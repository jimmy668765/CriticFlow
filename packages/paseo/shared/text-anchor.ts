export type TextAnchor = { before: string; after: string; occurrence: number; total: number };

// Compare prose, not Markdown decoration or generated annotation badges.
export function prose(text: string): string {
  return text.replace(/\{>>[\s\S]*?<<\}/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export function occurrences(text: string, needle: string): number[] {
  const found: number[] = [];
  if (!needle) return found;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) found.push(i);
  return found;
}
