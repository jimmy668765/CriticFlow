import { occurrences, prose, type TextAnchor } from "../shared/text-anchor.ts";

/** Snapshot the actual range before opening a dialog changes browser selection. */
export function captureTextAnchor(range: Range, originalText: string): TextAnchor | undefined {
  const element = range.startContainer.nodeType === 1
    ? range.startContainer as HTMLElement : range.startContainer.parentElement;
  const root = element?.closest('[data-testid="workspace-file-pane"]');
  if (!root || !root.contains(range.endContainer)) return undefined;
  const clean = (r: Range) => {
    const fragment = r.cloneContents();
    fragment.querySelectorAll('.paseo-critic-badge, script, style, [aria-hidden="true"]').forEach(el => el.remove());
    return (fragment.textContent || "").replace(/\{>>[\s\S]*?<<\}/g, "");
  };
  const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  const after = range.cloneRange(); after.selectNodeContents(root); after.setStart(range.endContainer, range.endOffset);
  const left = clean(before), right = clean(after);
  return {
    before: prose(left).slice(-96), after: prose(right).slice(0, 96),
    occurrence: occurrences(left, originalText).length,
    total: occurrences(left + originalText + right, originalText).length,
  };
}

export function captureMarkAnchor(mark: HTMLElement, text: string): TextAnchor | undefined {
  const range = mark.ownerDocument.createRange();
  range.selectNode(mark);
  return captureTextAnchor(range, text);
}
