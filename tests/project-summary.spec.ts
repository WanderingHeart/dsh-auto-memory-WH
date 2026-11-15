import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryStore } from '../src/store.ts'
import { applyConsolidationCandidates, buildConsolidationPrompt } from '../src/consolidate.ts'
import { renderMemoryIndexDetailAsync } from '../src/injection.ts'
import { cleanUserSummary, saveUserSummary } from '../src/project-summary.ts'
import type { Config } from '../src/index.ts'
import type { MemoryType } from '../src/types.ts'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { registerMemoryTools } from '../src/memory-tools.ts'
const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wh-layered-')); roots.push(root)
  return { root, store: new MemoryStore(root) }
}
const a=join(tmpdir(), 'wh-test-projects', 'synthetic', 'ackermann'), b=join(tmpdir(), 'wh-test-projects', 'synthetic', 'other')
const config={maxBytes:65536,enableUserScope:true,staleAfterDays:0} as Config
const summary='用户之前完成过阿克曼小车项目。'
const detail='用户已完成阿克曼小车项目；该项目使用专用虚拟机，VM_DETAIL_ONLY 为项目内部环境标识。'
const candidate=(type: MemoryType='project') => ({name:'ackermann-experience',type,scope:'project',description:detail,body:detail,userSummary:summary,evidence:detail,importance:8})
async function apply(store: MemoryStore, candidates=[candidate()], enabled=true, cwd=a) {
  return applyConsolidationCandidates({store,cwd,candidates,options:{enableUserScope:enabled,minImportance:0,autoSummarizeMaxMemories:5,autoSummarizeDedupe:true},sessionId:'synthetic-layered',transcript:detail})
}
describe('two-level memory',()=>{
  for(const type of ['user','feedback','reference','project'] as const) it(`${type}: persists detail within project and abstract across projects`,async()=>{
    const {store,root}=await fixture(); const tally=await apply(store,[candidate(type)])
    expect(tally.summaries[0]?.result).toBe('written')
    const reopened=new MemoryStore(root)
    expect((await reopened.read('ackermann-experience','project',a))?.body).toContain('VM_DETAIL_ONLY')
    const globals=await reopened.list('user',b)
    expect(globals).toHaveLength(1); expect(globals[0]?.type).toBe(type); expect(globals[0]?.body).toBe(summary)
    expect(JSON.stringify(globals)).not.toContain('VM_DETAIL_ONLY'); expect(globals[0]?.evidence).toBeUndefined()
    expect((await renderMemoryIndexDetailAsync(reopened,config,a)).text).toContain('VM_DETAIL_ONLY')
    const other=await renderMemoryIndexDetailAsync(reopened,config,b)
    expect(other.text).toContain(summary); expect(other.text).not.toContain('VM_DETAIL_ONLY')
    expect(await reopened.read('ackermann-experience','project',b)).toBeNull()
  })
  it('does not overwrite a same-named user fact with project detail',async()=>{
    const {store}=await fixture(); await store.write({name:'ackermann-experience',type:'project',description:'Original global fact',body:'Original global fact'},'user',a)
    await apply(store)
    expect((await store.read('ackermann-experience','user',a))?.body).toBe('Original global fact')
    expect((await store.read('ackermann-experience','project',a))?.body).toBe(detail)
  })
  it('updates the same abstract without duplicates and keeps two projects distinct',async()=>{
    const {store}=await fixture(); await apply(store); await apply(store)
    expect(await store.list('user',a)).toHaveLength(1)
    await apply(store,[{...candidate(),userSummary:'用户完成阿克曼小车项目并积累了调试经验。'}])
    expect(await store.list('user',a)).toHaveLength(1)
    expect((await store.list('user',a))[0]?.body).toContain('调试经验')
    await apply(store,[candidate()],true,b)
    expect(await store.list('user',a)).toHaveLength(2)
  })
  it('keeps a stable abstract when project fact is superseded',async()=>{
    const {store}=await fixture()
    await apply(store,[{...candidate(),description:'Uses 4 GB memory',body:'Uses 4 GB memory'}])
    const result=await apply(store,[{...candidate(),description:'Uses 8 GB memory',body:'Uses 8 GB memory',userSummary:'用户有阿克曼小车项目调试经验。'}])
    expect(result.superseded).toHaveLength(1)
    expect(await store.list('user',a)).toHaveLength(1)
    expect((await store.list('user',a))[0]?.body).toBe('用户有阿克曼小车项目调试经验。')
  })
  it('honors disabled user scope',async()=>{
    const {store}=await fixture(); const result=await apply(store,[candidate()],false)
    expect(result.summaries[0]?.result).toBe('disabled'); expect(await store.list('user',a)).toHaveLength(0)
    expect(await store.list('project',a)).toHaveLength(1)
  })
  it.each([undefined,null,'', 'x'.repeat(161),'private\nmultiline','My VM is C:\\private\\image','password: demo-password','See https://private.example'])('never falls back to copying details for invalid summary %s',async raw=>{
    const {store}=await fixture(); const result=await applyConsolidationCandidates({store,cwd:a,candidates:[{...candidate(),userSummary:raw}],options:{enableUserScope:true,minImportance:0,autoSummarizeMaxMemories:5,autoSummarizeDedupe:true},sessionId:'synthetic',transcript:detail})
    expect(await store.list('user',a)).toHaveLength(0); expect(await store.list('project',a)).toHaveLength(1)
    expect(['missing','invalid']).toContain(result.summaries[0]?.result)
  })
  it('does not promote disputed project records',async()=>{
    const {store}=await fixture(); const source=await store.write({name:'disputed-source',type:'project',description:detail,body:detail,status:'disputed'},'project',a)
    expect(await saveUserSummary(store,source!,a,summary,true)).toBe('blocked')
    expect(await store.list('user',a)).toHaveLength(0)
  })
  it('summary storage failure retains project detail and reports failure',async()=>{
    const {store}=await fixture(); const write=store.write.bind(store)
    vi.spyOn(store,'write').mockImplementation(async (record,scope,cwd)=>{ if(scope==='user') throw new Error('synthetic failure'); return write(record,scope,cwd) })
    const result=await apply(store)
    expect(result.summaries[0]?.result).toBe('failed'); expect(await store.list('project',a)).toHaveLength(1)
  })
  it('never revives an explicitly blocked user summary',async()=>{
    const {store}=await fixture(); await apply(store)
    const record=(await store.list('user',a))[0]!
    await store.write({...record,disabled:true},'user',a)
    const result=await apply(store)
    expect(result.summaries[0]?.result).toBe('blocked')
    expect((await renderMemoryIndexDetailAsync(store,config,b)).text).toBe('')
  })
  it('reuses the model extraction request and explains both scopes in the prompt',()=>{
    const prompt=buildConsolidationPrompt([],detail,5)
    expect(prompt).toContain('userSummary');expect(prompt).toContain('all work in both scopes')
    expect(prompt).not.toContain('Use scope "user" only for user-global preferences')
    expect(cleanUserSummary(summary)).toBe(summary)
  })
  it('memory_write saves and exposes both levels',async()=>{
    const {store}=await fixture(); const ctx=new Context()
    try {
      await ctx.plugin(SystemPrompt,{});await ctx.plugin(ToolRuntime,{})
      registerMemoryTools(ctx,store,true)
      const {importance,evidence,...args}=candidate()
      const result=await ctx.tools.get('memory_write')!.execute(args as never,{agent:{session:{id:'synthetic',header:{cwd:a}}}} as never)
      expect(result).toMatchObject({userSummary:'written'})
      expect((await store.list('user',b))[0]?.body).toBe(summary)
    } finally { await ctx.fiber.dispose() }
  })
})
