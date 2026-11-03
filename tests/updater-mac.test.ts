import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Updater } from '../src/main/updater'

// Installation réelle sur macOS, lancée par le workflow de release avec le DMG qu'il vient de construire
// (LEARN_DMG=release/Learn-x.y.z-arm64.dmg). Ignoré ailleurs.
const dmg = process.env.LEARN_DMG
describe.skipIf(process.platform !== 'darwin' || !dmg)('mise à jour macOS (DMG réel)', () => {
  it('remplace Learn.app par la version du DMG puis relance', async () => {
    const apps = mkdtempSync(join(tmpdir(), 'learn-apps-'))
    const bundle = join(apps, 'Learn.app')
    mkdirSync(join(bundle, 'Contents', 'MacOS'), { recursive: true })
    writeFileSync(join(bundle, 'Contents', 'ancienne-version'), '0.0.1')
    let relaunched = false
    const u = new Updater(fetch, '0.0.1', () => {}, {
      platform: 'darwin',
      arch: process.arch,
      exePath: join(bundle, 'Contents', 'MacOS', 'Learn'),
      openPath: async () => '',
      relaunch: () => (relaunched = true),
      quit: () => {}
    })
    ;(u as unknown as { file: string }).file = dmg!
    await u.install()
    expect(relaunched).toBe(true)
    expect(existsSync(join(bundle, 'Contents', 'Info.plist'))).toBe(true)
    expect(existsSync(join(bundle, 'Contents', 'ancienne-version'))).toBe(false)
    expect(existsSync(`${bundle}.old`)).toBe(false)
    expect(existsSync(`${bundle}.new`)).toBe(false)
  }, 120_000)
})
