export type NavigationDecision =
  | { action: 'allow' }
  | { action: 'external'; url: string }
  | { action: 'deny' };

export function classifyNavigation(
  target: string,
  applicationOrigin: string,
): NavigationDecision {
  try {
    const url = new URL(target);
    if (url.origin === applicationOrigin) return { action: 'allow' };
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      return { action: 'external', url: url.toString() };
    }
    return { action: 'deny' };
  } catch {
    return { action: 'deny' };
  }
}
