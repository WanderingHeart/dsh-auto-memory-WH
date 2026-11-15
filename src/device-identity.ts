import { createHash, generateKeyPairSync, createPublicKey, createPrivateKey, diffieHellman, hkdfSync, randomBytes, createCipheriv, createDecipheriv, sign, verify } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { canonicalJson } from './transfer.ts'

export const IDENTITY_VERSION = 1
export const ENVELOPE_FORMAT = 'wh-sync-envelope'
export const ENVELOPE_VERSION = 1

export interface DeviceIdentity {
  version: typeof IDENTITY_VERSION
  deviceId: string
  signPublicKey: string
  signPrivateKey: string
  encPublicKey: string
  encPrivateKey: string
  createdAt: string
}

export interface TrustEntry {
  deviceId: string
  signPublicKey: string
  encPublicKey: string
  label?: string
  addedAt: string
}

export interface TrustStore { version: 1; devices: TrustEntry[] }

export interface SyncEnvelope {
  format: typeof ENVELOPE_FORMAT
  version: typeof ENVELOPE_VERSION
  sender: { deviceId: string; signPublicKey: string; encPublicKey: string }
  recipient: { deviceId: string }
  nonce: string
  ciphertext: string
  signature: string
}

export class IdentityError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function deviceIdFromPublicKey(publicKey: string): string {
  return `dev-${createHash('sha256').update(publicKey).digest('hex').slice(0, 16)}`
}

export function generateIdentity(now = Date.now()): DeviceIdentity {
  const signing = generateKeyPairSync('ed25519')
  const encryption = generateKeyPairSync('x25519')
  const signPublicKey = signing.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  const encPublicKey = encryption.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
  return {
    version: IDENTITY_VERSION,
    deviceId: deviceIdFromPublicKey(signPublicKey),
    signPublicKey,
    signPrivateKey: signing.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    encPublicKey,
    encPrivateKey: encryption.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    createdAt: new Date(now).toISOString(),
  }
}

export async function loadIdentity(file: string): Promise<DeviceIdentity> {
  const parsed = JSON.parse(await readFile(file, 'utf8')) as DeviceIdentity
  if (parsed.version !== IDENTITY_VERSION || !parsed.signPrivateKey || !parsed.encPrivateKey) throw new IdentityError('INVALID_IDENTITY', '设备身份文件无效。')
  if (deviceIdFromPublicKey(parsed.signPublicKey) !== parsed.deviceId) throw new IdentityError('INVALID_IDENTITY', '设备身份与公钥不匹配。')
  return parsed
}

export async function saveIdentity(file: string, identity: DeviceIdentity): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(identity, null, 2), { mode: 0o600 })
}

export function trustEntry(identity: DeviceIdentity, label?: string, now = Date.now()): TrustEntry {
  return { deviceId: identity.deviceId, signPublicKey: identity.signPublicKey, encPublicKey: identity.encPublicKey, label, addedAt: new Date(now).toISOString() }
}

export async function loadTrust(file: string): Promise<TrustStore> {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8')) as TrustStore
    if (parsed.version !== 1 || !Array.isArray(parsed.devices)) throw new IdentityError('INVALID_TRUST', '信任文件无效。')
    return parsed
  } catch (error) {
    if (error instanceof IdentityError) throw error
    return { version: 1, devices: [] }
  }
}

export async function saveTrust(file: string, store: TrustStore): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2))
}

export function addTrust(store: TrustStore, entry: TrustEntry): TrustStore {
  return { version: 1, devices: [...store.devices.filter(device => device.deviceId !== entry.deviceId), entry] }
}

export function removeTrust(store: TrustStore, deviceId: string): TrustStore {
  return { version: 1, devices: store.devices.filter(device => device.deviceId !== deviceId) }
}

function deriveKey(privateKeyB64: string, publicKeyB64: string): Buffer {
  const shared = diffieHellman({ privateKey: createPrivateKey({ key: Buffer.from(privateKeyB64, 'base64'), format: 'der', type: 'pkcs8' }), publicKey: createPublicKey({ key: Buffer.from(publicKeyB64, 'base64'), format: 'der', type: 'spki' }) })
  return Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), Buffer.from('wh-sync-v1'), 32))
}

function decodeBase64(value: unknown, field: string): Buffer {
  if (typeof value !== 'string' || value.length === 0) throw new IdentityError('INVALID_ENVELOPE', `信封字段 ${field} 缺失或不是字符串。`)
  const buffer = Buffer.from(value, 'base64')
  if (buffer.length === 0) throw new IdentityError('INVALID_ENVELOPE', `信封字段 ${field} 不是有效的 base64。`)
  return buffer
}

