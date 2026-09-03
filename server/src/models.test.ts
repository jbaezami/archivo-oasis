import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from './db'
import { upsertUserLogin, findUserByUsername, getPermissions, setPermission, listUsersWithPermissions, createInvitedUser } from './models'

test('upsertUserLogin creates a new user on first login and reuses it on the second', () => {
  const db = createDb(':memory:')
  const first = upsertUserLogin(db, 'alice')
  const second = upsertUserLogin(db, 'alice')
  assert.equal(first.id, second.id)
  assert.equal(second.jellyfinUsername, 'alice')
})

test('usernames are matched case-insensitively', () => {
  const db = createDb(':memory:')
  const first = upsertUserLogin(db, 'Alice')
  const second = upsertUserLogin(db, 'alice')
  assert.equal(first.id, second.id)
})

test('findUserByUsername returns undefined for an unknown user', () => {
  const db = createDb(':memory:')
  assert.equal(findUserByUsername(db, 'ghost'), undefined)
})

test('setPermission grants and revokes access to an app', () => {
  const db = createDb(':memory:')
  const user = upsertUserLogin(db, 'alice')
  assert.deepEqual(getPermissions(db, user.id), [])

  setPermission(db, user.id, 'cantina', true)
  assert.deepEqual(getPermissions(db, user.id), ['cantina'])

  setPermission(db, user.id, 'cantina', false)
  assert.deepEqual(getPermissions(db, user.id), [])
})

test('granting the same permission twice does not error or duplicate it', () => {
  const db = createDb(':memory:')
  const user = upsertUserLogin(db, 'alice')
  setPermission(db, user.id, 'jellyfin', true)
  setPermission(db, user.id, 'jellyfin', true)
  assert.deepEqual(getPermissions(db, user.id), ['jellyfin'])
})

test('listUsersWithPermissions returns every known user with their permissions', () => {
  const db = createDb(':memory:')
  const alice = upsertUserLogin(db, 'alice')
  upsertUserLogin(db, 'bob')
  setPermission(db, alice.id, 'cantina', true)

  const users = listUsersWithPermissions(db)
  assert.equal(users.length, 2)
  const aliceEntry = users.find((u) => u.username === 'alice')
  assert.deepEqual(aliceEntry?.permissions, ['cantina'])
})

test('createInvitedUser crea el usuario con lastLoginAt nulo', () => {
  const db = createDb(':memory:')
  const user = createInvitedUser(db, 'marta')
  assert.equal(user.jellyfinUsername, 'marta')
  assert.equal(user.lastLoginAt, null)
  assert.equal(findUserByUsername(db, 'marta')?.lastLoginAt, null)
})

test('createInvitedUser es idempotente y no pisa un login previo', () => {
  const db = createDb(':memory:')
  const first = upsertUserLogin(db, 'marta')
  assert.notEqual(first.lastLoginAt, null)
  const second = createInvitedUser(db, 'Marta')
  assert.equal(second.id, first.id)
  assert.notEqual(second.lastLoginAt, null)
})

test('un usuario invitado que luego inicia sesión obtiene lastLoginAt', () => {
  const db = createDb(':memory:')
  const invited = createInvitedUser(db, 'marta')
  assert.equal(invited.lastLoginAt, null)
  const loggedIn = upsertUserLogin(db, 'marta')
  assert.equal(loggedIn.id, invited.id)
  assert.notEqual(loggedIn.lastLoginAt, null)
})

test('listUsersWithPermissions incluye usuarios invitados con lastLoginAt null', () => {
  const db = createDb(':memory:')
  createInvitedUser(db, 'marta')
  const list = listUsersWithPermissions(db)
  const marta = list.find((u) => u.username === 'marta')
  assert.equal(marta?.lastLoginAt, null)
})
