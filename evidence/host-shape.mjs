/**
 * The shipped reasoning row is a sealed primitive, so the plugin decorates the DOM
 * the host actually renders. This suite is the one place the *installed* shape is
 * modelled, because the sibling-layout fixture in `client-harness.mjs` is not what
 * DSH builds:
 *
 *   div[data-variant=think][data-expanded?][data-state]
 *     span.visuallyHidden                 only while running (streaming)
 *     div[data-open?]                     DisclosureRow root, data-open only while expanded
 *       div[data-disclosure-row]          the header text line
 *         span.leading, span.root > span.content > (span.title, span.separator, span.summary)
 *       div.thinkBody                     the expanded content, INSIDE the disclosure block
 *         p > text
 *
 * Three states decide whether the plugin works, and every one of them was broken
 * before: streaming-while-collapsed (the chips must not land in the hidden status
 * span), settled-and-expanded (the body must still be found without ever having
 * been seen streaming), and streaming-while-expanded (the marks must not go into
 * the hidden span).
 *
 *   node host-shape.mjs
 */
import { existsSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const bundle = readFileSync(join(root, 'client.js'), 'utf8')

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })

/* ────────────────────────────── stub host ─────────────────────────────── */

class StubText {
  constructor(value) {
    this.nodeType = 3
    this.nodeValue = value
    this.parentNode = null
    this.isConnected = true
  }
  remove() {
    if (this.parentNode) {
      const at = this.parentNode.childNodes.indexOf(this)
      if (at >= 0) this.parentNode.childNodes.splice(at, 1)
      this.parentNode = null
    }
    this.isConnected = false
  }
}

class StubElement {
  constructor(tag) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.childNodes = []
    this.attributes = {}
    this.style = {}
    this.parentNode = null
    this.isConnected = true
  }
  get text() {
    let out = ''
    for (const child of this.childNodes) out += child.nodeType === 3 ? child.nodeValue : child.text
    return out
  }
  get textContent() {
    return this.text
  }
  set textContent(value) {
    for (const child of [...this.childNodes]) {
      child.parentNode = null
      child.isConnected = false
    }
    this.childNodes = []
    this.appendChild(new StubText(String(value)))
  }
  set className(value) {
    this.attributes.class = String(value)
  }
  get className() {
    return this.attributes.class ?? ''
  }
  get classList() {
    const element = this
    const read = () => String(element.attributes.class ?? '').split(/\s+/).filter(Boolean)
    const write = (list) => {
      element.attributes.class = list.join(' ')
    }
    return {
      add(...names) {
        const list = read()
        for (const name of names) if (!list.includes(name)) list.push(name)
        write(list)
      },
      remove(...names) {
        write(read().filter((name) => !names.includes(name)))
      },
      contains(name) {
        return read().includes(name)
      },
    }
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }
  getAttribute(name) {
    return this.attributes[name] ?? null
  }
  hasAttribute(name) {
    return this.attributes[name] !== undefined
  }
  removeAttribute(name) {
    delete this.attributes[name]
  }
  get children() {
    return this.childNodes.filter((child) => child.nodeType === 1)
  }
  get firstElementChild() {
    return this.childNodes.find((child) => child.nodeType === 1) ?? null
  }
  get nextElementSibling() {
    if (!this.parentNode) return null
    const siblings = this.parentNode.childNodes
    for (let i = siblings.indexOf(this) + 1; i < siblings.length; i += 1) if (siblings[i].nodeType === 1) return siblings[i]
    return null
  }
  get parentElement() {
    return this.parentNode !== null && this.parentNode.nodeType === 1 ? this.parentNode : null
  }
  get childElementCount() {
    return this.children.length
  }
  addEventListener() {}
  appendChild(node) {
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }
  insertBefore(node, before) {
    node.parentNode = this
    const at = this.childNodes.indexOf(before)
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, node)
    return node
  }
  removeChild(node) {
    const at = this.childNodes.indexOf(node)
    if (at >= 0) this.childNodes.splice(at, 1)
    node.parentNode = null
    return node
  }
  matches(selector) {
    if (selector === '[data-variant="think"]') return this.attributes['data-variant'] === 'think'
    if (selector.startsWith('.')) return String(this.attributes.class ?? '').split(' ').includes(selector.slice(1))
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const body = selector.slice(1, -1)
      const [name, raw] = body.split('=')
      if (raw === undefined) return this.hasAttribute(name)
      return this.attributes[name] === raw.replaceAll('"', '')
    }
    if (selector.startsWith('div[') && selector.endsWith(']')) {
      return this.tagName === 'DIV' && this.hasAttribute(selector.slice(4, -1))
    }
    return false
  }
  querySelectorAll(selector) {
    const out = []
    const walk = (element) => {
      for (const child of element.childNodes) {
        if (child.nodeType !== 1) continue
        if (child.matches(selector)) out.push(child)
        walk(child)
      }
    }
    walk(this)
    return out
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null
  }
  closest(selector) {
    let node = this
    while (node) {
      if (node.nodeType === 1 && node.matches(selector)) return node
      node = node.parentNode
    }
    return null
  }
  contains(other) {
    let node = other
    while (node) {
      if (node === this) return true
      node = node.parentNode
    }
    return false
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this)
    this.isConnected = false
  }
}

