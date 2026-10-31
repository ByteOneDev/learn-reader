import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookPlus } from 'lucide-react'
import { useApp } from './lib/store'
import { useShortcuts } from './lib/shortcuts'
import Sidebar from './components/Sidebar'
import Timeline from './components/Timeline'
import Reader from './components/Reader'
import AddSourceDialog from './components/AddSourceDialog'
import SettingsDialog from './components/SettingsDialog'
import Toasts from './components/Toasts'
import Onboarding from './onboarding/Onboarding'
import BalanceDialog from './components/BalanceDialog'
import BoardView from './components/boards/BoardView'
import PlayerBar from './components/media/PlayerBar'
import { useT } from './lib/i18n'

export default function App(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const dialog = useApp((s) => s.dialog)
  const setDialog = useApp((s) => s.setDialog)
  const focusMode = useApp((s) => s.focusMode)
  const view = useApp((s) => s.view)
  const api = useApp((s) => s.api)
  const importBooks = useApp((s) => s.importBooks)
  const t = useT()
  const [dragging, setDragging] = useState(false)
  useShortcuts()

  // Glisser-déposer d'EPUB et de PDF n'importe où dans la fenêtre.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (!depth) setDragging(false)
    }
    const over = (e: DragEvent): void => {
      if (hasFiles(e)) e.preventDefault()
    }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => /\.(epub|pdf)$/i.test(f.name))
      const paths = api.pathForFile ? files.map((f) => api.pathForFile!(f)).filter(Boolean) : []
      if (paths.length) void importBooks(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [api, importBooks])

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
          {sidebarOpen && !focusMode && (
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
        {view.type === 'board' && <BoardView boardId={view.boardId} />}
        <AnimatePresence initial={false}>
          {!focusMode && view.type !== 'board' && (
            <motion.div
              key="list"
              style={{ display: 'flex', overflow: 'hidden', flex: 'none' }}
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            >
              <Timeline />
            </motion.div>
          )}
        </AnimatePresence>
        {view.type !== 'board' && <Reader />}
      </div>

      <AnimatePresence>
        {dialog === 'add' && <AddSourceDialog key="add" onClose={() => setDialog(null)} />}
        {dialog === 'settings' && <SettingsDialog key="settings" onClose={() => setDialog(null)} />}
        {dialog === 'balance' && <BalanceDialog key="balance" onClose={() => setDialog(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {(!settings.onboarded || dialog === 'catalog') && (
          <Onboarding key="onboarding" mode={settings.onboarded ? 'catalog' : 'first'} onClose={() => setDialog(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dragging && (
          <motion.div className="drop-zone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="drop-card" initial={{ scale: 0.94 }} animate={{ scale: 1 }}>
              <BookPlus size={40} strokeWidth={1.5} />
              {t.dropHere}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PlayerBar />
      <Toasts />
    </>
  )
}
