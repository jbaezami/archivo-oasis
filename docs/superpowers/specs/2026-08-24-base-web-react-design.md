# Base web React — diseño

Fecha: 2026-08-24

## Objetivo

Montar la base de la web "archivo-oasis" (portada del almanaque de servicios/herramientas/pruebas de jbaezami) con una estructura ordenada para poder seguir desarrollando páginas nuevas después, y con despliegue automático en Docker/Portainer cada vez que se actualiza la rama `main` en GitHub.

En esta primera fase solo existe una página, la portada (`/`), que debe mostrar el texto **"Bienvenido al almanaque"** (contenido temporal).

## Stack

- **Vite + React + TypeScript** — SPA ligera, build rápido, se compila a estáticos puros servidos por nginx en producción.
- **react-router-dom** para el enrutado de páginas.
- **CSS Modules** (`*.module.css`) para estilos por componente/página, sin dependencias adicionales.

## Estructura de directorios

```
archivo-oasis/
├── .github/workflows/deploy.yml     # CI: build imagen + push a ghcr.io + trigger webhook Portainer
├── docker/
│   ├── Dockerfile                   # build multi-stage: node (build) -> nginx (serve estáticos)
│   └── nginx.conf                   # sirve /dist, fallback a index.html para rutas de React Router
├── public/                          # estáticos servidos tal cual (favicon, robots.txt...)
├── src/
│   ├── assets/                      # imágenes/fuentes usadas por componentes (procesadas por Vite)
│   ├── components/                  # componentes compartidos (vacío de momento, ej. futuro Layout/Nav)
│   ├── pages/
│   │   └── Home/
│   │       ├── Home.tsx
│   │       └── Home.module.css
│   ├── routes/
│   │   └── AppRoutes.tsx            # configuración de react-router-dom
│   ├── App.tsx
│   ├── main.tsx
│   └── index.css                    # reset/estilos base globales
├── docker-compose.yml               # stack para Portainer
├── .dockerignore
├── .gitignore
├── index.html
├── vite.config.ts
├── tsconfig.json
├── tsconfig.app.json / tsconfig.node.json (generados por el scaffold de Vite)
└── package.json
```

**Convención para páginas futuras**: cada página nueva es una carpeta en `src/pages/<Nombre>/` con su `.tsx` y `.module.css`, registrada como una ruta más en `src/routes/AppRoutes.tsx`. Los recursos estáticos que solo usa un componente van en `src/assets/`; lo que debe servirse tal cual sin procesar (favicon, robots.txt, manifest) va en `public/`.

## Routing

`react-router-dom` con `BrowserRouter` montado en `App.tsx`. `AppRoutes.tsx` centraliza las rutas:

```tsx
<Routes>
  <Route path="/" element={<Home />} />
</Routes>
```

Por ahora solo existe la ruta raíz `/` → `Home`, que renderiza el texto "Bienvenido al almanaque".

## Docker

Build multi-stage en `docker/Dockerfile`:

1. **Etapa build** (`node:alpine`): `npm ci` + `npm run build` → genera `dist/`.
2. **Etapa serve** (`nginx:alpine`): copia `dist/` a `/usr/share/nginx/html`, usa `docker/nginx.conf` con `try_files $uri /index.html;` para que las rutas de React Router funcionen al recargar la página, expone el puerto 80.

La imagen final no contiene Node ni el código fuente, solo los estáticos compilados + nginx.

## docker-compose.yml (stack de Portainer)

- Imagen: `ghcr.io/<usuario-github>/archivo-oasis:latest`.
- Publica un puerto del host (por defecto `8080:80`) para que **cloudflared** pueda apuntar a `localhost:8080` (o al nombre del servicio si cloudflared corre en la misma red Docker).
- `restart: unless-stopped`.
- Sin credenciales de registry necesarias: el repo es público y la imagen en ghcr.io se publica como pública.

## CI/CD (GitHub Actions)

Workflow `.github/workflows/deploy.yml`, disparado en `push` a `main`:

1. Checkout del código.
2. Login a `ghcr.io` usando el `GITHUB_TOKEN` automático (permisos `packages: write`), sin necesidad de un PAT porque el repo es público.
3. Build de la imagen Docker (`docker/Dockerfile`) y push a `ghcr.io/<usuario>/archivo-oasis:latest`.
4. Llamada `curl` al webhook de Portainer (URL en el secret de GitHub `PORTAINER_WEBHOOK_URL`) para que Portainer haga pull de la nueva imagen y redespliegue el stack.

**Configuración manual pendiente por parte del usuario** (documentada en el README):

- Crear el webhook en Portainer (en el servicio/stack correspondiente, sección "Webhooks") tras el primer despliegue manual del stack.
- Guardar esa URL como secret `PORTAINER_WEBHOOK_URL` en GitHub (Settings → Secrets and variables → Actions).
- Marcar el paquete de ghcr.io como público la primera vez que se publique (por defecto los paquetes nuevos de GITHUB_TOKEN se crean con la visibilidad del repo, pero conviene verificarlo).

## Fuera de alcance (por ahora)

- Contenido real de la portada más allá del texto temporal.
- Páginas adicionales, navegación, layout compartido.
- Tests automatizados, linting estricto más allá del scaffold por defecto de Vite.
- Configuración de dominio/TLS en cloudflared (se asume que el usuario ya gestiona esto fuera de este proyecto).
