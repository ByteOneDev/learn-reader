import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useApp } from './lib/store'
import { useShortcuts } from './lib/shortcuts'
import Sidebar from './components/Sidebar'
import Timeline from './components/Timeline'
import Reader from './components/Reader'
import AddSourceDialog from './components/AddSourceDialog'
import SettingsDialog from './components/SettingsDialog'
import Toasts from './components/Toasts'
import Onboarding from './onboarding/Onboarding'

export default function App(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const dialog = useApp((s) => s.dialog)
  const setDialog = useApp((s) => s.setDialog)
  useShortcuts()

  useEffect(() => {
    const root = document.documentElement
    if (!settings || settings.theme === 'system') delete root.dataset.theme
    else root.dataset.theme = settings.theme
    root.lang = settings?.language ?? 'fr'
    root.style.setProperty('--reader-size', `${settings?.readerSize ?? 18}px`)
  }, [settings])

  if (!settings) return <div />

  return (
    <>
      <div className="app">
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              key="sidebar"
              style={{ display: 'flex', overflow: 'hidden', flex: 'none' }}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            >
              <Sidebar />
            </motion.div>
          )}
        </AnimatePresence>
        <Timeline />
        <Reader />
      </div>

      <AnimatePresence>
        {dialog === 'add' && <AddSourceDialog key="add" onClose={() => setDialog(null)} />}
        {dialog === 'settings' && <SettingsDialog key="settings" onClose={() => setDialog(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {(!settings.onboarded || dialog === 'catalog') && (
          <Onboarding key="onboarding" mode={settings.onboarded ? 'catalog' : 'first'} onClose={() => setDialog(null)} />
        )}
      </AnimatePresence>

      <Toasts />
    </>
  )
}
