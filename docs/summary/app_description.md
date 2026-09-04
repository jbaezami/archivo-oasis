# archivo-oasis — descripción completa de la aplicación

> Guía de referencia del estado actual de la app: arquitectura, stack, partes,
> infraestructura, configuración, funcionalidades presentes y futuras, y
> convenciones para iniciar nuevos desarrollos.
>
> Última revisión: 2026-09-04. Si algo aquí no cuadra con el código, gana el código —
> este documento es una foto, no estado vivo.

---

## 1. Qué es

`archivo-oasis` (dominio `archivo-oasis.com`) es el portal de los servicios
self-hosted del autor. Tiene dos mitades:

- **Portada pública (`/`)** — una escena 3D con una puerta. Es el "hall de entrada".
- **Parte interna (`/archivo` y sub-rutas)** — un dashboard tras autenticación
  (contra Jellyfin) donde cada usuario ve solo las secciones a las que un
  administrador le ha dado acceso: enlaces a Jellyfin/Jellyseerr, un foro (La
  Cantina, aún placeholder), y **Aportaciones** (proponer torrents que el admin
  aprueba y se mandan a qBittorrent). Un panel de **Configuración** para el admin
  (permisos por usuario, invitaciones de un solo uso a Jellyfin).

La app nació 100 % estática (Vite + nginx) y ganó un backend propio cuando hicieron
falta identidad y permisos por usuario.

---

## 2. Arquitectura de alto nivel

```
Navegador
   │  HTTPS
   ▼
Cloudflare (edge)  ──►  cloudflared (túnel, red docker `red-cloudflare`)
                              │  HTTP
                              ▼
                   ┌─────────────────────────────┐
                   │ contenedor `archivo-oasis`  │  nginx:1.27-alpine
                   │  - sirve el build de Vite   │  (estáticos SPA)
                   │  - /api/* → proxy_pass       │
                   └──────────────┬──────────────┘
                                  │  HTTP  (red docker `default`)
                                  ▼
                   ┌─────────────────────────────┐
                   │ contenedor `archivo-oasis-api` │ node:22, Express
                   │  - SQLite en volumen /data  │
                   │  - clientes: Jellyfin, Jellyfin-admin, qBittorrent │
                   │  - ficheros .torrent en /data/aportaciones/ │
                   └──────────────┬──────────────┘
                                  │
                   ┌──────────────┴───────────────────────────┐
                   ▼                    ▼                       ▼
             Jellyfin            Jellyseerr              qBittorrent
        (teatro.archivo-        (peticiones.…          (qbittorrent.…
         oasis.com)              — solo login            — WebUI API)
                                  con Jellyfin)
```

- **Dos imágenes Docker**, dos contenedores, un solo `docker-compose.yml`.
- El navegador solo habla con `archivo-oasis` (mismo origen para todo, incluida la
  cookie de sesión). nginx reenvía `/api/*` al backend.
- El TLS lo termina Cloudflare; dentro de la red Docker todo es HTTP.

---

## 3. Stack técnico

### Frontend (`/`, raíz del repo)

| Pieza | Versión | Para qué |
|---|---|---|
| React | 18.3 | UI |
| react-router-dom | 6.26 | rutas (SPA, `BrowserRouter`) |
| Vite | 5.4 | dev server + bundler |
| TypeScript | 5.5 | `strict`, `noUnusedLocals`, `noUnusedParameters` |
| three / @react-three/fiber / @react-three/drei | 0.185 / 8.18 / 9.122 | escena 3D de la portada |
| concurrently | 9 (devDep) | `npm run dev` levanta frontend + API a la vez |

- **CSS Modules** (`*.module.css` por componente). No hay framework CSS ni sistema de
  design tokens — se copian los mismos valores (paleta neón).
- Sin librería de estado global; `useState` local + un hook `useAuth`.
- Sin tests unitarios de frontend (decisión del proyecto). Verificación: `tsc` +
  `npm run build` + prueba manual.

### Backend (`server/`)

