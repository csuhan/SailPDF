/**
 * Locate fonts for baking replacement text so it matches the original:
 * 1) fonts embedded in the source PDF (exact match when glyphs cover the text)
 * 2) system fonts matched by family name (queryLocalFonts in the browser;
 *    the desktop shell provides fs-based lookup on macOS)
 */
import { PDFDict, PDFDocument, PDFName, PDFStream, PDFString } from 'pdf-lib'
import { cleanFontName } from '../fontMatch'
import { normalizeFontProgram } from './fontProgram'

// fontkit is heavy — load it lazily so startup stays fast
interface FontkitLike {
  create: (buffer: Uint8Array, postscriptName?: string) => unknown
}
let fontkitModulePromise: Promise<FontkitLike> | null = null
export function loadFontkit(): Promise<FontkitLike> {
  if (!fontkitModulePromise) {
    fontkitModulePromise = import('@pdf-lib/fontkit').then(
      (m) => ((m as { default?: FontkitLike }).default ?? m) as unknown as FontkitLike,
    )
  }
  return fontkitModulePromise
}

type FontkitCreate = FontkitLike['create']

interface EmbeddedProgram {
  family: string
  base: string
  bold: boolean
  italic: boolean
  bytes: Uint8Array
  fontkitFont: ReturnType<FontkitCreate> | null
}

const programCache = new WeakMap<PDFDocument, Promise<EmbeddedProgram[]>>()

function nameOfFont(fd: PDFDict): string {
  try {
    const n = fd.get(PDFName.of('FontName')) as PDFName | PDFString | undefined
    if (n instanceof PDFName) return n.asString()
    if (n instanceof PDFString) return n.decodeText()
  } catch {
    /* ignore */
  }
  return ''
}

export function collectEmbeddedFonts(doc: PDFDocument): Promise<EmbeddedProgram[]> {
  const cached = programCache.get(doc)
  if (cached) return cached
  const p = collectEmbeddedFontsInner(doc)
  programCache.set(doc, p)
  return p
}

const seenRef = new WeakSet<object>()

async function collectEmbeddedFontsInner(doc: PDFDocument): Promise<EmbeddedProgram[]> {
  const fontkit = await loadFontkit()
  const out: EmbeddedProgram[] = []
  for (const page of doc.getPages()) {
    try {
      const resources = page.node.Resources()
      if (!resources || !(resources instanceof PDFDict)) continue
      const fonts = resources.lookup(PDFName.of('Font'))
      if (!(fonts instanceof PDFDict)) continue
      for (const [, ref] of fonts.entries()) {
        if (typeof ref === 'object' && ref !== null) {
          if (seenRef.has(ref)) continue
          seenRef.add(ref)
        }
        try {
          const fontDict = doc.context.lookup(ref)
          if (!(fontDict instanceof PDFDict)) continue
          const fd = fontDict.lookup(PDFName.of('FontDescriptor'))
          if (!(fd instanceof PDFDict)) continue
          let stream: PDFStream | null = null
          for (const key of ['FontFile2', 'FontFile3', 'FontFile']) {
            const s = fd.lookup(PDFName.of(key))
            if (s instanceof PDFStream) {
              stream = s
              break
            }
          }
          if (!stream) continue
          const bytes = stream.getContents()
          const fontName = nameOfFont(fd)
          let fk: EmbeddedProgram['fontkitFont'] = null
          let family = ''
          let base = fontName
          let bold = false
          let italic = false
          try {
            fk = fontkit.create(bytes) as EmbeddedProgram['fontkitFont']
            family = (fk as { familyName?: string }).familyName ?? ''
            const sub = (fk as { subfamilyName?: string }).subfamilyName ?? ''
            const cleaned = cleanFontName(fontName || family)
            base = cleaned.base || family
            bold = cleaned.bold || /bold/i.test(sub)
            italic = cleaned.italic || /italic|oblique/i.test(sub)
          } catch {
            const cleaned = cleanFontName(fontName)
            family = cleaned.family
            bold = cleaned.bold
            italic = cleaned.italic
          }
          out.push({ family, base, bold, italic, bytes, fontkitFont: fk })
        } catch {
          /* skip font */
        }
      }
    } catch {
      /* skip page */
    }
  }
  return out
}

