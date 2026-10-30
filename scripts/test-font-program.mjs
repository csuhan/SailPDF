import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

async function source(file) {
  const result = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false })
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(
    mod,
    mod.exports,
    createRequire(import.meta.url),
  )
  return mod.exports
}
const { normalizeFontProgram } = await source('src/pdf/edit/fontProgram.ts')
function face(bytes, at, tables) {
  const view = new DataView(bytes.buffer)
  view.setUint32(at, 0x00010000)
  view.setUint16(at + 4, tables.length)
  for (let i = 0; i < tables.length; i++) {
    const [tag, offset, length] = tables[i]
    const entry = at + 12 + i * 16
    bytes.set(Buffer.from(tag), entry)
    view.setUint32(entry + 8, offset)
    view.setUint32(entry + 12, length)
  }
}
const valid = new Uint8Array(36)
face(valid, 0, [['glyf', 28, 8]])
valid.set([1, 2, 3, 4, 5, 6, 7, 8], 28)
assert.equal(normalizeFontProgram(valid), valid)
assert.throws(() => normalizeFontProgram(new Uint8Array(10)), /Truncated/)
const missing = valid.slice()
missing.set(Buffer.from('cmap'), 12)
assert.throws(() => normalizeFontProgram(missing), /no supported glyph outlines/)
const bounds = valid.slice()
new DataView(bounds.buffer).setUint32(20, 9999)
assert.throws(() => normalizeFontProgram(bounds), /no supported glyph outlines/)

// A TTC face uses absolute offsets; the output must copy table data and rebase.
const collection = new Uint8Array(256)
const view = new DataView(collection.buffer)
collection.set(Buffer.from('ttcf'))
view.setUint32(4, 0x00010000)
view.setUint32(8, 2)
view.setUint32(12, 24)
view.setUint32(16, 64)
face(collection, 24, [['glyf', 128, 8]])
face(collection, 64, [
  ['glyf', 136, 8],
  ['name', 144, 70],
])
collection.set([11, 12, 13, 14, 15, 16, 17, 18], 128)
collection.set([21, 22, 23, 24, 25, 26, 27, 28], 136)
const nameAt = 144
view.setUint16(nameAt + 2, 1)
view.setUint16(nameAt + 4, 18)
view.setUint16(nameAt + 6, 3)
view.setUint16(nameAt + 8, 1)
view.setUint16(nameAt + 12, 6)
const name = 'SelectedFace'
view.setUint16(nameAt + 14, name.length * 2)
for (let i = 0; i < name.length; i++) view.setUint16(nameAt + 18 + i * 2, name.charCodeAt(i))
const first = normalizeFontProgram(collection)
assert.deepEqual([...first.subarray(new DataView(first.buffer).getUint32(20), 36)], [11, 12, 13, 14, 15, 16, 17, 18])
const chosen = normalizeFontProgram(collection, name)
const chosenOffset = new DataView(chosen.buffer).getUint32(20)
assert.deepEqual([...chosen.subarray(chosenOffset, chosenOffset + 8)], [21, 22, 23, 24, 25, 26, 27, 28])

// Model the outline-free macOS export seen on CI and prove fallback selection.
const previousWindow = globalThis.window
try {
  globalThis.window = {
    queryLocalFonts: async () => [
      { family: 'PingFang SC', style: 'Regular', postscriptName: 'BadFace', blob: async () => new Blob([missing]) },
      { family: 'Arial Unicode MS', style: 'Regular', postscriptName: 'GoodFace', blob: async () => new Blob([valid]) },
    ],
  }
  const { loadSystemCjkFont } = await source('src/pdf/edit/cjkFont.ts')
  const simultaneous = await Promise.all([loadSystemCjkFont(), loadSystemCjkFont()])
  assert.deepEqual(simultaneous, [valid, valid])
} finally {
  globalThis.window = previousWindow
}
console.log('PASS font validation, invalid exports, TTC offset rebuilding, face selection and CJK fallback')
