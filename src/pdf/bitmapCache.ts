/** LRU cache of rendered page bitmaps, budgeted by bytes. */

interface Entry {
  bitmap: ImageBitmap
  bytes: number
  key: string
}

const BUDGET_BYTES = 192 * 1024 * 1024 // ~192MB of bitmaps max
const cache = new Map<string, Entry>()
let totalBytes = 0

function entryBytes(bmp: ImageBitmap): number {
  return bmp.width * bmp.height * 4
}

export function cacheKey(page: number | string, devicePxW: number, rotation: number): string {
  return `${page}@${Math.round(devicePxW)}r${rotation}`
}

export function getBitmap(key: string): ImageBitmap | null {
  const e = cache.get(key)
  if (!e) return null
  // refresh recency
  cache.delete(key)
  cache.set(key, e)
  return e.bitmap
}

export function putBitmap(key: string, bitmap: ImageBitmap): void {
  const old = cache.get(key)
  if (old) {
    totalBytes -= old.bytes
    if (old.bitmap !== bitmap) old.bitmap.close()
    cache.delete(key)
  }
  const entry: Entry = { bitmap, bytes: entryBytes(bitmap), key }
  cache.set(key, entry)
  totalBytes += entry.bytes
  // evict least-recently-used until within budget
  for (const [k, v] of cache) {
    if (totalBytes <= BUDGET_BYTES) break
    if (k === key) continue
    v.bitmap.close()
    totalBytes -= v.bytes
    cache.delete(k)
  }
}

/** any cached bitmap for a page (used as a scaled placeholder while the
 *  sharp render at a new zoom finishes — avoids blank flashes) */
export function getAnyBitmapForPage(page: number | string): ImageBitmap | null {
  const prefix = `${page}@`
  let best: ImageBitmap | null = null
  let bestW = 0
  for (const [k, v] of cache) {
    if (k.startsWith(prefix) && v.bitmap.width > bestW) {
      best = v.bitmap
      bestW = v.bitmap.width
    }
  }
  return best
}

export function dropBitmap(key: string): void {
  const e = cache.get(key)
  if (e) {
    totalBytes -= e.bytes
    e.bitmap.close()
    cache.delete(key)
  }
}

export function clearBitmapCache(): void {
  for (const e of cache.values()) e.bitmap.close()
  cache.clear()
  totalBytes = 0
}