| Pieza | Versión | Para qué |
|---|---|---|
| Node.js | ≥ 20 (imagen `node:22`) | runtime |
| Express | 4.22 | HTTP |
| better-sqlite3 | 13 | BD embebida, síncrona |
| cookie-session | 2.1 | sesión firmada en cookie httpOnly |
| TypeScript | 5.9 | `module: CommonJS`, `strict` |
| tsx | 4.23 (devDep) | ejecutar TS en dev (`tsx watch`) y tests (`tsx --test`) |
| `node:test` | nativo | tests (sin Jest/Vitest/Mocha) |

- **Sin dependencias más allá de esas 3 de runtime.** Los `.torrent` viajan en base64
  dentro del JSON (no hay `multer`); las llamadas HTTP salientes usan `fetch` /
  `FormData` / `Blob` globales de Node ≥18; los tokens usan `node:crypto`; el `.env`
  local se parsea con código propio.
- **~100 tests** (`node:test`, SQLite `:memory:`, dobles inyectados para los servicios
  externos). Cobertura de todas las rutas y modelos.

---

## 4. Estructura de ficheros

### Frontend

```
src/
├── main.tsx                     # createRoot + <BrowserRouter><App/>
├── App.tsx                      # solo <AppRoutes/>
├── index.css                    # reset/base global
├── routes/AppRoutes.tsx         # TODAS las rutas
├── lib/
│   ├── authApi.ts               # cliente HTTP de /api/* + tipos compartidos
│   └── useAuth.ts               # hook de sesión (loading|authenticated|anonymous|offline)
└── pages/
    ├── Home/                    # portada 3D
    │   ├── Home.tsx  Scene.tsx  Door.tsx  JumpKeys.tsx
    │   ├── useJumpKeys.ts  jumpRiff.ts     # el "puzzle" del riff
    │   └── LoginModal.tsx                  # modal de login (usa authApi.login)
    ├── Archivo/                 # parte interna
    │   ├── Archivo.tsx          # guard de sesión + monta <Dashboard>
    │   ├── Dashboard.tsx        # cuadros según session.permissions (+ Configuración si isAdmin)
    │   ├── Placeholder.tsx      # página "próximamente" con guard por permiso (La Cantina)
    │   ├── HomeButton.tsx       # botón circular fijo arriba-izquierda → /
    │   ├── LogoutButton.tsx     # botón circular fijo arriba-derecha → logout
    │   ├── AdminLayout.tsx      # /archivo/admin: guard de admin + menú lateral + <Outlet/>
    │   ├── PermisosPage.tsx     # tabla de permisos (conceder/revocar, eliminar usuario)
    │   ├── InvitacionesPage.tsx # generar/listar/revocar invitaciones
    │   └── AportacionesPage.tsx # formulario de usuario + panel de moderación (si isAdmin)
    └── Invitacion/
        └── Invitacion.tsx       # /invitacion/:token — PÚBLICA, sin sesión

public/
├── favicon.svg
├── fonts/orbitron-700.woff     # fuente del rótulo 3D (self-host)
└── models/door.glb             # modelo de la puerta
```

### Backend

```
server/src/
├── index.ts             # entrypoint: carga .env local, lee env vars, construye clientes, app.listen
├── app.ts               # createApp(config): monta middleware + routers. AppConfig es el contrato de DI
├── session.ts           # cookie-session (httpOnly, sameSite lax, secure en producción, 30 días)
├── db.ts                # createDb(path): esquema SQLite + migración idempotente. AppKey, APP_KEYS
├── models.ts            # acceso a datos de users + permissions
├── invites.ts           # acceso a datos de invites + estados derivados
├── submissions.ts       # acceso a datos de submissions (aportaciones)
├── submissionFiles.ts   # helpers de disco para los .torrent (DATA_DIR/aportaciones/<id>.torrent)
├── middleware.ts        # requireAuth, requireAdmin(adminUsername), requirePermission(db, appKey)
├── jellyfin.ts          # cliente de login (AuthenticateByName, sin credenciales de servidor)
├── jellyfinAdmin.ts     # cliente de administración (crea usuarios; API key)
├── qbittorrent.ts       # cliente de la WebUI (login + añadir torrent; compatible API < 5.1 y 5.1+)
└── routes/
    ├── auth.ts          # /api/login, /api/logout, /api/me
    ├── admin.ts         # /api/admin/* (permisos, usuarios, invitaciones, moderación de aportaciones)
    ├── invites.ts       # /api/invites/:token — PÚBLICO
    └── aportaciones.ts  # /api/aportaciones/* — usuario con permiso 'aportaciones'
```

