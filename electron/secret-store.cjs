const { tr } = require('./locale.cjs')
;('use strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
/** Fixed-purpose, system-encrypted storage. Never falls back to plaintext. */
class SecretStore {
  constructor({ directory, safeStorage }) {
    this.directory = directory
    this.safeStorage = safeStorage
    this.file = path.join(directory, 'ai-credential.enc')
    this.queue = Promise.resolve()
  }
  async available() {
    const available = this.safeStorage.isAsyncEncryptionAvailable
      ? await this.safeStorage.isAsyncEncryptionAvailable()
      : this.safeStorage.isEncryptionAvailable()
    return (
      available && (process.platform !== 'linux' || this.safeStorage.getSelectedStorageBackend?.() !== 'basic_text')
    )
  }
  load() {
    return this.queue.then(async () => {
      if (!(await this.available()))
        return {
          apiKey: '',
          endpoint: '',
          available: false,
          error: tr('系统安全存储不可用，API Key 仅在本次会话使用。'),
        }
      try {
        const stat = await fs.lstat(this.file)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 128 * 1024)
          throw new Error('invalid credential file')
        const data = await fs.readFile(this.file)
        const decrypted = this.safeStorage.decryptStringAsync
          ? (await this.safeStorage.decryptStringAsync(data)).result
          : this.safeStorage.decryptString(data)
        const value = JSON.parse(decrypted)
        if (typeof value.apiKey !== 'string' || typeof value.endpoint !== 'string')
          throw new Error('invalid credential data')
        return { apiKey: value.apiKey, endpoint: value.endpoint, available: true }
      } catch (error) {
        if (error.code === 'ENOENT') return { apiKey: '', endpoint: '', available: true }
        return { apiKey: '', endpoint: '', available: true, error: tr('无法读取已加密的 API Key，请重新输入。') }
      }
    })
  }
  save(value) {
    const result = this.queue
      .then(async () => {
        if (!value.apiKey) {
          await fs.unlink(this.file).catch((error) => {
            if (error.code !== 'ENOENT') throw error
          })
          return { ok: true }
        }
        if (!(await this.available())) return { ok: false, message: tr('系统安全存储不可用，未将 API Key 写入磁盘。') }
        await fs.mkdir(this.directory, { recursive: true, mode: 0o700 })
        const temp = path.join(this.directory, `.${randomUUID()}.tmp`)
        try {
          const encrypted = this.safeStorage.encryptStringAsync
            ? await this.safeStorage.encryptStringAsync(JSON.stringify(value))
            : this.safeStorage.encryptString(JSON.stringify(value))
          const handle = await fs.open(temp, 'wx', 0o600)
          try {
            await handle.writeFile(encrypted)
            await handle.sync()
          } finally {
            await handle.close()
          }
          await fs.rename(temp, this.file)
          await fs.chmod(this.file, 0o600)
          return { ok: true }
        } finally {
          await fs.unlink(temp).catch(() => {})
        }
      })
      .catch(() => ({ ok: false, message: tr('API Key 未能安全保存，请检查系统钥匙串或稍后重试。') }))
    this.queue = result.then(() => {})
    return result
  }
}
module.exports = { SecretStore }
