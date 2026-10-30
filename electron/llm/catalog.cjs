// Local models that Sail PDF can download and run with the bundled
// llama-server. Weights are fetched on first use from Hugging Face and
// verified against the SHA-256 published by the repository (LFS oid).
'use strict'

/** @typedef {{ file: string, size: number, sha256: string }} ModelFile */
/**
 * @typedef {{
 *   id: string, name: string, desc: string, repo: string,
 *   model: ModelFile, mmproj?: ModelFile,
 *   minRamGB: number, ctx: number, recommended?: boolean
 * }} CatalogEntry
 */

/** @type {CatalogEntry[]} */
const CATALOG = [
  {
    id: 'gemma-4-e2b-qat',
    name: 'Gemma 4 E2B',
    desc: '最快、最省内存，适合 8GB 内存的电脑',
    repo: 'google/gemma-4-E2B-it-qat-q4_0-gguf',
    model: {
      file: 'gemma-4-E2B_q4_0-it.gguf',
      size: 3349516256,
      sha256: 'fa401b55b07ee70a54c6dae3903c783a6e65064312529ea57175cb5f8dec6634',
    },
    minRamGB: 8,
    ctx: 32768,
    recommended: true,
  },
  {
    id: 'gemma-4-e4b-qat',
    name: 'Gemma 4 E4B',
    desc: '质量与速度均衡，推荐 16GB 内存',
    repo: 'google/gemma-4-E4B-it-qat-q4_0-gguf',
    model: {
      file: 'gemma-4-E4B_q4_0-it.gguf',
      size: 5154941280,
      sha256: '676c35070db6dbe52f93e9c864ee0fba4eddea94b9c875d9cb10daff453fbaee',
    },
    minRamGB: 16,
    ctx: 32768,
  },
  {
    id: 'gemma-4-12b-qat',
    name: 'Gemma 4 12B',
    desc: '理解与编辑能力最强，需要 24GB 以上内存',
    repo: 'google/gemma-4-12B-it-qat-q4_0-gguf',
    model: {
      file: 'gemma-4-12b-it-qat-q4_0.gguf',
      size: 6975879296,
      sha256: '93567e57a8fe10b23569b9d9ec38cd005deedf71e29477c421a4b83f418a538b',
    },
    minRamGB: 24,
    ctx: 32768,
  },
]

/** download url of a file in a Hugging Face repo */
function hfUrl(repo, file, mirror) {
  const host = (mirror || 'https://huggingface.co').replace(/\/+$/, '')
  return `${host}/${repo}/resolve/main/${encodeURIComponent(file)}`
}

module.exports = { CATALOG, hfUrl }
