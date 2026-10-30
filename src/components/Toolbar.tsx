import { tr, onLocaleChange, formatPageCount } from '../i18n/locale'
import { useEffect, useRef, useState } from 'react'
import { usePreferences } from '../state/preferences'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { MODE_TOOLS, useToolStore, type ToolId } from '../state/toolStore'
import { getViewportController } from './viewportController'
import { closeDocument } from '../utils/docSession'
import { getDesktop } from '../desktop/bridge'
import { notify } from '../utils/save'
import { printCurrentDocument } from '../utils/print'
import { docPermissions, RESTRICTED_HINT } from '../utils/secureOpen'
import {
  IconAI,
  IconMaximize,
  IconMoon,
  IconSpread,
  IconArrow,
  IconHome,
  IconBook,
  IconChevronDown,
  IconCircle,
  IconContinuous,
  IconDraw,
  IconEdit,
  IconFileText,
  IconFitPage,
  IconFitWidth,
  IconHighlight,
  IconImage,
  IconLine,
  IconLink,
  IconLock,
  IconMarker,
  IconMinus,
  IconNote,
  IconNextPage,
  IconOpen,
  IconPages,
  IconPenLine,
  IconPlus,
  IconPrevPage,
  IconPrint,
  IconRedact,
  IconRedo,
  IconRotateCCW,
  IconRotateCW,
  IconSave,
  IconSearch,
  IconSelect,
  IconSidebar,
  IconSignature,
  IconSinglePage,
  IconSquare,
  IconStampTool,
  IconStrike,
  IconText,
  IconTools,
  IconUnderline,
  IconUndo,
} from './icons'
import type { ShapeKind } from '../pdf/edit/ops'
import { SignatureDialog, savedSignature } from './SignatureDialog'
import { useAiStore } from '../ai/aiStore'
import { toggleFullscreen, useTheme } from '../state/theme'
import { STAMPS } from '../pdf/edit/stamps'
import { useToolDiscoveryStore } from '../state/toolDiscoveryStore'
import { runTool } from '../tools/runTool'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

const openFile = () => void runTool('open')

/**
 * App header: document identity and frequently used document actions.
 * Doubles as the window title bar on macOS (drag region, traffic lights).
 */
