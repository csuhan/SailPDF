import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
if (process.platform !== 'darwin' || process.arch !== 'arm64')
  throw new Error('Desktop packaging currently targets macOS Apple Silicon. Browser builds do not need OCR.')
const root = fileURLToPath(new URL('../', import.meta.url))
execFileSync(
  'swiftc',
  [
    '-O',
    '-target',
    'arm64-apple-macos13.0',
    path.join(root, 'native/ocr.swift'),
    '-o',
    path.join(root, 'native/pdfpro-ocr'),
  ],
  { stdio: 'inherit' },
)
console.log('Built the on-device Vision OCR helper from source.')
