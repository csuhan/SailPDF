import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const dictionary = JSON.parse(fs.readFileSync('locales/en.json', 'utf8'))
test('interface translations cover literal keys and preserve interpolation parameters', () => {
  const missing = []
  function walk(folder) {
    for (const name of fs.readdirSync(folder)) {
      const file = path.join(folder, name)
      if (fs.statSync(file).isDirectory()) {
        walk(file)
        continue
      }
      if (!/\.(tsx?|cjs)$/.test(name)) continue
      const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node) {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'tr' &&
          ts.isStringLiteral(node.arguments[0])
        ) {
          const key = node.arguments[0].text.trim().replace(/\s+/g, ' ')
          if (/[\u4e00-\u9fff]/.test(key) && !dictionary[key]) missing.push(`${file}: ${key}`)
          if (dictionary[key])
            for (let n = 0; n < node.arguments.length - 1; n++)
              assert.ok(dictionary[key].includes(`{${n}}`), `${key}: English must retain argument ${n}`)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  }
  walk('src')
  walk('electron')
  assert.deepEqual(missing, [])
})
test('English default, storage failure, bilingual catalogs and user-provided values remain reliable', async () => {
  const previous = process.env.PDFPRO_TEST_LANGUAGE
  delete process.env.PDFPRO_TEST_LANGUAGE
  const originalStorage = globalThis.localStorage
  globalThis.localStorage = {
    getItem() {
      throw Error('unavailable')
    },
    setItem() {
      throw Error('unavailable')
    },
  }
  try {
    const output = await build({
      stdin: {
        contents: 'export * from "./src/i18n/locale";export * from "./src/tools/registry"',
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      write: false,
    })
    const module = { exports: {} }
    new Function('module', 'exports', 'require', output.outputFiles[0].text)(
      module,
      module.exports,
      createRequire(import.meta.url),
    )
    const api = module.exports
    assert.equal(api.getLocale(), 'en')
    assert.equal(api.tr('保存'), 'Save')
    assert.equal(api.tr('constructor'), 'constructor')
    const original = '保存 · 注释 {0}'
    assert.equal(api.tr('已保存到 {0}', original), 'Saved to ' + original)
    const ids = api.TOOL_REGISTRY.map((v) => v.id)
    assert.ok(api.searchTools('编辑文字与图片').some((v) => v.id === 'edit'))
    assert.ok(api.searchTools('edit text').some((v) => v.id === 'edit'))
    api.setLocale('zh-CN')
    assert.equal(api.tr('保存'), '保存')
    assert.equal(api.TOOL_REGISTRY[0].title, '编辑文字与图片')
    assert.ok(api.searchTools('edit text').some((v) => v.id === 'edit'))
    assert.deepEqual(
      api.TOOL_REGISTRY.map((v) => v.id),
      ids,
    )
    api.setLocale('en')
    assert.equal(api.TOOL_REGISTRY[0].title, 'Edit text & images')
  } finally {
    if (previous === undefined) delete process.env.PDFPRO_TEST_LANGUAGE
    else process.env.PDFPRO_TEST_LANGUAGE = previous
    globalThis.localStorage = originalStorage
  }
})
