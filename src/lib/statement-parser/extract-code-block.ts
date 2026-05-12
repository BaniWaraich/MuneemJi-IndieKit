/**
 * Strip markdown code fences from an LLM response and return the inner text.
 * Handles:
 *   - No fences at all
 *   - Single fence pair: ```lang\n...\n```
 *   - Missing closing fence (accepts content after opening fence to end-of-string)
 *   - Multiple fence pairs (returns the content of the first fenced block)
 *   - Leading/trailing whitespace around fences
 */
export function extractCodeBlock(raw: string): string {
  const trimmed = raw.trim();
  const fenceOpen = trimmed.indexOf('```');
  if (fenceOpen === -1) return trimmed;

  const afterOpen = trimmed.indexOf('\n', fenceOpen);
  if (afterOpen === -1) return trimmed.slice(fenceOpen + 3).trim();

  const body = trimmed.slice(afterOpen + 1);
  const fenceClose = body.indexOf('```');
  if (fenceClose === -1) return body.trim();
  return body.slice(0, fenceClose).trim();
}
