/** Verify packaged macOS code without launching it or changing quarantine attributes. */
'use strict'

const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { promisify } = require('node:util')

const execFileAsync = promisify(execFile)
const BUNDLE_ID = 'com.pdfpro.app'

function requireMacOS() {
  if (process.platform !== 'darwin') throw new Error('macOS package verification must run on macOS.')
}

async function run(command, args, timeout = 120000) {
  try {
    return await execFileAsync(command, args, { encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 })
  } catch (error) {
    const detail = (error.stderr || error.stdout || error.message).trim()
    throw new Error(`${path.basename(command)} failed: ${detail}`, { cause: error })
  }
}

async function containedFile(appPath, relativePath) {
  const file = await fs.realpath(path.join(appPath, relativePath))
  if (!file.startsWith(appPath + path.sep) || !(await fs.stat(file)).isFile())
    throw new Error(`Expected a file inside the application: ${relativePath}`)
  return file
}

async function dylibsIn(directory, appPath, visited = new Set()) {
  const resolved = await fs.realpath(directory)
  if (!resolved.startsWith(appPath + path.sep)) throw new Error('Bundled llama code resolves outside the application.')
  if (visited.has(resolved)) return []
  visited.add(resolved)
  const files = []
  for (const entry of await fs.readdir(resolved, { withFileTypes: true })) {
    const candidate = path.join(resolved, entry.name)
    const info = await fs.stat(candidate)
    if (info.isDirectory()) files.push(...(await dylibsIn(candidate, appPath, visited)))
    else if (entry.name.endsWith('.dylib')) {
      files.push(await containedFile(appPath, path.relative(appPath, candidate)))
    }
  }
  return [...new Set(files)]
}

async function verifyApp(input) {
  requireMacOS()
  const appPath = await fs.realpath(input)
  if (path.extname(appPath) !== '.app' || !(await fs.stat(appPath)).isDirectory())
    throw new Error(`Expected a .app directory: ${input}`)

  const plist = await containedFile(appPath, 'Contents/Info.plist')
  const { stdout: identifier } = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist])
  if (identifier.trim() !== BUNDLE_ID) throw new Error(`Unexpected application bundle identifier: ${identifier.trim()}`)
  const { stdout: executableValue } = await run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist])
  const executableName = executableValue.trim()
  if (!executableName || executableName === '.' || executableName === '..' || /[\/\\\0\r\n]/.test(executableName))
    throw new Error('Invalid CFBundleExecutable in the application bundle.')
  const executable = await containedFile(appPath, path.join('Contents/MacOS', executableName))
  await run('/usr/bin/lipo', [executable, '-verify_arch', 'arm64'])
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath])

  const ocr = await containedFile(appPath, 'Contents/Resources/pdfpro-ocr')
  const server = await containedFile(appPath, 'Contents/Resources/llama/llama-server')
  const libraries = await dylibsIn(path.join(appPath, 'Contents/Resources/llama'), appPath)
  if (!libraries.length) throw new Error('No bundled llama .dylib files were found.')
  for (const file of [ocr, server, ...libraries]) {
    await run('/usr/bin/lipo', [file, '-verify_arch', 'arm64'])
    await run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', file])
  }

  const signature = await run('/usr/bin/codesign', ['--display', '--verbose=4', appPath])
  const details = signature.stdout + signature.stderr
  const kind = /^Signature=adhoc$/m.test(details)
    ? 'ad-hoc signature; not a Developer ID signature'
    : /^Authority=Developer ID Application:/m.test(details)
      ? 'Developer ID Application signature'
      : 'valid code signature; no Developer ID Application identity established'
  console.log(`PASS ${input}: ${BUNDLE_ID}, arm64, app and ${libraries.length + 2} native components verified.`)
  console.log(`Signing: ${kind}. Notarization and Gatekeeper acceptance are not certified by this check.`)
}

async function topLevelApp(directory) {
  const entries = (await fs.readdir(directory, { withFileTypes: true })).filter((entry) => entry.name.endsWith('.app'))
  if (entries.length !== 1 || !entries[0].isDirectory())
    throw new Error('The archive must contain exactly one top-level .app directory.')
  return path.join(directory, entries[0].name)
}

async function verifyDmg(image) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sail-package-dmg-'))
  const mountpoint = path.join(temporary, 'mounted')
  await fs.mkdir(mountpoint)
  let mounted = false
  let failure
  try {
    await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mountpoint, image])
    mounted = true
    await verifyApp(await topLevelApp(mountpoint))
  } catch (error) {
    failure = error
  } finally {
    try {
      await run('/usr/bin/hdiutil', ['detach', mountpoint])
      mounted = false
    } catch (error) {
      if (mounted) {
        const cleanup = new Error(`Could not detach the read-only image at ${mountpoint}`, { cause: error })
        failure = failure ? new AggregateError([failure, cleanup], `${failure.message}; ${cleanup.message}`) : cleanup
      }
    }
    if (!mounted) await fs.rm(temporary, { recursive: true, force: true })
  }
  if (failure) throw failure
  console.log(`PASS archive ${image}`)
}

async function verifyZip(archive) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'sail-package-zip-'))
  try {
    await run('/usr/bin/ditto', ['-x', '-k', archive, temporary], 180000)
    await verifyApp(await topLevelApp(temporary))
  } finally {
    await fs.rm(temporary, { recursive: true, force: true })
  }
  console.log(`PASS archive ${archive}`)
}

async function verifyPackage(input) {
  requireMacOS()
  const resolved = path.resolve(input)
  const extension = path.extname(resolved).toLowerCase()
  if (extension === '.app') return verifyApp(resolved)
  if (!(await fs.stat(resolved)).isFile()) throw new Error(`Expected an application or archive file: ${input}`)
  if (extension === '.dmg') return verifyDmg(resolved)
  if (extension === '.zip') return verifyZip(resolved)
  throw new Error(`Unsupported package type: ${input}. Use .app, .dmg or .zip.`)
}

/** electron-builder afterSign hook; packaging stops if any code signature is invalid. */
module.exports = async function afterSign(context) {
  requireMacOS()
  const filename = context?.packager?.appInfo?.productFilename
  if (!context?.appOutDir || !filename || path.basename(filename) !== filename || filename === '.' || filename === '..')
    throw new Error('Invalid electron-builder afterSign context.')
  await verifyApp(path.join(context.appOutDir, `${filename}.app`))
}

if (require.main === module) {
  ;(async () => {
    requireMacOS()
    const inputs = process.argv.slice(2)
    if (!inputs.length) throw new Error('Usage: node scripts/verify-macos-package.cjs <app|dmg|zip> [...]')
    let failed = false
    for (const input of inputs) {
      try {
        await verifyPackage(input)
      } catch (error) {
        failed = true
        console.error(`FAIL ${input}: ${error.message}`)
      }
    }
    if (failed) process.exitCode = 1
  })().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
