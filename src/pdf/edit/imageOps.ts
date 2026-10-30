/**
 * Find / remove / replace images that already exist in a PDF page.
 *
 * An image is identified by its placement matrix (the CTM when it is painted,
 * as reported by pdf.js) plus its paint index on the page. We walk the page
 * content (recursing into form XObjects) tracking q/Q/cm and match paints by
 * that matrix. Rewrites go through fresh streams, so shared form XObjects and
 * other pages are never affected.
 */
import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFStream,
  decodePDFRawStream,
  type PDFDocument,
  type PDFPage,
} from 'pdf-lib'
import { parseContent, rewrite } from './contentStream'

export type Mat = [number, number, number, number, number, number]
const ID: Mat = [1, 0, 0, 1, 0, 0]
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
]

export function closeMatrix(a: Mat, b: Mat): boolean {
  const scale = Math.max(1, Math.abs(a[0]) + Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[3]))
  for (let k = 0; k < 4; k++) if (Math.abs(a[k] - b[k]) > scale * 0.01 + 0.01) return false
  return Math.abs(a[4] - b[4]) < 0.75 && Math.abs(a[5] - b[5]) < 0.75
}

function streamBytes(s: PDFStream): Uint8Array {
  if (s instanceof PDFRawStream) {
    try {
      return decodePDFRawStream(s).decode()
    } catch {
      return s.getContents()
    }
  }
  return (s as unknown as { getContents: () => Uint8Array }).getContents()
}

const num = (t: { value?: number | string }) => (typeof t.value === 'number' ? t.value : 0)

export interface PaintSite {
  /** placement matrix in page user space */
  matrix: Mat
  /** order of the paint among image paints on the page */
  index: number
  /** image XObject (null for inline images) */
  xobject: PDFStream | null
  /** inline image raw bytes (BI ... EI), when inline */
  inlineBytes?: Uint8Array
  /** rewrite this paint: replacement content (e.g. ' /X1 Do ') or ' ' to delete */
  replace: (content: string) => void
  /** add an XObject resource visible at this paint site; returns its name */
  addXObject: (ref: PDFRef, tag: string) => string
}

/**
 * Visit every image paint on the page. `onPaint` may call site.replace();
 * rewritten streams are written back after the walk.
 */
