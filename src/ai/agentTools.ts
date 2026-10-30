import { tr, onLocaleChange } from '../i18n/locale'
/**
 * Tools the AI agent can call. Reading tools run immediately; every change
 * to the document is collected into a PLAN (pending EditOps + a human
 * readable description and before/after preview). Nothing is applied until
 * the user confirms; applying pushes the ops as one undo step.
 */
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { newOpId, type EditOp, type HighlightOp, type MarkupKind, type RedactOp } from '../pdf/edit/ops'
import { computePageMap } from '../pdf/edit/pageOrder'
import { getGlyphModel, type PageGlyph } from '../pdf/edit/glyphModel'
import { findTextOnPage } from '../pdf/edit/findText'
import { buildLineEditOp, openLineEdit } from '../pdf/edit/lineEdit'
import { extractPagesFromBuffer } from '../pdf/edit/multiDoc'
import { currentOutputBytes } from '../utils/output'
import { saveBlobFile } from '../utils/save'
import { docPermissions } from '../utils/secureOpen'
import { getDocIndex, formatPassages } from './docIndex'
import type { ToolDef } from './client'

export interface PlanStep {
  /** what will happen, for the confirmation list */
  title: string
  /** before / after text for text edits */
  before?: string
  after?: string
  page?: number
  /** original page ref of `page` (for jumping / highlighting) */
  ref?: number
  /** pdf boxes to preview on the page */
  boxes?: { x0: number; y0: number; x1: number; y1: number }[]
  ops: EditOp[]
  /** side effect instead of ops (e.g. export a new file) */
  run?: (assertCurrent: () => void) => Promise<string>
}

export interface Plan {
  steps: PlanStep[]
  /** The document state the user previewed. Never rebase a plan implicitly. */
  base?: { documentEpoch: number; editRevision: number }
}

const planDocuments = new WeakMap<Plan, object>()
function createStalePlan() {
  return tr('文档已发生变化，这份修改计划已失效，请重新生成。')
}

let STALE_PLAN = createStalePlan()

export function createPlan(): Plan {
  const plan: Plan = { steps: [] }
  bindPlan(plan)
  return plan
}

function bindPlan(plan: Plan): void {
  if (plan.base) return
  const app = useAppStore.getState()
  if (!app.pdfDoc) throw new Error(tr('没有打开的文档'))
  plan.base = { documentEpoch: app.docEpoch, editRevision: useEditStore.getState().revision }
  planDocuments.set(plan, app.pdfDoc)
}

export function assertPlanCurrent(plan: Plan): void {
  const app = useAppStore.getState()
  if (
    !plan.base ||
    planDocuments.get(plan) !== app.pdfDoc ||
    plan.base.documentEpoch !== app.docEpoch ||
    plan.base.editRevision !== useEditStore.getState().revision
  ) {
    throw new Error(STALE_PLAN)
  }
}

const pdf = () => {
  const d = useAppStore.getState().pdfDoc
  if (!d) throw new Error(tr('没有打开的文档'))
  return d
}

/** view page (what the user sees) -> original page ref */
function refOf(viewPage: number): number {
  const map = computePageMap(pdf().numPages, useEditStore.getState().ops)
  const r = map[viewPage - 1]
  if (!r) throw new Error(tr('第 {0} 页不存在（共 {1} 页）', viewPage, map.length))
  return r
}
function viewCount(): number {
  return computePageMap(pdf().numPages, useEditStore.getState().ops).length
}

function pagesArg(v: unknown): number[] {
  const n = viewCount()
  const raw = Array.isArray(v) ? v : typeof v === 'number' ? [v] : typeof v === 'string' ? v.split(/[,，\s]+/) : []
  const out: number[] = []
  for (const x of raw) {
    const s = String(x)
    const m = /^(\d+)\s*[-–~]\s*(\d+)$/.exec(s)
    if (m) for (let i = +m[1]; i <= +m[2]; i++) out.push(i)
    else if (/^\d+$/.test(s)) out.push(+s)
  }
  return Array.from(new Set(out))
    .filter((p) => p >= 1 && p <= n)
    .sort((a, b) => a - b)
}

