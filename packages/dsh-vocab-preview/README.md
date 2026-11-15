# dsh-vocab-preview

让 **剧有词（juyouci）** 生成的单词学习页，在你下一句话说完的瞬间，自动出现在 DSH 右侧的预览面板里。

## 它解决什么问题

DSH 官方预览插件（`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`）**本来就能渲染 HTML**：
它注册了 `html` / `htm` 渲染器，把文件字节塞进一个 `sandbox="allow-scripts"` 的 iframe。
剧有词学习页的「学习 → 回忆词义 → 英文挖空 → 自评 → 错词重练」全靠脚本驱动，在这个 iframe 里能照常运行。

所以**不需要**再装一个 HTML 渲染器——那是重复造轮子。真正缺的是**自动化**：

- 官方的 HTML 预览要你自己在文件树里点到那个文件；
- 剧有词默认把学习页写到 `~/Documents/series-vocab/`，这通常在会话工作区**之外**，文件树里根本看不见。

本插件只负责一件事：**决定什么时候打开它**。

## 它怎么工作

客户端半边注册一个 `conversation.chat.turnTail` 座位（不可见，不产生任何 DOM）。
当一轮对话收尾时，它读取该轮 `deliverables` 投影里的 produced / presented 文件，挑出符合
「HTML + 路径含 `vocab`（或 `剧有词`）」的文件，取最新的一个，通过 turn-tail 插槽本来就会下发的
`openFile` 回调交给右侧预览。

判定规则对齐官方交付物的时间窗口：produced 计到收尾 `seq`（含），presented 严格早于 `seq`。

### 三条刻意的边界

| 行为 | 原因 |
|---|---|
| 一次页面加载内同一个 deck 只自动打开一次 | 避免同一轮反复重渲染时反复抢占右侧面板 |
| 250ms 防抖，最新候选取消旧候选 | 加载含多个 deck 的旧会话时，多个 turn-tail 会同时挂载；最终稳定在**最新**那一页 |
| 打开记录写进 `sessionStorage`，**同一个 deck 不会因刷新而重开** | 自动打开应当由「产出」触发，而不是由「刷新」触发；否则你在做别的事时刷新页面，已经看过的旧学习页会自己弹出来 |

关于最后一条的准确语义：判定键是「轮次 + 路径」。**插件生效后的第一次页面加载**里，这些键还没有记录，
所以会话中最新的那个 deck 会被打开一次（当作「产出」处理）；从第二次刷新开始，同一个 deck 就安静了。

如果你更希望每次刷新都把学习页找回来，删掉 `src/client.js` 里 `wasOpenedHere` / `rememberOpened`
的调用，重新 `npm run build` 即可。

## 匹配范围

`src/match.js` 里的两条规则：

```js
const HTML_EXTENSION = /\.html?$/i
const VOCAB_HINT = /vocab|剧有词/i
```

只要路径含 `vocab`，`.html` / `.htm` 就会被自动打开——覆盖剧有词的默认文件名
`vocab-show-S01E01.html` 和默认目录 `~/Documents/series-vocab/`。
想放宽到「任何 HTML 产出都自动预览」，把 `VOCAB_HINT` 改成 `/.*/ ` 即可。

## 安装

源码与构建产物都在 `~/.dsh/local-plugins/dsh-vocab-preview/`，profile 通过 `link:` 依赖解析到它：

```sh
cd ~/.dsh/local-plugins/dsh-vocab-preview
npm install          # esbuild
npm run build        # 生成 lib/client.js
npm test             # 19 项离线校验

# profile 里挂载（web profile 是 patchReload: live，改完即热挂载，不用重启 dsh web）
# ~/.dsh/profiles/web/cordis.patch.yml 追加一行 insert（见该文件里的说明）
ln -s ../../../local-plugins/dsh-vocab-preview ~/.dsh/profiles/web/node_modules/dsh-vocab-preview
```

改动插件代码后：`npm run build` 重新生成浏览器包，浏览器刷新一次页面即可加载新包。

## 构建与验证

- `npm run build` — esbuild 把 `src/` 打成 `lib/client.js`，包装成
  `window.__ModuleLoader__.load({ id, factory })`；`react` 保持外部依赖，由宿主模块表提供。
- `npm test` — 19 项校验，分两层：
  1. `src/match.js` 纯函数层：命名识别、时间窗口、去重、顺序、畸形数据容错；
  2. `lib/client.js` **真实构建产物**层：在 `node:vm` 里用桩 `window.__ModuleLoader__` 按宿主的方式
     求值，验证 loader 契约、插槽注册、以及完整自动打开流程（防抖、去重、刷新静默）。

  第二层是本插件的主要保障：它跑的就是要发到浏览器的那个 bundle，而不是源码。

## 卸载

删掉 `~/.dsh/profiles/web/cordis.patch.yml` 里那一行 insert，浏览器刷新即可。
插件目录与 profile 里的 symlink 可以留着，也可以一起删。
