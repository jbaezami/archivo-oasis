# Parte interna: base (backend + identidad + permisos) — diseño

Fecha: 2026-09-01

## Objetivo

Definir y construir la primera pieza de la "parte interna" de archivo-oasis: la que
permite que, una vez dentro de `/archivo`, cada usuario vea solo las secciones a las
que tiene acceso, y que un administrador pueda conceder o revocar ese acceso.

Esta pieza es la base de la que dependen todas las demás. Sin ella no hay forma de
saber quién es cada usuario más allá de la sesión de un navegador concreto, ni de
distinguir qué puede ver cada uno.

## Alcance completo y descomposición

La petición original incluye seis piezas. Solo la primera (0) se diseña e implementa
ahora; el resto quedan enumeradas para que cada una tenga su propio ciclo de diseño
cuando le toque:

| # | Pieza | Depende de |
|---|-------|------------|
| 0 | Base: backend + identidad + permisos (**esta spec**) | — |
| 1 | Dashboard (`/archivo` real, cuadros por app) | 0 |
| 2 | Panel de admin (gestión de permisos) | 0 |
| 3 | Tile Jellyfin | 0, 1 |
| 4 | Tile Jellyseerr | 0, 1 |
| 5 | La Cantina (foro) | 0 |
| 6 | Aportaciones (envío a qBittorrent) | 0 |

Esta spec cubre 0, 1 y 2 juntas (el dashboard y el panel de admin son consecuencia
directa de tener backend + permisos, y sin ellos la base no es verificable). Las
piezas 3 y 4 se limitan aquí a "enlace externo permitido o no"; su comportamiento fino
(SSO, embebido, etc.) queda fuera. Las piezas 5 y 6 quedan completamente fuera: sus
cuadros en el dashboard llevan a una página placeholder, igual que `/archivo` lo era
hasta ahora.

## Contexto: por qué hace falta backend ahora

`archivo-oasis` es hoy un sitio 100% estático (Vite build servido por nginx, sin
servidor propio, sin base de datos — confirmado al conectar el login de Jellyfin, que
funcionó sin backend precisamente porque Jellyfin expone su propio endpoint público de
autenticación). Los permisos por usuario, en cambio, son un concepto que solo existe
dentro de archivo-oasis — Jellyfin no sabe nada de "acceso a La Cantina" — así que
requieren almacenamiento propio.

Además, el estado "autenticado" actual (`src/lib/useAuth.ts`) es un booleano en
`localStorage` que cualquiera puede falsificar abriendo la consola del navegador (se
usó así, deliberadamente, para probar el flujo antes de tener backend). Esta pieza lo
sustituye por una sesión real verificada por el servidor.

## Arquitectura

Un nuevo contenedor Docker, `archivo-oasis-api` (Node.js + SQLite), se añade al
`docker-compose.yml` junto al contenedor `archivo-oasis` (nginx) ya existente. Nginx
se configura para reenviar las peticiones bajo `/api/` a `archivo-oasis-api`; para el
navegador todo sigue siendo el mismo origen, así que la sesión puede ir en una cookie
httpOnly sin necesidad de gestionar CORS.

```
Navegador
   │
   ▼
nginx (archivo-oasis)
   ├── /            → estáticos (build de Vite)
   └── /api/*       → proxy_pass → archivo-oasis-api:PORT
                                        │
                                        ▼
                                   SQLite (volumen)
                                        │
                                        ▼
                              Jellyfin (AuthenticateByName)
```

La base de datos SQLite vive en un volumen Docker nombrado para sobrevivir a
redespliegues. El backend necesita estas variables de entorno (no committeadas,
pasadas vía `docker-compose.yml`/secretos de despliegue):

- `JELLYFIN_URL` — ya no es secreta, pero ahora vive en el backend en vez de en el
  bundle del frontend
- `ADMIN_JELLYFIN_USERNAME` — qué usuario de Jellyfin es administrador en archivo-oasis
- `SESSION_SECRET` — clave para firmar la cookie de sesión, genuinamente secreta

## Modelo de datos (SQLite)

```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  jellyfin_username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);

CREATE TABLE permissions (
  user_id INTEGER NOT NULL REFERENCES users(id),
  app_key TEXT NOT NULL CHECK (app_key IN ('jellyfin', 'jellyseerr', 'cantina', 'aportaciones')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (user_id, app_key)
);
```

