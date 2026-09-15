export type DocumentContext = { filePath: string; workspaceId: string };

/** Read identity, never infer it from displayed text, filenames, or another pane. */
export function captureDocumentContext(source: HTMLElement | null, pathname: string): DocumentContext | null {
  if (!source) return null;
  const persisted = source.closest<HTMLElement>("[data-critic-file][data-critic-workspace]");
  if (persisted) return {
    filePath: persisted.dataset.criticFile!, workspaceId: persisted.dataset.criticWorkspace!,
  };
  const deck = source.closest<HTMLElement>('[data-testid^="workspace-deck-entry-"]');
  const deckId = deck?.getAttribute("data-testid") || "";
  // Prefer the selection's retained workspace, not the currently navigated route.
  const workspaceId = deck
    ? deckId.match(/:(wks_[^:]+)$/)?.[1]
    : pathname.match(/\/workspace\/(wks_[^/]+)/)?.[1];
  if (!workspaceId) return null;

  const explicit = source.closest<HTMLElement>("[data-file-path], [data-filepath]");
  const explicitPath = explicit?.getAttribute("data-file-path") || explicit?.getAttribute("data-filepath");
  if (explicitPath && /\.(md|markdown)$/i.test(explicitPath)) return { filePath: explicitPath, workspaceId };

  // Do not bind chat text or one split pane to a document open in a different pane.
  if (!source.closest('[data-testid="workspace-file-pane"]')) return null;
  const pane = source.closest<HTMLElement>('[data-testid^="workspace-pane-"]');
  const scope = pane || deck;
  if (!scope) return null;
  const tabs = Array.from(scope.querySelectorAll<HTMLElement>(
    '[data-testid^="workspace-tab-file_"][aria-selected="true"]',
  ));
  if (tabs.length !== 1) return null;
  const filePath = tabs[0].getAttribute("data-testid")!.slice("workspace-tab-file_".length);
  return /\.(md|markdown)$/i.test(filePath) ? { filePath, workspaceId } : null;
}
