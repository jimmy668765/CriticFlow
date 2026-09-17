# CriticFlow Paseo 插件

Paseo 网页端划词引用与 CriticMarkup 批注插件。v1.2.3 为 GitHub prerelease；本版本未运行测试，未完成 GUI 验收。依赖网页 DOM 与 Paseo Plugin RPC；**Paseo 原生手机端不支持**。

不需要 bridge，也不需要手动启动本地 server。

## 工作方式

- 在当前工作区的原始 Markdown 文件中划选文本，选择引用、评论或批注。
- 选区绑定当前工作区、原始文件与位置，不跨工作区搜索，也不要求输入目标路径。
- 批注直接写回原 Markdown 文件，使用 `{==原文==}{>>批注<<}`；支持新增、修改、删除。
- 重复文本按位置区分；同一 Markdown 块内可跨文本节点显示批注。
- 跨段落、列表项等块级边界的批注暂时保留源码，可能没有高亮/气泡；不进行破坏结构的跨块 Range 删除，此项显示支持尚未完成。

## 保存与并发限制

写入前保存备份，保存时执行最后检查，然后写入临时文件并原子 rename。该流程**不是跨进程原子 CAS**：外部编辑器在极短窗口内仍可能产生冲突。请避免多个编辑器同时写入同一文件。

## 快捷键

- `⌘/Ctrl + Shift + Q`：引用当前选区；无输入框时打开批注面板
- `⌘/Ctrl + Shift + C`：打开批注面板
- `⌘/Ctrl + K`：搜索 Quote、Annotate / 批注命令
- `Esc`：关闭浮动工具栏、面板或详情弹窗

## 安装

在仓库根目录执行：

```sh
paseo plugin install ./packages/paseo
# 升级本地源码后：
paseo plugin reload quote-selection
```

按 CLI 提示信任此插件。macOS 如果 `paseo` 不在 PATH，可使用 `/Applications/Paseo.app/Contents/Resources/bin/paseo`。保留 `client/`、`shared/` 与 `server/` 目录，它们是运行时依赖。
