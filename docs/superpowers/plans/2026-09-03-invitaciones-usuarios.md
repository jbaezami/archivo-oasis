# Configuración → Usuarios: permisos + invitaciones a Jellyfin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir a `/archivo/admin` un menú lateral de categorías cuya primera categoría, **Usuarios**, contiene la gestión de permisos actual (movida sin cambios) y una herramienta nueva de invitaciones de un solo uso con las que una persona externa crea su cuenta de Jellyfin y obtiene acceso a Jellyfin, Jellyseerr y a los cuadros correspondientes del dashboard.

**Architecture:** El backend `archivo-oasis-api` (Express + better-sqlite3) gana una tabla `invites`, un cliente de administración de Jellyfin autenticado con API key (`jellyfinAdmin.ts`), rutas de admin para crear/listar/revocar invitaciones y un router público (sin sesión) para consultar y consumir un token. El frontend reestructura `/archivo/admin` en un layout con menú lateral + rutas hijas, y añade una página pública `/invitacion/:token`.

**Tech Stack:** Backend: Node.js ≥20, TypeScript, Express 4, better-sqlite3, `node:test`, `node:crypto`, `fetch` global — **sin dependencias npm nuevas**. Frontend: React 18 + react-router-dom 6 + CSS Modules ya existentes — **sin dependencias npm nuevas**.

**Spec:** `docs/superpowers/specs/2026-09-03-invitaciones-usuarios-design.md`

## Global Constraints

- **Runtime del backend: Node.js ≥ 20** (lo exige `better-sqlite3@13`). En la máquina de desarrollo con Node 18, `better-sqlite3@13` hace segfault; para correr los tests en local se instala el shim `npm install --no-save better-sqlite3@11.10.0` (con `npm_config_python=/usr/bin/python3.12` si node-gyp falla) y se restaura después con `git checkout package-lock.json && npm ci`. En Docker (`node:22`) y CI funciona con la v13 sin cambios. Memoria: `server-node-version`.
- **Sin dependencias npm nuevas** en `server/package.json` ni en el `package.json` raíz. Tokens con `node:crypto`; llamadas a Jellyfin con `fetch` global; el `.env` local se parsea con código propio en `index.ts`.
- Tests del backend: `npm test` en `server/` (script ya existente: `tsx --test src/*.test.ts src/routes/*.test.ts`).
- El frontend no tiene tests unitarios; su verificación es manual (Task 12), pero cada tarea de frontend termina con `npx tsc --noEmit` y `npm run build` en verde.
- Conjunto fijo de `app_key`: `jellyfin`, `jellyseerr`, `cantina`, `aportaciones`.
- Token de invitación: 32 bytes aleatorios en `base64url`. Caducidad: exactamente 7 días desde la creación.
- El admin se identifica comparando el `jellyfin_username` de la sesión (case-insensitive) con `ADMIN_JELLYFIN_USERNAME`. No hay columna de admin.
- Todo el texto visible para el usuario va en español.
- Estética del frontend: neón cian (`#0ff0fc`) sobre fondo casi negro (`#03010a`), CSS Modules, misma línea que `LoginModal.module.css` y `Dashboard.module.css`.
- La sesión (cookie httpOnly firmada por `cookie-session`) no cambia.

---

## Resumen de ficheros

**Backend (`server/src/`):**
```
db.ts                    # MODIFICAR: tabla invites; users.last_login_at nullable
models.ts                # MODIFICAR: createInvitedUser; lastLoginAt: string | null
models.test.ts           # MODIFICAR: test de createInvitedUser
invites.ts               # NUEVO: modelo de la tabla invites
invites.test.ts          # NUEVO
jellyfinAdmin.ts         # NUEVO: cliente de admin de Jellyfin (API key)
jellyfinAdmin.test.ts    # NUEVO
app.ts                   # MODIFICAR: AppConfig gana jellyfinAdmin; monta router de invites
index.ts                 # MODIFICAR: carga .env local; lee JELLYFIN_API_KEY; crea jellyfinAdmin
routes/auth.test.ts      # MODIFICAR: helper startTestServer pasa jellyfinAdmin: null
routes/admin.ts          # MODIFICAR: endpoints POST/GET/DELETE de invitaciones
routes/admin.test.ts     # MODIFICAR: helper + tests de invitaciones
routes/invites.ts        # NUEVO: router público GET/POST /api/invites/:token
routes/invites.test.ts   # NUEVO
```

**Frontend (`src/`):**
```
lib/authApi.ts                       # MODIFICAR: cliente y tipos de invitaciones; AdminUser.lastLoginAt nullable
pages/Archivo/AdminLayout.tsx        # NUEVO: guarda de admin + menú lateral + <Outlet/>
pages/Archivo/AdminLayout.module.css # NUEVO
pages/Archivo/PermisosPage.tsx       # NUEVO: la tabla de permisos actual, sin la guarda
pages/Archivo/PermisosPage.module.css# NUEVO
pages/Archivo/InvitacionesPage.tsx   # NUEVO
pages/Archivo/InvitacionesPage.module.css # NUEVO
pages/Archivo/AdminPanel.tsx         # ELIMINAR
pages/Archivo/AdminPanel.module.css  # ELIMINAR
pages/Invitacion/Invitacion.tsx      # NUEVO: página pública de registro
pages/Invitacion/Invitacion.module.css # NUEVO
routes/AppRoutes.tsx                 # MODIFICAR: rutas hijas de /archivo/admin + /invitacion/:token
```

**Infra:**
```
docker-compose.yml       # MODIFICAR: JELLYFIN_API_KEY en el servicio archivo-oasis-api
```
`docker/nginx.conf` y `.github/workflows/deploy.yml` no cambian.

---

## Task 1: Esquema SQLite de invitaciones + modelo `invites.ts`

**Files:**
- Modify: `server/src/db.ts`
- Create: `server/src/invites.ts`
- Test: `server/src/invites.test.ts`

**Interfaces:**
- Consumes: `DB` (`db.ts`)
- Produces:
  - `export interface InviteRecord { token: string; label: string | null; createdBy: string; createdAt: string; expiresAt: string; usedAt: string | null; usedByUsername: string | null; revokedAt: string | null }` (`invites.ts`)
  - `export type InviteStatus = 'valid' | 'used' | 'expired' | 'revoked'` (`invites.ts`)
  - `export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000` (`invites.ts`)
  - `export function createInvite(db: DB, params: { createdBy: string; label?: string | null }): InviteRecord` (`invites.ts`)
  - `export function findInvite(db: DB, token: string): InviteRecord | undefined` (`invites.ts`)
  - `export function inviteStatus(invite: InviteRecord, now?: Date): InviteStatus` (`invites.ts`)
  - `export function listInvites(db: DB): (InviteRecord & { status: InviteStatus })[]` (`invites.ts`)
  - `export function markInviteUsed(db: DB, token: string, username: string): boolean` (`invites.ts`) — `true` si esta llamada lo marcó, `false` si ya estaba usado.
  - `export function revokeInvite(db: DB, token: string): boolean` (`invites.ts`) — `false` si no existe o ya está usada/revocada.

- [ ] **Step 1: Añadir la tabla `invites` y hacer `users.last_login_at` nullable en `server/src/db.ts`**

Reemplaza el bloque `db.exec(\`...\`)` completo por:

```typescript
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      jellyfin_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS permissions (
      user_id INTEGER NOT NULL REFERENCES users(id),
      app_key TEXT NOT NULL CHECK (app_key IN ('jellyfin', 'jellyseerr', 'cantina', 'aportaciones')),
      granted_at TEXT NOT NULL,
      PRIMARY KEY (user_id, app_key)
    );

    CREATE TABLE IF NOT EXISTS invites (
      token TEXT PRIMARY KEY,
      label TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      used_by_username TEXT,
      revoked_at TEXT
    );
  `)
```

Nota: `CREATE TABLE IF NOT EXISTS` no altera una tabla `users` ya creada con `last_login_at NOT NULL`. Como la BD está en pre-producción se recrea (ver Task 12, Step 1). Los tests usan `:memory:`, así que siempre parten del esquema nuevo.

- [ ] **Step 2: Escribir el test `server/src/invites.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from './db'
import {
  createInvite,
  findInvite,
  inviteStatus,
  listInvites,
  markInviteUsed,
  revokeInvite,
  INVITE_TTL_MS,
} from './invites'

test('createInvite genera un token y fija expires_at a 7 días', () => {
  const db = createDb(':memory:')
  const before = Date.now()
  const invite = createInvite(db, { createdBy: 'admin', label: 'para Marta' })
  assert.equal(typeof invite.token, 'string')
  assert.ok(invite.token.length >= 40)
  assert.equal(invite.createdBy, 'admin')
  assert.equal(invite.label, 'para Marta')
  assert.equal(invite.usedAt, null)
  assert.equal(invite.revokedAt, null)
  const ttl = new Date(invite.expiresAt).getTime() - new Date(invite.createdAt).getTime()
  assert.ok(Math.abs(ttl - INVITE_TTL_MS) < 1000)
  assert.ok(new Date(invite.expiresAt).getTime() > before)
})

