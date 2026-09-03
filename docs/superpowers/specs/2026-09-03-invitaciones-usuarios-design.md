# Configuración → Usuarios: permisos + invitaciones a Jellyfin — diseño

Fecha: 2026-09-03

## Objetivo

Ampliar la sección de administración (`/archivo/admin`) con una categoría **Usuarios**
que agrupa dos herramientas:

1. **Permisos** — la gestión de permisos por usuario que ya existe hoy, movida sin
   cambios de comportamiento a su propia sub-página.
2. **Invitaciones** — herramienta nueva para generar URLs de un solo uso con las que
   una persona externa crea su propia cuenta de Jellyfin (nombre + contraseña) y
   obtiene acceso a `teatro.archivo-oasis.com` (Jellyfin) y `peticiones.archivo-oasis.com`
   (Jellyseerr), además de acceso automático a esas dos secciones en el dashboard de
   archivo-oasis.

Es la primera categoría de una Configuración pensada para crecer (Jellyfin, La Cantina,
etc. tendrán sus propias categorías más adelante), así que el layout se construye ya
como un menú lateral de categorías → ítems.

## Contexto

`archivo-oasis` ya tiene desde la pieza base (`2026-09-01-interior-base-design.md`) un
backend propio (`archivo-oasis-api`, Node.js + SQLite) detrás de nginx en `/api/*`, con
sesión en cookie httpOnly y un panel de admin que lista usuarios y concede/revoca
permisos sobre cuatro `app_key`: `jellyfin`, `jellyseerr`, `cantina`, `aportaciones`.

Hoy un usuario de archivo-oasis solo se crea la primera vez que inicia sesión
correctamente contra Jellyfin. No existe forma de crear usuarios de Jellyfin desde
archivo-oasis: para eso hace falta la API key de admin de Jellyfin, que hasta ahora
estaba deliberadamente fuera de alcance. Esta pieza la introduce.

**Jellyseerr** ya está configurado con "Enable Jellyfin Sign-In": cualquier usuario de
Jellyfin puede entrar en `peticiones.archivo-oasis.com` con sus credenciales de Jellyfin
y Jellyseerr crea su cuenta al primer login. Por tanto, **crear el usuario en Jellyfin
es suficiente**; esta pieza no integra la API de Jellyseerr.

## Alcance

Dentro:

- Menú lateral de categorías en `/archivo/admin`; categoría **Usuarios** con ítems
  **Permisos** e **Invitaciones**.
- Extraer el panel de permisos actual a su sub-página sin cambiar su comportamiento.
- Tabla `invites` en SQLite.
- Cliente de administración de Jellyfin (`jellyfinAdmin.ts`) autenticado con API key.
- Rutas de admin para crear / listar / revocar invitaciones.
- Rutas públicas (sin sesión) para consultar y consumir un token de invitación.
- Página pública `/invitacion/:token` con formulario de registro y pantalla de éxito.
- Pre-crear la fila del usuario en archivo-oasis con permisos `jellyfin` y `jellyseerr`
  al consumir la invitación.
- Variable de entorno nueva `JELLYFIN_API_KEY` en `docker-compose.yml` y `deploy.yml`.

Fuera:

- Integración con la API de Jellyseerr (no hace falta: sign-in con Jellyfin ya activo).
- Recuperación de contraseña o edición de cuentas de Jellyfin desde archivo-oasis.
- Invitaciones con caducidad configurable, invitaciones multi-uso, límite de usos.
- Rate-limiting de los endpoints públicos (el control es la entropía del token de 256
  bits; el app es privado y de bajo tráfico).
