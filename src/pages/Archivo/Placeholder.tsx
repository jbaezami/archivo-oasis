import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import type { AppKey } from '../../lib/authApi'
import HomeButton from './HomeButton'
import styles from './Archivo.module.css'

interface PlaceholderProps {
  title: string
  need: AppKey
}

function Placeholder({ title, need }: PlaceholderProps) {
  const { status, session } = useAuth()
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

  if (!session || !session.permissions.includes(need)) {
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
      <h1>{title} — próximamente</h1>
    </main>
  )
}

export default Placeholder