test('createInvite acepta label ausente', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.equal(invite.label, null)
})

test('findInvite devuelve la invitación por token y undefined si no existe', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.deepEqual(findInvite(db, invite.token), invite)
  assert.equal(findInvite(db, 'no-existe'), undefined)
})

test('inviteStatus: valid recién creada', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.equal(inviteStatus(invite), 'valid')
})

test('inviteStatus: expired cuando expires_at está en el pasado', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  const future = new Date(Date.now() + INVITE_TTL_MS + 1000)
  assert.equal(inviteStatus(invite, future), 'expired')
})

test('inviteStatus: used tras markInviteUsed', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.equal(markInviteUsed(db, invite.token, 'marta'), true)
  const used = findInvite(db, invite.token)!
  assert.equal(inviteStatus(used), 'used')
  assert.equal(used.usedByUsername, 'marta')
})

test('markInviteUsed devuelve false si ya estaba usada', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  markInviteUsed(db, invite.token, 'marta')
  assert.equal(markInviteUsed(db, invite.token, 'otro'), false)
  assert.equal(findInvite(db, invite.token)!.usedByUsername, 'marta')
})

test('inviteStatus: revoked tiene prioridad sobre expired y used', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.equal(revokeInvite(db, invite.token), true)
  const revoked = findInvite(db, invite.token)!
  const future = new Date(Date.now() + INVITE_TTL_MS + 1000)
  assert.equal(inviteStatus(revoked, future), 'revoked')
})

test('revokeInvite devuelve false para token inexistente o ya usado', () => {
  const db = createDb(':memory:')
  assert.equal(revokeInvite(db, 'no-existe'), false)
  const invite = createInvite(db, { createdBy: 'admin' })
  markInviteUsed(db, invite.token, 'marta')
  assert.equal(revokeInvite(db, invite.token), false)
})

test('listInvites devuelve todas con su estado, más recientes primero', () => {
  const db = createDb(':memory:')
  const a = createInvite(db, { createdBy: 'admin', label: 'a' })
  const b = createInvite(db, { createdBy: 'admin', label: 'b' })
  markInviteUsed(db, a.token, 'marta')
  const list = listInvites(db)
  assert.equal(list.length, 2)
  assert.equal(list[0].token, b.token)
  assert.equal(list[0].status, 'valid')
  assert.equal(list[1].token, a.token)
  assert.equal(list[1].status, 'used')
})
```

- [ ] **Step 3: Ejecutar el test y verlo fallar**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './invites'`.

- [ ] **Step 4: Escribir `server/src/invites.ts`**

```typescript
import { randomBytes } from 'node:crypto'
import type { DB } from './db'

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export interface InviteRecord {
  token: string
  label: string | null
  createdBy: string
  createdAt: string
  expiresAt: string
  usedAt: string | null
  usedByUsername: string | null
  revokedAt: string | null
}

export type InviteStatus = 'valid' | 'used' | 'expired' | 'revoked'

interface InviteRow {
  token: string
  label: string | null
  created_by: string
  created_at: string
  expires_at: string
  used_at: string | null
  used_by_username: string | null
  revoked_at: string | null
}

function toInviteRecord(row: InviteRow): InviteRecord {
  return {
    token: row.token,
    label: row.label,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    usedByUsername: row.used_by_username,
    revokedAt: row.revoked_at,
  }
}

const SELECT_COLS =
  'token, label, created_by, created_at, expires_at, used_at, used_by_username, revoked_at'

export function createInvite(
  db: DB,
  params: { createdBy: string; label?: string | null },
): InviteRecord {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString()
  const label = params.label ?? null

  db.prepare(
    'INSERT INTO invites (token, label, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  ).run(token, label, params.createdBy, createdAt, expiresAt)

  return {
    token,
    label,
    createdBy: params.createdBy,
    createdAt,
    expiresAt,
    usedAt: null,
    usedByUsername: null,
    revokedAt: null,
  }
}

export function findInvite(db: DB, token: string): InviteRecord | undefined {
  const row = db
    .prepare(`SELECT ${SELECT_COLS} FROM invites WHERE token = ?`)
    .get(token) as InviteRow | undefined
  return row ? toInviteRecord(row) : undefined
}

export function inviteStatus(invite: InviteRecord, now: Date = new Date()): InviteStatus {
  if (invite.revokedAt) return 'revoked'
  if (invite.usedAt) return 'used'
  if (new Date(invite.expiresAt).getTime() < now.getTime()) return 'expired'
  return 'valid'
}

export function listInvites(db: DB): (InviteRecord & { status: InviteStatus })[] {
  const rows = db
    .prepare(`SELECT ${SELECT_COLS} FROM invites ORDER BY created_at DESC`)
    .all() as InviteRow[]
  const now = new Date()
  return rows.map((row) => {
    const record = toInviteRecord(row)
    return { ...record, status: inviteStatus(record, now) }
  })
}

export function markInviteUsed(db: DB, token: string, username: string): boolean {
  const result = db
    .prepare('UPDATE invites SET used_at = ?, used_by_username = ? WHERE token = ? AND used_at IS NULL')
    .run(new Date().toISOString(), username, token)
  return result.changes > 0
}

export function revokeInvite(db: DB, token: string): boolean {
  const result = db
    .prepare(
      'UPDATE invites SET revoked_at = ? WHERE token = ? AND used_at IS NULL AND revoked_at IS NULL',
    )
    .run(new Date().toISOString(), token)
  return result.changes > 0
}
```

- [ ] **Step 5: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 10 tests de `invites.test.ts` pasan; el resto de la suite sigue en verde.

- [ ] **Step 6: Commit**

```bash
git add server/src/db.ts server/src/invites.ts server/src/invites.test.ts
git commit -m "feat(server): esquema y modelo de invitaciones de un solo uso"
```

---

## Task 2: `createInvitedUser` + `lastLoginAt` nullable en `models.ts`

**Files:**
- Modify: `server/src/models.ts`
- Test: `server/src/models.test.ts`

**Interfaces:**
- Consumes: `DB` (`db.ts`)
- Produces:
  - `UserRecord.lastLoginAt: string | null` (tipo cambiado en `models.ts`)
  - `export function createInvitedUser(db: DB, username: string): UserRecord` (`models.ts`) — inserta con `last_login_at = NULL`; si el usuario ya existe (COLLATE NOCASE) lo devuelve sin tocar.
  - `listUsersWithPermissions` devuelve `lastLoginAt: string | null`.

- [ ] **Step 1: Escribir los tests nuevos en `server/src/models.test.ts`**

Añade al final del fichero:

```typescript
import { createInvitedUser } from './models'

test('createInvitedUser crea el usuario con lastLoginAt nulo', () => {
  const db = createDb(':memory:')
  const user = createInvitedUser(db, 'marta')
  assert.equal(user.jellyfinUsername, 'marta')
  assert.equal(user.lastLoginAt, null)
  assert.equal(findUserByUsername(db, 'marta')?.lastLoginAt, null)
})

test('createInvitedUser es idempotente y no pisa un login previo', () => {
  const db = createDb(':memory:')
  const first = upsertUserLogin(db, 'marta')
  assert.notEqual(first.lastLoginAt, null)
  const second = createInvitedUser(db, 'Marta')
  assert.equal(second.id, first.id)
  assert.notEqual(second.lastLoginAt, null)
})

test('un usuario invitado que luego inicia sesión obtiene lastLoginAt', () => {
  const db = createDb(':memory:')
  const invited = createInvitedUser(db, 'marta')
  assert.equal(invited.lastLoginAt, null)
  const loggedIn = upsertUserLogin(db, 'marta')
  assert.equal(loggedIn.id, invited.id)
  assert.notEqual(loggedIn.lastLoginAt, null)
})

test('listUsersWithPermissions incluye usuarios invitados con lastLoginAt null', () => {
  const db = createDb(':memory:')
  createInvitedUser(db, 'marta')
  const list = listUsersWithPermissions(db)
  const marta = list.find((u) => u.username === 'marta')
  assert.equal(marta?.lastLoginAt, null)
})
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `cd server && npm test`
Expected: FAIL — `createInvitedUser` no existe.

- [ ] **Step 3: Modificar `server/src/models.ts`**

Cambia la interfaz `UserRecord` y la fila interna para permitir null:

```typescript
export interface UserRecord {
  id: number
  jellyfinUsername: string
  createdAt: string
  lastLoginAt: string | null
}

