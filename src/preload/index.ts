import { contextBridge, ipcRenderer } from 'electron'
import { API_METHODS, type LearnAPI, type LearnEvent } from '@shared/types'

// Seule passerelle entre l'interface et le système : une liste fermée de méthodes, rien d'autre.
const api = Object.fromEntries(API_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`learn:${m}`, ...args)])) as unknown as LearnAPI

api.platform = process.platform
api.onEvent = (cb: (e: LearnEvent) => void) => {
  const listener = (_: unknown, e: LearnEvent): void => cb(e)
  ipcRenderer.on('learn:event', listener)
  return () => ipcRenderer.removeListener('learn:event', listener)
}

contextBridge.exposeInMainWorld('learn', api)