const BODY_TEXT = '先看提示词，但不要急。提示词再确认一次，但结论不变。'
const STORED = {
  lang: 'zh',
  enabled: true,
  caseSensitive: false,
  chipsWhenCollapsed: true,
  liftOnExpand: false,
  muted: [],
  rows: [{ id: 'a', text: '提示词', color: '#dc2626', whole: false }],
}

function boot() {
  const body = new StubElement('body')
  const store = new Map([['dsh-thinking-highlight.state.v1', JSON.stringify(STORED)]])
  globalThis.document = {
    body,
    head: new StubElement('head'),
    documentElement: new StubElement('html'),
    createElement: (tag) => new StubElement(tag),
    createTextNode: (value) => new StubText(value),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
  }
  const timers = []
  globalThis.window = {
    __ModuleLoader__: { load: (registration) => (globalThis.__reg = registration) },
    styles: { insert: () => () => {} },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
    getComputedStyle: () => ({ overflowY: 'visible', maxHeight: 'none' }),
    setTimeout: (fn) => {
      timers.push(fn)
      return timers.length
    },
    clearTimeout: () => {},
  }
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  const React = {
    Fragment: Symbol('f'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useEffect() {},
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    memo: (component) => component,
  }
  new Function('window', 'document', bundle)(globalThis.window, globalThis.document)
  const plugin = globalThis.__reg.factory((specifier) => {
    if (specifier === 'react') return React
    if (specifier === 'react-dom/client') return { createRoot: () => ({ render() {}, unmount() {} }) }
    throw new Error('unexpected ' + specifier)
  })
  const slots = {
    register: () => () => {},
    inject: (_name, callback) => {
      callback()
      return () => {}
    },
  }
  const ctx = {
    slots,
    get: (name) => (name === 'slots' ? slots : undefined),
    on: () => () => {},
    provide: () => () => {},
    effect: (callback) => {
      callback()
      return () => {}
    },
  }
  plugin.apply(ctx)
  const drain = () => {
    while (timers.length > 0) timers.shift()()
  }
  drain()
  return { body, runtime: globalThis.window.__DSH_TH__, drain }
}

/** Build one row exactly the way the installed ReasoningRow renders it. */
function buildRow(body, { running = false, expanded = false, text = BODY_TEXT } = {}) {
  const doc = globalThis.document
  const row = doc.createElement('div')
  row.setAttribute('data-variant', 'think')
  row.setAttribute('data-state', running ? 'running' : 'ok')
  if (expanded) row.setAttribute('data-expanded', '')
  if (running) {
    const status = doc.createElement('span')
    status.className = 'xD_KDq_visuallyHidden'
    status.textContent = '正在思考'
    row.appendChild(status)
  }
  const disclosure = doc.createElement('div')
  if (expanded) disclosure.setAttribute('data-open', '')
  const line = doc.createElement('div')
  line.setAttribute('data-disclosure-row', '')
  const leading = doc.createElement('span')
  leading.textContent = '◇'
  const contentRoot = doc.createElement('span')
  const contentLine = doc.createElement('span')
  const title = doc.createElement('span')
  title.textContent = '思考'
  const separator = doc.createElement('span')
  separator.textContent = '·'
  const summary = doc.createElement('span')
  summary.textContent = '先看提示词，但不要急'
  contentLine.appendChild(title)
  contentLine.appendChild(separator)
  contentLine.appendChild(summary)
  contentRoot.appendChild(contentLine)
  line.appendChild(leading)
  line.appendChild(contentRoot)
  disclosure.appendChild(line)
  let thinkBody = null
  let hostText = null
  if (expanded) {
    thinkBody = doc.createElement('div')
    thinkBody.className = 'thinkBody'
    const paragraph = doc.createElement('p')
    hostText = doc.createTextNode(BODY_TEXT)
    paragraph.appendChild(hostText)
    thinkBody.appendChild(paragraph)
    disclosure.appendChild(thinkBody)
  }
  row.appendChild(disclosure)
  /*
   * React hangs the fiber on every element it created; the row component's own
   * `text` prop is the whole chain of thought, folded or not, and that is what the
   * counts use. The stub hangs one on the row so the folded path is the one under
   * test rather than the DOM-text fallback.
   */
  if (text !== null) {
    row['__reactFiber$hostshapetest'] = { memoizedProps: { text }, return: null }
  }
  body.appendChild(row)
  return { row, disclosure, line, summary, thinkBody, hostText }
}

const mounts = (element) => element.querySelectorAll('[data-dsh-th="badges"]')
const hits = (element) => element.querySelectorAll('[data-dsh-th="hit"]')

/* ───────────────────────── 1. streaming, collapsed ────────────────────── */
{
  const host = boot()
  const row = buildRow(host.body, { running: true, expanded: false })
  host.runtime.pass()
  const mount = mounts(row.row)[0]
  check(
    'a streaming row still shows its chip set on the header line',
    mount !== undefined && mount.closest('.xD_KDq_visuallyHidden') === null,
    mount === undefined ? 'no chip set' : 'mounted in ' + (mount.parentNode.className || mount.parentNode.tagName),
  )
  check(
    'the chip set is not parked inside the visually hidden status label',
    mount !== undefined && mount.closest('.xD_KDq_visuallyHidden') === null,
    mount === undefined ? 'no chip set' : String(mount.closest('.xD_KDq_visuallyHidden') !== null),
  )
  check('a streaming row reports its keyword count', host.runtime.rows()[0]?.count === 2, JSON.stringify(host.runtime.rows()))
  check('and it counted the folded reasoning, not the preview line', host.runtime.rows()[0]?.folded === true, JSON.stringify(host.runtime.rows()))
}

/* ───────────────── 2. settled and expanded, never streamed ────────────── */
{
  const host = boot()
  const row = buildRow(host.body, { running: false, expanded: true })
  host.runtime.pass()
  check(
    'an already settled row gets a body stamp where the host renders the body',
    row.thinkBody.classList.contains('dsh-th-body'),
    row.thinkBody.className,
  )
  check('its chain of thought is highlighted', hits(row.thinkBody).length === 2, String(hits(row.thinkBody).length) + ' hits')
  check(
    'the header line and its preview are left alone',
    hits(row.line).length === 0,
    String(hits(row.line).length) + ' hits in the header',
  )
  check(
    'expanding a settled row still counts the whole chain of thought',
    host.runtime.rows()[0]?.count === 2,
    JSON.stringify(host.runtime.rows()),
  )
}

/* ──────────────────── 3. streaming while already expanded ─────────────── */
{
  const host = boot()
  const row = buildRow(host.body, { running: true, expanded: true })
  host.runtime.pass()
  check('marks never land on the hidden status label', hits(row.row.firstElementChild).length === 0, String(hits(row.row.firstElementChild).length))
  check('marks land in the chain of thought', hits(row.thinkBody).length === 2, String(hits(row.thinkBody).length))
  check('the stamp is on the body the host rendered', row.thinkBody.classList.contains('dsh-th-body'), row.thinkBody.className)
}

/* ──────────── 4. the live path: stream collapsed, then expand ─────────── */
{
  const host = boot()
  const row = buildRow(host.body, { running: true, expanded: false })
  host.runtime.pass()
  /* the block finishes; the reader opens the row */
  row.row.childNodes[0].remove()
  row.row.setAttribute('data-expanded', '')
  row.disclosure.setAttribute('data-open', '')
  const thinkBody = globalThis.document.createElement('div')
  thinkBody.className = 'thinkBody'
  const paragraph = globalThis.document.createElement('p')
  row.hostText = globalThis.document.createTextNode(BODY_TEXT)
  paragraph.appendChild(row.hostText)
  thinkBody.appendChild(paragraph)
  row.disclosure.appendChild(thinkBody)
  host.runtime.pass()
  check('a row that streamed collapsed is highlighted once opened', hits(thinkBody).length === 2, String(hits(thinkBody).length))
  check('the same body carries the stamp', thinkBody.classList.contains('dsh-th-body'), thinkBody.className)
}

/* ─────────────────── 5. unload leaves no trace on the host ────────────── */
{
  const body = new StubElement('body')
  const store = new Map([['dsh-thinking-highlight.state.v1', JSON.stringify(STORED)]])
  globalThis.document = {
    body,
    head: new StubElement('head'),
    documentElement: new StubElement('html'),
    createElement: (tag) => new StubElement(tag),
    createTextNode: (value) => new StubText(value),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    querySelector: (selector) => body.querySelector(selector),
  }
  const disposers = []
  globalThis.window = {
    __ModuleLoader__: { load: (registration) => (globalThis.__reg = registration) },
    styles: { insert: () => () => {} },
    localStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, String(value)),
    },
    getComputedStyle: () => ({ overflowY: 'visible', maxHeight: 'none' }),
    setTimeout: () => 0,
    clearTimeout: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  const React = {
    Fragment: Symbol('f'),
    createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }),
    useState: (initial) => [initial, () => {}],
    useRef: (initial) => ({ current: initial }),
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useEffect() {},
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    memo: (component) => component,
  }
  new Function('window', 'document', bundle)(globalThis.window, globalThis.document)
  const plugin = globalThis.__reg.factory((specifier) => {
    if (specifier === 'react') return React
    if (specifier === 'react-dom/client') return { createRoot: () => ({ render() {}, unmount() {} }) }
    throw new Error('unexpected ' + specifier)
  })
  const slots = {
    register: () => () => {},
    inject: (_name, callback) => {
      callback()
      return () => {}
    },
  }
  plugin.apply({
    slots,
    get: (name) => (name === 'slots' ? slots : undefined),
    on: () => () => {},
    provide: () => () => {},
    effect: (callback) => {
      const disposer = callback()
      disposers.push(disposer)
      return () => {}
    },
  })
  const row = buildRow(body, { running: false, expanded: true })
  globalThis.window.__DSH_TH__.pass()
  const stampedBefore = row.thinkBody.classList.contains('dsh-th-body')
  for (const disposer of disposers) if (typeof disposer === 'function') disposer()
  check('the row was stamped before unload', stampedBefore, String(stampedBefore))
  check(
    'unload removes the plugin class from the host body',
    row.thinkBody.classList.contains('dsh-th-body') === false,
    row.thinkBody.className,
  )
  check('unload removes the chip set', mounts(row.row).length === 0, String(mounts(row.row).length))
  check('unload removes the highlight marks', hits(row.thinkBody).length === 0, String(hits(row.thinkBody).length))
  check('unload restores the text', row.thinkBody.text === BODY_TEXT, JSON.stringify(row.thinkBody.text))
}

