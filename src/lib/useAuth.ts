import { useCallback, useEffect, useState } from 'react'
import { fetchSession, logout as logoutRequest, type AuthSession } from './authApi'

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'offline'

export interface AuthState {
  status: AuthStatus
  session: AuthSession | null
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

export function useAuth(): AuthState {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [session, setSession] = useState<AuthSession | null>(null)

  const refresh = useCallback(async () => {
    try {
      const result = await fetchSession()
      if (result) {
        setSession(result)
        setStatus('authenticated')
      } else {
        setSession(null)
        setStatus('anonymous')
      }
    } catch {
      // fetchSession only rejects on a network-level failure (backend unreachable) —
      // a resolved 401 already becomes `null` above, so this is genuinely "can't reach it".
      setSession(null)
      setStatus('offline')
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const logout = useCallback(async () => {
    await logoutRequest()
    setSession(null)
    setStatus('anonymous')
  }, [])

  return { status, session, refresh, logout }
}