interface UserRow {
  id: number
  jellyfin_username: string
  created_at: string
  last_login_at: string | null
}
```

Añade la función nueva (debajo de `upsertUserLogin`):

```typescript
export function createInvitedUser(db: DB, username: string): UserRecord {
  const existing = findUserByUsername(db, username)
  if (existing) return existing

  const now = new Date().toISOString()
  const result = db
    .prepare('INSERT INTO users (jellyfin_username, created_at, last_login_at) VALUES (?, ?, NULL)')
    .run(username, now)

  return {
    id: Number(result.lastInsertRowid),
    jellyfinUsername: username,
    createdAt: now,
    lastLoginAt: null,
  }
}
```

Cambia la firma de retorno de `listUsersWithPermissions`:

```typescript
export function listUsersWithPermissions(
  db: DB,
): { username: string; lastLoginAt: string | null; permissions: AppKey[] }[] {
  const users = db
    .prepare('SELECT id, jellyfin_username, last_login_at FROM users ORDER BY jellyfin_username COLLATE NOCASE')
    .all() as { id: number; jellyfin_username: string; last_login_at: string | null }[]

  return users.map((u) => ({
    username: u.jellyfin_username,
    lastLoginAt: u.last_login_at,
    permissions: getPermissions(db, u.id),
  }))
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 4 tests nuevos pasan; la suite completa sigue en verde.

- [ ] **Step 5: Commit**

```bash
git add server/src/models.ts server/src/models.test.ts
git commit -m "feat(server): createInvitedUser y last_login_at opcional"
```

---

## Task 3: Cliente de administración de Jellyfin

**Files:**
- Create: `server/src/jellyfinAdmin.ts`
- Test: `server/src/jellyfinAdmin.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `export class JellyfinAdminError extends Error {}` (`jellyfinAdmin.ts`)
  - `export class JellyfinUserExistsError extends JellyfinAdminError {}` (`jellyfinAdmin.ts`)
  - `export interface JellyfinAdminClient { createUser(username: string, password: string): Promise<void> }` (`jellyfinAdmin.ts`)
  - `export function createJellyfinAdminClient(baseUrl: string, apiKey: string): JellyfinAdminClient` (`jellyfinAdmin.ts`)

**Notas de la API de Jellyfin (referencia para el implementador):**
- `GET {baseUrl}/Users` con cabecera `X-Emby-Token: <apiKey>` → array de `{ Id, Name, ... }`. Se usa para detectar nombre en uso de forma determinista.
- `POST {baseUrl}/Users/New` con `{ "Name": username }` → `200` con `{ Id, ... }`.
- `POST {baseUrl}/Users/{Id}/Password` con `{ "CurrentPw": "", "NewPw": password }` → `204`.
- El acceso a todas las bibliotecas (actuales y futuras) es el comportamiento **por defecto** de un usuario nuevo de Jellyfin (`EnableAllFolders: true`), así que no se hace ninguna llamada a `/Policy` — la spec lo recoge así para no arriesgar a pisar otros campos de la política.

- [ ] **Step 1: Escribir el test `server/src/jellyfinAdmin.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJellyfinAdminClient, JellyfinAdminError, JellyfinUserExistsError } from './jellyfinAdmin'

interface Call {
  url: string
  method: string
  body: unknown
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const original = global.fetch
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  return { calls, restore: () => { global.fetch = original } }
}

test('createUser crea el usuario y fija la contraseña', async () => {
  const { calls, restore } = stubFetch((call) => {
    if (call.method === 'GET' && call.url.endsWith('/Users')) return new Response('[]', { status: 200 })
    if (call.url.endsWith('/Users/New')) return new Response(JSON.stringify({ Id: 'u-1' }), { status: 200 })
    if (call.url.endsWith('/Users/u-1/Password')) return new Response(null, { status: 204 })
    return new Response(null, { status: 500 })
  })
  try {
    const client = createJellyfinAdminClient('https://jf.example.com', 'key-123')
    await client.createUser('marta', 'secret123')
    const newCall = calls.find((c) => c.url.endsWith('/Users/New'))!
    assert.deepEqual(newCall.body, { Name: 'marta' })
    const pwCall = calls.find((c) => c.url.endsWith('/Users/u-1/Password'))!
    assert.deepEqual(pwCall.body, { CurrentPw: '', NewPw: 'secret123' })
  } finally {
    restore()
  }
})

test('createUser envía la API key en X-Emby-Token', async () => {
  let seenHeader: string | null = null
  const original = global.fetch
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenHeader = new Headers(init?.headers).get('X-Emby-Token')
    if (init?.method === undefined || init.method === 'GET') return new Response('[]', { status: 200 })
    if (String(_input).endsWith('/Users/New')) return new Response(JSON.stringify({ Id: 'u-1' }), { status: 200 })
    return new Response(null, { status: 204 })
  }) as typeof fetch
  try {
    await createJellyfinAdminClient('https://jf.example.com', 'key-123').createUser('marta', 'secret123')
    assert.equal(seenHeader, 'key-123')
  } finally {
    global.fetch = original
  }
})

test('createUser lanza JellyfinUserExistsError si el nombre ya existe', async () => {
  const { restore } = stubFetch((call) => {
    if (call.method === 'GET' && call.url.endsWith('/Users')) {
      return new Response(JSON.stringify([{ Id: 'x', Name: 'Marta' }]), { status: 200 })
    }
    return new Response(null, { status: 500 })
  })
  try {
    const client = createJellyfinAdminClient('https://jf.example.com', 'key-123')
    await assert.rejects(
      () => client.createUser('marta', 'secret123'),
      (err: unknown) => err instanceof JellyfinUserExistsError,
    )
  } finally {
    restore()
  }
})

test('createUser lanza JellyfinAdminError si Jellyfin responde error al crear', async () => {
  const { restore } = stubFetch((call) => {
    if (call.method === 'GET' && call.url.endsWith('/Users')) return new Response('[]', { status: 200 })
    if (call.url.endsWith('/Users/New')) return new Response('nope', { status: 500 })
    return new Response(null, { status: 500 })
  })
  try {
    const client = createJellyfinAdminClient('https://jf.example.com', 'key-123')
    await assert.rejects(
      () => client.createUser('marta', 'secret123'),
      (err: unknown) => err instanceof JellyfinAdminError && !(err instanceof JellyfinUserExistsError),
    )
  } finally {
    restore()
  }
})

test('createUser lanza JellyfinAdminError si la red falla', async () => {
  const original = global.fetch
  global.fetch = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  try {
    const client = createJellyfinAdminClient('https://jf.example.com', 'key-123')
    await assert.rejects(
      () => client.createUser('marta', 'secret123'),
      (err: unknown) => err instanceof JellyfinAdminError,
    )
  } finally {
    global.fetch = original
  }
})
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './jellyfinAdmin'`.

- [ ] **Step 3: Escribir `server/src/jellyfinAdmin.ts`**

```typescript
export class JellyfinAdminError extends Error {}
export class JellyfinUserExistsError extends JellyfinAdminError {}

export interface JellyfinAdminClient {
  createUser(username: string, password: string): Promise<void>
}

interface JellyfinUser {
  Id: string
  Name: string
}

