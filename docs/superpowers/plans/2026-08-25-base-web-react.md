# Base web React Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montar la base de la web "archivo-oasis" con Vite + React + TypeScript, una única página de portada ("Bienvenido al almanaque"), y despliegue automático en Docker/Portainer cada vez que se hace push a `main` en GitHub.

**Architecture:** SPA con Vite + React + TypeScript + react-router-dom, estilada con CSS Modules. Se compila a estáticos puros servidos por nginx en un contenedor Docker (build multi-stage). GitHub Actions construye y publica la imagen en ghcr.io en cada push a `main`, y dispara un webhook de Portainer para que redespliegue el stack automáticamente.

**Tech Stack:** Vite, React 18, TypeScript, react-router-dom, CSS Modules, Docker (node:20-alpine build + nginx:alpine serve), GitHub Actions, GitHub Container Registry (ghcr.io), Portainer (stack + webhook).

**Spec:** `docs/superpowers/specs/2026-08-24-base-web-react-design.md`

## Global Constraints

- Repo GitHub: `jbaezami/archivo-oasis` (owner `jbaezami`, repo `archivo-oasis`) — usar este nombre exacto para la imagen: `ghcr.io/jbaezami/archivo-oasis`.
- El texto de la portada debe ser exactamente: **"Bienvenido al almanaque"**.
- Estilos con CSS Modules (`*.module.css`), sin librerías de estilos adicionales.
- Sin PAT adicional para ghcr.io: usar el `GITHUB_TOKEN` automático de Actions (repo público).
- **Entorno de ejecución sin `node`/`npm`/`docker` instalados y sin `sudo`.** No se puede correr `npm install`, `npm run build`, `npm run dev` ni `docker build` durante la implementación. Cada tarea se valida con las herramientas disponibles (sintaxis JSON/YAML vía `python3`, revisión de contenido) y se deja documentado en el README qué debe verificar el usuario localmente o confiar en que lo valide el propio workflow de GitHub Actions (que sí corre en una máquina con Node y Docker) en el primer push.

---

### Task 1: Scaffold del proyecto Vite (config, sin `npm install`)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `public/favicon.svg`
- Create: `.gitignore`

**Interfaces:**
- Produces: script `npm run dev` (servidor de desarrollo Vite), `npm run build` (compila a `dist/`), `npm run preview`. Dependencias declaradas: `react`, `react-dom`, `react-router-dom`; devDependencies: `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `typescript`, `vite`.
- Consumes: nada (primera tarea).

- [ ] **Step 1: Crear `package.json`**

```json
{
  "name": "archivo-oasis",
  "private": true,
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.2"
  },
  "devDependencies": {
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "typescript": "^5.5.4",
    "vite": "^5.4.2"
  }
}
```

- [ ] **Step 2: Crear `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Crear `vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
```

- [ ] **Step 4: Crear `index.html`**

```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>El Almanaque</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Crear `public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#1f2937"/>
  <text x="16" y="22" font-size="18" text-anchor="middle" fill="#f9fafb" font-family="serif">A</text>
</svg>
```

- [ ] **Step 6: Crear `.gitignore`**

```
node_modules/
dist/
.env
*.local
```

- [ ] **Step 7: Validar sintaxis de los ficheros JSON**

Run: `python3 -m json.tool package.json > /dev/null && python3 -m json.tool tsconfig.json > /dev/null && echo OK`
Expected: `OK`

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vite.config.ts index.html public/favicon.svg .gitignore
git commit -m "Scaffold Vite + React + TypeScript project config"
```

---

### Task 2: Código fuente de la app (App, routing, página Home)

**Files:**
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/index.css`
- Create: `src/routes/AppRoutes.tsx`
- Create: `src/pages/Home/Home.tsx`
- Create: `src/pages/Home/Home.module.css`

**Interfaces:**
- Consumes: `index.html` (monta en `#root`, carga `/src/main.tsx`) de Task 1.
- Produces: componente `App` (default export de `src/App.tsx`), componente `AppRoutes` (default export de `src/routes/AppRoutes.tsx`) usado por `App`, componente `Home` (default export de `src/pages/Home/Home.tsx`) usado por `AppRoutes` en la ruta `"/"`.

