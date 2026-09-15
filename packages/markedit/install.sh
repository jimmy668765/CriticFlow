#!/bin/bash
set -e

# Target MarkEdit Scripts Directory
TARGET_DIR="$HOME/Library/Containers/app.cyan.markedit/Data/Documents/scripts"

echo "=== MarkEdit CriticMarkup Annotation 扩展安装程序 ==="

if [ -L "$TARGET_DIR" ]; then
  echo "错误: 目标脚本目录是符号链接，为避免覆盖别处已停止: $TARGET_DIR"
  exit 1
fi

if [ ! -d "$TARGET_DIR" ]; then
  echo "正在创建 MarkEdit 脚本目录: $TARGET_DIR"
  mkdir -p "$TARGET_DIR"
fi

SCRIPT_SOURCE="$(cd "$(dirname "$0")" && pwd)/criticmarkup-annotate.js"
SCRIPT_TARGET="$TARGET_DIR/criticmarkup-annotate.js"
EDITOR_TARGET="$HOME/Library/Containers/app.cyan.markedit/Data/Documents/editor.js"

if [ ! -f "$SCRIPT_SOURCE" ]; then
  echo "错误: 未找到源脚本 $SCRIPT_SOURCE"
  exit 1
fi

if [ -L "$SCRIPT_TARGET" ] || { [ -e "$SCRIPT_TARGET" ] && [ ! -f "$SCRIPT_TARGET" ]; }; then
  echo "错误: 目标脚本不是普通文件，为避免覆盖别处已停止: $SCRIPT_TARGET"
  exit 1
fi

OLD_SCRIPT_EXISTS=0
MATCHING_EDITOR=0
if [ -f "$SCRIPT_TARGET" ]; then
  OLD_SCRIPT_EXISTS=1
fi
if [ -f "$SCRIPT_TARGET" ] && [ ! -L "$EDITOR_TARGET" ] && [ -f "$EDITOR_TARGET" ] && cmp -s "$EDITOR_TARGET" "$SCRIPT_TARGET"; then
  MATCHING_EDITOR=1
fi

if [ -f "$SCRIPT_TARGET" ]; then
  BACKUP_ROOT="$HOME/.criticflow/backups/markedit"
  if [ -L "$BACKUP_ROOT" ]; then
    echo "错误: 备份目录是符号链接，为避免写入别处已停止: $BACKUP_ROOT"
    exit 1
  fi
  mkdir -p "$BACKUP_ROOT"

  BACKUP_DIR="$(mktemp -d "$BACKUP_ROOT/$(date '+%Y%m%d-%H%M%S')-XXXXXX")"

  cp -p "$SCRIPT_TARGET" "$BACKUP_DIR/criticmarkup-annotate.js"
  if [ "$MATCHING_EDITOR" -eq 1 ]; then
    cp -p "$EDITOR_TARGET" "$BACKUP_DIR/editor.js"
  fi
  echo "已备份旧文件到: $BACKUP_DIR"
fi

cp "$SCRIPT_SOURCE" "$SCRIPT_TARGET"

echo "✅ 成功安装到: $SCRIPT_TARGET"

if [ "$MATCHING_EDITOR" -eq 1 ]; then
  if [ -L "$EDITOR_TARGET" ]; then
    echo "⚠️ editor.js 是符号链接，未修改；请手动确认旧批注脚本，勿破坏用户脚本。"
  else
    cp "$SCRIPT_SOURCE" "$EDITOR_TARGET"
    echo "✅ 已同步替换重复的: $EDITOR_TARGET"
  fi
elif [ "$OLD_SCRIPT_EXISTS" -eq 1 ] && [ -f "$EDITOR_TARGET" ]; then
  echo "⚠️ editor.js 与旧 scripts 文件不一致，未修改 editor.js。若旧批注还在 editor.js，请手动清理，勿破坏用户脚本。"
fi
echo ""
echo "快捷键说明："
echo "1. 选中文本按下 【⌘ + Shift + C】：就地弹出批注框，插入 {==选区==}{>>批注<<}"
echo "2. 按下 【⌘ + Shift + E】：一键提取当前文档内所有批注，编译为 Agent 提示词复制到剪贴板！"
echo ""
echo "请重启 MarkEdit 使脚本生效。"
