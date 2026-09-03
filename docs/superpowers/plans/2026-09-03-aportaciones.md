# Sección Aportaciones (envío de torrents a qBittorrent) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que los usuarios con permiso `aportaciones` propongan contenido (descripción + `.torrent` por URL o fichero + categoría), y que un administrador revise la cola en `/archivo/aportaciones` y, al aceptar, envíe el torrent a qBittorrent con esa categoría.

**Architecture:** Tabla `submissions` en SQLite + ficheros `.torrent` en `DATA_DIR/aportaciones/<id>.torrent`. Cliente `qbittorrent.ts` (login usuario/contraseña, cookie SID cacheada), inyectado en `AppConfig` como `qbittorrent: QbittorrentClient | null`. Rutas de usuario en `/api/aportaciones` (`requireAuth` + `requirePermission('aportaciones')`) y de admin en `/api/admin/aportaciones` (`requireAdmin`). El frontend sustituye el `Placeholder` de `/archivo/aportaciones` por `AportacionesPage`, con parte de usuario (si tiene el permiso) y parte de moderación (si `isAdmin`).

**Tech Stack:** Backend Node.js ≥20, TypeScript, Express 4, better-sqlite3, `node:test`, `fetch`/`FormData`/`Blob` globales — **sin dependencias npm nuevas**. Frontend React 18 + react-router-dom 6 + CSS Modules — **sin dependencias npm nuevas**.

**Spec:** `docs/superpowers/specs/2026-09-03-aportaciones-design.md`

## Global Constraints

- **Runtime del backend: Node.js ≥ 20** (`better-sqlite3@13` hace segfault en Node 18). Para correr los tests en local con Node 18: `cd server && npm_config_python=/usr/bin/python3.12 npm install --no-save better-sqlite3@11.10.0`, luego `npm test`, y al terminar `git checkout package-lock.json && npm_config_python=/usr/bin/python3.12 npm ci`. Nunca commitear un cambio en `server/package.json` o `server/package-lock.json`. Un `SIGSEGV` en `npm test` = el shim no está activo; reinstalarlo. Memoria: `server-node-version`.
- **Sin dependencias npm nuevas** (backend ni frontend). El fichero `.torrent` viaja en base64 dentro del JSON; el `FormData`/`Blob` hacia qBittorrent es nativo de Node ≥18.
- Tests del backend: `npm test` en `server/` (`tsx --test src/*.test.ts src/routes/*.test.ts`).
- El frontend no tiene tests unitarios; cada tarea de frontend termina con `npx tsc --noEmit` y `npm run build` en verde desde la raíz del repo.
- Categorías: conjunto fijo `movies` / `tv` / `music`.
- Estados: `pendiente` / `procesada` / `rechazada`. Un fallo de qBittorrent al aceptar **no** cambia el estado.
- El admin se identifica comparando el usuario de la sesión (case-insensitive) con `ADMIN_JELLYFIN_USERNAME`.
- Todo el texto visible para el usuario va en español.
- Estética del frontend: neón cian (`#0ff0fc`) sobre `#03010a`, CSS Modules, misma línea que `InvitacionesPage.module.css` / `PermisosPage.module.css`.
- `express.json()` global sube su límite a `5mb`.
- Si falta `QBITTORRENT_URL` / `QBITTORRENT_USER` / `QBITTORRENT_PASSWORD`, el backend arranca igual y `POST /api/admin/aportaciones/:id/aceptar` responde `503`.

---

## Resumen de ficheros

**Backend (`server/src/`):**
```
db.ts                       # MODIFICAR: CREATE TABLE submissions
middleware.ts               # MODIFICAR: requirePermission(db, appKey)
middleware.test.ts          # NUEVO
submissions.ts              # NUEVO: modelo de la tabla submissions
submissions.test.ts         # NUEVO
submissionFiles.ts          # NUEVO: helpers de disco para los .torrent
submissionFiles.test.ts     # NUEVO
qbittorrent.ts              # NUEVO: cliente de qBittorrent
qbittorrent.test.ts         # NUEVO
app.ts                      # MODIFICAR: AppConfig gana qbittorrent + dataDir; monta rutas
index.ts                    # MODIFICAR: lee QBITTORRENT_*; construye el cliente o null
routes/aportaciones.ts      # NUEVO: rutas de usuario
routes/aportaciones.test.ts # NUEVO
routes/admin.ts             # MODIFICAR: 3 endpoints de moderación
routes/admin.test.ts        # MODIFICAR: helper + tests de moderación
routes/auth.test.ts         # MODIFICAR: helper createApp con los campos nuevos
```

**Frontend (`src/`):**
```
lib/authApi.ts                        # MODIFICAR: tipos + funciones de aportaciones
pages/Archivo/AportacionesPage.tsx    # NUEVO
pages/Archivo/AportacionesPage.module.css  # NUEVO
routes/AppRoutes.tsx                  # MODIFICAR: /archivo/aportaciones -> AportacionesPage
```

**Infra:**
```
docker-compose.yml     # MODIFICAR: QBITTORRENT_URL/USER/PASSWORD
.env.example           # MODIFICAR
server/.env.example    # MODIFICAR
README.md              # MODIFICAR
docker/nginx.conf      # MODIFICAR: client_max_body_size 6m en /api/
```

---

## Task 1: Tabla `submissions` + modelo `submissions.ts`

**Files:**
- Modify: `server/src/db.ts`
- Create: `server/src/submissions.ts`
- Test: `server/src/submissions.test.ts`

**Interfaces:**
- Consumes: `DB` (`db.ts`)
- Produces:
  - `export type SubmissionCategory = 'movies' | 'tv' | 'music'` (`submissions.ts`)
  - `export type SubmissionStatus = 'pendiente' | 'procesada' | 'rechazada'`
  - `export type SubmissionSourceType = 'url' | 'file'`
  - `export interface SubmissionRecord { id: number; userId: number; description: string; category: SubmissionCategory; sourceType: SubmissionSourceType; sourceUrl: string | null; fileName: string | null; status: SubmissionStatus; rejectionReason: string | null; createdAt: string; processedAt: string | null; processedBy: string | null }`
  - `export function createSubmission(db: DB, input: { userId: number; description: string; category: SubmissionCategory; sourceType: SubmissionSourceType; sourceUrl?: string | null; fileName?: string | null }): SubmissionRecord`
  - `export function getSubmission(db: DB, id: number): SubmissionRecord | undefined`
  - `export function listByUser(db: DB, userId: number): SubmissionRecord[]` — `created_at` desc
  - `export function listAll(db: DB, status?: SubmissionStatus): (SubmissionRecord & { username: string })[]` — `created_at` desc
  - `export function deleteSubmission(db: DB, id: number, userId: number): 'deleted' | 'not_found' | 'forbidden' | 'not_pending'`
  - `export function setStatus(db: DB, id: number, status: 'procesada' | 'rechazada', opts: { processedBy: string; rejectionReason?: string | null }): SubmissionRecord`

- [ ] **Step 1: Añadir la tabla a `server/src/db.ts`**

Dentro del `db.exec(\`...\`)`, tras la tabla `invites`, añade:

```sql
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      description TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('movies','tv','music')),
      source_type TEXT NOT NULL CHECK (source_type IN ('url','file')),
      source_url TEXT,
      file_name TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente'
        CHECK (status IN ('pendiente','procesada','rechazada')),
      rejection_reason TEXT,
      created_at TEXT NOT NULL,
      processed_at TEXT,
      processed_by TEXT
    );
```

- [ ] **Step 2: Escribir el test `server/src/submissions.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from './db'
import { upsertUserLogin } from './models'
import {
  createSubmission,
  getSubmission,
  listByUser,
  listAll,
  deleteSubmission,
  setStatus,
} from './submissions'

function seed() {
  const db = createDb(':memory:')
  const alice = upsertUserLogin(db, 'alice')
  const bob = upsertUserLogin(db, 'bob')
  return { db, alice, bob }
}

test('createSubmission inserta en estado pendiente', () => {
  const { db, alice } = seed()
  const s = createSubmission(db, {
    userId: alice.id,
    description: 'Una peli',
    category: 'movies',
    sourceType: 'url',
    sourceUrl: 'magnet:?xt=urn:btih:abc',
  })
  assert.equal(s.status, 'pendiente')
  assert.equal(s.userId, alice.id)
  assert.equal(s.sourceUrl, 'magnet:?xt=urn:btih:abc')
  assert.equal(s.fileName, null)
  assert.equal(s.processedAt, null)
  assert.deepEqual(getSubmission(db, s.id), s)
})

test('createSubmission con fichero guarda fileName y sourceUrl null', () => {
  const { db, alice } = seed()
  const s = createSubmission(db, {
    userId: alice.id,
    description: 'Serie',
    category: 'tv',
    sourceType: 'file',
    fileName: 'algo.torrent',
  })
  assert.equal(s.sourceType, 'file')
  assert.equal(s.fileName, 'algo.torrent')
  assert.equal(s.sourceUrl, null)
})

test('listByUser devuelve solo las del usuario, recientes primero', async () => {
  const { db, alice, bob } = seed()
  const first = createSubmission(db, { userId: alice.id, description: 'a', category: 'music', sourceType: 'url', sourceUrl: 'http://x' })
  await new Promise((r) => setTimeout(r, 5))
  const second = createSubmission(db, { userId: alice.id, description: 'b', category: 'music', sourceType: 'url', sourceUrl: 'http://y' })
  createSubmission(db, { userId: bob.id, description: 'c', category: 'music', sourceType: 'url', sourceUrl: 'http://z' })

  const mine = listByUser(db, alice.id)
  assert.equal(mine.length, 2)
  assert.equal(mine[0].id, second.id)
  assert.equal(mine[1].id, first.id)
})

test('listAll incluye el username y filtra por estado', () => {
  const { db, alice, bob } = seed()
  const a = createSubmission(db, { userId: alice.id, description: 'a', category: 'movies', sourceType: 'url', sourceUrl: 'http://x' })
  createSubmission(db, { userId: bob.id, description: 'b', category: 'tv', sourceType: 'url', sourceUrl: 'http://y' })
  setStatus(db, a.id, 'procesada', { processedBy: 'admin-user' })

  const all = listAll(db)
  assert.equal(all.length, 2)
  assert.ok(all.every((s) => typeof s.username === 'string'))

  const pendientes = listAll(db, 'pendiente')
  assert.equal(pendientes.length, 1)
  assert.equal(pendientes[0].username, 'bob')
})

test('deleteSubmission distingue not_found / forbidden / not_pending / deleted', () => {
  const { db, alice, bob } = seed()
  assert.equal(deleteSubmission(db, 999, alice.id), 'not_found')

  const s = createSubmission(db, { userId: alice.id, description: 'a', category: 'music', sourceType: 'url', sourceUrl: 'http://x' })
  assert.equal(deleteSubmission(db, s.id, bob.id), 'forbidden')

  const processed = createSubmission(db, { userId: alice.id, description: 'b', category: 'music', sourceType: 'url', sourceUrl: 'http://y' })
  setStatus(db, processed.id, 'rechazada', { processedBy: 'admin-user' })
  assert.equal(deleteSubmission(db, processed.id, alice.id), 'not_pending')

  assert.equal(deleteSubmission(db, s.id, alice.id), 'deleted')
  assert.equal(getSubmission(db, s.id), undefined)
})

test('setStatus marca procesada/rechazada con processed_by y motivo', () => {
  const { db, alice } = seed()
  const s = createSubmission(db, { userId: alice.id, description: 'a', category: 'movies', sourceType: 'url', sourceUrl: 'http://x' })

  const rejected = setStatus(db, s.id, 'rechazada', { processedBy: 'admin-user', rejectionReason: 'nope' })
  assert.equal(rejected.status, 'rechazada')
  assert.equal(rejected.rejectionReason, 'nope')
  assert.equal(rejected.processedBy, 'admin-user')
  assert.ok(rejected.processedAt)

  const s2 = createSubmission(db, { userId: alice.id, description: 'b', category: 'movies', sourceType: 'url', sourceUrl: 'http://y' })
  const processed = setStatus(db, s2.id, 'procesada', { processedBy: 'admin-user' })
  assert.equal(processed.status, 'procesada')
  assert.equal(processed.rejectionReason, null)
})
```

