# 标红插件 · Thinking Highlighter

思维链（思考行）的提示词统计与标红插件，配套一行设置界面。

- **计数徽章**：每条思考行展开行标题旁显示 `提示词 × n`，n 是该条思维链里这个词出现的次数；多个关键词各占一个徽章，颜色即该关键词的标红颜色。
- **思维链标红**：展开思考行后，正文里命中的关键词以该关键词的颜色加底色标出。
- **眼睛开关**：徽章右侧一只眼睛图标，点一下变成「眼睛加斜线」，这一行的标红立刻隐藏/恢复，按钮图标同步切换。
- **设置行**：`Ctrl + ,` → 通用里新增一行「标红插件」，纵向排列，样式沿用设置内其他选项：

  | 行 | 作用 |
  |---|---|
  | 语言 | 中文 / English，插件界面语言（第一行） |
  | 插件开关 | 一键隐藏全部颜色、徽章与标红 |
  | 不区分大小写 | 关键词匹配是否忽略大小写 |
  | 版本 | `版本 v1.0` |
  | ——— 分隔线 ——— | |
  | 关键词 / 颜色 / 删除 | 每行一个关键词，可改颜色（色块即取色器） |
  | 添加提示词 | 新增一个关键词行；右侧「恢复默认」回默认值 |

设置保存在浏览器本地（`localStorage`），改动即时生效。

## 结构

| 文件 | 作用 |
|---|---|
| `package.json` | bundle 清单：`dsh.bundle.patch` + `dsh.client`（`platform: web`） |
| `cordis.patch.yml` | 在 profile 里插入 `thinking-highlight` 行 |
| `index.js` | Host 半边；只负责让包可加载并发布 `dsh.client` |
| `client.js` | 浏览器半边：设置行 + 思考行装饰（计数徽章、标红、眼睛开关） |
| `locale/zh.json`、`locale/en.json` | 插件卡片标题与描述，跟随 DSH 界面语言 |
| `icon.svg` | 插件图标 |

## 实现要点

思考行 `[data-variant="think"]` 是内置组件，没有对外插槽，所以装饰走渲染后的 DOM：

- 标红只做两件事——把 React 自己那个文本节点的值清空，然后在它前面插入新建的高亮 `span` 和剩余文字节点。
  新节点全是插件自己的，React 之后写回的仍是原来那个节点，所以流式输出时不会崩、不会丢字，也不会出现重复文字。
- 每次变更按 90ms 合并一次；行文本与正文都没变就整行跳过，流式期间开销可控。
- 重新标红前先按记录把上一次插入的节点删掉、把文本还原，所以反复展开/折叠、编辑关键词都不会累积。

## 运行期自检

浏览器控制台里可用 `window.__DSH_TH__`：

```js
__DSH_TH__.version            // '1.0'
__DSH_TH__.settings()         // 当前设置
__DSH_TH__.rows()             // 每条思考行：{ highlighted, count, hasBadges }
__DSH_TH__.refresh()          // 强制重算所有行（改过 localStorage 后可用）
__DSH_TH__.clear()            // 立刻移除徽章、还原文本节点
```

## 本地校验（不装插件也能跑）

```bash
node evidence/selftest.mjs                 # 20 项：切分/还原/计数/大小写/颜色
node evidence/e2e-bundle.mjs <带 token 的页面地址> @local/dsh-thinking-highlight <cookie>
```

`evidence/selftest.mjs` 用大括号配对从 `client.js` 里**抽出真正在跑的函数**（不是副本），
配一个遵守 `splitText` 真实语义的 DOM 桩来验证：命中切分后文本一字不多一字不少、
还原后节点结构与文本完全回到原样、同一段重复包装不会累积、跨多个文本节点时每条记录都能还原、
正则元字符按字面处理、长词优先、颜色只接受合法十六进制。

`evidence/e2e-bundle.mjs` 对着一个跑起来的临时 profile 校验：插件行真的激活了、
启动清单里带上了它的浏览器半边、下发的 bundle 内容就是当前源码。

## 卸载

`plugin_manager` → `remove_bundle` 删除 `@local/dsh-thinking-highlight`，或直接删掉本目录后在设置里移除该 bundle。插件卸载时会自动移除徽章、还原被切分的文本节点并撤销样式。
