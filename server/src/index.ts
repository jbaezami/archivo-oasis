import path from 'node:path'
import { createApp } from './app'
import { createDb } from './db'
import { createJellyfinClient } from './jellyfin'

const PORT = Number(process.env.PORT ?? 3001)
const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, '..', 'data')
const JELLYFIN_URL = process.env.JELLYFIN_URL
const ADMIN_JELLYFIN_USERNAME = process.env.ADMIN_JELLYFIN_USERNAME
const SESSION_SECRET = process.env.SESSION_SECRET

if (!JELLYFIN_URL) throw new Error('Falta la variable de entorno JELLYFIN_URL')
if (!ADMIN_JELLYFIN_USERNAME) throw new Error('Falta la variable de entorno ADMIN_JELLYFIN_USERNAME')
if (!SESSION_SECRET) throw new Error('Falta la variable de entorno SESSION_SECRET')

const db = createDb(path.join(DATA_DIR, 'archivo-oasis.db'))
const jellyfin = createJellyfinClient(JELLYFIN_URL)

const app = createApp({
  db,
  jellyfin,
  adminUsername: ADMIN_JELLYFIN_USERNAME,
  sessionSecret: SESSION_SECRET,
})

app.listen(PORT, () => {
  console.log(`archivo-oasis-api listening on port ${PORT}`)
})
