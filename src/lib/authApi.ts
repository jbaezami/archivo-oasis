export type AppKey = 'jellyfin' | 'jellyseerr' | 'cantina' | 'aportaciones'
export const APP_KEYS: AppKey[] = ['jellyfin', 'jellyseerr', 'cantina', 'aportaciones']

export interface AuthSession {
  username: string
  isAdmin: boolean
  permissions: AppKey[]
}

export class JellyfinAuthError extends Error {}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null)
  return typeof body?.error === 'string' ? body.error : fallback
}

export async function login(username: string, password: string): Promise<AuthSession> {
  let response: Response
  try {
    response = await fetch('/api/login', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    throw new JellyfinAuthError('No se pudo conectar con el servidor')
  }

  if (!response.ok) {
    throw new JellyfinAuthError(await readErrorMessage(response, 'No se pudo conectar con el servidor'))
  }

  return (await response.json()) as AuthSession
}

export async function fetchSession(): Promise<AuthSession | null> {
  const response = await fetch('/api/me', { credentials: 'same-origin' })
  if (!response.ok) return null
  return (await response.json()) as AuthSession
}

export async function logout(): Promise<void> {
  await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' })
}

export interface AdminUser {
  username: string
  lastLoginAt: string
  permissions: AppKey[]
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const response = await fetch('/api/admin/users', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo cargar la lista de usuarios'))
  }
  const body = (await response.json()) as { users: AdminUser[] }
  return body.users
}

export async function setUserPermission(username: string, appKey: AppKey, granted: boolean): Promise<void> {
  const response = await fetch('/api/admin/permissions', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, appKey, granted }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo actualizar el permiso'))
  }
}
