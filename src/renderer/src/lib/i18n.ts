import { useApp } from './store'
import { dictionaries, type Dict } from './strings'

export { dictionaries, type Dict }

export function useT(): Dict {
  const lang = useApp((s) => s.settings?.language ?? 'fr')
  return dictionaries[lang]
}
