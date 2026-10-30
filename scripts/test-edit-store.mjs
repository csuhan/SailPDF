import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
const bundle = await build({
  entryPoints: ['src/state/editStore.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['zustand'],
})
const m = { exports: {} }
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(m, m.exports, createRequire(import.meta.url))
const { useEditStore: store } = m.exports
const text = (id, value = 'saved') => ({
  kind: 'overlay-text',
  id,
  page: 1,
  x: 20,
  y: 100,
  text: value,
  fontSize: 14,
  fontName: 'Helvetica',
  color: '#000000',
})
test('editing a saved object then undoing another edit remains dirty', () => {
  store.getState().reset()
  store.getState().pushOp(text('a'))
  store.getState().markSaved()
  store.getState().updateOp('a', { text: 'CHANGED' })
  store.getState().pushOp(text('b'))
  store.getState().undo()
  assert.equal(store.getState().dirty, true)
  assert.equal(store.getState().ops[0].text, 'CHANGED')
  store.getState().updateOp('a', { text: 'saved' })
  assert.equal(store.getState().dirty, false)
})
test('move and resize changes participate in save equality', () => {
  store.getState().reset()
  store.getState().pushOp(text('a'))
  store.getState().markSaved()
  store.getState().updateOp('a', { x: 42 })
  store.getState().pushOp(text('b'))
  store.getState().removeOp('b')
  assert.equal(store.getState().dirty, true)
  store.getState().updateOp('a', { x: 20 })
  assert.equal(store.getState().dirty, false)
})
test('undo and redo preserve saved content and grouped edits', () => {
  store.getState().reset()
  store.getState().pushOp(text('a'))
  store.getState().markSaved()
  store.getState().pushOps([text('b'), text('c')])
  store.getState().undo()
  assert.equal(store.getState().dirty, false)
  assert.equal(store.getState().ops.length, 1)
  store.getState().redo()
  assert.equal(store.getState().dirty, true)
  assert.equal(store.getState().ops.length, 3)
})
test('revision tracks repeated form edits and reset, not selection', () => {
  const before = store.getState().revision
  store.getState().setFormDirty(true)
  store.getState().setFormDirty(true)
  assert.equal(store.getState().revision, before + 2)
  store.getState().setSelectedOp('a')
  assert.equal(store.getState().revision, before + 2)
  store.getState().reset()
  assert.equal(store.getState().revision, before + 3)
})
test('saved binary-backed objects compare changed geometry without duplicating pixels', () => {
  store.getState().reset()
  store.getState().pushOp({
    kind: 'image',
    id: 'img',
    page: 1,
    x: 0,
    y: 0,
    width: 2,
    height: 2,
    imageType: 'png',
    imageData: new Uint8Array([1, 2]),
  })
  store.getState().markSaved()
  store.getState().updateOp('img', { width: 4 })
  assert.equal(store.getState().dirty, true)
  store.getState().updateOp('img', { width: 2, imageData: new Uint8Array([1, 2]) })
  assert.equal(store.getState().dirty, false)
})
