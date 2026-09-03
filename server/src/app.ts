import express, { type Express } from 'express'
import type { DB } from './db'
import type { JellyfinClient } from './jellyfin'
import type { JellyfinAdminClient } from './jellyfinAdmin'
import type { QbittorrentClient } from './qbittorrent'
import { createSessionMiddleware } from './session'
import { createAuthRouter } from './routes/auth'
import { createAdminRouter } from './routes/admin'
import { createInvitesRouter } from './routes/invites'
import { createAportacionesRouter } from './routes/aportaciones'

export interface AppConfig {
  db: DB
  jellyfin: JellyfinClient
  jellyfinAdmin: JellyfinAdminClient | null
  qbittorrent: QbittorrentClient | null
  dataDir: string
  adminUsername: string
  sessionSecret: string
}

export function createApp(config: AppConfig): Express {
  const app = express()
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '5mb' }))
  app.use(createSessionMiddleware(config.sessionSecret))

  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.use('/api', createAuthRouter(config.db, config.jellyfin, config.adminUsername))
  app.use(
    '/api/admin',
    createAdminRouter(config.db, config.adminUsername, config.qbittorrent, config.dataDir),
  )
  app.use('/api/invites', createInvitesRouter(config.db, config.jellyfinAdmin))
  app.use('/api/aportaciones', createAportacionesRouter(config.db, config.dataDir))

  return app
}
