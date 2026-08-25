import { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import Scene from './Scene'
import styles from './Home.module.css'

function Home() {
  return (
    <div className={styles.container}>
      <Canvas camera={{ position: [0, 2, 6], fov: 50 }}>
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
    </div>
  )
}

export default Home