- Reorganizar o renombrar las otras futuras categorías de Configuración.
- Notificaciones por email al generar o consumir una invitación.

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Acceso a Jellyseerr | Sign-in con Jellyfin ya activo → solo se crea el usuario en Jellyfin. |
| Cuenta de archivo-oasis | Al consumir la invitación se pre-crea la fila del usuario con `jellyfin` y `jellyseerr` concedidos. |
| Vida de la invitación | Un solo uso + caducidad fija a 7 días + el admin puede revocar. |
| Layout de Configuración | Menú lateral de categorías → ítems. `Usuarios` es la primera. |
| Bibliotecas de Jellyfin | Todas, actuales y futuras: es el valor por defecto de Jellyfin para usuarios nuevos (`EnableAllFolders`), así que no se hace ninguna llamada a `/Users/{Id}/Policy`. |
| Pantalla de éxito | Bienvenida con enlaces a teatro, peticiones y `/archivo`. Sin login automático. |
| URL de la invitación | La construye el frontend con `window.location.origin`; sin config nueva. |

## Arquitectura

```
Navegador (admin)                         Navegador (invitado, sin sesión)
   │  /archivo/admin/invitaciones            │  /invitacion/:token
   ▼                                         ▼
nginx (archivo-oasis)  ──────────────────────────────────────────────
   └── /api/*  → archivo-oasis-api
                   ├── /api/admin/invites*      (requireAdmin)
                   └── /api/invites/:token      (público)
                          │
                          ├── SQLite: tabla invites, users, permissions
                          └── jellyfinAdmin  → Jellyfin  (POST /Users/New, /Password)
                                                con X-Emby-Token: JELLYFIN_API_KEY
```

Variables de entorno del backend (se añade una):

- `JELLYFIN_URL` — ya existe.
- `ADMIN_JELLYFIN_USERNAME` — ya existe.
- `SESSION_SECRET` — ya existe.
- **`JELLYFIN_API_KEY`** — nueva. API key de administrador generada en Jellyfin
  (Panel → Avanzado → Claves API). Genuinamente secreta.

Si `JELLYFIN_API_KEY` no está definida, el backend arranca igual pero las rutas de
invitaciones responden `503` con un mensaje claro (permite desplegar el resto sin
bloquear si la key aún no está lista).

## Modelo de datos (SQLite)

Tabla nueva, creada en el mismo `createDb` con `CREATE TABLE IF NOT EXISTS`:

```sql
CREATE TABLE invites (
  token TEXT PRIMARY KEY,          -- 32 bytes aleatorios en base64url
  label TEXT,                      -- nota opcional del admin ("para Marta")
  created_by TEXT NOT NULL,        -- jellyfin_username del admin que la generó
  created_at TEXT NOT NULL,        -- ISO 8601
  expires_at TEXT NOT NULL,        -- created_at + 7 días
  used_at TEXT,                    -- NULL mientras no se consume
  used_by_username TEXT,           -- nombre del usuario de Jellyfin creado
  revoked_at TEXT                  -- NULL salvo revocación por el admin
);
```

Estado derivado en tiempo de lectura (no se persiste), en este orden de prioridad:

1. `revoked_at` no NULL → `revoked`
2. `used_at` no NULL → `used`
3. `expires_at` < ahora → `expired`
4. en otro caso → `valid`

**Cambio en la tabla `users`:** `last_login_at` pasa de `NOT NULL` a nullable. Un
usuario pre-creado por invitación todavía no ha iniciado sesión en archivo-oasis. El
panel de permisos muestra "—" en "último acceso" mientras `last_login_at` sea NULL;
`upsertUserLogin` lo rellena en el primer login real. Como la base de datos está en
pre-producción, el cambio se aplica editando el `CREATE TABLE` del esquema y recreando
la BD de desarrollo. (Si se decide conservar datos: `ALTER TABLE` no puede quitar un
`NOT NULL` en SQLite; requeriría recrear la tabla. Se documenta en el plan como paso
opcional.)

## API

### Admin (requieren sesión de admin — `requireAdmin`)