- [ ] **Step 1: Crear `src/pages/Home/Home.module.css`**

```css
.container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  text-align: center;
}
```

- [ ] **Step 2: Crear `src/pages/Home/Home.tsx`**

```tsx
import styles from './Home.module.css'

function Home() {
  return (
    <main className={styles.container}>
      <h1>Bienvenido al almanaque</h1>
    </main>
  )
}

export default Home
```

- [ ] **Step 3: Crear `src/routes/AppRoutes.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom'
import Home from '../pages/Home/Home'

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  )
}

export default AppRoutes
```

- [ ] **Step 4: Crear `src/App.tsx`**

```tsx
import AppRoutes from './routes/AppRoutes'

function App() {
  return <AppRoutes />
}

export default App
```

- [ ] **Step 5: Crear `src/index.css`**

```css
:root {
  color-scheme: light dark;
  font-family: system-ui, -apple-system, 'Segoe UI', sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}
```

- [ ] **Step 6: Crear `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 7: Verificar que la cadena de imports y el texto de portada son correctos**

Run: `grep -q "Bienvenido al almanaque" src/pages/Home/Home.tsx && grep -q "AppRoutes" src/App.tsx && grep -q "path=\"/\"" src/routes/AppRoutes.tsx && echo OK`
Expected: `OK`

Nota: no se puede ejecutar `npm run dev` ni `tsc` en este entorno (sin Node). La primera verificación real de compilación/tipos ocurrirá al correr `npm install && npm run dev` localmente (Task 6 documenta esto) o en el workflow de GitHub Actions (Task 5).

- [ ] **Step 8: Commit**

```bash
git add src/
git commit -m "Add App shell, routing and Home page"
```

---

### Task 3: Imagen Docker (build multi-stage + nginx)

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/nginx.conf`
- Create: `.dockerignore`

**Interfaces:**
- Consumes: `package.json`/`npm run build` (Task 1) que genera `dist/`; `docker/nginx.conf` referenciado desde `docker/Dockerfile`.
- Produces: imagen Docker que expone el puerto `80` sirviendo `dist/` con fallback SPA. Usada por `docker-compose.yml` (Task 4) y por el workflow de build (Task 5) con `context: .` y `file: docker/Dockerfile`.

- [ ] **Step 1: Crear `docker/nginx.conf`**

```nginx
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

- [ ] **Step 2: Crear `docker/Dockerfile`**

```dockerfile
# ---- Build stage ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# ---- Serve stage ----
FROM nginx:1.27-alpine AS serve
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

- [ ] **Step 3: Crear `.dockerignore`**

```
node_modules
dist
.git
docs
```

- [ ] **Step 4: Revisar que las rutas referenciadas existen**

Run: `test -f docker/nginx.conf && test -f package.json && echo OK`
Expected: `OK`

Nota: no se puede ejecutar `docker build` en este entorno (sin Docker ni sudo para instalarlo). La primera build real ocurre en el workflow de GitHub Actions (Task 5), que corre en un runner con Docker disponible.

- [ ] **Step 5: Commit**

```bash
git add docker/ .dockerignore
git commit -m "Add multi-stage Dockerfile and nginx config for static serving"
```

---

### Task 4: docker-compose.yml para el stack de Portainer

**Files:**
- Create: `docker-compose.yml`

**Interfaces:**
- Consumes: imagen `ghcr.io/jbaezami/archivo-oasis:latest` publicada por el workflow de Task 5.
- Produces: stack desplegable en Portainer, servicio `archivo-oasis` escuchando en el puerto `8080` del host (mapeado al `80` del contenedor).

- [ ] **Step 1: Crear `docker-compose.yml`**

```yaml
services:
  archivo-oasis:
    image: ghcr.io/jbaezami/archivo-oasis:latest
    container_name: archivo-oasis
    restart: unless-stopped
    ports:
      - "8080:80"
```

