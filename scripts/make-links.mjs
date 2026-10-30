// Test doc for line editing: links (annotations over colored text), mixed
// colors/weights on one line, a right-aligned block on the same baseline.
// Fonts are embedded as SUBSETS like real-world PDFs.
import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, PDFName, PDFString, rgb } from 'pdf-lib'
import { readFileSync, writeFileSync } from 'node:fs'

const F = (process.env.SAIL_TEST_FONT_DIR || '/System/Library/Fonts/Supplemental').replace(/\/$/, '') + '/'
const doc = await PDFDocument.create()
doc.registerFontkit(fontkit)
const reg = await doc.embedFont(readFileSync(F + 'Georgia.ttf'), { subset: true })
const bold = await doc.embedFont(readFileSync(F + 'Georgia Bold.ttf'), { subset: true })
const page = doc.addPage([612, 792])
const BLACK = rgb(0.1, 0.1, 0.1)
const BLUE = rgb(0.05, 0.33, 0.8)
const links = []

// draw a sequence of [text, font, color, linkUrl?] segments on one baseline
function line(y, segs, size = 13, x0 = 72) {
  let x = x0
  for (const [text, font, color, url] of segs) {
    page.drawText(text, { x, y, size, font, color })
    const w = font.widthOfTextAtSize(text, size)
    if (url) links.push({ x, y: y - size * 0.25, w, h: size * 1.15, url })
    x += w
  }
}

page.drawText('Link Editing Test', { x: 72, y: 720, size: 22, font: bold, color: BLACK })
line(680, [
  ['Homepage: ', bold, BLACK],
  ['example.com', reg, BLUE, 'https://example.com/'],
  [' and docs', reg, BLACK],
])
line(652, [
  ['Contact ', reg, BLACK],
  ['support@example.com', reg, BLUE, 'mailto:support@example.com'],
  [' for help.', reg, BLACK],
])
line(624, [
  ['Lab: ', bold, BLACK],
  ['Vision Group', reg, BLUE, 'https://example.org/lab'],
])
// right-aligned date on the same baseline
line(596, [['Senior Engineer, Example Corp', bold, BLACK]])
const date = 'Mar 2024 - Present'
page.drawText(date, { x: 540 - reg.widthOfTextAtSize(date, 13), y: 596, size: 13, font: reg, color: BLACK })
line(568, [
  ['Status: ', bold, BLACK],
  ['approved', reg, rgb(0.1, 0.55, 0.2)],
  [' by the board.', reg, BLACK],
])
line(540, [['Plain line with every letter: the quick brown fox jumps over a lazy dog.', reg, BLACK]], 12)

const annots = links.map((l) =>
  doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [l.x, l.y, l.x + l.w, l.y + l.h],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(l.url) },
    }),
  ),
)
page.node.set(PDFName.of('Annots'), doc.context.obj(annots))
writeFileSync('public/samples/links.pdf', await doc.save())
console.log('written public/samples/links.pdf')
