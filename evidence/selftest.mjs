/**
 * Self-test for @local/dsh-thinking-highlight's client half.
 *
 * The risky half of the plugin is DOM surgery on nodes React owns, so this test
 * extracts the shipped functions out of client.js by brace matching (never a
 * copy) and runs them against a small DOM stub that honours splitText's real
 * contract. Exit code 0 means every case passed.
 *
 *   node selftest.mjs
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** Pull one function declaration out of the shipped bundle by brace matching. */
function extract(name) {
  const at = source.indexOf('function ' + name + '(')
  if (at < 0) throw new Error('not found in client.js: ' + name)
  let depth = 0
  for (let i = source.indexOf('{', at); i < source.length; i += 1) {
    const char = source[i]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return source.slice(at, i + 1)
    }
  }
  throw new Error('unbalanced braces in ' + name)
}

/** The constants the extracted functions close over. */
function constant(name) {
  const match = new RegExp('const ' + name + ' = (.+)').exec(source)
  if (match === null) throw new Error('not found in client.js: const ' + name)
  return match[1].trim()
}

/* ───────────────────────────── stub DOM ───────────────────────────── */

let nodeSeq = 0

class StubNode {
  constructor() {
    this.id = ++nodeSeq
    this.parentNode = null
    this.isConnected = true
  }
  remove() {
    if (this.parentNode !== null) this.parentNode.removeChild(this)
    this.isConnected = false
  }
}

class StubText extends StubNode {
  constructor(value) {
    super()
    this.nodeType = 3
    this.nodeValue = value
  }
  /** Real splitText: this node keeps the head, the sibling gets the tail. */
  splitText(offset) {
    const head = this.nodeValue.slice(0, offset)
    const tail = this.nodeValue.slice(offset)
    const sibling = new StubText(tail)
    sibling.parentNode = this.parentNode
    this.nodeValue = head
    const at = this.parentNode.childNodes.indexOf(this)
    this.parentNode.childNodes.splice(at + 1, 0, sibling)
    return sibling
  }
}

class StubElement extends StubNode {
  constructor(tag, attrs = {}) {
    super()
    this.nodeType = 1
    this.tagName = tag.toUpperCase()
    this.childNodes = []
    this.attributes = { class: attrs.class ?? '', 'data-dsh-th': attrs['data-dsh-th'] }
    this.style = {}
  }
  /** Like the real DOM: reading joins descendants, writing replaces them. */
  get textContent() {
    return this.text
  }
  set textContent(value) {
    this.childNodes = []
    this.appendChild(new StubText(String(value)))
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value)
  }
  set className(value) {
    this.attributes.class = String(value)
  }
  get className() {
    return this.attributes.class ?? ''
  }
  hasAttribute(name) {
    return this.attributes[name] !== undefined && this.attributes[name] !== null
  }
  get firstElementChild() {
    return this.childNodes.find((node) => node.nodeType === 1) ?? null
  }
  get nextElementSibling() {
    if (this.parentNode === null) return null
    const siblings = this.parentNode.childNodes
    for (let i = siblings.indexOf(this) + 1; i < siblings.length; i += 1) {
      if (siblings[i].nodeType === 1) return siblings[i]
    }
    return null
  }
  appendChild(node) {
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }
  removeChild(node) {
    const at = this.childNodes.indexOf(node)
    if (at >= 0) this.childNodes.splice(at, 1)
    node.parentNode = null
    return node
  }
  insertBefore(node, before) {
    node.parentNode = this
    const at = this.childNodes.indexOf(before)
    this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, node)
    return node
  }
  /** Layout-independent text of the whole subtree, like the real thing. */
  get text() {
    let out = ''
    for (const node of this.childNodes) out += node.nodeType === 3 ? node.nodeValue : node.text
    return out
  }
}

const document = {
  createElement: (tag) => new StubElement(tag),
  createTextNode: (value) => new StubText(value),
}