- [ ] **Step 3: Ejecutar y ver fallar**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './submissions'`.

- [ ] **Step 4: Escribir `server/src/submissions.ts`**

```typescript
import type { DB } from './db'

export type SubmissionCategory = 'movies' | 'tv' | 'music'
export type SubmissionStatus = 'pendiente' | 'procesada' | 'rechazada'
export type SubmissionSourceType = 'url' | 'file'

export const SUBMISSION_CATEGORIES: SubmissionCategory[] = ['movies', 'tv', 'music']

export interface SubmissionRecord {
  id: number
  userId: number
  description: string
  category: SubmissionCategory
  sourceType: SubmissionSourceType
  sourceUrl: string | null
  fileName: string | null
  status: SubmissionStatus
  rejectionReason: string | null
  createdAt: string
  processedAt: string | null
  processedBy: string | null
}

interface SubmissionRow {
  id: number
  user_id: number
  description: string
  category: SubmissionCategory
  source_type: SubmissionSourceType
  source_url: string | null
  file_name: string | null
  status: SubmissionStatus
  rejection_reason: string | null
  created_at: string
  processed_at: string | null
  processed_by: string | null
}

function toRecord(row: SubmissionRow): SubmissionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    description: row.description,
    category: row.category,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    fileName: row.file_name,
    status: row.status,
    rejectionReason: row.rejection_reason,
    createdAt: row.created_at,
    processedAt: row.processed_at,
    processedBy: row.processed_by,
  }
}

const COLS =
  'id, user_id, description, category, source_type, source_url, file_name, status, rejection_reason, created_at, processed_at, processed_by'

export function createSubmission(
  db: DB,
  input: {
    userId: number
    description: string
    category: SubmissionCategory
    sourceType: SubmissionSourceType
    sourceUrl?: string | null
    fileName?: string | null
  },
): SubmissionRecord {
  const now = new Date().toISOString()
  const result = db
    .prepare(
      `INSERT INTO submissions (user_id, description, category, source_type, source_url, file_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.userId,
      input.description,
      input.category,
      input.sourceType,
      input.sourceUrl ?? null,
      input.fileName ?? null,
      now,
    )
  return getSubmission(db, Number(result.lastInsertRowid))!
}

export function getSubmission(db: DB, id: number): SubmissionRecord | undefined {
  const row = db.prepare(`SELECT ${COLS} FROM submissions WHERE id = ?`).get(id) as SubmissionRow | undefined
  return row ? toRecord(row) : undefined
}

export function listByUser(db: DB, userId: number): SubmissionRecord[] {
  const rows = db
    .prepare(`SELECT ${COLS} FROM submissions WHERE user_id = ? ORDER BY created_at DESC, id DESC`)
    .all(userId) as SubmissionRow[]
  return rows.map(toRecord)
}

export function listAll(db: DB, status?: SubmissionStatus): (SubmissionRecord & { username: string })[] {
  const where = status ? 'WHERE s.status = ?' : ''
  const rows = db
    .prepare(
      `SELECT ${COLS.split(', ').map((c) => 's.' + c).join(', ')}, u.jellyfin_username AS username
       FROM submissions s JOIN users u ON u.id = s.user_id
       ${where}
       ORDER BY s.created_at DESC, s.id DESC`,
    )
    .all(...(status ? [status] : [])) as (SubmissionRow & { username: string })[]
  return rows.map((row) => ({ ...toRecord(row), username: row.username }))
}

export function deleteSubmission(
  db: DB,
  id: number,
  userId: number,
): 'deleted' | 'not_found' | 'forbidden' | 'not_pending' {
  const s = getSubmission(db, id)
  if (!s) return 'not_found'
  if (s.userId !== userId) return 'forbidden'
  if (s.status !== 'pendiente') return 'not_pending'
  db.prepare('DELETE FROM submissions WHERE id = ?').run(id)
  return 'deleted'
}

export function setStatus(
  db: DB,
  id: number,
  status: 'procesada' | 'rechazada',
  opts: { processedBy: string; rejectionReason?: string | null },
): SubmissionRecord {
  db.prepare(
    'UPDATE submissions SET status = ?, processed_at = ?, processed_by = ?, rejection_reason = ? WHERE id = ?',
  ).run(status, new Date().toISOString(), opts.processedBy, opts.rejectionReason ?? null, id)
  return getSubmission(db, id)!
}
```

- [ ] **Step 5: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 6 tests de `submissions.test.ts` pasan; la suite completa sigue en verde.

- [ ] **Step 6: Commit**

```bash
git add server/src/db.ts server/src/submissions.ts server/src/submissions.test.ts
git commit -m "feat(server): tabla y modelo de aportaciones (submissions)"
```

---

## Task 2: Helpers de disco `submissionFiles.ts`

**Files:**
- Create: `server/src/submissionFiles.ts`
- Test: `server/src/submissionFiles.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `export function submissionFilePath(dataDir: string, id: number): string`
  - `export function writeSubmissionFile(dataDir: string, id: number, bytes: Uint8Array): void` — crea `dataDir/aportaciones/` si no existe.
  - `export function readSubmissionFile(dataDir: string, id: number): Uint8Array` — lanza si no existe.
  - `export function deleteSubmissionFile(dataDir: string, id: number): void` — best-effort: no lanza si el fichero no existe; loguea con `console.error` cualquier otro error.

- [ ] **Step 1: Escribir el test `server/src/submissionFiles.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  submissionFilePath,
  writeSubmissionFile,
  readSubmissionFile,
  deleteSubmissionFile,
} from './submissionFiles'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aportaciones-test-'))
}

test('submissionFilePath es determinista y vive bajo aportaciones/', () => {
  const dir = tmpDir()
  assert.equal(submissionFilePath(dir, 42), path.join(dir, 'aportaciones', '42.torrent'))
})

test('writeSubmissionFile crea el directorio y escribe los bytes; readSubmissionFile los devuelve', () => {
  const dir = tmpDir()
  const bytes = new Uint8Array([1, 2, 3, 4])
  writeSubmissionFile(dir, 7, bytes)
  assert.deepEqual(new Uint8Array(readSubmissionFile(dir, 7)), bytes)
})

test('deleteSubmissionFile borra el fichero y no lanza si no existe', () => {
  const dir = tmpDir()
  writeSubmissionFile(dir, 9, new Uint8Array([0]))
  deleteSubmissionFile(dir, 9)
  assert.equal(fs.existsSync(submissionFilePath(dir, 9)), false)
  assert.doesNotThrow(() => deleteSubmissionFile(dir, 9))
})
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './submissionFiles'`.

- [ ] **Step 3: Escribir `server/src/submissionFiles.ts`**

```typescript
import fs from 'node:fs'
import path from 'node:path'

function dir(dataDir: string): string {
  return path.join(dataDir, 'aportaciones')
}

export function submissionFilePath(dataDir: string, id: number): string {
  return path.join(dir(dataDir), `${id}.torrent`)
}

export function writeSubmissionFile(dataDir: string, id: number, bytes: Uint8Array): void {
  fs.mkdirSync(dir(dataDir), { recursive: true })
  fs.writeFileSync(submissionFilePath(dataDir, id), bytes)
}

export function readSubmissionFile(dataDir: string, id: number): Uint8Array {
  return fs.readFileSync(submissionFilePath(dataDir, id))
}

