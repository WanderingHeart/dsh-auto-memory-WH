import { readFile, writeFile } from 'node:fs/promises'
import { applyMigration, createBackup, inventoryRoot, planMigration, recoverTransactions, releaseStaleLock, restoreBackup, verifySnapshot } from './maintenance.ts'
import { MemoryStore } from './store.ts'
import { applyImport, buildExportPackage, planImport, verifyExportPackage } from './transfer.ts'
import { applyChangeset, buildChangeset, loadSyncState, saveSyncState, verifyChangeset } from './sync.ts'
import { addTrust, generateIdentity, loadIdentity, loadTrust, openEnvelope, removeTrust, saveIdentity, saveTrust, sealChangeset, verifyEnvelope } from './device-identity.ts'
import { archiveProject, listProjects, mergeProjects, remapProject } from './projects.ts'
import { createLocalEndpoint, type SyncEndpoint } from './endpoint.ts'
import { createHttpTransport } from './transport.ts'
import { createRelayServer } from './sync-relay.ts'
import { pullFromPeer, pushToPeer } from './sync-flow.ts'

async function localEndpoint(args: { root: string; scope: 'user' | 'project'; identityFile: string; trustFile: string; stateFile?: string; cwd?: string; deviceId?: string }): Promise<SyncEndpoint> {
  const identity = await loadIdentity(args.identityFile)
  const trust = await loadTrust(args.trustFile)
  if (args.deviceId !== undefined && args.deviceId !== identity.deviceId) throw new Error('deviceId does not match the identity file')
  return createLocalEndpoint({ root: args.root, scope: args.scope, deviceId: identity.deviceId, identity, trust, cwd: args.cwd, stateFile: args.stateFile })
}

function relayTransport(args: { relayUrl: string; token: string; timeoutMs?: number }) {
  return createHttpTransport({ baseUrl: args.relayUrl, token: args.token, timeoutMs: args.timeoutMs })
}

