import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createDb } from './db'
import { upsertUserLogin, findUserByUsername, getPermissions, setPermission, listUsersWithPermissions } from './models'

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
