const SENSITIVE_KEY =
  /authorization|api[-_]?key|credential|password|secret|token|user[-_]?agent|email|resume|profile|description|requirements|raw/i;

export function sanitizeLogContext(
  context: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context).map(([key, value]) => [
      key,
      SENSITIVE_KEY.test(key) ? '[redacted]' : sanitizeValue(value, 0),
    ]),
  );
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 3) return '[truncated]';
  if (Array.isArray(value))
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === 'object' && value !== null) {
    return sanitizeLogContext(value as Record<string, unknown>);
  }
  if (typeof value === 'string') return value.slice(0, 1000);
  return value;
}
