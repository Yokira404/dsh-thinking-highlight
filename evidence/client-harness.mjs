/**
 * Headless Client-half harness: run the shipped factory the way the browser
 * module system would, with stubs for the platform modules, and execute the
 * plugin's own `apply` plus every component it registers —?including a full
 * decoration pass against a stub DOM.
 *
 * This is what catches a client-half activation failure without a browser:
 * anything that throws out of `factory()` or `apply()` fails this script.
 *
 *   node client-harness.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const bundle = readFileSync(join(here, '..', 'client.js'), 'utf8')

/* - platform-module stubs - */

/**
 * Hook cells: a component that renders again must see the state it set, or a draft
 * that commits on blur could never be tested. One cursor per render pass, reset when
 * the page is rendered (see `renderPage`), which is what a mounted component sees.
 */
let hookCursor = 0
const hookCells = []

/** Minimal React: createElement, hooks, and the memo/Fragment surface used. */
const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    if (type === undefined) throw new Error('createElement: type is undefined')
    if (typeof type === 'string' && type.length === 0) throw new Error('createElement: empty tag')
    return { type, props: props ?? {}, children }
  },
  useState(initial) {
    const at = hookCursor
    hookCursor += 1
    if (hookCells.length <= at || hookCells[at] === undefined) {
      hookCells[at] = typeof initial === 'function' ? initial() : initial
    }
    return [hookCells[at], (next) => {
      hookCells[at] = typeof next === 'function' ? next(hookCells[at]) : next
    }]
  },
  useRef(initial) {
    return { current: initial }
  },
  useMemo(factory) {
    return factory()
  },
  useCallback(fn) {
    return fn
  },
  useEffect() {},
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
  memo(component) {
    return component
  },
}

const roots = []
/** Every element tree handed to a plugin-owned root, so props can be inspected. */
const renderCalls = []
const ReactDOMClient = {
  createRoot(container) {
    const root = {
      container,
      render(element) {
        renderCalls.push({ container, element })
        // Walk the element tree so every component function the plugin renders
        // actually executes, exactly as React would on mount.
        const visited = new Set()
        const walk = (node) => {
          if (node === null || node === undefined || typeof node === 'boolean') return
          if (Array.isArray(node)) {
            for (const child of node) walk(child)
            return
          }
          if (typeof node === 'string' || typeof node === 'number') return
          const { type, props } = node
          if (typeof type === 'function') {
            if (type.name === 'SettingsPanel' && visited.has('panel')) return
            if (type.name === 'SettingsPanel') visited.add('panel')
            walk(type(props))
            return
          }
          walk(props?.children)
        }
        walk(element)
      },
      unmount() {},
    }
    roots.push(root)
    return root
  },
}

const cssInserts = []
const slotsRegistrations = []
const effects = []
const listeners = new Map()

/*
 * Slot keys this harness declares, so `register` enforces the real contract:
 * the target slot travels in `options.name`, and registering into a slot that is
 * not declared throws. Omitting `name` once silently cost the whole settings row,
 * and a stub that accepts anything cannot catch that. `settings.general.item`
 * stays declared on purpose: the plugin must no longer register there.
 */
const declaredSlots = new Set(['settings.section', 'settings.general.item', 'settings.thinking-highlight.item', 'conversation.composer.dock'])

const slotsService = {
  register(options, component) {
    if (options === undefined || options === null || typeof options.name !== 'string') {
      throw new Error('slot "' + String(options?.name) + '" is not declared (a parent entry\'s children table must declare it)')
    }
    if (declaredSlots.has(options.name) === false) {
      throw new Error('slot "' + options.name + '" is not declared (a parent entry\'s children table must declare it)')
    }
    if (typeof options.id !== 'string' || options.id.length === 0) {
      throw new Error('slot "' + options.name + '" registration needs a string id')
    }
    slotsRegistrations.push({ slot: options.name, options, component, disposed: false })
    return () => {
      const entry = slotsRegistrations.find((item) => item.options === options)
      if (entry !== undefined) entry.disposed = true
    }
  },
  inject(key, callback) {
    if (declaredSlots.has(key) === false) {
      throw new Error('harness has not declared the injected slot: ' + key)
    }
    const disposer = callback()
    return typeof disposer === 'function' ? disposer : () => {}
  },
}

const ctx = {
  /* Cordis hands injected services to the plugin as ctx.<name>. */
  slots: slotsService,
  get(name) {
    return name === 'slots' ? slotsService : undefined
  },
  on(name, listener) {
    listeners.set(name, listener)
    return () => listeners.delete(name)
  },
  provide() {
    return () => {}
  },
  effect(callback, label) {
    const disposer = callback()
    effects.push({ label, disposer })
    return () => {
      if (typeof disposer === 'function') disposer()
    }
  },
}

const platformModules = {
  react: React,
  'react-dom/client': ReactDOMClient,
}

/* - browser stubs - */

let pending = null
const timeouts = []
const observers = []
const storage = new Map()
const windowListeners = []

globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      pending = registration
    },
  },
  styles: {
    insert(css) {
      cssInserts.push(css)
      return () => {}
    },
  },
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, value),
  },
  setTimeout: (fn, delay) => {
    timeouts.push({ fn, delay })
    return timeouts.length
  },
  clearTimeout: () => {},
  /* Only the two computed properties the cap lookup reads; a fixture declares its
     own `computedStyle` to stand in for a folded process-group body. The host's own
     `--dsh-content-font-delta` is published on `body` as
     `calc(var(--dsh-content-font-size,14px) - 14px)`, so at the default reader body
     size it resolves to `0px` — which is what a real `getComputedStyle` would answer. */
  getComputedStyle: (node) => ({
    overflowY: node?.computedStyle?.overflowY ?? 'visible',
    maxHeight: node?.computedStyle?.maxHeight ?? 'none',
    getPropertyValue: (name) => (name === '--dsh-content-font-delta' ? (node?.fontDelta ?? '0px') : ''),
  }),
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  /* Enough of the listener API for the plugin's cross-document settings sync. */
  addEventListener(name, listener) {
    windowListeners.push({ name, listener })
  },
  removeEventListener(name, listener) {
    const at = windowListeners.findIndex((entry) => entry.name === name && entry.listener === listener)
    if (at >= 0) windowListeners.splice(at, 1)
  },
  innerWidth: 1440,
  innerHeight: 900,
}

class StubText {
  constructor(value) {
    this.nodeType = 3
    this.nodeValue = value
    this.parentNode = null
    this.isConnected = true
  }
  remove() {
    if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1)
    this.isConnected = false
  }
}
/**
 * The one piece of `CSSStyleDeclaration` the plugin relies on. `removeProperty`
 * takes the dashed name and the plugin reads the camel-cased one, exactly as the
 * real declaration reflects the same property under both spellings.
 */
