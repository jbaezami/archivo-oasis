import fs from 'node:fs'
import path from 'node:path'
import { createApp } from './app'
import { createDb } from './db'
import { createJellyfinClient } from './jellyfin'
import { createJellyfinAdminClient } from './jellyfinAdmin'

// Carga server/.env si existe. Solo para desarrollo local: en Docker el fichero
// no se copia a la imagen y las variables llegan por el entorno del contenedor.
function loadDotEnv(): void {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadDotEnv()

const PORT = Number(process.env.PORT ?? 3001)
const DATA_DIR = process.env.DATA_DIR ?? path.join(__dirname, '..', 'data')
const JELLYFIN_URL = process.env.JELLYFIN_URL
const ADMIN_JELLYFIN_USERNAME = process.env.ADMIN_JELLYFIN_USERNAME
const SESSION_SECRET = process.env.SESSION_SECRET
const JELLYFIN_API_KEY = process.env.JELLYFIN_API_KEY

if (!JELLYFIN_URL) throw new Error('Falta la variable de entorno JELLYFIN_URL')
if (!ADMIN_JELLYFIN_USERNAME) throw new Error('Falta la variable de entorno ADMIN_JELLYFIN_USERNAME')
if (!SESSION_SECRET) throw new Error('Falta la variable de entorno SESSION_SECRET')

const db = createDb(path.join(DATA_DIR, 'archivo-oasis.db'))
const jellyfin = createJellyfinClient(JELLYFIN_URL)
const jellyfinAdmin = JELLYFIN_API_KEY
  ? createJellyfinAdminClient(JELLYFIN_URL, JELLYFIN_API_KEY)
  : null

if (!jellyfinAdmin) {
  console.warn(
    'JELLYFIN_API_KEY no definida — la creación de cuentas por invitación devolverá 503',
  )
}

const app = createApp({
  db,
  jellyfin,
  jellyfinAdmin,
  adminUsername: ADMIN_JELLYFIN_USERNAME,
  sessionSecret: SESSION_SECRET,
})

app.listen(PORT, () => {
  console.log(`archivo-oasis-api listening on port ${PORT}`)
})
