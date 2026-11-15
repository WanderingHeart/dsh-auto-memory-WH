import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

/** Use the host's current, durably projected directory when it is available. */
export function effectiveProjectCwd(ctx: Context, session: { header: { cwd?: string } } | undefined): string | undefined {
  if (!session) return undefined
  const workingDirectory = ctx.get('workingDirectory') as { get?: (session: unknown) => unknown } | undefined
  if (workingDirectory !== undefined) {
    if (typeof workingDirectory.get !== 'function') return undefined
    try {
      const current = workingDirectory.get(session)
      return typeof current === 'string' && isAbsolute(current) ? current : undefined
    } catch {
      return undefined
    }
  }
  const original = session.header.cwd
  return typeof original === 'string' && isAbsolute(original) ? original : undefined
}
