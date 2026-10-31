import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { API_METHODS, type LearnAPI, type LearnEvent } from '@shared/types'

// Seule passerelle entre l'interface et le système : une liste fermée de méthodes, rien d'autre.
const api = Object.fromEntries(API_METHODS.map((m) => [m, (...args: unknown[]) => ipcRenderer.invoke(`learn:${m}`, ...args)])) as unknown as LearnAPI

api.platform = process.platform
// Glisser-déposer : le chemin d'un fichier n'est plus exposé par File.path depuis Electron 32.
api.pathForFile = (file: File) => webUtils.getPathForFile(file)
api.onEvent = (cb: (e: LearnEvent) => void) => {
  const listener = (_: unknown, e: LearnEvent): void => cb(e)
  ipcRenderer.on('learn:event', listener)
  return () => ipcRenderer.removeListener('learn:event', listener)
}

contextBridge.exposeInMainWorld('learn', api)
