/**
 * Document structure recovery for conversions (Word / Markdown / LaTeX /
 * HTML). From each page's text items we rebuild:
 *  - lines (items on one baseline), merged into paragraphs
 *  - headings (by font size relative to the body size + boldness)
 *  - list items (bullets / numbering)
 *  - simple tables (rows of cells aligned on shared column starts)
 *  - two-column layouts (read left column first)
 *  - images (placed bitmaps, exported as PNG/JPEG)
 * Headers/footers repeated on most pages and page numbers are dropped.
 */
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { getGlyphModel } from '../edit/glyphModel'
import { exportPageImage } from '../edit/imageExport'

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: Inline[] }
  | { type: 'paragraph'; text: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'table'; rows: string[][] }
  | { type: 'image'; data: Uint8Array; ext: 'png' | 'jpg' | 'jp2'; width: number; height: number; name: string }
  | { type: 'pagebreak' }

export interface Inline {
  text: string
  bold?: boolean
  italic?: boolean
  /** link target */
  href?: string
}

export interface DocStructure {
  title: string
  blocks: Block[]
}

interface Item {
  str: string
  x: number
  y: number
  w: number
  size: number
  bold: boolean
  italic: boolean
  font: string
}

interface Line {
  items: Item[]
  x0: number
  x1: number
  y: number
  size: number
  text: string
}

const BULLET = /^\s*([•●○◦▪▫■□\-–—*·])\s+/
const NUMBERED =
  /^\s*((\d{1,3}|[a-z]|[ivx]{1,4})[.)、](?=\s)|\d{1,3}、|[（(]\d{1,3}[)）]|第[一二三四五六七八九十\d]+[章节条]|[一二三四五六七八九十]+、)\s*/

async function pageItems(page: PDFPageProxy): Promise<{ items: Item[]; links: { rect: number[]; url: string }[] }> {
  const tc = await page.getTextContent()
  const styles = tc.styles as Record<string, { fontFamily?: string }>
  // bold / italic from the real font names (glyph model)
  const model = await getGlyphModel(page).catch(() => null)
  const fontFlags = new Map<string, { bold: boolean; italic: boolean }>()
  if (model)
    for (const [id, f] of model.fonts) {
      const n = f.name.replace(/^[A-Z]{6}\+/, '')
      fontFlags.set(id, {
        // TeX: CMBX / CMB / SFBX = bold extended, CMTI / CMSL = italic
        bold: f.bold || /bold|black|heavy|semibold|demi|medium|^cmbx|^cmb\d|^sfbx|^lmroman.*-bold|\bbx\d/i.test(n),
        italic: f.italic || /italic|oblique|^cmti|^cmsl|^cmmi|-it$/i.test(n),
      })
    }
  const items: Item[] = []
  for (const it of tc.items) {
    if (!('str' in it) || !it.str) continue
    const [a, b, c, d, e, f] = it.transform as number[]
    // rotated / vertical text (margins stamps like arXiv ids) is not body text
    if (Math.abs(b) > Math.abs(a) * 0.2 || Math.abs(c) > Math.abs(d) * 0.2) continue
    const size = Math.hypot(a, b) || Math.abs(d) || 10
    const fl = fontFlags.get(it.fontName) ?? {
      bold: /bold/i.test(styles[it.fontName]?.fontFamily ?? ''),
      italic: false,
    }
    items.push({ str: it.str, x: e, y: f, w: it.width, size, bold: fl.bold, italic: fl.italic, font: it.fontName })
  }
  let links: { rect: number[]; url: string }[] = []
  try {
    const ann = await page.getAnnotations()
    links = ann
      .filter((x) => x.subtype === 'Link' && x.url)
      .map((x) => ({ rect: x.rect as number[], url: x.url as string }))
  } catch {
    /* no annotations */
  }
  return { items, links }
}

function toLines(items: Item[]): Line[] {
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x)
  const lines: Line[] = []
  for (const it of sorted) {
    const l = lines.find(
      (x) => Math.abs(x.y - it.y) < Math.max(1.5, Math.min(x.size, it.size) * 0.45) && it.x > x.x0 - it.size * 30,
    )
    if (l) {
      l.items.push(it)
      l.size = Math.max(l.size, it.size)
    } else lines.push({ items: [it], x0: it.x, x1: it.x + it.w, y: it.y, size: it.size, text: '' })
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x)
    l.x0 = l.items[0].x
    l.x1 = Math.max(...l.items.map((i) => i.x + i.w))
    let t = ''
    let prev: Item | null = null
    for (const it of l.items) {
      if (prev && it.x - (prev.x + prev.w) > it.size * 0.2 && !/\s$/.test(t) && !/^\s/.test(it.str)) t += ' '
      t += it.str
      prev = it
    }
    l.text = t
  }
  return lines.sort((a, b) => b.y - a.y || a.x0 - b.x0)
}

