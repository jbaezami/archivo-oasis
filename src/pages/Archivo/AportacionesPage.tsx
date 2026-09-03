import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../lib/useAuth'
import HomeButton from './HomeButton'
import {
  acceptSubmission,
  createSubmission,
  deleteSubmission,
  fetchAdminSubmissions,
  fetchMySubmissions,
  rejectSubmission,
  type AdminSubmission,
  type Submission,
  type SubmissionCategory,
  type SubmissionStatus,
} from '../../lib/authApi'
import styles from './AportacionesPage.module.css'

const CATEGORY_LABEL: Record<SubmissionCategory, string> = {
  movies: 'Películas',
  tv: 'Series',
  music: 'Música',
}

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  pendiente: 'Pendiente',
  procesada: 'Procesada',
  rechazada: 'Rechazada',
}

function fileToBase64(file: File): Promise<string> {
  return file.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf)
    let binary = ''
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  })
}

function StatusBadge({ status }: { status: SubmissionStatus }) {
  return <span className={`${styles.badge} ${styles[status]}`}>{STATUS_LABEL[status]}</span>
}

function UserSection() {
  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState<SubmissionCategory>('movies')
  const [mode, setMode] = useState<'url' | 'file'>('url')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchMySubmissions()
      .then(setSubmissions)
      .catch(() => {
        setSubmissions([])
        setError('No se pudieron cargar tus aportaciones')
      })
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const created = await createSubmission(
        mode === 'url'
          ? { description, category, sourceType: 'url', sourceUrl: url }
          : {
              description,
              category,
              sourceType: 'file',
              fileName: file?.name,
              fileBase64: file ? await fileToBase64(file) : undefined,
            },
      )
      setSubmissions((prev) => [created, ...(prev ?? [])])
      setDescription('')
      setUrl('')
      setFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo enviar la aportación')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (id: number) => {
    if (!window.confirm('¿Cancelar esta aportación?')) return
    setError(null)
    try {
      await deleteSubmission(id)
      setSubmissions((prev) => prev?.filter((s) => s.id !== id) ?? null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cancelar')
    }
  }

  return (
    <section>
      <h1 className={styles.h1}>Aportaciones</h1>
      <form className={styles.form} onSubmit={submit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="ap-desc">
            Descripción
          </label>
          <textarea
            id="ap-desc"
            className={styles.textarea}
            maxLength={280}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />
          <span className={styles.counter}>{description.length}/280</span>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="ap-cat">
            Categoría
          </label>
          <select
            id="ap-cat"
            className={styles.select}
            value={category}
            onChange={(e) => setCategory(e.target.value as SubmissionCategory)}
          >
            <option value="movies">Películas</option>
            <option value="tv">Series</option>
            <option value="music">Música</option>
          </select>
        </div>

        <div className={styles.radios}>
          <label>
            <input type="radio" checked={mode === 'url'} onChange={() => setMode('url')} /> Enlace
          </label>
          <label>
            <input type="radio" checked={mode === 'file'} onChange={() => setMode('file')} /> Fichero
          </label>
        </div>

        {mode === 'url' ? (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ap-url">
              URL o enlace magnet
            </label>
            <input
              id="ap-url"
              className={styles.input}
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://… o magnet:…"
              required
            />
          </div>
        ) : (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="ap-file">
              Fichero .torrent
            </label>
            <input
              id="ap-file"
              className={styles.input}
              type="file"
              accept=".torrent"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              required
            />
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <button type="submit" className={styles.submit} disabled={busy}>
          {busy ? 'Enviando…' : 'Enviar aportación'}
        </button>
      </form>

      {!submissions ? (
        <p className={styles.empty}>Cargando…</p>
      ) : submissions.length === 0 ? (
        <p className={styles.empty}>Todavía no has enviado ninguna aportación.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Descripción</th>
              <th>Categoría</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={s.id}>
                <td>{s.description}</td>
                <td>{CATEGORY_LABEL[s.category]}</td>
                <td>{new Date(s.createdAt).toLocaleDateString('es-ES')}</td>
                <td>
                  <StatusBadge status={s.status} />
                  {s.status === 'rechazada' && s.rejectionReason && (
                    <div className={styles.reason}>Motivo: {s.rejectionReason}</div>
                  )}
                </td>
                <td>
                  {s.status === 'pendiente' && (
                    <button className={`${styles.rowButton} ${styles.danger}`} onClick={() => cancel(s.id)}>
                      Cancelar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function AdminSection() {
  const [submissions, setSubmissions] = useState<AdminSubmission[] | null>(null)
  const [filter, setFilter] = useState<SubmissionStatus | 'todas'>('todas')
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    fetchAdminSubmissions(filter === 'todas' ? undefined : filter)
      .then(setSubmissions)
      .catch(() => {
        setSubmissions([])
        setError('No se pudieron cargar las aportaciones')
      })
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  const update = (updated: Submission) =>
    setSubmissions(
      (prev) => prev?.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) ?? null,
    )

  const accept = async (id: number) => {
    setError(null)
    setBusyId(id)
    try {
      update(await acceptSubmission(id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo aceptar')
    } finally {
      setBusyId(null)
    }
  }

  const reject = async (id: number) => {
    const reason = window.prompt('Motivo (opcional):')
    if (reason === null) return
    setError(null)
    setBusyId(id)
    try {
      update(await rejectSubmission(id, reason.trim() || undefined))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo rechazar')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section>
      <h2 className={styles.h2}>Moderación</h2>
      <select
        className={`${styles.select} ${styles.filter}`}
        value={filter}
        onChange={(e) => setFilter(e.target.value as SubmissionStatus | 'todas')}
      >
        <option value="todas">Todas</option>
        <option value="pendiente">Pendientes</option>
        <option value="procesada">Procesadas</option>
        <option value="rechazada">Rechazadas</option>
      </select>

      {error && <p className={styles.error}>{error}</p>}

      {!submissions ? (
        <p className={styles.empty}>Cargando…</p>
      ) : submissions.length === 0 ? (
        <p className={styles.empty}>No hay aportaciones.</p>
      ) : (
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Descripción</th>
              <th>Categoría</th>
              <th>Origen</th>
              <th>Fecha</th>
              <th>Estado</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {submissions.map((s) => (
              <tr key={s.id}>
                <td>{s.username}</td>
                <td>{s.description}</td>
                <td>{CATEGORY_LABEL[s.category]}</td>
                <td>
                  {s.sourceType === 'url' && s.sourceUrl ? (
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer">
                      {s.sourceUrl.length > 40 ? `${s.sourceUrl.slice(0, 40)}…` : s.sourceUrl}
                    </a>
                  ) : (
                    s.fileName ?? '—'
                  )}
                </td>
                <td>{new Date(s.createdAt).toLocaleDateString('es-ES')}</td>
                <td>
                  <StatusBadge status={s.status} />
                  {s.status === 'rechazada' && s.rejectionReason && (
                    <div className={styles.reason}>Motivo: {s.rejectionReason}</div>
                  )}
                </td>
                <td>
                  {s.status === 'pendiente' && (
                    <>
                      <button
                        className={styles.rowButton}
                        onClick={() => accept(s.id)}
                        disabled={busyId === s.id}
                      >
                        Aceptar
                      </button>
                      <button
                        className={`${styles.rowButton} ${styles.danger}`}
                        onClick={() => reject(s.id)}
                        disabled={busyId === s.id}
                      >
                        Denegar
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function AportacionesPage() {
  const { status, session } = useAuth()
  const navigate = useNavigate()

  if (status === 'loading') {
    return <div className={styles.centered} />
  }

  if (status === 'offline') {
    return (
      <div className={styles.centered}>
        <HomeButton />
        <div>
          <h1>No se pudo conectar con el servidor</h1>
          <button className={styles.submit} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </div>
    )
  }

  const canUse = session?.permissions.includes('aportaciones') ?? false
  const isAdmin = session?.isAdmin ?? false

  if (!session || (!canUse && !isAdmin)) {
    return (
      <div className={styles.centered}>
        <HomeButton />
        <div>
          <h1>Solo el penitente pasará</h1>
          <button className={styles.submit} onClick={() => navigate('/')}>
            Volver
          </button>
        </div>
      </div>
    )
  }

  return (
    <main className={styles.container}>
      <HomeButton />
      <div className={styles.inner}>
        {canUse && <UserSection />}
        {isAdmin && <AdminSection />}
      </div>
    </main>
  )
}

export default AportacionesPage