/* ─────────────────── instantiate the shipped functions ─────────────────── */

const MARK = 'data-dsh-th'
const DEFAULT_COLOR = '#dc2626'
const ns = new Function(
  'document',
  'MARK',
  'DEFAULT_COLOR',
  [
    'const MAX_KEYWORDS = ' + constant('MAX_KEYWORDS'),
    'const marks = new WeakMap()',
    extract('escapeRegExp'),
    extract('buildPattern'),
    extract('countMatches'),
    extract('toTint'),
    extract('hex'),
    extract('matchSegments'),
    extract('unwrapBody'),
    extract('wrapNode'),
    'return { buildPattern, countMatches, toTint, escapeRegExp, matchSegments, wrapNode, unwrapBody, hex, marks }',
  ].join('\n'),
)(document, MARK, DEFAULT_COLOR)

/* ─────────────────────────────── cases ─────────────────────────────── */

const cases = []
const check = (name, pass, observed, expected) => cases.push({ name, pass: Boolean(pass), observed, expected })

const items = [
  { id: 'a', text: '提示词', color: '#dc2626' },
  { id: 'b', text: '但', color: '#2563eb' },
]

// 1. A keyword inside one text node becomes [head][hit][tail] and reads back the same.
//    The loop's final splitText leaves one empty tail node behind; it is inert, and
//    it is what a later unwrap removes.
{
  const parent = new StubElement('p')
  const node = parent.appendChild(new StubText('先看提示词再动手'))
  const tint = () => 'rgba(220, 38, 38, 0.24)'
  const hits = ns.wrapNode(node, parent, items, false, tint)
  const kinds = parent.childNodes.map((child) => (child.nodeType === 3 ? 't' : 'span:' + child.attributes.class))
  const expected = 't|span:dsh-th-hit|t|t'
  check('single-node wrap splits into head/hit/tail', hits === 1 && kinds.join('|') === expected, kinds.join('|'), expected)
  check('wrapped text preserves the original string', parent.text === '先看提示词再动手', parent.text, '先看提示词再动手')
  check('hit carries the keyword and its tint', parent.childNodes[1].textContent === '提示词' && parent.childNodes[1].style.backgroundColor === 'rgba(220, 38, 38, 0.24)', parent.childNodes[1].style.backgroundColor, 'rgba(220, 38, 38, 0.24)')
}

// 2. Three hits inside one text node: they share the single undo record for that
//    node, and the body reads back exactly as it did before.
{
  const parent = new StubElement('p')
  const node = parent.appendChild(new StubText('提示词A但B提示词'))
  const hits = ns.wrapNode(node, parent, items, false, () => 'tint')
  const text = parent.text
  check('three occurrences wrap into three hits', hits === 3, hits, 3)
  check('interleaved wrap keeps order', text === '提示词A但B提示词', text, '提示词A但B提示词')
  check('one undo record for the one node it emptied', (ns.marks.get(parent)?.size ?? 0) === 1, ns.marks.get(parent)?.size ?? 0, 1)
}

// 3. Two keywords in two text nodes of one body: both must be restored, which is
//    the case a single-record-per-body implementation silently loses.
{
  const parent = new StubElement('p')
  const first = parent.appendChild(new StubText('提示词'))
  const second = parent.appendChild(new StubText('但'))
  const hits = ns.wrapNode(first, parent, items, false, () => 'tint') + ns.wrapNode(second, parent, items, false, () => 'tint')
  const wrapped = parent.text
  ns.unwrapBody(parent)
  check('both text nodes wrap', hits === 2 && wrapped === '提示词但', hits + '/' + wrapped, '2/提示词但')
  check('unwrap restores every recorded node', first.nodeValue === '提示词' && second.nodeValue === '但', first.nodeValue + '|' + second.nodeValue, '提示词|但')
  check('unwrap clears the mark record', ns.marks.get(parent) === undefined, String(ns.marks.get(parent)), 'undefined')
}

