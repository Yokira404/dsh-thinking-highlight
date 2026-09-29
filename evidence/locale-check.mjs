/**
 * The texts the Plugins page and the settings page show must stay in one piece:
 * the package meta, both locale dictionaries and the client's own version tag.
 *
 *   node locale-check.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'))

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })

const pkg = readJson(join(root, 'package.json'))
const zh = readJson(join(root, 'locale', 'zh.json'))
const en = readJson(join(root, 'locale', 'en.json'))
const client = readFileSync(join(root, 'client.js'), 'utf8')

const meta = (dict) => dict?.meta ?? {}
const text = (value) => (typeof value === 'string' ? value.trim() : '')

check('the package carries a title and a description', text(pkg.meta?.title).length > 0 && text(pkg.meta?.description).length > 0, JSON.stringify(pkg.meta))
check('both locales use the meta shape DSH reads', meta(zh).title !== undefined && meta(en).title !== undefined, JSON.stringify([Object.keys(zh), Object.keys(en)]))
check('both locales describe the plugin', text(meta(zh).description).length > 20 && text(meta(en).description).length > 20, String(text(meta(zh).description).length) + ' zh / ' + String(text(meta(en).description).length) + ' en')
check('the two locales are actually different texts', meta(zh).title !== meta(en).title && meta(zh).description !== meta(en).description, meta(zh).title + ' / ' + meta(en).title)
check('the card title matches the Chinese locale', meta(zh).title === text(pkg.meta.title), String(meta(zh).title) + ' vs ' + String(pkg.meta.title))
check('the card description matches the Chinese locale', meta(zh).description === text(pkg.meta.description), 'equal: ' + String(meta(zh).description === text(pkg.meta.description)))
check('the description mentions what the plugin now does', /徽章/.test(text(meta(zh).description)) && /完整词/.test(text(meta(zh).description)) && /颜色/.test(text(meta(zh).description)), text(meta(zh).description).slice(0, 40))
const version = /const VERSION = '([^']+)'/.exec(client)
check('the client version tag matches package.json', version !== null && version[1] === pkg.version, String(version?.[1]) + ' vs ' + String(pkg.version))

let failed = 0
for (const result of checks) {
  if (!result.pass) failed += 1
  console.log((result.pass ? 'PASS  ' : 'FAIL  ') + result.name + (result.pass ? '' : '  (' + result.detail + ')'))
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
