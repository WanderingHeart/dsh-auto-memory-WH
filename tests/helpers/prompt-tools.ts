import type { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'

/** New hosts split prompt tool presentation from the registry. No model/tool execution here. */
export async function mountPromptTools(ctx: Context): Promise<void> {
  await ctx.plugin(ToolRuntime, {})
  await ctx.plugin({
    inject: ['tools'],
    apply(scope: Context) {
      const tools = scope.tools as Context['tools'] & {
        setExecutor?: (executor: {
          describe: () => { schemas: ReturnType<Context['tools']['schemas']> }
          execute: () => never
        }) => void
      }
      tools.setExecutor?.({
        describe: () => ({ schemas: tools.schemas() }),
        execute: () => { throw new Error('Prompt fixture does not execute tools') },
      })
    },
  })
}
