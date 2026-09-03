import { useEffect, useState } from 'react'
import { fetchInvites, generateInvite, revokeInvite, type InviteSummary } from '../../lib/authApi'
import styles from './InvitacionesPage.module.css'

const STATUS_LABEL: Record<InviteSummary['status'], string> = {
  valid: 'Pendiente',
  used: 'Usada',
  expired: 'Caducada',
  revoked: 'Revocada',
}

function inviteUrl(token: string): string {
  return `${window.location.origin}/invitacion/${token}`
}

function InvitacionesPage() {
  const [invites, setInvites] = useState<InviteSummary[] | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    fetchInvites()
      .then(setInvites)
      .catch(() => setError('No se pudo cargar la lista de invitaciones'))
  }, [])

  const handleGenerate = async () => {
    setBusy(true)
    setError(null)
    try {
      const invite = await generateInvite(label.trim() || undefined)
      setInvites((prev) => [invite, ...(prev ?? [])])
      setLabel('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo generar la invitación')
    } finally {
      setBusy(false)
    }
  }

  const handleRevoke = async (token: string) => {
    setError(null)
    try {
      await revokeInvite(token)
      setInvites(
        (prev) => prev?.map((i) => (i.token === token ? { ...i, status: 'revoked' } : i)) ?? null,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo revocar la invitación')
    }
  }

  const handleCopy = async (token: string) => {
    await navigator.clipboard.writeText(inviteUrl(token))
    setCopied(token)
    setTimeout(() => setCopied((c) => (c === token ? null : c)), 2000)
  }

  return (
    <section>
      <h1 className={styles.title}>Invitaciones</h1>

      <div className={styles.generate}>
        <input
          className={styles.input}
          type="text"
          placeholder="Nota (opcional): para quién es"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <button className={styles.button} onClick={handleGenerate} disabled={busy}>
          {busy ? 'Generando…' : 'Generar invitación'}
        </button>
      </div>

      {error && <p className={styles.error}>{error}</p>}

      {!invites ? (
        <p className={styles.status}>Cargando…</p>
      ) : invites.length === 0 ? (
        <p className={styles.status}>Todavía no hay invitaciones.</p>
      ) : (
        <div className={styles.list}>
          {invites.map((invite) => (
            <div key={invite.token} className={styles.row}>
              <div className={styles.rowTop}>
                <strong>{invite.label ?? 'Sin nota'}</strong>
                <span
                  className={
                    invite.status === 'valid' ? `${styles.status} ${styles.statusValid}` : styles.status
                  }
                >
                  {STATUS_LABEL[invite.status]}
                </span>
              </div>

              {invite.status === 'valid' && (
                <div className={styles.url}>
                  <span className={styles.urlText}>{inviteUrl(invite.token)}</span>
                  <button className={styles.linkButton} onClick={() => handleCopy(invite.token)}>
                    {copied === invite.token ? 'Copiado' : 'Copiar'}
                  </button>
                  <button className={styles.linkButton} onClick={() => handleRevoke(invite.token)}>
                    Revocar
                  </button>
                </div>
              )}

              <p className={styles.meta}>
                Creada el {new Date(invite.createdAt).toLocaleString('es-ES')} · caduca el{' '}
                {new Date(invite.expiresAt).toLocaleDateString('es-ES')}
                {invite.usedByUsername ? ` · usada por ${invite.usedByUsername}` : ''}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default InvitacionesPage
