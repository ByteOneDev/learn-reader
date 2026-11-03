import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { installKind, newerThan, pickAsset, Updater, type Release } from '../src/main/updater'

const payload = Buffer.from('nouvelle version de Learn')
const sha = createHash('sha256').update(payload).digest('hex')
const release = (digest: string): Release => ({
  tag_name: 'v0.14.0',
  html_url: 'https://github.com/ByteOneDev/learn-reader/releases/tag/v0.14.0',
  assets: [
    { name: 'Learn-0.14.0-arm64.dmg', browser_download_url: 'https://dl/arm64.dmg', size: payload.length, digest: `sha256:${digest}` },
    { name: 'Learn-0.14.0.dmg', browser_download_url: 'https://dl/x64.dmg', size: payload.length },
    { name: 'Learn.Setup.0.14.0.exe', browser_download_url: 'https://dl/setup.exe', size: payload.length },
    { name: 'Learn-0.14.0.AppImage', browser_download_url: 'https://dl/app.AppImage', size: payload.length },
    { name: 'learn-reader_0.14.0_amd64.deb', browser_download_url: 'https://dl/app.deb', size: payload.length }
  ]
})

const fakeFetch = (rel: Release) => async (url: string): Promise<Response> =>
  url.includes('api.github.com') ? new Response(JSON.stringify(rel)) : new Response(new Blob([payload]).stream())

const opts = { platform: 'darwin' as NodeJS.Platform, arch: 'arm64', exePath: '/Applications/Learn.app/Contents/MacOS/Learn', openPath: async () => '', relaunch: () => {}, quit: () => {} }

describe('mise à jour automatique', () => {
  it('compare les versions et choisit le bon fichier', () => {
    expect(newerThan('v0.14.0', '0.13.9')).toBe(true)
    expect(newerThan('0.13.10', '0.13.9')).toBe(true)
    expect(newerThan('0.13.0', '0.13.0')).toBe(false)
    expect(newerThan('0.12.5', '0.13.0')).toBe(false)
    const r = release(sha)
    expect(pickAsset(r, 'mac', 'arm64')?.name).toBe('Learn-0.14.0-arm64.dmg')
    expect(pickAsset(r, 'mac', 'x64')?.name).toBe('Learn-0.14.0.dmg')
    expect(pickAsset(r, 'windows', 'x64')?.name).toBe('Learn.Setup.0.14.0.exe')
    expect(installKind('linux', { APPIMAGE: '/home/moi/Learn.AppImage' })).toBe('appimage')
    expect(installKind('linux', {})).toBe('deb')
  })

  it('télécharge la nouvelle version et vérifie son empreinte', async () => {
    const states: string[] = []
    const u = new Updater(fakeFetch(release(sha)), '0.13.0', (s) => states.push(s.state), opts)
    const s = await u.check(true)
    expect(s).toMatchObject({ state: 'ready', version: '0.14.0', progress: 1 })
    expect(states).toContain('downloading')
    const file = (u as unknown as { file: string }).file
    expect(readFileSync(file)).toEqual(payload)
  })

  it('refuse un fichier dont l’empreinte ne correspond pas', async () => {
    const u = new Updater(fakeFetch(release('0'.repeat(64))), '0.13.0', () => {}, opts)
    const s = await u.check(true)
    expect(s.state).toBe('error')
    expect(s.error).toMatch(/Empreinte/)
    expect((u as unknown as { file: string | null }).file).toBeNull()
  })

  it('ne propose rien quand l’app est à jour', async () => {
    const u = new Updater(fakeFetch(release(sha)), '0.14.0', () => {}, opts)
    expect((await u.check(true)).state).toBe('none')
    expect(existsSync('/nonexistent')).toBe(false)
  })
})

describe('mise à jour déjà prête', () => {
  it('ne retélécharge pas la même version', async () => {
    let downloads = 0
    const rel = release(sha)
    const f = async (url: string): Promise<Response> => {
      if (url.includes('api.github.com')) return new Response(JSON.stringify(rel))
      downloads++
      return new Response(new Blob([payload]).stream())
    }
    const u = new Updater(f, '0.13.0', () => {}, opts)
    await u.check(true)
    const again = await u.check(true)
    expect(again.state).toBe('ready')
    expect(downloads).toBe(1)
  })
})

import { mkdtempSync, statSync, writeFileSync as writeTmp } from 'node:fs'
import { join as joinPath } from 'node:path'
import { tmpdir as osTmp } from 'node:os'
describe.skipIf(process.platform === 'win32')('installation Linux (AppImage)', () => {
  it('remplace le fichier de l’AppImage, exécutable, puis relance', async () => {
    const dir = mkdtempSync(joinPath(osTmp(), 'learn-appimage-'))
    const target = joinPath(dir, 'Learn.AppImage')
    writeTmp(target, 'ancienne version')
    const previous = process.env.APPIMAGE
    process.env.APPIMAGE = target
    let relaunched = 0
    try {
      const u = new Updater(fakeFetch(release(sha)), '0.13.0', () => {}, { ...opts, platform: 'linux', relaunch: () => relaunched++ })
      await u.check(true)
      await Promise.all([u.install(), u.install()])
      expect(readFileSync(target)).toEqual(payload)
      expect(statSync(target).mode & 0o111).not.toBe(0)
      expect(relaunched).toBe(1)
    } finally {
      if (previous === undefined) delete process.env.APPIMAGE
      else process.env.APPIMAGE = previous
    }
  })
})
