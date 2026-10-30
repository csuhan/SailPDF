import { tr, onLocaleChange } from '../i18n/locale'
import { useEffect, useState } from 'react'
import { FEEDBACK_URL, PROJECT_URL, RELEASES_URL, openExternalLink } from '../utils/externalLinks'
import { feedbackReport } from '../utils/feedback'
import { notify, saveBlobFile } from '../utils/save'
import { useLocale } from '../i18n/react'
function createDocuments() {
  return [
    ['help', tr('快速上手与已知限制'), 'HELP.txt'],
    ['privacy', tr('隐私说明'), 'PRIVACY.txt'],
    ['terms', tr('使用说明与测试版条款'), 'TERMS.txt'],
    ['project-license', tr('Sail PDF 开源许可（Apache-2.0）'), 'PROJECT_LICENSE.txt'],
    ['third-party', tr('第三方软件与字体许可'), 'THIRD_PARTY_NOTICES.txt'],
    ['models', tr('本机模型许可'), 'MODEL_NOTICES.txt'],
    ['chromium', tr('Chromium 许可'), 'CHROMIUM_NOTICES.txt'],
  ] as const
}

let documents = createDocuments()
export function HelpSettings() {
  const locale = useLocale()
  const [selected, setSelected] = useState('help'),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [description, setDescription] = useState(''),
    [busy, setBusy] = useState(false)
  const current = documents.find(([id]) => id === selected)!
  useEffect(() => {
    let active = true
    setText('')
    setError('')
    const file =
      locale === 'en' && ['help', 'privacy', 'terms', 'models'].includes(selected)
        ? current[2].replace('.txt', '.en.txt')
        : current[2]
    void fetch(`${import.meta.env.BASE_URL ?? './'}legal/${file}`)
      .then((response) => {
        if (!response.ok) throw new Error()
        return response.text()
      })
      .then(
        (value) => {
          if (active) setText(value)
        },
        () => {
          if (active) setError(tr('说明文件暂时无法读取，请从项目仓库查看。'))
        },
      )
    return () => {
      active = false
    }
  }, [selected, locale])
  const open = async (url: string) => {
    if (!(await openExternalLink(url))) notify(tr('无法打开链接，请在浏览器中访问项目仓库。'), 'error')
  }
  const exportReport = async () => {
    setBusy(true)
    try {
      await saveBlobFile(
        'Sail-PDF-feedback.txt',
        new TextEncoder().encode(feedbackReport(description)),
        'text/plain',
        tr('反馈诊断'),
        ['txt'],
      )
    } catch {
      notify(tr('导出未完成，请重试。'), 'error')
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <h3>{tr('帮助与反馈')}</h3>
      <p className="settings-intro">
        {tr('查看本机说明，获取新版本，或向项目反馈问题。应用不会自动提交报告或上传文档。')}
      </p>
      <div className="help-links">
        <button className="btn small" onClick={() => void open(PROJECT_URL)}>
          {tr('项目仓库')}
        </button>
        <button className="btn small" onClick={() => void open(RELEASES_URL)}>
          {tr('版本与更新')}
        </button>
        <button className="btn small" onClick={() => void open(FEEDBACK_URL)}>
          {tr('在 GitHub 反馈')}
        </button>
      </div>
      <label className="form-field">
        <span className="form-label">{tr('查看说明')}</span>
        <select
          className="form-input"
          aria-label={tr('查看帮助与许可')}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
        >
          {documents.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {error ? (
        <p role="alert" className="settings-error">
          {error}
        </p>
      ) : (
        <article className="help-document" aria-label={current[1]} tabIndex={0}>
          <pre>{text || tr('正在读取…')}</pre>
        </article>
      )}
      <h4>{tr('准备问题反馈')}</h4>
      <p className="settings-intro">
        {tr('GitHub Issues 通常公开可见。请只描述操作步骤、实际和预期结果，不要填写文档内容、个人资料或密钥。')}
      </p>
      <textarea
        className="form-input feedback-description"
        aria-label={tr('问题描述与复现步骤')}
        rows={5}
        maxLength={6000}
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder={tr('例如：打开一份测试 PDF，添加便签后切换标签；预期…，实际…')}
      />
      <div className="help-links">
        <button
          className="btn small"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(feedbackReport(description))
              notify(tr('反馈内容已复制，请核对后自行提交。'))
            } catch {
              notify(tr('无法复制，请使用导出诊断。'), 'error')
            }
          }}
        >
          {tr('复制反馈内容')}
        </button>
        <button className="btn small" disabled={busy} onClick={() => void exportReport()}>
          {busy ? tr('正在导出…') : tr('导出诊断文件')}
        </button>
      </div>
      <p className="form-note">
        {tr(
          '自动诊断只包含版本、平台、语言与功能接口状态，不含文件名、路径、文档正文、对话、日志或 API Key。常见密钥与本机路径会从问题描述中遮蔽，分享前仍请自行核对。',
        )}
      </p>
    </>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  documents = createDocuments()
})