const [command, requestFile] = process.argv.slice(2)
if (command === '--help' || command === undefined) {
  console.log('WH offline maintenance: node lib/maintenance-cli.js <command> <request.json>\nCommands: inventory, plan, apply, backup, verify, restore, recover, unlock, archive-list, archive-restore, scope-backups, projects, project-remap, project-merge, project-archive, transfer-export, transfer-plan, transfer-apply, sync-changes, sync-apply, sync-init, sync-trust, sync-seal, sync-open, sync-push, sync-pull, sync-relay\nRead docs/storage-recovery.md before use. No DSH profile is switched by this program.')
} else {
  try {
    if (!requestFile) throw new Error('A JSON request file is required')
    const args = JSON.parse(await readFile(requestFile, 'utf8'))
    let result: unknown
    let waitForShutdown: (() => Promise<void>) | null = null
    switch (command) {
      case 'sync-push': { const endpoint = await localEndpoint(args); const transport = relayTransport(args); const pushed = await pushToPeer(endpoint, transport, args.recipient); result = { recipient: pushed.recipient, published: pushed.published, since: pushed.since, until: pushed.until, records: pushed.records, messageId: pushed.messageId, duplicate: pushed.duplicate, checksum: pushed.changeset.checksum }; break }
      case 'sync-pull': { const endpoint = await localEndpoint(args); const transport = relayTransport(args); result = await pullFromPeer(endpoint, transport, { limit: args.limit, onConflict: args.onConflict === 'remote' ? 'remote' : args.onConflict === 'fork' ? 'fork' : 'manual' }); break }
      case 'sync-relay': { const relay = createRelayServer({ token: args.token, root: args.root, host: args.host, port: args.port, retentionMs: args.retentionMs }); const address = await relay.start(); result = { ...address, root: args.root, retentionMs: args.retentionMs }; waitForShutdown = async () => { await new Promise<void>(resolve => { process.once('SIGINT', () => resolve()); process.once('SIGTERM', () => resolve()) }); await relay.stop() }; break }
      case 'sync-init': { const identity = generateIdentity(); await saveIdentity(args.file, identity); result = { deviceId: identity.deviceId, signPublicKey: identity.signPublicKey, encPublicKey: identity.encPublicKey, file: args.file }; break }
      case 'sync-trust': { const store = await loadTrust(args.trustFile); if (args.action === 'add') { if (!args.deviceId || !args.signPublicKey || !args.encPublicKey) throw new Error('deviceId, signPublicKey and encPublicKey are required'); const next = addTrust(store, { deviceId: args.deviceId, signPublicKey: args.signPublicKey, encPublicKey: args.encPublicKey, label: args.label, addedAt: new Date().toISOString() }); await saveTrust(args.trustFile, next); result = { devices: next.devices.map(device => device.deviceId) } } else if (args.action === 'remove') { const next = removeTrust(store, args.deviceId); await saveTrust(args.trustFile, next); result = { devices: next.devices.map(device => device.deviceId) } } else result = { devices: store.devices.map(device => ({ deviceId: device.deviceId, label: device.label })) }; break }
      case 'sync-seal': { const identity = await loadIdentity(args.identityFile); const trust = await loadTrust(args.trustFile); const recipient = trust.devices.find(device => device.deviceId === args.recipient); if (!recipient) throw new Error('recipient is not trusted'); const changeset = JSON.parse(await readFile(args.file, 'utf8')); const envelope = sealChangeset(changeset, identity, recipient); await writeFile(args.out, JSON.stringify(envelope, null, 2)); result = { format: envelope.format, version: envelope.version, sender: envelope.sender.deviceId, recipient: envelope.recipient.deviceId, out: args.out }; break }
      case 'sync-open': { const identity = await loadIdentity(args.identityFile); const trust = await loadTrust(args.trustFile); const envelope = verifyEnvelope(JSON.parse(await readFile(args.file, 'utf8'))); const changeset = openEnvelope(envelope, identity, trust); await writeFile(args.out, JSON.stringify(changeset, null, 2)); result = { sender: envelope.sender.deviceId, recipient: envelope.recipient.deviceId, out: args.out }; break }
      case 'sync-changes': { const store = new MemoryStore(args.root); const state = args.stateFile ? await loadSyncState(args.stateFile) : null; const since = args.since ?? state?.cursor ?? 0; const set = await buildChangeset(store, { scope: args.scope, cwd: args.cwd, since, deviceId: args.deviceId }); await writeFile(args.out, JSON.stringify(set, null, 2)); result = { format: set.format, version: set.version, deviceId: set.deviceId, scope: set.scope, since: set.since, until: set.until, upserts: set.upserts.length, deletions: set.deletions.length, checksum: set.checksum, out: args.out }; break }
      case 'sync-apply': { const store = new MemoryStore(args.root); const set = verifyChangeset(JSON.parse(await readFile(args.file, 'utf8'))); const applied = await applyChangeset(store, set, { cwd: args.cwd, approvedChecksum: args.approvedChecksum, onConflict: args.onConflict === 'remote' ? 'remote' : args.onConflict === 'fork' ? 'fork' : 'manual' }); if (args.stateFile) await saveSyncState(args.stateFile, { deviceId: set.deviceId, scope: set.scope, cursor: set.until, updatedAt: new Date().toISOString() }); result = applied; break }
      case 'transfer-export': { const store = new MemoryStore(args.root); const pkg = buildExportPackage(await store.list(args.scope, args.cwd), { scope: args.scope }); await writeFile(args.out, JSON.stringify(pkg, null, 2)); result = { format: pkg.format, version: pkg.version, scope: pkg.scope, records: pkg.records.length, checksum: pkg.checksum, out: args.out }; break }
      case 'transfer-plan': { const store = new MemoryStore(args.root); const pkg = verifyExportPackage(JSON.parse(await readFile(args.file, 'utf8'))); result = planImport(pkg, await store.list(pkg.scope, args.cwd)); break }
      case 'transfer-apply': { const store = new MemoryStore(args.root); const pkg = verifyExportPackage(JSON.parse(await readFile(args.file, 'utf8'))); result = await applyImport(store, pkg, { cwd: args.cwd, approvedChecksum: args.approvedChecksum, onConflict: args.onConflict }); break }
      case 'inventory': result = await inventoryRoot(args.source, args.selection); break
      case 'plan': result = await planMigration(args); break
      case 'apply': result = await applyMigration(args.plan, args.options); break
      case 'backup': result = await createBackup(args); break
      case 'verify': { const snapshot = await verifySnapshot(args.file, args.expectedHash); result = { verified: true, files: snapshot.files.length, id: snapshot.id }; break }
      case 'restore': result = await restoreBackup(args); break
      case 'recover': result = await recoverTransactions(args.root, args.writersStopped); break
      case 'unlock': await releaseStaleLock(args); result = { released: true }; break
      case 'archive-list': result = await new MemoryStore(args.root).listArchive(args.scope, args.cwd); break
      case 'scope-backups': result = await new MemoryStore(args.root).listBackups(args.scope, args.cwd); break
      case 'projects': result = listProjects(args.root); break
      case 'project-remap': result = remapProject(args); break
      case 'project-merge': result = mergeProjects(args); break
      case 'project-archive': result = archiveProject(args); break
      case 'archive-restore':
        if (args.writersStopped !== true) throw new Error('Stop writers before archive restoration')
        await new MemoryStore(args.root).restoreArchived(args.id, args.scope, args.cwd); result = { restored: true }; break
      default: throw new Error('Unknown maintenance command')
    }
    console.log(JSON.stringify(result, null, 2))
    if (waitForShutdown) await waitForShutdown()
  } catch (error) {
    // Never print request payloads or file contents on error.
    console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Maintenance failed' }))
    process.exitCode = 1
  }
}
