#!/bin/bash
set -e

# Target MarkEdit Scripts Directory
TARGET_DIR="$HOME/Library/Containers/app.cyan.markedit/Data/Documents/scripts"

echo "=== MarkEdit CriticMarkup Annotation 扩展安装程序 ==="

if [ ! -d "$TARGET_DIR" ]; then
  echo "正在创建 MarkEdit 脚本目录: $TARGET_DIR"
  mkdir -p "$TARGET_DIR"
fi

SCRIPT_SOURCE="$(cd "$(dirname "$0")" && pwd)/criticmarkup-annotate.js"

if [ ! -f "$SCRIPT_SOURCE" ]; then
  echo "错误: 未找到源脚本 $SCRIPT_SOURCE"
  exit 1
fi

cp "$SCRIPT_SOURCE" "$TARGET_DIR/criticmarkup-annotate.js"

echo "✅ 成功安装到: $TARGET_DIR/criticmarkup-annotate.js"
echo ""
echo "快捷键说明："
echo "1. 选中文本按下 【⌘ + Shift + C】：就地弹出批注框，插入 {==选区==}{>>批注<<}"
echo "2. 按下 【⌘ + Shift + E】：一键提取当前文档内所有批注，编译为 Agent 提示词复制到剪贴板！"
echo ""
echo "请重启 MarkEdit 使脚本生效。"
