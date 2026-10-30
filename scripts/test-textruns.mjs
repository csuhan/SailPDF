// Unit test for run-preserving line reconstruction (pure logic).
import { assembleRunsText, reconstructRuns } from '../src/pdf/edit/textRuns.ts'

const FONT = '13px Georgia'
const pos = { measure: (_f, t) => t.length * 10 }

function makeRuns() {
  // "Meeting notes: |IMPORTANT| |deadline moved| |to Friday 5pm"
  return [
    {
      text: 'Meeting notes: ',
      x: 0,
      width: 150,
      cssFont: FONT,
      baseFamily: 'Georgia',
      bold: false,
      italic: false,
      color: '#111',
      fontFallback: 'serif',
    },
    {
      text: 'IMPORTANT',
      x: 150,
      width: 110,
      cssFont: 'bold 13px Georgia',
      baseFamily: 'Georgia',
      bold: true,
      italic: false,
      color: '#b00',
      fontFallback: 'serif',
    },
    {
      text: ' ',
      x: 260,
      width: 10,
      cssFont: FONT,
      baseFamily: 'Georgia',
      bold: false,
      italic: false,
      color: '#111',
      fontFallback: 'serif',
      isSpace: true,
    },
    {
      text: 'deadline moved',
      x: 270,
      width: 150,
      cssFont: FONT,
      baseFamily: 'Georgia',
      bold: false,
      italic: false,
      color: '#111',
      fontFallback: 'serif',
    },
    {
      text: ' ',
      x: 420,
      width: 10,
      cssFont: FONT,
      baseFamily: 'Georgia',
      bold: false,
      italic: false,
      color: '#111',
      fontFallback: 'serif',
      isSpace: true,
    },
    {
      text: 'to Friday 5pm',
      x: 430,
      width: 130,
      cssFont: FONT,
      baseFamily: 'Georgia',
      bold: false,
      italic: false,
      color: '#225',
      fontFallback: 'serif',
    },
  ]
}

let failures = 0
function check(name, fn) {
  try {
    fn()
    console.log('✅', name)
  } catch (e) {
    failures++
    console.log('❌', name, '—', e.message)
  }
}
function eq(a, b, what) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
}

const runs = makeRuns()
const oldText = assembleRunsText(runs, 8)
check('assemble merges contiguous pieces', () =>
  eq(oldText, 'Meeting notes: IMPORTANT deadline moved to Friday 5pm', 'text'),
)

// 1) unchanged
check('unchanged text → identity', () => {
  const out = reconstructRuns(oldText, oldText, runs, 3, pos, 8)
  eq(out.length, runs.length, 'run count')
  eq(out[1].color, '#b00', 'style kept')
  eq(out[3].x, 270, 'positions kept')
})

// 2) single-word replacement inside a run: style preserved everywhere else
check('word replacement keeps other styles & contiguous layout', () => {
  const newText = 'Meeting notes: IMPORTANT deadline postponed to Friday 5pm'
  const out = reconstructRuns(oldText, newText, runs, 3, pos, 8)
  const texts = out.map((r) => r.text).join('')
  eq(texts.replace(/ +/g, ' '), newText.replace(/ +/g, ' '), 'assembled output text')
  const imp = out.find((r) => r.text === 'IMPORTANT')
  if (!imp || imp.color !== '#b00' || imp.bold !== true) throw new Error('IMPORTANT lost its style')
  const fri = out.find((r) => r.text === 'to Friday 5pm')
  if (!fri || fri.color !== '#225') throw new Error('suffix lost its style')
  // 'deadline ' head kept with original style
  const head = out.find((r) => r.text === 'deadline ')
  if (!head || head.ofOriginal !== 3) throw new Error('split head missing')
  // edited middle exists and sits right after the kept head
  const mid = out.find((r) => r.ofOriginal === -1)
  if (!mid) throw new Error('edited middle missing')
  // everything stays ordered & (loosely) contiguous
  const sorted = out.slice().sort((a, b) => a.x - b.x)
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1].x + sorted[i - 1].width
    if (sorted[i].x < prevEnd - 0.6 || sorted[i].x > prevEnd + 12) {
      throw new Error(`non-contiguous layout at ${i}: ${sorted[i].x} after ${prevEnd}`)
    }
  }
})

// 3) deletion collapses the middle: suffix shifts left
check('word deletion shifts suffix left', () => {
  const newText = 'Meeting notes: IMPORTANT deadline to Friday 5pm'
  const out = reconstructRuns(oldText, newText, runs, 3, pos, 8)
  const fri = out.find((r) => r.text === 'to Friday 5pm')
  // 'deadline ' shrunk to 'deadline ' head kept — oldMid 'moved ' is deleted...
  // prefix = "Meeting notes: IMPORTANT deadline" (spans multiple pieces)
  const head = out.find((r) => r.ofOriginal === 3)
  if (!head) throw new Error('anchor run head missing')
  // old suffix start x was 430, delta = headEnd - oldSufX
  const shift = fri.x - 430
  if (!(shift < 0)) throw new Error(`expected left shift, got ${shift}`)
})

// 4) insertion-only
check('pure insertion keeps flanks', () => {
  const newText = 'Meeting notes: VERY IMPORTANT deadline moved to Friday 5pm'
  const out = reconstructRuns(oldText, newText, runs, 1, pos, 8)
  const mid = out.find((r) => r.ofOriginal === -1)
  if (!mid || mid.text !== 'VERY ') throw new Error(`bad middle: ${mid && JSON.stringify(mid.text)}`)
  const imp = out.find((r) => r.text === 'IMPORTANT')
  if (!imp) throw new Error('IMPORTANT missing')
  if (friCount(out) !== 1) throw new Error('suffix dup')
  function friCount(o) {
    return o.filter((r) => r.text === 'to Friday 5pm').length
  }
})

// proper ending
if (failures) {
  console.log(`\n${failures} FAILURES`)
  process.exit(1)
}
console.log('\nRUNS TESTS PASS')
