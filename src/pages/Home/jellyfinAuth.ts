// Public Jellyfin server URL — not a secret, this is the same address the
// server's own login page is reachable at.
const JELLYFIN_URL = 'https://teatro.archivo-oasis.com'

export class JellyfinAuthError extends Error {}

// Validates credentials against Jellyfin's own login endpoint (the same one
// its official web/mobile/TV clients use). No API key involved — Jellyfin
// authenticates a user purely from username + password.
export async function authenticateWithJellyfin(username: string, password: string): Promise<void> {
  let response: Response
  try {
    response = await fetch(`${JELLYFIN_URL}/Users/AuthenticateByName`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Emby-Authorization':
          'MediaBrowser Client="Archivo Oasis", Device="Web", DeviceId="archivo-oasis-web", Version="1.0.0"',
      },
      body: JSON.stringify({ Username: username, Pw: password }),
    })
  } catch {
    throw new JellyfinAuthError('No se pudo conectar con el servidor')
  }

  if (response.status === 401 || response.status === 400) {
    throw new JellyfinAuthError('Usuario o contraseña incorrectos')
  }
  if (!response.ok) {
    throw new JellyfinAuthError('No se pudo conectar con el servidor')
  }
}
