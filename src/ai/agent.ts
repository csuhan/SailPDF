import { tr, onLocaleChange } from '../i18n/locale'
/**
 * AI reader & editor agent.
 *
 * - Reading: answers are grounded in document passages; the model must cite
 *   passage ids like [p3#2]. Citations are validated against the index
 *   (unknown ids are dropped) and rendered as clickable chips that jump to
 *   the page and flash the quoted passage.
 * - Editing: modification tools only build a plan; the UI shows it with a
 *   preview and applies it after the user confirms (one undo step).
 */
import { useAppStore } from '../state/stores'
import { chat, type AiSettings, type ChatMessage, type ToolCall } from './client'
import { documentContext, formatPassages, getDocIndex, type DocIndex, type Passage } from './docIndex'
import { TOOL_DEFS, assertPlanCurrent, createPlan, dedupePlan, runTool, type Plan } from './agentTools'

export type ReplyStyle = 'concise' | 'expert' | 'simple'

export interface AgentTurn {
  role: 'user' | 'assistant'
  text: string
  /** visible tool activity ("查找 …") */
  activity?: string[]
  plan?: Plan
  planState?: 'pending' | 'applied' | 'rejected' | 'stale'
  error?: string
}

function createStyleHint(): Record<ReplyStyle, string> {
  return {
    concise: tr('回答简洁，先给结论，必要时用要点列表。'),
    expert: tr('用专业、严谨的方式回答，保留术语并解释推理依据。'),
    simple: tr('用通俗易懂的语言解释，像给非专业人士讲解，可举例。'),
  }
}

let STYLE_HINT: Record<ReplyStyle, string> = createStyleHint()

function langHint(s: AiSettings, sample: string): string {
  if (s.language === 'zh') return tr('始终用简体中文回答。')
  if (s.language === 'en') return 'Always answer in English.'
  return /[\u3400-\u9fff]/.test(sample) ? tr('用简体中文回答。') : tr('使用与用户提问相同的语言回答。')
}

function systemPrompt(idx: DocIndex, settings: AiSettings, style: ReplyStyle, userText: string, extra: string): string {
  const app = useAppStore.getState()
  const outline = idx.outline.length
    ? idx.outline
        .slice(0, 40)
        .map((o) => `${o.title}${o.page ? tr('（第{0}页）', o.page) : ''}`)
        .join('\n')
    : tr('（无目录）')
  return [
    tr(
      '你是 Sail PDF 内置的文档助手，正在帮助用户阅读和编辑文档“{0}”（共 {1} 页，当前在第 {2} 页）。',
      app.fileName ?? tr('文档'),
      idx.pages,
      app.currentPage,
    ),
    '',
    tr('规则：'),
    tr('1. 只依据文档内容回答。文档里没有的信息要明确说“文档中没有提到”，不要编造。'),
    tr(
      '2. 每个基于文档的论断后面都要标注来源段落编号，格式严格为 [p页#段]，例如 [p3#2]；可以连续写多个 [p3#2][p4#1]。只能使用上下文或工具结果中出现过的编号。',
    ),
    tr('3. 需要更多原文时，调用 search_document / read_pages / find_text 工具，不要猜测。'),
    tr(
      '4. 用户要求修改文档时（改文字、标记、脱敏、删除/旋转/提取页面、加便签），调用相应的修改工具。修改工具只生成“待确认的计划”，不会立即生效；调用后用一两句话说明计划了什么，请用户在下方确认。不要声称已经修改完成。',
    ),
    tr('5. 修改文字时 find 必须是原文中真实存在的片段，先用 find_text 确认。'),
    `6. ${STYLE_HINT[style]} ${langHint(settings, userText)}`,
    '',
    tr('文档目录：\n{0}', outline),
    extra ? `\n${extra}` : '',
  ].join('\n')
}

export interface RunOptions {
  settings: AiSettings
  style: ReplyStyle
  history: AgentTurn[]
  userText: string
  /** selected text the question is about */
  selection?: { text: string; page: number } | null
  /** quick task: whole-document context instead of retrieval */
  wholeDoc?: boolean
  signal?: AbortSignal
  onUpdate: (turn: AgentTurn) => void
}

function createToolLabel(): Record<string, string> {
  return {
    search_document: tr('检索'),
    read_pages: tr('阅读'),
    find_text: tr('查找'),
    mark_text: tr('计划标记'),
    replace_text: tr('计划修改文字'),
    redact_text: tr('计划脱敏'),
    delete_pages: tr('计划删除页面'),
    rotate_pages: tr('计划旋转页面'),
    extract_pages: tr('计划提取页面'),
    add_note: tr('计划添加便签'),
  }
}

