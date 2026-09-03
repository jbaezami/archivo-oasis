import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import { migrateUsersLastLoginNullable } from './db'

function withOldSchema(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      jellyfin_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );
    CREATE TABLE permissions (
      user_id INTEGER NOT NULL REFERENCES users(id),
      app_key TEXT NOT NULL,
      granted_at TEXT NOT NULL,
      PRIMARY KEY (user_id, app_key)
    );
  `)
  return db
}

function lastLoginNotNull(db: Database.Database): number {
  const columns = db.pragma('table_info(users)') as { name: string; notnull: number }[]
  return columns.find((c) => c.name === 'last_login_at')!.notnull
}

test('migrateUsersLastLoginNullable hace nullable la columna y preserva las filas', () => {
  const db = withOldSchema()
  db.prepare('INSERT INTO users (id, jellyfin_username, created_at, last_login_at) VALUES (?, ?, ?, ?)').run(
    7,
    'marta',
    '2026-01-01T00:00:00.000Z',
    '2026-01-02T00:00:00.000Z',
  )
  db.prepare('INSERT INTO permissions (user_id, app_key, granted_at) VALUES (?, ?, ?)').run(
    7,
    'jellyfin',
    '2026-01-01T00:00:00.000Z',
  )
  assert.equal(lastLoginNotNull(db), 1)

  migrateUsersLastLoginNullable(db)

  assert.equal(lastLoginNotNull(db), 0)
  const row = db.prepare('SELECT id, jellyfin_username, last_login_at FROM users WHERE id = 7').get() as {
    id: number
    jellyfin_username: string
    last_login_at: string
  }
  assert.deepEqual(row, {
    id: 7,
    jellyfin_username: 'marta',
    last_login_at: '2026-01-02T00:00:00.000Z',
  })
  const perm = db.prepare('SELECT user_id FROM permissions WHERE app_key = ?').get('jellyfin') as {
    user_id: number
  }
  assert.equal(perm.user_id, 7)
})

test('migrateUsersLastLoginNullable ejecutada dos veces es un no-op', () => {
  const db = withOldSchema()
  migrateUsersLastLoginNullable(db)
  assert.equal(lastLoginNotNull(db), 0)
  migrateUsersLastLoginNullable(db)
  assert.equal(lastLoginNotNull(db), 0)
})

test('migrateUsersLastLoginNullable no toca una tabla que ya es nullable', () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      jellyfin_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
  `)
  migrateUsersLastLoginNullable(db)
  assert.equal(lastLoginNotNull(db), 0)
})
