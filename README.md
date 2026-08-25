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

## Despliegue en Portainer (automático desde GitHub)

El redeploy automático usa [Watchtower](https://containrrr.dev/watchtower/) en vez del webhook nativo de Portainer, porque ese webhook es una función de pago (Business Edition) no disponible en Portainer Community Edition.

1. En GitHub, cada push a `main` ejecuta `.github/workflows/deploy.yml`, que construye la imagen y la publica en `ghcr.io/jbaezami/archivo-oasis:latest`.
2. La primera vez, verifica en GitHub → tu perfil → Packages → `archivo-oasis` que el paquete esté marcado como **público** (para que Portainer/Watchtower puedan hacer pull sin credenciales).
3. En Portainer, crea un Stack nuevo usando el contenido de `docker-compose.yml` de este repo, y despliégalo. El stack incluye un contenedor `watchtower` que vigila `archivo-oasis` (por la label `com.centurylinklabs.watchtower.enable=true`) y comprueba cada 5 minutos si hay una imagen `:latest` nueva en ghcr.io; si la hay, la descarga y recrea el contenedor solo.
4. A partir de aquí, cada push a `main` construye la imagen nueva y Watchtower la despliega automáticamente en un plazo máximo de 5 minutos, sin que tengas que tocar nada en Portainer.

`--label-enable` en el comando de Watchtower hace que solo vigile contenedores marcados explícitamente con esa label, para no tocar otros contenedores que ya tengas corriendo en el mismo host.

Si usas [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) para exponer el servicio a internet, apúntalo a `localhost:8081` (o al nombre del servicio `archivo-oasis` si cloudflared corre en la misma red Docker).
