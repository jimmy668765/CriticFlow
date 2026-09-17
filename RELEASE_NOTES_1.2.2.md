# CriticFlow v1.2.2

> GitHub v1.2.2 为 prerelease。本次修复针对 Paseo 划词批注保存误拒绝；未运行 GUI 验收，不宣称三端实机通过。

## Paseo 保存定位修复

- 唯一的精确源文件匹配不再被渲染前后文 anchor 的差异误拒绝。
- 阅读模式选区与 Markdown 源文件不连续时，使用保留源 offset 的 prose 映射；支持常见 Markdown 链接、Wiki 链接、HTML 标签与 HTML 实体。
- 重复文本仍需通过前后文或出现序号消歧，不会取第一处。
- 写入仍保留源文件实际片段；已有批注重叠、文件变化和工作区越界继续拒绝写入。

## 现状边界

- Paseo 插件已同步并重载，本机状态为 `running`。
- 本次未操作 GUI，未运行测试；需在 Paseo 中重新划选并保存一次确认实际体验。
- 跨 Markdown 块的高亮/气泡仍采取保守策略，可能保留 CriticMarkup 源码。
