export class JellyfinAdminError extends Error {}
export class JellyfinUserExistsError extends JellyfinAdminError {}

export interface JellyfinAdminClient {
  createUser(username: string, password: string): Promise<void>
}

interface JellyfinUser {
  Id: string
  Name: string | null
}

export function createJellyfinAdminClient(baseUrl: string, apiKey: string): JellyfinAdminClient {
  const headers = {
    'Content-Type': 'application/json',
    'X-Emby-Token': apiKey,
  }

  async function call(pathname: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(`${baseUrl}${pathname}`, { ...init, headers })
    } catch (err) {
      throw new JellyfinAdminError(`No se pudo contactar con Jellyfin (${pathname})`, { cause: err })
    }
  }

  async function parseJson<T>(response: Response): Promise<T> {
    try {
      return (await response.json()) as T
    } catch {
      throw new JellyfinAdminError('Respuesta inesperada de Jellyfin')
    }
  }

  return {
    async createUser(username: string, password: string): Promise<void> {
      const listResponse = await call('/Users', { method: 'GET' })
      if (!listResponse.ok) {
        throw new JellyfinAdminError('Jellyfin no devolvió la lista de usuarios')
      }
      const existing = await parseJson<JellyfinUser[]>(listResponse)
      if (existing.some((u) => u.Name?.toLowerCase() === username.toLowerCase())) {
        throw new JellyfinUserExistsError(`El usuario "${username}" ya existe en Jellyfin`)
      }

      const createResponse = await call('/Users/New', {
        method: 'POST',
        body: JSON.stringify({ Name: username }),
      })
      if (!createResponse.ok) {
        throw new JellyfinAdminError('Jellyfin rechazó la creación del usuario')
      }
      const created = await parseJson<JellyfinUser>(createResponse)
      if (!created || typeof created.Id !== 'string' || !created.Id) {
        throw new JellyfinAdminError('Jellyfin no devolvió el id del usuario creado')
      }

      try {
        const passwordResponse = await call(`/Users/${created.Id}/Password`, {
          method: 'POST',
          body: JSON.stringify({ CurrentPw: '', NewPw: password }),
        })
        if (!passwordResponse.ok) {
          throw new JellyfinAdminError('Jellyfin rechazó la contraseña del usuario')
        }
      } catch (err) {
        try {
          await call(`/Users/${created.Id}`, { method: 'DELETE' })
        } catch {
          // best-effort: ignoramos errores de limpieza
        }
        console.error(
          `No se pudo fijar la contraseña; usuario Jellyfin ${created.Id} eliminado (best-effort)`,
        )
        throw err instanceof JellyfinAdminError
          ? err
          : new JellyfinAdminError('Jellyfin rechazó la contraseña del usuario')
      }
    },
  }
}
