import { App, MarkdownView, TFile, type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";

export type Target = {
  file: TFile; path: string; view?: MarkdownView; editor?: Editor; cm?: EditorView;
  snapshot: string | Promise<string | null>; from?: number; to?: number;
  before?: string; after?: string;
};
export const prose = (text: string) => text.replace(/\{>>[\s\S]*?<<\}/g, "")
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/<[^>]*>/g, "").replace(/[^\p{L}\p{N}]/gu, "");
export const markupPattern = () => /\{==([\s\S]*?)==\}\{>>([\s\S]*?)<<\}/g;
export const hasMarkers = (text: string) => /\{==|==\}|\{>>|<<\}/.test(text);

export function resolveActiveContext(app: App) {
  const view = app.workspace.getActiveViewOfType(MarkdownView);
  return { view, file: view?.file, editor: view?.getMode() === "source" ? view.editor : undefined };
}
function owningView(app: App, node: Node): MarkdownView | undefined {
  return app.workspace.getLeavesOfType("markdown").map(l => l.view)
    .find((v): v is MarkdownView => v instanceof MarkdownView && v.contentEl.contains(node));
}
function visibleText(range: Range) {
  const fragment = range.cloneContents();
  fragment.querySelectorAll(".cm-critic-badge, script, style, [aria-hidden=true]").forEach(e => e.remove());
  return prose(fragment.textContent || "");
}
export function captureAddition(app: App): { text: string; target: Target } | null {
  const selection = window.getSelection();
  const range = selection && !selection.isCollapsed && selection.rangeCount ? selection.getRangeAt(0) : null;
  const view = range ? owningView(app, range.startContainer) : resolveActiveContext(app).view;
  if (!view?.file || (range && !view.contentEl.contains(range.endContainer))) return null;
  const file = view.file;
  if (view.getMode() === "source") {
    const editor = view.editor, raw = editor.getSelection(), text = raw.trim();
    if (!text) return null;
    const from = editor.posToOffset(editor.getCursor("from")) + raw.indexOf(text);
    return { text, target: { file, path: file.path, view, editor, snapshot: editor.getValue(), from, to: from + text.length } };
  }
  if (!range) return null;
  const parent = range.startContainer.parentElement;
  if (parent?.closest("pre, code, input, textarea, .cm-critic-badge, .criticflow-modal-overlay")) return null;
  const text = selection!.toString().trim();
  const root = parent?.closest(".markdown-preview-view") || view.contentEl;
  if (!text || !root.contains(range.endContainer)) return null;
  const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange(); after.selectNodeContents(root); after.setStart(range.endContainer, range.endOffset);
  return { text, target: { file, path: file.path, view, snapshot: app.vault.read(file).catch(() => null),
    before: visibleText(before).slice(-96), after: visibleText(after).slice(0, 96) } };
}
export function targetForWidget(app: App, cm: EditorView, badge: HTMLElement): Target | null {
  const view = owningView(app, cm.dom);
  if (!view?.file) return null;
  const snapshot = cm.state.doc.toString(), pos = cm.posAtDOM(badge);
  const match = [...snapshot.matchAll(markupPattern())].find(m => pos >= m.index! && pos < m.index! + m[0].length);
  if (!match) return null;
  return { file: view.file, path: view.file.path, view, cm, snapshot, from: match.index!, to: match.index! + match[0].length };
}
function locate(snapshot: string, expected: string, target: Target) {
  if (target.from !== undefined && target.to !== undefined) {
    if (snapshot.slice(target.from, target.to) !== expected) throw new Error("批注位置或原文已变化，请重新打开批注");
    if (!hasMarkers(expected) && [...snapshot.matchAll(markupPattern())].some(m => target.from! < m.index! + m[0].length && target.to! > m.index!))
      throw new Error("选区位于已有批注中，请点击气泡编辑");
    return { from: target.from, to: target.to };
  }
  const occupied = [...snapshot.matchAll(markupPattern())].map(m => [m.index!, m.index! + m[0].length]);
  const candidates: number[] = [];
  for (let at = snapshot.indexOf(expected); at >= 0; at = snapshot.indexOf(expected, at + 1)) {
    if (occupied.some(([from, to]) => at < to && at + expected.length > from)) continue;
    const before = (target.before || "").slice(-48), after = (target.after || "").slice(0, 48);
    if ((!before || prose(snapshot.slice(0, at)).endsWith(before)) &&
        (!after || prose(snapshot.slice(at + expected.length)).startsWith(after))) candidates.push(at);
  }
  if (candidates.length !== 1) throw new Error("选区与源文件无法唯一对应，未写入；请在编辑模式批注");
  return { from: candidates[0], to: candidates[0] + expected.length };
}
export async function replaceTarget(app: App, target: Target, expected: string, replacement: string) {
  const snapshot = await target.snapshot;
  if (snapshot === null || target.file.path !== target.path) throw new Error("原文件已移动或读取失败，未写入");
  const { from, to } = locate(snapshot, expected, target);
  if (target.cm || target.editor) {
    if (target.view?.file !== target.file || target.view.getMode() !== "source") throw new Error("原编辑器已切换，未写入");
    if (target.cm) {
      if (!target.cm.dom.isConnected || target.cm.state.doc.toString() !== snapshot) throw new Error("文档已变化，请重新打开批注");
      target.cm.dispatch({ changes: { from, to, insert: replacement } });
    } else {
      const editor = target.editor!;
      if (editor !== target.view.editor || editor.getValue() !== snapshot) throw new Error("文档已变化，请重新划选");
      editor.replaceRange(replacement, editor.offsetToPos(from), editor.offsetToPos(to));
    }
    return "editor" as const; // Obsidian owns autosave; do not claim a verified disk flush.
  }
  for (const leaf of app.workspace.getLeavesOfType("markdown")) {
    const view = leaf.view;
    if (view instanceof MarkdownView && view.file === target.file && view.getMode() === "source" && view.editor.getValue() !== snapshot)
      throw new Error("该文件有未同步的编辑内容，未覆盖");
  }
  await app.vault.process(target.file, current => {
    if (current !== snapshot) throw new Error("文件已变化，未覆盖；请重新打开批注");
    return current.slice(0, from) + replacement + current.slice(to);
  });
  return "file" as const;
}