/* ─────────── 6. the installed build still renders what we model ────────── */
{
  const candidates = [
    'C:/Users/Yokira/AppData/Local/Programs/DeepSeek Harness/resources/app.asar',
    join(root, '..', '..', 'resources', 'app.asar'),
  ]
  const archive = candidates.find((path) => existsSync(path))
  if (archive === undefined) {
    console.log('SKIP  the DSH app.asar was not found, so the installed markers were not checked')
  } else {
    const fd = openSync(archive, 'r')
    try {
      const head = Buffer.alloc(16)
      readSync(fd, head, 0, 16, 0)
      const headerSize = head.readUInt32LE(12)
      const headerBuf = Buffer.alloc(headerSize)
      readSync(fd, headerBuf, 0, headerSize, 16)
      const header = JSON.parse(headerBuf.toString('utf8'))
      const baseOffset = 16 + headerSize
      const collect = (node, prefix, out) => {
        for (const [name, entry] of Object.entries(node.files ?? {})) {
          const path = prefix ? prefix + '/' + name : name
          if (entry.files) collect(entry, path, out)
          else out.push({ path, size: entry.size ?? 0, offset: entry.offset ? Number(entry.offset) : 0 })
        }
        return out
      }
      const wanted = ['dsh-client-ui-chat/lib/client.js', 'dsh-client-ui-primitives/lib/index.js']
      const entries = collect(header, '', []).filter((entry) => wanted.some((needle) => entry.path.endsWith(needle)))
      check('the installed host bundles were found', entries.length === wanted.length, String(entries.length) + '/' + String(wanted.length))
      for (const entry of entries) {
        const buf = Buffer.alloc(Math.min(entry.size, 700000))
        readSync(fd, buf, 0, buf.length, baseOffset + entry.offset)
        const text = buf.toString('utf8')
        const isChat = entry.path.endsWith('ui-chat/lib/client.js')
        const needles = isChat
          ? ['"data-variant": "think"', 'data-expanded', 'data-turn-process-inline']
          : ['"data-disclosure-row": true', '"data-open": open || void 0', 'open && children']
        for (const needle of needles) {
          check(
            'the installed build still contains ' + JSON.stringify(needle),
            text.includes(needle),
            entry.path + (text.includes(needle) ? '' : ' — the host markup this plugin addresses may have changed'),
          )
        }
      }
    } finally {
      closeSync(fd)
    }
  }
}

let failed = 0
for (const result of checks) {
  if (!result.pass) failed += 1
  console.log((result.pass ? 'PASS  ' : 'FAIL  ') + result.name + (result.pass ? '' : '  (' + result.detail + ')'))
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
