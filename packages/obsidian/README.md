# CriticMarkup Annotate & Review（Obsidian）

为 Obsidian 提供划词批注与 Agent 审阅工作流。v1.2.3 为 GitHub prerelease；本版本未运行测试，未完成 GUI 验收或 desktop/mobile 实机验收。

## 核心能力

- 划词创建批注，底层保存为标准 CriticMarkup：`{==原文==}{>>批注<<}`。
- 批注目标冻结原始 `TFile`、路径、编辑器身份与全文快照。
- 新增、编辑、删除均使用精确选区与 offset 替换，避免重复文本误定位。
- Reading View 保存前检查文件快照；发生变化时保留弹窗并报错，不提示成功。
- Reading renderer 按源 section 范围与快照绑定定位批注，重复出现次数按位置区分；格式与软换行差异通过保留 offset 的 prose 映射定位；Live Preview 支持多行折叠。
- `⌘ + Shift + E`：提取全文批注为 Agent 指令并复制到剪贴板。
- `⌘ + Shift + C`：用当前选区打开批注；`⌥ + Shift + C`：切换预览与源码视图；`Esc`：关闭弹窗。

## 已知限制

多行折叠的实现路径已完成，但尚未实机确认所有 Reading View 场景。跨独立渲染 section 或跨 Markdown 块的长备注保守保留 CriticMarkup 源码，不执行跨块 DOM 删除。

## 安装

要求 Obsidian **1.1.0 或以上**。将 `main.js`、`manifest.json`、`styles.css` 放入 Vault 的 `.obsidian/plugins/obsidian-criticmarkup/`，然后在第三方插件中启用；升级后重启应用。

若旧版装在 `criticflow-annotate`，先备份并移走旧目录、停用旧入口，只保留与 manifest ID 一致的 `obsidian-criticmarkup`，避免重复加载。