function covers(fk: EmbeddedProgram['fontkitFont'], text: string): boolean {
  if (!fk) return false
  const anyFk = fk as unknown as { hasGlyphForCodePoint?: (cp: number) => boolean }
  if (!anyFk.hasGlyphForCodePoint) return false
  for (const ch of text) {
    const cp = ch.codePointAt(0)!
    if (cp === 32 || cp === 10) continue
    try {
      if (!anyFk.hasGlyphForCodePoint(cp)) return false
    } catch {
      return false
    }
  }
  return true
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** find an embedded font program matching the wanted family/style & glyphs */
export async function findEmbeddedFont(
  doc: PDFDocument,
  family: string,
  bold: boolean,
  italic: boolean,
  newText: string,
): Promise<Uint8Array | null> {
  if (!family) return null
  const want = norm(family)
  const fonts = await collectEmbeddedFonts(doc)
  if (fonts.length === 0) return null
  const score = (p: EmbeddedProgram): number => {
    const famA = norm(p.base || p.family)
    const famB = norm(p.family)
    if (!famA.includes(want) && !want.includes(famA) && !famB.includes(want) && !want.includes(famB)) {
      return -1
    }
    let s = famA === want || famB === want ? 10 : 6
    if (p.bold === bold) s += 3
    if (p.italic === italic) s += 3
    if (covers(p.fontkitFont, newText)) s += 10
    return s
  }
  let best: EmbeddedProgram | null = null
  let bestScore = -1
  for (const p of fonts) {
    const sc = score(p)
    if (sc > bestScore) {
      bestScore = sc
      best = p
    }
  }
  // require style-family match AND glyph coverage
  if (best && bestScore >= 10 && covers(best.fontkitFont, newText)) return best.bytes
  return null
}

// ── system fonts ──────────────────────────────────────────────

interface LocalFont {
  family: string
  fullName: string
  postscriptName: string
  style: string
  blob: () => Promise<Blob>
}

declare global {
  interface Window {
    queryLocalFonts?: (options?: { postscriptNames?: string[] }) => Promise<LocalFont[]>
  }
}

let localFontsCache: LocalFont[] | null | undefined
let fontPermPrompted = false

async function getLocalFonts(): Promise<LocalFont[]> {
  if (localFontsCache !== undefined && localFontsCache !== null) return localFontsCache
  try {
    if (!window.queryLocalFonts || fontPermPrompted) return []
    fontPermPrompted = true
    localFontsCache = await window.queryLocalFonts()
    return localFontsCache ?? []
  } catch {
    localFontsCache = null
    return []
  }
}

const sysFontCache = new Map<string, Uint8Array | null>()

/** search installed system fonts by family+style (browser: local-fonts API;
 *  desktop: preload-provided fs search — takes precedence) */
export async function findSystemFont(family: string, bold: boolean, italic: boolean): Promise<Uint8Array | null> {
  const key = `${family}#${bold}#${italic}`
  const cached = sysFontCache.get(key)
  if (cached !== undefined) return cached

  let result: Uint8Array | null = null

  // desktop (Electron preload bridge)
  const desktop = (window as unknown as Record<string, unknown>).pdfDesktop as
    | { searchFont?: (q: { family: string; bold: boolean; italic: boolean }) => Promise<Uint8Array | null> }
    | undefined
  if (desktop?.searchFont) {
    try {
      const data = await desktop.searchFont({ family, bold, italic })
      if (data) result = normalizeFontProgram(data instanceof Uint8Array ? data : new Uint8Array(data))
    } catch {
      /* continue to browser path */
    }
  }

  if (!result) {
    const fonts = await getLocalFonts()
    const want = family.toLowerCase().replace(/\s+/g, '')
    let candidates = fonts.filter(
      (f) =>
        f.family.toLowerCase().replace(/\s+/g, '').includes(want) ||
        want.includes(f.family.toLowerCase().replace(/\s+/g, '')),
    )
    if (candidates.length === 0) candidates = []
    const styleScore = (f: LocalFont): number => {
      const st = f.style.toLowerCase()
      let s = 0
      if (bold === /bold|black|heavy|demi/.test(st)) s += 2
      if (italic === /italic|oblique/.test(st)) s += 2
      if (/regular|roman|plain/.test(st) && !bold && !italic) s += 2
      return s
    }
    candidates.sort((a, b) => styleScore(b) - styleScore(a))
    for (const c of candidates) {
      try {
        if (c.family.toLowerCase().replace(/\s+/g, '') !== want && candidates.length > 1 && styleScore(c) === 0) {
          continue
        }
        const buf = new Uint8Array(await (await c.blob()).arrayBuffer())
        result = normalizeFontProgram(buf, c.postscriptName)
        break
      } catch {
        /* next */
      }
    }
  }

  sysFontCache.set(key, result)
  return result
}
