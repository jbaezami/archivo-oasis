import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import { APP_KEYS, fetchAdminUsers, setUserPermission, type AdminUser, type AppKey } from '../../lib/authApi'
import archivoStyles from './Archivo.module.css'
import styles from './AdminPanel.module.css'

const APP_LABELS: Record<AppKey, string> = {
  jellyfin: 'Jellyfin',
  jellyseerr: 'Jellyseerr',
  cantina: 'La Cantina',
  aportaciones: 'Aportaciones',
}

function AdminPanel() {
  const { status, session } = useAuth()
  const navigate = useNavigate()
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status !== 'authenticated' || !session?.isAdmin) return
    fetchAdminUsers()
      .then(setUsers)
      .catch(() => setError('No se pudo cargar la lista de usuarios'))
  }, [status, session])

  if (status === 'loading') {
    return <main className={archivoStyles.container} />
  }

  if (status === 'offline') {
    return (
      <main className={archivoStyles.container}>
        <div>
          <h1>No se pudo conectar con el servidor</h1>
          <button className={archivoStyles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  if (!session || !session.isAdmin) {
    return (
      <main className={archivoStyles.container}>
        <div>
          <h1>Solo el penitente pasará</h1>
          <button className={archivoStyles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </main>
    )
  }

  const toggle = async (username: string, appKey: AppKey, granted: boolean) => {
    setError(null)
    try {
      await setUserPermission(username, appKey, granted)
      setUsers(
        (prev) =>
          prev?.map((u) =>
            u.username === username
              ? {
                  ...u,
                  permissions: granted ? [...u.permissions, appKey] : u.permissions.filter((p) => p !== appKey),
                }
              : u,
          ) ?? null,
      )
    } catch {
      setError('No se pudo actualizar el permiso')
    }
  }

  return (
    <main className={styles.container}>
      <h1 className={styles.title}>Configuración — permisos</h1>
      {error && <p className={styles.error}>{error}</p>}
      {!users ? (
        <p className={styles.loading}>Cargando…</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Usuario</th>
              {APP_KEYS.map((key) => (
                <th key={key}>{APP_LABELS[key]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username}>
                <td>{user.username}</td>
                {APP_KEYS.map((key) => (
                  <td key={key}>
                    <input
                      type="checkbox"
                      checked={user.permissions.includes(key)}
                      onChange={(e) => toggle(user.username, key, e.target.checked)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}

export default AdminPanel
