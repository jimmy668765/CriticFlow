# CriticMarkup Annotate & Review (Obsidian Plugin)

专为 **Obsidian** 打造的沉浸式划词批注与 AI Agent 审阅工作流插件。

基于 **CodeMirror 6 原生 MatchDecorator 与 WidgetType** 构建，提供极致轻快、不破坏文本排版的所见即所得体验。

---

## ✨ 核心特性

1. **鼠标划词即浮现便签**：划选任何文本后，选区上方自动浮现【📝 批注】小胶囊，点击直接弹出卡片输入修改意见；
2. **非侵入式折叠（所见即所得）**：底层存储为国际通用的标准 CriticMarkup 语法（`{==原文==}{>>批注<<}`），视图层自动隐形符号，呈现为**金色荧光正文 ＋ 词尾胶囊便签 `💬 批注内容`**；
3. **点击便签管理**：点击任何已有批注气泡，弹出详情卡片，支持【🗑️ 删除批注】（一键还原原文）或【保存修改】；
4. **一键提取给 Agent（⌘ + Shift + E）**：将全文所有批注按审阅标准编译为 Prompt 指令并复制到剪贴板，直接粘贴给 Claude Code / Codex / Pi；
5. **快捷键完备**：
   - `⌘ + Shift + C`：选区弹出批注卡片
   - `⌘ + Shift + E`：提取全篇批注给 Agent
   - `⌥ + Shift + C`：自由切换便签预览视图 / 源码纯文本视图
   - `Esc`：快速关闭弹窗

---

## 🚀 安装方式

### 方式一：本地极速安装（推荐）

只需将本文件夹复制到你 Obsidian 库的插件目录：
```bash
# 复制到你的 Vault
cp -r obsidian-criticmarkup /path/to/your/vault/.obsidian/plugins/obsidian-criticmarkup
```
然后在 Obsidian 设置 -> **第三方插件**中启用本插件即可。

### 方式二：Obsidian Community Plugins 市场提交
已包含符合官方规范的 `manifest.json`、`styles.css`、`main.js`，可以直接提交至 Obsidian 官方插件仓库。
