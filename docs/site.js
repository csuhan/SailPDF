import { en as dynamicEnglish, zh, toolData } from './site-content.js'

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
const en = { ...initial, ...dynamicEnglish }
const locale = document.documentElement.lang === 'zh-CN' ? 'zh-CN' : 'en'
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
function languageContent() {
  return locale === 'zh-CN' ? 'zh' : 'en'
}
function applyLanguage() {
  document.querySelectorAll('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n)))
  document.querySelectorAll('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml)))
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)))
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => (el.placeholder = t(el.dataset.i18nPlaceholder)))
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
    const response = await fetch(new URL(`assets/${file}`, import.meta.url))
    if (!response.ok) throw Error()
    dialog.querySelector('pre').textContent = await response.text()
  } catch {
    dialog.querySelector('pre').textContent = t('legalError')
  }
}
document.addEventListener('click', (event) => {
  const target = event.target.closest('button,a')
  if (!target) return
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
