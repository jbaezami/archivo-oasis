import { useEffect, useState, type FormEvent } from 'react'
import { authenticateWithJellyfin, JellyfinAuthError } from './jellyfinAuth'
import styles from './LoginModal.module.css'

interface LoginModalProps {
  onClose: () => void
  onSuccess: () => void
}

function LoginModal({ onClose, onSuccess }: LoginModalProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await authenticateWithJellyfin(username, password)
      onSuccess()
    } catch (err) {
      setError(err instanceof JellyfinAuthError ? err.message : 'Ha ocurrido un error inesperado')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className={styles.backdrop}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={styles.card}>
        <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Cerrar">
          ×
        </button>

        <h2 className={styles.title}>Acceso al archivo</h2>
        <p className={styles.subtitle}>La puerta está desbloqueada — identifícate para entrar</p>

        <form onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-username">
              Usuario
            </label>
            <input
              id="login-username"
              className={styles.input}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="login-password">
              Contraseña
            </label>
            <input
              id="login-password"
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button type="submit" className={styles.submit} disabled={submitting}>
            {submitting ? 'Comprobando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default LoginModal
