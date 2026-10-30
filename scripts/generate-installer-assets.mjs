// Finder renders this background behind the app, Applications and INSTALL.txt icons.
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const build = path.join(root, 'build')
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const color = {
  paper: '#f7f8f5',
  ink: '#172c40',
  muted: '#536b76',
  line: '#dce5e5',
  accent: '#6c9188',
  white: '#ffffff',
}
// Rasterize with an installed CJK font; no font binaries are copied into the package.
const cjkFontPath = [
  '/System/Library/Fonts/STHeiti Medium.ttc',
  '/System/Library/Fonts/STHeiti Light.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
].find((candidate) => existsSync(candidate))
if (!cjkFontPath || !GlobalFonts.registerFromPath(cjkFontPath, 'Sail Installer CJK'))
  throw new Error('Installer artwork needs a system CJK font (Heiti SC on macOS or Noto Sans CJK).')
const font = 'Arial, "Sail Installer CJK", sans-serif'

const logo = await loadImage(await readFile(path.join(build, 'icon.svg')))

function renderBackground(scale) {
  const canvas = createCanvas(720 * scale, 560 * scale)
  const context = canvas.getContext('2d')
  context.scale(scale, scale)
  function text(value, x, y, size = 14, weight = 400, fill = color.ink, alignment = 'left') {
    context.font = `${weight} ${size}px ${font}`
    context.fillStyle = fill
    context.textAlign = alignment
    context.fillText(value, x, y)
  }

  function circle(x, y, radius, fill, stroke) {
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fillStyle = fill
    context.fill()
    if (stroke) {
      context.strokeStyle = stroke
      context.lineWidth = 1
      context.stroke()
    }
  }

  function step(number, y, english, chinese) {
    circle(60, y - 5, 13, color.ink)
    text(String(number), 60, y, 13, 700, color.white, 'center')
    text(english, 87, y, 14, 600)
    text(chinese, 87, y + 23, 13, 400, color.muted)
  }

  context.fillStyle = color.paper
  context.fillRect(0, 0, 720, 560)
  context.drawImage(logo, 43, 28, 38, 38)
  text('Sail PDF', 89, 52, 19, 700)
  text(`v${version} Beta`, 673, 50, 12, 400, color.muted, 'right')
  text('Drag to install. / 拖入即可安装。', 48, 98, 24, 600)
  text('Your documents stay on your Mac. / 文档保留在你的 Mac 上。', 48, 121, 13, 400, color.muted)

  // Native Finder icons occupy these empty circles; do not bake icons into the image.
  for (const x of [190, 530]) circle(x, 190, 61, color.white, color.line)
  context.beginPath()
  context.moveTo(304, 190)
  context.lineTo(415, 190)
  context.moveTo(402, 177)
  context.lineTo(415, 190)
  context.lineTo(402, 203)
  context.lineWidth = 3
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = color.accent
  context.stroke()
  text('Drag / 拖入', 360, 225, 12, 500, color.muted, 'center')

  context.beginPath()
  context.moveTo(48, 266)
  context.lineTo(672, 266)
  context.strokeStyle = color.line
  context.lineWidth = 1
  context.stroke()

  step(1, 287, 'Drag Sail PDF into Applications.', '将 Sail PDF 拖入「应用程序」。')
  step(2, 338, 'Open Sail PDF from Applications.', '从「应用程序」打开 Sail PDF。')
  circle(60, 389, 13, color.ink)
  text('3', 60, 394, 13, 700, color.white, 'center')
  text('If blocked: System Settings → Privacy & Security', 87, 394, 13.5, 600)
  text('Choose Open Anyway, then follow the prompts.', 87, 415, 13.5, 400, color.muted)
  text('如遇验证提示：系统设置 → 隐私与安全性', 87, 443, 13.5, 400, color.muted)
  text('选择「仍要打开」，再按提示确认。', 87, 465, 13.5, 400, color.muted)
  text('Beta · Not notarized by Apple / 测试版 · 未经 Apple 公证', 48, 490, 12, 400, color.muted)
  return canvas.toBuffer('image/png')
}

const instructions = `Sail PDF ${version} Beta — Installation / 安装说明
====================================================

English
-------
1. Download the DMG or ZIP and SHA256SUMS.txt from the official release page:
   https://github.com/csuhan/SailPDF/releases
2. Drag Sail PDF into Applications. Wait for the copy to finish.
3. Open Sail PDF from Applications. You can then eject the installer volume.

First launch on macOS
---------------------
This beta has an ad-hoc signature and has not been notarized by Apple.
The signature verifies bundle integrity; it does not verify the developer's identity.
If macOS blocks the app, dismiss the message, open System Settings → Privacy &
Security, find the Sail PDF notice and choose Open Anyway. Follow the macOS
confirmation prompts, then open Sail PDF again.

Advanced option for a package whose source you have confirmed
-----------------------------------------------------------
If Open Anyway is unavailable, you can manually remove the downloaded-file
quarantine marker from this application using Terminal:

  xattr -dr com.apple.quarantine "/Applications/Sail PDF.app"

Then reopen Sail PDF. Run this only for the Sail PDF package you downloaded from
the official release page. This text file does not run commands automatically.
If you installed the app in another folder, adjust the application path.

简体中文
--------
1. 从官方发布页下载安装包与 SHA256SUMS.txt 校验文件：
   https://github.com/csuhan/SailPDF/releases
2. 将 Sail PDF 拖入「应用程序」，等待复制完成。
3. 从「应用程序」打开 Sail PDF，随后可推出安装磁盘。

首次启动遇到 macOS 验证提示
--------------------------
当前测试版采用临时签名，未经 Apple 公证。
临时签名用于校验包完整性，不代表开发者身份已验证。
如果 macOS 阻止打开，请关闭提示，进入「系统设置 → 隐私与安全性」，
找到 Sail PDF 的提示并选择「仍要打开」，按系统提示确认，再打开应用。

已确认安装包来源后的进阶方式
--------------------------
如果没有「仍要打开」按钮，可在「终端」手动执行：

  xattr -dr com.apple.quarantine "/Applications/Sail PDF.app"

随后重新打开 Sail PDF。此命令只适用于你确认从上述官方发布页下载的安装包。
本说明文件不会自动执行任何命令。如果安装在其他文件夹，请相应调整应用路径。

Official website / 官网：https://sailpdf.pages.dev/
`

await mkdir(build, { recursive: true })
await writeFile(path.join(build, 'installer-background.png'), renderBackground(1))
await writeFile(path.join(build, 'installer-background@2x.png'), renderBackground(2))
await writeFile(path.join(build, 'INSTALL.txt'), instructions)
console.log('Generated 720 × 560 and 1440 × 1120 Retina installer backgrounds and bilingual INSTALL.txt.')
