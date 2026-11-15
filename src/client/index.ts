/**
 * 浏览器半:侧栏"记忆"入口 + 主列记忆管理面板。
 *
 * 结构照官方样板(ui-plugin-manager):全局面板挂 main slot,侧栏图标挂
 * sidebar.panellist;数据经宿主半注册的 /api/auto-memory-wh/* 路由(认证围栏内)
 * fetch 获取,操作后 refetch 刷新(事件白名单硬编码,不做推送)。
 *
 * 约束(激活失败会白屏整个前端,务必保守):
 * - 值导入仅限基线模块表(react / cordis / ui-primitives);其余一律 import type;
 * - inject 只声明 web 组合必有的稳定服务(slots、locale);
 * - 样式内联(官方 CSS Modules 管线未随 preset 发布)。
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { PACKAGE_NAME, PLUGIN_ID, API_BASE, LOCALE_NAMESPACE } from '../identity.ts'
// 类型:LocaleNamespaceMap / slots 与 'main'/'sidebar.panellist' 声明合并(编译期擦除)
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MemoryPage } from './MemoryPage.tsx'
import { MemoryPanelIcon } from './MemoryPanelIcon.tsx'
import { installWhaleNotifier, type WhaleStorage, type WhaleWindow } from './whale-notify.ts'
import { installCompletionNotifier } from './completion-notify.ts'
import { en, zh, type PluginMemoryLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Memory panel copy. */
    'autoMemoryWH': PluginMemoryLocaleKey
  }
}

/** 词典命名空间。 */
export const NS = LOCALE_NAMESPACE

/** 侧栏入口与主面板共用的面板 id。 */
export const PANEL_ID = PLUGIN_ID as MainPanelId

/** 浏览器半依赖的服务(slots/locale 为 web 组合必有;sessions 来自基线 client-store)。 */
export const inject = ['slots', 'locale', 'sessions']

export interface MemoryFace {
  request: (name: string, data: Record<string, unknown>, method?: 'GET' | 'POST') => Promise<unknown>
  projectSessions: () => Array<{ id: string; cwd: string }>
}
export function memoryFace(ctx: ClientContext): MemoryFace {
  return {
    request: async (name, data, method = 'GET') => {
      const query = new URLSearchParams()
      if (method === 'GET') for (const [key, value] of Object.entries(data)) if (value !== undefined && value !== '') query.set(key, String(value))
      const response = await fetch(API_BASE + '/' + name + (query.size ? '?' + query : ''), {
        method, headers: { 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
      })
      if (response.status === 401) throw new Error('登录已失效，请重新打开 DSH 页面；未保存草稿请先保留。')
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
        throw new Error(response.status === 403 ? '请求未通过宿主权限或来源检查。' : '宿主返回了无法识别的响应，请保留草稿后重试。')
      }
      let result: { error?: string; code?: string }
      try { result = await response.json() } catch { throw new Error('宿主响应不完整，请保留草稿后重试。') }
      if (!response.ok) throw new Error((result.code ? result.code + ': ' : '') + (result.error ?? '请求失败'))
      return result
    },
    projectSessions: () => {
      const sessions = ctx.get('sessions') as { list?: { getSnapshot?: () => { byId?: Record<string, { cwd?: string }> } } } | undefined
      return Object.entries(sessions?.list?.getSnapshot?.()?.byId ?? {}).filter(([, session]) => typeof session.cwd === 'string' && session.cwd.length > 0).map(([id, session]) => ({ id, cwd: session.cwd! }))
    },
  }
}

