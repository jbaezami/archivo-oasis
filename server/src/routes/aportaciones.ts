import { Router } from 'express'
import type { DB } from '../db'
import { requireAuth, requirePermission } from '../middleware'
import { findUserByUsername } from '../models'
import {
  createSubmission,
  listByUser,
  deleteSubmission,
  SUBMISSION_CATEGORIES,
  type SubmissionCategory,
  type SubmissionRecord,
  type SubmissionStatus,
} from '../submissions'
import { writeSubmissionFile, deleteSubmissionFile } from '../submissionFiles'

export interface SubmissionJson {
  id: number
  description: string
  category: SubmissionCategory
  sourceType: 'url' | 'file'
  sourceUrl: string | null
  fileName: string | null
  status: SubmissionStatus
  rejectionReason: string | null
  createdAt: string
  processedAt: string | null
  processedBy: string | null
}

export function toSubmissionJson(s: SubmissionRecord): SubmissionJson {
  return {
    id: s.id,
    description: s.description,
    category: s.category,
    sourceType: s.sourceType,
    sourceUrl: s.sourceUrl,
    fileName: s.fileName,
    status: s.status,
    rejectionReason: s.rejectionReason,
    createdAt: s.createdAt,
    processedAt: s.processedAt,
    processedBy: s.processedBy,
  }
}

const MAX_FILE_BYTES = 2 * 1024 * 1024

export function createAportacionesRouter(db: DB, dataDir: string): Router {
  const router = Router()
  router.use(requireAuth)
  router.use(requirePermission(db, 'aportaciones'))

  function currentUserId(username: string): number {
    return findUserByUsername(db, username)!.id
  }

  router.get('/', (req, res) => {
    const userId = currentUserId(req.session!.username as string)
    res.json({ submissions: listByUser(db, userId).map(toSubmissionJson) })
  })

  router.post('/', (req, res) => {
    const body = req.body as {
      description?: string
      category?: string
      sourceType?: string
      sourceUrl?: string
      fileName?: string
      fileBase64?: string
    }

    const description = typeof body.description === 'string' ? body.description.trim() : ''
    if (!description || description.length > 280) {
      res.status(400).json({ error: 'La descripción es obligatoria y no puede pasar de 280 caracteres' })
      return
    }
    if (!SUBMISSION_CATEGORIES.includes(body.category as SubmissionCategory)) {
      res.status(400).json({ error: 'Categoría inválida' })
      return
    }
    const category = body.category as SubmissionCategory

    if (body.sourceType === 'url') {
      const url = typeof body.sourceUrl === 'string' ? body.sourceUrl.trim() : ''
      if (!/^(https?:\/\/|magnet:)/i.test(url)) {
        res.status(400).json({ error: 'La URL debe empezar por http://, https:// o magnet:' })
        return
      }
      if (url.length > 2048) {
        res.status(400).json({ error: 'La URL es demasiado larga' })
        return
      }
      const submission = createSubmission(db, {
        userId: currentUserId(req.session!.username as string),
        description,
        category,
        sourceType: 'url',
        sourceUrl: url,
      })
      res.status(201).json({ submission: toSubmissionJson(submission) })
      return
    }

    if (body.sourceType === 'file') {
      const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : ''
      if (!fileName || !fileName.toLowerCase().endsWith('.torrent')) {
        res.status(400).json({ error: 'El fichero debe ser un .torrent' })
        return
      }
      if (fileName.length > 255) {
        res.status(400).json({ error: 'El nombre del fichero es demasiado largo' })
        return
      }
      const bytes = Buffer.from(String(body.fileBase64 ?? ''), 'base64')
      if (bytes.length === 0 || bytes.length > MAX_FILE_BYTES) {
        res.status(400).json({ error: 'El fichero está vacío o supera los 2 MB' })
        return
      }
      const submission = createSubmission(db, {
        userId: currentUserId(req.session!.username as string),
        description,
        category,
        sourceType: 'file',
        fileName,
      })
      try {
        writeSubmissionFile(dataDir, submission.id, bytes)
      } catch (err) {
        deleteSubmission(db, submission.id, currentUserId(req.session!.username as string))
        console.error('No se pudo guardar el fichero de la aportación', { id: submission.id, err })
        res.status(500).json({ error: 'No se pudo guardar el fichero' })
        return
      }
      res.status(201).json({ submission: toSubmissionJson(submission) })
      return
    }

    res.status(400).json({ error: 'Debes indicar una URL o un fichero' })
  })

  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: 'Aportación no encontrada' })
      return
    }
    const userId = currentUserId(req.session!.username as string)
    const result = deleteSubmission(db, id, userId)
    if (result === 'not_found') {
      res.status(404).json({ error: 'Aportación no encontrada' })
      return
    }
    if (result === 'forbidden') {
      res.status(403).json({ error: 'Esa aportación no es tuya' })
      return
    }
    if (result === 'not_pending') {
      res.status(409).json({ error: 'Solo puedes cancelar aportaciones pendientes' })
      return
    }
    deleteSubmissionFile(dataDir, id)
    res.status(204).end()
  })

  return router
}
