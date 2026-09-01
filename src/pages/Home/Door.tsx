import { useRef, useState, useMemo } from 'react'
import { Html, useCursor, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const DOOR_MODEL_URL = '/models/door.glb'

interface DoorProps {
  onDoorClick: () => void
}

function Door({ onDoorClick }: DoorProps) {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const downPos = useRef<[number, number] | null>(null)

  const { scene } = useGLTF(DOOR_MODEL_URL)

  const doorScene = useMemo(() => scene.clone(true), [scene])

  const glowScene = useMemo(() => {
    const clone = scene.clone(true)
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: '#7bf7ff',
      transparent: true,
      opacity: 0,
      side: THREE.BackSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        ;(child as THREE.Mesh).material = glowMaterial
      }
    })
    return { object: clone, material: glowMaterial }
  }, [scene])

  useFrame((_, delta) => {
    const target = hovered ? 0.5 : 0
    glowScene.material.opacity = THREE.MathUtils.damp(glowScene.material.opacity, target, 8, delta)
  })

  return (
    <group
      position={[0, 0, 0]}
      rotation={[0, Math.PI / 2, 0]}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onPointerDown={(e) => {
        downPos.current = [e.clientX, e.clientY]
      }}
      onPointerUp={(e) => {
        const down = downPos.current
        if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) {
          onDoorClick()
        }
      }}
    >
      <primitive object={doorScene} />

      <group scale={1.035}>
        <primitive object={glowScene.object} />
      </group>

      {hovered && (
        <Html position={[0, -0.35, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            style={{
              color: '#0ff0fc',
              fontFamily: 'system-ui, sans-serif',
              fontSize: '1rem',
              whiteSpace: 'nowrap',
              textShadow: '0 0 8px #0ff0fc',
              pointerEvents: 'none',
            }}
          >
            Bienvenido al almanaque — entra
          </div>
        </Html>
      )}
    </group>
  )
}

useGLTF.preload(DOOR_MODEL_URL)

export default Door
