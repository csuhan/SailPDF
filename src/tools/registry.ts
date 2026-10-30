import { tr, onLocaleChange, searchableCopy } from '../i18n/locale'
import type { AppMode, ToolId } from '../state/toolStore'
import type { Permissions } from '../pdf/security/standardSecurity'

export type ToolDialog =
  | 'watermark'
  | 'page-numbers'
  | 'properties'
  | 'export-images'
  | 'protect'
  | 'redact'
  | 'optimize'
  | 'compare'
  | 'crop'
  | 'convert'
  | 'ocr'
  | 'export-pdf'
type Command = 'open' | 'create' | 'form' | 'share' | 'export-text' | 'extract-images' | 'save' | 'save-as'
export interface ToolDefinition {
  id: string
  title: string
  description: string
  group: string
  keywords: string
  icon: string
  tint: string
  needsDocument?: boolean
  permissions?: (keyof Permissions)[]
  capability?: 'ocr'
  shortcut?: string
  action:
    | { kind: 'mode'; mode: AppMode; tool?: ToolId }
    | { kind: 'dialog'; dialog: ToolDialog }
    | { kind: 'command'; command: Command }
}

// One catalog supplies both the tools page and command search. The IDs also
// persist favorites, so labels can evolve without losing a user's choices.
function createToolRegistry(): readonly ToolDefinition[] {
  return [
    {
      id: 'edit',
      title: tr('编辑文字与图片'),
      description: tr('直接改原文，保留字体'),
      group: tr('编辑'),
      keywords: '修改 文字 图片 原文 text edit',
      icon: 'edit',
      tint: '#e3f2ef',
      permissions: ['modify'],
      action: { kind: 'mode', mode: 'edit', tool: 'edit-text' },
    },
    {
      id: 'add-text',
      title: tr('添加文本'),
      description: tr('在任意位置加文字'),
      group: tr('编辑'),
      keywords: '写字 插入 文字 text',
      icon: 'text',
      tint: '#e3f2ef',
      permissions: ['modify'],
      action: { kind: 'mode', mode: 'edit', tool: 'add-text' },
    },
    {
      id: 'add-image',
      title: tr('添加图片'),
      description: tr('放置 PNG / JPG'),
      group: tr('编辑'),
      keywords: '插图 照片 image png jpg',
      icon: 'image',
      tint: '#e3f2ef',
      permissions: ['modify'],
      action: { kind: 'mode', mode: 'edit', tool: 'add-image' },
    },
    {
      id: 'watermark',
      title: tr('水印'),
      description: tr('每页加文字水印'),
      group: tr('编辑'),
      keywords: 'watermark 内部资料 草稿',
      icon: 'stamp',
      tint: '#eef2ff',
      permissions: ['modify'],
      action: { kind: 'dialog', dialog: 'watermark' },
    },
    {
      id: 'page-numbers',
      title: tr('页码'),
      description: tr('添加页码 / 页眉页脚'),
      group: tr('编辑'),
      keywords: '编号 页号 页眉 页脚 number',
      icon: 'hash',
      tint: '#eef2ff',
      permissions: ['modify'],
      action: { kind: 'dialog', dialog: 'page-numbers' },
    },
    {
      id: 'note',
      title: tr('注释'),
      description: tr('便签批注，其它阅读器可见'),
      group: tr('批注与审阅'),
      keywords: '评论 便签 批注 note comment',
      icon: 'note',
      tint: '#fff6db',
      permissions: ['annotate'],
      action: { kind: 'mode', mode: 'annotate', tool: 'note' },
    },
    {
      id: 'highlight',
      title: tr('高亮与标记'),
      description: tr('高亮、下划线、删除线'),
      group: tr('批注与审阅'),
      keywords: '荧光笔 画线 highlight underline',
      icon: 'highlight',
      tint: '#fff6db',
      permissions: ['annotate'],
      action: { kind: 'mode', mode: 'annotate', tool: 'highlight' },
    },
    {
      id: 'stamp',
      title: tr('图章'),
      description: tr('已批准、机密、草稿等'),
      group: tr('批注与审阅'),
      keywords: '印章 批准 stamp',
      icon: 'stamp-tool',
      tint: '#fff6db',
      permissions: ['annotate'],
      action: { kind: 'mode', mode: 'annotate', tool: 'stamp' },
    },
    {
      id: 'sign',
      title: tr('签名'),
      description: tr('手写或输入签名并放置'),
      group: tr('批注与审阅'),
      keywords: '签字 手写 signature',
      icon: 'signature',
      tint: '#f3e8fd',
      permissions: ['modify'],
      action: { kind: 'mode', mode: 'edit', tool: 'signature' },
    },
    {
      id: 'form',
      title: tr('填写表单'),
      description: tr('直接在表单字段里输入'),
      group: tr('批注与审阅'),
      keywords: '表格 字段 填写 form',
      icon: 'form',
      tint: '#f3e8fd',
      permissions: ['fillForms'],
      action: { kind: 'command', command: 'form' },
    },
    {
      id: 'organize',
      title: tr('组织页面'),
      description: tr('排序、旋转、插入、删除'),
      group: tr('页面与文件'),
      keywords: '旋转 重排 删除 rotate arrange',
      icon: 'pages',
      tint: '#e8f5e9',
      permissions: ['assemble'],
      action: { kind: 'mode', mode: 'pages' },
    },
    {
      id: 'crop',
      title: tr('裁剪页面'),
      description: tr('去除白边或指定页边距'),
      group: tr('页面与文件'),
      keywords: '裁边 白边 边距 crop',
      icon: 'crop',
      tint: '#e8f5e9',
      permissions: ['modify'],
      action: { kind: 'dialog', dialog: 'crop' },
    },
    {
      id: 'merge',
      title: tr('合并文件'),
      description: tr('把其他 PDF 接到末尾'),
      group: tr('页面与文件'),
      keywords: '拼接 合成 多文件 merge combine',
      icon: 'files',
      tint: '#e8f5e9',
      permissions: ['assemble'],
      action: { kind: 'mode', mode: 'pages' },
    },
    {
      id: 'split',
      title: tr('拆分 / 提取'),
      description: tr('按范围拆成多个文件'),
      group: tr('页面与文件'),
      keywords: '分割 抽页 单页 split extract',
      icon: 'scissors',
      tint: '#e8f5e9',
      permissions: ['assemble'],
      action: { kind: 'mode', mode: 'pages' },
    },
    {
      id: 'ocr',
      title: tr('识别文字 (OCR)'),
      description: tr('扫描件转为可搜索、可复制的 PDF'),
      group: tr('页面与文件'),
      keywords: '扫描识字 扫描件 识别 图片文字 ocr scan',
      icon: 'scan',
      tint: '#e8f5e9',
      permissions: ['modify'],
      capability: 'ocr',
      action: { kind: 'dialog', dialog: 'ocr' },
    },
    {
      id: 'create',
      title: tr('创建 PDF'),
      description: tr('把多张图片合成一个 PDF'),
      group: tr('页面与文件'),
      keywords: '新建 图片转pdf 照片 create',
      icon: 'file-image',
      tint: '#e8f5e9',
      needsDocument: false,
      action: { kind: 'command', command: 'create' },
    },
    {
      id: 'compare',
      title: tr('比较文件'),
      description: tr('与旧版本逐页对比文字差异'),
      group: tr('页面与文件'),
      keywords: '对比 差异 新旧版本 compare diff',
      icon: 'compare',
      tint: '#e8f5e9',
      permissions: ['copy'],
      action: { kind: 'dialog', dialog: 'compare' },
    },
    {
      id: 'open',
      title: tr('打开其它文件'),
      description: tr('选择一个 PDF 文档'),
      group: tr('页面与文件'),
      keywords: '打开 导入 open',
      icon: 'file-plus',
      tint: '#f1f1ef',
      needsDocument: false,
      shortcut: '⌘O',
      action: { kind: 'command', command: 'open' },
    },
    {
      id: 'export-pdf',
      title: tr('导出 PDF 副本'),
      description: tr('含批注 / 拼合批注 / 干净版本'),
      group: tr('导出与信息'),
      keywords: '副本 平面化 flatten export',
      icon: 'file-export',
      tint: '#e3f0fb',
      action: { kind: 'dialog', dialog: 'export-pdf' },
    },
    {
      id: 'share',
      title: tr('分享'),
      description: tr('通过邮件、隔空投送等发送当前文档'),
      group: tr('导出与信息'),
      keywords: '发送 邮件 airdrop share',
      icon: 'share',
      tint: '#e3f0fb',
      action: { kind: 'command', command: 'share' },
    },
    {
      id: 'convert',
      title: tr('转换为 Word / Markdown'),
      description: tr('也支持 LaTeX、HTML，保留标题表格图片'),
      group: tr('导出与信息'),
      keywords: '格式转换 docx word markdown latex html',
      icon: 'convert',
      tint: '#e3f0fb',
      permissions: ['copy'],
      action: { kind: 'dialog', dialog: 'convert' },
    },
    {
      id: 'export-images',
      title: tr('导出为图片'),
      description: tr('每页一张 PNG / JPG'),
      group: tr('导出与信息'),
      keywords: '转图片 png jpg export image',
      icon: 'file-export',
      tint: '#e3f0fb',
      permissions: ['copy'],
      action: { kind: 'dialog', dialog: 'export-images' },
    },
    {
      id: 'export-text',
      title: tr('导出为文本'),
      description: tr('提取全部文字 (.txt)'),
      group: tr('导出与信息'),
      keywords: '复制 文字 导出 txt text',
      icon: 'file-text',
      tint: '#e3f0fb',
      permissions: ['copy'],
      action: { kind: 'command', command: 'export-text' },
    },
    {
      id: 'extract-images',
      title: tr('提取全部图片'),
      description: tr('原图打包为 .zip'),
      group: tr('导出与信息'),
      keywords: '原图 提取 图片 zip extract',
      icon: 'download',
      tint: '#e3f0fb',
      permissions: ['copy'],
      action: { kind: 'command', command: 'extract-images' },
    },
    {
      id: 'optimize',
      title: tr('压缩 PDF'),
      description: tr('压缩图片与字体，减小文件'),
      group: tr('导出与信息'),
      keywords: '减小附件 缩小文件 邮件附件 compress optimize',
      icon: 'compress',
      tint: '#e3f0fb',
      permissions: ['modify'],
      action: { kind: 'dialog', dialog: 'optimize' },
    },
    {
      id: 'properties',
      title: tr('文档属性'),
      description: tr('标题、作者、页面信息'),
      group: tr('导出与信息'),
      keywords: '元数据 标题 作者 信息 metadata properties',
      icon: 'info',
      tint: '#f1f1ef',
      action: { kind: 'dialog', dialog: 'properties' },
    },
    {
      id: 'protect',
      title: tr('保护'),
      description: tr('打开密码、限制编辑与打印'),
      group: tr('保护与密文'),
      keywords: '加密 解密 权限 密码 password encrypt unlock',
      icon: 'lock',
      tint: '#fdecec',
      action: { kind: 'dialog', dialog: 'protect' },
    },
    {
      id: 'redact-find',
      title: tr('查找并标记密文'),
      description: tr('按文字或邮箱、手机号批量删除'),
      group: tr('保护与密文'),
      keywords: '脱敏 隐私 删除敏感信息 redact',
      icon: 'search',
      tint: '#fdecec',
      permissions: ['modify', 'annotate'],
      action: { kind: 'dialog', dialog: 'redact' },
    },
    {
      id: 'redact',
      title: tr('标记密文'),
      description: tr('框选区域，保存时彻底删除内容'),
      group: tr('保护与密文'),
      keywords: '涂黑 遮盖 脱敏 redact',
      icon: 'redact',
      tint: '#fdecec',
      permissions: ['modify', 'annotate'],
      action: { kind: 'mode', mode: 'annotate', tool: 'redact' },
    },
    {
      id: 'save',
      title: tr('保存文档'),
      description: tr('保存当前修改'),
      group: tr('常用操作'),
      keywords: '写入 文件 save',
      icon: 'save',
      tint: '#f1f1ef',
      shortcut: '⌘S',
      action: { kind: 'command', command: 'save' },
    },
    {
      id: 'save-as',
      title: tr('另存为'),
      description: tr('选择新位置保存 PDF'),
      group: tr('常用操作'),
      keywords: '另存 副本 保存 save as',
      icon: 'save',
      tint: '#f1f1ef',
      shortcut: '⇧⌘S',
      action: { kind: 'command', command: 'save-as' },
    },
  ]
}

