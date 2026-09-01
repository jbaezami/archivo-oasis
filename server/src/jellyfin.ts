export class JellyfinAuthError extends Error {}

export interface JellyfinClient {
  authenticate(username: string, password: string): Promise<void>
}

export function createJellyfinClient(baseUrl: string): JellyfinClient {
  return {
    async authenticate(username: string, password: string): Promise<void> {
      let response: Response
      try {
        response = await fetch(`${baseUrl}/Users/AuthenticateByName`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Emby-Authorization':
              'MediaBrowser Client="Archivo Oasis", Device="Server", DeviceId="archivo-oasis-api", Version="1.0.0"',
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
    },
  }
}
