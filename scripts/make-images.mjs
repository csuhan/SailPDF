// Test doc for image editing: opaque PNG, PNG with alpha (SMask), rotated
// image, image inside a form XObject, an inline image, and one image XObject
// reused on page 2 (editing page 1 must not touch page 2).
import { PDFDocument, PDFName, degrees, StandardFonts } from 'pdf-lib'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

function crc32(buf) {
  let c
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** minimal RGBA PNG encoder */
export function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = pixel(x, y)
      const o = y * (w * 4 + 1) + 1 + x * 4
      raw[o] = r
      raw[o + 1] = g
      raw[o + 2] = b
      raw[o + 3] = a
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(td))
    return Buffer.concat([len, td, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

import { fileURLToPath } from 'node:url'
const isMain = process.argv[1] === fileURLToPath(import.meta.url)

if (isMain) await build()

async function build() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([612, 792])
  const p2 = doc.addPage([612, 792])
  p1.drawText('Image Editing Test', { x: 72, y: 730, size: 22, font })
  p1.drawText('Caption below the gradient image.', { x: 72, y: 470, size: 12, font })

  // 1) opaque gradient
  const grad = await doc.embedPng(
    png(160, 100, (x, y) => [Math.round((x / 159) * 255), Math.round((y / 99) * 255), 140, 255]),
  )
  p1.drawImage(grad, { x: 72, y: 500, width: 200, height: 125 })
  // 2) PNG with transparency (SMask): red disc
  const disc = await doc.embedPng(png(80, 80, (x, y) => [220, 40, 40, Math.hypot(x - 40, y - 40) < 36 ? 255 : 0]))
  p1.drawImage(disc, { x: 330, y: 520, width: 80, height: 80 })
  // 3) rotated
  p1.drawImage(grad, { x: 470, y: 520, width: 90, height: 60, rotate: degrees(20) })

  // 4) image inside a form XObject, 5) inline image — appended as raw content
  const formImg = await doc.embedPng(png(60, 60, (x) => [40, 120 + (x % 30) * 3, 200, 255]))
  const form = doc.context.flateStream(new TextEncoder().encode('q 100 0 0 100 0 0 cm /FI0 Do Q'), {
    Type: 'XObject',
    Subtype: 'Form',
    BBox: [0, 0, 100, 100],
    Matrix: [1, 0, 0, 1, 0, 0],
    Resources: { XObject: { FI0: formImg.ref } },
  })
  const formRef = doc.context.register(form)
  const fxName = p1.node.newXObject('Fx', formRef)
  let hex = ''
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) hex += (x + y) % 2 ? '000000' : 'ffcc00'
  const extraOps = [
    `q 1 0 0 1 72 300 cm ${fxName.toString()} Do Q`,
    `q 60 0 0 60 330 300 cm BI /W 4 /H 4 /BPC 8 /CS /RGB /F /AHx ID ${hex}> EI Q`,
  ].join('\n')
  const extraRef = doc.context.register(doc.context.flateStream(new TextEncoder().encode(extraOps + '\n')))
  const cur = p1.node.get(PDFName.of('Contents'))
  const list = cur && cur.asArray ? cur.asArray() : cur ? [cur] : []
  p1.node.set(PDFName.of('Contents'), doc.context.obj([...list, extraRef]))

  // 6) same gradient XObject on page 2
  p2.drawText('Page two reuses the gradient image.', { x: 72, y: 730, size: 14, font })
  p2.drawImage(grad, { x: 72, y: 500, width: 200, height: 125 })

  writeFileSync('public/samples/images.pdf', await doc.save())
  console.log('written public/samples/images.pdf')
}
