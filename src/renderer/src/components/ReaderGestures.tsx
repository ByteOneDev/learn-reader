import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Item } from '@shared/types'
import { useApp } from '../lib/store'
import { gestureOn, inHorizontalScroller, WheelTracker } from '../lib/gestures'

const NAV_THRESHOLD = 120
const MIN_SIZE = 13
const MAX_SIZE = 30

/**
 * Gestes du lecteur au trackpad :
 * - deux doigts à l'horizontale : ← article suivant, → précédent (pas dans les livres ni sur un élément
 *   qui défile lui-même horizontalement, comme un bloc de code) ;
 * - pincer : taille du texte, appliquée en direct puis enregistrée.
 */
export function useReaderGestures(scrollRef: React.RefObject<HTMLDivElement | null>, item: Item | null): number {
  const [nav, setNav] = useState(0)
  const itemRef = useRef(item)
  itemRef.current = item
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    let offset = 0
    let ignore = false
    let size = useApp.getState().settings?.readerSize ?? 18
    let saveTimer: ReturnType<typeof setTimeout> | null = null
    const tracker = new WheelTracker(() => {
      if (!ignore && Math.abs(offset) >= NAV_THRESHOLD) useApp.getState().move(offset < 0 ? 1 : -1)
      offset = 0
      ignore = false
      setNav(0)
    }, 170)
    const onWheel = (e: WheelEvent): void => {
      // Pincement au trackpad : Chromium l'envoie comme une molette avec Ctrl.
      if (e.ctrlKey) {
        if (!gestureOn('pinchZoom')) return
        e.preventDefault()
        size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, size - e.deltaY * 0.08))
        document.documentElement.style.setProperty('--reader-size', `${size.toFixed(1)}px`)
        if (saveTimer) clearTimeout(saveTimer)
        saveTimer = setTimeout(() => void useApp.getState().updateSettings({ readerSize: Math.round(size) }), 400)
        return
      }
      const it = itemRef.current
      if (!gestureOn('readerSwipe') || !it || it.format) return
      tracker.push(e)
      if (tracker.axis !== 'x' || ignore) return
      if (offset === 0 && inHorizontalScroller(e.target, el)) {
        ignore = true
        return
      }
      e.preventDefault()
      offset = Math.max(-200, Math.min(200, -tracker.dx))
      setNav(offset)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      if (saveTimer) clearTimeout(saveTimer)
    }
  }, [scrollRef, item?.id])
  return nav
}

/** Pastille au bord du lecteur pendant le balayage : précédent à gauche, suivant à droite. */
export function SwipeNavHint({ offset }: { offset: number }): React.JSX.Element | null {
  if (!offset) return null
  const next = offset < 0
  const progress = Math.min(1, Math.abs(offset) / NAV_THRESHOLD)
  return (
    <div
      className={`swipe-nav ${next ? 'next' : 'prev'}${progress >= 1 ? ' armed' : ''}`}
      style={{ opacity: progress, ['--p' as string]: progress } as React.CSSProperties}
      aria-hidden
    >
      {next ? <ChevronRight size={22} /> : <ChevronLeft size={22} />}
    </div>
  )
}

/** Image en plein écran (double-clic) ; clic ou Échap pour fermer. */
export function Lightbox({ src, onClose }: { src: string | null; onClose(): void }): React.JSX.Element {
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [src, onClose])
  return (
    <AnimatePresence>
      {src && (
        <motion.div className="lightbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.img
            src={src}
            alt=""
            referrerPolicy="no-referrer"
            initial={{ scale: 0.88, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.94, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
