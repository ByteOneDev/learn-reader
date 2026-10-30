/// <reference types="vite/client" />
import type { LearnAPI } from '@shared/types'

declare global {
  interface Window {
    learn?: LearnAPI
  }
}
