import { useRef, useState } from 'react'
import { Html, useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { JUMP_KEYS, JUMP_KEY_LABELS } from './jumpRiff'
import type { KeyFlash } from './useJumpKeys'

const KEY_COUNT = JUMP_KEYS.length
const KEY_WIDTH = 0.14
const KEY_DEPTH = 0.5
const KEY_HEIGHT = 0.05
const KEY_GAP = 0.045
const ROW_WIDTH = KEY_COUNT * KEY_WIDTH + (KEY_COUNT - 1) * KEY_GAP

interface KeyProps {
  index: number
  x: number
  label: string
  flash: KeyFlash
  onPress: (index: number) => void
}

function Key({ index, x, label, flash, onPress }: KeyProps) {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const meshRef = useRef<THREE.Mesh>(null)
  const downPos = useRef<[number, number] | null>(null)
  const pressedAtRef = useRef<number>(-Infinity)

  useFrame(() => {
    if (!meshRef.current) return
    const since = performance.now() - pressedAtRef.current
    const bump = since < 150 ? Math.sin((since / 150) * Math.PI) * 0.015 : 0
    meshRef.current.position.y = KEY_HEIGHT / 2 + bump
  })

  const isFlashing = flash?.index === index
  const color = isFlashing ? (flash!.correct ? '#0ff0fc' : '#ff3b5c') : '#cbd0e0'
  const emissive = isFlashing ? (flash!.correct ? '#0ff0fc' : '#ff3b5c') : '#1c2a3a'
  const emissiveIntensity = isFlashing ? 1 : hovered ? 0.6 : 0.3

  return (
    <mesh
      ref={meshRef}
      position={[x, KEY_HEIGHT / 2, 0]}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onPointerDown={(e) => {
        downPos.current = [e.clientX, e.clientY]
      }}
      onPointerUp={(e) => {
        const down = downPos.current
        if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) {
          pressedAtRef.current = performance.now()
          onPress(index)
        }
      }}
    >
      <boxGeometry args={[KEY_WIDTH, KEY_HEIGHT, KEY_DEPTH]} />
      <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={emissiveIntensity} roughness={0.4} />

      {hovered && (
        <Html position={[0, 0.12, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            style={{
              color: '#0ff0fc',
              fontFamily: 'system-ui, sans-serif',
              fontSize: '0.85rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              textShadow: '0 0 8px #0ff0fc',
              pointerEvents: 'none',
            }}
          >
            {label}
          </div>
        </Html>
      )}
    </mesh>
  )
}

interface JumpKeysProps {
  flash: KeyFlash
  onKeyPress: (index: number) => void
}

function JumpKeys({ flash, onKeyPress }: JumpKeysProps) {
  return (
    <group position={[0, 0, 0.55]}>
      {JUMP_KEYS.map((_, i) => (
        <Key
          key={i}
          index={i}
          x={-ROW_WIDTH / 2 + i * (KEY_WIDTH + KEY_GAP) + KEY_WIDTH / 2}
          label={JUMP_KEY_LABELS[i]}
          flash={flash}
          onPress={onKeyPress}
        />
      ))}
    </group>
  )
}

export default JumpKeys
