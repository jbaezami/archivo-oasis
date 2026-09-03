import { useNavigate } from 'react-router-dom'
import styles from './HomeButton.module.css'

function HomeButton() {
  const navigate = useNavigate()

  return (
    <button
      className={styles.button}
      onClick={() => navigate('/')}
      aria-label="Volver a la entrada"
      title="Volver a la entrada"
    >
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
        <path d="M4 21h16" />
        <path d="M7 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17" />
        <circle cx="14.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      </svg>
    </button>
  )
}

export default HomeButton