Cada `*.ts` de backend con lógica tiene su `*.test.ts` al lado.

---

## 5. Identidad, sesión y permisos

**No hay base de datos de contraseñas.** La autenticación delega en Jellyfin:

1. `POST /api/login {username, password}` → el backend llama a Jellyfin
   `POST {JELLYFIN_URL}/Users/AuthenticateByName`. Si Jellyfin lo acepta, se
   crea/actualiza la fila del usuario en SQLite y se abre sesión.
2. La sesión es una **cookie httpOnly firmada** (`cookie-session`, secreto
   `SESSION_SECRET`). Contiene solo `{ username }`. Dura 30 días. En producción es
   `Secure` (depende de `X-Forwarded-Proto`, ver §9).
3. `GET /api/me` devuelve `{ username, isAdmin, permissions[] }` recalculado en cada
   petición.

**Admin**: se calcula comparando el `jellyfin_username` de la sesión
(case-insensitive) con la variable de entorno **`ADMIN_JELLYFIN_USERNAME`**. **No hay
columna "admin" en la BD.** Cambiar quién es admin = cambiar la variable y reiniciar.

**Permisos**: cuatro `app_key` fijos — `jellyfin`, `jellyseerr`, `cantina`,
`aportaciones` (constante `APP_KEYS` en `db.ts` y `authApi.ts`, deben coincidir). Un
usuario nuevo no tiene ninguno; un admin los concede desde
`/archivo/admin/permisos`. El frontend (`Dashboard`, `Placeholder`,
`AportacionesPage`) muestra cada sección según `session.permissions`; **el backend
también lo comprueba** (`requirePermission`).

**Middleware**:
- `requireAuth` — 401 si no hay `req.session.username`.
- `requireAdmin(adminUsername)` — 401 sin sesión, 403 si no es el admin.
- `requirePermission(db, appKey)` — 401 sin sesión, 403 si el usuario no existe o no
  tiene el permiso.

---

## 6. Modelo de datos (SQLite)

Un solo fichero, `DATA_DIR/archivo-oasis.db` (en producción `/data`, volumen Docker
`archivo-oasis-data`). WAL activado. El esquema se crea con `CREATE TABLE IF NOT
EXISTS` en `createDb()` al arrancar.

```sql
users (
  id INTEGER PRIMARY KEY,                 -- rowid; sin AUTOINCREMENT (se reutiliza al borrar)
  jellyfin_username TEXT UNIQUE COLLATE NOCASE NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT                       -- NULL si se pre-creó por invitación y aún no ha entrado
)

permissions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  app_key TEXT CHECK (app_key IN ('jellyfin','jellyseerr','cantina','aportaciones')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_key)
)

invites (
  token TEXT PRIMARY KEY,                  -- 32 bytes aleatorios base64url
  label TEXT, created_by TEXT NOT NULL,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL,   -- +7 días fijos
  used_at TEXT, used_by_username TEXT, revoked_at TEXT
)
-- estado derivado (no persistido): revoked > used > expired > valid

submissions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  description TEXT NOT NULL,               -- 1..280
  category TEXT CHECK (category IN ('movies','tv','music')),
  source_type TEXT CHECK (source_type IN ('url','file')),
  source_url TEXT, file_name TEXT,         -- uno u otro según source_type
  status TEXT DEFAULT 'pendiente' CHECK (status IN ('pendiente','procesada','rechazada')),
  rejection_reason TEXT,
  created_at TEXT NOT NULL, processed_at TEXT, processed_by TEXT
)
```

