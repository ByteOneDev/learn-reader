import { describe, expect, it } from 'vitest'
import { guessCategory, parseList, parseTakeoutCsv } from '../src/shared/importList'

describe('import d’abonnements', () => {
  it('lit le fichier subscriptions.csv de Google Takeout (en-têtes français ou anglais)', () => {
    const fr = '﻿ID des chaînes,URL des chaînes,Titres des chaînes\r\nUCsXVk37bltHxD1rDPwtNM8Q,http://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q,Kurzgesagt – In a Nutshell\r\nUCAcAnMF0OrCtUep3Y4M-ZPw,http://www.youtube.com/channel/UCAcAnMF0OrCtUep3Y4M-ZPw,"HugoDécrypte, actus"\r\n'
    const r = parseTakeoutCsv(fr)
    expect(r).toHaveLength(2)
    expect(r[0]).toEqual({ channelId: 'UCsXVk37bltHxD1rDPwtNM8Q', url: 'https://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q', title: 'Kurzgesagt – In a Nutshell' })
    expect(r[1].title).toBe('HugoDécrypte, actus')
    expect(parseTakeoutCsv('Channel Id,Channel Url,Channel Title\nUCsXVk37bltHxD1rDPwtNM8Q,http://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q,K\nUCsXVk37bltHxD1rDPwtNM8Q,x,K')).toHaveLength(1)
  })

  it('lit une liste collée : subreddits, adresses, puces et doublons', () => {
    const r = parseList('- r/linux\n2. /r/ObsidianMD/\nunixporn # pas un subreddit écrit seul\nr/linux\nhttps://www.youtube.com/@Micmaths\n\n@user@mastodon.social')
    expect(r.map((x) => x.input)).toEqual(['r/linux', 'r/ObsidianMD', 'unixporn', 'https://www.youtube.com/@Micmaths', '@user@mastodon.social'])
    expect(r[0].kind).toBe('reddit')
    expect(r[3].kind).toBe('youtube')
  })

  it('devine une catégorie : catalogue d’abord, puis mots-clés', () => {
    const catalog = [{ title: 'Kurzgesagt – In a Nutshell', input: 'https://www.youtube.com/@kurzgesagt', category: 'sciences' }]
    expect(guessCategory('Kurzgesagt – In a Nutshell', 'https://www.youtube.com/channel/UC…', catalog)).toBe('sciences')
    expect(guessCategory('r/linux', 'r/linux', [])).toBe('tech')
    expect(guessCategory('r/Napoleon', 'r/Napoleon', [])).toBe('histoire')
    expect(guessCategory('r/ModdedMinecraft', 'r/ModdedMinecraft', [])).toBe('jeux')
    expect(guessCategory('r/Tintin', 'r/Tintin', [])).toBe('culture')
    expect(guessCategory('Inconnu', 'r/zzz', [])).toBe('')
  })
})
