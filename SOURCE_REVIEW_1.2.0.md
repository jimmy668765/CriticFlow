# v1.2.0 源码审查与交付记录

本文件记录源码检查与构建结果，不是 GUI 或测试通过报告。本轮依用户要求未运行测试、未操作宿主 GUI。

## 已收敛的问题

| 范围 | 修改 |
|---|---|
| Paseo | 宿主 RPC 替代裸 HTTP bridge；工作区与原文件绑定；快捷键入口同步捕获选区；上下文与出现次序消歧；新增/编辑/删除成功持久化后才更新界面；跨节点长批注从原文件取回完整评论；聊天输入框不再按最近距离或任意 textarea 猜测 |
| Obsidian | 冻结原文件、编辑器与文档快照；编辑器按 offset 替换；阅读模式使用来源 section 与 Vault.process 校验；拒绝陈旧、嵌套和歧义定位；失败不关闭弹窗、不报告成功；移除乐观 DOM 高亮 |
| MarkEdit | 冻结编辑器、文档与选区；已有批注按 widget 位置定位；等待真实 saveDocument 结果；失败重试不重复修改；修复折叠开关；删除直接改写 CodeMirror DOM 的兜底；防止新版脚本双份加载 |
| 编辑器渲染 | Obsidian、MarkEdit 改用直接 StateField decorations，而非 viewport MatchDecorator 处理多行范围 |

## 复核依据

- MarkEdit 官方 `CoreEditor/src/api/methods.ts`：`saveDocument(): Promise<boolean>`；实际安装 bundle 同样导出此方法。实现等待返回 true，并在 await 前后核对编辑器与文档。
  https://github.com/MarkEdit-app/MarkEdit/blob/main/CoreEditor/src/api/methods.ts
- CodeMirror 官方 folding 实现以 StateField + `Decoration.replace({widget})` 表示跨行折叠。因此未采纳“StateField 内的 inline replacement 一律不能跨行”的审查意见；不能混同 viewport ViewPlugin 的行结构限制。
  https://github.com/codemirror/language/blob/main/src/fold.ts
- Paseo 渲染匹配使用 Unicode prose 规范化，不要求 DOM textContent 保留源 Markdown 换行。长备注从 RPC 的源文件记录恢复，不从扁平化 DOM 伪造原始评论。最终加入块边界保护：参与替换的所有文本节点必须属于同一 Markdown 块，否则保留源码，不进行跨块 Range.deleteContents。跨段落长备注的高亮/气泡尚未完成，不能以本候选版视作已修复。Paseo 还拒绝归一化后对应多个不同原始批注的歧义映射。

## 已执行的交付检查

- 已生成 Obsidian production `main.js`，同步到仓库根目录；构建成功不等于类型检查或功能验收。
- Paseo 插件已重载，宿主报告 running；该状态不等于界面验收。
- 发布前检查版本、源码/副本同步和 Git diff；发布说明标注 GitHub prerelease。

## 仍需明确的限制

- Paseo 与 Obsidian 阅读模式跨块批注暂不折叠，保留源码以避免破坏段落、标题或列表结构。
- Paseo 文件写入不是跨进程原子 compare-and-swap。备份和最后一次检查无法消除不合作的外部编辑器在 check/rename 间写入的窗口；避免多编辑器并写。
- Obsidian 阅读模式以渲染 section 对应源范围。跨独立 section 的长备注、局部渲染及复杂 Markdown 不保证全部折叠；不能唯一定位时拒绝写入，建议在编辑模式处理。
- Obsidian 编辑器更改交由宿主自动保存；阅读模式才直接等待 Vault.process 完成。
- Paseo 原生手机界面不在当前 DOM 插件覆盖范围。Obsidian 手机端声明支持但本轮未实机验收；MarkEdit 仅 macOS。
