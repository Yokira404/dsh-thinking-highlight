/**
 * End-to-end check against a running scratch Web profile: the plugin's Host row
 * activates, the boot graph carries its browser half, and the served bundle is
 * the current source.
 *
 *   node e2e-bundle.mjs <page-url-with-token> <package-id>
 */
const page = process.argv[2]
const id = process.argv[3]
const cookieArg = process.argv[4]

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
  'settings.general.item',
  'matchSegments',
  'createTextNode',
  'data-dsh-th-eye',
  'dsh-th-eye',
  'useSyncExternalStore',
]
const missing = expected.filter((needle) => !body.includes(needle))
console.log('bundle: ' + response.status + ', ' + body.length + ' bytes')
console.log(missing.length === 0 ? 'OK: served bundle is the current source' : 'FAIL: bundle is missing ' + JSON.stringify(missing))
process.exit(missing.length === 0 && response.status === 200 ? 0 : 4)
