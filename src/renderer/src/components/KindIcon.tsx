import { AtSign, Headphones, MessagesSquare, Rss, Tv } from 'lucide-react'
import type { SourceKind } from '@shared/types'

/** Pictogramme du type de source (podcast, vidéo, forum, réseau social, flux). */
export default function KindIcon({ kind }: { kind: SourceKind }): React.JSX.Element {
  const size = 13
  if (kind === 'podcast') return <Headphones size={size} />
  if (kind === 'youtube') return <Tv size={size} />
  if (kind === 'reddit' || kind === 'forum') return <MessagesSquare size={size} />
  if (kind === 'mastodon' || kind === 'bluesky' || kind === 'x') return <AtSign size={size} />
  return <Rss size={size} />
}
