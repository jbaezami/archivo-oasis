import type { Request, Response, NextFunction, RequestHandler } from 'express'

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
