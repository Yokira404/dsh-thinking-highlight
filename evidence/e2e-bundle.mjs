/**
 * End-to-end check against a running scratch Web profile: the plugin's Host row
 * activates, the boot graph carries its browser half, and the served bundle is
 * byte-identical to the current source.
 *
 *   node e2e-bundle.mjs <page-url-with-token> <package-id> [cookie]
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const page = process.argv[2]
const id = process.argv[3]
const cookieArg = process.argv[4]

if (page === undefined || id === undefined) {
  console.error('usage: node e2e-bundle.mjs <page-url-with-token> <package-id> [cookie]')
  console.error("  the page URL must carry the desktop app's loopback token; _tools/live-page-check.mjs shows how to find one")
  process.exit(2)
}
try {
  new URL(page)
} catch (error) {
  console.error('FAIL: not a usable page URL: ' + page)
  process.exit(2)
}

/* The comparison below is the point of this suite: "the served bundle is the
   current source" cannot be shown by looking for a few identifiers in it. */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'client.js'))
const sourceHash = createHash('sha256').update(source).digest('hex')

/** The page sets a session cookie on the token exchange and also accepts a `cookie` argument. */
const headers = cookieArg === undefined ? {} : { cookie: cookieArg }
const first = await fetch(page, { headers })
const setCookie = (first.headers.getSetCookie?.() ?? []).map((value) => value.split(';')[0]).join('; ')
const cookie = cookieArg ?? setCookie
const html = await first.text()
if (html.startsWith('dsh web authentication required')) {
  console.error('FAIL: page refused the token (status ' + first.status + ')')
  process.exit(2)
}

// Pull the boot graph out of the injected __DSH_BOOT__ assignment.
const marker = html.indexOf('__DSH_BOOT__')
const open = html.indexOf('{', marker)
let depth = 0
let end = -1
for (let i = open; i < html.length; i += 1) {
  if (html[i] === '{') depth += 1
  else if (html[i] === '}') {
    depth -= 1
    if (depth === 0) {
      end = i
      break
    }
  }
}
const graph = JSON.parse(html.slice(open, end + 1))
const entry = graph.entries.find((item) => item.id === id)
if (entry === undefined) {
  console.error('FAIL: boot graph has no row for ' + id)
  process.exit(3)
}
console.log('boot graph row: ' + JSON.stringify({ id: entry.id, url: entry.url, immediately: entry.immediately, inject: entry.inject }))

const response = await fetch(new URL(entry.url, page).href, { headers: { cookie } })
const body = await response.text()
const expected = [
  'window.__ModuleLoader__.load',
  "id: '" + id + "'",
  'settings.section',
  'settings.thinking-highlight.item',
  'matchSegments',
  'createTextNode',
  'data-dsh-th-eye',
  'dsh-th-eye',
  'useSyncExternalStore',
]
const missing = expected.filter((needle) => !body.includes(needle))
const servedHash = createHash('sha256').update(body).digest('hex')
const sameBytes = servedHash === sourceHash
console.log('bundle: ' + response.status + ', ' + body.length + ' bytes')
console.log('  source sha256: ' + sourceHash)
console.log('  served sha256: ' + servedHash + (sameBytes ? '  (identical)' : '  (DIFFERENT — the page serves a stale build)'))
if (missing.length > 0) console.error('FAIL: bundle is missing ' + JSON.stringify(missing))
if (sameBytes === false) console.error('FAIL: served bundle is not the current source; rebuild or reload before trusting this check')
process.exit(missing.length === 0 && sameBytes === true && response.status === 200 ? 0 : 4)
