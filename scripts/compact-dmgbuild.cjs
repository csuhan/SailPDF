#!/usr/bin/env node
// The native tool creates the final ULMO image, then electron-builder computes
// signatures and update metadata from those exact bytes. ULMO needs macOS 10.15+;
// this app's Electron runtime already requires macOS 13 or later.
'use strict'

const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

function main() {
  if (process.platform !== 'darwin') throw new Error('The compact dmgbuild wrapper requires macOS.')
  const native = process.env.SAIL_NATIVE_DMGBUILD_PATH
  if (!native || !path.isAbsolute(native))
    throw new Error('Run Mac packaging through scripts/package-macos.mjs to resolve the verified native tool.')
  if (fs.realpathSync(native) === fs.realpathSync(__filename)) throw new Error('The native dmgbuild path is recursive.')
  if (!fs.statSync(native).isFile()) throw new Error('The native dmgbuild path is not a file.')
  fs.accessSync(native, fs.constants.X_OK)
  const args = process.argv.slice(2)
  const settingsIndex = args.indexOf('-s')
  if (settingsIndex < 0 || settingsIndex !== args.lastIndexOf('-s') || !args[settingsIndex + 1])
    throw new Error('Expected one dmgbuild -s settings.json argument.')
  const settings = JSON.parse(fs.readFileSync(args[settingsIndex + 1], 'utf8'))
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('Invalid dmgbuild settings object.')
  if (settings.format === 'ULFO') {
    settings.format = 'ULMO'
    console.log('Creating the compact ULMO disk image with the verified dmgbuild tool.')
  }
  // Preserve explicit formats such as UDRO for diagnostic builds.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'sail-dmgbuild-'))
  let result
  try {
    const file = path.join(temporary, 'settings.json')
    fs.writeFileSync(file, JSON.stringify(settings), { mode: 0o600 })
    args[settingsIndex + 1] = file
    result = spawnSync(native, args, { stdio: 'inherit', env: process.env })
    if (result.error) throw result.error
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
  if (result.signal) process.kill(process.pid, result.signal)
  else process.exitCode = result.status ?? 1
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
