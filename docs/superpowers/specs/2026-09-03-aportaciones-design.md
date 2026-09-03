# Sección Aportaciones (envío de torrents a qBittorrent) — diseño

Fecha: 2026-09-03

## Objetivo

Construir la sección **Aportaciones** de la parte interna de archivo-oasis: los
usuarios con permiso proponen contenido (una descripción + un `.torrent` por URL o
fichero + una categoría), y un administrador revisa la cola y, al aceptar, envía el
torrent a un qBittorrent con la categoría indicada.

Es la pieza 6 de la descomposición original (`2026-09-01-interior-base-design.md`), y
la primera que integra un servicio externo de descarga.

## Contexto

Ya existe: backend `archivo-oasis-api` (Express + better-sqlite3) tras nginx en
`/api/*`, sesión en cookie httpOnly, permisos por `app_key` (uno es `aportaciones`),
identidad de admin por variable de entorno `ADMIN_JELLYFIN_USERNAME`, y el patrón de
"cliente de servicio externo inyectado en `AppConfig` como `X | null`, y si falta la
config la ruta responde 503" (usado ya para `jellyfinAdmin`).

Hoy `/archivo/aportaciones` es una página `Placeholder` protegida por el permiso
`aportaciones`. Esta pieza la sustituye por la funcionalidad real.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Entrada del torrent | URL/magnet **o** fichero `.torrent` (el usuario elige). |
| Transporte del fichero | El frontend lo codifica en **base64** y lo manda en el JSON normal (los `.torrent` son diminutos). Sin multipart, sin `multer`. |
| Auth de qBittorrent | Usuario + contraseña en `.env` (`POST /api/v2/auth/login`, cookie `SID` cacheada). qBittorrent no tiene API keys. |
| Fallo al aceptar | La aportación **sigue `pendiente`** y se muestra el error de qBittorrent. Sin cuarto estado. |
| Motivo de rechazo | Opcional; visible para el usuario en su tabla. |
| Panel de moderación | Inline en `/archivo/aportaciones`, debajo de la parte del usuario, solo si `isAdmin`. |
| Cancelar envío | El usuario puede borrar una aportación **suya** mientras esté `pendiente` (se borra también el fichero). |
| Categorías | Conjunto fijo `movies` / `tv` / `music`. Se pasa el string a qBittorrent tal cual; no se crean categorías desde aquí. |
| Dependencias npm | Ninguna nueva (base64, `FormData`/`Blob` nativos de Node ≥18). |

## Arquitectura

```
Navegador (/archivo/aportaciones)
   │
nginx ── /api/* ──▶ archivo-oasis-api
                      ├── /api/aportaciones*         (requireAuth + requirePermission 'aportaciones')
                      ├── /api/admin/aportaciones*   (requireAdmin)
                      │      │
                      │      ├── SQLite: tabla submissions
                      │      ├── ficheros: DATA_DIR/aportaciones/<id>.torrent
                      │      └── qbittorrent  ──▶ qBittorrent WebUI
                      │                            POST /api/v2/auth/login
                      │                            POST /api/v2/torrents/add
```

**Variables de entorno nuevas del backend:**

- `QBITTORRENT_URL` — p.ej. `https://qbittorrent.archivo-oasis.com` (sin barra final).
- `QBITTORRENT_USER`, `QBITTORRENT_PASSWORD`.
- Si alguna falta, el backend arranca igual pero `POST /api/admin/aportaciones/:id/aceptar`
  responde `503`. Enviar, listar, cancelar y rechazar aportaciones funciona sin qBittorrent.

**Almacenamiento de ficheros:** los `.torrent` subidos se guardan en
`DATA_DIR/aportaciones/<id>.torrent` (mismo volumen persistente `archivo-oasis-data`).
Se borran (best-effort, se loguea si falla) cuando la aportación llega a un estado
terminal (`procesada` / `rechazada`) o el usuario la cancela.

## Modelo de datos (SQLite)

Tabla nueva, creada con `CREATE TABLE IF NOT EXISTS` en `createDb` (no requiere
migración de tablas existentes):

