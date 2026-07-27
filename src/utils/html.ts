const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&apos;': "'",
  '&gt;': '>',
  '&lt;': '<',
  '&nbsp;': ' ',
  '&quot;': '"',
};

export function htmlToText(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(
      /&(amp|apos|gt|lt|nbsp|quot);/g,
      (entity) => ENTITIES[entity] ?? entity,
    )
    .replace(/\s+/g, ' ')
    .trim();
}
