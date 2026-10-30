import { tr, onLocaleChange } from '../i18n/locale'
/**
 * Annotations that already exist in the file (read with pdf.js), plus
 * import / export of annotations as portable JSON (page + geometry +
 * contents), and deleting file annotations on save.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PDFArray, PDFDict, PDFName, PDFRef, type PDFDocument } from 'pdf-lib'
import { newOpId, type EditOp } from './edit/ops'

export interface FileAnnot {
  /** pdf.js annotation id ("12R") */
  id: string
  page: number
  kind: 'note' | 'markup' | 'draw' | 'shape' | 'text' | 'stamp'
  subtype: string
  label: string
  contents: string
  color: string
  author?: string
  date?: string
  box: { x0: number; y0: number; x1: number; y1: number }
  /** quads for markup (x,y,w,h) */
  quads?: { x: number; y: number; width: number; height: number }[]
}

function createSubtype(): Record<string, { kind: FileAnnot['kind']; label: string }> {
  return {
    Text: { kind: 'note', label: tr('便签') },
    FreeText: { kind: 'text', label: tr('文本框') },
    Highlight: { kind: 'markup', label: tr('高亮') },
    Underline: { kind: 'markup', label: tr('下划线') },
    StrikeOut: { kind: 'markup', label: tr('删除线') },
    Squiggly: { kind: 'markup', label: tr('波浪线') },
    Ink: { kind: 'draw', label: tr('画笔') },
    Square: { kind: 'shape', label: tr('矩形') },
    Circle: { kind: 'shape', label: tr('椭圆') },
    Line: { kind: 'shape', label: tr('直线') },
    Polygon: { kind: 'shape', label: tr('多边形') },
    PolyLine: { kind: 'shape', label: tr('折线') },
    Stamp: { kind: 'stamp', label: tr('图章') },
  }
}

let SUBTYPE: Record<string, { kind: FileAnnot['kind']; label: string }> = createSubtype()

const hex = (c: unknown): string => {
  const a = c as ArrayLike<number> | null | undefined
  if (!a || a.length < 3) return '#f5b400'
  // pdf.js gives 0..255 (Uint8ClampedArray)
  const v = (x: number) => Math.round(x).toString(16).padStart(2, '0')
  return `#${v(a[0])}${v(a[1])}${v(a[2])}`
}

export async function loadFileAnnotations(doc: PDFDocumentProxy, onlyPage?: number): Promise<FileAnnot[]> {
  const out: FileAnnot[] = []
  for (let p = onlyPage ?? 1; p <= (onlyPage ?? doc.numPages); p++) {
    let list: Record<string, unknown>[] = []
    try {
      list = (await (await doc.getPage(p)).getAnnotations({ intent: 'display' })) as Record<string, unknown>[]
    } catch {
      continue
    }
    for (const a of list) {
      const st = SUBTYPE[String(a.subtype)]
      if (!st) continue
      // pdf.js gives popups separately; their parent carries the text
      const r = (a.rect as number[]) ?? [0, 0, 0, 0]
      const contents = (a.contentsObj as { str?: string } | undefined)?.str ?? (a.contents as string) ?? ''
      const quadPoints = a.quadPoints as Float32Array | number[] | undefined
      let quads: FileAnnot['quads']
      if (quadPoints && quadPoints.length >= 8) {
        quads = []
        for (let i = 0; i + 7 < quadPoints.length; i += 8) {
          const xs = [quadPoints[i], quadPoints[i + 2], quadPoints[i + 4], quadPoints[i + 6]]
          const ys = [quadPoints[i + 1], quadPoints[i + 3], quadPoints[i + 5], quadPoints[i + 7]]
          quads.push({
            x: Math.min(...xs),
            y: Math.min(...ys),
            width: Math.max(...xs) - Math.min(...xs),
            height: Math.max(...ys) - Math.min(...ys),
          })
        }
      }
      out.push({
        id: String(a.id),
        page: p,
        kind: st.kind,
        subtype: String(a.subtype),
        label: st.label,
        contents,
        color: hex(a.color),
        author: (a.titleObj as { str?: string } | undefined)?.str || undefined,
        date: (a.modificationDate as string) || (a.creationDate as string) || undefined,
        box: { x0: Math.min(r[0], r[2]), y0: Math.min(r[1], r[3]), x1: Math.max(r[0], r[2]), y1: Math.max(r[1], r[3]) },
        quads,
      })
    }
  }
  return out
}

