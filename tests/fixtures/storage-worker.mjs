import { MemoryStore } from '../../src/store.ts'
const [root, name, mode] = process.argv.slice(2)
const crashPoint = mode?.startsWith('crash-') ? mode.slice('crash-'.length) : mode === 'crash' ? 'mutated' : undefined
const store = new MemoryStore(root, crashPoint ? { fault: point => { if (point === crashPoint) process.exit(71) } } : undefined)
await store.write({ ...(!crashPoint ? { status: 'verified' } : {}), name, type: 'reference', description: 'synthetic child process', body: crashPoint ? 'interrupted replacement' : name }, 'user')
