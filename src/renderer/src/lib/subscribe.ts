import type { LearnAPI, NewSource } from '@shared/types'
import type { SubscribeReport } from './store'

/** Abonnement groupé, par paquets de 6 (progression visible), avec le motif de chaque échec. */
export async function subscribeAll(api: LearnAPI, list: NewSource[], onProgress?: (done: number) => void): Promise<SubscribeReport> {
  const report: SubscribeReport = { added: 0, failed: [] }
  for (let i = 0; i < list.length; i += 6) {
    const chunk = list.slice(i, i + 6)
    try {
      const r = await api.addSources(chunk)
      report.added += r.added.length
      for (const f of r.failed) {
        const source = chunk.find((c) => (c.title ?? c.input) === f.input) ?? { input: f.input }
        report.failed.push({ input: f.input, error: f.error, source })
      }
    } catch (e) {
      // Le paquet entier a échoué (l'app elle-même) : on le note plutôt que de tout interrompre.
      for (const c of chunk) report.failed.push({ input: c.title ?? c.input, error: (e as Error).message, source: c })
    }
    onProgress?.(Math.min(list.length, i + chunk.length))
  }
  return report
}
