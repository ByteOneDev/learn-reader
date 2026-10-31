import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, Pause, Play, RotateCcw, RotateCw, Timer, Tv } from 'lucide-react'
import type { Cue, Highlight } from '@shared/types'
import { formatTime, youtubeId } from '@shared/media'
import { useApp } from '../../lib/store'
import { useT } from '../../lib/i18n'
import { RATES, usePlayer } from '../../lib/player'
import { sanitize } from '../../lib/sanitize'
import ArticleContent from '../ArticleContent'
import SourceIcon from '../SourceIcon'
import { parsePosition, type BookViewProps } from '../books/common'

type Tab = 'feed' | 'transcript'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Transcription → HTML : un paragraphe par segment, l'horodatage cliquable en tête. */
function transcriptHtml(cues: Cue[]): string {
  return cues
    .map((c) => {
      const time = c.start >= 0 ? `<a href="#t=${Math.floor(c.start)}">${formatTime(c.start)}</a> ` : ''
      const who = c.speaker ? `<strong>${esc(c.speaker)}</strong> · ` : ''
      return `<p>${time}${who}${esc(c.text)}</p>`
    })
    .join('')
}

interface Props extends BookViewProps {
  /** Moment noté : le lecteur ouvre aussitôt l'éditeur de note. */
  onMoment(h: Highlight, anchor: { x: number; y: number; bottom: number }): void
}

/** Pilotage du lecteur YouTube intégré par postMessage (API IFrame, sans charger de script externe). */
function useYouTube(frame: React.RefObject<HTMLIFrameElement | null>): { time: number; duration: number; seek(t: number): void; listen(): void } {
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (!/^https:\/\/www\.youtube(-nocookie)?\.com$/.test(e.origin) || typeof e.data !== 'string') return
      try {
        const d = JSON.parse(e.data) as { event?: string; info?: { currentTime?: number; duration?: number } }
        if (d.info?.currentTime !== undefined) setTime(d.info.currentTime)
        if (d.info?.duration) setDuration(d.info.duration)
      } catch {
        /* message d'un autre type */
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])
  const post = (msg: Record<string, unknown>): void => frame.current?.contentWindow?.postMessage(JSON.stringify({ id: 1, channel: 'widget', ...msg }), 'https://www.youtube-nocookie.com')
  return {
    time,
    duration,
    seek: (t) => post({ event: 'command', func: 'seekTo', args: [t, true] }),
    listen: () => post({ event: 'listening' })
  }
}