export function deleteSubmissionFile(dataDir: string, id: number): void {
  try {
    fs.rmSync(submissionFilePath(dataDir, id), { force: true })
  } catch (err) {
    console.error('No se pudo borrar el fichero de la aportación', { id, err })
  }
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 3 tests de `submissionFiles.test.ts` pasan; la suite completa en verde.

- [ ] **Step 5: Commit**

```bash
git add server/src/submissionFiles.ts server/src/submissionFiles.test.ts
git commit -m "feat(server): helpers de disco para los .torrent de aportaciones"
```

---

## Task 3: Cliente de qBittorrent `qbittorrent.ts`

**Files:**
- Create: `server/src/qbittorrent.ts`
- Test: `server/src/qbittorrent.test.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `export class QbittorrentError extends Error {}`
  - `export interface QbittorrentClient { addTorrent(input: { url?: string; file?: Uint8Array; fileName?: string; category: string }): Promise<void> }`
  - `export function createQbittorrentClient(baseUrl: string, user: string, password: string): QbittorrentClient`

**Notas de la API de qBittorrent (referencia):**
- `POST {baseUrl}/api/v2/auth/login` — `Content-Type: application/x-www-form-urlencoded`, body `username=...&password=...`, cabecera `Referer: {baseUrl}`. Éxito: `200` cuerpo `Ok.` + `Set-Cookie: SID=...`. Credenciales malas: `200` cuerpo `Fails.`.
- `POST {baseUrl}/api/v2/torrents/add` — `FormData` con `category`, y `urls` (URL/magnet) **o** `torrents` (fichero). Cabeceras `Cookie: SID=...`, `Referer: {baseUrl}`. NO fijar `Content-Type` (lo pone `fetch`). Éxito: `200` cuerpo `Ok.`. Torrent inválido: `415`. SID caducado: `403`.

- [ ] **Step 1: Escribir el test `server/src/qbittorrent.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQbittorrentClient, QbittorrentError } from './qbittorrent'

interface Call {
  url: string
  method: string
  headers: Headers
  body: unknown
}

function stub(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const original = global.fetch
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    }
    calls.push(call)
    return handler(call, calls.length)
  }) as typeof fetch
  return { calls, restore: () => { global.fetch = original } }
}

function loginOk(): Response {
  return new Response('Ok.', { status: 200, headers: { 'set-cookie': 'SID=abc123; HttpOnly; path=/' } })
}

test('addTorrent hace login y envía la URL con la categoría', async () => {
  const { calls, restore } = stub((call) => {
    if (call.url.endsWith('/api/v2/auth/login')) return loginOk()
    if (call.url.endsWith('/api/v2/torrents/add')) return new Response('Ok.', { status: 200 })
    return new Response(null, { status: 500 })
  })
  try {
    await createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({
      url: 'magnet:?xt=urn:btih:abc',
      category: 'movies',
    })
    const login = calls.find((c) => c.url.endsWith('/auth/login'))!
    assert.equal(String(login.body), 'username=admin&password=secret')
    const add = calls.find((c) => c.url.endsWith('/torrents/add'))!
    assert.ok(add.body instanceof FormData)
    const form = add.body as FormData
    assert.equal(form.get('urls'), 'magnet:?xt=urn:btih:abc')
    assert.equal(form.get('category'), 'movies')
    assert.equal(add.headers.get('cookie'), 'SID=abc123')
  } finally {
    restore()
  }
})

test('addTorrent con fichero manda el campo torrents', async () => {
  const { calls, restore } = stub((call) => {
    if (call.url.endsWith('/auth/login')) return loginOk()
    return new Response('Ok.', { status: 200 })
  })
  try {
    await createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({
      file: new Uint8Array([1, 2, 3]),
      fileName: 'x.torrent',
      category: 'tv',
    })
    const add = calls.find((c) => c.url.endsWith('/torrents/add'))!
    const form = add.body as FormData
    assert.ok(form.get('torrents') instanceof Blob)
    assert.equal(form.get('category'), 'tv')
  } finally {
    restore()
  }
})

test('un 403 en add fuerza re-login y un reintento', async () => {
  const { calls, restore } = stub((call, n) => {
    if (call.url.endsWith('/auth/login')) return loginOk()
    if (n === 2) return new Response('Forbidden', { status: 403 }) // primer add
    return new Response('Ok.', { status: 200 }) // segundo add
  })
  try {
    await createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({
      url: 'http://x',
      category: 'music',
    })
    const logins = calls.filter((c) => c.url.endsWith('/auth/login'))
    const adds = calls.filter((c) => c.url.endsWith('/torrents/add'))
    assert.equal(logins.length, 2)
    assert.equal(adds.length, 2)
  } finally {
    restore()
  }
})

test('credenciales incorrectas -> QbittorrentError', async () => {
  const { restore } = stub((call) => {
    if (call.url.endsWith('/auth/login')) return new Response('Fails.', { status: 200 })
    return new Response(null, { status: 500 })
  })
  try {
    await assert.rejects(
      () => createQbittorrentClient('https://qb.example.com', 'admin', 'bad').addTorrent({ url: 'http://x', category: 'movies' }),
      (err: unknown) => err instanceof QbittorrentError,
    )
  } finally {
    restore()
  }
})

test('respuesta "Fails." en add -> QbittorrentError', async () => {
  const { restore } = stub((call) => {
    if (call.url.endsWith('/auth/login')) return loginOk()
    return new Response('Fails.', { status: 200 })
  })
  try {
    await assert.rejects(
      () => createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({ url: 'http://x', category: 'movies' }),
      (err: unknown) => err instanceof QbittorrentError,
    )
  } finally {
    restore()
  }
})

test('fallo de red -> QbittorrentError', async () => {
  const original = global.fetch
  global.fetch = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  try {
    await assert.rejects(
      () => createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({ url: 'http://x', category: 'movies' }),
      (err: unknown) => err instanceof QbittorrentError,
    )
  } finally {
    global.fetch = original
  }
})
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module './qbittorrent'`.

- [ ] **Step 3: Escribir `server/src/qbittorrent.ts`**

```typescript
export class QbittorrentError extends Error {}

export interface QbittorrentClient {
  addTorrent(input: { url?: string; file?: Uint8Array; fileName?: string; category: string }): Promise<void>
}