export function verifyEnvelope(value: unknown): SyncEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IdentityError('INVALID_ENVELOPE', '信封必须是对象。')
  const envelope = value as SyncEnvelope
  if (envelope.format !== ENVELOPE_FORMAT) throw new IdentityError('UNSUPPORTED_FORMAT', '不是 WH 同步信封。')
  if (envelope.version !== ENVELOPE_VERSION) throw new IdentityError('UNSUPPORTED_VERSION', `不支持的信封版本：${String(envelope.version)}。`)
  if (!envelope.sender || typeof envelope.sender.deviceId !== 'string') throw new IdentityError('INVALID_ENVELOPE', '信封缺少发送方。')
  if (!envelope.recipient || typeof envelope.recipient.deviceId !== 'string') throw new IdentityError('INVALID_ENVELOPE', '信封缺少收件人。')
  decodeBase64(envelope.sender.signPublicKey, 'sender.signPublicKey')
  decodeBase64(envelope.sender.encPublicKey, 'sender.encPublicKey')
  decodeBase64(envelope.signature, 'signature')
  if (decodeBase64(envelope.nonce, 'nonce').length !== 12) throw new IdentityError('INVALID_ENVELOPE', '信封 nonce 长度必须是 12 字节。')
  if (decodeBase64(envelope.ciphertext, 'ciphertext').length <= 16) throw new IdentityError('INVALID_ENVELOPE', '信封密文长度非法。')
  return envelope
}

export function sealChangeset(changeset: unknown, identity: DeviceIdentity, recipient: TrustEntry): SyncEnvelope {
  const key = deriveKey(identity.encPrivateKey, recipient.encPublicKey)
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(changeset), 'utf8'), cipher.final(), cipher.getAuthTag()]).toString('base64')
  const envelope: SyncEnvelope = {
    format: ENVELOPE_FORMAT,
    version: ENVELOPE_VERSION,
    sender: { deviceId: identity.deviceId, signPublicKey: identity.signPublicKey, encPublicKey: identity.encPublicKey },
    recipient: { deviceId: recipient.deviceId },
    nonce: nonce.toString('base64'),
    ciphertext,
    signature: '',
  }
  const payload = canonicalJson({ ...envelope, signature: undefined })
  envelope.signature = sign(null, Buffer.from(payload), createPrivateKey({ key: Buffer.from(identity.signPrivateKey, 'base64'), format: 'der', type: 'pkcs8' })).toString('base64')
  return envelope
}

export function openEnvelope(envelope: SyncEnvelope, identity: DeviceIdentity, trust: TrustStore): unknown {
  if (!envelope || envelope.format !== ENVELOPE_FORMAT) throw new IdentityError('UNSUPPORTED_FORMAT', '不是 WH 同步信封。')
  if (envelope.version !== ENVELOPE_VERSION) throw new IdentityError('UNSUPPORTED_VERSION', `不支持的信封版本：${String(envelope.version)}。`)
  if (envelope.recipient.deviceId !== identity.deviceId) throw new IdentityError('WRONG_RECIPIENT', '信封收件人不是本设备。')
  const sender = trust.devices.find(device => device.deviceId === envelope.sender.deviceId)
  if (!sender) throw new IdentityError('UNTRUSTED_SENDER', `发送方未在信任列表中：${envelope.sender.deviceId}。`)
  if (sender.signPublicKey !== envelope.sender.signPublicKey || sender.encPublicKey !== envelope.sender.encPublicKey) throw new IdentityError('KEY_MISMATCH', '发送方公钥与信任记录不一致。')
  const payload = canonicalJson({ ...envelope, signature: undefined })
  const ok = verify(null, Buffer.from(payload), createPublicKey({ key: Buffer.from(envelope.sender.signPublicKey, 'base64'), format: 'der', type: 'spki' }), Buffer.from(envelope.signature, 'base64'))
  if (!ok) throw new IdentityError('BAD_SIGNATURE', '信封签名校验失败。')
  const combined = Buffer.from(envelope.ciphertext, 'base64')
  if (combined.length <= 16) throw new IdentityError('INVALID_ENVELOPE', '密文长度非法。')
  const tag = combined.subarray(combined.length - 16)
  const body = combined.subarray(0, combined.length - 16)
  try {
    const key = deriveKey(identity.encPrivateKey, sender.encPublicKey)
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce, 'base64'))
    decipher.setAuthTag(tag)
    return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'))
  } catch {
    throw new IdentityError('DECRYPT_FAILED', '解密失败：密钥不匹配或内容被篡改。')
  }
}
