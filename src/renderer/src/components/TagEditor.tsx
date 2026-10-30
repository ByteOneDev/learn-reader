import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useApp } from '../lib/store'
import { useT } from '../lib/i18n'

export default function TagEditor({ tags, onChange }: { tags: string[]; onChange(tags: string[]): void }): React.JSX.Element {
  const t = useT()
  const api = useApp((s) => s.api)
  const [value, setValue] = useState('')
  const [all, setAll] = useState<string[]>([])
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void api.allTags().then(setAll)
    setTimeout(() => ref.current?.focus(), 30)
  }, [api])

  const add = (tag: string): void => {
    const clean = tag.trim()
    if (clean && !tags.includes(clean)) onChange([...tags, clean])
    setValue('')
  }
  const suggestions = all.filter((s) => !tags.includes(s) && s.toLowerCase().includes(value.toLowerCase())).slice(0, 8)

  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          {tag}
          <button onClick={() => onChange(tags.filter((x) => x !== tag))} aria-label={`${t.delete} ${tag}`}>
            <X size={12} />
          </button>
        </span>
      ))}
      <input
        ref={ref}
        value={value}
        placeholder={t.addTag}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add(value)
          } else if (e.key === 'Backspace' && !value && tags.length) onChange(tags.slice(0, -1))
        }}
      />
      {suggestions.length > 0 && (
        <div className="tag-suggestions">
          {suggestions.map((s) => (
            <button key={s} onClick={() => add(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