```sql
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,              -- 1..280 tras trim
  category TEXT NOT NULL CHECK (category IN ('movies','tv','music')),
  source_type TEXT NOT NULL CHECK (source_type IN ('url','file')),
  source_url TEXT,                        -- si source_type='url'
  file_name TEXT,                         -- nombre original, si source_type='file'
  status TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente','procesada','rechazada')),
  rejection_reason TEXT,                  -- opcional, al rechazar
  created_at TEXT NOT NULL,
  processed_at TEXT,                      -- al pasar a procesada o rechazada
  processed_by TEXT                       -- jellyfin_username del admin
);
```

La ruta del fichero se deriva: `path.join(DATA_DIR, 'aportaciones', id + '.torrent')`.

## Permisos

- Enviar / listar-propias / cancelar aportaciones: `requireAuth` + comprobar que el
  usuario tiene el permiso `aportaciones`. Middleware nuevo `requirePermission(appKey)`.
- Moderación: `requireAdmin` (el existente).
- El frontend muestra la parte de usuario si `permissions.includes('aportaciones')` y la
  parte de admin si `isAdmin`. Un admin sin el permiso ve solo la moderación.

## API

### Usuario — `requireAuth` + `requirePermission('aportaciones')`

| Endpoint | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/aportaciones` | `{ description, category, sourceType: 'url'|'file', sourceUrl?, fileName?, fileBase64? }` | `201 { submission }` |
| `GET /api/aportaciones` | — | `200 { submissions: Submission[] }` — solo del usuario, `created_at` desc |
| `DELETE /api/aportaciones/:id` | — | `204` \| `404` (no existe) \| `403` (no es suya) \| `409` (ya no `pendiente`) |

Validación de `POST`:
- `description`: string, `trim`, longitud 1–280 → si no, `400`.
- `category`: uno de `movies` / `tv` / `music` → si no, `400`.
- `sourceType === 'url'`: `sourceUrl` no vacío tras `trim`, empieza por `http://`,
  `https://` o `magnet:` → si no, `400`.
- `sourceType === 'file'`: `fileBase64` presente y decodificable; `fileName` string no
  vacío que termina en `.torrent` (case-insensitive); bytes decodificados ≤ 2 MB → si
  no, `400`. El fichero se escribe **después** de insertar la fila (necesita el `id`).
- Cualquier otro `sourceType` → `400`.

### Admin — `requireAdmin`

| Endpoint | Cuerpo | Respuesta |
|---|---|---|
| `GET /api/admin/aportaciones` | query `?status=pendiente|procesada|rechazada` (opcional) | `200 { submissions: AdminSubmission[] }` — todas, `created_at` desc |
| `POST /api/admin/aportaciones/:id/aceptar` | — | `200 { submission }` \| `404` \| `409` (no `pendiente`) \| `502 { error }` (qBittorrent falló; fila **sigue `pendiente`**) \| `503` (sin qBittorrent configurado) |
| `POST /api/admin/aportaciones/:id/rechazar` | `{ reason?: string }` | `200 { submission }` \| `404` \| `409` (no `pendiente`) |

Flujo de `aceptar`:
1. Si `qbittorrent` es `null` → `503`.
2. Buscar la aportación. `404` si no existe; `409` si `status !== 'pendiente'`.
3. `qbittorrent.addTorrent({ url | file+fileName, category })`.
   - Fallo (`QbittorrentError`) → `502 { error: <mensaje legible> }`, **no** se toca la fila.
4. Éxito → en una transacción: `status='procesada'`, `processed_at=now`,
   `processed_by=<admin>`; luego borrar el fichero (best-effort).
5. `200 { submission }`.

Flujo de `rechazar`: `404` / `409` como arriba; si no, `status='rechazada'`,
`rejection_reason = reason?.trim() || null`, `processed_at`, `processed_by`; borrar el
fichero (best-effort); `200 { submission }`.

### Formas JSON