- **Las claves foráneas NO están enforced** (better-sqlite3 no ejecuta `PRAGMA
  foreign_keys=ON`). Los `DELETE` en cascada se hacen a mano en el modelo
  (`deleteUser` borra `submissions` + `permissions` + `users` en una transacción y
  devuelve los ids para que la ruta borre los ficheros).
- **Migraciones**: no hay framework. `db.ts` tiene una función
  `migrateUsersLastLoginNullable` idempotente (reconstruye `users` si `last_login_at`
  quedó `NOT NULL` de un despliegue viejo). Patrón a seguir para futuros cambios de
  esquema que no cubra `CREATE TABLE IF NOT EXISTS`: función idempotente que
  comprueba el estado (`PRAGMA table_info`) y reconstruye la tabla preservando ids.

Los ficheros `.torrent` subidos viven en `DATA_DIR/aportaciones/<id>.torrent` y se
borran cuando la aportación llega a estado terminal o el usuario la cancela
(best-effort, se loguea si falla).

---

## 7. API

Todas bajo `/api`. Respuestas de error: `{ error: string }`.

### Auth (sin prefijo especial)
| Método | Ruta | Auth | Notas |
|---|---|---|---|
| POST | `/api/login` | — | `{username,password}` → valida contra Jellyfin → 200 `{username,isAdmin,permissions[]}` / 401 |
| POST | `/api/logout` | — | 204, borra la sesión |
| GET | `/api/me` | sesión | 200 `{username,isAdmin,permissions[]}` / 401 |
| GET | `/api/health` | — | `{ok:true}` (healthcheck del contenedor) |

### Admin (`requireAdmin`)
| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/admin/users` | lista con `permissions[]`, `lastLoginAt`, `isAdmin` |
| POST | `/api/admin/permissions` | `{username,appKey,granted}` → concede/revoca |
| DELETE | `/api/admin/users/:username` | borra ficha + permisos + aportaciones + ficheros. 403 si es el admin, 404 si no existe |
| POST | `/api/admin/invites` | `{label?}` → `201 {invite}` |
| GET | `/api/admin/invites` | lista con estado derivado |
| DELETE | `/api/admin/invites/:token` | revoca. 404 si no existe o ya usada |
| GET | `/api/admin/aportaciones` | `?status=pendiente\|procesada\|rechazada` opcional; incluye `username` |
| POST | `/api/admin/aportaciones/:id/aceptar` | → qBittorrent. 200 / 409 (no pendiente) / 502 (qBittorrent falló, sigue pendiente) / 503 (no configurado) |
| POST | `/api/admin/aportaciones/:id/rechazar` | `{reason?}` → `rechazada` |

### Invitaciones — PÚBLICO (`/api/invites`, sin sesión)
| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/invites/:token` | `200 {status: valid\|used\|expired\|revoked\|not_found}` (nunca 404; `not_found` y `revoked` se muestran igual) |
| POST | `/api/invites/:token` | `{username,password}` → crea el usuario en Jellyfin + pre-crea la ficha con permisos `jellyfin`+`jellyseerr`. 200 / 400 / 409 (nombre en uso) / 410 (token no válido) / 502 / 503 (sin API key) |

### Aportaciones — usuario (`requireAuth` + `requirePermission('aportaciones')`)
| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/aportaciones` | solo las del usuario, recientes primero |
| POST | `/api/aportaciones` | `{description, category, sourceType, sourceUrl?, fileName?, fileBase64?}`. Valida: descripción 1..280, categoría, URL `http(s)://`/`magnet:` (≤2048), fichero `.torrent` (≤255 nombre, ≤2 MB decodificado) |
| DELETE | `/api/aportaciones/:id` | solo propia y `pendiente`. 403/404/409 |

`express.json({ limit: '5mb' })` (por el `fileBase64`); nginx `client_max_body_size 6m`
en `/api/`.

---

## 8. Funcionalidades presentes

### Portada 3D (`/`)
- Escena `@react-three/fiber` generada por código + `door.glb`, starfield (`<Stars>`),
  cámara orbital con límites, rótulo "ARCHIVO OASIS" (fuente Orbitron self-host).
