/**
 * Client half of @local/dsh-thinking-highlight.
 *
 * Two contributions, both registered inside `apply` so unloading the plugin
 * removes them:
 *
 *  1. a preference row in `settings.general.item` — language, plugin switch,
 *     case matching, a divider, then the keyword list with color pickers and an
 *     add button;
 *  2. a decoration of the Chat reasoning rows. The shipped reasoning row
 *     (`data-variant="think"`) is a sealed primitive that exposes no slot, so
 *     the only seat available is the rendered DOM: its header gains a
 *     keyword-count chip plus the eye toggle, and its expanded body's keyword
 *     occurrences are wrapped in highlight spans. The reconciler writes only
 *     `nodeValue` and splits text nodes, so React keeps updating the same text
 *     nodes in place and never meets a foreign child element.
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

    function loadState() {
      const base = defaults()
      const raw = readStore()
      if (raw === null || typeof raw !== 'object') return base
      base.lang = raw.lang === 'en' ? 'en' : 'zh'
      base.enabled = raw.enabled !== false
      base.caseSensitive = raw.caseSensitive === true
      const stored = Array.isArray(raw.rows) ? raw.rows : []
      if (stored.length > 0) base.rows = stored.slice(0, MAX_KEYWORDS).map(screenRow)
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
        rows: state.rows.map((row, index) => ({ ...row, key: 'r' + index + '-' + row.id })),
      }
    }

    /** Apply a patch, persist it, and republish the frozen snapshot. */
    function patch(changes) {
      state = { ...state, ...changes }
      snapshot = buildSnapshot()
      writeStore(state)
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
        title: '标红插件',
        lead: '统计思考行里出现的提示词并在思维链中标红；右侧眼睛按钮控制这一行的高亮显示。',
        language: '语言',
        enabled: '插件开关',
        caseSensitive: '不区分大小写',
        keywords: '提示词与颜色',
        add: '添加提示词',
        remove: '删除',
        keywordPlaceholder: '输入提示词…',
        reset: '恢复默认',
        empty: '还没有提示词；点上面的「添加提示词」新增一条。',
        showHighlight: '显示高亮',
        hideHighlight: '隐藏高亮',
        rowToggle: '这一行的高亮显示',
      },
      en: {
        title: 'Thinking Highlighter',
        lead: 'Counts the keywords below inside thinking rows and highlights them in the chain of thought; the eye button on the right toggles highlighting for that row.',
        language: 'Language',
        enabled: 'Plugin',
        caseSensitive: 'Match case',
        keywords: 'Keywords and colors',
        add: 'Add keyword',
        remove: 'Remove',
        keywordPlaceholder: 'Type a keyword…',
        reset: 'Restore defaults',
        empty: 'No keywords yet — use “Add keyword” to create one.',
        showHighlight: 'Show highlighting',
        hideHighlight: 'Hide highlighting',
        rowToggle: 'Highlighting for this row',
      },
    }

    function dict(lang) {
      return TEXT[lang] ?? TEXT.zh
    }

    /* ─────────────────────────────── styles ────────────────────────────── */

    /**
     * Every color comes from a --dsw-alias-* token so light and dark follow the
     * host theme. The keyword color is the only authored color, because it is
     * the user's own choice.
     */
    const CSS = `
.dsh-th-badge-set{display:flex;align-items:center;gap:6px;min-width:0;max-width:44%;flex:none;overflow:hidden;margin-left:6px}
.dsh-th-badge{display:inline-flex;align-items:center;gap:4px;flex:none;padding:0 6px;border-radius:6px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}
.dsh-th-badge[data-count="1"]{color:var(--dsw-alias-label-tertiary)}
.dsh-th-badge-name{display:inline-block;max-width:7em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-th-badge-x{opacity:.55}
.dsh-th-acts{display:flex;align-items:center;flex:none;margin-left:2px}
.dsh-th-eye{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:.45;transition:opacity 120ms ease,color 120ms ease,background-color 120ms ease}
[data-open]:hover .dsh-th-eye,.dsh-th-eye:focus-visible{opacity:1}
.dsh-th-eye:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-th-eye:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-body .dsh-th-hit{border-radius:3px}
[data-dsh-hl="off"] .dsh-th-body .dsh-th-hit{background-color:transparent !important}
.dsh-th-panel{display:flex;flex-direction:column;gap:16px;padding:2px 0 4px}
.dsh-th-hd{display:flex;flex-direction:column;gap:4px}
.dsh-th-hd-row{display:flex;align-items:center;gap:8px}
.dsh-th-hd-title{font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary)}
.dsh-th-tag{padding:0 6px;border-radius:6px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);font-variant-numeric:tabular-nums}
.dsh-th-lead{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-th-row{display:flex;align-items:center;justify-content:space-between;gap:12px}
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
.dsh-th-foot{display:flex;align-items:center;gap:8px}
.dsh-th-add{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border:0.5px dashed var(--dsw-alias-border-l2);border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;cursor:pointer}
.dsh-th-add:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.dsh-th-add:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-reset{margin-left:auto;padding:5px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer}
.dsh-th-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
`

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

    /** The disclosure header row: the row that owns the expandable `[data-open]` marker. */
    function headerRowOf(root) {
      for (const candidate of root.querySelectorAll('div[data-open]')) return candidate
      const first = root.firstElementChild
      if (first === null) return null
      return first.querySelector('div[data-open]') ?? first
    }

    /** The expanded chain-of-thought container the shipped row renders. */
    function bodyOf(root) {
      const own = root.querySelector('.' + BODY_CLASS)
      if (own !== null) return own
      const inline = root.querySelector('[data-turn-process-inline] > div')
      if (inline === null) return null
      inline.classList.add(BODY_CLASS)
      return inline
    }

    /**
     * Best-effort injection point for one row's chip set. Expanded, the shipped
     * row renders the chain-of-thought as the disclosure's child, so the chip set
     * belongs in that block's parent — the header row, beside the title;
     * collapsed (or on an older layout) the header row itself is the seat.
     */
    function injectionPointOf(root, header) {
      const block = bodyOf(root)
      const parent = block === null ? null : block.parentElement
      if (parent !== null && parent !== root && header.contains(parent) === false) return parent
      return header
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
      for (const item of counts) {
        children.push(
          React.createElement(
            'span',
            {
              key: item.id,
              className: 'dsh-th-badge',
              'data-count': String(item.count),
              title: item.text + ' × ' + item.count,
            },
            React.createElement('span', { className: 'dsh-th-badge-name', style: { color: colors[item.text] } }, item.text),
            React.createElement('span', { className: 'dsh-th-badge-x' }, '×'),
            React.createElement('span', null, String(item.count)),
          ),
        )
      }
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
      const target = injectionPointOf(root, header)
      if (entry.mount !== undefined && entry.mount.parentNode !== target) unmountBadges(entry)
      if (entry.mount === undefined) {
        entry.mount = document.createElement('div')
        entry.mount.className = 'dsh-th-badge-set'
        entry.mount.setAttribute(MARK, 'badges')
        target.appendChild(entry.mount)
        entry.mountParent = target
      } else if (entry.mountParent !== undefined && entry.mountParent.isConnected !== true && entry.mount.isConnected === true) {
        /* the host rebuilt the row's header: re-seat the chip set after its new content */
        target.appendChild(entry.mount)
        entry.mountParent = target
      }
      entry.counts = counts
      const key = counts.map((item) => item.id + ':' + item.count).join('|') + '#' + String(entry.highlighted === true)
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
        if (head.nodeValue !== record.original) head.nodeValue = record.original
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
     * Bring one reasoning row in line with the current settings. A row is left
     * alone unless its text or the filter changed, so streaming re-renders do
     * not re-wrap the same content.
     */
    function reconcileRow(root, options) {
      const entry = stateOf(root)
      const text = root.textContent ?? ''
      if (entry.text === text && entry.patternKey === options.patternKey && entry.enabled === options.enabled) return
      entry.text = text
      entry.patternKey = options.patternKey
      entry.enabled = options.enabled

      const colors = {}
      const counts = []
      if (options.enabled === true) {
        for (const item of options.items) {
          if (item.text.length === 0) continue
          colors[item.text] = item.color
          const count = countMatches(text, item, options.caseSensitive)
          if (count > 0) counts.push({ id: item.id, text: item.text, count, color: item.color })
        }
      }
      entry.count = counts.reduce((total, item) => total + item.count, 0)
      decorate(root, entry, counts, colors, options)

      const body = bodyOf(root)
      if (body === null) {
        /* Collapsed: React unmounted the chain-of-thought, so the next expansion
           must re-wrap the freshly mounted nodes. */
        entry.bodyKey = undefined
        return
      }
      /*
       * Expanded. Re-wrap only when this body's own text changed: while a row
       * streams, React re-renders the header (updating the row text above) far
       * more often than the body, and this check is what keeps that cheap.
       */
      const bodyText = body.textContent ?? ''
      const bodyKey = entry.bodyKey
      if (typeof bodyKey === 'string' && bodyKey === bodyText && entry.enabled === options.enabled) return
      entry.bodyKey = bodyText

      unwrapBody(body)
      setHighlight(root, entry.highlighted === true && options.enabled === true)
      if (options.enabled !== true || entry.highlighted !== true) return
      const tintFor = (word) => toTint(colors[word] ?? DEFAULT_COLOR, TINT_ALPHA)
      const stack = [body]
      while (stack.length > 0) {
        const element = stack.pop()
        let child = element.firstElementChild
        while (child !== null) {
          stack.push(child)
          child = child.nextElementSibling
        }
        if (element.hasAttribute(MARK)) continue
        for (const node of [...element.childNodes]) {
          if (node.nodeType === 3) wrapNode(node, body, options.items, options.caseSensitive, tintFor)
        }
      }
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
        const items = settings.rows.map((row) => ({ id: row.id, text: row.text.trim(), color: row.color }))
        const patternKey =
          String(settings.enabled) + '|' + String(settings.caseSensitive) + '|' + items.map((item) => item.id + '=' + item.text + item.color).join(',')
        for (const root of liveRoots()) {
          try {
            reconcileRow(root, {
              items,
              caseSensitive: settings.caseSensitive,
              enabled: settings.enabled,
              labels,
              patternKey,
            })
          } catch (error) {
            console.error('[' + NS + '] decorate failed', error)
          }
        }
        sweeps += 1
        if (sweeps % 8 === 0) sweepRows()
      }
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
      return React.createElement(
        'div',
        { className: 'dsh-th-row' },
        React.createElement('span', { className: 'dsh-th-label' }, props.label),
        props.children,
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

    function buildSettingsPanel() {
      return function SettingsPanel() {
        const settings = useSettings()
        const labels = dict(settings.lang)
        const setRows = (next) => patch({ rows: next })
        return React.createElement(
          'div',
          { className: 'dsh-th-panel', 'data-dsh-th': 'panel', lang: settings.lang === 'en' ? 'en' : 'zh-CN' },
          React.createElement(
            'div',
            { className: 'dsh-th-hd' },
            React.createElement(
              'div',
              { className: 'dsh-th-hd-row' },
              React.createElement('span', { className: 'dsh-th-hd-title' }, labels.title),
              React.createElement('span', { className: 'dsh-th-tag', 'data-dsh-th': 'version' }, labels.version + ' v' + VERSION),
            ),
            React.createElement('div', { className: 'dsh-th-lead' }, labels.lead),
          ),
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
            { label: labels.caseSensitive },
            React.createElement(Switch, {
              checked: settings.caseSensitive,
              label: labels.caseSensitive,
              onChange: () => patch({ caseSensitive: settings.caseSensitive !== true }),
            }),
          ),
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
                    placeholder: labels.keywordPlaceholder,
                    colorLabel: labels.keywords,
                    removeLabel: labels.remove,
                    onText: (value) => setRows(settings.rows.map((item, at) => (at === index ? { ...item, text: value } : item))),
                    onColor: (value) => setRows(settings.rows.map((item, at) => (at === index ? { ...item, color: hex(value) } : item))),
                    onRemove: () => setRows(settings.rows.filter((item, at) => at !== index)),
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
                onClick: () => setRows(defaults().rows),
              },
              labels.reset,
            ),
          ),
        )
      }
    }

    /* ─────────────────────────────── runtime ───────────────────────────── */

    return {
      inject: ['slots'],
      apply(ctx) {
        const handle = { settings: () => snapshot }

        ctx.effect(() => window.styles.insert(CSS), NS + ':styles')

        ctx.slots.inject('settings.general.item', () =>
          ctx.slots.register({ id: NS, order: 25 }, buildSettingsPanel()),
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
                }
              }),
            refresh: forget,
            clear: () => {
              for (const root of liveRoots()) {
                unmountBadges(stateOf(root))
                const body = bodyOf(root)
                if (body !== null) unwrapBody(body)
              }
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
