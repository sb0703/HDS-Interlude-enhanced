/** Normalize only model-produced visible-message separators. Story prose and
 * incoming user text must never pass through this compatibility layer. */
export function normalizeMessageSeparators(value: unknown, separator = '<sep/>') {
  const canonical = separator.trim() || '<sep/>'
  return String(value ?? '').replace(/[<＜]\s*sep\s*\/?\s*[>＞]/gi, canonical)
}

