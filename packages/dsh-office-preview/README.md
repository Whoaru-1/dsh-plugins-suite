# dsh-office-preview

给 DSH Web 右侧边栏的**文件预览**补上官方渲染器不支持的格式。装完之后，点击文件树里的
Word / Excel / PowerPoint / CSV 文件就能直接看到内容，而不是报错或显示乱码。

## 它解决什么问题

官方预览插件（`@deepseek-ai/dsh-client-ui-sidebar-documentpreview`）只注册了这几类渲染器：

| 渲染器 | 扩展名 | 读取方式 |
|---|---|---|
| Markdown | `md` `markdown` | 按行分页读文本 |
| 代码高亮 | 各语言扩展名 | 按行分页读文本 |
| 图片 | `png` `jpg` `jpeg` `gif` `webp` `bmp` `ico` `svg` | 完整字节 |
| PDF | `pdf` | 完整字节 |
| HTML | `html` `htm` | 完整字节 |
| 纯文本（兜底） | 任何其他扩展名 | 按行分页读文本 |

问题出在兜底路径：`.docx` / `.xlsx` / `.pptx` 都是 ZIP 包，字节里含 NUL，而
`workspaceFiles.read` 对文本页做 UTF-8 与 NUL 校验，会直接抛
`workspace-file/not-text`（“contains NUL bytes”），所以侧边栏里根本打不开 Word 文件。
旧版 `.doc`、`.rtf`、`.odt`、`.epub`、压缩包、音视频、字体等二进制文件同理。

## 装了什么

通过官方扩展点注册渲染器（不修改任何官方文件）：

- `ctx.documentPreviews.register({ id, extensions, priority: 'extension', loading: 'bytes-complete' })`
- `ctx.slots.inject('sidebar.right.tab.document', …)` 注册对应的 keyed 组件

`priority: 'extension'` 让这些渲染器排在官方内置渲染器前面，扩展名命中即自动选中，
不需要手动切换下拉框。新增的渲染器：

| 渲染器 | 扩展名 | 实现 |
|---|---|---|
| Word 文档 | `docx` `docm` `dotx` `dotm` | docx-preview：真实分页、页眉页脚、表格、内嵌图片 |
| Excel 表格 | `xlsx` `xlsm` `xltx` `xltm` `xls` `xlsb` | SheetJS：多工作表标签、合并单元格、数字右对齐、日期格式化 |
| 分隔文本表格 | `csv` `tsv` `tab` | 自带解析器：引号、字段内逗号与换行、分隔符自动嗅探 |
| PowerPoint | `pptx` `pptm` `potx` `potm` `ppsx` | pptx-preview：逐页幻灯片渲染，按面板宽度缩放 |
| 旧版/开放文档 | `doc` `dot` `rtf` `odt` `ott` `ods` `odp` `odg` `epub` … | 友好提示卡片（说明如何转换） |
| 压缩包 | `zip` `rar` `7z` `tar` `gz` `jar` `dmg` `iso` … | 友好提示卡片 |
| 音视频 | `mp3` `wav` `m4a` `mp4` `mov` `mkv` `webm` … | 友好提示卡片 |
| 其他二进制 | `exe` `dll` `ttf` `woff2` `psd` `sqlite` `pyc` `wasm` … | 友好提示卡片 |

未列出的扩展名（例如 `.bin`、`.dat`）仍走官方纯文本兜底。

## 安装

插件源码与构建产物都在 `~/.dsh/local-plugins/dsh-office-preview/`，profile 通过
`file:` 依赖安装它：

```sh
dsh plugin --profile web add "dsh-office-preview@file:$HOME/.dsh/local-plugins/dsh-office-preview"
```

profile 的 `cordis.patch.yml` 里需要一行挂载（profile 的 `dsh.profile.bundles`
列表也可以，二选一）：

```yaml
- insert:
    - id: dsh-office-preview
      name: 'dsh-office-preview'
```

改动插件代码后重新构建并刷新 profile 依赖：

```sh
cd ~/.dsh/local-plugins/dsh-office-preview
npm run build                     # 重新生成 lib/client.js
npm test                          # 离线验证（需要 /tmp/dopfx 下的样例文件）
cd ~/.dsh/profiles/web && pnpm install
```

## 构建与验证

- `npm run build` — esbuild 把 `src/client.js` 打成 `lib/client.js`，包装成
  `window.__ModuleLoader__.load({ id, factory })`；`react` 与 `react/jsx-runtime`
  保持外部依赖，由宿主模块表提供。
- `npm test` — 在 jsdom 里用真实 React 渲染真实文件，检查：
  注册了 8 个渲染器、扩展名不冲突、每种渲染器都渲染出真实 DOM（Word 分页与表格、
  Excel 网格与日期、CSV 引号与换行、PPT 幻灯片）、兜底卡片文案、卸载时释放全部注册。

样例文件可以用 python-docx / openpyxl / python-pptx 生成：

```sh
python3 -c "from docx import Document; Document().save('/tmp/dopfx/sample.docx')"
```

## 第三方库与许可

| 库 | 许可 | 用途 |
|---|---|---|
| [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) | Apache-2.0 | Word 渲染 |
| [SheetJS xlsx](https://git.sheetjs.com/sheetjs/sheetjs) | Apache-2.0 | Excel 解析 |
| [pptx-preview](https://github.com/501351981/pptx-preview) | ISC | PowerPoint 渲染（发布包免费使用；其源码不开源） |

`jszip` 与 `echarts` 等传递依赖随上述库一并打包进 `lib/client.js`。
