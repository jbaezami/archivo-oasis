export class JellyfinAdminError extends Error {}
export class JellyfinUserExistsError extends JellyfinAdminError {}

export interface JellyfinAdminClient {
  createUser(username: string, password: string): Promise<void>
}

interface JellyfinUser {
  Id: string
  Name: string
}

export function createJellyfinAdminClient(baseUrl: string, apiKey: string): JellyfinAdminClient {
  const headers = {
    'Content-Type': 'application/json',
    'X-Emby-Token': apiKey,
  }

  async function call(pathname: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${baseUrl}${pathname}`, { ...init, headers })
    } catch {
      throw new JellyfinAdminError(`No se pudo contactar con Jellyfin (${pathname})`)
    }
  }

  return {
    async createUser(username: string, password: string): Promise<void> {
      const listResponse = await call('/Users', { method: 'GET' })
      if (!listResponse.ok) {
        throw new JellyfinAdminError('Jellyfin no devolvió la lista de usuarios')
      }
      const existing = (await listResponse.json()) as JellyfinUser[]
      if (existing.some((u) => u.Name.toLowerCase() === username.toLowerCase())) {
        throw new JellyfinUserExistsError(`El usuario "${username}" ya existe en Jellyfin`)
      }

      const createResponse = await call('/Users/New', {
        method: 'POST',
        body: JSON.stringify({ Name: username }),
      })
      if (!createResponse.ok) {
        throw new JellyfinAdminError('Jellyfin rechazó la creación del usuario')
      }
      const created = (await createResponse.json()) as JellyfinUser

      const passwordResponse = await call(`/Users/${created.Id}/Password`, {
        method: 'POST',
        body: JSON.stringify({ CurrentPw: '', NewPw: password }),
      })
      if (!passwordResponse.ok) {
        throw new JellyfinAdminError('Jellyfin rechazó la contraseña del usuario')
      }
    },
  }
}
