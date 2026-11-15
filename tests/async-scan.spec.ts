import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'
import {promises as fs} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {MemoryStore} from '../src/store.ts'
let root:string,store:MemoryStore
beforeEach(async()=>{root=await fs.mkdtemp(join(tmpdir(),'wh-async-scan-'));store=new MemoryStore(root)})
afterEach(async()=>{vi.restoreAllMocks();await fs.rm(root,{recursive:true,force:true})})
describe('bounded async scan is fail-closed',()=>{
 it('matches synchronous scan for reviewed records and detects external semantic change',async()=>{
  await store.write({name:'alpha',description:'synthetic',body:'original',type:'reference',status:'verified'},'user')
  expect(await store.scanAsync('user')).toEqual(store.scanSync('user'))
  const file=join(root,'_user','alpha.md'),raw=await fs.readFile(file,'utf8')
  await fs.writeFile(file,raw.replace('original','changed outside'))
  const asyncValue=await store.scanAsync('user')
  expect(asyncValue).toEqual(store.scanSync('user'))
  expect(asyncValue.records[0].status).toBe('candidate')
 })
 it('preserves file-order results under concurrent reads',async()=>{
  await store.write({name:'seed',description:'synthetic',body:'safe',type:'reference',status:'verified'},'user')
  const raw=await fs.readFile(join(root,'_user','seed.md'),'utf8')
  await Promise.all(Array.from({length:32},(_,i)=>fs.writeFile(join(root,'_user',`record-${i}.md`),raw.replace('name: seed',`name: record-${i}`))))
  expect(await store.scanAsync('user')).toEqual(store.scanSync('user'))
 })
 it('refuses unknown format and active transaction lock without modifying files',async()=>{
  await store.write({name:'alpha',description:'synthetic',body:'safe',type:'reference',status:'verified'},'user')
  const marker=join(root,'.wh-format.json'),original=await fs.readFile(marker,'utf8')
  await fs.writeFile(marker,JSON.stringify({format:'dsh-auto-memory-wh',version:99}))
  expect((await store.scanAsync('user')).issues).toEqual(['storage-unavailable'])
  await fs.writeFile(marker,original)
  await fs.writeFile(join(root,'.wh-writer.lock'),'synthetic lock')
  expect((await store.scanAsync('user')).issues).toEqual(['storage-unavailable'])
  expect(await fs.readFile(marker,'utf8')).toBe(original)
 })
 it('keeps same-name user and project records separate and rejects an injected file link',async()=>{
  const cwd=join(root,'synthetic-project')
  await store.write({name:'alpha',description:'user',body:'user fact',type:'reference',status:'verified'},'user')
  await store.write({name:'alpha',description:'project',body:'project fact',type:'reference',status:'verified'},'project',cwd)
  expect((await store.scanAsync('user')).records[0].body).toBe('user fact')
  expect((await store.scanAsync('project',cwd)).records[0].body).toBe('project fact')
  const outside=join(root,'outside-directory')
  await fs.mkdir(outside)
  await fs.symlink(outside,join(root,'_user','linked.md'),process.platform==='win32'?'junction':'dir')
  expect(await store.scanAsync('user')).toEqual(store.scanSync('user'))
  expect((await store.scanAsync('user')).issues).toContain('unsafe-file')
 })
 it('rejects oversized and malformed source files without returning a partial trusted set',async()=>{
  await store.write({name:'alpha',description:'synthetic',body:'safe',type:'reference',status:'verified'},'user')
  await fs.writeFile(join(root,'_user','broken.md'),'not frontmatter')
  expect(await store.scanAsync('user')).toEqual(store.scanSync('user'))
  await fs.writeFile(join(root,'_user','huge.md'),'x'.repeat(1024*1024+1))
  expect((await store.scanAsync('user')).issues).toEqual(['storage-unavailable'])
  expect((await store.scanAsync('user')).records).toHaveLength(0)
 })
 it('returns no reviewed records when a listed file vanishes before open',async()=>{
  await store.write({name:'alpha',description:'synthetic',body:'safe',type:'reference',status:'verified'},'user')
  const file=join(root,'_user','alpha.md')
  const originalOpen=fs.open.bind(fs)
  let entered!:()=>void,release!:()=>void
  const paused=new Promise<void>(resolve=>{entered=resolve})
  const gate=new Promise<void>(resolve=>{release=resolve})
  vi.spyOn(fs,'open').mockImplementation((async (...args: any[])=>{
    if(String(args[0])===file){entered();await gate}
    return originalOpen(args[0],args[1],args[2])
  }) as typeof fs.open)
  const pending=store.scanAsync('user')
  await paused
  await fs.rm(file)
  release()
  expect(await pending).toEqual({records:[],issues:['storage-unavailable']})
 })
 it('does not keep verification after same-size external edit with restored timestamp',async()=>{
  await store.write({name:'alpha',description:'synthetic',body:'safe',type:'reference',status:'verified'},'user')
  const file=join(root,'_user','alpha.md'),original=await fs.readFile(file,'utf8'),time=await fs.stat(file)
  let entered!:()=>void,release!:()=>void
  const paused=new Promise<void>(resolve=>{entered=resolve}),gate=new Promise<void>(resolve=>{release=resolve})
  const originalOpen=fs.open.bind(fs)
  vi.spyOn(fs,'open').mockImplementation((async(...args:any[])=>{
    if(String(args[0])===file){entered();await gate}
    return originalOpen(args[0],args[1],args[2])
  }) as typeof fs.open)
  const pending=store.scanAsync('user')
  await paused
  await fs.writeFile(file,original.replace('safe','evil'))
  await fs.utimes(file,time.atime,time.mtime)
  release()
  const result=await pending
  expect(result.issues).toEqual([])
  expect(result.records[0].status).toBe('candidate')
  expect(result.records[0].body).toBe('evil')
 })
})
