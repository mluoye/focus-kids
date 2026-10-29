/**
 * 孩子端直接把文本放进 {{ }}，这里把 Markdown 记号去掉，避免出现星号。
 */
export function stripAiMarkup(source: string): string {
  if (!source) return ''
  return source
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*+]\s+/gm, '· ')
}

/**
 * 极简 Markdown 渲染：大模型经常返回 `**加粗**`、`- 列表`，直接 {{ }} 会露出星号。
 * 只支持加粗、行内代码、无序列表和空行，其余一律当纯文本处理。
 * 先转义 HTML，因此可以安全地交给 v-html。
 */
export function renderAiText(source: string): string {
  if (!source) return ''
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

  return escaped
    .split(/\r?\n/)
    .map((raw) => {
      const line = raw.trim()
      if (!line) return '<div class="ai-gap"></div>'
      const html = line
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
      if (/^[-*+]\s+/.test(html)) {
        return `<div class="ai-line ai-line--li">${html.replace(/^[-*+]\s+/, '')}</div>`
      }
      if (/^#{1,6}\s+/.test(html)) {
        return `<div class="ai-line ai-line--h">${html.replace(/^#{1,6}\s+/, '')}</div>`
      }
      return `<div class="ai-line">${html}</div>`
    })
    .join('')
}
