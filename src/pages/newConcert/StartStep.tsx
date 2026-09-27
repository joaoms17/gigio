/* ═══════════════════════════════════════════════════════════════
   Passo 1 — "COMO QUERES COMEÇAR?"
   01 IMPORTAR LISTA (destaque: PDF · FOTO · TEXTO; o destino é o
   PARA do cabeçalho, logo por cima) · 02 COPIAR CONCERTO · 03 DO REPERTÓRIO · começar
   vazio (link discreto). Por cima, quando há: a lista por acabar
   (rascunho) e o concerto que já existe no dia escolhido.
═══════════════════════════════════════════════════════════════ */
import { ImportSource, type SetlistImporter } from '../../components/import'
import type { ConcertOption } from './data'
import { dayOfMonth, monthLabel, pad2, songsLabel } from './data'
import { IconAlert, IconBlank, IconChevronRight, IconCopy, IconImport, IconLibrary } from './icons'
import styles from './NewConcertPage.module.css'

const PREVIEW_CONCERTS = 3

export interface StartStepProps {
  /** Importador da origem "Importar lista" (já embrulhado para avançar para a revisão) */
  importer: SetlistImporter
  /** Lista importada à espera de revisão (voltar atrás não a perde) */
  pendingImport: { count: number; name: string | null } | null
  onReviewImport: () => void
  onDiscardImport: () => void

  /** Rascunho de uma visita anterior (sessionStorage) */
  draftOffer: { count: number; ago: string; label: string } | null
  onRestoreDraft: () => void
  onDiscardDraft: () => void

  /** Concerto do projeto que já existe no dia escolhido (vindo do Calendário) */
  dayConcert: { name: string; songCount: number; canImport: boolean } | null
  onImportToDay: () => void
  onOpenDay: () => void

  projectId: string | null
  projectName: string

  /** Concertos visíveis, já ordenados (projeto escolhido primeiro); null = a carregar */
  concerts: ConcertOption[] | null
  concertsError: string | null
  onPickConcert: (id: string) => void
  /** Concerto a abrir (à espera do alinhamento) */
  openingConcertId: string | null
  onOpenCopy: () => void

  librarySize: number
  libraryLoading: boolean
  libraryError: string | null
  onRetryLibrary: () => void
  pickedCount: number
  onOpenLibrary: () => void

  onStartEmpty: () => void
}

