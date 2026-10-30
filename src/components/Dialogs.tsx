import { tr } from '../i18n/locale'
/**
 * App-level dialogs and notifications:
 * - unsaved changes prompt (save / don't save / cancel)
 * - transient toasts (save results, errors)
 */
import { useEffect, useRef, useState } from 'react'
import { setUnsavedAsker, type UnsavedChoice } from '../utils/docSession'
import { setToast } from '../utils/save'
import { setPasswordAsker } from '../utils/secureOpen'
import { setRestoreAsker, type RestoreOffer } from '../utils/autosave'
import { IconCheck, IconClose, IconLock } from './icons'

interface Ask {
  fileName: string
  opCount: number
  resolve: (c: UnsavedChoice) => void
}

export function UnsavedDialog() {
  const [ask, setAsk] = useState<Ask | null>(null)
  const saveRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setUnsavedAsker(
      (fileName, opCount) => new Promise<UnsavedChoice>((resolve) => setAsk({ fileName, opCount, resolve })),
    )
    return () => setUnsavedAsker(null)
  }, [])

  useEffect(() => {
    if (!ask) return
    saveRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        done('cancel')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask])

  const done = (c: UnsavedChoice) => {
    ask?.resolve(c)
    setAsk(null)
  }

  if (!ask) return null
  return (
    <div className="modal-backdrop" role="presentation">
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="unsaved-title"
        aria-describedby="unsaved-desc"
      >
        <h2 id="unsaved-title">
          {tr('要保存对“')}
          {ask.fileName.replace(/\.pdf$/i, '')}
          {tr('”的修改吗？')}
        </h2>
        <p id="unsaved-desc">
          {ask.opCount > 0 ? tr('共 {0} 处修改尚未保存。', ask.opCount) : tr('文档有尚未保存的修改。')}
          {tr('如果不保存，这些修改将会丢失。')}
        </p>
        <div className="modal-actions">
          <button className="btn" onClick={() => done('discard')}>
            {tr('不保存')}
          </button>
          <span className="modal-spacer" />
          <button className="btn" onClick={() => done('cancel')}>
            {tr('取消')}
          </button>
          <button className="btn primary" ref={saveRef} onClick={() => done('save')}>
            {tr('保存')}
          </button>
        </div>
      </div>
    </div>
  )
}

interface ToastItem {
  id: number
  msg: string
  kind: 'ok' | 'error'
}

interface PwAsk {
  fileName: string
  retry: boolean
  resolve: (pw: string | null) => void
}

/** "this document is password protected" prompt */
export function PasswordDialog() {
  const [ask, setAsk] = useState<PwAsk | null>(null)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setPasswordAsker(
      (fileName, retry) =>
        new Promise<string | null>((resolve) => {
          setValue('')
          setAsk({ fileName, retry, resolve })
        }),
    )
    return () => setPasswordAsker(null)
  }, [])

  useEffect(() => {
    if (ask) setTimeout(() => inputRef.current?.focus(), 0)
  }, [ask])

  const done = (pw: string | null) => {
    ask?.resolve(pw)
    setAsk(null)
  }

  if (!ask) return null
  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal pw-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-title"
        onSubmit={(e) => {
          e.preventDefault()
          done(value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            done(null)
          }
        }}
      >
        <div className="pw-head">
          <span className="pw-icon">
            <IconLock size={20} />
          </span>
          <div>
            <h2 id="pw-title">{tr('需要密码')}</h2>
            <p className="pw-file">
              “{ask.fileName}
              {tr('”受密码保护，请输入文档打开口令。')}
            </p>
          </div>
        </div>
        <input
          ref={inputRef}
          className={`form-input ${ask.retry ? 'invalid' : ''}`}
          type="password"
          autoComplete="off"
          aria-label={tr('密码')}
          placeholder={tr('密码')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        {ask.retry && <p className="pw-error">{tr('密码不正确，请重试。')}</p>}
        <div className="modal-actions">
          <span className="modal-spacer" />
          <button type="button" className="btn" onClick={() => done(null)}>
            {tr('取消')}
          </button>
          <button type="submit" className="btn primary" disabled={!value}>
            {tr('打开')}
          </button>
        </div>
      </form>
    </div>
  )
}

let toastSeq = 0

export function Toasts() {
  const [items, setItems] = useState<ToastItem[]>([])
  useEffect(() => {
    setToast((msg, kind = 'ok') => {
      const id = ++toastSeq
      setItems((l) => [...l.slice(-2), { id, msg, kind }])
      window.setTimeout(() => setItems((l) => l.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 2600)
    })
    return () => setToast(null)
  }, [])
  if (items.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'ok' ? <IconCheck size={15} /> : <IconClose size={15} />}
          <span>{t.msg}</span>
        </div>
      ))}
    </div>
  )
}

/** "恢复未保存的修改" banner after reopening a file with an autosaved draft */
export function RestoreBanner() {
  const [offer, setOffer] = useState<RestoreOffer | null>(null)
  useEffect(() => {
    setRestoreAsker(setOffer)
    return () => setRestoreAsker(null)
  }, [])
  if (!offer) return null
  return (
    <div className="restore-banner" role="alert">
      <span>
        {tr('发现 ')}
        {offer.when}
        {tr(' 自动保存的 ')}
        {offer.count}
        {tr(' 处未保存修改。')}
      </span>
      <button
        className="btn small"
        onClick={() => {
          offer.discard()
          setOffer(null)
        }}
      >
        {tr('丢弃')}
      </button>
      <button
        className="btn small primary-solid"
        onClick={() => {
          offer.restore()
          setOffer(null)
        }}
      >
        {tr('恢复')}
      </button>
    </div>
  )
}
