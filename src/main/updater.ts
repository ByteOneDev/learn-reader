import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { chmodSync, copyFileSync, createWriteStream, existsSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { UpdateStatus } from '@shared/types'

// Mise à jour automatique depuis les releases GitHub, sans service tiers ni signature Apple :
// - macOS : le DMG est monté, la nouvelle Learn.app remplace l'ancienne, puis l'app redémarre ;
// - Windows : l'installeur NSIS est lancé en silencieux (/S) et relance Learn ;
// - Linux : l'AppImage est remplacée sur place ; pour le paquet .deb, l'installeur du système s'ouvre.
// Chaque fichier est vérifié avec l'empreinte SHA-256 publiée par GitHub avant installation.

const run = promisify(execFile)
export const RELEASES_API = 'https://api.github.com/repos/ByteOneDev/learn-reader/releases/latest'

interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
  digest?: string | null
}

export interface Release {
  tag_name: string
  body?: string
  html_url: string
  assets: ReleaseAsset[]
}

/** 0.13.2 > 0.13.10 ? Compare des versions x.y.z (le « v » initial est ignoré). */
export function newerThan(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((x) => Number.parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

export type InstallKind = 'mac' | 'windows' | 'appimage' | 'deb' | 'none'

export function installKind(platform: NodeJS.Platform, env: NodeJS.ProcessEnv = process.env): InstallKind {
  if (platform === 'darwin') return 'mac'
  if (platform === 'win32') return 'windows'
  if (platform === 'linux') return env.APPIMAGE ? 'appimage' : 'deb'
  return 'none'
}

/** Le fichier de la release qui correspond à cette installation. */
export function pickAsset(release: Release, kind: InstallKind, arch: string): ReleaseAsset | undefined {
  const v = release.tag_name.replace(/^v/, '')
  const names: Record<InstallKind, string[]> = {
    mac: arch === 'arm64' ? [`Learn-${v}-arm64.dmg`] : [`Learn-${v}.dmg`],
    windows: [`Learn.Setup.${v}.exe`, `Learn-Setup-${v}.exe`],
    appimage: [`Learn-${v}.AppImage`],
    deb: [`learn-reader_${v}_amd64.deb`],
    none: []
  }
  return release.assets.find((a) => names[kind].includes(a.name))
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export class Updater {
  status: UpdateStatus = { state: 'idle', current: '' }
  private release: Release | null = null
  private file: string | null = null
  private busy = false

  constructor(
    private readonly fetchFn: Fetch,
    private readonly current: string,
    private readonly emit: (s: UpdateStatus) => void,
    private readonly opts: { platform: NodeJS.Platform; arch: string; exePath: string; openPath: (p: string) => Promise<string>; relaunch: () => void; quit: () => void }
  ) {
    this.status.current = current
  }

  private set(s: Partial<UpdateStatus>): void {
    this.status = { ...this.status, ...s }
    this.emit(this.status)
  }

  /** Cherche une nouvelle version ; la télécharge aussitôt si `download`. */
  async check(download: boolean): Promise<UpdateStatus> {
    if (this.busy) return this.status
    this.busy = true
    const previous = this.status
    try {
      this.set({ state: 'checking', error: undefined })
      const res = await this.fetchFn(RELEASES_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Learn' } })
      if (!res.ok) throw new Error(`GitHub : HTTP ${res.status}`)
      const release = (await res.json()) as Release
      if (!newerThan(release.tag_name, this.current)) {
        this.set({ state: 'none', checkedAt: Date.now() })
        return this.status
      }
      // Déjà téléchargée et vérifiée : on garde « Redémarrer » au lieu de tout reprendre.
      if (this.file && previous.state === 'ready' && previous.version === release.tag_name.replace(/^v/, '')) {
        this.set({ ...previous, checkedAt: Date.now() })
        return this.status
      }
      this.release = release
      const asset = pickAsset(release, installKind(this.opts.platform), this.opts.arch)
      this.set({ state: 'available', version: release.tag_name.replace(/^v/, ''), notesUrl: release.html_url, checkedAt: Date.now(), size: asset?.size })
      if (download && asset) await this.downloadAsset(asset)
      return this.status
    } catch (e) {
      this.set({ state: 'error', error: (e as Error).message })
      return this.status
    } finally {
      this.busy = false
    }
  }

  async download(): Promise<UpdateStatus> {
    const asset = this.release && pickAsset(this.release, installKind(this.opts.platform), this.opts.arch)
    if (!asset) return this.status
    try {
      await this.downloadAsset(asset)
    } catch (e) {
      this.set({ state: 'error', error: (e as Error).message })
    }
    return this.status
  }

  private async downloadAsset(asset: ReleaseAsset): Promise<void> {
    this.set({ state: 'downloading', progress: 0 })
    const res = await this.fetchFn(asset.browser_download_url, { headers: { 'User-Agent': 'Learn' } })
    if (!res.ok || !res.body) throw new Error(`Téléchargement : HTTP ${res.status}`)
    const dir = mkdtempSync(join(tmpdir(), 'learn-update-'))
    const file = join(dir, asset.name)
    const out = createWriteStream(file)
    const hash = createHash('sha256')
    const total = asset.size || Number(res.headers.get('content-length') ?? 0)
    let done = 0
    let last = 0
    const reader = res.body.getReader()
    for (;;) {
      const { value, done: end } = await reader.read()
      if (end) break
      hash.update(value)
      if (!out.write(value)) await new Promise((r) => out.once('drain', r))
      done += value.length
      if (total && Date.now() - last > 250) {
        last = Date.now()
        this.set({ progress: done / total })
      }
    }
    await new Promise<void>((r, j) => out.end((err?: Error | null) => (err ? j(err) : r())))
    // Empreinte publiée par GitHub (« sha256:… ») : un fichier altéré n'est jamais installé.
    const expected = asset.digest?.replace(/^sha256:/, '')
    if (expected && hash.digest('hex') !== expected) {
      rmSync(dir, { recursive: true, force: true })
      throw new Error('Empreinte du téléchargement invalide : mise à jour annulée')
    }
    this.file = file
    this.set({ state: 'ready', progress: 1 })
  }

  /** Installe la version téléchargée puis redémarre Learn. */
  private installing = false

  async install(): Promise<void> {
    if (!this.file) throw new Error('Aucune mise à jour téléchargée')
    // Double clic sur « Redémarrer » : une seule installation.
    if (this.installing) return
    this.installing = true
    try {
      await this.doInstall(this.file)
    } finally {
      this.installing = false
    }
  }

  private async doInstall(file: string): Promise<void> {
    this.file = file
    const kind = installKind(this.opts.platform)
    if (kind === 'mac') return this.installMac(this.file)
    if (kind === 'windows') {
      spawn(this.file, ['/S', '--updated', '--force-run'], { detached: true, stdio: 'ignore' }).unref()
      return this.opts.quit()
    }
    if (kind === 'appimage') {
      const target = process.env.APPIMAGE!
      // Copie puis renommage dans le même dossier : /tmp est souvent sur un autre disque (renommer échouerait).
      copyFileSync(this.file, `${target}.new`)
      chmodSync(`${target}.new`, 0o755)
      renameSync(`${target}.new`, target)
      this.opts.relaunch()
      return
    }
    // .deb : l'installeur du système demande le mot de passe administrateur.
    await this.opts.openPath(this.file)
  }

  private async installMac(dmg: string): Promise<void> {
    // /Applications/Learn.app/Contents/MacOS/Learn → /Applications/Learn.app
    const bundle = resolve(dirname(this.opts.exePath), '..', '..')
    // App lancée depuis le DMG ou isolée par Gatekeeper (« translocation ») : on ne peut pas la remplacer.
    if (!bundle.endsWith('.app') || bundle.startsWith('/Volumes/') || bundle.includes('/AppTranslocation/')) {
      await this.opts.openPath(dmg)
      throw new Error('Learn n’est pas dans le dossier Applications : glisse la nouvelle version depuis la fenêtre qui vient de s’ouvrir.')
    }
    const mount = mkdtempSync(join(tmpdir(), 'learn-dmg-'))
    await run('hdiutil', ['attach', dmg, '-nobrowse', '-noautoopen', '-quiet', '-mountpoint', mount])
    const fresh = `${bundle}.new`
    const old = `${bundle}.old`
    try {
      rmSync(fresh, { recursive: true, force: true })
      await run('ditto', [join(mount, 'Learn.app'), fresh])
    } finally {
      await run('hdiutil', ['detach', mount, '-quiet', '-force']).catch(() => undefined)
    }
    rmSync(old, { recursive: true, force: true })
    renameSync(bundle, old)
    try {
      renameSync(fresh, bundle)
    } catch (e) {
      renameSync(old, bundle)
      throw e
    }
    await run('xattr', ['-dr', 'com.apple.quarantine', bundle]).catch(() => undefined)
    if (existsSync(old)) rmSync(old, { recursive: true, force: true })
    this.opts.relaunch()
  }
}
