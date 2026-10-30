import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'

const output = await build({
  stdin: {
    contents: 'export * from "./src/state/preferences"; export * from "./src/state/theme"',
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['zustand'],
  define: { 'import.meta.hot': 'false' },
})
function load(initial = {}) {
  const values = new Map(Object.entries(initial))
  const listeners = new Set()
  const media = {
    matches: false,
    addEventListener: (_event, callback) => listeners.add(callback),
    removeEventListener: (_event, callback) => listeners.delete(callback),
  }
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  globalThis.document = { documentElement: { dataset: {} } }
  globalThis.matchMedia = () => media
  const module = { exports: {} }
  new Function('module', 'exports', 'require', output.outputFiles[0].text)(
    module,
    module.exports,
    createRequire(import.meta.url),
  )
  return {
    ...module.exports,
    values,
    media,
    changed: () => {
      for (const listener of listeners) listener()
    },
  }
}

test('preference data rejects corrupt shapes and validates each stored value', () => {
  const api = load()
  assert.deepEqual(api.readPreferences({ getItem: () => 'null' }), api.DEFAULT_PREFERENCES)
  assert.deepEqual(api.readPreferences({ getItem: () => 'invalid' }), api.DEFAULT_PREFERENCES)
  assert.deepEqual(api.readPreferences({ getItem: () => '[false]' }), api.DEFAULT_PREFERENCES)
  const preferences = api.normalizePreferences({
    defaultViewMode: 'bad',
    defaultFitMode: 'custom',
    defaultScale: Infinity,
    restorePosition: 'false',
    autosaveIntervalMs: 0,
    autosaveEnabled: false,
  })
  assert.equal(preferences.defaultViewMode, 'continuous')
  assert.equal(preferences.defaultFitMode, 'custom')
  assert.equal(preferences.defaultScale, 1)
  assert.equal(preferences.restorePosition, true)
  assert.equal(preferences.autosaveIntervalMs, 1000)
  assert.equal(preferences.autosaveEnabled, false)
})

test('preference updates persist only supported values and preserve other fields', () => {
  const api = load()
  api.usePreferences
    .getState()
    .setPreferences({ defaultViewMode: 'single', defaultScale: 99, autosaveIntervalMs: 999999 })
  const saved = JSON.parse(api.values.get(api.PREFERENCES_KEY))
  assert.equal(saved.defaultViewMode, 'single')
  assert.equal(saved.defaultScale, 8)
  assert.equal(saved.autosaveIntervalMs, 60000)
  assert.equal(saved.copySuffix, '_edited')
  assert.equal(
    Object.values(saved).some((value) => typeof value === 'function'),
    false,
  )
  assert.deepEqual(api.readPreferences(), saved)
})

test('unavailable storage keeps changes usable for the current session', () => {
  const api = load()
  globalThis.localStorage = {
    getItem() {
      throw new Error('blocked')
    },
    setItem() {
      throw new Error('quota')
    },
  }
  assert.deepEqual(api.readPreferences(), api.DEFAULT_PREFERENCES)
  assert.doesNotThrow(() => api.usePreferences.getState().setPreferences({ restorePosition: false }))
  assert.equal(api.usePreferences.getState().restorePosition, false)
})

test('copy names are suffix-based with bounded path-safe user text', () => {
  const api = load()
  assert.equal(api.suggestedPdfName('Report.PDF', true, '_审核'), 'Report_审核.pdf')
  assert.equal(api.suggestedPdfName('Report.pdf', false, '_审核'), 'Report.pdf')
  assert.equal(api.suggestedPdfName('Report', true), 'Report_edited.pdf')
  assert.equal(api.sanitizeCopySuffix('/\\:*?"<>|'), '_edited')
  assert.equal(api.sanitizeCopySuffix('x'.repeat(100)).length, 32)
  assert.equal(api.suggestedPdfName('Report.pdf', true, '../copy'), 'Report..copy.pdf')
})

test('reset restores default preferences and writes the reset', () => {
  const api = load()
  api.usePreferences
    .getState()
    .setPreferences({ defaultViewMode: 'spread', copySuffix: '_copy', restorePosition: false })
  api.usePreferences.getState().resetPreferences()
  assert.deepEqual(api.readPreferences(), api.DEFAULT_PREFERENCES)
})

test('old light/dark choice migrates and system theme follows later OS changes', () => {
  const api = load({ 'pdfpro.theme': 'dark' })
  assert.equal(api.useTheme.getState().preference, 'dark')
  assert.equal(api.useTheme.getState().theme, 'dark')
  api.useTheme.getState().setPreference('system')
  assert.equal(api.useTheme.getState().theme, 'light')
  api.media.matches = true
  api.changed()
  assert.equal(api.useTheme.getState().theme, 'dark')
  assert.equal(document.documentElement.dataset.theme, 'dark')
  api.useTheme.getState().setTheme('light')
  api.media.matches = true
  api.changed()
  assert.equal(api.useTheme.getState().theme, 'light')
  assert.equal(api.values.get('pdfpro.theme'), 'light')
})