export function createJellyfinAdminClient(baseUrl: string, apiKey: string): JellyfinAdminClient {
  const headers = {
    'Content-Type': 'application/json',
    'X-Emby-Token': apiKey,
  }

  async function call(pathname: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${baseUrl}${pathname}`, { ...init, headers })
    } catch {
      throw new JellyfinAdminError(`No se pudo contactar con Jellyfin (${pathname})`)
    }
  }

  return {
    async createUser(username: string, password: string): Promise<void> {
      const listResponse = await call('/Users', { method: 'GET' })
      if (!listResponse.ok) {
        throw new JellyfinAdminError('Jellyfin no devolvió la lista de usuarios')
      }
      const existing = (await listResponse.json()) as JellyfinUser[]
      if (existing.some((u) => u.Name.toLowerCase() === username.toLowerCase())) {
        throw new JellyfinUserExistsError(`El usuario "${username}" ya existe en Jellyfin`)
      }

      const createResponse = await call('/Users/New', {
        method: 'POST',
        body: JSON.stringify({ Name: username }),
      })
      if (!createResponse.ok) {
        throw new JellyfinAdminError('Jellyfin rechazó la creación del usuario')
      }
      const created = (await createResponse.json()) as JellyfinUser

      const passwordResponse = await call(`/Users/${created.Id}/Password`, {
        method: 'POST',
        body: JSON.stringify({ CurrentPw: '', NewPw: password }),
      })
      if (!passwordResponse.ok) {
        throw new JellyfinAdminError('Jellyfin rechazó la contraseña del usuario')
      }
    },
  }
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 5 tests de `jellyfinAdmin.test.ts` pasan; la suite completa en verde.

- [ ] **Step 5: Commit**

```bash
git add server/src/jellyfinAdmin.ts server/src/jellyfinAdmin.test.ts
git commit -m "feat(server): cliente de administración de Jellyfin con API key"
```

---

## Task 4: Cablear `jellyfinAdmin` en `AppConfig` + `.env` local + `JELLYFIN_API_KEY`

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/auth.test.ts`
- Modify: `server/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `JellyfinAdminClient` (`jellyfinAdmin.ts`, Task 3); `createJellyfinAdminClient` (`jellyfinAdmin.ts`)
- Produces:
  - `AppConfig` gana `jellyfinAdmin: JellyfinAdminClient | null` (`app.ts`) — lo consumen Task 5 y Task 6.
  - `index.ts` carga `server/.env` si existe (solo desarrollo) y construye `jellyfinAdmin` a partir de `JELLYFIN_API_KEY`.

- [ ] **Step 1: Añadir `jellyfinAdmin` a `AppConfig` en `server/src/app.ts`**

```typescript
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
```

(El router de invitaciones se monta en la Task 6; aquí solo se añade el campo a la config.)

- [ ] **Step 2: Actualizar el helper de `server/src/routes/auth.test.ts`**

En la función `startTestServer`, añade `jellyfinAdmin: null` al objeto pasado a `createApp`:

```typescript
  const app = createApp({
    db: createDb(':memory:'),
    jellyfin,
    jellyfinAdmin: null,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
```

- [ ] **Step 3: Actualizar el helper de `server/src/routes/admin.test.ts`**

Igual, en su `startTestServer`:

```typescript
  const app = createApp({
    db: createDb(':memory:'),
    jellyfin: acceptingJellyfin,
    jellyfinAdmin: null,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
```

- [ ] **Step 4: Ejecutar la suite para confirmar que sigue verde**

Run: `cd server && npm test`
Expected: PASS — todos los tests existentes siguen pasando con el campo nuevo.

- [ ] **Step 5: Reescribir `server/src/index.ts`**

```typescript
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
```

- [ ] **Step 6: Verificar que compila**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/src/routes/auth.test.ts server/src/routes/admin.test.ts
git commit -m "feat(server): jellyfinAdmin en AppConfig y carga de server/.env en desarrollo"
```

---

## Task 5: Endpoints de admin para invitaciones

**Files:**
- Modify: `server/src/routes/admin.ts`
- Modify: `server/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `createInvite`, `listInvites`, `revokeInvite`, `inviteStatus`, `InviteRecord`, `InviteStatus` (`invites.ts`, Task 1)
- Produces (respuesta JSON, forma `InviteSummary`):
  `{ token: string; label: string | null; createdBy: string; createdAt: string; expiresAt: string; status: 'valid'|'used'|'expired'|'revoked'; usedAt: string | null; usedByUsername: string | null }`
  - `POST /api/admin/invites` → `201 { invite: InviteSummary }`
  - `GET /api/admin/invites` → `200 { invites: InviteSummary[] }`
  - `DELETE /api/admin/invites/:token` → `204` | `404`

- [ ] **Step 1: Escribir los tests nuevos en `server/src/routes/admin.test.ts`**

Añade al final del fichero:

```typescript
test('POST /api/admin/invites crea una invitación para el admin', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const response = await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ label: 'para Marta' }),
    })
    assert.equal(response.status, 201)
    const { invite } = await response.json()
    assert.equal(typeof invite.token, 'string')
    assert.equal(invite.label, 'para Marta')
    assert.equal(invite.createdBy, 'admin-user')
    assert.equal(invite.status, 'valid')
    assert.ok(new Date(invite.expiresAt).getTime() > Date.now())
  } finally {
    server.close()
  }
})

test('POST /api/admin/invites sin label funciona', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const response = await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({}),
    })
    assert.equal(response.status, 201)
    const { invite } = await response.json()
    assert.equal(invite.label, null)
  } finally {
    server.close()
  }
})

test('los endpoints de invitaciones rechazan a quien no es admin', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const noSession = await fetch(`${baseUrl}/api/admin/invites`)
    assert.equal(noSession.status, 401)
    const userCookie = await loginAs(baseUrl, 'alice')
    const asUser = await fetch(`${baseUrl}/api/admin/invites`, { headers: { Cookie: userCookie } })
    assert.equal(asUser.status, 403)
  } finally {
    server.close()
  }
})

test('GET /api/admin/invites lista las invitaciones con su estado', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ label: 'una' }),
    })
    const response = await fetch(`${baseUrl}/api/admin/invites`, { headers: { Cookie: adminCookie } })
    assert.equal(response.status, 200)
    const { invites } = await response.json()
    assert.equal(invites.length, 1)
    assert.equal(invites[0].status, 'valid')
  } finally {
    server.close()
  }
})

