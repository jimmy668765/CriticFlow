# Paseo Quote Selection Plugin (划词引用插件)

一个轻量、高效的 Paseo 客户端插件，实现划词选中文本后快速引用到对话框的功能。

## 功能特性

1. **悬浮引用与批注工具栏（Floating Toolbar）**：
   - 在聊天历史、消息或纯 Markdown 文档中划选任意文字，选区上方自动浮现微拟态半透明工具栏。
   - 提供「引用提问 (`⌘⇧Q`)」、「引用评论」与全新的「📝 批注 (`⌘⇧C`)」三大操作。
2. **纯 Markdown 界面就地批注弹窗（Inline Annotation Popover）**：
   - **专为文档评审设计**：在无聊天输入框的纯 Markdown 文档/Artifacts 界面中，点击或按快捷键自动展开就地批注卡片。
   - 输入批注修改意见，支持：
     - **`📋 复制标记`**：一键生成标准 CriticMarkup 语法 `{==原文==}{>>批注<<}` 复制至剪贴板；
     - **`🤖 发送给 Agent`**：自动组装结构化 Prompt（带原文引用与修改意图），若有输入框自动填入并聚焦，若为纯文档则生成标准 Agent 任务指令复制到剪贴板并弹出 Toast 引导。
3. **快捷键全面支持**：
   - **`⌘ + Shift + Q`**：一键引用到输入框（无输入框时智能唤起批注弹窗）。
   - **`⌘ + Shift + C`**：无论任何界面，就地唤起 CriticMarkup 批注弹窗。
   - **`Esc`**：一键关闭任何浮窗。
4. **命令面板（Command Center）集成**：
   - 按 `⌘ + K` 搜索 `Quote`（引用选区）或 `Annotate` / `批注`（就地批注当前选区）。
5. **斜杠命令（Slash Command）**：
   - 支持在输入框使用 `/quote` 命令快速引用。
6. **智能防干扰与纯净内存**：
   - 输入框内编辑不触发浮窗；
   - 卸载或热重载时彻底清理所有 DOM 节点与全局监听器，零内存泄漏。

## 项目结构

```
quote-selection/
  ├── paseo-plugin.json   # Paseo 插件元数据清单
  ├── package.json        # 依赖与类型检查配置
  ├── tsconfig.json       # TypeScript 编译配置
  ├── index.client.tsx    # 客户端划词监听、DOM 气泡与输入框注入实现
  └── README.md
```

## 管理命令

- **查看插件状态**：
  ```bash
  paseo plugin ls
  ```
- **查看插件日志**：
  ```bash
  paseo plugin logs quote-selection
  ```
- **热重载插件**：
  ```bash
  paseo plugin reload quote-selection
  ```
