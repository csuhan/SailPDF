import { cp, mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
for (const [source, destination] of [
  ['node_modules/pdfjs-dist/cmaps', 'public/cmaps'],
  ['node_modules/pdfjs-dist/standard_fonts', 'public/standard_fonts'],
  ['node_modules/pdfjs-dist/web/images', 'public/pdfjs-images'],
]) {
  await mkdir(path.join(root, destination), { recursive: true })
  await cp(path.join(root, source), path.join(root, destination), { recursive: true })
}
console.log('Prepared PDF.js CMaps, standard fonts and interface assets.')
