import type { ResolvedInput } from '@shared/types'

/**
 * Transforme ce que tape l'utilisateur en adresse de flux, selon le réseau :
 *   r/linux, https://reddit.com/r/linux        → Reddit
 *   @user@instance.social, https://inst/@user  → Mastodon
 *   @handle.bsky.social, bsky.app/profile/x    → Bluesky
 *   youtube.com/channel/UC…                    → YouTube
 *   x.com/user, @user (avec passerelle)        → X via la passerelle RSS configurée
 *   toute autre URL                            → flux générique (découverte automatique au téléchargement)
 */
export function resolveInput(raw: string, opts: { xBridge?: string } = {}): ResolvedInput {
  const input = raw.trim()
  if (!input) throw new Error('Adresse vide')

  // Reddit : r/sub ou u/user
  let m = input.match(/^\/?(r|u|user)\/([\w-]+)\/?$/i)
  if (m) return reddit(m[1].toLowerCase() === 'r' ? 'r' : 'user', m[2])

  // Mastodon : @user@instance
  m = input.match(/^@?([\w.-]+)@([\w-]+(?:\.[\w-]+)+)$/)
  if (m && !input.includes('/')) {
    return { kind: 'mastodon', url: `https://${m[2]}/@${m[1]}.rss`, title: `@${m[1]}@${m[2]}`, siteUrl: `https://${m[2]}/@${m[1]}` }
  }

  // Bluesky : @handle.domaine
  m = input.match(/^@([\w-]+(?:\.[\w-]+)+)$/)
  if (m) return bluesky(m[1])

  // X : @user sans domaine → passerelle
  m = input.match(/^@(\w{1,15})$/)
  if (m) return xBridge(m[1], opts.xBridge)

  let url: URL
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`)
  } catch {
    throw new Error(`Adresse non reconnue : ${input}`)
  }
  const host = url.hostname.replace(/^(www|old|new)\./, '')
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'reddit.com' && parts.length >= 2 && ['r', 'u', 'user'].includes(parts[0])) {
    if (parts[2] === '.rss' || parts[1].endsWith('.rss')) return { kind: 'reddit', url: url.href, title: `${parts[0]}/${parts[1]}` }
    return reddit(parts[0] === 'r' ? 'r' : 'user', parts[1])
  }
  if (host === 'bsky.app' && parts[0] === 'profile' && parts[1]) return bluesky(parts[1])
  if ((host === 'x.com' || host === 'twitter.com') && parts[0]) return xBridge(parts[0], opts.xBridge)
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    if (parts[0] === 'channel' && parts[1]) {
      return { kind: 'youtube', url: `https://www.youtube.com/feeds/videos.xml?channel_id=${parts[1]}`, siteUrl: url.href }
    }
    if (parts[0] === 'feeds') return { kind: 'youtube', url: url.href }
    const list = url.searchParams.get('list')
    if (parts[0] === 'playlist' && list) return { kind: 'youtube', url: `https://www.youtube.com/feeds/videos.xml?playlist_id=${list}`, siteUrl: url.href }
    // @pseudo, /c/…, /user/… : la page de la chaîne annonce son flux, trouvé à la découverte.
    if (parts[0]?.startsWith('@') || parts[0] === 'c' || parts[0] === 'user') {
      return { kind: 'youtube', url: `https://www.youtube.com/${parts.slice(0, parts[0].startsWith('@') ? 1 : 2).join('/')}`, siteUrl: url.href }
    }
  }
  if (parts[0]?.startsWith('@') && parts.length === 1 && !host.includes('youtube')) {
    // Profil Mastodon (ou compatible) : https://instance/@user
    const user = parts[0].replace(/\.rss$/, '')
    return { kind: 'mastodon', url: `${url.origin}/${user}.rss`, title: `${user}@${url.hostname}`, siteUrl: `${url.origin}/${user}` }
  }
  if (parts[0] === 'tags' && parts[1] && !url.pathname.endsWith('.rss')) {
    return { kind: 'mastodon', url: `${url.origin}/tags/${parts[1]}.rss`, title: `#${parts[1]}` }
  }
  if (host === 'hnrss.org' || host === 'news.ycombinator.com' || host === 'lobste.rs' || /\/feeds\/c\//.test(url.pathname)) {
    return { kind: 'forum', url: host === 'news.ycombinator.com' ? 'https://hnrss.org/frontpage' : url.href }
  }
  return { kind: 'rss', url: url.href }
}

function reddit(type: 'r' | 'user', name: string): ResolvedInput {
  return {
    kind: 'reddit',
    url: `https://www.reddit.com/${type}/${name}/.rss`,
    title: `${type === 'r' ? 'r' : 'u'}/${name}`,
    siteUrl: `https://www.reddit.com/${type}/${name}/`
  }
}

function bluesky(handle: string): ResolvedInput {
  return {
    kind: 'bluesky',
    url: `https://bsky.app/profile/${handle}/rss`,
    title: `@${handle}`,
    siteUrl: `https://bsky.app/profile/${handle}`
  }
}

function xBridge(user: string, template?: string): ResolvedInput {
  if (!template || !template.includes('{user}')) {
    throw new Error(
      "X ne fournit pas de flux RSS. Configure une passerelle (RSSHub, rss.app…) dans les Réglages, avec {user} à la place du nom d'utilisateur."
    )
  }
  return { kind: 'x', url: template.replace('{user}', encodeURIComponent(user)), title: `@${user}`, siteUrl: `https://x.com/${user}` }
}