// 4. Re-wrapping the same body twice must not compound.
{
  const parent = new StubElement('p')
  const node = parent.appendChild(new StubText('提示词提示词'))
  ns.wrapNode(node, parent, items, false, () => 'tint')
  const first = parent.text
  ns.unwrapBody(parent)
  ns.wrapNode(node, parent, items, false, () => 'tint')
  check('second wrap is idempotent after unwrap', parent.text === first && first === '提示词提示词', parent.text, '提示词提示词')
}

// 5. A stale node (React removed it) is dropped instead of resurrecting text.
{
  const parent = new StubElement('p')
  const node = parent.appendChild(new StubText('但'))
  ns.wrapNode(node, parent, items, false, () => 'tint')
  const orphan = parent.childNodes[parent.childNodes.length - 1]
  orphan.remove()
  ns.unwrapBody(parent)
  check('detached recorded node is dropped', parent.childNodes.includes(orphan) === false, parent.childNodes.includes(orphan), false)
}

// 6. Substrings that are not the keyword are left alone.
{
  const parent = new StubElement('p')
  const node = parent.appendChild(new StubText('提示词化 但是'))
  const hits = ns.wrapNode(node, parent, items, false, () => 'tint')
  check('matching is substring-based by design', hits === 2, hits, 2)
}

// 7. Case sensitivity switch.
{
  const upper = [{ id: 'c', text: 'TODO', color: '#dc2626' }]
  check('insensitive matches mixed case', ns.countMatches('todo Todo TODO', upper[0], false) === 3, ns.countMatches('todo Todo TODO', upper[0], false), 3)
  check('sensitive matches exact case only', ns.countMatches('todo Todo TODO', upper[0], true) === 1, ns.countMatches('todo Todo TODO', upper[0], true), 1)
}

// 8. Regex metacharacters in a keyword are literal.
{
  const meta = [{ id: 'd', text: 'a.c(', color: '#dc2626' }]
  check('metacharacters are escaped', ns.countMatches('xa.c(y aXcY', meta[0], true) === 1, ns.countMatches('xa.c(y aXcY', meta[0], true), 1)
}

// 9. Longest keyword wins so a nested shorter one cannot shadow it.
{
  const nested = [
    { id: 'e', text: '但', color: '#dc2626' },
    { id: 'f', text: '但是', color: '#dc2626' },
  ]
  const pattern = ns.buildPattern(nested, true)
  const match = pattern.exec('但是')
  check('longest keyword is preferred', match !== null && match[0] === '但是', match === null ? 'null' : match[0], '但是')
}

// 10. Empty keyword list is a no-op, not a wildcard match.
{
  check('no keywords builds no pattern', ns.buildPattern([{ id: 'g', text: '', color: '#fff' }], false) === null, String(ns.buildPattern([{ id: 'g', text: '', color: '#fff' }], false)), 'null')
}

// 11. Colour input is normalised and never trusted raw.
{
  check('valid hex passes through lowercased', ns.hex('#ABCDEF') === '#abcdef', ns.hex('#ABCDEF'), '#abcdef')
  check('garbage falls back to the default', ns.hex('javascript:alert(1)') === DEFAULT_COLOR, ns.hex('javascript:alert(1)'), DEFAULT_COLOR)
  check('undefined colour falls back', ns.hex(undefined) === DEFAULT_COLOR, ns.hex(undefined), DEFAULT_COLOR)
}

/* ─────────────────────────────── report ─────────────────────────────── */

let failed = 0
for (const item of cases) {
  if (!item.pass) failed += 1
  const mark = item.pass ? 'PASS' : 'FAIL'
  console.log(mark + '  ' + item.name + (item.pass ? '' : '  (observed ' + JSON.stringify(item.observed) + ', expected ' + JSON.stringify(item.expected) + ')'))
}
console.log('\n' + (cases.length - failed) + '/' + cases.length + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
