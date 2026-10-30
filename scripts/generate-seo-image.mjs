import { createCanvas, loadImage } from '@napi-rs/canvas'
import { readFile, writeFile } from 'node:fs/promises'

// Reuse the project's own branding and screenshot for link preview cards.
const canvas = createCanvas(1200, 630)
const ctx = canvas.getContext('2d')
ctx.fillStyle = '#f8f9f7'
ctx.fillRect(0, 0, 1200, 630)
const logo = await loadImage(await readFile(new URL('../docs/images/logo.png', import.meta.url)))
const workspace = await loadImage(await readFile(new URL('../docs/images/workspace.png', import.meta.url)))
ctx.drawImage(logo, 44, 36, 80, 80)
ctx.fillStyle = '#172c40'
ctx.font = 'bold 44px sans-serif'
ctx.fillText('Sail PDF', 137, 89)
ctx.font = '24px sans-serif'
ctx.fillText('Open-source PDF reader & editor for Mac', 48, 153)
ctx.fillStyle = '#53616d'
ctx.font = '18px sans-serif'
ctx.fillText('Read · Annotate · Edit · Optional on-device AI', 48, 189)
ctx.save()
ctx.shadowColor = '#172c4026'
ctx.shadowBlur = 24
ctx.shadowOffsetY = 8
ctx.fillStyle = '#ffffff'
ctx.beginPath()
ctx.roundRect(48, 224, 1104, 622, 14)
ctx.fill()
ctx.restore()
ctx.save()
ctx.beginPath()
ctx.roundRect(48, 224, 1104, 622, 14)
ctx.clip()
ctx.drawImage(workspace, 48, 224, 1104, 621)
ctx.restore()
await writeFile(new URL('../docs/images/social-card.png', import.meta.url), canvas.toBuffer('image/png'))
console.log('Generated docs/images/social-card.png (1200 × 630).')
