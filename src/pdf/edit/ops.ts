/**
 * Edit operation model — every modification to the open document is an op.
 * Ops render live as canvas/DOM overlays, and are baked into the PDF on save.
 */

export type EditOp =
  | TextEditOp
  | OverlayTextOp
  | ImageOp
  | PageImageOp
  | NoteOp
  | WatermarkOp
  | PageNumbersOp
  | DocInfoOp
  | DrawOp
  | ShapeOp
  | HighlightOp
  | RedactOp
  | PageRotateOp
  | PageDeleteOp
  | PageInsertBlankOp
  | PageReorderOp
  | SecurityOp
  | PageCropOp
  | AnnotDeleteOp
  | LinkOp

/** a link area: opens a web address or jumps to a page (view page number) */
export interface LinkOp extends OpBase {
  kind: 'link'
  x: number
  y: number
  width: number
  height: number
  url?: string
  /** target view page (1-based) for internal links */
  toPage?: number
}

/** delete an annotation that exists in the file (pdf.js id like "12R") */
export interface AnnotDeleteOp extends OpBase {
  kind: 'annot-delete'
  annotId: string
}

/**
 * crop pages (CropBox). op.page is 0; `pages` lists the stable page refs it
 * applies to, or 'all'. Margins in points from each edge of the current
 * page box; all zero = remove a previous crop. Latest op per page wins.
 */
export interface PageCropOp extends OpBase {
  kind: 'page-crop'
  pages: number[] | 'all'
  margins: { left: number; right: number; top: number; bottom: number }
}

/**
 * document security to write on save (op.page is 0; latest op wins).
 * null removes the password protection.
 */
export interface SecurityOp extends OpBase {
  kind: 'security'
  protect: {
    userPassword: string
    /** null: keep a random permissions password */
    ownerPassword: string | null
    permissions: {
      print: boolean
      printHigh: boolean
      modify: boolean
      copy: boolean
      annotate: boolean
      fillForms: boolean
      assemble: boolean
    }
  } | null
}

interface OpBase {
  id: string
  /**
   * stable page reference: value from computePageMap at creation time
   * (>0 = original 1-based page number, <0 = inserted blank page id).
   * Stays valid across reorder/delete undo; bake maps it to the final index.
   */
  page: number
  /** ops pushed together (pushOps) share a group: undo/redo treats them as one */
  group?: string
}

/** replace existing text: original rect is whited-out, new text drawn on top.
 * coordinates are in PDF user units (points), origin bottom-left. */
export interface TextEditOp extends OpBase {
  kind: 'text-edit'
  rect: { x: number; y: number; width: number; height: number }
  newText: string
  fontSize: number
  fontName: StandardFontName
  color: string
  /** pdf x of the text start (baseline origin); defaults to rect.x */
  x?: number
  /** pdf y of the baseline; defaults to rect-derived */
  baselineY?: number
  /** cleaned original family, e.g. "Georgia" — used for bake font resolution */
  baseFamily?: string
  bold?: boolean
  italic?: boolean
  /** generic fallback matching the original: serif | sans-serif | monospace */
  fontFallback?: 'serif' | 'sans-serif' | 'monospace'
  /**
   * style-preserving reconstruction of the original line: when present, the
   * bake draws THESE runs instead of newText. Unedited runs carry their
   * original fonts/colors; the edited zone carries the anchor style. All
   * runs share this op's baselineY.
   */
  runs?: TextEditRun[]
  /**
   * a pdf point on the ORIGINAL line; re-editing finds the line again from
   * the unchanged document through it (glyph-model based edits only)
   */
  anchor?: { x: number; y: number }
  /** the original line text (before any edit) */
  originalText?: string
  /** a later edit of the same line supersedes the op with this id */
  replaces?: string
  /** clickable area (white-out ∪ new text), pdf user space */
  hitRect?: { x: number; y: number; width: number; height: number }
}

export interface TextEditRun {
  text: string
  /** pdf x of this run's start at the shared baseline */
  x: number
  fontSize: number
  color: string
  baseFamily?: string
  bold?: boolean
  italic?: boolean
  fontFallback?: 'serif' | 'sans-serif' | 'monospace'
  fontName?: StandardFontName
  /**
   * the ORIGINAL font of the document. When present, `pieces` with `hex`
   * are written with that very font resource (exact glyphs, metrics, kerning
   * base), so edited text is indistinguishable from untouched text.
   */
  pdfFont?: {
    baseFont: string
    loadedName: string
    type3?: boolean
    /**
     * fingerprint to pick the right dict when several fonts share a name
     * (same BaseFont, different encodings): sampled char code -> width
     */
    widthSig?: [number, number][]
  }
  /** exact layout of the run; pieces without `hex` use the fallback font */
  pieces?: TextEditPiece[]
  /** horizontal text scaling of the original (1 = none) */
  hScale?: number
  /** PDF text render mode (0 fill, 1 stroke, 2 fill+stroke) */
  renderMode?: number
  strokeColor?: string
  /** stroke width in user units */
  strokeWidth?: number
}

