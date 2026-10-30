import { createCanvas, loadImage } from '@napi-rs/canvas'
import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'

const root = fileURLToPath(new URL('../', import.meta.url))
const image = await loadImage(await readFile(path.join(root, 'build/icon.svg')))
function png(size) {
  const canvas = createCanvas(size, size)
  canvas.getContext('2d').drawImage(image, 0, 0, size, size)
  return canvas.toBuffer('image/png')
}
await mkdir(path.join(root, 'docs/images'), { recursive: true })
await writeFile(path.join(root, 'build/icon.png'), png(1024))
await writeFile(path.join(root, 'docs/images/logo.png'), png(256))
await copyFile(path.join(root, 'docs/assets/favicon.svg'), path.join(root, 'public/favicon.svg'))
if (process.platform === 'darwin') {
  const temp = await mkdtemp(path.join(tmpdir(), 'sail-icon-'))
  const iconset = path.join(temp, 'Sail.iconset')
  try {
    await mkdir(iconset)
    for (const size of [16, 32, 128, 256, 512]) {
      await writeFile(path.join(iconset, `icon_${size}x${size}.png`), png(size))
      await writeFile(path.join(iconset, `icon_${size}x${size}@2x.png`), png(size * 2))
    }
    execFileSync('iconutil', ['-c', 'icns', '-o', path.join(root, 'build/icon.icns'), iconset])
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}
console.log('Generated the shared Sail icon, favicon and README logo.')