test('DELETE /api/admin/invites/:token revoca una invitación pendiente', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const created = await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({}),
    })
    const { invite } = await created.json()

    const del = await fetch(`${baseUrl}/api/admin/invites/${invite.token}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    assert.equal(del.status, 204)

    const list = await fetch(`${baseUrl}/api/admin/invites`, { headers: { Cookie: adminCookie } })
    const { invites } = await list.json()
    assert.equal(invites[0].status, 'revoked')
  } finally {
    server.close()
  }
})

test('DELETE /api/admin/invites/:token devuelve 404 si no existe', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const del = await fetch(`${baseUrl}/api/admin/invites/no-existe`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    assert.equal(del.status, 404)
  } finally {
    server.close()
  }
})
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `cd server && npm test`
Expected: FAIL — `POST /api/admin/invites` responde 404 (ruta no montada).

- [ ] **Step 3: Modificar `server/src/routes/admin.ts`**

```typescript
import { Router } from 'express'
import type { DB } from '../db'
import { APP_KEYS, type AppKey } from '../db'
import { listUsersWithPermissions, findUserByUsername, setPermission } from '../models'
import { createInvite, listInvites, revokeInvite, type InviteRecord, type InviteStatus } from '../invites'
import { requireAdmin } from '../middleware'

function toInviteSummary(invite: InviteRecord & { status: InviteStatus }) {
  return {
    token: invite.token,
    label: invite.label,
    createdBy: invite.createdBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    status: invite.status,
    usedAt: invite.usedAt,
    usedByUsername: invite.usedByUsername,
  }
}

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

  router.post('/invites', (req, res) => {
    const { label } = req.body as { label?: string }
    const createdBy = req.session!.username as string
    const trimmed = typeof label === 'string' && label.trim() ? label.trim() : null
    const invite = createInvite(db, { createdBy, label: trimmed })
    res.status(201).json({ invite: toInviteSummary({ ...invite, status: 'valid' }) })
  })

  router.get('/invites', (_req, res) => {
    res.json({ invites: listInvites(db).map(toInviteSummary) })
  })

  router.delete('/invites/:token', (req, res) => {
    const ok = revokeInvite(db, req.params.token)
    if (!ok) {
      res.status(404).json({ error: 'Invitación no encontrada o ya usada' })
      return
    }
    res.status(204).end()
  })

  return router
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 6 tests nuevos de `admin.test.ts` pasan; la suite completa en verde.

- [ ] **Step 5: Commit**

```bash
git add server/src/routes/admin.ts server/src/routes/admin.test.ts
git commit -m "feat(server): endpoints de admin para crear, listar y revocar invitaciones"
```

---

## Task 6: Router público de invitaciones (`/api/invites/:token`)

**Files:**
- Create: `server/src/routes/invites.ts`
- Test: `server/src/routes/invites.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `DB` (`db.ts`); `JellyfinAdminClient`, `JellyfinAdminError`, `JellyfinUserExistsError` (`jellyfinAdmin.ts`, Task 3); `findInvite`, `inviteStatus`, `markInviteUsed` (`invites.ts`, Task 1); `createInvitedUser`, `findUserByUsername`, `setPermission` (`models.ts`, Task 2); `AppConfig.jellyfinAdmin` (`app.ts`, Task 4)
- Produces:
  - `export function createInvitesRouter(db: DB, jellyfinAdmin: JellyfinAdminClient | null): Router` (`routes/invites.ts`), montado en `app.ts` bajo `/api/invites`.
  - `GET /api/invites/:token` → `200 { status: 'valid'|'used'|'expired'|'revoked'|'not_found' }`
  - `POST /api/invites/:token` → `200 { ok: true }` | `400` | `409` | `410` | `502` | `503`

- [ ] **Step 1: Escribir el test `server/src/routes/invites.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app'
import { createDb } from '../db'
import type { DB } from '../db'
import type { JellyfinClient } from '../jellyfin'
import {
  type JellyfinAdminClient,
  JellyfinAdminError,
  JellyfinUserExistsError,
} from '../jellyfinAdmin'
import { createInvite, findInvite, markInviteUsed, revokeInvite, INVITE_TTL_MS } from '../invites'
import { getPermissions, findUserByUsername } from '../models'

const acceptingJellyfin: JellyfinClient = { async authenticate() {} }

const recordingAdmin = () => {
  const calls: { username: string; password: string }[] = []
  const client: JellyfinAdminClient = {
    async createUser(username, password) {
      calls.push({ username, password })
    },
  }
  return { calls, client }
}

function startTestServer(jellyfinAdmin: JellyfinAdminClient | null) {
  const db: DB = createDb(':memory:')
  const app = createApp({
    db,
    jellyfin: acceptingJellyfin,
    jellyfinAdmin,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}`, db }
}

test('GET /api/invites/:token devuelve el estado', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const valid = await fetch(`${baseUrl}/api/invites/${invite.token}`)
    assert.deepEqual(await valid.json(), { status: 'valid' })

    const unknown = await fetch(`${baseUrl}/api/invites/no-existe`)
    assert.deepEqual(await unknown.json(), { status: 'not_found' })

    revokeInvite(db, invite.token)
    const revoked = await fetch(`${baseUrl}/api/invites/${invite.token}`)
    assert.deepEqual(await revoked.json(), { status: 'revoked' })
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token crea la cuenta, da permisos y consume el token', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })

    assert.deepEqual(admin.calls, [{ username: 'marta', password: 'secret123' }])

    const user = findUserByUsername(db, 'marta')!
    assert.equal(user.lastLoginAt, null)
    assert.deepEqual(getPermissions(db, user.id).sort(), ['jellyfin', 'jellyseerr'])

    const consumed = findInvite(db, invite.token)!
    assert.equal(consumed.usedByUsername, 'marta')
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token con token ya usado devuelve 410 y no llama a Jellyfin', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    markInviteUsed(db, invite.token, 'otro')
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 410)
    assert.equal(admin.calls.length, 0)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token con contraseña corta devuelve 400, token intacto', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'x' }),
    })
    assert.equal(response.status, 400)
    assert.equal(admin.calls.length, 0)
    assert.equal(findInvite(db, invite.token)!.usedAt, null)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token con username vacío o con espacios devuelve 400', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    for (const username of ['', '  ', 'con espacio']) {
      const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'secret123' }),
      })
      assert.equal(response.status, 400)
    }
    assert.equal(findInvite(db, invite.token)!.usedAt, null)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token: nombre ya en Jellyfin devuelve 409, token intacto', async () => {
  const client: JellyfinAdminClient = {
    async createUser() {
      throw new JellyfinUserExistsError('ya existe')
    },
  }
  const { server, baseUrl, db } = startTestServer(client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 409)
    assert.equal(findInvite(db, invite.token)!.usedAt, null)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token: fallo de Jellyfin devuelve 502, token intacto', async () => {
  const client: JellyfinAdminClient = {
    async createUser() {
      throw new JellyfinAdminError('jellyfin caído')
    },
  }
  const { server, baseUrl, db } = startTestServer(client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 502)
    assert.equal(findInvite(db, invite.token)!.usedAt, null)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token sin jellyfinAdmin configurado devuelve 503', async () => {
  const { server, baseUrl, db } = startTestServer(null)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 503)
  } finally {
    server.close()
  }
})
```

- [ ] **Step 2: Ejecutar y verlo fallar**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module '../routes/invites'` o 404 en las rutas.

- [ ] **Step 3: Escribir `server/src/routes/invites.ts`**

```typescript
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
    if (!jellyfinAdmin) {
      res.status(503).json({ error: 'La creación de cuentas no está disponible ahora mismo' })
      return
    }

    const invite = findInvite(db, req.params.token)
    if (!invite || inviteStatus(invite) !== 'valid') {
      res.status(410).json({ error: 'Esta invitación no es válida', status: invite ? inviteStatus(invite) : 'not_found' })
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

    db.transaction(() => {
      const user = createInvitedUser(db, trimmedUsername)
      setPermission(db, user.id, 'jellyfin', true)
      setPermission(db, user.id, 'jellyseerr', true)
      markInviteUsed(db, invite.token, trimmedUsername)
    })()

    res.json({ ok: true })
  })

  return router
}
```

- [ ] **Step 4: Montar el router en `server/src/app.ts`**

Añade el import:

```typescript
import { createInvitesRouter } from './routes/invites'
```

Y debajo de la línea `app.use('/api/admin', createAdminRouter(...))`:

```typescript
  app.use('/api/invites', createInvitesRouter(config.db, config.jellyfinAdmin))
```

- [ ] **Step 5: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 8 tests de `invites.test.ts` pasan; la suite completa en verde.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/invites.ts server/src/routes/invites.test.ts server/src/app.ts
git commit -m "feat(server): router público para consultar y consumir invitaciones"
```

---

## Task 7: Infra — `JELLYFIN_API_KEY` en docker-compose

**Files:**
- Modify: `docker-compose.yml`

**Interfaces:**
- Consumes: nada de código.
- Produces: el contenedor `archivo-oasis-api` recibe `JELLYFIN_API_KEY` del `.env` de despliegue.

- [ ] **Step 1: Añadir la variable al servicio `archivo-oasis-api` en `docker-compose.yml`**

En el bloque `environment:` del servicio `archivo-oasis-api`, añade la línea:

```yaml
      - JELLYFIN_API_KEY=${JELLYFIN_API_KEY}
```

El bloque queda:

```yaml
    environment:
      - JELLYFIN_URL=${JELLYFIN_URL}
      - ADMIN_JELLYFIN_USERNAME=${ADMIN_JELLYFIN_USERNAME}
      - SESSION_SECRET=${SESSION_SECRET}
      - JELLYFIN_API_KEY=${JELLYFIN_API_KEY}
```

- [ ] **Step 2: Verificar la sintaxis del compose**

Run: `docker compose -f docker-compose.yml config` (si `docker` está disponible; si no, revisa el YAML a mano)
Expected: imprime la config resuelta sin errores de sintaxis. `JELLYFIN_API_KEY` aparece en el entorno de `archivo-oasis-api`.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(infra): pasar JELLYFIN_API_KEY al contenedor archivo-oasis-api"
```

---

## Task 8: Cliente de invitaciones en el frontend (`authApi.ts`)

**Files:**
- Modify: `src/lib/authApi.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `AdminUser.lastLoginAt: string | null` (tipo cambiado)
  - `export type InviteStatus = 'valid' | 'used' | 'expired' | 'revoked' | 'not_found'`
  - `export interface InviteSummary { token: string; label: string | null; createdBy: string; createdAt: string; expiresAt: string; status: 'valid' | 'used' | 'expired' | 'revoked'; usedAt: string | null; usedByUsername: string | null }`
  - `export class InviteGoneError extends Error {}`
  - `export async function generateInvite(label?: string): Promise<InviteSummary>`
  - `export async function fetchInvites(): Promise<InviteSummary[]>`
  - `export async function revokeInvite(token: string): Promise<void>`
  - `export async function fetchInviteStatus(token: string): Promise<InviteStatus>`
  - `export async function consumeInvite(token: string, username: string, password: string): Promise<void>` — lanza `InviteGoneError` si la invitación ya no es válida (410); lanza `Error` con mensaje del backend en 400/409/otros.

- [ ] **Step 1: Cambiar el tipo de `AdminUser.lastLoginAt` en `src/lib/authApi.ts`**

```typescript
export interface AdminUser {
  username: string
  lastLoginAt: string | null
  permissions: AppKey[]
}
```

- [ ] **Step 2: Añadir el bloque de invitaciones al final de `src/lib/authApi.ts`**

```typescript
export type InviteStatus = 'valid' | 'used' | 'expired' | 'revoked' | 'not_found'

export interface InviteSummary {
  token: string
  label: string | null
  createdBy: string
  createdAt: string
  expiresAt: string
  status: 'valid' | 'used' | 'expired' | 'revoked'
  usedAt: string | null
  usedByUsername: string | null
}

export class InviteGoneError extends Error {}

export async function generateInvite(label?: string): Promise<InviteSummary> {
  const response = await fetch('/api/admin/invites', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo generar la invitación'))
  }
  const body = (await response.json()) as { invite: InviteSummary }
  return body.invite
}

export async function fetchInvites(): Promise<InviteSummary[]> {
  const response = await fetch('/api/admin/invites', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo cargar la lista de invitaciones'))
  }
  const body = (await response.json()) as { invites: InviteSummary[] }
  return body.invites
}

export async function revokeInvite(token: string): Promise<void> {
  const response = await fetch(`/api/admin/invites/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo revocar la invitación'))
  }
}

export async function fetchInviteStatus(token: string): Promise<InviteStatus> {
  const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error('No se pudo comprobar la invitación')
  }
  const body = (await response.json()) as { status: InviteStatus }
  return body.status
}

export async function consumeInvite(token: string, username: string, password: string): Promise<void> {
  const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (response.ok) return

  const message = await readErrorMessage(response, 'No se pudo crear la cuenta')
  if (response.status === 410) {
    throw new InviteGoneError(message)
  }
  throw new Error(message)
}
```

- [ ] **Step 3: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: FALLA en `AdminPanel.tsx` si usa `lastLoginAt` como `string` en un contexto que no acepta `null` — si es así, es esperado y se arregla en la Task 9 (que elimina ese fichero). Si `AdminPanel.tsx` no toca `lastLoginAt`, compila limpio. Confírmalo; si el único error es en `AdminPanel.tsx`, continúa.

- [ ] **Step 4: Commit**

```bash
git add src/lib/authApi.ts
git commit -m "feat(frontend): cliente de invitaciones y AdminUser.lastLoginAt opcional"
```

---

## Task 9: Layout de admin con menú lateral + extraer `PermisosPage`

**Files:**
- Create: `src/pages/Archivo/AdminLayout.tsx`
- Create: `src/pages/Archivo/AdminLayout.module.css`
- Create: `src/pages/Archivo/PermisosPage.tsx`
- Create: `src/pages/Archivo/PermisosPage.module.css`
- Delete: `src/pages/Archivo/AdminPanel.tsx`
- Delete: `src/pages/Archivo/AdminPanel.module.css`
- Modify: `src/routes/AppRoutes.tsx`

**Interfaces:**
- Consumes: `useAuth` (`src/lib/useAuth.ts`); `APP_KEYS`, `fetchAdminUsers`, `setUserPermission`, `AdminUser`, `AppKey` (`src/lib/authApi.ts`, Task 8)
- Produces:
  - `export default function AdminLayout(): JSX.Element` — guarda de admin + menú lateral + `<Outlet/>`. Usado por `AppRoutes.tsx`.
  - `export default function PermisosPage(): JSX.Element` — la tabla de permisos, sin guarda propia (asume que el layout ya validó admin).

- [ ] **Step 1: Crear `src/pages/Archivo/AdminLayout.module.css`**

```css
.container {
  min-height: 100vh;
  background: #03010a;
  color: #0ff0fc;
  display: grid;
  grid-template-columns: 220px 1fr;
}

