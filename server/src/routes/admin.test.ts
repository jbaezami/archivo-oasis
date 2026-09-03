import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app'
import { createDb } from '../db'
import type { JellyfinClient } from '../jellyfin'
import { QbittorrentError, type QbittorrentClient } from '../qbittorrent'
import { upsertUserLogin, setPermission } from '../models'
import { createSubmission } from '../submissions'
import { submissionFilePath, writeSubmissionFile } from '../submissionFiles'

const acceptingJellyfin: JellyfinClient = {
  async authenticate() {},
}

function startTestServer(qbittorrent: QbittorrentClient | null = null) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-aportaciones-'))
  const db = createDb(':memory:')
  const app = createApp({
    db,
    jellyfin: acceptingJellyfin,
    jellyfinAdmin: null,
    qbittorrent,
    dataDir,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}`, db, dataDir }
}

const recordingQb = () => {
  const calls: { url?: string; fileName?: string; category: string }[] = []
  const client: QbittorrentClient = {
    async addTorrent(input) {
      calls.push({ url: input.url, fileName: input.fileName, category: input.category })
    },
  }
  return { calls, client }
}

function seedSubmission(
  db: ReturnType<typeof createDb>,
  username: string,
  over: Partial<Parameters<typeof createSubmission>[1]> = {},
) {
  const u = upsertUserLogin(db, username)
  setPermission(db, u.id, 'aportaciones', true)
  return createSubmission(db, {
    userId: u.id,
    description: 'algo',
    category: 'movies',
    sourceType: 'url',
    sourceUrl: 'magnet:?xt=urn:btih:abc',
    ...over,
  })
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

test('GET /api/admin/aportaciones lista todas y filtra por estado', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    seedSubmission(db, 'alice')
    seedSubmission(db, 'bob')
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const all = await (await fetch(`${baseUrl}/api/admin/aportaciones`, { headers: { Cookie: adminCookie } })).json()
    assert.equal(all.submissions.length, 2)
    assert.ok(all.submissions.every((s: { username: string }) => typeof s.username === 'string'))

    const proc = await (await fetch(`${baseUrl}/api/admin/aportaciones?status=procesada`, { headers: { Cookie: adminCookie } })).json()
    assert.equal(proc.submissions.length, 0)
  } finally {
    server.close()
  }
})

test('aceptar envia a qBittorrent, marca procesada y borra el fichero', async () => {
  const qb = recordingQb()
  const { server, baseUrl, db, dataDir } = startTestServer(qb.client)
  try {
    const s = seedSubmission(db, 'alice', { sourceType: 'file', fileName: 'x.torrent', sourceUrl: null })
    writeSubmissionFile(dataDir, s.id, new Uint8Array([1, 2, 3]))
    const adminCookie = await loginAs(baseUrl, 'admin-user')

    const r = await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })
    assert.equal(r.status, 200)
    const { submission } = await r.json()
    assert.equal(submission.status, 'procesada')
    assert.equal(submission.processedBy, 'admin-user')
    assert.equal(qb.calls.length, 1)
    assert.equal(qb.calls[0].category, 'movies')
    assert.equal(fs.existsSync(submissionFilePath(dataDir, s.id)), false)
  } finally {
    server.close()
  }
})

test('aceptar cuando qBittorrent falla -> 502 y sigue pendiente', async () => {
  const failing: QbittorrentClient = {
    async addTorrent() {
      throw new QbittorrentError('qBittorrent rechazo el torrent')
    },
  }
  const { server, baseUrl, db } = startTestServer(failing)
  try {
    const s = seedSubmission(db, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const r = await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })
    assert.equal(r.status, 502)

    const list = await (await fetch(`${baseUrl}/api/admin/aportaciones`, { headers: { Cookie: adminCookie } })).json()
    assert.equal(list.submissions[0].status, 'pendiente')
  } finally {
    server.close()
  }
})

test('aceptar sin qBittorrent configurado -> 503', async () => {
  const { server, baseUrl, db } = startTestServer(null)
  try {
    const s = seedSubmission(db, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const r = await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })
    assert.equal(r.status, 503)
  } finally {
    server.close()
  }
})

test('aceptar/rechazar sobre algo no pendiente -> 409', async () => {
  const qb = recordingQb()
  const { server, baseUrl, db } = startTestServer(qb.client)
  try {
    const s = seedSubmission(db, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })

    assert.equal((await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/aceptar`, { method: 'POST', headers: { Cookie: adminCookie } })).status, 409)
    assert.equal(
      (await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/rechazar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
        body: JSON.stringify({ reason: 'x' }),
      })).status,
      409,
    )
  } finally {
    server.close()
  }
})

test('rechazar marca rechazada con el motivo', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    const s = seedSubmission(db, 'alice')
    const adminCookie = await loginAs(baseUrl, 'admin-user')
    const r = await fetch(`${baseUrl}/api/admin/aportaciones/${s.id}/rechazar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ reason: '  duplicado  ' }),
    })
    assert.equal(r.status, 200)
    const { submission } = await r.json()
    assert.equal(submission.status, 'rechazada')
    assert.equal(submission.rejectionReason, 'duplicado')
  } finally {
    server.close()
  }
})

test('los endpoints de moderacion rechazan a quien no es admin', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const userCookie = await loginAs(baseUrl, 'alice')
    assert.equal((await fetch(`${baseUrl}/api/admin/aportaciones`, { headers: { Cookie: userCookie } })).status, 403)
  } finally {
    server.close()
  }
})
