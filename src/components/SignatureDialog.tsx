import { tr } from '../i18n/locale'
/**
 * Signature (Acrobat "填写和签名"): draw with mouse/trackpad or type a name.
 * The result is a transparent PNG kept for the session (and in localStorage)
 * and placed on the page as an image object (move / resize with 选择).
 */
import { useEffect, useRef, useState } from 'react'
import { IconClose } from './icons'

const STORE_KEY = 'pdfpro.signature'

export function savedSignature(): string | null {
  try {
    return localStorage.getItem(STORE_KEY)
  } catch {
    return null
  }
}

function trimCanvas(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const ctx = src.getContext('2d')!
  const { width: w, height: h } = src
  const data = ctx.getImageData(0, 0, w, h).data
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  const pad = 6
  const out = document.createElement('canvas')
  out.width = x1 - x0 + 1 + pad * 2
  out.height = y1 - y0 + 1 + pad * 2
  out.getContext('2d')!.drawImage(src, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height)
  return out
}

export function SignatureDialog({ onClose, onDone }: { onClose: () => void; onDone: (pngDataUrl: string) => void }) {
  const [tab, setTab] = useState<'draw' | 'type'>('draw')
  const [name, setName] = useState('')
  const [color, setColor] = useState('#1a237e')
  const [empty, setEmpty] = useState(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = 2
    c.width = c.clientWidth * dpr
    c.height = c.clientHeight * dpr
    const ctx = c.getContext('2d')!
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }, [tab])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const pos = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const clear = () => {
    const c = canvasRef.current
    if (!c) return
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height)
    setEmpty(true)
  }

  const finish = () => {
    let src: HTMLCanvasElement | null = null
    if (tab === 'draw') {
      src = canvasRef.current
    } else {
      if (!name.trim()) return
      src = document.createElement('canvas')
      src.width = 1200
      src.height = 300
      const ctx = src.getContext('2d')!
      ctx.fillStyle = color
      ctx.font = 'italic 140px "Snell Roundhand", "Apple Chancery", "Brush Script MT", "Kaiti SC", "STKaiti", cursive'
      ctx.textBaseline = 'middle'
      ctx.fillText(name.trim(), 20, 150)
    }
    const trimmed = src && trimCanvas(src)
    if (!trimmed) return
    const url = trimmed.toDataURL('image/png')
    try {
      localStorage.setItem(STORE_KEY, url)
    } catch {
      /* storage full */
    }
    onDone(url)
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal form-modal sig-modal" role="dialog" aria-modal="true" aria-label={tr('创建签名')}>
        <div className="form-modal-head">
          <h2>{tr('创建签名')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="seg sig-tabs" role="tablist">
          <button
            className={tab === 'draw' ? 'active' : ''}
            onClick={() => setTab('draw')}
            role="tab"
            aria-selected={tab === 'draw'}
          >
            {tr('手写')}
          </button>
          <button
            className={tab === 'type' ? 'active' : ''}
            onClick={() => setTab('type')}
            role="tab"
            aria-selected={tab === 'type'}
          >
            {tr('输入')}
          </button>
        </div>
        {tab === 'draw' ? (
          <canvas
            ref={canvasRef}
            className="sig-pad"
            onPointerDown={(e) => {
              ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
              drawing.current = pos(e)
            }}
            onPointerMove={(e) => {
              const last = drawing.current
              if (!last) return
              const p = pos(e)
              const ctx = canvasRef.current!.getContext('2d')!
              ctx.strokeStyle = color
              ctx.lineWidth = 2.6
              ctx.beginPath()
              ctx.moveTo(last.x, last.y)
              ctx.lineTo(p.x, p.y)
              ctx.stroke()
              drawing.current = p
              setEmpty(false)
            }}
            onPointerUp={() => (drawing.current = null)}
          />
        ) : (
          <input
            className="form-input sig-type"
            placeholder={tr('输入姓名')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ color }}
            autoFocus
          />
        )}
        <div className="sig-tools">
          <div className="mt-swatches">
            {['#1a237e', '#111111', '#0d47a1', '#b71c1c'].map((c) => (
              <button
                key={c}
                className={`mt-swatch ${color === c ? 'active' : ''}`}
                style={{ background: c }}
                aria-label={c}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          {tab === 'draw' && (
            <button className="btn small" onClick={clear} disabled={empty}>
              {tr('清除')}
            </button>
          )}
        </div>
        <div className="modal-actions">
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('取消')}
          </button>
          <button className="btn primary" onClick={finish} disabled={tab === 'draw' ? empty : !name.trim()}>
            {tr('放置签名')}
          </button>
        </div>
      </div>
    </div>
  )
}
