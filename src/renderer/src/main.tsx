import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import App from './App'
import { useApp } from './lib/store'
import { withFriendlyErrors } from './lib/errors'
import './styles/app.css'

async function boot(): Promise<void> {
  // Dans Electron, le preload expose window.learn. Dans un navigateur (npm run web), on charge l'API simulée.
  const api = withFriendlyErrors(window.learn ?? (await import('./lib/mockApi')).mockApi)
  document.documentElement.classList.add(`platform-${api.platform}`)
  await useApp.getState().init(api)
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <MotionConfig reducedMotion="user">
        <App />
      </MotionConfig>
    </StrictMode>
  )
}

void boot()
