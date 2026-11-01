// Test de fumée de l'app réelle : lance Electron sur le build (out/), avec un profil vierge, et vérifie
// que l'interface s'affiche et répond. Attrape ce que les tests unitaires et l'aperçu navigateur ne voient
// pas : preload, processus principal, chargement en file://, politique de sécurité (CSP).
//   npm run build && npm run smoke            (Linux sans écran : xvfb-run -a npm run smoke)
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { _electron } from 'playwright-core'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const electronPath = createRequire(import.meta.url)('electron')
const profile = mkdtempSync(join(tmpdir(), 'learn-smoke-'))
const errors = []
let current = 'démarrage'
const step = (msg) => console.log(`✓ ${msg}`)

const app = await _electron.launch({
  executablePath: electronPath,
  args: [root, `--user-data-dir=${profile}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])],
  timeout: 60_000
})
try {
  const w = await app.firstWindow()
  w.on('pageerror', (e) => errors.push(`Erreur de l'interface : ${e.message}`))
  w.on('console', (m) => {
    // Excalidraw tente aussi un CDN de secours pour ses polices, bloqué par la CSP : sans conséquence.
    if (m.type() === 'error' && !m.text().includes('esm.sh')) errors.push(`console.error : ${m.text()}`)
  })

  // 1. L'interface s'affiche (un écran blanc = échec).
  await w.waitForFunction(() => (document.getElementById('root')?.children.length ?? 0) > 0, null, { timeout: 30_000 })
  step('interface affichée')

  // 2. Premier lancement : on choisit un thème léger et on va au bout. Le dernier bouton reste grisé
  //    pendant l'abonnement aux sources (réseau réel en CI) : on attend qu'il redevienne cliquable.
  current = 'premier lancement'
  for (let i = 0; i < 90 && (await w.locator('.onboarding').count()); i++) {
    const btn = w.locator('.onboarding button').filter({ hasText: /Commencer|Continuer|C’est parti|Get started|Continue|Let’s go/ }).last()
    const enabled = (await btn.count()) > 0 && (await btn.isEnabled().catch(() => false))
    if (!enabled && (await w.getByText(/Qu’est-ce qui t’intéresse|What are you into/).count())) {
      await w.locator('.onboarding button').filter({ hasText: /^(Santé|Health)/ }).first().click({ timeout: 5000 }).catch(() => {})
    } else if (enabled) {
      await btn.click({ timeout: 5000 }).catch(() => {})
    }
    await w.waitForTimeout(1500)
  }
  await w.locator('.onboarding').waitFor({ state: 'detached', timeout: 120_000 })
  await w.locator('.sidebar').waitFor()
  step('premier lancement terminé, barre latérale visible')

  // 2 bis. Les sources choisies sont bien abonnées (avec le réseau, en CI : SMOKE_NETWORK=1).
  current = 'abonnement aux sources'
  const subscribed = await w.evaluate(async () => (await window.learn.listSources()).map((x) => `${x.title}${x.error ? ` [${x.error}]` : ''}`))
  const toasts = await w.locator('.toast').allTextContents()
  console.log(`  ${subscribed.length} source(s) abonnée(s)${subscribed.length ? ' : ' + subscribed.join(', ') : ''}`)
  if (toasts.length) console.log(`  messages : ${toasts.join(' | ')}`)
  if (process.env.SMOKE_NETWORK === '1' && subscribed.length === 0) throw new Error('aucune source abonnée après le premier lancement')
  if (subscribed.length) step('sources abonnées')

  // 3. Réglages et raccourcis.
  current = 'réglages et raccourcis'
  await w.locator('.sidebar-top button').first().click()
  await w.locator('.dialog').waitFor()
  await w.locator('.dialog .btn').filter({ hasText: /Personnaliser|Customize/ }).click()
  await w.locator('.shortcut-row').first().waitFor()
  await w.keyboard.press('Escape')
  await w.keyboard.press('Escape')
  step('réglages et raccourcis')

  // 4. Schéma Excalidraw (chargé à la demande, polices servies par l'app).
  current = 'schéma Excalidraw'
  await w.locator('.nav-row').filter({ hasText: /Nouveau board|New board/ }).click()
  await w.locator('.menu button').filter({ hasText: /Excalidraw/ }).click()
  await w.locator('.excalidraw').waitFor({ timeout: 30_000 })
  step('schéma Excalidraw')

  await w.waitForTimeout(1000)
} catch (e) {
  errors.unshift(`Étape « ${current} » échouée : ${String(e?.message ?? e).split('\n')[0]}`)
} finally {
  await app.close().catch(() => {})
  rmSync(profile, { recursive: true, force: true })
}

if (errors.length) {
  console.error(`\n✗ ${errors.length} erreur(s) :\n${errors.map((e) => `  - ${e}`).join('\n')}`)
  process.exit(1)
}
console.log('\nTest de fumée réussi.')
