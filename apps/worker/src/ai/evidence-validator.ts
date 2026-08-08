/**
 * Normalizes whitespace/line breaks the same way for both the stored page
 * text and the model's excerpt, so a harmless reflow does not cause a real
 * excerpt to be rejected as invented.
 */
export function normalizeForMatch(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Returns true only when the excerpt text actually occurs in the page's
 * effective text. An empty/undefined excerpt is allowed (e.g. a visual
 * reference) and is not itself proof of anything; callers decide whether an
 * excerpt is required for the evidence's status.
 */
export function excerptExistsOnPage(excerpt: string | undefined, pageText: string): boolean {
  if (!excerpt) return true;
  const normalizedExcerpt = normalizeForMatch(excerpt);
  if (!normalizedExcerpt) return true;
  return normalizeForMatch(pageText).includes(normalizedExcerpt);
}
