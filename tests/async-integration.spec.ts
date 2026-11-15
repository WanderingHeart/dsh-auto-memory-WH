import {describe,it,expect,vi} from 'vitest'
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Context} from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../src/index.ts'
import {MemoryStore} from '../src/store.ts'
import {readAudit,registerInjectionAudit} from '../src/audit-log.ts'
describe('async prompt assembly integration',()=>{
 it('injects only reviewed current content and audits each real assembly',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'wh-async-integration-')),ctx=new Context(),cwd=join(root,'synthetic-project')
  try {
   await ctx.plugin(SystemPrompt,{})
   await ctx.plugin(ToolRuntime,{})
   await ctx.plugin(plugin,{maxBytes:4096,memoryDir:root,enableUserScope:true,autoSummarize:false,autoSummarizeMaxMemories:5,autoSummarizeMaxTokens:2048,minImportance:4,staleAfterDays:0})
   const store=new MemoryStore(root),agent={session:{id:'synthetic-session',header:{cwd}}}
   await store.write({name:'alpha',description:'safe synthetic',body:'synthetic fact',type:'reference',status:'verified'},'user')
   const first=(await ctx.systemPrompt.assemble({agent} as any)).sections.find(s=>s.name==='memory-wh:index')
   expect(first?.text).toContain('alpha')
   const file=join(root,'_user','alpha.md'),raw=await fs.readFile(file,'utf8')
   await fs.writeFile(file,raw.replace('synthetic fact','externally edited fact'))
   const second=(await ctx.systemPrompt.assemble({agent} as any)).sections.find(s=>s.name==='memory-wh:index')
   expect(second?.text).toContain('alpha')
   await registerInjectionAudit(store,{maxBytes:4096} as any,root).flush()
   const audit=await readAudit(root)
   expect(audit).toHaveLength(2)
   expect(audit.map(row=>row.bytes)).toEqual([Buffer.byteLength(first!.text),Buffer.byteLength(second!.text)])
   expect(audit[1].excluded?.some(row=>row.reason==='candidate')).toBe(false)
   await fs.writeFile(file,raw)
   await store.write({name:'project-seed',description:'synthetic project',body:'candidate',type:'reference'},'project',cwd)
   await fs.writeFile(join(store.dir('project',cwd),'.wh-transaction.json'),'synthetic busy journal')
   const unavailable=(await ctx.systemPrompt.assemble({agent} as any)).sections.find(s=>s.name==='memory-wh:index')
   expect(unavailable?.text).toBe('')
   await registerInjectionAudit(store,{maxBytes:4096} as any,root).flush()
   const finalAudit=await readAudit(root)
   expect(finalAudit).toHaveLength(3)
   expect(finalAudit[2].issues).toContain('project:storage-unavailable')
   expect(finalAudit[2].bytes).toBe(0)
  } finally {await ctx.fiber.dispose();await fs.rm(root,{recursive:true,force:true})}
 })
 it('keeps concurrent project assemblies isolated and respects a complete prompt',async()=>{
  const root=await fs.mkdtemp(join(tmpdir(),'wh-async-boundary-')),ctx=new Context()
  const cwdA=join(root,'project-a'),cwdB=join(root,'project-b')
  try {
   await ctx.plugin(SystemPrompt,{})
   await ctx.plugin(ToolRuntime,{})
   ctx.on('system-prompt/assemble',async(_assembly,_context,next)=>{
    const result=await next()
    return {...result,variables:{...result.variables,boundary_marker:'other-listener'}}
   })
   await ctx.plugin(plugin,{maxBytes:4096,memoryDir:root,enableUserScope:true,autoSummarize:false,autoSummarizeMaxMemories:5,autoSummarizeMaxTokens:2048,minImportance:4,staleAfterDays:0})
   const store=new MemoryStore(root)
   await store.write({name:'shared',description:'user only',body:'user body',type:'reference',status:'verified'},'user')
   await store.write({name:'local',description:'only alpha',body:'alpha body',type:'project',status:'verified'},'project',cwdA)
   await store.write({name:'local',description:'only beta',body:'beta body',type:'project',status:'verified'},'project',cwdB)
   const agent=(id:string,cwd:string)=>({session:{id,header:{cwd}}})
   const [assemblyA,assemblyB]=await Promise.all([
    ctx.systemPrompt.assemble({agent:agent('a',cwdA)} as any),
    ctx.systemPrompt.assemble({agent:agent('b',cwdB)} as any),
   ])
   const text=(assembly:any)=>assembly.sections.find((s:any)=>s.name==='memory-wh:index')?.text ?? ''
   expect(text(assemblyA)).toContain('only alpha')
   expect(text(assemblyA)).not.toContain('only beta')
   expect(text(assemblyB)).toContain('only beta')
   expect(text(assemblyB)).not.toContain('only alpha')
   expect(text(assemblyA)).toContain('user only')
   expect(text(assemblyB)).toContain('user only')
   expect(assemblyA.variables.boundary_marker).toBe('other-listener')
   expect(assemblyB.variables.boundary_marker).toBe('other-listener')
   expect(text(await ctx.systemPrompt.assemble({}))).toBe('')
   const controller=new AbortController()
   controller.abort()
   expect(text(await ctx.systemPrompt.assemble({agent:agent('a',cwdA),signal:controller.signal} as any))).toBe('')
   const originalScan=MemoryStore.prototype.scanAsync
   let release!:()=>void,started!:()=>void
   const gate=new Promise<void>(resolve=>{release=resolve})
   const entered=new Promise<void>(resolve=>{started=resolve})
   const scanSpy=vi.spyOn(MemoryStore.prototype,'scanAsync').mockImplementation(async function(this:MemoryStore,...args:Parameters<MemoryStore['scanAsync']>){started();await gate;return originalScan.apply(this,args)})
   try {
    const during=new AbortController()
    const pending=ctx.systemPrompt.assemble({agent:agent('a',cwdA),signal:during.signal} as any)
    await entered
    during.abort()
    release()
    expect(text(await pending)).toBe('')
   } finally {release();scanSpy.mockRestore()}
   ctx.systemPrompt.section({name:'synthetic-complete',order:9000,text:'complete only',complete:true})
   const complete=await ctx.systemPrompt.assemble({agent:agent('a',cwdA)} as any)
   expect(complete.sections).toEqual([{name:'synthetic-complete',text:'complete only'}])
   await registerInjectionAudit(store,{maxBytes:4096} as any,root).flush()
   const audit=await readAudit(root)
   expect(audit).toHaveLength(5)
   expect(audit.every(row=>row.kind==='render_attempt')).toBe(true)
   expect(audit[2].issues).toContain('assembly-aborted')
   expect(audit[2].bytes).toBe(0)
   expect(audit[3].issues).toContain('assembly-aborted')
   expect(audit[3].bytes).toBe(0)
  } finally {await ctx.fiber.dispose();await fs.rm(root,{recursive:true,force:true})}
 })
})
