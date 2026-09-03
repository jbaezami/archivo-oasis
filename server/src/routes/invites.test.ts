import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApp } from '../app'
import { createDb } from '../db'
import type { DB } from '../db'
import type { JellyfinClient } from '../jellyfin'
import {
  type JellyfinAdminClient,
  JellyfinAdminError,
  JellyfinUserExistsError,
} from '../jellyfinAdmin'
import { createInvite, findInvite, markInviteUsed, revokeInvite, INVITE_TTL_MS } from '../invites'
import { getPermissions, findUserByUsername } from '../models'

const acceptingJellyfin: JellyfinClient = { async authenticate() {} }

const recordingAdmin = () => {
  const calls: { username: string; password: string }[] = []
  const client: JellyfinAdminClient = {
    async createUser(username, password) {
      calls.push({ username, password })
    },
  }
  return { calls, client }
}

function startTestServer(jellyfinAdmin: JellyfinAdminClient | null) {
  const db: DB = createDb(':memory:')
  const app = createApp({
    db,
    jellyfin: acceptingJellyfin,
    jellyfinAdmin,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}`, db }
}

test('GET /api/invites/:token devuelve el estado', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const valid = await fetch(`${baseUrl}/api/invites/${invite.token}`)
    assert.deepEqual(await valid.json(), { status: 'valid' })

    const unknown = await fetch(`${baseUrl}/api/invites/no-existe`)
    assert.deepEqual(await unknown.json(), { status: 'not_found' })

    revokeInvite(db, invite.token)
    const revoked = await fetch(`${baseUrl}/api/invites/${invite.token}`)
    assert.deepEqual(await revoked.json(), { status: 'revoked' })
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token crea la cuenta, da permisos y consume el token', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { ok: true })

    assert.deepEqual(admin.calls, [{ username: 'marta', password: 'secret123' }])

    const user = findUserByUsername(db, 'marta')!
    assert.equal(user.lastLoginAt, null)
    assert.deepEqual(getPermissions(db, user.id).sort(), ['jellyfin', 'jellyseerr'])

    const consumed = findInvite(db, invite.token)!
    assert.equal(consumed.usedByUsername, 'marta')
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token con token ya usado devuelve 410 y no llama a Jellyfin', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    markInviteUsed(db, invite.token, 'otro')
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 410)
    assert.equal(admin.calls.length, 0)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token con contraseña corta devuelve 400, token intacto', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'x' }),
    })
    assert.equal(response.status, 400)
    assert.equal(admin.calls.length, 0)
    assert.equal(findInvite(db, invite.token)!.usedAt, null)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token con username vacío o con espacios devuelve 400', async () => {
  const admin = recordingAdmin()
  const { server, baseUrl, db } = startTestServer(admin.client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    for (const username of ['', '  ', 'con espacio']) {
      const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: 'secret123' }),
      })
      assert.equal(response.status, 400)
    }
    assert.equal(findInvite(db, invite.token)!.usedAt, null)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token: nombre ya en Jellyfin devuelve 409, token intacto', async () => {
  const client: JellyfinAdminClient = {
    async createUser() {
      throw new JellyfinUserExistsError('ya existe')
    },
  }
  const { server, baseUrl, db } = startTestServer(client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 409)
    assert.equal(findInvite(db, invite.token)!.usedAt, null)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token: fallo de Jellyfin devuelve 502, token intacto', async () => {
  const client: JellyfinAdminClient = {
    async createUser() {
      throw new JellyfinAdminError('jellyfin caído')
    },
  }
  const { server, baseUrl, db } = startTestServer(client)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 502)
    assert.equal(findInvite(db, invite.token)!.usedAt, null)
  } finally {
    server.close()
  }
})

test('POST /api/invites/:token sin jellyfinAdmin configurado devuelve 503', async () => {
  const { server, baseUrl, db } = startTestServer(null)
  try {
    const invite = createInvite(db, { createdBy: 'admin-user' })
    const response = await fetch(`${baseUrl}/api/invites/${invite.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'marta', password: 'secret123' }),
    })
    assert.equal(response.status, 503)
  } finally {
    server.close()
  }
})