- **Puerta bloqueada**: al hacer clic muestra "Salta amigo y entra". Se desbloquea
  tocando en las teclas de piano flotantes (`JumpKeys`) el riff de *Jump* de Van
  Halen (`jumpRiff.ts`; suena con Web Audio API). Al completarlo: "Puerta
  desbloqueada" y desaparecen las teclas.
- Con la puerta desbloqueada (o sesión ya activa), el clic abre el `LoginModal`
  (o navega directo a `/archivo` si ya autenticado).

### Parte interna (`/archivo`)
- **Dashboard**: cuadros según `permissions`. Jellyfin/Jellyseerr → enlaces externos
  (`teatro.` / `peticiones.archivo-oasis.com`). Cantina/Aportaciones → rutas internas.
  Admin ve además el cuadro "Configuración". Usuario sin permisos: "Pendiente de
  aprobación".
- **Botones flotantes**: `HomeButton` (arriba-izq → `/`), `LogoutButton` (arriba-der).

### Configuración (`/archivo/admin`, solo admin)
Menú lateral de categorías. Hoy una categoría, **Usuarios**:
- **Permisos**: tabla de todos los que han iniciado sesión alguna vez. Checkboxes
  para conceder/revocar cada `app_key`. Botón "Eliminar" por fila (no en la del
  admin) que borra la ficha de archivo-oasis (reversible: si vuelve a entrar se
  recrea sin permisos).
- **Invitaciones**: generar URL de un solo uso (7 días de caducidad, nota opcional),
  copiarla, revocarla. La URL pública `/invitacion/:token` deja a alguien crear su
  cuenta de Jellyfin (nombre + contraseña) y le concede acceso automático a Jellyfin
  y Jellyseerr en archivo-oasis. Jellyseerr no se toca por API — tiene "Enable
  Jellyfin Sign-In" activo, así que basta con crear el usuario en Jellyfin.

### Aportaciones (`/archivo/aportaciones`)
- **Usuario** (con permiso `aportaciones`): formulario — descripción (≤280),
  categoría (Películas/Series/Música), y URL/magnet **o** fichero `.torrent`
  (se sube en base64). Tabla de sus aportaciones con estado
  (pendiente/procesada/rechazada) y motivo si fue rechazada. Botón "Cancelar" en las
  pendientes.
- **Admin** (en la misma página, debajo): tabla de todas las aportaciones, filtro por
  estado, botones "Aceptar" / "Denegar" (motivo opcional) en las pendientes.
  "Aceptar" hace login en qBittorrent y `POST /api/v2/torrents/add` con la categoría.
  Si qBittorrent falla, la aportación **sigue pendiente** y se muestra el error.

### La Cantina (`/archivo/cantina`)
Solo placeholder ("próximamente"), con guard por el permiso `cantina`.

---

## 9. Infraestructura y despliegue

### Imágenes Docker (`.github/workflows/deploy.yml`)
Cada push a `main` construye y publica en GHCR:
- `ghcr.io/jbaezami/archivo-oasis:latest` — `docker/Dockerfile`: build de Vite
  (`node:20-alpine`) → servido por `nginx:1.27-alpine` con `docker/nginx.conf`.
- `ghcr.io/jbaezami/archivo-oasis-api:latest` — `server/Dockerfile`: `node:22-bookworm-slim`,
  compila `better-sqlite3` desde fuente (python3/make/g++), `npm prune --omit=dev`,
  healthcheck a `/api/health`, `VOLUME /data`, `NODE_ENV=production`.

El paquete GHCR de la imagen del frontend debe estar **público** para que Portainer
haga pull sin credenciales.

### `docker-compose.yml` (stack de Portainer)
- `archivo-oasis` (nginx): puerto `8081:80`, en redes `default` + `red-cloudflare`,
  `depends_on: archivo-oasis-api`.
- `archivo-oasis-api`: sin puertos publicados (solo accesible por la red interna),
  volumen `archivo-oasis-data:/data`, todas las env vars vía `${...}`.