```
Submission = {
  id, description, category, sourceType, sourceUrl, fileName,
  status, rejectionReason, createdAt, processedAt, processedBy
}
AdminSubmission = Submission & { username }   // jellyfin_username del autor
```

## Cliente de qBittorrent

`server/src/qbittorrent.ts`:

- `export class QbittorrentError extends Error {}`
- `export interface QbittorrentClient { addTorrent(input: { url?: string; file?: Uint8Array; fileName?: string; category: string }): Promise<void> }`
- `export function createQbittorrentClient(baseUrl: string, user: string, password: string): QbittorrentClient`

Comportamiento de `addTorrent`:
1. Sin `SID` cacheado → `POST {baseUrl}/api/v2/auth/login` con `Content-Type:
   application/x-www-form-urlencoded`, body `username=<user>&password=<pass>`, cabecera
   `Referer: {baseUrl}`. Respuesta `200` con cuerpo `Ok.` y `Set-Cookie: SID=...` →
   cachear el SID. Cuerpo `Fails.` o sin cookie → `QbittorrentError('No se pudo
   autenticar con qBittorrent')`.
2. `POST {baseUrl}/api/v2/torrents/add` con `FormData` nativo:
   - siempre `category`;
   - si `url` → campo `urls` con la URL/magnet;
   - si `file` → campo `torrents` = `new Blob([file], { type: 'application/x-bittorrent' })`
     con nombre `fileName`;
   - cabeceras `Cookie: SID=<sid>`, `Referer: {baseUrl}` (no fijar `Content-Type`: lo
     pone `fetch` con el boundary).
3. `403` → SID caducado: re-login una vez y reintentar la petición de add. Un segundo
   `403` → `QbittorrentError`.
4. Respuesta `200` con cuerpo `Ok.` → éxito. Cuerpo distinto de `Ok.` (incluye
   `Fails.`), `415`, o cualquier `!response.ok` → `QbittorrentError` con un mensaje
   legible que incluya el cuerpo si lo hay.
5. Fallo de red (fetch lanza) en cualquier paso → `QbittorrentError`.

Se inyecta en `AppConfig` como `qbittorrent: QbittorrentClient | null`.

**Categorías:** se pasa el string tal cual. Si la categoría no existe en qBittorrent, el
torrent se añade igualmente (queda sin categoría asignada según la versión). No se crean
categorías desde archivo-oasis.

## Cambios en el frontend

- **`src/routes/AppRoutes.tsx`**: la ruta `/archivo/aportaciones` pasa de `<Placeholder
  title="Aportaciones" need="aportaciones" />` a `<AportacionesPage />`.
- **`src/pages/Archivo/AportacionesPage.tsx`** (nuevo) + **`AportacionesPage.module.css`**
  (nuevo). Usa `useAuth`. `HomeButton` arriba-izquierda (patrón ya existente).
  - Guard: `status` loading/offline como el resto; si no hay sesión o
    `!(permissions.includes('aportaciones') || isAdmin)` → "Solo el penitente pasará" +
    botón a `/`.
  - **Parte usuario** (si `permissions.includes('aportaciones')`):
    - Formulario: `description` (`<textarea maxLength={280}>` + contador), `category`
      (`<select>`: Películas→movies, Series→tv, Música→music), origen (`<input
      type="radio">` Enlace / Fichero), y según el radio un `<input type="text">` para la
      URL o un `<input type="file" accept=".torrent">`. Al enviar, si es fichero se lee
      con `FileReader`/`arrayBuffer` y se pasa a base64. Éxito → limpia el formulario y
      antepone la nueva aportación a la lista.
    - Tabla de sus aportaciones (recientes primero): Descripción, Categoría, Fecha,
      Estado (badge de color), y si `rechazada` con `rejectionReason` se muestra el
      motivo. Botón "Cancelar" en filas `pendiente` → `window.confirm` → `DELETE` →
      quita la fila.
  - **Parte admin** (si `isAdmin`), debajo, separada por una cabecera "Moderación":
    - Filtro de estado: `<select>` Todas / Pendientes / Procesadas / Rechazadas → refetch
      con `?status=`.
    - Tabla: Usuario, Descripción, Categoría, Origen (URL truncada con `<a>` a ella, o el
      nombre del fichero), Fecha, Estado, Acciones.
    - En filas `pendiente`: "Aceptar" y "Denegar". "Aceptar" → `POST .../aceptar`; en
      `502` muestra el error de qBittorrent junto a la fila y la deja `pendiente`; en
      `503` muestra "qBittorrent no está configurado". "Denegar" → `window.prompt('Motivo
      (opcional):')` → `POST .../rechazar`. Éxito → actualiza la fila.
