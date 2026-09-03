import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app'
import { createDb } from '../db'
import type { JellyfinClient } from '../jellyfin'

const acceptingJellyfin: JellyfinClient = {
  async authenticate() {},
}

function startTestServer() {
  const app = createApp({
    db: createDb(':memory:'),
    jellyfin: acceptingJellyfin,
    jellyfinAdmin: null,
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
// (See the identical helper in ../routes/auth.test.ts.)
function cookieHeaderFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ')
}

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'whatever' }),
  })
  return cookieHeaderFrom(response)
}

test('GET /api/admin/users is rejected without a session', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const response = await fetch(`${baseUrl}/api/admin/users`)
    assert.equal(response.status, 401)
  } finally {
    server.close()
  }
})

test('GET /api/admin/users is rejected for a non-admin user', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const cookie = await loginAs(baseUrl, 'alice')
    const response = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: cookie } })
    assert.equal(response.status, 403)
  } finally {
    server.close()
  }
})

test('GET /api/admin/users lists everyone who has logged in', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    await loginAs(baseUrl, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const response = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    assert.equal(response.status, 200)
    const body = await response.json()
    const usernames = body.users.map((u: { username: string }) => u.username)
    assert.ok(usernames.includes('alice'))
    assert.ok(usernames.includes('admin-user'))
  } finally {
    server.close()
  }
})

test('POST /api/admin/permissions grants and revokes access', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    await loginAs(baseUrl, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const grant = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ username: 'alice', appKey: 'cantina', granted: true }),
    })
    assert.equal(grant.status, 200)

    const afterGrant = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    const { users: usersAfterGrant } = await afterGrant.json()
    const aliceAfterGrant = usersAfterGrant.find((u: { username: string }) => u.username === 'alice')
    assert.deepEqual(aliceAfterGrant.permissions, ['cantina'])

    const revoke = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ username: 'alice', appKey: 'cantina', granted: false }),
    })
    assert.equal(revoke.status, 200)

    const afterRevoke = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    const { users: usersAfterRevoke } = await afterRevoke.json()
    const aliceAfterRevoke = usersAfterRevoke.find((u: { username: string }) => u.username === 'alice')
    assert.deepEqual(aliceAfterRevoke.permissions, [])
  } finally {
    server.close()
  }
})

test('POST /api/admin/permissions rejects an unknown appKey', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    await loginAs(baseUrl, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const response = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ username: 'alice', appKey: 'not-a-real-app', granted: true }),
    })
    assert.equal(response.status, 400)
  } finally {
    server.close()
  }
})

test('POST /api/admin/permissions returns 404 for an unknown username', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const response = await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ username: 'ghost', appKey: 'cantina', granted: true }),
    })
    assert.equal(response.status, 404)
  } finally {
    server.close()
  }
})