class StubStyle {
  removeProperty(name) {
    const camel = String(name).replace(/-([a-z])/gu, (_, letter) => letter.toUpperCase())
    delete this[name]
    delete this[camel]
  }
}
class StubElement {
  constructor(tag) {
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.childNodes = []
    this.attributes = {}
    this.style = new StubStyle()
    this.parentNode = null
    this.isConnected = true
    this.listeners = {}
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
    this.childNodes = []
    this.appendChild(new StubText(String(value)))
  }
  set className(value) {
    this.attributes.class = String(value)
  }
  get className() {
    return this.attributes.class ?? ''
  }
  /** Real DOM semantics: add/remove/contains over the space-separated class attribute. */
  get classList() {
    const element = this
    const read = () => String(element.attributes.class ?? '').split(/\s+/).filter(Boolean)
    return {
      add(...names) {
        const list = read()
        for (const name of names) if (!list.includes(name)) list.push(name)
        element.attributes.class = list.join(' ')
      },
      remove(...names) {
        element.attributes.class = read().filter((name) => !names.includes(name)).join(' ')
      },
      contains(name) {
        return read().includes(name)
      },
    }
  }
  get firstElementChild() {
    return this.childNodes.find((node) => node.nodeType === 1) ?? null
  }
  /** Element children only, as the platform collection the plugin indexes into. */
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1)
  }
  get nextElementSibling() {
    if (this.parentNode === null) return null
    const siblings = this.parentNode.childNodes
    for (let i = siblings.indexOf(this) + 1; i < siblings.length; i += 1) {
      if (siblings[i].nodeType === 1) return siblings[i]
    }
    return null
  }
  get parentElement() {
    return this.parentNode !== null && this.parentNode.nodeType === 1 ? this.parentNode : null
  }
  contains(other) {
    let node = other
    while (node) {
      if (node === this) return true
      node = node.parentNode
    }
    return false
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }
  getAttribute(name) {
    return this.attributes[name] ?? null
  }
  removeAttribute(name) {
    delete this.attributes[name]
  }
  hasAttribute(name) {
    return this.attributes[name] !== undefined
  }
  addEventListener(name, listener) {
    this.listeners[name] = listener
  }
  appendChild(node) {
    node.parentNode = this
    node.isConnected = true
    this.childNodes.push(node)
    return node
  }
  insertBefore(node, before) {
    node.parentNode = this
    node.isConnected = true
    const at = this.childNodes.indexOf(before)
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, node)
    return node
  }
  removeChild(node) {
    const at = this.childNodes.indexOf(node)
    if (at >= 0) this.childNodes.splice(at, 1)
    node.parentNode = null
    node.isConnected = false
    return node
  }
  querySelectorAll(selector) {
    const out = []
    const match = (element) => {
      if (/^[a-z]+$/u.test(selector)) return element.tagName === selector.toUpperCase()
      if (selector === '[data-variant="think"]' && element.attributes['data-variant'] === 'think') return true
      if (selector === 'div[data-open]' && element.tagName === 'DIV' && element.hasAttribute('data-open')) return true
      if (selector.startsWith('.') && String(element.attributes.class ?? '').split(' ').includes(selector.slice(1))) return true
      if (selector.startsWith('[') && selector.endsWith(']')) {
        const body = selector.slice(1, -1)
        const [name, rawValue] = body.split('=')
        if (rawValue === undefined) return element.hasAttribute(name)
        return element.attributes[name] === rawValue.replaceAll('"', '')
      }
      return false
    }
    const walk = (element) => {
      for (const child of element.childNodes) {
        if (child.nodeType !== 1) continue
        if (match(child)) out.push(child)
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
      if (node.nodeType === 1 && node.matches?.(selector)) return node
      node = node.parentNode
    }
    return null
  }
  matches(selector) {
    if (selector === '[data-variant="think"]') return this.attributes['data-variant'] === 'think'
    return false
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this)
    this.isConnected = false
  }
  click() {
    const listener = this.listeners.click
    if (listener) listener({ preventDefault() {}, stopPropagation() {}, currentTarget: this, target: this })
  }
}

const body = new StubElement('body')
globalThis.document = {
  body,
  head: new StubElement('head'),
  documentElement: new StubElement('html'),
  createElement: (tag) => new StubElement(tag),
  createTextNode: (value) => new StubText(value),
  querySelectorAll: (selector) => body.querySelectorAll(selector),
  querySelector: (selector) => body.querySelector(selector),
  addEventListener() {},
}
globalThis.MutationObserver = class {
  constructor(callback) {
    this.callback = callback
    observers.push(this)
  }
  observe() {}
  disconnect() {}
}
globalThis.console = console

/* - the check itself - */

const results = []
const check = (name, pass, detail) => results.push({ name, pass: Boolean(pass), detail })

// 1. The bundle registers exactly one factory under the plugin's own id.
new Function('window', bundle)(globalThis.window)
check('bundle registers a factory', pending !== null && typeof pending.factory === 'function', pending === null ? 'no registration' : String(pending.id))
check('registration id is the package name', pending?.id === '@Yokira404/dsh-thinking-highlight', String(pending?.id))

/*
 * Negative control: the stub must reject a registration that omits the target
 * slot, because that is the defect that once cost this plugin its settings row
 * while every other check still passed. If this check ever passes the wrong way,
 * the harness has stopped being able to catch that bug.
 */
{
  let threw = null
  try {
    slotsService.register({ id: 'x', order: 1 }, () => null)
  } catch (error) {
    threw = String(error && error.message)
  }
  check('stub rejects a registration without a slot name', threw !== null && threw.includes('is not declared'), String(threw))
  let threwUnknown = null
  try {
    slotsService.register({ name: 'not.a.real.slot', id: 'x' }, () => null)
  } catch (error) {
    threwUnknown = String(error && error.message)
  }
  check('stub rejects an undeclared slot', threwUnknown !== null && threwUnknown.includes('is not declared'), String(threwUnknown))
}

// 2. The factory materializes with only the platform modules available.
let plugin = null
try {
  plugin = pending.factory((specifier) => {
    if (!(specifier in platformModules)) throw new Error('unexpected module request: ' + specifier)
    return platformModules[specifier]
  })
  check('factory materializes', true, 'ok')
} catch (error) {
  check('factory materializes', false, String(error && error.stack ? error.stack : error))
}

// 3. Its shape is a Cordis plugin the client system can apply.
check('exports inject + apply', plugin !== null && Array.isArray(plugin.inject) && typeof plugin.apply === 'function', plugin === null ? 'no exports' : JSON.stringify(Object.keys(plugin)))
check('declares the slots service', plugin?.inject?.includes('slots'), JSON.stringify(plugin?.inject))

// 4. apply() runs without throwing, and registers what the plugin promises.
if (plugin !== null) {
  try {
    plugin.apply(ctx)
    check('apply() runs', true, 'ok')
  } catch (error) {
    check('apply() runs', false, String(error && error.stack ? error.stack : error))
  }
}

const section = () => slotsRegistrations.filter((entry) => entry.slot === 'settings.section').at(-1)

check('registers its own settings section', section() !== undefined, JSON.stringify(slotsRegistrations.map((entry) => entry.options)))
check('registers nothing into the General settings list', slotsRegistrations.every((entry) => entry.slot !== 'settings.general.item'), JSON.stringify(slotsRegistrations.map((entry) => entry.slot)))
check('section id is the package namespace', section()?.options?.id === 'dsh-thinking-highlight', String(section()?.options?.id))
check('section declares its child list slot', section()?.options?.children?.['settings.thinking-highlight.item']?.kind === 'list', JSON.stringify(section()?.options?.children))
check('section label is a thunk, so the nav follows the plugin language', typeof section()?.options?.label === 'function' && section().options.label() === '标红插件', String(typeof section()?.options?.label) + ' -> ' + String(section()?.options?.label?.()))
check('inserts its stylesheet', cssInserts.some((css) => css.includes('.dsh-th-badge')), cssInserts.length + ' inserts')
check('installs a decoration effect', effects.some((entry) => String(entry.label).includes('decorate')), JSON.stringify(effects.map((entry) => entry.label)))

