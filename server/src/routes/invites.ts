import { Router } from 'express'
import type { DB } from '../db'
import {
  type JellyfinAdminClient,
  JellyfinAdminError,
  JellyfinUserExistsError,
} from '../jellyfinAdmin'
import { findInvite, inviteStatus, markInviteUsed } from '../invites'
import { createInvitedUser, setPermission } from '../models'

const MIN_PASSWORD_LENGTH = 6

export function createInvitesRouter(db: DB, jellyfinAdmin: JellyfinAdminClient | null): Router {
  const router = Router()

  router.get('/:token', (req, res) => {
    const invite = findInvite(db, req.params.token)
    if (!invite) {
      res.json({ status: 'not_found' })
      return
    }
    res.json({ status: inviteStatus(invite) })
  })

  router.post('/:token', async (req, res) => {
    try {
      if (!jellyfinAdmin) {
        res.status(503).json({ error: 'La creación de cuentas no está disponible ahora mismo' })
        return
      }

      const invite = findInvite(db, req.params.token)
      if (!invite || inviteStatus(invite) !== 'valid') {
        res.status(410).json({
          error: 'Esta invitación no es válida',
          status: invite ? inviteStatus(invite) : 'not_found',
        })
        return
      }

      const { username, password } = req.body as { username?: string; password?: string }
      const trimmedUsername = typeof username === 'string' ? username.trim() : ''
      if (!trimmedUsername || /\s/.test(trimmedUsername) || trimmedUsername.length > 40) {
        res.status(400).json({ error: 'El nombre de usuario no puede estar vacío ni contener espacios' })
        return
      }
      if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
        res.status(400).json({ error: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres` })
        return
      }

      try {
        await jellyfinAdmin.createUser(trimmedUsername, password)
      } catch (err) {
        if (err instanceof JellyfinUserExistsError) {
          res.status(409).json({ error: 'Ese nombre de usuario ya está en uso' })
          return
        }
        if (err instanceof JellyfinAdminError) {
          res.status(502).json({ error: 'No se pudo crear la cuenta ahora mismo, inténtalo más tarde' })
          return
        }
        throw err
      }

      try {
        db.transaction(() => {
          const user = createInvitedUser(db, trimmedUsername)
          setPermission(db, user.id, 'jellyfin', true)
          setPermission(db, user.id, 'jellyseerr', true)
          markInviteUsed(db, invite.token, trimmedUsername)
        })()
      } catch (err) {
        console.error(
          'CUENTA JELLYFIN HUÉRFANA: se creó el usuario en Jellyfin pero falló la escritura local',
          { username: trimmedUsername, token: req.params.token },
        )
        throw err
      }

      res.json({ ok: true })
    } catch (err) {
      console.error('Fallo al consumir la invitación', { token: req.params.token, err })
      res.status(500).json({ error: 'No se pudo completar el registro' })
    }
  })

  return router
}