export interface TextEditPiece {
  text: string
  /** absolute pdf x of the piece start */
  x: number
  /** char codes in the original font (hex), when encodable */
  hex?: string
  /** pdf.js private-use glyph string for the live preview */
  pua?: string
  /**
   * explicit per-glyph placement (exact positions incl. kerning). dx and w
   * are pdf user units relative to `x`; takes precedence over hex/pua.
   */
  glyphs?: { hex: string; pua: string; dx: number; w: number }[]
}

export interface OverlayTextOp extends OpBase {
  kind: 'overlay-text'
  x: number
  y: number
  text: string
  fontSize: number
  fontName: StandardFontName
  color: string
}

export interface ImageOp extends OpBase {
  kind: 'image'
  x: number
  y: number
  width: number
  height: number
  /** rotation clockwise, degrees */
  rotation: number
  imageType: 'png' | 'jpg'
  imageData: Uint8Array
}

/**
 * Delete or replace an image that is part of the ORIGINAL page content.
 * The image is located by its placement matrix + paint index at bake time.
 */
export interface PageImageOp extends OpBase {
  kind: 'page-image'
  action: 'delete' | 'replace'
  /** placement matrix (unit square -> page user space) */
  matrix: [number, number, number, number, number, number]
  /** paint order of the image on the page */
  index: number
  /** axis-aligned box in page user space (hit testing / preview) */
  box: { x0: number; y0: number; x1: number; y1: number }
  /** replacement image, drawn into the same placement */
  imageType?: 'png' | 'jpg'
  imageData?: Uint8Array
  /** replacement fitting inside the original box */
  fit?: 'contain' | 'stretch'
}

/** sticky note: baked as a real PDF Text annotation (visible in any reader) */
export interface NoteOp extends OpBase {
  kind: 'note'
  /** icon anchor (top-left) in pdf user space */
  x: number
  y: number
  text: string
  color: string
  author?: string
  /** ISO time of the last change */
  modified: string
}

/** document-wide watermark (op.page is 0) */
export interface WatermarkOp extends OpBase {
  kind: 'watermark'
  text: string
  fontSize: number
  color: string
  opacity: number
  /** degrees, counter-clockwise */
  angle: number
  /** draw behind the page content instead of on top */
  behind?: boolean
}

/** document-wide page numbers (op.page is 0) */
export interface PageNumbersOp extends OpBase {
  kind: 'page-numbers'
  /** e.g. "{n}" / "{n} / {total}" / "第 {n} 页" */
  format: string
  position: 'bottom-center' | 'bottom-right' | 'bottom-left' | 'top-center' | 'top-right' | 'top-left'
  fontSize: number
  color: string
  /** first page that gets a number (1-based, view order) */
  startPage: number
  /** number shown on startPage */
  startNumber: number
}

/** document properties (op.page is 0); latest op wins */
export interface DocInfoOp extends OpBase {
  kind: 'doc-info'
  title: string
  author: string
  subject: string
  keywords: string
}

export interface DrawOp extends OpBase {
  kind: 'draw'
  /** polyline in PDF points */
  points: { x: number; y: number }[]
  color: string
  thickness: number
  opacity: number
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'arrow'
export interface ShapeOp extends OpBase {
  kind: 'shape'
  shape: ShapeKind
  x: number
  y: number
  width: number
  height: number
  color: string
  thickness: number
  fill: boolean
}

export type MarkupKind = 'highlight' | 'underline' | 'strikeout'
export interface HighlightOp extends OpBase {
  kind: 'markup'
  markup: MarkupKind
  /** quads in PDF points */
  quads: { x: number; y: number; width: number; height: number }[]
  color: string
  opacity: number
}

export interface RedactOp extends OpBase {
  kind: 'redact'
  x: number
  y: number
  width: number
  height: number
}

export interface PageRotateOp extends OpBase {
  kind: 'page-rotate'
  /** 0-based index in the edited page order */
  pageIndex: number
  degrees: 90 | 180 | 270
}

export interface PageDeleteOp extends OpBase {
  kind: 'page-delete'
  pageIndex: number
  page: number
}

export interface PageInsertBlankOp extends OpBase {
  kind: 'page-insert-blank'
  /** insert position (0-based) in edited page order */
  pageIndex: number
  width: number
  height: number
}

export interface PageReorderOp extends OpBase {
  kind: 'page-reorder'
  /** new order of original 1-based page numbers; blank pages represented as negative ids */
  order: number[]
  page: number
}

export type StandardFontName =
  | 'Helvetica'
  | 'Helvetica-Bold'
  | 'Helvetica-Oblique'
  | 'Helvetica-BoldOblique'
  | 'Times-Roman'
  | 'Times-Bold'
  | 'Times-Italic'
  | 'Times-BoldItalic'
  | 'Courier'
  | 'Courier-Bold'

let opSeq = 0
export function newOpId(): string {
  return `op-${Date.now().toString(36)}-${opSeq++}`
}
