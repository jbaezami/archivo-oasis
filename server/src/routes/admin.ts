import { Router } from 'express'
import type { DB } from '../db'
import { APP_KEYS, type AppKey } from '../db'
import { listUsersWithPermissions, findUserByUsername, setPermission, deleteUser } from '../models'
import { createInvite, listInvites, revokeInvite, type InviteRecord, type InviteStatus } from '../invites'
import { requireAdmin } from '../middleware'
import type { QbittorrentClient } from '../qbittorrent'
import { QbittorrentError } from '../qbittorrent'
import { listAll, getSubmission, setStatus, type SubmissionStatus } from '../submissions'
import { readSubmissionFile, deleteSubmissionFile } from '../submissionFiles'
import { toSubmissionJson } from './aportaciones'

export interface InviteSummary {
  token: string
  label: string | null
  createdBy: string
  createdAt: string
  expiresAt: string
  status: InviteStatus
  usedAt: string | null
  usedByUsername: string | null
}

function toInviteSummary(invite: InviteRecord & { status: InviteStatus }): InviteSummary {
  return {
    token: invite.token,
    label: invite.label,
    createdBy: invite.createdBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    status: invite.status,
    usedAt: invite.usedAt,
    usedByUsername: invite.usedByUsername,
  }
}

const SUB_STATUSES: SubmissionStatus[] = ['pendiente', 'procesada', 'rechazada']

export function createAdminRouter(
  db: DB,
  adminUsername: string,
  qbittorrent: QbittorrentClient | null,
  dataDir: string,
): Router {
  const router = Router()
  router.use(requireAdmin(adminUsername))

  router.get('/users', (_req, res) => {
    const users = listUsersWithPermissions(db).map((u) => ({
      ...u,
      isAdmin: u.username.toLowerCase() === adminUsername.toLowerCase(),
    }))
    res.json({ users })
  })

  router.delete('/users/:username', (req, res) => {
    const { username } = req.params
    if (username.toLowerCase() === adminUsername.toLowerCase()) {
      res.status(403).json({ error: 'No puedes eliminar al administrador' })
      return
    }
    if (!deleteUser(db, username)) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }
    res.status(204).end()
  })

  router.post('/permissions', (req, res) => {
    const { username, appKey, granted } = req.body as { username?: string; appKey?: string; granted?: boolean }

    if (!username || !appKey || typeof granted !== 'boolean') {
      res.status(400).json({ error: 'username, appKey y granted son obligatorios' })
      return
    }
    if (!APP_KEYS.includes(appKey as AppKey)) {
      res.status(400).json({ error: 'appKey inválido' })
      return
    }

    const user = findUserByUsername(db, username)
    if (!user) {
      res.status(404).json({ error: 'Usuario no encontrado' })
      return
    }

    setPermission(db, user.id, appKey as AppKey, granted)
    res.json({ ok: true })
  })

  router.post('/invites', (req, res) => {
    const { label } = req.body as { label?: string }
    const createdBy = req.session!.username as string
    const trimmed = typeof label === 'string' && label.trim() ? label.trim() : null
    const invite = createInvite(db, { createdBy, label: trimmed })
    res.status(201).json({ invite: toInviteSummary({ ...invite, status: 'valid' }) })
  })

  router.get('/invites', (_req, res) => {
    res.json({ invites: listInvites(db).map(toInviteSummary) })
  })

  router.delete('/invites/:token', (req, res) => {
    const ok = revokeInvite(db, req.params.token)
    if (!ok) {
      res.status(404).json({ error: 'Invitación no encontrada o ya usada' })
      return
    }
    res.status(204).end()
  })

  router.get('/aportaciones', (req, res) => {
    const status = req.query.status
    const filter = SUB_STATUSES.includes(status as SubmissionStatus) ? (status as SubmissionStatus) : undefined
    const submissions = listAll(db, filter).map((s) => ({ ...toSubmissionJson(s), username: s.username }))
    res.json({ submissions })
  })

  router.post('/aportaciones/:id/aceptar', async (req, res) => {
    if (!qbittorrent) {
      res.status(503).json({ error: 'qBittorrent no está configurado' })
      return
    }
    const s = getSubmission(db, Number(req.params.id))
    if (!s) {
      res.status(404).json({ error: 'Aportación no encontrada' })
      return
    }
    if (s.status !== 'pendiente') {
      res.status(409).json({ error: 'Esa aportación ya no está pendiente' })
      return
    }

    try {
      await qbittorrent.addTorrent({
        url: s.sourceType === 'url' ? s.sourceUrl ?? undefined : undefined,
        file: s.sourceType === 'file' ? readSubmissionFile(dataDir, s.id) : undefined,
        fileName: s.fileName ?? undefined,
        category: s.category,
      })
    } catch (err) {
      const message = err instanceof QbittorrentError ? err.message : 'No se pudo enviar a qBittorrent'
      res.status(502).json({ error: message })
      return
    }

    const updated = setStatus(db, s.id, 'procesada', { processedBy: req.session!.username as string })
    deleteSubmissionFile(dataDir, s.id)
    res.json({ submission: toSubmissionJson(updated) })
  })

  router.post('/aportaciones/:id/rechazar', (req, res) => {
    const s = getSubmission(db, Number(req.params.id))
    if (!s) {
      res.status(404).json({ error: 'Aportación no encontrada' })
      return
    }
    if (s.status !== 'pendiente') {
      res.status(409).json({ error: 'Esa aportación ya no está pendiente' })
      return
    }
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : null
    const updated = setStatus(db, s.id, 'rechazada', {
      processedBy: req.session!.username as string,
      rejectionReason: reason,
    })
    deleteSubmissionFile(dataDir, s.id)
    res.json({ submission: toSubmissionJson(updated) })
  })

  return router
}
