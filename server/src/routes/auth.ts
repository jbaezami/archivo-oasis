import { Router } from 'express'
import type { DB, AppKey } from '../db'
import { JellyfinAuthError, type JellyfinClient } from '../jellyfin'
import { upsertUserLogin, findUserByUsername, getPermissions, type UserRecord } from '../models'
import { requireAuth } from '../middleware'

function toSessionResponse(user: UserRecord, permissions: AppKey[], adminUsername: string) {
  return {
    username: user.jellyfinUsername,
    isAdmin: user.jellyfinUsername.toLowerCase() === adminUsername.toLowerCase(),
    permissions,
  }
}

export function createAuthRouter(db: DB, jellyfin: JellyfinClient, adminUsername: string): Router {
  const router = Router()

  router.post('/login', async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string }
    if (!username || !password) {
      res.status(400).json({ error: 'Usuario y contraseña son obligatorios' })
      return
    }

    try {
      await jellyfin.authenticate(username, password)
    } catch (err) {
      const message = err instanceof JellyfinAuthError ? err.message : 'No se pudo conectar con el servidor'
      res.status(401).json({ error: message })
      return
    }

    const user = upsertUserLogin(db, username)
    req.session = { username: user.jellyfinUsername }

    res.json(toSessionResponse(user, getPermissions(db, user.id), adminUsername))
  })

  router.post('/logout', (req, res) => {
    req.session = null
    res.status(204).end()
  })

  router.get('/me', requireAuth, (req, res) => {
    const username = req.session!.username as string
    const user = findUserByUsername(db, username)
    if (!user) {
      req.session = null
      res.status(401).json({ error: 'No autenticado' })
      return
    }
    res.json(toSessionResponse(user, getPermissions(db, user.id), adminUsername))
  })

  return router
}
