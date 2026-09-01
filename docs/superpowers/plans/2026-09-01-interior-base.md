# Parte interna: base (backend + identidad + permisos) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el login falsificable de `localStorage` por un backend real (Node.js + SQLite) que verifica credenciales contra Jellyfin, guarda permisos por usuario y expone un dashboard con cuadros por sección más un panel de admin para conceder/revocar acceso.

**Architecture:** Nuevo contenedor `archivo-oasis-api` (Express + better-sqlite3) añadido al `docker-compose.yml` existente; nginx reenvía `/api/*` a ese contenedor (mismo origen, cookie de sesión httpOnly). El frontend deja de llamar a Jellyfin directamente y de fiarse de `localStorage`; en su lugar habla con `/api/*` y renderiza el dashboard/panel de admin según lo que la API le diga.

**Tech Stack:** Backend: Node.js 22, TypeScript, Express 4, better-sqlite3, cookie-session, `node:test` (sin frameworks de test adicionales). Frontend: React/TS ya existente en el repo, sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-01-interior-base-design.md`

## Global Constraints

- El backend es Node.js + SQLite en un contenedor nuevo (no reutiliza infraestructura externa).
- La sesión va en una cookie httpOnly; nginx hace de proxy inverso de `/api/*` — mismo origen, sin CORS.
- El administrador se identifica comparando el `jellyfin_username` de la sesión con la variable de entorno `ADMIN_JELLYFIN_USERNAME` (case-insensitive) — no existe columna "admin" en la base de datos.
- Un usuario nuevo (primer login) no tiene ningún permiso por defecto; debe concedérselos un admin.
- El conjunto de `app_key` es fijo en v1: `jellyfin`, `jellyseerr`, `cantina`, `aportaciones`.
- No se pre-asignan permisos a usuarios de Jellyfin que aún no han iniciado sesión (no se usa la API key de Jellyfin en esta pieza).
- No se introducen dependencias de frontend nuevas; el backend usa el runner de tests integrado de Node (`node:test`), no Jest/Vitest/Mocha.

---

## Resumen de ficheros

**Backend (nuevo directorio `server/`):**
```
server/
├── package.json
├── package-lock.json      (generado por npm install, no se escribe a mano)
├── tsconfig.json
├── Dockerfile
├── .dockerignore
└── src/
    ├── db.ts               # esquema SQLite + tipos AppKey
    ├── models.ts           # acceso a datos (usuarios, permisos)
    ├── models.test.ts
    ├── jellyfin.ts          # cliente HTTP hacia Jellyfin (movido desde el frontend)
    ├── jellyfin.test.ts
    ├── session.ts           # middleware de cookie-session
    ├── middleware.ts        # requireAuth / requireAdmin
    ├── app.ts               # ensambla la app Express (testable sin levantar el proceso real)
    ├── index.ts              # entrypoint: lee env vars, crea la app, escucha
    └── routes/
        ├── auth.ts
        ├── auth.test.ts
        ├── admin.ts
        └── admin.test.ts
```

**Infra (modificados):**
- `docker/nginx.conf`
- `docker-compose.yml`
- `.github/workflows/deploy.yml`
- `.gitignore`

**Frontend (nuevos/modificados):**
```
src/lib/
├── authApi.ts              # nuevo — sustituye src/pages/Home/jellyfinAuth.ts
└── useAuth.ts               # reescrito

src/pages/Home/
├── Home.tsx                 # modificado
└── LoginModal.tsx           # modificado

src/pages/Archivo/
├── Archivo.tsx               # reescrito (guard + monta Dashboard)
├── Dashboard.tsx              # nuevo
├── Dashboard.module.css       # nuevo
├── Placeholder.tsx             # nuevo (Cantina/Aportaciones)
├── AdminPanel.tsx               # nuevo
├── AdminPanel.module.css        # nuevo
└── LogoutButton.tsx              # modificado (ya existe)

src/routes/AppRoutes.tsx        # modificado
```

`src/pages/Home/jellyfinAuth.ts` se elimina (su lógica se traslada al backend y a `src/lib/authApi.ts`).

---

## Task 1: Esqueleto del backend + esquema SQLite

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/.dockerignore`
- Create: `server/src/db.ts`
- Create: `server/src/models.ts`
- Test: `server/src/models.test.ts`

**Interfaces:**
- Produces: `export type AppKey = 'jellyfin' | 'jellyseerr' | 'cantina' | 'aportaciones'` (`db.ts`)
- Produces: `export const APP_KEYS: AppKey[]` (`db.ts`)
- Produces: `export type DB = Database.Database` (`db.ts`)
- Produces: `export function createDb(filePath: string): DB` (`db.ts`)
- Produces: `export interface UserRecord { id: number; jellyfinUsername: string; createdAt: string; lastLoginAt: string }` (`models.ts`)
- Produces: `export function upsertUserLogin(db: DB, username: string): UserRecord` (`models.ts`)
- Produces: `export function findUserByUsername(db: DB, username: string): UserRecord | undefined` (`models.ts`)
- Produces: `export function getPermissions(db: DB, userId: number): AppKey[]` (`models.ts`)
- Produces: `export function setPermission(db: DB, userId: number, appKey: AppKey, granted: boolean): void` (`models.ts`)
- Produces: `export function listUsersWithPermissions(db: DB): { username: string; lastLoginAt: string; permissions: AppKey[] }[]` (`models.ts`)

- [ ] **Step 1: Crear `server/package.json`**

```json
{
  "name": "archivo-oasis-api",
  "private": true,
  "version": "0.0.1",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "tsx --test src/**/*.test.ts src/**/**/*.test.ts"
  },
  "dependencies": {
    "express": "^4.22.2",
    "better-sqlite3": "^13.0.3",
    "cookie-session": "^2.1.1"
  },
  "devDependencies": {
    "@types/express": "^4.17.25",
    "@types/better-sqlite3": "^9.6.0",
    "@types/cookie-session": "^2.0.49",
    "@types/node": "^22.20.1",
    "typescript": "^5.9.3",
    "tsx": "^4.23.13"
  }
}
```

- [ ] **Step 2: Crear `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Crear `server/.dockerignore`**

```
node_modules
dist
data
```

- [ ] **Step 4: Instalar dependencias**

Run: `cd server && npm install`
Expected: crea `server/node_modules/` y `server/package-lock.json`. Si `better-sqlite3` necesita compilar desde fuente y falla por falta de herramientas de compilación en esta máquina, no es bloqueante para este paso — se compilará correctamente dentro del contenedor Docker (Task 5), que sí incluye las herramientas necesarias. Confirma al menos que `npm install` generó `package-lock.json`.

- [ ] **Step 5: Escribir `server/src/db.ts`**

```typescript
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

export type DB = Database.Database
export type AppKey = 'jellyfin' | 'jellyseerr' | 'cantina' | 'aportaciones'
export const APP_KEYS: AppKey[] = ['jellyfin', 'jellyseerr', 'cantina', 'aportaciones']

export function createDb(filePath: string): DB {
  if (filePath !== ':memory:') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }

  const db = new Database(filePath)

  if (filePath !== ':memory:') {
    db.pragma('journal_mode = WAL')
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      jellyfin_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL,
      last_login_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS permissions (
      user_id INTEGER NOT NULL REFERENCES users(id),
      app_key TEXT NOT NULL CHECK (app_key IN ('jellyfin', 'jellyseerr', 'cantina', 'aportaciones')),
      granted_at TEXT NOT NULL,
      PRIMARY KEY (user_id, app_key)
    );
  `)

  return db
}
```

- [ ] **Step 6: Escribir `server/src/models.ts`**

```typescript
import type { DB, AppKey } from './db'

export interface UserRecord {
  id: number
  jellyfinUsername: string
  createdAt: string
  lastLoginAt: string
}

interface UserRow {
  id: number
  jellyfin_username: string
  created_at: string
  last_login_at: string
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    jellyfinUsername: row.jellyfin_username,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }
}

export function upsertUserLogin(db: DB, username: string): UserRecord {
  const now = new Date().toISOString()
  const existing = db
    .prepare('SELECT id, jellyfin_username, created_at, last_login_at FROM users WHERE jellyfin_username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined

  if (existing) {
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now, existing.id)
    return toUserRecord({ ...existing, last_login_at: now })
  }

  const result = db
    .prepare('INSERT INTO users (jellyfin_username, created_at, last_login_at) VALUES (?, ?, ?)')
    .run(username, now, now)

  return toUserRecord({
    id: Number(result.lastInsertRowid),
    jellyfin_username: username,
    created_at: now,
    last_login_at: now,
  })
}

export function findUserByUsername(db: DB, username: string): UserRecord | undefined {
  const row = db
    .prepare('SELECT id, jellyfin_username, created_at, last_login_at FROM users WHERE jellyfin_username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined
  return row ? toUserRecord(row) : undefined
}

export function getPermissions(db: DB, userId: number): AppKey[] {
  const rows = db.prepare('SELECT app_key FROM permissions WHERE user_id = ?').all(userId) as { app_key: AppKey }[]
  return rows.map((r) => r.app_key)
}

export function setPermission(db: DB, userId: number, appKey: AppKey, granted: boolean): void {
  if (granted) {
    db.prepare(
      'INSERT INTO permissions (user_id, app_key, granted_at) VALUES (?, ?, ?) ON CONFLICT(user_id, app_key) DO NOTHING',
    ).run(userId, appKey, new Date().toISOString())
  } else {
    db.prepare('DELETE FROM permissions WHERE user_id = ? AND app_key = ?').run(userId, appKey)
  }
}

export function listUsersWithPermissions(db: DB): { username: string; lastLoginAt: string; permissions: AppKey[] }[] {
  const users = db
    .prepare('SELECT id, jellyfin_username, last_login_at FROM users ORDER BY jellyfin_username COLLATE NOCASE')
    .all() as { id: number; jellyfin_username: string; last_login_at: string }[]

  return users.map((u) => ({
    username: u.jellyfin_username,
    lastLoginAt: u.last_login_at,
    permissions: getPermissions(db, u.id),
  }))
}
```

- [ ] **Step 7: Escribir el test `server/src/models.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from './db'
import { upsertUserLogin, findUserByUsername, getPermissions, setPermission, listUsersWithPermissions } from './models'

test('upsertUserLogin creates a new user on first login and reuses it on the second', () => {
  const db = createDb(':memory:')
  const first = upsertUserLogin(db, 'alice')
  const second = upsertUserLogin(db, 'alice')
  assert.equal(first.id, second.id)
  assert.equal(second.jellyfinUsername, 'alice')
})

test('usernames are matched case-insensitively', () => {
  const db = createDb(':memory:')
  const first = upsertUserLogin(db, 'Alice')
  const second = upsertUserLogin(db, 'alice')
  assert.equal(first.id, second.id)
})

test('findUserByUsername returns undefined for an unknown user', () => {
  const db = createDb(':memory:')
  assert.equal(findUserByUsername(db, 'ghost'), undefined)
})

test('setPermission grants and revokes access to an app', () => {
  const db = createDb(':memory:')
  const user = upsertUserLogin(db, 'alice')
  assert.deepEqual(getPermissions(db, user.id), [])

  setPermission(db, user.id, 'cantina', true)
  assert.deepEqual(getPermissions(db, user.id), ['cantina'])

  setPermission(db, user.id, 'cantina', false)
  assert.deepEqual(getPermissions(db, user.id), [])
})

test('granting the same permission twice does not error or duplicate it', () => {
  const db = createDb(':memory:')
  const user = upsertUserLogin(db, 'alice')
  setPermission(db, user.id, 'jellyfin', true)
  setPermission(db, user.id, 'jellyfin', true)
  assert.deepEqual(getPermissions(db, user.id), ['jellyfin'])
})

test('listUsersWithPermissions returns every known user with their permissions', () => {
  const db = createDb(':memory:')
  const alice = upsertUserLogin(db, 'alice')
  upsertUserLogin(db, 'bob')
  setPermission(db, alice.id, 'cantina', true)

  const users = listUsersWithPermissions(db)
  assert.equal(users.length, 2)
  const aliceEntry = users.find((u) => u.username === 'alice')
  assert.deepEqual(aliceEntry?.permissions, ['cantina'])
})
```

- [ ] **Step 8: Ejecutar los tests**

Run: `cd server && npm test`
Expected: 6 tests pasando (`# pass 6`).

- [ ] **Step 9: Commit**

```bash
git add server/package.json server/package-lock.json server/tsconfig.json server/.dockerignore server/src/db.ts server/src/models.ts server/src/models.test.ts
git commit -m "feat(server): esqueleto del backend + esquema y acceso a datos SQLite"
```

---

## Task 2: Cliente Jellyfin (lado servidor)

**Files:**
- Create: `server/src/jellyfin.ts`
- Test: `server/src/jellyfin.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces: `export class JellyfinAuthError extends Error {}` (`jellyfin.ts`)
- Produces: `export interface JellyfinClient { authenticate(username: string, password: string): Promise<void> }` (`jellyfin.ts`)
- Produces: `export function createJellyfinClient(baseUrl: string): JellyfinClient` (`jellyfin.ts`)

- [ ] **Step 1: Escribir el test `server/src/jellyfin.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJellyfinClient, JellyfinAuthError } from './jellyfin'

test('authenticate resolves when Jellyfin responds 200', async () => {
  const originalFetch = global.fetch
  global.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch
  try {
    const client = createJellyfinClient('https://jellyfin.example.com')
    await client.authenticate('alice', 'correct-password')
  } finally {
    global.fetch = originalFetch
  }
})

test('authenticate throws JellyfinAuthError with a friendly message on 401', async () => {
  const originalFetch = global.fetch
  global.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch
  try {
    const client = createJellyfinClient('https://jellyfin.example.com')
    await assert.rejects(
      () => client.authenticate('alice', 'wrong-password'),
      (err: unknown) => err instanceof JellyfinAuthError && err.message === 'Usuario o contraseña incorrectos',
    )
  } finally {
    global.fetch = originalFetch
  }
})

test('authenticate throws JellyfinAuthError when the network request fails', async () => {
  const originalFetch = global.fetch
  global.fetch = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  try {
    const client = createJellyfinClient('https://jellyfin.example.com')
    await assert.rejects(
      () => client.authenticate('alice', 'whatever'),
      (err: unknown) => err instanceof JellyfinAuthError && err.message === 'No se pudo conectar con el servidor',
    )
  } finally {
    global.fetch = originalFetch
  }
})
```

- [ ] **Step 2: Ejecutar el test y comprobar que falla**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './jellyfin'`.

- [ ] **Step 3: Escribir `server/src/jellyfin.ts`**

```typescript
export class JellyfinAuthError extends Error {}

export interface JellyfinClient {
  authenticate(username: string, password: string): Promise<void>
}

export function createJellyfinClient(baseUrl: string): JellyfinClient {
  return {
    async authenticate(username: string, password: string): Promise<void> {
      let response: Response
      try {
        response = await fetch(`${baseUrl}/Users/AuthenticateByName`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Emby-Authorization':
              'MediaBrowser Client="Archivo Oasis", Device="Server", DeviceId="archivo-oasis-api", Version="1.0.0"',
          },
          body: JSON.stringify({ Username: username, Pw: password }),
        })
      } catch {
        throw new JellyfinAuthError('No se pudo conectar con el servidor')
      }

      if (response.status === 401 || response.status === 400) {
        throw new JellyfinAuthError('Usuario o contraseña incorrectos')
      }
      if (!response.ok) {
        throw new JellyfinAuthError('No se pudo conectar con el servidor')
      }
    },
  }
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 3 tests de `jellyfin.test.ts` pasan, además de los 6 de `models.test.ts` (9 en total).

- [ ] **Step 5: Commit**

```bash
git add server/src/jellyfin.ts server/src/jellyfin.test.ts
git commit -m "feat(server): cliente de autenticación contra Jellyfin"
```

---

## Task 3: App Express + sesión + rutas de autenticación

**Files:**
- Create: `server/src/session.ts`
- Create: `server/src/middleware.ts`
- Create: `server/src/app.ts`
- Create: `server/src/routes/auth.ts`
- Test: `server/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: `DB`, `createDb` (`db.ts`); `upsertUserLogin`, `findUserByUsername`, `getPermissions` (`models.ts`); `JellyfinClient`, `JellyfinAuthError` (`jellyfin.ts`)
- Produces: `export function createSessionMiddleware(secret: string): RequestHandler` (`session.ts`)
- Produces: `export function requireAuth(req, res, next): void` (`middleware.ts`)
- Produces: `export function requireAdmin(adminUsername: string): RequestHandler` (`middleware.ts`)
- Produces: `export interface AppConfig { db: DB; jellyfin: JellyfinClient; adminUsername: string; sessionSecret: string }` (`app.ts`)
- Produces: `export function createApp(config: AppConfig): Express` (`app.ts`) — usado también por Task 4 y Task 5.
- Produces: `export function createAuthRouter(db: DB, jellyfin: JellyfinClient, adminUsername: string): Router` (`routes/auth.ts`)
- Produces (respuesta JSON de `/api/login` y `/api/me`): `{ username: string; isAdmin: boolean; permissions: AppKey[] }`

- [ ] **Step 1: Escribir `server/src/session.ts`**

```typescript
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
```

- [ ] **Step 2: Escribir `server/src/middleware.ts`**

```typescript
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
```

- [ ] **Step 3: Escribir `server/src/routes/auth.ts`**

```typescript
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
```

- [ ] **Step 4: Escribir `server/src/app.ts`**

```typescript
import express, { type Express } from 'express'
import type { DB } from './db'
import type { JellyfinClient } from './jellyfin'
import { createSessionMiddleware } from './session'
import { createAuthRouter } from './routes/auth'

export interface AppConfig {
  db: DB
  jellyfin: JellyfinClient
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

  return app
}
```

- [ ] **Step 5: Escribir el test `server/src/routes/auth.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app'
import { createDb } from '../db'
import { JellyfinAuthError, type JellyfinClient } from '../jellyfin'

const acceptingJellyfin: JellyfinClient = {
  async authenticate() {
    // succeeds for any credentials
  },
}

const rejectingJellyfin: JellyfinClient = {
  async authenticate() {
    throw new JellyfinAuthError('Usuario o contraseña incorrectos')
  },
}

function startTestServer(jellyfin: JellyfinClient) {
  const app = createApp({
    db: createDb(':memory:'),
    jellyfin,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

test('POST /api/login succeeds and sets a session cookie', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'whatever' }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.username, 'alice')
    assert.equal(body.isAdmin, false)
    assert.deepEqual(body.permissions, [])
    assert.ok(response.headers.get('set-cookie'))
  } finally {
    server.close()
  }
})

test('POST /api/login rejects invalid credentials with 401', async () => {
  const { server, baseUrl } = startTestServer(rejectingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong' }),
    })
    assert.equal(response.status, 401)
  } finally {
    server.close()
  }
})

test('POST /api/login rejects a missing username or password with 400', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice' }),
    })
    assert.equal(response.status, 400)
  } finally {
    server.close()
  }
})

test('GET /api/me returns 401 without a session', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/me`)
    assert.equal(response.status, 401)
  } finally {
    server.close()
  }
})

test('GET /api/me returns the current user after logging in', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'whatever' }),
    })
    const cookie = loginResponse.headers.get('set-cookie')!.split(';')[0]

    const meResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } })
    assert.equal(meResponse.status, 200)
    const body = await meResponse.json()
    assert.equal(body.username, 'alice')
  } finally {
    server.close()
  }
})

test('login marks the configured admin username as isAdmin', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Admin-User', password: 'whatever' }),
    })
    const body = await response.json()
    assert.equal(body.isAdmin, true)
  } finally {
    server.close()
  }
})

test('POST /api/logout clears the session', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'whatever' }),
    })
    const loginCookie = loginResponse.headers.get('set-cookie')!.split(';')[0]

    const logoutResponse = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { Cookie: loginCookie },
    })
    const logoutCookie = logoutResponse.headers.get('set-cookie')!.split(';')[0]

    const meResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: logoutCookie } })
    assert.equal(meResponse.status, 401)
  } finally {
    server.close()
  }
})
```

- [ ] **Step 6: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 7 tests nuevos de `auth.test.ts` pasan, sin romper los 9 anteriores (16 en total).

- [ ] **Step 7: Commit**

```bash
git add server/src/session.ts server/src/middleware.ts server/src/app.ts server/src/routes/auth.ts server/src/routes/auth.test.ts
git commit -m "feat(server): app Express con sesión de cookie y rutas de login/logout/me"
```

---

## Task 4: Rutas de administración

**Files:**
- Create: `server/src/routes/admin.ts`
- Test: `server/src/routes/admin.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `createApp`, `AppConfig` (`app.ts`, Task 3); `APP_KEYS`, `AppKey` (`db.ts`); `listUsersWithPermissions`, `findUserByUsername`, `setPermission` (`models.ts`); `requireAdmin` (`middleware.ts`)
- Produces: `export function createAdminRouter(db: DB, adminUsername: string): Router` (`routes/admin.ts`), montado en `app.ts` bajo `/api/admin`.
- Produces (respuesta de `GET /api/admin/users`): `{ users: { username: string; lastLoginAt: string; permissions: AppKey[] }[] }`

- [ ] **Step 1: Escribir `server/src/routes/admin.ts`**

```typescript
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
```

- [ ] **Step 2: Montar el router en `server/src/app.ts`**

En `server/src/app.ts`, añade el import y el `app.use`:

```typescript
import { createAdminRouter } from './routes/admin'
```

Justo debajo de la línea `app.use('/api', createAuthRouter(...))`:

```typescript
  app.use('/api/admin', createAdminRouter(config.db, config.adminUsername))
```

- [ ] **Step 3: Escribir el test `server/src/routes/admin.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app'
import { createDb } from '../db'
import type { JellyfinClient } from '../jellyfin'

const acceptingJellyfin: JellyfinClient = {
  async authenticate() {},
}

function startTestServer() {
  const app = createApp({
    db: createDb(':memory:'),
    jellyfin: acceptingJellyfin,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'whatever' }),
  })
  return response.headers.get('set-cookie')!.split(';')[0]
}

test('GET /api/admin/users is rejected without a session', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const response = await fetch(`${baseUrl}/api/admin/users`)
    assert.equal(response.status, 401)
  } finally {
    server.close()
  }
})

test('GET /api/admin/users is rejected for a non-admin user', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const cookie = await loginAs(baseUrl, 'alice')
    const response = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: cookie } })
    assert.equal(response.status, 403)
  } finally {
    server.close()
  }
})

test('GET /api/admin/users lists everyone who has logged in', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    await loginAs(baseUrl, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const response = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    assert.equal(response.status, 200)
    const body = await response.json()
    const usernames = body.users.map((u: { username: string }) => u.username)
    assert.ok(usernames.includes('alice'))
    assert.ok(usernames.includes('admin-user'))
  } finally {
    server.close()
  }
})

test('POST /api/admin/permissions grants and revokes access', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    await loginAs(baseUrl, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const grant = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ username: 'alice', appKey: 'cantina', granted: true }),
    })
    assert.equal(grant.status, 200)

    const afterGrant = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    const { users: usersAfterGrant } = await afterGrant.json()
    const aliceAfterGrant = usersAfterGrant.find((u: { username: string }) => u.username === 'alice')
    assert.deepEqual(aliceAfterGrant.permissions, ['cantina'])

    const revoke = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ username: 'alice', appKey: 'cantina', granted: false }),
    })
    assert.equal(revoke.status, 200)

    const afterRevoke = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    const { users: usersAfterRevoke } = await afterRevoke.json()
    const aliceAfterRevoke = usersAfterRevoke.find((u: { username: string }) => u.username === 'alice')
    assert.deepEqual(aliceAfterRevoke.permissions, [])
  } finally {
    server.close()
  }
})

test('POST /api/admin/permissions rejects an unknown appKey', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    await loginAs(baseUrl, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const response = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ username: 'alice', appKey: 'not-a-real-app', granted: true }),
    })
    assert.equal(response.status, 400)
  } finally {
    server.close()
  }
})

test('POST /api/admin/permissions returns 404 for an unknown username', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const response = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ username: 'ghost', appKey: 'cantina', granted: true }),
    })
    assert.equal(response.status, 404)
  } finally {
    server.close()
  }
})
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 6 tests nuevos de `admin.test.ts` pasan, sin romper los 16 anteriores (22 en total).

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/admin.ts server/src/routes/admin.test.ts server/src/app.ts
git commit -m "feat(server): rutas de administración para listar usuarios y gestionar permisos"
```

---

## Task 5: Entrypoint y Dockerfile del backend

**Files:**
- Create: `server/src/index.ts`
- Create: `server/Dockerfile`

**Interfaces:**
- Consumes: `createApp`, `AppConfig` (`app.ts`); `createDb` (`db.ts`); `createJellyfinClient` (`jellyfin.ts`)
- Produces: proceso HTTP escuchando en `process.env.PORT` (por defecto `3001`), leyendo `JELLYFIN_URL`, `ADMIN_JELLYFIN_USERNAME`, `SESSION_SECRET`, `DATA_DIR` de variables de entorno.

- [ ] **Step 1: Escribir `server/src/index.ts`**

```typescript
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
```

- [ ] **Step 2: Comprobar que compila**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Escribir `server/Dockerfile`**

```dockerfile
# ---- Build stage ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ---- Serve stage ----
FROM node:22-bookworm-slim AS serve
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
ENV NODE_ENV=production
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s CMD node -e "fetch('http://localhost:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
```

- [ ] **Step 4: Construir la imagen localmente para verificar que el Dockerfile funciona**

Run: `cd server && docker build -t archivo-oasis-api:test .`
Expected: build completa sin errores (incluye la compilación nativa de `better-sqlite3` dentro del contenedor).

- [ ] **Step 5: Commit**

```bash
git add server/src/index.ts server/Dockerfile
git commit -m "feat(server): entrypoint HTTP y Dockerfile del backend"
```

---

## Task 6: Infraestructura — nginx, docker-compose y CI

**Files:**
- Modify: `docker/nginx.conf`
- Modify: `docker-compose.yml`
- Modify: `.github/workflows/deploy.yml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: la imagen `archivo-oasis-api` construida en Task 5, expuesta en el puerto `3001` dentro de la red Docker.
- Produces: `/api/*` accesible desde el navegador a través de nginx; el contenedor `archivo-oasis-api` desplegado junto al `archivo-oasis` existente.

- [ ] **Step 1: Añadir el proxy a `docker/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://archivo-oasis-api:3001/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }
}
```

- [ ] **Step 2: Añadir el servicio nuevo a `docker-compose.yml`**

```yaml
services:
  archivo-oasis:
    image: ghcr.io/jbaezami/archivo-oasis:latest
    container_name: archivo-oasis
    restart: unless-stopped
    ports:
      - "8081:80"
    networks:
      - default
      - red-cloudflare
    depends_on:
      - archivo-oasis-api

  archivo-oasis-api:
    image: ghcr.io/jbaezami/archivo-oasis-api:latest
    container_name: archivo-oasis-api
    restart: unless-stopped
    environment:
      - JELLYFIN_URL=${JELLYFIN_URL}
      - ADMIN_JELLYFIN_USERNAME=${ADMIN_JELLYFIN_USERNAME}
      - SESSION_SECRET=${SESSION_SECRET}
    volumes:
      - archivo-oasis-data:/data
    networks:
      - default

networks:
  red-cloudflare:
    external: true

volumes:
  archivo-oasis-data:
```

Nota para el despliegue: crea un fichero `.env` junto a `docker-compose.yml` (ya cubierto por `.gitignore`, no se commitea) con:

```
JELLYFIN_URL=https://teatro.archivo-oasis.com
ADMIN_JELLYFIN_USERNAME=<tu usuario de Jellyfin>
SESSION_SECRET=<una cadena aleatoria larga, p.ej. `openssl rand -hex 32`>
```

- [ ] **Step 3: Añadir el build+push de la imagen del backend en `.github/workflows/deploy.yml`**

Añade este step al final del job `build-and-push`, después del step `Build and push image` existente:

```yaml
      - name: Build and push API image
        uses: docker/build-push-action@v6
        with:
          context: ./server
          file: server/Dockerfile
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}-api:latest
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}-api:${{ github.sha }}
```

- [ ] **Step 4: Añadir la carpeta de datos local del backend a `.gitignore`**

Añade esta línea a `.gitignore`:

```
server/data/
```

- [ ] **Step 5: Commit**

```bash
git add docker/nginx.conf docker-compose.yml .github/workflows/deploy.yml .gitignore
git commit -m "feat(infra): desplegar archivo-oasis-api junto a nginx con proxy a /api/*"
```

---

## Task 7: `src/lib/authApi.ts` — cliente HTTP del frontend hacia el backend

**Files:**
- Create: `src/lib/authApi.ts`
- Delete: `src/pages/Home/jellyfinAuth.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores (es la primera pieza de frontend).
- Produces: `export type AppKey = 'jellyfin' | 'jellyseerr' | 'cantina' | 'aportaciones'` (`authApi.ts`)
- Produces: `export const APP_KEYS: AppKey[]` (`authApi.ts`)
- Produces: `export interface AuthSession { username: string; isAdmin: boolean; permissions: AppKey[] }` (`authApi.ts`)
- Produces: `export class JellyfinAuthError extends Error {}` (`authApi.ts`)
- Produces: `export async function login(username: string, password: string): Promise<AuthSession>` (`authApi.ts`)
- Produces: `export async function fetchSession(): Promise<AuthSession | null>` (`authApi.ts`)
- Produces: `export async function logout(): Promise<void>` (`authApi.ts`)
- Produces: `export interface AdminUser { username: string; lastLoginAt: string; permissions: AppKey[] }` (`authApi.ts`)
- Produces: `export async function fetchAdminUsers(): Promise<AdminUser[]>` (`authApi.ts`)
- Produces: `export async function setUserPermission(username: string, appKey: AppKey, granted: boolean): Promise<void>` (`authApi.ts`)

- [ ] **Step 1: Crear `src/lib/authApi.ts`**

```typescript
export type AppKey = 'jellyfin' | 'jellyseerr' | 'cantina' | 'aportaciones'
export const APP_KEYS: AppKey[] = ['jellyfin', 'jellyseerr', 'cantina', 'aportaciones']

export interface AuthSession {
  username: string
  isAdmin: boolean
  permissions: AppKey[]
}

export class JellyfinAuthError extends Error {}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null)
  return typeof body?.error === 'string' ? body.error : fallback
}

export async function login(username: string, password: string): Promise<AuthSession> {
  let response: Response
  try {
    response = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    throw new JellyfinAuthError('No se pudo conectar con el servidor')
  }

  if (!response.ok) {
    throw new JellyfinAuthError(await readErrorMessage(response, 'No se pudo conectar con el servidor'))
  }

  return (await response.json()) as AuthSession
}

export async function fetchSession(): Promise<AuthSession | null> {
  const response = await fetch('/api/me', { credentials: 'same-origin' })
  if (!response.ok) return null
  return (await response.json()) as AuthSession
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
}

export interface AdminUser {
  username: string
  lastLoginAt: string
  permissions: AppKey[]
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const response = await fetch('/api/admin/users', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo cargar la lista de usuarios'))
  }
  const body = (await response.json()) as { users: AdminUser[] }
  return body.users
}

export async function setUserPermission(username: string, appKey: AppKey, granted: boolean): Promise<void> {
  const response = await fetch('/api/admin/permissions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, appKey, granted }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo actualizar el permiso'))
  }
}
```

- [ ] **Step 2: Eliminar el fichero antiguo**

Run: `rm src/pages/Home/jellyfinAuth.ts`

- [ ] **Step 3: Comprobar que el proyecto sigue compilando (fallará hasta la Task 8/9 — es esperado)**

Run: `npx tsc --noEmit`
Expected: FAIL — `LoginModal.tsx` todavía importa `./jellyfinAuth`, que ya no existe. Esto se corrige en la Task 9; no hagas commit todavía de este estado roto.

- [ ] **Step 4: Commit**

```bash
git add src/lib/authApi.ts
git rm src/pages/Home/jellyfinAuth.ts
git commit -m "feat(frontend): cliente HTTP hacia la nueva API de autenticación"
```

---

## Task 8: Reescribir `src/lib/useAuth.ts`

**Files:**
- Modify: `src/lib/useAuth.ts`

**Interfaces:**
- Consumes: `fetchSession`, `logout as logoutRequest`, `AuthSession` (`src/lib/authApi.ts`, Task 7)
- Produces: `export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'offline'` (`useAuth.ts`) — `'offline'` distingue "no se pudo hablar con el backend" de "no autenticado", tal y como pide la spec.
- Produces: `export interface AuthState { status: AuthStatus; session: AuthSession | null; refresh: () => Promise<void>; logout: () => Promise<void> }` (`useAuth.ts`)
- Produces: `export function useAuth(): AuthState` (`useAuth.ts`) — usado por Task 9, 10, 11, 12.

- [ ] **Step 1: Reemplazar el contenido completo de `src/lib/useAuth.ts`**

```typescript
import { useCallback, useEffect, useState } from 'react'
import { fetchSession, logout as logoutRequest, type AuthSession } from './authApi'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'offline'

export interface AuthState {
  status: AuthStatus
  session: AuthSession | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

export function useAuth(): AuthState {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<AuthSession | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await fetchSession()
      if (result) {
        setSession(result)
        setStatus('authenticated')
      } else {
        setSession(null)
        setStatus('anonymous')
      }
    } catch {
      // fetchSession only rejects on a network-level failure (backend unreachable) —
      // a resolved 401 already becomes `null` above, so this is genuinely "can't reach it".
      setSession(null)
      setStatus('offline')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await logoutRequest()
    setSession(null)
    setStatus('anonymous')
  }, [])

  return { status, session, refresh, logout }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/useAuth.ts
git commit -m "feat(frontend): useAuth consulta la sesión real del backend en vez de localStorage"
```

---

## Task 9: Adaptar `Home.tsx`, `LoginModal.tsx` y `LogoutButton.tsx` al nuevo `useAuth`

**Files:**
- Modify: `src/pages/Home/Home.tsx`
- Modify: `src/pages/Home/LoginModal.tsx`
- Modify: `src/pages/Archivo/LogoutButton.tsx` (solo el sitio donde se usa — el componente en sí no cambia)

**Interfaces:**
- Consumes: `useAuth` (`src/lib/useAuth.ts`, Task 8); `login`, `JellyfinAuthError` (`src/lib/authApi.ts`, Task 7)
- Produces: nada nuevo — cierra el ciclo de login/logout iniciado en las tareas 7 y 8.

- [ ] **Step 1: Reemplazar el contenido completo de `src/pages/Home/Home.tsx`**

```typescript
import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import Scene from './Scene'
import LoginModal from './LoginModal'
import styles from './Home.module.css'

function Home() {
  const { status, refresh } = useAuth()
  const [loginOpen, setLoginOpen] = useState(false)
  const navigate = useNavigate()

  const handleRequestAccess = () => {
    if (status === 'loading') return
    if (status === 'authenticated') {
      navigate('/archivo')
    } else {
      setLoginOpen(true)
    }
  }

  const handleLoginSuccess = async () => {
    await refresh()
    setLoginOpen(false)
    navigate('/archivo')
  }

  return (
    <div className={styles.container}>
      <Canvas camera={{ position: [0, 2, 6], fov: 50 }}>
        <Suspense fallback={null}>
          <Scene authenticated={status === 'authenticated'} onRequestAccess={handleRequestAccess} />
        </Suspense>
      </Canvas>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onSuccess={handleLoginSuccess} />}
    </div>
  )
}

export default Home
```

- [ ] **Step 2: Actualizar `src/pages/Home/LoginModal.tsx`**

Sustituye el import y la llamada de autenticación (el resto del fichero — JSX, estados `submitting`/`error`, estilos — no cambia):

```typescript
import { login, JellyfinAuthError } from '../../lib/authApi'
```

Y en `handleSubmit`, sustituye `await authenticateWithJellyfin(username, password)` por:

```typescript
      await login(username, password)
```

- [ ] **Step 3: Comprobar que el proyecto compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Verificación manual con el flujo existente**

Run el servidor de desarrollo del frontend (`npm run dev`) y, sin backend todavía corriendo (se añade en la Task 13), confirma en el navegador que:
- La pantalla de inicio carga sin errores de consola.
- Al pulsar la puerta bloqueada sigue mostrando "Salta amigo y entra" (no depende del backend).
- Resolver el riff sigue mostrando "Puerta desbloqueada" y ocultando las teclas (tampoco depende del backend).
- Al pulsar la puerta ya "desbloqueada" (sin backend corriendo) el formulario de login aparece, y al enviarlo muestra el error de conexión (`No se pudo conectar con el servidor`) — confirma que ya no llama a Jellyfin directamente.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Home/Home.tsx src/pages/Home/LoginModal.tsx
git commit -m "feat(frontend): Home y LoginModal usan la sesión real de /api"
```

---

## Task 10: Dashboard con cuadros por permiso

**Files:**
- Create: `src/pages/Archivo/Dashboard.tsx`
- Create: `src/pages/Archivo/Dashboard.module.css`
- Modify: `src/pages/Archivo/Archivo.tsx`

**Interfaces:**
- Consumes: `useAuth` (`src/lib/useAuth.ts`, Task 8); `AuthSession`, `AppKey` (`src/lib/authApi.ts`, Task 7); componente `LogoutButton` ya existente (`src/pages/Archivo/LogoutButton.tsx`)
- Produces: `export default function Dashboard(props: { session: AuthSession }): JSX.Element` (`Dashboard.tsx`) — usado por `Archivo.tsx`.

- [ ] **Step 1: Crear `src/pages/Archivo/Dashboard.module.css`**

```css
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 1.25rem;
  width: min(900px, 90vw);
  padding: 2rem;
}

.tile {
  display: flex;
  align-items: center;
  justify-content: center;
  aspect-ratio: 1;
  border-radius: 12px;
  border: 1px solid rgba(15, 240, 252, 0.35);
  background: rgba(10, 5, 24, 0.7);
  color: #0ff0fc;
  font-weight: 700;
  font-size: 1rem;
  text-align: center;
  text-decoration: none;
  padding: 1rem;
  transition: box-shadow 0.15s, transform 0.1s, border-color 0.15s;
}

.tile:hover {
  border-color: #0ff0fc;
  box-shadow: 0 0 20px rgba(15, 240, 252, 0.4);
  transform: translateY(-2px);
}

.empty {
  text-align: center;
  color: #0ff0fc;
}

.empty p {
  color: #8b8fb3;
  margin-top: 0.5rem;
}
```

- [ ] **Step 2: Crear `src/pages/Archivo/Dashboard.tsx`**

```typescript
import { Link } from 'react-router-dom'
import type { AppKey, AuthSession } from '../../lib/authApi'
import styles from './Dashboard.module.css'

interface Tile {
  key: AppKey
  label: string
  href: string
  external: boolean
}

const APP_TILES: Record<AppKey, Tile> = {
  jellyfin: { key: 'jellyfin', label: 'Jellyfin', href: 'https://teatro.archivo-oasis.com', external: true },
  jellyseerr: {
    key: 'jellyseerr',
    label: 'Jellyseerr',
    href: 'https://peticiones.archivo-oasis.com',
    external: true,
  },
  cantina: { key: 'cantina', label: 'La Cantina', href: '/archivo/cantina', external: false },
  aportaciones: { key: 'aportaciones', label: 'Aportaciones', href: '/archivo/aportaciones', external: false },
}

interface DashboardProps {
  session: AuthSession
}

function Dashboard({ session }: DashboardProps) {
  const tiles = session.permissions.map((key) => APP_TILES[key])

  if (tiles.length === 0 && !session.isAdmin) {
    return (
      <div className={styles.empty}>
        <h1>Pendiente de aprobación</h1>
        <p>Un administrador debe concederte acceso a alguna sección.</p>
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      {tiles.map((tile) =>
        tile.external ? (
          <a key={tile.key} className={styles.tile} href={tile.href} target="_blank" rel="noreferrer">
            {tile.label}
          </a>
        ) : (
          <Link key={tile.key} className={styles.tile} to={tile.href}>
            {tile.label}
          </Link>
        ),
      )}
      {session.isAdmin && (
        <Link className={styles.tile} to="/archivo/admin">
          Configuración
        </Link>
      )}
    </div>
  )
}

export default Dashboard
```

- [ ] **Step 3: Reemplazar el contenido completo de `src/pages/Archivo/Archivo.tsx`**

```typescript
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import LogoutButton from './LogoutButton'
import Dashboard from './Dashboard'
import styles from './Archivo.module.css'

function Archivo() {
  const { status, session, logout } = useAuth()
  const navigate = useNavigate()

  if (status === 'loading') {
    return <main className={styles.container} />
  }

  if (status === 'offline') {
    return (
      <main className={styles.container}>
        <div>
          <h1>No se pudo conectar con el servidor</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  if (status === 'anonymous' || !session) {
    return (
      <main className={styles.container}>
        <div>
          <h1>Solo el penitente pasará</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.container}>
      <LogoutButton
        onLogout={async () => {
          await logout()
          navigate('/')
        }}
      />
      <Dashboard session={session} />
    </main>
  )
}

export default Archivo
```

- [ ] **Step 4: Comprobar que el proyecto compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Archivo/Dashboard.tsx src/pages/Archivo/Dashboard.module.css src/pages/Archivo/Archivo.tsx
git commit -m "feat(frontend): dashboard con cuadros según los permisos de la sesión"
```

---

## Task 11: Placeholders de La Cantina / Aportaciones + rutas

**Files:**
- Create: `src/pages/Archivo/Placeholder.tsx`
- Modify: `src/routes/AppRoutes.tsx`

**Interfaces:**
- Consumes: `useAuth` (`src/lib/useAuth.ts`, Task 8); `AppKey` (`src/lib/authApi.ts`, Task 7)
- Produces: `export default function Placeholder(props: { title: string; need: AppKey }): JSX.Element` (`Placeholder.tsx`), montado en `AppRoutes.tsx`.

- [ ] **Step 1: Crear `src/pages/Archivo/Placeholder.tsx`**

```typescript
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import type { AppKey } from '../../lib/authApi'
import styles from './Archivo.module.css'

interface PlaceholderProps {
  title: string
  need: AppKey
}

function Placeholder({ title, need }: PlaceholderProps) {
  const { status, session } = useAuth()
  const navigate = useNavigate()

  if (status === 'loading') {
    return <main className={styles.container} />
  }

  if (status === 'offline') {
    return (
      <main className={styles.container}>
        <div>
          <h1>No se pudo conectar con el servidor</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  if (!session || !session.permissions.includes(need)) {
    return (
      <main className={styles.container}>
        <div>
          <h1>Solo el penitente pasará</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.container}>
      <h1>{title} — próximamente</h1>
    </main>
  )
}

export default Placeholder
```

- [ ] **Step 2: Reemplazar el contenido completo de `src/routes/AppRoutes.tsx`**

```typescript
import { Routes, Route } from 'react-router-dom'
import Home from '../pages/Home/Home'
import Archivo from '../pages/Archivo/Archivo'
import Placeholder from '../pages/Archivo/Placeholder'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/archivo" element={<Archivo />} />
      <Route path="/archivo/cantina" element={<Placeholder title="La Cantina" need="cantina" />} />
      <Route path="/archivo/aportaciones" element={<Placeholder title="Aportaciones" need="aportaciones" />} />
    </Routes>
  )
}

export default AppRoutes
```

(La ruta `/archivo/admin` se añade en la Task 12.)

- [ ] **Step 3: Comprobar que el proyecto compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Archivo/Placeholder.tsx src/routes/AppRoutes.tsx
git commit -m "feat(frontend): páginas placeholder de La Cantina y Aportaciones, protegidas por permiso"
```

---

## Task 12: Panel de administración

**Files:**
- Create: `src/pages/Archivo/AdminPanel.tsx`
- Create: `src/pages/Archivo/AdminPanel.module.css`
- Modify: `src/routes/AppRoutes.tsx`

**Interfaces:**
- Consumes: `useAuth` (`src/lib/useAuth.ts`, Task 8); `APP_KEYS`, `AppKey`, `AdminUser`, `fetchAdminUsers`, `setUserPermission` (`src/lib/authApi.ts`, Task 7)
- Produces: `export default function AdminPanel(): JSX.Element` (`AdminPanel.tsx`), montado en `/archivo/admin`.

- [ ] **Step 1: Crear `src/pages/Archivo/AdminPanel.module.css`**

```css
.container {
  min-height: 100vh;
  background: #03010a;
  color: #0ff0fc;
  padding: 3rem 2rem;
}

.title {
  text-align: center;
  margin-bottom: 2rem;
}

.error {
  text-align: center;
  color: #ff6b81;
  margin-bottom: 1rem;
}

.loading {
  text-align: center;
  color: #8b8fb3;
}

.table {
  width: min(700px, 100%);
  margin: 0 auto;
  border-collapse: collapse;
}

.table th,
.table td {
  padding: 0.6rem 0.9rem;
  text-align: center;
  border-bottom: 1px solid rgba(15, 240, 252, 0.2);
}

.table th:first-child,
.table td:first-child {
  text-align: left;
}

.table input[type='checkbox'] {
  width: 18px;
  height: 18px;
  accent-color: #0ff0fc;
  cursor: pointer;
}
```

- [ ] **Step 2: Crear `src/pages/Archivo/AdminPanel.tsx`**

```typescript
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import { APP_KEYS, fetchAdminUsers, setUserPermission, type AdminUser, type AppKey } from '../../lib/authApi'
import archivoStyles from './Archivo.module.css'
import styles from './AdminPanel.module.css'

const APP_LABELS: Record<AppKey, string> = {
  jellyfin: 'Jellyfin',
  jellyseerr: 'Jellyseerr',
  cantina: 'La Cantina',
  aportaciones: 'Aportaciones',
}

function AdminPanel() {
  const { status, session } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated' || !session?.isAdmin) return
    fetchAdminUsers()
      .then(setUsers)
      .catch(() => setError('No se pudo cargar la lista de usuarios'))
  }, [status, session])

  if (status === 'loading') {
    return <main className={archivoStyles.container} />
  }

  if (status === 'offline') {
    return (
      <main className={archivoStyles.container}>
        <div>
          <h1>No se pudo conectar con el servidor</h1>
          <button className={archivoStyles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  if (!session || !session.isAdmin) {
    return (
      <main className={archivoStyles.container}>
        <div>
          <h1>Solo el penitente pasará</h1>
          <button className={archivoStyles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  const toggle = async (username: string, appKey: AppKey, granted: boolean) => {
    setError(null)
    try {
      await setUserPermission(username, appKey, granted)
      setUsers(
        (prev) =>
          prev?.map((u) =>
            u.username === username
              ? {
                  ...u,
                  permissions: granted ? [...u.permissions, appKey] : u.permissions.filter((p) => p !== appKey),
                }
              : u,
          ) ?? null,
      )
    } catch {
      setError('No se pudo actualizar el permiso')
    }
  }

  return (
    <main className={styles.container}>
      <h1 className={styles.title}>Configuración — permisos</h1>
      {error && <p className={styles.error}>{error}</p>}
      {!users ? (
        <p className={styles.loading}>Cargando…</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Usuario</th>
              {APP_KEYS.map((key) => (
                <th key={key}>{APP_LABELS[key]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username}>
                <td>{user.username}</td>
                {APP_KEYS.map((key) => (
                  <td key={key}>
                    <input
                      type="checkbox"
                      checked={user.permissions.includes(key)}
                      onChange={(e) => toggle(user.username, key, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}

export default AdminPanel
```

- [ ] **Step 3: Añadir la ruta en `src/routes/AppRoutes.tsx`**

Añade el import:

```typescript
import AdminPanel from '../pages/Archivo/AdminPanel'
```

Y la ruta, junto a las de Cantina/Aportaciones:

```typescript
      <Route path="/archivo/admin" element={<AdminPanel />} />
```

- [ ] **Step 4: Comprobar que el proyecto compila**

Run: `npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Archivo/AdminPanel.tsx src/pages/Archivo/AdminPanel.module.css src/routes/AppRoutes.tsx
git commit -m "feat(frontend): panel de administración para conceder y revocar permisos"
```

---

## Task 13: Verificación manual end-to-end

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: confirmación de que el flujo completo funciona con el backend real corriendo en local.

- [ ] **Step 1: Arrancar el backend en local apuntando a Jellyfin real**

```bash
cd server
JELLYFIN_URL=https://teatro.archivo-oasis.com \
ADMIN_JELLYFIN_USERNAME=<tu usuario admin de Jellyfin> \
SESSION_SECRET=dev-secret \
PORT=3001 \
npm run dev
```

- [ ] **Step 2: Servir el frontend con proxy hacia el backend en dev**

Vite necesita reenviar `/api` al backend en local (nginx solo existe en producción). Añade temporalmente a `vite.config.ts` — si no existe ya un bloque `server.proxy`, créalo:

```typescript
server: {
  proxy: {
    '/api': 'http://localhost:3001',
  },
},
```

Run: `npm run dev` (en la raíz del repo, puerto por defecto de Vite)

- [ ] **Step 3: Verificar el flujo con credenciales incorrectas**

En el navegador: resuelve el riff, pulsa la puerta, escribe un usuario/contraseña incorrectos. Espera: el formulario muestra "Usuario o contraseña incorrectos" (confirma que el backend está llamando de verdad a Jellyfin).

- [ ] **Step 4: Verificar el flujo con credenciales reales**

Repite con tus credenciales reales de Jellyfin. Espera: navega a `/archivo`. Como es tu primer login contra este backend, no tienes ningún permiso todavía — deberías ver "Pendiente de aprobación" (o el dashboard con solo el cuadro de "Configuración", si el usuario coincide con `ADMIN_JELLYFIN_USERNAME`).

- [ ] **Step 5: Verificar el panel de admin**

Si iniciaste sesión como el usuario admin: entra en el cuadro "Configuración", confirma que te ves listado en la tabla, marca la casilla de "La Cantina" para tu propio usuario, recarga `/archivo` y confirma que ahora ves el cuadro de "La Cantina" en el dashboard y que lleva a `/archivo/cantina`.

- [ ] **Step 6: Verificar el guard de permisos por URL directa**

Con el mismo usuario (sin permiso en "Aportaciones"), navega directamente a `/archivo/aportaciones` escribiendo la URL. Espera: "Solo el penitente pasará", no el contenido placeholder.

- [ ] **Step 7: Verificar logout**

Pulsa el botón de cierre de sesión. Espera: vuelve a `/`, y al navegar directamente a `/archivo` vuelve a mostrar "Solo el penitente pasará".

- [ ] **Step 8: Revertir el cambio temporal de `vite.config.ts` si no se quiere dejar committeado, o dejarlo si se prefiere tener proxy de desarrollo permanente**

Decide si el proxy de `vite.config.ts` del Step 2 se queda (recomendado, para que `npm run dev` funcione contra el backend local sin more configuración) o se revierte. Si se queda:

```bash
git add vite.config.ts
git commit -m "chore: proxy de Vite hacia la API local en desarrollo"
```
