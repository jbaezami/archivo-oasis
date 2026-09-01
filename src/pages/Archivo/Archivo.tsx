import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import LogoutButton from './LogoutButton'
import styles from './Archivo.module.css'

function Archivo() {
  const { authenticated, setAuthenticated } = useAuth()
  const navigate = useNavigate()

  if (!authenticated) {
    return (
      <main className={styles.container}>
        <div>
          <h1>Solo el penitente pasará</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.container}>
      <LogoutButton
        onLogout={() => {
          setAuthenticated(false)
          navigate('/')
        }}
      />
      <h1>Archivo — próximamente</h1>
    </main>
  )
}

export default Archivo
