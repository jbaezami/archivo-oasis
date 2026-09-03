import { useEffect, useState } from 'react'
import { APP_KEYS, fetchAdminUsers, setUserPermission, type AdminUser, type AppKey } from '../../lib/authApi'
import styles from './PermisosPage.module.css'

const APP_LABELS: Record<AppKey, string> = {
  jellyfin: 'Jellyfin',
  jellyseerr: 'Jellyseerr',
  cantina: 'La Cantina',
  aportaciones: 'Aportaciones',
}

function PermisosPage() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchAdminUsers()
      .then(setUsers)
      .catch(() => setError('No se pudo cargar la lista de usuarios'))
  }, [])

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
                  permissions: granted
                    ? [...u.permissions, appKey]
                    : u.permissions.filter((p) => p !== appKey),
                }
              : u,
          ) ?? null,
      )
    } catch {
      setError('No se pudo actualizar el permiso')
    }
  }

  return (
    <section>
      <h1 className={styles.title}>Permisos</h1>
      {error && <p className={styles.error}>{error}</p>}
      {!users ? (
        <p className={styles.loading}>Cargando…</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Último acceso</th>
              {APP_KEYS.map((key) => (
                <th key={key}>{APP_LABELS[key]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.username}>
                <td>{user.username}</td>
                <td>{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleDateString('es-ES') : '—'}</td>
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
    </section>
  )
}

export default PermisosPage