/** 面板样式表(官方主题 token 驱动;深浅主题与第三方主题自动跟随)。 */
export const PANEL_CSS = `
.dam-wh-root{display:flex;justify-content:flex-start;align-items:flex-start;width:100%;height:100%;overflow-y:auto;box-sizing:border-box;padding:clamp(16px,3vw,32px);background:var(--dsw-alias-bg-layer-2);}
@supports (background:color-mix(in srgb,white 50%,black)){.dam-wh-root{background:color-mix(in srgb,var(--dsw-alias-bg-base) 93%,var(--dsw-alias-label-primary) 7%);}}
.dam-wh-shell{position:relative;width:100%;max-width:1040px;margin:0;min-width:0;display:flex;flex-direction:column;gap:14px;font-size:13px;line-height:1.55;color:var(--dsw-alias-label-primary);}
.dam-wh-header{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:nowrap;}
.dam-wh-heading{display:flex;flex-direction:column;gap:3px;min-width:0;}
.dam-wh-title{font-size:30px;font-weight:700;line-height:1.15;margin:0;letter-spacing:-.03em;color:var(--dsw-alias-label-primary);}
.dam-wh-intro{color:var(--dsw-alias-label-secondary);font-size:12px;margin:0;}
.dam-wh-header-actions{display:flex;align-items:center;gap:8px;flex-wrap:nowrap;margin-left:auto;}
.dam-wh-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dam-wh-search{flex:0 0 0;width:0;min-width:0;overflow:hidden;opacity:0;transition:width .18s ease,opacity .18s ease;}
.dam-wh-search--open{flex:0 0 auto;width:200px;opacity:1;}
.dam-wh-search{position:relative;display:flex;align-items:center;}
.dam-wh-search input{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:inherit;padding:7px 30px 7px 30px;font-size:12.5px;outline:none;font-family:inherit;}
.dam-wh-search input:focus{border-color:var(--dsw-alias-brand-primary,#4d76e6);}
.dam-wh-search-icon{position:absolute;left:9px;display:inline-flex;color:var(--dsw-alias-label-tertiary);pointer-events:none;}
.dam-wh-search-clear{position:absolute;right:6px;width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;padding:0;}
.dam-wh-search-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dam-wh-segment{display:inline-flex;align-items:center;gap:2px;padding:2px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);}
.dam-wh-segment button{display:inline-flex;align-items:center;gap:5px;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;padding:4px 9px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;}
.dam-wh-segment button span{font-size:10px;opacity:.65;font-variant-numeric:tabular-nums;}
.dam-wh-segment button[data-on="1"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgba(0,0,0,.08);}
.dam-wh-select{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:6px 10px;font-size:12px;font-family:inherit;cursor:pointer;outline:none;}
.dam-wh-select:focus{border-color:var(--dsw-alias-brand-primary,#4d76e6);}
.dam-wh-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:9px;padding:5px 12px;font-size:12px;cursor:pointer;font-family:inherit;white-space:nowrap;}
.dam-wh-btn svg{flex:none;}
.dam-wh-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border:1px solid var(--dsw-alias-border-l2);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0;font-family:inherit;list-style:none;}
.dam-wh-icon-btn:hover{color:var(--dsw-alias-brand-primary,#4d76e6);border-color:var(--dsw-alias-brand-primary,#4d76e6);}
.dam-wh-icon-btn::-webkit-details-marker{display:none;}
.dam-wh-settings{position:relative;}
.dam-wh-settings-menu{position:absolute;right:52px;top:36px;z-index:30;display:flex;flex-direction:column;align-items:stretch;gap:6px;min-width:230px;padding:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 30px rgba(0,0,0,.18);}
.dam-wh-settings-menu .dam-wh-btn{justify-content:flex-start;}
.dam-wh-filter{position:relative;}
.dam-wh-filter summary{list-style:none;}
.dam-wh-filter summary::-webkit-details-marker{display:none;}
.dam-wh-filter-menu{position:absolute;left:0;top:36px;z-index:30;display:flex;flex-direction:column;gap:8px;min-width:0;width:max-content;padding:8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 10px 30px rgba(0,0,0,.18);}
.dam-wh-filter-menu label{display:block;margin:0;}
.dam-wh-filter-menu select{width:auto;min-width:132px;}
.dam-wh-edition-menu{min-width:230px;width:250px;}
.dam-wh-edition-menu p{margin:0;font-size:13px;}
.dam-wh-range{width:100%;accent-color:var(--dsw-alias-label-primary);}
.dam-wh-range-labels{display:flex;justify-content:space-between;font-size:12px;color:var(--dsw-alias-label-secondary);}
@media (prefers-color-scheme:dark){.dam-wh-edition-menu{background:var(--dsw-alias-bg-layer-1);border-color:rgba(255,255,255,.16);}}
.dam-wh-summary-menu{min-width:260px;width:300px;align-items:stretch;}
.dam-wh-summary-head{display:flex;align-items:flex-start;gap:8px;justify-content:space-between;}
.dam-wh-summary-head p{flex:1;margin:0;}
.dam-wh-summary-row{display:flex;flex-direction:column;gap:2px;text-align:left;width:100%;padding:8px 10px;border-radius:8px;background:transparent;}
.dam-wh-btn.dam-wh-summary-row{align-items:flex-start;justify-content:flex-start;text-align:left;}
.dam-wh-summary-cwd{font-size:13px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;max-width:100%;}
.dam-wh-summary-row:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);}
.dam-wh-summary-meta{font-size:12px;color:var(--dsw-alias-label-secondary);text-align:left;}
@media (prefers-color-scheme:dark){.dam-wh-summary-menu{background:var(--dsw-alias-bg-layer-1);border-color:rgba(255,255,255,.16);}}
.dam-wh-visually-hidden{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
.dam-wh-drawer{position:absolute;right:52px;top:38px;z-index:60;width:min(420px,100%);max-height:min(70vh,520px);display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:0 16px 40px rgba(0,0,0,.22);overflow:auto;animation:dam-wh-drawer-in .16s ease-out;}
.dam-wh-graph{display:flex;flex-direction:column;gap:10px;}
.dam-wh-graph-canvas{display:block;width:100%;height:min(70vh,560px);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);touch-action:none;cursor:grab;}
.dam-wh-graph-hint{margin:0;font-size:12px;color:var(--dsw-alias-label-secondary);}
.dam-wh-arc{display:flex;flex-direction:column;gap:12px;}
.dam-wh-arc-chapter{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);}
.dam-wh-arc-chapter h3{margin:0;font-size:14px;}
.dam-wh-arc-list{display:flex;flex-direction:column;gap:8px;margin:0;padding-left:18px;}
.dam-wh-arc-list li{display:flex;flex-wrap:wrap;align-items:center;gap:6px;}
.dam-wh-arc-list time{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;}
.dam-wh-arc-title{padding:0;border:0;background:transparent;font-size:13px;color:var(--dsw-alias-brand-primary,#4d76e6);cursor:pointer;text-align:left;}
.dam-wh-arc-title:hover{text-decoration:underline;}
.dam-wh-arc-list .dam-wh-desc{flex-basis:100%;margin:0;}
.dam-wh-hidden-file{display:none;}
.dam-wh-transfer{display:flex;flex-direction:column;gap:6px;margin:8px 0;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);}
.dam-wh-transfer h2{margin:0;font-size:13px;}
.dam-wh-transfer-conflicts{display:grid;gap:4px;}
.dam-wh-transfer-conflicts p{margin:0;}
.dam-wh-transfer-conflicts label{display:flex;align-items:center;gap:6px;font-size:12px;}
.dam-wh-dropzone{position:fixed;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;border:2px dashed var(--dsw-alias-brand-primary,#4d76e6);border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-bg-base) 70%,transparent);color:var(--dsw-alias-brand-primary,#4d76e6);font-size:14px;pointer-events:none;}
@keyframes dam-wh-drawer-in{from{transform:translateX(8px);opacity:0;}to{transform:none;opacity:1;}}
.dam-wh-history-heading{display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.dam-wh-history-popup{position:fixed;top:15vh;right:5vw;width:min(640px,90vw);max-height:70vh;z-index:80;overflow:auto;padding:18px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);box-shadow:0 16px 40px rgba(0,0,0,.22);}
.dam-wh-history-popup article{padding:12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);overflow-wrap:anywhere;}
.dam-wh-history-body{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;}
.dam-wh-drawer-head{display:flex;align-items:center;justify-content:space-between;gap:8px;}
.dam-wh-drawer-head h2{font-size:14px;margin:0;}
.dam-wh-drawer-body{display:flex;flex-direction:column;gap:6px;min-width:0;overflow-wrap:anywhere;}
.dam-wh-drawer-body p{margin:0;font-size:12px;}
.dam-wh-drawer-body code{overflow-wrap:anywhere;}
.dam-wh-bar{display:flex;align-items:center;gap:8px;max-width:260px;margin:6px 0;}
.dam-wh-bar-track{flex:1;height:8px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}
.dam-wh-bar-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4d76e6);transition:width .2s ease;}
.dam-wh-bar-label{font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap;}
.dam-wh-merge{display:flex;flex-direction:column;gap:10px;}
.dam-wh-merge article{padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);}
.dam-wh-merge h2{font-size:13px;margin:0;}
.dam-wh-merge p{margin:4px 0;font-size:12px;}
.dam-wh-btn:hover{border-color:var(--dsw-alias-brand-primary,#4d76e6);color:var(--dsw-alias-brand-primary,#4d76e6);}
.dam-wh-btn:disabled{opacity:.5;cursor:default;}
.dam-wh-btn-ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);}
.dam-wh-btn-ghost:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:transparent;}
.dam-wh-btn-primary{background:var(--dsw-alias-brand-primary,#4d76e6);border-color:var(--dsw-alias-brand-primary,#4d76e6);color:var(--dsw-alias-bg-base,#fff);}
.dam-wh-btn-primary:hover{color:var(--dsw-alias-bg-base,#fff);opacity:.88;}
.dam-wh-btn-danger-ghost{color:var(--dsw-alias-state-error-primary,#ef4444);}
.dam-wh-btn-danger{background:var(--dsw-alias-state-error-primary,#dc2626);border-color:var(--dsw-alias-state-error-primary,#dc2626);color:#fff;}
.dam-wh-btn-danger:hover{color:#fff;opacity:.9;}
.dam-wh-overview{display:flex;align-items:center;gap:18px;flex-wrap:wrap;padding:10px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);}
.dam-wh-stat{display:inline-flex;align-items:baseline;gap:5px;font-size:11.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.dam-wh-stat b{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;}
.dam-wh-usage{flex:1;min-width:170px;margin-left:auto;}
.dam-wh-usage-label{font-size:10.5px;color:var(--dsw-alias-label-tertiary);display:block;margin-bottom:4px;text-align:right;font-variant-numeric:tabular-nums;}
.dam-wh-usage-track{display:block;height:5px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden;}
.dam-wh-usage-track i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4d76e6);transition:width .2s ease;}
.dam-wh-usage-track i[data-hot="1"]{background:var(--dsw-alias-state-warn-primary,#d97706);}
.dam-wh-groups{display:flex;flex-direction:column;gap:10px;}
.dam-wh-group{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;transition:border-color .12s ease;box-shadow:0 1px 2px rgba(0,0,0,.05);}
.dam-wh-group:hover{box-shadow:0 2px 10px rgba(0,0,0,.07);}
.dam-wh-group[data-scope]{border-left-width:3px;}
.dam-wh-group[data-scope="user"]{border-left-color:#3b82f6;}
.dam-wh-group[data-scope="project"]{border-left-color:#8b5cf6;}
.dam-wh-group[data-scope="project"][data-current="1"]{border-left-color:#16a34a;}
.dam-wh-group-head{display:grid;grid-template-columns:18px minmax(0,1fr) auto 16px;gap:10px;align-items:center;width:100%;padding:11px 14px;border:0;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer;}
.dam-wh-group-head:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dam-wh-group-icon{font-size:13px;text-align:center;line-height:1;}
.dam-wh-group-name{display:flex;flex-direction:column;gap:1px;min-width:0;}
.dam-wh-group-title{font-weight:600;font-size:13px;line-height:18px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dam-wh-group-sub{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dam-wh-group-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;}
.dam-wh-chevron{display:inline-flex;color:var(--dsw-alias-label-tertiary);transition:transform .15s ease;transform:rotate(90deg);}
.dam-wh-group[data-open="0"] .dam-wh-chevron{transform:rotate(0deg);}
.dam-wh-group-body{padding:0 10px 10px;display:flex;flex-direction:column;gap:6px;}
.dam-wh-group-tools{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:8px 4px 4px;border-top:1px solid var(--dsw-alias-border-l1);}
.dam-wh-budget{display:inline-flex;align-items:center;gap:8px;flex:0 1 auto;min-width:0;max-width:380px;}
.dam-wh-budget-track{display:block;width:190px;flex:none;height:4px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden;}
.dam-wh-budget-track i{display:block;height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary,#4d76e6);transition:width .2s ease;}
.dam-wh-budget-track i[data-hot="1"]{background:var(--dsw-alias-state-warn-primary,#d97706);}
.dam-wh-budget-label{font-size:10.5px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;font-variant-numeric:tabular-nums;}
.dam-wh-group-hint{font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex:1;}
.dam-wh-index>summary{cursor:pointer;font-size:10.5px;color:var(--dsw-alias-label-tertiary);list-style:none;white-space:nowrap;}
.dam-wh-index>summary::-webkit-details-marker{display:none;}
.dam-wh-index pre{margin:6px 0 0;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);font-size:11px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:240px;overflow:auto;}
.dam-wh-tag{font-size:11px;border-radius:6px;padding:1px 7px;white-space:nowrap;border:1px solid transparent;}
.dam-wh-tag--user{color:var(--dsw-alias-brand-primary,#3b82f6);border-color:var(--dsw-alias-brand-primary,#3b82f6);}
.dam-wh-tag--feedback{color:var(--dsw-alias-state-warn-primary,#d97706);border-color:var(--dsw-alias-state-warn-primary,#d97706);}
.dam-wh-tag--project{color:var(--dsw-alias-state-success-primary,#16a34a);border-color:var(--dsw-alias-state-success-primary,#16a34a);}
.dam-wh-tag--reference{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2);}
.dam-wh-memory-list{display:flex;flex-direction:column;gap:1px;}
.dam-wh-memory{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;padding:8px;border-radius:9px;transition:background .12s ease;}
.dam-wh-memory:hover,.dam-wh-memory:focus-within{background:var(--dsw-alias-interactive-bg-hover);}
.dam-wh-memory[data-muted="1"]{opacity:.6;}
.dam-wh-memory-main{min-width:0;cursor:pointer;outline:none;}
.dam-wh-memory-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d76e6);outline-offset:2px;border-radius:6px;}
.dam-wh-memory-line{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;}
.dam-wh-memory-title{font-weight:600;font-size:12.5px;line-height:18px;min-width:120px;flex:1;overflow-wrap:anywhere;}
.dam-wh-memory-pin{font-size:10px;line-height:1;}
.dam-wh-memory-time{margin-left:auto;font-size:10px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;}
.dam-wh-memory-desc{margin:2px 0 0;font-size:11.5px;line-height:1.55;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.dam-wh-memory-actions{display:flex;align-items:flex-start;gap:2px;opacity:.85;transition:opacity .12s ease;}
.dam-wh-memory:hover .dam-wh-memory-actions,.dam-wh-memory:focus-within .dam-wh-memory-actions{opacity:1;}
@media (hover:none){.dam-wh-memory-actions{opacity:1;}}
.dam-wh-icon-btn{display:inline-grid;place-items:center;width:27px;height:27px;padding:0;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;font-family:inherit;}
.dam-wh-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.dam-wh-icon-btn[data-on="1"]{color:var(--dsw-alias-brand-primary,#4d76e6);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d76e6) 30%,transparent);}
.dam-wh-icon-btn[data-danger="1"]:hover{color:var(--dsw-alias-state-error-primary,#ef4444);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 10%,transparent);}
.dam-wh-icon-btn:disabled{opacity:.35;cursor:default;}
.dam-wh-memory-body{grid-column:1 / -1;margin:6px 0 2px;}
.dam-wh-memory-confirm{grid-column:1 / -1;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:8px;margin-top:4px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 40%,transparent);border-radius:8px;background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 6%,transparent);font-size:11.5px;color:var(--dsw-alias-label-secondary);}
.dam-wh-body{margin:0;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-2);font-family:var(--ds-font-family-code);font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;}
/* ---- 注入统计卡(0.10.1):指标条 + 占比条榜 + 截断榜 + 时间线 ---- */
.dam-wh-stats{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-brand-primary,#4d76e6) 4%,var(--dsw-alias-bg-layer-1)),var(--dsw-alias-bg-layer-1));overflow:hidden;}
.dam-wh-stats>summary{list-style:none;display:flex;align-items:center;gap:11px;padding:12px 16px;cursor:pointer;user-select:none;transition:background .12s ease;}
.dam-wh-stats>summary::-webkit-details-marker{display:none;}
.dam-wh-stats>summary:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dam-wh-stats[open]>summary{border-bottom:1px solid var(--dsw-alias-border-l1);}
.dam-wh-stats-glyph{flex:none;width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-size:15px;background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d76e6) 11%,transparent);}
.dam-wh-stats-titles{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;}
.dam-wh-stats-title{font-size:13px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-primary);}
.dam-wh-stats-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dam-wh-stats-chev{flex:none;font-size:16px;line-height:1;color:var(--dsw-alias-label-tertiary);transition:transform .18s ease;}
.dam-wh-stats[open] .dam-wh-stats-chev{transform:rotate(90deg);}
.dam-wh-stats-body{display:flex;flex-direction:column;gap:14px;padding:14px 16px 16px;max-height:420px;overflow-y:auto;}
.dam-wh-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}
.dam-wh-metric{padding:9px 13px;border-left:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:1px;min-width:0;}
.dam-wh-metric:first-child{border-left:0;}
.dam-wh-metric b{font-size:18px;line-height:23px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary);}
.dam-wh-metric span{font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.dam-wh-block{display:flex;flex-direction:column;gap:2px;min-width:0;}
.dam-wh-block-head{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:3px;}
.dam-wh-section{margin:0;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--dsw-alias-label-tertiary);}
.dam-wh-note{margin:0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}
.dam-wh-legend{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:10.5px;color:var(--dsw-alias-label-tertiary);}
.dam-wh-legend-item{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;}
.dam-wh-scope-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--scope-color,var(--dsw-alias-label-tertiary));box-shadow:0 0 0 2px color-mix(in srgb,var(--scope-color,var(--dsw-alias-border-l2)) 16%,transparent);}
.dam-wh-legend-item .dam-wh-scope-dot{width:6px;height:6px;box-shadow:none;}
.dam-wh-rank-row[data-scope="user"],.dam-wh-trunc-row[data-scope="user"]{--scope-color:var(--dsw-alias-brand-primary,#3b82f6);}
.dam-wh-rank-row[data-scope="project"],.dam-wh-trunc-row[data-scope="project"]{--scope-color:#8b5cf6;}
.dam-wh-rank-row[data-scope="both"],.dam-wh-trunc-row[data-scope="both"]{--scope-color:#8b5cf6;}
.dam-wh-rank-row[data-scope="missing"],.dam-wh-trunc-row[data-scope="missing"]{--scope-color:#94a3b8;}
.dam-wh-scope-dot[data-scope="user"]{--scope-color:var(--dsw-alias-brand-primary,#3b82f6);}
.dam-wh-scope-dot[data-scope="project"]{--scope-color:#8b5cf6;}
.dam-wh-scope-dot[data-scope="both"]{background:linear-gradient(90deg,#3b82f6 0 50%,#8b5cf6 50% 100%);}
.dam-wh-scope-dot[data-scope="missing"]{--scope-color:#94a3b8;}
.dam-wh-rank-row[data-scope="both"] .dam-wh-scope-dot{background:linear-gradient(90deg,#3b82f6 0 50%,#8b5cf6 50% 100%);}
.dam-wh-rank-row[data-scope="both"] .dam-wh-mini-bar i{background:linear-gradient(90deg,#3b82f6,#8b5cf6);}
.dam-wh-rank-row{display:grid;grid-template-columns:8px minmax(0,280px) minmax(60px,1fr) 44px 34px;align-items:center;gap:10px;padding:5px 8px;margin:0 -8px;border-radius:8px;transition:background .12s ease;}
.dam-wh-rank-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dam-wh-rank-name{font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);}
.dam-wh-mini-bar{height:4px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden;}
.dam-wh-mini-bar i{display:block;height:100%;border-radius:999px;background:var(--scope-color,var(--dsw-alias-brand-primary,#4d76e6));transition:width .2s ease;}
.dam-wh-ratio{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}
.dam-wh-rank-warn{font-size:10px;line-height:16px;text-align:right;white-space:nowrap;color:var(--dsw-alias-state-warn-primary,#d97706);}
.dam-wh-trunc-row{display:grid;grid-template-columns:8px minmax(0,1fr) auto;align-items:center;gap:10px;padding:4px 8px;margin:0 -8px;border-radius:8px;transition:background .12s ease;}
.dam-wh-trunc-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dam-wh-trunc-row .dam-wh-warn{justify-self:end;}
/* ---- 按项目统计(0.10.1):固定列 + 项目色条 ---- */
.dam-wh-proj-head,.dam-wh-proj-row{display:grid;grid-template-columns:minmax(0,280px) 34px 34px minmax(60px,1fr) 44px 30px;align-items:center;gap:8px;padding-left:8px;padding-right:8px;margin:0 -8px;}
.dam-wh-proj-head{font-size:10px;color:var(--dsw-alias-label-tertiary);text-align:right;padding-top:2px;padding-bottom:2px;}
.dam-wh-proj-head span:first-child{text-align:left;}
.dam-wh-proj-row{padding-top:5px;padding-bottom:5px;border-radius:8px;transition:background .12s ease;}
.dam-wh-proj-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dam-wh-proj-name{font-family:var(--ds-font-family-code);font-size:11px;line-height:16px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-secondary);}
.dam-wh-proj-stat{font-size:10.5px;line-height:14px;color:var(--dsw-alias-label-tertiary);text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;}
.dam-wh-proj-bar{height:4px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden;}
.dam-wh-proj-bar i{display:block;height:100%;border-radius:999px;}
.dam-wh-proj-warn{font-size:10px;line-height:16px;color:var(--dsw-alias-state-warn-primary,#d97706);text-align:right;white-space:nowrap;}
.dam-wh-warn{flex:none;font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;font-weight:600;white-space:nowrap;color:var(--dsw-alias-state-warn-primary,#d97706);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 12%,transparent);}
.dam-wh-timeline{display:flex;flex-direction:column;border-left:1.5px solid var(--dsw-alias-border-l2);margin:2px 0 0 4px;padding:2px 0 0 14px;}
.dam-wh-tl-item{position:relative;padding:4px 0;}
.dam-wh-tl-item::before{content:"";position:absolute;left:-18px;top:9px;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-border-l2);}
.dam-wh-tl-item[data-latest="1"]::before{background:var(--dsw-alias-brand-primary,#4d76e6);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d76e6) 22%,transparent);}
.dam-wh-tl-top{display:flex;align-items:baseline;gap:8px;font-size:11px;line-height:16px;min-width:0;}
.dam-wh-tl-time{flex:none;color:var(--dsw-alias-label-tertiary);white-space:nowrap;margin-left:auto;}
.dam-wh-tl-ws{flex:1 1 auto;min-width:0;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dam-wh-tl-meta{display:flex;align-items:center;gap:6px;margin-top:2px;font-size:10.5px;line-height:15px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}
.dam-wh-pill{display:inline-flex;align-items:center;padding:0 6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);line-height:15px;}
.dam-wh-subdetails>summary{cursor:pointer;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);padding:4px 0;list-style:none;}
.dam-wh-subdetails>summary::-webkit-details-marker{display:none;}
.dam-wh-form{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:14px;background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:8px;position:sticky;bottom:12px;box-shadow:var(--dsw-elevation-prominent,0 3px 8px rgba(0,0,0,.14),0 0 20px rgba(0,0,0,.18));}
.dam-wh-form--inline{position:static;box-shadow:none;border-color:var(--dsw-alias-brand-primary,#4d76e6);}
.dam-wh-form-title{font-weight:600;font-size:13px;display:flex;align-items:center;gap:8px;}
.dam-wh-form-bar{width:3px;height:14px;border-radius:2px;background:var(--dsw-alias-brand-primary,#4d76e6);display:inline-block;}
.dam-wh-label{font-size:12px;color:var(--dsw-alias-label-secondary);margin:4px 0 0;}
.dam-wh-input,.dam-wh-textarea{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:inherit;padding:6px 10px;font-size:13px;outline:none;font-family:inherit;}
.dam-wh-input:focus,.dam-wh-textarea:focus{border-color:var(--dsw-alias-brand-primary,#4d76e6);}
.dam-wh-textarea{resize:vertical;min-height:120px;}
.dam-wh-editor{display:flex;flex-direction:column;gap:12px;padding:16px;min-width:0;overflow:visible;}
.dam-wh-editor>h2,.dam-wh-editor>p{margin:0;}
.dam-wh-editor-field{display:flex;flex-direction:column;gap:5px;min-width:0;font-size:12px;color:var(--dsw-alias-label-secondary);}
.dam-wh-editor .dam-wh-input,.dam-wh-editor .dam-wh-textarea{width:100%;min-width:0;}
.dam-wh-editor-summary,.dam-wh-editor-body{min-height:38px;height:38px;max-height:38px;overflow:hidden;resize:none;transition:height .16s ease,max-height .16s ease;}
.dam-wh-editor-summary.dam-wh-editor--grow,.dam-wh-editor-body.dam-wh-editor--grow{height:auto;min-height:120px;max-height:320px;overflow:auto;resize:vertical;}
.dam-wh-desc{display:-webkit-box;-webkit-line-clamp:1;-webkit-box-orient:vertical;overflow:hidden;margin:0;}
.dam-wh-editor-review{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.5;}
.dam-wh-editor-review input{flex:none;margin:3px 0 0;}
.dam-wh-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
.dam-wh-err{color:var(--dsw-alias-state-warn-primary,#d97706);font-size:12px;}
.dam-wh-banner{padding:8px 12px;border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 35%,transparent);border-radius:9px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 7%,transparent);}
.dam-wh-empty{display:flex;flex-direction:column;align-items:center;gap:4px;border:1px dashed var(--dsw-alias-border-l2);border-radius:14px;padding:34px 16px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:12.5px;background:var(--dsw-alias-bg-layer-1);}
.dam-wh-empty-icon{font-size:26px;line-height:1;margin-bottom:4px;}
.dam-wh-empty h3{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dam-wh-empty p{margin:0;max-width:520px;}
.dam-wh-modal-backdrop{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(15,23,42,.42);backdrop-filter:blur(2px);}
.dam-wh-modal{width:min(760px,100%);max-height:min(82vh,820px);overflow:auto;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.28);padding:18px;}
.dam-wh-modal .dam-wh-form{position:static;box-shadow:none;border:0;background:transparent;padding:0;max-height:none;}
.dam-wh-table{width:100%;border-collapse:collapse;font-size:12.5px;}
.dam-wh-table th{text-align:left;padding:4px 6px;font-weight:500;opacity:.7;}
.dam-wh-table td{padding:4px 6px;border-top:1px solid var(--dsw-alias-border-l1);}
.dam-wh-check{accent-color:var(--dsw-alias-brand-primary,#4d76e6);}
/* ---- Claude Code 导入弹层(0.10.0):逐条勾选 + 状态徽章 + 撤销 ---- */
.dam-wh-import-wrap{display:flex;flex-direction:column;gap:8px;max-height:46vh;overflow-y:auto;padding-right:2px;}
.dam-wh-import-group{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:8px 10px;}
.dam-wh-import-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:2px;}
.dam-wh-import-slug{font-size:11.5px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;}
.dam-wh-import-items{display:flex;flex-direction:column;gap:2px;margin-top:4px;}
.dam-wh-import-item{display:flex;align-items:flex-start;gap:8px;padding:4px 6px;border-radius:7px;cursor:pointer;transition:background .12s ease;}
.dam-wh-import-item:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dam-wh-import-item[data-locked="1"]{cursor:default;opacity:.72;}
.dam-wh-import-main{display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;}
.dam-wh-import-name{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:12px;line-height:17px;}
.dam-wh-import-file{font-size:10.5px;color:var(--dsw-alias-label-tertiary);}
.dam-wh-import-desc{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;}
.dam-wh-badge{flex:none;align-self:center;font-size:10.5px;line-height:16px;padding:0 7px;border-radius:999px;white-space:nowrap;border:1px solid transparent;}
.dam-wh-badge--ok{color:var(--dsw-alias-state-success-primary,#16a34a);background:color-mix(in srgb,var(--dsw-alias-state-success-primary,#16a34a) 12%,transparent);}
.dam-wh-badge--warn{color:var(--dsw-alias-state-warn-primary,#d97706);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 12%,transparent);}
/* 可信记忆(1.0.0):状态徽章 + 证据链 + 体检卡 */
.dam-wh-badge--cand{color:var(--dsw-alias-brand-primary,#4d76e6);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d76e6) 12%,transparent);}
.dam-wh-badge--danger{color:var(--dsw-alias-state-error-primary,#ef4444);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ef4444) 12%,transparent);}
.dam-wh-evidence{display:flex;gap:6px;align-items:baseline;font-size:11.5px;padding:6px 8px;border-left:2px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);border-radius:0 6px 6px 0;}
.dam-wh-evidence-label{color:var(--dsw-alias-label-secondary);white-space:nowrap;}
.dam-wh-evidence-quote{color:var(--dsw-alias-label-secondary);font-style:italic;overflow-wrap:anywhere;}
.dam-wh-status-actions{display:flex;gap:6px;}
.dam-wh-health summary{cursor:pointer;display:flex;align-items:center;gap:8px;list-style:none;}
.dam-wh-health summary::-webkit-details-marker{display:none;}
.dam-wh-health-body{display:flex;flex-direction:column;gap:2px;max-height:280px;overflow-y:auto;margin-top:8px;padding-right:4px;}
.dam-wh-health-row{display:flex;align-items:center;gap:8px;font-size:12px;padding:2px 0;min-width:0;}
.dam-wh-health-row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.dam-wh-health-meta{margin-left:auto;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;flex:none;}
/* 导入提示条 + 导出成功提示(1.2.0) */
.dam-wh-import-hint{display:flex;align-items:center;gap:10px;justify-content:space-between;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary,#4d76e6) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#4d76e6) 8%,transparent);border-radius:8px;padding:6px 12px;font-size:12.5px;}
.dam-wh-export-note{color:var(--dsw-alias-state-success-primary,#16a34a);font-size:12px;}
/* #19 谱系:可点徽章与跳转命中高亮 */
.dam-wh-lineage-link{cursor:pointer;text-decoration:underline dotted;}
.dam-wh-lineage-link:hover{color:var(--dsw-alias-brand-primary,#4d76e6);}
@keyframes dam-wh-lineage-flash{0%{box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary,#4d76e6) 60%,transparent);}100%{box-shadow:0 0 0 3px transparent;}}
.dam-wh-lineage-hit{animation:dam-wh-lineage-flash 1.5s ease-out;border-radius:8px;}
.dam-wh-badge--muted{color:var(--dsw-alias-label-secondary);border-color:var(--dsw-alias-border-l2);}
/* v0.8.0 第二批：键盘焦点、窄窗口、深色与减少动效 */
.dam-wh-shell :where(button,summary,input,select,textarea,a):focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d76e6);outline-offset:2px;border-radius:7px;}
.dam-wh-memory{transition:border-color .12s ease,background-color .12s ease;}
.dam-wh-memory:hover{border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1));}
@media (max-width:720px){
.dam-wh-root{padding:12px;}
.dam-wh-header{flex-wrap:nowrap;align-items:center;gap:8px;}
.dam-wh-header-actions{justify-content:flex-end;flex-wrap:nowrap;}
.dam-wh-settings{width:auto;}
.dam-wh-search--open{width:120px;}
.dam-wh-settings-menu{left:auto;right:0;width:min(340px,calc(100vw - 24px));}
.dam-wh-drawer{left:0;right:0;width:auto;top:46px;max-height:70vh;}
.dam-wh-bar{max-width:none;}
.dam-wh-merge article{overflow-x:auto;}
}
@media (prefers-color-scheme: dark){
.dam-wh-root{background:color-mix(in srgb,var(--dsw-alias-bg-base) 96%,#000 4%);}
.dam-wh-group,.dam-wh-merge article,.dam-wh-graph-canvas{background:var(--dsw-alias-bg-layer-1);border-color:color-mix(in srgb,var(--dsw-alias-border-l1) 72%,transparent);}
.dam-wh-settings-menu,.dam-wh-drawer,.dam-wh-filter-menu{background:var(--dsw-alias-bg-layer-1);border-color:color-mix(in srgb,var(--dsw-alias-border-l1) 80%,transparent);box-shadow:0 16px 40px rgba(0,0,0,.55);}
.dam-wh-settings-menu{box-shadow:0 10px 30px rgba(0,0,0,.5);}
.dam-wh-bar-track{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 22%,transparent);}
.dam-wh-bar-fill{background:linear-gradient(90deg,#6f9bff,#8fb2ff);}
.dam-wh-note,.dam-wh-desc,.dam-wh-graph-hint{color:color-mix(in srgb,var(--dsw-alias-label-secondary) 88%,transparent);}
.dam-wh-editor input,.dam-wh-editor textarea,.dam-wh-editor select{background:var(--dsw-alias-bg-layer-2);border-color:color-mix(in srgb,var(--dsw-alias-border-l1) 80%,transparent);color:var(--dsw-alias-label-primary);}
.dam-wh-btn{background:var(--dsw-alias-bg-layer-2);border-color:color-mix(in srgb,var(--dsw-alias-border-l1) 74%,transparent);}
.dam-wh-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 82%,#fff 6%);}
.dam-wh-icon-btn:hover{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 80%,#fff 8%);}
}
@media (prefers-reduced-motion: reduce){
.dam-wh-shell *{transition:none !important;animation:none !important;}
}
`

