/**
 * Self-test for @yokira404/dsh-thinking-highlight's client half.
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
  body: new StubElement('body'),
}

/*
 * The two custom properties the chip's cap reads off `body`. `--dsh-content-font-delta`
 * is the host's own: `calc(var(--dsh-content-font-size,14px) - 14px)`, published on
 * `body`, which is where a value has to be resolved from. The stub answers what a real
 * `getComputedStyle` would for whichever body size the case below installs.
 */
let bodyFontSize = 14
const window = {
  getComputedStyle: () => ({
    getPropertyValue(name) {
      if (name === '--dsh-content-font-delta') return String(bodyFontSize - 14) + 'px'
      return ''
    },
  }),
}

/* ─────────────────── instantiate the shipped functions ─────────────────── */

const MARK = 'data-dsh-th'
const DEFAULT_COLOR = '#dc2626'
const ns = new Function(
  'document',
  'MARK',
  'DEFAULT_COLOR',
  'window',
  [
    'const MAX_KEYWORDS = ' + constant('MAX_KEYWORDS'),
    'const WORD_EDGE = ' + constant('WORD_EDGE'),
    'const WORD_HEAD = ' + constant('WORD_HEAD'),
    'const WORD_TAIL = ' + constant('WORD_TAIL'),
    'const FONT_SIZE_MIN = ' + constant('FONT_SIZE_MIN'),
    'const FONT_SIZE_MAX = ' + constant('FONT_SIZE_MAX'),
    'const FONT_SIZE_DEFAULT = ' + constant('FONT_SIZE_DEFAULT'),
    'const CHIP_SCALE_MIN = ' + constant('CHIP_SCALE_MIN'),
    'const CHIP_SCALE_MAX = ' + constant('CHIP_SCALE_MAX'),
    'const marks = new WeakMap()',
    extract('escapeRegExp'),
    extract('keywordBody'),
    extract('buildPattern'),
    extract('countMatches'),
    extract('toTint'),
    extract('hex'),
    extract('textColor'),
    extract('fontSize'),
    extract('matchSegments'),
    extract('unwrapBody'),
    extract('wrapNode'),
    extract('markStyle'),
    extract('styleKey'),
    extract('chipScale'),
    extract('chipLineCap'),
    'return { buildPattern, countMatches, toTint, escapeRegExp, matchSegments, wrapNode, unwrapBody, hex, textColor, fontSize, markStyle, styleKey, chipScale, chipLineCap, marks, FONT_SIZE_MIN, FONT_SIZE_MAX, FONT_SIZE_DEFAULT }',
  ].join('\n'),
)(document, MARK, DEFAULT_COLOR, window)

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

// 12. The whole-word lock: only matches that stand alone count.
{
  const loose = { id: 'w1', text: 'is', color: '#dc2626' }
  const locked = { id: 'w2', text: 'is', color: '#dc2626', whole: true }
  check('a plain keyword matches inside longer words', ns.countMatches('this is and this is not', loose, false) === 4, ns.countMatches('this is and this is not', loose, false), 4)
  check('the whole-word lock drops the embedded ones', ns.countMatches('this is and this is not', locked, false) === 2, ns.countMatches('this is and this is not', locked, false), 2)
  check('a digit next to it also blocks the match', ns.countMatches('is2 is', locked, false) === 1, ns.countMatches('is2 is', locked, false), 1)
  check('letter case is irrelevant to the lock', ns.countMatches('ThisIs IS', locked, false) === 1, ns.countMatches('ThisIs IS', locked, false), 1)
  check('punctuation still counts as a boundary', ns.countMatches('(is), is.', locked, false) === 2, ns.countMatches('(is), is.', locked, false), 2)
  check('Chinese keywords are locked the same way', ns.countMatches('提示词汇 提示词', { id: 'w3', text: '提示词', color: '#dc2626', whole: true }, false) === 1, ns.countMatches('提示词汇 提示词', { id: 'w3', text: '提示词', color: '#dc2626', whole: true }, false), 1)
  const mixed = ns.buildPattern([{ id: 'w4', text: 'and', color: '#dc2626', whole: true }, { id: 'w5', text: 'is', color: '#2563eb' }], false)
  check('the lock is per keyword, not for the whole list', mixed !== null && 'brand is'.replace(mixed, '#') === 'brand #', mixed === null ? 'null' : 'brand is'.replace(mixed, '#'), 'brand #')
}

