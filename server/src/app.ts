import express, { type Express } from 'express'
import type { DB } from './db'
import type { JellyfinClient } from './jellyfin'
import type { JellyfinAdminClient } from './jellyfinAdmin'
import { createSessionMiddleware } from './session'
import { createAuthRouter } from './routes/auth'
import { createAdminRouter } from './routes/admin'

export interface AppConfig {
  db: DB
  jellyfin: JellyfinClient
  jellyfinAdmin: JellyfinAdminClient | null
  adminUsername: string
  sessionSecret: string
}

export function createApp(config: AppConfig): Express {
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json())
  app.use(createSessionMiddleware(config.sessionSecret))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api', createAuthRouter(config.db, config.jellyfin, config.adminUsername))
  app.use('/api/admin', createAdminRouter(config.db, config.adminUsername))

  return app
}
