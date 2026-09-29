/**
 * Install the authored plugin into a profile the way the Plugins page expects it.
 *
 * The page lists a package only when the profile records it as a *dependency*
 * (`installed`) or as a shipped-optional bundle; the bundle selection alone is
 * invisible there. `plugin_manager.listBundles` reads `manifest.dependencies`,
 * and the page filters on it, so a package that is merely selected in
 * `dsh.profile.bundles` gets no card and no switch at all.
 *
 * A `link:` dependency plus a junction under the profile's node_modules keeps the
 * authoring workspace as the single source of truth: the Host row and the browser
 * bundle are read straight from this directory, and enabling/disabling the plugin
 * from the Plugins page only rewrites the profile's bundle list.
 *
 *   node evidence/install.mjs [profileName]
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const packageName = manifest.name
const [scope, bare] = packageName.split('/')

const profileName = process.argv[2] ?? process.env.DSH_PROFILE ?? 'desktop'
const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const profileDir = join(home, 'profiles', profileName)
if (existsSync(profileDir) === false) {
  console.error('profile directory not found: ' + profileDir)
  process.exit(2)
}

const modulePath = join(profileDir, 'node_modules', scope, bare)
const manifestPath = join(profileDir, 'package.json')

// 1. Materialise the package link. A previous copy or junction is removed first:
//    writing through a junction would edit the workspace, not the profile.
if (existsSync(modulePath) || lstatSync(modulePath, { throwIfNoEntry: false }) !== undefined) {
  rmSync(modulePath, { recursive: true, force: true })
}
mkdirSync(dirname(modulePath), { recursive: true })
symlinkSync(packageRoot, modulePath, 'junction')

// 2. Record the dependency (`installed`) and the bundle selection (`enabled`).
//    `link:` is what `pnpm add <local-dir>` writes, so a later pnpm reconcile in
//    this profile keeps this shape instead of replacing it.
const profile = JSON.parse(readFileSync(manifestPath, 'utf8'))
profile.dependencies ??= {}
profile.dependencies[packageName] = 'link:' + packageRoot.split(sep).join('/')
profile.dsh ??= {}
profile.dsh.profile ??= {}
const bundles = profile.dsh.profile.bundles ?? (profile.dsh.profile.bundles = [])
if (bundles.includes(packageName) === false) bundles.push(packageName)
writeFileSync(manifestPath, JSON.stringify(profile, null, 2) + '\n', 'utf8')

console.log('linked ' + packageName + ' -> ' + modulePath)
console.log('  target: ' + packageRoot)
console.log('  dependency: ' + JSON.stringify(profile.dependencies))
console.log('  bundles: ' + JSON.stringify(bundles))
console.log('  profile page: 已安装 card with a switch; reload the page to see it')
if (relative(profileDir, packageRoot).startsWith('..') === false) {
  console.log('  note: the linked directory sits inside the profile; a `file:` install would be safer there')
}