| Endpoint | Cuerpo | Respuesta |
|---|---|---|
| `POST /api/admin/invites` | `{ label?: string }` | `201 { invite: InviteSummary }` |
| `GET /api/admin/invites` | — | `200 { invites: InviteSummary[] }` ordenadas por `created_at` desc. |
| `DELETE /api/admin/invites/:token` | — | `204` si se revoca; `404` si no existe o ya está usada. |

`InviteSummary = { token, label, createdBy, createdAt, expiresAt, status, usedAt, usedByUsername }`
donde `status` es `valid | used | expired | revoked`. La URL completa la construye
siempre el frontend con `window.location.origin`; el backend no la devuelve.

### Público (sin sesión) — montado en `/api/invites`

| Endpoint | Cuerpo | Respuesta |
|---|---|---|
| `GET /api/invites/:token` | — | `200 { status }` con `status ∈ { valid, used, expired, revoked, not_found }`. `not_found` y `revoked` devuelven lo mismo hacia fuera. |
| `POST /api/invites/:token` | `{ username, password }` | `200 { ok: true }` en éxito; ver "Manejo de errores". |

## Flujo de consumo (`POST /api/invites/:token`)

1. Si falta `JELLYFIN_API_KEY` en el entorno → `503`.
2. Buscar el token y calcular su estado. Si no es `valid` → `410 { error, status }`
   (revalidado aquí, no basta con el `GET` previo).
3. Validar entrada:
   - `username`: requerido, sin espacios en blanco, `trim` aplicado, longitud 1–40.
   - `password`: requerido, longitud ≥ 6.
   - Si falla → `400 { error }` con el motivo concreto; el token no se toca.
4. `jellyfinAdmin.createUser(username, password)`:
   - `POST /Users/New` con `{ Name: username }` → obtiene `{ Id }`.
   - `POST /Users/{Id}/Password` con `{ NewPw: password }`.
   - No se llama a `/Users/{Id}/Policy`: el acceso a todas las bibliotecas
     (`EnableAllFolders`) es el valor por defecto de Jellyfin para los usuarios
     nuevos, así que no hace falta ninguna llamada de política.
   - Errores:
     - Jellyfin indica nombre duplicado → lanza `JellyfinUserExistsError` → `409`,
       token intacto.
     - Cualquier otro fallo de red o respuesta no OK → lanza `JellyfinAdminError` →
       `502`, token intacto.
5. Transacción SQLite (todo o nada):
   - `createInvitedUser(db, username)` → fila en `users` con `last_login_at` NULL
     (idempotente: si ya existe, la reutiliza).
   - `setPermission(db, userId, 'jellyfin', true)`.
   - `setPermission(db, userId, 'jellyseerr', true)`.
   - `UPDATE invites SET used_at = ?, used_by_username = ? WHERE token = ?`.
6. `200 { ok: true }`.

**Orden deliberado:** primero Jellyfin (la parte que falla por causas externas), y solo
tras su éxito se escribe en la BD local y se marca el token. Si el paso 5 fallara tras
crear la cuenta en Jellyfin (muy improbable — SQLite local), la cuenta de Jellyfin ya
existe y es funcional; la persona podría entrar a archivo-oasis por login normal (sin
los permisos automáticos) y un admin se los concede a mano. Se registra en el log del
servidor con nivel error.

**Concurrencia (doble envío):** el segundo POST encuentra el token ya `used` → `410`.
Si se cuela en la ventana previa a marcarlo, Jellyfin rechaza el nombre duplicado →
`409`. No quedan cuentas huérfanas ni el token se consume dos veces.

## Manejo de errores

### `GET /api/invites/:token`

Nunca es un error HTTP; siempre `200 { status }`. La página pública decide qué pintar:

| status | Pantalla |
|---|---|
| `valid` | Formulario usuario + contraseña. |
| `used` | "Esta invitación ya se ha usado." |
| `expired` | "Esta invitación ha caducado. Pide una nueva." |
| `revoked` / `not_found` | "Esta invitación no es válida." (mismo texto para ambos). |