export function createQbittorrentClient(
  baseUrl: string,
  user: string,
  password: string,
): QbittorrentClient {
  let sid: string | null = null

  async function login(): Promise<void> {
    let response: Response
    try {
      response = await fetch(`${baseUrl}/api/v2/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: baseUrl,
        },
        body: `username=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}`,
      })
    } catch {
      throw new QbittorrentError('No se pudo contactar con qBittorrent')
    }
    const text = await response.text().catch(() => '')
    const cookie = response.headers.get('set-cookie') ?? ''
    const match = cookie.match(/SID=([^;]+)/)
    if (!response.ok || text.trim() !== 'Ok.' || !match) {
      throw new QbittorrentError('No se pudo autenticar con qBittorrent')
    }
    sid = match[1]
  }

  async function add(
    input: { url?: string; file?: Uint8Array; fileName?: string; category: string },
  ): Promise<Response> {
    const form = new FormData()
    form.set('category', input.category)
    if (input.url) {
      form.set('urls', input.url)
    } else if (input.file) {
      form.set(
        'torrents',
        new Blob([input.file], { type: 'application/x-bittorrent' }),
        input.fileName ?? 'aportacion.torrent',
      )
    }
    try {
      return await fetch(`${baseUrl}/api/v2/torrents/add`, {
        method: 'POST',
        headers: { Cookie: `SID=${sid}`, Referer: baseUrl },
        body: form,
      })
    } catch {
      throw new QbittorrentError('No se pudo contactar con qBittorrent')
    }
  }

  return {
    async addTorrent(input) {
      if (!input.url && !input.file) {
        throw new QbittorrentError('La aportación no tiene URL ni fichero')
      }
      if (!sid) await login()

      let response = await add(input)
      if (response.status === 403) {
        await login()
        response = await add(input)
      }

      const text = await response.text().catch(() => '')
      if (!response.ok || text.trim() !== 'Ok.') {
        const detail = text.trim() ? ` (${text.trim()})` : ` (HTTP ${response.status})`
        throw new QbittorrentError(`qBittorrent rechazó el torrent${detail}`)
      }
    },
  }
}
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 6 tests de `qbittorrent.test.ts` pasan; la suite completa en verde.

- [ ] **Step 5: Commit**

```bash
git add server/src/qbittorrent.ts server/src/qbittorrent.test.ts
git commit -m "feat(server): cliente de qBittorrent (login + añadir torrent)"
```

---

## Task 4: Middleware `requirePermission`

**Files:**
- Modify: `server/src/middleware.ts`
- Test: `server/src/middleware.test.ts`

**Interfaces:**
- Consumes: `DB`, `AppKey` (`db.ts`); `findUserByUsername`, `getPermissions` (`models.ts`)
- Produces: `export function requirePermission(db: DB, appKey: AppKey): RequestHandler` (`middleware.ts`) — `401` si no hay sesión; `403` si el usuario de la sesión no existe o no tiene el permiso; si no, `next()`.

- [ ] **Step 1: Escribir el test `server/src/middleware.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { createDb } from './db'
import { upsertUserLogin, setPermission } from './models'
import { createSessionMiddleware } from './session'
import { requireAuth, requirePermission } from './middleware'

function appWith(db: ReturnType<typeof createDb>) {
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware('test-secret'))
  // ruta de utilidad para abrir sesión en el test
  app.post('/login/:username', (req, res) => {
    req.session = { username: req.params.username }
    res.json({ ok: true })
  })
  app.get('/protegido', requireAuth, requirePermission(db, 'aportaciones'), (_req, res) => res.json({ ok: true }))
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function sessionCookie(baseUrl: string, username: string): Promise<string> {
  const r = await fetch(`${baseUrl}/login/${username}`, { method: 'POST' })
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

test('requirePermission: 401 sin sesión', async () => {
  const { server, baseUrl } = appWith(createDb(':memory:'))
  try {
    const r = await fetch(`${baseUrl}/protegido`)
    assert.equal(r.status, 401)
  } finally {
    server.close()
  }
})

test('requirePermission: 403 si el usuario no tiene el permiso', async () => {
  const db = createDb(':memory:')
  upsertUserLogin(db, 'alice')
  const { server, baseUrl } = appWith(db)
  try {
    const cookie = await sessionCookie(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/protegido`, { headers: { Cookie: cookie } })
    assert.equal(r.status, 403)
  } finally {
    server.close()
  }
})

test('requirePermission: pasa si el usuario tiene el permiso', async () => {
  const db = createDb(':memory:')
  const alice = upsertUserLogin(db, 'alice')
  setPermission(db, alice.id, 'aportaciones', true)
  const { server, baseUrl } = appWith(db)
  try {
    const cookie = await sessionCookie(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/protegido`, { headers: { Cookie: cookie } })
    assert.equal(r.status, 200)
  } finally {
    server.close()
  }
})
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd server && npm test`
Expected: FAIL — `requirePermission` no está exportado.

- [ ] **Step 3: Añadir `requirePermission` a `server/src/middleware.ts`**

Añade los imports y la función (deja `requireAuth` y `requireAdmin` como están):

```typescript
import type { Request, Response, NextFunction, RequestHandler } from 'express'
import type { DB, AppKey } from './db'
import { findUserByUsername, getPermissions } from './models'
```

```typescript
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
```

- [ ] **Step 4: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 3 tests de `middleware.test.ts` pasan; la suite completa en verde.

- [ ] **Step 5: Commit**

```bash
git add server/src/middleware.ts server/src/middleware.test.ts
git commit -m "feat(server): middleware requirePermission para el permiso aportaciones"
```

---

## Task 5: Cablear `qbittorrent` y `dataDir` en `AppConfig`

**Files:**
- Modify: `server/src/app.ts`
- Modify: `server/src/index.ts`
- Modify: `server/src/routes/auth.test.ts`
- Modify: `server/src/routes/admin.test.ts`

**Interfaces:**
- Consumes: `QbittorrentClient`, `createQbittorrentClient` (`qbittorrent.ts`, Task 3)
- Produces:
  - `AppConfig` gana `qbittorrent: QbittorrentClient | null` y `dataDir: string` (`app.ts`) — lo consumen Task 6 y Task 7.
  - `express.json({ limit: '5mb' })`.

- [ ] **Step 1: Modificar `server/src/app.ts`**

```typescript
import express, { type Express } from 'express'
import type { DB } from './db'
import type { JellyfinClient } from './jellyfin'
import type { JellyfinAdminClient } from './jellyfinAdmin'
import type { QbittorrentClient } from './qbittorrent'
import { createSessionMiddleware } from './session'
import { createAuthRouter } from './routes/auth'
import { createAdminRouter } from './routes/admin'
import { createInvitesRouter } from './routes/invites'

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
  app.use('/api/admin', createAdminRouter(config.db, config.adminUsername))
  app.use('/api/invites', createInvitesRouter(config.db, config.jellyfinAdmin))

  return app
}
```

(El router de aportaciones y los parámetros nuevos de `createAdminRouter` se añaden en Tasks 6 y 7.)

- [ ] **Step 2: Actualizar el helper de `server/src/routes/auth.test.ts`**

En `startTestServer`, el objeto pasado a `createApp` gana dos campos:

```typescript
  const app = createApp({
    db: createDb(':memory:'),
    jellyfin,
    jellyfinAdmin: null,
    qbittorrent: null,
    dataDir: '/tmp/archivo-oasis-test',
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
    qbittorrent: null,
    dataDir: '/tmp/archivo-oasis-test',
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
```

- [ ] **Step 4: Ejecutar la suite (sigue verde)**

Run: `cd server && npm test`
Expected: PASS — todos los tests existentes pasan con los campos nuevos. `npx tsc --noEmit` limpio.

- [ ] **Step 5: Modificar `server/src/index.ts`**

Añade el import y, tras el bloque de `JELLYFIN_API_KEY`, la construcción del cliente de qBittorrent; pasa `qbittorrent` y `dataDir` a `createApp`.

```typescript
import { createQbittorrentClient } from './qbittorrent'
```

```typescript
const QBITTORRENT_URL = process.env.QBITTORRENT_URL
const QBITTORRENT_USER = process.env.QBITTORRENT_USER
const QBITTORRENT_PASSWORD = process.env.QBITTORRENT_PASSWORD

const qbittorrent =
  QBITTORRENT_URL && QBITTORRENT_USER && QBITTORRENT_PASSWORD
    ? createQbittorrentClient(QBITTORRENT_URL, QBITTORRENT_USER, QBITTORRENT_PASSWORD)
    : null

if (!qbittorrent) {
  console.warn('qBittorrent no configurado — aceptar aportaciones devolverá 503')
}
```

Y en la llamada a `createApp({...})` añade:

```typescript
  qbittorrent,
  dataDir: DATA_DIR,
```

- [ ] **Step 6: Verificar que compila**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add server/src/app.ts server/src/index.ts server/src/routes/auth.test.ts server/src/routes/admin.test.ts
git commit -m "feat(server): qbittorrent y dataDir en AppConfig"
```

---

## Task 6: Rutas de usuario `/api/aportaciones`

**Files:**
- Create: `server/src/routes/aportaciones.ts`
- Test: `server/src/routes/aportaciones.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `DB` (`db.ts`); `requireAuth`, `requirePermission` (`middleware.ts`, Task 4); `findUserByUsername` (`models.ts`); `createSubmission`, `getSubmission`, `listByUser`, `deleteSubmission`, `SubmissionRecord`, `SubmissionCategory`, `SUBMISSION_CATEGORIES` (`submissions.ts`, Task 1); `writeSubmissionFile`, `deleteSubmissionFile` (`submissionFiles.ts`, Task 2); `AppConfig.dataDir` (`app.ts`, Task 5)
- Produces:
  - `export function createAportacionesRouter(db: DB, dataDir: string): Router` (`routes/aportaciones.ts`), montado en `app.ts` bajo `/api/aportaciones`.
  - `export function toSubmissionJson(s: SubmissionRecord): SubmissionJson` y `export interface SubmissionJson` — forma `{ id, description, category, sourceType, sourceUrl, fileName, status, rejectionReason, createdAt, processedAt, processedBy }`. La reutiliza Task 7.

- [ ] **Step 1: Escribir el test `server/src/routes/aportaciones.test.ts`**

```typescript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app'
import { createDb } from '../db'
import type { DB } from '../db'
import type { JellyfinClient } from '../jellyfin'
import { upsertUserLogin, setPermission } from '../models'
import { submissionFilePath } from '../submissionFiles'

const acceptingJellyfin: JellyfinClient = { async authenticate() {} }

function startTestServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aportaciones-routes-'))
  const db: DB = createDb(':memory:')
  const app = createApp({
    db,
    jellyfin: acceptingJellyfin,
    jellyfinAdmin: null,
    qbittorrent: null,
    dataDir,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}`, db, dataDir }
}

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const r = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'whatever' }),
  })
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

function grant(db: DB, username: string) {
  const u = upsertUserLogin(db, username)
  setPermission(db, u.id, 'aportaciones', true)
}

const B64_TORRENT = Buffer.from('d8:announce4:teste').toString('base64')

test('POST /api/aportaciones sin el permiso -> 403', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const cookie = await loginAs(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'x', category: 'movies', sourceType: 'url', sourceUrl: 'http://x' }),
    })
    assert.equal(r.status, 403)
  } finally {
    server.close()
  }
})

test('POST /api/aportaciones con URL crea la aportación', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    grant(db, 'alice')
    const cookie = await loginAs(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'Una peli', category: 'movies', sourceType: 'url', sourceUrl: 'magnet:?xt=urn:btih:abc' }),
    })
    assert.equal(r.status, 201)
    const { submission } = await r.json()
    assert.equal(submission.status, 'pendiente')
    assert.equal(submission.sourceUrl, 'magnet:?xt=urn:btih:abc')
  } finally {
    server.close()
  }
})

test('POST /api/aportaciones con fichero base64 crea la aportación y escribe el fichero', async () => {
  const { server, baseUrl, db, dataDir } = startTestServer()
  try {
    grant(db, 'alice')
    const cookie = await loginAs(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'Serie', category: 'tv', sourceType: 'file', fileName: 'x.torrent', fileBase64: B64_TORRENT }),
    })
    assert.equal(r.status, 201)
    const { submission } = await r.json()
    assert.equal(submission.fileName, 'x.torrent')
    assert.ok(fs.existsSync(submissionFilePath(dataDir, submission.id)))
  } finally {
    server.close()
  }
})

test('POST /api/aportaciones valida descripción, categoría, origen y fichero', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    grant(db, 'alice')
    const cookie = await loginAs(baseUrl, 'alice')
    const post = (body: unknown) =>
      fetch(`${baseUrl}/api/aportaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      })

    assert.equal((await post({ description: 'x'.repeat(281), category: 'movies', sourceType: 'url', sourceUrl: 'http://x' })).status, 400)
    assert.equal((await post({ description: 'ok', category: 'nope', sourceType: 'url', sourceUrl: 'http://x' })).status, 400)
    assert.equal((await post({ description: 'ok', category: 'movies', sourceType: 'url', sourceUrl: '   ' })).status, 400)
    assert.equal((await post({ description: 'ok', category: 'movies', sourceType: 'file', fileName: 'x.txt', fileBase64: B64_TORRENT })).status, 400)
    assert.equal((await post({ description: 'ok', category: 'movies', sourceType: 'file', fileName: 'x.torrent', fileBase64: Buffer.alloc(3 * 1024 * 1024).toString('base64') })).status, 400)
  } finally {
    server.close()
  }
})

test('GET /api/aportaciones devuelve solo las del usuario, recientes primero', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    grant(db, 'alice')
    grant(db, 'bob')
    const aliceCookie = await loginAs(baseUrl, 'alice')
    const bobCookie = await loginAs(baseUrl, 'bob')
    const mk = (cookie: string, desc: string) =>
      fetch(`${baseUrl}/api/aportaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ description: desc, category: 'music', sourceType: 'url', sourceUrl: 'http://x' }),
      })
    await mk(aliceCookie, 'a1')
    await new Promise((r) => setTimeout(r, 5))
    await mk(aliceCookie, 'a2')
    await mk(bobCookie, 'b1')

    const r = await fetch(`${baseUrl}/api/aportaciones`, { headers: { Cookie: aliceCookie } })
    const { submissions } = await r.json()
    assert.deepEqual(
      submissions.map((s: { description: string }) => s.description),
      ['a2', 'a1'],
    )
  } finally {
    server.close()
  }
})

test('DELETE /api/aportaciones/:id: propia y pendiente -> 204 y el fichero desaparece', async () => {
  const { server, baseUrl, db, dataDir } = startTestServer()
  try {
    grant(db, 'alice')
    const cookie = await loginAs(baseUrl, 'alice')
    const created = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'x', category: 'tv', sourceType: 'file', fileName: 'x.torrent', fileBase64: B64_TORRENT }),
    })
    const { submission } = await created.json()

    const del = await fetch(`${baseUrl}/api/aportaciones/${submission.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
    assert.equal(del.status, 204)
    assert.equal(fs.existsSync(submissionFilePath(dataDir, submission.id)), false)
  } finally {
    server.close()
  }
})

test('DELETE /api/aportaciones/:id: de otro usuario -> 403; inexistente -> 404', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    grant(db, 'alice')
    grant(db, 'bob')
    const aliceCookie = await loginAs(baseUrl, 'alice')
    const bobCookie = await loginAs(baseUrl, 'bob')
    const created = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie },
      body: JSON.stringify({ description: 'x', category: 'tv', sourceType: 'url', sourceUrl: 'http://x' }),
    })
    const { submission } = await created.json()

    assert.equal((await fetch(`${baseUrl}/api/aportaciones/${submission.id}`, { method: 'DELETE', headers: { Cookie: bobCookie } })).status, 403)
    assert.equal((await fetch(`${baseUrl}/api/aportaciones/99999`, { method: 'DELETE', headers: { Cookie: aliceCookie } })).status, 404)
  } finally {
    server.close()
  }
})
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd server && npm test`
Expected: FAIL — `Cannot find module '../routes/aportaciones'` / rutas devuelven 404.

- [ ] **Step 3: Escribir `server/src/routes/aportaciones.ts`**

```typescript
import { Router } from 'express'
import type { DB } from '../db'
import { requireAuth, requirePermission } from '../middleware'
import { findUserByUsername } from '../models'
import {
  createSubmission,
  getSubmission,
  listByUser,
  deleteSubmission,
  SUBMISSION_CATEGORIES,
  type SubmissionCategory,
  type SubmissionRecord,
} from '../submissions'
import { writeSubmissionFile, deleteSubmissionFile } from '../submissionFiles'