- `red-cloudflare` es **external** (la crea el stack de cloudflared; si no existe:
  `docker network create red-cloudflare`).

### nginx (`docker/nginx.conf`)
- `location /api/` → `proxy_pass http://archivo-oasis-api:3001/api/;` +
  `client_max_body_size 6m`.
- **`X-Forwarded-Proto`**: como Cloudflare termina el TLS y nginx recibe HTTP, hay un
  `map $http_x_forwarded_proto $forwarded_proto { default $http_x_forwarded_proto; "" $scheme; }`
  — respeta el `https` que manda cloudflared, y si no viene ninguno usa el esquema
  local. Esto es lo que permite que la cookie de sesión `Secure` funcione en
  producción. (Bug histórico: antes machacaba con `$scheme` = `http` y la sesión no
  se mantenía.)
- `location /` → `try_files $uri $uri/ /index.html` (fallback SPA — cubre
  `/invitacion/:token`, `/archivo/*`, etc.).

### Cloudflare Tunnel
Zero Trust → Networks → Tunnels → Public Hostname:
`archivo-oasis.com` → `HTTP` → `archivo-oasis:80` (host interno del contenedor, no el
8081 del host).

### Redespliegue
Manual: Portainer → stack → **Pull and redeploy** tras cada push a `main`. (El webhook
de Portainer es de pago; no se usa Watchtower para mantenerlo simple.)

### Persistencia
Todo el estado (usuarios, permisos, invitaciones, aportaciones, ficheros `.torrent`)
vive en el volumen `archivo-oasis-data`. Sobrevive a redeploys y recreación de
contenedores. Solo se pierde borrando el volumen a mano.

---

## 10. Configuración — variables de entorno

Las lee **el backend** (`server/src/index.ts`). En producción llegan por el
`environment:` del `docker-compose.yml`, que a su vez las toma de un `.env` **junto al
`docker-compose.yml`** (no versionado). En local, de `server/.env` (cargado por
`loadDotEnv()` en `index.ts`; solo lo que no esté ya en `process.env`).

| Variable | Obligatoria | Para qué | Si falta |
|---|---|---|---|
| `JELLYFIN_URL` | **sí** | login + creación de usuarios | el backend **no arranca** |
| `ADMIN_JELLYFIN_USERNAME` | **sí** | quién es admin | el backend **no arranca** |
| `SESSION_SECRET` | **sí** | firma de la cookie de sesión (`openssl rand -hex 32`) | el backend **no arranca** |
| `JELLYFIN_API_KEY` | no | crear usuarios de Jellyfin al consumir una invitación (Jellyfin → Panel → Avanzado → Claves API) | `/api/invites` POST responde `503` |
| `QBITTORRENT_URL` | no | WebUI de qBittorrent, sin barra final | aceptar una aportación responde `503` |
| `QBITTORRENT_USER` / `QBITTORRENT_PASSWORD` | no | credenciales de la WebUI (qBittorrent **no usa API keys**) | idem |
| `PORT` | no (def. `3001`) | puerto del backend | — |
| `DATA_DIR` | no (def. `../data`, en Docker `/data`) | ruta de la BD y los `.torrent` | — |
| `NODE_ENV` | Docker lo pone a `production` | activa `Secure` en la cookie | en local no está → cookie sin `Secure`, funciona por HTTP |

Plantillas: `.env.example` (raíz, para el despliegue) y `server/.env.example` (para
local). El `.gitignore` bloquea cualquier `.env` salvo los `*.example`.

**Portainer**: las variables se ponen en la sección "Environment variables" del stack
(no se puede usar el `.env` del repo porque está en `.gitignore`).

---

## 11. Desarrollo local

Requisitos: **Node.js ≥ 20** recomendado. (Node 18 también sirve si `better-sqlite3`
se compila desde fuente — ver memoria del proyecto `server-node-version`; el binario
*prebuilt* de una ABI nueva hace segfault.)

