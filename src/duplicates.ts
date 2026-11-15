/**
 * Near-duplicate detection for the management panel.
 *
 * Read-only, local, deterministic: it never rewrites or merges records, it only
 * groups records whose normalized text overlaps above a threshold. The panel
 * shows the groups; merging/archiving remains a human decision.
 */

export interface DuplicateCandidate {
  name: string
  title?: string
  description: string
  type: string
  status?: string
  revision: string
  updatedMs?: number
}

export interface DuplicateGroup {
  /** Highest pairwise similarity inside the group, in [threshold, 1]. */
  similarity: number
  members: DuplicateCandidate[]
}

export interface DuplicateOptions {
  threshold?: number
  sameTypeOnly?: boolean
  maxRecords?: number
  maxBodyChars?: number
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/u

/** Lowercase, strip markdown punctuation and collapse whitespace. */
export function normalizeForCompare(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[`*_>#~[\](){}|\\]/g, ' ')
    .replace(/[.,;:!?'"“”‘’、。，；：！？（）【】《》…—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Word tokens for latin text and character bigrams for CJK text. Bigrams keep
 * the comparison useful for Chinese, where whitespace tokenization does not
 * apply and single characters are too ambiguous.
 */
export function tokenize(text: string): Set<string> {
  const normalized = normalizeForCompare(text)
  const tokens = new Set<string>()
  for (const chunk of normalized.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]+|[^\s]+/gu) ?? []) {
    if (CJK.test(chunk)) {
      for (const char of chunk) tokens.add(char)
      for (let i = 0; i + 1 < chunk.length; i += 1) tokens.add(chunk.slice(i, i + 2))
    } else {
      tokens.add(chunk)
    }
  }
  return tokens
}

export function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const token of a) if (b.has(token)) shared += 1
  return shared / (a.size + b.size - shared)
}

export function candidateText(record: DuplicateCandidate & { body?: string }, maxBodyChars = 4000): string {
  // The body is what the model reads; names are expected to differ between
  // duplicates, so they must not dominate the comparison.
  const body = (record.body ?? '').slice(0, maxBodyChars).trim()
  return body.length > 0 ? body : [record.title ?? '', record.description].join(' ')
}

/**
 * Group records whose pairwise similarity is at or above `threshold`.
 *
 * Records of different types are only compared when `sameTypeOnly` is false.
 * The scan is bounded: at most `maxRecords` records and `maxBodyChars` body
 * characters per record, so a large scope cannot stall the panel request.
 */
export function findNearDuplicateGroups(
  records: Array<DuplicateCandidate & { body?: string }>,
  options: DuplicateOptions = {},
): DuplicateGroup[] {
  const threshold = clamp(options.threshold ?? 0.8, 0.5, 1)
  const sameTypeOnly = options.sameTypeOnly ?? true
  const maxRecords = clampInt(options.maxRecords ?? 300, 2, 2000)
  const maxBodyChars = clampInt(options.maxBodyChars ?? 4000, 200, 8000)
  const candidates = records.slice(0, maxRecords)
  const tokens = candidates.map(record => tokenize(candidateText(record, maxBodyChars)))
  const parent = candidates.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root]!
    while (parent[index] !== root) { const next = parent[index]!; parent[index] = root; index = next }
    return root
  }
  const union = (a: number, b: number): void => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra }
  const best = new Map<number, number>()
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      if (sameTypeOnly && candidates[i]!.type !== candidates[j]!.type) continue
      const score = similarity(tokens[i]!, tokens[j]!)
      if (score < threshold) continue
      union(i, j)
      const root = find(i)
      if (score > (best.get(root) ?? 0)) best.set(root, score)
    }
  }
  const buckets = new Map<number, number[]>()
  for (let i = 0; i < candidates.length; i += 1) {
    const root = find(i)
    const bucket = buckets.get(root)
    if (bucket) bucket.push(i)
    else buckets.set(root, [i])
  }
  const groups: DuplicateGroup[] = []
  for (const indexes of buckets.values()) {
    if (indexes.length < 2) continue
    const members = indexes.map(index => candidates[index]!).sort((a, b) => a.name.localeCompare(b.name))
    const similarityScore = Math.max(...indexes.map(index => best.get(find(index)) ?? threshold))
    groups.push({ similarity: round(similarityScore), members })
  }
  groups.sort((a, b) => b.members.length - a.members.length || b.similarity - a.similarity)
  return groups
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

function clampInt(value: number, min: number, max: number): number {
  return Math.floor(clamp(value, min, max))
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
