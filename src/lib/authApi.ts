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
  lastLoginAt: string | null
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

export type InviteStatus = 'valid' | 'used' | 'expired' | 'revoked' | 'not_found'

export interface InviteSummary {
  token: string
  label: string | null
  createdBy: string
  createdAt: string
  expiresAt: string
  status: 'valid' | 'used' | 'expired' | 'revoked'
  usedAt: string | null
  usedByUsername: string | null
}

export class InviteGoneError extends Error {}

export async function generateInvite(label?: string): Promise<InviteSummary> {
  const response = await fetch('/api/admin/invites', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label }),
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo generar la invitación'))
  }
  const body = (await response.json()) as { invite: InviteSummary }
  return body.invite
}

export async function fetchInvites(): Promise<InviteSummary[]> {
  const response = await fetch('/api/admin/invites', { credentials: 'same-origin' })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo cargar la lista de invitaciones'))
  }
  const body = (await response.json()) as { invites: InviteSummary[] }
  return body.invites
}

export async function revokeInvite(token: string): Promise<void> {
  const response = await fetch(`/api/admin/invites/${encodeURIComponent(token)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'No se pudo revocar la invitación'))
  }
}

export async function fetchInviteStatus(token: string): Promise<InviteStatus> {
  const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error('No se pudo comprobar la invitación')
  }
  const body = (await response.json()) as { status: InviteStatus }
  return body.status
}

export async function consumeInvite(token: string, username: string, password: string): Promise<void> {
  const response = await fetch(`/api/invites/${encodeURIComponent(token)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (response.ok) return

  const message = await readErrorMessage(response, 'No se pudo crear la cuenta')
  if (response.status === 410) {
    throw new InviteGoneError(message)
  }
  throw new Error(message)
}