No hay columna de "administrador": se calcula en cada petición comparando el
`jellyfin_username` de la sesión (case-insensitive) con `ADMIN_JELLYFIN_USERNAME`. Un
usuario se crea solo la primera vez que inicia sesión correctamente (no se
pre-provisionan usuarios de Jellyfin que aún no han entrado — eso requeriría la API
key de Jellyfin para listar su directorio de usuarios, y queda fuera de esta pieza).

## API

| Endpoint | Auth | Descripción |
|---|---|---|
| `POST /api/login` | — | `{ username, password }`. El backend llama a Jellyfin (`AuthenticateByName`) del lado del servidor. Si es válido: crea/actualiza el usuario, abre sesión (cookie httpOnly), responde `{ username, isAdmin, permissions[] }`. Si no: 401. |
| `POST /api/logout` | sesión | Cierra la sesión. |
| `GET /api/me` | sesión | `{ username, isAdmin, permissions[] }` si hay sesión válida; 401 si no. |
| `GET /api/admin/users` | admin | Lista de usuarios que ya han iniciado sesión alguna vez, con sus permisos y último acceso. |
| `POST /api/admin/permissions` | admin | `{ username, appKey, granted }`. Concede o revoca un permiso. 403 si quien llama no es admin. |

## Cambios en el frontend

- **`src/pages/Home/jellyfinAuth.ts`**: deja de llamar a Jellyfin directamente desde el
  navegador; pasa a llamar a `POST /api/login`. Los mensajes de error visibles no
  cambian.
- **`src/lib/useAuth.ts`**: deja de leer/escribir `localStorage`. Al montar, llama a
  `GET /api/me` para saber el estado real (autenticado, admin, permisos). El login
  exitoso y el logout disparan la misma llamada para refrescar el estado. La
  persistencia "sesión libre una vez logueado" se mantiene, pero ahora la garantiza la
  cookie httpOnly, no un valor manipulable desde la consola.
- **`/archivo` (`Archivo.tsx`)**: se convierte en el dashboard real.
  - Sin sesión: se mantiene "Solo el penitente pasará" + botón a `/`, igual que ahora.
  - Con sesión: cuadros (grid), uno por cada `app_key` presente en `permissions`, más
    un cuadro de admin si `isAdmin`. Cada cuadro navega a su sección — Jellyfin y
    Jellyseerr como enlaces externos a sus URLs; Cantina, Aportaciones y Admin como
    rutas internas nuevas (`/archivo/cantina`, `/archivo/aportaciones`,
    `/archivo/admin`), cada una con contenido placeholder salvo Admin, que en esta
    pieza sí tiene su funcionalidad real (listar usuarios, conceder/revocar permisos).
  - Un usuario sin ningún permiso ve el dashboard vacío con un aviso de "pendiente de
    aprobación" (consistente con la decisión de que los usuarios nuevos no ven nada
    hasta que el admin les da acceso).
- **`LogoutButton`**: pasa a llamar a `POST /api/logout` antes de navegar a `/`.

## Manejo de errores

- Credenciales incorrectas en `/api/login` → 401, mismo mensaje que ya existe en el
  formulario.
- Sesión ausente/caducada en `/api/me` → 401 → se trata como "no autenticado" (mismo
  comportamiento que hoy).
- Backend inalcanzable (fallo de despliegue) → el frontend distingue este caso de "no
  autenticado" y muestra un aviso de conexión en vez de la pantalla de penitente, para
  no confundir un problema de infraestructura con un permiso denegado.
- Endpoints de admin llamados por alguien no-admin → 403.

## Testing

- Backend: pruebas de integración sobre la API (login correcto/incorrecto, conceder y
  revocar permisos, rechazo de endpoints de admin a quien no lo es) contra una base
  SQLite de prueba.
- Frontend: verificación manual con el mismo flujo de Puppeteer usado hasta ahora en
  este proyecto (navegador real contra el backend corriendo en local), cubriendo:
  login vía backend, dashboard vacío para usuario sin permisos, dashboard con cuadros
  tras concesión de permisos, panel de admin concediendo/revocando, logout.

## Fuera de alcance (de esta pieza)

- Contenido real de La Cantina (pieza 5) y Aportaciones (pieza 6).
- Comportamiento fino de los tiles de Jellyfin/Jellyseerr más allá del enlace externo
  (piezas 3 y 4).
- Pre-asignar permisos a usuarios de Jellyfin que aún no han iniciado sesión (requiere
  la API key de Jellyfin; decidido explícitamente fuera de alcance para v1).
- Recuperación de contraseña, gestión de cuentas — eso sigue siendo responsabilidad de
  Jellyfin, archivo-oasis solo consume su login.
