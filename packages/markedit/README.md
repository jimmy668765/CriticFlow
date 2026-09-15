# MarkEdit CriticMarkup Annotation 扩展

专为 **MarkEdit (macOS 原生 Markdown 编辑器)** 打造的就地批注与 Agent 反馈闭环脚本。

## 🎯 核心能力

1. **就地弹出微拟态批注框**：
   - 在 MarkEdit 任意文档中选中文本，按下 **`⌘ + Shift + C`**。
   - 原地弹出暗色毛玻璃卡片，输入你的修改意见或要求。
   - 按 **`⌘ + Enter`** 或点击提交，选区将自动转化为标准的 CriticMarkup 规范：
     ```markdown
     {==被选中的文本==}{>>你的修改批注内容<<}
     ```
2. **一键提取所有批注为 Agent 指令**：
   - 审阅完整篇文档后，按下 **`⌘ + Shift + E`**。
   - 脚本自动扫描当前文档中所有 `{==原文==}{>>批注<<}` 标记，编译成结构化的 Agent 任务清单并直接存入剪贴板：
     ```markdown
     【文档批注修改清单】请根据以下人类批注修改对应文本，改完后清除所有批注标记：
     1. 原文：... 批注：...
     2. 原文：... 批注：...
     ```
   - 切换到任何 Agent 聊天框直接 `⌘ + V` 发送即可！

## 🚀 安装方法

在终端运行以下一行命令即可自动安装：

```bash
bash markedit-extension/install.sh
```

或者手动将 `criticmarkup-annotate.js` 复制到：
`~/Library/Containers/app.cyan.markedit/Data/Documents/scripts/criticmarkup-annotate.js`

完成后**重启 MarkEdit** 即可生效。
