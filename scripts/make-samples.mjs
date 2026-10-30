// Generates sample PDFs for manual testing into public/samples/
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib'
import { mkdirSync, writeFileSync } from 'node:fs'

mkdirSync('public/samples', { recursive: true })

// ── sample 1: 6-page demo doc ────────────────────────────────
async function sample1() {
  const doc = await PDFDocument.create()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const times = await doc.embedFont(StandardFonts.TimesRoman)

  const contents = [
    {
      title: 'Sail PDF Feature Test',
      body: [
        'This document exercises the reader: text selection, search,',
        'zoom, thumbnails, outline and page navigation.',
        '',
        'Try searching for "lorem" or "PDF".',
      ],
    },
    {
      title: 'Text Editing Test',
      body: [
        'Click a line of text with the Edit tool to replace it.',
        'Fonts: Helvetica, Times-Roman and neighbors map to the',
        'standard PDF fonts for overlay re-drawing.',
        '',
        'Lorem ipsum dolor sit amet, consectetur adipiscing elit,',
        'sed do eiusmod tempor incididunt ut labore et dolore magna.',
      ],
    },
    {
      title: 'Page Operations',
      body: [
        'Organize Pages: drag to reorder, rotate, delete, insert.',
        'Split this file by page ranges. Merge it with other PDFs.',
      ],
    },
    {
      title: 'Annotations',
      body: [
        'Highlight, underline, strikeout selected text.',
        'Draw freehand, rectangles, ellipses, arrows. Add sticky notes.',
      ],
    },
    {
      title: 'Performance',
      body: [
        'Pages render lazily against an LRU bitmap cache with',
        'device-pixel-ratio aware canvases and placeholder scaling.',
        'Scroll fast: the render queue re-prioritizes visible pages.',
      ],
    },
    {
      title: 'The End',
      body: ['This is the last page. Save, split or merge me!'],
    },
  ]

  for (let i = 0; i < contents.length; i++) {
    const c = contents[i]
    const page = doc.addPage([612, 792])
    page.drawText(c.title, { x: 72, y: 730, size: 24, font: bold, color: rgb(0.1, 0.2, 0.5) })
    page.drawLine({
      start: { x: 72, y: 716 },
      end: { x: 540, y: 716 },
      thickness: 1.2,
      color: rgb(0.6, 0.65, 0.75),
    })
    let y = 680
    for (const line of c.body) {
      page.drawText(line, { x: 72, y, size: 12, font: helv, color: rgb(0.15, 0.15, 0.15) })
      page.drawText(`Lorem ipsum dolor sit amet ${i + 1}`, {
        x: 72,
        y: y - 60,
        size: 10,
        font: times,
        color: rgb(0.45, 0.45, 0.45),
      })
      y -= 20
    }
    page.drawText(`Page ${i + 1} of ${contents.length}`, {
      x: 272,
      y: 32,
      size: 9,
      font: helv,
      color: rgb(0.5, 0.5, 0.5),
    })
  }
  return doc.save()
}

// ── sample 2: 400-page stress doc ────────────────────────────
async function sample2() {
  const doc = await PDFDocument.create()
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 1; i <= 400; i++) {
    const page = doc.addPage([595, 842])
    page.drawText(`Stress page ${i}`, { x: 60, y: 790, size: 20, font: helv })
    for (let r = 0; r < 30; r++) {
      page.drawText(`Line ${r + 1} — the quick brown fox jumps over the lazy dog. 0123456789`, {
        x: 60,
        y: 750 - r * 22,
        size: 11,
        font: helv,
      })
    }
  }
  return doc.save()
}

const s1 = await sample1()
writeFileSync('public/samples/sample.pdf', s1)
const s2 = await sample2()
writeFileSync('public/samples/stress-400.pdf', s2)
console.log('samples written:', s1.length, 'bytes,', s2.length, 'bytes')
