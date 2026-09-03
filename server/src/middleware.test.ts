import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { createDb } from './db'
import { upsertUserLogin, setPermission } from './models'
import { createSessionMiddleware } from './session'
import { requireAuth, requirePermission } from './middleware'

function appWith(db: ReturnType<typeof createDb>) {
  const app = express()
  app.use(express.json())
  app.use(createSessionMiddleware('test-secret'))
  // ruta de utilidad para abrir sesión en el test
  app.post('/login/:username', (req, res) => {
    req.session = { username: req.params.username }
    res.json({ ok: true })
  })
  app.get('/protegido', requireAuth, requirePermission(db, 'aportaciones'), (_req, res) => res.json({ ok: true }))
  const server = app.listen(0)
  const { port } = server.address() as AddressInfo
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function sessionCookie(baseUrl: string, username: string): Promise<string> {
  const r = await fetch(`${baseUrl}/login/${username}`, { method: 'POST' })
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
}

test('requirePermission: 401 sin sesión', async () => {
  const { server, baseUrl } = appWith(createDb(':memory:'))
  try {
    const r = await fetch(`${baseUrl}/protegido`)
    assert.equal(r.status, 401)
  } finally {
    server.close()
  }
})

test('requirePermission: 403 si el usuario no tiene el permiso', async () => {
  const db = createDb(':memory:')
  upsertUserLogin(db, 'alice')
  const { server, baseUrl } = appWith(db)
  try {
    const cookie = await sessionCookie(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/protegido`, { headers: { Cookie: cookie } })
    assert.equal(r.status, 403)
  } finally {
    server.close()
  }
})

test('requirePermission: pasa si el usuario tiene el permiso', async () => {
  const db = createDb(':memory:')
  const alice = upsertUserLogin(db, 'alice')
  setPermission(db, alice.id, 'aportaciones', true)
  const { server, baseUrl } = appWith(db)
  try {
    const cookie = await sessionCookie(baseUrl, 'alice')
    const r = await fetch(`${baseUrl}/protegido`, { headers: { Cookie: cookie } })
    assert.equal(r.status, 200)
  } finally {
    server.close()
  }
})
