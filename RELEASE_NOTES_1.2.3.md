# CriticFlow v1.2.3

> 三端统一定位修正版，GitHub prerelease。未运行测试或 GUI 验收，不宣称三端实机通过。

## 统一修复

三端都遵循同一条规则：网页/渲染文字只产生候选位置，最终写入必须使用原始 Markdown 源 offset；唯一候选可直接写入，重复候选必须经过位置锚点消歧，无法确认就拒绝而不改文件。

### Paseo

- 修复 Markdown 渲染文字与源文件不连续时的误报“原文或旧批注已变化”。
- 增加源 offset prose 映射，支持常见链接、Wiki 链接、HTML 标签和实体。
- 唯一源匹配不再被渲染前后文差异误杀；重复文本不退化为仅凭局部上下文猜测。

### Obsidian

- 修复 source projection 的 Unicode/Emoji offset 重复计数问题。
- Reading View 仍以源 section 与快照为边界，源码写入保留原始片段。
- 重复文本和复杂 Markdown 无法唯一映射时继续拒绝写入。

### MarkEdit

- 新增批注直接使用冻结的 CodeMirror source selection，不再在选区内 `trim()` 后重新 `indexOf()`。
- DOM 选区必须属于编辑器；批注气泡打开前校验源码范围，编辑/删除不再依赖无校验的固定 DOM 反推。
- 无 CodeMirror 原文时不再从 `document.body.innerText` 伪造批注报告。

## 实际部署与边界

- Paseo 已重载，CLI 状态为 `running`。
- Obsidian 已构建并覆盖本机 canonical 插件目录。
- MarkEdit 两份脚本已备份并覆盖本机目标文件。
- 尚未操作 GUI 或运行测试；请重新划选并分别验证三个宿主。
- 跨 Markdown 块批注仍可能保留 CriticMarkup 源码；Paseo 原生手机端不支持；MarkEdit 仅 macOS。