### `POST /api/invites/:token`

| Situación | Código | Cuerpo |
|---|---|---|
| Falta `JELLYFIN_API_KEY` | `503` | `{ error: 'La creación de cuentas no está disponible ahora mismo' }` |
| Token no `valid` | `410` | `{ error, status }` |
| `username` / `password` inválidos | `400` | `{ error }` con el motivo |
| Nombre ya existe en Jellyfin | `409` | `{ error: 'Ese nombre de usuario ya está en uso' }` — token intacto |
| Jellyfin inalcanzable o error | `502` | `{ error: 'No se pudo crear la cuenta ahora mismo, inténtalo más tarde' }` — token intacto |
| Éxito | `200` | `{ ok: true }` |

### Endpoints de admin

`requireAdmin` → `401` sin sesión, `403` si no es admin. `DELETE` sobre token
inexistente o ya usado → `404`. Crear invitación no falla salvo error de BD (`500`).

### Frontend

- **`/invitacion/:token`**: al montar hace `GET` y decide la pantalla. Los errores del
  `POST` se muestran inline bajo el formulario sin borrar lo escrito. `409` permite
  reintentar con otro nombre; `410` sustituye el formulario por el mensaje de invitación
  no válida. Fallo de red en el `GET` → "No se pudo comprobar la invitación, recarga la
  página".
- **`InvitacionesPage`**: fallo al generar o revocar → aviso breve, sin recargar toda la
  tabla. Tras generar con éxito, la nueva invitación aparece arriba con su URL y un
  botón de copiar.

## Cambios en el frontend

### Reestructuración de `/archivo/admin`

Componentes nuevos / modificados en `src/pages/Archivo/`:

- **`AdminLayout.tsx`** (nuevo) — asume la guarda que hoy está en `AdminPanel.tsx`
  (estados `loading`, `offline`, no-admin → "Solo el penitente pasará"). Renderiza el
  menú lateral y un `<Outlet/>`. El menú se define como una lista de grupos:
  `[{ label: 'Usuarios', items: [{ label: 'Permisos', to: 'permisos' }, { label: 'Invitaciones', to: 'invitaciones' }] }]`.
- **`admin/PermisosPage.tsx`** (nuevo, extraído de `AdminPanel.tsx`) — la tabla de
  permisos actual tal cual: `fetchAdminUsers`, `setUserPermission`, checkboxes. Sin
  cambios de comportamiento salvo mostrar "—" cuando `lastLoginAt` es null.
- **`admin/InvitacionesPage.tsx`** (nuevo) — botón "Generar invitación" (con campo
  opcional de nota), lista de invitaciones con estado / fecha / caducidad y botón
  "Revocar" en las `valid`. Cada fila `valid` muestra su URL completa
  (`${window.location.origin}/invitacion/${token}`) con botón de copiar.
- **`AdminPanel.tsx`** se elimina (su contenido se reparte entre `AdminLayout` y
  `PermisosPage`).
- **`AdminPanel.module.css`** se renombra / divide según haga falta para los nuevos
  componentes (`AdminLayout.module.css`, `InvitacionesPage.module.css`).

### Página pública de invitación

- **`src/pages/Invitacion/Invitacion.tsx`** (nuevo) — lee `:token` de la URL, hace el
  `GET`, y según el `status` muestra el formulario o el mensaje correspondiente. En
  éxito: pantalla de bienvenida con tres enlaces (teatro, peticiones, `/archivo`).
- **`src/pages/Invitacion/Invitacion.module.css`** (nuevo).
- No usa `useAuth` ni ninguna guarda.

### Cliente HTTP del frontend

- **`src/lib/authApi.ts`** (modificado) — añade:
  - `generateInvite(label?: string): Promise<InviteSummary>`
  - `fetchInvites(): Promise<InviteSummary[]>`
  - `revokeInvite(token: string): Promise<void>`
  - `fetchInviteStatus(token: string): Promise<InviteStatus>`
  - `consumeInvite(token, username, password): Promise<void>`
  - tipos `InviteSummary`, `InviteStatus`.