// ── portable export / import ───────────────────────────────────

interface Exported {
  format: 'pdfpro-annotations'
  version: 1
  annotations: Record<string, unknown>[]
}

const PORTABLE = new Set(['note', 'markup', 'draw', 'shape', 'overlay-text'])

/** annotations as JSON: page numbers are view pages (1-based) */
export function exportAnnotations(ops: EditOp[], file: FileAnnot[]): string {
  const annotations: Record<string, unknown>[] = []
  for (const a of file) {
    if (a.kind === 'note')
      annotations.push({
        kind: 'note',
        page: a.page,
        x: a.box.x0,
        y: a.box.y1,
        text: a.contents,
        color: a.color,
        author: a.author,
      })
    else if (a.kind === 'markup' && a.quads) {
      const markup = a.subtype === 'Underline' ? 'underline' : a.subtype === 'StrikeOut' ? 'strikeout' : 'highlight'
      annotations.push({ kind: 'markup', page: a.page, markup, quads: a.quads, color: a.color })
    }
  }
  for (const op of ops) {
    if (!PORTABLE.has(op.kind)) continue
    const { id: _id, group: _g, ...rest } = op as EditOp & { group?: string }
    void _id
    void _g
    annotations.push(rest)
  }
  const out: Exported = { format: 'pdfpro-annotations', version: 1, annotations }
  return JSON.stringify(out, null, 1)
}

export function importAnnotations(json: string, pageMap: number[]): EditOp[] {
  const data = JSON.parse(json) as Exported
  if (data.format !== 'pdfpro-annotations' || !Array.isArray(data.annotations))
    throw new Error(tr('不是 Sail PDF 导出的批注文件'))
  const out: EditOp[] = []
  for (const a of data.annotations) {
    const kind = String(a.kind)
    if (!PORTABLE.has(kind)) continue
    const page = Number(a.page)
    if (!pageMap.includes(page)) continue
    if (kind === 'note' && !a.modified) a.modified = new Date().toISOString()
    if (kind === 'markup' && a.opacity === undefined) a.opacity = a.markup === 'highlight' ? 0.42 : 1
    out.push({ ...(a as object), id: newOpId(), page } as EditOp)
  }
  return out
}

// ── deleting annotations of the file on save ───────────────────

/** remove annotations by pdf.js id ("12R" = object 12 gen 0) from a page */
export function deleteFileAnnotations(doc: PDFDocument, pageIndex: number, ids: string[]): void {
  const page = doc.getPage(pageIndex)
  const annots = page.node.lookup(PDFName.of('Annots'))
  if (!(annots instanceof PDFArray)) return
  const drop = new Set(ids)
  const keep: unknown[] = []
  const popups = new Set<string>()
  for (let i = 0; i < annots.size(); i++) {
    const raw = annots.get(i)
    const key = raw instanceof PDFRef ? `${raw.objectNumber}R${raw.generationNumber ? raw.generationNumber : ''}` : ''
    if (drop.has(key)) {
      // its popup goes too
      const d = annots.lookup(i)
      const pop = d instanceof PDFDict ? d.get(PDFName.of('Popup')) : undefined
      if (pop instanceof PDFRef) popups.add(pop.toString())
      continue
    }
    keep.push(raw)
  }
  const final = keep.filter((r) => !(r instanceof PDFRef && popups.has(r.toString())))
  page.node.set(PDFName.of('Annots'), doc.context.obj(final as never))
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  SUBTYPE = createSubtype()
})