let TOOL_LABEL: Record<string, string> = createToolLabel()

export async function runAgent(opts: RunOptions): Promise<AgentTurn> {
  const doc = useAppStore.getState().pdfDoc
  if (!doc) throw new Error(tr('没有打开的文档'))
  const plan = createPlan()
  const checkCurrent = () => {
    opts.signal?.throwIfAborted()
    assertPlanCurrent(plan)
  }
  checkCurrent()
  const idx = await getDocIndex(doc)
  checkCurrent()
  const turn: AgentTurn = { role: 'assistant', text: '', activity: [] }

  // context: whole document for global tasks (budgeted), otherwise the
  // passages most relevant to the question (+ current page + selection)
  // context budget (characters): the bundled model runs with a 32k-token
  // window, remote models usually have much more
  const small = opts.settings.provider === 'bundled'
  const B = small
    ? { whole: 24000, related: 9000, full: 16000, fullIf: 14000, tool: 8000 }
    : { whole: 48000, related: 14000, full: 32000, fullIf: 30000, tool: 16000 }
  let extra = ''
  if (opts.wholeDoc) {
    extra = tr('文档内容（按段落编号）：\n{0}', documentContext(idx, B.whole))
  } else {
    const app = useAppStore.getState()
    const hits = idx.search(opts.userText + ' ' + (opts.selection?.text ?? ''), 10)
    const cur = idx.passages.filter((p) => p.page === (opts.selection?.page ?? app.currentPage)).slice(0, 12)
    const seen = new Set<string>()
    const ctx: Passage[] = []
    for (const p of [...cur, ...hits]) if (!seen.has(p.id) && seen.add(p.id)) ctx.push(p)
    extra = tr('与问题相关的段落：\n{0}', formatPassages(ctx, B.related))
    if (idx.chars < B.fullIf) extra = tr('文档全文（按段落编号）：\n{0}', documentContext(idx, B.full))
  }
  // is the request an edit? (used to insist on tool calls)
  const wantsEdit =
    /(改成|改为|修改|替换|换成|标出|标记|高亮|划线|删除|删掉|去掉|旋转|提取|拆出|脱敏|涂黑|隐去|加.{0,4}(便签|注释|批注))/.test(
      opts.userText,
    )
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(idx, opts.settings, opts.style, opts.userText, extra) },
  ]
  // history: past assistant claims about plans are restated as facts, so the
  // model never treats an earlier "已计划" as a still-pending plan
  // small local models get distracted by long histories: keep it short
  for (const t of opts.history.slice(small ? -4 : -8)) {
    if (!t.text && !t.plan) continue
    let content = t.text
    if (t.role === 'assistant' && t.plan) {
      const st =
        t.planState === 'applied'
          ? tr('用户已确认并应用')
          : t.planState === 'rejected'
            ? tr('用户放弃了')
            : t.planState === 'stale'
              ? tr('文档已变化，计划失效')
              : tr('尚未确认')
      content += tr('\n（系统备注：上面的修改计划共 {0} 项，{1}。）', t.plan.steps.length, st)
    }
    messages.push({ role: t.role, content })
  }
  let user = opts.userText
  if (opts.selection?.text)
    user = tr(
      '关于我选中的这段文字（第 {0} 页）：\n“{1}”\n\n{2}',
      opts.selection.page,
      opts.selection.text.slice(0, 3000),
      opts.userText,
    )
  // edit requests: the reminder sits right next to the request (models weigh
  // the end of the prompt most)
  if (wantsEdit) user += tr('\n\n（这是修改请求：直接调用修改工具生成计划，界面会让我确认，不要只用文字描述计划。）')
  messages.push({ role: 'user', content: user })

  let nudges = 0
  let triedEdit = false
  for (let step = 0; step < 8; step++) {
    checkCurrent()
    const r = await chat(opts.settings, messages, {
      tools: TOOL_DEFS,
      signal: opts.signal,
      onDelta: (full) => {
        checkCurrent()
        turn.text = full
        opts.onUpdate({ ...turn })
      },
    })
    checkCurrent()
    // small models sometimes write the call as text instead of a tool call:
    // `mark_text(regex="…", style="highlight")` or a JSON block. Recover it.
    if (!r.toolCalls.length) {
      const recovered = parseTextToolCalls(r.content)
      if (recovered.length) r.toolCalls.push(...recovered)
    }
    if (!r.toolCalls.length) {
      // the model says it planned / made a change but called no tool: make
      // it actually call one (once), never show a fake confirmation
      // the model described / promised a change in prose but called no tool
      // (small local models do this a lot): make it call the tool, never show
      // a fake confirmation
      const claims =
        /(已|将|会|我来|准备|为你|帮你).{0,8}(修改|替换|改为|改成|标记|高亮|脱敏|删除|旋转|提取|添加便签)|请在下方确认|请确认此计划|计划[:：]/.test(
          r.content,
        )
      // only nudge when no modification tool was tried yet: if one ran and
      // found nothing, the model already got that result and may explain it
      if (
        (claims || (wantsEdit && !r.content.includes('无法'))) &&
        !plan.steps.length &&
        !triedEdit &&
        step < 6 &&
        nudges < 2
      ) {
        nudges++
        messages.push({ role: 'assistant', content: r.content || tr('（未调用工具）') })
        messages.push({
          role: 'user',
          content: tr(
            '（系统提示：修改并没有生成——只有调用工具才会生成修改计划，用户会在界面上确认，不需要你再征求确认。现在直接调用相应的工具（例如 replace_text、mark_text、redact_text、delete_pages），参数用原文中的准确文字；如果确实无法完成，请说明原因。）',
          ),
        })
        turn.text = ''
        continue
      }
      turn.text = r.content
      break
    }
    messages.push({ role: 'assistant', content: r.content || null, tool_calls: r.toolCalls })
    for (const tc of r.toolCalls) {
      let preview = ''
      try {
        const a = JSON.parse(tc.function.arguments || '{}')
        preview = String(
          a.query ?? a.text ?? a.find ?? (a.pages ? tr('第 {0} 页', [].concat(a.pages).join('、')) : ''),
        ).slice(0, 40)
      } catch {
        /* show the name only */
      }
      turn.activity = [
        ...(turn.activity ?? []),
        `${TOOL_LABEL[tc.function.name] ?? tc.function.name}${preview ? `：${preview}` : ''}`,
      ]
      turn.text = ''
      opts.onUpdate({ ...turn })
      let result: string
      if (EDIT_TOOLS.has(tc.function.name)) triedEdit = true
      try {
        result = await runTool(tc.function.name, tc.function.arguments, { plan })
      } catch (e) {
        result = tr('工具执行失败：{0}', e instanceof Error ? e.message : String(e))
      }
      checkCurrent()
      messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: result.slice(0, B.tool) })
    }
  }
  checkCurrent()
  dedupePlan(plan)
  if (plan.steps.length) {
    turn.plan = plan
    turn.planState = 'pending'
  }
  turn.text = sanitizeCitations(turn.text, idx)
  opts.onUpdate({ ...turn })
  return turn
}

