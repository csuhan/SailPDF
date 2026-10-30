import { tr } from '../i18n/locale'
import { useLocale } from '../i18n/react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { useToolStore } from '../state/toolStore'
import { computePageMap, pageExtraRotation } from '../pdf/edit/pageOrder'
import { newOpId, type EditOp } from '../pdf/edit/ops'
import { acquireRenderSlot } from '../pdf/document'
import { currentOutputBytes } from '../utils/output'
import { downloadBytes } from '../pdf/edit/applyOps'
import { validatePdfOutput } from '../pdf/validateOutput'
import { notify } from '../utils/save'
import {
  extractPagesFromBuffer,
  mergePdfBuffers,
  parseRanges,
  rangesEveryN,
  splitPdfBuffer,
} from '../pdf/edit/multiDoc'
import { pickPdfFile } from '../utils/fileOpen'
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconDownload,
  IconFilePlus,
  IconFiles,
  IconPlus,
  IconRotateCCW,
  IconRotateCW,
  IconScissors,
  IconTrash,
} from './icons'

const CSS_UNITS = 96 / 72

export function OrganizePages() {
  const activeTool = useToolStore((s) => s.activeTool)
  if (activeTool !== 'organize') return null
  return <OrganizeDialog />
}

function OrganizeDialog() {
  const pdfDoc = useAppStore((s) => s.pdfDoc)
  const fileBytes = useAppStore((s) => s.fileBytes)
  const fileName = useAppStore((s) => s.fileName)
  const pageSizes = useAppStore((s) => s.pageSizes)
  const ops = useEditStore((s) => s.ops)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [splitMode, setSplitMode] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const dragIdx = useRef<number | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const lastClicked = useRef<number | null>(null)

  const pageMap = useMemo(() => (pdfDoc ? computePageMap(pdfDoc.numPages, ops) : []), [pdfDoc, ops])
  const viewCount = pageMap.length

  const close = useCallback(() => {
    useToolStore.getState().setTool('select')
    useEditStore.getState().setSelectedOp(null)
  }, [])

  const toggle = (idx: number, shift: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (shift && lastClicked.current !== null) {
        const [a, b] = [Math.min(lastClicked.current, idx), Math.max(lastClicked.current, idx)]
        for (let i = a; i <= b; i++) next.add(i)
      } else if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
    lastClicked.current = idx
  }

  const pushReorder = (order: number[]) => {
    useEditStore.getState().pushOp({
      kind: 'page-reorder',
      id: newOpId(),
      page: 0,
      order,
    } as EditOp)
  }

  // ── actions ──────────────────────────────────────────────
  const rotateSelected = (deg: 90 | -90) => {
    const store = useEditStore.getState()
    const indices = selected.size ? Array.from(selected).sort((a, b) => a - b) : pageMap.map((_, i) => i)
    for (const i of indices) {
      store.pushOp({
        kind: 'page-rotate',
        id: newOpId(),
        page: 0,
        pageIndex: i,
        degrees: (((deg % 360) + 360) % 360) as 90 | 180 | 270,
      } as EditOp)
    }
  }

  const deleteSelected = () => {
    if (selected.size === 0 || selected.size >= viewCount) return
    const order = pageMap.filter((_, i) => !selected.has(i))
    pushReorder(order)
    setSelected(new Set())
  }

  const insertBlankAfter = () => {
    const at = selected.size ? Math.max(...selected) + 1 : viewCount
    const ref = pageMap[Math.max(0, at - 1)] ?? 1
    const sizeCss = pageSizes.get(Math.abs(ref)) ?? { width: 612 * CSS_UNITS, height: 792 * CSS_UNITS }
    useEditStore.getState().pushOp({
      kind: 'page-insert-blank',
      id: newOpId(),
      page: 0,
      pageIndex: at,
      width: sizeCss.width / CSS_UNITS,
      height: sizeCss.height / CSS_UNITS,
    } as EditOp)
  }

  const moveSelected = (dir: -1 | 1) => {
    if (selected.size === 0) return
    const order = pageMap.slice()
    const idxs = Array.from(selected).sort((a, b) => (dir === 1 ? b - a : a - b))
    for (const i of idxs) {
      const j = i + dir
      if (j < 0 || j >= order.length || selected.has(j)) continue
      ;[order[i], order[j]] = [order[j], order[i]]
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(i)
        next.add(j)
        return next
      })
    }
    pushReorder(order)
  }

  const onDrop = (targetIdx: number) => {
    const from = dragIdx.current
    dragIdx.current = null
    setDropTarget(null)
    if (from === null || from === targetIdx) return
    const order = pageMap.slice()
    const [moved] = order.splice(from, 1)
    order.splice(targetIdx, 0, moved)
    pushReorder(order)
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(from)
      next.add(targetIdx)
      return next
    })
  }

  const bakedBytes = async (): Promise<Uint8Array> => {
    if (!fileBytes) throw new Error('no document')
    return (await currentOutputBytes()) ?? fileBytes
  }

  const baseName = (fileName ?? 'document').replace(/\.pdf$/i, '')

  const extractSelected = async () => {
    if (selected.size === 0) return
    setBusy(tr('正在提取所选页面…'))
    try {
      const baked = await bakedBytes()
      const idxs = Array.from(selected)
        .sort((a, b) => a - b)
        .map((i) => i + 1)
      const out = await extractPagesFromBuffer(baked, idxs)
      await validatePdfOutput(out, idxs.length)
      downloadBytes(tr('{0}_提取页面.pdf', baseName), out)
    } catch (error) {
      notify(tr('提取失败：{0}', error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      setBusy(null)
    }
  }

  const mergeFiles = async () => {
    const files = await pickPdfFile(true)
    if (!files || !Array.isArray(files) || files.length === 0) return
    setBusy(tr('正在合并文档…'))
    try {
      const baked = await bakedBytes()
      const others = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())))
      const merged = await mergePdfBuffers([baked, ...others])
      // a new document: no path, so ⌘S asks where to save it (never
      // overwrites the original with the merged result)
      if (!(await useAppStore.getState().openFile(merged, `${baseName}_merged.pdf`, null))) return
      useEditStore.setState({ dirty: true })
      close()
    } finally {
      setBusy(null)
    }
  }

  const insertFileAfter = async () => {
    const files = await pickPdfFile(true)
    if (!files || !Array.isArray(files) || files.length === 0) return
    setBusy(tr('正在插入文件…'))
    try {
      const at = selected.size ? Math.max(...selected) + 1 : viewCount
      const baked = await bakedBytes()
      const parts: Uint8Array[] = []
      const head = await extractPagesFromBuffer(baked, seq(at))
      const tail = await extractPagesFromBuffer(baked, seqRange(at + 1, viewCount))
      if (at > 0) parts.push(head)
      const others = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())))
      parts.push(...others)
      if (at < viewCount) parts.push(tail)
      const merged = await mergePdfBuffers(parts)
      // a new document: no path, so ⌘S asks where to save it (never
      // overwrites the original with the merged result)
      if (!(await useAppStore.getState().openFile(merged, `${baseName}_merged.pdf`, null))) return
      useEditStore.setState({ dirty: true })
      close()
    } finally {
      setBusy(null)
    }
  }

  const [splitEveryN, setSplitEveryN] = useState('1')
  const [splitRanges, setSplitRanges] = useState('')
  const [splitError, setSplitError] = useState('')

  const doSplit = async (mode: 'n' | 'ranges') => {
    setSplitError('')
    let ranges
    if (mode === 'n') {
      const n = parseInt(splitEveryN, 10)
      if (!Number.isFinite(n) || n < 1) {
        setSplitError(tr('请输入有效的页数'))
        return
      }
      ranges = rangesEveryN(viewCount, n)
    } else {
      const r = parseRanges(splitRanges, viewCount)
      if (!r) {
        setSplitError(tr('范围格式无效，示例：1-3, 5, 7-{0}', viewCount))
        return
      }
      ranges = r
    }
    setBusy(tr('正在拆分文档…'))
    try {
      const baked = await bakedBytes()
      const outs = await splitPdfBuffer(baked, ranges)
      for (let i = 0; i < outs.length; i++) {
        const r = ranges[i]
        const suffix = outs.length === 1 ? `${r.from}-${r.to}` : tr('第{0}部分_{1}-{2}', i + 1, r.from, r.to)
        await validatePdfOutput(outs[i], r.to - r.from + 1)
        downloadBytes(`${baseName}_${suffix}.pdf`, outs[i])
        await sleep(350 + i * 60)
      }
      setSplitMode(false)
    } catch (error) {
      notify(tr('拆分失败：{0}', error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!pdfDoc) return null

  return (
    <div className="organize-view">
      <div className="organize-dialog">
        <header className="organize-header">
          <h2>{tr('组织页面')}</h2>
          <span className="organize-count">
            {tr('共 ')}
            {viewCount}
            {tr(' 页')}
            {selected.size > 0 ? tr(' · 已选 {0} 页', selected.size) : ''}
          </span>
          <div className="organize-actions">
            <div className="org-group">
              <button onClick={() => rotateSelected(-90)} title={tr('逆时针旋转所选（未选则全部）')}>
                <IconRotateCCW size={15} />
                {tr(' 左旋')}
              </button>
              <button onClick={() => rotateSelected(90)} title={tr('顺时针旋转所选（未选则全部）')}>
                <IconRotateCW size={15} />
                {tr(' 右旋')}
              </button>
              <button onClick={() => moveSelected(-1)} disabled={selected.size === 0} title={tr('把所选页面前移一位')}>
                <IconArrowLeft size={15} />
                {tr(' 前移')}
              </button>
              <button onClick={() => moveSelected(1)} disabled={selected.size === 0} title={tr('把所选页面后移一位')}>
                <IconArrowRight size={15} />
                {tr(' 后移')}
              </button>
            </div>
            <div className="org-group">
              <button onClick={insertBlankAfter} title={tr('在所选页后插入空白页')}>
                <IconPlus size={15} />
                {tr(' 空白页')}
              </button>
              <button onClick={insertFileAfter} title={tr('在所选位置插入另一个 PDF')}>
                <IconFilePlus size={15} />
                {tr(' 插入文件')}
              </button>
              <button onClick={mergeFiles} title={tr('把其他 PDF 合并到本文档末尾')}>
                <IconFiles size={15} />
                {tr(' 合并')}
              </button>
            </div>
            <div className="org-group">
              <button onClick={extractSelected} disabled={selected.size === 0} title={tr('提取所选页面为新 PDF')}>
                <IconDownload size={15} />
                {tr(' 提取')}
              </button>
              <button
                className={splitMode ? 'active' : ''}
                onClick={() => setSplitMode((v) => !v)}
                title={tr('把文档拆分为多个文件')}
              >
                <IconScissors size={15} />
                {tr(' 拆分')}
              </button>
              <button
                onClick={deleteSelected}
                disabled={selected.size === 0 || selected.size >= viewCount}
                className="danger"
                title={tr('删除所选页面')}
              >
                <IconTrash size={15} />
                {tr(' 删除')}
              </button>
            </div>
            <button className="organize-done" onClick={close}>
              <IconCheck size={15} />
              {tr(' 完成')}
            </button>
          </div>
        </header>

        {splitMode && (
          <div className="split-bar">
            <div className="split-group">
              <span>{tr('每')}</span>
              <input
                value={splitEveryN}
                onChange={(e) => setSplitEveryN(e.target.value.replace(/\D/g, ''))}
                style={{ width: 50 }}
              />
              <span>{tr('页拆分为一个文件')}</span>
              <button onClick={() => doSplit('n')}>{tr('拆分')}</button>
            </div>
            <div className="split-group">
              <span>{tr('按范围:')}</span>
              <input
                value={splitRanges}
                placeholder={tr('如 1-3, 5, 7-{0}', viewCount)}
                onChange={(e) => setSplitRanges(e.target.value)}
                style={{ width: 220 }}
              />
              <button onClick={() => doSplit('ranges')}>{tr('拆分')}</button>
            </div>
            {splitError && <span className="split-error">{splitError}</span>}
          </div>
        )}

        <div className="organize-grid" onPointerDown={(e) => e.target === e.currentTarget && setSelected(new Set())}>
          {pageMap.map((ref, idx) => (
            <OrganizeThumb
              key={`${idx}-${ref}`}
              doc={pdfDoc}
              pageRef={ref}
              viewIndex={idx}
              selected={selected.has(idx)}
              dropTarget={dropTarget === idx}
              rotationAcc={pageExtraRotation(idx + 1, ops, pdfDoc.numPages)}
              onClick={(e) => toggle(idx, e.shiftKey)}
              onDragStart={() => {
                dragIdx.current = idx
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setDropTarget(idx)
              }}
              onDragLeave={() => setDropTarget((v) => (v === idx ? null : v))}
              onDrop={() => onDrop(idx)}
            />
          ))}
        </div>

        {busy && (
          <div className="organize-busy">
            <div className="spinner" />
            <span>{busy}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function seq(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1)
}
function seqRange(from: number, to: number): number[] {
  const out: number[] = []
  for (let i = from; i <= to; i++) out.push(i)
  return out
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

const OrganizeThumb = memo(function OrganizeThumb({
  doc,
  pageRef,
  viewIndex,
  selected,
  dropTarget,
  rotationAcc,
  onClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  doc: PDFDocumentProxy
  pageRef: number
  viewIndex: number
  selected: boolean
  dropTarget: boolean
  rotationAcc: number
  onClick: (e: React.MouseEvent) => void
  onDragStart: () => void
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: () => void
}) {
  useLocale()
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    let release: (() => void) | null = null
    if (pageRef < 0) return // blank page: CSS renders the card
    ;(async () => {
      try {
        const page = await doc.getPage(pageRef)
        if (cancelled) return
        const rotation = (((page.rotate + rotationAcc) % 360) + 360) % 360
        const vp0 = page.getViewport({ scale: 1, rotation })
        const scale = 132 / vp0.width
        const vp = page.getViewport({ scale: scale * 1.5, rotation })
        const canvas = canvasRef.current
        if (!canvas || cancelled) return
        canvas.width = Math.round(vp.width)
        canvas.height = Math.round(vp.height)
        canvas.style.width = `${Math.round(vp0.width * scale)}px`
        canvas.style.height = `${Math.round(vp0.height * scale)}px`
        release = await acquireRenderSlot()
        if (cancelled) return
        await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise
      } catch {
        /* cancelled */
      } finally {
        release?.()
      }
    })()
    return () => {
      cancelled = true
      release?.()
    }
  }, [doc, pageRef, rotationAcc])

  return (
    <div
      className={`org-item ${selected ? 'selected' : ''} ${dropTarget ? 'drop-target' : ''} ${pageRef < 0 ? 'blank' : ''}`}
      draggable
      onClick={onClick}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="org-thumb">
        {pageRef < 0 ? <span className="org-blank-label">{tr('空白页')}</span> : <canvas ref={canvasRef} />}
      </div>
      <div className="org-label">{viewIndex + 1}</div>
    </div>
  )
})
