import { Stars, OrbitControls, Text } from '@react-three/drei'
import Door from './Door'

function Scene() {
  return (
    <>
      <color attach="background" args={['#03010a']} />
      <ambientLight intensity={0.3} />
      <pointLight position={[0, 2, 3]} intensity={2} color="#0ff0fc" />
      <pointLight position={[0, 2, -2]} intensity={1} color="#7b2ff7" />

      <Stars radius={50} depth={50} count={3000} factor={4} saturation={0} fade speed={0.5} />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#050311" roughness={0.9} />
      </mesh>

      <Text
        position={[0, 3, 0]}
        fontSize={0.4}
        color="#0ff0fc"
        anchorX="center"
        anchorY="middle"
        font="/fonts/orbitron-700.woff"
      >
        ARCHIVO OASIS
      </Text>

      <Door />

      <OrbitControls
        target={[0, 1.25, 0]}
        minDistance={3}
        maxDistance={12}
        minPolarAngle={Math.PI / 6}
        maxPolarAngle={Math.PI / 2.1}
      />
    </>
  )
}

export default Scene
