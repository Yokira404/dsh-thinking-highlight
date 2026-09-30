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
 *   node evidence/install.mjs [profileName] [--dry-run]
 *
 * `--dry-run` prints exactly what it would write and touches nothing, so the
 * destructive parts below can be reviewed before they run.
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const packageName = manifest.name
const [scope, bare] = packageName.split('/')

const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const profileName = argv.find((value) => value.startsWith('--') === false) ?? process.env.DSH_PROFILE ?? 'desktop'
const home = process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh')
const profileDir = join(home, 'profiles', profileName)
if (existsSync(profileDir) === false) {
  console.error('profile directory not found: ' + profileDir)
  process.exit(2)
}

const modulePath = join(profileDir, 'node_modules', scope, bare)
const manifestPath = join(profileDir, 'package.json')
if (existsSync(manifestPath) === false) {
  console.error('profile manifest not found: ' + manifestPath)
  process.exit(2)
}
if (dryRun === true) console.log('dry run: nothing below is written')

/**
 * Only a link this script could have created may be removed. A real directory at
 * that path is somebody's install (a `pnpm add` from a registry, a copied tree),
 * and deleting it recursively would destroy it.
 */
function removeOwnLink(path, label) {
  const stats = lstatSync(path, { throwIfNoEntry: false })
  if (stats === undefined) return
  if (stats.isSymbolicLink() === false) {
    console.error('refusing to remove ' + label + ': ' + path + ' is not a link (remove it by hand if it is stale)')
    process.exit(3)
  }
  if (dryRun === true) {
    console.log('would remove the link ' + path)
    return
  }
  rmSync(path, { recursive: true, force: true })
}

// 1. Materialise the package link. A previous link is removed first: writing
//    through a junction would edit the workspace, not the profile.
removeOwnLink(modulePath, 'the package link')
if (dryRun !== true) {
  mkdirSync(dirname(modulePath), { recursive: true })
  symlinkSync(packageRoot, modulePath, 'junction')
}

// 2. Record the dependency (`installed`) and the bundle selection (`enabled`).
//    `link:` is what `pnpm add <local-dir>` writes, so a later pnpm reconcile in
//    this profile keeps this shape instead of replacing it.
const before = readFileSync(manifestPath, 'utf8')
const profile = JSON.parse(before)
profile.dependencies ??= {}
profile.dsh ??= {}
profile.dsh.profile ??= {}
const bundles = profile.dsh.profile.bundles ?? (profile.dsh.profile.bundles = [])

// 2a. A rename must not leave the old name behind: a stale bundle entry points at a
//     package that no longer exists, and a stale dependency keeps the old link alive.
//     Only names this plugin plausibly used before qualify — the same package name
//     under the scopes this script has written (`@local` in the first release, the
//     current scope now) — so another publisher's same-named package is never touched.
const previousScopes = new Set(['@local', scope])
const isThisPlugin = (name) => typeof name === 'string' && previousScopes.has(name.split('/')[0]) && name.split('/')[1] === bare
const stale = [
  ...bundles.filter((name) => name !== packageName && isThisPlugin(name)),
  ...Object.keys(profile.dependencies).filter((name) => name !== packageName && isThisPlugin(name)),
]
for (const name of new Set(stale)) {
  const [oldScope, oldBare] = name.split('/')
  profile.dsh.profile.bundles = profile.dsh.profile.bundles.filter((entry) => entry !== name)
  delete profile.dependencies[name]
  removeOwnLink(join(profileDir, 'node_modules', oldScope, oldBare), 'the previous name ' + name)
  console.log('removed the previous name ' + name)
}

profile.dependencies[packageName] = 'link:' + packageRoot.split(sep).join('/')
if (profile.dsh.profile.bundles.includes(packageName) === false) profile.dsh.profile.bundles.push(packageName)
const after = JSON.stringify(profile, null, 2) + '\n'
if (after === before) {
  console.log('the profile already records this plugin exactly; manifest left untouched')
} else if (dryRun === true) {
  console.log('would rewrite ' + manifestPath + ' (' + before.length + ' -> ' + after.length + ' bytes)')
} else {
  /* The profile manifest is not ours: keep one copy of what was there before. */
  const backup = manifestPath + '.bak-' + Date.now()
  copyFileSync(manifestPath, backup)
  writeFileSync(manifestPath, after, 'utf8')
  console.log('  previous manifest kept at ' + backup)
}

console.log('linked ' + packageName + ' -> ' + modulePath + (dryRun === true ? ' (dry run)' : ''))
console.log('  target: ' + packageRoot)
console.log('  dependency: ' + JSON.stringify(profile.dependencies))
console.log('  bundles: ' + JSON.stringify(profile.dsh.profile.bundles))
console.log('  profile page: 已安装 card with a switch; reload the page to see it')
if (relative(profileDir, packageRoot).startsWith('..') === false) {
  console.log('  note: the linked directory sits inside the profile; a `file:` install would be safer there')
}
