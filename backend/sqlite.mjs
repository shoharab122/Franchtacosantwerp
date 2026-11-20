import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const migrations = fileURLToPath(new URL('../drizzle/', import.meta.url))

export function openSqlite(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(resolve(filename)), { recursive: true, mode: 0o700 })
  const sqlite = new DatabaseSync(filename)
  sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;')
  sqlite.exec('BEGIN IMMEDIATE;')
  try {
    const files = readdirSync(migrations).filter(file => file.endsWith('.sql')).sort()
    const version = sqlite.prepare('PRAGMA user_version').get().user_version
    if (version > files.length) throw new Error('This database requires a newer version of French Tacos Antwerp.')
    for (const file of files.slice(version)) sqlite.exec(readFileSync(resolve(migrations, file), 'utf8'))
    sqlite.exec('PRAGMA user_version = ' + files.length)
    sqlite.exec('COMMIT;')
  } catch (error) {
    sqlite.exec('ROLLBACK;')
    sqlite.close()
    throw error
  }

  return {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      return {
        bind(...args) {
          return {
            async first() { return statement.get(...args) ?? null },
            async all() { return { results: statement.all(...args) } },
            execute() { return { meta: statement.run(...args) } },
            async run() { return this.execute() },
          }
        },
      }
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE;')
      try {
        const results = statements.map(statement => statement.execute())
        sqlite.exec('COMMIT;')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK;')
        throw error
      }
    },
    close() { sqlite.close() },
  }
}
