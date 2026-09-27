/* ═══════════════════════════════════════════════════════════════
   "Esta lista é de outra banda?" — depois de importar, compara as
   linhas com o repertório de cada projeto onde o utilizador pode
   criar. Se outro projeto corresponde claramente melhor do que o
   PARA atual, a revisão propõe mudar (evita criar em duplicado na
   banda errada). Uma só query (títulos dos repertórios), em cache.
═══════════════════════════════════════════════════════════════ */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { findLibraryMatch, type SongQuery } from '../../lib/setlistImport/match'
import { rowQuery } from '../../lib/setlistImport/rows'
import type { ImportRow, LibrarySong } from '../../components/import'
import type { ProjectOption } from './data'

export interface ProjectFit {
  projectId: string
  name: string
  color: string
  /** Quantas linhas estão no repertório desse projeto */
  matched: number
  total: number
}

type SongsByProject = Map<string, LibrarySong[]>

/**
 * @param rows linhas importadas (só as do "Importar lista")
 * @param current PARA atual (null = pessoal)
 * @param currentMatched quantas linhas já estão no repertório do PARA atual
 */
export function useProjectFit(
  rows: readonly ImportRow[],
  projects: readonly ProjectOption[] | null,
  current: string | null,
  currentMatched: number,
  enabled: boolean,
): ProjectFit | null {
  const candidates = useMemo(
    () => (projects ?? []).filter(p => p.canCreate && p.id !== current),
    [projects, current],
  )
  const idsKey = (projects ?? []).filter(p => p.canCreate).map(p => p.id).sort().join(',')
  const [songs, setSongs] = useState<{ key: string; byProject: SongsByProject } | null>(null)
  const want = enabled && rows.length >= 4 && candidates.length > 0

  useEffect(() => {
    if (!want || !idsKey || songs?.key === idsKey) return
    let cancelled = false
    supabase
      .from('songs')
      .select('id, title, artist, project_id')
      .in('project_id', idsKey.split(','))
      .limit(5000)
      .then(({ data, error }) => {
        if (cancelled || error) return
        const byProject: SongsByProject = new Map()
        for (const s of (data ?? []) as (LibrarySong & { project_id: string })[]) {
          const list = byProject.get(s.project_id) ?? []
          list.push(s)
          byProject.set(s.project_id, list)
        }
        setSongs({ key: idsKey, byProject })
      }, () => { /* sem rede: sem sugestão */ })
    return () => { cancelled = true }
  }, [want, idsKey, songs?.key])

  // Só o que se procura importa (não recalcular a cada resultado online)
  const queriesKey = JSON.stringify(rows.map(rowQuery))

  return useMemo(() => {
    if (!want || !songs || songs.key !== idsKey) return null
    const queries = JSON.parse(queriesKey) as SongQuery[]
    const total = queries.length
    let best: ProjectFit | null = null
    for (const p of candidates) {
      const lib = songs.byProject.get(p.id) ?? []
      if (lib.length === 0) continue
      const matched = queries.filter(q => findLibraryMatch(q, lib)).length
      if (!best || matched > best.matched) best = { projectId: p.id, name: p.name, color: p.color, matched, total }
    }
    if (!best) return null
    const clearlyBetter = best.matched >= 3
      && best.matched >= total * 0.5
      && best.matched >= currentMatched + Math.max(2, Math.ceil(total * 0.25))
    return clearlyBetter ? best : null
  }, [want, songs, idsKey, queriesKey, candidates, currentMatched])
}
