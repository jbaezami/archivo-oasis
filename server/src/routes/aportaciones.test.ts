import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app'
import { createDb } from '../db'
import type { DB } from '../db'
import type { JellyfinClient } from '../jellyfin'
import { upsertUserLogin, setPermission } from '../models'
import { submissionFilePath } from '../submissionFiles'

const acceptingJellyfin: JellyfinClient = { async authenticate() {} }

function startTestServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aportaciones-routes-'))
  const db: DB = createDb(':memory:')
  const app = createApp({
    db,
    jellyfin: acceptingJellyfin,
    jellyfinAdmin: null,
    qbittorrent: null,
    dataDir,
    adminUsername: 'admin-user',
    sessionSecret: 'test-secret',
  })
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}`, db, dataDir }
}

async function loginAs(baseUrl: string, username: string): Promise<string> {
  const r = await fetch(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password: 'whatever' }),
  })
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

function grant(db: DB, username: string) {
  const u = upsertUserLogin(db, username)
  setPermission(db, u.id, 'aportaciones', true)
}

const B64_TORRENT = Buffer.from('d8:announce4:teste').toString('base64')

test('POST /api/aportaciones sin el permiso -> 403', async () => {
  const { server, baseUrl } = startTestServer()
  try {
    const cookie = await loginAs(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'x', category: 'movies', sourceType: 'url', sourceUrl: 'http://x' }),
    })
    assert.equal(r.status, 403)
  } finally {
    server.close()
  }
})

test('POST /api/aportaciones con URL crea la aportación', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    grant(db, 'alice')
    const cookie = await loginAs(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'Una peli', category: 'movies', sourceType: 'url', sourceUrl: 'magnet:?xt=urn:btih:abc' }),
    })
    assert.equal(r.status, 201)
    const { submission } = await r.json()
    assert.equal(submission.status, 'pendiente')
    assert.equal(submission.sourceUrl, 'magnet:?xt=urn:btih:abc')
  } finally {
    server.close()
  }
})

test('POST /api/aportaciones con fichero base64 crea la aportación y escribe el fichero', async () => {
  const { server, baseUrl, db, dataDir } = startTestServer()
  try {
    grant(db, 'alice')
    const cookie = await loginAs(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'Serie', category: 'tv', sourceType: 'file', fileName: 'x.torrent', fileBase64: B64_TORRENT }),
    })
    assert.equal(r.status, 201)
    const { submission } = await r.json()
    assert.equal(submission.fileName, 'x.torrent')
    assert.ok(fs.existsSync(submissionFilePath(dataDir, submission.id)))
  } finally {
    server.close()
  }
})

test('POST /api/aportaciones valida descripción, categoría, origen y fichero', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    grant(db, 'alice')
    const cookie = await loginAs(baseUrl, 'alice')
    const post = (body: unknown) =>
      fetch(`${baseUrl}/api/aportaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      })

    assert.equal((await post({ description: 'x'.repeat(281), category: 'movies', sourceType: 'url', sourceUrl: 'http://x' })).status, 400)
    assert.equal((await post({ description: 'ok', category: 'nope', sourceType: 'url', sourceUrl: 'http://x' })).status, 400)
    assert.equal((await post({ description: 'ok', category: 'movies', sourceType: 'url', sourceUrl: '   ' })).status, 400)
    assert.equal((await post({ description: 'ok', category: 'movies', sourceType: 'file', fileName: 'x.txt', fileBase64: B64_TORRENT })).status, 400)
    assert.equal((await post({ description: 'ok', category: 'movies', sourceType: 'file', fileName: 'x.torrent', fileBase64: Buffer.alloc(3 * 1024 * 1024).toString('base64') })).status, 400)
  } finally {
    server.close()
  }
})

test('GET /api/aportaciones devuelve solo las del usuario, recientes primero', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    grant(db, 'alice')
    grant(db, 'bob')
    const aliceCookie = await loginAs(baseUrl, 'alice')
    const bobCookie = await loginAs(baseUrl, 'bob')
    const mk = (cookie: string, desc: string) =>
      fetch(`${baseUrl}/api/aportaciones`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ description: desc, category: 'music', sourceType: 'url', sourceUrl: 'http://x' }),
      })
    await mk(aliceCookie, 'a1')
    await new Promise((r) => setTimeout(r, 5))
    await mk(aliceCookie, 'a2')
    await mk(bobCookie, 'b1')

    const r = await fetch(`${baseUrl}/api/aportaciones`, { headers: { Cookie: aliceCookie } })
    const { submissions } = await r.json()
    assert.deepEqual(
      submissions.map((s: { description: string }) => s.description),
      ['a2', 'a1'],
    )
  } finally {
    server.close()
  }
})

test('DELETE /api/aportaciones/:id: propia y pendiente -> 204 y el fichero desaparece', async () => {
  const { server, baseUrl, db, dataDir } = startTestServer()
  try {
    grant(db, 'alice')
    const cookie = await loginAs(baseUrl, 'alice')
    const created = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ description: 'x', category: 'tv', sourceType: 'file', fileName: 'x.torrent', fileBase64: B64_TORRENT }),
    })
    const { submission } = await created.json()

    const del = await fetch(`${baseUrl}/api/aportaciones/${submission.id}`, { method: 'DELETE', headers: { Cookie: cookie } })
    assert.equal(del.status, 204)
    assert.equal(fs.existsSync(submissionFilePath(dataDir, submission.id)), false)
  } finally {
    server.close()
  }
})

test('DELETE /api/aportaciones/:id: de otro usuario -> 403; inexistente -> 404', async () => {
  const { server, baseUrl, db } = startTestServer()
  try {
    grant(db, 'alice')
    grant(db, 'bob')
    const aliceCookie = await loginAs(baseUrl, 'alice')
    const bobCookie = await loginAs(baseUrl, 'bob')
    const created = await fetch(`${baseUrl}/api/aportaciones`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: aliceCookie },
      body: JSON.stringify({ description: 'x', category: 'tv', sourceType: 'url', sourceUrl: 'http://x' }),
    })
    const { submission } = await created.json()

    assert.equal((await fetch(`${baseUrl}/api/aportaciones/${submission.id}`, { method: 'DELETE', headers: { Cookie: bobCookie } })).status, 403)
    assert.equal((await fetch(`${baseUrl}/api/aportaciones/99999`, { method: 'DELETE', headers: { Cookie: aliceCookie } })).status, 404)
  } finally {
    server.close()
  }
})
