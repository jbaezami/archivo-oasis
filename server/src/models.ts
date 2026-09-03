import type { DB, AppKey } from './db'

export interface UserRecord {
  id: number
  jellyfinUsername: string
  createdAt: string
  lastLoginAt: string | null
}

interface UserRow {
  id: number
  jellyfin_username: string
  created_at: string
  last_login_at: string | null
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    jellyfinUsername: row.jellyfin_username,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }
}

export function upsertUserLogin(db: DB, username: string): UserRecord {
  const now = new Date().toISOString()
  const existing = db
    .prepare('SELECT id, jellyfin_username, created_at, last_login_at FROM users WHERE jellyfin_username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined

  if (existing) {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, existing.id)
    return toUserRecord({ ...existing, last_login_at: now })
  }

  const result = db
    .prepare('INSERT INTO users (jellyfin_username, created_at, last_login_at) VALUES (?, ?, ?)')
    .run(username, now, now)

  return toUserRecord({
    id: Number(result.lastInsertRowid),
    jellyfin_username: username,
    created_at: now,
    last_login_at: now,
  })
}

export function createInvitedUser(db: DB, username: string): UserRecord {
  const existing = findUserByUsername(db, username)
  if (existing) return existing

  const now = new Date().toISOString()
  const result = db
    .prepare('INSERT INTO users (jellyfin_username, created_at, last_login_at) VALUES (?, ?, NULL)')
    .run(username, now)

  return {
    id: Number(result.lastInsertRowid),
    jellyfinUsername: username,
    createdAt: now,
    lastLoginAt: null,
  }
}

// Borra la ficha del usuario en archivo-oasis (y sus permisos). No toca Jellyfin.
// Devuelve false si el usuario no existía. Idempotente por transacción.
export function deleteUser(db: DB, username: string): boolean {
  const user = findUserByUsername(db, username)
  if (!user) return false
  db.transaction(() => {
    db.prepare('DELETE FROM permissions WHERE user_id = ?').run(user.id)
    db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
  })()
  return true
}

export function findUserByUsername(db: DB, username: string): UserRecord | undefined {
  const row = db
    .prepare('SELECT id, jellyfin_username, created_at, last_login_at FROM users WHERE jellyfin_username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined
  return row ? toUserRecord(row) : undefined
}

export function getPermissions(db: DB, userId: number): AppKey[] {
  const rows = db.prepare('SELECT app_key FROM permissions WHERE user_id = ?').all(userId) as { app_key: AppKey }[]
  return rows.map((r) => r.app_key)
}

export function setPermission(db: DB, userId: number, appKey: AppKey, granted: boolean): void {
  if (granted) {
    db.prepare(
      'INSERT INTO permissions (user_id, app_key, granted_at) VALUES (?, ?, ?) ON CONFLICT(user_id, app_key) DO NOTHING',
    ).run(userId, appKey, new Date().toISOString())
  } else {
    db.prepare('DELETE FROM permissions WHERE user_id = ? AND app_key = ?').run(userId, appKey)
  }
}

export function listUsersWithPermissions(
  db: DB,
): { username: string; lastLoginAt: string | null; permissions: AppKey[] }[] {
  const users = db
    .prepare('SELECT id, jellyfin_username, last_login_at FROM users ORDER BY jellyfin_username COLLATE NOCASE')
    .all() as { id: number; jellyfin_username: string; last_login_at: string | null }[]

  return users.map((u) => ({
    username: u.jellyfin_username,
    lastLoginAt: u.last_login_at,
    permissions: getPermissions(db, u.id),
  }))
}
