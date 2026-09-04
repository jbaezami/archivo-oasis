import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createQbittorrentClient, QbittorrentError } from './qbittorrent'

interface Call {
  url: string
  method: string
  headers: Headers
  body: unknown
}

function stub(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const original = global.fetch
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    }
    calls.push(call)
    return handler(call, calls.length)
  }) as typeof fetch
  return { calls, restore: () => { global.fetch = original } }
}

// qBittorrent 5.1+: login responde 204 sin cuerpo y la cookie se llama QBT_SID_<puerto>.
function loginOk(): Response {
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': 'QBT_SID_8080=abc123; HttpOnly; SameSite=Lax; path=/' },
  })
}

// qBittorrent 5.1+: /torrents/add responde 200 con JSON.
function addOkJson(): Response {
  return new Response(JSON.stringify({ added_torrent_ids: ['h'], failure_count: 0, success_count: 1 }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('addTorrent hace login (204) y envía la URL con la categoría y la cookie', async () => {
  const { calls, restore } = stub((call) => {
    if (call.url.endsWith('/api/v2/auth/login')) return loginOk()
    if (call.url.endsWith('/api/v2/torrents/add')) return addOkJson()
    return new Response(null, { status: 500 })
  })
  try {
    await createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({
      url: 'magnet:?xt=urn:btih:abc',
      category: 'movies',
    })
    const login = calls.find((c) => c.url.endsWith('/auth/login'))!
    assert.equal(String(login.body), 'username=admin&password=secret')
    const add = calls.find((c) => c.url.endsWith('/torrents/add'))!
    assert.ok(add.body instanceof FormData)
    const form = add.body as FormData
    assert.equal(form.get('urls'), 'magnet:?xt=urn:btih:abc')
    assert.equal(form.get('category'), 'movies')
    assert.equal(add.headers.get('cookie'), 'QBT_SID_8080=abc123')
  } finally {
    restore()
  }
})

test('addTorrent acepta también la API antigua (200 "Ok." + cookie SID)', async () => {
  const { calls, restore } = stub((call) => {
    if (call.url.endsWith('/auth/login')) {
      return new Response('Ok.', { status: 200, headers: { 'set-cookie': 'SID=old123; path=/' } })
    }
    return new Response('Ok.', { status: 200 })
  })
  try {
    await createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({
      url: 'http://x',
      category: 'tv',
    })
    const add = calls.find((c) => c.url.endsWith('/torrents/add'))!
    assert.equal(add.headers.get('cookie'), 'SID=old123')
  } finally {
    restore()
  }
})

test('addTorrent con fichero manda el campo torrents', async () => {
  const { calls, restore } = stub((call) => {
    if (call.url.endsWith('/auth/login')) return loginOk()
    return addOkJson()
  })
  try {
    await createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({
      file: new Uint8Array([1, 2, 3]),
      fileName: 'x.torrent',
      category: 'tv',
    })
    const add = calls.find((c) => c.url.endsWith('/torrents/add'))!
    const form = add.body as FormData
    assert.ok(form.get('torrents') instanceof Blob)
    assert.equal(form.get('category'), 'tv')
  } finally {
    restore()
  }
})

test('un 403 en add fuerza re-login y un reintento', async () => {
  const { calls, restore } = stub((call, n) => {
    if (call.url.endsWith('/auth/login')) return loginOk()
    if (n === 2) return new Response('Forbidden', { status: 403 }) // primer add
    return addOkJson() // segundo add
  })
  try {
    await createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({
      url: 'http://x',
      category: 'music',
    })
    const logins = calls.filter((c) => c.url.endsWith('/auth/login'))
    const adds = calls.filter((c) => c.url.endsWith('/torrents/add'))
    assert.equal(logins.length, 2)
    assert.equal(adds.length, 2)
  } finally {
    restore()
  }
})

test('credenciales incorrectas ("Fails.") -> QbittorrentError', async () => {
  const { restore } = stub((call) => {
    if (call.url.endsWith('/auth/login')) return new Response('Fails.', { status: 200 })
    return new Response(null, { status: 500 })
  })
  try {
    await assert.rejects(
      () => createQbittorrentClient('https://qb.example.com', 'admin', 'bad').addTorrent({ url: 'http://x', category: 'movies' }),
      (err: unknown) => err instanceof QbittorrentError,
    )
  } finally {
    restore()
  }
})

test('login sin cookie de sesión -> QbittorrentError', async () => {
  const { restore } = stub((call) => {
    if (call.url.endsWith('/auth/login')) return new Response(null, { status: 204 })
    return new Response(null, { status: 500 })
  })
  try {
    await assert.rejects(
      () => createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({ url: 'http://x', category: 'movies' }),
      (err: unknown) => err instanceof QbittorrentError,
    )
  } finally {
    restore()
  }
})

test('add con failure_count > 0 -> QbittorrentError', async () => {
  const { restore } = stub((call) => {
    if (call.url.endsWith('/auth/login')) return loginOk()
    return new Response(JSON.stringify({ failure_count: 1, success_count: 0 }), { status: 200 })
  })
  try {
    await assert.rejects(
      () => createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({ url: 'http://x', category: 'movies' }),
      (err: unknown) => err instanceof QbittorrentError,
    )
  } finally {
    restore()
  }
})

test('respuesta "Fails." en add -> QbittorrentError', async () => {
  const { restore } = stub((call) => {
    if (call.url.endsWith('/auth/login')) return loginOk()
    return new Response('Fails.', { status: 200 })
  })
  try {
    await assert.rejects(
      () => createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({ url: 'http://x', category: 'movies' }),
      (err: unknown) => err instanceof QbittorrentError,
    )
  } finally {
    restore()
  }
})

test('fallo de red -> QbittorrentError', async () => {
  const original = global.fetch
  global.fetch = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  try {
    await assert.rejects(
      () => createQbittorrentClient('https://qb.example.com', 'admin', 'secret').addTorrent({ url: 'http://x', category: 'movies' }),
      (err: unknown) => err instanceof QbittorrentError,
    )
  } finally {
    global.fetch = original
  }
})