```bash
npm install                 # instala frontend
npm --prefix server install # instala backend (compila better-sqlite3)
cp server/.env.example server/.env   # y rellenar

npm run dev        # levanta Vite (:5173) + API (:3001) con concurrently
# o por separado:
npm run dev:web
npm run dev:api
```

- Vite hace `proxy` de `/api` → `localhost:3001` (`vite.config.ts`).
- El backend (`tsx watch`) recarga solo al editar `server/src/**`.
- Abrir `http://localhost:5173`.

**Tests del backend:**
```bash
cd server && npm test        # tsx --test src/*.test.ts src/routes/*.test.ts
npx tsc --noEmit             # el runner de tests (esbuild) NO comprueba tipos estrictos — corre tsc aparte
```

**Build de producción:**
```bash
npm run build                # frontend: tsc && vite build
npm --prefix server run build # backend: tsc → dist/
```

Gotchas conocidas:
- `npm test` con esbuild no pilla errores de `tsc` estricto (p.ej. `Blob`/`BlobPart`).
  Correr `npx tsc --noEmit` siempre.
- `AppConfig` es un objeto: al añadirle un campo hay que actualizar **todos** los
  helpers `createApp({...})` de los ficheros de test (`auth.test.ts`, `admin.test.ts`,
  `invites.test.ts`, `aportaciones.test.ts`) o `tsc` falla.

---

## 12. Convenciones y patrones para nuevos desarrollos

### Proceso
El proyecto usa el flujo **spec → plan → implementación** (skills "superpowers"):
1. `docs/superpowers/specs/YYYY-MM-DD-<tema>-design.md` — diseño acordado.
2. `docs/superpowers/plans/YYYY-MM-DD-<tema>.md` — plan por tareas con código y tests.
3. Implementación por tareas (subagentes o inline), revisión, merge.
Los specs anteriores documentan las decisiones y lo que quedó "fuera de alcance".

### Añadir una página al frontend
1. `src/pages/<Nombre>/<Nombre>.tsx` + `.module.css`.
2. Registrarla en `src/routes/AppRoutes.tsx`.
3. Si es interna: usar `useAuth()`, replicar el patrón de guard (`loading` → blanco,
   `offline` → aviso, sin permiso → "Solo el penitente pasará" + botón a `/`), y
   poner `<HomeButton />`.
4. Estética: fondo `#03010a`, cian `#0ff0fc`, acentos magenta `#7b2ff7`; mirar
   `InvitacionesPage.module.css` / `AportacionesPage.module.css` como referencia.

### Añadir una ruta/endpoint al backend
1. Modelo en un `*.ts` nuevo o existente (funciones puras `(db, ...) => ...`), con su
   `*.test.ts` (SQLite `:memory:`).
2. Router en `server/src/routes/<x>.ts` como `createXRouter(db, ...deps): Router`.
3. Middleware de acceso: `requireAuth` / `requireAdmin(adminUsername)` /
   `requirePermission(db, appKey)`.
4. Montarlo en `app.ts`; si necesita una dependencia nueva (un cliente externo,
   `dataDir`...), añadirla a `AppConfig` + a `index.ts` + a los 4 helpers de test.
5. Tests de ruta: levantar la app con `createApp`, doble inyectado para el servicio
   externo, cookies de sesión reales vía `/api/login`.

### Añadir una tabla / cambiar el esquema
- Tabla nueva: `CREATE TABLE IF NOT EXISTS` en `db.ts`.
- Cambio en una tabla existente: función de migración **idempotente** en `db.ts`
  (comprobar estado con `PRAGMA`, reconstruir preservando ids; recordar que las FKs
  no están enforced y hay que gestionar `PRAGMA foreign_keys` alrededor del DROP).
- Borrados en cascada: a mano en el modelo, en una transacción.

### Añadir un cliente de servicio externo
Patrón `jellyfinAdmin` / `qbittorrent`:
- `createXClient(baseUrl, ...creds): XClient` con una interfaz mínima.
- Errores propios (`class XError extends Error`); nunca dejar escapar un `fetch` crudo.
- Inyectar como `X | null` en `AppConfig` (null si falta la config → la ruta responde
  `503`).
