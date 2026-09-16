/** Language-level duration quantities only. Whether they describe newly
 * completed actions is decided against the candidate by the time auditor. */
export interface NarrativeDurationAnchor { id: number; excerpt: string; quantity: string; minimumMinutes: number }

const numeralDigits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9 }
const numeralUnits: Record<string, number> = { 十: 10, 百: 100, 千: 1000 }

function quantityNumber(value: string): number | undefined {
  if (/^\d+$/.test(value)) return Number(value)
  let amount = 0, digit = 0
  for (const character of value) {
    if (character in numeralUnits) {
      amount += (digit || 1) * numeralUnits[character]
      digit = 0
    } else if (character in numeralDigits) digit = numeralDigits[character]
    else return undefined
  }
  return amount + digit
}

export function narrativeDurationAnchors(script: string): NarrativeDurationAnchor[] {
  const anchors: NarrativeDurationAnchor[] = []
  const seen = new Set<string>()
  const pattern = /((?:\d{1,4}|[零〇一二两三四五六七八九十百千]{1,8}))(?:个)?(半)?(?:来|多|余|几)?(分钟|小时|钟头|天)/g
  for (const match of script.matchAll(pattern)) {
    const at = match.index ?? 0
    // A clock's minute component is not an elapsed duration.
    if (/[点时:：]/.test(script[at - 1] ?? '')) continue
    const amount = quantityNumber(match[1])
    if (!amount || !Number.isFinite(amount)) continue
    const unit = match[3]
    const minutes = (amount + (match[2] ? 0.5 : 0)) * (unit === '分钟' ? 1 : unit === '天' ? 1440 : 60)
    const left = Math.max(0, at - 70)
    const right = Math.min(script.length, at + match[0].length + 70)
    const excerpt = script.slice(left, right)
    const key = `${at}:${match[0]}`
    if (seen.has(key)) continue
    seen.add(key)
    anchors.push({ id: anchors.length + 1, excerpt, quantity: match[0], minimumMinutes: minutes })
    if (anchors.length >= 24) break
  }
  return anchors
}
