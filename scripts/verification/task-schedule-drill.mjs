/**
 * v0.5.0 M2 drill: memory tasks -> optional host schedule delivery (fake service).
 *
 * Verifies the bridge contract without a running host:
 *  - create/update/delete follows the memory records (memory is the source of truth);
 *  - re-running reconcile is idempotent and survives a restart via the sidecar;
 *  - a missing service degrades to the session-start reminder channel;
 *  - only this plugin's schedules are ever removed from the host.
 *
 * Run: node scripts/verification/task-schedule-drill.mjs [stage]
 * Evidence: docs/evidence/<stage>/schedule-bridge.json (stage defaults to S05-v050-tasks).
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MemoryStore } from '../../src/store.ts'
import { createScheduleBridge, loadBridgeState, TASK_MARKER, TASK_TITLE_PREFIX } from '../../src/schedule-bridge.ts'
import { collectTaskReminders, isRemindableTask } from '../../src/tasks.ts'
import { renderTaskReminderText } from '../../src/injection.ts'

const repo = 'C:/Users/example-user/Desktop/dsh-plug-in/dsh-auto-memory-WH'
const stage = process.argv[2] ?? 'S05-v050-tasks'
const base = join(repo, '.work/S05/task-schedule-drill', String(Date.now()))
const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail === undefined ? '' : ` (${detail})`}`)
}

const now = Date.UTC(2026, 10, 7, 12, 0, 0)
const hour = 60 * 60 * 1000
const due = now + 3 * hour
const remind = now + 2 * hour

function makeService() {
  const created = []
  const edited = []
  let counter = 0
  let items = []
  return {
    created,
    edited,
    items: () => items,
    async create(request) {
      created.push(request)
      const id = `schedule-${++counter}`
      items.push({ id, title: request.title, prompt: request.prompt, active: true })
      return { id }
    },
    async edit(request) {
      edited.push(request)
      if (request.action === 'delete') {
        items = items.filter(item => item.id !== request.id)
        return { id: request.id, deleted: true }
      }
      items = items.map(item => item.id === request.id ? { ...item, ...(request.patch ?? {}) } : item)
      return { id: request.id }
    },
    async list() {
      return { items: items.slice(), total: items.length }
    },
  }
}

await mkdir(join(base, 'memory'), { recursive: true })
await writeFile(join(base, 'memory', '.wh-format.json'), JSON.stringify({ format: 'dsh-auto-memory-wh', version: 1 }))
const store = new MemoryStore(join(base, 'memory'))
let service
try {
  const writeTask = (name, extra = {}) => store.write({
    name,
    title: `Drill ${name}`,
    description: `synthetic task ${name}`,
    body: `body ${name}`,
    type: 'task',
    status: 'verified',
    taskStatus: 'open',
    priority: 2,
    dueAt: due,
    remindAt: remind,
    ...extra,
  }, 'user')
  await writeTask('drill-alpha')
  await writeTask('drill-beta', { status: 'candidate' })
  const records = store.scanSync('user').records
  check('candidate-task-not-remindable', records.filter(isRemindableTask).length === 1, `remindable=${records.filter(isRemindableTask).length}`)

  service = makeService()
  const bridge = createScheduleBridge({ getService: () => service, root: join(base, 'memory'), now: () => now })
  check('bridge-available-with-service', bridge.available() === true)

  const first = await bridge.reconcile(records)
  check('creates-one-schedule', first.created.length === 1 && first.created[0] === 'drill-alpha', JSON.stringify(first.created))
  const request = service.created[0]
  check('uses-title-prefix', request?.title?.startsWith(TASK_TITLE_PREFIX) === true, request?.title)
  check('prompt-carries-marker', String(request?.prompt ?? '').includes(`${TASK_MARKER}drill-alpha`) === true)
  check('target-is-new-once', request?.target?.kind === 'new_once')
  check('future-reminder-uses-at', request?.timing?.kind === 'at' && typeof request?.timing?.at === 'string', request?.timing?.kind)
  const stateFile = join(base, 'memory', 'schedule-bridge.json')
  const state1 = await loadBridgeState(join(base, 'memory'))
  check('sidecar-recorded', state1.entries['drill-alpha']?.scheduleId === 'schedule-1', JSON.stringify(Object.keys(state1.entries)))

  const second = await bridge.reconcile(store.scanSync('user').records)
  check('reconcile-is-idempotent', second.created.length === 0 && second.updated.length === 0 && service.created.length === 1, `created=${service.created.length}`)

  const restarted = createScheduleBridge({ getService: () => service, root: join(base, 'memory'), now: () => now })
  const third = await restarted.reconcile(store.scanSync('user').records)
  check('restart-reuses-sidecar', third.created.length === 0 && service.created.length === 1)

  await writeTask('drill-alpha', { dueAt: due + hour, remindAt: remind + hour })
  const changed = await restarted.reconcile(store.scanSync('user').records)
  check('reschedules-on-change', changed.updated.length === 1 && service.edited.some(entry => entry.action === 'update'), `updated=${changed.updated.length}`)

  await writeTask('drill-alpha', { taskStatus: 'done' })
  const done = await restarted.reconcile(store.scanSync('user').records)
  check('deletes-when-done', done.deleted.length === 1 && !(await loadBridgeState(join(base, 'memory'))).entries['drill-alpha'])
  const afterDone = renderTaskReminderText(collectTaskReminders(store.scanSync('user').records, now), now)
  check('no-reminder-when-done', afterDone === '')

  await writeTask('drill-alpha')
  const degraded = createScheduleBridge({ getService: () => undefined, root: join(base, 'memory'), now: () => now })
  const skipped = await degraded.reconcile(store.scanSync('user').records)
  check('degrades-without-service', skipped.available === false && skipped.skipped.length === 1 && skipped.skipped[0] === '*')
  const reminderText = renderTaskReminderText(collectTaskReminders(store.scanSync('user').records, now), now)
  check('session-reminder-fallback', reminderText.includes('<memory_tasks>') && reminderText.includes('drill-alpha'), `${reminderText.length} bytes`)

  const orphanService = makeService()
  orphanService.items().push(
    { id: 'orphan-1', title: `${TASK_TITLE_PREFIX}orphan`, prompt: `${TASK_MARKER}orphan` },
    { id: 'foreign-1', title: 'user private reminder', prompt: 'buy milk' },
  )
  const orphanBridge = createScheduleBridge({ getService: () => orphanService, root: join(base, 'orphan-root'), now: () => now })
  await mkdir(join(base, 'orphan-root'), { recursive: true })
  const orphaned = await orphanBridge.reconcile([])
  check('removes-only-own-orphans', orphaned.orphansRemoved.length === 1 && orphaned.orphansRemoved[0] === 'orphan-1' && orphanService.items().some(item => item.id === 'foreign-1'), JSON.stringify(orphaned.orphansRemoved))

  await readFile(stateFile, 'utf8')
  check('state-file-readable', true)
} finally {
  if (!process.env.WH_KEEP_DRILL) await rm(base, { recursive: true, force: true })
}

const failed = checks.filter(entry => !entry.ok)
const evidence = {
  stage,
  kind: 'task-schedule-drill',
  pass: failed.length === 0,
  at: new Date().toISOString(),
  checks,
  boundary: [
    'uses an in-process fake schedule service; a real DSH host is verified only after the 0.5.0 candidate is installed',
    'host delivery text/timing is owned by dsh-schedule; this drill asserts the request we hand it',
    'the sidecar is best-effort: losing it causes a single duplicate create, not data loss',
    'schedule.json is outside the memory tree and is not backed up by WH',
  ],
  tool: 'scripts/verification/task-schedule-drill.mjs',
}
const evidenceDir = join(repo, 'docs/evidence', stage)
await mkdir(evidenceDir, { recursive: true })
await writeFile(join(evidenceDir, 'schedule-bridge.json'), JSON.stringify(evidence, null, 2) + '\n')
console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'}: ${checks.length - failed.length}/${checks.length} checks -> docs/evidence/${stage}/schedule-bridge.json`)
process.exit(failed.length === 0 ? 0 : 1)