export interface SubmissionJson {
  id: number
  description: string
  category: SubmissionCategory
  sourceType: 'url' | 'file'
  sourceUrl: string | null
  fileName: string | null
  status: string
  rejectionReason: string | null
  createdAt: string
  processedAt: string | null
  processedBy: string | null
}

export function toSubmissionJson(s: SubmissionRecord): SubmissionJson {
  return {
    id: s.id,
    description: s.description,
    category: s.category,
    sourceType: s.sourceType,
    sourceUrl: s.sourceUrl,
    fileName: s.fileName,
    status: s.status,
    rejectionReason: s.rejectionReason,
    createdAt: s.createdAt,
    processedAt: s.processedAt,
    processedBy: s.processedBy,
  }
}

const MAX_FILE_BYTES = 2 * 1024 * 1024

export function createAportacionesRouter(db: DB, dataDir: string): Router {
  const router = Router()
  router.use(requireAuth)
  router.use(requirePermission(db, 'aportaciones'))

  function currentUserId(username: string): number {
    return findUserByUsername(db, username)!.id
  }

  router.get('/', (req, res) => {
    const userId = currentUserId(req.session!.username as string)
    res.json({ submissions: listByUser(db, userId).map(toSubmissionJson) })
  })

  router.post('/', (req, res) => {
    const body = req.body as {
      description?: string
      category?: string
      sourceType?: string
      sourceUrl?: string
      fileName?: string
      fileBase64?: string
    }

    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (!description || description.length > 280) {
      res.status(400).json({ error: 'La descripción es obligatoria y no puede pasar de 280 caracteres' })
      return
    }
    if (!SUBMISSION_CATEGORIES.includes(body.category as SubmissionCategory)) {
      res.status(400).json({ error: 'Categoría inválida' })
      return
    }
    const category = body.category as SubmissionCategory

    if (body.sourceType === 'url') {
      const url = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : ''
      if (!/^(https?:\/\/|magnet:)/i.test(url)) {
        res.status(400).json({ error: 'La URL debe empezar por http://, https:// o magnet:' })
        return
      }
      const submission = createSubmission(db, {
        userId: currentUserId(req.session!.username as string),
        description,
        category,
        sourceType: 'url',
        sourceUrl: url,
      })
      res.status(201).json({ submission: toSubmissionJson(submission) })
      return
    }

    if (body.sourceType === 'file') {
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
      if (!fileName || !fileName.toLowerCase().endsWith('.torrent')) {
        res.status(400).json({ error: 'El fichero debe ser un .torrent' })
        return
      }
      let bytes: Buffer
      try {
        bytes = Buffer.from(String(body.fileBase64 ?? ''), 'base64')
      } catch {
        bytes = Buffer.alloc(0)
      }
      if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
        res.status(400).json({ error: 'El fichero está vacío o supera los 2 MB' })
        return
      }
      const submission = createSubmission(db, {
        userId: currentUserId(req.session!.username as string),
        description,
        category,
        sourceType: 'file',
        fileName,
      })
      writeSubmissionFile(dataDir, submission.id, bytes)
      res.status(201).json({ submission: toSubmissionJson(submission) })
      return
    }

    res.status(400).json({ error: 'Debes indicar una URL o un fichero' })
  })

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'Aportación no encontrada' })
      return
    }
    const userId = currentUserId(req.session!.username as string)
    const result = deleteSubmission(db, id, userId)
    if (result === 'not_found') {
      res.status(404).json({ error: 'Aportación no encontrada' })
      return
    }
    if (result === 'forbidden') {
      res.status(403).json({ error: 'Esa aportación no es tuya' })
      return
    }
    if (result === 'not_pending') {
      res.status(409).json({ error: 'Solo puedes cancelar aportaciones pendientes' })
      return
    }
    deleteSubmissionFile(dataDir, id)
    res.status(204).end()
  })

  return router
}
```

- [ ] **Step 4: Montar el router en `server/src/app.ts`**

Añade el import:

```typescript
import { createAportacionesRouter } from './routes/aportaciones'
```

Y tras `app.use('/api/invites', ...)`:

```typescript
  app.use('/api/aportaciones', createAportacionesRouter(config.db, config.dataDir))
```

- [ ] **Step 5: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 7 tests de `aportaciones.test.ts` pasan; la suite completa en verde.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/aportaciones.ts server/src/routes/aportaciones.test.ts server/src/app.ts
git commit -m "feat(server): rutas de usuario para enviar y cancelar aportaciones"
```

---

## Task 7: Rutas de moderación en `/api/admin/aportaciones`

**Files:**
- Modify: `server/src/routes/admin.ts`
- Modify: `server/src/routes/admin.test.ts`
- Modify: `server/src/app.ts`

**Interfaces:**
- Consumes: `QbittorrentClient`, `QbittorrentError` (`qbittorrent.ts`, Task 3); `listAll`, `getSubmission`, `setStatus`, `SubmissionStatus` (`submissions.ts`, Task 1); `readSubmissionFile`, `deleteSubmissionFile` (`submissionFiles.ts`, Task 2); `toSubmissionJson`, `SubmissionJson` (`routes/aportaciones.ts`, Task 6); `AppConfig.qbittorrent`, `AppConfig.dataDir` (Task 5)
- Produces:
  - `createAdminRouter` gana la firma `createAdminRouter(db: DB, adminUsername: string, qbittorrent: QbittorrentClient | null, dataDir: string): Router`.
  - `GET /api/admin/aportaciones` → `{ submissions: (SubmissionJson & { username: string })[] }`
  - `POST /api/admin/aportaciones/:id/aceptar` → `{ submission }` | 404 | 409 | 502 `{ error }` | 503
  - `POST /api/admin/aportaciones/:id/rechazar` → `{ submission }` | 404 | 409

- [ ] **Step 1: Escribir los tests nuevos en `server/src/routes/admin.test.ts`**

Primero, ajusta el helper `startTestServer` para aceptar un `qbittorrent` opcional y exponer `db`/`dataDir`:

```typescript
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { type QbittorrentClient } from '../qbittorrent'

function startTestServer(qbittorrent: QbittorrentClient | null = null) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-aportaciones-'))
  const db = createDb(':memory:')
  const app = createApp({
    db,
    jellyfin: acceptingJellyfin,
    jellyfinAdmin: null,
    qbittorrent,
    dataDir,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}`, db, dataDir }
}
```

(Los tests existentes que llaman `startTestServer()` sin argumentos siguen valiendo; los que usaban `const { server, baseUrl } = startTestServer()` no cambian.)

Añade al final del fichero:

```typescript
import { upsertUserLogin as _seedUser, setPermission as _seedPerm } from '../models'
import { createSubmission } from '../submissions'
import { submissionFilePath, writeSubmissionFile } from '../submissionFiles'

const recordingQb = () => {
  const calls: { url?: string; fileName?: string; category: string }[] = []
  const client: QbittorrentClient = {
    async addTorrent(input) {
      calls.push({ url: input.url, fileName: input.fileName, category: input.category })
    },
  }
  return { calls, client }
}

function seedSubmission(db: ReturnType<typeof createDb>, username: string, over: Partial<Parameters<typeof createSubmission>[1]> = {}) {
  const u = _seedUser(db, username)
  _seedPerm(db, u.id, 'aportaciones', true)
  return createSubmission(db, {
    userId: u.id,
    description: 'algo',
    category: 'movies',
    sourceType: 'url',
    sourceUrl: 'magnet:?xt=urn:btih:abc',
    ...over,
  })
}

