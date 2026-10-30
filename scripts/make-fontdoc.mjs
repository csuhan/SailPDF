// Test doc with embedded (subset) Georgia fonts — mimics real-world PDFs
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb } from 'pdf-lib'
import { readFileSync, writeFileSync } from 'node:fs'

const F = (process.env.SAIL_TEST_FONT_DIR || '/System/Library/Fonts/Supplemental').replace(/\/$/, '') + '/'
const reg = readFileSync(F + 'Georgia.ttf')
const bold = readFileSync(F + 'Georgia Bold.ttf')
const italic = readFileSync(F + 'Georgia Italic.ttf')

const doc = await PDFDocument.create()
doc.registerFontkit(fontkit)
const fReg = await doc.embedFont(reg, { subset: true })
const fBold = await doc.embedFont(bold, { subset: true })
const fIt = await doc.embedFont(italic, { subset: true })

const page = doc.addPage([612, 792])
page.drawText('Quarterly Typeface Report', { x: 72, y: 720, size: 24, font: fBold, color: rgb(0.14, 0.19, 0.35) })
page.drawLine({ start: { x: 72, y: 706 }, end: { x: 540, y: 706 }, thickness: 1, color: rgb(0.7, 0.72, 0.78) })
page.drawText('Georgia is a serif typeface with a distinctive old-style figure set.', {
  x: 72,
  y: 672,
  size: 13,
  font: fReg,
  color: rgb(0.12, 0.12, 0.14),
})
page.drawText('Robert Bringhurst photographed the numerals 0123456789 in 1996.', {
  x: 72,
  y: 648,
  size: 13,
  font: fReg,
  color: rgb(0.35, 0.13, 0.13),
})
page.drawText('Edit this line — the replacement should keep Georgia 13pt.', {
  x: 72,
  y: 624,
  size: 13,
  font: fReg,
  color: rgb(0.12, 0.12, 0.14),
})
page.drawText('Italic caption: the quick brown fox, floral and calm.', {
  x: 72,
  y: 592,
  size: 12,
  font: fIt,
  color: rgb(0.2, 0.3, 0.2),
})
page.drawText('Bold heading lives here.', { x: 72, y: 564, size: 14, font: fBold, color: rgb(0.1, 0.1, 0.1) })

const bytes = await doc.save()
writeFileSync('public/samples/georgia.pdf', bytes)
console.log('written georgia.pdf', bytes.length, 'bytes')
