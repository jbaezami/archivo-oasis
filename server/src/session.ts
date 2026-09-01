import cookieSession from 'cookie-session'
import type { RequestHandler } from 'express'

export function createSessionMiddleware(secret: string): RequestHandler {
  return cookieSession({
    name: 'archivo_oasis_session',
    secret,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  })
}
