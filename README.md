# CriticFlow ⚡️

> **Universal Non-Invasive Markdown Annotation & Agent Review Suite**
> 
> *Write, annotate, and review Markdown seamlessly across **Paseo**, **Obsidian**, and **MarkEdit** with continuous sentence highlights, floating capsule badges, and 1-click Agent prompt compilation.*

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Format: CriticMarkup](https://img.shields.io/badge/Syntax-CriticMarkup-blue.svg)](https://criticmarkup.com/)
[![Platforms](https://img.shields.io/badge/Platforms-Paseo%20|%20Obsidian%20|%20MarkEdit-brightgreen.svg)]()

---

## 🎯 为什么需要 CriticFlow？(The Pain Point)

让 AI 改写长文档或文章时，最痛苦的现实是：
- ❌ **直接全篇喂给 AI 重写**：语感彻底被机器味冲垮，原有行文节奏、上下文结构被粗暴破坏；
- ❌ **人类在文档里手打括号备注**：文档变成满屏 `(这里改一下)`、`【注意删掉这段】`，排版支离破碎，读起来极度难受。

**CriticFlow 的极客解法**：
1. **人类视觉无干扰（所见即所得）**：划词就自动浮现便签小胶囊，输入批注后，底层语法自动折叠为 **金色荧光底色 ＋ 词尾胶囊便签 `💬 批注内容`**。点击便签可编辑、可一键删除还原原文；
2. **底层纯文本国际规范**：原生存储为无污染的 **CriticMarkup** 标准（`{==原文==}{>>批注<<}`），任何纯文本编辑器、Git 仓库均原生兼容；
3. **AI 协同毫秒级收敛**：按下 `⌘ + Shift + E`，一键将全篇分散批注编译为结构化审阅 Prompt 并复制到剪贴板，直接粘贴给 Claude Code / Codex / Pi，精准定点执行微创手术！

---

## 📦 三端矩阵架构 (Monorepo Packages)

| 客户端 | 适用场景 | 技术栈 | 交付目录 |
|:---|:---|:---|:---|
| **Obsidian** | 个人知识库、长文写作、双链生产流 | CodeMirror 6 ViewPlugin + Modal | [`packages/obsidian/`](./packages/obsidian) |
| **MarkEdit** | macOS 原生极简单文件闪电审阅 | CodeMirror 6 MatchDecorator + WidgetType | [`packages/markedit/`](./packages/markedit) |
| **Paseo** | 本地 Agent 协同、对话与编程主战壕 | React Native for Web + Native Bridge | [`packages/paseo/`](./packages/paseo) |

---

## 🚀 安装与上手指南

### 1. Obsidian 插件安装

#### 方式 A：本地极速安装（推荐）
1. 打开终端，将 `packages/obsidian` 复制到你的 Vault 插件目录：
   ```bash
   cp -r packages/obsidian "/path/to/your/vault/.obsidian/plugins/criticflow-annotate"
   ```
2. 在 Obsidian **设置 -> 第三方插件** 中刷新，开启 **CriticMarkup Annotate & Review** 即可。

#### 方式 B：通过 BRAT 插件一键测试
1. 在 Obsidian 安装社区热门测试工具 **BRAT**；
2. 在 BRAT 中添加 GitHub 仓库地址，即可自动拉取最新 Release 并安装。

#### 方式 C：官方 Community Plugins 市场
本项目符合官方审核规范，等待官方仓库合并后，可直接在官方市场搜索 `CriticFlow` 安装。

---

### 2. MarkEdit (macOS) 扩展安装

MarkEdit 是 macOS 上体验绝佳的原生 Markdown 编辑器。

#### 一键脚本安装：
```bash
cd packages/markedit
bash install.sh
```
或手动将 `criticmarkup-annotate.js` 复制到：
`~/Library/Containers/app.cyan.markedit/Data/Documents/editor.js`
重启 MarkEdit 即可在划选文字时自动浮现 `[ 📝 批注 ]` 小胶囊！

---

### 3. Paseo 插件安装

直接将 `packages/paseo` 目录链接或复制到 Paseo 的插件工作区中，Paseo 客户端启动时将自动加载。

---

## ⌨️ 统一快捷键速查

全平台保持完全一致的肌肉记忆：

| 快捷键 | 动作 | 说明 |
|:---|:---|:---|
| **鼠标划选** | 自动浮现 `[ 📝 批注 ]` | 纯鼠标流操作，点击直接弹出卡片 |
| **`⌘ + Shift + C`** | 划选后就地弹出批注框 | 纯键盘流操作 |
| **`⌘ + Enter`** | 批注弹窗内快速提交 | 提交后原地折叠成金色便签 |
| **点击便签气泡** | 打开详情管理卡片 | 支持查看原文、修改批注、**一键删除还原原文** |
| **`Esc`** | 极速退出弹窗 | 0 延迟销毁，无残留 |
| **`⌘ + Shift + E`** | **一键提取全篇批注给 Agent** | 自动生成标准化修改指令并写入剪贴板 |
| **`⌥ + Shift + C`** | 切换折叠预览 / 源码视图 | 随时查看底层 CriticMarkup 纯文本 |

---

## 🤖 编译出的 Agent 指令示例

按下 `⌘ + Shift + E` 后，剪贴板将自动生成如下结构化指令，直接发送给任何 Coding Agent：

```markdown
# 文档审阅与修改要求 (来自批注)

本文档共包含 **3** 条审阅修改意见：

### 批注 1
- **原文位置**：`AI 团队、智能体协作。`
- **修改批注**：此处缺少具体产品案例支撑，补充 2026 最新行业实践。

### 批注 2
- **原文位置**：`边际成本归零`
- **修改批注**：措辞过于绝对，改为“推理边际成本大幅下降”。

请严格根据上述批注修改对应文件并保存，保持其他无关内容不变。
```

---

## 📄 开源许可

本项目基于 [MIT License](./LICENSE) 开源。欢迎提 Issue 与 PR 共同打磨！
