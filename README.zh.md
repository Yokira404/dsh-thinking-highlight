# 标红插件 · Thinking Highlighter

[English →](README.md)

DSH 插件：统计思考行（思维链）里关键词出现的次数并按词标红，设置在左侧有独立分区。

![思考行上的计数徽章与标红](docs/reasoning.png)

- **计数徽章**：每条思考行的标题行上、紧挨着标题显示 `关键词 × n`，一个词一个徽章，一眼看出哪个词反复出现、出现几次。
- **点徽章 = 这个词的开关**：点一下，这个词在**所有行**里停止标红，徽章原地变成灰虚线（位置和计数都还在），再点一下恢复。
  状态会存进设置，刷新后仍然有效。
- **标红**：展开思考行后，命中的关键词以它自己的颜色加底色标出；正文文字本身不变色，所以不会出现「字和背景一个色」。
- **每个词自己的样式**：颜色、字体（默认 / 等宽 / 衬线）、加粗、斜体、下划线——正文里的标红和徽章上的词一起变。
- **完整词**：按词开关。开了以后 `is` 只匹配独立成词的位置，不再命中 `this` 或 `ThisIs`。
- **折叠时统计整段推理**：折叠与展开时的数字一致，不会只数那一行预览。
- **逐行眼睛**：单独隐藏某一行的标红，不影响其它行。
- **一个词只有一条**：输入已存在的词会被拒绝，并说明原因。

## 安装

需要 DSH 桌面端（开发与验证基于 `@deepseek-ai/dsh-desktop` 0.2.0-rc.2）。

```bash
git clone https://github.com/Yokira404/dsh-thinking-highlight.git
cd dsh-thinking-highlight
node evidence/install.mjs desktop        # 或传入其它 profile 名
```

安装脚本会在 profile 的 `package.json` 里写一条指向本目录的 **`link:` 依赖**、把包加进 `dsh.profile.bundles`，
并在 `<profile>/node_modules` 下建一个 junction。之后**重启应用**：侧边栏「插件 → 已安装」里会出现卡片，
卡片右侧的开关即整体启停。

也可以用插件页自带的「添加插件」填本目录路径，效果相同（它还会顺带跑一次 pnpm 刷新 lockfile）。

> 依赖那一条不能省：插件页只列 profile 记成**依赖**（或随安装提供的官方可选包）的组合包。只写进
> `dsh.profile.bundles` 的包照常加载，但不会出现卡片，也就没有开关。

## 设置

`Ctrl + ,` → 左侧导航 **标红插件 / Thinking Highlighter**。

![插件自己的设置分区](docs/settings-zh.png)

| 行 | 作用 |
|---|---|
| 语言 | 插件界面语言（中文 / English）；左侧导航那一行的名字也跟着变 |
| 插件开关 | 一键隐藏全部颜色、徽章与标红 |
| 折叠时显示标注 | 折叠的思考行是否显示徽章与眼睛 |
| 展开时撑开思考框（默认关） | DSH 把一轮的过程收进一个最高 400px 的可滚动框里；打开这一项后，有行展开期间插件会临时去掉这个高度上限，长思维链不用在框内滚动就能读完 |
| 区分大小写 | 关掉（默认）时 `is` 也会命中 `IS` |
| 关键词（每行） | `关键词输入框` `▸样式` `完整词` `抑制` `删除` |
| ▸ 样式面板 | 这个词的颜色、字体、**B** 加粗、**I** 斜体、**U** 下划线 |

设置存在浏览器本地（`localStorage`），改动即时生效。

## 实现要点

思考行是内置组件、没有对外插槽，所以装饰走**渲染后的 DOM**——只切分文本节点，从不替换 React 的节点：

- 标红时把 React 自己那个文本节点的值清空，在它前面插入插件新建的 span。React 之后写回的仍是同一个节点，
  因此流式输出不崩、不丢字。唯一看得见的接缝：React 把新一段写进那个节点之后、插件下一趟处理之前（最多一个
  90 ms 的合并窗口），上一版的切分副本和新全文会同时留在 DOM 里，那一趟会把旧副本丢掉并重新标红新文本。
- 变更按 90 ms 合并；行文本与设置都没变就整行跳过。
- 徽章插在**标题那一行本身**（`[data-open] > [data-disclosure-row] > 内容行`），标题与它的分隔点之后、
  折叠预览之前：折叠时整个头部是固定高度的盒子，挂在块级层上会掉到行下面去。头部块靠它的
  `[data-disclosure-row]` 那一行来找，而不是靠「行的第一个子元素」：模型还在流式输出时，宿主会在头部块
  **之前**渲染一个视觉隐藏的「正在思考」状态 span，徽章落进那个 1px 盒子就等于没人看得见。