test('GET /api/admin/aportaciones lista todas y filtra por estado', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    seedSubmission(db, 'alice')
    seedSubmission(db, 'bob')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const all = await (await fetch(`${baseUrl}/api/admin/aportaciones`, { headers: { Cookie: adminCookie } })).json()
    assert.equal(all.submissions.length, 2)
    assert.ok(all.submissions.every((s: { username: string }) => typeof s.username === 'string'))

    const pend = await (await fetch(`${baseUrl}/api/admin/aportaciones?status=procesada`, { headers: { Cookie: adminCookie } })).json()
    assert.equal(pend.submissions.length, 0)
  } finally {
    server.close()
  }
})

test('aceptar envía a qBittorrent, marca procesada y borra el fichero', async () => {
  const qb = recordingQb()
  const { server, baseUrl, db, dataDir } = startTestServer(qb.client)
  try {
    const s = seedSubmission(db, 'alice', { sourceType: 'file', fileName: 'x.torrent', sourceUrl: null })
    writeSubmissionFile(dataDir, s.id, new Uint8Array([1, 2, 3]))
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const r = await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })
    assert.equal(r.status, 200)
    const { submission } = await r.json()
    assert.equal(submission.status, 'procesada')
    assert.equal(submission.processedBy, 'admin-user')
    assert.equal(qb.calls.length, 1)
    assert.equal(qb.calls[0].category, 'movies')
    assert.equal(fs.existsSync(submissionFilePath(dataDir, s.id)), false)
  } finally {
    server.close()
  }
})

test('aceptar cuando qBittorrent falla -> 502 y sigue pendiente', async () => {
  const failing: QbittorrentClient = {
    async addTorrent() {
      const { QbittorrentError } = await import('../qbittorrent')
      throw new QbittorrentError('qBittorrent rechazó el torrent')
    },
  }
  const { server, baseUrl, db } = startTestServer(failing)
  try {
    const s = seedSubmission(db, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const r = await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })
    assert.equal(r.status, 502)

    const list = await (await fetch(`${baseUrl}/api/admin/aportaciones`, { headers: { Cookie: adminCookie } })).json()
    assert.equal(list.submissions[0].status, 'pendiente')
  } finally {
    server.close()
  }
})

test('aceptar sin qBittorrent configurado -> 503', async () => {
  const { server, baseUrl, db } = startTestServer(null)
  try {
    const s = seedSubmission(db, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const r = await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })
    assert.equal(r.status, 503)
  } finally {
    server.close()
  }
})

test('aceptar/rechazar sobre algo no pendiente -> 409', async () => {
  const qb = recordingQb()
  const { server, baseUrl, db } = startTestServer(qb.client)
  try {
    const s = seedSubmission(db, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })

    assert.equal((await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })).status, 409)
    assert.equal(
      (await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/rechazar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ reason: 'x' }),
      })).status,
      409,
    )
  } finally {
    server.close()
  }
})

test('rechazar marca rechazada con el motivo', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    const s = seedSubmission(db, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const r = await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/rechazar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ reason: '  duplicado  ' }),
    })
    assert.equal(r.status, 200)
    const { submission } = await r.json()
    assert.equal(submission.status, 'rechazada')
    assert.equal(submission.rejectionReason, 'duplicado')
  } finally {
    server.close()
  }
})

test('los endpoints de moderación rechazan a quien no es admin', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const userCookie = await loginAs(baseUrl, 'alice')
    assert.equal((await fetch(`${baseUrl}/api/admin/aportaciones`, { headers: { Cookie: userCookie } })).status, 403)
  } finally {
    server.close()
  }
})
```

- [ ] **Step 2: Ejecutar y ver fallar**

Run: `cd server && npm test`
Expected: FAIL — rutas de moderación no existen / firma de `createAdminRouter`.

- [ ] **Step 3: Modificar `server/src/routes/admin.ts`**

Añade los imports:

```typescript
import type { QbittorrentClient } from '../qbittorrent'
import { QbittorrentError } from '../qbittorrent'
import { listAll, getSubmission, setStatus, type SubmissionStatus } from '../submissions'
import { readSubmissionFile, deleteSubmissionFile } from '../submissionFiles'
import { toSubmissionJson } from './aportaciones'
```

Cambia la firma de la función y añade los tres endpoints (después de los de invitaciones, antes de `return router`):

```typescript
export function createAdminRouter(
  db: DB,
  adminUsername: string,
  qbittorrent: QbittorrentClient | null,
  dataDir: string,
): Router {
  // ... requireAdmin y el resto de rutas existentes sin cambios ...

  const SUB_STATUSES: SubmissionStatus[] = ['pendiente', 'procesada', 'rechazada']

  router.get('/aportaciones', (req, res) => {
    const status = req.query.status
    const filter = SUB_STATUSES.includes(status as SubmissionStatus) ? (status as SubmissionStatus) : undefined
    const submissions = listAll(db, filter).map((s) => ({ ...toSubmissionJson(s), username: s.username }))
    res.json({ submissions })
  })

  router.post('/aportaciones/:id/aceptar', async (req, res) => {
    if (!qbittorrent) {
      res.status(503).json({ error: 'qBittorrent no está configurado' })
      return
    }
    const s = getSubmission(db, Number(req.params.id))
    if (!s) {
      res.status(404).json({ error: 'Aportación no encontrada' })
      return
    }
    if (s.status !== 'pendiente') {
      res.status(409).json({ error: 'Esa aportación ya no está pendiente' })
      return
    }

    try {
      await qbittorrent.addTorrent({
        url: s.sourceType === 'url' ? s.sourceUrl ?? undefined : undefined,
        file: s.sourceType === 'file' ? readSubmissionFile(dataDir, s.id) : undefined,
        fileName: s.fileName ?? undefined,
        category: s.category,
      })
    } catch (err) {
      const message = err instanceof QbittorrentError ? err.message : 'No se pudo enviar a qBittorrent'
      res.status(502).json({ error: message })
      return
    }

    const updated = setStatus(db, s.id, 'procesada', { processedBy: req.session!.username as string })
    deleteSubmissionFile(dataDir, s.id)
    res.json({ submission: toSubmissionJson(updated) })
  })

  router.post('/aportaciones/:id/rechazar', (req, res) => {
    const s = getSubmission(db, Number(req.params.id))
    if (!s) {
      res.status(404).json({ error: 'Aportación no encontrada' })
      return
    }
    if (s.status !== 'pendiente') {
      res.status(409).json({ error: 'Esa aportación ya no está pendiente' })
      return
    }
    const reason = typeof req.body?.reason === 'string' && req.body.reason.trim() ? req.body.reason.trim() : null
    const updated = setStatus(db, s.id, 'rechazada', { processedBy: req.session!.username as string, rejectionReason: reason })
    deleteSubmissionFile(dataDir, s.id)
    res.json({ submission: toSubmissionJson(updated) })
  })

  return router
}
```

- [ ] **Step 4: Actualizar la llamada en `server/src/app.ts`**

```typescript
  app.use('/api/admin', createAdminRouter(config.db, config.adminUsername, config.qbittorrent, config.dataDir))
```

- [ ] **Step 5: Ejecutar los tests**

Run: `cd server && npm test`
Expected: los 7 tests nuevos de `admin.test.ts` pasan; la suite completa en verde. `npx tsc --noEmit` limpio.

- [ ] **Step 6: Commit**

```bash
git add server/src/routes/admin.ts server/src/routes/admin.test.ts server/src/app.ts
git commit -m "feat(server): moderación de aportaciones (listar, aceptar -> qBittorrent, rechazar)"
```

---

## Task 8: Infra — variables de entorno de qBittorrent

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Modify: `server/.env.example`
- Modify: `README.md`
- Modify: `docker/nginx.conf`

**Interfaces:**
- Consumes: nada de código.
- Produces: el contenedor `archivo-oasis-api` recibe `QBITTORRENT_URL` / `QBITTORRENT_USER` / `QBITTORRENT_PASSWORD`; nginx acepta bodies de hasta 6 MB en `/api/`.

- [ ] **Step 1: `docker-compose.yml`**

En el bloque `environment:` del servicio `archivo-oasis-api`, tras `JELLYFIN_API_KEY`:

```yaml
      - QBITTORRENT_URL=${QBITTORRENT_URL}
      - QBITTORRENT_USER=${QBITTORRENT_USER}
      - QBITTORRENT_PASSWORD=${QBITTORRENT_PASSWORD}