export default function MediaView({ item, highlights, navRef, onOrphans, onMouseUp, onClick, onMoment }: Props): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const sources = useApp((s) => s.sources)
  const serif = useApp((s) => s.settings?.readerFont === 'serif')
  const addHighlight = useApp((s) => s.addHighlight)
  const source = sources.find((s) => s.id === item.sourceId)
  const player = usePlayer()
  const contentRef = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const video = useRef<HTMLVideoElement>(null)
  const yt = useYouTube(frame)
  const [videoTime, setVideoTime] = useState(0)
  const [tab, setTab] = useState<Tab>('feed')
  const [cues, setCues] = useState<Cue[] | null | undefined>(undefined)
  const start = useMemo(() => Math.floor(parsePosition(item.position).t ?? 0), [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const isAudio = item.mediaType === 'audio'
  const isYouTube = item.mediaType === 'youtube'
  const current = player.item?.id === item.id
  const time = isAudio ? (current ? player.time : start) : isYouTube ? yt.time : videoTime
  const duration = isAudio ? (current ? player.duration : item.duration ?? 0) : isYouTube ? yt.duration || item.duration || 0 : item.duration ?? 0
  const ytId = youtubeId(item.mediaUrl ?? item.url)
  // Par défaut, une vidéo YouTube s'ouvre dans le navigateur de l'utilisateur ; « Lire ici » (ou le réglage) garde le lecteur intégré.
  const videoPlayer = useApp((s) => s.settings?.videoPlayer ?? 'browser')
  const [playHere, setPlayHere] = useState(false)
  const inApp = videoPlayer === 'app' || playHere
  const patchItem = useApp((s) => s.patchItem)
  const openInBrowser = async (): Promise<void> => {
    if (!ytId) return
    await api.openExternal(`https://www.youtube.com/watch?v=${ytId}${start ? `&t=${start}s` : ''}`)
    if (!item.read) void patchItem(item.id, { read: true })
  }

  const seek = (sec: number): void => {
    if (isAudio) {
      if (!current) player.load(item, source?.title)
      player.seek(sec)
    } else if (isYouTube) yt.seek(sec)
    else if (video.current) video.current.currentTime = sec
  }

  // Transcription : chargée quand on ouvre l'onglet.
  useEffect(() => {
    if (tab !== 'transcript' || cues !== undefined) return
    setCues(null)
    void api
      .transcript(item.id)
      .then((c) => setCues(c ?? []))
      .catch(() => setCues([]))
  }, [tab, cues, api, item.id])

  // Reprise et progression pour les vidéos (YouTube, vidéos jointes).
  const lastSaved = useRef(0)
  useEffect(() => {
    if (isAudio || !time || Math.abs(time - lastSaved.current) < 10) return
    lastSaved.current = time
    void api.savePosition(item.id, JSON.stringify({ t: Math.floor(time) }), duration ? Math.min(1, time / duration) : 0)
  }, [time, isAudio, api, item.id, duration])

  navRef.current = {
    current: () => tab,
    goTo: async (layer) => {
      if (layer.startsWith('t:')) seek(Number(layer.slice(2)))
      else if (layer === 'transcript' || layer === 'feed') setTab(layer)
    }
  }

  const moments = useMemo(() => highlights.filter((h) => h.layer.startsWith('t:')).sort((a, b) => a.start - b.start), [highlights])
  const layer = tab
  const html = useMemo(
    () => (tab === 'transcript' ? (cues?.length ? transcriptHtml(cues) : '') : sanitize(item.contentHtml ?? (item.summary ? `<p>${esc(item.summary)}</p>` : ''), item.url)),
    [tab, cues, item.contentHtml, item.summary, item.url]
  )
  const layerHighlights = useMemo(() => highlights.filter((h) => h.layer === layer), [highlights, layer])

  const markMoment = async (e: React.MouseEvent): Promise<void> => {
    const sec = Math.floor(time)
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // La citation du moment est la phrase prononcée à cet instant, si une transcription existe.
    let list = cues
    if (list === undefined && item.transcriptUrl) {
      list = await api.transcript(item.id).catch(() => null)
      setCues(list ?? [])
    }
    const cue = list?.filter((c) => c.start >= 0 && c.start <= sec).at(-1)
    const h = await addHighlight({
      itemId: item.id,
      color: 'yellow',
      quote: cue?.text ?? `${formatTime(sec)} · ${item.title}`,
      prefix: '',
      suffix: '',
      start: sec,
      end: sec,
      note: '',
      layer: `t:${sec}`
    })
    onMoment(h, { x: r.left + r.width / 2, y: r.top, bottom: r.bottom })
  }

  const onContentClick = (e: React.MouseEvent): void => {
    const a = (e.target as HTMLElement).closest('a[href^="#t="]')
    if (a) {
      e.preventDefault()
      seek(Number(a.getAttribute('href')!.slice(3)))
      return
    }
    onClick(e)
  }

  return (
    <motion.article className="article media-article" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24 }}>
      <div className="article-source">
        <SourceIcon source={source} />
        {source?.title}
      </div>
      <h1 className="title">{item.title}</h1>

      {isYouTube && ytId && !inApp && (
        <button className="video-launch" onClick={() => void openInBrowser()} title={t.watchInBrowser}>
          <img src={item.imageUrl ?? `https://i.ytimg.com/vi/${ytId}/hqdefault.jpg`} alt="" referrerPolicy="no-referrer" />
          <span className="video-launch-play">
            <Play size={30} fill="currentColor" />
          </span>
          <span className="video-launch-label">
            <ExternalLink size={15} /> {t.watchInBrowser}
            {start ? ` · ${formatTime(start)}` : ''}
          </span>
        </button>
      )}
      {isYouTube && ytId && !inApp && (
        <div className="video-launch-alt">
          <button className="btn" onClick={() => setPlayHere(true)}>
            <Tv size={15} /> {t.playHere}
          </button>
          <span className="hint">{t.videoSettingHint}</span>
        </div>
      )}
      {isYouTube && ytId && inApp && (
        <div className="video-frame">
          <iframe
            ref={frame}
            src={`https://www.youtube-nocookie.com/embed/${ytId}?enablejsapi=1&rel=0&playsinline=1${playHere ? '&autoplay=1' : ''}${start ? `&start=${start}` : ''}`}
            title={item.title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => yt.listen()}
          />
        </div>
      )}
      {item.mediaType === 'video' && (
        <div className="video-frame">
          <video ref={video} src={item.mediaUrl} controls preload="metadata" onTimeUpdate={(e) => setVideoTime(e.currentTarget.currentTime)} onLoadedMetadata={(e) => (e.currentTarget.currentTime = start)} />
        </div>
      )}

      {isAudio && (
        <div className="audio-card">
          {item.imageUrl || source?.icon ? <img className="audio-art" src={item.imageUrl ?? source?.icon} alt="" /> : <div className="audio-art placeholder" />}
          <div className="audio-controls">
            <div className="audio-buttons">
              <button className="round-btn" onClick={() => (current ? player.skip(-15) : seek(Math.max(0, start - 15)))} title={t.back15} aria-label={t.back15}>
                <RotateCcw size={17} />
              </button>
              <button className="play-btn" onClick={() => (current ? player.toggle() : player.load(item, source?.title))} aria-label={current && player.playing ? t.pause : t.play}>
                {current && player.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" style={{ marginLeft: 3 }} />}
              </button>
              <button className="round-btn" onClick={() => (current ? player.skip(30) : seek(start + 30))} title={t.forward30} aria-label={t.forward30}>
                <RotateCw size={17} />
              </button>
              <button
                className="rate-btn"
                onClick={() => player.setRate(RATES[(RATES.indexOf(player.rate) + 1) % RATES.length])}
                title={t.speed}
                aria-label={t.speed}
              >
                {player.rate}×
              </button>
            </div>
            <div className="scrubber">
              <span>{formatTime(time)}</span>
              <input
                type="range"
                min={0}
                max={Math.max(1, Math.floor(duration))}
                value={Math.floor(time)}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Position"
                style={{ ['--p' as string]: `${duration ? (time / duration) * 100 : 0}%` }}
              />
              <span>-{formatTime(Math.max(0, duration - time))}</span>
            </div>
          </div>
        </div>
      )}

      {(!isYouTube || inApp) && (
        <div className="media-actions">
          <button className="btn" onClick={(e) => void markMoment(e)} disabled={!isAudio && isYouTube && !yt.time && !start}>
            <Timer size={16} /> {t.markMoment} · {formatTime(time)}
          </button>
          {isYouTube && <span className="hint">{t.youtubeHint}</span>}
        </div>
      )}

      {moments.length > 0 && (
        <div className="moments">
          <div className="field-label">{t.moments}</div>
          {moments.map((m) => (
            <button key={m.id} className="moment" onClick={() => seek(m.start)} style={{ ['--c' as string]: `var(--dot-${m.color})` }}>
              <span className="moment-time">{formatTime(m.start)}</span>
              <span className="moment-body">
                <span className="q">{m.quote}</span>
                {m.note.trim() && <span className="n">{m.note}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="mode-switch" role="tablist">
        {(['feed', 'transcript'] as const).map((m) => (
          <button key={m} className={tab === m ? 'on' : ''} onClick={() => setTab(m)} role="tab" aria-selected={tab === m}>
            {tab === m && <motion.span layoutId="media-tab" className="mode-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <span>{m === 'feed' ? (isAudio ? t.episodeNotes : t.description) : t.transcriptTab}</span>
          </button>
        ))}
      </div>

      {tab === 'transcript' && cues === null && <div className="hint">{t.loadingTranscript}</div>}
      {tab === 'transcript' && cues?.length === 0 && <div className="hint">{t.noTranscript}</div>}
      <ArticleContent
        key={tab}
        contentRef={contentRef}
        html={html}
        layer={layer}
        highlights={layerHighlights}
        serif={serif}
        onOrphans={onOrphans}
        onMouseUp={onMouseUp}
        onClick={onContentClick}
      />
    </motion.article>
  )
}
