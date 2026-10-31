import { AnimatePresence, motion } from 'framer-motion'
import { Pause, Play, RotateCw, X } from 'lucide-react'
import { formatTime } from '@shared/media'
import { usePlayer } from '../../lib/player'
import { useApp } from '../../lib/store'
import { useT } from '../../lib/i18n'

/** Mini-lecteur : l'épisode en cours reste à portée de main, quel que soit l'écran affiché. */
export default function PlayerBar(): React.JSX.Element {
  const t = useT()
  const { item, playing, time, duration, toggle, skip, stop } = usePlayer()
  const setView = useApp((s) => s.setView)
  const select = useApp((s) => s.select)
  return (
    <AnimatePresence>
      {item && (
        <motion.div
          className="player-bar"
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
        >
          <div className="player-progress" style={{ width: `${duration ? (time / duration) * 100 : 0}%` }} />
          <button
            className="player-info"
            onClick={() => {
              setView({ type: 'kind', kind: 'podcast' })
              void select(item.id)
            }}
            title={t.openEpisode}
          >
            {item.imageUrl ? <img src={item.imageUrl} alt="" /> : <span className="player-art" />}
            <span className="player-text">
              <span className="player-title">{item.title}</span>
              <span className="player-time">
                {formatTime(time)} / {formatTime(duration)}
              </span>
            </span>
          </button>
          <button className="tb-btn" onClick={toggle} aria-label={playing ? t.pause : t.play}>
            {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
          </button>
          <button className="tb-btn" onClick={() => skip(30)} aria-label={t.forward30}>
            <RotateCw size={16} />
          </button>
          <button className="tb-btn" onClick={stop} aria-label={t.close}>
            <X size={15} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
