import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app'
import { createDb } from '../db'
import { JellyfinAuthError, type JellyfinClient } from '../jellyfin'

const acceptingJellyfin: JellyfinClient = {
  async authenticate() {
    // succeeds for any credentials
  },
}

const rejectingJellyfin: JellyfinClient = {
  async authenticate() {
    throw new JellyfinAuthError('Usuario o contraseña incorrectos')
  },
}

function startTestServer(jellyfin: JellyfinClient) {
  const app = createApp({
    db: createDb(':memory:'),
    jellyfin,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

// cookie-session signs its cookie by default, which means a single response
// sets *two* Set-Cookie headers: the session value and a companion
// `<name>.sig` cookie used to verify it. `Headers.get('set-cookie')` joins
// multiple Set-Cookie headers into one comma-separated string per the fetch
// spec, so naively splitting on ';' silently drops the .sig cookie and
// breaks signature verification on the next request. `getSetCookie()`
// returns each header separately, so we combine both into one Cookie header.
function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

test('POST /api/login succeeds and sets a session cookie', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'whatever' }),
    })
    assert.equal(response.status, 200)
    const body = await response.json()
    assert.equal(body.username, 'alice')
    assert.equal(body.isAdmin, false)
    assert.deepEqual(body.permissions, [])
    assert.ok(response.headers.get('set-cookie'))
  } finally {
    server.close()
  }
})

test('POST /api/login rejects invalid credentials with 401', async () => {
  const { server, baseUrl } = startTestServer(rejectingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'wrong' }),
    })
    assert.equal(response.status, 401)
  } finally {
    server.close()
  }
})

test('POST /api/login rejects a missing username or password with 400', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice' }),
    })
    assert.equal(response.status, 400)
  } finally {
    server.close()
  }
})

test('GET /api/me returns 401 without a session', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/me`)
    assert.equal(response.status, 401)
  } finally {
    server.close()
  }
})

test('GET /api/me returns the current user after logging in', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'whatever' }),
    })
    const cookie = cookieHeaderFrom(loginResponse)

    const meResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: cookie } })
    assert.equal(meResponse.status, 200)
    const body = await meResponse.json()
    assert.equal(body.username, 'alice')
  } finally {
    server.close()
  }
})

test('login marks the configured admin username as isAdmin', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const response = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Admin-User', password: 'whatever' }),
    })
    const body = await response.json()
    assert.equal(body.isAdmin, true)
  } finally {
    server.close()
  }
})

test('POST /api/logout clears the session', async () => {
  const { server, baseUrl } = startTestServer(acceptingJellyfin)
  try {
    const loginResponse = await fetch(`${baseUrl}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'whatever' }),
    })
    const loginCookie = cookieHeaderFrom(loginResponse)

    const logoutResponse = await fetch(`${baseUrl}/api/logout`, {
      method: 'POST',
      headers: { Cookie: loginCookie },
    })
    const logoutCookie = cookieHeaderFrom(logoutResponse)

    const meResponse = await fetch(`${baseUrl}/api/me`, { headers: { Cookie: logoutCookie } })
    assert.equal(meResponse.status, 401)
  } finally {
    server.close()
  }
})
