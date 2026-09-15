# MarkEdit CriticMarkup Annotation 扩展

为 **MarkEdit（仅 macOS）** 提供就地批注与 Agent 审阅工作流。v1.2.1 为 GitHub prerelease；本版本未运行测试，未完成 GUI 验收或实机验收。

## 核心能力

- 选中文本后按 **`⌘ + Shift + C`** 打开批注框，提交为标准 CriticMarkup：
  ```markdown
  {==被选中的文本==}{>>你的修改批注内容<<}
  ```
- 批注交互绑定 `EditorView`、文档快照与 offset，文档变化时不会把批注写入错误位置。
- 保存前后检查文档状态；失败时保留弹窗并明确提示。
- `saveDocument(): Promise<boolean>` 可用时自动保存；API 缺失或失败时提示使用 **`Cmd+S`**。
- 保存重试只重新保存，不会二次插入批注。
- **`⌘ + Shift + E`**：将全文批注编译为 Agent 指令并复制到剪贴板。

自动保存 API 已对照 MarkEdit 官方源码及实际安装 bundle 核对，但仍未完成实机验收；编辑器写入不应视为磁盘持久化成功。

## 安装

```bash
cd packages/markedit
bash install.sh
```

安装脚本默认写入 MarkEdit 的 Scripts 目录：
`~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/criticmarkup-annotate.js`

如果发现旧的 Scripts 文件，会先将其备份到 `~/.criticflow/backups/markedit/` 下的唯一时间目录；逐字节匹配的 `editor.js` 也会一并备份。仅当两者逐字节相同时，才会同步替换 `editor.js`；不一致时会保留用户的 `editor.js` 不动。

安装后需重启 MarkEdit；本版本不声称脚本已在界面加载。
