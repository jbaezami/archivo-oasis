import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { DB, AppKey } from './db'
import { findUserByUsername, getPermissions } from './models'

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session?.username) {
    res.status(401).json({ error: 'No autenticado' })
    return
  }
  next()
}

export function requireAdmin(adminUsername: string): RequestHandler {
  return (req, res, next) => {
    const username = req.session?.username as string | undefined
    if (!username) {
      res.status(401).json({ error: 'No autenticado' })
      return
    }
    if (username.toLowerCase() !== adminUsername.toLowerCase()) {
      res.status(403).json({ error: 'No autorizado' })
      return
    }
    next()
  }
}

export function requirePermission(db: DB, appKey: AppKey): RequestHandler {
  return (req, res, next) => {
    const username = req.session?.username as string | undefined
    if (!username) {
      res.status(401).json({ error: 'No autenticado' })
      return
    }
    const user = findUserByUsername(db, username)
    if (!user || !getPermissions(db, user.id).includes(appKey)) {
      res.status(403).json({ error: 'No tienes acceso a esta sección' })
      return
    }
    next()
  }
}
