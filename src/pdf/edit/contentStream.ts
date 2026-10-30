/**
 * Minimal PDF content stream tokenizer, enough to locate image paint
 * operators (`Do` of image XObjects, inline images BI..ID..EI) and rewrite
 * them, recursing into form XObjects. Operands are kept as raw byte ranges,
 * so untouched content is copied byte-for-byte.
 */

export interface Token {
  /** operator keyword, or null for operands */
  op: string | null
  start: number
  end: number
  /** operand value (numbers / names), when cheap to decode */
  value?: number | string
}

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20])
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25])

export interface Instruction {
  op: string
  /** operand tokens */
  args: Token[]
  /** byte range of the whole instruction (first operand .. operator end) */
  start: number
  end: number
}

/** split a content stream into instructions (operands + operator) */
export function parseContent(bytes: Uint8Array): Instruction[] {
  const out: Instruction[] = []
  let args: Token[] = []
  let i = 0
  const n = bytes.length
  const skipWs = () => {
    while (i < n) {
      const c = bytes[i]
      if (WS.has(c)) i++
      else if (c === 0x25) {
        while (i < n && bytes[i] !== 0x0a && bytes[i] !== 0x0d) i++
      } else break
    }
  }
  while (i < n) {
    skipWs()
    if (i >= n) break
    const s = i
    const c = bytes[i]
    if (c === 0x28) {
      // literal string with nesting and escapes
      let depth = 0
      while (i < n) {
        const b = bytes[i]
        if (b === 0x5c) {
          i += 2
          continue
        }
        if (b === 0x28) depth++
        else if (b === 0x29) {
          depth--
          if (depth === 0) {
            i++
            break
          }
        }
        i++
      }
      args.push({ op: null, start: s, end: i })
    } else if (c === 0x3c && bytes[i + 1] === 0x3c) {
      // dictionary (inline, e.g. BDC properties)
      let depth = 0
      while (i < n) {
        if (bytes[i] === 0x3c && bytes[i + 1] === 0x3c) {
          depth++
          i += 2
        } else if (bytes[i] === 0x3e && bytes[i + 1] === 0x3e) {
          depth--
          i += 2
          if (depth === 0) break
        } else if (bytes[i] === 0x28) {
          // skip nested strings
          let d = 0
          while (i < n) {
            if (bytes[i] === 0x5c) {
              i += 2
              continue
            }
            if (bytes[i] === 0x28) d++
            else if (bytes[i] === 0x29 && --d === 0) {
              i++
              break
            }
            i++
          }
        } else i++
      }
      args.push({ op: null, start: s, end: i })
    } else if (c === 0x3c) {
      while (i < n && bytes[i] !== 0x3e) i++
      i++
      args.push({ op: null, start: s, end: i })
    } else if (c === 0x5b) {
      // array: keep as one operand (may contain strings)
      let depth = 0
      while (i < n) {
        const b = bytes[i]
        if (b === 0x28) {
          let d = 0
          while (i < n) {
            if (bytes[i] === 0x5c) {
              i += 2
              continue
            }
            if (bytes[i] === 0x28) d++
            else if (bytes[i] === 0x29 && --d === 0) {
              i++
              break
            }
            i++
          }
          continue
        }
        if (b === 0x5b) depth++
        else if (b === 0x5d && --depth === 0) {
          i++
          break
        }
        i++
      }
      args.push({ op: null, start: s, end: i })
    } else if (c === 0x2f) {
      i++
      while (i < n && !WS.has(bytes[i]) && !DELIM.has(bytes[i])) i++
      args.push({ op: null, start: s, end: i, value: decodeName(bytes.subarray(s + 1, i)) })
    } else if ((c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2d || c === 0x2e) {
      while (i < n && !WS.has(bytes[i]) && !DELIM.has(bytes[i])) i++
      args.push({ op: null, start: s, end: i, value: parseFloat(latin1(bytes, s, i)) })
    } else if (DELIM.has(c)) {
      // stray delimiter (e.g. ')' or '}') — skip
      i++
    } else {
      while (i < n && !WS.has(bytes[i]) && !DELIM.has(bytes[i])) i++
      const op = latin1(bytes, s, i)
      if (op === 'BI') {
        // inline image: dictionary pairs until ID, then binary data until EI
        const id = findInlineData(bytes, i)
        const ei = id >= 0 ? findEI(bytes, id) : -1
        const end = ei >= 0 ? ei + 2 : n
        out.push({ op: 'BI', args: [], start: args[0]?.start ?? s, end })
        i = end
        args = []
        continue
      }
      out.push({ op, args, start: args[0]?.start ?? s, end: i })
      args = []
    }
  }
  return out
}

function latin1(b: Uint8Array, s: number, e: number): string {
  let str = ''
  for (let k = s; k < e; k++) str += String.fromCharCode(b[k])
  return str
}

function decodeName(b: Uint8Array): string {
  let s = ''
  for (let k = 0; k < b.length; k++) {
    if (b[k] === 0x23 && k + 2 < b.length) {
      s += String.fromCharCode(parseInt(String.fromCharCode(b[k + 1], b[k + 2]), 16))
      k += 2
    } else s += String.fromCharCode(b[k])
  }
  return s
}

/** position right after the `ID` keyword + single whitespace */
function findInlineData(b: Uint8Array, from: number): number {
  for (let k = from; k < b.length - 1; k++) {
    if (b[k] === 0x49 && b[k + 1] === 0x44 && WS.has(b[k - 1]) && (k + 2 >= b.length || WS.has(b[k + 2]))) {
      return k + 3
    }
  }
  return -1
}

/** start of the `EI` that ends inline image data (whitespace-delimited) */
function findEI(b: Uint8Array, from: number): number {
  for (let k = from; k < b.length - 1; k++) {
    if (b[k] === 0x45 && b[k + 1] === 0x49 && WS.has(b[k - 1]) && (k + 2 >= b.length || WS.has(b[k + 2]))) {
      return k
    }
  }
  return -1
}

/** rebuild a content stream replacing some instruction byte ranges */
export function rewrite(bytes: Uint8Array, edits: { start: number; end: number; with: string }[]): Uint8Array {
  const sorted = edits.slice().sort((a, b) => a.start - b.start)
  const parts: Uint8Array[] = []
  let pos = 0
  const enc = new TextEncoder()
  for (const e of sorted) {
    if (e.start < pos) continue
    parts.push(bytes.subarray(pos, e.start))
    parts.push(enc.encode(e.with))
    pos = e.end
  }
  parts.push(bytes.subarray(pos))
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