- **`src/lib/authApi.ts`** (modificado): tipos `SubmissionCategory =
  'movies'|'tv'|'music'`, `SubmissionStatus = 'pendiente'|'procesada'|'rechazada'`,
  `Submission`, `AdminSubmission`; funciones:
  - `createSubmission(input): Promise<Submission>`
  - `fetchMySubmissions(): Promise<Submission[]>`
  - `deleteSubmission(id: number): Promise<void>`
  - `fetchAdminSubmissions(status?: SubmissionStatus): Promise<AdminSubmission[]>`
  - `acceptSubmission(id: number): Promise<Submission>`
  - `rejectSubmission(id: number, reason?: string): Promise<Submission>`
- **`src/pages/Archivo/Placeholder.tsx`** deja de usarse para aportaciones pero sigue en
  uso para `cantina`; no se toca.

## Cambios en el backend

Ficheros nuevos en `server/src/`:
- `qbittorrent.ts` (+ `qbittorrent.test.ts`)
- `submissions.ts` — modelo de la tabla `submissions` (+ `submissions.test.ts`)
- `submissionFiles.ts` — helpers de disco: `submissionFilePath(dataDir, id)`,
  `writeSubmissionFile(dataDir, id, bytes)`, `deleteSubmissionFile(dataDir, id)`
  (best-effort, no lanza).
- `routes/aportaciones.ts` (+ `routes/aportaciones.test.ts`) — rutas de usuario.

Ficheros modificados:
- `db.ts` — `CREATE TABLE submissions`.
- `middleware.ts` — `requirePermission(appKey: AppKey): RequestHandler` (usa
  `findUserByUsername` + `getPermissions`; `401` sin sesión, `403` sin permiso).
- `app.ts` — `AppConfig` gana `qbittorrent: QbittorrentClient | null` y `dataDir: string`
  (las rutas de aportaciones necesitan la ruta de datos para los ficheros); monta
  `createAportacionesRouter` en `/api/aportaciones`; pasa lo necesario a
  `createAdminRouter`.
- `routes/admin.ts` — `createAdminRouter` gana parámetros `qbittorrent` y `dataDir`;
  añade `GET /aportaciones`, `POST /aportaciones/:id/aceptar`, `POST
  /aportaciones/:id/rechazar`.
- `routes/admin.test.ts`, `routes/auth.test.ts` — actualizar el helper `createApp({...})`
  con los campos nuevos de `AppConfig` (`qbittorrent: null`, `dataDir`).
- `index.ts` — leer `QBITTORRENT_URL` / `QBITTORRENT_USER` / `QBITTORRENT_PASSWORD`;
  construir `qbittorrent` o `null` (con `console.warn` si falta); pasar `dataDir` y
  `qbittorrent` a `createApp`.
- `express.json()` — subir el límite a `5mb` (para el `fileBase64`). Se aplica global
  (simple) o solo a la ruta de aportaciones; el diseño usa global por simplicidad.

## Infra

- `docker-compose.yml` — añadir `QBITTORRENT_URL`, `QBITTORRENT_USER`,
  `QBITTORRENT_PASSWORD` al servicio `archivo-oasis-api`.
- `.env.example` y `server/.env.example` — documentar las tres variables.
- `README.md` — añadirlas a la lista de variables del backend.
- `docker/nginx.conf` — sin cambios (`/api/*` ya se reenvía; el body de 5 MB pasa sin
  problema, pero se añade `client_max_body_size 6m;` al `location /api/` por si el
  default de nginx (1 MB) lo corta).