/** 幂等注入面板样式(官方 data-plugin-css 约定)。 */
function injectPanelCss(): void {
  const tagId = PACKAGE_NAME + '/panel.css'
  if (typeof document === 'undefined' || document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return
  const tag = document.createElement('style')
  tag.dataset.plugin = PACKAGE_NAME
  tag.dataset.pluginCss = tagId
  tag.textContent = PANEL_CSS
  document.head.appendChild(tag)
}

/** 注册侧栏入口与记忆管理面板。 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-auto-memory-wh: dictionaries')
  // 样式注入(参照官方 client bundle 的 data-plugin-css 约定,幂等)——
  // 内联 style 没有 hover/focus/line-clamp 能力,0.9.1 起面板视觉层走真 CSS 类
  injectPanelCss()
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => memoryFace(ctx),
  }, MemoryPage))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 50,
    label: () => t('panel'),
    locale: NS,
  }, MemoryPanelIcon))

  // v0.7.0:可选的小鲸鱼气泡通道。检测不到钩子时静默退出，不影响面板与注入。
  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    const face = memoryFace(ctx)
    let storage: WhaleStorage | undefined
    try { storage = window.sessionStorage } catch { storage = undefined }
    return installWhaleNotifier({ request: face.request, win: window as unknown as WhaleWindow, storage })
  }, 'dsh-auto-memory-wh: whale reminders')

  // v0.11.0:长轮次完成通知，同样复用可选的小鲸鱼钩子。
  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    const face = memoryFace(ctx)
    let storage: WhaleStorage | undefined
    try { storage = window.sessionStorage } catch { storage = undefined }
    return installCompletionNotifier({ request: face.request, win: window as unknown as WhaleWindow, storage })
  }, 'dsh-auto-memory-wh: completion notices')
}




