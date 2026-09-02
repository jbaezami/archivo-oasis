import { Link } from 'react-router-dom'
import type { AppKey, AuthSession } from '../../lib/authApi'
import styles from './Dashboard.module.css'

interface Tile {
  key: AppKey
  label: string
  href: string
  external: boolean
}

const APP_TILES: Record<AppKey, Tile> = {
  jellyfin: { key: 'jellyfin', label: 'Jellyfin', href: 'https://teatro.archivo-oasis.com', external: true },
  jellyseerr: {
    key: 'jellyseerr',
    label: 'Jellyseerr',
    href: 'https://peticiones.archivo-oasis.com',
    external: true,
  },
  cantina: { key: 'cantina', label: 'La Cantina', href: '/archivo/cantina', external: false },
  aportaciones: { key: 'aportaciones', label: 'Aportaciones', href: '/archivo/aportaciones', external: false },
}

interface DashboardProps {
  session: AuthSession
}

function Dashboard({ session }: DashboardProps) {
  const tiles = session.permissions.map((key) => APP_TILES[key])

  if (tiles.length === 0 && !session.isAdmin) {
    return (
      <div className={styles.empty}>
        <h1>Pendiente de aprobación</h1>
        <p>Un administrador debe concederte acceso a alguna sección.</p>
      </div>
    )
  }

  return (
    <div className={styles.grid}>
      {tiles.map((tile) =>
        tile.external ? (
          <a key={tile.key} className={styles.tile} href={tile.href} target="_blank" rel="noreferrer">
            {tile.label}
          </a>
        ) : (
          <Link key={tile.key} className={styles.tile} to={tile.href}>
            {tile.label}
          </Link>
        ),
      )}
      {session.isAdmin && (
        <Link className={styles.tile} to="/archivo/admin">
          Configuración
        </Link>
      )}
    </div>
  )
}

export default Dashboard
