// PDF security/integrity regression: real saved bytes, no browser or server.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import esbuild from 'esbuild'
import {
  PDFDocument,
  PDFArray,
  PDFDict,
  PDFName,
  PDFPage,
  PDFRawStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  degrees,
} from 'pdf-lib'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
async function loadSource(file) {
  const built = await esbuild.build({
    entryPoints: [path.join(root, file)],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    external: ['pdf-lib', '@pdf-lib/fontkit'],
  })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', built.outputFiles[0].text)(
    mod,
    mod.exports,
    createRequire(import.meta.url),
  )
  return mod.exports
}
const { bakePdf } = await loadSource('src/pdf/edit/applyOps.ts')
const { computePageState, pageExtraRotation } = await loadSource('src/pdf/edit/pageOrder.ts')
let passed = 0
async function test(name, run) {
  await run()
  console.log(`PASS ${name}`)
  passed++
}
const redact = (page = 1) => ({ kind: 'redact', id: 'redact', page, x: 0, y: 80, width: 295, height: 70 })
const overlay = (text) => ({
  kind: 'overlay-text',
  id: 'text',
  page: 1,
  x: 20,
  y: 100,
  text,
  fontSize: 20,
  fontName: 'Helvetica',
  color: '#000000',
})
const hex = (s) => Buffer.from(s).toString('hex').toUpperCase()
async function textOf(bytes, page = 1) {
  const doc = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise
  try {
    return (await (await doc.getPage(page)).getTextContent()).items.map((i) => i.str ?? '').join(' ')
  } finally {
    await doc.destroy()
  }
}
async function objectText(bytes) {
  const doc = await PDFDocument.load(bytes)
  return doc.context
    .enumerateIndirectObjects()
    .map(([, o]) =>
      o instanceof PDFRawStream ? Buffer.from(decodePDFRawStream(o).decode()).toString('latin1') : o.toString(),
    )
    .join('\n')
}
async function noSecret(bytes, secret) {
  const all = await objectText(bytes)
  assert(!all.includes(secret), 'secret remains in a serialized object')
  assert(!all.toUpperCase().includes(hex(secret)), 'secret remains in a decoded serialized stream')
  const utf16 = Array.from(secret)
    .map((c) => c.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')
    .toUpperCase()
  assert(!all.toUpperCase().includes(utf16), 'secret remains in a UTF-16 PDF string')
  assert(!(await textOf(bytes)).includes(secret), 'secret remains in extracted page text')
}
async function fixture() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([300, 400]).drawText('ORIGINAL_SECRET', { x: 20, y: 100, size: 20, font })
  doc.getPage(0).drawText('KEEP_OUTSIDE', { x: 20, y: 260, size: 16, font })
  return doc
}
await test('redacted original text is absent from every serialized object; outside text survives', async () => {
  const out = await bakePdf(await (await fixture()).save(), [redact()])
  await noSecret(out, 'ORIGINAL_SECRET')
  assert((await textOf(out)).includes('KEEP_OUTSIDE'))
  assert((await objectText(out)).includes('re f Q'), 'redaction cover missing')
})
await test('a partially covered glyph is removed rather than hidden', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage([300, 400]).drawText('W', { x: 20, y: 100, size: 20, font })
  const out = await bakePdf(await doc.save(), [{ ...redact(), x: 20, y: 95, width: 1, height: 25 }])
  assert.equal((await textOf(out)).trim(), '')
})
await test('pending text and annotations are removed before serialization', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([300, 400])
  const out = await bakePdf(await doc.save(), [
    overlay('PENDING_SECRET'),
    {
      kind: 'note',
      id: 'note',
      page: 1,
      x: 25,
      y: 120,
      text: 'NOTE_SECRET',
      color: '#ff0000',
      modified: new Date(0).toISOString(),
    },
    {
      kind: 'link',
      id: 'link',
      page: 1,
      x: 20,
      y: 100,
      width: 80,
      height: 20,
      url: 'https://example.test/LINK_SECRET',
    },
    redact(),
  ])
  for (const s of ['PENDING_SECRET', 'NOTE_SECRET', 'LINK_SECRET']) await noSecret(out, s)
})
await test('redacted image resources and bytes are removed', async () => {
  const doc = await PDFDocument.create()
  const p = doc.addPage([300, 400])
  const img = doc.context.register(
    doc.context.stream(Buffer.from('PIXEL_SECRET'), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 4,
      Height: 1,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
    }),
  )
  p.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { SecretImage: img } }))
  p.node.addContentStream(doc.context.register(doc.context.flateStream('q 100 0 0 30 20 100 cm /SecretImage Do Q')))
  const out = await bakePdf(await doc.save(), [redact()])
  await noSecret(out, 'PIXEL_SECRET')
  assert(!(await objectText(out)).includes('/Subtype /Image'))
})
await test('newly embedded image under redaction is not resurrected on save', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([300, 400])
  const png = new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS9sAAAAASUVORK5CYII=',
      'base64',
    ),
  )
  const image = {
    kind: 'image',
    id: 'pending-image',
    page: 1,
    x: 20,
    y: 100,
    width: 50,
    height: 30,
    rotation: 0,
    imageType: 'png',
    imageData: png,
  }
  const out = await bakePdf(await doc.save(), [image, redact()])
  assert(!(await objectText(out)).includes('/Subtype /Image'))
})
await test('shared live image on another page survives without a target-page resource', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([300, 400])
  doc.addPage([300, 400])
  const image = doc.context.register(
    doc.context.stream(new Uint8Array([255, 0, 0]), {
      Type: 'XObject',
      Subtype: 'Image',
      Width: 1,
      Height: 1,
      ColorSpace: 'DeviceRGB',
      BitsPerComponent: 8,
    }),
  )
  const resources = doc.context.register(doc.context.obj({ XObject: { Shared: image } }))
  for (const page of doc.getPages()) {
    page.node.set(PDFName.of('Resources'), resources)
    page.node.addContentStream(doc.context.register(doc.context.flateStream('q 100 0 0 30 20 100 cm /Shared Do Q')))
  }
  const out = await PDFDocument.load(await bakePdf(await doc.save(), [redact()]))
  assert(!out.getPage(0).node.Resources().lookup(PDFName.of('XObject')).has(PDFName.of('Shared')))
  const kept = out.getPage(1).node.Resources().lookup(PDFName.of('XObject')).lookup(PDFName.of('Shared'))
  assert.equal(kept.dict.get(PDFName.of('Subtype')), PDFName.of('Image'))
})
await test('nested shared form redaction uses isolated resources and keeps the other page intact', async () => {
  const doc = await PDFDocument.create()
  doc.addPage([300, 400])
  doc.addPage([300, 400])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  await doc.flush()
  const form = doc.context.register(
    doc.context.flateStream(`BT /F 20 Tf 1 0 0 1 20 100 Tm <${hex('FORM_SECRET')}> Tj ET`, {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 300, 400],
      Resources: { Font: { F: font.ref } },
    }),
  )
  const outer = doc.context.register(
    doc.context.flateStream('/Inner Do', {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: [0, 0, 300, 400],
      Resources: { XObject: { Inner: form } },
    }),
  )
  const resources = doc.context.register(doc.context.obj({ XObject: { Outer: outer } }))
  for (const page of doc.getPages()) {
    page.node.set(PDFName.of('Resources'), resources)
    page.node.addContentStream(doc.context.register(doc.context.flateStream('/Outer Do')))
  }
  const out = await bakePdf(await doc.save(), [redact()])
  assert(!(await textOf(out, 1)).includes('FORM_SECRET'))
  assert((await textOf(out, 2)).includes('FORM_SECRET'))
  const all = await bakePdf(await doc.save(), [redact(1), { ...redact(2), id: 'r2' }])
  await noSecret(all, 'FORM_SECRET')
})
await test('redacted form field is removed while other field and document metadata survive', async () => {
  const doc = await fixture()
  doc.setTitle('Preserved title')
  doc.setAuthor('Preserved author')
  doc.catalog.set(
    PDFName.of('Metadata'),
    doc.context.register(
      doc.context.stream('<metadata>KEEP_METADATA</metadata>', { Type: 'Metadata', Subtype: 'XML' }),
    ),
  )
  const form = doc.getForm()
  const hidden = form.createTextField('secret_field')
  hidden.setText('FIELD_SECRET')
  hidden.addToPage(doc.getPage(0), { x: 20, y: 95, width: 200, height: 30 })
  const kept = form.createTextField('kept_field')
  kept.setText('KEEP_FORM')
  kept.addToPage(doc.getPage(0), { x: 20, y: 300, width: 200, height: 30 })
  const out = await bakePdf(await doc.save(), [redact()])
  await noSecret(out, 'FIELD_SECRET')
  const loaded = await PDFDocument.load(out)
  assert.equal(loaded.getTitle(), 'Preserved title')
  assert.equal(loaded.getAuthor(), 'Preserved author')
  assert.equal(loaded.getForm().getTextField('kept_field').getText(), 'KEEP_FORM')
  assert.deepEqual(
    loaded
      .getForm()
      .getFields()
      .map((f) => f.getName()),
    ['kept_field'],
  )
  assert((await objectText(out)).includes('KEEP_METADATA'))
})
await test('rotate follows original page through reorder and deleting the rotated page saves', async () => {
  const doc = await fixture()
  doc.addPage([300, 400]).drawText('SECOND_PAGE', { x: 20, y: 260 })
  const bytes = await doc.save()
  const rotate = { kind: 'page-rotate', id: 'rotate', page: 0, pageIndex: 0, degrees: 90 }
  const reorder = { kind: 'page-reorder', id: 'order', page: 0, order: [2, 1] }
  const out = await bakePdf(bytes, [rotate, reorder])
  const loaded = await PDFDocument.load(out)
  assert.deepEqual(
    loaded.getPages().map((p) => p.getRotation().angle),
    [0, 90],
  )
  assert((await textOf(out, 1)).includes('SECOND_PAGE'))
  assert.equal(pageExtraRotation(2, [rotate, reorder], 2), 90)
  const deleted = await PDFDocument.load(
    await bakePdf(bytes, [
      { ...rotate, pageIndex: 1 },
      { ...reorder, order: [1] },
    ]),
  )
  assert.equal(deleted.getPageCount(), 1)
  assert.equal(deleted.getPage(0).getRotation().angle, 0)
})
await test('blank identity retains dimensions and rotation after insertion and reorder', async () => {
  const doc = await fixture()
  doc.addPage([300, 400])
  doc.getPage(0).setRotation(degrees(90))
  doc.setTitle('Keep after reorder')
  const ops = [
    { kind: 'page-insert-blank', id: 'a', page: 0, pageIndex: 1, width: 110, height: 220 },
    { kind: 'page-rotate', id: 'r', page: 0, pageIndex: 1, degrees: 90 },
    { kind: 'page-insert-blank', id: 'b', page: 0, pageIndex: 0, width: 330, height: 440 },
    { kind: 'page-reorder', id: 'o', page: 0, order: [-1, 2, 1, -2] },
  ]
  const state = computePageState(2, ops)
  assert.equal(state.rotations.get(-1), 90)
  assert.deepEqual(state.blankSizes.get(-1), { width: 110, height: 220 })
  const out = await PDFDocument.load(await bakePdf(await doc.save(), ops))
  assert.deepEqual(
    out.getPages().map((p) => [p.getWidth(), p.getHeight(), p.getRotation().angle]),
    [
      [110, 220, 90],
      [300, 400, 0],
      [300, 400, 90],
      [330, 440, 0],
    ],
  )
  assert.equal(out.getTitle(), 'Keep after reorder')
})
await test('page reordering preserves form catalog and its filled value', async () => {
  const doc = await fixture()
  doc.addPage([300, 400])
  const field = doc.getForm().createTextField('persist')
  field.setText('FORM_PERSISTS')
  field.addToPage(doc.getPage(0), { x: 20, y: 300, width: 200, height: 30 })
  const out = await PDFDocument.load(
    await bakePdf(await doc.save(), [{ kind: 'page-reorder', id: 'r', page: 0, order: [2, 1] }]),
  )
  assert.equal(out.getForm().getTextField('persist').getText(), 'FORM_PERSISTS')
  const annots = out.getPage(1).node.lookup(PDFName.of('Annots'))
  assert(annots instanceof PDFArray && annots.size() > 0)
})
await test('reparented pages preserve inherited fonts, boxes, and rotations from nested page trees', async () => {
  const doc = await PDFDocument.create()
  const fonts = [await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.Courier)]
  const labels = ['INHERITED_FIRST', 'INHERITED_SECOND']
  const pages = labels.map((label, i) => {
    const p = doc.addPage([300, 400])
    p.drawText(label, { x: 30, y: 100, font: fonts[i], size: 15 })
    return p
  })
  const root = doc.catalog.Pages()
  const rootRef = doc.catalog.get(PDFName.of('Pages'))
  const sizes = [
    [300, 400],
    [500, 600],
  ]
  const crops = [
    [10, 20, 280, 370],
    [15, 25, 480, 570],
  ]
  const rotations = [90, 180]
  const branches = pages.map((p, i) => {
    const node = doc.context.obj({
      Type: 'Pages',
      Parent: rootRef,
      Kids: [p.ref],
      Count: 1,
      Resources: p.node.Resources(),
      MediaBox: [0, 0, ...sizes[i]],
      CropBox: crops[i],
      Rotate: rotations[i],
    })
    const ref = doc.context.register(node)
    p.node.set(PDFName.of('Parent'), ref)
    for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) p.node.delete(PDFName.of(key))
    return ref
  })
  root.set(PDFName.of('Kids'), doc.context.obj(branches))
  root.set(PDFName.of('Count'), doc.context.obj(2))
  const input = await doc.save()
  const source = await PDFDocument.load(input)
  assert.equal(source.getPage(0).getRotation().angle, 90)
  assert.equal(source.getPage(1).getWidth(), 500)
  assert((await textOf(input, 1)).includes(labels[0]))
  const out = await bakePdf(input, [{ kind: 'page-reorder', id: 'inherited-order', page: 0, order: [2, 1] }])
  const read = await PDFDocument.load(out)
  assert.deepEqual(
    read.getPages().map((p) => [p.getWidth(), p.getHeight(), p.getRotation().angle]),
    [
      [500, 600, 180],
      [300, 400, 90],
    ],
  )
  assert.deepEqual(
    read.getPages().map((p) => p.getCropBox()),
    [
      { x: 15, y: 25, width: 465, height: 545 },
      { x: 10, y: 20, width: 270, height: 350 },
    ],
  )
  assert((await textOf(out, 1)).includes(labels[1]))
  assert((await textOf(out, 2)).includes(labels[0]))
})
async function assertConcurrentFonts(inputs, ops) {
  const original = PDFPage.prototype.drawText
  let foreignFonts = 0
  PDFPage.prototype.drawText = function (text, options) {
    if (options?.font && options.font.doc !== this.doc) foreignFonts++
    return original.call(this, text, options)
  }
  let outputs
  try {
    outputs = await Promise.all(inputs.map((bytes) => bakePdf(bytes, ops)))
  } finally {
    PDFPage.prototype.drawText = original
  }
  assert.equal(foreignFonts, 0, 'concurrent exports used a font owned by a different PDF document')
  for (const bytes of outputs) {
    const text = await textOf(bytes)
    for (const op of ops) assert(text.includes(op.text ?? op.newText))
    const saved = await PDFDocument.load(bytes)
    const fonts = saved.getPage(0).node.Resources().lookup(PDFName.of('Font'))
    for (const [, ref] of fonts.entries()) {
      const font = saved.context.lookup(ref)
      assert(
        font instanceof PDFDict && font.get(PDFName.of('Type')) === PDFName.of('Font'),
        'saved font reference is invalid',
      )
    }
  }
}
await test('concurrent standard-font exports keep fonts in their owning documents', async () => {
  const a = await PDFDocument.create()
  a.addPage([300, 400])
  const b = await PDFDocument.create()
  b.addPage([300, 400])
  b.addPage([300, 400])
  const ops = Array.from({ length: 10 }, (_, i) => ({
    ...overlay(`CONCURRENT_${i}`),
    id: `op-${i}`,
    y: 20 + i * 20,
    fontSize: 12,
  }))
  await assertConcurrentFonts(await Promise.all([a.save(), b.save()]), ops)
})
await test('concurrent embedded-font exports keep font programs in their owning documents', async () => {
  const fontkit = (await import('@pdf-lib/fontkit')).default
  const fontBytes = new Uint8Array(await readFile(path.join(root, 'public/standard_fonts/LiberationSans-Regular.ttf')))
  const inputs = []
  for (let i = 0; i < 2; i++) {
    const doc = await PDFDocument.create()
    doc.registerFontkit(fontkit)
    const font = await doc.embedFont(fontBytes, { subset: false })
    doc.addPage([300, 400]).drawText('SOURCE', { x: 20, y: 350, font, size: 12 })
    if (i) doc.addPage([300, 400])
    inputs.push(await doc.save())
  }
  const ops = Array.from({ length: 3 }, (_, i) => ({
    kind: 'text-edit',
    id: `embedded-${i}`,
    page: 1,
    rect: { x: 20, y: 40 + i * 40, width: 230, height: 20 },
    x: 20,
    baselineY: 45 + i * 40,
    newText: `EMBEDDED_${i}`,
    fontSize: 12,
    fontName: 'Helvetica',
    baseFamily: 'Liberation Sans',
    color: '#000000',
  }))
  // The desktop bridge supplies the font program when a source font cannot
  // cover the edited text. This exercises the same EMBED_CACHE as reuse.
  const previousWindow = globalThis.window
  globalThis.window = { pdfDesktop: { searchFont: async () => fontBytes } }
  try {
    await assertConcurrentFonts(inputs, ops)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }
})
console.log(`PDF integrity: ${passed} tests passed`)