```

- [ ] **Step 2: `.env.example`** (raíz)

Añade al final:

```
# qBittorrent (sección Aportaciones). WebUI del qBittorrent, sin barra final.
# Si se dejan vacías, aceptar una aportación devuelve 503.
QBITTORRENT_URL=https://qbittorrent.archivo-oasis.com
QBITTORRENT_USER=
QBITTORRENT_PASSWORD=
```

- [ ] **Step 3: `server/.env.example`**

Añade el mismo bloque que en el Step 2.

- [ ] **Step 4: `README.md`**

En la sección de variables de entorno del backend, añade `QBITTORRENT_URL`, `QBITTORRENT_USER`, `QBITTORRENT_PASSWORD` con una línea cada una explicando que son para la sección Aportaciones y que sin ellas aceptar una aportación devuelve 503.

- [ ] **Step 5: `docker/nginx.conf`**

Dentro de `location /api/ {`, añade como primera línea del bloque:

```nginx
        client_max_body_size 6m;
```

- [ ] **Step 6: Verificar**

Run: `docker compose -f docker-compose.yml config` si `docker` está disponible; si no, revisa el YAML y el nginx.conf a mano.
Expected: sin errores de sintaxis.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml .env.example server/.env.example README.md docker/nginx.conf
git commit -m "feat(infra): variables de qBittorrent y límite de body de nginx para aportaciones"
```

---

## Task 9: Cliente de aportaciones en el frontend (`authApi.ts`)

**Files:**
- Modify: `src/lib/authApi.ts`

**Interfaces:**
- Consumes: nada de tareas anteriores.
- Produces:
  - `export type SubmissionCategory = 'movies' | 'tv' | 'music'`
  - `export type SubmissionStatus = 'pendiente' | 'procesada' | 'rechazada'`
  - `export interface Submission { id: number; description: string; category: SubmissionCategory; sourceType: 'url' | 'file'; sourceUrl: string | null; fileName: string | null; status: SubmissionStatus; rejectionReason: string | null; createdAt: string; processedAt: string | null; processedBy: string | null }`
  - `export interface AdminSubmission extends Submission { username: string }`
  - `export async function createSubmission(input: { description: string; category: SubmissionCategory; sourceType: 'url' | 'file'; sourceUrl?: string; fileName?: string; fileBase64?: string }): Promise<Submission>`
  - `export async function fetchMySubmissions(): Promise<Submission[]>`
  - `export async function deleteSubmission(id: number): Promise<void>`
  - `export async function fetchAdminSubmissions(status?: SubmissionStatus): Promise<AdminSubmission[]>`
  - `export async function acceptSubmission(id: number): Promise<Submission>`
  - `export async function rejectSubmission(id: number, reason?: string): Promise<Submission>`

- [ ] **Step 1: Añadir el bloque al final de `src/lib/authApi.ts`**

```typescript
export type SubmissionCategory = 'movies' | 'tv' | 'music'
export type SubmissionStatus = 'pendiente' | 'procesada' | 'rechazada'

export interface Submission {
  id: number
  description: string
  category: SubmissionCategory
  sourceType: 'url' | 'file'
  sourceUrl: string | null
  fileName: string | null
  status: SubmissionStatus
  rejectionReason: string | null
  createdAt: string
  processedAt: string | null
  processedBy: string | null
}

export interface AdminSubmission extends Submission {
  username: string
}

export async function createSubmission(input: {
  description: string
  category: SubmissionCategory
  sourceType: 'url' | 'file'
  sourceUrl?: string
  fileName?: string
  fileBase64?: string
}): Promise<Submission> {
  const response = await fetch('/api/aportaciones', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo enviar la aportación'))
  }
  return ((await response.json()) as { submission: Submission }).submission
}

export async function fetchMySubmissions(): Promise<Submission[]> {
  const response = await fetch('/api/aportaciones', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudieron cargar tus aportaciones'))
  }
  return ((await response.json()) as { submissions: Submission[] }).submissions
}

export async function deleteSubmission(id: number): Promise<void> {
  const response = await fetch(`/api/aportaciones/${id}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo cancelar la aportación'))
  }
}

