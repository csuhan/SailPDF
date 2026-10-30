import { tr } from '../../i18n/locale'
import { normalizeFontProgram } from './fontProgram'
/**
 * CJK / extended-character font support for baked text.
 *
 * pdf-lib's standard fonts can only encode WinAnsi. For CJK content we ask
 * Chrome's Local Font Access API for a system CJK font (PingFang SC on macOS,
 * Microsoft YaHei on Windows, Noto Sans CJK on Linux), select a usable face
 * from its font program, and embed it (subsetted).
 */

const PREFERRED_FAMILIES = [
  'PingFang SC',
  'PingFang TC',
  'Hiragino Sans GB',
  'Source Han Sans SC',
  'Source Han Sans CN',
  'Noto Sans CJK SC',
  'Noto Sans SC',
  'Microsoft YaHei',
  'SimSun',
  'STHeiti',
  'Arial Unicode MS',
]

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

let fontBytesPromise: Promise<Uint8Array | null> | null = null

/** CP1252 adds these on top of the latin-1 range — WinAnsi can encode them, so
 *  standard PDF fonts (and virtually every Latin text font) cover them too. */
const CP1252_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
])

export function textNeedsCustomFont(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c <= 0xff) continue
    if (CP1252_EXTRA.has(c)) continue
    return true
  }
  return false
}

export function loadSystemCjkFont(): Promise<Uint8Array | null> {
  if (!fontBytesPromise) fontBytesPromise = loadSystemCjkFontInner()
  return fontBytesPromise
}

async function loadSystemCjkFontInner(): Promise<Uint8Array | null> {
  try {
    if (!window.queryLocalFonts) return null
    const fonts = await window.queryLocalFonts()
    for (const family of PREFERRED_FAMILIES) {
      const candidates = fonts
        .filter((font) => font.family === family)
        .sort((a, b) => Number(!/regular|normal|roman/i.test(a.style)) - Number(!/regular|normal|roman/i.test(b.style)))
      for (const font of candidates) {
        try {
          const buf = new Uint8Array(await (await font.blob()).arrayBuffer())
          return normalizeFontProgram(buf, font.postscriptName)
        } catch {
          // Some macOS fonts export metadata without usable glyph outlines.
          // Continue to another installed face rather than failing during save.
        }
      }
    }
  } catch {
    return null
  }
  return null
}

/**
 * Embed a font that can encode the given text. Throws with a friendly
 * message when no font can encode the text.
 */
export async function fontForText(
  doc: import('pdf-lib').PDFDocument,
  text: string,
): Promise<import('pdf-lib').PDFFont> {
  if (!textNeedsCustomFont(text)) {
    const { StandardFonts } = await import('pdf-lib')
    return doc.embedFont(StandardFonts.Helvetica)
  }
  const bytes = await loadSystemCjkFont()
  if (!bytes) {
    throw new Error(
      tr(
        '文本包含非拉丁字符（如中文），需要嵌入系统字体，但当前浏览器不支持查询本地字体。请使用 Chrome/Edge，或以 “添加图片/画笔” 方式覆盖。',
      ),
    )
  }
  try {
    return await doc.embedFont(bytes, { subset: true })
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pdf-pro] CJK subset embedding failed, embedding full font instead:', e)
    return await doc.embedFont(bytes)
  }
}
