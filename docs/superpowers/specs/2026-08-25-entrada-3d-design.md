# Portada como entrada 3D — diseño

Fecha: 2026-08-25

## Objetivo

Rediseñar la portada (`/`) de "archivo-oasis": en vez del texto estático actual ("Bienvenido al almanaque"), la portada pasa a ser un entorno 3D navegable con una puerta como punto de acceso. Al pasar el ratón/tocar la puerta, esta saluda e invita a entrar; al hacer clic, navega a una nueva ruta `/archivo` que por ahora es un placeholder y se desarrollará más adelante como el archivo real.

Esta es la primera versión: prioriza una escena estilizada y ligera (sin modelos 3D externos) sobre la fidelidad visual respecto a cualquier imagen de referencia.

## Stack técnico

- **`three`** — motor WebGL subyacente.
- **`@react-three/fiber`** — renderer de React para Three.js (`<Canvas>`, hooks `useFrame`/`useThree`, etc.).
- **`@react-three/drei`** — helpers de alto nivel: `OrbitControls`, `Stars`, `Text` (texto 3D vía troika-three-text), `Html` (overlay HTML posicionado en el espacio 3D), `useCursor`.

Estas se añaden como nuevas dependencias de `package.json`. No se usan modelos 3D externos (`.glb`/`.gltf`) ni texturas descargadas — toda la geometría de la escena se genera por código con primitivas de Three.js (`BoxGeometry`, `PlaneGeometry`, etc.) y materiales emissive para el efecto neón.

## Composición de la escena

- **Fondo**: `<Stars>` de drei sobre un `Canvas` con fondo oscuro — efecto starfield barato, sin necesidad de skybox ni texturas.
- **Suelo**: un `<mesh>` con `PlaneGeometry` grande, material oscuro (p.ej. `MeshStandardMaterial` con color oscuro y algo de `roughness`), rotado horizontalmente.
- **Puerta**: geometría compuesta por primitivas (marco = varias `BoxGeometry` formando un arco/rectángulo; panel de puerta = otra `BoxGeometry` o `PlaneGeometry`), con `MeshStandardMaterial`/`MeshBasicMaterial` de color emissive en tono neón (cian/magenta) para que destaque en la oscuridad.
- **Luces**: `ambientLight` tenue para que el resto de la escena no quede negro, más 1-2 `pointLight` cerca de la puerta para reforzar el brillo neón.
- **Rótulo**: `<Text>` de drei con "ARCHIVO OASIS" (u otro texto a definir en implementación) posicionado sobre el marco de la puerta.
- **Cámara**: `PerspectiveCamera` por defecto de `@react-three/fiber`, controlada por `OrbitControls` de drei:
  - `target` apuntando al centro de la puerta.
  - Límites de zoom (`minDistance`/`maxDistance`) y de ángulo polar (`minPolarAngle`/`maxPolarAngle`) para que el usuario no pueda atravesar el suelo ni alejarse en exceso.
  - Funciona igual con ratón (drag) que con touch (drag/pinch) sin configuración adicional — drei/three lo gestionan.

No se usa post-procesado (bloom, etc.) en esta primera versión — se deja como posible mejora futura fuera de alcance.

## Interacción con la puerta

- **Hover** (`onPointerOver`/`onPointerOut` en el mesh de la puerta, con `useCursor` de drei para cambiar el cursor a pointer): muestra un `<Html>` de drei posicionado junto a la puerta con el texto **"Bienvenido al almanaque — entra"**. El overlay desaparece al quitar el ratón/dedo de la puerta.
- **Clic/tap** (`onClick` en el mesh de la puerta): navega a `/archivo` usando `useNavigate()` de `react-router-dom`.

## Nueva ruta `/archivo`

Página placeholder mínima que confirma que la navegación funciona, a desarrollar como el archivo real en una iteración futura. Contenido de esta primera versión: un texto tipo "Archivo — próximamente" (el texto exacto se decide en implementación, no es un requisito estricto como lo era "Bienvenido al almanaque" para la portada).

## Estructura de ficheros

```
src/
├── pages/
│   ├── Home/
│   │   ├── Home.tsx           # monta <Canvas> a pantalla completa y renderiza <Scene>
│   │   ├── Home.module.css    # el canvas ocupa 100vw/100vh
│   │   ├── Scene.tsx          # composición: luces, <Stars>, suelo, <Door>, <OrbitControls>
│   │   └── Door.tsx           # mesh de la puerta + hover (<Html> saludo) + clic (navigate)
│   └── Archivo/
│       ├── Archivo.tsx        # página placeholder
│       └── Archivo.module.css
└── routes/
    └── AppRoutes.tsx          # añade la ruta "/archivo" -> Archivo
```

`Home.tsx` dejará de renderizar el `<h1>Bienvenido al almanaque</h1>` estático — ese texto pasa a ser el saludo flotante de `Door.tsx` al hacer hover, tal y como se decidió en el diseño conversacional.

## Fuera de alcance (por ahora)

- Contenido real de `/archivo` (queda como placeholder).
- Modelos 3D externos, texturas descargadas, post-procesado (bloom, sombras avanzadas).
- Movimiento libre en primera persona (se usa cámara orbital, no caminar por la escena).
- Sonido/música ambiental.
- Optimización de rendimiento más allá de lo que dan por defecto three.js/R3F para una escena tan simple.