export function walkImagePaints(
  doc: PDFDocument,
  page: PDFPage,
  onPaint: (site: PaintSite) => void,
  baseMatrix: Mat = ID,
): void {
  let paintIndex = 0

  interface Frame {
    bytes: Uint8Array
    resources: PDFDict | undefined
    edits: { start: number; end: number; with: string }[]
    /** creates the resources dict on demand */
    ensureResources: () => PDFDict
    commit: (bytes: Uint8Array) => void
  }

  const addXObjectTo = (res: PDFDict, ref: PDFRef, tag: string): string => {
    let xo = res.lookup(PDFName.of('XObject'))
    if (!(xo instanceof PDFDict)) {
      xo = doc.context.obj({})
      res.set(PDFName.of('XObject'), xo)
    }
    const key = (xo as PDFDict).uniqueKey(tag)
    ;(xo as PDFDict).set(key, ref)
    return key.toString()
  }

  const visit = (fr: Frame, ctm0: Mat, depth: number) => {
    if (depth > 12) return
    const instrs = parseContent(fr.bytes)
    let ctm = ctm0
    const stack: Mat[] = []
    const xobjs = fr.resources?.lookup(PDFName.of('XObject'))
    for (const ins of instrs) {
      if (ins.op === 'q') stack.push(ctm)
      else if (ins.op === 'Q') {
        if (stack.length) ctm = stack.pop()!
      } else if (ins.op === 'cm') {
        if (ins.args.length >= 6) ctm = mul(ctm, ins.args.slice(-6).map(num) as Mat)
      } else if (ins.op === 'BI' || ins.op === 'Do') {
        let xobject: PDFStream | null = null
        let isForm = false
        let formRaw: unknown = null
        if (ins.op === 'Do') {
          const nameTok = ins.args[ins.args.length - 1]
          const name = typeof nameTok?.value === 'string' ? nameTok.value : null
          if (!name || !(xobjs instanceof PDFDict)) continue
          formRaw = xobjs.get(PDFName.of(name))
          const xo = formRaw instanceof PDFRef ? doc.context.lookup(formRaw) : formRaw
          if (!(xo instanceof PDFStream)) continue
          const sub = xo.dict.get(PDFName.of('Subtype'))?.toString()
          if (sub === '/Form') isForm = true
          else if (sub === '/Image') xobject = xo
          else continue
          if (isForm) {
            const fm = xo.dict.lookup(PDFName.of('Matrix'))
            let m: Mat = ID
            if (fm instanceof PDFArray && fm.size() === 6) {
              m = [0, 1, 2, 3, 4, 5].map((k) => {
                const v = fm.lookup(k)
                return v instanceof PDFNumber ? v.asNumber() : 0
              }) as Mat
            }
            const fres = xo.dict.lookup(PDFName.of('Resources'))
            const childRes = fres instanceof PDFDict ? fres : fr.resources
            const child: Frame = {
              bytes: streamBytes(xo),
              resources: childRes,
              edits: [],
              ensureResources: () => {
                if (child.resources) return child.resources
                const d = doc.context.obj({}) as PDFDict
                child.resources = d
                return d
              },
              commit: (bytes) => {
                // copy-on-write: fresh form stream, same dict (minus encoding)
                const fresh = doc.context.flateStream(bytes, {})
                for (const [k, v] of xo.dict.entries()) {
                  const ks = k.toString()
                  if (ks === '/Filter' || ks === '/DecodeParms' || ks === '/Length') continue
                  fresh.dict.set(k, v)
                }
                if (child.resources) fresh.dict.set(PDFName.of('Resources'), child.resources)
                const ref = doc.context.register(fresh)
                const key = addXObjectTo(fr.ensureResources(), ref, 'FmE')
                fr.edits.push({ start: ins.start, end: ins.end, with: ` ${key} Do ` })
              },
            }
            // resources of the child may be shared: clone before mutation
            if (child.resources) child.resources = child.resources.clone(doc.context)
            visit(child, mul(ctm, m), depth + 1)
            if (child.edits.length) child.commit(rewrite(child.bytes, child.edits))
            continue
          }
        }
        const site: PaintSite = {
          matrix: mul(baseMatrix, ctm),
          index: paintIndex++,
          xobject,
          inlineBytes: ins.op === 'BI' ? fr.bytes.subarray(ins.start, ins.end) : undefined,
          replace: (content) => fr.edits.push({ start: ins.start, end: ins.end, with: content }),
          addXObject: (ref, tag) => addXObjectTo(fr.ensureResources(), ref, tag),
        }
        onPaint(site)
      }
    }
  }

  // page content: Contents may be an array; q/Q/cm carry across streams
  const contents = page.node.Contents()
  const chunks: Uint8Array[] = []
  if (contents instanceof PDFArray) {
    for (let k = 0; k < contents.size(); k++) {
      const s = contents.lookup(k)
      if (s instanceof PDFStream) chunks.push(streamBytes(s))
    }
  } else if (contents instanceof PDFStream) {
    chunks.push(streamBytes(contents))
  }
  const joined = new Uint8Array(chunks.reduce((a, c) => a + c.length + 1, 0))
  let o = 0
  for (const c of chunks) {
    joined.set(c, o)
    o += c.length
    joined[o++] = 0x0a
  }
  const pr = page.node.Resources()
  const pageFrame: Frame = {
    bytes: joined,
    resources: pr instanceof PDFDict ? pr : undefined,
    edits: [],
    ensureResources: () => {
      if (pageFrame.resources) return pageFrame.resources
      const d = doc.context.obj({}) as PDFDict
      page.node.set(PDFName.of('Resources'), d)
      pageFrame.resources = d
      return d
    },
    commit: (bytes) => {
      const ref = doc.context.register(doc.context.flateStream(bytes, {}))
      page.node.set(PDFName.of('Contents'), doc.context.obj([ref]))
    },
  }
  visit(pageFrame, ID, 0)
  if (pageFrame.edits.length) pageFrame.commit(rewrite(pageFrame.bytes, pageFrame.edits))
}

// ── exporting the original image bytes ───────────────────────────

export interface ExtractedImage {
  /** file extension: jpg (DCT), jp2 (JPX), or png (re-encoded by caller) */
  kind: 'jpg' | 'jp2' | 'raw'
  bytes?: Uint8Array
}

/** original encoded bytes when the image is a plain JPEG/JPEG2000 stream */
export function originalImageBytes(xobject: PDFStream): ExtractedImage {
  const filter = xobject.dict.lookup(PDFName.of('Filter'))
  const names: string[] = []
  if (filter instanceof PDFName) names.push(filter.toString())
  else if (filter instanceof PDFArray) {
    for (let k = 0; k < filter.size(); k++) {
      const f = filter.lookup(k)
      if (f instanceof PDFName) names.push(f.toString())
    }
  }
  const smask = xobject.dict.get(PDFName.of('SMask')) || xobject.dict.get(PDFName.of('Mask'))
  const decode = xobject.dict.get(PDFName.of('Decode'))
  const cs = xobject.dict.lookup(PDFName.of('ColorSpace'))
  const csName = cs instanceof PDFName ? cs.toString() : ''
  // JPEG pass-through is only faithful without masks/decode arrays/CMYK
  if (names.length === 1 && names[0] === '/DCTDecode' && !smask && !decode && csName !== '/DeviceCMYK') {
    return { kind: 'jpg', bytes: (xobject as PDFRawStream).getContents() }
  }
  if (names.length === 1 && names[0] === '/JPXDecode' && !smask) {
    return { kind: 'jp2', bytes: (xobject as PDFRawStream).getContents() }
  }
  return { kind: 'raw' }
}
