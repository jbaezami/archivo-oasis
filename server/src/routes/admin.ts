import { Router } from 'express'
import type { DB } from '../db'
import { APP_KEYS, type AppKey } from '../db'
import { listUsersWithPermissions, findUserByUsername, setPermission } from '../models'
import { createInvite, listInvites, revokeInvite, type InviteRecord, type InviteStatus } from '../invites'
import { requireAdmin } from '../middleware'

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

export function createAdminRouter(db: DB, adminUsername: string): Router {
  const router = Router()
  router.use(requireAdmin(adminUsername))

  router.get('/users', (_req, res) => {
    res.json({ users: listUsersWithPermissions(db) })
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

  return router
}
