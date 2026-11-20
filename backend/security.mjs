const encoder = new TextEncoder()
const decoder = new TextDecoder()
const secrets = new Map()

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex) {
  return Uint8Array.from(hex.match(/../g) ?? [], pair => Number.parseInt(pair, 16))
}

export function randomToken() {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)))
}

function appKeys(secret) {
  if (!/^[a-f0-9]{64}$/i.test(secret ?? '')) throw new Error('APP_KEY must be a 32-byte hex secret.')
  if (!secrets.has(secret)) {
    secrets.set(secret, (async () => {
      const root = await crypto.subtle.importKey('raw', hexToBytes(secret), 'HKDF', false, ['deriveKey'])
      // Keep the original salt so existing installations can read their records.
      const derive = (info, algorithm, usages) => crypto.subtle.deriveKey({
        name: 'HKDF', hash: 'SHA-256', salt: encoder.encode('Minhaj Shift v1'), info: encoder.encode(info),
      }, root, algorithm, false, usages)
      return {
        mac: await derive('lookup', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
        vault: await derive('staff records', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
      }
    })())
  }
  return secrets.get(secret)
}

export async function digest(secret, namespace, value) {
  const { mac } = await appKeys(secret)
  return bytesToHex(await crypto.subtle.sign('HMAC', mac, encoder.encode(namespace + ':' + value)))
}

export async function encrypt(secret, value, context) {
  const { vault } = await appKeys(secret)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const encrypted = await crypto.subtle.encrypt({
    name: 'AES-GCM', iv, additionalData: encoder.encode(context),
  }, vault, encoder.encode(value))
  return bytesToHex(iv) + '.' + bytesToHex(encrypted)
}

export async function decrypt(secret, value, context) {
  if (value == null) return null
  const { vault } = await appKeys(secret)
  const [iv, encrypted] = value.split('.').map(hexToBytes)
  return decoder.decode(await crypto.subtle.decrypt({
    name: 'AES-GCM', iv, additionalData: encoder.encode(context),
  }, vault, encrypted))
}

export async function passwordHash(password, salt = randomToken().slice(0, 32), iterations = 600_000) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: hexToBytes(salt), iterations,
  }, key, 256)
  return salt + '.' + bytesToHex(bits)
}

export async function checkPassword(password, stored, iterations) {
  if (typeof password !== 'string' || password.length > 256 || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(stored ?? '')) return false
  const candidate = await passwordHash(password, stored.split('.')[0], iterations)
  let mismatch = 0
  for (let i = 0; i < candidate.length; i++) mismatch |= candidate.charCodeAt(i) ^ stored.charCodeAt(i)
  return mismatch === 0
}