export function Toolbar() {
  const fileName = useAppStore((s) => s.fileName)
  const numPages = useAppStore((s) => s.numPages)
  const sidebar = useAppStore((s) => s.sidebar)
  const searchOpen = useAppStore((s) => s.searchOpen)
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const dirty = useEditStore((s) => s.dirty)
  const opCount = useEditStore((s) => s.ops.length)
  const canUndo = useEditStore((s) => s.ops.length > 0)
  const canRedo = useEditStore((s) => s.redoStack.length > 0)
  const mode = useToolStore((s) => s.mode)
  const savePath = useAppStore((s) => s.savePath)
  const encryption = useAppStore((s) => s.encryption)
  const aiOpen = useAiStore((s) => s.open)
  const perms = docPermissions(encryption)
  const [saving, setSaving] = useState(false)
  const st = useAppStore.getState
  const desktopMac = !!getDesktop() && isMac

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      await runTool('save')
    } finally {
      setSaving(false)
    }
  }

  const title = fileName?.replace(/\.pdf$/i, '') ?? ''

  return (
    <>
      <header className={`app-header ${desktopMac ? 'mac-titlebar' : ''}`} role="toolbar" aria-label={tr('PDF 工具栏')}>
        <div className="hd-left">
          <button
            className="tb-btn"
            title={tr('关闭文档，回到首页 (⌘W)')}
            aria-label={tr('关闭文档')}
            onClick={() => void closeDocument()}
          >
            <IconHome />
          </button>
          <button
            className={`tb-btn ${sidebar !== 'none' ? 'active' : ''}`}
            title={tr('侧边栏')}
            aria-label={tr('侧边栏')}
            onClick={() => st().setSidebar(sidebar === 'none' ? 'thumbs' : 'none')}
          >
            <IconSidebar />
          </button>
          <div className="doc-identity" title={fileName ?? ''}>
            <span className="doc-icon">
              <IconFileText size={15} />
            </span>
            <span className="doc-title">{title}</span>
            <span className="doc-meta">{formatPageCount(numPages)}</span>
            {encryption && (
              <span
                className="doc-lock"
                title={tr(
                  '已加密（{0}）{1}，保存时保持保护',
                  encryption.info.method,
                  encryption.info.restricted && !encryption.owner ? tr('，部分操作受限') : '',
                )}
                aria-label={tr('已加密')}
              >
                <IconLock size={13} />
              </span>
            )}
            {dirty && (
              <span className="doc-badge" title={tr('{0} 处未保存的修改', opCount)}>
                {tr('已编辑')}
              </span>
            )}
          </div>
        </div>

        <div className="hd-right">
          <button
            className="tb-btn"
            title={tr('搜索工具与命令 (⌘K)')}
            aria-label={tr('搜索工具与命令')}
            onClick={() => useToolDiscoveryStore.getState().setPaletteOpen(true)}
          >
            <IconTools />
          </button>
          <button
            className="tb-btn"
            title={tr('撤销 (⌘Z)')}
            aria-label={tr('撤销')}
            disabled={!canUndo}
            onClick={() => useEditStore.getState().undo()}
          >
            <IconUndo />
          </button>
          <button
            className="tb-btn"
            title={tr('重做 (⇧⌘Z)')}
            aria-label={tr('重做')}
            disabled={!canRedo}
            onClick={() => useEditStore.getState().redo()}
          >
            <IconRedo />
          </button>
          <span className="tb-sep" />
          <button
            className={`tb-btn ${searchOpen ? 'active' : ''}`}
            title={tr('查找 (⌘F)')}
            aria-label={tr('查找')}
            disabled={!pdfDoc}
            onClick={() => st().setSearchOpen(!searchOpen)}
          >
            <IconSearch />
          </button>
          <button
            className={`tb-btn ai-toggle ${aiOpen ? 'active' : ''}`}
            title={tr('AI 助手 (⌘J)')}
            aria-label={tr('AI 助手')}
            aria-pressed={aiOpen}
            disabled={!pdfDoc}
            onClick={() => useAiStore.getState().setOpen(!aiOpen)}
          >
            <IconAI />
          </button>
          <button className="tb-btn" title={tr('打开 (⌘O)')} aria-label={tr('打开')} onClick={openFile}>
            <IconOpen />
          </button>
          <button
            className="tb-btn"
            title={perms.print ? tr('打印 (⌘P)') : RESTRICTED_HINT}
            aria-label={tr('打印')}
            disabled={!pdfDoc || !perms.print}
            onClick={() => void printCurrentDocument()}
          >
            <IconPrint />
          </button>
          <button
            className={`save-btn ${dirty ? 'dirty' : ''}`}
            aria-label={saving ? tr('保存中…') : tr('保存')}
            aria-busy={saving}
            title={
              savePath
                ? tr('保存到 {0} (⌘S)', savePath.replace(/^\/Users\/[^/]+/, '~'))
                : tr('保存… 首次保存时选择位置 (⌘S)')
            }
            disabled={!pdfDoc || saving}
            onClick={save}
          >
            <IconSave size={16} />
          </button>
        </div>
      </header>
      <ModeToolbar />
      <SignatureHost />
    </>
  )
}

function SignatureHost() {
  const req = useToolStore((s) => s.signatureRequest)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (req > 0) setOpen(true)
  }, [req])
  if (!open) return null
  return (
    <SignatureDialog
      onClose={() => setOpen(false)}
      onDone={(url) => {
        setOpen(false)
        useToolStore.getState().setTool('signature')
        window.dispatchEvent(new CustomEvent('pdfpro:signature-created', { detail: url }))
        notify(tr('签名已创建，点击页面放置'))
      }}
    />
  )
}

// ── contextual tool strip (edit / annotate) ─────────────────────

