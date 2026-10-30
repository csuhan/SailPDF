import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const bundle = await build({
  stdin: {
    contents: 'export * from "./src/tools/registry"; export * from "./src/state/toolDiscoveryStore"',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['zustand'],
})
const module = { exports: {} }
new Function('module', 'exports', 'require', bundle.outputFiles[0].text)(
  module,
  module.exports,
  createRequire(import.meta.url),
)
const { TOOL_REGISTRY, findTool, searchTools, getToolAvailability, readToolFavorites, useToolDiscoveryStore } =
  module.exports
const permissions = {
  print: true,
  printHigh: true,
  modify: true,
  copy: true,
  annotate: true,
  fillForms: true,
  assemble: true,
}
const context = { hasDocument: true, loading: false, permissions, ocr: 'available' }

test('search understands user tasks and combines normalized terms', () => {
  assert.equal(searchTools('减小附件')[0].id, 'optimize')
  assert.equal(searchTools('扫描识字')[0].id, 'ocr')
  assert.equal(searchTools('  ＷＯＲＤ   转换 ')[0].id, 'convert')
  assert.ok(searchTools('旋转').some((tool) => tool.id === 'organize'))
  assert.deepEqual(searchTools('totally-unknown-tool-9813'), [])
})

test('catalog IDs are unique and every dialog points to a supported host', () => {
  assert.equal(new Set(TOOL_REGISTRY.map((tool) => tool.id)).size, TOOL_REGISTRY.length)
  const dialogs = new Set([
    'watermark',
    'page-numbers',
    'properties',
    'export-images',
    'protect',
    'redact',
    'optimize',
    'compare',
    'crop',
    'convert',
    'ocr',
    'export-pdf',
  ])
  for (const tool of TOOL_REGISTRY) if (tool.action.kind === 'dialog') assert.ok(dialogs.has(tool.action.dialog))
})

test('welcome tools guide document selection without offering unavailable OCR', () => {
  assert.deepEqual(getToolAvailability(findTool('optimize'), { ...context, hasDocument: false }), {
    available: false,
    canOpenDocument: true,
    reason: '选择 PDF 后使用',
  })
  assert.equal(getToolAvailability(findTool('create'), { ...context, hasDocument: false }).available, true)
  const ocr = getToolAvailability(findTool('ocr'), { ...context, hasDocument: false, ocr: 'unavailable' })
  assert.equal(ocr.available, false)
  assert.equal(ocr.canOpenDocument, undefined)
})

test('permission restrictions distinguish editing, extraction, forms and assembly', () => {
  const restricted = {
    ...context,
    permissions: { ...permissions, modify: false, copy: false, assemble: false, annotate: false, fillForms: true },
  }
  for (const id of [
    'edit',
    'watermark',
    'crop',
    'optimize',
    'redact',
    'redact-find',
    'export-text',
    'convert',
    'merge',
    'split',
    'note',
  ]) {
    assert.equal(getToolAvailability(findTool(id), restricted).available, false, id)
  }
  for (const id of ['form', 'protect', 'properties', 'save'])
    assert.equal(getToolAvailability(findTool(id), restricted).available, true, id)
})

test('busy and loading sessions cannot start tools', () => {
  assert.equal(getToolAvailability(findTool('open'), { ...context, busy: true }).available, false)
  assert.equal(getToolAvailability(findTool('edit'), { ...context, loading: true }).available, false)
})

test('favorite preferences recover from corrupt and stale stored values', () => {
  assert.deepEqual(readToolFavorites({ getItem: () => 'broken JSON' }), [])
  assert.deepEqual(readToolFavorites({ getItem: () => '{}' }), [])
  assert.deepEqual(readToolFavorites({ getItem: () => '["optimize", 3, "removed-tool", "optimize", "ocr"]' }), [
    'optimize',
    'ocr',
  ])
  const store = useToolDiscoveryStore
  store.setState({ favorites: [] })
  store.getState().toggleFavorite('optimize')
  assert.deepEqual(store.getState().favorites, ['optimize'])
  store.getState().toggleFavorite('invalid-tool')
  assert.deepEqual(store.getState().favorites, ['optimize'])
  store.getState().toggleFavorite('optimize')
  assert.deepEqual(store.getState().favorites, [])
})
