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

1. En GitHub, cada push a `main` ejecuta `.github/workflows/deploy.yml`, que construye la imagen y la publica en `ghcr.io/jbaezami/archivo-oasis:latest`.
2. La primera vez, verifica en GitHub → tu perfil → Packages → `archivo-oasis` que el paquete esté marcado como **público** (para que Portainer pueda hacer pull sin credenciales).
3. En Portainer, crea un Stack nuevo usando el contenido de `docker-compose.yml` de este repo, y despliégalo una vez manualmente.
4. En el servicio del stack, entra en la sección **Webhooks** y actívalo. Copia la URL que te da (algo como `https://tu-portainer/api/webhooks/<uuid>`).
5. En GitHub, ve a `Settings → Secrets and variables → Actions` y crea un secret llamado `PORTAINER_WEBHOOK_URL` con esa URL.
6. A partir de aquí, cada push a `main` construye la imagen nueva y le dice a Portainer que la despliegue automáticamente.

Si usas [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) para exponer el servicio a internet, apúntalo a `localhost:8080` (o al nombre del servicio `archivo-oasis` si cloudflared corre en la misma red Docker).
