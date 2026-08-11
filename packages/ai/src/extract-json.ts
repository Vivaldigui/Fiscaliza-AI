/**
 * Extracts a JSON payload from a model's raw text output. Providers that only
 * instruct the model to emit JSON (via prompt) can receive a bare JSON object
 * or one wrapped in a markdown code fence; both forms are normalized here
 * before `JSON.parse` is attempted. Parsing and schema validation happen in the
 * caller so the repair/retry path always receives the original pre-validation
 * text.
 */
export function extractJson(value: string): string {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1]?.trim() ?? trimmed;
}