### Rutas (`src/routes/AppRoutes.tsx`)

```
/archivo/admin            → <AdminLayout/>
    index                 → redirect a "permisos"
    permisos              → <PermisosPage/>
    invitaciones          → <InvitacionesPage/>
/invitacion/:token        → <Invitacion/>            (sin guarda)
```

El dashboard (`Dashboard.tsx`) ya enlaza a `/archivo/admin`; sigue igual (cae en el
índice → `permisos`).

## Cambios en el backend

Ficheros nuevos en `server/src/`:

- **`jellyfinAdmin.ts`**
  - `export class JellyfinAdminError extends Error {}`
  - `export class JellyfinUserExistsError extends JellyfinAdminError {}`
  - `export interface JellyfinAdminClient { createUser(username: string, password: string): Promise<void> }`
  - `export function createJellyfinAdminClient(baseUrl: string, apiKey: string): JellyfinAdminClient`
  - Autentica con la cabecera `X-Emby-Token: <apiKey>`.
- **`invites.ts`** (modelo) — o funciones nuevas dentro de `models.ts`:
  - `export interface InviteRecord { token; label; createdBy; createdAt; expiresAt; usedAt; usedByUsername; revokedAt }`
  - `export type InviteStatus = 'valid' | 'used' | 'expired' | 'revoked'`
  - `createInvite(db, { createdBy, label }): InviteRecord` — genera token, `expires_at = now + 7d`.
  - `findInvite(db, token): InviteRecord | undefined`
  - `inviteStatus(invite, now = new Date()): InviteStatus`
  - `listInvites(db): (InviteRecord & { status: InviteStatus })[]`
  - `markInviteUsed(db, token, username): void`
  - `revokeInvite(db, token): boolean` — `false` si no existe o ya usada.
- **`routes/invites.ts`** — `createInvitesRouter(db, jellyfinAdmin: JellyfinAdminClient | null)`.
  Montado en `app.ts` bajo `/api/invites`. Si `jellyfinAdmin` es `null` (sin API key),
  el `POST` responde `503`.

Ficheros modificados:

- **`models.ts`** — `createInvitedUser`; `last_login_at` nullable en `toUserRecord` y en
  `listUsersWithPermissions` (permitir null).
- **`db.ts`** — `CREATE TABLE invites`; `users.last_login_at` sin `NOT NULL`.
- **`routes/admin.ts`** — endpoints `POST/GET/DELETE /invites`.
- **`app.ts`** — `AppConfig` gana `jellyfinAdmin: JellyfinAdminClient | null`; monta el
  router público de invitaciones.
- **`index.ts`** — lee `JELLYFIN_API_KEY`; si está, crea el `jellyfinAdmin` real; si no,
  pasa `null` y lo registra en el log al arrancar.

## Infra

- **`docker-compose.yml`** — añade `- JELLYFIN_API_KEY=${JELLYFIN_API_KEY}` al servicio
  `archivo-oasis-api`.
- **`.github/workflows/deploy.yml`** — sin cambios de build; la variable se inyecta en
  el despliegue (secreto). Documentar en el `.env` de ejemplo del despliegue.
- **`docker/nginx.conf`** — sin cambios: `/api/*` ya se reenvía y el fallback SPA
  (`try_files ... /index.html`) ya cubre `/invitacion/:token`.

## Testing

### Backend (`node:test` + SQLite en memoria + doble de `JellyfinAdminClient`)

`jellyfinAdmin` de prueba: registra las llamadas a `createUser`; variantes que lanzan
`JellyfinUserExistsError` y `JellyfinAdminError`.

