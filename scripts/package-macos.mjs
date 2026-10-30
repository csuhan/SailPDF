// Use electron-builder's supported custom dmgbuild entry point before it creates
// signatures, blockmaps or update metadata. No finished artifact is converted.
import { spawnSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../', import.meta.url))
const wrapper = fileURLToPath(new URL('./compact-dmgbuild.cjs', import.meta.url))
const toolset = {
  releaseName: 'dmg-builder@1.2.5',
  checksums: {
    'dmgbuild-bundle-arm64-75c8a6c.tar.gz': '793404d0c96687e27d5ee40a668d498c92e36a64d6c2906df511031adb33cbeb',
    'dmgbuild-bundle-x86_64-75c8a6c.tar.gz': '1664972f9cc2d6e8fce3b63e42cd30078aff602669c5856939c4519921200433',
  },
}

async function main() {
  if (process.platform !== 'darwin') throw new Error('Mac installation packages must be built on macOS.')
  const args = process.argv.slice(2)
  if (!args.length) throw new Error('Usage: node scripts/package-macos.mjs <electron-builder options>')
  for (const variable of ['CUSTOM_DMGBUILD_PATH', 'SAIL_NATIVE_DMGBUILD_PATH']) {
    if (process.env[variable]?.trim())
      throw new Error(`${variable} is already set. Unset it before using the compact Mac packaging command.`)
  }
  // Review the pinned native toolset and CLI contract when upgrading the builder.
  if (require('app-builder-lib/package.json').version !== '26.18.0')
    throw new Error('Compact DMG packaging requires the reviewed electron-builder 26.18.0 toolchain.')
  const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x86_64' : null
  if (!arch) throw new Error(`Unsupported Mac build host architecture: ${process.arch}`)
  const { downloadBuilderToolset } = require('app-builder-lib/out/util/electronGet')
  const directory = await downloadBuilderToolset({
    ...toolset,
    filenameWithExt: `dmgbuild-bundle-${arch}-75c8a6c.tar.gz`,
  })
  const native = await realpath(path.join(directory, 'dmgbuild'))
  if (!(await stat(native)).isFile()) throw new Error('The verified native dmgbuild tool is not a file.')
  await access(native, constants.X_OK)
  await access(wrapper, constants.X_OK)
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), ...args], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CUSTOM_DMGBUILD_PATH: wrapper, SAIL_NATIVE_DMGBUILD_PATH: native },
  })
  if (result.error) throw result.error
  if (result.signal) process.kill(process.pid, result.signal)
  else process.exitCode = result.status ?? 1
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
