import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import {
  consumeInvite,
  fetchInviteStatus,
  InviteGoneError,
  type InviteStatus,
} from '../../lib/authApi'
import styles from './Invitacion.module.css'

type View = 'loading' | 'form' | 'done' | 'gone' | 'used' | 'expired' | 'revoked' | 'error'

const INVALID_MESSAGE: Record<'used' | 'expired' | 'revoked' | 'gone', string> = {
  used: 'Esta invitación ya se ha usado.',
  expired: 'Esta invitación ha caducado. Pide una nueva.',
  revoked: 'Esta invitación no es válida.',
  gone: 'Esta invitación ya no es válida.',
}

function statusToView(status: InviteStatus): View {
  if (status === 'valid') return 'form'
  if (status === 'used') return 'used'
  if (status === 'expired') return 'expired'
  return 'revoked' // revoked + not_found → mismo texto
}

function Invitacion() {
  const { token = '' } = useParams()
  const [view, setView] = useState<View>('loading')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchInviteStatus(token)
      .then((status) => setView(statusToView(status)))
      .catch(() => setView('error'))
  }, [token])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await consumeInvite(token, username, password)
      setView('done')
    } catch (err) {
      if (err instanceof InviteGoneError) {
        setView('gone')
      } else {
        setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta')
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (view === 'loading') {
    return <div className={styles.container} />
  }

  if (view === 'error') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>Algo ha ido mal</h1>
          <p className={styles.subtitle}>No se pudo comprobar la invitación. Recarga la página.</p>
        </div>
      </div>
    )
  }

  if (view === 'used' || view === 'expired' || view === 'revoked' || view === 'gone') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>Invitación no disponible</h1>
          <p className={styles.subtitle}>{INVALID_MESSAGE[view]}</p>
        </div>
      </div>
    )
  }

  if (view === 'done') {
    return (
      <div className={styles.container}>
        <div className={styles.card}>
          <h1 className={styles.title}>¡Cuenta creada!</h1>
          <p className={styles.subtitle}>
            Ya puedes entrar con tu usuario y contraseña en:
          </p>
          <div className={styles.links}>
            <a className={styles.link} href="https://teatro.archivo-oasis.com">
              Teatro (Jellyfin)
            </a>
            <a className={styles.link} href="https://peticiones.archivo-oasis.com">
              Peticiones (Jellyseerr)
            </a>
            <a className={styles.link} href="/archivo">
              El archivo
            </a>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <form className={styles.card} onSubmit={handleSubmit}>
        <h1 className={styles.title}>Crea tu cuenta</h1>
        <p className={styles.subtitle}>Elige un usuario y una contraseña para el archivo.</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="inv-username">
            Usuario
          </label>
          <input
            id="inv-username"
            className={styles.input}
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="inv-password">
            Contraseña (mínimo 6 caracteres)
          </label>
          <input
            id="inv-password"
            className={styles.input}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit} disabled={submitting}>
          {submitting ? 'Creando…' : 'Crear cuenta'}
        </button>
      </form>
    </div>
  )
}

export default Invitacion