function createToolDefs(): ToolDef[] {
  return [
    {
      type: 'function',
      function: {
        name: 'search_document',
        description: tr('在文档中做关键词检索，返回最相关的段落（带 [p页#段] 编号）。回答需要原文依据时先调用它。'),
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' }, k: { type: 'integer', description: tr('返回条数，默认 8') } },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_pages',
        description: tr('读取指定页的全部文字（带段落编号）。页码从 1 开始。'),
        parameters: {
          type: 'object',
          properties: { pages: { type: 'array', items: { type: 'integer' } } },
          required: ['pages'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'find_text',
        description: tr('精确查找文字或正则，返回出现位置（页码 + 所在行）。用于定位要修改/标记的内容。'),
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: tr('要找的文字') },
            regex: { type: 'boolean', description: tr('text 是 JavaScript 正则') },
          },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'mark_text',
        description: tr(
          '（计划）高亮 / 下划线 / 删除线标记文字。text 是要标记的原文文字；要标记一类内容（如所有金额、日期、邮箱）时，用 JavaScript 正则并设 regex=true，例如金额 "\\$[\\d,]+(\\.\\d+)?"、日期 "\\d{4}年\\d{1,2}月\\d{1,2}日"。会作为待确认的修改。',
        ),
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string' },
            regex: { type: 'boolean' },
            style: { type: 'string', enum: ['highlight', 'underline', 'strikeout'] },
            color: { type: 'string', description: tr('#rrggbb，可选') },
            pages: { type: 'array', items: { type: 'integer' }, description: tr('限定页码，可选') },
          },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'replace_text',
        description: tr(
          '（计划）把文档里的文字替换成新文字，保持原字体字号颜色。find 必须是原文中实际存在的片段（同一行内）。适合改日期、改名称、改数字等。',
        ),
        parameters: {
          type: 'object',
          properties: {
            find: { type: 'string' },
            replace: { type: 'string' },
            pages: { type: 'array', items: { type: 'integer' }, description: tr('限定页码，可选') },
            all: { type: 'boolean', description: tr('替换所有出现（默认只替换第一处）') },
          },
          required: ['find', 'replace'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'redact_text',
        description: tr('（计划）永久删除式脱敏：找到文字（或正则）后标记密文，保存时从文件中彻底删除。'),
        parameters: {
          type: 'object',
          properties: { text: { type: 'string' }, regex: { type: 'boolean' } },
          required: ['text'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delete_pages',
        description: tr('（计划）删除页面。'),
        parameters: {
          type: 'object',
          properties: { pages: { type: 'array', items: { type: 'integer' } } },
          required: ['pages'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'rotate_pages',
        description: tr('（计划）顺时针旋转页面。'),
        parameters: {
          type: 'object',
          properties: {
            pages: { type: 'array', items: { type: 'integer' } },
            degrees: { type: 'integer', enum: [90, 180, 270] },
          },
          required: ['pages', 'degrees'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'extract_pages',
        description: tr('（计划）把指定页面提取 / 合并成一个新的 PDF 文件并保存（不改变当前文档）。'),
        parameters: {
          type: 'object',
          properties: { pages: { type: 'array', items: { type: 'integer' } }, filename: { type: 'string' } },
          required: ['pages'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'add_note',
        description: tr('（计划）在某页添加便签注释（例如写下总结或批注意见）。可用 near 指定靠近哪段文字。'),
        parameters: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            text: { type: 'string' },
            near: { type: 'string', description: tr('便签贴在这段文字旁边，可选') },
          },
          required: ['page', 'text'],
        },
      },
    },
  ]
}

export let TOOL_DEFS: ToolDef[] = createToolDefs()

// ── text location helpers ─────────────────────────────────────

interface Hit {
  viewPage: number
  ref: number
  text: string
  box: { x0: number; y0: number; x1: number; y1: number }
}

/** a relaxed variant of a pattern: a fixed trailing part made optional */
function looseRegex(src: string): RegExp | null {
  let r = src
  // trailing  \.\d{2}  /  \.\d+  (cents, decimals) -> optional
  const frac = /(\\\.\\d(?:\{\d+(?:,\d*)?\}|\+)?)$/
  if (frac.test(r)) r = r.replace(frac, '(?:$1)?')
  else if (/\([^()]*\)$/.test(r)) r = r.replace(/(\([^()]*\))$/, '$1?')
  if (r === src) return null
  try {
    return new RegExp(r, 'g')
  } catch {
    return null
  }
}

async function findHits(text: string, regex: boolean, pages?: number[]): Promise<Hit[]> {
  const doc = pdf()
  const list = pages?.length ? pages : Array.from({ length: viewCount() }, (_, i) => i + 1)
  const hits: Hit[] = []
  for (const vp of list) {
    const ref = refOf(vp)
    if (ref <= 0) continue
    const page = await doc.getPage(ref)
    let terms = [text]
    if (regex) {
      let re: RegExp
      try {
        re = new RegExp(text, 'g')
      } catch {
        throw new Error(tr('正则无效：{0}', text))
      }
      const tc = await page.getTextContent()
      const plain = tc.items.map((i) => ('str' in i ? i.str : '')).join(' ')
      terms = Array.from(new Set(Array.from(plain.matchAll(re), (m) => m[0]).filter((t) => t.trim())))
      // models often over-specify (e.g. require cents): retry with the
      // trailing fixed-count parts made optional
      if (!terms.length) {
        const loose = looseRegex(text)
        if (loose) terms = Array.from(new Set(Array.from(plain.matchAll(loose), (m) => m[0]).filter((t) => t.trim())))
      }
    }
    for (const t of terms)
      for (const h of await findTextOnPage(page, t)) hits.push({ viewPage: vp, ref, text: h.text, box: h })
    if (hits.length > 400) break
  }
  return hits
}

/** text of the line around a hit (context for the model / preview) */
async function lineTextAt(ref: number, box: Hit['box']): Promise<string> {
  const page = await pdf().getPage(ref)
  const m = await getGlyphModel(page)
  const y = (box.y0 + box.y1) / 2
  const row = m.glyphs
    .filter((g: PageGlyph) => !g.invisible && Math.abs(g.y + g.size * 0.3 - y) < g.size * 0.6)
    .sort((a, b) => a.x - b.x)
  return row
    .map((g) => g.text)
    .join('')
    .slice(0, 160)
}

// ── execution ─────────────────────────────────────────────────

export interface ToolContext {
  plan: Plan
}

/** the model sometimes repeats a call: identical steps are planned once */
export function dedupePlan(plan: Plan): void {
  const seen = new Set<string>()
  plan.steps = plan.steps.filter((s) => {
    // Equal text on two different lines is still two separate edits.
    const k = JSON.stringify({
      title: s.title,
      after: s.after,
      ref: s.ref,
      boxes: s.boxes,
      ops: s.ops.map(({ id: _id, group: _group, ...content }) => content),
    })
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export async function runTool(name: string, argsJson: string, ctx: ToolContext): Promise<string> {
  // Standalone callers may still pass { steps: [] }; bind before any await.
  bindPlan(ctx.plan)
  assertPlanCurrent(ctx.plan)
  let args: Record<string, unknown> = {}
  try {
    args = argsJson ? JSON.parse(argsJson) : {}
  } catch {
    return tr('参数不是合法 JSON：{0}', argsJson)
  }
  const perms = docPermissions()
  const needs = (ok: boolean) => {
    if (!ok) throw new Error(tr('文档权限不允许此修改'))
  }
  switch (name) {
    case 'search_document': {
      const idx = await getDocIndex(pdf())
      const ps = idx.search(String(args.query ?? ''), Math.min(15, Number(args.k) || 8))
      return ps.length ? formatPassages(ps, 6000) : tr('没有找到相关段落。')
    }
    case 'read_pages': {
      const idx = await getDocIndex(pdf())
      const want = pagesArg(args.pages).map(refOf)
      const ps = idx.passages.filter((p) => want.includes(p.page))
      return ps.length ? formatPassages(ps, 12000) : tr('这些页没有可读取的文字（可能是扫描件）。')
    }
    case 'find_text': {
      const hits = await findHits(String(args.text ?? ''), !!args.regex)
      if (!hits.length) return tr('没有找到。')
      const lines = await Promise.all(
        hits
          .slice(0, 30)
          .map(async (h) => tr('第 {0} 页：“{1}” —— 所在行：{2}', h.viewPage, h.text, await lineTextAt(h.ref, h.box))),
      )
      return tr('共 {0} 处{1}：\n{2}', hits.length, hits.length > 30 ? tr('（只列前 30）') : '', lines.join('\n'))
    }
    case 'mark_text': {
      needs(perms.annotate)
      const style = (
        ['highlight', 'underline', 'strikeout'].includes(String(args.style)) ? args.style : 'highlight'
      ) as MarkupKind
      const hits = await findHits(String(args.text ?? ''), !!args.regex, pagesArg(args.pages))
      if (!hits.length) return tr('没有找到要标记的文字，未计划任何修改。')
      const color = /^#[0-9a-f]{6}$/i.test(String(args.color))
        ? String(args.color)
        : { highlight: '#ffeb3b', underline: '#1e88e5', strikeout: '#e53935' }[style]
      const byPage = new Map<number, Hit[]>()
      for (const h of hits) (byPage.get(h.viewPage) ?? byPage.set(h.viewPage, []).get(h.viewPage)!).push(h)
      for (const [vp, hs] of byPage) {
        const op: HighlightOp = {
          kind: 'markup',
          id: newOpId(),
          page: hs[0].ref,
          markup: style,
          quads: hs.map((h) => ({ x: h.box.x0, y: h.box.y0, width: h.box.x1 - h.box.x0, height: h.box.y1 - h.box.y0 })),
          color,
          opacity: style === 'highlight' ? 0.42 : 1,
        }
        ctx.plan.steps.push({
          title: tr(
            '第 {0} 页{1} {2} 处：{3}',
            vp,
            { highlight: tr('高亮'), underline: tr('下划线'), strikeout: tr('删除线') }[style],
            hs.length,
            Array.from(new Set(hs.map((h) => h.text)))
              .slice(0, 4)
              .join('、'),
          ),
          page: vp,
          ref: hs[0].ref,
          boxes: hs.map((h) => h.box),
          ops: [op],
        })
      }
      return tr('已计划标记 {0} 处（{1} 页），等待用户确认。', hits.length, byPage.size)
    }
    case 'replace_text': {
      needs(perms.modify)
      const find = String(args.find ?? '')
      const repl = String(args.replace ?? '')
      if (!find) return tr('find 不能为空。')
      const hits = await findHits(find, false, pagesArg(args.pages))
      if (!hits.length) return tr('原文中没有找到“{0}”。先用 find_text 或 read_pages 确认原文的准确写法。', find)
      const targets = args.all ? hits : hits.slice(0, 1)
      let planned = 0
      const failed: string[] = []
      // several hits on one line: chain the replacements into one edit
      const lines = new Map<string, Hit[]>()
      for (const h of targets) {
        const k = `${h.ref}:${Math.round((h.box.y0 + h.box.y1) / 2)}`
        ;(lines.get(k) ?? lines.set(k, []).get(k)!).push(h)
      }
      for (const hs of lines.values()) {
        const h = hs[0]
        const page = await pdf().getPage(h.ref)
        const cx = (h.box.x0 + h.box.x1) / 2
        const cy = h.box.y0 + (h.box.y1 - h.box.y0) * 0.45
        const opsNow = [...useEditStore.getState().ops, ...ctx.plan.steps.flatMap((s) => s.ops)]
        const lctx = await openLineEdit(page, h.ref, opsNow, cx, cy)
        if (!lctx) {
          failed.push(tr('第 {0} 页', h.viewPage))
          continue
        }
        const before = lctx.currentText
        // Use literal replacement text and honor the requested match count.
        const replace = (text: string, query: string) =>
          text.replace(new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), args.all ? 'gi' : 'i'), () => repl)
        let after = replace(before, find)
        if (after === before) {
          const loose = before.replace(/\s+/g, ' ')
          after = replace(loose, find.replace(/\s+/g, ' '))
        }
        if (after === before) {
          failed.push(tr('第 {0} 页', h.viewPage))
          continue
        }
        const op = buildLineEditOp(lctx, h.ref, after, newOpId())
        if (!op) {
          failed.push(tr('第 {0} 页', h.viewPage))
          continue
        }
        ctx.plan.steps.push({
          title: tr('第 {0} 页改文字', h.viewPage),
          before,
          after,
          page: h.viewPage,
          ref: h.ref,
          boxes: [lctx.line.box],
          ops: [op],
        })
        planned += hs.length
      }
      return planned
        ? tr(
            '已计划替换 {0} 处，等待用户确认。{1}',
            planned,
            failed.length ? tr('另有 {0} 的位置无法编辑（可能是图片或特殊字体）。', failed.join('、')) : '',
          )
        : tr('找到了文字但无法在原位编辑（{0}），可能是图片、矢量文字或跨行文字。', failed.join('、'))
    }
    case 'redact_text': {
      needs(perms.modify)
      const hits = await findHits(String(args.text ?? ''), !!args.regex)
      if (!hits.length) return tr('没有找到要脱敏的内容。')
      const byPage = new Map<number, Hit[]>()
      for (const h of hits) (byPage.get(h.viewPage) ?? byPage.set(h.viewPage, []).get(h.viewPage)!).push(h)
      for (const [vp, hs] of byPage) {
        ctx.plan.steps.push({
          title: tr(
            '第 {0} 页永久删除 {1} 处：{2}',
            vp,
            hs.length,
            Array.from(new Set(hs.map((h) => h.text)))
              .slice(0, 3)
              .join('、'),
          ),
          page: vp,
          ref: hs[0].ref,
          boxes: hs.map((h) => h.box),
          ops: hs.map(
            (h): RedactOp => ({
              kind: 'redact',
              id: newOpId(),
              page: h.ref,
              x: h.box.x0 - 0.6,
              y: h.box.y0 - 0.6,
              width: h.box.x1 - h.box.x0 + 1.2,
              height: h.box.y1 - h.box.y0 + 1.2,
            }),
          ),
        })
      }
      return tr('已计划脱敏 {0} 处，等待用户确认。', hits.length)
    }
    case 'delete_pages': {
      needs(perms.assemble)
      const del = pagesArg(args.pages)
      if (!del.length) return tr('没有有效的页码。')
      if (del.length >= viewCount()) return tr('不能删除全部页面。')
      // pages already planned for deletion in this plan stay deleted
      const pending = ctx.plan.steps.flatMap((s) => s.ops)
      const map = computePageMap(pdf().numPages, [...useEditStore.getState().ops, ...pending])
      const base = computePageMap(pdf().numPages, useEditStore.getState().ops)
      const delRefs = new Set(del.map((v) => base[v - 1]))
      const order = map.filter((r) => !delRefs.has(r))
      if (order.length === map.length) return tr('第 {0} 页已在计划中删除。', del.join('、'))
      if (!order.length) return tr('不能删除全部页面。')
      ctx.plan.steps.push({
        title: tr('删除第 {0} 页', del.join('、')),
        ops: [{ kind: 'page-reorder', id: newOpId(), page: 0, order } as EditOp],
      })
      return tr('已计划删除 {0} 页，等待用户确认。', del.length)
    }
    case 'rotate_pages': {
      needs(perms.assemble)
      const ps = pagesArg(args.pages)
      const deg = [90, 180, 270].includes(Number(args.degrees)) ? (Number(args.degrees) as 90 | 180 | 270) : 90
      if (!ps.length) return tr('没有有效的页码。')
      ctx.plan.steps.push({
        title: tr('旋转第 {0} 页 {1}°', ps.join('、'), deg),
        ops: ps.map((p) => ({ kind: 'page-rotate', id: newOpId(), page: 0, pageIndex: p - 1, degrees: deg }) as EditOp),
      })
      return tr('已计划旋转，等待用户确认。')
    }
    case 'extract_pages': {
      const ps = pagesArg(args.pages)
      if (!ps.length) return tr('没有有效的页码。')
      const stem = (useAppStore.getState().fileName ?? 'document').replace(/\.pdf$/i, '')
      const name = String(args.filename || tr('{0}_第{1}页', stem, ps.join('_'))).replace(/\.pdf$/i, '') + '.pdf'
      ctx.plan.steps.push({
        title: tr('把第 {0} 页另存为新文件“{1}”', ps.join('、'), name),
        ops: [],
        run: async (assertCurrent) => {
          assertCurrent()
          const bytes = await currentOutputBytes()
          assertCurrent()
          if (!bytes) return tr('没有文档')
          const out = await extractPagesFromBuffer(bytes, ps)
          assertCurrent()
          const ok = await saveBlobFile(name, out, 'application/pdf', tr('PDF 文档'), ['pdf'])
          return ok ? tr('已保存 {0}', name) : tr('已取消保存')
        },
      })
      return tr('已计划导出新文件，等待用户确认。')
    }
    case 'add_note': {
      needs(perms.annotate)
      const vp = pagesArg([args.page])[0]
      if (!vp) return tr('页码无效。')
      const ref = refOf(vp)
      const page = await pdf().getPage(ref)
      const [x0, y0, x1, y1] = page.view
      let x = x1 - 36
      let y = y1 - 36
      if (args.near) {
        const h = (await findHits(String(args.near), false, [vp]))[0]
        if (h) {
          x = Math.min(x1 - 24, h.box.x1 + 4)
          y = h.box.y1 + 4
        }
      }
      void x0
      void y0
      ctx.plan.steps.push({
        title: tr('第 {0} 页添加便签：{1}', vp, String(args.text).slice(0, 40)),
        page: vp,
        ref,
        boxes: [{ x0: x, y0: y - 20, x1: x + 20, y1: y }],
        ops: [
          {
            kind: 'note',
            id: newOpId(),
            page: ref,
            x,
            y,
            text: String(args.text ?? ''),
            color: '#f5b400',
            author: 'AI',
            modified: new Date().toISOString(),
          },
        ],
      })
      return tr('已计划添加便签，等待用户确认。')
    }
    default:
      return tr('未知工具 {0}', name)
  }
}

/** apply a confirmed plan: all ops as one undo step, then side effects */
export async function applyPlan(plan: Plan): Promise<string[]> {
  assertPlanCurrent(plan)
  const ops = plan.steps.flatMap((s) => s.ops)
  if (ops.length) useEditStore.getState().pushOps(ops)
  // Own edits advance the revision. Async exports must stay on this accepted
  // state, and may not silently pick up a different document while awaiting.
  const app = useAppStore.getState()
  const revision = useEditStore.getState().revision
  const assertCurrent = () => {
    const current = useAppStore.getState()
    if (
      current.pdfDoc !== app.pdfDoc ||
      current.docEpoch !== app.docEpoch ||
      useEditStore.getState().revision !== revision
    )
      throw new Error(STALE_PLAN)
  }
  const notes: string[] = []
  for (const s of plan.steps)
    if (s.run) {
      assertCurrent()
      notes.push(await s.run(assertCurrent))
    }
  return notes
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  STALE_PLAN = createStalePlan()
  TOOL_DEFS = createToolDefs()
})
