import { describe, expect, it } from 'vitest'
import { resolveInput } from '../src/main/feeds/resolve'

describe('resolveInput', () => {
  it.each([
    ['r/linux', 'reddit', 'https://www.reddit.com/r/linux/.rss'],
    ['https://www.reddit.com/r/selfhosted/', 'reddit', 'https://www.reddit.com/r/selfhosted/.rss'],
    ['https://old.reddit.com/r/chess', 'reddit', 'https://www.reddit.com/r/chess/.rss'],
    ['u/spez', 'reddit', 'https://www.reddit.com/user/spez/.rss'],
    ['@Gargron@mastodon.social', 'mastodon', 'https://mastodon.social/@Gargron.rss'],
    ['https://mastodon.social/@nixCraft', 'mastodon', 'https://mastodon.social/@nixCraft.rss'],
    ['https://mastodon.social/tags/linux', 'mastodon', 'https://mastodon.social/tags/linux.rss'],
    ['@theverge.com', 'bluesky', 'https://bsky.app/profile/theverge.com/rss'],
    ['https://bsky.app/profile/nature.com', 'bluesky', 'https://bsky.app/profile/nature.com/rss'],
    ['https://www.youtube.com/channel/UCabc', 'youtube', 'https://www.youtube.com/feeds/videos.xml?channel_id=UCabc'],
    ['https://news.ycombinator.com', 'forum', 'https://hnrss.org/frontpage'],
    ['numerama.com/feed/', 'rss', 'https://numerama.com/feed/']
  ])('%s → %s', (input, kind, url) => {
    expect(resolveInput(input)).toMatchObject({ kind, url })
  })

  it('exige une passerelle pour X', () => {
    expect(() => resolveInput('https://x.com/jack')).toThrow(/passerelle/)
    expect(resolveInput('x.com/jack', { xBridge: 'https://rsshub.example/twitter/user/{user}' })).toMatchObject({
      kind: 'x',
      url: 'https://rsshub.example/twitter/user/jack'
    })
    expect(resolveInput('@jack', { xBridge: 'https://bridge.example/{user}.xml' }).url).toBe('https://bridge.example/jack.xml')
  })

  it('refuse une entrée vide', () => {
    expect(() => resolveInput('   ')).toThrow()
  })
})
