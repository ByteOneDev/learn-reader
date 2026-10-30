import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'

interface Props {
  /** Point d'ancrage en coordonnées de fenêtre ; le popover se place au-dessus ou en dessous. */
  anchor: { x: number; y: number; bottom?: number }
  placement?: 'above' | 'below'
  onClose(): void
  children: ReactNode
  className?: string
}

export default function Popover({ anchor, placement = 'above', onClose, children, className = '' }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; below: boolean } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    let below = placement === 'below'
    let top = below ? (anchor.bottom ?? anchor.y) + 10 : anchor.y - height - 10
    if (!below && top < 8) {
      below = true
      top = (anchor.bottom ?? anchor.y) + 10
    }
    if (top + height > window.innerHeight - 8) top = Math.max(8, window.innerHeight - height - 8)
    const left = Math.min(Math.max(8, anchor.x - width / 2), window.innerWidth - width - 8)
    setPos({ left, top, below })
  }, [anchor.x, anchor.y, anchor.bottom, placement])

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    window.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  return createPortal(
    <motion.div
      ref={ref}
      className={`popover ${className}`}
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999, transformOrigin: pos?.below ? 'top center' : 'bottom center' }}
      initial={{ opacity: 0, scale: 0.92, y: pos?.below ? -4 : 4 }}
      animate={{ opacity: pos ? 1 : 0, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 600, damping: 36 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </motion.div>,
    document.body
  )
}