- **`invites.test.ts` (modelo, nuevo):**
  - `createInvite` fija `expires_at` a +7 días y estado inicial `valid`.
  - `inviteStatus`: `valid`; `expired` con `expires_at` en el pasado; `used` tras
    `markInviteUsed`; `revoked` tras `revokeInvite`; prioridad `revoked` > `used` >
    `expired`.
  - `revokeInvite` devuelve `false` sobre token inexistente o ya usado.
  - `createInvitedUser` inserta con `last_login_at` NULL y es idempotente.
- **`routes/admin.test.ts` (amplía):**
  - `POST /api/admin/invites` como admin → `201` con token y `expiresAt`.
  - no-admin / sin sesión → `403` / `401`.
  - `GET /api/admin/invites` lista con los `status` correctos.
  - `DELETE` revoca; consumo posterior → `410`.
  - `DELETE` sobre token usado → `404`.
- **`routes/invites.test.ts` (nuevo):**
  - `GET` de token `valid` / `used` / `expired` / `revoked` / inexistente → `status`
    esperado (`not_found` para inexistente).
  - `POST` válido → el doble registra `createUser(username, password)`; en la BD el
    usuario existe con permisos `jellyfin` y `jellyseerr`; el token queda `used` con
    `used_by_username`.
  - `POST` con token ya usado → `410`, sin segunda llamada al doble.
  - `POST` con `password` de 5 caracteres → `400`, token intacto, sin llamada al doble.
  - `POST` con `username` vacío o con espacios → `400`.
  - `POST` cuando el doble lanza `JellyfinUserExistsError` → `409`, token intacto.
  - `POST` cuando el doble lanza `JellyfinAdminError` → `502`, token intacto.
  - `POST` con `jellyfinAdmin` = `null` → `503`.

### Frontend (verificación manual con el backend en local, patrón del proyecto)

1. Como admin, ir a `/archivo/admin` → cae en **Permisos**; la tabla funciona igual que
   antes; el menú lateral muestra el grupo **Usuarios** con **Permisos** e
   **Invitaciones**.
2. En **Invitaciones**, generar una con nota "prueba"; aparece arriba con su URL y
   botón de copiar; estado `valid`.
3. Abrir la URL en una ventana de incógnito → formulario de usuario + contraseña.
   - Contraseña corta → error inline, no avanza.
   - Nombre + contraseña válidos → pantalla de bienvenida con los tres enlaces.
4. Iniciar sesión en `teatro.archivo-oasis.com` y en `peticiones.archivo-oasis.com` con
   esas credenciales → ambas funcionan.
5. Iniciar sesión en archivo-oasis con esas credenciales → el dashboard muestra los
   cuadros de Jellyfin y Jellyseerr directamente (sin "pendiente de aprobación").
6. Recargar la URL de la invitación → "Esta invitación ya se ha usado".
7. Generar otra, revocarla desde el panel, abrir su URL → "no es válida".
8. En el panel de Permisos, el usuario nuevo aparece; "último acceso" con fecha real
   tras el paso 5.

## Riesgos y mitigaciones

- **La API key de Jellyfin da acceso total a Jellyfin.** Vive solo en el backend, nunca
  en el bundle del frontend, y se pasa como secreto de despliegue. Mismo modelo que
  `SESSION_SECRET`.
- **Endpoint público que crea cuentas reales.** El único gate es el token de 256 bits de
  un solo uso y 7 días de vida. Aceptable para un servicio privado y de bajo volumen;
  si en el futuro hace falta, se añade rate-limiting por IP.
- **Variantes de la API de Jellyfin entre versiones** (crear con contraseña en
  `/Users/New` vs. `/Users/{Id}/Password` aparte). El cliente hace siempre los dos
  pasos: crear por nombre y fijar contraseña por separado, que funciona en todas las
  versiones actuales.
- **Cambio de `NOT NULL` en `users.last_login_at`.** SQLite no permite quitarlo con
  `ALTER TABLE`; en pre-producción se recrea la BD. El plan incluye el paso y la
  alternativa (recrear tabla) por si hay datos que conservar.
