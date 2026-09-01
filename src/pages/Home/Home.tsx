import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useNavigate } from 'react-router-dom'
import Scene from './Scene'
import LoginModal from './LoginModal'
import styles from './Home.module.css'

function Home() {
  const [loginOpen, setLoginOpen] = useState(false)
  const navigate = useNavigate()

  return (
    <div className={styles.container}>
      <Canvas camera={{ position: [0, 2, 6], fov: 50 }}>
        <Suspense fallback={null}>
          <Scene onRequestLogin={() => setLoginOpen(true)} />
        </Suspense>
      </Canvas>

      {loginOpen && (
        <LoginModal onClose={() => setLoginOpen(false)} onSuccess={() => navigate('/archivo')} />
      )}
    </div>
  )
}

export default Home
