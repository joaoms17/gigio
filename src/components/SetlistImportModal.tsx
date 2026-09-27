/* ═══════════════════════════════════════════════════════════════
   Importar para um concerto existente — mesmo importador do "Novo
   concerto" (PDF · FOTO · TEXTO + revisão). Com o concerto vazio,
   acrescenta pela ordem da lista. Com músicas já lá dentro (o caso
   da "versão revista" do organizador), escolhe-se:
     ACRESCENTAR AO FIM (saltando as que já estão — por defeito) ou
     SUBSTITUIR O ALINHAMENTO pela ordem nova (as que ficam mantêm o
     tom/notas do concerto).
═══════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useId, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useToast } from './Toast'
import { useConfirm } from './ConfirmDialog'
import ImportSource from './import/ImportSource'
import ImportReview from './import/ImportReview'
import { useSetlistImport } from './import/useSetlistImport'
import { useOnline } from './import/useOnline'
import { insertSetlistSongs, replaceSetlistSongs, toSetlistInserts } from '../lib/setlistImport/commit'
import { importErrorMessage } from '../lib/setlistImport/errors'
import { pad2 } from '../lib/setlistImport/text'
import { IconArrowLeft, IconCheck, IconClose, IconRetry } from './import/icons'
import styles from './SetlistImportModal.module.css'

interface Props {
  setlistId: string
  projectId: string | null
  currentPosition: number
  onClose: () => void
  onImported: () => void
}

const SOURCE_LABEL = { pdf: 'PDF', image: 'Foto', text: 'Texto', library: 'Repertório', setlist: 'Concerto' } as const

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

type Mode = 'append' | 'replace'

export default function SetlistImportModal({ setlistId, projectId, currentPosition, onClose, onImported }: Props) {
  const importer = useSetlistImport({ projectId })
  const toast = useToast()
  const confirm = useConfirm()
  const online = useOnline()
  const titleId = useId()
  /** Músicas que já estão no concerto; null = a carregar; 'error' = falhou */
  const [existing, setExisting] = useState<Set<string> | null | 'error'>(null)
  const [existingTry, setExistingTry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [mode, setMode] = useState<Mode>('append')
  const [skipExisting, setSkipExisting] = useState(true)

  // Músicas que já estão no concerto (para marcar "JÁ NO CONCERTO" e não as repetir)
  useEffect(() => {
    let cancelled = false
    supabase.from('setlist_songs').select('song_id').eq('setlist_id', setlistId).then(({ data, error }) => {
      if (cancelled) return
      setExisting(error ? 'error' : new Set((data ?? []).map((r: { song_id: string }) => r.song_id)))
    }, () => { if (!cancelled) setExisting('error') })
    return () => { cancelled = true }
  }, [setlistId, existingTry])

  const existingSet = existing instanceof Set ? existing : null
  const hasExisting = !!existingSet && existingSet.size > 0
  const inReview = importer.phase === 'review'
  const total = importer.rows.length
  const working = saving || importer.committing
  const alreadyCount = existingSet
    ? importer.rows.filter(r => r.choice?.kind === 'library' && existingSet.has(r.choice.song.id)).length
    : 0
  const effectiveMode: Mode = hasExisting ? mode : 'append'
  const skipping = effectiveMode === 'append' && skipExisting && alreadyCount > 0
  const toAdd = skipping ? total - alreadyCount : total

  /** Há trabalho que se perderia ao fechar (lista lida, ou texto colado) */
  const hasWork = (inReview && total > 0) || (!inReview && !!importer.draftText.trim())

  const requestClose = useCallback(async () => {
    if (working) return
    if (importer.busy) importer.cancelSource()
    if (hasWork) {
      const ok = await confirm({
        title: inReview ? 'Descartar importação?' : 'Descartar o texto colado?',
        message: inReview ? 'A lista lida é descartada. Nada foi adicionado ao concerto.' : 'O texto que colaste perde-se.',
        confirmLabel: 'Descartar',
        danger: true,
      })
      if (!ok) return
    }
    onClose()
  }, [working, importer, hasWork, inReview, confirm, onClose])

  // Escape fecha (em bolha: o seletor de correspondência e o ConfirmDialog tratam-no antes)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') void requestClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [requestClose])

  async function back() {
    if (working) return
    if (total > 0) {
      const ok = await confirm({
        title: 'Voltar ao início?',
        message: 'A lista lida é descartada e podes importar outra.',
        confirmLabel: 'Voltar',
      })
      if (!ok) return
    }
    importer.reset()
  }

  async function handleAdd() {
    if (total === 0 || working || !existingSet) return
    if (effectiveMode === 'replace') {
      const ok = await confirm({
        title: 'Substituir o alinhamento?',
        message: `As ${existingSet.size} músicas do concerto saem e entra a lista importada (${total}), por esta ordem. As que se mantêm guardam o tom e as notas.`,
        confirmLabel: 'Substituir',
        danger: true,
      })
      if (!ok) return
    }
    setSaving(true)
    try {
      const result = await importer.commit()
      let inserts = toSetlistInserts(result)
      if (skipping) inserts = inserts.filter(r => !existingSet.has(r.song_id))
      if (inserts.length === 0) {
        toast(result.failed > 0 ? 'Nenhuma música foi adicionada — tenta de novo.' : 'Nada a adicionar: essas músicas já estão no concerto.', {
          type: result.failed > 0 ? 'error' : 'success',
        })
        if (result.failed === 0) onImported()
        return
      }
      const { error } = effectiveMode === 'replace'
        ? await replaceSetlistSongs(setlistId, inserts)
        // Acrescenta ao fim do concerto, pela ordem da lista (um só insert)
        : await insertSetlistSongs(setlistId, inserts, { minPosition: currentPosition })
      if (error) {
        toast(`Erro ao ${effectiveMode === 'replace' ? 'substituir o alinhamento' : 'adicionar ao concerto'}: ${error}`, { type: 'error' })
        return
      }
      const n = inserts.length
      let msg = effectiveMode === 'replace'
        ? `Alinhamento substituído · ${n} ${plural(n, 'música', 'músicas')}`
        : `${n} ${plural(n, 'música adicionada', 'músicas adicionadas')} ao concerto`
      if (skipping) msg += ` · ${alreadyCount} já lá ${plural(alreadyCount, 'estava', 'estavam')}`
      if (result.created > 0) msg += ` · ${result.created} ${plural(result.created, 'nova', 'novas')} no repertório`
      if (result.failed > 0) {
        toast(`${msg} · ${result.failed} ${plural(result.failed, 'falhou', 'falharam')}`, { type: 'error' })
      } else {
        toast(msg, { type: 'success' })
      }
      onImported()
    } catch (e) {
      toast(importErrorMessage(e, 'Não foi possível adicionar as músicas.'), { type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const progress = importer.commitProgress
  const blocked = importer.libraryLoading || !!importer.libraryError || existing === null || existing === 'error'
  let primaryLabel: string
  if (progress) {
    primaryLabel = progress.phase === 'resolving'
      ? (progress.current || 'A procurar letras…')
      : `A ${effectiveMode === 'replace' ? 'gravar' : 'adicionar'} ${pad2(Math.min(progress.done + 1, progress.total))}/${pad2(progress.total)}`
  } else if (!online) {
    primaryLabel = 'Sem ligação'
  } else if (saving) {
    primaryLabel = effectiveMode === 'replace' ? 'A substituir…' : 'A adicionar…'
  } else if (importer.libraryLoading || existing === null) {
    primaryLabel = 'A carregar o repertório…'
  } else if (effectiveMode === 'replace') {
    primaryLabel = `Substituir · ${total} ${plural(total, 'música', 'músicas')}`
  } else if (skipping) {
    // As que já lá estão ficam explicadas no "Saltar as N…" por cima — o botão diz só o que entra
    primaryLabel = toAdd > 0 ? `Adicionar ${toAdd} ${plural(toAdd, 'música', 'músicas')}` : 'Já estão todas no concerto'
  } else {
    primaryLabel = `Adicionar ${total} ${plural(total, 'música', 'músicas')}`
  }

  const kicker = inReview
    ? `Importar · 02 / 02 · Rever${importer.source ? ` · ${SOURCE_LABEL[importer.source.kind]}` : ''}`
    : 'Importar · 01 / 02 · Fonte'

  const modeControls = existing === 'error' ? (
    <div className={styles.modeError} role="alert">
      <span>Não foi possível ver as músicas que já estão no concerto{typeof navigator !== 'undefined' && navigator.onLine === false ? ' (sem ligação)' : ''}.</span>
      <button type="button" className={styles.btnSecondary} onClick={() => { setExisting(null); setExistingTry(n => n + 1) }}>
        <IconRetry />Tentar de novo
      </button>
    </div>
  ) : hasExisting ? (
    <div className={styles.modeBox}>
      <div className={styles.modeLabel}>O concerto já tem {existingSet!.size} {plural(existingSet!.size, 'música', 'músicas')}</div>
      <div className={styles.segmented} role="radiogroup" aria-label="O que fazer com a lista">
        {(['append', 'replace'] as const).map(m => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={mode === m}
            className={`${styles.segment} ${mode === m ? styles.segmentOn : ''}`}
            onClick={() => setMode(m)}
            disabled={working}
          >
            {m === 'append' ? 'Acrescentar ao fim' : 'Substituir o alinhamento'}
          </button>
        ))}
      </div>
      {mode === 'append' && alreadyCount > 0 && (
        <label className={styles.toggle}>
          <input type="checkbox" checked={skipExisting} onChange={e => setSkipExisting(e.target.checked)} disabled={working} />
          <span className={styles.toggleBox} aria-hidden="true"><IconCheck size={14} /></span>
          <span>Saltar as {alreadyCount} que já estão no concerto</span>
        </label>
      )}
      {mode === 'replace' && (
        <p className={styles.modeNote}>A lista importada passa a ser o alinhamento, por esta ordem.</p>
      )}
    </div>
  ) : null

  return (
    <div
      className={styles.overlay}
      onClick={() => {
        // Tocar fora (ex.: para baixar o teclado) não deita fora trabalho
        if (importer.busy || working) return
        if (hasWork) void requestClose()
        else onClose()
      }}
    >
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={e => e.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.headText}>
            <div className={styles.kicker}>{kicker}</div>
            <h2 id={titleId} className={styles.title}>{inReview ? 'Rever lista' : 'Importar lista'}</h2>
            {!inReview && (
              <p className={styles.sub}>PDF, foto ou texto — pela ordem da lista.</p>
            )}
          </div>
          <button type="button" className={styles.close} onClick={() => void requestClose()} disabled={working} aria-label="Fechar">
            <IconClose />
          </button>
        </header>

        <div className={styles.scroll}>
          {inReview
            ? (
              <ImportReview
                importer={importer}
                existingSongIds={existingSet ?? undefined}
                skipExisting={effectiveMode === 'append' && skipExisting}
                top={modeControls}
              />
            )
            : <ImportSource importer={importer} />}
        </div>

        {inReview && (
          <footer className={styles.footer}>
            <button type="button" className={styles.btnSecondary} onClick={() => void back()} disabled={working}>
              <IconArrowLeft />Voltar
            </button>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={() => void handleAdd()}
              disabled={total === 0 || working || blocked || !online || (skipping && toAdd === 0)}
              aria-live="polite"
            >
              {primaryLabel}
            </button>
          </footer>
        )}

        {working && progress && progress.total > 0 && (
          <div className={styles.progressTrack} aria-hidden="true">
            <div
              className={styles.progressFill}
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