/** split into columns when the page has a clear vertical gutter */
function columns(lines: Line[], pageW: number): Line[][] {
  const mid = pageW / 2
  const left = lines.filter((l) => l.x1 < mid + 4)
  const right = lines.filter((l) => l.x0 > mid - 4)
  const spanning = lines.filter((l) => l.x0 <= mid - 4 && l.x1 >= mid + 4)
  // two columns: both sides well populated, few lines crossing the middle
  if (left.length > 6 && right.length > 6 && spanning.length < (left.length + right.length) * 0.15) {
    // spanning lines above the columns (title / abstract) come first
    const topCol = Math.max(...[...left, ...right].map((l) => l.y))
    const head = spanning.filter((l) => l.y > topCol)
    const rest = spanning.filter((l) => l.y <= topCol)
    return [head, left, right, rest].filter((c) => c.length)
  }
  return [lines]
}

function inlines(l: Line, links: { rect: number[]; url: string }[]): Inline[] {
  const out: Inline[] = []
  let prev: Item | null = null
  for (const it of l.items) {
    // the link must cover most of the item (link boxes often overlap the
    // label before them by a few points)
    const href = links.find((k) => {
      const lx0 = Math.min(k.rect[0], k.rect[2])
      const lx1 = Math.max(k.rect[0], k.rect[2])
      const cy = it.y + it.size * 0.3
      if (cy < Math.min(k.rect[1], k.rect[3]) || cy > Math.max(k.rect[1], k.rect[3])) return false
      const ov = Math.min(it.x + it.w, lx1) - Math.max(it.x, lx0)
      return ov > Math.max(1, it.w * 0.6)
    })?.url
    let s = it.str
    if (prev && it.x - (prev.x + prev.w) > it.size * 0.2 && !/^\s/.test(s)) s = ' ' + s
    const last = out[out.length - 1]
    if (last && !!last.bold === it.bold && !!last.italic === it.italic && last.href === href) last.text += s
    else out.push({ text: s, bold: it.bold || undefined, italic: it.italic || undefined, href })
    prev = it
  }
  return out
}

const plain = (xs: Inline[]) => xs.map((x) => x.text).join('')

function joinInlines(a: Inline[], b: Inline[]): Inline[] {
  if (!a.length) return b
  const at = plain(a)
  const bt = plain(b)
  const out = a.map((x) => ({ ...x }))
  const last = out[out.length - 1]
  if (/[a-z]-$/.test(at) && /^[a-z]/.test(bt)) last.text = last.text.slice(0, -1)
  else if (!(/[\u3400-\u9fff，。、；：]$/.test(at) && /^[\u3400-\u9fff]/.test(bt))) last.text += ' '
  for (const x of b) {
    const l = out[out.length - 1]
    if (l && !!l.bold === !!x.bold && !!l.italic === !!x.italic && l.href === x.href) l.text += x.text
    else out.push({ ...x })
  }
  return out
}

/** table detection: consecutive lines with ≥2 cells sharing column starts */
function tableRows(lines: Line[]): { rows: string[][]; used: number } | null {
  const cellsOf = (l: Line) => {
    const cells: { x: number; text: string }[] = []
    let cur: { x: number; text: string; end: number } | null = null
    for (const it of l.items) {
      if (cur && it.x - cur.end < it.size * 1.6) {
        cur.text += (it.x - cur.end > it.size * 0.2 ? ' ' : '') + it.str
        cur.end = it.x + it.w
      } else {
        if (cur) cells.push(cur)
        cur = { x: it.x, text: it.str, end: it.x + it.w }
      }
    }
    if (cur) cells.push(cur)
    return cells
  }
  const first = cellsOf(lines[0])
  if (first.length < 2) return null
  const cols = first.map((c) => c.x)
  const rows: string[][] = []
  let used = 0
  for (const l of lines) {
    const cells = cellsOf(l)
    if (cells.length < 2) break
    // every cell must start near one of the columns
    const row: string[] = new Array(cols.length).fill('')
    let ok = true
    for (const c of cells) {
      let k = cols.findIndex((x) => Math.abs(x - c.x) < l.size * 1.2)
      if (k < 0) {
        // right-aligned numbers: nearest column to the left
        k = cols.reduce((best, x, i) => (x <= c.x ? i : best), -1)
        if (k < 0) {
          ok = false
          break
        }
      }
      row[k] = row[k] ? `${row[k]} ${c.text}` : c.text
    }
    if (!ok) break
    rows.push(row)
    used++
  }
  return rows.length >= 2 ? { rows, used } : null
}

