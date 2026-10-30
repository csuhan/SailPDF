// Exercise real ensure() locking without spawning a model or using the network.
// Run: node --test scripts/test-llama-concurrency.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { LlamaServer } = createRequire(import.meta.url)('../electron/llm/server.cjs')
const delay = () => new Promise((resolve) => setTimeout(resolve, 5))
const model = (id) => ({ id, modelPath: `/${id}.gguf`, ctx: 512 })

function harness() {
  const server = new LlamaServer({ binDir: '/unused', runDir: '/unused', logFile: '/unused' })
  const starts = []
  let live = 0
  let failNext = false
  server.touch = () => {}
  server.start = async function (m) {
    starts.push(m.id)
    assert.equal(++live, 1, 'only one child may run at a time')
    this.child = { id: m.id }
    this.state = 'starting'
    await delay()
    if (failNext) {
      failNext = false
      live--
      this.child = null
      this.state = 'crashed'
      throw new Error('intentional failed start')
    }
    this.modelPath = m.modelPath
    this.state = 'ready'
    this.port = starts.length
    this.key = m.id
    return { url: `http://127.0.0.1:${this.port}`, key: this.key }
  }
  server.stop = async function () {
    this.state = 'stopping'
    await delay()
    if (this.child) live--
    this.child = null
    this.state = 'stopped'
  }
  return {
    server,
    starts,
    fail: () => {
      failNext = true
    },
  }
}

test('cold concurrent callers share one model start', async () => {
  const { server, starts } = harness()
  const answers = await Promise.all(Array.from({ length: 8 }, () => server.ensure(model('A'))))
  assert.deepEqual(starts, ['A'])
  assert.equal(new Set(answers.map((answer) => answer.url)).size, 1)
})

test('queued A -> B callers share the entire stop/start transition', async () => {
  const { server, starts } = harness()
  const answers = await Promise.all([server.ensure(model('A')), server.ensure(model('B')), server.ensure(model('B'))])
  assert.deepEqual(starts, ['A', 'B'])
  assert.equal(answers[1].url, answers[2].url)
  assert.equal(server.pending, null)
  await server.ensure(model('B'))
  assert.deepEqual(starts, ['A', 'B'], 'ready model is reused')
})

test('concurrent switching away from a ready model starts only one child', async () => {
  const { server, starts } = harness()
  await server.ensure(model('A'))
  await Promise.all(Array.from({ length: 6 }, () => server.ensure(model('B'))))
  assert.deepEqual(starts, ['A', 'B'])
})

test('failed transition releases the lock for the next model', async () => {
  const { server, starts, fail } = harness()
  fail()
  const [first, second] = await Promise.allSettled([server.ensure(model('A')), server.ensure(model('B'))])
  assert.equal(first.status, 'rejected')
  assert.equal(second.status, 'fulfilled')
  assert.deepEqual(starts, ['A', 'B'])
  assert.equal(server.pending, null)
})
