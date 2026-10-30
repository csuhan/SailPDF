'use strict'
const dictionary = Object.assign(Object.create(null), require('../locales/en.json'))
let language = process.env.PDFPRO_TEST_LANGUAGE === 'zh-CN' ? 'zh-CN' : 'en'
const listeners = new Set()
function tr(source, ...values) {
  const key = source.trim().replace(/\s+/g, ' ')
  return (language === 'en' ? (dictionary[key] ?? source) : source).replace(/\{(\d+)\}/g, (match, index) =>
    Number(index) < values.length ? String(values[Number(index)]) : match,
  )
}
function setLanguage(value) {
  if (!['en', 'zh-CN'].includes(value)) return false
  language = value
  for (const listener of listeners) listener()
  return true
}
function onLocaleChange(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
module.exports = { tr, setLanguage, onLocaleChange, getLanguage: () => language }
