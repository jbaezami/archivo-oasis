import { useRef, useState } from 'react'
import { useCursor } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { JUMP_KEYS, JUMP_SEQUENCE } from './jumpRiff'

const KEY_COUNT = JUMP_KEYS.length
const KEY_WIDTH = 0.22
const KEY_DEPTH = 0.16
const KEY_HEIGHT = 0.06
const KEY_GAP = 0.06
const ROW_WIDTH = KEY_COUNT * KEY_WIDTH + (KEY_COUNT - 1) * KEY_GAP
const FLASH_MS = 220

function playChord(ctx: AudioContext, freqs: number[]) {
  const now = ctx.currentTime
  for (const freq of freqs) {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'triangle'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(0.1, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.9)
  }
}

type Flash = 'correct' | 'wrong' | null

interface KeyProps {
  index: number
  x: number
  flash: Flash
  onPress: (index: number) => void
}

function Key({ index, x, flash, onPress }: KeyProps) {
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

  const color = flash === 'correct' ? '#0ff0fc' : flash === 'wrong' ? '#ff3b5c' : '#cbd0e0'
  const emissive = flash === 'correct' ? '#0ff0fc' : flash === 'wrong' ? '#ff3b5c' : '#1c2a3a'
  const emissiveIntensity = flash ? 1 : hovered ? 0.6 : 0.3

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
    </mesh>
  )
}

interface JumpKeysProps {
  onUnlock: () => void
}

function JumpKeys({ onUnlock }: JumpKeysProps) {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [progress, setProgress] = useState(0)
  const [flash, setFlash] = useState<{ index: number; correct: boolean } | null>(null)
  const flashTimeoutRef = useRef<number | null>(null)

  const getAudioContext = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }

  const handlePress = (index: number) => {
    playChord(getAudioContext(), JUMP_KEYS[index])

    const isCorrect = index === JUMP_SEQUENCE[progress]
    setFlash({ index, correct: isCorrect })
    if (flashTimeoutRef.current) window.clearTimeout(flashTimeoutRef.current)
    flashTimeoutRef.current = window.setTimeout(() => setFlash(null), FLASH_MS)

    if (isCorrect) {
      const next = progress + 1
      if (next === JUMP_SEQUENCE.length) {
        setProgress(0)
        onUnlock()
      } else {
        setProgress(next)
      }
    } else {
      setProgress(index === JUMP_SEQUENCE[0] ? 1 : 0)
    }
  }

  return (
    <group position={[0, 0, 0.55]}>
      {JUMP_KEYS.map((_, i) => (
        <Key
          key={i}
          index={i}
          x={-ROW_WIDTH / 2 + i * (KEY_WIDTH + KEY_GAP) + KEY_WIDTH / 2}
          flash={flash?.index === i ? (flash.correct ? 'correct' : 'wrong') : null}
          onPress={handlePress}
        />
      ))}
    </group>
  )
}

export default JumpKeys