// 13. A keyword's own text colour: absent means "the host's", never a guess.
{
  check('no colour is kept as null, not as the default', ns.textColor(undefined) === null && ns.textColor(null) === null && ns.textColor('') === null, JSON.stringify([ns.textColor(undefined), ns.textColor(null), ns.textColor('')]), 'null')
  check('a colour is normalised to lower-case hex', ns.textColor('#A1B2C3') === '#a1b2c3', String(ns.textColor('#A1B2C3')), '#a1b2c3')
  check('garbage is refused rather than repainted', ns.textColor('javascript:alert(1)') === null && ns.textColor('#12345') === null, JSON.stringify([ns.textColor('javascript:alert(1)'), ns.textColor('#12345')]), 'null')
  check('the explicit "follow" spelling also means the host colour', ns.textColor('follow') === null && ns.textColor(' FOLLOW ') === null, JSON.stringify([ns.textColor('follow'), ns.textColor(' FOLLOW ')]), 'null')
  /* Colour and size travel together as the key that decides whether marks are rebuilt. */
  const base = { color: '#dc2626', textColor: null, fontSize: 14 }
  check('the style key is stable for identical styles', ns.styleKey(base) === ns.styleKey({ ...base }), ns.styleKey(base), ns.styleKey({ ...base }))
  check('a text colour alone changes the style key', ns.styleKey(base) !== ns.styleKey({ ...base, textColor: '#2563eb' }), ns.styleKey({ ...base, textColor: '#2563eb' }), 'different')
  check('a size alone changes the style key', ns.styleKey(base) !== ns.styleKey({ ...base, fontSize: 18 }), ns.styleKey({ ...base, fontSize: 18 }), 'different')
  check('a background colour alone changes the style key', ns.styleKey(base) !== ns.styleKey({ ...base, color: '#16a34a' }), ns.styleKey({ ...base, color: '#16a34a' }), 'different')
  check('an absent text colour matches an explicit null', ns.styleKey({ ...base, textColor: undefined }) === ns.styleKey(base), ns.styleKey({ ...base, textColor: undefined }), ns.styleKey(base))
}

// 14. The size scale is the host's own, and a chip can never outgrow its line.
{
  check('the bounds are the host content size bounds', ns.FONT_SIZE_MIN === 10 && ns.FONT_SIZE_MAX === 22 && ns.FONT_SIZE_DEFAULT === 14, JSON.stringify([ns.FONT_SIZE_MIN, ns.FONT_SIZE_MAX, ns.FONT_SIZE_DEFAULT]), '[10,22,14]')
  check('a missing size is the reader body size', ns.fontSize(undefined) === 14 && ns.fontSize(null) === 14 && ns.fontSize('') === 14, JSON.stringify([ns.fontSize(undefined), ns.fontSize(null), ns.fontSize('')]), '14')
  check('a size below the range is clamped up to the minimum', ns.fontSize(2) === 10 && ns.fontSize(-40) === 10, JSON.stringify([ns.fontSize(2), ns.fontSize(-40)]), '10')
  check('a size above the range is clamped down to the maximum', ns.fontSize(96) === 22 && ns.fontSize(1000) === 22, JSON.stringify([ns.fontSize(96), ns.fontSize(1000)]), '22')
  check('a fractional size lands on a whole pixel', ns.fontSize(15.6) === 16 && ns.fontSize('17.4px') === 17, JSON.stringify([ns.fontSize(15.6), ns.fontSize('17.4px')]), '16/17')
  check('the default size leaves a chip exactly as it was', ns.chipScale(14) === 1, String(ns.chipScale(14)), '1')
  check('the smallest size shrinks the chip', ns.chipScale(10) < 1 && ns.chipScale(10) >= 0.7, String(ns.chipScale(10)), '<1 and >=0.7')
  check('the largest size grows the chip', ns.chipScale(22) > 1, String(ns.chipScale(22)), '>1')
  /*
   * The chip sits on a fixed-height header line, so the scale has to stay inside the
   * bound whatever arrives — including a stored size from a hand-edited store.
   */
  const capped = ns.chipScale(400)
  const floored = ns.chipScale(-5)
  check('the chip scale is bounded at both ends', capped <= 1.45 && floored >= 0.7, JSON.stringify([capped, floored]), '<=1.45 and >=0.7')
  check('an unusable size still yields a usable chip scale', ns.chipScale(undefined) === 1 && ns.chipScale('nonsense') === 1, JSON.stringify([ns.chipScale(undefined), ns.chipScale('nonsense')]), '1')
}

