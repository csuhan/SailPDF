/** Validate local font exports and rebuild standalone faces from TTC files.
 * Table offsets in a collection refer to the original file, so slicing at a
 * face header corrupts them. Some OS font exports also omit all outlines.
 */
export function normalizeFontProgram(bytes: Uint8Array, postscriptName?: string): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tagAt = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  const within = (offset: number, length: number) => offset >= 0 && length >= 0 && offset + length <= bytes.length
  if (!within(0, 12)) throw new Error('Truncated font header')
  const collection = tagAt(0) === 'ttcf'
  const count = collection ? view.getUint32(8) : 1
  if (!count || count > 1024 || (collection && !within(12, count * 4))) throw new Error('Invalid font collection')
  const faces: { offset: number; tables: { tag: string; offset: number; length: number; checksum: number }[] }[] = []
  for (let face = 0; face < count; face++) {
    const offset = collection ? view.getUint32(12 + face * 4) : 0
    if (!within(offset, 12)) continue
    const signature = view.getUint32(offset)
    if (![0x00010000, 0x74727565, 0x4f54544f].includes(signature)) continue
    const n = view.getUint16(offset + 4)
    if (!n || !within(offset + 12, n * 16)) continue
    const tables = []
    for (let i = 0; i < n; i++) {
      const entry = offset + 12 + i * 16
      tables.push({
        tag: tagAt(entry),
        checksum: view.getUint32(entry + 4),
        offset: view.getUint32(entry + 8),
        length: view.getUint32(entry + 12),
      })
    }
    if (tables.some((t) => !within(t.offset, t.length))) continue
    if (!tables.some((t) => ['glyf', 'CFF ', 'CFF2'].includes(t.tag) && t.length > 0)) continue
    faces.push({ offset, tables })
  }
  if (!faces.length) throw new Error('Font export has no supported glyph outlines')
  const normalizedName = (name: string) => name.replace(/[\s_-]/g, '').toLowerCase()
  const matches = (face: (typeof faces)[number]) => {
    const table = face.tables.find((t) => t.tag === 'name')
    if (!table || table.length < 6 || !postscriptName) return false
    const records = view.getUint16(table.offset + 2)
    const strings = view.getUint16(table.offset + 4)
    for (let i = 0; i < records; i++) {
      const at = table.offset + 6 + i * 12
      if (at + 12 > table.offset + table.length) break
      if (view.getUint16(at + 6) !== 6) continue
      const start = table.offset + strings + view.getUint16(at + 10)
      const length = view.getUint16(at + 8)
      if (start < table.offset || start + length > table.offset + table.length) continue
      const platform = view.getUint16(at)
      const name = new TextDecoder(platform === 0 || platform === 3 ? 'utf-16be' : 'latin1').decode(
        bytes.subarray(start, start + length),
      )
      if (normalizedName(name) === normalizedName(postscriptName)) return true
    }
    return false
  }
  const face = faces.find(matches) ?? faces[0]
  if (!collection) return bytes
  const n = face.tables.length
  let size = 12 + n * 16
  const out = new Uint8Array(size + face.tables.reduce((sum, t) => sum + ((t.length + 3) & ~3), 0))
  const result = new DataView(out.buffer)
  out.set(bytes.subarray(face.offset, face.offset + 12))
  for (let i = 0; i < n; i++) {
    const table = face.tables[i]
    const entry = 12 + i * 16
    out.set(
      Array.from(table.tag, (c) => c.charCodeAt(0)),
      entry,
    )
    result.setUint32(entry + 4, table.checksum)
    result.setUint32(entry + 8, size)
    result.setUint32(entry + 12, table.length)
    out.set(bytes.subarray(table.offset, table.offset + table.length), size)
    size += (table.length + 3) & ~3
  }
  // checkSumAdjustment covers the standalone file, rather than the collection.
  const head = face.tables.findIndex((t) => t.tag === 'head' && t.length >= 12)
  if (head >= 0) {
    const adjustment = result.getUint32(12 + head * 16 + 8) + 8
    result.setUint32(adjustment, 0)
    let sum = 0
    for (let i = 0; i < out.length; i += 4) sum = (sum + result.getUint32(i)) >>> 0
    result.setUint32(adjustment, (0xb1b0afba - sum) >>> 0)
  }
  return out
}