// 5. The settings page renders, and its controls work.
const page = section()
if (page !== undefined) {
  try {
    const element = page.component({ renderSlot: () => null })
    check('settings page renders', element !== null && element !== undefined, 'ok')
    check('page opens with its own heading and intro', element.type === 'div' && element.props?.className === 'dsh-th-section', String(element.props?.className))
    // Exercise the interactive leaves: language, switches, add, remove, color.
    const collect = (node, out = []) => {
      if (node === null || node === undefined) return out
      if (Array.isArray(node)) {
        for (const child of node) collect(child, out)
        return out
      }
      if (typeof node !== 'object') return out
      out.push(node)
      collect(node.children, out)
      collect(node.props?.children, out)
      return out
    }
    const nodes = collect(element)
    const clickable = nodes.filter((node) => typeof node.type === 'string' && node.type === 'button' && typeof node.props?.onClick === 'function')
    check('settings page exposes controls', clickable.length >= 4, clickable.length + ' buttons')
    for (const node of clickable) {
      try {
        node.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {} })
      } catch (error) {
        check('control click: ' + JSON.stringify(node.props?.['data-dsh-th'] ?? node.props?.className), false, String(error && error.message))
      }
    }
    const inputs = nodes.filter((node) => node.type === 'input' && typeof node.props?.onChange === 'function')
    for (const node of inputs) {
      try {
        node.props.onChange({ target: { value: node.props.type === 'color' ? '#00ff00' : '测试词' } })
      } catch (error) {
        check('input change: ' + String(node.props?.className), false, String(error && error.message))
      }
    }
    check('settings controls do not throw', true, clickable.length + ' buttons, ' + inputs.length + ' inputs driven')

    /*
     * Driving the language buttons flipped the plugin to English. The nav label is
     * resolved by the shell from the ledger, so the plugin must have republished
     * its section —?otherwise the sidebar keeps the old text forever.
     */
    const registrations = slotsRegistrations.filter((entry) => entry.slot === 'settings.section')
    const current = registrations.at(-1)
    check(
      'language flip republishes the section so the nav label follows',
      registrations.length >= 2 && typeof current?.options?.label === 'function' && current.options.label() === 'Thinking Highlighter',
      registrations.length + ' registrations, last label ' + String(current?.options?.label?.()),
    )
    check(
      'the superseded registration is disposed',
      registrations.slice(0, -1).every((entry) => entry.disposed === true),
      registrations.map((entry) => entry.disposed).join(','),
    )
  } catch (error) {
    check('settings page renders', false, String(error && error.stack ? error.stack : error))
  }
}

// 6. Decoration: build a fake reasoning row and run the reconciler through the timer.
/* The shipped row, as the plugin meets it while collapsed:
     [data-variant=think] > [data-open] > [data-disclosure-row]
       > (leading glyph, TextShimmer root > content line > title, separator, summary) */
const row = new StubElement('div')
row.setAttribute('data-variant', 'think')
/* Collapsed: the shipped row stamps neither `data-open` nor `data-expanded`. */
const header = new StubElement('div')
const line = new StubElement('div')
line.setAttribute('data-disclosure-row', '')
const leading = new StubElement('span')
line.appendChild(leading)
const contentRoot = new StubElement('span')
const contentLine = new StubElement('span')
const title = new StubElement('span')
title.textContent = '已完成思考'
const separator = new StubElement('span')
separator.setAttribute('aria-hidden', 'true')
const summary = new StubElement('span')
summary.textContent = '先看提示词，但不要急'
contentLine.appendChild(title)
contentLine.appendChild(separator)
contentLine.appendChild(summary)
contentRoot.appendChild(contentLine)
line.appendChild(contentRoot)
header.appendChild(line)
row.appendChild(header)
const bodyWrap = new StubElement('div')
const thinkBody = new StubElement('div')
thinkBody.appendChild(new StubText('先看提示词，但不要急。提示词再确认一次。'))
/* A seat of our own inside the body: nothing in it may ever be highlighted. */
const ownSeat = new StubElement('span')
ownSeat.setAttribute('data-dsh-th', 'own-seat')
const ownSeatText = new StubElement('span')
ownSeatText.textContent = '但'
ownSeat.appendChild(ownSeatText)
thinkBody.appendChild(ownSeat)
bodyWrap.appendChild(thinkBody)
row.appendChild(bodyWrap)
/*
 * The folded process-group box DSH wraps a turn's process in: it scrolls its own
 * overflow and carries the height cap that was clipping an expanded body.
 */
const groupBox = new StubElement('div')
groupBox.setAttribute('data-stub', 'group-body')
groupBox.computedStyle = { overflowY: 'auto', maxHeight: '400px' }
groupBox.clientHeight = 400
groupBox.scrollHeight = 1200
groupBox.appendChild(row)
body.appendChild(groupBox)

/* The shipped row renders the chain-of-thought directly under the row root, so
   reach the body both ways: the decorated node is what the reconciler marks. */
const decoratedBody = thinkBody

// The decoration effect scheduled a timeout through window.setTimeout; run it.
let ran = false
for (const entry of timeouts.splice(0)) {
  try {
    entry.fn()
    ran = true
  } catch (error) {
    check('decoration pass runs', false, String(error && error.stack ? error.stack : error))
  }
}
check('decoration pass runs', ran, timeouts.length + ' pending timers')

const badgeSet = row.querySelectorAll('[data-dsh-th="badges"]')[0]
check('badge container is mounted in the row', badgeSet !== undefined && badgeSet !== null, badgeSet === null || badgeSet === undefined ? 'not found' : 'found')
check('chip set sits on the header text line, not under it', badgeSet?.parentNode === contentLine, String(badgeSet?.parentNode === contentLine))
check('chip set sits after the title separator', badgeSet?.parentNode?.childNodes?.indexOf?.(separator) < badgeSet?.parentNode?.childNodes?.indexOf?.(badgeSet), 'order ' + String(badgeSet?.parentNode?.childNodes?.map?.((c) => c.attributes?.['data-dsh-th'] ?? c.textContent ?? c.tagName)?.join('|')))
check('chip set sits before the collapsed preview', badgeSet?.nextElementSibling === summary, String(badgeSet?.nextElementSibling === summary))
check('the chip set never lands in the header block itself', header.childNodes.includes(badgeSet) === false && line.contains(badgeSet) === true, 'header children ' + header.childNodes.length)
const highlights = row.querySelectorAll('[data-dsh-th="hit"]')
check('keywords are highlighted', highlights.length === 3, highlights.length + ' hits')
check('nothing inside our own chip set is highlighted', ownSeat.querySelectorAll('[data-dsh-th="hit"]').length === 0 && ownSeat.children[0]?.attributes?.['data-dsh-th'] === undefined, 'marked seat hits: ' + ownSeat.querySelectorAll('[data-dsh-th="hit"]').length)
check('row text is unchanged by highlighting', row.text === '已完成思考先看提示词，但不要急先看提示词，但不要急。提示词再确认一次。但', JSON.stringify(row.text))
check('body text is unchanged', decoratedBody.text === '先看提示词，但不要急。提示词再确认一次。但', JSON.stringify(decoratedBody.text))
check('the collapsed preview keeps its place after the chips', summary.parentNode === contentLine, String(summary.parentNode === contentLine))

/* The chip carries the keyword color on its frame, never on its text or fill. */
const findNode = (node, predicate) => {
  if (node === null || node === undefined || typeof node !== 'object') return undefined
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findNode(child, predicate)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (predicate(node)) return node
  return findNode(node.children, predicate) ?? findNode(node.props?.children, predicate)
}
const badgeTree = renderCalls.at(-1)?.element
const chipNode = findNode(badgeTree, (node) => node.props?.className === 'dsh-th-badge')
const chipNameNode = findNode(badgeTree, (node) => node.props?.className === 'dsh-th-badge-name')
const chipGroup = findNode(badgeTree, (node) => node.props?.className === 'dsh-th-chips')
check('chip frame is the keyword colour', typeof chipNode?.props?.style?.borderColor === 'string' && chipNode.props.style.borderColor.length > 0, JSON.stringify(chipNode?.props?.style))
/*
 * The chip name previews the keyword's own type styling — its size and ink included —
 * while the chip's *frame* stays the only place the background colour appears. That
 * separation is what keeps a name from ever being painted the same colour as the chip
 * behind it.
 */
