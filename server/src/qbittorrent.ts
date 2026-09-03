export class QbittorrentError extends Error {}

export interface QbittorrentClient {
  addTorrent(input: { url?: string; file?: Uint8Array; fileName?: string; category: string }): Promise<void>
}

export function createQbittorrentClient(
  baseUrl: string,
  user: string,
  password: string,
): QbittorrentClient {
  let sid: string | null = null

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
    const text = await response.text().catch(() => '')
    const cookie = response.headers.get('set-cookie') ?? ''
    const match = cookie.match(/SID=([^;]+)/)
    if (!response.ok || text.trim() !== 'Ok.' || !match) {
      throw new QbittorrentError('No se pudo autenticar con qBittorrent')
    }
    sid = match[1]
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
        headers: { Cookie: `SID=${sid}`, Referer: baseUrl },
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
      if (!sid) await login()

      let response = await add(input)
      if (response.status === 403) {
        await login()
        response = await add(input)
      }

      const text = await response.text().catch(() => '')
      if (!response.ok || text.trim() !== 'Ok.') {
        const detail = text.trim() ? ` (${text.trim()})` : ` (HTTP ${response.status})`
        throw new QbittorrentError(`qBittorrent rechazó el torrent${detail}`)
      }
    },
  }
}