export async function fetchAdminSubmissions(status?: SubmissionStatus): Promise<AdminSubmission[]> {
  const query = status ? `?status=${status}` : ''
  const response = await fetch(`/api/admin/aportaciones${query}`, { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudieron cargar las aportaciones'))
  }
  return ((await response.json()) as { submissions: AdminSubmission[] }).submissions
}

export async function acceptSubmission(id: number): Promise<Submission> {
  const response = await fetch(`/api/admin/aportaciones/${id}/aceptar`, {
    method: 'POST',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo aceptar la aportación'))
  }
  return ((await response.json()) as { submission: Submission }).submission
}

export async function rejectSubmission(id: number, reason?: string): Promise<Submission> {
  const response = await fetch(`/api/admin/aportaciones/${id}/rechazar`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo rechazar la aportación'))
  }
  return ((await response.json()) as { submission: Submission }).submission
}
```

- [ ] **Step 2: Verificar que compila y construye**

Run (desde la raíz del repo): `npx tsc --noEmit && npm run build`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add src/lib/authApi.ts
git commit -m "feat(frontend): cliente de aportaciones"
```

---

## Task 10: Página `AportacionesPage`

**Files:**
- Create: `src/pages/Archivo/AportacionesPage.tsx`
- Create: `src/pages/Archivo/AportacionesPage.module.css`
- Modify: `src/routes/AppRoutes.tsx`

**Interfaces:**
- Consumes: `useAuth` (`src/lib/useAuth.ts`); `HomeButton` (`src/pages/Archivo/HomeButton.tsx`); todo el bloque de aportaciones de `authApi.ts` (Task 9)
- Produces: `export default function AportacionesPage(): JSX.Element` — ruta `/archivo/aportaciones`.

- [ ] **Step 1: Crear `src/pages/Archivo/AportacionesPage.module.css`**

```css
.container {
  min-height: 100vh;
  background: #03010a;
  color: #0ff0fc;
  padding: 4.5rem 1.5rem 3rem;
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

.inner {
  width: min(900px, 100%);
  margin: 0 auto;
}

.h1 {
  margin: 0 0 1.5rem;
}

.h2 {
  margin: 2.5rem 0 1rem;
  border-top: 1px solid rgba(15, 240, 252, 0.2);
  padding-top: 1.5rem;
}

.form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  margin-bottom: 2rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.label {
  font-size: 0.8rem;
  color: #a7abc9;
}

.input,
.textarea,
.select {
  background: #12102a;
  border: 1px solid #2c2a4a;
  border-radius: 6px;
  padding: 0.55rem 0.7rem;
  color: #f0f2ff;
  font: inherit;
}

.textarea {
  resize: vertical;
  min-height: 3.5rem;
}

.counter {
  font-size: 0.75rem;
  color: #6f7391;
  align-self: flex-end;
}

.radios {
  display: flex;
  gap: 1.25rem;
  font-size: 0.9rem;
  color: #d7d9f0;
}

.submit {
  align-self: flex-start;
  padding: 0.55rem 1.4rem;
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

.error {
  color: #ff6b81;
  margin: 0.5rem 0;
}

.filter {
  margin-bottom: 1rem;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.table th,
.table td {
  padding: 0.55rem 0.7rem;
  text-align: left;
  border-bottom: 1px solid rgba(15, 240, 252, 0.15);
  color: #d7d9f0;
  vertical-align: top;
}

.badge {
  display: inline-block;
  padding: 0.1rem 0.5rem;
  border-radius: 999px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.pendiente {
  background: rgba(255, 209, 102, 0.15);
  color: #ffd166;
}

.procesada {
  background: rgba(6, 214, 160, 0.15);
  color: #06d6a0;
}

.rechazada {
  background: rgba(255, 107, 129, 0.15);
  color: #ff6b81;
}

.rowButton {
  background: none;
  border: 1px solid rgba(15, 240, 252, 0.4);
  color: #0ff0fc;
  border-radius: 4px;
  padding: 0.2rem 0.55rem;
  font-size: 0.78rem;
  cursor: pointer;
  margin-right: 0.35rem;
}

.rowButton.danger {
  border-color: rgba(255, 107, 129, 0.5);
  color: #ff6b81;
}

.reason {
  font-size: 0.78rem;
  color: #8b8fb3;
  margin-top: 0.2rem;
}

.empty {
  color: #8b8fb3;
}
```

- [ ] **Step 2: Crear `src/pages/Archivo/AportacionesPage.tsx`**

```typescript
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import HomeButton from './HomeButton'
import {
  acceptSubmission,
  createSubmission,
  deleteSubmission,
  fetchAdminSubmissions,
  fetchMySubmissions,
  rejectSubmission,
  type AdminSubmission,
  type Submission,
  type SubmissionCategory,
  type SubmissionStatus,
} from '../../lib/authApi'
import styles from './AportacionesPage.module.css'

const CATEGORY_LABEL: Record<SubmissionCategory, string> = {
  movies: 'Películas',
  tv: 'Series',
  music: 'Música',
}

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pendiente: 'Pendiente',
  procesada: 'Procesada',
  rechazada: 'Rechazada',
}

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  })
}

function StatusBadge({ status }: { status: SubmissionStatus }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{STATUS_LABEL[status]}</span>
}

function UserSection() {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<SubmissionCategory>('movies')
  const [mode, setMode] = useState<'url' | 'file'>('url')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMySubmissions()
      .then(setSubmissions)
      .catch(() => {
        setSubmissions([])
        setError('No se pudieron cargar tus aportaciones')
      })
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const created = await createSubmission(
        mode === 'url'
          ? { description, category, sourceType: 'url', sourceUrl: url }
          : {
              description,
              category,
              sourceType: 'file',
              fileName: file?.name,
              fileBase64: file ? await fileToBase64(file) : undefined,
            },
      )
      setSubmissions((prev) => [created, ...(prev ?? [])])
      setDescription('')
      setUrl('')
      setFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la aportación')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: number) => {
    if (!window.confirm('¿Cancelar esta aportación?')) return
    setError(null)
    try {
      await deleteSubmission(id)
      setSubmissions((prev) => prev?.filter((s) => s.id !== id) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar')
    }
  }

  return (
    <section>
      <h1 className={styles.h1}>Aportaciones</h1>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ap-desc">
            Descripción
          </label>
          <textarea
            id="ap-desc"
            className={styles.textarea}
            maxLength={280}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
          <span className={styles.counter}>{description.length}/280</span>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ap-cat">
            Categoría
          </label>
          <select
            id="ap-cat"
            className={styles.select}
            value={category}
            onChange={(e) => setCategory(e.target.value as SubmissionCategory)}
          >
            <option value="movies">Películas</option>
            <option value="tv">Series</option>
            <option value="music">Música</option>
          </select>
        </div>

        <div className={styles.radios}>
          <label>
            <input type="radio" checked={mode === 'url'} onChange={() => setMode('url')} /> Enlace
          </label>
          <label>
            <input type="radio" checked={mode === 'file'} onChange={() => setMode('file')} /> Fichero
          </label>
        </div>

        {mode === 'url' ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ap-url">
              URL o enlace magnet
            </label>
            <input
              id="ap-url"
              className={styles.input}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… o magnet:…"
              required
            />
          </div>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ap-file">
              Fichero .torrent
            </label>
            <input
              id="ap-file"
              className={styles.input}
              type="file"
              accept=".torrent"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit} disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar aportación'}
        </button>
      </form>

      {!submissions ? (
        <p className={styles.empty}>Cargando…</p>
      ) : submissions.length === 0 ? (
        <p className={styles.empty}>Todavía no has enviado ninguna aportación.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Descripción</th>
              <th>Categoría</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={s.id}>
                <td>{s.description}</td>
                <td>{CATEGORY_LABEL[s.category]}</td>
                <td>{new Date(s.createdAt).toLocaleDateString('es-ES')}</td>
                <td>
                  <StatusBadge status={s.status} />
                  {s.status === 'rechazada' && s.rejectionReason && (
                    <div className={styles.reason}>Motivo: {s.rejectionReason}</div>
                  )}
                </td>
                <td>
                  {s.status === 'pendiente' && (
                    <button className={`${styles.rowButton} ${styles.danger}`} onClick={() => cancel(s.id)}>
                      Cancelar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function AdminSection() {
  const [submissions, setSubmissions] = useState<AdminSubmission[] | null>(null)
  const [filter, setFilter] = useState<SubmissionStatus | 'todas'>('todas')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchAdminSubmissions(filter === 'todas' ? undefined : filter)
      .then(setSubmissions)
      .catch(() => {
        setSubmissions([])
        setError('No se pudieron cargar las aportaciones')
      })
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  const update = (updated: Submission) =>
    setSubmissions(
      (prev) => prev?.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) ?? null,
    )

  const accept = async (id: number) => {
    setError(null)
    try {
      update(await acceptSubmission(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar')
    }
  }

  const reject = async (id: number) => {
    const reason = window.prompt('Motivo (opcional):') ?? undefined
    setError(null)
    try {
      update(await rejectSubmission(id, reason))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo rechazar')
    }
  }

  return (
    <section>
      <h2 className={styles.h2}>Moderación</h2>
      <select
        className={`${styles.select} ${styles.filter}`}
        value={filter}
        onChange={(e) => setFilter(e.target.value as SubmissionStatus | 'todas')}
      >
        <option value="todas">Todas</option>
        <option value="pendiente">Pendientes</option>
        <option value="procesada">Procesadas</option>
        <option value="rechazada">Rechazadas</option>
      </select>

      {error && <p className={styles.error}>{error}</p>}

      {!submissions ? (
        <p className={styles.empty}>Cargando…</p>
      ) : submissions.length === 0 ? (
        <p className={styles.empty}>No hay aportaciones.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Descripción</th>
              <th>Categoría</th>
              <th>Origen</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={s.id}>
                <td>{s.username}</td>
                <td>{s.description}</td>
                <td>{CATEGORY_LABEL[s.category]}</td>
                <td>
                  {s.sourceType === 'url' && s.sourceUrl ? (
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                      {s.sourceUrl.length > 40 ? `${s.sourceUrl.slice(0, 40)}…` : s.sourceUrl}
                    </a>
                  ) : (
                    (s.fileName ?? '—')
                  )}
                </td>
                <td>{new Date(s.createdAt).toLocaleDateString('es-ES')}</td>
                <td>
                  <StatusBadge status={s.status} />
                  {s.status === 'rechazada' && s.rejectionReason && (
                    <div className={styles.reason}>Motivo: {s.rejectionReason}</div>
                  )}
                </td>
                <td>
                  {s.status === 'pendiente' && (
                    <>
                      <button className={styles.rowButton} onClick={() => accept(s.id)}>
                        Aceptar
                      </button>
                      <button className={`${styles.rowButton} ${styles.danger}`} onClick={() => reject(s.id)}>
                        Denegar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function AportacionesPage() {
  const { status, session } = useAuth()
  const navigate = useNavigate()

  if (status === 'loading') {
    return <div className={styles.centered} />
  }

  if (status === 'offline') {
    return (
      <div className={styles.centered}>
        <HomeButton />
        <div>
          <h1>No se pudo conectar con el servidor</h1>
          <button className={styles.submit} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </div>
    )
  }

  const canUse = session?.permissions.includes('aportaciones') ?? false
  const isAdmin = session?.isAdmin ?? false

  if (!session || (!canUse && !isAdmin)) {
    return (
      <div className={styles.centered}>
        <HomeButton />
        <div>
          <h1>Solo el penitente pasará</h1>
          <button className={styles.submit} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </div>
    )
  }

  return (
    <main className={styles.container}>
      <HomeButton />
      <div className={styles.inner}>
        {canUse && <UserSection />}
        {isAdmin && <AdminSection />}
      </div>
    </main>
  )
}

export default AportacionesPage
```

- [ ] **Step 3: Cambiar la ruta en `src/routes/AppRoutes.tsx`**

Añade el import:

```typescript
import AportacionesPage from '../pages/Archivo/AportacionesPage'
```

Sustituye la línea de la ruta:

```typescript
      <Route path="/archivo/aportaciones" element={<AportacionesPage />} />
```

(La ruta `/archivo/cantina` sigue con `<Placeholder title="La Cantina" need="cantina" />`.)

- [ ] **Step 4: Verificar que compila y construye**

Run (desde la raíz): `npx tsc --noEmit && npm run build`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Archivo/AportacionesPage.tsx src/pages/Archivo/AportacionesPage.module.css src/routes/AppRoutes.tsx
git commit -m "feat(frontend): página de Aportaciones (formulario de usuario + moderación de admin)"
```

---

## Task 11: Verificación manual end-to-end

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Rellenar `server/.env`**

Añade `QBITTORRENT_URL`, `QBITTORRENT_USER`, `QBITTORRENT_PASSWORD` con los datos reales del qBittorrent.

- [ ] **Step 2: Arrancar backend (Node ≥20 o shim) y frontend**

```bash
cd server && set -a && . ./.env && set +a && DATA_DIR="$PWD/data" PORT=3001 npx tsx watch src/index.ts
# en otra terminal, en la raíz:
npm run dev
```

El backend debe arrancar sin el aviso `qBittorrent no configurado`.

- [ ] **Step 3: Como usuario con permiso `aportaciones`**

En `/archivo/aportaciones`: ver el botón de la puerta arriba-izquierda. Enviar una aportación por URL (magnet) → aparece en la tabla como "Pendiente". Enviar otra por fichero `.torrent` → aparece. Probar validaciones (descripción vacía, fichero que no es `.torrent`). Cancelar una pendiente → desaparece.

- [ ] **Step 4: Como admin**

En la misma página, sección "Moderación": filtrar por "Pendientes". Aceptar una → comprobar en qBittorrent que el torrent aparece con la categoría correcta; en la tabla pasa a "Procesada". Denegar otra con un motivo → pasa a "Rechazada".

- [ ] **Step 5: Como usuario otra vez**

Ver que la aceptada está "Procesada" y la denegada "Rechazada" con el motivo visible.

- [ ] **Step 6: qBittorrent apagado**

Parar qBittorrent (o poner mal la contraseña en `.env` y reiniciar) → aceptar una aportación → aviso de error, la fila sigue "Pendiente".

- [ ] **Step 7: Suite completa del backend**

Run: `cd server && npm test`
Expected: todos los tests pasan. Si estás en Node 18 con el shim, restaura después (`git checkout package-lock.json && npm ci`).

---

## Self-Review

**Cobertura de la spec:**

| Requisito de la spec | Tarea |
|---|---|
| Tabla `submissions` + modelo (crear, listar propias/todas, borrar, estado) | Task 1 |
| Ficheros `.torrent` en `DATA_DIR/aportaciones/<id>.torrent`, borrado best-effort | Task 2, usado en 6 y 7 |
| Cliente qBittorrent (login SID, add url/file, re-login en 403, errores) | Task 3 |
| `requirePermission('aportaciones')` | Task 4 |
| `QBITTORRENT_*` env + `qbittorrent`/`dataDir` en `AppConfig`, `express.json` 5mb | Task 5 |
| `POST/GET/DELETE /api/aportaciones` con validación (280, categoría, url/magnet, `.torrent`, 2 MB) | Task 6 |
| `GET /api/admin/aportaciones` + filtro; `aceptar` (502 sigue pendiente / 503 sin config / 409); `rechazar` con motivo | Task 7 |
| `docker-compose.yml`, `.env.example` x2, README, `nginx client_max_body_size` | Task 8 |
| Cliente de aportaciones en el frontend | Task 9 |
| `AportacionesPage`: parte usuario (form + tabla + cancelar) y parte admin (filtro + aceptar/denegar); `HomeButton`; sustituye `Placeholder` | Task 10 |
| Verificación manual E2E | Task 11 |

**Escaneo de placeholders:** sin "TBD"/"TODO"/"añadir validación" — todos los pasos llevan código real.

**Consistencia de tipos:**
- `SubmissionRecord` / `SubmissionCategory` / `SubmissionStatus` / `SubmissionSourceType` — Task 1, consumidos con los mismos nombres en Tasks 4, 6, 7.
- `SubmissionJson` + `toSubmissionJson` — definidos en Task 6 (`routes/aportaciones.ts`), reimportados en Task 7 (`routes/admin.ts`).
- Forma JSON `Submission` (frontend, Task 9) = `toSubmissionJson` (backend, Task 6): `id, description, category, sourceType, sourceUrl, fileName, status, rejectionReason, createdAt, processedAt, processedBy`. `AdminSubmission` = `Submission & { username }`, y Task 7 añade `username` al mapear.
- `QbittorrentClient.addTorrent({ url?, file?, fileName?, category })` — Task 3, consumido en Task 7 y en los tests con un doble.
- `AppConfig` gana `qbittorrent: QbittorrentClient | null` y `dataDir: string` — Task 5, consumido en Tasks 6 y 7 vía `config.qbittorrent` / `config.dataDir`.
- `createAdminRouter(db, adminUsername, qbittorrent, dataDir)` — nueva firma en Task 7; la llamada en `app.ts` se actualiza en Task 7 Step 4; el helper de `admin.test.ts` en Task 7 Step 1.
- `requirePermission(db, appKey)` — Task 4, consumido en Task 6.
