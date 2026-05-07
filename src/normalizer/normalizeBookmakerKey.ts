export function normalizeBookmakerKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function normalizeBookmakerList(values: readonly string[]): string[] {
  const normalized = values.map(normalizeBookmakerKey).filter((value) => value.length > 0);
  return Array.from(new Set(normalized)).sort();
}
