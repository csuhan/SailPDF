/**
 * Export variants of the current document:
 *  - with annotations (as saved)
 *  - flattened: annotations and form fields become part of the page content
 *    (cannot be edited / removed by other readers)
 *  - clean: all comments / markup removed (markup ops of this session are
 *    left out, and existing markup annotations of the file are dropped);
 *    real content edits are kept
 */
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFOperator } from 'pdf-lib'
import { bakePdf } from './applyOps'
import type { EditOp } from './ops'
import { pdfjs } from '../document'
import { bytesWithFormValues } from '../document'

export type ExportVariant = 'normal' | 'flatten' | 'clean'

/** ops that are comments rather than content */
const COMMENT_KINDS = new Set<EditOp['kind']>(['note', 'markup', 'draw', 'shape', 'image', 'overlay-text'])

/** markup-type annotation subtypes removed by "clean" */
const COMMENT_SUBTYPES = new Set([
  'Text',
  'FreeText',
  'Highlight',
  'Underline',
  'StrikeOut',
  'Squiggly',
  'Ink',
  'Square',
  'Circle',
  'Line',
  'Polygon',
  'PolyLine',
  'Stamp',
  'Caret',
  'Popup',
  'FileAttachment',
  'Sound',
])

export async function exportVariant(
  fileBytes: Uint8Array,
  ops: EditOp[],
  variant: ExportVariant,
  keepStampsAndText = true,
): Promise<Uint8Array> {
  const base = (await bytesWithFormValues()) ?? fileBytes
  const content = ops.filter((o) => o.kind !== 'security')
  if (variant === 'clean') {
    const keep = content.filter((o) => {
      if (!COMMENT_KINDS.has(o.kind)) return true
      // added text / images / stamps are content for many users
      return keepStampsAndText && (o.kind === 'overlay-text' || o.kind === 'image')
    })
    const bytes = keep.length ? await bakePdf(base, keep) : base
    const doc = await PDFDocument.load(bytes, { updateMetadata: false })
    for (const page of doc.getPages()) {
      const annots = page.node.lookup(PDFName.of('Annots'))
      if (!(annots instanceof PDFArray)) continue
      const kept: unknown[] = []
      for (let i = 0; i < annots.size(); i++) {
        const a = annots.lookup(i)
        const st = a instanceof PDFDict ? a.lookup(PDFName.of('Subtype')) : undefined
        if (st instanceof PDFName && COMMENT_SUBTYPES.has(st.decodeText())) continue
        kept.push(annots.get(i))
      }
      page.node.set(PDFName.of('Annots'), doc.context.obj(kept as never))
    }
    return doc.save({ useObjectStreams: true })
  }
  const bytes = content.length ? await bakePdf(base, content) : base
  if (variant === 'normal') return bytes
  return flatten(bytes)
}

/**
 * Flatten: every page is redrawn from what pdf.js renders INCLUDING
 * annotations and form fields. Text stays real text: the page content is
 * kept and annotation appearances are merged in through pdf.js' print
 * intent operator list, approximated here by stamping each annotation's
 * appearance stream onto the page and removing the annotation.
 */
async function flatten(bytes: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  // forms: pdf-lib can flatten AcroForm fields into page content
  try {
    const form = doc.getForm()
    if (form.getFields().length) form.flatten()
  } catch {
    /* no / broken form */
  }
  for (const page of doc.getPages()) {
    const annots = page.node.lookup(PDFName.of('Annots'))
    if (!(annots instanceof PDFArray)) continue
    const kept: unknown[] = []
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i)
      if (!(a instanceof PDFDict)) continue
      const st = a.lookup(PDFName.of('Subtype'))
      const name = st instanceof PDFName ? st.decodeText() : ''
      // links stay clickable; popups have no appearance of their own
      if (name === 'Link' || name === 'Widget') {
        kept.push(annots.get(i))
        continue
      }
      if (name === 'Popup') continue
      const ap = a.lookup(PDFName.of('AP'))
      const n = ap instanceof PDFDict ? ap.lookup(PDFName.of('N')) : undefined
      const rect = a.lookup(PDFName.of('Rect'))
      if (!n || !(rect instanceof PDFArray)) continue
      const r = rect.asRectangle()
      // /N may be a stream or a dict of states (/AS picks the state)
      let nRef = (ap as PDFDict).get(PDFName.of('N'))
      if (n instanceof PDFDict && !(n as unknown as { dict?: unknown }).dict) {
        const as = a.lookup(PDFName.of('AS'))
        nRef = as instanceof PDFName ? n.get(as) : undefined
        if (!nRef) continue
      }
      const xo = page.node.newXObject('FlatA', nRef as never)
      // the appearance BBox maps onto Rect
      const stream = doc.context.lookup(nRef as never) as unknown as { dict?: PDFDict }
      const bbox = stream?.dict?.lookup(PDFName.of('BBox'))
      let sx = 1
      let sy = 1
      let ox = 0
      let oy = 0
      if (bbox instanceof PDFArray) {
        const b = bbox.asRectangle()
        sx = b.width ? r.width / b.width : 1
        sy = b.height ? r.height / b.height : 1
        ox = -b.x * sx
        oy = -b.y * sy
      }
      page.pushOperators(
        ...([
          { op: 'q', args: [] },
          { op: 'cm', args: [sx, 0, 0, sy, r.x + ox, r.y + oy] },
          { op: 'Do', args: [xo] },
          { op: 'Q', args: [] },
        ].map((x) => opOf(x.op, x.args)) as never[]),
      )
    }
    page.node.set(PDFName.of('Annots'), doc.context.obj(kept as never))
  }
  return doc.save({ useObjectStreams: true })
}

function opOf(op: string, args: (number | PDFName)[]): PDFOperator {
  return PDFOperator.of(
    op as never,
    args.map((a) => (typeof a === 'number' ? PDFNumber.of(a) : a)),
  )
}

/** sanity check used by tests: does the output open? */
export async function opens(bytes: Uint8Array): Promise<number> {
  const d = await pdfjs.getDocument({ data: bytes.slice() }).promise
  const n = d.numPages
  void d.destroy()
  return n
}
