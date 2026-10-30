import { tr } from '../../i18n/locale'
/**
 * Writers for converted documents: Markdown, LaTeX, HTML and Word (.docx).
 * Formats with images are packaged as .zip (text file + images/) except
 * .docx, which embeds its images.
 */
import { makeZip, type ZipEntry } from '../../utils/zip'
import type { Block, DocStructure, Inline } from './structure'

export type Format = 'docx' | 'md' | 'tex' | 'html' | 'txt'

export interface Output {
  data: Uint8Array
  ext: string
  mime: string
  filterName: string
}

const enc = new TextEncoder()
const hasImages = (s: DocStructure) => s.blocks.some((b) => b.type === 'image')

// ── Markdown ───────────────────────────────────────────────────

function mdInline(xs: Inline[]): string {
  return xs
    .map((x) => {
      let t = x.text.replace(/([\\`*_[\]#<>|])/g, '\\$1')
      if (!t.trim()) return t
      const lead = /^\s*/.exec(t)![0]
      const trail = /\s*$/.exec(t)![0]
      t = t.trim()
      if (x.bold && x.italic) t = `***${t}***`
      else if (x.bold) t = `**${t}**`
      else if (x.italic) t = `*${t}*`
      if (x.href) t = `[${t}](${x.href})`
      return lead + t + trail
    })
    .join('')
}

export function toMarkdown(s: DocStructure): string {
  const out: string[] = []
  for (const b of s.blocks) {
    switch (b.type) {
      case 'heading':
        out.push(`${'#'.repeat(b.level)} ${mdInline(b.text).trim()}`)
        break
      case 'paragraph':
        out.push(mdInline(b.text).trim())
        break
      case 'list':
        out.push(b.items.map((it, i) => `${b.ordered ? `${i + 1}.` : '-'} ${mdInline(it).trim()}`).join('\n'))
        break
      case 'table': {
        const w = Math.max(...b.rows.map((r) => r.length))
        const row = (r: string[]) =>
          `| ${Array.from({ length: w }, (_, i) => (r[i] ?? '').replace(/\|/g, '\\|').trim()).join(' | ')} |`
        out.push([row(b.rows[0]), `| ${Array(w).fill('---').join(' | ')} |`, ...b.rows.slice(1).map(row)].join('\n'))
        break
      }
      case 'image':
        out.push(`![](images/${b.name})`)
        break
      case 'pagebreak':
        out.push('---')
        break
    }
  }
  return out.join('\n\n') + '\n'
}

// ── LaTeX ──────────────────────────────────────────────────────

function texEsc(t: string): string {
  return t
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/([#$%&_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
}

function texInline(xs: Inline[]): string {
  return xs
    .map((x) => {
      let t = texEsc(x.text)
      if (!t.trim()) return t
      if (x.bold) t = `\\textbf{${t}}`
      if (x.italic) t = `\\textit{${t}}`
      if (x.href) t = `\\href{${x.href.replace(/([#%])/g, '\\$1')}}{${t}}`
      return t
    })
    .join('')
}

export function toLatex(s: DocStructure): string {
  const cjk = /[\u3400-\u9fff]/.test(JSON.stringify(s.blocks.filter((b) => b.type !== 'image')))
  const head = [
    cjk ? '\\documentclass[11pt]{ctexart}' : '\\documentclass[11pt]{article}',
    '\\usepackage[margin=2.5cm]{geometry}',
    '\\usepackage{graphicx}',
    '\\usepackage{hyperref}',
    '\\usepackage{booktabs}',
    '\\usepackage{enumitem}',
    s.title ? `\\title{${texEsc(s.title)}}` : '',
    '\\date{}',
    '',
    '\\begin{document}',
    s.title ? '\\maketitle' : '',
    '',
  ]
  const body: string[] = []
  const cmd = { 1: 'section', 2: 'subsection', 3: 'subsubsection' } as const
  let skippedTitle = false
  for (const b of s.blocks) {
    switch (b.type) {
      case 'heading': {
        const t = b.text
          .map((x) => x.text)
          .join('')
          .trim()
        if (!skippedTitle && s.title && t === s.title) {
          skippedTitle = true
          break
        }
        body.push(`\\${cmd[b.level]}*{${texInline(b.text).trim()}}`)
        break
      }
      case 'paragraph':
        body.push(texInline(b.text).trim())
        break
      case 'list':
        body.push(
          [
            `\\begin{${b.ordered ? 'enumerate' : 'itemize'}}`,
            ...b.items.map((it) => `  \\item ${texInline(it).trim()}`),
            `\\end{${b.ordered ? 'enumerate' : 'itemize'}}`,
          ].join('\n'),
        )
        break
      case 'table': {
        const w = Math.max(...b.rows.map((r) => r.length))
        const row = (r: string[]) =>
          Array.from({ length: w }, (_, i) => texEsc((r[i] ?? '').trim())).join(' & ') + ' \\\\'
        body.push(
          [
            '\\begin{table}[h]',
            '\\centering',
            `\\begin{tabular}{${'l'.repeat(w)}}`,
            '\\toprule',
            row(b.rows[0]),
            '\\midrule',
            ...b.rows.slice(1).map(row),
            '\\bottomrule',
            '\\end{tabular}',
            '\\end{table}',
          ].join('\n'),
        )
        break
      }
      case 'image':
        body.push(
          [
            '\\begin{figure}[h]',
            '\\centering',
            `\\includegraphics[width=${Math.min(1, b.width / 450).toFixed(2)}\\linewidth]{images/${b.name}}`,
            '\\end{figure}',
          ].join('\n'),
        )
        break
      case 'pagebreak':
        body.push('\\clearpage')
        break
    }
  }
  return [...head.filter((l, i) => l || i > 6), ...body.map((b) => b + '\n'), '\\end{document}', ''].join('\n')
}

// ── HTML ───────────────────────────────────────────────────────

const htmlEsc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function htmlInline(xs: Inline[]): string {
  return xs
    .map((x) => {
      let t = htmlEsc(x.text)
      if (x.bold) t = `<strong>${t}</strong>`
      if (x.italic) t = `<em>${t}</em>`
      if (x.href) t = `<a href="${htmlEsc(x.href)}">${t}</a>`
      return t
    })
    .join('')
}

export function toHtml(s: DocStructure, inlineImages: boolean): string {
  const b64 = (d: Uint8Array) => {
    let bin = ''
    for (let i = 0; i < d.length; i += 0x8000) bin += String.fromCharCode(...d.subarray(i, i + 0x8000))
    return btoa(bin)
  }
  const body = s.blocks.map((b: Block) => {
    switch (b.type) {
      case 'heading':
        return `<h${b.level}>${htmlInline(b.text).trim()}</h${b.level}>`
      case 'paragraph':
        return `<p>${htmlInline(b.text).trim()}</p>`
      case 'list':
        return `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((it) => `<li>${htmlInline(it).trim()}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`
      case 'table':
        return `<table><thead><tr>${b.rows[0].map((c) => `<th>${htmlEsc(c)}</th>`).join('')}</tr></thead><tbody>${b.rows
          .slice(1)
          .map((r) => `<tr>${r.map((c) => `<td>${htmlEsc(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      case 'image': {
        const mime = b.ext === 'jpg' ? 'image/jpeg' : b.ext === 'png' ? 'image/png' : 'image/jp2'
        return `<figure><img src="${inlineImages ? `data:${mime};base64,${b64(b.data)}` : `images/${b.name}`}" alt="" style="max-width:${Math.round(b.width * 1.333)}px"></figure>`
      }
      case 'pagebreak':
        return '<hr class="page-break">'
    }
  })
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><title>${htmlEsc(s.title || 'document')}</title>
<style>body{max-width:780px;margin:40px auto;padding:0 20px;font:16px/1.7 -apple-system,"PingFang SC",sans-serif;color:#222}
table{border-collapse:collapse;margin:1em 0}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f4f4f4}
img{max-width:100%}hr.page-break{border:0;border-top:1px dashed #ccc;margin:2em 0}</style></head>
<body>
${body.join('\n')}
</body></html>
`
}

// ── Word (.docx, WordprocessingML) ─────────────────────────────

const xmlEsc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function docxRuns(xs: Inline[], rels: string[]): string {
  return xs
    .map((x) => {
      if (!x.text) return ''
      const rpr = `${x.bold ? '<w:b/>' : ''}${x.italic ? '<w:i/>' : ''}${x.href ? '<w:color w:val="0563C1"/><w:u w:val="single"/>' : ''}`
      const run = `<w:r>${rpr ? `<w:rPr>${rpr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(x.text)}</w:t></w:r>`
      if (!x.href) return run
      rels.push(
        `<Relationship Id="rIdL${rels.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(x.href)}" TargetMode="External"/>`,
      )
      return `<w:hyperlink r:id="rIdL${rels.length}">${run}</w:hyperlink>`
    })
    .join('')
}

export function toDocx(s: DocStructure): Uint8Array {
  const rels: string[] = []
  const media: ZipEntry[] = []
  const paras: string[] = []
  let hasNumbering = false
  let imgId = 0
  for (const b of s.blocks) {
    switch (b.type) {
      case 'heading':
        paras.push(`<w:p><w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>${docxRuns(b.text, rels)}</w:p>`)
        break
      case 'paragraph':
        paras.push(`<w:p>${docxRuns(b.text, rels)}</w:p>`)
        break
      case 'list':
        hasNumbering = true
        for (const it of b.items)
          paras.push(
            `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${b.ordered ? 2 : 1}"/></w:numPr></w:pPr>${docxRuns(it, rels)}</w:p>`,
          )
        break
      case 'table': {
        const w = Math.max(...b.rows.map((r) => r.length))
        const cell = (t: string, head: boolean) =>
          `<w:tc><w:tcPr><w:tcW w:w="${Math.floor(9000 / w)}" w:type="dxa"/></w:tcPr><w:p><w:r>${head ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${xmlEsc(t.trim())}</w:t></w:r></w:p></w:tc>`
        paras.push(
          `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/><w:tblBorders>${[
            'top',
            'left',
            'bottom',
            'right',
            'insideH',
            'insideV',
          ]
            .map((e) => `<w:${e} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`)
            .join(
              '',
            )}</w:tblBorders></w:tblPr><w:tblGrid>${Array.from({ length: w }, () => `<w:gridCol w:w="${Math.floor(9000 / w)}"/>`).join('')}</w:tblGrid>${b.rows
            .map((r, i) => `<w:tr>${Array.from({ length: w }, (_, k) => cell(r[k] ?? '', i === 0)).join('')}</w:tr>`)
            .join('')}</w:tbl><w:p/>`,
        )
        break
      }
      case 'image': {
        if (b.ext === 'jp2') break
        imgId++
        const rid = `rIdImg${imgId}`
        media.push({ name: `word/media/${b.name}`, data: b.data })
        rels.push(
          `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${b.name}"/>`,
        )
        // EMU: 1pt = 12700
        const maxW = 6 * 914400
        let cx = Math.round(b.width * 12700)
        let cy = Math.round(b.height * 12700)
        if (cx > maxW) {
          cy = Math.round((cy * maxW) / cx)
          cx = maxW
        }
        paras.push(
          `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imgId}" name="Picture ${imgId}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${imgId}" name="${b.name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
        )
        break
      }
      case 'pagebreak':
        paras.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>')
        break
    }
  }
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`
  const heading = (n: number, size: number) =>
    `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${360 - n * 60}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="PingFang SC"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${heading(1, 36)}${heading(2, 30)}${heading(3, 26)}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/></w:pPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/></w:style></w:styles>`
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${hasNumbering ? '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' : ''}${rels.join('')}</Relationships>`
  const types = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>${hasNumbering ? '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' : ''}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`
  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(s.title)}</dc:title><dc:creator>Sail PDF</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`
  return makeZip([
    { name: '[Content_Types].xml', data: enc.encode(types) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'docProps/core.xml', data: enc.encode(core) },
    { name: 'word/document.xml', data: enc.encode(document) },
    { name: 'word/styles.xml', data: enc.encode(styles) },
    ...(hasNumbering ? [{ name: 'word/numbering.xml', data: enc.encode(numbering) }] : []),
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
    ...media,
  ])
}

export function toPlainText(s: DocStructure): string {
  return toMarkdown({ ...s, blocks: s.blocks.filter((b) => b.type !== 'image') })
    .replace(/\\([\\`*_[\]#<>|])/g, '$1')
    .replace(/^#+\s/gm, '')
    .replace(/\*\*|__/g, '')
}

/** package a structure in a format; text formats with images become .zip */
export function writeFormat(s: DocStructure, fmt: Format, stem: string): Output {
  const images = s.blocks.filter((b): b is Extract<Block, { type: 'image' }> => b.type === 'image')
  const bundle = (name: string, text: string, ext: string, mime: string, filterName: string): Output => {
    if (!hasImages(s)) return { data: enc.encode(text), ext, mime, filterName }
    return {
      data: makeZip([
        { name: `${stem}/${name}`, data: enc.encode(text) },
        ...images.map((im) => ({ name: `${stem}/images/${im.name}`, data: im.data })),
      ]),
      ext: 'zip',
      mime: 'application/zip',
      filterName: tr('ZIP 压缩包'),
    }
  }
  switch (fmt) {
    case 'docx':
      return {
        data: toDocx(s),
        ext: 'docx',
        mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        filterName: tr('Word 文档'),
      }
    case 'md':
      return bundle(`${stem}.md`, toMarkdown(s), 'md', 'text/markdown', 'Markdown')
    case 'tex':
      return bundle(`${stem}.tex`, toLatex(s), 'tex', 'application/x-tex', 'LaTeX')
    case 'html':
      return { data: enc.encode(toHtml(s, true)), ext: 'html', mime: 'text/html', filterName: tr('HTML 网页') }
    case 'txt':
      return { data: enc.encode(toPlainText(s)), ext: 'txt', mime: 'text/plain', filterName: tr('文本') }
  }
}
