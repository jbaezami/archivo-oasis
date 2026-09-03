import fs from 'node:fs'
import path from 'node:path'

function dir(dataDir: string): string {
  return path.join(dataDir, 'aportaciones')
}

export function submissionFilePath(dataDir: string, id: number): string {
  return path.join(dir(dataDir), `${id}.torrent`)
}

export function writeSubmissionFile(dataDir: string, id: number, bytes: Uint8Array): void {
  fs.mkdirSync(dir(dataDir), { recursive: true })
  fs.writeFileSync(submissionFilePath(dataDir, id), bytes)
}

export function readSubmissionFile(dataDir: string, id: number): Uint8Array {
  return fs.readFileSync(submissionFilePath(dataDir, id))
}

export function deleteSubmissionFile(dataDir: string, id: number): void {
  try {
    fs.rmSync(submissionFilePath(dataDir, id), { force: true })
  } catch (err) {
    console.error('No se pudo borrar el fichero de la aportación', { id, err })
  }
}
