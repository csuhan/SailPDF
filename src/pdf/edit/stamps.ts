import { tr, onLocaleChange } from '../../i18n/locale'
/**
 * Rubber stamps (Acrobat: 图章 → 动态 / 标准商业). Rendered to a PNG with a
 * transparent background and placed as an image op, so they can be moved,
 * resized and deleted like any other placed image.
 */
export interface StampDef {
  id: string
  label: string
  color: string
  /** add date + time below the label (dynamic stamps) */
  dated?: boolean
}

function createStamps(): StampDef[] {
  return [
    { id: 'approved', label: tr('已批准'), color: '#2e7d32', dated: true },
    { id: 'reviewed', label: tr('已审阅'), color: '#1565c0', dated: true },
    { id: 'received', label: tr('已收到'), color: '#1565c0', dated: true },
    { id: 'confidential', label: tr('机密'), color: '#c62828' },
    { id: 'draft', label: tr('草稿'), color: '#6a1b9a' },
    { id: 'final', label: tr('最终版'), color: '#2e7d32' },
    { id: 'void', label: tr('作废'), color: '#c62828' },
    { id: 'not-approved', label: tr('未批准'), color: '#c62828', dated: true },
  ]
}

export let STAMPS: StampDef[] = createStamps()

/** stamp PNG + its natural size in points */
export async function renderStamp(def: StampDef, author = ''): Promise<{ png: Uint8Array; wPt: number; hPt: number }> {
  const scale = 4 // px per pt: crisp when printed
  const font = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif'
  const now = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const sub = def.dated
    ? `${author ? author + ' · ' : ''}${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`
    : ''
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = `700 ${22 * scale}px ${font}`
  const labelW = measure.measureText(def.label).width / scale
  measure.font = `500 ${8 * scale}px ${font}`
  const subW = sub ? measure.measureText(sub).width / scale : 0
  const wPt = Math.ceil(Math.max(labelW + 28, subW + 20, 84))
  const hPt = sub ? 50 : 38
  const c = document.createElement('canvas')
  c.width = wPt * scale
  c.height = hPt * scale
  const ctx = c.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.strokeStyle = def.color
  ctx.fillStyle = def.color
  ctx.globalAlpha = 0.9
  // double border, slightly rounded
  const r = 5
  const box = (i: number, lw: number) => {
    ctx.lineWidth = lw
    ctx.beginPath()
    ctx.roundRect(i, i, wPt - 2 * i, hPt - 2 * i, Math.max(1, r - i / 2))
    ctx.stroke()
  }
  box(1.5, 2)
  box(4.5, 0.8)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 22px ${font}`
  ctx.fillText(def.label, wPt / 2, sub ? 20 : hPt / 2 + 1)
  if (sub) {
    ctx.font = `500 8px ${font}`
    ctx.fillText(sub, wPt / 2, 38)
  }
  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error('stamp render failed'))), 'image/png'),
  )
  return { png: new Uint8Array(await blob.arrayBuffer()), wPt, hPt }
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  STAMPS = createStamps()
})
