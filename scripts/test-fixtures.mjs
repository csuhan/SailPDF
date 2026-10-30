// Synthetic fixtures shared by browser suites. No personal files or absolute
// user paths are required. The native canvas package ships with pdfjs-dist.
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib'
import { createCanvas } from '@napi-rs/canvas'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export const TEST_EMAIL = 'test-reader@example.test'
export const TEST_READER = 'TEST READER'
export const TEST_REFERENCE = 'Reference Link'

export async function ensureTestFixtures() {
  const root = fileURLToPath(new URL('../', import.meta.url))
  const dir = path.join(root, '.scratch', 'test-fixtures')
  await mkdir(dir, { recursive: true })
  const save = async (name, bytes) => {
    const target = path.join(dir, name)
    const temp = `${target}.${process.pid}.tmp`
    await writeFile(temp, bytes)
    await rename(temp, target)
    return target
  }
  const doc = await PDFDocument.create()
  doc.setTitle('Synthetic PDF review fixture')
  doc.setAuthor('Test Suite')
  doc.setCreationDate(new Date('2000-01-01T00:00:00Z'))
  doc.setModificationDate(new Date('2000-01-01T00:00:00Z'))
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const first = doc.addPage([612, 792])
  first.drawText(TEST_READER, { x: 72, y: 724, size: 22, font })
  first.drawText(TEST_REFERENCE, { x: 72, y: 680, size: 12, font })
  first.drawText(TEST_EMAIL, { x: 72, y: 650, size: 12, font })
  first.drawText('Synthetic material for annotation and redaction tests.', { x: 72, y: 620, size: 12, font })
  const mailto = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Link',
      Rect: [70, 646, 74 + font.widthOfTextAtSize(TEST_EMAIL, 12), 664],
      Border: [0, 0, 0],
      A: { Type: 'Action', S: 'URI', URI: PDFString.of(`mailto:${TEST_EMAIL}`) },
    }),
  )
  const note = doc.context.register(
    doc.context.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [500, 500, 520, 520],
      Contents: PDFString.of('Synthetic sticky note'),
      T: PDFString.of('Test Suite'),
      Name: 'Comment',
      C: [1, 0.8, 0],
      F: 4,
    }),
  )
  first.node.set(PDFName.of('Annots'), doc.context.obj([mailto, note]))
  for (let n = 2; n <= 3; n++) {
    doc.addPage([612, 792]).drawText(`Synthetic review page ${n}`, { x: 72, y: 720, size: 18, font })
  }
  const reviewPath = await save('review.pdf', await doc.save())
  const landscape = createCanvas(900, 600)
  const ctx1 = landscape.getContext('2d')
  ctx1.fillStyle = '#215b9f'
  ctx1.fillRect(0, 0, 900, 600)
  ctx1.fillStyle = '#f3c64a'
  ctx1.fillRect(100, 100, 700, 400)
  const landscapePath = await save('landscape.png', landscape.toBuffer('image/png'))
  const portrait = createCanvas(600, 900)
  const ctx2 = portrait.getContext('2d')
  ctx2.fillStyle = '#398366'
  ctx2.fillRect(0, 0, 600, 900)
  ctx2.fillStyle = '#d5eadf'
  ctx2.fillRect(100, 150, 400, 600)
  const portraitPath = await save('portrait.jpg', portrait.toBuffer('image/jpeg'))
  return { reviewPath, reviewUrl: `/@fs${reviewPath}`, landscapePath, portraitPath }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(await ensureTestFixtures())