check(
  'chip text previews the keyword style, not the keyword background',
  chipNameNode !== undefined && chipNameNode.props?.style?.color === 'currentColor' && chipNameNode.props?.style?.fontSize === '14px' && chipNameNode.props?.style?.backgroundColor === undefined,
  JSON.stringify(chipNameNode?.props?.style),
)
check(
  'a default-sized chip carries the neutral scale of 1',
  chipNode?.props?.style?.['--dsh-th-chip-scale'] === '1',
  JSON.stringify(chipNode?.props?.style?.['--dsh-th-chip-scale']),
)
/*
 * The chip also carries the tallest it may draw, computed from the host's own
 * `--dsh-content-font-delta`: a collapsed row's header line is a fixed height with
 * `contain: size layout`, so this is what stops the largest keyword's chip from being
 * clipped by the line it sits on.
 */
check(
  'a chip carries the header-line cap it may not outgrow',
  chipNode?.props?.style?.['--dsh-th-chip-line'] === 'calc(21px + 0px)',
  JSON.stringify(chipNode?.props?.style?.['--dsh-th-chip-line']),
)
check('the eye stays outside the clipping chip group', findNode(badgeTree, (node) => node.props?.['data-dsh-th-eye'] === '1') !== undefined && chipGroup !== undefined, 'chips group ' + String(chipGroup !== undefined))

// 7. Collapsed rows honour the new switch: hide the chip set, then show it again.
if (runtime0() !== undefined) {
  const countWhenCollapsed = runtime0().rows()[0]?.count
  const storage = globalThis.window.localStorage
  const current = JSON.parse(storage.getItem('dsh-thinking-highlight.state.v1') ?? '{}')
  storage.setItem('dsh-thinking-highlight.state.v1', JSON.stringify({ ...current, chipsWhenCollapsed: false }))
  runtime0().refresh()
  runTimers()
  check('the row counts its own keywords', countWhenCollapsed === 6, 'count ' + String(countWhenCollapsed))
  check('collapsed row hides its chips when the switch is off', row.querySelectorAll('[data-dsh-th="badges"]').length === 0, 'badge sets: ' + row.querySelectorAll('[data-dsh-th="badges"]').length)

  /* Expanded: the switch only governs the collapsed state. */
  row.setAttribute('data-expanded', '')
  header.setAttribute('data-open', '')
  const reWrap = new StubElement('div')
  const expandedBody = new StubElement('div')
  expandedBody.appendChild(new StubText('先看提示词，但'))
  reWrap.appendChild(expandedBody)
  header.appendChild(reWrap)
  runtime0().refresh()
  runTimers()
  check('expanded row shows its chips again', row.querySelectorAll('[data-dsh-th="badges"]').length === 1, 'badge sets: ' + row.querySelectorAll('[data-dsh-th="badges"]').length)
}

function runtime0() {
  return globalThis.window.__DSH_TH__
}
/** The settings exactly as the page persists them. */
function storedState() {
  return JSON.parse(globalThis.window.localStorage.getItem('dsh-thinking-highlight.state.v1') ?? '{}')
}
/** Detach every child of a stub element the way the host's re-render detaches it. */
function detachChildren(element) {
  for (const node of element.childNodes) {
    node.parentNode = null
    node.isConnected = false
  }
  element.childNodes = []
}
function runTimers() {
  for (const entry of timeouts.splice(0)) entry.fn()
}
/** Write the stored settings the way the settings page does, then re-read them. */
function storeSettings(changes) {
  const storage = globalThis.window.localStorage
  const current = JSON.parse(storage.getItem('dsh-thinking-highlight.state.v1') ?? '{}')
  storage.setItem('dsh-thinking-highlight.state.v1', JSON.stringify({ ...current, ...changes }))
  runtime0().refresh()
  runTimers()
}
/**
 * Drive the live settings page: a patch republishes the snapshot, and that alone
 * schedules a pass —?the reconciler runs with its caches intact, exactly as it does
 * when the reader flips a switch in the app.
 */
/**
 * The settings page's rendered element tree. `expand` also runs the hook-free leaf
 * components (`Switch`, `KeywordRow`, the icons) the way React would, which is what
 * puts their controls —?the per-keyword mute button, the switches —?in reach; the
 * page's own literal buttons are in the tree either way.
 */
function pageNodes(expand = false) {
  hookCursor = 0
  const tree = section().component({ renderSlot: () => null })
  const nodes = []
  const collect = (node) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) {
      for (const child of node) collect(child)
      return
    }
    if (typeof node !== 'object') return
    if (expand === true && typeof node.type === 'function') {
      /*
       * React hands a component its children through props; the stub keeps them on the
       * element, so put them back where the component looks for them.
       */
      const children = node.children ?? []
      collect(node.type({ ...(node.props ?? {}), children: children.length > 1 ? children : children[0] }))
      return
    }
    nodes.push(node)
    collect(node.children)
    collect(node.props?.children)
  }
  collect(tree)
  return nodes
}

function clickSettings(marker) {
  const target = pageNodes(true).find((node) => node.props?.['data-dsh-th'] === marker)
  if (target === undefined) throw new Error('no settings control marked ' + marker)
  target.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {} })
  runTimers()
}

/** The chip elements the plugin last rendered into one row's badge container. */
function chipsFor(row) {
  const container = row.querySelector('[data-dsh-th="badges"]')
  const tree = renderCalls.filter((call) => call.container === container).at(-1)?.element
  const out = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node.props?.className === 'dsh-th-badge') out.push(node)
    walk(node.children)
    walk(node.props?.children)
  }
  walk(tree)
  return out
}

