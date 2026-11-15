/** Explicitly reviewed synthetic fixtures for legacy index/ranking tests.
 * Trust-default tests use the real MemoryStore directly; production never imports this helper.
 */
import { MemoryStore, detectDirectivePattern, renderIndexBody, type MemoryWriteInput } from '../../src/store.ts'
import type { MemoryRecord, MemoryScope } from '../../src/types.ts'
export class ReviewedFixtureStore extends MemoryStore {
  override write(record: MemoryWriteInput, scope: MemoryScope, cwd?: string): Promise<MemoryRecord | null> {
    const dangerous = detectDirectivePattern(record.body) || detectDirectivePattern(record.description)
    return super.write({ ...record, ...(record.status === undefined && !dangerous ? { status: 'verified' as const } : {}) }, scope, cwd)
  }
}
export function renderReviewedIndexBody(records: MemoryRecord[]): string {
  return renderIndexBody(records.map(record => ({ ...record, status: record.status ?? 'verified' })))
}
