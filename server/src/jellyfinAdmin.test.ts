import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJellyfinAdminClient, JellyfinAdminError, JellyfinUserExistsError } from './jellyfinAdmin'

interface Call {
  url: string
  method: string
  body: unknown
}

function stubFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const original = global.fetch
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    }
    calls.push(call)
    return handler(call)
  }) as typeof fetch
  return { calls, restore: () => { global.fetch = original } }
}

test('createUser crea el usuario y fija la contraseña', async () => {
  const { calls, restore } = stubFetch((call) => {
    if (call.method === 'GET' && call.url.endsWith('/Users')) return new Response('[]', { status: 200 })
    if (call.url.endsWith('/Users/New')) return new Response(JSON.stringify({ Id: 'u-1' }), { status: 200 })
    if (call.url.endsWith('/Users/u-1/Password')) return new Response(null, { status: 204 })
    return new Response(null, { status: 500 })
  })
  try {
    const client = createJellyfinAdminClient('https://jf.example.com', 'key-123')
    await client.createUser('marta', 'secret123')
    const newCall = calls.find((c) => c.url.endsWith('/Users/New'))!
    assert.deepEqual(newCall.body, { Name: 'marta' })
    const pwCall = calls.find((c) => c.url.endsWith('/Users/u-1/Password'))!
    assert.deepEqual(pwCall.body, { CurrentPw: '', NewPw: 'secret123' })
  } finally {
    restore()
  }
})

test('createUser envía la API key en X-Emby-Token', async () => {
  let seenHeader: string | null = null
  const original = global.fetch
  global.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    seenHeader = new Headers(init?.headers).get('X-Emby-Token')
    if (init?.method === undefined || init.method === 'GET') return new Response('[]', { status: 200 })
    if (String(_input).endsWith('/Users/New')) return new Response(JSON.stringify({ Id: 'u-1' }), { status: 200 })
    return new Response(null, { status: 204 })
  }) as typeof fetch
  try {
    await createJellyfinAdminClient('https://jf.example.com', 'key-123').createUser('marta', 'secret123')
    assert.equal(seenHeader, 'key-123')
  } finally {
    global.fetch = original
  }
})

test('createUser lanza JellyfinUserExistsError si el nombre ya existe', async () => {
  const { restore } = stubFetch((call) => {
    if (call.method === 'GET' && call.url.endsWith('/Users')) {
      return new Response(JSON.stringify([{ Id: 'x', Name: 'Marta' }]), { status: 200 })
    }
    return new Response(null, { status: 500 })
  })
  try {
    const client = createJellyfinAdminClient('https://jf.example.com', 'key-123')
    await assert.rejects(
      () => client.createUser('marta', 'secret123'),
      (err: unknown) => err instanceof JellyfinUserExistsError,
    )
  } finally {
    restore()
  }
})

test('createUser lanza JellyfinAdminError si Jellyfin responde error al crear', async () => {
  const { restore } = stubFetch((call) => {
    if (call.method === 'GET' && call.url.endsWith('/Users')) return new Response('[]', { status: 200 })
    if (call.url.endsWith('/Users/New')) return new Response('nope', { status: 500 })
    return new Response(null, { status: 500 })
  })
  try {
    const client = createJellyfinAdminClient('https://jf.example.com', 'key-123')
    await assert.rejects(
      () => client.createUser('marta', 'secret123'),
      (err: unknown) => err instanceof JellyfinAdminError && !(err instanceof JellyfinUserExistsError),
    )
  } finally {
    restore()
  }
})

test('createUser lanza JellyfinAdminError si la red falla', async () => {
  const original = global.fetch
  global.fetch = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  try {
    const client = createJellyfinAdminClient('https://jf.example.com', 'key-123')
    await assert.rejects(
      () => client.createUser('marta', 'secret123'),
      (err: unknown) => err instanceof JellyfinAdminError,
    )
  } finally {
    global.fetch = original
  }
})
