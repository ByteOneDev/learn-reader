import type { LearnAPI } from '@shared/types'

// Les erreurs qui traversent l'IPC arrivent sous la forme
// « Error invoking remote method 'learn:addSource': Error: HTTP 429 » : on garde le message utile,
// et on traduit les codes HTTP les plus courants.

const HTTP_MESSAGES: Record<string, string> = {
  '429': 'Le site limite le nombre de requêtes (429). Réessaie dans quelques minutes.',
  '403': 'Le site refuse l’accès (403).',
  '404': 'Adresse introuvable (404). Vérifie le lien.',
  '410': 'Ce flux n’existe plus (410).',
  '500': 'Le site rencontre une erreur (500). Réessaie plus tard.',
  '502': 'Le site ne répond pas correctement (502). Réessaie plus tard.',
  '503': 'Le site est momentanément indisponible (503).'
}

export function friendlyError(raw: string): string {
  const msg = raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(\w*Error):\s*/, '')
  const http = msg.match(/^HTTP (\d{3})$/)
  return http ? (HTTP_MESSAGES[http[1]] ?? `Erreur du site (HTTP ${http[1]}).`) : msg
}

/** Enveloppe l'API pour que toute erreur rejetée porte un message lisible. */
export function withFriendlyErrors(api: LearnAPI): LearnAPI {
  return new Proxy(api, {
    get(target, key, receiver) {
      const v = Reflect.get(target, key, receiver)
      if (typeof v !== 'function' || key === 'onEvent' || key === 'pathForFile') return v
      return (...args: unknown[]) => {
        const r = (v as (...a: unknown[]) => unknown).apply(target, args)
        return r instanceof Promise ? r.catch((e: unknown) => Promise.reject(new Error(friendlyError((e as Error)?.message ?? String(e))))) : r
      }
    }
  })
}