if (runtime0() !== undefined) {
  try {
  // 8. Our own chips must never feed back into the counts.
  const chipCounts = () => {
    const out = []
    const walk = (node) => {
      if (node === null || node === undefined || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const child of node) walk(child)
        return
      }
      if (node.props?.className === 'dsh-th-badge') out.push(node.props['data-count'])
      walk(node.children)
      walk(node.props?.children)
    }
    walk(renderCalls.at(-1)?.element)
    return out.join(',')
  }
  const stableCount = runtime0().rows()[0]?.count
  const stableChips = chipCounts()
  const passesBefore = runtime0().passes()
  for (let i = 0; i < 3; i += 1) runtime0().pass()
  check('the pass seam runs the observer pass', runtime0().passes() === passesBefore + 3, 'passes ' + String(passesBefore) + ' -> ' + String(runtime0().passes()))
  check(
    'our own chips never feed back into the counts',
    runtime0().rows()[0]?.count === stableCount,
    'count ' + String(stableCount) + ' -> ' + String(runtime0().rows()[0]?.count),
  )
  check('chip counts stay put across passes', chipCounts() === stableChips, JSON.stringify(stableChips) + ' -> ' + JSON.stringify(chipCounts()))
  check('the chips do not collapse once the body is wrapped', chipCounts() !== '' && runtime0().rows()[0]?.count === stableCount, 'chips ' + JSON.stringify(chipCounts()) + ', count ' + String(runtime0().rows()[0]?.count))

  // 9. An open row asks for room: the folded box loses the cap that clipped it.
  storeSettings({ liftOnExpand: true, chipsWhenCollapsed: false })
  check('an open row uncaps the folded box that clipped it', groupBox.style.maxHeight === 'none', JSON.stringify(groupBox.style))
  check('the plugin remembers the cap it lifted', runtime0().internals.lifts.get(groupBox) === '', JSON.stringify([...runtime0().internals.lifts.keys()].length))
  storeSettings({ liftOnExpand: false })
  check('turning the switch off puts the cap back', groupBox.style.maxHeight === undefined && runtime0().internals.lifts.size === 0, JSON.stringify(groupBox.style))
  storeSettings({ liftOnExpand: true })
  row.removeAttribute('data-expanded')
  header.removeAttribute('data-open')
  storeSettings({ liftOnExpand: true })
  check('collapsing the row puts the cap back', groupBox.style.maxHeight === undefined && runtime0().internals.lifts.size === 0, JSON.stringify(groupBox.style))
  row.setAttribute('data-expanded', '')
  header.setAttribute('data-open', '')
  storeSettings({ liftOnExpand: true })

  // 10. A host re-render that drops our marks is repaired, text unchanged.
  const hitsInBody = () => bodyWrap.querySelectorAll('[data-dsh-th="hit"]').length
  const bodyTextNow = thinkBody.text
  detachChildren(thinkBody)
  thinkBody.appendChild(new StubText('先看提示词，但不要急。提示词再确认一次。'))
  thinkBody.appendChild(ownSeat)
  check('the re-render really did drop our marks', hitsInBody() === 0, 'hits after rebuild ' + String(hitsInBody()))
  runtime0().pass()
  check('a re-render of the body gets its marks back', hitsInBody() === 3, 'hits ' + String(hitsInBody()) + ', row ' + JSON.stringify(runtime0().rows()[0]) + ', bodyClass ' + String(bodyWrap.attributes.class) + ', cap ' + JSON.stringify(groupBox.style))
  check('the repaired body still reads the same', thinkBody.text === bodyTextNow, JSON.stringify(thinkText(thinkBody)) + ' vs ' + JSON.stringify(bodyTextNow))

  // 11. A host rewrite of the node we emptied keeps its newer text.
  const emptied = thinkBody.childNodes.find((node) => node.nodeType === 3 && node.nodeValue === '')
  check('the wrap left the host its own text node', emptied !== undefined, 'body nodes: ' + thinkBody.childNodes.map((node) => node.tagName + ':' + JSON.stringify(node.nodeValue ?? node.text)).join(' '))
  if (emptied !== undefined) {
    emptied.nodeValue = '全新的提示词'
    runtime0().pass()
    check('a streaming rewrite is never clobbered by the undo', thinkBody.text === '全新的提示词但', JSON.stringify(thinkBody.text))
    check('the rewritten text is highlighted again', hitsInBody() === 1, 'hits ' + String(hitsInBody()))
  }
  /* Leave the fixture as the later runtime checks expect to find it. */
  detachChildren(thinkBody)
  thinkBody.appendChild(new StubText('先看提示词，但不要急。提示词再确认一次。'))
  thinkBody.appendChild(ownSeat)
  runtime0().pass()

  // 12. A chip is that keyword's switch: click off, click on.
  const stored = storedState
  storeSettings({ muted: [], chipsWhenCollapsed: false })
  const chipsBeforeClick = chipsFor(row)
  check(
    'a chip is a working switch, not just a label',
    chipsBeforeClick.length === 2 && chipsBeforeClick.every((chip) => chip.type === 'button' && typeof chip.props.onClick === 'function' && chip.props['aria-pressed'] === 'true'),
    chipsBeforeClick.length + ' chips: ' + JSON.stringify(chipsBeforeClick.map((chip) => [chip.type, chip.props['aria-pressed']])),
  )
  chipsBeforeClick[0].props.onClick({ preventDefault() {}, stopPropagation() {} })
  runTimers()
  const mutedChip = chipsFor(row)[0]
  check('clicking a chip stops that keyword being highlighted', hitsInBody() === 1, 'hits ' + String(hitsInBody()) + ' (但 only)')
  check(
    'the muted chip keeps its place and its count, in an off state',
    mutedChip !== undefined && mutedChip.props['data-muted'] === '1' && mutedChip.props['aria-pressed'] === 'false' && mutedChip.props.style?.borderColor === undefined,
    JSON.stringify(mutedChip?.props?.['data-muted']) + ' ' + JSON.stringify(mutedChip?.props?.style),
  )
  check('the other keyword keeps its highlight', hitsInBody() === 1 && chipsFor(row).length === 2, 'chips ' + String(chipsFor(row).length))
  check('the switch is remembered across reloads', Array.isArray(stored().muted) && stored().muted.length === 1, JSON.stringify(stored().muted))
  check(
    'the settings page shows the same switch state',
    pageNodes(true).some((node) => node.props?.['data-dsh-th'] === 'mute' && node.props?.['aria-pressed'] === 'true'),
    JSON.stringify(pageNodes(true).filter((node) => node.props?.['data-dsh-th'] === 'mute').map((node) => node.props?.['aria-pressed'])),
  )
  chipsFor(row)[0].props.onClick({ preventDefault() {}, stopPropagation() {} })
  runTimers()
  check(
    'clicking it again turns the keyword back on',
    hitsInBody() === 3 && stored().muted.length === 0 && chipsFor(row)[0].props['data-muted'] === undefined,
    'hits ' + String(hitsInBody()) + ', muted ' + JSON.stringify(stored().muted),
  )
  clickSettings('mute')
  check('the settings page can mute the same keyword', hitsInBody() === 1 && stored().muted.length === 1, 'hits ' + String(hitsInBody()))
  clickSettings('mute')
  check('and unmute it again', hitsInBody() === 3 && stored().muted.length === 0, 'hits ' + String(hitsInBody()))
  storeSettings({ muted: [] })  } catch (error) {
    check('the post-regression checks run', false, String(error && error.stack ? error.stack : error) + ' | body nodes: ' + thinkBody.childNodes.map((node) => node.tagName + ':' + JSON.stringify(node.nodeValue ?? node.text)).join(' '))
  }
}

function thinkText(node) {
  return node.text
}

// 8. The runtime seam answers, and disposal leaves no residue.
const runtime = globalThis.window.__DSH_TH__
check('runtime seam is exposed', runtime !== undefined && typeof runtime.rows === 'function', typeof runtime)
if (runtime !== undefined) {
  const rows = runtime.rows()
  check('runtime reports the row', Array.isArray(rows) && rows.length === 1 && rows[0].hasBadges === true, JSON.stringify(rows))
  try {
    runtime.clear()
    check('runtime clear leaves no highlights', row.querySelectorAll('[data-dsh-th="hit"]').length === 0, 'ok')
    check('runtime clear restores the text', thinkBody.text === '先看提示词，但不要急。提示词再确认一次。但', JSON.stringify(thinkBody.text))
  } catch (error) {
    check('runtime clear leaves no highlights', false, String(error && error.message))
  }
}

/* - report - */

// 13. A folded row counts the text it hides, not the single line it shows.
/*
 * The shipped row renders no chain of thought while it is folded — React mounts the
 * body only while `expanded` — so the folded text exists in the host component's
 * `text` prop and nowhere in the DOM. This fixture is exactly that row: a title, one
 * preview line, no body at all, and a fiber carrying the whole reasoning.
 */