- [ ] **Step 2: Validar sintaxis YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml')); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "Add docker-compose stack for Portainer deployment"
```

---

### Task 5: Workflow de GitHub Actions (build + push a ghcr.io + webhook Portainer)

**Files:**
- Create: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `docker/Dockerfile` (Task 3), secret de GitHub `PORTAINER_WEBHOOK_URL` (configurado manualmente por el usuario, ver Task 6).
- Produces: imagen publicada en `ghcr.io/jbaezami/archivo-oasis:latest` y `:<sha>` en cada push a `main`; llamada POST al webhook de Portainer si el secret está configurado.

- [ ] **Step 1: Crear `.github/workflows/deploy.yml`**

```yaml
name: Build and deploy

on:
  push:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  build-and-push:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Log in to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push image
        uses: docker/build-push-action@v6
        with:
          context: .
          file: docker/Dockerfile
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
            ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:${{ github.sha }}

      - name: Trigger Portainer redeploy
        if: ${{ secrets.PORTAINER_WEBHOOK_URL != '' }}
        run: curl -fsS -X POST "${{ secrets.PORTAINER_WEBHOOK_URL }}"
```

- [ ] **Step 2: Validar sintaxis YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deploy.yml')); print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "Add GitHub Actions workflow to build, push and trigger Portainer redeploy"
```

---

### Task 6: README con instrucciones de desarrollo y despliegue

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: todo lo anterior (Tasks 1-5) — documenta cómo usarlo.
- Produces: documentación para el usuario, sin interfaz de código.

- [ ] **Step 1: Reescribir `README.md`**

```markdown
# archivo-oasis

Página principal de mis servicios. Herramientas, desarrollos, pruebas... la entrada al almanaque.

## Desarrollo local

Requiere Node.js 20+.

\`\`\`bash
npm install
npm run dev
\`\`\`

Esto genera (o actualiza) `package-lock.json`; conviene comitearlo para que las builds (incluida la de Docker/CI) sean reproducibles.

Abre `http://localhost:5173`.

## Estructura

- `src/pages/<Nombre>/` — una carpeta por página, con su `.tsx` y `.module.css`. Regístrala como ruta en `src/routes/AppRoutes.tsx`.
- `src/components/` — componentes compartidos entre páginas.
- `src/assets/` — imágenes/fuentes usadas por componentes (procesadas por Vite).
- `public/` — estáticos servidos tal cual (favicon, robots.txt...).

## Build de producción

\`\`\`bash
npm run build
npm run preview
\`\`\`

## Docker

\`\`\`bash
docker build -f docker/Dockerfile -t archivo-oasis .
docker run --rm -p 8080:80 archivo-oasis
\`\`\`

Abre `http://localhost:8080`.

## Despliegue en Portainer (automático desde GitHub)

1. En GitHub, cada push a `main` ejecuta `.github/workflows/deploy.yml`, que construye la imagen y la publica en `ghcr.io/jbaezami/archivo-oasis:latest`.
2. La primera vez, verifica en GitHub → tu perfil → Packages → `archivo-oasis` que el paquete esté marcado como **público** (para que Portainer pueda hacer pull sin credenciales).
3. En Portainer, crea un Stack nuevo usando el contenido de `docker-compose.yml` de este repo, y despliégalo una vez manualmente.
4. En el servicio del stack, entra en la sección **Webhooks** y actívalo. Copia la URL que te da (algo como `https://tu-portainer/api/webhooks/<uuid>`).
5. En GitHub, ve a `Settings → Secrets and variables → Actions` y crea un secret llamado `PORTAINER_WEBHOOK_URL` con esa URL.
6. A partir de aquí, cada push a `main` construye la imagen nueva y le dice a Portainer que la despliegue automáticamente.

Si usas [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) para exponer el servicio a internet, apúntalo a `localhost:8080` (o al nombre del servicio `archivo-oasis` si cloudflared corre en la misma red Docker).
\`\`\`

- [ ] **Step 2: Verificar que el README cubre los pasos clave**

Run: `grep -q "PORTAINER_WEBHOOK_URL" README.md && grep -q "npm run dev" README.md && grep -q "docker build" README.md && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document local dev, Docker and Portainer deployment steps"
```
