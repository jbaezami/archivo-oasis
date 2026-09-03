import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from './db'
import {
  createInvite,
  findInvite,
  inviteStatus,
  listInvites,
  markInviteUsed,
  revokeInvite,
  INVITE_TTL_MS,
} from './invites'

test('createInvite genera un token y fija expires_at a 7 días', () => {
  const db = createDb(':memory:')
  const before = Date.now()
  const invite = createInvite(db, { createdBy: 'admin', label: 'para Marta' })
  assert.equal(typeof invite.token, 'string')
  assert.ok(invite.token.length >= 40)
  assert.equal(invite.createdBy, 'admin')
  assert.equal(invite.label, 'para Marta')
  assert.equal(invite.usedAt, null)
  assert.equal(invite.revokedAt, null)
  const ttl = new Date(invite.expiresAt).getTime() - new Date(invite.createdAt).getTime()
  assert.ok(Math.abs(ttl - INVITE_TTL_MS) < 1000)
  assert.ok(new Date(invite.expiresAt).getTime() > before)
})

test('createInvite acepta label ausente', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.equal(invite.label, null)
})

test('findInvite devuelve la invitación por token y undefined si no existe', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.deepEqual(findInvite(db, invite.token), invite)
  assert.equal(findInvite(db, 'no-existe'), undefined)
})

test('inviteStatus: valid recién creada', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.equal(inviteStatus(invite), 'valid')
})

test('inviteStatus: expired cuando expires_at está en el pasado', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  const future = new Date(Date.now() + INVITE_TTL_MS + 1000)
  assert.equal(inviteStatus(invite, future), 'expired')
})

test('inviteStatus: used tras markInviteUsed', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.equal(markInviteUsed(db, invite.token, 'marta'), true)
  const used = findInvite(db, invite.token)!
  assert.equal(inviteStatus(used), 'used')
  assert.equal(used.usedByUsername, 'marta')
})

test('markInviteUsed devuelve false si ya estaba usada', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  markInviteUsed(db, invite.token, 'marta')
  assert.equal(markInviteUsed(db, invite.token, 'otro'), false)
  assert.equal(findInvite(db, invite.token)!.usedByUsername, 'marta')
})

test('inviteStatus: revoked tiene prioridad sobre expired y used', () => {
  const db = createDb(':memory:')
  const invite = createInvite(db, { createdBy: 'admin' })
  assert.equal(revokeInvite(db, invite.token), true)
  const revoked = findInvite(db, invite.token)!
  const future = new Date(Date.now() + INVITE_TTL_MS + 1000)
  assert.equal(inviteStatus(revoked, future), 'revoked')
})

test('revokeInvite devuelve false para token inexistente o ya usado', () => {
  const db = createDb(':memory:')
  assert.equal(revokeInvite(db, 'no-existe'), false)
  const invite = createInvite(db, { createdBy: 'admin' })
  markInviteUsed(db, invite.token, 'marta')
  assert.equal(revokeInvite(db, invite.token), false)
})

test('listInvites devuelve todas con su estado, más recientes primero', () => {
  const db = createDb(':memory:')
  const a = createInvite(db, { createdBy: 'admin', label: 'a' })
  const b = createInvite(db, { createdBy: 'admin', label: 'b' })
  markInviteUsed(db, a.token, 'marta')
  const list = listInvites(db)
  assert.equal(list.length, 2)
  assert.equal(list[0].token, b.token)
  assert.equal(list[0].status, 'valid')
  assert.equal(list[1].token, a.token)
  assert.equal(list[1].status, 'used')
})
