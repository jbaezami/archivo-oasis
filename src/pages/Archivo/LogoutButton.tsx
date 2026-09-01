import styles from './LogoutButton.module.css'

interface LogoutButtonProps {
  onLogout: () => void
}

function LogoutButton({ onLogout }: LogoutButtonProps) {
  return (
    <button className={styles.button} onClick={onLogout} aria-label="Cerrar sesión" title="Cerrar sesión">
      <svg
        viewBox="0 0 24 24"
        width="24"
        height="24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="14.5" cy="4.5" r="2.1" fill="currentColor" stroke="none" />
        <path d="M13.5 7.5 L9.5 12.5 L12.5 14 L11 20" />
        <path d="M13.5 7.5 L17.5 10 L15.5 13.5" />
        <path d="M9.5 12.5 L6 15" />
        <path d="M12.5 14 L16.5 17.5" />
      </svg>
    </button>
  )
}

export default LogoutButton
