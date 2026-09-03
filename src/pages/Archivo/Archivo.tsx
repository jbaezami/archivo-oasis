import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import HomeButton from './HomeButton'
import LogoutButton from './LogoutButton'
import Dashboard from './Dashboard'
import styles from './Archivo.module.css'

function Archivo() {
  const { status, session, logout } = useAuth()
  const navigate = useNavigate()

  if (status === 'loading') {
    return <main className={styles.container} />
  }

  if (status === 'offline') {
    return (
      <main className={styles.container}>
        <HomeButton />
        <div>
          <h1>No se pudo conectar con el servidor</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  if (status === 'anonymous' || !session) {
    return (
      <main className={styles.container}>
        <HomeButton />
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
      <HomeButton />
      <LogoutButton
        onLogout={async () => {
          await logout()
          navigate('/')
        }}
      />
      <Dashboard session={session} />
    </main>
  )
}

export default Archivo
