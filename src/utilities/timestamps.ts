export function nowUtc(): string {
  return new Date().toISOString();
}

export function assertUtcTimestamp(value: string, name: string): void {
  if (!value.endsWith('Z') || Number.isNaN(Date.parse(value))) {
    throw new Error(`${name} must be a valid ISO 8601 UTC timestamp`);
  }
}