export let TOOL_REGISTRY: readonly ToolDefinition[] = createToolRegistry()

export const TOOL_GROUPS = [...new Set(TOOL_REGISTRY.map((tool) => tool.group))]
export const findTool = (id: string): ToolDefinition | undefined => TOOL_REGISTRY.find((tool) => tool.id === id)

export interface ToolContext {
  hasDocument: boolean
  loading: boolean
  permissions: Permissions
  ocr: 'checking' | 'available' | 'unavailable'
  busy?: boolean
}
export interface ToolAvailability {
  available: boolean
  /** Choosing a document is a supported next step, rather than a dead end. */
  canOpenDocument?: boolean
  reason: string
}
export function getToolAvailability(tool: ToolDefinition, context: ToolContext): ToolAvailability {
  if (context.busy) return { available: false, reason: tr('另一项工具正在处理，请稍候') }
  if (context.loading) return { available: false, reason: tr('正在打开文档，请稍候') }
  if (tool.capability === 'ocr') {
    if (context.ocr === 'checking') return { available: false, reason: tr('正在检查文字识别功能') }
    if (context.ocr === 'unavailable') return { available: false, reason: tr('文字识别需要支持此功能的 macOS 桌面版') }
  }
  if (tool.needsDocument !== false && !context.hasDocument)
    return { available: false, canOpenDocument: true, reason: tr('选择 PDF 后使用') }
  if (tool.permissions?.some((key) => !context.permissions[key]))
    return { available: false, reason: tr('文档权限不允许此操作，可在“保护”中解锁') }
  return { available: true, reason: tool.capability === 'ocr' ? tr('本机文字识别') : '' }
}

const normalize = (s: string): string => s.normalize('NFKC').toLocaleLowerCase().trim()
export function searchTools(query: string): ToolDefinition[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return [...TOOL_REGISTRY]
  return TOOL_REGISTRY.map((tool, index) => {
    const title = normalize(tool.title)
    const text = normalize(
      `${searchableCopy(tool.title)} ${searchableCopy(tool.description)} ${searchableCopy(tool.group)} ${tool.keywords} ${tool.id}`,
    )
    if (!terms.every((term) => text.includes(term))) return { tool, score: 0, index }
    return { tool, score: terms.reduce((score, term) => score + (title.includes(term) ? 10 : 1), 0), index }
  })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.tool)
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  TOOL_REGISTRY = createToolRegistry()
})
