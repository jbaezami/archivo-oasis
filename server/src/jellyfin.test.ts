import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJellyfinClient, JellyfinAuthError } from './jellyfin'

test('authenticate resolves when Jellyfin responds 200', async () => {
  const originalFetch = global.fetch
  global.fetch = (async () => new Response(null, { status: 200 })) as typeof fetch
  try {
    const client = createJellyfinClient('https://jellyfin.example.com')
    await client.authenticate('alice', 'correct-password')
  } finally {
    global.fetch = originalFetch
  }
})

test('authenticate throws JellyfinAuthError with a friendly message on 401', async () => {
  const originalFetch = global.fetch
  global.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch
  try {
    const client = createJellyfinClient('https://jellyfin.example.com')
    await assert.rejects(
      () => client.authenticate('alice', 'wrong-password'),
      (err: unknown) => err instanceof JellyfinAuthError && err.message === 'Usuario o contraseña incorrectos',
    )
  } finally {
    global.fetch = originalFetch
  }
})

test('authenticate throws JellyfinAuthError when the network request fails', async () => {
  const originalFetch = global.fetch
  global.fetch = (async () => {
    throw new Error('network down')
  }) as typeof fetch
  try {
    const client = createJellyfinClient('https://jellyfin.example.com')
    await assert.rejects(
      () => client.authenticate('alice', 'whatever'),
      (err: unknown) => err instanceof JellyfinAuthError && err.message === 'No se pudo conectar con el servidor',
    )
  } finally {
    global.fetch = originalFetch
  }
})
