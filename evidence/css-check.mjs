/**
 * Static sanity check of the plugin's stylesheet literal: it must exist, carry the
 * chip rules, and balance its braces — a stray backtick or brace in this template
 * literal either breaks the bundle's syntax or silently drops every rule after it.
 *
 *   node evidence/css-check.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

const open = 'const CSS = `'
const start = source.indexOf(open)
/*
 * The literal's closing backtick owns its own line; doc comments later in the file
 * also carry backticks, so anchoring on a line start is what finds the right one.
 * The `\r?` matters: a Windows checkout (core.autocrlf) ends that line with CRLF, and
 * without it the whole stylesheet silently reads as empty here while the browser is
 * perfectly happy with the very same file.
 */
const closing = /^`\r?$/m.exec(source.slice(start + open.length))
const end = start < 0 || closing === null ? -1 : start + open.length + closing.index
const css = start < 0 || end < 0 ? '' : source.slice(start + open.length, end)

const checks = []
const check = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail })
const count = (needle) => css.split(needle).length - 1

check('the stylesheet literal is present', css.length > 1000, css.length + ' bytes')
check('braces balance', count('{') === count('}'), count('{') + ' open / ' + count('}') + ' close')
check('chip group rule exists', css.includes('.dsh-th-chips{'), 'present')
check('chip set rule exists', css.includes('.dsh-th-badge-set{'), 'present')
check('chip frame rule exists', /\.dsh-th-badge\{[^}]*border:1px solid transparent/.test(css), 'present')
check('chip name keeps the host colour', /\.dsh-th-badge-name\{[^}]*color:inherit/.test(css), 'present')
check('nothing in the chip set shrinks', /\.dsh-th-badge-set\{[^}]*flex:none/.test(css) && /\.dsh-th-chips\{[^}]*flex:none/.test(css), 'present')
check('no percentage cap in the chip rules', /\.dsh-th-(badge-set|chips)\{[^}]*max-width:\s*\d+%/.test(css) === false, 'absent')
check('the chip reads as a button, not a span', /\.dsh-th-badge\{[^}]*font:inherit/.test(css) && /\.dsh-th-badge\{[^}]*cursor:pointer/.test(css), 'present')
check('the muted chip drops every keyword colour', /\.dsh-th-badge\[data-muted="1"\][^{]*\{[^}]*border-color:var\(--dsw-alias-border-l3\)/.test(css), 'present')
check('the muted chip is dashed, so off never looks like on', /\.dsh-th-badge\[data-muted="1"\][^{]*\{[^}]*border-style:dashed/.test(css), 'present')
check('the style disclosure and its panel exist', css.includes('.dsh-th-disc{') && css.includes('.dsh-th-panel{'), 'present')
check('the whole-word button sits where the colour used to', css.includes('.dsh-th-whole{') && css.includes('.dsh-th-kwrow{'), 'present')
check('the panel carries font, style toggles and a darker surface', css.includes('.dsh-th-select{') && css.includes('.dsh-th-style{') && /\.dsh-th-panel\{[^}]*background:var\(--dsw-alias-bg-module-platform/.test(css), 'present')
check('a refused duplicate shows its warning', css.includes('.dsh-th-warn{') && /\.dsh-th-input\[aria-invalid="true"\]\{[^}]*border-color/.test(css), 'present')
check('settings rows mirror the host row', /\.dsh-th-setrow\{[^}]*border-bottom:\.5px solid var\(--dsw-alias-border-l2\)/.test(css) && /\.dsh-th-setdesc\{[^}]*color:var\(--dsw-alias-label-secondary\)/.test(css), 'present')
/* The keyword list's heading is a settings row without its hairline, and its padding
   is balanced around the text so the heading binds to the list below it. */
check(
  'the keyword group heading draws no hairline and is padded around its text',
  /\.dsh-th-grouphead\{[^}]*border-bottom:0/.test(css) && /\.dsh-th-grouphead\{[^}]*padding:14px 0 4px/.test(css),
  'present',
)
check('settings controls use the host filled look', /\.dsh-th-seg\{[^}]*background:var\(--dsw-alias-interactive-bg-hover\)/.test(css) && /\.dsh-th-whole\{[^}]*background:var\(--dsw-alias-interactive-bg-hover\)/.test(css) && /\.dsh-th-add\{[^}]*background:var\(--dsw-alias-interactive-bg-hover\)/.test(css), 'present')
check('the page title is bold and a step larger', /\.dsh-th-heading\{[^}]*font-size:18px/.test(css) && /\.dsh-th-heading\{[^}]*font-weight:600/.test(css), 'present')
/*
 * The eye keeps the marks in the DOM and hides them here, so this rule is the whole
 * of "off": it has to neutralise the keyword's own type styling too, not just the tint
 * (a bold keyword stayed bold with its tint gone, which reads as "off did not work").
 * The text colour and the size are part of that: leaving them out would make the eye a
 * half-switch, with a recoloured or resized word still standing out with its tint gone.
 */
check(
  'an eye-off row neutralises the tint and the keyword type styling',
  /\[data-dsh-hl="off"\] \.dsh-th-body \.dsh-th-hit\{[^}]*background-color:transparent !important/.test(css) &&
    /\[data-dsh-hl="off"\] \.dsh-th-body \.dsh-th-hit\{[^}]*font-weight:inherit !important/.test(css) &&
    /\[data-dsh-hl="off"\] \.dsh-th-body \.dsh-th-hit\{[^}]*font-style:inherit !important/.test(css) &&
    /\[data-dsh-hl="off"\] \.dsh-th-body \.dsh-th-hit\{[^}]*text-decoration:inherit !important/.test(css) &&
    /\[data-dsh-hl="off"\] \.dsh-th-body \.dsh-th-hit\{[^}]*font-family:inherit !important/.test(css) &&
    /\[data-dsh-hl="off"\] \.dsh-th-body \.dsh-th-hit\{[^}]*color:inherit !important/.test(css) &&
    /\[data-dsh-hl="off"\] \.dsh-th-body \.dsh-th-hit\{[^}]*font-size:inherit !important/.test(css),
  'present',
)
/*
 * The chip scales with its keyword's size, and it has to do so through the factors the
 * chip element carries: a chip on a collapsed row sits on a fixed-height header line, so
 * the scale is what bounds its growth and the line cap is what keeps it inside that line.
 * The fallbacks matter too — a keyword left at the default size is then exactly the chip
 * it always was, and a platform without the host's variable is not left with no height.
 */
check(
  'the chip scales with its keyword through its own factor',
  /\.dsh-th-badge\{[^}]*font-size:calc\(12px \* var\(--dsh-th-chip-scale,1\)\)/.test(css) &&
    /\.dsh-th-badge\{[^}]*line-height:min\(calc\(16px \* \(1 \+ \(var\(--dsh-th-chip-scale,1\) - 1\) \* \.667\)\),var\(--dsh-th-chip-line,none\)\)/.test(css),
  'present',
)
/* Padding stays in px: the chip's box must not grow a second time with its text. */
check('the chip keeps its own box measurements fixed', /\.dsh-th-badge\{[^}]*padding:0 6px/.test(css) && /\.dsh-th-badge\{[^}]*gap:4px/.test(css), 'present')
check('the text colour and size controls have their rules', css.includes('.dsh-th-follow{') && css.includes('.dsh-th-size{') && css.includes('.dsh-th-arrow{'), 'present')
check(
  'a stepper arrow at either end of the range reads as dead',
  /\.dsh-th-arrow:disabled\{[^}]*cursor:not-allowed/.test(css),
  'present',
)
check('the panel no longer hard-codes a chip size', /\.dsh-th-badge\{[^}]*font-size:12px/.test(css) === false, 'absent')
const stray = css.split('\n').find((line) => line.includes('`'))
check('the literal closes at a line of its own', end > 0 && stray === undefined, stray === undefined ? 'ok' : 'stray line: ' + stray.trim())

let failed = 0
for (const result of checks) {
  if (!result.pass) failed += 1
  console.log((result.pass ? 'PASS  ' : 'FAIL  ') + result.name + (result.pass ? '' : '  (' + result.detail + ')'))
}
console.log('\n' + (checks.length - failed) + '/' + checks.length + ' checks passed')
process.exit(failed === 0 ? 0 : 1)
