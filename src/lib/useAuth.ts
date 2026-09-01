import { useCallback, useState } from 'react'

const STORAGE_KEY = 'archivo-oasis:authenticated'

function readStoredAuth(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function useAuth() {
  const [authenticated, setAuthenticatedState] = useState<boolean>(readStoredAuth)

  const setAuthenticated = useCallback((value: boolean) => {
    setAuthenticatedState(value)
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, 'true')
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // localStorage unavailable (private browsing, etc.) — state still holds for this session.
    }
  }, [])

  return { authenticated, setAuthenticated }
}
