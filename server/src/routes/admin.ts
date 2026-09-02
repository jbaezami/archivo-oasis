import { Router } from 'express'
import type { DB } from '../db'
import { APP_KEYS, type AppKey } from '../db'
import { listUsersWithPermissions, findUserByUsername, setPermission } from '../models'
import { requireAdmin } from '../middleware'

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

  return router
}