- `deploy.yml` — sin cambios de build.

## Manejo de errores (resumen)

| Situación | Código |
|---|---|
| `POST /api/aportaciones` inválido | `400` con motivo concreto |
| Sin sesión | `401` |
| Sesión sin permiso `aportaciones` | `403` |
| `DELETE` de otro usuario | `403` |
| `DELETE` de algo ya procesado/rechazado | `409` |
| Aportación inexistente | `404` |
| `aceptar` / `rechazar` sobre algo no `pendiente` | `409` |
| qBittorrent falla al aceptar | `502 { error }`, fila sigue `pendiente` |
| qBittorrent no configurado | `503` |

Frontend: errores de formulario inline sin borrar lo escrito; errores de acción de tabla
junto a la fila o en un aviso de sección; fallo de carga inicial → estado vacío + aviso
(no "Cargando…" perpetuo).

## Testing

**Backend** (`node:test`, SQLite `:memory:`, `QbittorrentClient` falso, `DATA_DIR` a un
directorio temporal por test):

- `submissions.test.ts`: `createSubmission` inserta `pendiente`; `listByUser` filtra por
  usuario y ordena `created_at` desc; `getSubmission`; `deleteSubmission` solo si es del
  usuario y `pendiente`; `setStatus` (procesada/rechazada con motivo, `processed_by`);
  `listAll` con y sin filtro de estado, incluye `username`.
- `submissionFiles.test.ts`: `write` crea el fichero con los bytes; `delete` lo borra y
  no lanza si no existe; `path` es determinista.
- `qbittorrent.test.ts` (fetch-stub): login manda el form correcto y captura el SID;
  `addTorrent` con `url` → el `FormData` lleva `urls` + `category`; con `file` → lleva
  `torrents` + `category`; `403` en add → re-login y reintento; cuerpo `Fails.` →
  `QbittorrentError`; fallo de red → `QbittorrentError`.
- `routes/aportaciones.test.ts`: `POST` con URL crea `201`; `POST` con `fileBase64` crea
  `201` y escribe el fichero; `400` para descripción > 280, categoría inválida, origen
  ausente, `fileName` sin `.torrent`, fichero > 2 MB; `GET` devuelve solo las del
  llamante, recientes primero; `DELETE` de una propia `pendiente` → `204` y el fichero
  desaparece; `DELETE` de otra persona → `403`; `DELETE` de una `procesada` → `409`;
  sesión sin permiso `aportaciones` → `403` en todas.
- `routes/admin.test.ts` (ampliado): `GET /api/admin/aportaciones` lista todas y filtra
  por `?status=`; `aceptar` → el `QbittorrentClient` falso registra la llamada, la fila
  pasa a `procesada` y el fichero se borra; `aceptar` cuando el falso lanza → `502` y la
  fila sigue `pendiente`; `aceptar` sobre no-`pendiente` → `409`; `aceptar` con
  `qbittorrent: null` → `503`; `rechazar` → `rechazada` + motivo; `rechazar` sobre
  no-`pendiente` → `409`; no-admin → `403`.

**Frontend**: verificación manual con el backend y un qBittorrent real (patrón del
proyecto): enviar por URL y por fichero, ver la aportación en "pendiente", cancelarla;
como admin filtrar por estado, aceptar (comprobar que aparece en qBittorrent con la
categoría), denegar con motivo y ver el motivo como usuario; comprobar `503` con
qBittorrent apagado.

## Fuera de alcance

- Notificaciones (email, etc.) al cambiar de estado.
- Reintentos automáticos del envío a qBittorrent.
- Edición de una aportación ya enviada (solo cancelar mientras esté `pendiente`).
- Rutas de guardado por categoría en qBittorrent (se configuran en qBittorrent).
- Paginación de las tablas (a este volumen no hace falta; se ordena y ya).
- Ver el progreso de la descarga en qBittorrent desde archivo-oasis.