function createToolMeta(): Partial<Record<ToolId, { label: string; icon: React.ReactNode; hint: string }>> {
  return {
    'edit-text': {
      label: tr('编辑内容'),
      icon: <IconEdit size={16} />,
      hint: tr('点击文字直接修改，点击图片可导出 / 替换 / 删除'),
    },
    'add-text': { label: tr('添加文本'), icon: <IconText size={16} />, hint: tr('在页面任意位置添加文字') },
    'add-image': { label: tr('添加图片'), icon: <IconImage size={16} />, hint: tr('在页面放置 PNG / JPG 图片') },
    signature: { label: tr('签名'), icon: <IconSignature size={16} />, hint: tr('点击页面放置签名，之后可拖动和缩放') },
    select: { label: tr('选择'), icon: <IconSelect size={16} />, hint: tr('选择、移动、缩放已添加的对象') },
    note: { label: tr('注释'), icon: <IconNote size={16} />, hint: tr('点击页面添加便签注释') },
    highlight: { label: tr('高亮'), icon: <IconHighlight size={16} />, hint: tr('选中文字添加高亮') },
    underline: { label: tr('下划线'), icon: <IconUnderline size={16} />, hint: tr('选中文字添加下划线') },
    strikeout: { label: tr('删除线'), icon: <IconStrike size={16} />, hint: tr('选中文字添加删除线') },
    draw: { label: tr('画笔'), icon: <IconDraw size={16} />, hint: tr('自由绘制') },
    shape: { label: tr('图形'), icon: <IconSquare size={16} />, hint: tr('矩形、椭圆、直线、箭头') },
    link: { label: tr('链接'), icon: <IconLink size={16} />, hint: tr('框选一块区域，设置要打开的网址或跳转的页面') },
    stamp: { label: tr('图章'), icon: <IconStampTool size={16} />, hint: tr('选择图章后点击页面放置，可拖动和缩放') },
    redact: {
      label: tr('标记密文'),
      icon: <IconRedact size={16} />,
      hint: tr('框选要删除的区域，保存时其中的文字、图片会被彻底删除'),
    },
  }
}

let TOOL_META: Partial<Record<ToolId, { label: string; icon: React.ReactNode; hint: string }>> = createToolMeta()

function ModeToolbar() {
  const mode = useToolStore((s) => s.mode)
  const activeTool = useToolStore((s) => s.activeTool)
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  if (!pdfDoc || (mode !== 'edit' && mode !== 'annotate')) return null
  const tools = MODE_TOOLS[mode]
  return (
    <div className="mode-toolbar" role="toolbar" aria-label={mode === 'edit' ? tr('编辑工具') : tr('批注工具')}>
      <div className="mt-tools">
        {tools.map((t) => {
          const meta = TOOL_META[t]
          if (!meta) return null
          return (
            <button
              key={t}
              className={`mt-tool ${activeTool === t ? 'active' : ''}`}
              title={meta.hint}
              aria-label={meta.label}
              aria-pressed={activeTool === t}
              onClick={() => useToolStore.getState().setTool(t)}
            >
              {meta.icon}
              <span>{meta.label}</span>
            </button>
          )
        })}
      </div>
      <span className="mt-sep" />
      <ToolOptions tool={activeTool} />
    </div>
  )
}

// ── inline tool options (replaces the old right-hand panel) ─────

function createFontOptions() {
  return [
    ['Helvetica', 'Helvetica'],
    ['Helvetica-Bold', tr('Helvetica 粗体')],
    ['Helvetica-Oblique', tr('Helvetica 斜体')],
    ['Times-Roman', 'Times'],
    ['Times-Bold', tr('Times 粗体')],
    ['Times-Italic', tr('Times 斜体')],
    ['Courier', 'Courier'],
    ['Courier-Bold', tr('Courier 粗体')],
  ] as const
}

let FONT_OPTIONS = createFontOptions()

const COLORS = ['#111111', '#d32f2f', '#ef6c00', '#f9a825', '#2e7d32', '#1565c0', '#6a1b9a']
const MARK_COLORS = ['#ffeb3b', '#a5d6a7', '#90caf9', '#f48fb1', '#ffcc80']
const NOTE_COLORS = ['#f5b400', '#43a047', '#1e88e5', '#e53935', '#8e24aa']

