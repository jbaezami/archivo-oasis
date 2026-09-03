import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export type DB = Database.Database
export type AppKey = 'jellyfin' | 'jellyseerr' | 'cantina' | 'aportaciones'
export const APP_KEYS: AppKey[] = ['jellyfin', 'jellyseerr', 'cantina', 'aportaciones']

export function createDb(filePath: string): DB {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }

  const db = new Database(filePath)

  if (filePath !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      jellyfin_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS permissions (
      user_id INTEGER NOT NULL REFERENCES users(id),
      app_key TEXT NOT NULL CHECK (app_key IN ('jellyfin', 'jellyseerr', 'cantina', 'aportaciones')),
      granted_at TEXT NOT NULL,
      PRIMARY KEY (user_id, app_key)
    );

    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      label TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by_username TEXT,
      revoked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      description TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('movies','tv','music')),
      source_type TEXT NOT NULL CHECK (source_type IN ('url','file')),
      source_url TEXT,
      file_name TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (status IN ('pendiente','procesada','rechazada')),
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT,
      processed_by TEXT
    );
  `)

  migrateUsersLastLoginNullable(db)

  return db
}

/**
 * Migración idempotente: en despliegues antiguos la columna `users.last_login_at`
 * se creó como `NOT NULL`. Un usuario pre-creado por invitación aún no ha iniciado
 * sesión, así que la columna debe admitir NULL. `CREATE TABLE IF NOT EXISTS` no
 * altera una tabla ya existente y la BD vive en un volumen persistente, por lo que
 * hace falta reconstruir la tabla. SQLite no permite quitar un `NOT NULL` con
 * `ALTER TABLE`, así que se recrea preservando filas e ids (las referencias de
 * `permissions.user_id` siguen siendo válidas porque los ids se conservan).
 */
export function migrateUsersLastLoginNullable(db: DB): void {
  const columns = db.pragma('table_info(users)') as { name: string; notnull: number }[]
  const lastLogin = columns.find((c) => c.name === 'last_login_at')
  if (!lastLogin || lastLogin.notnull !== 1) return

  // Las claves foráneas (better-sqlite3 las activa por defecto) impedirían el DROP TABLE;
  // se desactivan durante la reconstrucción y se restauran después. Los ids se conservan,
  // así que las filas de `permissions` siguen apuntando al usuario correcto.
  const fkWasOn = db.pragma('foreign_keys', { simple: true }) === 1
  if (fkWasOn) db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE users_new (
          id INTEGER PRIMARY KEY,
          jellyfin_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
          created_at TEXT NOT NULL,
          last_login_at TEXT
        );
        INSERT INTO users_new (id, jellyfin_username, created_at, last_login_at)
          SELECT id, jellyfin_username, created_at, last_login_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
      `)
    })()
  } finally {
    if (fkWasOn) db.pragma('foreign_keys = ON')
  }
}