- 展开的思维链在**披露块内部**、紧跟标题行之后找（`DisclosureRow` 就是这么渲染的：`[div[data-disclosure-row],
  open && children]`）。已经完结、从未在流式中被看到过的行也必须这样找得到，否则展开它永远不会上色。
- 徽章组**完全不参与收缩**（旁边的折叠预览是 `flex: auto`），所以它有定宽上限、只裁自己。
- 计数用的文本**只排除徽章组**，高亮 span 要算进来：两者都带标记，一律排除会让数字在第一次标红后掉到 0，
  连徽章一起消失；反过来连徽章一起数，就是自己数自己，数字每轮往上爬一格。
- 折叠行没有正文可数：宿主只在展开时挂载思维链，整段文字活在宿主组件的 `text` 属性上。插件顺着 React 挂在
  每个节点上的 fiber（`__reactFiber$…`）往上找到它；任何意外情况（没有 fiber、属性改名、换 React）都读作
  「拿不到」，退回只用 DOM 文字。

## 兼容性与已知取舍

- 插件按当前 DSH 渲染出的 `[data-variant="think"]` 行来装饰。DSH 若改动这些内部结构，这里可能需要跟着改；
  查找失败时插件只会「少做一点」，不会把对话弄坏。`evidence/host-shape.mjs` 按安装版的真实结构建模，并顺带
  断言它依赖的那几个标记仍然存在于应用自己的 bundle 里——DSH 改名会变成一条失败的测试，而不是安静地不工作。
- 抑制是按**关键词**生效的（同一个词在所有行一起停），逐行控制是那只眼睛。
- 四个设置里只有「展开时撑开思考框」会碰宿主布局，所以它默认关闭。
- 设置存在本机浏览器里。另一个窗口改了设置，会通过浏览器的 `storage` 事件传过来，插件重新读一遍并重建每一行。

## 开发

```bash
node evidence/selftest.mjs         #  27 项：切分/还原/计数/大小写/颜色/完整词边界
node evidence/client-harness.mjs   # 102 项：浏览器半边在桩宿主里真的跑起来
node evidence/css-check.mjs        #  19 项：样式表字面量（括号、徽章/行/面板规则）
node evidence/locale-check.mjs     #   8 项：包 meta、两个语言文件与版本号互相对得上
node evidence/host-shape.mjs       #  25 项：安装版的真实行结构，以及它在应用 bundle 里的标记
node evidence/e2e-bundle.mjs <带 token 的页面地址> @Yokira404/dsh-thinking-highlight <cookie>
```

自检用大括号配对从 `client.js` 里**抽出真正在跑的函数**（不是副本）跑在 DOM 桩上；harness 则真的执行
factory、`apply`、设置页组件和一次完整的思考行装饰。它们针对的都是安静出错的坑：模板字符串丢了尾巴、
计数把自己数进去、缓存让标红再也回不来。

`host-shape.mjs` 是唯一按**宿主真正渲染的 DOM** 建模的套件（含流式期间那个视觉隐藏的状态 span、嵌在披露块
内部的正文）：用插件自己的假设搭出来的桩，抓不到假设本身错在哪。找不到应用安装时，它的 bundle 检查会打印
SKIP 而不是失败。

`e2e-bundle.mjs` 对着一个跑起来的临时 profile 做端到端校验：Host 行真的激活、启动清单带上浏览器半边、
下发的 bundle 与 `client.js` **逐字节一致（sha256）**。

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单：`dsh.bundle.patch` + `dsh.client`（`platform: web`） |
| `cordis.patch.yml` | 往 profile 里插入 `thinking-highlight` 行 |
| `index.js` | Host 半边：让包可加载并发布 `dsh.client` |
| `client.js` | 浏览器半边：设置分区 + 思考行装饰 |
| `locale/*.json` | 卡片标题与描述，必须是 `{"meta": {...}}` |
| `icon.svg` | 插件图标 |
| `docs/` | 上面那几张截图 |

运行期可以在控制台用 `window.__DSH_TH__`：`settings()`、`rows()`（`{ highlighted, count, hasBadges, marked,
folded }`）、`refresh()`、`clear()`、`pass()`、`passes()`。

## 卸载

插件页卡片上的**卸载**，或手动删掉 `link:` 依赖、`node_modules/@Yokira404/dsh-thinking-highlight` junction
与 `dsh.profile.bundles` 里的条目。卸载会移除全部徽章、还原被切分的文本节点、撤掉插件样式，并把
`dsh-th-body` 这个标记 class 从宿主元素上摘掉。

## 许可

[MIT](LICENSE) © 2026 Yokira404
