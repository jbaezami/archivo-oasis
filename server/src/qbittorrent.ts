export class QbittorrentError extends Error {}

export interface QbittorrentClient {
  addTorrent(input: { url?: string; file?: Uint8Array; fileName?: string; category: string }): Promise<void>
}

export function createQbittorrentClient(
  baseUrl: string,
  user: string,
  password: string,
): QbittorrentClient {
  // Cookie de sesión completa ("nombre=valor"). El nombre depende de la versión:
  // qBittorrent < 5.1 usa `SID`; 5.1+ usa `QBT_SID_<puerto>`.
  let cookie: string | null = null

  async function login(): Promise<void> {
    let response: Response
    try {
      response = await fetch(`${baseUrl}/api/v2/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: baseUrl,
        },
        body: `username=${encodeURIComponent(user)}&password=${encodeURIComponent(password)}`,
      })
    } catch {
      throw new QbittorrentError('No se pudo contactar con qBittorrent')
    }

    // Éxito: qBittorrent < 5.1 responde 200 con cuerpo "Ok."; 5.1+ responde 204 sin
    // cuerpo. Credenciales incorrectas: 200 "Fails." o 403 (IP baneada).
    const text = (await response.text().catch(() => '')).trim()
    if (!response.ok || text === 'Fails.') {
      throw new QbittorrentError('No se pudo autenticar con qBittorrent')
    }

    const setCookie = response.headers.get('set-cookie') ?? ''
    const sessionCookie = setCookie.split(';')[0].trim()
    if (!sessionCookie || !/sid/i.test(sessionCookie)) {
      throw new QbittorrentError('qBittorrent no devolvió la cookie de sesión')
    }
    cookie = sessionCookie
  }

  async function add(
    input: { url?: string; file?: Uint8Array; fileName?: string; category: string },
  ): Promise<Response> {
    const form = new FormData()
    form.set('category', input.category)
    if (input.url) {
      form.set('urls', input.url)
    } else if (input.file) {
      form.set(
        'torrents',
        new Blob([input.file as BlobPart], { type: 'application/x-bittorrent' }),
        input.fileName ?? 'aportacion.torrent',
      )
    }
    try {
      return await fetch(`${baseUrl}/api/v2/torrents/add`, {
        method: 'POST',
        headers: { Cookie: cookie as string, Referer: baseUrl },
        body: form,
      })
    } catch {
      throw new QbittorrentError('No se pudo contactar con qBittorrent')
    }
  }

  return {
    async addTorrent(input) {
      if (!input.url && !input.file) {
        throw new QbittorrentError('La aportación no tiene URL ni fichero')
      }
      if (!cookie) await login()

      let response = await add(input)
      if (response.status === 403) {
        await login()
        response = await add(input)
      }

      const text = (await response.text().catch(() => '')).trim()

      if (!response.ok) {
        throw new QbittorrentError(`qBittorrent rechazó el torrent (HTTP ${response.status})`)
      }
      if (text === 'Fails.') {
        throw new QbittorrentError('qBittorrent rechazó el torrent')
      }
      // qBittorrent 5.1+ responde con JSON { success_count, failure_count, ... }.
      if (text.startsWith('{')) {
        let result: { success_count?: number; failure_count?: number }
        try {
          result = JSON.parse(text)
        } catch {
          return // JSON ilegible pero status 2xx: lo damos por bueno
        }
        if ((result.success_count ?? 0) === 0 && (result.failure_count ?? 0) > 0) {
          throw new QbittorrentError('qBittorrent no pudo añadir el torrent')
        }
      }
      // Versiones < 5.1: cuerpo "Ok." o vacío → éxito.
    },
  }
}
