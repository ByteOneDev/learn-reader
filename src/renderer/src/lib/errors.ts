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

// Erreurs réseau de Chromium (net::ERR_…) : ce que l'utilisateur peut en faire.
const NET_MESSAGES: [RegExp, string][] = [
  [/INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE/, 'Pas de connexion Internet.'],
  [/NAME_NOT_RESOLVED|NAME_RESOLUTION_FAILED/, 'Site introuvable (adresse inconnue, ou DNS bloqué).'],
  [/PROXY|TUNNEL_CONNECTION/, 'Le proxy réseau refuse la connexion.'],
  [/CERT_|SSL_/, 'Certificat du site refusé (connexion non sécurisée, ou inspection par un antivirus/pare-feu).'],
  [/BLOCKED/, 'Connexion bloquée sur cet ordinateur.'],
  [/CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT|FAILED|ABORTED)|TIMED_OUT|EMPTY_RESPONSE/, 'Connexion impossible (site injoignable, ou bloqué par un pare-feu ou un VPN).']
]

/** Erreur due à la connexion de l'ordinateur plutôt qu'au site ? */
export function isNetworkError(raw: string): boolean {
  return /net::ERR_/.test(raw) || raw === 'Délai dépassé'
}

export function friendlyError(raw: string): string {
  const msg = raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^(\w*Error):\s*/, '')
  const http = msg.match(/^HTTP (\d{3})$/)
  if (http) return HTTP_MESSAGES[http[1]] ?? `Erreur du site (HTTP ${http[1]}).`
  if (/net::ERR_/.test(msg)) {
    const known = NET_MESSAGES.find(([re]) => re.test(msg))
    return known ? `${known[1]} (${msg.match(/net::ERR_\w+/)![0]})` : msg
  }
  return msg
}

/**
 * Enveloppe l'API pour que toute erreur rejetée porte un message lisible.
 * Copie dans un objet neuf, pas de Proxy : dans Electron, l'API exposée par le preload (contextBridge) est
 * figée, et un Proxy n'a pas le droit d'y renvoyer autre chose que les fonctions d'origine.
 */
export function withFriendlyErrors(api: LearnAPI): LearnAPI {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(api)) {
    const v = (api as unknown as Record<string, unknown>)[key]
    if (typeof v !== 'function' || key === 'onEvent' || key === 'pathForFile') {
      out[key] = v
      continue
    }
    out[key] = (...args: unknown[]) => {
      const r = (v as (...a: unknown[]) => unknown).apply(api, args)
      return r instanceof Promise ? r.catch((e: unknown) => Promise.reject(new Error(friendlyError((e as Error)?.message ?? String(e))))) : r
    }
  }
  return out as unknown as LearnAPI
}