const foldedRow = new StubElement('div')
foldedRow.setAttribute('data-variant', 'think')
const foldedLine = new StubElement('div')
foldedLine.setAttribute('data-disclosure-row', '')
const foldedLeading = new StubElement('span')
const foldedContentRoot = new StubElement('span')
const foldedContentLine = new StubElement('span')
const foldedTitle = new StubElement('span')
foldedTitle.textContent = '思考'
const foldedSeparator = new StubElement('span')
foldedSeparator.setAttribute('aria-hidden', 'true')
const foldedSummary = new StubElement('span')
foldedSummary.textContent = '先看提示词首行'
foldedContentLine.appendChild(foldedTitle)
foldedContentLine.appendChild(foldedSeparator)
foldedContentLine.appendChild(foldedSummary)
foldedContentRoot.appendChild(foldedContentLine)
foldedLine.appendChild(foldedLeading)
foldedLine.appendChild(foldedContentRoot)
foldedRow.appendChild(foldedLine)
/* The preview holds 提示词 ×1; the folded reasoning holds it three times and 但 once. */
foldedRow['__reactFiber$stub'] = {
  memoizedProps: { className: 'row', children: null },
  return: { memoizedProps: { text: '先看提示词，但不要急。提示词再确认一次。提示词' }, return: null },
}
groupBox.appendChild(foldedRow)
/* The state the reader is in when this matters: chips shown on a folded row. */
storeSettings({ chipsWhenCollapsed: true, muted: [] })
runtime0().pass()
check(
  'a folded row counts the reasoning it hides, not its one preview line',
  runtime0().rows()[1]?.count === 4,
  'count ' + String(runtime0().rows()[1]?.count) + ' ' + JSON.stringify(runtime0().rows()[1]),
)
check('the folded row says where its numbers came from', runtime0().rows()[1]?.folded === true, JSON.stringify(runtime0().rows()[1]))
const foldedChips = chipsFor(foldedRow)
check(
  'the chips carry the folded counts',
  foldedChips.length === 2 && foldedChips[0].props['data-count'] === '3' && foldedChips[1].props['data-count'] === '1',
  JSON.stringify(foldedChips.map((chip) => chip.props['data-count'])),
)
foldedRow.setAttribute('data-expanded', '')
foldedLine.setAttribute('data-open', '')
runtime0().pass()
check('expanding the row does not change the numbers', runtime0().rows()[1]?.count === 4, 'count ' + String(runtime0().rows()[1]?.count))
/* Leave the caps where the plugin found them. */
storeSettings({ liftOnExpand: false })

// 14. The whole-word lock, from the settings button through to the counts.
storeSettings({
  rows: [
    { id: 'w-is', text: 'is', color: '#dc2626' },
    { id: 'w-and', text: 'and', color: '#35c047' },
  ],
  muted: [],
  chipsWhenCollapsed: true,
})
/* The folded row is the cheapest fixture with text of its own. */
foldedRow['__reactFiber$stub'].return.memoizedProps.text = 'this is and this is not'
runtime0().pass()
check('a plain keyword counts the matches inside longer words', runtime0().rows()[1]?.count === 5, 'count ' + String(runtime0().rows()[1]?.count))
clickSettings('whole')
check('the whole-word button locks that keyword', runtime0().rows()[1]?.count === 3, 'count ' + String(runtime0().rows()[1]?.count))
check('the lock is stored on the keyword itself', storedState().rows[0].whole === true, JSON.stringify(storedState().rows[0]))
check(
  'the chip count follows the lock',
  chipsFor(foldedRow)[0]?.props?.['data-count'] === '2',
  JSON.stringify(chipsFor(foldedRow).map((chip) => chip.props['data-count'])),
)

// 15. Bold / italic / underline / font ride the marks and the chip name.
thinkBody.appendChild(new StubText('this is and'))
runtime0().pass()
const hitSpans = () => thinkBody.querySelectorAll('[data-dsh-th="hit"]')
check(
  'the locked keyword is only marked where it stands alone',
  hitSpans().length === 2 && hitSpans().map((span) => span.text).join('|') === 'is|and',
  'hits ' + hitSpans().map((span) => span.text).join('|'),
)
/*
 * The style menu is a disclosure; a click is what opens it, and the stub's hook cells
 * keep it open for the next render the way a mounted component would.
 */
const openNodes = (() => {
  pageNodes(true).find((node) => node.props?.['data-dsh-th'] === 'style-menu').props.onClick({ preventDefault() {}, stopPropagation() {} })
  return pageNodes(true)
})()
{
  const markers = ['style-panel', 'font', 'style-b', 'style-i', 'style-u']
  check(
    'the style menu reveals colour, font and the three toggles',
    markers.every((marker) => openNodes.some((node) => node.props?.['data-dsh-th'] === marker)),
    JSON.stringify(markers.map((marker) => openNodes.filter((node) => node.props?.['data-dsh-th'] === marker).length)),
  )
  check(
    'the panel no longer spends a line on the note',
    openNodes.some((node) => node.props?.['data-dsh-th'] === 'whole-note') === false && openNodes.some((node) => node.props?.className === 'dsh-th-note') === false,
    'note nodes ' + String(openNodes.filter((node) => node.props?.['data-dsh-th'] === 'whole-note').length),
  )
  /* The explanation the note used to carry still lives on the lock's own tooltip. */
  const wholeButton = pageNodes(true).find((node) => node.props?.['data-dsh-th'] === 'whole')
  check(
    'the whole-word lock explains itself on hover',
    wholeButton !== undefined && String(wholeButton.props.title ?? '').length > 10,
    JSON.stringify(String(wholeButton?.props?.title ?? '').slice(0, 24)),
  )
  openNodes.find((node) => node.props?.['data-dsh-th'] === 'font').props.onChange({ target: { value: 'mono' } })
  for (const marker of ['style-b', 'style-i', 'style-u']) {
    pageNodes(true).find((node) => node.props?.['data-dsh-th'] === marker).props.onClick({ preventDefault() {}, stopPropagation() {} })
  }
}
runtime0().pass()
const styledHit = hitSpans().find((span) => span.text === 'is')
check(
  'the mark carries the keyword text style',
  styledHit !== undefined &&
    styledHit.style.fontWeight === '600' &&
    styledHit.style.fontStyle === 'italic' &&
    styledHit.style.textDecoration === 'underline' &&
    styledHit.style.fontFamily === 'var(--ds-font-family-code)',
  JSON.stringify(styledHit?.style),
)
const plainHit = hitSpans().find((span) => span.text === 'and')
check(
  'a keyword without a style gets no extra style',
  plainHit !== undefined && plainHit.style.fontWeight === undefined && plainHit.style.fontStyle === undefined,
  JSON.stringify(plainHit?.style),
)
check(
  'the chip name previews the same style',
  chipsFor(row)[0]?.children?.[0]?.props?.style?.fontWeight === '600',
  JSON.stringify(chipsFor(row)[0]?.children?.[0]?.props?.style),
)
check('the style is stored with the keyword', storedState().rows[0].bold === true && storedState().rows[0].font === 'mono', JSON.stringify(storedState().rows[0]))

