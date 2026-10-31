import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { Settings } from '@shared/types'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'
import Dialog from './Dialog'

export default function SettingsDialog({ onClose }: { onClose(): void }): React.JSX.Element {
  const t = useT()
  const settings = useApp((s) => s.settings)!
  const updateSettings = useApp((s) => s.updateSettings)
  const api = useApp((s) => s.api)
  const toast = useApp((s) => s.toast)
  const setDialog = useApp((s) => s.setDialog)
  const reloadMeta = useApp((s) => s.reloadMeta)
  const [bridge, setBridge] = useState(settings.xBridge ?? '')
  const [folder, setFolder] = useState(settings.obsidianFolder)

  const set = (patch: Partial<Settings>): void => void updateSettings(patch)

  return (
    <Dialog title={t.settings} onClose={onClose} width={600}>
      <div className="field row-between">
        <span className="field-label" style={{ margin: 0 }}>{t.theme}</span>
        <div className="segmented">
          {(['system', 'dark', 'light'] as const).map((th) => (
            <button key={th} className={settings.theme === th ? 'on' : ''} onClick={() => set({ theme: th })}>
              {th === 'system' ? t.themeSystem : th === 'dark' ? t.themeDark : t.themeLight}
            </button>
          ))}
        </div>
      </div>
      <div className="field row-between">
        <span className="field-label" style={{ margin: 0 }}>{t.language}</span>
        <div className="segmented">
          <button className={settings.language === 'fr' ? 'on' : ''} onClick={() => set({ language: 'fr' })}>Français</button>
          <button className={settings.language === 'en' ? 'on' : ''} onClick={() => set({ language: 'en' })}>English</button>
        </div>
      </div>
      <div className="field row-between">
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t.showUnread}</span>
        <button className={`switch${settings.showUnread ? ' on' : ''}`} onClick={() => set({ showUnread: !settings.showUnread })} role="switch" aria-checked={settings.showUnread} />
      </div>
      <div className="field row-between">
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t.refreshEvery}</span>
        <div className="segmented">
          {[15, 30, 60, 180].map((m) => (
            <button key={m} className={settings.refreshMinutes === m ? 'on' : ''} onClick={() => set({ refreshMinutes: m })}>
              {m < 60 ? `${m} min` : `${m / 60} h`}
            </button>
          ))}
        </div>
      </div>
      <div className="field row-between">
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t.readerFont}</span>
        <div className="segmented">
          <button className={settings.readerFont === 'sans' ? 'on' : ''} onClick={() => set({ readerFont: 'sans' })}>{t.sans}</button>
          <button className={settings.readerFont === 'serif' ? 'on' : ''} onClick={() => set({ readerFont: 'serif' })} style={{ fontFamily: 'var(--font-serif)' }}>
            {t.serif}
          </button>
        </div>
      </div>
      <div className="field row-between">
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t.textSize}</span>
        <input type="range" min={15} max={24} value={settings.readerSize} onChange={(e) => set({ readerSize: Number(e.target.value) })} style={{ accentColor: 'var(--accent)' }} />
      </div>

      <div className="field">
        <label>{t.obsidian}</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="text-input" readOnly value={settings.obsidianVault ?? ''} placeholder={t.vault} />
          <button
            className="btn"
            onClick={async () => {
              const f = await api.chooseFolder()
              if (f) set({ obsidianVault: f })
            }}
          >
            <FolderOpen size={16} /> {t.chooseVault}
          </button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
          <input
            className="text-input"
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            onBlur={() => set({ obsidianFolder: folder.trim() || 'Learn' })}
            aria-label={t.folderInVault}
            placeholder={t.folderInVault}
          />
          <button
            className="btn"
            disabled={!settings.obsidianVault}
            onClick={async () => {
              try {
                const r = await api.exportAllToObsidian()
                toast(`${t.exported} · ${r.count}`)
              } catch (e) {
                toast((e as Error).message, 'error')
              }
            }}
          >
            {t.exportAll}
          </button>
        </div>
      </div>

      <div className="field row-between" style={{ marginTop: -4 }}>
        <span>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>{t.obsidianSync}</span>
          <span className="hint" style={{ display: 'block', marginTop: 4 }}>{t.obsidianSyncHint}</span>
        </span>
        <button
          className={`switch${settings.obsidianSync ? ' on' : ''}`}
          disabled={!settings.obsidianVault}
          onClick={() => set({ obsidianSync: !settings.obsidianSync })}
          role="switch"
          aria-checked={!!settings.obsidianSync}
          aria-label={t.obsidianSync}
        />
      </div>

      <div className="field">
        <label>{t.xBridge}</label>
        <input
          className="text-input"
          value={bridge}
          onChange={(e) => setBridge(e.target.value)}
          onBlur={() => set({ xBridge: bridge.trim() || undefined })}
          placeholder={t.xBridgeHint}
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label>{t.subscriptions}</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn" onClick={() => setDialog('catalog')}>
            {t.browseCatalog}
          </button>
          <button
            className="btn"
            onClick={async () => {
              const r = await api.importOpml()
              if (r) {
                toast(`OPML : +${r.added}${r.failed ? ` · ${t.errorsCount(r.failed)}` : ''}`, r.failed ? 'error' : 'ok')
                void reloadMeta()
              }
            }}
          >
            {t.importOpml}
          </button>
          <button className="btn" onClick={() => void api.exportOpml()}>
            {t.exportOpml}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
