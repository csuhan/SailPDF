import { tr } from '../i18n/locale'
/**
 * "创建 PDF": images → PDF (one page each), reorderable before creating.
 * The result opens as a new, unsaved document.
 */
import { useEffect, useState } from 'react'
import { pdfFromImages, type PageFit } from '../pdf/edit/createFromImages'
import { openDocument } from '../utils/docSession'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { notify } from '../utils/save'
import { IconArrowLeft, IconArrowRight, IconClose, IconFileImage, IconTrash } from './icons'

function pickImages(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.multiple = true
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

export function CreatePdfDialog({ onClose, initial }: { onClose: () => void; initial?: File[] }) {
  const [files, setFiles] = useState<File[]>(initial ?? [])
  const [urls, setUrls] = useState<string[]>([])
  const [fit, setFit] = useState<PageFit>('a4')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f))
    setUrls(u)
    return () => u.forEach((x) => URL.revokeObjectURL(x))
  }, [files])

  const add = async () => {
    const more = await pickImages()
    if (more.length) setFiles((f) => [...f, ...more])
  }
  const move = (i: number, d: number) =>
    setFiles((f) => {
      const j = i + d
      if (j < 0 || j >= f.length) return f
      const n = f.slice()
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })

  const create = async () => {
    setBusy(tr('正在创建…'))
    try {
      const bytes = await pdfFromImages(files, fit, (d, t) => setBusy(tr('正在添加图片 {0}/{1}', d, t)))
      const name = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') + '.pdf' : tr('图片合集.pdf')
      if (await openDocument({ data: bytes, name, path: null })) {
        // a brand-new document: unsaved until the user saves it
        useEditStore.getState().setFormDirty(true)
        notify(tr('已创建 {0} 页的 PDF', files.length))
        onClose()
      }
    } catch (e) {
      notify(tr('创建失败：{0}', e instanceof Error ? e.message : String(e)), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div
        className="modal form-modal create-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('创建 PDF')}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            onClose()
          }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const imgs = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
          if (imgs.length) setFiles((f) => [...f, ...imgs])
        }}
      >
        <div className="form-modal-head">
          <h2>{tr('从图片创建 PDF')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose} disabled={!!busy}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">
          <div className="img-grid">
            {files.map((f, i) => (
              <figure key={`${f.name}-${i}`} className="img-tile">
                <img src={urls[i]} alt={f.name} />
                <figcaption>
                  <span className="img-no">{i + 1}</span>
                  <button
                    className="tb-btn"
                    title={tr('前移')}
                    aria-label={tr('前移')}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <IconArrowLeft size={13} />
                  </button>
                  <button
                    className="tb-btn"
                    title={tr('后移')}
                    aria-label={tr('后移')}
                    disabled={i === files.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <IconArrowRight size={13} />
                  </button>
                  <button
                    className="tb-btn"
                    title={tr('移除')}
                    aria-label={tr('移除')}
                    onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}
                  >
                    <IconTrash size={13} />
                  </button>
                </figcaption>
              </figure>
            ))}
            <button className="img-add" onClick={() => void add()}>
              <IconFileImage size={22} />
              <span>{tr('添加图片')}</span>
            </button>
          </div>
          <div className="form-row">
            <label className="form-field">
              <span className="form-label">{tr('页面大小')}</span>
              <div className="seg">
                {(
                  [
                    ['a4', 'A4'],
                    ['letter', 'Letter'],
                    ['image', tr('与图片一致')],
                  ] as [PageFit, string][]
                ).map(([k, l]) => (
                  <button key={k} type="button" className={fit === k ? 'active' : ''} onClick={() => setFit(k)}>
                    {l}
                  </button>
                ))}
              </div>
            </label>
          </div>
          {busy && <p className="form-note">{busy}</p>}
        </div>
        <div className="modal-actions">
          <span className="form-note">
            {files.length}
            {tr(' 张图片，每张一页')}
          </span>
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose} disabled={!!busy}>
            {tr('取消')}
          </button>
          <button className="btn primary" disabled={!files.length || !!busy} onClick={() => void create()}>
            {tr('创建')}
          </button>
        </div>
      </div>
    </div>
  )
}

export { pickImages }

/** mounted once by the app; opened through useToolStore.createPdfOpen */
export function CreatePdfHost() {
  const open = useToolStore((s) => s.createPdfOpen)
  if (!open) return null
  return <CreatePdfDialog onClose={() => useToolStore.getState().setCreatePdfOpen(false)} />
}
