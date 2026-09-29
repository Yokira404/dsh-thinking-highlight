/**
 * Client half of @local/dsh-thinking-highlight.
 *
 * Two contributions, both registered inside `apply` so unloading the plugin
 * removes them:
 *
 *  1. its own Settings section (`settings.section`, id `dsh-thinking-highlight`):
 *     a left-hand nav row plus a page — language, plugin switch, case matching, a
 *     divider, then the keyword list with color pickers and an add button. The
 *     page also declares and renders the child list slot
 *     `settings.thinking-highlight.item`, so later features (and other packages)
 *     can add rows without touching this file's layout;
 *  2. a decoration of the Chat reasoning rows. The shipped reasoning row
 *     (`data-variant="think"`) is a sealed primitive that exposes no slot, so
 *     the only seat available is the rendered DOM: its header's own text line
 *     gains a keyword-count chip set plus the eye toggle — inline, right after
 *     the title — and its expanded body's keyword occurrences are outlined in
 *     the keyword's color. The reconciler writes only `nodeValue` and splits
 *     text nodes, so React keeps updating the same text nodes in place and never
 *     meets a foreign child element.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-thinking-highlight',
  factory(require) {
    const React = require('react')
    const ReactDOMClient = require('react-dom/client')

    /* ───────────────────────────── constants ───────────────────────────── */

    const NS = 'dsh-thinking-highlight'
    const VERSION = '1.0'
    const STORAGE_KEY = 'dsh-thinking-highlight.state.v1'
    const ROW_SELECTOR = '[data-variant="think"]'
    const BODY_CLASS = 'dsh-th-body'
    const MARK = 'data-dsh-th'
    const DEFAULT_KEYWORDS = ['提示词', '但']
    const DEFAULT_COLOR = '#dc2626'
    const TINT_ALPHA = 0.24
    /** Upper bound on active keywords, so one wild pattern can never be built. */
    const MAX_KEYWORDS = 200

    /* ──────────────────────────── preferences ──────────────────────────── */

    let rowSeq = 0

    function nextRowId() {
      rowSeq += 1
      return 'kw' + Date.now().toString(36) + '-' + rowSeq
    }

    function hex(value) {
      const text = typeof value === 'string' ? value.trim() : ''
      return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : DEFAULT_COLOR
    }

    /** Fresh-install defaults; stored fields are merged over these. */
    function defaults() {
      return {
        lang: 'zh',
        enabled: true,
        caseSensitive: false,
        /* A collapsed row shows its chip set unless the reader turns this off. */
        chipsWhenCollapsed: true,
        /*
         * Off by default: it reaches outside the plugin and drops a height cap the
         * host put on a folded process group, so it stays an explicit opt-in.
         */
        liftOnExpand: false,
        /*
         * Keyword ids the reader switched off by clicking their chip in the
         * transcript. Kept as ids so a keyword keeps its state while its text is
         * edited, and pruned whenever its row is gone.
         */
        muted: [],
        rows: DEFAULT_KEYWORDS.map((text) => ({ id: nextRowId(), text, color: DEFAULT_COLOR })),
      }
    }

    /** Prefer browser persistence; a storage-blocked page keeps the state live in memory. */
    function readStore() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        return raw ? JSON.parse(raw) : null
      } catch (error) {
        return null
      }
    }

    function writeStore(value) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
      } catch (error) {
        /* private mode: keep the in-memory value */
      }
    }

    function screenRow(row, index) {
      return {
        id: typeof row?.id === 'string' && row.id ? row.id : 'kw-restored-' + index,
        text: typeof row?.text === 'string' ? row.text : '',
        color: hex(row?.color),
      }
    }

    /** One id in or out of a list, as a new array; both toggles share this. */
    function toggleIn(list, id) {
      const next = new Set(Array.isArray(list) ? list : [])
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return [...next]
    }

    function loadState() {
      const base = defaults()
      const raw = readStore()
      if (raw === null || typeof raw !== 'object') return base
      base.lang = raw.lang === 'en' ? 'en' : 'zh'
      base.enabled = raw.enabled !== false
      base.caseSensitive = raw.caseSensitive === true
      base.chipsWhenCollapsed = raw.chipsWhenCollapsed !== false
      base.liftOnExpand = raw.liftOnExpand === true
      const stored = Array.isArray(raw.rows) ? raw.rows : []
      if (stored.length > 0) base.rows = stored.slice(0, MAX_KEYWORDS).map(screenRow)
      /* A keyword that no longer exists cannot stay muted. */
      base.muted = (Array.isArray(raw.muted) ? raw.muted : []).filter(
        (id) => typeof id === 'string' && base.rows.some((row) => row.id === id),
      )
      return base
    }

    let state = loadState()
    let snapshot = buildSnapshot()
    const listeners = new Set()

    function buildSnapshot() {
      return {
        lang: state.lang,
        enabled: state.enabled,
        caseSensitive: state.caseSensitive,
        chipsWhenCollapsed: state.chipsWhenCollapsed,
        liftOnExpand: state.liftOnExpand,
        muted: state.muted.slice(),
        rows: state.rows.map((row, index) => ({ ...row, key: 'r' + index + '-' + row.id })),
      }
    }

    /** Apply a patch, persist it, and republish the frozen snapshot. */
    function patch(changes) {
      state = { ...state, ...changes }
      snapshot = buildSnapshot()
      writeStore(state)
      publish()
    }

    /** Read the browser's stored copy again, without writing anything back. */
    function reloadFromStore() {
      state = loadState()
      snapshot = buildSnapshot()
      publish()
    }

    function publish() {
      for (const listener of [...listeners]) {
        try {
          listener()
        } catch (error) {
          /* one bad subscriber must not block the rest */
        }
      }
    }

    function subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }

    function useSettings() {
      if (typeof React.useSyncExternalStore === 'function') {
        return React.useSyncExternalStore(subscribe, () => snapshot, () => snapshot)
      }
      const [value, setValue] = React.useState(snapshot)
      React.useEffect(() => subscribe(() => setValue(snapshot)), [])
      return value
    }

    /* ────────────────────────────── dictionaries ───────────────────────── */

    const TEXT = {
      zh: {
        nav: '标红插件',
        title: '标红插件',
        lead: '统计思考行里出现的提示词并在思维链中标红；右侧眼睛按钮控制这一行的高亮显示。',
        language: '语言',
        enabled: '插件开关',
        caseSensitive: '不区分大小写',
        chipsWhenCollapsed: '折叠时显示标注',
        liftOnExpand: '展开时撑开思考框',
        liftOnExpandHint: '默认关闭。DSH 把一轮的过程收进一个最高 400px、可滚动的框里；如果你展开的思考被这个框截断（后面的内容要框内滚动才看得到），打开这一项，插件会在展开时临时去掉那个高度上限。',
        keywords: '提示词与颜色',
        version: '版本',
        add: '添加提示词',
        remove: '删除',
        keywordPlaceholder: '输入提示词…',
        reset: '恢复默认',
        empty: '还没有提示词；点上面的「添加提示词」新增一条。',
        showHighlight: '显示高亮',
        hideHighlight: '隐藏高亮',
        rowToggle: '这一行的高亮显示',
        chipMute: '点击关闭这个词的标红',
        chipUnmute: '已关闭，点击恢复这个词的标红',
        mute: '抑制',
        unmute: '已抑制',
        muteHint: '抑制后这个词不再标红，徽章保留（对话里点徽章也是同一个开关）',
      },
      en: {
        nav: 'Thinking Highlighter',
        title: 'Thinking Highlighter',
        lead: 'Counts the keywords below inside thinking rows and highlights them in the chain of thought; the eye button on the right toggles highlighting for that row.',
        language: 'Language',
        enabled: 'Plugin',
        caseSensitive: 'Match case',
        chipsWhenCollapsed: 'Chips when collapsed',
        liftOnExpand: 'Expand lifts the box',
        liftOnExpandHint: 'Off by default. DSH folds one turn’s process into a scroll box capped at 400px; if an expanded row is clipped by it, turn this on and the plugin drops that cap while a row is open.',
        keywords: 'Keywords and colors',
        version: 'version',
        add: 'Add keyword',
        remove: 'Remove',
        keywordPlaceholder: 'Type a keyword…',
        reset: 'Restore defaults',
        empty: 'No keywords yet — use “Add keyword” to create one.',
        showHighlight: 'Show highlighting',
        hideHighlight: 'Hide highlighting',
        rowToggle: 'Highlighting for this row',
        chipMute: 'Click to stop highlighting this keyword',
        chipUnmute: 'Off — click to highlight this keyword again',
        mute: 'Suppress',
        unmute: 'Suppressed',
        muteHint: 'A suppressed keyword stops being highlighted; its chips stay in place (the chips in the transcript are the same switch)',
      },
    }

    /**
     * The label set for one language. A missing key degrades to readable text
     * instead of `undefined`, because an undefined label would reach a rendered
     * node or a title attribute.
     */
    function dict(lang) {
      const source = TEXT[lang] ?? TEXT.zh
      return new Proxy(source, {
        get(target, key) {
          if (typeof key !== 'string') return target[key]
          const value = target[key] ?? TEXT.zh[key]
          return typeof value === 'string' ? value : key
        },
      })
    }

    /* ─────────────────────────────── styles ────────────────────────────── */

    /**
     * Every color comes from a --dsw-alias-* token so light and dark follow the
     * host theme. The keyword color is the only authored color, because it is
     * the user's own choice.
     */
    const CSS = `/*
 * The chip set lives on the header's own text line, next to the title. Nothing in
 * it may shrink: the collapsed preview beside it is flex-auto, so a shrinkable
 * chip set would be squeezed by a long preview and clip its own chips away. The
 * chip group caps at a fixed width instead (a percentage cap cannot be resolved
 * inside a line sized by max-content) and clips only its own overflow, which keeps
 * the eye whole and the preview beside it.
 */
.dsh-th-badge-set{display:inline-flex;align-items:center;gap:6px;min-width:0;flex:none;margin-left:8px}
.dsh-th-chips{display:inline-flex;align-items:center;gap:6px;min-width:0;flex:none;max-width:420px;overflow:hidden}
.dsh-th-badge{display:inline-flex;align-items:center;gap:4px;flex:none;padding:0 6px;border-radius:6px;font:inherit;font-size:12px;line-height:16px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover);border:1px solid transparent;cursor:pointer}
.dsh-th-badge[data-count="1"]{color:var(--dsw-alias-label-tertiary)}
.dsh-th-badge:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
.dsh-th-badge:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
/*
 * Switched off from the chip itself. The chip keeps its place and its count — it
 * is the switch that turns the keyword back on — but drops the keyword colour
 * everywhere, so a muted chip cannot be mistaken for a highlighted one.
 */
.dsh-th-badge[data-muted="1"],.dsh-th-badge[data-muted="1"][data-count="1"]{border-style:dashed;border-color:var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-dimmed)}
.dsh-th-badge[data-muted="1"] .dsh-th-count{color:inherit}
.dsh-th-badge[data-muted="1"] .dsh-th-badge-x{opacity:.35}
.dsh-th-badge-name{display:inline-block;max-width:7em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit;background:transparent}
.dsh-th-badge-x{opacity:.55}
.dsh-th-count{color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.dsh-th-acts{display:flex;align-items:center;flex:none;margin-left:2px}
.dsh-th-eye{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:.45;transition:opacity 120ms ease,color 120ms ease,background-color 120ms ease}
[data-open]:hover .dsh-th-eye,.dsh-th-eye:focus-visible{opacity:1}
.dsh-th-eye:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-th-eye:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-body .dsh-th-hit{border-radius:3px}
[data-dsh-hl="off"] .dsh-th-body .dsh-th-hit{background-color:transparent !important}
.dsh-th-section{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsh-th-head{display:flex;flex-direction:column;gap:4px}
.dsh-th-heading{display:flex;align-items:center;gap:8px;margin:0;font-size:18px;font-weight:600;line-height:26px}
.dsh-th-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.dsh-th-group{display:flex;flex-direction:column;gap:16px;padding:2px 0 4px}
.dsh-th-tag{padding:0 6px;border-radius:6px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);font-variant-numeric:tabular-nums}
.dsh-th-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dsh-th-stack{display:flex;flex-direction:column;gap:4px}
.dsh-th-hint{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-th-label{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dsh-th-seg{display:inline-flex;padding:2px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover)}
.dsh-th-seg-item{padding:3px 12px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}
.dsh-th-seg-item[data-on]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsh-th-seg-item:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-switch{position:relative;flex:none;width:36px;height:20px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer}
.dsh-th-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dsh-th-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-th-knob{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}
.dsh-th-switch[aria-checked="false"] .dsh-th-knob{background:var(--dsw-alias-switch-thumb)}
.dsh-th-switch[aria-checked="true"] .dsh-th-knob{transform:translateX(16px)}
.dsh-th-hr{height:1px;background:var(--dsw-alias-border-l1)}
.dsh-th-kws{display:flex;flex-direction:column;gap:8px}
.dsh-th-kw{display:flex;align-items:center;gap:8px}
.dsh-th-input{flex:1;min-width:0;height:32px;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px;outline:none}
.dsh-th-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.dsh-th-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.dsh-th-color{position:relative;display:inline-flex;flex:none;align-items:center;gap:6px;height:32px;padding:0 8px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.dsh-th-swatch{position:absolute;inset:0;width:100%;height:100%;opacity:0;padding:0;border:0;cursor:pointer}
.dsh-th-dot{width:14px;height:14px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.dsh-th-hex{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dsh-th-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-th-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}
.dsh-th-icon:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-empty{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-th-mute{flex:none;padding:4px 8px;border:0.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11px;line-height:16px;cursor:pointer}
.dsh-th-mute:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-th-mute[aria-pressed="true"]{border-style:dashed;border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-dimmed)}
.dsh-th-mute:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-foot{display:flex;align-items:center;gap:8px}
.dsh-th-add{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:0.5px dashed var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer}
.dsh-th-add:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-th-add:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-reset{margin-left:auto;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}
.dsh-th-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`

    /**
     * Insert the stylesheet through the client `styles` builtin. A platform that
     * does not expose it falls back to a plain style element, so styling can
     * never be the reason this plugin fails to activate.
     */
    function insertStyles(css) {
      try {
        const builtin = typeof window === 'undefined' ? undefined : window.styles
        if (builtin !== undefined && typeof builtin.insert === 'function') return builtin.insert(css)
      } catch (error) {
        console.error('[' + NS + '] styles builtin failed', error)
      }
      const tag = document.createElement('style')
      tag.setAttribute(MARK, 'style')
      tag.textContent = css
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }

    /* ────────────────────────────── icons ─────────────────────────────── */

    function EyeIcon(props) {
      const children = [
        React.createElement('path', {
          key: 'eye',
          d: 'M2.6 10S5.6 4.6 10 4.6 17.4 10 17.4 10 14.4 15.4 10 15.4 2.6 10 2.6 10Z',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinejoin: 'round',
        }),
        React.createElement('circle', { key: 'pupil', cx: 10, cy: 10, r: 2.3, fill: 'currentColor' }),
      ]
      if (props.slashed === true) {
        children.push(
          React.createElement('path', {
            key: 'slash',
            d: 'M4.4 15.6 15.6 4.4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.5,
            strokeLinecap: 'round',
          }),
        )
      }
      return React.createElement(
        'svg',
        { viewBox: '0 0 20 20', width: 16, height: 16, 'aria-hidden': 'true', focusable: 'false', style: { display: 'block' } },
        children,
      )
    }

    function PlusIcon() {
      return React.createElement(
        'svg',
        { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true', focusable: 'false' },
        React.createElement('path', {
          d: 'M8 3v10M3 8h10',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
        }),
      )
    }

    function TrashIcon() {
      return React.createElement(
        'svg',
        { viewBox: '0 0 16 16', width: 14, height: 14, 'aria-hidden': 'true', focusable: 'false' },
        React.createElement('path', {
          d: 'M3.5 4.5h9M6.5 4.5V3h3v1.5M5 4.5l.6 8h4.8l.6-8',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    /* ────────────────────────── keyword engine ─────────────────────────── */

    function escapeRegExp(text) {
      return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    }

    /**
     * One combined pattern for the whole keyword list, longest keyword first so
     * an overlapping shorter one cannot win. A fresh stateful RegExp per node,
     * because `lastIndex` lives on the instance.
     */
    function buildPattern(items, caseSensitive) {
      const active = items.filter((item) => item.text.length > 0).slice(0, MAX_KEYWORDS)
      if (active.length === 0) return null
      const ordered = [...active].sort((left, right) => right.text.length - left.text.length)
      return new RegExp(ordered.map((item) => '(' + escapeRegExp(item.text) + ')').join('|'), caseSensitive ? 'g' : 'gi')
    }

    function countMatches(text, item, caseSensitive) {
      if (!text || !item.text) return 0
      const pattern = new RegExp(escapeRegExp(item.text), caseSensitive ? 'g' : 'gi')
      let count = 0
      while (pattern.exec(text) !== null) {
        count += 1
        if (count >= 5000 || pattern.lastIndex === 0) break
      }
      return count
    }

    function toTint(color, alpha) {
      const value = hex(color)
      const red = parseInt(value.slice(1, 3), 16)
      const green = parseInt(value.slice(3, 5), 16)
      const blue = parseInt(value.slice(5, 7), 16)
      return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + alpha + ')'
    }

    /* ──────────────────────── reasoning-row decoration ─────────────────── */

    /** Per-row state and per-body mark records; WeakMaps let removed rows be collected. */
    const rows = new WeakMap()
    const marks = new WeakMap()

    function stateOf(root) {
      let entry = rows.get(root)
      if (entry === undefined) {
        entry = { highlighted: true, count: 0 }
        rows.set(root, entry)
      }
      return entry
    }

    /**
     * A row's text without the chip set the plugin itself inserted. The chips repeat
     * every keyword next to its count, so counting from `textContent` fed our own
     * output back into the counts: the pass after a paint read `is × 22` and counted
     * 23, the next one 24, and the numbers crept up for as long as the row stayed on
     * screen — every repaint being a fresh mutation that scheduled the next pass.
     *
     * Only the chip set is skipped, by its own marker value: the highlight spans are
     * `data-dsh-th` too, and skipping *those* would drop every already-highlighted
     * occurrence out of the text — the counts would collapse to zero on the next
     * pass and take the chips with them.
     */
    function unmarkedText(node) {
      let out = ''
      const walk = (current) => {
        for (const child of current.childNodes) {
          if (child.nodeType === 3) out += child.nodeValue ?? ''
          else if (child.nodeType === 1 && child.getAttribute(MARK) !== 'badges') walk(child)
        }
      }
      walk(node)
      return out
    }

    /** The disclosure header row: the row that owns the expandable `[data-open]` marker. */
    function headerRowOf(root) {
      for (const candidate of root.querySelectorAll('div[data-open]')) return candidate
      const first = root.firstElementChild
      if (first === null) return null
      return first.querySelector('div[data-open]') ?? first
    }

    /**
     * The expanded chain-of-thought container. Rows vary: the wrapper may be
     * absent, present, or the body may be laid out differently, so the class is
     * stamped on whichever element is found and every later pass finds it by
     * class. A collapsed row has no body and correctly returns null.
     */
    function bodyOf(root) {
      /*
       * A stamp on an element the host has already replaced is worse than no stamp:
       * the pass would keep marking a body nobody can see. Only a connected stamp
       * counts, and anything else falls through to a fresh structural lookup.
       */
      const own = root.querySelector('.' + BODY_CLASS)
      if (own !== null && own !== undefined && own.isConnected !== false) return own
      const wrapped = root.querySelector('[data-turn-process-inline] > div')
      if (wrapped !== null && wrapped !== undefined) {
        wrapped.classList.add(BODY_CLASS)
        return wrapped
      }
      const header = headerRowOf(root)
      const first = root.firstElementChild
      if (first === null || first === undefined) return null
      const candidate = first === header ? first.nextElementSibling : first
      if (candidate === null || candidate === undefined || candidate.nodeType !== 1) return null
      candidate.classList.add(BODY_CLASS)
      return candidate
    }

    /* ── the folded box DSH clips an expanded body with ─────────────────────── */

    /**
     * Capped scroll ancestors the plugin uncapped, with the inline value to put
     * back. A turn's process group keeps its body in `max-height: min(400px, 50vh)`
     * with `overflow-y: auto` and a bottom fade, so an expanded chain of thought
     * taller than the box is clipped: the reader sees the first lines fade out and
     * the rest is only reachable by scrolling inside a box that does not look
     * scrollable. Expanding a row is an explicit "read this" act, so while a row is
     * open the plugin drops that cap and lets the transcript carry the height.
     */
    const lifts = new Map()

    /**
     * Shortest box the plugin will uncap. The turn rail's hover preview keeps its
     * content in a ~100px scroller of its own; uncapping that would wreck the
     * preview instead of helping anyone.
     */
    const LIFT_MIN_HEIGHT = 160

    /** Put one box's own cap back, exactly as it was. */
    function restoreLift(box) {
      if (lifts.has(box) !== true) return
      const previous = lifts.get(box)
      lifts.delete(box)
      if (previous === '') box.style.removeProperty('max-height')
      else box.style.maxHeight = previous
    }

    /**
     * The nearest ancestor that both scrolls its own overflow and carries a
     * `max-height` — the box whose bottom edge was cutting the row off. Uncapped
     * scrollers above it (the transcript itself) are passed over, because their
     * height comes from the layout rather than from a cap of their own.
     */
    function liftSeatOf(root) {
      if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') return null
      let node = root.parentElement
      while (node !== null && node !== document.body && node !== document.documentElement) {
        const style = window.getComputedStyle(node)
        const overflow = style.overflowY
        if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') && style.maxHeight !== 'none' && style.maxHeight !== '') {
          return node.clientHeight >= LIFT_MIN_HEIGHT ? node : null
        }
        node = node.parentElement
      }
      return null
    }

    /** Keep one open row's folded box uncapped; every pass re-asserts it. */
    function liftForRow(root) {
      const box = liftSeatOf(root)
      if (box === null) return
      if (lifts.has(box) !== true) lifts.set(box, box.style.maxHeight ?? '')
      if (box.style.maxHeight !== 'none') box.style.maxHeight = 'none'
    }

    /**
     * Whether an open row lives inside this box right now. Asked of the rows the
     * reconciler already walks instead of a CSS selector, so "open" means exactly
     * what `isExpanded` means everywhere else.
     */
    function openRowIn(box) {
      for (const root of liveRoots()) {
        if (box.contains(root) !== true) continue
        const header = headerRowOf(root)
        if (header !== null && isExpanded(root, header)) return true
      }
      return false
    }

    /**
     * Put back every cap whose box no longer holds an open row, and re-assert the
     * ones that still do — the app re-rendering the box would otherwise silently
     * restore its cap under an open row, and a collapsed row would leave its box
     * uncapped forever.
     */
    function sweepLifts(on) {
      for (const box of [...lifts.keys()]) {
        if (on !== true || box.isConnected !== true || openRowIn(box) !== true) {
          restoreLift(box)
          continue
        }
        if (box.style.maxHeight !== 'none') box.style.maxHeight = 'none'
      }
    }

    /**
     * Where one row's chip set sits: inside the disclosure header's own text line,
     * right after the title and its separator, ahead of the collapsed preview.
     *
     * The shipped header is `[data-open] > [data-disclosure-row] > (leading glyph,
     * TextShimmer root > content line > title, separator, summary)`. The chip set
     * must be a sibling *inside that content line*: anywhere else in the header
     * (the old mistake was the `[data-open]` block itself) is a second flex line of
     * a container that is a fixed 24px tall with `contain: size layout` while the
     * row is collapsed, so the chips were laid out under the row instead of on it.
     *
     * `before` is the first sibling after the title that carries text, which is the
     * preview summary; `null` means "at the end of the line".
     */
    function chipSeatOf(header) {
      const line = header.querySelector('[data-disclosure-row]')
      if (line === null) return { parent: header, before: null }
      const contentRoot = line.children.length > 1 ? line.children[1] : line
      const contentLine = contentRoot.firstElementChild ?? contentRoot
      let title = contentLine.firstElementChild
      if (title === null) return { parent: contentLine, before: null }
      let before = title.nextElementSibling
      /* Skip the separator dot and our own chip set: the seat is before the preview. */
      while (before !== null && (before.hasAttribute(MARK) || (before.textContent ?? '').trim() === '')) {
        before = before.nextElementSibling
      }
      return { parent: contentLine, before }
    }

    /**
     * Whether the row is open. The shipped reasoning row stamps `data-expanded` on
     * itself and `data-open` on its disclosure header only while expanded, and a
     * collapsed row renders no body at all.
     */
    function isExpanded(root, header) {
      return root.hasAttribute('data-expanded') === true || header.hasAttribute('data-open') === true
    }

    function unmountBadges(entry) {
      if (entry.mount === undefined) return
      if (entry.mountReact !== undefined) {
        try {
          entry.mountReact.unmount()
        } catch (error) {
          /* the host may already have detached the container */
        }
      }
      try {
        entry.mount.remove()
      } catch (error) {
        /* already gone */
      }
      entry.mount = undefined
      entry.mountReact = undefined
      entry.mountKey = undefined
      entry.mountParent = undefined
    }

    /**
     * Render the chip set into the plugin's own container. React owns every node
     * inside it, so the host tree never re-renders or removes anything of ours.
     */
    function paintBadges(entry, children, labels) {
      const container = entry.mount
      if (container === undefined || container.isConnected !== true) return
      try {
        if (entry.mountReact === undefined) {
          entry.mountReact = ReactDOMClient.createRoot(container, { onRecoverableError: () => {} })
        }
        container.lang = labels === undefined ? 'zh-CN' : labels.lang
        entry.mountReact.render(React.createElement(React.Fragment, null, children))
      } catch (error) {
        console.error('[' + NS + '] badge render failed', error)
        entry.mountReact = undefined
      }
    }

    /**
     * Mount or update one row's chip set: a chip per keyword that occurs in this
     * block, then the eye toggle. Returns before touching React when nothing
     * about the row changed, which is what keeps streaming cheap.
     */
    function decorate(root, entry, counts, colors, options) {
      const header = headerRowOf(root)
      if (header === null) return
      const eye = (next) => {
        entry.highlighted = next
        setHighlight(root, next === true && options.enabled === true)
        decorate(root, entry, counts, colors, options)
      }
      const children = []
      const chips = []
      for (const item of counts) {
        const muted = item.muted === true
        const hint = item.text + ' × ' + item.count + ' · ' + (muted ? options.labels.chipUnmute : options.labels.chipMute)
        chips.push(
          React.createElement(
            'button',
            {
              key: item.id,
              type: 'button',
              className: 'dsh-th-badge',
              'data-count': String(item.count),
              'data-muted': muted ? '1' : undefined,
              'aria-pressed': muted ? 'false' : 'true',
              'aria-label': hint,
              title: hint,
              /*
               * The keyword's color rides the chip's own frame. The name keeps the
               * host's text color and the chip keeps its neutral background, so the
               * name can never end up the same color as the surface behind it. A
               * muted chip carries no inline color at all: the stylesheet's dashed,
               * dimmed frame is what says "off".
               */
              style: muted ? undefined : { borderColor: colors[item.text] },
              /*
               * The chip is also this keyword's switch. The click stops at the
               * chip so it cannot also fold or unfold the row it sits on.
               */
              onClick(event) {
                event.preventDefault()
                event.stopPropagation()
                if (typeof options.onToggleKeyword === 'function') options.onToggleKeyword(item.id)
              },
            },
            React.createElement('span', { className: 'dsh-th-badge-name' }, item.text),
            React.createElement('span', { className: 'dsh-th-badge-x' }, '×'),
            React.createElement('span', { className: 'dsh-th-count' }, String(item.count)),
          ),
        )
      }
      /*
       * The chips shrink and clip first; the eye stays whole. A percentage cap here
       * would be resolved against a line whose width is its own max-content, which
       * is what clipped the chips away when the row was expanded.
       */
      children.push(React.createElement('span', { key: '__chips', className: 'dsh-th-chips' }, chips))
      children.push(
        React.createElement(
          'span',
          { key: '__acts', className: 'dsh-th-acts' },
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-th-eye',
              'data-dsh-th-eye': '1',
              'aria-pressed': entry.highlighted === true ? 'true' : 'false',
              'aria-label': options.labels.rowToggle,
              title: entry.highlighted === true ? options.labels.hideHighlight : options.labels.showHighlight,
              onClick(event) {
                event.preventDefault()
                event.stopPropagation()
                eye(entry.highlighted !== true)
              },
            },
            React.createElement(EyeIcon, { slashed: entry.highlighted !== true }),
          ),
        ),
      )

      /*
       * No native click guard on this container. React 18 delegates to the
       * container its own root was created on, so a native listener here that
       * stopped propagation would also stop every synthetic click inside it —
       * the eye button would go dead. The eye button stops propagation itself.
       */
      if (options.showChips !== true) {
        /* Collapsed, and the reader asked to keep collapsed rows unmarked. */
        if (entry.mount !== undefined) unmountBadges(entry)
        entry.counts = counts
        entry.mountKey = undefined
        return
      }
      const seat = chipSeatOf(header)
      if (entry.mount === undefined) {
        entry.mount = document.createElement('div')
        entry.mount.className = 'dsh-th-badge-set'
        entry.mount.setAttribute(MARK, 'badges')
      }
      /*
       * Keep the chip set on the title line: the seat moves when the collapsed
       * preview appears or disappears, and moving the container keeps the React
       * root that already owns its children.
       */
      if (entry.mount.parentNode !== seat.parent || entry.mount.nextElementSibling !== seat.before) {
        seat.parent.insertBefore(entry.mount, seat.before)
        entry.mountParent = seat.parent
      }
      entry.counts = counts
      const key =
        counts.map((item) => item.id + ':' + item.count + (item.muted === true ? '!' : '')).join('|') + '#' + String(entry.highlighted === true)
      if (entry.mountKey === key && entry.mount.childElementCount === children.length) return
      entry.mountKey = key
      paintBadges(entry, children, options.labels)
    }

    /**
     * Undo one body's highlighting exactly. The head node gets the original text
     * back, and the nodes the wrap inserted — the split heads/tails and the
     * highlight spans — are dropped, so the DOM reads as if the plugin had never
     * touched it. A node React already removed is simply discarded.
     */
    function unwrapBody(body) {
      const records = marks.get(body)
      if (records === undefined) return
      marks.delete(body)
      for (const record of records) {
        const head = record.head
        if (head.isConnected !== true) continue
        /*
         * Only the value this pass emptied is ours to put back. If the host wrote
         * something else into the node meanwhile — a streaming update lands on the
         * very node React created, which is this one — that newer text is the truth:
         * keep it and just drop the split-off copies beside it.
         */
        if (head.nodeValue === '') head.nodeValue = record.original
        for (const node of record.inserted ?? []) {
          if (node === head || node.isConnected !== true) continue
          try {
            node.remove()
          } catch (error) {
            /* already detached */
          }
        }
      }
    }

    /**
     * Every keyword occurrence of one text node, as offsets into that node.
     * `splitText` cannot do this job: it leaves the matched text on the node the
     * host still owns, so the node gets emptied and rebuilt from these segments
     * instead — exactly one copy of every character, and no residue.
     */
    function matchSegments(value, items, caseSensitive) {
      const pattern = buildPattern(items, caseSensitive)
      if (pattern === null) return null
      const segments = []
      let cursor = 0
      let match = pattern.exec(value)
      while (match !== null && segments.length < 4000) {
        const text = match[0]
        if (text.length === 0) break
        if (match.index > cursor) segments.push({ hit: false, text: value.slice(cursor, match.index) })
        segments.push({ hit: true, text })
        cursor = match.index + text.length
        if (pattern.lastIndex <= match.index) pattern.lastIndex = match.index + 1
        match = pattern.exec(value)
      }
      if (segments.length === 0) return null
      if (cursor < value.length) segments.push({ hit: false, text: value.slice(cursor) })
      return segments
    }

    /**
     * Highlight one text node's keywords in place. Every inserted node is freshly
     * created and the host's own text node only changes value, so that node keeps
     * its identity and position and React keeps updating it in place. The undo
     * record holds the emptied node, its original value, and every node the
     * rebuild inserted, which is what `unwrapBody` removes again.
     */
    function wrapNode(node, body, items, caseSensitive, tintFor) {
      const value = node.nodeValue
      if (!value) return 0
      const segments = matchSegments(value, items, caseSensitive)
      if (segments === null) return 0
      const parent = node.parentNode
      if (parent === null) return 0

      const inserted = []
      let hits = 0
      for (const segment of segments) {
        if (segment.hit) {
          const span = document.createElement('span')
          span.className = 'dsh-th-hit'
          span.setAttribute(MARK, 'hit')
          span.style.backgroundColor = tintFor(segment.text)
          span.textContent = segment.text
          parent.insertBefore(span, node)
          inserted.push(span)
          hits += 1
        } else {
          const piece = document.createTextNode(segment.text)
          parent.insertBefore(piece, node)
          inserted.push(piece)
        }
      }
      node.nodeValue = ''

      let records = marks.get(body)
      if (records === undefined) {
        records = new Set()
        marks.set(body, records)
      }
      records.add({ head: node, original: value, inserted })
      return hits
    }

    /**
     * The reasoning text the host is holding, whole, even while the row is folded.
     *
     * A collapsed row renders no chain of thought at all — the host mounts the body
     * only while `expanded` — so the folded text exists nowhere in the DOM, and the
     * one line of preview beside the title is all the markup has. The text itself
     * still lives in the row component's own `text` prop (`ReasoningRow`), and React
     * hangs its fiber on every element it created: `__reactFiber$…`. Walking up from
     * the row to the nearest component that owns a string `text` is that row.
     *
     * Everything that can go wrong — no fiber, a renamed prop, another React — reads
     * as "no folded text" and the DOM text is used, which is what the plugin did
     * before this existed.
     */
    function foldedTextOf(root) {
      try {
        const key = Object.keys(root).find(
          (name) => name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$'),
        )
        if (key === undefined) return null
        let fiber = root[key]
        for (let steps = 0; fiber !== null && fiber !== undefined && steps < 32; steps += 1) {
          const props = fiber.memoizedProps
          if (props !== null && typeof props === 'object' && typeof props.text === 'string' && props.text.length > 0) return props.text
          fiber = fiber.return
        }
        return null
      } catch (error) {
        return null
      }
    }

    /**
     * One node of this body's wrap, or undefined when nothing was inserted. Kept so
     * the next pass can tell, in constant time, whether the marks are still there.
     */
    function sampleMark(body) {
      const records = marks.get(body)
      if (records === undefined) return undefined
      for (const record of records) {
        for (const node of record.inserted) {
          if (node.nodeType === 1) return node
        }
      }
      return undefined
    }

    /**
     * Bring one reasoning row in line with the current settings. A row is left
     * alone unless its text or the filter changed, so streaming re-renders do
     * not re-wrap the same content.
     */
    function reconcileRow(root, options) {
      const entry = stateOf(root)
      /*
       * The marks can vanish without a character changing: a host re-render of the
       * body — compacting the context rebuilds the transcript that way — throws away
       * the nodes we inserted while the text the caches compare stays identical, and
       * the row would then never be marked again. One sample node catches it in
       * constant time and sends the row through the full path.
       */
      if (entry.sample !== undefined && entry.sample.isConnected !== true) {
        entry.sample = undefined
        entry.bodyKey = undefined
        entry.text = undefined
      }
      const header = headerRowOf(root)
      const expanded = header !== null && isExpanded(root, header)
      /*
       * What the chips count is the reasoning itself, not the slice of it the row
       * happens to show: while folded that is one preview line, while open it is the
       * rendered body. The host's own `text` prop is the same whole string in both
       * states, so the numbers no longer change when a row is expanded — and a folded
       * row stops reporting the counts of a single line.
       */
      const domText = unmarkedText(root)
      const folded = foldedTextOf(root)
      const counted = folded === null ? domText : folded
      /* The DOM text stays in the key: the preview appearing or leaving is a change. */
      const text = counted + '\u0000' + domText
      const patternChanged = entry.patternKey !== options.patternKey
      if (entry.text === text && patternChanged !== true && entry.enabled === options.enabled && entry.expanded === expanded) return
      entry.text = text
      entry.patternKey = options.patternKey
      entry.enabled = options.enabled
      entry.expanded = expanded
      entry.folded = folded !== null
      /*
       * A colour, a filter or a mute changes what the marks should look like without
       * changing a character of the body, so the body's text cache has to go with
       * it — otherwise recolouring a keyword or switching it off would leave the old
       * highlight in place until the text happened to change.
       */
      if (patternChanged === true) entry.bodyKey = undefined

      const colors = {}
      const counts = []
      if (options.enabled === true) {
        for (const item of options.items) {
          if (item.text.length === 0) continue
          colors[item.text] = item.color
          const count = countMatches(counted, item, options.caseSensitive)
          if (count > 0) counts.push({ id: item.id, text: item.text, count, color: item.color, muted: item.muted === true })
        }
      }
      entry.count = counts.reduce((total, item) => total + item.count, 0)
      decorate(root, entry, counts, colors, {
        ...options,
        showChips: options.chipsWhenCollapsed === true || expanded,
      })
      /*
       * An open row asks for room: the folded box around it would otherwise clip the
       * body at its own bottom edge. Re-applied by the pass sweep, and put back the
       * moment the row closes.
       */
      if (expanded === true && options.liftOnExpand === true) liftForRow(root)

      const body = bodyOf(root)
      if (body === null) {
        /* Collapsed: React unmounted the chain-of-thought, so the next expansion
           must re-wrap the freshly mounted nodes. */
        entry.bodyKey = undefined
        return
      }
      /*
       * The host can re-render a body and drop every node we inserted without
       * changing its text — compacting the context re-renders the transcript that
       * way — so the cached key alone cannot prove the body is still marked. The
       * sample node checked at the top of the pass is what detects that.
       */
      /*
       * Expanded. Re-wrap only when this body's own text changed: while a row
       * streams, React re-renders the header (updating the row text above) far
       * more often than the body, and this check is what keeps that cheap.
       */
      const bodyText = unmarkedText(body)
      const bodyKey = entry.bodyKey
      if (typeof bodyKey === 'string' && bodyKey === bodyText && entry.enabled === options.enabled) return

      unwrapBody(body)
      /* Whatever the body holds *now* is the text the marks were rebuilt from. */
      entry.bodyKey = unmarkedText(body)
      entry.sample = undefined
      setHighlight(root, entry.highlighted === true && options.enabled === true)
      if (options.enabled !== true || entry.highlighted !== true) return
      /*
       * Muted keywords are left out of the wrap entirely, so a keyword the reader
       * switched off is not merely invisible: the text itself stops being split.
       */
      const active = options.items.filter((item) => item.muted !== true)
      const tintFor = (word) => toTint(colors[word] ?? DEFAULT_COLOR, TINT_ALPHA)
      const stack = [body]
      while (stack.length > 0) {
        const element = stack.pop()
        /*
         * Ours: never highlight inside our own chip set. Its keyword text carries
         * the keyword's own color on a surface of the same family, so a second
         * highlight there is what made the chip name unreadable.
         */
        if (element.hasAttribute(MARK)) continue
        let child = element.firstElementChild
        while (child !== null) {
          stack.push(child)
          child = child.nextElementSibling
        }
        for (const node of [...element.childNodes]) {
          if (node.nodeType === 3) wrapNode(node, body, active, options.caseSensitive, tintFor)
        }
      }
      entry.sample = sampleMark(body)
    }

    function setHighlight(root, on) {
      root.setAttribute('data-dsh-hl', on ? 'on' : 'off')
    }

    function liveRoots() {
      return [...document.querySelectorAll(ROW_SELECTOR)]
    }

    /** Chips whose row left the document are dropped with it. */
    function sweepRows() {
      for (const mount of document.querySelectorAll('[' + MARK + '="badges"]')) {
        if (mount.closest(ROW_SELECTOR) === null) mount.remove()
      }
    }

    /** Observe the conversation and keep every reasoning row decorated. */
    function startDecorating(handle) {
      let scheduled = 0
      let sweeps = 0
      const run = () => {
        scheduled = 0
        if (document.body === null) {
          schedule()
          return
        }
        const settings = handle.settings()
        const labels = dict(settings.lang)
        const muted = new Set(settings.muted)
        const items = settings.rows.map((row) => ({ id: row.id, text: row.text.trim(), color: row.color, muted: muted.has(row.id) }))
        const patternKey =
          String(settings.enabled) + '|' + String(settings.caseSensitive) + '|' + String(settings.chipsWhenCollapsed) + '|' + String(settings.liftOnExpand) + '|' + settings.muted.join(',') + '|' + items.map((item) => item.id + '=' + item.text + item.color).join(',')
        /*
         * What a chip click does: one keyword in or out of the muted list, persisted
         * like any other setting. Every row hears about it on the next pass, so a
         * chip clicked in one row switches that keyword off everywhere.
         */
        const toggleKeyword = (id) => patch({ muted: toggleIn(settings.muted, id) })
        for (const root of liveRoots()) {
          try {
            reconcileRow(root, {
              items,
              caseSensitive: settings.caseSensitive,
              enabled: settings.enabled,
              chipsWhenCollapsed: settings.chipsWhenCollapsed,
              liftOnExpand: settings.liftOnExpand,
              onToggleKeyword: toggleKeyword,
              labels,
              patternKey,
            })
          } catch (error) {
            console.error('[' + NS + '] decorate failed', error)
          }
        }
        sweeps += 1
        if (sweeps % 8 === 0) sweepRows()
        /* Caps last: the loop above is what asks for them. */
        sweepLifts(settings.liftOnExpand === true)
      }
      /*
       * Testing seam: run one pass immediately, without the cache reset `refresh`
       * performs. A self-test needs exactly the pass the observer would run, since
       * that is the path that has to notice the host dropping our marks.
       */
      handle.pass = run
      handle.passes = () => sweeps
      const schedule = () => {
        if (scheduled !== 0) return
        scheduled = window.setTimeout(run, 90)
      }
      const stop = subscribe(schedule)
      const observer = new MutationObserver(schedule)
      let attaching = 0
      const observe = () => {
        attaching = 0
        if (document.body === null) {
          attaching = window.setTimeout(observe, 200)
          return
        }
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })
        schedule()
      }
      observe()
      return () => {
        if (attaching !== 0) window.clearTimeout(attaching)
        observer.disconnect()
        stop()
        if (scheduled !== 0) window.clearTimeout(scheduled)
        scheduled = 0
        for (const box of [...lifts.keys()]) restoreLift(box)
        for (const root of liveRoots()) {
          unmountBadges(stateOf(root))
          const body = bodyOf(root)
          if (body !== null) unwrapBody(body)
          root.removeAttribute('data-dsh-hl')
        }
      }
    }

    /* ───────────────────────────── settings row ────────────────────────── */

    function Switch(props) {
      return React.createElement(
        'button',
        {
          type: 'button',
          className: 'dsh-th-switch',
          role: 'switch',
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label,
          title: props.label,
          onClick: props.onChange,
        },
        React.createElement('span', { className: 'dsh-th-knob' }),
      )
    }

    function SettingRow(props) {
      const label = React.createElement('span', { className: 'dsh-th-label' }, props.label)
      if (props.hint === undefined) {
        return React.createElement('div', { className: 'dsh-th-row' }, label, props.children)
      }
      return React.createElement(
        'div',
        { className: 'dsh-th-stack' },
        React.createElement('div', { className: 'dsh-th-row' }, label, props.children),
        React.createElement('p', { className: 'dsh-th-hint' }, props.hint),
      )
    }

    function KeywordRow(props) {
      const row = props.row
      return React.createElement(
        'div',
        { className: 'dsh-th-kw', 'data-dsh-th': 'kw' },
        React.createElement('input', {
          className: 'dsh-th-input',
          type: 'text',
          value: row.text,
          spellCheck: false,
          placeholder: props.placeholder,
          'aria-label': props.placeholder,
          onChange: (event) => props.onText(event.target.value),
        }),
        React.createElement(
          'label',
          { className: 'dsh-th-color', title: row.color },
          React.createElement('input', {
            className: 'dsh-th-swatch',
            type: 'color',
            value: row.color,
            'aria-label': props.colorLabel,
            onChange: (event) => props.onColor(event.target.value),
          }),
          React.createElement('span', { className: 'dsh-th-dot', style: { backgroundColor: row.color } }),
          React.createElement('span', { className: 'dsh-th-hex' }, row.color.toUpperCase()),
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-th-mute',
            'data-dsh-th': 'mute',
            'data-muted': props.muted === true ? '1' : undefined,
            'aria-pressed': props.muted === true ? 'true' : 'false',
            'aria-label': props.muted === true ? props.unmuteLabel : props.muteLabel,
            title: props.muteHint,
            onClick: props.onMute,
          },
          props.muted === true ? props.unmuteLabel : props.muteLabel,
        ),
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-th-icon',
            'data-dsh-th': 'remove',
            'aria-label': props.removeLabel,
            title: props.removeLabel,
            onClick: props.onRemove,
          },
          React.createElement(TrashIcon, null),
        ),
      )
    }

    /**
     * The plugin's own Settings page. It is a `settings.section` of its own — its
     * nav row in the settings sidebar follows the plugin language — so later
     * features grow here instead of lengthening the General list. The shell hands
     * every section its composed slot props, and `renderSlot` is what renders the
     * child list this section declares for its own (or another package's) rows.
     */
    function buildSettingsSection() {
      return function ThinkingHighlightSection(props) {
        const settings = useSettings()
        const labels = dict(settings.lang)
        const setRows = (next) => patch({ rows: next })
        const contributed = typeof props.renderSlot === 'function' ? props.renderSlot('settings.thinking-highlight.item', {}) : null
        return React.createElement(
          'div',
          { className: 'dsh-th-section', 'data-dsh-th': 'section', lang: settings.lang === 'en' ? 'en' : 'zh-CN' },
          React.createElement(
            'div',
            { className: 'dsh-th-head' },
            React.createElement(
              'h2',
              { className: 'dsh-th-heading' },
              labels.title,
              React.createElement('span', { className: 'dsh-th-tag', 'data-dsh-th': 'version' }, labels.version + ' v' + VERSION),
            ),
            React.createElement('p', { className: 'dsh-th-intro' }, labels.lead),
          ),
          React.createElement(
            'div',
            { className: 'dsh-th-group' },
            React.createElement(
              SettingRow,
              { label: labels.language },
              React.createElement(
                'div',
                { className: 'dsh-th-seg', role: 'group', 'aria-label': labels.language },
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-th-seg-item',
                    'data-dsh-th': 'lang-zh',
                    'data-on': settings.lang === 'zh' ? '1' : undefined,
                    'aria-pressed': settings.lang === 'zh' ? 'true' : 'false',
                    onClick: () => patch({ lang: 'zh' }),
                  },
                  '中文',
                ),
                React.createElement(
                  'button',
                  {
                    type: 'button',
                    className: 'dsh-th-seg-item',
                    'data-dsh-th': 'lang-en',
                    'data-on': settings.lang === 'en' ? '1' : undefined,
                    'aria-pressed': settings.lang === 'en' ? 'true' : 'false',
                    onClick: () => patch({ lang: 'en' }),
                  },
                  'English',
                ),
              ),
            ),
            React.createElement(
              SettingRow,
              { label: labels.enabled },
              React.createElement(Switch, {
                checked: settings.enabled,
                label: labels.enabled,
                onChange: () => patch({ enabled: settings.enabled !== true }),
              }),
            ),
            React.createElement(
              SettingRow,
              { label: labels.chipsWhenCollapsed },
              React.createElement(Switch, {
                checked: settings.chipsWhenCollapsed,
                label: labels.chipsWhenCollapsed,
                onChange: () => patch({ chipsWhenCollapsed: settings.chipsWhenCollapsed !== true }),
              }),
            ),
            React.createElement(
              SettingRow,
              { label: labels.liftOnExpand, hint: labels.liftOnExpandHint },
              React.createElement(Switch, {
                checked: settings.liftOnExpand,
                label: labels.liftOnExpand,
                onChange: () => patch({ liftOnExpand: settings.liftOnExpand !== true }),
              }),
            ),
            React.createElement(
              SettingRow,
              { label: labels.caseSensitive },
              React.createElement(Switch, {
                checked: settings.caseSensitive,
                label: labels.caseSensitive,
                onChange: () => patch({ caseSensitive: settings.caseSensitive !== true }),
              }),
            ),
          ),
          contributed,
          React.createElement('div', { className: 'dsh-th-hr', 'data-dsh-th': 'divider' }),
          React.createElement(
            'div',
            { className: 'dsh-th-kws', 'data-dsh-th': 'keywords' },
            settings.rows.length === 0
              ? React.createElement('div', { className: 'dsh-th-empty' }, labels.empty)
              : settings.rows.map((row, index) =>
                  React.createElement(KeywordRow, {
                    key: row.key,
                    row,
                    muted: settings.muted.includes(row.id),
                    placeholder: labels.keywordPlaceholder,
                    colorLabel: labels.keywords,
                    removeLabel: labels.remove,
                    muteLabel: labels.mute,
                    unmuteLabel: labels.unmute,
                    muteHint: labels.muteHint,
                    onText: (value) => setRows(settings.rows.map((item, at) => (at === index ? { ...item, text: value } : item))),
                    onColor: (value) => setRows(settings.rows.map((item, at) => (at === index ? { ...item, color: hex(value) } : item))),
                    onMute: () => patch({ muted: toggleIn(settings.muted, row.id) }),
                    onRemove: () =>
                      patch({
                        rows: settings.rows.filter((item, at) => at !== index),
                        /* A deleted keyword cannot stay muted. */
                        muted: settings.muted.filter((id) => id !== row.id),
                      }),
                  }),
                ),
          ),
          React.createElement(
            'div',
            { className: 'dsh-th-foot' },
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-th-add',
                'data-dsh-th': 'add',
                onClick: () => setRows(settings.rows.concat({ id: nextRowId(), text: '', color: DEFAULT_COLOR })),
              },
              React.createElement(PlusIcon, null),
              labels.add,
            ),
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-th-reset',
                'data-dsh-th': 'reset',
                onClick: () => patch({ rows: defaults().rows, muted: [] }),
              },
              labels.reset,
            ),
          ),
        )
      }
    }

    /* ─────────────────────────────── runtime ───────────────────────────── */

    /**
     * Self-report of the section registration. The slot a settings page lives in
     * is declared at runtime by the settings shell, so a registration can
     * legitimately wait — and if the declaration never arrives, nothing renders
     * and nothing throws. That silence is what this records, so
     * `localStorage['dsh-thinking-highlight.registration']` says which branch was
     * taken on the last page load instead of leaving it to guesswork.
     */
    function reportRegistration(stage, detail) {
      try {
        window.localStorage.setItem(
          'dsh-thinking-highlight.registration',
          JSON.stringify({ stage, detail: detail === undefined ? null : String(detail), at: new Date().toISOString(), version: VERSION }),
        )
      } catch (error) {
        /* diagnostics must never be the failure */
      }
    }

    /** This page's id in the settings ledger: the nav row and the slot key. */
    const SECTION_ID = NS
    /** Child list other rows can register into; the page renders it after its own rows. */
    const SECTION_ITEM_SLOT = 'settings.thinking-highlight.item'
    /** After the official sections (general 0, plugins 15), so this sits last. */
    const SECTION_ORDER = 30

    /* ─────────────────────────────── runtime ───────────────────────────── */

    return {
      inject: ['slots'],
      apply(ctx) {
        const handle = { settings: () => snapshot }

        ctx.effect(() => insertStyles(CSS), NS + ':styles')

        reportRegistration('apply-entered', typeof ctx.slots?.inject === 'function' ? 'slots.inject available' : 'slots.inject MISSING')

        /*
         * The settings section: a nav row plus the page. `name` is the slot to
         * register into; `id` is this entry's own key inside that slot (it is also
         * what the shell keeps selected). Omitting `name` makes the registry look
         * up slot "undefined" and throw, which once silently cost this plugin its
         * settings entirely. `label` is read by the shell through
         * `resolveSlotLabel`, which calls a thunk — that is how the nav row follows
         * the plugin's own language.
         */
        let sectionLive = false
        let disposeSection = null
        const openSection = () => {
          disposeSection = ctx.slots.register(
            {
              name: 'settings.section',
              id: SECTION_ID,
              order: SECTION_ORDER,
              label: () => dict(snapshot.lang).nav,
              /* Declared here, so the page is the only owner of its own extension seam. */
              children: { [SECTION_ITEM_SLOT]: { kind: 'list', scope: 'root' } },
            },
            buildSettingsSection(),
          )
          return disposeSection
        }
        try {
          ctx.slots.inject('settings.section', () => {
            try {
              sectionLive = true
              openSection()
              reportRegistration('registered', 'settings.section#' + SECTION_ID)
              return () => {
                sectionLive = false
                if (disposeSection !== null) disposeSection()
                disposeSection = null
              }
            } catch (error) {
              reportRegistration('register-threw', error && error.message ? error.message : error)
              throw error
            }
          })
        } catch (error) {
          reportRegistration('inject-threw', error && error.message ? error.message : error)
        }

        /*
         * The shell resolves a section label when the ledger or the locale
         * revision changes, so a label thunk alone would keep the old nav text
         * after a language flip inside the page. Re-registering the same id
         * republishes the ledger, which re-resolves it; the page component is
         * stateless, so the swap is invisible apart from the label itself.
         */
        ctx.effect(
          () => {
            let shownLang = snapshot.lang
            return subscribe(() => {
              if (sectionLive === false || snapshot.lang === shownLang) return
              shownLang = snapshot.lang
              try {
                if (disposeSection !== null) disposeSection()
                disposeSection = null
                openSection()
                reportRegistration('relabelled', snapshot.lang)
              } catch (error) {
                /* a language flip must never break the click that caused it */
                reportRegistration('relabel-threw', error && error.message ? error.message : error)
              }
            })
          },
          NS + ':section-label',
        )

        ctx.effect(() => startDecorating(handle), NS + ':decorate')

        ctx.effect(() => {
          const forget = () => {
            for (const root of liveRoots()) {
              const entry = rows.get(root)
              if (entry === undefined) continue
              entry.text = undefined
              entry.bodyKey = undefined
            }
          }
          const runtime = {
            version: VERSION,
            settings: () => snapshot,
            rows: () =>
              liveRoots().map((root) => {
                const entry = rows.get(root)
                return {
                  highlighted: entry?.highlighted ?? true,
                  count: entry?.count ?? 0,
                  hasBadges: root.querySelector('[' + MARK + '="badges"]') !== null,
                  /* Whether the counts came from the folded reasoning or only the DOM. */
                  folded: entry?.folded === true,
                  /* Whether the marks this row's body was given are still in the document. */
                  marked: entry?.sample === undefined ? false : entry.sample.isConnected === true,
                }
              }),
            /* Re-read what the settings page (or another tab) wrote, then redo every row. */
            refresh: () => {
              reloadFromStore()
              forget()
            },
            /* The pass the observer runs, on demand and with the caches intact. */
            pass: () => {
              if (typeof handle.pass === 'function') handle.pass()
            },
            /* How many passes this plugin has run in this page. */
            passes: () => (typeof handle.passes === 'function' ? handle.passes() : 0),
            clear: () => {
              for (const root of liveRoots()) {
                unmountBadges(stateOf(root))
                const body = bodyOf(root)
                if (body !== null) unwrapBody(body)
              }
              for (const box of [...lifts.keys()]) restoreLift(box)
              forget()
            },
            /* Testing seam: the same functions the reconciler runs, so a DOM
               self-test exercises shipped code instead of a copy of it. */
            internals: {
              buildPattern,
              countMatches,
              toTint,
              escapeRegExp,
              wrapNode,
              unwrapBody,
              hex,
              unmarkedText,
              liftSeatOf,
              liftForRow,
              restoreLift,
              sweepLifts,
              lifts,
            },
          }
          window.__DSH_TH__ = runtime
          return () => {
            if (window.__DSH_TH__ === runtime) delete window.__DSH_TH__
          }
        }, NS + ':runtime')
      },
    }
  },
})