/*
 * 14b. The cap that keeps the tallest chip inside the collapsed header line. The host
 * pins that line to `24px + var(--dsh-content-font-delta)` and clips it, so the chip's
 * own line height is capped against the very variable the host publishes — read from
 * `body`, because that is the only place it is defined.
 */
{
  const cap = () => ns.chipLineCap()
  bodyFontSize = 14
  check('at the reader body size the cap is the header line less the chip frame', cap() === 'calc(21px + 0px)', String(cap()))
  bodyFontSize = 22
  check('a larger reader body size raises the cap with it', cap() === 'calc(21px + 8px)', String(cap()))
  bodyFontSize = 10
  check('a smaller reader body size lowers the cap with it', cap() === 'calc(21px + -4px)', String(cap()))
  /*
   * The property is only there because the host publishes it. A platform (or a test
   * double) without it must not turn into a chip with no line height at all.
   */
  const withStyle = window.getComputedStyle
  window.getComputedStyle = () => ({ getPropertyValue: () => '' })
  check('a missing host variable means no cap, not a broken one', cap() === 'none', String(cap()))
  window.getComputedStyle = () => ({ getPropertyValue: () => 'not-a-length' })
  check('a garbage host value is refused, not obeyed', cap() === 'none', String(cap()))
  window.getComputedStyle = () => ({ getPropertyValue: () => '9999px' })
  check('an absurd host value is refused too', cap() === 'none', String(cap()))
  window.getComputedStyle = () => {
    throw new Error('no computed style here')
  }
  check('an unreadable computed style is survivable', cap() === 'none', String(cap()))
  window.getComputedStyle = withStyle
  bodyFontSize = 14
  /* Arithmetic the stylesheet then performs: the capped box plus the frame fits the line. */
  const tallest = 16 * (1 + (ns.chipScale(22) - 1) * 0.667)
  check('the tallest chip box fits the 24px header line with its frame', tallest + 2 <= 24, String(tallest + 2), '<=24')
  const smallest = 16 * (1 + (ns.chipScale(10) - 1) * 0.667)
  check('the smallest chip box stays readable', smallest >= 12, String(smallest), '>=12')
}

// 15. What a mark is given: the text style, its own ink and its own size.
{
  const plain = ns.markStyle({ color: '#dc2626' })
  check('a bare keyword still gets a colour and a size', plain.color === 'currentColor' && plain.fontSize === '14px', JSON.stringify(plain), 'currentColor/14px')
  const inked = ns.markStyle({ color: '#dc2626', textColor: '#2563eb', fontSize: 18 })
  check('the chosen ink and size ride the mark', inked.color === '#2563eb' && inked.fontSize === '18px', JSON.stringify(inked), '#2563eb/18px')
  const styled = ns.markStyle({ color: '#dc2626', bold: true, italic: true, underline: true, font: 'mono' })
  check('bold, italic, underline and the typeface still ride it too', styled.fontWeight === '600' && styled.fontStyle === 'italic' && styled.textDecoration === 'underline' && styled.fontFamily === 'var(--ds-font-family-code)', JSON.stringify(styled), 'all four')
  check('the background colour never rides the mark', styled.backgroundColor === undefined && inked.backgroundColor === undefined, JSON.stringify([styled.backgroundColor, inked.backgroundColor]), 'undefined')
  check('no item means no style at all', ns.markStyle(undefined) === null && ns.markStyle(null) === null, String(ns.markStyle(undefined)), 'null')
  /* A size outside the range cannot reach the DOM as written. */
  check('an out-of-range size is clamped before it reaches the mark', ns.markStyle({ color: '#dc2626', fontSize: 900 }).fontSize === '22px', ns.markStyle({ color: '#dc2626', fontSize: 900 }).fontSize, '22px')
  /* Inherited ink must never be written as a literal, or the eye-off rule would have
     nothing to hand back and a theme flip would leave the word unreadable. */
  check('the followed colour is written as currentColor, not a fixed hex', ns.markStyle({ color: '#dc2626', textColor: null }).color === 'currentColor', ns.markStyle({ color: '#dc2626', textColor: null }).color, 'currentColor')
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