function ToolOptions({ tool }: { tool: ToolId }) {
  const textStyle = useToolStore((s) => s.textStyle)
  const drawStyle = useToolStore((s) => s.drawStyle)
  const shapeKind = useToolStore((s) => s.shapeKind)
  const shapeFill = useToolStore((s) => s.shapeFill)
  const markupColors = useToolStore((s) => s.markupColors)
  const noteColor = useToolStore((s) => s.noteColor)
  const stampId = useToolStore((s) => s.stampId)
  const ts = useToolStore.getState()

  if (tool === 'add-text') {
    return (
      <div className="mt-options">
        <select
          className="mt-select"
          aria-label={tr('字体')}
          value={textStyle.fontName}
          onChange={(e) => ts.setTextStyle({ fontName: e.target.value as typeof textStyle.fontName })}
        >
          {FONT_OPTIONS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        <Stepper
          label={tr('字号')}
          value={textStyle.fontSize}
          unit="pt"
          min={6}
          max={96}
          step={1}
          onChange={(v) => ts.setTextStyle({ fontSize: v })}
        />
        <Swatches colors={COLORS} value={textStyle.color} onChange={(c) => ts.setTextStyle({ color: c })} />
      </div>
    )
  }
  if (tool === 'draw' || tool === 'shape') {
    return (
      <div className="mt-options">
        {tool === 'shape' && (
          <div className="mt-segment" role="group" aria-label={tr('形状')}>
            {(
              [
                ['rect', tr('矩形'), <IconSquare size={15} />],
                ['ellipse', tr('椭圆'), <IconCircle size={15} />],
                ['line', tr('直线'), <IconLine size={15} />],
                ['arrow', tr('箭头'), <IconArrow size={15} />],
              ] as [ShapeKind, string, React.ReactNode][]
            ).map(([k, label, icon]) => (
              <button
                key={k}
                className={shapeKind === k ? 'active' : ''}
                title={label}
                aria-label={label}
                aria-pressed={shapeKind === k}
                onClick={() => ts.setShapeKind(k)}
              >
                {icon}
              </button>
            ))}
          </div>
        )}
        {tool === 'shape' && (
          <label className="mt-check">
            <input type="checkbox" checked={shapeFill} onChange={(e) => ts.setShapeFill(e.target.checked)} />
            {tr('填充')}
          </label>
        )}
        <Stepper
          label={tr('粗细')}
          value={drawStyle.thickness}
          unit="pt"
          min={0.5}
          max={12}
          step={0.5}
          onChange={(v) => ts.setDrawStyle({ thickness: v })}
        />
        {tool === 'draw' && (
          <Stepper
            label={tr('不透明')}
            value={Math.round(drawStyle.opacity * 100)}
            unit="%"
            min={10}
            max={100}
            step={10}
            onChange={(v) => ts.setDrawStyle({ opacity: v / 100 })}
          />
        )}
        <Swatches colors={COLORS} value={drawStyle.color} onChange={(c) => ts.setDrawStyle({ color: c })} />
      </div>
    )
  }
  if (tool === 'signature') {
    return (
      <div className="mt-options">
        <span className="mt-hint">{tr('点击页面放置签名')}</span>
        <button className="btn small" onClick={() => ts.requestSignature()}>
          {savedSignature() ? tr('重新创建签名') : tr('创建签名')}
        </button>
      </div>
    )
  }
  if (tool === 'stamp') {
    return (
      <div className="mt-options">
        <div className="stamp-picker" role="radiogroup" aria-label={tr('图章')}>
          {STAMPS.map((d) => (
            <button
              key={d.id}
              role="radio"
              aria-checked={stampId === d.id}
              className={`stamp-chip ${stampId === d.id ? 'active' : ''}`}
              style={{ color: d.color, borderColor: stampId === d.id ? d.color : undefined }}
              title={d.dated ? tr('{0}（带日期时间）', d.label) : d.label}
              onClick={() => ts.setStampId(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </div>
    )
  }
  if (tool === 'note') {
    return (
      <div className="mt-options">
        <Swatches colors={NOTE_COLORS} value={noteColor} onChange={(c) => ts.setNoteColor(c)} />
        <span className="mt-hint">{tr('点击页面放置注释')}</span>
      </div>
    )
  }
  if (tool === 'highlight' || tool === 'underline' || tool === 'strikeout') {
    return (
      <div className="mt-options">
        <Swatches
          colors={tool === 'highlight' ? MARK_COLORS : COLORS}
          value={markupColors[tool]}
          onChange={(c) => ts.setMarkupColor(tool, c)}
        />
      </div>
    )
  }
  const meta = TOOL_META[tool]
  return <div className="mt-options mt-hint">{meta?.hint}</div>
}

function Stepper({
  label,
  value,
  unit,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  unit: string
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step))
  return (
    <div className="mt-stepper" role="group" aria-label={label}>
      <span className="mt-stepper-label">{label}</span>
      <button
        title={tr('减小{0}', label)}
        aria-label={tr('减小{0}', label)}
        onClick={() => onChange(clamp(value - step))}
        disabled={value <= min}
      >
        <IconMinus size={13} />
      </button>
      <span className="mt-stepper-value">
        {value}
        {unit}
      </span>
      <button
        title={tr('增大{0}', label)}
        aria-label={tr('增大{0}', label)}
        onClick={() => onChange(clamp(value + step))}
        disabled={value >= max}
      >
        <IconPlus size={13} />
      </button>
    </div>
  )
}

function Swatches({ colors, value, onChange }: { colors: string[]; value: string; onChange: (c: string) => void }) {
  const custom = !colors.includes(value.toLowerCase())
  return (
    <div className="mt-swatches" role="radiogroup" aria-label={tr('颜色')}>
      {colors.map((c) => (
        <button
          key={c}
          className={`mt-swatch ${value.toLowerCase() === c ? 'active' : ''}`}
          style={{ background: c }}
          title={c}
          aria-label={c}
          aria-checked={value.toLowerCase() === c}
          role="radio"
          onClick={() => onChange(c)}
        />
      ))}
      <label
        className={`mt-swatch mt-swatch-custom ${custom ? 'active' : ''}`}
        title={tr('自定义颜色')}
        style={custom ? { background: value } : undefined}
      >
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={tr('自定义颜色')} />
      </label>
    </div>
  )
}

// ── floating view controls (bottom of the canvas) ───────────────

const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]

export function ViewControls() {
  const readingColor = usePreferences((s) => s.readingColor)
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const numPages = useAppStore((s) => s.numPages)
  const currentPage = useAppStore((s) => s.currentPage)
  const scale = useAppStore((s) => s.scale)
  const fitMode = useAppStore((s) => s.fitMode)
  const viewMode = useAppStore((s) => s.viewMode)
  const mode = useToolStore((s) => s.mode)
  const theme = useTheme((s) => s.theme)
  const setTheme = useTheme((s) => s.setTheme)
  const [pageInput, setPageInput] = useState(String(currentPage))
  const [menu, setMenu] = useState(false)
  const editing = useRef(false)
  const st = useAppStore.getState

  useEffect(() => {
    if (!editing.current) setPageInput(String(currentPage))
  }, [currentPage])

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])

  // page / tools views replace the reading canvas: no zoom controls there
  if (!pdfDoc || mode === 'pages' || mode === 'tools') return null

  const commit = () => {
    editing.current = false
    const n = parseInt(pageInput, 10)
    if (Number.isFinite(n)) st().goToPage(n)
    else setPageInput(String(st().currentPage))
  }
  const zoomLabel =
    fitMode === 'fit-width' ? tr('适合宽度') : fitMode === 'fit-page' ? tr('适合页面') : `${Math.round(scale * 100)}%`

  return (
    <div className="view-controls" role="toolbar" aria-label={tr('视图控制')}>
      <button
        className="vc-btn"
        title={tr('上一页')}
        aria-label={tr('上一页')}
        disabled={currentPage <= 1}
        onClick={() => st().goToPage(currentPage - 1)}
      >
        <IconPrevPage size={16} />
      </button>
      <div className="vc-page">
        <input
          value={pageInput}
          aria-label={tr('页码')}
          onFocus={(e) => {
            editing.current = true
            e.target.select()
          }}
          onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') {
              editing.current = false
              setPageInput(String(st().currentPage))
              ;(e.target as HTMLInputElement).blur()
            }
            e.stopPropagation()
          }}
        />
        <span>/ {numPages}</span>
      </div>
      <button
        className="vc-btn"
        title={tr('下一页')}
        aria-label={tr('下一页')}
        disabled={currentPage >= numPages}
        onClick={() => st().goToPage(currentPage + 1)}
      >
        <IconNextPage size={16} />
      </button>
      <span className="vc-sep" />
      <button
        className="vc-btn"
        title={tr('缩小 (−)')}
        aria-label={tr('缩小')}
        onClick={() => getViewportController()?.zoomBy(1 / 1.15)}
      >
        <IconMinus size={15} />
      </button>
      <div className="vc-zoom" onPointerDown={(e) => e.stopPropagation()}>
        <button className="vc-zoom-btn" title={tr('缩放')} onClick={() => setMenu((v) => !v)}>
          {zoomLabel}
          <IconChevronDown size={12} />
        </button>
        {menu && (
          <div className="vc-menu" role="menu">
            <button
              className={fitMode === 'fit-width' ? 'active' : ''}
              onClick={() => {
                st().setFitMode('fit-width')
                setMenu(false)
              }}
            >
              <IconFitWidth size={15} />
              {tr(' 适合宽度 ')}
              <kbd>⌘9</kbd>
            </button>
            <button
              className={fitMode === 'fit-page' ? 'active' : ''}
              onClick={() => {
                st().setFitMode('fit-page')
                setMenu(false)
              }}
            >
              <IconFitPage size={15} />
              {tr(' 适合页面 ')}
              <kbd>⌘0</kbd>
            </button>
            <div className="vc-menu-sep" />
            {ZOOM_PRESETS.map((z) => (
              <button
                key={z}
                className={fitMode === 'custom' && Math.abs(scale - z) < 0.005 ? 'active' : ''}
                onClick={() => {
                  st().setScale(z, 'custom')
                  setMenu(false)
                }}
              >
                <span className="vc-menu-pad" />
                {Math.round(z * 100)}%
              </button>
            ))}
            <div className="vc-menu-sep" />
            <button
              className={viewMode === 'continuous' ? 'active' : ''}
              onClick={() => {
                st().setViewMode('continuous')
                setMenu(false)
              }}
            >
              <IconContinuous size={15} />
              {tr(' 连续滚动')}
            </button>
            <button
              className={viewMode === 'single' ? 'active' : ''}
              onClick={() => {
                st().setViewMode('single')
                setMenu(false)
              }}
            >
              <IconSinglePage size={15} />
              {tr(' 单页')}
            </button>
            <button
              className={viewMode === 'spread' ? 'active' : ''}
              onClick={() => {
                st().setViewMode('spread')
                setMenu(false)
              }}
            >
              <IconSpread size={15} />
              {tr(' 双页')}
            </button>
            <div className="vc-menu-sep" />
            <button
              className={theme === 'dark' ? 'active' : ''}
              onClick={() => {
                setTheme(theme === 'dark' ? 'light' : 'dark')
                setMenu(false)
              }}
            >
              <IconMoon size={15} />
              {tr(' 深色模式 ')}
              <kbd>⇧⌘D</kbd>
            </button>
            <button
              onClick={() => {
                toggleFullscreen()
                setMenu(false)
              }}
            >
              <IconMaximize size={15} />
              {tr(' 全屏 ')}
              <kbd>F11</kbd>
            </button>
            <div className="vc-menu-sep" />
            <button
              onClick={() => {
                st().rotateView(-90)
                setMenu(false)
              }}
            >
              <IconRotateCCW size={15} />
              {tr(' 向左旋转 ')}
              <kbd>⇧R</kbd>
            </button>
            <button
              onClick={() => {
                st().rotateView(90)
                setMenu(false)
              }}
            >
              <IconRotateCW size={15} />
              {tr(' 向右旋转 ')}
              <kbd>R</kbd>
            </button>
          </div>
        )}
      </div>
      <button
        className="vc-btn"
        title={tr('放大 (+)')}
        aria-label={tr('放大')}
        onClick={() => getViewportController()?.zoomBy(1.15)}
      >
        <IconPlus size={15} />
      </button>
      <span className="vc-sep" />
      <select
        className="reading-color-select"
        aria-label={tr('切换阅读底色')}
        title={tr('阅读底色（仅影响屏幕显示）')}
        value={readingColor}
        onChange={(event) =>
          usePreferences.getState().setPreferences({ readingColor: event.target.value as typeof readingColor })
        }
      >
        <option value="auto">{tr('自动底色')}</option>
        <option value="original">{tr('原色')}</option>
        <option value="warm">{tr('暖纸')}</option>
        <option value="green">{tr('护眼绿')}</option>
        <option value="dark">{tr('深色阅读')}</option>
      </select>
    </div>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  TOOL_META = createToolMeta()
  FONT_OPTIONS = createFontOptions()
})