export default function StartStep(p: StartStepProps) {
  const top = p.concerts?.slice(0, PREVIEW_CONCERTS) ?? []
  const total = p.concerts?.length ?? 0
  const isPersonal = p.projectId === null

  return (
    <div className={styles.start}>
      {p.draftOffer && (
        <div className={styles.banner} role="status">
          <span className={styles.pendingLed} aria-hidden="true" />
          <span className={styles.bannerText}>
            Tens uma lista por acabar · <b>{pad2(p.draftOffer.count)}</b> música{p.draftOffer.count === 1 ? '' : 's'}
            <span className={styles.pendingName}> · {p.draftOffer.label} · {p.draftOffer.ago}</span>
          </span>
          <span className={styles.pendingActions}>
            <button type="button" className={styles.ghostBtn} onClick={p.onDiscardDraft}>Descartar</button>
            <button type="button" className={styles.secondaryBtn} onClick={p.onRestoreDraft}>
              Continuar <IconChevronRight size={16} />
            </button>
          </span>
        </div>
      )}

      {p.dayConcert && (
        <div className={styles.banner} role="status">
          <IconAlert size={18} />
          <span className={styles.bannerText}>
            Já existe <b>«{p.dayConcert.name}»</b> neste dia
            <span className={styles.pendingName}> · {songsLabel(p.dayConcert.songCount)}</span>
          </span>
          <span className={styles.pendingActions}>
            <button type="button" className={styles.ghostBtn} onClick={p.onOpenDay}>Abrir</button>
            {p.dayConcert.canImport && (
              <button type="button" className={styles.secondaryBtn} onClick={p.onImportToDay}>
                Importar para esse <IconChevronRight size={16} />
              </button>
            )}
          </span>
        </div>
      )}

      {/* ── 01 IMPORTAR LISTA — o caminho mais comum ── */}
      <section className={`${styles.card} ${styles.cardImport}`} aria-labelledby="nc-import-title">
        <header className={styles.cardHead}>
          <span className={styles.cardIcon}><IconImport /></span>
          <div className={styles.cardHeadText}>
            <span className={styles.cardKicker}>
              <span className={styles.cardNum}>01</span>
              <span className={styles.tag}>Mais rápido</span>
            </span>
            <h2 id="nc-import-title" className={`${styles.cardTitle} ${styles.cardTitleLg}`}>Importar lista</h2>
            <p className={styles.cardSub}>A lista que a banda já tem — as músicas entram pela mesma ordem.</p>
          </div>
        </header>

        {p.pendingImport && (
          <div className={styles.pending} role="status">
            <span className={styles.pendingLed} aria-hidden="true" />
            <span className={styles.pendingText}>
              <b>{pad2(p.pendingImport.count)}</b> música{p.pendingImport.count === 1 ? '' : 's'} importada{p.pendingImport.count === 1 ? '' : 's'}
              {p.pendingImport.name && <span className={styles.pendingName}> · {p.pendingImport.name}</span>}
            </span>
            <span className={styles.pendingActions}>
              <button type="button" className={styles.ghostBtn} onClick={p.onDiscardImport}>Descartar</button>
              <button type="button" className={styles.secondaryBtn} onClick={p.onReviewImport}>
                Rever lista <IconChevronRight size={16} />
              </button>
            </span>
          </div>
        )}

        <ImportSource importer={p.importer} />
      </section>

      <div className={styles.cardRow}>
        {/* ── 02 COPIAR CONCERTO ── */}
        <section className={styles.card} aria-labelledby="nc-copy-title">
          <header className={styles.cardHead}>
            <span className={styles.cardIcon}><IconCopy /></span>
            <div className={styles.cardHeadText}>
              <span className={styles.cardKicker}><span className={styles.cardNum}>02</span></span>
              <h2 id="nc-copy-title" className={styles.cardTitle}>Copiar concerto</h2>
              <p className={styles.cardSub}>De um concerto anterior — a mesma ordem, tons e notas.</p>
            </div>
          </header>

          {p.concerts === null ? (
            <div className={styles.miniWrap} aria-hidden="true">
              <div className={styles.miniList}>
                {[0, 1, 2].map(i => (
                  <div key={i} className={styles.miniSkel}>
                    <div className="skeleton" style={{ width: 28, height: 30 }} />
                    <div style={{ flex: 1 }}>
                      <div className="skeleton" style={{ width: '60%', height: 14 }} />
                      <div className="skeleton" style={{ width: '35%', height: 10, marginTop: 8 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : top.length === 0 ? (
            <p className={styles.cardEmpty}>
              {p.concertsError ? `Não foi possível carregar os concertos — ${p.concertsError}` : 'Ainda não há concertos com músicas para copiar.'}
            </p>
          ) : (
            <div className={styles.miniWrap}>
              <ul className={styles.miniList}>
                {top.map(c => {
                  const opening = p.openingConcertId === c.id
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        className={styles.miniRow}
                        onClick={() => p.onPickConcert(c.id)}
                        disabled={!!p.openingConcertId}
                        aria-busy={opening || undefined}
                      >
                        <span className={styles.miniDate}>
                          {c.date ? (
                            <>
                              <span className={styles.miniDay}>{dayOfMonth(c.date)}</span>
                              <span className={styles.miniMonth}>{monthLabel(c.date)}</span>
                            </>
                          ) : (
                            <>
                              <span className={`${styles.miniDay} ${styles.dim}`}>--</span>
                              <span className={styles.miniMonth}>s/d</span>
                            </>
                          )}
                        </span>
                        <span className={styles.miniInfo}>
                          <span className={styles.miniName}>{c.name}</span>
                          <span className={styles.miniMeta}>
                            {opening ? 'A abrir…' : (
                              <>
                                {c.bandId !== p.projectId && <>{c.bandName ?? 'Pessoal'} · </>}
                                {songsLabel(c.songCount)}
                                {c.venue && <> · {c.venue}</>}
                              </>
                            )}
                          </span>
                        </span>
                        <span className={styles.miniChev}><IconChevronRight /></span>
                      </button>
                    </li>
                  )
                })}
              </ul>
              <button type="button" className={styles.cardLink} onClick={p.onOpenCopy}>
                <span>Ver todos os concertos</span>
                <span className={styles.cardLinkCount}>{pad2(total)}</span>
                <IconChevronRight size={16} />
              </button>
            </div>
          )}
        </section>

        {/* ── 03 DO REPERTÓRIO ── */}
        <section className={styles.card} aria-labelledby="nc-lib-title">
          <header className={styles.cardHead}>
            <span className={styles.cardIcon}><IconLibrary /></span>
            <div className={styles.cardHeadText}>
              <span className={styles.cardKicker}><span className={styles.cardNum}>03</span></span>
              <h2 id="nc-lib-title" className={styles.cardTitle}>Do repertório</h2>
              <p className={styles.cardSub}>
                {isPersonal ? 'Escolhe músicas do teu repertório' : 'Escolhe músicas da banda'}, pela ordem do concerto.
              </p>
            </div>
          </header>

          {p.libraryError ? (
            <div className={styles.inlineError} role="alert">
              <IconAlert />
              <span>Não foi possível carregar o repertório.</span>
              <button type="button" className={styles.ghostBtn} onClick={p.onRetryLibrary}>Tentar de novo</button>
            </div>
          ) : (
            <div className={styles.stat}>
              {p.libraryLoading ? (
                <div className="skeleton" style={{ width: 64, height: 40 }} aria-hidden="true" />
              ) : (
                <span className={styles.statNum}>{pad2(p.librarySize)}</span>
              )}
              <span className={styles.statLabel}>
                música{p.librarySize === 1 ? '' : 's'} no repertório
                <br />{isPersonal ? 'pessoal' : <>de {p.projectName}</>}
              </span>
              {p.pickedCount > 0 && (
                <span className={`${styles.tag} ${styles.statTag}`}>{pad2(p.pickedCount)} escolhida{p.pickedCount === 1 ? '' : 's'}</span>
              )}
            </div>
          )}

          <button
            type="button"
            className={`${styles.secondaryBtn} ${styles.cardBtn}`}
            onClick={p.onOpenLibrary}
            disabled={!!p.libraryError || (!p.libraryLoading && p.librarySize === 0)}
          >
            {p.pickedCount > 0 ? 'Continuar a escolher' : 'Escolher músicas'}
            <IconChevronRight size={16} />
          </button>
        </section>
      </div>

      {/* ── Começar vazio — discreto ── */}
      <button type="button" className={styles.emptyLink} onClick={p.onStartEmpty}>
        <IconBlank />
        <span className={styles.emptyLinkText}>
          <span className={styles.emptyLinkTitle}>Começar vazio</span>
          <span className={styles.emptyLinkSub}>Crias o concerto e juntas as músicas depois</span>
        </span>
        <IconChevronRight />
      </button>
    </div>
  )
}
