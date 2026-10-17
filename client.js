/**
 * Client half of @yokira404/dsh-thinking-highlight.
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
  id: '@yokira404/dsh-thinking-highlight',
  factory(require) {
    const React = require('react')
    const ReactDOMClient = require('react-dom/client')

    /* ───────────────────────────── constants ───────────────────────────── */

    const NS = 'dsh-thinking-highlight'
    const VERSION = '1.4.1'
    const STORAGE_KEY = 'dsh-thinking-highlight.state.v1'
    const ROW_SELECTOR = '[data-variant="think"]'
    const BODY_CLASS = 'dsh-th-body'
    const MARK = 'data-dsh-th'
    const DEFAULT_KEYWORDS = ['提示词', '但']
    const DEFAULT_COLOR = '#dc2626'
    /*
     * What the text-colour well offers a keyword that follows the theme. It is a
     * starting point for the picker, not a decision: the sample is the host's own label
     * colour, so a reader who accepts it unedited gets text that reads exactly like the
     * body around it.
     */
    const DEFAULT_TEXT_COLOR = '#0f1115'
    const TINT_ALPHA = 0.24
    /** Typefaces a keyword can ask for; `default` keeps whatever the host uses. */
    const FONTS = ['default', 'mono', 'serif']
    /** Upper bound on active keywords, so one wild pattern can never be built. */
    const MAX_KEYWORDS = 200
    /*
     * The size scale a keyword may ask for, in px — and it is the host's own:
     * `@deepseek-ai/dsh-client-ui-theme` declares its content font size as
     * `Schema.number().step(1).min(10).max(22).default(14)`, and its own stepper
     * disables the arrows at exactly those two ends. Borrowing the bounds means a
     * highlighted word can never be larger than the reader's own body text can be,
     * and a keyword left at the default size stays byte-identical to before.
     */
    const FONT_SIZE_MIN = 10
    const FONT_SIZE_MAX = 22
    const FONT_SIZE_DEFAULT = 14
    /*
     * How far a chip may grow or shrink with its keyword's size. A chip sits on the
     * header line of a collapsed row, which DSH pins to `calc(24px +
     * var(--dsh-content-font-delta))` with `contain: size layout`: a chip taller than
     * that line is clipped instead of read. The bound is set so the tallest chip still
     * fits there — with the stylesheet's own line-height curve (16 px growing by
     * two thirds of the factor) the box is 21.2 px plus the chip's 2 px of frame, which
     * leaves room for the row's own hairline. Below the reader's body size the chip
     * simply follows the text down.
     */
    const CHIP_SCALE_MIN = 0.7
    const CHIP_SCALE_MAX = 1.45
    /*
     * How far the reader may push a chip away from that natural size, and the
     * geometry its look is drawn from. A chip bigger than the line it sits on used
     * to be the one thing the bound above could not allow: the host pins a collapsed
     * row to `calc(24px + var(--dsh-content-font-delta))` with `contain: size layout`
     * and clips its own overflow, so a taller chip is cut off. The room for one is
     * therefore granted the same way the folded-box lift is — the plugin raises the
     * row's own height while a chip needs it (`setRoom`), which is what lets the
     * upper end of this scale be a real size instead of a clipped one.
     */
    const BADGE_SCALE_MIN = 0.5
    const BADGE_SCALE_MAX = 2.4
    const BADGE_SCALE_STEP = 0.1
    /** A shape is the radius it draws with; a frame is the width it draws at. */
    const BADGE_SHAPES = { rounded: '6px', pill: '999px', square: '2px' }
    const BADGE_SHAPE_IDS = ['rounded', 'pill', 'square']
    const BADGE_BORDERS = { hairline: 1, solid: 2, none: 0 }
    const BADGE_BORDER_IDS = ['hairline', 'solid', 'none']
    const BADGE_SHADOWS = ['none', 'soft', 'glow']
    const BADGE_BOLD_WEIGHT = '600'
    /** What a texture may be and how it may be laid into the chip. */
    const BADGE_FITS = ['repeat', 'cover', 'contain']
    const TEXTURE_SIZES = { repeat: 'auto', cover: '100% 100%', contain: 'contain' }
    /*
     * A texture lives in the same localStorage record as everything else, so it is
     * a data URL the browser can store: the upload is redrawn to at most 96px on its
     * long edge before it is kept, and anything that survives that and is still
     * enormous is refused rather than allowed to fill the whole store.
     */
    const TEXTURE_MAX_PX = 96
    const TEXTURE_MAX_CHARS = 400000
    const TEXTURE_MAX_FILE = 8 * 1024 * 1024
    const TEXTURE_ALPHA_MIN = 0.05
    const TEXTURE_ALPHA_MAX = 1
    const TEXTURE_ALPHA_STEP = 0.05
    /** Saved templates are a convenience, not a library: a short list, first in wins. */
    const TEMPLATE_MAX = 12

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

    /**
     * One keyword's own text colour, or null for "keep the host's". Null is a real
     * value here, not a missing one: it is what leaves the highlight readable after
     * a theme flip, because the token behind it follows the theme.
     */
    function textColor(value) {
      if (typeof value !== 'string') return null
      const text = value.trim()
      if (text === '' || text.toLowerCase() === 'follow') return null
      return /^#[0-9a-fA-F]{6}$/.test(text) ? text.toLowerCase() : null
    }

    /** A keyword's size in px, clamped into the host's own range. */
    function fontSize(value) {
      const number = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
      if (!Number.isFinite(number)) return FONT_SIZE_DEFAULT
      return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, Math.round(number)))
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
        rows: DEFAULT_KEYWORDS.map((text) => freshRow(text)),
        /*
         * The chip look every keyword follows until it is given one of its own, and
         * the looks the reader saved as templates. Both are shared state, not per-row:
         * a keyword's own copy only exists once the reader changed something on it.
         */
        badge: badgeDefaults(),
        badgeTemplates: [],
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
        /* Whole-word matching: a keyword sitting inside a longer word is not a hit. */
        whole: row?.whole === true,
        font: FONTS.includes(row?.font) ? row.font : 'default',
        bold: row?.bold === true,
        italic: row?.italic === true,
        underline: row?.underline === true,
        /* The two the style panel gained: the words' own ink, and their size. */
        textColor: textColor(row?.textColor),
        fontSize: fontSize(row?.fontSize),
        /*
         * The chip's own look. Null is the meaningful value here: it means this
         * keyword has no opinion and follows the shared badge, which is what keeps a
         * later change to the shared one reaching every keyword that never overrode it.
         */
        badge: screenBadge(row?.badge),
      }
    }

    /**
     * Everything about how one keyword's hits look, as one compact string. It is
     * what tells a row whether its marks have to be built again, so a size or a text
     * colour that changed has to reach it — and both of those are exactly the kind
     * of change that leaves the body's text untouched.
     */
    function styleKey(item) {
      const ink = item.textColor === null || item.textColor === undefined ? '' : item.textColor
      return (
        String(item.color ?? '') +
        ink +
        String(item.fontSize ?? '') +
        (item.whole === true ? 'W' : '') +
        (item.bold === true ? 'B' : '') +
        (item.italic === true ? 'I' : '') +
        (item.underline === true ? 'U' : '') +
        String(item.font ?? '') +
        /*
         * The chip's look rides the same key: a chip that was resized or textured has
         * to be drawn again, and nothing else about the row would say so.
         */
        badgeKey(item.badge ?? null)
      )
    }

    /**
     * How large a chip may draw its own text, as a multiplier of its natural size:
     * the keyword's size against the reader's body size (i.e. the host's default),
     * bounded so a chip can never outgrow the fixed-height header line it sits on.
     */
    function chipScale(size) {
      const number = fontSize(size)
      const scale = number / FONT_SIZE_DEFAULT
      return Math.min(CHIP_SCALE_MAX, Math.max(CHIP_SCALE_MIN, scale))
    }

    /**
     * One custom property `body` carries, as a number, or null when it is missing, is
     * not a plain length, or is outside the range a reader's own font size can be. Read
     * off `body` because that is where the host publishes these, so a node inside the
     * document is the only thing that can resolve them at all.
     */
    function bodyLength(name, min, max) {
      try {
        if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function' || document.body === null) return null
        const value = Number.parseFloat(window.getComputedStyle(document.body).getPropertyValue(name))
        /* A sane number or nothing: a garbage value must not become a measurement. */
        if (Number.isFinite(value) === true && value >= min && value <= max) return value
      } catch (error) {
        /* unreadable custom property: whoever asked keeps its own fallback */
      }
      return null
    }

    /**
     * The host's body font-size delta in px — the one number that says how much taller a
     * reader's own text made every line of the transcript — or null when it cannot be
     * known. A collapsed row's own line is `24px + this`, and the room a chip taller than
     * that line asks for is measured against it.
     *
     * The host publishes the delta as a `calc()` — `calc(var(--dsh-content-font-size,14px)
     * - 14px)` — and a custom property's computed value is the token sequence rather than
     * the length it stands for, so parsing it directly reads nothing at all. That is not a
     * detail: it is why an oversized chip went unmeasured in the real app. The plain-length
     * case is still tried first (another platform may publish one), and otherwise the
     * arithmetic is the host's own, applied to the size the host does publish as a plain
     * length. `evidence/host-shape.mjs` asserts that definition is still in the installed
     * bundle, so a DSH release that changes it fails a test instead of quietly switching
     * the room off.
     */
    function hostFontDelta() {
      const direct = bodyLength('--dsh-content-font-delta', -20, 40)
      if (direct !== null) return direct
      const size = bodyLength('--dsh-content-font-size', 10, 40)
      return size === null ? null : size - FONT_SIZE_DEFAULT
    }

    /* ──────────────────────────── badge look ───────────────────────────── */

    /**
     * How one chip looks when nobody has said otherwise: the size the reader's own
     * text implies, the host's neutral fill, the keyword's colour on the frame, and
     * no decoration of its own. Every field here is drawn from tokens rather than
     * fixed paint, so a chip left alone is the chip the plugin always drew — light
     * and dark included.
     */
    function badgeDefaults() {
      return {
        scale: 1,
        followText: true,
        bg: 'theme',
        ink: 'theme',
        frame: 'keyword',
        border: 'hairline',
        shape: 'rounded',
        shadow: 'none',
        bold: false,
        texture: null,
      }
    }

    /** A number clamped into the badge's own range, or the fallback for garbage. */
    function badgeNumber(value, min, max, fallback) {
      const number = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
      if (Number.isFinite(number) !== true) return fallback
      return Math.min(max, Math.max(min, Math.round(number * 100) / 100))
    }

    /**
     * One colour of the badge. Three words are colours here as much as `#rrggbb` is:
     * `theme` hands the field back to the host's tokens, `none` is transparency (the
     * one way to ask for a bare, outlined chip), and `keyword` keeps the frame on the
     * word's own colour — which is what an untouched chip does.
     */
    function badgePaint(value, fallback) {
      if (typeof value !== 'string') return fallback
      const text = value.trim().toLowerCase()
      if (text === 'theme' || text === 'none' || text === 'keyword') return text
      return /^#[0-9a-f]{6}$/.test(text) ? text : fallback
    }

    /**
     * The uploaded image a chip is textured with, or null. The source is a data URL
     * and nothing else: a texture is local to this browser, never a network address,
     * so a stored record can never make the transcript fetch something.
     */
    function badgeTexture(value) {
      if (value === null || typeof value !== 'object') return null
      const src = typeof value.src === 'string' ? value.src : ''
      if (/^data:image\//.test(src) !== true || src.length > TEXTURE_MAX_CHARS) return null
      return {
        id: typeof value.id === 'string' && value.id !== '' ? value.id : 'tex',
        src,
        fit: BADGE_FITS.includes(value.fit) ? value.fit : 'repeat',
        alpha: badgeNumber(value.alpha, TEXTURE_ALPHA_MIN, TEXTURE_ALPHA_MAX, 0.85),
      }
    }

    /** One complete badge look, or null for "no opinion". Stored fields are merged over the defaults. */
    function screenBadge(value) {
      if (value === null || typeof value !== 'object') return null
      const base = badgeDefaults()
      /* Only the frame can borrow the word's colour, and a frame is never "none": its width says that. */
      const bg = badgePaint(value.bg, base.bg)
      const frame = badgePaint(value.frame, base.frame)
      return {
        scale: badgeNumber(value.scale, BADGE_SCALE_MIN, BADGE_SCALE_MAX, base.scale),
        followText: value.followText !== false,
        bg: bg === 'keyword' ? base.bg : bg,
        ink: badgePaint(value.ink, base.ink),
        frame: frame === 'none' ? base.frame : frame,
        border: BADGE_BORDER_IDS.includes(value.border) ? value.border : base.border,
        shape: BADGE_SHAPE_IDS.includes(value.shape) ? value.shape : base.shape,
        shadow: BADGE_SHADOWS.includes(value.shadow) ? value.shadow : base.shadow,
        bold: value.bold === true,
        texture: badgeTexture(value.texture),
      }
    }

    /** A saved template: a name and the look it stands for, sanitized like any stored badge. */
    function screenTemplate(value, index) {
      if (value === null || typeof value !== 'object') return null
      const spec = screenBadge(value.spec)
      if (spec === null) return null
      const name = typeof value.name === 'string' ? value.name.trim().slice(0, 24) : ''
      return {
        id: typeof value.id === 'string' && value.id !== '' ? value.id : 'tpl-restored-' + index,
        name: name === '' ? '' : name,
        spec,
      }
    }

    /** How many pixels of frame a badge carries; the box geometry is built from it. */
    function badgeBorderWidth(spec) {
      const width = BADGE_BORDERS[spec?.border ?? 'hairline']
      return typeof width === 'number' ? width : 1
    }

    /**
     * The factor a chip draws at: its keyword's size (unless the reader asked it to
     * stop following the text) times the badge's own scale. At the defaults this is
     * exactly `chipScale`, so an untouched chip is unchanged to the pixel.
     */
    function chipScaleOf(item, spec) {
      const follow = spec === null || spec === undefined || spec.followText !== false ? chipScale(item?.fontSize) : 1
      const own = spec === null || spec === undefined ? 1 : badgeNumber(spec.scale, BADGE_SCALE_MIN, BADGE_SCALE_MAX, 1)
      return follow * own
    }

    /** The line box a chip draws its text in at that factor — the stylesheet's own curve. */
    function chipLineHeight(scale) {
      return 16 * (1 + (scale - 1) * 0.667)
    }

    /** The chip's whole box at that factor: its line box plus the frame above and below. */
    function chipBoxHeight(scale, spec) {
      return chipLineHeight(scale) + 2 * badgeBorderWidth(spec)
    }

    /**
     * Everything about how one chip looks, as one compact string. The chip set is
     * rebuilt when this changes and left alone when it does not, so a stored texture
     * contributes its id and length rather than its whole data URL.
     */
    function badgeKey(spec) {
      if (spec === null || spec === undefined) return ''
      const texture = spec.texture === null ? '' : spec.texture.id + '/' + String(spec.texture.src.length) + '/' + spec.texture.fit + '/' + String(spec.texture.alpha)
      return (
        'b' +
        String(spec.scale) +
        (spec.followText === false ? 'F' : '') +
        spec.bg +
        spec.ink +
        spec.frame +
        spec.border +
        spec.shape +
        spec.shadow +
        (spec.bold === true ? 'B' : '') +
        texture
      )
    }

    /**
     * The looks offered as one-click templates. Each is a patch over the defaults, so
     * a template can never carry a field it did not mean to set; the dictionaries
     * hold the names, keyed by the same ids (see `BADGE_TEMPLATE_NAMES`).
     */
    const BADGE_PRESETS = [
      { id: 'default', spec: {} },
      { id: 'emphasis', spec: { scale: 1.2, bold: true, border: 'solid', shadow: 'soft' } },
      { id: 'pill', spec: { shape: 'pill', border: 'hairline' } },
      { id: 'outline', spec: { bg: 'none', border: 'hairline', shadow: 'none' } },
      { id: 'square', spec: { shape: 'square', border: 'solid' } },
      { id: 'glow', spec: { bold: true, border: 'solid', shadow: 'glow' } },
    ]

    /** One keyword row with every field the settings page can set. */
    function freshRow(text) {
      return screenRow({ id: nextRowId(), text, color: DEFAULT_COLOR }, 0)
    }

    /**
     * What counts as "the same keyword": the text the matcher actually compares —
     * trimmed, and case-folded while matching ignores case, because `is` and `IS`
     * would then be two words that hit exactly the same places. Two keywords sharing
     * a key can never coexist: the settings page refuses the edit, stored state is
     * deduplicated on load, and the pass would ignore the later one anyway.
     */
    function keywordKey(text, caseSensitive) {
      const trimmed = typeof text === 'string' ? text.trim() : ''
      return caseSensitive === true ? trimmed : trimmed.toLowerCase()
    }

    /** The duplicate of `candidate` among `rows` (that row's text), or null. */
    function duplicateOf(rows, candidate, ownId, caseSensitive) {
      const key = keywordKey(candidate, caseSensitive)
      if (key === '') return null
      for (const row of rows) {
        if (row.id === ownId) continue
        if (keywordKey(row.text, caseSensitive) === key) return row.text
      }
      return null
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
      /* An older record has no badge at all, which reads as "the defaults". */
      base.badge = screenBadge(raw.badge) ?? badgeDefaults()
      base.badgeTemplates = (Array.isArray(raw.badgeTemplates) ? raw.badgeTemplates : []).slice(0, TEMPLATE_MAX).map(screenTemplate).filter(Boolean)
      const stored = Array.isArray(raw.rows) ? raw.rows : []
      if (stored.length > 0) base.rows = stored.slice(0, MAX_KEYWORDS).map(screenRow)
      /* Older state (or a hand-edited one) may hold duplicates; the first one wins. */
      const seen = new Set()
      base.rows = base.rows.filter((row) => {
        const key = keywordKey(row.text, base.caseSensitive)
        if (key === '') return true
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
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
        badge: state.badge,
        badgeTemplates: state.badgeTemplates.map((template) => ({ ...template })),
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
        languageHint: '插件界面语言；左侧导航那一行的名字也跟着变',
        enabled: '插件开关',
        enabledHint: '一键隐藏全部颜色、徽章与标红',
        caseSensitive: '区分大小写',
        caseSensitiveHint: '关掉时 is 也会命中 IS；打开后只有大小写完全一致才算。',
        chipsWhenCollapsed: '折叠时显示标注',
        chipsWhenCollapsedHint: '折叠的思考行是否显示徽章与眼睛',
        liftOnExpand: '展开时撑开思考框',
        liftOnExpandHint: '默认关闭。DSH 把一轮的过程收进一个最高 400px、可滚动的框里；如果你展开的思考被这个框截断（后面的内容要框内滚动才看得到），打开这一项，插件会在展开时临时去掉那个高度上限。',
        keywords: '提示词',
        keywordsHint: '一行一个词；右侧的图标里是这个词的颜色与样式',
        version: '版本',
        add: '添加提示词',
        keywordsFull: '已达上限（最多 200 个词）',
        remove: '删除',
        keywordPlaceholder: '输入提示词…',
        reset: '恢复默认',
        empty: '还没有提示词；点上面的「添加提示词」新增一条。',
        showHighlight: '显示高亮',
        hideHighlight: '隐藏高亮',
        rowToggle: '这一行的高亮显示',
        chipMute: '点击关闭这个词的标红',
        chipUnmute: '已关闭，点击恢复这个词的标红',
        duplicate: '已经有一条一样的关键词了，这条没有改动：',
        duplicateHint: '同一个词只留一条（关掉「区分大小写」时 is 与 IS 算同一个词）。',
        mute: '抑制',
        unmute: '已抑制',
        muteHint: '抑制后这个词不再标红，徽章保留（对话里点徽章也是同一个开关）',
        whole: '完整词',
        wholeHint: '只标注作为完整词出现的匹配：前后紧挨着字母或数字的不算（勾上以后 is 不会命中 this，也不会命中 ThisIs）。',
        styleMenu: '样式设置',
        styleMenuHint: '颜色、字体、加粗、斜体、下划线',
        style: '样式',
        colorLabel: '颜色',
        textColorLabel: '文字颜色',
        follow: '跟随',
        followHint: '不加自己的颜色，跟随主题的正文色（深浅色切换也不会看不清）',
        fontSizeLabel: '文字大小',
        fontSizeUp: '加大一号',
        fontSizeDown: '减小一号',
        sizeUnit: 'px',
        font: '字体',
        fontDefault: '默认',
        fontMono: '等宽',
        fontSerif: '衬线',
        bold: '加粗',
        italic: '斜体',
        underline: '下划线',
        badgeSettings: '徽章设置',
        badgeSettingsHint: '徽章的大小、颜色、样式与纹理',
        badgeShared: '全部徽章',
        badgeSharedHint: '所有关键词默认跟随的徽章外观；单个词可以有自己的设置',
        badgeSubjectGlobal: '所有关键词的默认',
        badgeOwn: '这个词有自己的设置',
        badgeFollows: '跟随全局',
        badgePreview: '预览',
        badgePreviewNote: '放大后行高会自动让位，徽章不会被裁掉',
        badgePreviewText: '折叠行后面的预览文字',
        badgeTemplates: '模板',
        badgeTemplatesMine: '我的模板',
        badgeSaveTemplate: '存为模板',
        badgeTemplateName: '模板名字',
        badgeTemplatePick: '选择模板…',
        badgeTemplateNone: '还没有保存的模板',
        badgeSave: '保存',
        badgeCancel: '取消',
        badgeDeleteTemplate: '删除模板',
        badgeTemplateCopy: '的副本',
        badgeTemplatesFull: '模板已达上限（最多 12 个）',
        badgeReset: '还原',
        badgeResetOwn: '恢复成跟随全局的徽章',
        badgeResetGlobal: '把所有徽章恢复成默认外观',
        badgeDone: '完成',
        badgeClose: '关闭',
        badgeSize: '大小',
        badgeSizeUp: '放大一档',
        badgeSizeDown: '缩小一档',
        badgeFollowText: '跟随文字大小',
        badgeFollowTextHint: '关掉后徽章不再跟着这个词的字号变，只按上面的倍数画',
        badgeBg: '底色',
        badgeInk: '文字',
        badgeFrame: '边框色',
        badgeTheme: '主题',
        badgeKeyword: '词色',
        badgeNoFill: '透明',
        badgeShape: '形状',
        badgeShapeRounded: '圆角',
        badgeShapePill: '胶囊',
        badgeShapeSquare: '方框',
        badgeStroke: '描边',
        badgeStrokeHairline: '细',
        badgeStrokeSolid: '粗',
        badgeNone: '无',
        badgeShadow: '阴影',
        badgeShadowSoft: '柔和',
        badgeShadowGlow: '发光',
        badgeTexture: '纹理',
        badgeTextureHint: '上传一张图片作为徽章底纹；图片只存在这台浏览器里，不会上传',
        badgeUpload: '上传图片',
        badgeReplace: '换一张',
        badgeRemoveTexture: '去掉纹理',
        badgeFit: '填充',
        badgeFitRepeat: '平铺',
        badgeFitCover: '拉伸',
        badgeFitContain: '居中',
        badgeOpacity: '显影',
        badgeTextureTooBig: '这张图太大了，换一张小一点的',
        badgeTextureFailed: '读不出这张图片，换一张试试',
        badgeTemplateDefault: '默认',
        badgeTemplateEmphasis: '强调',
        badgeTemplatePill: '胶囊',
        badgeTemplateOutline: '描边',
        badgeTemplateSquare: '方框',
        badgeTemplateGlow: '夜光',
      },
      en: {
        nav: 'Thinking Highlighter',
        title: 'Thinking Highlighter',
        lead: 'Counts the keywords below inside thinking rows and highlights them in the chain of thought; the eye button on the right toggles highlighting for that row.',
        language: 'Language',
        languageHint: 'The plugin’s own language; its nav row follows too',
        enabled: 'Plugin',
        enabledHint: 'Hide every colour, chip and highlight at once',
        caseSensitive: 'Case sensitive',
        caseSensitiveHint: 'Off, is also matches IS; on, only an exact case match counts.',
        chipsWhenCollapsed: 'Chips when collapsed',
        chipsWhenCollapsedHint: 'Whether a folded row shows its chips and eye',
        liftOnExpand: 'Expand lifts the box',
        liftOnExpandHint: 'Off by default. DSH folds one turn’s process into a scroll box capped at 400px; if an expanded row is clipped by it, turn this on and the plugin drops that cap while a row is open.',
        keywords: 'Keywords',
        keywordsHint: 'One word per row; the icon on the right holds its colour and text style',
        version: 'version',
        add: 'Add keyword',
        keywordsFull: 'Limit reached (200 keywords max)',
        remove: 'Remove',
        keywordPlaceholder: 'Type a keyword…',
        reset: 'Restore defaults',
        empty: 'No keywords yet — use “Add keyword” to create one.',
        showHighlight: 'Show highlighting',
        hideHighlight: 'Hide highlighting',
        rowToggle: 'Highlighting for this row',
        chipMute: 'Click to stop highlighting this keyword',
        chipUnmute: 'Off — click to highlight this keyword again',
        duplicate: 'A keyword with the same text already exists — this row was left unchanged:',
        duplicateHint: 'One row per word (with “Case sensitive” off, is and IS are the same word).',
        mute: 'Suppress',
        unmute: 'Suppressed',
        muteHint: 'A suppressed keyword stops being highlighted; its chips stay in place (the chips in the transcript are the same switch)',
        whole: 'Whole word',
        wholeHint: 'Only matches that stand alone count: a keyword with a letter or digit right next to it is ignored (with this on, is never matches this or ThisIs).',
        styleMenu: 'Text style',
        styleMenuHint: 'Color, font, bold, italic, underline',
        style: 'Style',
        colorLabel: 'Color',
        textColorLabel: 'Text color',
        follow: 'Theme',
        followHint: 'Add no colour of its own and follow the theme’s body text, so it stays readable in light and dark',
        fontSizeLabel: 'Text size',
        fontSizeUp: 'One step larger',
        fontSizeDown: 'One step smaller',
        sizeUnit: 'px',
        font: 'Font',
        fontDefault: 'Default',
        fontMono: 'Monospace',
        fontSerif: 'Serif',
        bold: 'Bold',
        italic: 'Italic',
        underline: 'Underline',
        badgeSettings: 'Badge settings',
        badgeSettingsHint: 'Size, colour, style and texture of the count badge',
        badgeShared: 'All badges',
        badgeSharedHint: 'The badge every keyword follows; a single keyword can have its own',
        badgeSubjectGlobal: 'Default for every keyword',
        badgeOwn: 'This keyword has its own',
        badgeFollows: 'Follows the shared badge',
        badgePreview: 'Preview',
        badgePreviewNote: 'The row makes room for it, so a larger badge is never clipped',
        badgePreviewText: 'the folded preview follows the chips',
        badgeTemplates: 'Templates',
        badgeTemplatesMine: 'My templates',
        badgeSaveTemplate: 'Save as template',
        badgeTemplateName: 'Template name',
        badgeTemplatePick: 'Pick a template…',
        badgeTemplateNone: 'No saved templates yet',
        badgeSave: 'Save',
        badgeCancel: 'Cancel',
        badgeDeleteTemplate: 'Delete template',
        badgeTemplateCopy: 'copy',
        badgeTemplatesFull: 'Template limit reached (12 max)',
        badgeReset: 'Reset',
        badgeResetOwn: 'Go back to following the shared badge',
        badgeResetGlobal: 'Restore the default look for every badge',
        badgeDone: 'Done',
        badgeClose: 'Close',
        badgeSize: 'Size',
        badgeSizeUp: 'One step larger',
        badgeSizeDown: 'One step smaller',
        badgeFollowText: 'Follow the word’s size',
        badgeFollowTextHint: 'Off, the badge stops following this word’s text size and draws at the factor alone',
        badgeBg: 'Fill',
        badgeInk: 'Text',
        badgeFrame: 'Frame',
        badgeTheme: 'Theme',
        badgeKeyword: 'Word',
        badgeNoFill: 'None',
        badgeShape: 'Shape',
        badgeShapeRounded: 'Rounded',
        badgeShapePill: 'Pill',
        badgeShapeSquare: 'Square',
        badgeStroke: 'Stroke',
        badgeStrokeHairline: 'Thin',
        badgeStrokeSolid: 'Thick',
        badgeNone: 'None',
        badgeShadow: 'Shadow',
        badgeShadowSoft: 'Soft',
        badgeShadowGlow: 'Glow',
        badgeTexture: 'Texture',
        badgeTextureHint: 'Upload an image to fill the badge with; it stays in this browser and is never uploaded',
        badgeUpload: 'Upload image',
        badgeReplace: 'Replace',
        badgeRemoveTexture: 'Remove texture',
        badgeFit: 'Fill',
        badgeFitRepeat: 'Tile',
        badgeFitCover: 'Stretch',
        badgeFitContain: 'Fit',
        badgeOpacity: 'Strength',
        badgeTextureTooBig: 'That image is too large — try a smaller one',
        badgeTextureFailed: 'That image could not be read — try another',
        badgeTemplateDefault: 'Default',
        badgeTemplateEmphasis: 'Emphasis',
        badgeTemplatePill: 'Pill',
        badgeTemplateOutline: 'Outline',
        badgeTemplateSquare: 'Square',
        badgeTemplateGlow: 'Glow',
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
/*
 * The chip's own size follows the keyword's. --dsh-th-chip-scale is the factor its size
 * carries against the reader's body size, and --dsh-th-chip-line is the tallest the
 * chip may draw: the header line of a collapsed row is pinned by the host to a fixed
 * height (24px plus its own content-font delta) with containment, so a chip taller than
 * that line is clipped rather than read. The line height therefore grows by only two
 * thirds of the factor (the text grows faster than its box) and is capped against a
 * length the client computes from the host's own variable; where that variable is
 * missing the cap is none, which is exactly the behaviour before it existed. The
 * fallback of 1 is what a keyword left at the default size gets, so that chip is exactly
 * the chip it always was.
 */
.dsh-th-badge{position:relative;overflow:hidden;display:inline-flex;align-items:center;gap:4px;flex:none;padding:0 6px;border-radius:var(--dsh-th-radius,6px);font:inherit;font-size:calc(12px * var(--dsh-th-chip-scale,1));line-height:var(--dsh-th-chip-line,calc(16px * (1 + (var(--dsh-th-chip-scale,1) - 1) * .667)));font-weight:var(--dsh-th-weight,400);color:var(--dsh-th-ink,var(--dsh-th-ink-default));background:var(--dsh-th-bg,var(--dsw-alias-interactive-bg-hover));border-style:solid;border-width:var(--dsh-th-frame-width,1px);border-color:var(--dsh-th-frame,transparent);cursor:pointer}
/*
 * Every field the badge editor can set arrives as one of the custom properties above,
 * and each of them falls back to the value this chip drew with before the editor
 * existed. That is what keeps a chip nobody has customised byte-identical: no inline
 * paint at all, only the host's own tokens.
 */
.dsh-th-badge{--dsh-th-ink-default:var(--dsw-alias-label-secondary)}
.dsh-th-badge[data-count="1"]{--dsh-th-ink-default:var(--dsw-alias-label-tertiary)}
/* The uploaded texture, laid into the chip's own box; the chip's text stays on top. */
.dsh-th-badge::before{content:'';position:absolute;inset:0;border-radius:inherit;background-image:var(--dsh-th-tex,none);background-repeat:var(--dsh-th-tex-repeat,repeat);background-size:var(--dsh-th-tex-size,auto);background-position:center;opacity:var(--dsh-th-tex-alpha,1);pointer-events:none}
.dsh-th-badge>*{position:relative;z-index:1}
/* Shadows are the one decoration a token cannot express as a colour alone, so they
   are named modes; the glow borrows whichever colour the frame already carries. */
.dsh-th-badge[data-shadow="soft"]{box-shadow:0 1px 3px rgb(0 0 0 / 18%)}
.dsh-th-badge[data-shadow="glow"]{box-shadow:0 0 0 1px var(--dsh-th-frame,var(--dsw-alias-border-l3)),0 0 6px 1px var(--dsh-th-frame,var(--dsw-alias-border-l3))}
.dsh-th-badge:hover{background:var(--dsh-th-bg,var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover)))}
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
.dsh-th-count{color:var(--dsh-th-count-ink,var(--dsw-alias-label-caption));font-variant-numeric:tabular-nums}
.dsh-th-acts{display:flex;align-items:center;flex:none;margin-left:2px}
.dsh-th-eye{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;opacity:.45;transition:opacity 120ms ease,color 120ms ease,background-color 120ms ease}
[data-open]:hover .dsh-th-eye,.dsh-th-eye:focus-visible{opacity:1}
.dsh-th-eye:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-th-eye:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-body .dsh-th-hit{border-radius:3px}
/*
 * One row switched off with its eye. The marks stay in the DOM — the row has to keep
 * them so switching the eye back on is instant and lossless — so "off" is expressed
 * by neutralising every part of the mark: the tint, the keyword's own type styling
 * (bold/italic/underline/typeface), its own text colour and its size. Leaving the last
 * two out would have made the eye a half-switch: a resized or recoloured word stayed
 * visibly highlighted with its tint gone.
 */
[data-dsh-hl="off"] .dsh-th-body .dsh-th-hit{background-color:transparent !important;font-weight:inherit !important;font-style:inherit !important;text-decoration:inherit !important;font-family:inherit !important;color:inherit !important;font-size:inherit !important}
/*
 * The settings page follows the host's own settings rows (the .PgWN5G_row rule in
 * @deepseek-ai/dsh-client-ui-settings-general, mirrored here): label and description
 * stacked on the left, the control on the right, and a hairline under every row.
 * Controls use the host's filled look — a light fill instead of an outline — so the
 * page reads as part of the settings shell rather than a form inside it.
 */
.dsh-th-section{display:flex;flex-direction:column;max-width:760px;color:var(--dsw-alias-label-primary)}
.dsh-th-head{display:flex;flex-direction:column;gap:4px;padding-bottom:8px}
.dsh-th-heading{display:flex;align-items:center;gap:8px;margin:0;font-size:18px;font-weight:600;line-height:26px}
.dsh-th-intro{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-th-group{display:flex;flex-direction:column}
.dsh-th-setrow{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-th-setlabel{display:flex;flex-direction:column;min-width:0}
.dsh-th-settitle{font-size:14px;line-height:20px}
.dsh-th-setdesc{margin-top:4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-th-tag{padding:0 6px;border-radius:6px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);font-variant-numeric:tabular-nums}
.dsh-th-seg{display:inline-flex;flex:none;gap:2px;padding:3px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover)}
.dsh-th-seg-item{padding:5px 14px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;cursor:pointer}
.dsh-th-seg-item[data-on]{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 1px 2px rgb(0 0 0 / 6%)}
.dsh-th-seg-item:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-switch{position:relative;flex:none;width:40px;height:22px;padding:2px;border:0;border-radius:999px;background:var(--dsw-alias-border-l3);cursor:pointer;transition:background-color 120ms ease}
.dsh-th-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.dsh-th-switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
.dsh-th-knob{display:block;width:18px;height:18px;border-radius:50%;background:var(--dsw-alias-switch-thumb,var(--dsw-alias-label-primary-foreground));box-shadow:0 1px 2px rgb(0 0 0 / 18%);transition:transform 120ms ease}
.dsh-th-switch[aria-checked="true"] .dsh-th-knob{transform:translateX(18px)}
/* The keyword group's heading reuses the settings-row layout but keeps no hairline:
   the first keyword row draws its own, so the heading would otherwise box the list in.
   Its padding is balanced around the text instead of the row's even 16/16 — the plain
   row padding left the heading hugging the hairline above it with a wide gap under it,
   which reads as text sitting too high. */
.dsh-th-grouphead{padding:14px 0 4px;border-bottom:0}
.dsh-th-kws{display:flex;flex-direction:column}
.dsh-th-kw{display:flex;flex-direction:column;gap:8px;padding:14px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-th-kwrow{display:flex;align-items:center;gap:8px}
.dsh-th-input{flex:1;min-width:0;height:36px;padding:0 12px;border:0.5px solid transparent;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;outline:none}
.dsh-th-input:focus{border-color:var(--dsw-alias-state-business-primary)}
.dsh-th-input::placeholder{color:var(--dsw-alias-label-dimmed)}
.dsh-th-input[aria-invalid="true"]{border-color:var(--dsw-alias-state-error-primary)}
/* The disclosure that hides colour and text styling behind one icon. */
.dsh-th-disc{display:inline-flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;padding:0;border:0;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-th-disc:hover{color:var(--dsw-alias-label-primary)}
.dsh-th-disc[aria-expanded="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-th-disc:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-disc svg{transition:transform 120ms ease}
.dsh-th-disc[aria-expanded="true"] svg{transform:rotate(90deg)}
/* Whole-word lock: the slot the colour used to sit in. */
.dsh-th-whole{flex:none;height:36px;padding:0 14px;border:0;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;cursor:pointer}
.dsh-th-whole:hover{color:var(--dsw-alias-label-primary)}
.dsh-th-whole[aria-pressed="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-th-whole:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
/* The open style panel: a slightly darker surface, so it reads as its own sheet. */
.dsh-th-panel{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;border-radius:12px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-interactive-bg-hover))}
.dsh-th-panelLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.dsh-th-select{height:32px;padding:0 8px;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-th-select:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-style{display:inline-flex;align-items:center;justify-content:center;flex:none;width:32px;height:32px;padding:0;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:13px;line-height:18px;cursor:pointer}
.dsh-th-style[aria-pressed="true"]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-th-style:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-styleB{font-weight:700}
.dsh-th-styleI{font-style:italic}
.dsh-th-styleU{text-decoration:underline}
.dsh-th-color{position:relative;display:inline-flex;flex:none;align-items:center;gap:6px;height:32px;padding:0 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);cursor:pointer}
.dsh-th-swatch{position:absolute;inset:0;width:100%;height:100%;opacity:0;padding:0;border:0;cursor:pointer}
.dsh-th-dot{width:14px;height:14px;border-radius:4px;box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2)}
.dsh-th-hex{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
/* "Follow the theme": a plain chip that hands one value back to the host. It reads as
   switched on when the value is nothing but the host's, because that is what it means. */
.dsh-th-follow{height:32px;padding:0 10px;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-th-follow:hover{color:var(--dsw-alias-label-primary)}
.dsh-th-follow[data-following]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font-weight:600}
.dsh-th-follow:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
/* The size stepper, in the host's own shape: the value centred, the two arrows stacked
   at its right, and each arrow disabled at the end of the host's own range. */
.dsh-th-size{display:inline-flex;align-items:center;height:32px;padding:0 6px 0 12px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsh-th-sizeValue{min-width:2ch;text-align:center;font-size:12px;line-height:18px;font-variant-numeric:tabular-nums}
.dsh-th-sizeUnit{padding-left:2px;font-size:11px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-th-sizeArrows{display:inline-flex;flex-direction:column;margin-left:4px}
.dsh-th-arrow{display:inline-flex;align-items:center;justify-content:center;width:16px;height:12px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.dsh-th-arrow:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/* At either end of the host's range the arrow that would leave it stays visible but dead. */
.dsh-th-arrow:disabled{color:var(--dsw-alias-label-dimmed);cursor:not-allowed}
.dsh-th-arrow:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-mute{flex:none;height:36px;padding:0 14px;border:0;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;cursor:pointer}
.dsh-th-mute:hover{color:var(--dsw-alias-label-primary)}
.dsh-th-mute[aria-pressed="true"]{background:transparent;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2);color:var(--dsw-alias-label-dimmed)}
.dsh-th-mute:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-icon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;padding:0;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.dsh-th-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-state-error-primary)}
.dsh-th-icon:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-warn{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-warn-label,var(--dsw-alias-state-error-primary))}
.dsh-th-empty{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dsh-th-foot{display:flex;align-items:center;gap:8px;padding-top:16px}
.dsh-th-add{display:inline-flex;align-items:center;gap:6px;height:36px;padding:0 14px;border:0;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:18px;cursor:pointer}
.dsh-th-add:hover{background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
/* At the keyword cap the add button stays visible but stops taking clicks. */
.dsh-th-add[disabled]{opacity:.5;cursor:not-allowed}
.dsh-th-add[disabled]:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dsh-th-add:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-reset{margin-left:auto;height:36px;padding:0 12px;border:0;border-radius:10px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:18px;cursor:pointer}
.dsh-th-reset:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
/*
 * The badge editor is the host's own dialog, spelled with the tokens its Modal
 * primitive uses (a full-viewport layer, a masked backdrop, and a card on the
 * secondary layer with the prominent elevation), because the settings page it opens
 * from is that shell's own surface. It renders where the plugin already is — inside
 * the settings page — so it needs no portal and no service the plugin does not have.
 */
.dsh-th-veil{pointer-events:auto;position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(24px,var(--dsh-frame-overlay-top,24px)) 24px}
.dsh-th-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;background:var(--dsw-alias-bg-mask-1,rgb(0 0 0 / 32%));backdrop-filter:var(--dsw-mask-blur)}
.dsh-th-dialog{box-sizing:border-box;position:relative;z-index:1;display:flex;flex-direction:column;width:min(580px,100%);max-height:100%;padding:0 0 20px;overflow:hidden;border-radius:var(--dsw-radius-panel,16px);background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base));box-shadow:var(--dsw-elevation-prominent)}
.dsh-th-dialogHead{display:flex;align-items:center;gap:8px;padding:22px 14px 12px 24px}
.dsh-th-dialogTitle{margin:0;font-size:16px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-primary)}
.dsh-th-dialogSubject{max-width:12em;padding:0 8px;border-radius:6px;font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);background:var(--dsw-alias-interactive-bg-hover);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-th-dialogClose{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;margin-left:auto;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-secondary);font-size:15px;line-height:1;cursor:pointer}
.dsh-th-dialogClose:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-th-dialogBody{display:flex;flex-direction:column;min-height:0;overflow:auto;padding:0 24px}
.dsh-th-dialogFoot{display:flex;align-items:center;gap:8px;padding:18px 24px 0}
/* The dialog's own state line leads the footer; the two actions answer it on the right. */
.dsh-th-dialogFoot .dsh-th-panelLabel{margin-right:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/*
 * One row of the badge editor, in the settings page's own shape: the label in a column of
 * a fixed width on the left, the controls pushed to the right edge — so every control in
 * the dialog ends at the same x, and a row reads as "this setting, that value" — and the
 * hairline the host draws under its own settings rows. Thirteen controls in one column
 * need that rhythm to be readable at all.
 */
.dsh-th-brow{display:flex;align-items:flex-start;gap:12px;padding:9px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.dsh-th-brow:last-child{border-bottom:0}
.dsh-th-browLabel{flex:none;width:64px;padding-top:7px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;word-break:break-word}
.dsh-th-browBody{display:flex;flex-wrap:wrap;align-items:center;justify-content:flex-end;gap:8px;min-width:0;flex:auto}
/* A note under a row's controls takes a line of its own rather than squeezing beside them. */
.dsh-th-browBody>.dsh-th-fieldNote{flex-basis:100%;margin:0}
/*
 * The three segmented rows are the same size as each other: a grid gives every segment the
 * same track (so the bubbles inside a group match too), and the shared minimum width is
 * what makes 形状, 描边 and 阴影 come out at one size instead of three, each as wide as its
 * own longest word. The settings page's language control keeps its inline sizing.
 */
.dsh-th-browBody>.dsh-th-seg{flex:none;display:inline-grid;grid-auto-flow:column;grid-auto-columns:1fr;min-width:240px}
.dsh-th-browBody>.dsh-th-seg .dsh-th-seg-item{padding:5px 10px;white-space:nowrap}
/* The preview is the transcript's own line, drawn with the transcript's own parts:
   a title, the separator dot, then the chips and the folded preview text after them. */
.dsh-th-preview{display:flex;align-items:center;gap:8px;flex:auto;padding:12px;border-radius:var(--dsw-radius-md,10px);background:var(--dsw-alias-markdown-code-block,var(--dsw-alias-interactive-bg-hover))}
.dsh-th-previewLine{display:flex;align-items:center;min-width:0;flex:auto}
.dsh-th-previewTitle{flex:none;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(24px + var(--dsh-content-font-delta,0px));color:var(--dsw-alias-label-tertiary)}
.dsh-th-previewDot{flex:none;width:2px;height:2px;margin:0 8px;border-radius:1px;background:var(--dsw-alias-label-caption)}
.dsh-th-previewText{min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-th-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:0;border-radius:var(--dsw-radius-md,10px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;cursor:pointer}
.dsh-th-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.dsh-th-btn[data-primary]{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));color:var(--dsw-alias-label-primary-foreground)}
.dsh-th-btn[data-primary]:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary))}
.dsh-th-btn[data-outline]{box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l3)}
.dsh-th-btn:disabled{opacity:.4;cursor:not-allowed}
.dsh-th-btn:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
/* A template is a look you can put on in one click: the presets, then your own. */
.dsh-th-tpls{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
/* The saved ones are a list that grows, so they live in a dropdown — and it takes the
   width its names need up to a point, rather than pushing the row out of the dialog. */
.dsh-th-browBody>.dsh-th-select{min-width:150px;max-width:250px}
.dsh-th-tpl{display:inline-flex;align-items:center;gap:4px;height:30px;padding:0 10px;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-th-tpl:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover-solid,var(--dsw-alias-interactive-bg-hover))}
.dsh-th-tpl:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-name{height:30px;min-width:8em;padding:0 10px;border:.5px solid transparent;border-radius:8px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-interactive-bg-hover));color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;outline:none}
.dsh-th-name:focus{border-color:var(--dsw-alias-state-business-primary)}
/* The texture: a thumbnail of what is uploaded, how it is laid in, and how strongly. */
.dsh-th-tex{display:flex;align-items:center;gap:10px}
.dsh-th-texThumb{width:40px;height:40px;flex:none;border-radius:10px;background-position:center;background-size:cover;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2),0 1px 2px rgb(0 0 0 / 8%)}
.dsh-th-texEmpty{display:inline-flex;align-items:center;justify-content:center;width:40px;height:40px;flex:none;border-radius:10px;color:var(--dsw-alias-label-dimmed);font-size:11px;line-height:1;box-shadow:inset 0 0 0 .5px var(--dsw-alias-border-l2)}
.dsh-th-file{display:none}
.dsh-th-range{flex:1;min-width:120px;max-width:220px;height:24px;accent-color:var(--dsw-alias-brand-primary)}
.dsh-th-fieldNote{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
/* The two ways into the editor: the panel's own button, and the one that edits the
   shared badge the whole list follows (which sits on the page, not in a panel). */
.dsh-th-badgeopen{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 10px;border:0;border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.dsh-th-badgeopen[data-placement="page"]{height:36px;padding:0 14px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);font-size:13px}
.dsh-th-badgeopen:hover{color:var(--dsw-alias-label-primary)}
.dsh-th-badgeopen[data-own]{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-foreground)}
.dsh-th-badgeopen:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:1px}
.dsh-th-dotmark{width:6px;height:6px;flex:none;border-radius:50%;background:currentColor}
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

    /** The disclosure chevron; the stylesheet turns it a quarter when open. */
    function ChevronIcon() {
      return React.createElement(
        'svg',
        { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true', focusable: 'false' },
        React.createElement('path', {
          d: 'M6 3.5 10.5 8 6 12.5',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

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

    /** One arrow of the size stepper; `up` picks the direction it points. */
    function StepIcon(props) {
      return React.createElement(
        'svg',
        { viewBox: '0 0 10 6', width: 9, height: 6, 'aria-hidden': 'true', focusable: 'false' },
        React.createElement('path', {
          d: props.up === true ? 'M1 5 5 1 9 5' : 'M1 1 5 5 9 1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
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

    function TrashIcon() {      return React.createElement(
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
     * What may sit next to a whole-word keyword: letters, digits and underscore are
     * "still inside a word". `is` then stops matching `this`, and a Chinese keyword
     * only matches where it is not glued to more characters.
     */
    const WORD_EDGE = '[\\p{L}\\p{N}_]'
    const WORD_HEAD = '(?<!' + WORD_EDGE + ')'
    const WORD_TAIL = '(?!' + WORD_EDGE + ')'

    /** One keyword as a pattern body, bounded when the reader locked it to whole words. */
    function keywordBody(item) {
      const escaped = escapeRegExp(item.text)
      return item.whole === true ? WORD_HEAD + escaped + WORD_TAIL : escaped
    }

    /**
     * One combined pattern for the whole keyword list, longest keyword first so
     * an overlapping shorter one cannot win. A fresh stateful RegExp per node,
     * because `lastIndex` lives on the instance.
     *
     * `u` is required by the lookarounds of a whole-word keyword, and is safe for
     * the rest because every keyword is escaped.
     */
    function buildPattern(items, caseSensitive) {
      const active = items.filter((item) => item.text.length > 0).slice(0, MAX_KEYWORDS)
      if (active.length === 0) return null
      const ordered = [...active].sort((left, right) => right.text.length - left.text.length)
      return new RegExp(ordered.map((item) => '(' + keywordBody(item) + ')').join('|'), caseSensitive ? 'gu' : 'giu')
    }

    function countMatches(text, item, caseSensitive) {
      if (!text || !item.text) return 0
      const pattern = new RegExp('(' + keywordBody(item) + ')', caseSensitive ? 'gu' : 'giu')
      let count = 0
      while (pattern.exec(text) !== null) {
        count += 1
        if (count >= 5000 || pattern.lastIndex === 0) break
      }
      return count
    }

    /**
     * The inline style one keyword's marks carry — bold, italic, underline, the
     * typeface, the keyword's own text colour and its size — or null when the
     * keyword asks for none. The chip's name uses the same object, so what a keyword
     * looks like is visible before you open a row. The background colour is
     * deliberately not part of it: that one rides the frame and the tint.
     *
     * The text colour falls back to `currentColor`, which is what the marked word
     * already inherits from the body around it — so "follow the theme" needs no
     * separate code path and survives a theme flip.
     */
    function markStyle(item) {
      if (item === undefined || item === null) return null
      const style = {}
      if (item.bold === true) style.fontWeight = '600'
      if (item.italic === true) style.fontStyle = 'italic'
      if (item.underline === true) style.textDecoration = 'underline'
      if (item.font === 'mono') style.fontFamily = 'var(--ds-font-family-code)'
      else if (item.font === 'serif') style.fontFamily = 'Georgia, "Times New Roman", serif'
      style.color = item.textColor === null || item.textColor === undefined ? 'currentColor' : item.textColor
      style.fontSize = fontSize(item.fontSize) + 'px'
      return style
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

    /**
     * The disclosure block: the element that owns the header text line. It carries
     * `data-open` only while the row is expanded, so a collapsed row is found
     * through its `[data-disclosure-row]` line instead.
     *
     * The first element child is only the last resort. While the model is still
     * streaming, the shipped row renders a visually-hidden "running" status span
     * (`clip: rect(0 0 0 0); width: 1px; height: 1px; overflow: hidden`) *before*
     * the disclosure block, so taking the first child there put the whole chip set
     * and the eye inside that 1px box: the reader saw no badges at all for exactly
     * as long as they were being counted.
     */
    function headerRowOf(root) {
      for (const candidate of root.querySelectorAll('div[data-open]')) return candidate
      const line = root.querySelector('[data-disclosure-row]')
      const owner = line === null ? null : line.parentElement
      if (owner !== null && owner !== undefined && owner !== root && root.contains(owner) === true) return owner
      const first = root.firstElementChild
      if (first === null) return null
      return first.querySelector('div[data-open]') ?? first
    }

    /**
     * The expanded chain-of-thought container. Rows vary, so the class is stamped
     * on whichever element is found and every later pass finds it by class. A
     * collapsed row has no body and correctly returns null.
     *
     * The shipped layout keeps the expanded content *inside* the disclosure block,
     * directly after the header line (`DisclosureRow` renders
     * `[div[data-disclosure-row], open && children]`), so that is where the body is
     * looked for first. The old walk assumed the body was a sibling of the header
     * and, failing that, stamped whatever the first element child happened to be —
     * which is how the marks ended up on the hidden status span, and why a settled
     * row that had never been seen streaming could not be highlighted at all.
     */
    function bodyOf(root) {
      /*
       * A stamp on an element the host has already replaced is worse than no stamp:
       * the pass would keep marking a body nobody can see. Only a connected stamp
       * counts, and anything else falls through to a fresh structural lookup.
       */
      const own = root.querySelector('.' + BODY_CLASS)
      if (own !== null && own !== undefined && own.isConnected !== false) return own
      const header = headerRowOf(root)
      if (header === null || header === undefined) return null
      /*
       * Where the expanded content sits depends on how the host nests its disclosure,
       * and DSH 0.2.1 added a level:
       *
       *   0.2.1     [data-open] > [data-disclosure-header] > [data-disclosure-row]
       *             [data-open] > body                     the body is the header
       *                                                    block's next sibling
       *   earlier   [data-open] > [data-disclosure-row]
       *             [data-open] > body                     the body is the line's next
       *                                                    sibling
       *
       * Reading only `line.nextElementSibling` is what lost the body in 0.2.1: the
       * line now sits alone inside the header block, so that sibling is null and the
       * chain of thought was never marked. Both nestings describe the same thing —
       * the first element after the header that is not ours — so the candidates are
       * tried in that order instead of assuming one of them.
       */
      const line = header.querySelector('[data-disclosure-row]')
      const candidates = []
      if (line !== null && line !== undefined) {
        candidates.push(line.nextElementSibling)
        const block = line.parentElement
        if (block !== null && block !== undefined && block !== header) candidates.push(block.nextElementSibling)
      }
      /* The older shapes: the second child of the block, or the block's own sibling. */
      candidates.push(line === null || line === undefined ? header.children?.[1] : undefined)
      candidates.push(header.nextElementSibling)
      for (const candidate of candidates) {
        if (candidate === null || candidate === undefined) continue
        if (candidate.nodeType !== 1) continue
        if (candidate.hasAttribute(MARK) === true) continue
        if (candidate.contains(header) === true) continue
        if (root.contains(candidate) !== true) continue
        candidate.classList.add(BODY_CLASS)
        return candidate
      }
      return null
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

    /* ── the room a scaled-up chip asks its row for ─────────────────────────── */

    /**
     * Elements whose own height the plugin raised so a chip could draw at the size the
     * reader asked for, with the inline value to put back. The host pins a collapsed
     * row — and the disclosure line inside it — to `calc(24px +
     * var(--dsh-content-font-delta))` with `contain: size layout` and `overflow:
     * hidden`, so a chip taller than that line is cut off rather than read. The badge
     * editor's size therefore comes with height, taken while it is needed and given
     * back the moment it is not.
     */
    const rooms = new Map()

    /** Put one element's own height back, exactly as it was. */
    function restoreRoom(element) {
      if (rooms.has(element) !== true) return
      const previous = rooms.get(element)
      rooms.delete(element)
      if (previous === '') element.style.removeProperty('height')
      else element.style.height = previous
    }

    /**
     * Raise one element by `extra` px on top of the height the host pins it to. The
     * expression keeps the host's own variable in the calc rather than freezing a
     * number, so a reader who changes the content font size still moves the row.
     */
    function setRoom(element, extra) {
      if (extra <= 0) {
        restoreRoom(element)
        return
      }
      if (rooms.has(element) !== true) rooms.set(element, element.style.height ?? '')
      const value = 'calc(24px + var(--dsh-content-font-delta,0px) + ' + extra + 'px)'
      if (element.style.height !== value) element.style.height = value
    }

    /**
     * How many pixels taller than the host's own line one chip is, over the tallest
     * chip a row shows. Zero for every chip that already fits, which is every chip at
     * the sizes this plugin drew before the editor existed.
     */
    function badgeRoom(items, specOf, linePx) {
      if (linePx === null || linePx === undefined) return 0
      let extra = 0
      for (const item of items) {
        const spec = specOf(item)
        extra = Math.max(extra, Math.ceil(chipBoxHeight(chipScaleOf(item, spec), spec) - linePx))
      }
      return Math.max(0, extra)
    }

    /**
     * Give one row the room its chips need: the disclosure line it draws on, and — while
     * the row is folded — the row itself, whose height the host pins with containment.
     * An expanded row is left alone: its height is its content's, and raising it there
     * would push the transcript around for nothing.
     */
    function applyRoom(root, header, extra, expanded) {
      const line = header === null || header === undefined ? null : header.querySelector('[data-disclosure-row]')
      if (line !== null) setRoom(line, extra)
      if (expanded === true) restoreRoom(root)
      else setRoom(root, extra)
    }

    /**
     * Re-assert every row's chip room and drop the ones nothing needs any more. A host
     * re-render that rebuilds the disclosure line takes the inline height away with the
     * element, and that row would then clip its own chips until something else about it
     * changed — so the sweep puts the room back, exactly as the fold lift does.
     */
    function sweepRooms(roots) {
      const live = new Set()
      for (const root of roots ?? liveRoots()) {
        const entry = rows.get(root)
        const extra = entry?.roomExtra ?? 0
        if (extra <= 0) continue
        const header = headerRowOf(root)
        if (header === null) continue
        const line = header.querySelector('[data-disclosure-row]')
        if (line !== null) {
          setRoom(line, extra)
          live.add(line)
        }
        if (root.hasAttribute('data-expanded') !== true) {
          setRoom(root, extra)
          live.add(root)
        }
      }
      for (const element of [...rooms.keys()]) {
        if (live.has(element) !== true) restoreRoom(element)
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
    }

    /**
     * One chip, as an element: the keyword's name, the ×, its count, and the click that
     * switches this keyword off. The transcript and the badge editor's preview are both
     * built here, so what the preview shows is what the row draws — one function, not
     * two drawings that can drift apart.
     *
     * Everything the reader can change rides a custom property or a data attribute, and
     * every one of those falls back to the value the chip drew with before the editor
     * existed: a chip nobody customised carries no paint of its own at all.
     */
    function buildChip(item, spec, options) {
      const muted = item.muted === true
      /*
       * What the reader asked the badge itself to be: 1 is "the size it always was", and
       * everything below is multiplied by it. It rides the chip's own font size — which is
       * what carries the count's digits and the box around them — and the name previewing
       * the word, because a chip drawn large with its name left at the reader's own text
       * size reads as a mistake rather than as a setting.
       */
      const own = spec === null || spec === undefined ? 1 : badgeNumber(spec.scale, BADGE_SCALE_MIN, BADGE_SCALE_MAX, 1)
      const scale = chipScaleOf(item, spec)
      /*
       * The line box the chip draws in: its own text's height at this factor, which the
       * row is then asked to make room for. It is handed over as `--dsh-th-chip-line`, so
       * the stylesheet draws the chip at the height this same arithmetic measured.
       */
      const line = chipLineHeight(scale)
      const style = {
        '--dsh-th-chip-scale': String(scale),
        '--dsh-th-chip-line': line.toFixed(2) + 'px',
      }
      const nameStyle = markStyle(item)
      if (nameStyle !== null && own !== 1) {
        /* The name's size is the word's own, clamped by the word's own range — times the badge. */
        nameStyle.fontSize = (fontSize(item.fontSize) * own).toFixed(1) + 'px'
      }
      if (muted !== true) {
        if (spec === null || spec === undefined) {
          /* Nobody has an opinion: the keyword's colour rides the frame, as it always has. */
          style.borderColor = hex(item.color)
        } else {
          /*
           * Only the fields that were actually given a value are written. Everything
           * left alone keeps its stylesheet fallback — including the states the sheet
           * expresses per chip, like the dimmer text a single occurrence draws in — so a
           * badge nobody customised is drawn by exactly the rules that always drew it.
           */
          const fill = badgeColorOf(spec.bg)
          if (spec.bg === 'none') style['--dsh-th-bg'] = 'transparent'
          else if (fill !== null) style['--dsh-th-bg'] = fill
          const ink = badgeColorOf(spec.ink)
          if (ink !== null) {
            style['--dsh-th-ink'] = ink
            /* An ink of its own dims the count by that same ink, so the pair stays readable. */
            style['--dsh-th-count-ink'] = 'color-mix(in srgb, ' + ink + ' 72%, transparent)'
          }
          const frame = badgeColorOf(spec.frame)
          if (frame !== null) style['--dsh-th-frame'] = frame
          else if (spec.frame === 'theme') style['--dsh-th-frame'] = 'var(--dsw-alias-border-l3)'
          else style.borderColor = hex(item.color)
          if (spec.border !== 'hairline') style['--dsh-th-frame-width'] = badgeBorderWidth(spec) + 'px'
          if (spec.shape !== 'rounded') style['--dsh-th-radius'] = BADGE_SHAPES[spec.shape] ?? BADGE_SHAPES.rounded
          if (spec.bold === true) style['--dsh-th-weight'] = BADGE_BOLD_WEIGHT
          if (spec.texture !== null) {
            style['--dsh-th-tex'] = 'url("' + spec.texture.src + '")'
            style['--dsh-th-tex-size'] = TEXTURE_SIZES[spec.texture.fit] ?? 'auto'
            style['--dsh-th-tex-repeat'] = spec.texture.fit === 'repeat' ? 'repeat' : 'no-repeat'
            style['--dsh-th-tex-alpha'] = String(spec.texture.alpha)
          }
        }
      }
      const hint = item.text + ' × ' + item.count + ' · ' + (muted ? options.labels.chipUnmute : options.labels.chipMute)
      return React.createElement(
        'button',
        {
          key: item.id,
          type: 'button',
          className: 'dsh-th-badge',
          'data-count': String(item.count),
          'data-muted': muted ? '1' : undefined,
          'data-shadow': muted !== true && spec !== null && spec !== undefined && spec.shadow !== 'none' ? spec.shadow : undefined,
          'aria-pressed': muted ? 'false' : 'true',
          'aria-label': hint,
          title: hint,
          style,
          /*
           * The chip is also this keyword's switch. The click stops at the chip so it
           * cannot also fold or unfold the row it sits on.
           */
          onClick(event) {
            event.preventDefault()
            event.stopPropagation()
            if (typeof options.onToggleKeyword === 'function') options.onToggleKeyword(item.id)
          },
        },
        React.createElement('span', { className: 'dsh-th-badge-name', style: nameStyle ?? undefined }, item.text),
        React.createElement('span', { className: 'dsh-th-badge-x' }, '×'),
        React.createElement('span', { className: 'dsh-th-count' }, String(item.count)),
      )
    }

    /** A badge field's own colour when it has one, or null while it is a token, a word or a mode. */
    function badgeColorOf(value) {
      return typeof value === 'string' && value.startsWith('#') === true ? value : null
    }

    /**
     * Render the chip set into the plugin's own container. React owns every node
     * inside it, so the host tree never re-renders or removes anything of ours.
     */
    function paintBadges(entry, children, labels, lang) {
      const container = entry.mount
      if (container === undefined || container.isConnected !== true) return
      try {
        if (entry.mountReact === undefined) {
          entry.mountReact = ReactDOMClient.createRoot(container, { onRecoverableError: () => {} })
        }
        /*
         * The dictionary has no `lang` key of its own — asking it for one answers the
         * key itself, which is how the container ended up carrying `lang="lang"`.
         */
        container.lang = lang === undefined || labels === undefined ? 'zh-CN' : lang === 'en' ? 'en' : 'zh-CN'
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
      /* Read here rather than taken from the caller: the room below is the row's own. */
      const expanded = isExpanded(root, header)
      const eye = (next) => {
        entry.highlighted = next
        setHighlight(root, next === true && options.enabled === true)
        /*
         * Revealing is instant when the marks are there, which is what the rebuild
         * above guarantees. A row whose marks are gone anyway (a host re-render that
         * landed while the eye was off, or a plugin switch) has nothing to reveal, so
         * its caches go and the next pass rebuilds it. The pass is requested
         * explicitly: the attribute write above is not a mutation the observer watches.
         */
        if (next === true) {
          if (entry.sample === undefined || entry.sample.isConnected !== true) {
            entry.text = undefined
            entry.bodyKey = undefined
          }
          if (typeof options.requestPass === 'function') options.requestPass()
        }
        decorate(root, entry, counts, colors, options)
      }
      const children = []
      const chips = []
      /*
       * What one chip draws with: its keyword's own look, or the shared one every
       * keyword follows until it is given one of its own. Resolved once here and used
       * for the chip, for the room it asks for, and for the key that decides whether
       * the set has to be drawn again.
       */
      const specOf = (item) => (item.badge === null || item.badge === undefined ? options.badge ?? null : item.badge)
      for (const item of counts) {
        /*
         * The chip's own size follows its keyword's: the reader set the size to make
         * that word stand out, so a chip still drawn at the default size would
         * contradict the word it points at. `--dsh-th-chip-scale` carries the factor and
         * the stylesheet applies it to the chip's font size and line height; its padding
         * stays as it is, because the box a chip draws must not grow a second time with
         * the text inside it. Everything else the badge editor can set rides the same
         * one element — see `buildChip`.
         */
        chips.push(buildChip(item, specOf(item), options))
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
        entry.mountKey = undefined
        entry.roomExtra = 0
        applyRoom(root, header, 0, expanded)
        return
      }
      /*
       * The room the chips need, granted before anything is drawn: a chip scaled past
       * the host's own line height would otherwise be clipped by the row it sits on.
       */
      const room = badgeRoom(counts, specOf, options.chipLinePx)
      entry.roomExtra = room
      applyRoom(root, header, room, expanded)
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
      }
      /*
       * The key covers everything a chip shows: its count, its off state, the size it
       * draws at, the look the badge editor gave it, the text style its name previews —
       * and the language of its label and tooltip, which changes with nothing else on
       * the row.
       */
      const key =
        counts
          .map(
            (item) =>
              item.id +
              ':' +
              item.count +
              (item.muted === true ? '!' : '') +
              'z' +
              String(chipScaleOf(item, specOf(item))) +
              styleKey(item),
          )
          .join('|') +
        '#' +
        String(entry.highlighted === true) +
        '@' +
        String(options.lang ?? '')
      if (entry.mountKey === key && entry.mount.childElementCount === children.length) return
      entry.mountKey = key
      paintBadges(entry, children, options.labels, options.lang)
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
    function wrapNode(node, body, items, caseSensitive, tintFor, styleFor) {
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
          /* Optional second half: the keyword's own bold / italic / underline / font. */
          const extra = typeof styleFor === 'function' ? styleFor(segment.text) : null
          if (extra !== null && extra !== undefined) {
            for (const name of Object.keys(extra)) span.style[name] = extra[name]
          }
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
     * DSH's own reasoning-translation plugin claims the reasoning body slot and
     * renders `[data-cot-translation] > (toolbar, rendered reasoning)`. The wrapper is
     * the only thing that says so; without the plugin the body is the reasoning.
     */
    function translationWrapperOf(body) {
      if (body === null || body === undefined || typeof body.querySelector !== 'function') return null
      const wrapper = body.querySelector('[data-cot-translation]')
      return wrapper === null || wrapper === undefined ? null : wrapper
    }

    /**
     * The element that actually carries the reasoning text inside a body.
     *
     * The translation toolbar is chrome — "view translation", the spinner, the retry
     * action — so neither its words nor its buttons may be marked, and the string
     * behind the wrapper is the translated one, not the row's original. Its last
     * element child is the rendered reasoning; the body itself is the reasoning when
     * no wrapper is there.
     */
    function reasoningRootOf(body) {
      const wrapper = translationWrapperOf(body)
      if (wrapper === null) return body
      return wrapper.lastElementChild ?? body
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
      /*
       * A chip set the host detached — it re-rendered the header away, or moved the
       * seat — is out of the document, so no query can find it again. Without this
       * the row keeps its stale caches, the early return below skips it forever and
       * the badges stay invisible while their React root stays alive; dropping the
       * caches sends the row through the full path, which re-seats the same container.
       */
      if (entry.mount !== undefined && entry.mount.isConnected !== true) {
        entry.text = undefined
        entry.bodyKey = undefined
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
      /*
       * With DSH's own reasoning translation installed, the open body shows the
       * translated string rather than the row's own `text` prop. Counting the original
       * there would leave every chip disagreeing with the marks the reader can see, so
       * a translated body is counted from itself; a folded row has no body at all and
       * keeps counting the whole chain.
       */
      const body = bodyOf(root)
      const wrapper = translationWrapperOf(body)
      const counted =
        wrapper === null ? (folded === null ? domText : folded) : unmarkedText(reasoningRootOf(body))
      /* The DOM text stays in the key: the preview appearing or leaving is a change. */
      const text = counted + '\u0000' + domText
      const patternChanged = entry.patternKey !== options.patternKey
      /*
       * A language flip changes nothing about the text or the pattern, but every
       * chip's label, tooltip and `lang` attribute has to follow it — and the early
       * return below would otherwise keep the rows the reader is looking at in the
       * old language until something else about them changed.
       */
      const labelsChanged = entry.labelsKey !== options.labelsKey
      if (
        entry.text === text &&
        patternChanged !== true &&
        labelsChanged !== true &&
        entry.enabled === options.enabled &&
        entry.expanded === expanded
      ) {
        return
      }
      entry.text = text
      entry.patternKey = options.patternKey
      entry.labelsKey = options.labelsKey
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
      const styles = {}
      const counts = []
      /*
       * Case-insensitive matching hands the *matched* text to the lookups, which may
       * be cased differently from the keyword, so both maps are keyed the way the
       * match is keyed — otherwise `IS` would fall back to the default color.
       */
      const keyOf = (word) => (options.caseSensitive === true ? word : word.toLowerCase())
      if (options.enabled === true) {
        for (const item of options.items) {
          if (item.text.length === 0) continue
          const key = keyOf(item.text)
          colors[key] = item.color
          styles[key] = item
          const count = countMatches(counted, item, options.caseSensitive)
          if (count > 0) {
            counts.push({
              id: item.id,
              text: item.text,
              count,
              color: item.color,
              muted: item.muted === true,
              whole: item.whole === true,
              font: item.font,
              bold: item.bold === true,
              italic: item.italic === true,
              underline: item.underline === true,
              textColor: item.textColor ?? null,
              fontSize: item.fontSize,
              /* The chip's own look, or null while this keyword follows the shared one. */
              badge: item.badge ?? null,
            })
          }
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
      const reasoning = reasoningRootOf(body)
      const bodyText = unmarkedText(reasoning)
      const bodyKey = entry.bodyKey
      if (typeof bodyKey === 'string' && bodyKey === bodyText && entry.enabled === options.enabled) return

      unwrapBody(body)
      /* Whatever the body holds *now* is the text the marks were rebuilt from. */
      entry.bodyKey = unmarkedText(reasoning)
      entry.sample = undefined
      setHighlight(root, entry.highlighted === true && options.enabled === true)
      /*
       * The per-row eye is a presentation switch, not a filter on the work: the marks
       * are rebuilt whatever it says and the stylesheet hides them while the row is
       * switched off (`[data-dsh-hl="off"]`). Skipping the rebuild here is what made
       * the eye lossy — muting a chip (or any other change to the row) while the eye
       * was off dropped the body's marks, and switching the eye back on only repainted
       * the chips, so even untouched keywords stayed unhighlighted.
       */
      if (options.enabled !== true) return
      /*
       * Muted keywords are left out of the wrap entirely, so a keyword the reader
       * switched off is not merely invisible: the text itself stops being split.
       */
      const active = options.items.filter((item) => item.muted !== true)
      const tintFor = (word) => toTint(colors[keyOf(word)] ?? DEFAULT_COLOR, TINT_ALPHA)
      const styleFor = (word) => markStyle(styles[keyOf(word)])
      /*
       * The walk starts at the reasoning itself, not at the body: DSH's reasoning
       * translation wraps the text in a toolbar plus the rendered chain, and the
       * toolbar's own words ("view translation", "retry") are chrome that must stay
       * out of both the marks and the counts.
       */
      const stack = [reasoning]
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
          if (node.nodeType === 3) wrapNode(node, body, active, options.caseSensitive, tintFor, styleFor)
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

    /**
     * Drop the per-row text and body caches. The next pass then rebuilds every row
     * from whatever the settings say now, which is what a settings change made
     * outside this document (another window, or `refresh`) needs.
     */
    function forgetRows() {
      for (const root of liveRoots()) {
        const entry = rows.get(root)
        if (entry === undefined) continue
        entry.text = undefined
        entry.bodyKey = undefined
      }
    }

    /** Observe the conversation and keep every reasoning row decorated. */
    function startDecorating(handle) {
      let scheduled = 0
      let sweeps = 0
      /* Off unless the reader asked for it: see `reportProbe`. */
      let probeOn = false
      handle.setProbe = (on) => {
        probeOn = on === true
        if (probeOn === true) watchErrors(handle)
      }
      const run = () => {
        scheduled = 0
        if (document.body === null) {
          schedule()
          return
        }
        const settings = handle.settings()
        const labels = dict(settings.lang)
        const muted = new Set(settings.muted)
        /*
         * A duplicate never takes effect: the settings page refuses to create one and
         * loading deduplicates, so this only guards state that arrived some other way.
         * The first row with a given key is the one that counts.
         */
        const seen = new Set()
        const items = []
        for (const row of settings.rows) {
          const key = keywordKey(row.text, settings.caseSensitive)
          if (key !== '') {
            if (seen.has(key)) continue
            seen.add(key)
          }
          items.push({
            id: row.id,
            text: row.text.trim(),
            color: row.color,
            muted: muted.has(row.id),
            whole: row.whole === true,
            font: row.font,
            bold: row.bold === true,
            italic: row.italic === true,
            underline: row.underline === true,
            textColor: row.textColor ?? null,
            fontSize: row.fontSize,
            badge: row.badge ?? null,
          })
        }
        /*
         * Everything that changes how a hit looks belongs in the key: a changed key is
         * what tells every row to drop its body cache and mark the text again. A keyword's
         * own badge rides `styleKey` with the rest of its styling, and the shared badge
         * rides here — a keyword following it stores no opinion of its own, so without
         * this a change to the shared look would reach the settings page and never the
         * transcript.
         */
        const patternKey =
          String(settings.enabled) + '|' + String(settings.caseSensitive) + '|' + String(settings.chipsWhenCollapsed) + '|' + String(settings.liftOnExpand) + '|' + settings.muted.join(',') + '|' + badgeKey(settings.badge) + '|' + items.map((item) => item.id + '=' + item.text + styleKey(item)).join(',')
        /*
         * What a chip click does: one keyword in or out of the muted list, persisted
         * like any other setting. Every row hears about it on the next pass, so a
         * chip clicked in one row switches that keyword off everywhere.
         */
        const toggleKeyword = (id) => patch({ muted: toggleIn(settings.muted, id) })
        /*
         * The height the host gives a collapsed row's own line, read once for the whole
         * pass instead of once per chip: it is a computed-style lookup on `body`, and
         * every row measures its chips against the same line. Null when the host does not
         * publish the variable, and then no chip is ever taller than a line nobody can
         * measure — so no row is touched.
         */
        const delta = hostFontDelta()
        const chipLinePx = delta === null ? null : 24 + delta
        const roots = liveRoots()
        let decorated = 0
        for (const root of roots) {
          try {
            reconcileRow(root, {
              items,
              caseSensitive: settings.caseSensitive,
              enabled: settings.enabled,
              chipsWhenCollapsed: settings.chipsWhenCollapsed,
              liftOnExpand: settings.liftOnExpand,
              onToggleKeyword: toggleKeyword,
              /* A control inside a row (the eye) can ask for a pass by itself. */
              requestPass: schedule,
              labels,
              chipLinePx,
              /* The shared badge every keyword follows until it is given one of its own. */
              badge: settings.badge,
              /* The language is a rendering concern of its own: see `labelsChanged`. */
              lang: settings.lang,
              labelsKey: settings.lang,
              patternKey,
            })
            /*
             * What the last pass actually found, kept for the diagnostics below: the
             * difference between "no reasoning rows on this page" and "rows are here but
             * the chips never landed" is invisible from outside, and it is the first thing
             * anyone asking why nothing shows up needs to know.
             */
            if (root.querySelector('[' + MARK + '="badges"]') !== null) decorated += 1
          } catch (error) {
            console.error('[' + NS + '] decorate failed', error)
          }
        }
        handle.lastPass = {
          at: new Date().toISOString(),
          rows: roots.length,
          decorated,
          keywords: items.length,
          muted: muted.size,
          enabled: settings.enabled === true,
          chipsWhenCollapsed: settings.chipsWhenCollapsed === true,
          lang: settings.lang,
          passes: sweeps + 1,
        }
        sweeps += 1
        if (probeOn === true) reportProbe(handle)
        if (sweeps % 8 === 0) sweepRows()
        /* Caps last: the loop above is what asks for them. */
        sweepLifts(settings.liftOnExpand === true)
        /* Rooms too — a rebuilt header line takes its inline height away with it. */
        sweepRooms(roots)
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
        /* The room a scaled-up chip was given is the plugin's too: give it back. */
        for (const element of [...rooms.keys()]) restoreRoom(element)
        for (const root of liveRoots()) {
          unmountBadges(stateOf(root))
          const body = bodyOf(root)
          if (body !== null) unwrapBody(body)
          /*
           * The body stamp is ours too. Leaving it behind would keep a class of ours
           * on a host element (and on an element the host may re-render for a
           * different row, where the next install would mistake it for the body).
           */
          for (const stamped of root.querySelectorAll('.' + BODY_CLASS)) stamped.classList.remove(BODY_CLASS)
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
          /* Named so a test can drive this exact switch instead of counting them. */
          'data-dsh-th': props.marker,
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label,
          title: props.label,
          onClick: props.onChange,
        },
        React.createElement('span', { className: 'dsh-th-knob' }),
      )
    }

    /**
     * One settings row, in the host's own shape: the label with its description
     * stacked on the left and the control on the right (see `.dsh-th-setrow`).
     */
    function SettingRow(props) {
      return React.createElement(
        'div',
        { className: 'dsh-th-setrow' },
        React.createElement(
          'div',
          { className: 'dsh-th-setlabel' },
          React.createElement('span', { className: 'dsh-th-settitle' }, props.label),
          props.hint === undefined ? null : React.createElement('span', { className: 'dsh-th-setdesc' }, props.hint),
        ),
        props.children,
      )
    }

    /**
     * One keyword: its text, the whole-word lock, the suppress switch, and — behind a
     * disclosure icon — everything about how its hits look. The disclosure sits left
     * of the lock, so the row's own line keeps only what is used constantly.
     *
     * The text field keeps a draft while it is being typed in and commits on blur or
     * Enter: that is what lets a refused edit (a duplicate keyword) put the old text
     * back instead of fighting every keystroke.
     */
    function KeywordRow(props) {
      const row = props.row
      const [open, setOpen] = React.useState(false)
      const [draft, setDraft] = React.useState(null)
      const value = draft === null ? row.text : draft
      const commit = () => {
        if (draft === null) return
        props.onCommitText(draft)
        setDraft(null)
      }
      /*
       * What the colour well shows for a keyword that follows the theme. It has to be a
       * concrete colour — an `<input type="color">` cannot express "nothing" — and it is
       * deliberately not the keyword's background colour: offering that would hide the
       * text the moment the reader accepted it.
       */
      const shownInk = row.textColor ?? textColor(DEFAULT_TEXT_COLOR)
      const styleOf = (letter, field, value, label) =>
        React.createElement(
          'button',
          {
            type: 'button',
            className: 'dsh-th-style dsh-th-style' + letter,
            'data-dsh-th': 'style-' + letter.toLowerCase(),
            'aria-pressed': value === true ? 'true' : 'false',
            'aria-label': label,
            title: label,
            onClick: () => props.onStyle({ [field]: value !== true }),
          },
          letter,
        )
      return React.createElement(
        'div',
        { className: 'dsh-th-kw', 'data-dsh-th': 'kw' },
        React.createElement(
          'div',
          { className: 'dsh-th-kwrow' },
          React.createElement('input', {
            className: 'dsh-th-input',
            type: 'text',
            value,
            spellCheck: false,
            placeholder: props.placeholder,
            'aria-label': props.placeholder,
            'data-dsh-th': 'text',
            'aria-invalid': props.warning === undefined ? undefined : 'true',
            onChange: (event) => {
              setDraft(event.target.value)
              props.onEdit()
            },
            onBlur: commit,
            onKeyDown: (event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
            },
          }),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-th-disc',
              'data-dsh-th': 'style-menu',
              'aria-expanded': open === true ? 'true' : 'false',
              'aria-label': props.styleMenu,
              title: props.styleMenuHint,
              onClick: () => setOpen(open !== true),
            },
            React.createElement(ChevronIcon, null),
          ),
          React.createElement(
            'button',
            {
              type: 'button',
              className: 'dsh-th-whole',
              'data-dsh-th': 'whole',
              'data-on': row.whole === true ? '1' : undefined,
              'aria-pressed': row.whole === true ? 'true' : 'false',
              'aria-label': props.wholeLabel,
              title: props.wholeHint,
              onClick: () => props.onWhole(row.whole !== true),
            },
            props.wholeLabel,
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
        ),
        /* Why the last edit did not take: shown under the row until it is edited again. */
        props.warning === undefined
          ? null
          : React.createElement('p', { className: 'dsh-th-warn', 'data-dsh-th': 'duplicate' }, props.warning),
        open === true
          ? React.createElement(
              'div',
              { className: 'dsh-th-panel', 'data-dsh-th': 'style-panel' },
              React.createElement('span', { className: 'dsh-th-panelLabel' }, props.colorLabel),
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
              /*
               * The words' own colour. "Follow" is the default and stays available
               * rather than being a one-way door: a keyword that took a colour can give
               * it back, which is the only way to undo a choice made in the wrong theme.
               */
              React.createElement('span', { className: 'dsh-th-panelLabel' }, props.textColorLabel),
              React.createElement(
                'label',
                { className: 'dsh-th-color', title: shownInk },
                React.createElement('input', {
                  className: 'dsh-th-swatch',
                  type: 'color',
                  value: shownInk,
                  'aria-label': props.textColorLabel,
                  onChange: (event) => props.onInk(event.target.value),
                }),
                React.createElement('span', {
                  className: 'dsh-th-dot',
                  'data-dsh-th': 'ink-dot',
                  /*
                   * `currentColor` resolves against this dot's own inherited colour —
                   * the panel's text colour, which the host paints from its theme — so
                   * the swatch previews exactly what "follow the theme" looks like.
                   */
                  style: { backgroundColor: row.textColor === null ? 'currentColor' : shownInk },
                }),
                React.createElement('span', { className: 'dsh-th-hex' }, row.textColor === null ? props.follow : shownInk.toUpperCase()),
              ),
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsh-th-follow',
                  'data-dsh-th': 'ink-follow',
                  'data-following': row.textColor === null ? '1' : undefined,
                  'aria-pressed': row.textColor === null ? 'true' : 'false',
                  'aria-label': props.followLabel,
                  title: props.followHint,
                  onClick: () => props.onInk(null),
                },
                props.followLabel,
              ),
              /*
               * The size. Its arrows walk the host's own scale — the theme plugin's
               * content font size is a number stepped by 1 between 10 and 22 — so the
               * ends of this stepper and the ends of the host's are the same two ends.
               */
              React.createElement('span', { className: 'dsh-th-panelLabel' }, props.fontSizeLabel),
              React.createElement(
                'div',
                { className: 'dsh-th-size', 'data-dsh-th': 'size' },
                React.createElement('span', { className: 'dsh-th-sizeValue', 'data-dsh-th': 'size-value' }, String(row.fontSize)),
                React.createElement('span', { className: 'dsh-th-sizeUnit' }, props.sizeUnit),
                React.createElement(
                  'span',
                  { className: 'dsh-th-sizeArrows' },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-th-arrow',
                      'data-dsh-th': 'size-up',
                      disabled: row.fontSize >= FONT_SIZE_MAX,
                      'aria-label': props.fontSizeUp,
                      title: props.fontSizeUp,
                      onClick: () => props.onSize(row.fontSize + 1),
                    },
                    React.createElement(StepIcon, { up: true }),
                  ),
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: 'dsh-th-arrow',
                      'data-dsh-th': 'size-down',
                      disabled: row.fontSize <= FONT_SIZE_MIN,
                      'aria-label': props.fontSizeDown,
                      title: props.fontSizeDown,
                      onClick: () => props.onSize(row.fontSize - 1),
                    },
                    React.createElement(StepIcon, { up: false }),
                  ),
                ),
              ),
              React.createElement('span', { className: 'dsh-th-panelLabel' }, props.fontLabel),
              React.createElement(
                'select',
                {
                  className: 'dsh-th-select',
                  'data-dsh-th': 'font',
                  value: row.font,
                  'aria-label': props.fontLabel,
                  onChange: (event) => props.onStyle({ font: event.target.value }),
                },
                [
                  ['default', props.fontDefault],
                  ['mono', props.fontMono],
                  ['serif', props.fontSerif],
                ].map(([value, label]) => React.createElement('option', { key: value, value }, label)),
              ),
              styleOf('B', 'bold', row.bold, props.boldLabel),
              styleOf('I', 'italic', row.italic, props.italicLabel),
              styleOf('U', 'underline', row.underline, props.underlineLabel),
              /*
               * The badge's own editor. It sits at the end of the style panel because it
               * is the deepest thing the panel holds: one look for the chip this word
               * draws in the transcript, with the shared look as its starting point.
               */
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'dsh-th-badgeopen',
                  'data-dsh-th': 'badge-open',
                  'data-own': row.badge === null || row.badge === undefined ? undefined : '1',
                  'aria-label': props.badgeSettingsLabel,
                  title: props.badgeSettingsHint,
                  onClick: props.onBadgeOpen,
                },
                props.badgeSettingsLabel,
              ),
            )
          : null,
      )
    }

    /* ───────────────────────────── badge editor ────────────────────────── */

    /**
     * Redraw one uploaded image small enough to keep. A texture is stored as a data URL
     * in the same record as every other setting, and a photograph straight off a camera
     * would fill that store on its own: the long edge is capped at 96px, the aspect
     * ratio is kept, and a browser that cannot do either is told so rather than handed a
     * texture the next reload would quietly drop.
     */
    function shrinkTexture(src, done) {
      const keep = () => done(src.length <= TEXTURE_MAX_CHARS ? src : null)
      try {
        if (typeof window === 'undefined' || typeof window.Image !== 'function') {
          keep()
          return
        }
        const image = new window.Image()
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            if (typeof canvas.getContext !== 'function') {
              keep()
              return
            }
            const width = image.width || TEXTURE_MAX_PX
            const height = image.height || TEXTURE_MAX_PX
            const ratio = Math.min(1, TEXTURE_MAX_PX / Math.max(width, height))
            canvas.width = Math.max(1, Math.round(width * ratio))
            canvas.height = Math.max(1, Math.round(height * ratio))
            const context = canvas.getContext('2d')
            if (context === null || context === undefined || typeof context.drawImage !== 'function') {
              keep()
              return
            }
            context.drawImage(image, 0, 0, canvas.width, canvas.height)
            const out = typeof canvas.toDataURL === 'function' ? canvas.toDataURL('image/png') : ''
            if (typeof out === 'string' && out.length > 22 && out.length <= TEXTURE_MAX_CHARS) {
              done(out)
              return
            }
            keep()
          } catch (error) {
            keep()
          }
        }
        image.onerror = () => done(null)
        image.src = src
      } catch (error) {
        done(null)
      }
    }

    /**
     * The badge editor: one dialog for one chip's look, with the row it will be drawn on
     * previewed at the top so every change is seen where it lands. It edits as it goes —
     * there is no draft to lose and no cancel that could silently throw a choice away —
     * and its two ends are the two ways out: `Reset` hands the chip back to the shared
     * look, `Done` closes the dialog and changes nothing else.
     *
     * The preview is built by the transcript's own chip builder, so it cannot drift from
     * what the row will draw.
     */
    function BadgeEditor(props) {
      const labels = props.labels
      const spec = props.spec
      const [naming, setNaming] = React.useState(false)
      const [name, setName] = React.useState('')
      const [note, setNote] = React.useState('')
      /*
       * Which saved template the dropdown is showing. Kept here rather than in the store:
       * it is a view of the list, not a setting — and it is also what the delete button
       * acts on, so that one template is the only thing either control can mean.
       */
      const [picked, setPicked] = React.useState('')
      /* Escape closes it, like every other dialog on this shell. */
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') props.onClose()
        }
        window.addEventListener('keydown', onKey)
        return () => {
          if (typeof window.removeEventListener === 'function') window.removeEventListener('keydown', onKey)
        }
      }, [])
      const el = React.createElement
      const patch = props.onPatch
      const sample = props.sample
      const texture = spec.texture
      const patchTexture = (changes) => {
        if (texture === null) return
        patch({ texture: { ...texture, ...changes } })
      }
      /*
       * What the colour well offers for a field that is not a colour of its own. It has
       * to be something concrete — `<input type="color">` cannot express "the theme" —
       * and it is deliberately the value the field falls back to, so accepting the well
       * unedited is not a surprise.
       */
      const swatchOf = (field) => {
        const value = spec[field]
        if (typeof value === 'string' && value.startsWith('#') === true) return value
        if (field === 'frame') return hex(sample.color)
        if (field === 'ink') return DEFAULT_TEXT_COLOR
        return '#eceef2'
      }
      const isOwn = (field) => typeof spec[field] === 'string' && spec[field].startsWith('#') === true
      /* What a field that carries no colour of its own says instead of a hex value. */
      const namedChoice = (field, quicks) => {
        const match = quicks.find(([value]) => spec[field] === value)
        return match === undefined ? quicks[0][2] : match[2]
      }
      /*
       * One row of this dialog, in the settings page's own shape: a label column of a
       * fixed width — so every control in the dialog starts at the same x — the controls
       * beside it, and the hairline the host draws under its own settings rows. Thirteen
       * controls in one column need that rhythm to be readable at all.
       */
      const row = (label, ...controls) =>
        el(
          'div',
          { className: 'dsh-th-brow' },
          el('span', { className: 'dsh-th-browLabel' }, label),
          el('div', { className: 'dsh-th-browBody' }, controls),
        )
      const well = (field, label, quicks) =>
        el(
          'label',
          { className: 'dsh-th-color', key: field, title: label },
          el('input', {
            className: 'dsh-th-swatch',
            type: 'color',
            value: swatchOf(field),
            'aria-label': label,
            'data-dsh-th': 'badge-well-' + field,
            onChange: (event) => patch({ [field]: hex(event.target.value) }),
          }),
          el('span', {
            className: 'dsh-th-dot',
            'data-dsh-th': 'badge-dot-' + field,
            /*
             * `currentColor` is the dialog's own text colour, which is the token this field
             * falls back to — so the dot previews the theme choice itself. A field that asks
             * for no fill shows the empty square its own hairline draws.
             */
            style: { backgroundColor: isOwn(field) ? spec[field] : spec[field] === 'none' ? 'transparent' : 'currentColor' },
          }),
          el('span', { className: 'dsh-th-hex' }, isOwn(field) ? String(spec[field]).toUpperCase() : namedChoice(field, quicks)),
        )
      const choices = (field, quicks) =>
        quicks.map(([value, marker, text]) =>
          el(
            'button',
            {
              key: marker,
              type: 'button',
              className: 'dsh-th-follow',
              'data-dsh-th': 'badge-quick-' + marker,
              'data-following': spec[field] === value ? '1' : undefined,
              'aria-pressed': spec[field] === value ? 'true' : 'false',
              'aria-label': text,
              title: text,
              onClick: () => patch({ [field]: value }),
            },
            text,
          ),
        )
      const segment = (label, entries, current, onPick, marker) =>
        el(
          'div',
          { className: 'dsh-th-seg', role: 'group', 'aria-label': label },
          entries.map(([id, text]) =>
            el(
              'button',
              {
                key: id,
                type: 'button',
                className: 'dsh-th-seg-item',
                'data-dsh-th': marker + '-' + id,
                'data-on': current === id ? '1' : undefined,
                'aria-pressed': current === id ? 'true' : 'false',
                onClick: () => onPick(id),
              },
              text,
            ),
          ),
        )
      const upload = (event) => {
        const file = event.target.files === null || event.target.files === undefined ? null : event.target.files[0]
        /* The field keeps no value of its own: the same image may be picked again. */
        event.target.value = ''
        if (file === null || file === undefined) return
        if (typeof file.size === 'number' && file.size > TEXTURE_MAX_FILE) {
          setNote(labels.badgeTextureTooBig)
          return
        }
        if (typeof window.FileReader !== 'function') {
          setNote(labels.badgeTextureFailed)
          return
        }
        const reader = new window.FileReader()
        reader.onload = () => {
          const src = typeof reader.result === 'string' ? reader.result : ''
          if (/^data:image\//.test(src) !== true) {
            setNote(labels.badgeTextureFailed)
            return
          }
          shrinkTexture(src, (kept) => {
            if (kept === null) {
              setNote(labels.badgeTextureTooBig)
              return
            }
            setNote('')
            patch({
              texture: {
                id: 'tex' + Date.now().toString(36),
                src: kept,
                fit: texture === null ? 'repeat' : texture.fit,
                alpha: texture === null ? 0.85 : texture.alpha,
              },
            })
          })
        }
        reader.onerror = () => setNote(labels.badgeTextureFailed)
        try {
          reader.readAsDataURL(file)
        } catch (error) {
          setNote(labels.badgeTextureFailed)
        }
      }
      /*
       * Saving hands back the new template's id — the dropdown then shows what was just
       * saved, so the row answers "did that work?" without a word of its own — or a
       * message when the name was empty or the list is full.
       */
      const save = () => {
        const result = props.onSaveTemplate(name)
        if (result !== null && typeof result === 'object') {
          if (typeof result.error === 'string' && result.error !== '') {
            setNote(result.error)
            return
          }
          if (typeof result.id === 'string') setPicked(result.id)
        }
        setNaming(false)
        setName('')
        setNote('')
      }
      /* The transcript's own chip, drawn by the transcript's own builder. */
      const preview = row(
        labels.badgePreview,
        el(
          'div',
          { className: 'dsh-th-preview', 'data-dsh-th': 'badge-preview' },
          el(
            'div',
            { className: 'dsh-th-previewLine' },
            el('span', { className: 'dsh-th-previewTitle' }, 'think'),
            el('span', { className: 'dsh-th-previewDot', 'aria-hidden': 'true' }),
            el(
              'span',
              { className: 'dsh-th-badge-set' },
              el(
                'span',
                { className: 'dsh-th-chips' },
                buildChip({ ...sample, id: 'badge-preview-chip', count: 3, muted: false }, spec, {
                  labels,
                }),
              ),
              el(
                'span',
                { className: 'dsh-th-acts' },
                el(
                  'span',
                  { className: 'dsh-th-eye', 'aria-hidden': 'true' },
                  el(EyeIcon, { slashed: false }),
                ),
              ),
            ),
            el('span', { className: 'dsh-th-previewText' }, sample.preview),
          ),
        ),
        el('p', { className: 'dsh-th-fieldNote' }, labels.badgePreviewNote),
      )
      /*
       * The presets are a fixed six and stay visible: one click each, and there is nothing
       * to search. The reader's own templates are a list that grows, so they live in a
       * dropdown instead — twelve saved looks as twelve buttons was a row that overflowed
       * the dialog, and a dropdown is the one control that holds any number of them.
       */
      const templates = row(
        labels.badgeTemplates,
        el(
          'div',
          { className: 'dsh-th-tpls' },
          BADGE_PRESETS.map((preset) =>
            el(
              'button',
              {
                key: preset.id,
                type: 'button',
                className: 'dsh-th-tpl',
                'data-dsh-th': 'badge-tpl-' + preset.id,
                'aria-label': labels['badgeTemplate' + preset.id.charAt(0).toUpperCase() + preset.id.slice(1)],
                onClick: () => props.onApply({ ...badgeDefaults(), ...preset.spec }),
              },
              labels['badgeTemplate' + preset.id.charAt(0).toUpperCase() + preset.id.slice(1)],
            ),
          ),
          naming === true
            ? [
                el('input', {
                  key: 'name',
                  className: 'dsh-th-name',
                  type: 'text',
                  value: name,
                  placeholder: labels.badgeTemplateName,
                  'aria-label': labels.badgeTemplateName,
                  'data-dsh-th': 'badge-template-name',
                  spellCheck: false,
                  onChange: (event) => setName(event.target.value),
                  onKeyDown: (event) => {
                    if (event.key === 'Enter') save()
                  },
                }),
                el(
                  'button',
                  { key: 'save', type: 'button', className: 'dsh-th-btn', 'data-primary': '1', 'data-dsh-th': 'badge-template-save', onClick: save },
                  labels.badgeSave,
                ),
                el(
                  'button',
                  {
                    key: 'cancel',
                    type: 'button',
                    className: 'dsh-th-btn',
                    'data-dsh-th': 'badge-template-cancel',
                    onClick: () => {
                      setNaming(false)
                      setNote('')
                    },
                  },
                  labels.badgeCancel,
                ),
              ]
            : el(
                'button',
                {
                  type: 'button',
                  className: 'dsh-th-btn',
                  'data-outline': '1',
                  'data-dsh-th': 'badge-template-new',
                  disabled: props.templates.length >= TEMPLATE_MAX,
                  title: props.templates.length >= TEMPLATE_MAX ? labels.badgeTemplatesFull : labels.badgeSaveTemplate,
                  onClick: () => setNaming(true),
                },
                labels.badgeSaveTemplate,
              ),
        ),
      )
      /* The saved ones: pick one to put it on, delete the one that is picked. */
      const saved = props.templates.some((template) => template.id === picked) ? picked : ''
      const ownTemplates = row(
        labels.badgeTemplatesMine,
        el(
          'select',
          {
            className: 'dsh-th-select',
            'data-dsh-th': 'badge-tpl-pick',
            value: saved,
            disabled: props.templates.length === 0,
            'aria-label': labels.badgeTemplatesMine,
            onChange: (event) => {
              const id = event.target.value
              setPicked(id)
              const template = props.templates.find((item) => item.id === id)
              if (template !== undefined) props.onApply(template.spec)
            },
          },
          [
            el('option', { key: '__none', value: '' }, props.templates.length === 0 ? labels.badgeTemplateNone : labels.badgeTemplatePick),
            ...props.templates.map((template) => el('option', { key: template.id, value: template.id }, template.name)),
          ],
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dsh-th-btn',
            'data-outline': '1',
            'data-dsh-th': 'badge-tpl-delete',
            disabled: saved === '',
            'aria-label': labels.badgeDeleteTemplate,
            title: labels.badgeDeleteTemplate,
            onClick: () => {
              props.onDeleteTemplate(saved)
              setPicked('')
            },
          },
          labels.badgeDeleteTemplate,
        ),
      )
      const size = row(
        labels.badgeSize,
        el(
          'div',
          { className: 'dsh-th-size', 'data-dsh-th': 'badge-size' },
          el('span', { className: 'dsh-th-sizeValue', 'data-dsh-th': 'badge-size-value' }, spec.scale.toFixed(2)),
          el('span', { className: 'dsh-th-sizeUnit' }, '×'),
          el(
            'span',
            { className: 'dsh-th-sizeArrows' },
            el(
              'button',
              {
                type: 'button',
                className: 'dsh-th-arrow',
                'data-dsh-th': 'badge-size-up',
                disabled: spec.scale >= BADGE_SCALE_MAX,
                'aria-label': labels.badgeSizeUp,
                title: labels.badgeSizeUp,
                onClick: () => patch({ scale: badgeNumber(spec.scale + BADGE_SCALE_STEP, BADGE_SCALE_MIN, BADGE_SCALE_MAX, 1) }),
              },
              el(StepIcon, { up: true }),
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dsh-th-arrow',
                'data-dsh-th': 'badge-size-down',
                disabled: spec.scale <= BADGE_SCALE_MIN,
                'aria-label': labels.badgeSizeDown,
                title: labels.badgeSizeDown,
                onClick: () => patch({ scale: badgeNumber(spec.scale - BADGE_SCALE_STEP, BADGE_SCALE_MIN, BADGE_SCALE_MAX, 1) }),
              },
              el(StepIcon, { up: false }),
            ),
          ),
        ),
        /* A slider beside the stepper: a size worth changing is worth one gesture. */
        el('input', {
          className: 'dsh-th-range',
          type: 'range',
          min: BADGE_SCALE_MIN,
          max: BADGE_SCALE_MAX,
          step: BADGE_SCALE_STEP,
          value: String(spec.scale),
          'aria-label': labels.badgeSize,
          'data-dsh-th': 'badge-scale',
          onChange: (event) => patch({ scale: badgeNumber(event.target.value, BADGE_SCALE_MIN, BADGE_SCALE_MAX, 1) }),
        }),
        el(Switch, {
          checked: spec.followText !== false,
          marker: 'badge-follow',
          label: labels.badgeFollowText,
          onChange: () => patch({ followText: spec.followText === false }),
        }),
        el('span', { className: 'dsh-th-panelLabel' }, labels.badgeFollowText),
      )
      /*
       * Three rows for the three colours, each keeping the way back to what the chip drew
       * with before: the host's tokens, transparency, or — on the frame alone — the word's
       * own colour.
       */
      const bgRow = row(
        labels.badgeBg,
        well('bg', labels.badgeBg, [
          ['theme', 'bg-theme', labels.badgeTheme],
          ['none', 'bg-none', labels.badgeNoFill],
        ]),
        choices('bg', [
          ['theme', 'bg-theme', labels.badgeTheme],
          ['none', 'bg-none', labels.badgeNoFill],
        ]),
      )
      const inkRow = row(
        labels.badgeInk,
        well('ink', labels.badgeInk, [['theme', 'ink-theme', labels.badgeTheme]]),
        choices('ink', [['theme', 'ink-theme', labels.badgeTheme]]),
      )
      const frameRow = row(
        labels.badgeFrame,
        well('frame', labels.badgeFrame, [
          ['keyword', 'frame-keyword', labels.badgeKeyword],
          ['theme', 'frame-theme', labels.badgeTheme],
        ]),
        choices('frame', [
          ['keyword', 'frame-keyword', labels.badgeKeyword],
          ['theme', 'frame-theme', labels.badgeTheme],
        ]),
      )
      const shapeRow = row(
        labels.badgeShape,
        segment(
          labels.badgeShape,
          [
            ['rounded', labels.badgeShapeRounded],
            ['pill', labels.badgeShapePill],
            ['square', labels.badgeShapeSquare],
          ],
          spec.shape,
          (value) => patch({ shape: value }),
          'badge-shape',
        ),
      )
      const strokeRow = row(
        labels.badgeStroke,
        segment(
          labels.badgeStroke,
          [
            ['hairline', labels.badgeStrokeHairline],
            ['solid', labels.badgeStrokeSolid],
            ['none', labels.badgeNone],
          ],
          spec.border,
          (value) => patch({ border: value }),
          'badge-stroke',
        ),
      )
      const shadowRow = row(
        labels.badgeShadow,
        segment(
          labels.badgeShadow,
          [
            ['none', labels.badgeNone],
            ['soft', labels.badgeShadowSoft],
            ['glow', labels.badgeShadowGlow],
          ],
          spec.shadow,
          (value) => patch({ shadow: value }),
          'badge-shadow',
        ),
      )
      const boldRow = row(
        labels.bold,
        el(Switch, {
          checked: spec.bold === true,
          marker: 'badge-bold',
          label: labels.bold,
          onChange: () => patch({ bold: spec.bold !== true }),
        }),
      )
      const textureRow = row(
        labels.badgeTexture,
        texture === null
          ? el('span', { className: 'dsh-th-texEmpty' }, labels.badgeNone)
          : el('span', {
              className: 'dsh-th-texThumb',
              'data-dsh-th': 'badge-thumb',
              style: { backgroundImage: 'url("' + texture.src + '")' },
            }),
        el(
          'label',
          { className: 'dsh-th-btn', 'data-outline': '1', 'data-dsh-th': 'badge-upload' },
          texture === null ? labels.badgeUpload : labels.badgeReplace,
          el('input', {
            className: 'dsh-th-file',
            type: 'file',
            accept: 'image/*',
            'data-dsh-th': 'badge-file',
            onChange: upload,
          }),
        ),
        texture === null
          ? null
          : el(
              'button',
              {
                type: 'button',
                className: 'dsh-th-btn',
                'data-dsh-th': 'badge-texture-remove',
                onClick: () => {
                  setNote('')
                  patch({ texture: null })
                },
              },
              labels.badgeRemoveTexture,
            ),
        /* What an upload does, on the line under its own controls — and that it stays here. */
        texture === null ? el('p', { className: 'dsh-th-fieldNote' }, labels.badgeTextureHint) : null,
      )
      /*
       * The last two rows only exist while there is a texture to point them at: how it is
       * laid into the chip, and how strongly it shows through.
       */
      const fitRow =
        texture === null
          ? null
          : row(
              labels.badgeFit,
              segment(
                labels.badgeFit,
                [['repeat', labels.badgeFitRepeat], ['cover', labels.badgeFitCover], ['contain', labels.badgeFitContain]],
                texture.fit,
                (value) => patchTexture({ fit: value }),
                'badge-fit',
              ),
            )
      const opacityRow =
        texture === null
          ? null
          : row(
              labels.badgeOpacity,
              el('input', {
                className: 'dsh-th-range',
                type: 'range',
                min: TEXTURE_ALPHA_MIN,
                max: TEXTURE_ALPHA_MAX,
                step: TEXTURE_ALPHA_STEP,
                value: String(texture.alpha),
                'aria-label': labels.badgeOpacity,
                'data-dsh-th': 'badge-texture-alpha',
                onChange: (event) => patchTexture({ alpha: badgeNumber(event.target.value, TEXTURE_ALPHA_MIN, TEXTURE_ALPHA_MAX, 0.85) }),
              }),
              /* The same readout the size row carries, so both sliders say what they hold. */
              el('span', { className: 'dsh-th-hex', 'data-dsh-th': 'badge-texture-alpha-value' }, Math.round(texture.alpha * 100) + '%'),
            )
      return el(
        'div',
        {
          className: 'dsh-th-veil',
          'data-dsh-th': 'badge-veil',
          /* A click that landed on the layer itself, not inside the card, closes it. */
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) props.onClose()
          },
        },
        el('div', { className: 'dsh-th-mask', 'aria-hidden': 'true' }),
        el(
          'div',
          { className: 'dsh-th-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': labels.badgeSettings, 'data-dsh-th': 'badge-dialog' },
          el(
            'div',
            { className: 'dsh-th-dialogHead' },
            el('h2', { className: 'dsh-th-dialogTitle' }, labels.badgeSettings),
            el('span', { className: 'dsh-th-dialogSubject', title: props.subject, 'data-dsh-th': 'badge-subject' }, props.subject),
            el(
              'button',
              {
                type: 'button',
                className: 'dsh-th-dialogClose',
                'data-dsh-th': 'badge-close',
                'aria-label': labels.badgeClose,
                title: labels.badgeClose,
                onClick: props.onClose,
              },
              '×',
            ),
          ),
          el(
            'div',
            { className: 'dsh-th-dialogBody' },
            preview,
            templates,
            ownTemplates,
            size,
            bgRow,
            inkRow,
            frameRow,
            shapeRow,
            strokeRow,
            shadowRow,
            boldRow,
            textureRow,
            fitRow,
            opacityRow,
            note === '' ? null : el('p', { className: 'dsh-th-warn', 'data-dsh-th': 'badge-note' }, note),
          ),
          el(
            'div',
            { className: 'dsh-th-dialogFoot' },
            el(
              'span',
              { className: 'dsh-th-panelLabel', 'data-dsh-th': 'badge-state' },
              props.state,
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dsh-th-btn',
                'data-outline': '1',
                'data-dsh-th': 'badge-reset',
                disabled: props.canReset !== true,
                title: props.resetHint,
                onClick: () => {
                  setNote('')
                  props.onReset()
                },
              },
              labels.badgeReset,
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dsh-th-btn',
                'data-primary': '1',
                'data-dsh-th': 'badge-done',
                onClick: props.onClose,
              },
              labels.badgeDone,
            ),
          ),
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
        /* The row whose last edit was refused for duplicating another keyword. */
        const [rejected, setRejected] = React.useState(null)
        /*
         * Which badge the editor has open: one keyword's own, or the shared one every
         * keyword follows by default. The target is held by row id rather than by index,
         * so a row deleted while its editor is open closes the editor instead of
         * quietly handing it to whichever row slid into that position.
         */
        const [badgeTarget, setBadgeTarget] = React.useState(null)
        const badgeRow =
          badgeTarget !== null && badgeTarget.kind === 'row' ? settings.rows.find((item) => item.id === badgeTarget.id) : undefined
        const badgeOpen = badgeTarget !== null && (badgeTarget.kind === 'shared' || badgeRow !== undefined)
        /* What the editor is editing: the row's own look, or the shared one it inherits. */
        const badgeSpec = badgeTarget !== null && badgeTarget.kind === 'row' && badgeRow !== undefined && badgeRow.badge !== null ? badgeRow.badge : settings.badge
        const badgeWrite = (next) => {
          if (badgeTarget === null) return
          if (badgeTarget.kind === 'shared') {
            patch({ badge: next })
            return
          }
          setRows(settings.rows.map((item) => (item.id === badgeTarget.id ? { ...item, badge: next } : item)))
        }
        /* A change to one field: the row materialises the shared look first, then edits it. */
        const badgePatch = (changes) => {
          if (badgeTarget === null) return
          const base = badgeTarget.kind === 'row' && badgeRow !== undefined && badgeRow.badge !== null ? badgeRow.badge : settings.badge
          badgeWrite({ ...base, ...changes })
        }
        const badgeReset = () => {
          if (badgeTarget === null) return
          /* Back to following: null is that statement for a row, the defaults for the list. */
          badgeWrite(badgeTarget.kind === 'shared' ? badgeDefaults() : null)
        }
        const badgeSaveTemplate = (value) => {
          const name = typeof value === 'string' ? value.trim() : ''
          if (name === '') return { error: labels.badgeTemplateName }
          if (settings.badgeTemplates.length >= TEMPLATE_MAX) return { error: labels.badgeTemplatesFull }
          const template = { id: 'tpl' + Date.now().toString(36), name: name.slice(0, 24), spec: badgeSpec }
          patch({ badgeTemplates: settings.badgeTemplates.concat(template) })
          /* The id comes back so the editor's dropdown can show what was just saved. */
          return { id: template.id }
        }
        const badgeSample = {
          text: badgeRow !== undefined && badgeRow.text.trim() !== '' ? badgeRow.text.trim() : labels.keywordPlaceholder,
          preview: labels.badgePreviewText,
          color: badgeRow === undefined ? DEFAULT_COLOR : badgeRow.color,
          whole: badgeRow === undefined ? false : badgeRow.whole === true,
          font: badgeRow === undefined ? 'default' : badgeRow.font,
          bold: badgeRow === undefined ? false : badgeRow.bold === true,
          italic: badgeRow === undefined ? false : badgeRow.italic === true,
          underline: badgeRow === undefined ? false : badgeRow.underline === true,
          textColor: badgeRow === undefined ? null : badgeRow.textColor,
          fontSize: badgeRow === undefined ? FONT_SIZE_DEFAULT : badgeRow.fontSize,
        }
        /*
         * Committing a keyword's text. A word may exist once: when the typed text is
         * the same keyword as another row (trimmed, and case-folded while matching
         * ignores case), the edit is refused — the row keeps its old text and says why.
         */
        const commitText = (value, ownId, index) => {
          if (duplicateOf(settings.rows, value, ownId, settings.caseSensitive) !== null) {
            setRejected({ id: ownId, text: value.trim() })
            return false
          }
          setRejected(null)
          setRows(settings.rows.map((item, at) => (at === index ? { ...item, text: value } : item)))
          return true
        }
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
              { label: labels.language, hint: labels.languageHint },
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
              { label: labels.enabled, hint: labels.enabledHint },
              React.createElement(Switch, {
                checked: settings.enabled,
                marker: 'switch-enabled',
                label: labels.enabled,
                onChange: () => patch({ enabled: settings.enabled !== true }),
              }),
            ),
            React.createElement(
              SettingRow,
              { label: labels.chipsWhenCollapsed, hint: labels.chipsWhenCollapsedHint },
              React.createElement(Switch, {
                checked: settings.chipsWhenCollapsed,
                marker: 'switch-chips',
                label: labels.chipsWhenCollapsed,
                onChange: () => patch({ chipsWhenCollapsed: settings.chipsWhenCollapsed !== true }),
              }),
            ),
            React.createElement(
              SettingRow,
              { label: labels.liftOnExpand, hint: labels.liftOnExpandHint },
              React.createElement(Switch, {
                checked: settings.liftOnExpand,
                marker: 'switch-lift',
                label: labels.liftOnExpand,
                onChange: () => patch({ liftOnExpand: settings.liftOnExpand !== true }),
              }),
            ),
            React.createElement(
              SettingRow,
              { label: labels.caseSensitive, hint: labels.caseSensitiveHint },
              React.createElement(Switch, {
                checked: settings.caseSensitive,
                marker: 'switch-case',
                label: labels.caseSensitive,
                onChange: () => patch({ caseSensitive: settings.caseSensitive !== true }),
              }),
            ),
          ),
          contributed,
          /* The keyword list reads as its own group, headed the way the host heads one. */
          React.createElement(
            'div',
            { className: 'dsh-th-setrow dsh-th-grouphead' },
            React.createElement(
              'div',
              { className: 'dsh-th-setlabel' },
              React.createElement('span', { className: 'dsh-th-settitle' }, labels.keywords),
              React.createElement('span', { className: 'dsh-th-setdesc' }, labels.keywordsHint),
            ),
            /*
             * The shared badge, from the one place that speaks for the whole list. Each
             * keyword's own editor starts from it, so it is also what "follow" means —
             * and it is the same words on the button as the one in a keyword's panel,
             * because it opens the same dialog. What tells the two apart is the tooltip
             * and the accessible name, which say whose badge the dialog will edit.
             */
            React.createElement(
              'button',
              {
                type: 'button',
                className: 'dsh-th-badgeopen',
                'data-placement': 'page',
                'data-dsh-th': 'badge-shared',
                'data-own': badgeKey(settings.badge) === badgeKey(badgeDefaults()) ? undefined : '1',
                'aria-label': labels.badgeShared,
                title: labels.badgeSharedHint,
                onClick: () => setBadgeTarget({ kind: 'shared' }),
              },
              labels.badgeSettings,
            ),
          ),
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
                    colorLabel: labels.colorLabel,
                    textColorLabel: labels.textColorLabel,
                    followLabel: labels.follow,
                    followHint: labels.followHint,
                    fontSizeLabel: labels.fontSizeLabel,
                    fontSizeUp: labels.fontSizeUp,
                    fontSizeDown: labels.fontSizeDown,
                    sizeUnit: labels.sizeUnit,
                    removeLabel: labels.remove,
                    muteLabel: labels.mute,
                    unmuteLabel: labels.unmute,
                    muteHint: labels.muteHint,
                    wholeLabel: labels.whole,
                    wholeHint: labels.wholeHint,
                    styleMenu: labels.styleMenu,
                    styleMenuHint: labels.styleMenuHint,
                    fontLabel: labels.font,
                    fontDefault: labels.fontDefault,
                    fontMono: labels.fontMono,
                    fontSerif: labels.fontSerif,
                    boldLabel: labels.bold,
                    italicLabel: labels.italic,
                    underlineLabel: labels.underline,
                    badgeSettingsLabel: labels.badgeSettings,
                    badgeSettingsHint: labels.badgeSettingsHint,
                    onBadgeOpen: () => setBadgeTarget({ kind: 'row', id: row.id }),
                    onCommitText: (value) => commitText(value, row.id, index),
                    onEdit: () => setRejected(null),
                    warning: rejected !== null && rejected.id === row.id ? labels.duplicate + ' 「' + rejected.text + '」' : undefined,
                    onColor: (value) => setRows(settings.rows.map((item, at) => (at === index ? { ...item, color: hex(value) } : item))),
                    /*
                     * `null` from the "Theme" button is not a missing value: it is the
                     * setting that says "leave the words the host's own colour".
                     */
                    onInk: (value) => setRows(settings.rows.map((item, at) => (at === index ? { ...item, textColor: textColor(value) } : item))),
                    onSize: (value) => setRows(settings.rows.map((item, at) => (at === index ? { ...item, fontSize: fontSize(value) } : item))),
                    onWhole: (value) => setRows(settings.rows.map((item, at) => (at === index ? { ...item, whole: value === true } : item))),
                    onStyle: (changes) => setRows(settings.rows.map((item, at) => (at === index ? { ...item, ...changes } : item))),
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
                /*
                 * The matcher and the loader both stop at MAX_KEYWORDS, so a row added
                 * past it would silently never match and would be dropped on the next
                 * reload. Refusing it here is the only honest option.
                 */
                disabled: settings.rows.length >= MAX_KEYWORDS,
                title: settings.rows.length >= MAX_KEYWORDS ? labels.keywordsFull : undefined,
                onClick: () => {
                  if (settings.rows.length >= MAX_KEYWORDS) return
                  setRows(settings.rows.concat(freshRow('')))
                },
              },
              React.createElement(PlusIcon, null),
              labels.add,
            ),
            settings.rows.length >= MAX_KEYWORDS
              ? React.createElement('span', { className: 'dsh-th-empty', 'data-dsh-th': 'keywords-full' }, labels.keywordsFull)
              : null,
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
          /*
           * The badge editor, when something opened it. It lives at the end of the page
           * rather than inside a keyword row because a fixed layer inside the row's own
           * layout would be clipped by the panel it was opened from; the row it edits is
           * named by id, so it does not care where it is mounted.
           */
          badgeOpen === true
            ? React.createElement(BadgeEditor, {
                labels,
                spec: badgeSpec,
                subject: badgeTarget.kind === 'shared' ? labels.badgeSubjectGlobal : badgeSample.text,
                /* What the dialog says it is editing, in the reader's own words. */
                state:
                  badgeTarget.kind === 'shared'
                    ? labels.badgeSubjectGlobal
                    : (badgeRow.badge ?? null) === null
                      ? labels.badgeFollows
                      : labels.badgeOwn,
                canReset:
                  badgeTarget.kind === 'shared'
                    ? badgeKey(settings.badge) !== badgeKey(badgeDefaults())
                    : (badgeRow.badge ?? null) !== null,
                resetHint: badgeTarget.kind === 'shared' ? labels.badgeResetGlobal : labels.badgeResetOwn,
                templates: settings.badgeTemplates,
                sample: badgeSample,
                onPatch: badgePatch,
                onApply: (next) => badgeWrite(screenBadge(next) ?? badgeDefaults()),
                onReset: badgeReset,
                onSaveTemplate: badgeSaveTemplate,
                onDeleteTemplate: (id) => patch({ badgeTemplates: settings.badgeTemplates.filter((item) => item.id !== id) }),
                onClose: () => setBadgeTarget(null),
              })
            : null,
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

    /**
     * Write the plugin's own view of the page to localStorage, so a reader who is
     * looking at a transcript where nothing appears can say what the plugin sees
     * instead of describing the symptom. This is the one question the cheaper
     * markers cannot answer: "the module ran, but did it ever find a reasoning row?"
     *
     * Opt-in, because it writes on every pass (a 90 ms-coalesced cadence) and an
     * unconditional write would be a permanent cost for every user. Call
     * `window.__DSH_TH__.diagnose()` once in the console, reload, then read
     * `localStorage['dsh-thinking-highlight.state.probe']`.
     */
    function reportProbe(handle) {
      /* Not `rows`: that name is the module's per-row WeakMap, and shadowing it here
         made every probe pass throw before it could write anything. */
      const report = []
      for (const root of liveRoots()) {
        const entry = rows.get(root)
        const header = headerRowOf(root)
        report.push({
          count: entry?.count ?? 0,
          highlighted: entry?.highlighted ?? true,
          badges: root.querySelector('[' + MARK + '="badges"]') !== null,
          marked: entry?.sample === undefined ? false : entry.sample.isConnected === true,
          folded: entry?.folded === true,
          expanded: header === null ? null : isExpanded(root, header),
          body: bodyOf(root) !== null,
        })
      }
      try {
        window.localStorage.setItem(
          'dsh-thinking-highlight.state.probe',
          JSON.stringify({
            version: VERSION,
            at: new Date().toISOString(),
            state: snapshot,
            lastPass: handle.lastPass ?? null,
            /*
             * Uncaught errors seen while the probe was on. A browser half that throws
             * before it decorates anything looks exactly like one that never ran, and
             * the console that would say so is the one thing a report cannot carry.
             */
            errors: handle.probeErrors ?? [],
            rows: report,
          }),
        )
      } catch (error) {
        /* diagnostics must never be the failure */
      }
    }

    /**
     * Start collecting uncaught errors, so the probe can carry them. Installed once, and
     * only while diagnosis is on: the handler is a permanent cost and an error listener
     * every user never asked for is not worth the convenience.
     */
    function watchErrors(handle) {
      if (handle.errorWatch === true) return
      handle.errorWatch = true
      handle.probeErrors = []
      if (typeof window.addEventListener !== 'function') return
      window.addEventListener('error', (event) => {
        const list = handle.probeErrors ?? []
        const message = event?.message ?? String(event?.error ?? 'unknown error')
        list.push({
          at: new Date().toISOString(),
          message: String(message).slice(0, 300),
          source: String(event?.filename ?? '').split('/').pop() + ':' + String(event?.lineno ?? ''),
        })
        /* Only the tail matters, and an unbounded list would be its own leak. */
        handle.probeErrors = list.slice(-5)
      })
    }

    /** This page's id in the settings ledger: the nav row and the slot key. */
    const SECTION_ID = NS
    /** Child list other rows can register into; the page renders it after its own rows. */
    const SECTION_ITEM_SLOT = 'settings.thinking-highlight.item'
    /** After the official sections (general 0, plugins 15), so this sits last. */
    const SECTION_ORDER = 30
    /**
     * How many times a refused `settings.section` injection is retried, and the
     * first delay. The shell declares the slot while it boots, so the first retry
     * usually lands; three attempts is enough not to look like a hang either way.
     */
    const SECTION_INJECT_ATTEMPTS = 3
    const SECTION_INJECT_DELAY = 400

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
        const sectionRetries = new Set()
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
        /*
         * A throw here is usually an ordering accident — the shell declares
         * `settings.section` at runtime, and so does the next plugin in the list — so
         * a failed injection is retried a few times instead of costing the plugin its
         * settings page for the whole session. Each attempt is recorded, so
         * `localStorage['…registration']` still says what happened.
         */
        const injectSection = (attempt) => {
          try {
            ctx.slots.inject('settings.section', () => {
              try {
                sectionLive = true
                openSection()
                reportRegistration(attempt === 0 ? 'registered' : 'registered-retry', 'settings.section#' + SECTION_ID)
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
            reportRegistration('inject-threw', (error && error.message ? error.message : error) + ' (attempt ' + (attempt + 1) + ')')
            if (attempt + 1 >= SECTION_INJECT_ATTEMPTS) return
            const timer = window.setTimeout(() => {
              sectionRetries.delete(timer)
              injectSection(attempt + 1)
            }, SECTION_INJECT_DELAY * (attempt + 1))
            sectionRetries.add(timer)
          }
        }
        injectSection(0)
        ctx.effect(
          () => () => {
            for (const timer of sectionRetries) window.clearTimeout(timer)
            sectionRetries.clear()
          },
          NS + ':section-retry',
        )

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

        /*
         * A second window (or the same page written from elsewhere) changes the stored
         * state without this document hearing about it any other way: the browser only
         * announces the change to the *other* documents, through `storage`. Re-read the
         * store and drop every row cache, so the transcript follows along instead of
         * waiting for a reload.
         */
        ctx.effect(() => {
          /* A platform without event listeners simply keeps the old single-document
             behaviour instead of failing to activate. */
          if (typeof window.addEventListener !== 'function') return () => {}
          const onStorage = (event) => {
            if (event.key !== null && event.key !== undefined && event.key !== STORAGE_KEY) return
            reloadFromStore()
            forgetRows()
          }
          window.addEventListener('storage', onStorage)
          return () => {
            if (typeof window.removeEventListener === 'function') window.removeEventListener('storage', onStorage)
          }
        }, NS + ':storage')

        ctx.effect(() => {
          const runtime = {
            version: VERSION,
            settings: () => snapshot,
            /*
             * Turn the page-state probe on (it then writes on every pass) and report the
             * one thing a reader can act on immediately: whether a reasoning row exists
             * on this page at all. Everything it writes goes to localStorage under
             * 'dsh-thinking-highlight.state.probe'; reload the page afterwards so a
             * fresh pass fills it in.
             */
            diagnose: (on = true) => {
              if (typeof handle.setProbe === 'function') handle.setProbe(on !== false)
              return {
                probe: on !== false ? 'on — reload the page, then read localStorage["dsh-thinking-highlight.state.probe"]' : 'off',
                reasoningRowsNow: liveRoots().length,
                keywords: snapshot.rows.length,
                enabled: snapshot.enabled === true,
              }
            },
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
              forgetRows()
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
              for (const element of [...rooms.keys()]) restoreRoom(element)
              forgetRows()
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
              textColor,
              fontSize,
              styleKey,
              chipScale,
              markStyle,
              unmarkedText,
              liftSeatOf,
              liftForRow,
              restoreLift,
              sweepLifts,
              lifts,
              setRoom,
              restoreRoom,
              sweepRooms,
              rooms,
              hostFontDelta,
              badgeDefaults,
              screenBadge,
              screenTemplate,
              badgeKey,
              badgeRoom,
              chipScaleOf,
              chipLineHeight,
              chipBoxHeight,
              buildChip,
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