.sidebar {
  border-right: 1px solid rgba(15, 240, 252, 0.2);
  padding: 2rem 1rem;
}

.groupLabel {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #8b8fb3;
  margin: 0 0 0.5rem 0.5rem;
}

.item {
  display: block;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  color: #a7abc9;
  text-decoration: none;
  font-size: 0.9rem;
}

.item:hover {
  color: #0ff0fc;
}

.itemActive {
  background: rgba(15, 240, 252, 0.12);
  color: #0ff0fc;
}

.content {
  padding: 2.5rem 2rem;
}

.centered {
  min-height: 100vh;
  background: #03010a;
  color: #0ff0fc;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.button {
  margin-top: 1rem;
  padding: 0.6rem 1.2rem;
  background: transparent;
  border: 1px solid #0ff0fc;
  color: #0ff0fc;
  border-radius: 6px;
  cursor: pointer;
}

@media (max-width: 640px) {
  .container {
    grid-template-columns: 1fr;
  }
  .sidebar {
    border-right: none;
    border-bottom: 1px solid rgba(15, 240, 252, 0.2);
  }
}
```

- [ ] **Step 2: Crear `src/pages/Archivo/AdminLayout.tsx`**

```typescript
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import styles from './AdminLayout.module.css'

const NAV_GROUPS = [
  {
    label: 'Usuarios',
    items: [{ label: 'Permisos', to: 'permisos' }],
  },
]