- Tests con `global.fetch` stub.

### app_key nuevo
Añadirlo en **`server/src/db.ts`** (`AppKey`, `APP_KEYS`, el `CHECK` de `permissions`)
**y** en `src/lib/authApi.ts` (`AppKey`, `APP_KEYS`) — deben coincidir. Añadir su
cuadro en `Dashboard.tsx` (`APP_TILES`).

---

## 13. Deuda técnica y limitaciones conocidas

- **FKs no enforced** en SQLite. Cada borrado en cascada es manual; fácil olvidar uno
  al añadir tablas que referencian `users`.
- **`users.id` es rowid reutilizable** (sin `AUTOINCREMENT`). Borrar el usuario de id
  más alto y crear otro le da el mismo id. `deleteUser` mitiga borrando sus datos.
- **qBittorrent**: `/torrents/add` devuelve `Ok.` aunque ignore silenciosamente un
  magnet inválido — no siempre se puede saber si el torrent entró de verdad. Sin
  validación de bencode del `.torrent` (un fichero corrupto se detecta al aceptar,
  como `502`, y la aportación queda pendiente para rechazar a mano).
- **Sin rate-limiting** en los endpoints públicos (`/api/invites/:token`). El control
  es la entropía del token (256 bits) + un solo uso + 7 días.
- **`aceptar` una aportación** pasa una URL del usuario a qBittorrent, que la descarga
  desde la red Docker (primitiva SSRF). Aceptado por diseño: requiere permiso
  `aportaciones` **y** aprobación explícita del admin.
- **Sin límite de aportaciones pendientes por usuario** — un permitido podría llenar
  el disco a base de `.torrent` de 2 MB.
- **Migraciones sin framework** — cada cambio de esquema es una función a mano.
- **Sin tests de frontend.** Sin linter (solo `tsc` estricto).
- **Redespliegue manual** en Portainer.
- Huecos menores de cobertura en `qbittorrent.test.ts` (doble-403, reuso de SID).

---

## 14. Funcionalidades futuras (previstas, no implementadas)

De la descomposición original (`docs/superpowers/specs/2026-09-01-interior-base-design.md`):

| Pieza | Estado | Notas |
|---|---|---|
| **La Cantina** (foro) | placeholder | Sección `cantina` ya existe como `app_key` y ruta. Falta diseñar y construir el foro. |
| Tiles Jellyfin / Jellyseerr | básico | Hoy son enlaces externos "permitido o no". Pendiente: SSO / embebido / comportamiento fino. |
| Aportaciones — mejoras | — | Límite de pendientes por usuario; validación del `.torrent`; ver progreso de descarga; notificaciones al cambiar de estado; reintento automático del envío a qBittorrent. |
| Configuración — más categorías | — | El menú lateral de `/archivo/admin` está pensado para crecer (Jellyfin, La Cantina...). Hoy solo "Usuarios". |
| Portada 3D | v1 | Posibles mejoras: post-procesado/bloom, sonido ambiental, primera persona. |
| Operación | — | Redespliegue automático (Watchtower o webhook), backup del volumen SQLite. |

---

## 15. Historial

- **2026-08-24/25** — base React + Vite + Docker + Cloudflare Tunnel (sitio estático).
- **2026-08-25** — portada 3D con la puerta y el puzzle del riff.
- **2026-09-01** — parte interna: backend `archivo-oasis-api` (Express + SQLite),
  identidad vía Jellyfin, permisos por usuario, dashboard, panel de admin. El sitio
  deja de ser 100 % estático.
- **2026-09-03** — invitaciones de un solo uso (crear usuarios de Jellyfin) + menú
  lateral de Configuración.
- **2026-09-03/04** — sección Aportaciones (envío a qBittorrent), botón de vuelta a la
  entrada, `npm run dev` combinado, fix de sesión tras Cloudflare, fix de compatibilidad
  con la API de qBittorrent 5.1+.

Cada pieza tiene su spec y su plan en `docs/superpowers/`.
