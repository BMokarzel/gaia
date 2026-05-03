// ─────────────────────────────────────────────────────────────
// Minimal markdown → HTML renderer (shared by DocModal and ChatPanel).
//
// Supports: headings, paragraphs, ul/ol, fenced code blocks, inline
// `code`, **bold**, *italic*/_italic_, [text](url), blockquotes, hr.
// All non-code text is HTML-escaped first; inline syntax is then
// applied on the escaped output.
// ─────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function applyInline(s: string): string {
  // s is already HTML-escaped — markdown delimiters survive escaping.
  // Order matters: code first (its content shouldn't get further inline parsing).
  const parts: string[] = []
  let i = 0
  while (i < s.length) {
    const tickStart = s.indexOf('`', i)
    if (tickStart === -1) { parts.push(transformInline(s.slice(i))); break }
    const tickEnd = s.indexOf('`', tickStart + 1)
    if (tickEnd === -1) { parts.push(transformInline(s.slice(i))); break }
    parts.push(transformInline(s.slice(i, tickStart)))
    parts.push(`<code>${s.slice(tickStart + 1, tickEnd)}</code>`)
    i = tickEnd + 1
  }
  return parts.join('')
}

function transformInline(s: string): string {
  // Links: [text](url) — url already escaped (& → &amp;, " → &quot;)
  let out = s.replace(
    /\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_m, text, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${text}</a>`,
  )
  // Bold (**...** before *...*) — non-greedy, no newlines
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  // Italic *...* (avoid matching inside already-replaced strong is moot since strong is non-greedy)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  // Italic _..._
  out = out.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>')
  return out
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []

  type ListMode = { type: 'ul' | 'ol'; indent: number }
  let listStack: ListMode[] = []
  let paraBuf: string[] = []
  let inFence = false
  let fenceLang = ''
  let fenceBuf: string[] = []

  const closeLists = (toDepth: number) => {
    while (listStack.length > toDepth) {
      const m = listStack.pop()!
      out.push(`</${m.type}>`)
    }
  }
  const flushPara = () => {
    if (paraBuf.length === 0) return
    const text = paraBuf.join(' ').trim()
    if (text) out.push(`<p>${applyInline(escapeHtml(text))}</p>`)
    paraBuf = []
  }

  for (const raw of lines) {
    // Fenced code block
    if (inFence) {
      if (/^```\s*$/.test(raw)) {
        inFence = false
        const langCls = fenceLang ? ` class="lang-${escapeHtml(fenceLang)}"` : ''
        out.push(`<pre><code${langCls}>${escapeHtml(fenceBuf.join('\n'))}</code></pre>`)
        fenceBuf = []
        fenceLang = ''
        continue
      }
      fenceBuf.push(raw)
      continue
    }
    const fenceOpen = raw.match(/^```\s*([A-Za-z0-9_-]*)\s*$/)
    if (fenceOpen) {
      flushPara()
      closeLists(0)
      inFence = true
      fenceLang = fenceOpen[1] ?? ''
      continue
    }

    // Blank line
    if (/^\s*$/.test(raw)) {
      flushPara()
      closeLists(0)
      continue
    }

    // Heading
    const h = raw.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushPara()
      closeLists(0)
      const level = Math.min(h[1].length, 4)
      out.push(`<h${level}>${applyInline(escapeHtml(h[2]))}</h${level}>`)
      continue
    }

    // Horizontal rule
    if (/^\s*---+\s*$/.test(raw) || /^\s*\*\*\*+\s*$/.test(raw)) {
      flushPara()
      closeLists(0)
      out.push('<hr />')
      continue
    }

    // Blockquote
    const bq = raw.match(/^\s*>\s?(.*)$/)
    if (bq) {
      flushPara()
      closeLists(0)
      out.push(`<blockquote>${applyInline(escapeHtml(bq[1]))}</blockquote>`)
      continue
    }

    // List items
    const ul = raw.match(/^(\s*)[-*]\s+(.*)$/)
    const ol = raw.match(/^(\s*)\d+\.\s+(.*)$/)
    if (ul || ol) {
      flushPara()
      const m = (ul ?? ol)!
      const indent = m[1].length
      const content = m[2]
      const type: 'ul' | 'ol' = ul ? 'ul' : 'ol'

      // adjust list stack to indent depth
      while (listStack.length > 0 && listStack[listStack.length - 1].indent > indent) {
        const popped = listStack.pop()!
        out.push(`</${popped.type}>`)
      }
      const top = listStack[listStack.length - 1]
      if (!top || top.indent < indent || top.type !== type) {
        if (top && top.indent === indent && top.type !== type) {
          out.push(`</${top.type}>`)
          listStack.pop()
          out.push(`<${type}>`)
          listStack.push({ type, indent })
        } else {
          out.push(`<${type}>`)
          listStack.push({ type, indent })
        }
      }
      out.push(`<li>${applyInline(escapeHtml(content))}</li>`)
      continue
    }

    // Paragraph accumulation (collapses lists)
    if (listStack.length > 0) closeLists(0)
    paraBuf.push(raw)
  }

  // Flush remaining state
  if (inFence) {
    out.push(`<pre><code>${escapeHtml(fenceBuf.join('\n'))}</code></pre>`)
  }
  flushPara()
  closeLists(0)

  return out.join('\n')
}
