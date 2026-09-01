import { useRef, useState } from 'react'
import { Stars, OrbitControls, Text, Html } from '@react-three/drei'
import Door from './Door'
import JumpKeys from './JumpKeys'

interface SceneProps {
  onRequestLogin: () => void
}

function Scene({ onRequestLogin }: SceneProps) {
  const [unlocked, setUnlocked] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const messageTimeoutRef = useRef<number | null>(null)

  const showMessage = (text: string) => {
    setMessage(text)
    if (messageTimeoutRef.current) window.clearTimeout(messageTimeoutRef.current)
    messageTimeoutRef.current = window.setTimeout(() => setMessage(null), 2400)
  }

  const handleUnlock = () => {
    setUnlocked(true)
    showMessage('Puerta desbloqueada')
  }

  const handleDoorClick = () => {
    if (!unlocked) {
      showMessage('Salta amigo y entra')
    } else {
      onRequestLogin()
    }
  }

  return (
    <>
      <color attach="background" args={['#03010a']} />
      <ambientLight intensity={0.4} />
      <hemisphereLight args={['#8079c2', '#0d0a1f', 0.7]} />
      <directionalLight position={[2.5, 4.5, 3.5]} intensity={3.2} color="#ffdfb0" />
      <pointLight position={[0, 1.7, 1.3]} intensity={0.5} color="#0ff0fc" decay={2} distance={4} />
      <pointLight position={[0, 1.7, -1.6]} intensity={0.35} color="#7b2ff7" decay={2} distance={4} />

      <Stars radius={50} depth={50} count={3000} factor={4} saturation={0} fade speed={0.5} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#050311" roughness={0.9} />
      </mesh>

      <Text
        position={[0, 3.4, 0]}
        fontSize={0.4}
        color="#0ff0fc"
        anchorX="center"
        anchorY="middle"
        font="/fonts/orbitron-700.woff"
      >
        ARCHIVO OASIS
      </Text>

      <Door onDoorClick={handleDoorClick} />
      {!unlocked && <JumpKeys onUnlock={handleUnlock} />}

      {message && (
        <Html position={[0, 2.55, 0]} center style={{ pointerEvents: 'none' }}>
          <div
            style={{
              color: '#0ff0fc',
              fontFamily: 'system-ui, sans-serif',
              fontSize: '1.1rem',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              textShadow: '0 0 10px #0ff0fc',
              pointerEvents: 'none',
            }}
          >
            {message}
          </div>
        </Html>
      )}

      <OrbitControls
        target={[0, 1.15, 0]}
        minDistance={3}
        maxDistance={12}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.1}
      />
    </>
  )
}

export default Scene
