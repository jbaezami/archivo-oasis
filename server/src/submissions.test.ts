import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from './db'
import { upsertUserLogin } from './models'
import {
  createSubmission,
  getSubmission,
  listByUser,
  listAll,
  deleteSubmission,
  setStatus,
} from './submissions'

function seed() {
  const db = createDb(':memory:')
  const alice = upsertUserLogin(db, 'alice')
  const bob = upsertUserLogin(db, 'bob')
  return { db, alice, bob }
}

test('createSubmission inserta en estado pendiente', () => {
  const { db, alice } = seed()
  const s = createSubmission(db, {
    userId: alice.id,
    description: 'Una peli',
    category: 'movies',
    sourceType: 'url',
    sourceUrl: 'magnet:?xt=urn:btih:abc',
  })
  assert.equal(s.status, 'pendiente')
  assert.equal(s.userId, alice.id)
  assert.equal(s.sourceUrl, 'magnet:?xt=urn:btih:abc')
  assert.equal(s.fileName, null)
  assert.equal(s.processedAt, null)
  assert.deepEqual(getSubmission(db, s.id), s)
})

test('createSubmission con fichero guarda fileName y sourceUrl null', () => {
  const { db, alice } = seed()
  const s = createSubmission(db, {
    userId: alice.id,
    description: 'Serie',
    category: 'tv',
    sourceType: 'file',
    fileName: 'algo.torrent',
  })
  assert.equal(s.sourceType, 'file')
  assert.equal(s.fileName, 'algo.torrent')
  assert.equal(s.sourceUrl, null)
})

test('listByUser devuelve solo las del usuario, recientes primero', async () => {
  const { db, alice, bob } = seed()
  const first = createSubmission(db, { userId: alice.id, description: 'a', category: 'music', sourceType: 'url', sourceUrl: 'http://x' })
  await new Promise((r) => setTimeout(r, 5))
  const second = createSubmission(db, { userId: alice.id, description: 'b', category: 'music', sourceType: 'url', sourceUrl: 'http://y' })
  createSubmission(db, { userId: bob.id, description: 'c', category: 'music', sourceType: 'url', sourceUrl: 'http://z' })

  const mine = listByUser(db, alice.id)
  assert.equal(mine.length, 2)
  assert.equal(mine[0].id, second.id)
  assert.equal(mine[1].id, first.id)
})

test('listAll incluye el username y filtra por estado', () => {
  const { db, alice, bob } = seed()
  const a = createSubmission(db, { userId: alice.id, description: 'a', category: 'movies', sourceType: 'url', sourceUrl: 'http://x' })
  createSubmission(db, { userId: bob.id, description: 'b', category: 'tv', sourceType: 'url', sourceUrl: 'http://y' })
  setStatus(db, a.id, 'procesada', { processedBy: 'admin-user' })

  const all = listAll(db)
  assert.equal(all.length, 2)
  assert.ok(all.every((s) => typeof s.username === 'string'))

  const pendientes = listAll(db, 'pendiente')
  assert.equal(pendientes.length, 1)
  assert.equal(pendientes[0].username, 'bob')
})

test('deleteSubmission distingue not_found / forbidden / not_pending / deleted', () => {
  const { db, alice, bob } = seed()
  assert.equal(deleteSubmission(db, 999, alice.id), 'not_found')

  const s = createSubmission(db, { userId: alice.id, description: 'a', category: 'music', sourceType: 'url', sourceUrl: 'http://x' })
  assert.equal(deleteSubmission(db, s.id, bob.id), 'forbidden')

  const processed = createSubmission(db, { userId: alice.id, description: 'b', category: 'music', sourceType: 'url', sourceUrl: 'http://y' })
  setStatus(db, processed.id, 'rechazada', { processedBy: 'admin-user' })
  assert.equal(deleteSubmission(db, processed.id, alice.id), 'not_pending')

  assert.equal(deleteSubmission(db, s.id, alice.id), 'deleted')
  assert.equal(getSubmission(db, s.id), undefined)
})

test('setStatus marca procesada/rechazada con processed_by y motivo', () => {
  const { db, alice } = seed()
  const s = createSubmission(db, { userId: alice.id, description: 'a', category: 'movies', sourceType: 'url', sourceUrl: 'http://x' })

  const rejected = setStatus(db, s.id, 'rechazada', { processedBy: 'admin-user', rejectionReason: 'nope' })
  assert.equal(rejected.status, 'rechazada')
  assert.equal(rejected.rejectionReason, 'nope')
  assert.equal(rejected.processedBy, 'admin-user')
  assert.ok(rejected.processedAt)

  const s2 = createSubmission(db, { userId: alice.id, description: 'b', category: 'movies', sourceType: 'url', sourceUrl: 'http://y' })
  const processed = setStatus(db, s2.id, 'procesada', { processedBy: 'admin-user' })
  assert.equal(processed.status, 'procesada')
  assert.equal(processed.rejectionReason, null)
})
