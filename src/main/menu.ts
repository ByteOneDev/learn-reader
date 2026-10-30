import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import type { LearnEvent } from '@shared/types'

export function buildMenu(send: (e: LearnEvent) => void): Menu {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Réglages…', accelerator: 'Cmd+,', click: () => send({ type: 'menu', action: 'settings' }) },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'Fichier',
      submenu: [
        { label: 'Ajouter une source…', accelerator: 'CmdOrCtrl+N', click: () => send({ type: 'menu', action: 'add-source' }) },
        { label: 'Actualiser', accelerator: 'CmdOrCtrl+R', click: () => send({ type: 'menu', action: 'refresh' }) },
        ...(isMac ? [] : [{ type: 'separator' } as const, { label: 'Réglages…', accelerator: 'Ctrl+,', click: () => send({ type: 'menu', action: 'settings' }) }, { role: 'quit' } as const])
      ]
    },
    { role: 'editMenu' },
    {
      label: 'Présentation',
      submenu: [{ role: 'togglefullscreen' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }]
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'Learn sur GitHub', click: () => void shell.openExternal('https://github.com/ByteOneDev/learn-reader') }]
    }
  ]
  return Menu.buildFromTemplate(template)
}