/*
 * 15b. The two the style panel gained: the words' own colour, and their own size.
 * The size scale is the host's own content-size range (10/22), and the chip has to
 * follow the word it points at — that is the whole reason the chip carries a scale.
 */
{
  const panelNode = (marker) => pageNodes(true).find((node) => node.props?.['data-dsh-th'] === marker)
  /*
   * The disclosure is a toggle: clicking it again closes the panel, so the guards below
   * open it only while it is shut. Opening it fights nothing — the hook cells keep the
   * open state across the renders these checks do.
   */
  const openPanel = () => {
    if (panelNode('style-panel') === undefined) {
      pageNodes(true).find((node) => node.props?.['data-dsh-th'] === 'style-menu').props.onClick({ preventDefault() {}, stopPropagation() {} })
    }
    return pageNodes(true)
  }
  const inkDot = () => panelNode('ink-dot')
  const sizeUp = () => panelNode('size-up')
  const sizeDown = () => panelNode('size-down')
  /** What the stepper shows for this keyword, as the reader sees it. */
  const sizeShown = () => panelNode('size-value')?.children?.[0]

  const openNodes2 = openPanel()
  check(
    'the style menu offers a text colour, a follow button and a size stepper',
    ['ink-dot', 'ink-follow', 'size', 'size-up', 'size-down'].every((marker) => openNodes2.some((node) => node.props?.['data-dsh-th'] === marker)),
    JSON.stringify(['ink-dot', 'ink-follow', 'size', 'size-up', 'size-down'].map((marker) => openNodes2.filter((node) => node.props?.['data-dsh-th'] === marker).length)),
  )
  check(
    'the text colour starts out following the theme',
    inkDot()?.props?.style?.backgroundColor === 'currentColor' && panelNode('ink-follow')?.props?.['aria-pressed'] === 'true' && panelNode('ink-follow')?.props?.['data-following'] === '1',
    JSON.stringify({ dot: inkDot()?.props?.style?.backgroundColor, pressed: panelNode('ink-follow')?.props?.['aria-pressed'] }),
  )
  check(
    'the size starts at the reader body size, with both arrows live',
    sizeShown() === '14' && sizeUp()?.props?.disabled === false && sizeDown()?.props?.disabled === false,
    JSON.stringify({ value: sizeShown(), up: sizeUp()?.props?.disabled, down: sizeDown()?.props?.disabled }),
  )

  /* Ink: the well writes it, and the mark and the chip name both take it. */
  const inkField = openNodes2.filter((node) => node.type === 'input' && node.props?.type === 'color').at(-1)
  inkField.props.onChange({ target: { value: '#2563EB' } })
  runtime0().pass()
  check('the text colour is stored with the keyword', storedState().rows[0].textColor === '#2563eb', JSON.stringify(storedState().rows[0].textColor))
  check(
    'the mark is painted in the keyword text colour',
    hitSpans().find((span) => span.text === 'is')?.style.color === '#2563eb',
    JSON.stringify(hitSpans().map((span) => [span.text, span.style.color])),
  )
  check(
    'the chip name previews the same ink',
    chipsFor(row)[0]?.children?.[0]?.props?.style?.color === '#2563eb',
    JSON.stringify(chipsFor(row)[0]?.children?.[0]?.props?.style),
  )
  check('the swatch stops claiming to follow the theme', panelNode('ink-follow')?.props?.['aria-pressed'] === 'false', String(panelNode('ink-follow')?.props?.['aria-pressed']))

  /* And it can be handed back: the eye-off rule needs a colour that means "the host's". */
  openPanel().find((node) => node.props?.['data-dsh-th'] === 'ink-follow').props.onClick({ preventDefault() {}, stopPropagation() {} })
  runtime0().pass()
  check('the follow button hands the colour back to the theme', storedState().rows[0].textColor === null, JSON.stringify(storedState().rows[0].textColor))
  check(
    'a followed colour is inherited, never written as a fixed hex',
    hitSpans().find((span) => span.text === 'is')?.style.color === 'currentColor',
    JSON.stringify(hitSpans().map((span) => [span.text, span.style.color])),
  )

  /* Size: one step at a time, and the chip follows the word. */
  const sizeChip = () => chipsFor(row)[0]?.props?.style?.['--dsh-th-chip-scale']
  const before18 = sizeChip()
  for (let step = 0; step < 4; step += 1) {
    pageNodes(true).find((node) => node.props?.['data-dsh-th'] === 'size-up').props.onClick({ preventDefault() {}, stopPropagation() {} })
  }
  runtime0().pass()
  check('the stepper walks up to 18px and stores it', storedState().rows[0].fontSize === 18, JSON.stringify(storedState().rows[0].fontSize))
  check(
    'the mark is drawn at the keyword size',
    hitSpans().find((span) => span.text === 'is')?.style.fontSize === '18px',
    JSON.stringify(hitSpans().map((span) => [span.text, span.style.fontSize])),
  )
  check('the chip grows with the word it points at', Number(sizeChip()) > Number(before18), before18 + ' -> ' + sizeChip())
  check('and the panel shows the size it stored', sizeShown() === '18', String(sizeShown()))

  /* The host's own ceiling, and the host's own floor. */
  for (let step = 0; step < 12; step += 1) {
    const up = pageNodes(true).find((node) => node.props?.['data-dsh-th'] === 'size-up')
    if (up?.props?.disabled === true) break
    up.props.onClick({ preventDefault() {}, stopPropagation() {} })
  }
  runtime0().pass()
  check('the size stops at the host maximum of 22px', storedState().rows[0].fontSize === 22, JSON.stringify(storedState().rows[0].fontSize))
  check('at the maximum the up arrow is dead but still there', panelNode('size-up')?.props?.disabled === true && panelNode('size-down')?.props?.disabled === false, JSON.stringify({ up: panelNode('size-up')?.props?.disabled, down: panelNode('size-down')?.props?.disabled }))
  /*
   * The cap matters more than the number: a collapsed row's header line is a fixed
   * height with `contain: size layout`, so a chip that grew without bound would be
   * clipped rather than read.
   */
  check('the chip scale stays inside its bound at the largest size', Number(sizeChip()) <= 1.45, sizeChip())
  check(
    'and at the largest size the chip still carries its header-line cap',
    /^calc\(21px \+ -?\d+(\.\d+)?px\)$/.test(String(chipsFor(row)[0]?.props?.style?.['--dsh-th-chip-line'])),
    String(chipsFor(row)[0]?.props?.style?.['--dsh-th-chip-line']),
  )
  for (let step = 0; step < 20; step += 1) {
    const down = pageNodes(true).find((node) => node.props?.['data-dsh-th'] === 'size-down')
    if (down?.props?.disabled === true) break
    down.props.onClick({ preventDefault() {}, stopPropagation() {} })
  }
  runtime0().pass()
  check('the size stops at the host minimum of 10px', storedState().rows[0].fontSize === 10, JSON.stringify(storedState().rows[0].fontSize))
  check('at the minimum the down arrow is dead but still there', panelNode('size-down')?.props?.disabled === true && panelNode('size-up')?.props?.disabled === false, JSON.stringify({ up: panelNode('size-up')?.props?.disabled, down: panelNode('size-down')?.props?.disabled }))
  check('the chip shrinks with the word, inside its own floor', Number(sizeChip()) >= 0.7 && Number(sizeChip()) < 1, sizeChip())

  /* A size below the reader's own leaves the mark smaller, and the row keeps reading. */
  check(
    'a smaller keyword is still the same text',
    hitSpans().map((span) => span.text).join('|') === 'is|and',
    hitSpans().map((span) => span.text).join('|'),
  )
  storeSettings({ rows: [{ id: 'w-is', text: 'is', color: '#dc2626' }, { id: 'w-and', text: 'and', color: '#35c047' }] })
}

// 16. Two identical keywords can never coexist.
storeSettings({
  rows: [
    { id: 'd-is', text: 'is', color: '#dc2626' },
    { id: 'd-and', text: 'and', color: '#35c047' },
  ],
  caseSensitive: false,
  muted: [],
})
const fields = () => pageNodes(true).filter((node) => node.props?.['data-dsh-th'] === 'text')
const typeInto = (at, value) => {
  fields()[at].props.onChange({ target: { value } })
  const rendered = fields()[at]
  return () => rendered.props.onBlur()
}
const texts = () => runtime0().settings().rows.map((row) => row.text).join('|')
typeInto(1, 'is')()
check('typing a keyword that already exists is refused', texts() === 'is|and', texts())
check('the refused row says why it did not change', pageNodes(true).some((node) => node.props?.['data-dsh-th'] === 'duplicate' && String((node.children ?? [])[0] ?? '').includes('is')), JSON.stringify(pageNodes(true).filter((node) => node.props?.['data-dsh-th'] === 'duplicate').map((node) => (node.children ?? [])[0])))
typeInto(1, 'IS')()
check('with case-insensitive matching, IS is the same word', texts() === 'is|and', texts())
typeInto(1, 'but')()
check('a genuinely different keyword still goes through', texts() === 'is|but', texts())
storeSettings({ caseSensitive: true })
typeInto(1, 'IS')()
check('with case-sensitive matching, IS is its own keyword', texts() === 'is|IS', texts())
/* State that arrives with duplicates (an older build, a hand-edited store) is cleaned. */
storeSettings({
  rows: [
    { id: 'x1', text: 'is', color: '#dc2626' },
    { id: 'x2', text: ' is ', color: '#2563eb' },
    { id: 'x3', text: 'and', color: '#35c047' },
  ],
  caseSensitive: false,
})
check('stored duplicates are deduplicated, first one wins', texts() === 'is|and', texts())