function AdminLayout() {
  const { status, session } = useAuth()
  const navigate = useNavigate()

  if (status === 'loading') {
    return <div className={styles.centered} />
  }

  if (status === 'offline') {
    return (
      <div className={styles.centered}>
        <div>
          <h1>No se pudo conectar con el servidor</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </div>
    )
  }

  if (!session || !session.isAdmin) {
    return (
      <div className={styles.centered}>
        <div>
          <h1>Solo el penitente pasará</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <nav className={styles.sidebar}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className={styles.groupLabel}>{group.label}</p>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? `${styles.item} ${styles.itemActive}` : styles.item
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  )
}

export default AdminLayout
```

- [ ] **Step 3: Crear `src/pages/Archivo/PermisosPage.module.css`**

```css
.title {
  margin: 0 0 1.5rem;
  color: #0ff0fc;
}

.error {
  color: #ff6b81;
  margin-bottom: 1rem;
}

.loading {
  color: #8b8fb3;
}

.table {
  width: min(700px, 100%);
  border-collapse: collapse;
}

.table th,
.table td {
  padding: 0.6rem 0.9rem;
  text-align: center;
  border-bottom: 1px solid rgba(15, 240, 252, 0.2);
  color: #d7d9f0;
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

- [ ] **Step 4: Crear `src/pages/Archivo/PermisosPage.tsx`**

```typescript
import { useEffect, useState } from 'react'
import { APP_KEYS, fetchAdminUsers, setUserPermission, type AdminUser, type AppKey } from '../../lib/authApi'
import styles from './PermisosPage.module.css'

const APP_LABELS: Record<AppKey, string> = {
  jellyfin: 'Jellyfin',
  jellyseerr: 'Jellyseerr',
  cantina: 'La Cantina',
  aportaciones: 'Aportaciones',
}

function PermisosPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch(() => setError('No se pudo cargar la lista de usuarios'))
  }, [])

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
                  permissions: granted
                    ? [...u.permissions, appKey]
                    : u.permissions.filter((p) => p !== appKey),
                }
              : u,
          ) ?? null,
      )
    } catch {
      setError('No se pudo actualizar el permiso')
    }
  }

  return (
    <section>
      <h1 className={styles.title}>Permisos</h1>
      {error && <p className={styles.error}>{error}</p>}
      {!users ? (
        <p className={styles.loading}>Cargando…</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Último acceso</th>
              {APP_KEYS.map((key) => (
                <th key={key}>{APP_LABELS[key]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username}>
                <td>{user.username}</td>
                <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('es-ES') : '—'}</td>
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
    </section>
  )
}

export default PermisosPage
```

- [ ] **Step 5: Reescribir `src/routes/AppRoutes.tsx`**

```typescript
import { Routes, Route, Navigate } from 'react-router-dom'
import Home from '../pages/Home/Home'
import Archivo from '../pages/Archivo/Archivo'
import Placeholder from '../pages/Archivo/Placeholder'
import AdminLayout from '../pages/Archivo/AdminLayout'
import PermisosPage from '../pages/Archivo/PermisosPage'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/archivo" element={<Archivo />} />
      <Route path="/archivo/cantina" element={<Placeholder title="La Cantina" need="cantina" />} />
      <Route path="/archivo/aportaciones" element={<Placeholder title="Aportaciones" need="aportaciones" />} />
      <Route path="/archivo/admin" element={<AdminLayout />}>
        <Route index element={<Navigate to="permisos" replace />} />
        <Route path="permisos" element={<PermisosPage />} />
      </Route>
    </Routes>
  )
}

export default AppRoutes
```

- [ ] **Step 6: Borrar el panel antiguo**

Run: `git rm src/pages/Archivo/AdminPanel.tsx src/pages/Archivo/AdminPanel.module.css`

- [ ] **Step 7: Verificar que compila y construye**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores. (Si `tsc` se queja de imports sin usar de `AdminPanel`, asegúrate de que nada más lo importa: `grep -rn AdminPanel src/`.)

- [ ] **Step 8: Commit**

```bash
git add src/pages/Archivo/AdminLayout.tsx src/pages/Archivo/AdminLayout.module.css src/pages/Archivo/PermisosPage.tsx src/pages/Archivo/PermisosPage.module.css src/routes/AppRoutes.tsx
git rm src/pages/Archivo/AdminPanel.tsx src/pages/Archivo/AdminPanel.module.css
git commit -m "feat(frontend): menú lateral de Configuración con la categoría Usuarios → Permisos"
```

---

## Task 10: Página de Invitaciones en el panel de admin

**Files:**
- Create: `src/pages/Archivo/InvitacionesPage.tsx`
- Create: `src/pages/Archivo/InvitacionesPage.module.css`
- Modify: `src/pages/Archivo/AdminLayout.tsx`
- Modify: `src/routes/AppRoutes.tsx`

**Interfaces:**
- Consumes: `generateInvite`, `fetchInvites`, `revokeInvite`, `InviteSummary` (`src/lib/authApi.ts`, Task 8)
- Produces: `export default function InvitacionesPage(): JSX.Element` — usado por `AppRoutes.tsx` bajo `/archivo/admin/invitaciones`.

- [ ] **Step 1: Crear `src/pages/Archivo/InvitacionesPage.module.css`**

```css
.title {
  margin: 0 0 1.5rem;
  color: #0ff0fc;
}

.generate {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 2rem;
  flex-wrap: wrap;
}

.input {
  background: #12102a;
  border: 1px solid #2c2a4a;
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  color: #f0f2ff;
  font-size: 0.9rem;
  min-width: 220px;
}

.button {
  padding: 0.5rem 1rem;
  border: none;
  border-radius: 6px;
  background: linear-gradient(135deg, #0ff0fc, #7b2ff7);
  color: #03010a;
  font-weight: 700;
  cursor: pointer;
}

.button:disabled {
  opacity: 0.6;
  cursor: default;
}

.error {
  color: #ff6b81;
  margin-bottom: 1rem;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.row {
  border: 1px solid rgba(15, 240, 252, 0.2);
  border-radius: 8px;
  padding: 0.9rem 1rem;
}

.rowTop {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: baseline;
}

.status {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #8b8fb3;
}

.statusValid {
  color: #0ff0fc;
}

.url {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.6rem;
  align-items: center;
}

.urlText {
  font-family: monospace;
  font-size: 0.8rem;
  color: #a7abc9;
  word-break: break-all;
  flex: 1;
}

.linkButton {
  background: none;
  border: 1px solid rgba(15, 240, 252, 0.4);
  color: #0ff0fc;
  border-radius: 4px;
  padding: 0.2rem 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
  white-space: nowrap;
}

.meta {
  font-size: 0.78rem;
  color: #6f7391;
  margin-top: 0.5rem;
}
```

- [ ] **Step 2: Crear `src/pages/Archivo/InvitacionesPage.tsx`**

```typescript
import { useEffect, useState } from 'react'
import { fetchInvites, generateInvite, revokeInvite, type InviteSummary } from '../../lib/authApi'
import styles from './InvitacionesPage.module.css'

const STATUS_LABEL: Record<InviteSummary['status'], string> = {
  valid: 'Pendiente',
  used: 'Usada',
  expired: 'Caducada',
  revoked: 'Revocada',
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/invitacion/${token}`
}

function InvitacionesPage() {
  const [invites, setInvites] = useState<InviteSummary[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    fetchInvites()
      .then(setInvites)
      .catch(() => setError('No se pudo cargar la lista de invitaciones'))
  }, [])

  const handleGenerate = async () => {
    setBusy(true)
    setError(null)
    try {
      const invite = await generateInvite(label.trim() || undefined)
      setInvites((prev) => [invite, ...(prev ?? [])])
      setLabel('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar la invitación')
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (token: string) => {
    setError(null)
    try {
      await revokeInvite(token)
      setInvites(
        (prev) => prev?.map((i) => (i.token === token ? { ...i, status: 'revoked' } : i)) ?? null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo revocar la invitación')
    }
  }

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(inviteUrl(token))
    setCopied(token)
    setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000)
  }

  return (
    <section>
      <h1 className={styles.title}>Invitaciones</h1>

      <div className={styles.generate}>
        <input
          className={styles.input}
          type="text"
          placeholder="Nota (opcional): para quién es"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className={styles.button} onClick={handleGenerate} disabled={busy}>
          {busy ? 'Generando…' : 'Generar invitación'}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {!invites ? (
        <p className={styles.status}>Cargando…</p>
      ) : invites.length === 0 ? (
        <p className={styles.status}>Todavía no hay invitaciones.</p>
      ) : (
        <div className={styles.list}>
          {invites.map((invite) => (
            <div key={invite.token} className={styles.row}>
              <div className={styles.rowTop}>
                <strong>{invite.label ?? 'Sin nota'}</strong>
                <span
                  className={
                    invite.status === 'valid' ? `${styles.status} ${styles.statusValid}` : styles.status
                  }
                >
                  {STATUS_LABEL[invite.status]}
                </span>
              </div>

              {invite.status === 'valid' && (
                <div className={styles.url}>
                  <span className={styles.urlText}>{inviteUrl(invite.token)}</span>
                  <button className={styles.linkButton} onClick={() => handleCopy(invite.token)}>
                    {copied === invite.token ? 'Copiado' : 'Copiar'}
                  </button>
                  <button className={styles.linkButton} onClick={() => handleRevoke(invite.token)}>
                    Revocar
                  </button>
                </div>
              )}

              <p className={styles.meta}>
                Creada el {new Date(invite.createdAt).toLocaleString('es-ES')} · caduca el{' '}
                {new Date(invite.expiresAt).toLocaleDateString('es-ES')}
                {invite.usedByUsername ? ` · usada por ${invite.usedByUsername}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default InvitacionesPage
```

- [ ] **Step 3: Añadir el ítem al menú en `src/pages/Archivo/AdminLayout.tsx`**

Cambia `NAV_GROUPS`:

```typescript
const NAV_GROUPS = [
  {
    label: 'Usuarios',
    items: [
      { label: 'Permisos', to: 'permisos' },
      { label: 'Invitaciones', to: 'invitaciones' },
    ],
  },
]
```

- [ ] **Step 4: Añadir la ruta en `src/routes/AppRoutes.tsx`**

Añade el import:

```typescript
import InvitacionesPage from '../pages/Archivo/InvitacionesPage'
```

Y dentro de `<Route path="/archivo/admin" element={<AdminLayout />}>`, tras la ruta `permisos`:

```typescript
        <Route path="invitaciones" element={<InvitacionesPage />} />
```

- [ ] **Step 5: Verificar que compila y construye**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Archivo/InvitacionesPage.tsx src/pages/Archivo/InvitacionesPage.module.css src/pages/Archivo/AdminLayout.tsx src/routes/AppRoutes.tsx
git commit -m "feat(frontend): página de invitaciones en Configuración → Usuarios"
```

---

## Task 11: Página pública `/invitacion/:token`

**Files:**
- Create: `src/pages/Invitacion/Invitacion.tsx`
- Create: `src/pages/Invitacion/Invitacion.module.css`
- Modify: `src/routes/AppRoutes.tsx`

**Interfaces:**
- Consumes: `fetchInviteStatus`, `consumeInvite`, `InviteGoneError`, `InviteStatus` (`src/lib/authApi.ts`, Task 8); `useParams` (react-router-dom)
- Produces: `export default function Invitacion(): JSX.Element` — ruta `/invitacion/:token`, sin guarda.

- [ ] **Step 1: Crear `src/pages/Invitacion/Invitacion.module.css`**

```css
.container {
  min-height: 100vh;
  background: #03010a;
  color: #0ff0fc;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.card {
  width: min(380px, 92vw);
  background: #0a0518;
  border: 1px solid rgba(15, 240, 252, 0.35);
  border-radius: 12px;
  padding: 2rem 1.75rem;
  box-shadow: 0 0 40px rgba(15, 240, 252, 0.15), 0 20px 60px rgba(0, 0, 0, 0.6);
}

.title {
  margin: 0 0 0.35rem;
  font-size: 1.15rem;
  letter-spacing: 0.06em;
  text-align: center;
  text-shadow: 0 0 10px rgba(15, 240, 252, 0.6);
}

.subtitle {
  margin: 0 0 1.5rem;
  font-size: 0.85rem;
  color: #8b8fb3;
  text-align: center;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin-bottom: 1.1rem;
}

.label {
  font-size: 0.8rem;
  color: #a7abc9;
}

.input {
  background: #12102a;
  border: 1px solid #2c2a4a;
  border-radius: 6px;
  padding: 0.6rem 0.75rem;
  font-size: 0.95rem;
  color: #f0f2ff;
  outline: none;
}

.input:focus {
  border-color: #0ff0fc;
  box-shadow: 0 0 0 3px rgba(15, 240, 252, 0.15);
}

.error {
  margin: -0.4rem 0 1rem;
  font-size: 0.82rem;
  color: #ff6b81;
  text-align: center;
}

.submit {
  width: 100%;
  margin-top: 0.5rem;
  padding: 0.65rem;
  border: none;
  border-radius: 6px;
  background: linear-gradient(135deg, #0ff0fc, #7b2ff7);
  color: #03010a;
  font-weight: 700;
  cursor: pointer;
}

.submit:disabled {
  opacity: 0.6;
  cursor: default;
}

.links {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 1.25rem;
}

.link {
  display: block;
  text-align: center;
  padding: 0.6rem;
  border: 1px solid rgba(15, 240, 252, 0.4);
  border-radius: 6px;
  color: #0ff0fc;
  text-decoration: none;
}

.link:hover {
  border-color: #0ff0fc;
  box-shadow: 0 0 16px rgba(15, 240, 252, 0.35);
}
```

- [ ] **Step 2: Crear `src/pages/Invitacion/Invitacion.tsx`**

```typescript
import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  consumeInvite,
  fetchInviteStatus,
  InviteGoneError,
  type InviteStatus,
} from '../../lib/authApi'
import styles from './Invitacion.module.css'

type View = 'loading' | 'form' | 'done' | 'gone' | 'used' | 'expired' | 'revoked' | 'error'

const INVALID_MESSAGE: Record<'used' | 'expired' | 'revoked' | 'gone', string> = {
  used: 'Esta invitación ya se ha usado.',
  expired: 'Esta invitación ha caducado. Pide una nueva.',
  revoked: 'Esta invitación no es válida.',
  gone: 'Esta invitación ya no es válida.',
}

function statusToView(status: InviteStatus): View {
  if (status === 'valid') return 'form'
  if (status === 'used') return 'used'
  if (status === 'expired') return 'expired'
  return 'revoked' // revoked + not_found → mismo texto
}

function Invitacion() {
  const { token = '' } = useParams()
  const [view, setView] = useState<View>('loading')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchInviteStatus(token)
      .then((status) => setView(statusToView(status)))
      .catch(() => setView('error'))
  }, [token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await consumeInvite(token, username, password)
      setView('done')
    } catch (err) {
      if (err instanceof InviteGoneError) {
        setView('gone')
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (view === 'loading') {
    return <div className={styles.container} />
  }

  if (view === 'error') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>Algo ha ido mal</h1>
          <p className={styles.subtitle}>No se pudo comprobar la invitación. Recarga la página.</p>
        </div>
      </div>
    )
  }

  if (view === 'used' || view === 'expired' || view === 'revoked' || view === 'gone') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>Invitación no disponible</h1>
          <p className={styles.subtitle}>{INVALID_MESSAGE[view]}</p>
        </div>
      </div>
    )
  }

  if (view === 'done') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>¡Cuenta creada!</h1>
          <p className={styles.subtitle}>
            Ya puedes entrar con tu usuario y contraseña en:
          </p>
          <div className={styles.links}>
            <a className={styles.link} href="https://teatro.archivo-oasis.com">
              Teatro (Jellyfin)
            </a>
            <a className={styles.link} href="https://peticiones.archivo-oasis.com">
              Peticiones (Jellyseerr)
            </a>
            <a className={styles.link} href="/archivo">
              El archivo
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title}>Crea tu cuenta</h1>
        <p className={styles.subtitle}>Elige un usuario y una contraseña para el archivo.</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="inv-username">
            Usuario
          </label>
          <input
            id="inv-username"
            className={styles.input}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="inv-password">
            Contraseña (mínimo 6 caracteres)
          </label>
          <input
            id="inv-password"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>
    </div>
  )
}

export default Invitacion
```

- [ ] **Step 3: Añadir la ruta pública en `src/routes/AppRoutes.tsx`**

Añade el import:

```typescript
import Invitacion from '../pages/Invitacion/Invitacion'
```

Y una ruta suelta (fuera del árbol de `/archivo`):

```typescript
      <Route path="/invitacion/:token" element={<Invitacion />} />
```

- [ ] **Step 4: Verificar que compila y construye**

Run: `npx tsc --noEmit && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Invitacion/Invitacion.tsx src/pages/Invitacion/Invitacion.module.css src/routes/AppRoutes.tsx
git commit -m "feat(frontend): página pública de registro por invitación"
```

---

## Task 12: Verificación manual end-to-end

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: confirmación de que el flujo completo funciona con el backend real y Jellyfin real.

- [ ] **Step 1: Recrear la BD de desarrollo (el esquema de `users` cambió)**

Run: `rm -f server/data/archivo-oasis.db server/data/archivo-oasis.db-wal server/data/archivo-oasis.db-shm`
La BD se recreará vacía con el esquema nuevo al arrancar el backend.

- [ ] **Step 2: Rellenar `JELLYFIN_API_KEY` en `server/.env`**

Edita `server/.env` y pon la API key de admin de Jellyfin en la línea `JELLYFIN_API_KEY=`.
(El fichero ya existe y está en `.gitignore`; ver `server/.env.example`.)

- [ ] **Step 3: Arrancar el backend**

En un Node ≥ 20 (o con el shim `better-sqlite3@11` bajo Node 18):

```bash
cd server
set -a && . ./.env && set +a
DATA_DIR="$PWD/data" PORT=3001 npx tsx watch src/index.ts
```

Espera: `archivo-oasis-api listening on port 3001` y **sin** el aviso de `JELLYFIN_API_KEY no definida`.

- [ ] **Step 4: Arrancar el frontend**

```bash
npm run dev
```

El proxy de Vite (`/api` → `localhost:3001`, ya en `vite.config.ts`) enruta las llamadas.

- [ ] **Step 5: Panel de permisos**

Inicia sesión como `jbaezami` (admin), ve a `/archivo/admin`. Espera:
- Redirige a `/archivo/admin/permisos`.
- Menú lateral con el grupo **Usuarios** → **Permisos**, **Invitaciones**.
- La tabla de permisos funciona igual que antes; la columna "Último acceso" muestra fecha para ti.

- [ ] **Step 6: Generar una invitación**

En **Invitaciones**: escribe la nota "prueba", pulsa "Generar invitación". Espera:
- Aparece una fila nueva arriba, estado **Pendiente**, con la URL `http://localhost:5173/invitacion/<token>` y botones "Copiar" y "Revocar".

- [ ] **Step 7: Consumir la invitación (credenciales inválidas primero)**

Abre la URL en una ventana de incógnito. Espera el formulario. Prueba:
- Contraseña de 3 caracteres → error inline "La contraseña debe tener al menos 6 caracteres", no avanza.
- Usuario con espacio → error inline, no avanza.

- [ ] **Step 8: Consumir la invitación (credenciales válidas)**

Usuario `prueba-invitacion`, contraseña `secret123`, "Crear cuenta". Espera:
- Pantalla "¡Cuenta creada!" con enlaces a Teatro, Peticiones y El archivo.

- [ ] **Step 9: Comprobar el acceso real**

- Inicia sesión en `https://teatro.archivo-oasis.com` con `prueba-invitacion` / `secret123` → entra, ve las bibliotecas.
- Inicia sesión en `https://peticiones.archivo-oasis.com` con las mismas credenciales → entra.
- Inicia sesión en archivo-oasis (`/`) con las mismas credenciales → `/archivo` muestra directamente los cuadros **Jellyfin** y **Jellyseerr** (no "pendiente de aprobación").

- [ ] **Step 10: Token de un solo uso y revocación**

- Recarga la URL de la invitación ya usada → "Esta invitación ya se ha usado."
- Genera otra, púlsale "Revocar", abre su URL → "Esta invitación no es válida."

- [ ] **Step 11: Panel de permisos tras el alta**

Vuelve a `/archivo/admin/permisos` como admin. Espera:
- `prueba-invitacion` aparece en la tabla con `jellyfin` y `jellyseerr` marcados.
- "Último acceso" muestra fecha (tras el paso 9) o "—" si aún no ha entrado a archivo-oasis.

- [ ] **Step 12: Limpieza**

Borra el usuario de prueba en Jellyfin (Panel → Usuarios) si no lo quieres conservar. La fila en `server/data/archivo-oasis.db` es de desarrollo y no importa.

- [ ] **Step 13: Suite completa del backend en verde**

Run: `cd server && npm test`
Expected: todos los tests pasan (los ~22 previos + los nuevos de `invites.test.ts`, `jellyfinAdmin.test.ts`, `models.test.ts`, `admin.test.ts`).
Si estás en Node 18 con el shim de `better-sqlite3@11`, restaura después: `git checkout package-lock.json && npm ci`.

---

## Self-Review

**Cobertura de la spec:**

| Requisito de la spec | Tarea |
|---|---|
| Tabla `invites` con estados derivados | Task 1 |
| `users.last_login_at` nullable + `createInvitedUser` | Task 1 (schema), Task 2 (modelo) |
| Cliente admin de Jellyfin con API key, `EnableAllFolders` por defecto | Task 3 |
| `JELLYFIN_API_KEY` env var; 503 si falta | Task 4 (wiring), Task 6 (503) |
| Carga de `server/.env` en desarrollo | Task 4 |
| `POST/GET/DELETE /api/admin/invites` (requireAdmin) | Task 5 |
| `GET /api/invites/:token` (estados, `not_found` = `revoked`) | Task 6 |
| `POST /api/invites/:token` (flujo, orden Jellyfin→BD, transacción, 400/409/410/502/503) | Task 6 |
| Pre-crear usuario archivo-oasis con `jellyfin` + `jellyseerr` | Task 6 |
| `docker-compose.yml` con `JELLYFIN_API_KEY` | Task 7 |
| Cliente de invitaciones en frontend + `AdminUser.lastLoginAt` nullable | Task 8 |
| Menú lateral de categorías; extraer `PermisosPage`; borrar `AdminPanel` | Task 9 |
| Rutas hijas `/archivo/admin/{permisos,invitaciones}` con índice redirigido | Task 9, Task 10 |
| `InvitacionesPage`: generar, listar, copiar URL, revocar | Task 10 |
| Página pública `/invitacion/:token`: formulario, estados, pantalla de éxito con 3 enlaces | Task 11 |
| Errores frontend: 409 reintentable inline, 410 sustituye el formulario | Task 11 (`InviteGoneError`) |
| `nginx.conf` y `deploy.yml` sin cambios | (confirmado en el resumen de ficheros) |
| Verificación manual E2E | Task 12 |

**Escaneo de placeholders:** sin "TBD"/"TODO"/"añadir manejo de errores" — todos los pasos de código llevan el código real.

**Consistencia de tipos:**
- `InviteRecord` / `InviteStatus` definidos en Task 1, consumidos con los mismos nombres en Tasks 5 y 6.
- `InviteSummary` (forma JSON) definido igual en Task 5 (backend `toInviteSummary`) y Task 8 (frontend `interface InviteSummary`): `token, label, createdBy, createdAt, expiresAt, status, usedAt, usedByUsername`.
- `JellyfinAdminClient.createUser(username, password)` definido en Task 3, stub/consumo idénticos en Task 6.
- `AppConfig.jellyfinAdmin: JellyfinAdminClient | null` — añadido en Task 4, consumido en Task 6 `createInvitesRouter(config.db, config.jellyfinAdmin)`.
- `createInvitedUser(db, username): UserRecord` — Task 2, consumido en Task 6.
- `UserRecord.lastLoginAt: string | null` — Task 2, reflejado en `AdminUser.lastLoginAt` Task 8 y renderizado con guardia `? ... : '—'` en Task 9.
- `InviteGoneError` — Task 8, consumido en Task 11.
- react-router `Navigate`, `Outlet`, `NavLink`, `useParams` — API de `react-router-dom@6.26`, disponible.
