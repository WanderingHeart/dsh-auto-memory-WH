/**
 * Host capability self-check and degraded diagnostics.
 *
 * DSH plugins run in-process against host services. When a host update changes
 * a plugin-facing API shape, the old code can throw during `apply`, which the
 * host may surface as a failed bundle: the panel entry disappears and the user
 * has no in-app explanation.
 *
 * This module runs before the real registrations. It only inspects the shape of
 * the services this plugin uses (cheap `typeof` checks), so a mismatch can be
 * reported through a read-only tool + management route instead of leaving the
 * user with a silently missing sidebar entry.
 *
 * It is intentionally conservative: a missing capability means "do not start
 * the memory engine", never "guess and write anyway".
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { API_BASE, PACKAGE_NAME } from './identity.ts'

export interface CompatIssue {
  capability: string
  detail: string
}

type ServiceShape = Record<string, unknown> | undefined

function shape(ctx: Context, service: string): ServiceShape {
  try {
    const value = (ctx as unknown as { get?: (name: string) => unknown }).get?.(service)
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/** Returns every host capability this plugin depends on that is missing/renamed. */
export function inspectCapabilities(ctx: Context): CompatIssue[] {
  const issues: CompatIssue[] = []
  const tools = shape(ctx, 'tools')
  const prompt = shape(ctx, 'systemPrompt')
  const note = (capability: string, detail: string): void => { issues.push({ capability, detail }) }

  if (typeof tools?.register !== 'function') note('tools.register', 'tool registration is unavailable')
  if (typeof prompt?.section !== 'function') note('systemPrompt.section', 'prompt section registration is unavailable')
  if (typeof (ctx as unknown as { on?: unknown }).on !== 'function') note('ctx.on', 'event subscription is unavailable')
  if (typeof (ctx as unknown as { effect?: unknown }).effect !== 'function') note('ctx.effect', 'effect registration is unavailable')
  if (typeof (ctx as unknown as { inject?: unknown }).inject !== 'function') note('ctx.inject', 'service injection is unavailable')

  const connection = shape(ctx, 'connection')
  if (connection !== undefined) {
    const fetchShape = connection.fetch as Record<string, unknown> | undefined
    if (typeof fetchShape?.register !== 'function') note('connection.fetch.register', 'management API registration is unavailable')
    if (typeof connection.requestRejection !== 'function') note('connection.requestRejection', 'host request authentication is unavailable')
  }
  return issues
}

export interface CompatReport {
  ok: boolean
  package: string
  checkedAt: string
  issues: CompatIssue[]
  guidance: string
}

export function buildCompatReport(issues: CompatIssue[]): CompatReport {
  return {
    ok: issues.length === 0,
    package: PACKAGE_NAME,
    checkedAt: new Date().toISOString(),
    issues,
    guidance: issues.length === 0
      ? 'Host capabilities look compatible.'
      : 'The memory engine was not started because a host capability is missing or renamed. Memory files are untouched. Update the plugin, or reinstall a candidate that targets this DSH version, then restart DSH. See docs/update-compatibility.md.',
  }
}

/**
 * Registers the smallest possible surface when the engine cannot start:
 * a read-only tool and a read-only management route that explain the mismatch.
 * Never throws: a degraded plugin must not become a failed plugin.
 */
export function registerCompatDiagnostics(ctx: Context, issues: CompatIssue[]): void {
  const report = buildCompatReport(issues)
  console.warn(`[${PACKAGE_NAME}] compatibility self-check failed; memory engine not started: ${JSON.stringify(issues)}`)

  const tools = shape(ctx, 'tools')
  if (typeof tools?.register === 'function' && typeof tools.get === 'function') {
    try {
      if (tools.get('memory_wh_compat') === undefined) {
        tools.register(defineTool({
          name: 'memory_wh_compat',
          description: 'Read-only compatibility report for the memory plugin. The memory engine did not start because this DSH host changed a plugin-facing capability.',
          parameters: {},
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                ok: { type: 'boolean', required: true },
                package: { type: 'string', required: true },
                checkedAt: { type: 'string', required: true },
                guidance: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
          },
          async execute() {
            return { ok: report.ok, package: report.package, checkedAt: report.checkedAt, guidance: report.guidance }
          },
        }))
      }
    } catch (error) {
      console.warn(`[${PACKAGE_NAME}] could not register compatibility tool: ${String(error)}`)
    }
  }

  try {
    ctx.inject(['connection'], fiberCtx => {
      const connection = fiberCtx.get('connection') as { fetch?: { register?: (options: unknown) => () => void } } | undefined
      const register = connection?.fetch?.register
      if (typeof register !== 'function') return
      fiberCtx.effect(() => register.call(connection!.fetch, {
        path: `${API_BASE}/compat.status`,
        methods: ['GET'],
        requestBody: 'streamed',
        fetch: async () => new Response(JSON.stringify(report), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }),
      }), 'WH compatibility status route')
    })
  } catch (error) {
    console.warn(`[${PACKAGE_NAME}] could not register compatibility route: ${String(error)}`)
  }
}