/** keep only citations that exist in the index (no invented sources) */
export function sanitizeCitations(text: string, idx: DocIndex): string {
  const known = new Set(idx.passages.map((p) => p.id))
  return (
    text
      .replace(/\[(p\d+#\d+)\]/g, (m, id: string) => (known.has(id) ? m : ''))
      // models sometimes write [p3#2, p4#1]
      .replace(/\[(p\d+#\d+(?:\s*[,，、]\s*p\d+#\d+)+)\]/g, (_, list: string) =>
        list
          .split(/\s*[,，、]\s*/)
          .filter((id) => known.has(id))
          .map((id) => `[${id}]`)
          .join(''),
      )
  )
}

// ── quick actions ──────────────────────────────────────────────

function createQuickActions(): { id: string; label: string; prompt: string; wholeDoc?: boolean }[] {
  return [
    {
      id: 'summary',
      label: tr('总结全文'),
      prompt: tr(
        '请总结这份文档：先用 2-3 句话概括核心内容，再列出主要部分各自讲了什么，最后给出关键结论。每点都要标注来源段落。',
      ),
      wholeDoc: true,
    },
    {
      id: 'keypoints',
      label: tr('关键论点'),
      prompt: tr('提取文档中的关键论点和结论，按重要性排序，每条一句话并标注来源段落。'),
      wholeDoc: true,
    },
    {
      id: 'terms',
      label: tr('术语与定义'),
      prompt: tr('列出文档中出现的重要术语、缩写及其定义或含义（以文档中的说明为准），标注来源段落。'),
      wholeDoc: true,
    },
    {
      id: 'data',
      label: tr('数据与数字'),
      prompt: tr(
        '提取文档中的关键数据：数字、百分比、金额、日期、实验结果等，用表格列出（数据 | 含义 | 来源），来源写段落编号。',
      ),
      wholeDoc: true,
    },
    {
      id: 'page',
      label: tr('解读本页'),
      prompt: tr('解读当前页的内容：这一页在讲什么、要点是什么、与全文的关系。标注来源段落。'),
    },
  ]
}

export let QUICK_ACTIONS: { id: string; label: string; prompt: string; wholeDoc?: boolean }[] = createQuickActions()

function createSelectionActions(): { id: string; label: string; prompt: string }[] {
  return [
    { id: 'explain', label: tr('解释'), prompt: tr('解释这段文字的意思，必要时结合文档上下文。') },
    {
      id: 'translate',
      label: tr('翻译'),
      prompt: tr('把这段文字翻译成中文（如果原文是中文则译成英文），保留术语，只输出译文。'),
    },
    { id: 'summarize', label: tr('概括'), prompt: tr('用一两句话概括这段文字。') },
    {
      id: 'define',
      label: tr('查词'),
      prompt: tr('这段文字是一个词或术语：给出它的含义；如果文档中有定义或用法，引用并标注来源。'),
    },
  ]
}

export let SELECTION_ACTIONS: { id: string; label: string; prompt: string }[] = createSelectionActions()

const TOOL_NAMES = new Set(TOOL_DEFS.map((t) => t.function.name))
const EDIT_TOOLS = new Set([
  'mark_text',
  'replace_text',
  'redact_text',
  'delete_pages',
  'rotate_pages',
  'extract_pages',
  'add_note',
])

/**
 * Tool calls written as plain text by models without reliable native tool
 * calling. Supports `name(key="v", key2=[1,2], key3=true)` and
 * `{"name": "...", "arguments": {...}}` (also inside code fences).
 */
export function parseTextToolCalls(text: string): ToolCall[] {
  const out: ToolCall[] = []
  // JSON form
  for (const m of text.matchAll(
    /\{[^{}]*"name"\s*:\s*"(\w+)"[^{}]*"(?:arguments|parameters)"\s*:\s*(\{[^{}]*\})[^{}]*\}/g,
  )) {
    if (!TOOL_NAMES.has(m[1])) continue
    try {
      JSON.parse(m[2])
      out.push({ id: `text_${out.length}`, type: 'function', function: { name: m[1], arguments: m[2] } })
    } catch {
      /* not valid JSON */
    }
  }
  if (out.length) return out
  // function-call form
  for (const m of text.matchAll(/\b(\w+)\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g)) {
    if (!TOOL_NAMES.has(m[1])) continue
    const args: Record<string, unknown> = {}
    const re = /(\w+)\s*[=:]\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|true|false|-?\d+(?:\.\d+)?)/g
    for (const a of m[2].matchAll(re)) {
      const v = a[2]
      if (v.startsWith('"') || v.startsWith("'")) {
        // keep backslashes literally (regex patterns): only unescape quotes
        args[a[1]] = v.slice(1, -1).replace(/\\(["'])/g, '$1')
      } else if (v.startsWith('[')) {
        try {
          args[a[1]] = JSON.parse(v.replace(/'/g, '"'))
        } catch {
          args[a[1]] = v
        }
      } else args[a[1]] = v === 'true' ? true : v === 'false' ? false : Number(v)
    }
    if (!Object.keys(args).length) continue
    // a pattern given as "regex" means text + regex=true
    if (typeof args.regex === 'string') {
      args.text = args.regex
      args.regex = true
    }
    out.push({ id: `text_${out.length}`, type: 'function', function: { name: m[1], arguments: JSON.stringify(args) } })
  }
  if (out.length) return out
  // prose form ("调用 redact_text 工具，对第 1 页中的手机号 13812345678 …"):
  // only for text-targeting tools, the target must be quoted or look like a
  // concrete value (number / email / url) right after the tool name
  for (const m of text.matchAll(
    /\b(redact_text|mark_text|find_text)\b[^\n]{0,40}?([“"「『]([^”"」』\n]{1,80})[”"」』]|([\w.+-]+@[\w-]+(?:\.[\w-]+)+|\+?\d[\d\s-]{5,}\d|\$[\d,.]+))/g,
  )) {
    const target = (m[3] ?? m[4] ?? '').trim()
    if (!target) continue
    out.push({
      id: `text_${out.length}`,
      type: 'function',
      function: { name: m[1], arguments: JSON.stringify({ text: target }) },
    })
  }
  return out
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  STYLE_HINT = createStyleHint()
  TOOL_LABEL = createToolLabel()
  QUICK_ACTIONS = createQuickActions()
  SELECTION_ACTIONS = createSelectionActions()
})
