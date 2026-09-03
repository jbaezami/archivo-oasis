# archivo-oasis

Página principal de mis servicios. Herramientas, desarrollos, pruebas... la entrada al almanaque.

## Desarrollo local

Requiere Node.js 20+.

```bash
npm install
npm run dev
```

Esto genera (o actualiza) `package-lock.json`; conviene comitearlo para que las builds (incluida la de Docker/CI) sean reproducibles.

Abre `http://localhost:5173`.

## Estructura

- `src/pages/<Nombre>/` — una carpeta por página, con su `.tsx` y `.module.css`. Regístrala como ruta en `src/routes/AppRoutes.tsx`.
- `src/components/` — componentes compartidos entre páginas.
- `src/assets/` — imágenes/fuentes usadas por componentes (procesadas por Vite).
- `public/` — estáticos servidos tal cual (favicon, robots.txt...).

## Build de producción

```bash
npm run build
npm run preview
```

## Docker

```bash
docker build -f docker/Dockerfile -t archivo-oasis .
docker run --rm -p 8080:80 archivo-oasis
```

Abre `http://localhost:8080`.

## Despliegue en Portainer

1. En GitHub, cada push a `main` ejecuta `.github/workflows/deploy.yml`, que construye la imagen y la publica en `ghcr.io/jbaezami/archivo-oasis:latest`.
2. La primera vez, verifica en GitHub → tu perfil → Packages → `archivo-oasis` que el paquete esté marcado como **público** (para que Portainer pueda hacer pull sin credenciales).
3. En Portainer, crea un Stack nuevo usando el contenido de `docker-compose.yml` de este repo, y despliégalo.
4. Cuando haya una imagen nueva (tras un push a `main`), vuelve a Portainer y pulsa **Pull and redeploy** en el stack para actualizar el contenedor con la última versión. Por ahora este paso es manual — el webhook nativo de Portainer es una función de pago (Business Edition) no disponible en Community Edition, y de momento no usamos ninguna alternativa automática (como [Watchtower](https://containrrr.dev/watchtower/)) para mantener esto simple.

### Variables de entorno del backend

El servicio `archivo-oasis-api` del `docker-compose.yml` lee estas variables de un `.env` situado junto al `docker-compose.yml` en el despliegue:

- `JELLYFIN_URL` — URL base de Jellyfin contra la que se validan los inicios de sesión.
- `ADMIN_JELLYFIN_USERNAME` — nombre de usuario de Jellyfin que tiene acceso al panel de administración de archivo-oasis.
- `SESSION_SECRET` — secreto para firmar la cookie de sesión. Genuinamente secreto.
- `JELLYFIN_API_KEY` — API key de administrador de Jellyfin (Panel → Avanzado → Claves API), usada para crear cuentas al consumir invitaciones. Genuinamente secreto. Si no se define, el backend arranca igual pero las rutas de invitaciones responden `503`.

## Exponer con cloudflared

El servicio está publicado vía [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) en `archivo-oasis.com`. El contenedor `archivo-oasis` está conectado también a la red Docker `red-cloudflare` (declarada como externa en `docker-compose.yml`), que es la misma red donde corre el contenedor de cloudflared — así puede resolver el host `archivo-oasis` por nombre.

En la ruta pública del túnel (Cloudflare Zero Trust → Networks → Tunnels → tu túnel → Public Hostname), la configuración es:
- Domain: `archivo-oasis.com` (sin subdominio)
- Service Type: `HTTP`
- URL: `archivo-oasis:80` (puerto interno del contenedor, no el 8081 publicado en el host)

Si la red `red-cloudflare` no existe ya en tu Docker host (por ejemplo, en un despliegue nuevo desde cero), créala antes de desplegar el stack: `docker network create red-cloudflare` — o ajusta el nombre en `docker-compose.yml` si tu red de cloudflared se llama distinto.
