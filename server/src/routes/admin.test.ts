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

test('POST /api/admin/invites crea una invitación para el admin', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const response = await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ label: 'para Marta' }),
    })
    assert.equal(response.status, 201)
    const { invite } = await response.json()
    assert.equal(typeof invite.token, 'string')
    assert.equal(invite.label, 'para Marta')
    assert.equal(invite.createdBy, 'admin-user')
    assert.equal(invite.status, 'valid')
    assert.ok(new Date(invite.expiresAt).getTime() > Date.now())
  } finally {
    server.close()
  }
})

test('POST /api/admin/invites sin label funciona', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const response = await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({}),
    })
    assert.equal(response.status, 201)
    const { invite } = await response.json()
    assert.equal(invite.label, null)
  } finally {
    server.close()
  }
})

test('los endpoints de invitaciones rechazan a quien no es admin', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const noSession = await fetch(`${baseUrl}/api/admin/invites`)
    assert.equal(noSession.status, 401)
    const userCookie = await loginAs(baseUrl, 'alice')
    const asUser = await fetch(`${baseUrl}/api/admin/invites`, { headers: { Cookie: userCookie } })
    assert.equal(asUser.status, 403)
  } finally {
    server.close()
  }
})

test('GET /api/admin/invites lista las invitaciones con su estado', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ label: 'una' }),
    })
    const response = await fetch(`${baseUrl}/api/admin/invites`, { headers: { Cookie: adminCookie } })
    assert.equal(response.status, 200)
    const { invites } = await response.json()
    assert.equal(invites.length, 1)
    assert.equal(invites[0].status, 'valid')
  } finally {
    server.close()
  }
})

test('DELETE /api/admin/invites/:token revoca una invitación pendiente', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const created = await fetch(`${baseUrl}/api/admin/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({}),
    })
    const { invite } = await created.json()

    const del = await fetch(`${baseUrl}/api/admin/invites/${invite.token}`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    assert.equal(del.status, 204)

    const list = await fetch(`${baseUrl}/api/admin/invites`, { headers: { Cookie: adminCookie } })
    const { invites } = await list.json()
    assert.equal(invites[0].status, 'revoked')
  } finally {
    server.close()
  }
})

test('DELETE /api/admin/invites/:token devuelve 404 si no existe', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const del = await fetch(`${baseUrl}/api/admin/invites/no-existe`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    assert.equal(del.status, 404)
  } finally {
    server.close()
  }
})

test('GET /api/admin/users marca isAdmin en la fila del administrador', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    await loginAs(baseUrl, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const response = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    const { users } = await response.json()
    const alice = users.find((u: { username: string }) => u.username === 'alice')
    const admin = users.find((u: { username: string }) => u.username === 'admin-user')
    assert.equal(alice.isAdmin, false)
    assert.equal(admin.isAdmin, true)
  } finally {
    server.close()
  }
})

test('DELETE /api/admin/users/:username elimina al usuario y sus permisos', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    await loginAs(baseUrl, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    await fetch(`${baseUrl}/api/admin/permissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ username: 'alice', appKey: 'cantina', granted: true }),
    })

    const del = await fetch(`${baseUrl}/api/admin/users/alice`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    assert.equal(del.status, 204)

    const afterDelete = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    const { users: usersAfter } = await afterDelete.json()
    assert.equal(
      usersAfter.find((u: { username: string }) => u.username === 'alice'),
      undefined,
    )

    // vuelve a iniciar sesión: fila nueva, sin los permisos antiguos
    await loginAs(baseUrl, 'alice')
    const afterRelogin = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    const { users: usersRelogin } = await afterRelogin.json()
    const aliceAgain = usersRelogin.find((u: { username: string }) => u.username === 'alice')
    assert.deepEqual(aliceAgain.permissions, [])
  } finally {
    server.close()
  }
})

test('DELETE /api/admin/users/:username devuelve 404 si el usuario no existe', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const del = await fetch(`${baseUrl}/api/admin/users/fantasma`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    assert.equal(del.status, 404)
  } finally {
    server.close()
  }
})

test('DELETE /api/admin/users/:username rechaza borrar al administrador con 403', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const del = await fetch(`${baseUrl}/api/admin/users/Admin-User`, {
      method: 'DELETE',
      headers: { Cookie: adminCookie },
    })
    assert.equal(del.status, 403)

    const list = await fetch(`${baseUrl}/api/admin/users`, { headers: { Cookie: adminCookie } })
    const { users } = await list.json()
    assert.ok(users.find((u: { username: string }) => u.username === 'admin-user'))
  } finally {
    server.close()
  }
})

test('DELETE /api/admin/users/:username rechaza a quien no es admin', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    await loginAs(baseUrl, 'target')
    const userCookie = await loginAs(baseUrl, 'alice')

    const noSession = await fetch(`${baseUrl}/api/admin/users/target`, { method: 'DELETE' })
    assert.equal(noSession.status, 401)

    const asUser = await fetch(`${baseUrl}/api/admin/users/target`, {
      method: 'DELETE',
      headers: { Cookie: userCookie },
    })
    assert.equal(asUser.status, 403)
  } finally {
    server.close()
  }
})
