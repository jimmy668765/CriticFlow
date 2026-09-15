import { App, MarkdownView, TFile, type Editor } from "obsidian";
import type { EditorView } from "@codemirror/view";
import { sourceProjection } from "./source-projection";

export type Target = {
  file: TFile; path: string; view?: MarkdownView; editor?: Editor; cm?: EditorView;
  snapshot: string | Promise<string | null>; from?: number; to?: number;
  before?: string; after?: string;
  bounds?: { from: number; to: number }; occurrence?: number; total?: number;
};
type ReadingSection = { path: string; snapshot: string; bounds: { from: number; to: number } | null };
const readingSections = new WeakMap<Element, ReadingSection>();
export function bindReadingSection(element: Element, section: ReadingSection) { readingSections.set(element, section); }
function sectionFor(node: Node): { element: Element; section: ReadingSection } | undefined {
  for (let el = node.nodeType === 1 ? node as Element : node.parentElement; el; el = el.parentElement) {
    const section = readingSections.get(el);
    if (section) return { element: el, section };
  }
}
function offsets(text: string, needle: string) {
  const result: number[] = [];
  if (needle) for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + 1)) result.push(at);
  return result;
}
export const prose = (text: string) => text.replace(/\{>>[\s\S]*?<<\}/g, "")
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, "$2")
  .replace(/<\/?[a-z][^>]*>/gi, "").replace(/[^\p{L}\p{N}]/gu, "");
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
  if (parent?.closest("pre, code, input, textarea, .cm-critic-badge, .criticflow-modal-overlay, .criticflow-reading-mark, .internal-embed, .markdown-embed, .inline-title, .metadata-container")) return null;
  const text = selection!.toString().trim();
  const startSection = sectionFor(range.startContainer), endSection = sectionFor(range.endContainer);
  if ([startSection, endSection].some(s => s && s.section.path !== file.path)) return null;
  const scoped = startSection && startSection.element.contains(range.endContainer) ? startSection : undefined;
  // Anchor to the rendered source section, not the preview title, properties or virtualized page.
  const root = scoped?.element || parent?.closest(".markdown-preview-view") || view.contentEl;
  if (!text || !root.contains(range.endContainer)) return null;
  const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange(); after.selectNodeContents(root); after.setStart(range.endContainer, range.endOffset);
  const prefix = visibleText(before), suffix = visibleText(after), needle = prose(text);
  const all = offsets(prefix + needle + suffix, needle), occurrence = all.indexOf(prefix.length);
  return { text, target: { file, path: file.path, view,
    snapshot: scoped?.section.snapshot ?? app.vault.read(file).catch(() => null),
    bounds: scoped?.section.bounds ?? undefined,
    occurrence: scoped && occurrence >= 0 ? occurrence : undefined, total: scoped ? all.length : undefined,
    before: prefix.slice(-96), after: suffix.slice(0, 96) } };
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
  const bounds = target.bounds || { from: 0, to: snapshot.length };
  const valid = (c: { from: number; to: number }) => c.from >= bounds.from && c.to <= bounds.to &&
    !occupied.some(([from, to]) => c.from < to && c.to > from) && !hasMarkers(snapshot.slice(c.from, c.to));
  const choose = (candidates: { from: number; to: number }[]) => {
    // A unique source match does not need page chrome or virtualized neighbours to match.
    if (candidates.length === 1) return candidates[0];
    const before = (target.before || "").slice(-48), after = (target.after || "").slice(0, 48);
    const anchored = candidates.filter(c => (!before || prose(snapshot.slice(bounds.from, c.from)).endsWith(before)) &&
      (!after || prose(snapshot.slice(c.to, bounds.to)).startsWith(after)));
    if (anchored.length === 1) return anchored[0];
    if (target.bounds && target.total === candidates.length && target.occurrence !== undefined)
      return candidates[target.occurrence];
    return undefined;
  };
  const exact = offsets(snapshot.slice(bounds.from, bounds.to), expected)
    .map(at => ({ from: at + bounds.from, to: at + bounds.from + expected.length })).filter(valid);
  // Reading View removes formatting and may collapse soft line breaks. Locate its
  // visible prose, then retain the exact original Markdown bytes inside the wrapper.
  const projection = sourceProjection(snapshot.slice(bounds.from, bounds.to)), needle = prose(expected);
  const leading = expected.match(/^[^\p{L}\p{N}]*/u)?.[0] || "";
  const trailing = expected.match(/[^\p{L}\p{N}]*$/u)?.[0] || "";
  const projected = offsets(projection.text, needle).map(at => {
    let from = bounds.from + projection.from[at], to = bounds.from + projection.to[at + needle.length - 1];
    if (leading && snapshot.slice(from - leading.length, from) === leading) from -= leading.length;
    if (trailing && snapshot.slice(to, to + trailing.length) === trailing) to += trailing.length;
    const expanded = projection.expand(from - bounds.from, to - bounds.from);
    return { from: bounds.from + expanded.from, to: bounds.from + expanded.to };
  }).filter(valid);
  // Count formatted and unformatted occurrences together before using an ordinal.
  // A lone literal match must not win over the actually selected formatted occurrence.
  const candidates = projected.length ? projected.map(c => exact.find(e => e.from <= c.from && e.to >= c.to) || c) : exact;
  const resolved = choose(candidates);
  if (resolved) return resolved;
  throw new Error("当前渲染选区无法对应原文件中的唯一位置，未写入；请重新划选以刷新位置");
}
export async function replaceTarget(app: App, target: Target, expected: string, replacement: string | ((original: string) => string)) {
  const snapshot = await target.snapshot;
  if (snapshot === null || target.file.path !== target.path) throw new Error("原文件已移动或读取失败，未写入");
  const { from, to } = locate(snapshot, expected, target);
  const inserted = typeof replacement === "function" ? replacement(snapshot.slice(from, to)) : replacement;
  if (target.cm || target.editor) {
    if (target.view?.file !== target.file || target.view.getMode() !== "source") throw new Error("原编辑器已切换，未写入");
    if (target.cm) {
      if (!target.cm.dom.isConnected || target.cm.state.doc.toString() !== snapshot) throw new Error("文档已变化，请重新打开批注");
      target.cm.dispatch({ changes: { from, to, insert: inserted } });
    } else {
      const editor = target.editor!;
      if (editor !== target.view.editor || editor.getValue() !== snapshot) throw new Error("文档已变化，请重新划选");
      editor.replaceRange(inserted, editor.offsetToPos(from), editor.offsetToPos(to));
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
    return current.slice(0, from) + inserted + current.slice(to);
  });
  return "file" as const;
}
