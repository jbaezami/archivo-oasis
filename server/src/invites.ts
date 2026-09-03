import { randomBytes } from 'node:crypto'
import type { DB } from './db'

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface InviteRecord {
  token: string
  label: string | null
  createdBy: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
  usedByUsername: string | null
  revokedAt: string | null
}

export type InviteStatus = 'valid' | 'used' | 'expired' | 'revoked'

interface InviteRow {
  token: string
  label: string | null
  created_by: string
  created_at: string
  expires_at: string
  used_at: string | null
  used_by_username: string | null
  revoked_at: string | null
}

function toInviteRecord(row: InviteRow): InviteRecord {
  return {
    token: row.token,
    label: row.label,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedByUsername: row.used_by_username,
    revokedAt: row.revoked_at,
  }
}

const SELECT_COLS =
  'token, label, created_by, created_at, expires_at, used_at, used_by_username, revoked_at'

export function createInvite(
  db: DB,
  params: { createdBy: string; label?: string | null },
): InviteRecord {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString()
  const label = params.label ?? null

  db.prepare(
    'INSERT INTO invites (token, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(token, label, params.createdBy, createdAt, expiresAt)

  return {
    token,
    label,
    createdBy: params.createdBy,
    createdAt,
    expiresAt,
    usedAt: null,
    usedByUsername: null,
    revokedAt: null,
  }
}

export function findInvite(db: DB, token: string): InviteRecord | undefined {
  const row = db
    .prepare(`SELECT ${SELECT_COLS} FROM invites WHERE token = ?`)
    .get(token) as InviteRow | undefined
  return row ? toInviteRecord(row) : undefined
}

export function inviteStatus(invite: InviteRecord, now: Date = new Date()): InviteStatus {
  if (invite.revokedAt) return 'revoked'
  if (invite.usedAt) return 'used'
  if (new Date(invite.expiresAt).getTime() < now.getTime()) return 'expired'
  return 'valid'
}

export function listInvites(db: DB): (InviteRecord & { status: InviteStatus })[] {
  // rowid desc como desempate: created_at puede coincidir al milisegundo entre dos invitaciones creadas seguidas.
  const rows = db
    .prepare(`SELECT ${SELECT_COLS} FROM invites ORDER BY created_at DESC, rowid DESC`)
    .all() as InviteRow[]
  const now = new Date()
  return rows.map((row) => {
    const record = toInviteRecord(row)
    return { ...record, status: inviteStatus(record, now) }
  })
}

export function markInviteUsed(db: DB, token: string, username: string): boolean {
  const result = db
    .prepare(
      'UPDATE invites SET used_at = ?, used_by_username = ? WHERE token = ? AND used_at IS NULL AND revoked_at IS NULL',
    )
    .run(new Date().toISOString(), username, token)
  return result.changes > 0
}

export function revokeInvite(db: DB, token: string): boolean {
  const result = db
    .prepare(
      'UPDATE invites SET revoked_at = ? WHERE token = ? AND used_at IS NULL AND revoked_at IS NULL',
    )
    .run(new Date().toISOString(), token)
  return result.changes > 0
}
