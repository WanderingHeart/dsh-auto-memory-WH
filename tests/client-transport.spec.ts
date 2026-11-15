import { afterEach, describe, expect, it, vi } from 'vitest'
import { memoryFace } from '../src/client/index.ts'
import type { Context } from '@deepseek-ai/cordis'
const face=()=>memoryFace({ get:()=>({list:{getSnapshot:()=>({byId:{a:{cwd:'synthetic-a'},b:{},c:{cwd:'synthetic-c'}}})}}) } as unknown as Context)
afterEach(()=>vi.unstubAllGlobals())
describe('browser carrier transport',()=>{
 it.each([401,403,502])('reports a plain-text HTTP %s response without JSON parser details',async status=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('upstream failure',{status})))
  await expect(face().request('groups.list',{scope:'user'})).rejects.toThrow(status===401?/登录已失效/:status===403?/权限或来源/:/无法识别/)
 })
 it('retains server revision-conflict details and handles truncated JSON',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({code:'REVISION_CONFLICT',error:'content changed'}),{status:409,headers:{'content-type':'application/json'}})))
  await expect(face().request('memory.write',{scope:'user'},'POST')).rejects.toThrow(/REVISION_CONFLICT/)
  vi.stubGlobal('fetch',vi.fn(async()=>new Response('{',{headers:{'content-type':'application/json'}})))
  await expect(face().request('groups.list',{scope:'user'})).rejects.toThrow(/响应不完整/)
 })
 it('serializes only supplied targets and never picks the most recent session',async()=>{
  const fetcher=vi.fn(async(_input: string,_init?: RequestInit)=>Response.json({records:[]}));vi.stubGlobal('fetch',fetcher)
  const api=face();expect(api.projectSessions()).toEqual([{id:'a',cwd:'synthetic-a'},{id:'c',cwd:'synthetic-c'}])
  await api.request('groups.list',{scope:'user',query:''})
  expect(fetcher.mock.calls[0]?.[0]).toBe('/api/auto-memory-wh/groups.list?scope=user')
 })
})
