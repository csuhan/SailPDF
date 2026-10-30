'use strict'
const REPO = 'https://github.com/csuhan/SailPDF'
const icons = {
  'arrow-down': '<path d="M12 4v16m-6-6 6 6 6-6"/>',
  'arrow-up-right': '<path d="M6 18 18 6M6 6h12v12"/>',
  'arrow-down-right': '<path d="m6 6 12 12M6 18h12V6"/>',
  book: '<path d="M12 6C9 4 5 4 3 5v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-2-1-6-1-9 1Zm0 0v14"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Z"/>',
  highlight: '<path d="m12 3 9 9-7 7-9-9Z"/><path d="m5 10-2 5 6 6 5-2M3 21h6"/>',
  pages:
    '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  sparkle: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
  panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M8 13h8M8 17h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
  bookmark: '<path d="M5 3h14v19l-7-5-7 5Z"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>',
  pointer: '<path d="m4 3 16 9-7 2-3 7Z"/>',
  laptop: '<rect x="4" y="3" width="16" height="13" rx="2"/><path d="m4 16-2 4h20l-2-4M10 12h4"/>',
  layers: '<path d="m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5"/>',
  shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6Zm-4 10 3 3 5-6"/>',
  history: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6M12 7v6l4 2"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  rotate: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  merge: '<path d="M5 3v5c0 5 7 3 7 7v6M19 3v5c0 5-7 3-7 7m-4 2 4 4 4-4"/>',
  export: '<path d="M9 4H4v17h16v-5M11 13 21 3M14 3h7v7"/>',
  form: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 7h8M8 12h8M8 17h4"/>',
  note: '<path d="M21 14V3H3v18h11Zm0 0h-7v7"/>',
  signature: '<path d="M3 18c3-1 6-13 8-13 3 0-4 13-1 13 1 0 4-4 5-4 1 0 0 3 2 3l4-1M3 22h18"/>',
  ocr: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M8 9h8m-4 0v8M9 17h6"/>',
  apple:
    '<path d="M16.8 2c.1 2-1.4 3.5-3.2 3.5-.1-1.8 1.4-3.3 3.2-3.5Z" fill="currentColor" stroke="none"/><path d="M18.8 12.6c0-2 1.6-3.1 1.7-3.2-1-1.4-2.5-1.6-3.1-1.7-1.3-.1-2.5.8-3.1.8-.7 0-1.8-.8-2.9-.7-1.5 0-2.9.9-3.7 2.2-1.5 2.6-.4 6.4 1 8.5.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.8-.7s1.7.7 2.9.7 1.9-1 2.5-2c.8-1.2 1.2-2.3 1.2-2.4-.1 0-2-.8-2-3.6Z" fill="currentColor" stroke="none"/>',
  github:
    '<path d="M9 19c-4 1-4-2-6-2m12 4v-3.4a3 3 0 0 0-.8-2.3c2.7-.3 5.5-1.3 5.5-6A4.7 4.7 0 0 0 18.4 6a4.3 4.3 0 0 0-.1-3.3S17.3 2.4 15 4a11 11 0 0 0-6 0C6.7 2.4 5.7 2.7 5.7 2.7a4.3 4.3 0 0 0-.1 3.3 4.7 4.7 0 0 0-1.3 3.3c0 4.7 2.8 5.7 5.5 6A3 3 0 0 0 9 17.6V21"/>',
}
function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.file}</svg>`
}
function hydrateIcons(root = document) {
  root.querySelectorAll('i[data-icon]').forEach((el) => {
    el.innerHTML = icon(el.dataset.icon)
  })
}
const initial = {}
document.querySelectorAll('[data-i18n]').forEach((el) => (initial[el.dataset.i18n] = el.textContent))
document.querySelectorAll('[data-i18n-html]').forEach((el) => (initial[el.dataset.i18nHtml] = el.innerHTML))
document
  .querySelectorAll('[data-i18n-aria]')
  .forEach((el) => (initial[el.dataset.i18nAria] = el.getAttribute('aria-label')))
document
  .querySelectorAll('[data-i18n-placeholder]')
  .forEach((el) => (initial[el.dataset.i18nPlaceholder] = el.getAttribute('placeholder')))
const en = {
  ...initial,
  all: 'All tools',
  reading: 'Reading',
  editing: 'Editing',
  pageTools: 'Pages',
  exportTools: 'Export',
  toolDetailLabel: 'IN THE TOOLKIT',
  howTo: 'How it works',
  tryPreview: 'See the workspace',
  rotate: 'Rotate page',
  reorder: 'Reorder pages',
  reordered: 'Example page order updated',
  rotation: 'Example page rotated',
  notesBy: 'YOUR NOTE',
  noteText: 'Check the delivery date with the team.',
  editHint: 'Text selected · original layout retained',
  annotationHint: 'Highlight · Underline · Note',
  pageHint: 'Select, rotate and reorder',
  aiPlaceholder: 'Ask about this document…',
  summaryPrompt: 'What are the key takeaways from this brief?',
  summaryIntro: 'The brief highlights three priorities:',
  summaryOne: 'A focused workspace',
  summaryOneText: 'Keep document reading and related decisions together.',
  summaryTwo: 'A clear review process',
  summaryTwoText: 'Review changes before they become final.',
  summaryThree: 'A considered next step',
  summaryThreeText: 'Validate the direction with the project team.',
  findPrompt: 'What needs to happen before delivery?',
  findAnswer:
    'The brief calls for a team review before the final handoff. Confirm the project scope, review the document changes, and agree on the delivery date.',
  findSource: 'Source: next steps, page 3.',
  revisePrompt: 'Prepare a clearer version of the review deadline.',
  reviseIntro: 'Here is a proposed wording change for your review:',
  reviseOld: 'The team should review it soon.',
  reviseNew: 'Complete the team review before the final handoff.',
  reviseNote: 'Proposed change only. Review it in the app before applying.',
  readDescription: 'Keep multiple PDFs open, search the text, and pick up where you left off.',
  editDescription: 'Make focused changes to text and images, with undo close at hand.',
  annotateDescription: 'Highlight what matters and leave notes without losing the original context.',
  pagesDescription: 'See the whole document. Reorder, rotate, merge or extract its pages.',
  aiDescription: 'Ask alongside the source. Check references and review proposed changes.',
  legalLoading: 'Loading document…',
  legalError: 'Unable to load this document. Please see the project repository.',
  privacyTitleDialog: 'Privacy notice',
  termsTitleDialog: 'Beta terms and limitations',
  licenseTitleDialog: 'Apache License 2.0',
  sourceDetails: 'The website previews interface behavior. PDF processing happens in the application.',
}
const zh = {
  skip: '跳转至正文',
  navigation: '主导航',
  navWorkspace: '工作空间',
  navTools: '常用工具',
  navAI: 'AI 助手',
  navPrivacy: '隐私与开源',
  download: '下载',
  openNav: '打开导航',
  heroLabel: '你的桌面，你的文档。',
  heroTitle: '让文档工作，<br>更有<span class="hero-emphasis">条理。</span>',
  heroDescription: '阅读、批注、编辑与理解 PDF。在同一个清晰、有序的工作空间里，专注于文档本身。',
  downloadMac: '获取 Sail PDF for Mac',
  explore: '探索工作空间',
  releaseShort: 'v0.11.0 测试版 · Apple Silicon',
  openSource: '开源',
  workspaceTitle: '体验 Sail PDF 工作空间',
  demoLabel: '可交互的产品示意界面',
  demoAssistant: 'AI 助手',
  read: '阅读',
  edit: '编辑',
  annotate: '批注',
  pages: '页面',
  tools: '工具',
  demoPageCount: '3 页',
  saved: '已保存在本机',
  exploreTools: '探索工具',
  notesFile: '研究笔记.pdf',
  demoDisclosure: '交互演示 · 示例内容',
  demoHint: '试试下方的工作模式',
  workspaceModes: '工作模式',
  ai: 'AI 助手',
  stripLocal: '日常文档处理留在本机',
  stripTabs: '多文档，独立工作空间',
  stripOpen: 'Apache 2.0 开源',
  stripAI: 'AI 模型，由你选择',
  toolsLabel: '日常需要的，准备齐全',
  toolsTitle: '合适的工具，<br>就在手边。',
  toolsIntro: '从一处高亮，到最终导出。常用操作集中呈现，让每一步衔接自然。',
  toolCategories: '工具分类',
  searchTools: '搜索工具',
  searchPlaceholder: '搜索工具…',
  emptyTools: '没有找到匹配的工具，请尝试其他关键词或分类。',
  toolsFootnote: '点击工具，了解用途和使用方式。',
  allSource: '查看项目源码',
  aiLabel: '文档旁，多一位助手',
  aiTitle: '与文档一起，<br>推进工作。',
  aiIntro: '提问、查找细节，或准备一项修改。助手就在 PDF 旁边，原文始终可见，判断始终由你完成。',
  aiPoint1: '回答有依据，原文可查阅。',
  aiPoint1Text: '沿着引用回到相关页面，核对回答与原始内容。',
  aiPoint2: '先看方案，再决定是否应用。',
  aiPoint2Text: '检查助手提出的修改，由你确认后再应用。',
  aiPoint3: '选择适合自己的模型。',
  aiPoint3Text: '使用本机模型，或连接自己的兼容 AI 服务。',
  assistantShort: '助手',
  example: '示例',
  summarize: '提炼要点',
  find: '查找信息',
  revise: '准备修改',
  exampleOnly: '示例回答',
  privacyLabel: '每一处设计，都考虑周全',
  privacyTitle: '你的文件，<br>由你做主。',
  privacyIntro: '桌面工作空间应当尊重你的文档，也尊重你的选择。这是 Sail PDF 的基本原则。',
  viewGithub: '在 GitHub 查看',
  privacyLocalTitle: '日常处理，在本机完成。',
  privacyLocalText: '阅读、批注和常用编辑在设备本地处理，使用这些工具无需注册应用账号。',
  privacyAITitle: '是否连接 AI，由你选择。',
  privacyAIText: '本地模型在 Mac 上运行。自定义 AI 服务会收到任务所需的文档上下文，请选择可信赖的服务。',
  privacySaveTitle: '每一次修改，都值得妥善保存。',
  privacySaveText: '恢复草稿包含表单内容。保存前校验与外部文件冲突检查，帮助你掌握文件状态。',
  privacyOpenTitle: '代码可查阅，也欢迎共同改进。',
  privacyOpenText: '自有代码采用 Apache 2.0 开源。你可以检查源码、提交问题，或参与下一个版本。',
  downloadLabel: '为下一份文档，准备好工作空间',
  downloadTitle: '下一份 PDF，从这里开始。',
  downloadDescription: 'Sail PDF 0.11.0 测试版 · macOS · Apple Silicon',
  faqLabel: '开始之前，你可能想了解',
  faqTitle: '几个常见问题。',
  faqIntro: '还没有找到答案？',
  askGithub: '在 GitHub 提问',
  faq1Q: '目前支持哪些平台？',
  faq1A:
    '当前桌面测试版面向 Apple Silicon Mac。浏览器版可以从源码运行。本次版本暂不提供 Windows、Linux 或 Intel Mac 安装包。',
  faq2Q: '不用 AI，也能使用 Sail PDF 吗？',
  faq2A:
    '可以。阅读、编辑、批注和页面工具无需连接 AI。使用文档助手时，可在应用内下载支持的本机模型，或配置自己的 OpenAI 兼容接口。',
  faq3Q: 'PDF 文件会被上传吗？',
  faq3A:
    '日常文档操作在本机处理。如果选择自定义 AI 服务，请求所需的文档上下文会发送到该服务。应用不会自动上传文档或诊断报告。',
  faq4Q: '使用测试版需要了解什么？',
  faq4A:
    '请保留重要文件的备份，特别留意复杂排版或字体的导出结果。当前构建未签名、未经公证。段落重排、部分字体和已压平批注存在编辑限制。',
  faq5Q: '可以使用和修改源代码吗？',
  faq5A: '可以，但需要遵守 Apache License 2.0 的条件。第三方软件、字体和模型保留各自许可，仓库内附有许可证与归属声明。',
  footerTagline: '更清晰的 PDF 工作方式。',
  releases: '版本发布',
  questions: '常见问题',
  privacyPolicy: '隐私说明',
  terms: '测试版条款',
  license: 'Apache 2.0',
  footerMade: '专注每一份文档。',
  close: '关闭',
  betaLabel: 'SAIL PDF / 公开测试版',
  dialogDownloadTitle: '为你的 Mac 准备的工作空间。',
  dialogDownloadIntro: '版本 0.11.0 · macOS Apple Silicon',
  downloadPlatform: '支持平台',
  downloadLicense: '源码许可',
  downloadStatus: '版本通道',
  beta: '测试版',
  releaseNotice:
    '当前测试版未签名、未经公证，请保留重要文件备份。在 GitHub Releases 查看可用安装包；如果尚无发布条目，表示公开安装包还未发布。',
  viewReleases: '查看可用版本',
  buildFromSource: '或在 GitHub 查看源码构建方式',
  all: '全部工具',
  reading: '阅读',
  editing: '编辑',
  pageTools: '页面',
  exportTools: '导出',
  toolDetailLabel: '常用工具',
  howTo: '使用方式',
  tryPreview: '查看工作区演示',
  rotate: '旋转页面',
  reorder: '调整顺序',
  reordered: '示例页面顺序已更新',
  rotation: '示例页面已旋转',
  notesBy: '我的批注',
  noteText: '请与团队复核交付日期。',
  editHint: '已选中文字 · 保留原有版式',
  annotationHint: '高亮 · 下划线 · 便签',
  pageHint: '选择、旋转和重排',
  aiPlaceholder: '围绕这份文档提问…',
  summaryPrompt: '请总结这份简报的关键要点。',
  summaryIntro: '简报提出了三个优先事项：',
  summaryOne: '专注的工作空间',
  summaryOneText: '将文档阅读与相关决策集中在一起。',
  summaryTwo: '清晰的审阅流程',
  summaryTwoText: '在修改成为最终结果前完成核对。',
  summaryThree: '明确的下一步',
  summaryThreeText: '与项目团队共同确认工作方向。',
  findPrompt: '交付前需要完成哪些工作？',
  findAnswer: '简报要求在最终交付前组织团队审阅，确认项目范围、复核文档修改，并约定交付日期。',
  findSource: '来源：第 3 页，后续计划。',
  revisePrompt: '请把审阅截止时间写得更明确。',
  reviseIntro: '以下是一项供你检查的措辞修改：',
  reviseOld: '团队应该尽快完成审阅。',
  reviseNew: '请在最终交付前完成团队审阅。',
  reviseNote: '仅为修改建议，请在应用中核对后再决定是否应用。',
  readDescription: '同时打开多份 PDF，搜索正文，从上次的位置继续阅读。',
  editDescription: '修改文字与图片，保留原有结构，随时可以撤销。',
  annotateDescription: '高亮重点、添加批注，让每一条意见都有上下文。',
  pagesDescription: '一眼看清整份文档，重排、旋转、合并或提取页面。',
  aiDescription: '在原文旁边提问，核对引用，并审阅提出的修改。',
  legalLoading: '正在读取说明…',
  legalError: '暂时无法读取该文档，请访问项目仓库查看。',
  privacyTitleDialog: '隐私说明',
  termsTitleDialog: '测试版条款与使用限制',
  licenseTitleDialog: 'Apache License 2.0',
  sourceDetails: '网页用于演示界面和工作方式，实际 PDF 处理在应用内完成。',
}
Object.assign(zh, {
  home: 'Sail PDF 首页',
  previewAI: '预览 AI 助手',
  exampleDocuments: '示例文档',
  examplePages: '示例页面',
  illustrativePDF: 'PDF 示例内容',
  assistantExample: 'AI 助手示例',
  assistantExamples: 'AI 示例类型',
  previewPage1: '预览第 1 页',
  previewPage2: '预览第 2 页',
  previewPage3: '预览第 3 页',
  faq6Q: '可以使用英文或中文界面吗？',
  faq6A:
    '可以。应用默认英文，可在设置中切换简体中文，偏好会自动保存。界面语言不会翻译 PDF 正文、批注、表单或已有对话。AI 回答语言通过单独的选项设置。',
})
let locale = 'en'
try {
  if ((localStorage.getItem('sail.site.language') || localStorage.getItem('lumen.site.language')) === 'zh-CN')
    locale = 'zh-CN'
} catch {}
const t = (key) => (locale === 'zh-CN' ? zh[key] : en[key]) ?? en[key] ?? key
const state = {
  mode: 'read',
  document: 'atlas',
  page: 1,
  category: 'all',
  search: '',
  aiExample: 'summary',
  order: [1, 2, 3],
  rotation: 0,
  activeTool: null,
}
const toolData = [
  {
    id: 'read',
    category: 'reading',
    icon: 'book',
    en: [
      'Comfortable reading',
      'Multiple PDFs, page navigation and reading colors.',
      [
        'Open PDFs in separate tabs.',
        'Choose a reading color and zoom level.',
        'Search text and return to your last reading position.',
      ],
    ],
    zh: [
      '舒适阅读',
      '多文档标签、页面导航与独立阅读底色。',
      ['在独立标签中打开多份 PDF。', '调整阅读底色、布局和缩放。', '搜索正文，从上次的位置继续。'],
    ],
    mode: 'read',
  },
  {
    id: 'highlight',
    category: 'reading',
    icon: 'highlight',
    en: [
      'Highlights & markup',
      'Highlight, underline or strike through a passage.',
      [
        'Select text in your PDF.',
        'Choose highlight, underline or strikeout.',
        'Manage or remove the mark from the annotation list.',
      ],
    ],
    zh: [
      '高亮与标记',
      '高亮、下划线和删除线，标记重要内容。',
      ['选择 PDF 中的文字。', '添加高亮、下划线或删除线。', '从批注列表管理或删除标记。'],
    ],
    mode: 'annotate',
  },
  {
    id: 'notes',
    category: 'reading',
    icon: 'note',
    en: [
      'Notes & comments',
      'Leave a thought right where it belongs.',
      [
        'Switch to annotation mode.',
        'Place a note beside the relevant passage.',
        'Save standard PDF notes for other readers to see.',
      ],
    ],
    zh: [
      '便签批注',
      '把想法留在相关内容旁边。',
      ['切换到批注模式。', '在相关内容旁放置便签。', '保存为标准 PDF 批注，方便其他阅读器查看。'],
    ],
    mode: 'annotate',
  },
  {
    id: 'text',
    category: 'editing',
    icon: 'edit',
    en: [
      'Text & image editing',
      'Make focused updates without starting over.',
      [
        'Choose Edit and select text or an image.',
        'Make the change, then review it on the page.',
        'Save a copy and check complex layouts in another reader.',
      ],
    ],
    zh: [
      '文字与图片编辑',
      '直接修改需要调整的内容，无需从头开始。',
      ['选择编辑，点击文字或图片。', '完成修改，并在页面上检查结果。', '另存副本，在其他阅读器核对复杂排版。'],
    ],
    mode: 'edit',
  },
  {
    id: 'forms',
    category: 'editing',
    icon: 'form',
    en: [
      'Fill PDF forms',
      'Complete existing form fields and save the result.',
      [
        'Open a PDF with interactive form fields.',
        'Enter values directly in the page.',
        'Save the PDF to retain the completed fields.',
      ],
    ],
    zh: [
      '填写表单',
      '直接填写现有表单字段，并保存结果。',
      ['打开包含交互表单的 PDF。', '在页面字段中填写内容。', '保存 PDF，保留填写结果。'],
    ],
    mode: 'edit',
  },
  {
    id: 'signature',
    category: 'editing',
    icon: 'signature',
    en: [
      'Handwritten signatures',
      'Place a drawn or typed signature on a page.',
      [
        'Draw or type a signature.',
        'Place and resize it on the page.',
        'Review the saved copy. This is a visual signature, not a certificate signature.',
      ],
    ],
    zh: [
      '手写签名',
      '在页面中放置绘制或输入的签名。',
      ['绘制或输入签名。', '将其放到页面中，调整位置与大小。', '核对保存结果。图像签名不等于证书数字签名。'],
    ],
    mode: 'edit',
  },
  {
    id: 'organize',
    category: 'pageTools',
    icon: 'pages',
    en: [
      'Organize pages',
      'Reorder, rotate, insert and remove pages.',
      ['Open the page overview.', 'Select and arrange the pages you need.', 'Review the document before saving.'],
    ],
    zh: ['组织页面', '重排、旋转、插入或删除页面。', ['进入页面总览。', '选择并调整需要的页面。', '核对文档后保存。']],
    mode: 'pages',
  },
  {
    id: 'merge',
    category: 'pageTools',
    icon: 'merge',
    en: [
      'Merge & split',
      'Bring files together. Keep only what you need.',
      [
        'Select PDFs to merge, or choose a page range.',
        'Set the sequence or extraction range.',
        'Export the combined file or selected pages.',
      ],
    ],
    zh: [
      '合并与拆分',
      '组合相关文件，或只保留需要的页面。',
      ['选择要合并的 PDF，或指定页码范围。', '确定顺序或提取范围。', '导出合并文件或所选页面。'],
    ],
    mode: 'pages',
  },
  {
    id: 'export',
    category: 'exportTools',
    icon: 'export',
    en: [
      'Export your work',
      'Save pages as images, or export document text.',
      ['Choose an export format.', 'Set page range and image quality where relevant.', 'Export and review the result.'],
    ],
    zh: [
      '导出文档',
      '将页面导出为图片，或提取文档文字。',
      ['选择导出格式。', '按需设置页码范围与图片质量。', '导出后检查结果。'],
    ],
    mode: 'read',
  },
  {
    id: 'ocr',
    category: 'exportTools',
    icon: 'ocr',
    en: [
      'Recognize scanned text',
      'Make scanned pages searchable with desktop OCR.',
      [
        'Open a scanned PDF in the desktop app.',
        'Choose OCR and select the pages.',
        'Review the recognized text and export. Availability depends on the desktop environment.',
      ],
    ],
    zh: [
      '识别扫描文字',
      '使用桌面 OCR 识别扫描页中的文字。',
      ['在桌面应用中打开扫描 PDF。', '选择 OCR 并指定页面。', '核对识别结果后导出。可用性取决于桌面环境。'],
    ],
    mode: 'read',
  },
  {
    id: 'protect',
    category: 'exportTools',
    icon: 'shield',
    en: [
      'Protect & redact',
      'Manage PDF protection and remove sensitive content.',
      [
        'Choose document protection or redaction.',
        'Set permissions, or mark content to remove.',
        'Save and inspect the output before sharing.',
      ],
    ],
    zh: [
      '保护与涂黑',
      '管理 PDF 保护设置，移除敏感内容。',
      ['选择文档保护或涂黑工具。', '设置权限，或标记需要移除的内容。', '保存并仔细检查结果，再进行分享。'],
    ],
    mode: 'annotate',
  },
  {
    id: 'assistant',
    category: 'reading',
    icon: 'sparkle',
    en: [
      'Document assistant',
      'Ask, find and prepare changes alongside the PDF.',
      [
        'Choose an on-device or custom AI model.',
        'Ask a question about your document.',
        'Verify the source and review any suggested changes.',
      ],
    ],
    zh: [
      '文档助手',
      '在 PDF 旁提问、查找信息和准备修改。',
      ['选择本机或自定义 AI 模型。', '围绕文档提出问题。', '核对来源，检查提出的修改。'],
    ],
    mode: 'ai',
  },
]
function languageContent() {
  return locale === 'zh-CN' ? 'zh' : 'en'
}
function applyLanguage() {
  document.documentElement.lang = locale
  document.title =
    locale === 'zh-CN' ? 'Sail PDF — 更清晰的 PDF 工作方式' : 'Sail PDF — A clearer way to work with PDFs'
  document.querySelector('meta[name="description"]').content =
    locale === 'zh-CN'
      ? 'Sail PDF 是开源的桌面 PDF 工作空间，集阅读、批注、编辑与 AI 助手于一体。日常操作在本机完成，AI 模型由你选择。'
      : 'Sail PDF is an open-source desktop workspace for reading, annotating, editing and understanding PDFs. Local document tools. Your choice of AI.'
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)))
  document.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)))
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)))
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)))
  document.querySelector('[data-language]').innerHTML =
    locale === 'en'
      ? '<strong>EN</strong><span class="lang-divider">/</span> 中'
      : 'EN<span class="lang-divider">/</span><strong>中</strong>'
  document
    .querySelector('[data-language]')
    .setAttribute('aria-label', locale === 'en' ? '切换到中文' : 'Switch to English')
  renderDemo()
  renderTools()
  renderAIExample()
  hydrateIcons()
}
function paperContent() {
  const cn = locale === 'zh-CN',
    notes = state.document === 'notes'
  if (notes)
    return cn
      ? '<p class="paper-kicker">研究笔记 / 01</p><h3>关注细节，<br>形成共识。</h3><p class="paper-description">Project Atlas · 团队访谈摘录与观察记录。</p><div class="paper-rule"><span>2026 年 10 月</span><span>团队内部示例</span></div><section class="paper-section"><h4>01 / 主要观察</h4><p>团队需要在阅读、记录和讨论之间顺畅切换。<mark>让信息始终处于同一上下文中</mark>，可以减少重复查找。</p><p>每次审阅结束后，整理待办事项，并记录下一次复核的时间。</p></section><section class="paper-section"><h4>02 / 待确认事项</h4><p>复核项目范围、交付日期，以及本轮文档中需要调整的内容。</p></section>'
      : '<p class="paper-kicker">RESEARCH NOTES / 01</p><h3>The details<br>make the difference.</h3><p class="paper-description">Project Atlas · Observations from team interviews.</p><div class="paper-rule"><span>OCTOBER 2026</span><span>WORKING NOTES</span></div><section class="paper-section"><h4>01 / WHAT WE OBSERVED</h4><p>The team moves between reading, note-taking and discussion. <mark>Keeping information in context</mark> makes it easier to pick up the thread.</p><p>After every review, capture the open questions and agree on a time to revisit them.</p></section><section class="paper-section"><h4>02 / OPEN QUESTIONS</h4><p>Confirm the project scope, delivery date and the changes required in this revision.</p></section>'
  if (state.page === 2)
    return cn
      ? '<p class="paper-kicker">PROJECT ATLAS / 研究结论</p><h3>清晰的工作，<br>从共同理解开始。</h3><p class="paper-description">研究阶段的观察与优先事项。</p><div class="paper-rule"><span>2026 年 10 月</span><span>研究与方向</span></div><section class="paper-section"><h4>01 / 关键发现</h4><p>专注的工作空间，帮助团队把文档阅读与相关决策集中在一起。</p><p><mark>在修改成为最终结果之前完成核对。</mark>清晰的审阅流程使每个人都理解正在发生的变化。</p></section><div class="paper-callout">下一步：与项目团队共同确认工作方向。</div>'
      : '<p class="paper-kicker">PROJECT ATLAS / FINDINGS</p><h3>Clarity begins<br>with shared context.</h3><p class="paper-description">Observations and priorities from the research phase.</p><div class="paper-rule"><span>OCTOBER 2026</span><span>RESEARCH & DIRECTION</span></div><section class="paper-section"><h4>01 / THE KEY FINDINGS</h4><p>A focused workspace keeps document reading and related decisions together.</p><p><mark>Review changes before they become final.</mark> A clear process helps everyone understand what is changing, and why.</p></section><div class="paper-callout">Next: validate the direction with the project team.</div>'
  if (state.page === 3)
    return cn
      ? '<p class="paper-kicker">PROJECT ATLAS / 后续计划</p><h3>方向明确，<br>行动有序。</h3><p class="paper-description">从研究结果到最终交付。</p><div class="paper-rule"><span>2026 年 10 月</span><span>后续计划</span></div><section class="paper-section"><h4>01 / 团队审阅</h4><p class="edit-target">团队应该尽快完成审阅。</p><p>确认项目范围、复核文档修改，并约定交付日期。</p></section><section class="paper-section"><h4>02 / 最终交付</h4><p>完成最终核对后，与团队分享已确认的版本，并保留原始文件。</p></section>'
      : '<p class="paper-kicker">PROJECT ATLAS / NEXT STEPS</p><h3>From direction<br>to delivery.</h3><p class="paper-description">Turning research findings into a considered handoff.</p><div class="paper-rule"><span>OCTOBER 2026</span><span>NEXT STEPS</span></div><section class="paper-section"><h4>01 / THE TEAM REVIEW</h4><p class="edit-target">The team should review it soon.</p><p>Confirm the project scope, review the document changes, and agree on the delivery date.</p></section><section class="paper-section"><h4>02 / THE FINAL HANDOFF</h4><p>After the final review, share the approved version with the team and keep the original files.</p></section>'
  return cn
    ? '<p class="paper-kicker">PROJECT ATLAS / 项目简报</p><h3>为专注工作，<br>留出空间。</h3><p class="paper-description">一份关于更清晰的文档流程、更有序的团队协作的研究与设计简报。</p><div class="paper-rule"><span>2026 年 10 月</span><span>研究与方向</span></div><section class="paper-section"><h4>01 / 工作目标</h4><p class="edit-target">好的工作空间，让重要的信息始终清晰可见。<mark>把注意力留给文档本身</mark>，而不是在不同工具之间反复切换。</p><p>本项目关注日常的阅读、记录与审阅流程，帮助团队在同一个上下文中推进工作。</p></section><section class="paper-section"><h4>02 / 基本原则</h4><p>让修改可检查，让决定有依据，让每一份文档都能清楚地表达原意。</p></section>'
    : '<p class="paper-kicker">PROJECT ATLAS / PROJECT BRIEF</p><h3>Make room<br>for focused work.</h3><p class="paper-description">A research and design brief on clearer documents, considered tools and a more focused way of working.</p><div class="paper-rule"><span>OCTOBER 2026</span><span>RESEARCH & DIRECTION</span></div><section class="paper-section"><h4>01 / THE OPPORTUNITY</h4><p class="edit-target">The best workspaces make important information easy to see. <mark>Keep the focus on the document</mark>, rather than moving between disconnected tools.</p><p>This project explores everyday reading, note-taking and review, helping teams move forward with a shared context.</p></section><section class="paper-section"><h4>02 / THE PRINCIPLE</h4><p>Make changes visible, decisions considered, and every document a clearer expression of its original intent.</p></section>'
}
function renderDemo() {
  const app = document.querySelector('.demo-app')
  app.className = `demo-app mode-${state.mode}`
  document.querySelector('#paper-content').innerHTML = paperContent()
  document.querySelector('#paper-number').textContent = `0${state.page} / 03`
  document.querySelectorAll('[data-demo]').forEach((button) => {
    const active = button.dataset.demo === state.mode
    button.classList.toggle('active', active)
    if (button.getAttribute('role') === 'tab') {
      button.setAttribute('aria-selected', String(active))
      button.tabIndex = active ? 0 : -1
    } else button.setAttribute('aria-pressed', String(active))
  })
  document.querySelectorAll('[data-document]').forEach((b) => {
    const selected = b.dataset.document === state.document
    b.classList.toggle('active', selected)
    b.setAttribute('aria-selected', String(selected))
    b.tabIndex = selected ? 0 : -1
  })
  document.querySelectorAll('[data-page]').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.page) === state.page)
    b.setAttribute('aria-pressed', String(Number(b.dataset.page) === state.page))
  })
  document.querySelector('.toolbar-document>span').textContent =
    state.document === 'atlas' ? 'Project Atlas.pdf' : t('notesFile')
  document.querySelector('.mode-description').textContent = t(state.mode + 'Description')
  const context = document.querySelector('.demo-contextbar')
  context.hidden = !['edit', 'annotate', 'pages'].includes(state.mode)
  context.innerHTML =
    icon(state.mode === 'pages' ? 'pages' : state.mode === 'edit' ? 'edit' : 'highlight') +
    t(state.mode === 'edit' ? 'editHint' : state.mode === 'pages' ? 'pageHint' : 'annotationHint')
  if (state.mode === 'annotate') {
    const section = document.querySelector('.paper-section')
    section.insertAdjacentHTML(
      'beforeend',
      `<div class="annotation-bubble"><b>${t('notesBy')}</b>${t('noteText')}</div>`,
    )
  }
  document.querySelector('.demo-paper').hidden = state.mode === 'pages'
  const organizer = document.querySelector('.page-organizer')
  organizer.hidden = state.mode !== 'pages'
  if (state.mode === 'pages')
    organizer.innerHTML =
      state.order
        .map(
          (page, index) =>
            `<div class="organizer-card ${index === 0 ? 'selected' : ''}"><div class="organizer-paper" ${index === 0 ? `style="transform:rotate(${state.rotation}deg)"` : ''}><h4>${['Project<br>Atlas', 'Research<br>findings', 'The next<br>steps'][page - 1]}</h4><b></b><b></b><b></b><b></b><b></b></div><span>${page}</span></div>`,
        )
        .join('') +
      `<div class="organizer-controls"><button data-organize="rotate">${icon('rotate')}${t('rotate')}</button><button data-organize="reorder">${icon('layers')}${t('reorder')}</button></div>`
  const panel = document.querySelector('.demo-ai-panel')
  panel.hidden = state.mode !== 'ai'
  panel.innerHTML = `<div class="demo-ai-heading">${icon('sparkle')}Sail ${t('assistantShort')}</div><div class="demo-ai-user">${t('summaryPrompt')}</div><div class="demo-ai-answer"><b>${t('summaryIntro')}</b><ol><li>${t('summaryOneText')} <span class="demo-ai-citation">p. 1</span></li><li>${t('summaryTwoText')} <span class="demo-ai-citation">p. 2</span></li><li>${t('summaryThreeText')} <span class="demo-ai-citation">p. 3</span></li></ol></div><div class="demo-ai-input">${t('aiPlaceholder')}</div>`
}
function setMode(mode) {
  if (mode === 'tools') {
    document.querySelector('#tools').scrollIntoView({ behavior: 'smooth' })
    document.querySelector('.tool-search input').focus({ preventScroll: true })
    return
  }
  state.mode = mode
  renderDemo()
}
function renderTools() {
  document.querySelector('.tool-categories').innerHTML = ['all', 'reading', 'editing', 'pageTools', 'exportTools']
    .map(
      (c) =>
        `<button role="tab" aria-selected="${c === state.category}" tabindex="${c === state.category ? 0 : -1}" class="${c === state.category ? 'active' : ''}" data-category="${c}">${t(c)}</button>`,
    )
    .join('')
  const query = state.search.trim().toLowerCase(),
    tools = toolData.filter(
      (tool) =>
        (state.category === 'all' || state.category === tool.category) &&
        (!query || [...tool.en.slice(0, 2), ...tool.zh.slice(0, 2)].join(' ').toLowerCase().includes(query)),
    )
  document.querySelector('.tool-grid').innerHTML = tools
    .map(
      (tool) =>
        `<button class="tool-card" data-tool="${tool.id}"><span class="tool-card-icon">${icon(tool.icon)}</span><span class="tool-card-arrow">${icon('arrow-up-right')}</span><h3>${tool[languageContent()][0]}</h3><p>${tool[languageContent()][1]}</p></button>`,
    )
    .join('')
  document.querySelector('.tool-empty').hidden = tools.length > 0
}
function renderAIExample() {
  const kind = state.aiExample
  document.querySelectorAll('[data-ai-example]').forEach((b) => {
    const active = b.dataset.aiExample === kind
    b.classList.toggle('active', active)
    b.setAttribute('aria-selected', String(active))
    b.tabIndex = active ? 0 : -1
  })
  let answer =
    kind === 'summary'
      ? `<strong>${t('summaryIntro')}</strong><ol>${['One', 'Two', 'Three'].map((n, i) => `<li><b>${t('summary' + n)}</b>${t('summary' + n + 'Text')} <span class="citation">p. ${i + 1}</span></li>`).join('')}</ol>`
      : kind === 'find'
        ? `<strong>${t('findAnswer')}</strong><p style="margin-top:17px">${t('findSource')} <span class="citation">p. 3</span></p>`
        : `<strong>${t('reviseIntro')}</strong><div class="proposed-edit"><del>${t('reviseOld')}</del><ins>${t('reviseNew')}</ins><p class="proposed-edit-note">${t('reviseNote')}</p></div>`
  document.querySelector('.ai-example-body').innerHTML =
    `<div class="example-question">${t(kind === 'summary' ? 'summaryPrompt' : kind === 'find' ? 'findPrompt' : 'revisePrompt')}</div><div class="example-answer">${answer}</div>`
}
let lastFocus = null
function showDialog(dialog) {
  lastFocus = document.activeElement
  dialog.showModal()
  document.body.classList.add('dialog-open')
}
function showTool(id) {
  const tool = toolData.find((item) => item.id === id)
  if (!tool) return
  state.activeTool = id
  const [name, description, steps] = tool[languageContent()]
  document.querySelector('#tool-detail').innerHTML =
    `<div class="dialog-icon">${icon(tool.icon)}</div><div class="eyebrow">${t('toolDetailLabel')}</div><h2 id="tool-dialog-title">${name}</h2><p>${description}</p><ol class="tool-detail-steps">${steps.map((step, index) => `<li><span>${index + 1}</span>${step}</li>`).join('')}</ol><p style="font-size:9px;margin-bottom:20px">${t('sourceDetails')}</p><button class="button button-ink button-full" data-tool-preview="${tool.mode}">${t('tryPreview')}${icon('arrow-up-right')}</button>`
  showDialog(document.querySelector('#tool-dialog'))
}
async function showLegal(kind) {
  const dialog = document.querySelector('#legal-dialog')
  dialog.querySelector('h2').textContent = t(kind + 'TitleDialog')
  dialog.querySelector('pre').textContent = t('legalLoading')
  showDialog(dialog)
  const file = kind === 'license' ? 'license.txt' : `${kind}${locale === 'en' ? '.en' : ''}.txt`
  try {
    const response = await fetch(`assets/${file}`)
    if (!response.ok) throw Error()
    dialog.querySelector('pre').textContent = await response.text()
  } catch {
    dialog.querySelector('pre').textContent = t('legalError')
  }
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('button,a')
  if (!target) return
  if (target.hasAttribute('data-language')) {
    locale = locale === 'en' ? 'zh-CN' : 'en'
    try {
      localStorage.setItem('sail.site.language', locale)
    } catch {}
    applyLanguage()
  }
  if (target.hasAttribute('data-download')) showDialog(document.querySelector('#download-dialog'))
  if (target.hasAttribute('data-demo')) setMode(target.dataset.demo)
  if (target.hasAttribute('data-document')) {
    state.document = target.dataset.document
    state.page = 1
    renderDemo()
  }
  if (target.hasAttribute('data-page')) {
    state.page = Number(target.dataset.page)
    renderDemo()
  }
  if (target.hasAttribute('data-category')) {
    state.category = target.dataset.category
    renderTools()
    document.querySelector(`[data-category="${state.category}"]`).focus({ preventScroll: true })
  }
  if (target.hasAttribute('data-tool')) showTool(target.dataset.tool)
  if (target.hasAttribute('data-ai-example')) {
    state.aiExample = target.dataset.aiExample
    renderAIExample()
  }
  if (target.hasAttribute('data-close-dialog')) target.closest('dialog').close()
  if (target.hasAttribute('data-tool-preview')) {
    target.closest('dialog').close()
    setMode(target.dataset.toolPreview)
    document.querySelector('#workspace').scrollIntoView({ behavior: 'smooth' })
  }
  if (target.hasAttribute('data-organize')) {
    if (target.dataset.organize === 'rotate') state.rotation = (state.rotation + 90) % 360
    else state.order = [state.order[1], state.order[0], state.order[2]]
    renderDemo()
  }
  if (target.hasAttribute('data-legal')) void showLegal(target.dataset.legal)
  if (target.matches('.mobile-menu-toggle')) {
    const menu = document.querySelector('#mobile-nav')
    menu.hidden = !menu.hidden
    target.setAttribute('aria-expanded', String(!menu.hidden))
  }
  if (target.closest('#mobile-nav')) {
    document.querySelector('#mobile-nav').hidden = true
    document.querySelector('.mobile-menu-toggle').setAttribute('aria-expanded', 'false')
  }
})
document.querySelector('.tool-search input').addEventListener('input', (event) => {
  state.search = event.target.value
  renderTools()
})
document.querySelectorAll('dialog').forEach((dialog) => {
  dialog.addEventListener('close', () => {
    if (!document.querySelector('dialog[open]')) document.body.classList.remove('dialog-open')
    lastFocus?.focus({ preventScroll: true })
  })
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close()
  })
})
document.addEventListener('keydown', (event) => {
  const textEntry = event.target.matches('input,textarea,[contenteditable="true"]')
  if (
    !textEntry &&
    !document.querySelector('dialog[open]') &&
    (event.key === '/' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k'))
  ) {
    event.preventDefault()
    setMode('tools')
  }
  if (event.key === 'Escape' && !document.querySelector('dialog[open]')) {
    document.querySelector('#mobile-nav').hidden = true
    document.querySelector('.mobile-menu-toggle').setAttribute('aria-expanded', 'false')
  }
  const group = event.target.closest('[role="tablist"]')
  if (!group || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const buttons = [...group.querySelectorAll('[role="tab"]')],
    current = buttons.indexOf(event.target)
  if (current < 0) return
  event.preventDefault()
  let next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length
  buttons[next].click()
  const active = group.querySelector('[aria-selected="true"]')
  active?.focus({ preventScroll: true })
})
applyLanguage()
