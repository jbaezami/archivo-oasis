import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import styles from './AdminLayout.module.css'

const NAV_GROUPS = [
  {
    label: 'Usuarios',
    items: [
      { label: 'Permisos', to: 'permisos' },
      { label: 'Invitaciones', to: 'invitaciones' },
    ],
  },
]

function AdminLayout() {
  const { status, session } = useAuth()
  const navigate = useNavigate()

  if (status === 'loading') {
    return <div className={styles.centered} />
  }

  if (status === 'offline') {
    return (
      <div className={styles.centered}>
        <div>
          <h1>No se pudo conectar con el servidor</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </div>
    )
  }

  if (!session || !session.isAdmin) {
    return (
      <div className={styles.centered}>
        <div>
          <h1>Solo el penitente pasará</h1>
          <button className={styles.button} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <nav className={styles.sidebar}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <p className={styles.groupLabel}>{group.label}</p>
            {group.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  isActive ? `${styles.item} ${styles.itemActive}` : styles.item
                }
              >
                {item.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <main className={styles.content}>
        <Outlet />
      </main>
    </div>
  )
}

export default AdminLayout
