import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Html, useCursor } from '@react-three/drei'

function Door() {
  const [hovered, setHovered] = useState(false)
  const navigate = useNavigate()
  useCursor(hovered)

  return (
    <group
      position={[0, 1.25, 0]}
      onPointerOver={() => setHovered(true)}
      onPointerOut={() => setHovered(false)}
      onClick={() => navigate('/archivo')}
    >
      <mesh position={[-0.9, 0, 0]}>
        <boxGeometry args={[0.2, 2.5, 0.2]} />
        <meshStandardMaterial color="#0ff0fc" emissive="#0ff0fc" emissiveIntensity={1.2} />
      </mesh>
      <mesh position={[0.9, 0, 0]}>
        <boxGeometry args={[0.2, 2.5, 0.2]} />
        <meshStandardMaterial color="#0ff0fc" emissive="#0ff0fc" emissiveIntensity={1.2} />
      </mesh>
      <mesh position={[0, 1.25, 0]}>
        <boxGeometry args={[2, 0.2, 0.2]} />
        <meshStandardMaterial color="#0ff0fc" emissive="#0ff0fc" emissiveIntensity={1.2} />
      </mesh>

      <mesh position={[0, 0, -0.05]}>
        <boxGeometry args={[1.6, 2.4, 0.1]} />
        <meshStandardMaterial color="#120024" emissive="#7b2ff7" emissiveIntensity={0.4} />
      </mesh>

      {hovered && (
        <Html position={[0, -1.4, 0]} center>
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

export default Door