export interface StructureOptions {
  images: boolean
  pageBreaks: boolean
  progress?: (done: number, total: number) => void
}

export async function extractStructure(
  doc: PDFDocumentProxy,
  fileBytes: Uint8Array | null,
  opts: StructureOptions,
): Promise<DocStructure> {
  const pages: { lines: Line[]; links: { rect: number[]; url: string }[]; w: number; h: number; page: PDFPageProxy }[] =
    []
  const sizeHist = new Map<number, number>()
  for (let p = 1; p <= doc.numPages; p++) {
    opts.progress?.(p - 1, doc.numPages * 2)
    const page = await doc.getPage(p)
    const { items, links } = await pageItems(page)
    const [, , w, h] = page.view
    const lines = toLines(items)
    for (const it of items) {
      const k = Math.round(it.size * 2) / 2
      sizeHist.set(k, (sizeHist.get(k) ?? 0) + it.str.length)
    }
    pages.push({ lines, links, w, h, page })
  }
  // body size = most frequent size by characters
  const body = Array.from(sizeHist.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 10
  // repeated headers / footers (same text near the same edge on many pages)
  const edgeCount = new Map<string, number>()
  const edgeKey = (l: Line, h: number) => (l.y > h - 60 || l.y < 60 ? l.text.replace(/\d+/g, '#').trim() : '')
  for (const pg of pages)
    for (const l of pg.lines) {
      const k = edgeKey(l, pg.h)
      if (k) edgeCount.set(k, (edgeCount.get(k) ?? 0) + 1)
    }
  const isChrome = (l: Line, h: number) => {
    const k = edgeKey(l, h)
    if (!k) return false
    if (/^#$|^#\s*\/\s*#$|^-\s*#\s*-$|^(page|第)?\s*#\s*(页)?$/i.test(k)) return true
    return pages.length >= 3 && (edgeCount.get(k) ?? 0) >= Math.max(3, pages.length * 0.5)
  }
  const sizes = Array.from(sizeHist.keys())
    .filter((s) => s > body * 1.12)
    .sort((a, b) => b - a)
  const levelOf = (size: number): 1 | 2 | 3 | 0 => {
    if (size < body * 1.12) return 0
    const i = sizes.findIndex((s) => Math.abs(s - size) < 0.6)
    return Math.min(3, (i < 0 ? 2 : i) + 1) as 1 | 2 | 3
  }

  const blocks: Block[] = []
  let title = ''
  let imgSeq = 0
  for (let pi = 0; pi < pages.length; pi++) {
    opts.progress?.(pages.length + pi, pages.length * 2)
    const pg = pages[pi]
    if (pi > 0 && opts.pageBreaks) blocks.push({ type: 'pagebreak' })
    // images: placed with the text flow by their top y
    const imgs: { y: number; block: Block }[] = []
    if (opts.images) {
      const model = await getGlyphModel(pg.page).catch(() => null)
      for (const im of model?.images ?? []) {
        const bw = im.box.x1 - im.box.x0
        const bh = im.box.y1 - im.box.y0
        if (bw < 24 || bh < 24 || im.isMask) continue
        try {
          const ex = await exportPageImage(pg.page, fileBytes, im)
          imgs.push({
            y: im.box.y1,
            block: {
              type: 'image',
              data: ex.bytes,
              ext: ex.ext,
              width: bw,
              height: bh,
              name: `image${++imgSeq}.${ex.ext}`,
            },
          })
        } catch {
          /* skip unreadable image */
        }
      }
    }
    const pageBlocks: { y: number; block: Block }[] = [...imgs]
    for (const col of columns(
      pg.lines.filter((l) => !isChrome(l, pg.h) && l.text.trim()),
      pg.w,
    )) {
      let para: { inl: Inline[]; y: number; last: Line } | null = null
      let list: { ordered: boolean; items: Inline[][]; y: number; last: Line } | null = null
      const flush = () => {
        if (para) pageBlocks.push({ y: para.y, block: { type: 'paragraph', text: para.inl } })
        if (list) pageBlocks.push({ y: list.y, block: { type: 'list', ordered: list.ordered, items: list.items } })
        para = null
        list = null
      }
      for (let i = 0; i < col.length; i++) {
        const l = col[i]
        // table?
        const tb = l.items.length >= 2 ? tableRows(col.slice(i)) : null
        if (tb && tb.used >= 2 && tb.rows[0].length >= 2 && tb.rows.every((r) => r.filter(Boolean).length >= 2)) {
          flush()
          pageBlocks.push({ y: l.y, block: { type: 'table', rows: tb.rows } })
          i += tb.used - 1
          continue
        }
        const level = levelOf(l.size)
        const allBold = l.items.every((it) => it.bold) && l.text.length < 90
        if (
          level ||
          (allBold &&
            l.text.length < 60 &&
            !/[.。:：]$/.test(l.text) &&
            (!para || l.y < (para as { last: Line }).last.y - l.size * 1.6))
        ) {
          flush()
          const lv = level || 3
          const text = inlines(l, pg.links).map((x) => ({ ...x, bold: undefined }))
          // a heading continued on the next line (same size)
          const prev = pageBlocks[pageBlocks.length - 1]
          if (prev && prev.block.type === 'heading' && prev.block.level === lv && Math.abs(prev.y - l.y) < l.size * 1.8)
            prev.block.text = joinInlines(prev.block.text, text)
          else pageBlocks.push({ y: l.y, block: { type: 'heading', level: lv, text } })
          if (!title && lv === 1 && pi === 0) title = l.text.trim()
          continue
        }
        // Chinese section numbering ("一、服务内容", "第三条 …") on a short line is a heading
        if (
          /^\s*([一二三四五六七八九十]+、|第[一二三四五六七八九十\d]+[章节条])/.test(l.text) &&
          l.text.trim().length <= 30 &&
          !/[。；;，,]$/.test(l.text.trim())
        ) {
          flush()
          pageBlocks.push({
            y: l.y,
            block: {
              type: 'heading',
              level: /^\s*第.+章/.test(l.text) ? 1 : 2,
              text: inlines(l, pg.links).map((x) => ({ ...x, bold: undefined })),
            },
          })
          continue
        }
        const bullet = BULLET.exec(l.text)
        const num = NUMBERED.exec(l.text)
        if (bullet || (num && l.text.length > num[0].length + 2)) {
          if (para) flush()
          const ordered = !bullet
          if (!list || list.ordered !== ordered) {
            flush()
            list = { ordered, items: [], y: l.y, last: l }
          }
          const inl = inlines(l, pg.links)
          const cut = (bullet ?? num)![0].length
          // strip the marker from the first inline(s)
          let rem = cut
          for (const x of inl) {
            if (rem <= 0) break
            const k = Math.min(rem, x.text.length)
            x.text = x.text.slice(k)
            rem -= k
          }
          ;(list as { items: Inline[][] }).items.push(inl.filter((x) => x.text))
          ;(list as { last: Line }).last = l
          continue
        }
        // continuation of a list item: indented, close below
        if (list && l.x0 > list.last.x0 + 4 && list.last.y - l.y < l.size * 1.8) {
          const items = list.items
          items[items.length - 1] = joinInlines(items[items.length - 1], inlines(l, pg.links))
          list.last = l
          continue
        }
        if (list) flush()
        const inl = inlines(l, pg.links)
        if (para) {
          const p = para as { inl: Inline[]; y: number; last: Line }
          const gap = p.last.y - l.y
          const sameBlock = gap > 0 && gap < l.size * 1.75 && Math.abs(l.size - p.last.size) < 1.2
          // a short previous line ending a sentence closes the paragraph
          const prevEnded =
            p.last.x1 < Math.max(...col.map((x) => x.x1)) - l.size * 4 && /[.。!?！？:：]$/.test(p.last.text.trim())
          // indented first line starts a new paragraph
          const indented = l.x0 > p.last.x0 + l.size * 1.2
          if (sameBlock && !prevEnded && !indented) {
            p.inl = joinInlines(p.inl, inl)
            p.last = l
            continue
          }
          flush()
        }
        para = { inl, y: l.y, last: l }
      }
      flush()
    }
    // keep column order for text; images go before the first text below them
    const text = pageBlocks.filter((b) => b.block.type !== 'image')
    const out: Block[] = []
    const pending = imgs.slice().sort((a, b) => b.y - a.y)
    for (const b of text) {
      while (pending.length && pending[0].y > b.y + 2) out.push(pending.shift()!.block)
      out.push(b.block)
    }
    for (const r of pending) out.push(r.block)
    blocks.push(...out)
  }
  opts.progress?.(1, 1)
  if (!title) {
    const h = blocks.find((b) => b.type === 'heading') as Extract<Block, { type: 'heading' }> | undefined
    title = h ? plain(h.text) : ''
  }
  return { title, blocks }
}

export { plain as plainText }
