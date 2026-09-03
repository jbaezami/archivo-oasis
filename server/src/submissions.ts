import type { DB } from './db'

export type SubmissionCategory = 'movies' | 'tv' | 'music'
export type SubmissionStatus = 'pendiente' | 'procesada' | 'rechazada'
export type SubmissionSourceType = 'url' | 'file'

export const SUBMISSION_CATEGORIES: SubmissionCategory[] = ['movies', 'tv', 'music']

export interface SubmissionRecord {
  id: number
  userId: number
  description: string
  category: SubmissionCategory
  sourceType: SubmissionSourceType
  sourceUrl: string | null
  fileName: string | null
  status: SubmissionStatus
  rejectionReason: string | null
  createdAt: string
  processedAt: string | null
  processedBy: string | null
}

interface SubmissionRow {
  id: number
  user_id: number
  description: string
  category: SubmissionCategory
  source_type: SubmissionSourceType
  source_url: string | null
  file_name: string | null
  status: SubmissionStatus
  rejection_reason: string | null
  created_at: string
  processed_at: string | null
  processed_by: string | null
}

function toRecord(row: SubmissionRow): SubmissionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    description: row.description,
    category: row.category,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    fileName: row.file_name,
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    processedBy: row.processed_by,
  }
}

const COLS =
  'id, user_id, description, category, source_type, source_url, file_name, status, rejection_reason, created_at, processed_at, processed_by'

export function createSubmission(
  db: DB,
  input: {
    userId: number
    description: string
    category: SubmissionCategory
    sourceType: SubmissionSourceType
    sourceUrl?: string | null
    fileName?: string | null
  },
): SubmissionRecord {
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO submissions (user_id, description, category, source_type, source_url, file_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId,
      input.description,
      input.category,
      input.sourceType,
      input.sourceUrl ?? null,
      input.fileName ?? null,
      now,
    )
  return getSubmission(db, Number(result.lastInsertRowid))!
}

export function getSubmission(db: DB, id: number): SubmissionRecord | undefined {
  const row = db.prepare(`SELECT ${COLS} FROM submissions WHERE id = ?`).get(id) as SubmissionRow | undefined
  return row ? toRecord(row) : undefined
}

export function listByUser(db: DB, userId: number): SubmissionRecord[] {
  const rows = db
    .prepare(`SELECT ${COLS} FROM submissions WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
    .all(userId) as SubmissionRow[]
  return rows.map(toRecord)
}

export function listAll(db: DB, status?: SubmissionStatus): (SubmissionRecord & { username: string })[] {
  const where = status ? 'WHERE s.status = ?' : ''
  const rows = db
    .prepare(
      `SELECT ${COLS.split(', ').map((c) => 's.' + c).join(', ')}, u.jellyfin_username AS username
       FROM submissions s JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY s.created_at DESC, s.id DESC`,
    )
    .all(...(status ? [status] : [])) as (SubmissionRow & { username: string })[]
  return rows.map((row) => ({ ...toRecord(row), username: row.username }))
}

export function deleteSubmission(
  db: DB,
  id: number,
  userId: number,
): 'deleted' | 'not_found' | 'forbidden' | 'not_pending' {
  const s = getSubmission(db, id)
  if (!s) return 'not_found'
  if (s.userId !== userId) return 'forbidden'
  if (s.status !== 'pendiente') return 'not_pending'
  db.prepare('DELETE FROM submissions WHERE id = ?').run(id)
  return 'deleted'
}

export function setStatus(
  db: DB,
  id: number,
  status: 'procesada' | 'rechazada',
  opts: { processedBy: string; rejectionReason?: string | null },
): SubmissionRecord {
  db.prepare(
    "UPDATE submissions SET status = ?, processed_at = ?, processed_by = ?, rejection_reason = ? WHERE id = ? AND status = 'pendiente'",
  ).run(status, new Date().toISOString(), opts.processedBy, opts.rejectionReason ?? null, id)
  return getSubmission(db, id)!
}
