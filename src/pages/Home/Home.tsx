import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import Scene from './Scene'
import LoginModal from './LoginModal'
import styles from './Home.module.css'

function Home() {
  const { authenticated, setAuthenticated } = useAuth()
  const [loginOpen, setLoginOpen] = useState(false)
  const navigate = useNavigate()

  const handleRequestAccess = () => {
    if (authenticated) {
      navigate('/archivo')
    } else {
      setLoginOpen(true)
    }
  }

  const handleLoginSuccess = () => {
    setAuthenticated(true)
    navigate('/archivo')
  }

  return (
    <div className={styles.container}>
      <Canvas camera={{ position: [0, 2, 6], fov: 50 }}>
        <Suspense fallback={null}>
          <Scene authenticated={authenticated} onRequestAccess={handleRequestAccess} />
        </Suspense>
      </Canvas>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onSuccess={handleLoginSuccess} />}
    </div>
  )
}

export default Home