// 17. The case switch does what its label says: turning it on makes matching picky.
storeSettings({ rows: [{ id: 'c1', text: 'is', color: '#dc2626' }], caseSensitive: false, muted: [] })
foldedRow['__reactFiber$stub'].return.memoizedProps.text = 'IS is'
runtime0().pass()
check('with the switch off, is also matches IS', runtime0().rows()[1]?.count === 2, 'count ' + String(runtime0().rows()[1]?.count))
clickSettings('switch-case')
check('turning the switch on makes matching case-sensitive', runtime0().rows()[1]?.count === 1, 'count ' + String(runtime0().rows()[1]?.count))
check('the switch is stored as caseSensitive', storedState().caseSensitive === true, JSON.stringify(storedState().caseSensitive))
clickSettings('switch-case')
check('turning it back off restores case-insensitive matching', runtime0().rows()[1]?.count === 2, 'count ' + String(runtime0().rows()[1]?.count))

// 18. A language flip reaches the chips that are already on screen.
storeSettings({ rows: [{ id: 'l1', text: 'is', color: '#dc2626' }], muted: [], lang: 'zh', caseSensitive: false })
row.removeAttribute('data-expanded')
header.removeAttribute('data-open')
runtime0().pass()
const chipTitle = () => chipsFor(row)[0]?.props?.title ?? ''
const badgeLang = () => row.querySelector('[data-dsh-th="badges"]')?.lang ?? ''
check('the chip explains itself in Chinese first', chipTitle().includes('点击关闭'), JSON.stringify(chipTitle()))
check('the chip container is tagged zh-CN', badgeLang() === 'zh-CN', JSON.stringify(badgeLang()))
clickSettings('lang-en')
runtime0().pass()
check('flipping the language re-labels the chips on screen', chipTitle().includes('Click to stop'), JSON.stringify(chipTitle()))
check('and re-tags the container', badgeLang() === 'en', JSON.stringify(badgeLang()))
clickSettings('lang-zh')
runtime0().pass()
check('flipping back restores the Chinese label', chipTitle().includes('点击关闭'), JSON.stringify(chipTitle()))

// 19. Another window writes the same key: only a `storage` event announces it.
{
  const current = storedState()
  globalThis.window.localStorage.setItem(
    'dsh-thinking-highlight.state.v1',
    JSON.stringify({ ...current, rows: [{ id: 's1', text: '但', color: '#2563eb' }], muted: [] }),
  )
  const before = runtime0().settings().rows.map((entry) => entry.text).join('|')
  for (const entry of [...windowListeners]) if (entry.name === 'storage') entry.listener({ key: 'dsh-thinking-highlight.state.v1' })
  runTimers()
  check('the plugin listens for storage events', windowListeners.some((entry) => entry.name === 'storage'), JSON.stringify(windowListeners.map((entry) => entry.name)))
  check('another window\'s settings arrive without a reload', before !== runtime0().settings().rows.map((entry) => entry.text).join('|'), before + ' -> ' + runtime0().settings().rows.map((entry) => entry.text).join('|'))
  check(
    'and the transcript follows the new keyword',
    chipsFor(row).some((chip) => (chip.children ?? []).some((child) => (child?.children ?? []).includes('但'))),
    JSON.stringify(chipsFor(row).map((chip) => chip.props?.title)),
  )
}

// 20. The keyword cap is enforced where the reader can see it.
{
  const many = Array.from({ length: 200 }, (_, index) => ({ id: 'cap' + index, text: 'w' + index, color: '#dc2626' }))
  storeSettings({ rows: many, muted: [] })
  const addAtCap = pageNodes(true).find((node) => node.props?.['data-dsh-th'] === 'add')
  check('at 200 keywords the add button is disabled', addAtCap?.props?.disabled === true, JSON.stringify(addAtCap?.props?.disabled))
  check('and the cap is explained', pageNodes(true).some((node) => node.props?.['data-dsh-th'] === 'keywords-full'), 'hint node ' + String(pageNodes(true).filter((node) => node.props?.['data-dsh-th'] === 'keywords-full').length))
  storeSettings({ rows: many.slice(0, 199) })
  const addBelowCap = pageNodes(true).find((node) => node.props?.['data-dsh-th'] === 'add')
  check('one below the cap it works again', addBelowCap?.props?.disabled !== true, JSON.stringify(addBelowCap?.props?.disabled))
}

// 21. The per-row eye is a presentation switch: it must never cost a keyword its marks.
/*
 * Reported from the app: with two keywords and the eye switched off, muting one
 * keyword (clicking its chip) and then switching the eye back on showed no
 * highlighting at all — not even for the keyword that was never muted. Muting
 * changes the pattern, the pass dropped the body's marks, and the eye being off
 * made it skip rebuilding them; switching the eye on only repainted the chips.
 */
{
  try {
    storeSettings({
      rows: [
        { id: 'e1', text: '提示词', color: '#dc2626' },
        { id: 'e2', text: '但', color: '#2563eb' },
      ],
      muted: [],
      caseSensitive: false,
      chipsWhenCollapsed: false,
    })
    row.setAttribute('data-expanded', '')
    header.setAttribute('data-open', '')
    runtime0().pass()
    const hitsNow = () => row.querySelectorAll('[data-dsh-th="hit"]').length
    const eyeNode = () => {
      const container = row.querySelector('[data-dsh-th="badges"]')
      const tree = renderCalls.filter((call) => call.container === container).at(-1)?.element
      return findNode(tree, (node) => node.props?.['data-dsh-th-eye'] === '1')
    }
    const clickEye = () => {
      eyeNode().props.onClick({ preventDefault() {}, stopPropagation() {} })
      runTimers()
      runtime0().pass()
    }
    const clickChip = (at) => {
      chipsFor(row)[at].props.onClick({ preventDefault() {}, stopPropagation() {} })
      runTimers()
      runtime0().pass()
    }

    const initialHits = hitsNow()
    check('both keywords are marked to begin with', initialHits >= 2, 'hits ' + String(initialHits))
    clickEye()
    check('the eye switches the row off', row.getAttribute('data-dsh-hl') === 'off', String(row.getAttribute('data-dsh-hl')))
    check('switching it off keeps the marks, it only hides them', hitsNow() === initialHits, 'hits ' + String(hitsNow()) + ' vs ' + String(initialHits))
    clickChip(0)
    const afterMute = hitsNow()
    check('muting a keyword with the eye off still rebuilds the body', afterMute > 0 && afterMute < initialHits, 'hits ' + String(afterMute) + ' of ' + String(initialHits))
    clickEye()
    check(
      'switching the eye back on shows the keyword that was never muted',
      row.getAttribute('data-dsh-hl') === 'on' && afterMute > 0 && hitsNow() === afterMute,
      JSON.stringify({ attr: row.getAttribute('data-dsh-hl'), hits: hitsNow(), expected: afterMute }),
    )
    clickChip(0)
    check('and unmuting brings the muted keyword back as well', hitsNow() === initialHits, 'hits ' + String(hitsNow()) + ' vs ' + String(initialHits))
    storeSettings({ muted: [] })
  } catch (error) {
    check('the eye regression checks run', false, String(error && error.stack ? error.stack : error))
  }
}

let failed = 0
for (const result of results) {
  if (!result.pass) failed += 1
  console.log((result.pass ? 'PASS  ' : 'FAIL  ') + result.name + (result.pass ? '' : '  (' + result.detail + ')'))
}
console.log('\n' + (results.length - failed) + '/' + results.length + ' checks passed')
process.exit(failed === 0 ? 0 : 1)

