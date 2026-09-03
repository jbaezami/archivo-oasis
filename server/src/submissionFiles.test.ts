import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  submissionFilePath,
  writeSubmissionFile,
  readSubmissionFile,
  deleteSubmissionFile,
} from './submissionFiles'

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aportaciones-test-'))
}

test('submissionFilePath es determinista y vive bajo aportaciones/', () => {
  const dir = tmpDir()
  assert.equal(submissionFilePath(dir, 42), path.join(dir, 'aportaciones', '42.torrent'))
})

test('writeSubmissionFile crea el directorio y escribe los bytes; readSubmissionFile los devuelve', () => {
  const dir = tmpDir()
  const bytes = new Uint8Array([1, 2, 3, 4])
  writeSubmissionFile(dir, 7, bytes)
  assert.deepEqual(new Uint8Array(readSubmissionFile(dir, 7)), bytes)
})

test('deleteSubmissionFile borra el fichero y no lanza si no existe', () => {
  const dir = tmpDir()
  writeSubmissionFile(dir, 9, new Uint8Array([0]))
  deleteSubmissionFile(dir, 9)
  assert.equal(fs.existsSync(submissionFilePath(dir, 9)), false)
  assert.doesNotThrow(() => deleteSubmissionFile(dir, 9))
})
