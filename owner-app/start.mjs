import { writeFileSync } from "node:fs";
if (process.env.RENDER) {
  writeFileSync(".env", "APP_KEY=64f4138797287956d958003c9b497c7b67bbe20dffec6e06f4c109e01294ed8c\nOWNER_PASSWORD_HASH=85c3e41a67cb6af0d34e3c99ee7db684.30346f79cde1ff42473418b02c04e62d07462b5\nDB_PATH=/var/data/minhaj-shift.sqlite\n");
}
import fs from "node:fs";
if (process.env.RENDER) {
  fs.writeFileSync(".env", "APP_KEY=64f4138797287956d958003c9b497c7b67bbe20dffec6e06f4c109e01294ed8c\nOWNER_PASSWORD_HASH=85c3e41a67cb6af0d34e3c99ee7db684.30346f79cde1ff42473418b02c04e62d07462b5\nDB_PATH=/var/data/minhaj-shift.sqlite\n");
}
import fs from "node:fs";
if (process.env.RENDER && !fs.existsSync(".env")) {
  fs.writeFileSync(".env", "APP_KEY=64f4138797287956d958003c9b497c7b67bbe20dffec6e06f4c109e01294ed8c\nOWNER_PASSWORD_HASH=85c3e41a67cb6af0d34e3c99ee7db684.30346f79cde1ff42473418b02c04e62d07462b5\nDB_PATH=/var/data/minhaj-shift.sqlite\n");
}
import { access, readFile, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { passwordHash, randomToken } from './backend/security.mjs'

if (Number(process.versions.node.split('.')[0]) < 24) {
  console.error('French Tacos Antwerp needs Node.js 24 or newer.')
  process.exit(1)
}
if (process.platform !== 'win32') process.umask(0o077)
process.chdir(fileURLToPath(new URL('.', import.meta.url)))

async function readSettings() {
  try { return parseEnv(await readFile('.env', 'utf8')) } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }

  console.log('Set up the French Tacos Antwerp owner account.')
  const muted = new Writable({ write(_chunk, _encoding, done) { done() } })
  const input = createInterface({ input: process.stdin, output: muted, terminal: Boolean(process.stdin.isTTY) })
  const answers = input[Symbol.asyncIterator]()
  async function ask(prompt) {
    process.stdout.write(prompt)
    const answer = await answers.next()
    process.stdout.write('\n')
    if (answer.done) throw new Error('Owner setup was cancelled.')
    return answer.value
  }

  try {
    for (;;) {
      const password = await ask('Choose a password (14–256 characters, hidden): ')
      if (password.length < 14 || password.length > 256) {
        console.log('Use between 14 and 256 characters.')
        continue
      }
      if (password !== await ask('Confirm your password: ')) {
        console.log('The passwords differ. Try again.')
        continue
      }
      const contents = [
        'APP_KEY=' + randomToken(),
        'OWNER_PASSWORD_HASH=' + await passwordHash(password),
        'DB_PATH=data/minhaj-shift.sqlite',
        '',
      ].join('\n')
      await writeFile('.env', contents, { flag: 'wx', mode: 0o600 })
      return parseEnv(contents)
    }
  } finally {
    input.close()
  }
}

try {
  await access('dist/index.html')
  const settings = await readSettings()
  const { startOwner } = await import('./backend/server.mjs')
  await startOwner(settings)
} catch (error) {
  if (error.code === 'EADDRINUSE') console.error('The owner app port is already in use. Check the other windows or change OWNER_PORT.')
  else if (error.code === 'ENOENT') console.error('The app files could not be found. Extract the entire ZIP to a folder before launching.')
  else console.error(error.message)
  process.exitCode = 1
}
