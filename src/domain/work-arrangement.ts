import type { RemoteType } from './job.js';

const ONSITE_EVIDENCE: readonly RegExp[] = [
  /(?:this\s+is\s+)?on[- ]?site\s+(?:role|position|job|opportunity)/i,
  /\bon[- ]?site\b/i,
  /\bin[- ]?person\s+(?:role|position|work)/i,
  /not\s+a\s+remote\s+(?:role|position|job|opportunity)/i,
  /not\s+(?:authorized|permitted|allowed)\s+to\s+work\s+remotely/i,
  /no\s+remote\s+(?:work|option|positions?)/i,
  /must\s+(?:live|reside|be\s+located)\s+within\s+(?:commuting\s+)?distance/i,
  /must\s+report\s+to\s+(?:the\s+)?(?:office|worksite|work\s+site|facility|onsite\s+location)/i,
  /requires?\s+onsite\s+(?:presence|attendance|work)\b/i,
  /onsite\s+presence\s+is\s+required\b/i,
  /work\s+from\s+our\s+office/i,
  /local\s+candidates?\s+only/i,
  /commutable\s+distance/i,
  /relocation\s+(?:assistance\s+)?is\s+not\s+available/i,
];

// Explicit statements that remote/telework availability is denied. These are
// matched clause-locally (no `.`, `;`, or newline may separate the term from
// its denial predicate) so an inserted qualifier such as "currently" or
// "at this time" cannot defeat the rule, and a denial in an unrelated clause
// cannot taint a positive remote statement elsewhere in the text.
const REMOTE_DENIAL_EVIDENCE: readonly RegExp[] = [
  /(?:telework(?:ing)?|remote\s+work|remote\s+positions?|remote\s+roles?|remote\s+opportunities?|telecommuting|telecommute|work\s+from\s+home|working\s+from\s+home|remote\s+option)\b[^.\n;]{0,80}?\b(?:not\s+(?:authorized|available|permitted|allowed|offered|eligible|provided|supported|possible)|unavailable|not\s+an\s+option)\b/i,
  /\b(?:not\s+(?:eligible|authorized|permitted|allowed)\s+for|does\s+not\s+(?:offer|provide|support|allow|permit|authorize)|do\s+not\s+(?:offer|provide|support|allow|permit|authorize))\s+(?:remote\s+work|remote\s+positions?|telework(?:ing)?|telecommuting|work\s+from\s+home)\b/i,
  /\bno\s+(?:remote\s+work|remote\s+positions?|telework(?:ing)?|telecommuting)\b/i,
];

const HYBRID_EVIDENCE: readonly RegExp[] = [
  /\bhybrid\b/i,
  /three\s+days?\s+(?:per\s+week|a\s+week|in\s+the\s+office)/i,
  /two\s+days?\s+(?:per\s+week|a\s+week|in\s+the\s+office)/i,
  /mix\s+of\s+(?:in[- ]?office|on[- ]?site)\s+and\s+remote/i,
  /split\s+(?:week|time)\s+between/i,
  /flexible\s+(?:remote|work\s+from\s+home)\s+(?:policy|arrangement)/i,
  /some\s+(?:days?\s+)?in\s+(?:the\s+)?office/i,
];

const REMOTE_EVIDENCE: readonly RegExp[] = [
  /(?:fully|completely|100%|totally)\s+remote\b/i,
  /\bremote\s+(?:role|position|job|opportunity|work|first|only)\b/i,
  /work\s+(?:from\s+)?home/i,
  /telecommute/i,
  /anywhere\s+in\s+(?:the\s+)?(?:us|united\s+states)/i,
  /nationwide\s+remote/i,
  /fully\s+distributed/i,
  /eligible\s+for\s+(?:remote\s+work|telework|telecommuting|remote\s+positions?)/i,
  /(?:may|can|will)\s+work\s+remotely\b/i,
  /\btelework(?:ing)?\s+(?:is\s+)?(?:available|permitted|allowed|offered|authorized)\b/i,
  /\btelecommuting\s+(?:is\s+)?(?:available|permitted|allowed|offered)\b/i,
  /\btelework(?:ing)?[\s-]?eligible\b/i,
];

const TECHNICAL_REMOTE_LANGUAGE: readonly RegExp[] = [
  /\bremote\s+(?:support|access|systems|monitoring|administration|troubleshooting|desktop|server|network|maintenance|diagnostics|infrastructure)\b/i,
  /\bon[- ]?premises\s+and\s+remote\s+infrastructure\b/i,
];

export interface WorkArrangementClassification {
  arrangement: RemoteType;
  evidence: string[];
  /** True when the text explicitly denies that remote/telework is available. */
  remoteDenied: boolean;
}

export function classifyWorkArrangement(
  text: string,
): WorkArrangementClassification {
  const onsite = matches(text, ONSITE_EVIDENCE);
  const denial = matches(text, REMOTE_DENIAL_EVIDENCE);
  const hybrid = matches(text, HYBRID_EVIDENCE);
  const remote = matches(text, REMOTE_EVIDENCE);
  const technicalRemote = matches(text, TECHNICAL_REMOTE_LANGUAGE);

  if (onsite.length > 0) {
    return { arrangement: 'onsite', evidence: onsite, remoteDenied: false };
  }
  if (denial.length > 0) {
    return {
      arrangement: 'onsite',
      evidence: denial.map(
        (indicator) => `${indicator} (remote/telework not authorized)`,
      ),
      remoteDenied: true,
    };
  }
  if (hybrid.length > 0) {
    return { arrangement: 'hybrid', evidence: hybrid, remoteDenied: false };
  }
  if (remote.length > 0 && technicalRemote.length === 0) {
    return { arrangement: 'remote', evidence: remote, remoteDenied: false };
  }
  if (technicalRemote.length > 0) {
    return {
      arrangement: 'unknown',
      evidence: technicalRemote.map(
        (indicator) =>
          `${indicator} (technical terminology, not work arrangement)`,
      ),
      remoteDenied: false,
    };
  }
  return { arrangement: 'unknown', evidence: [], remoteDenied: false };
}

function matches(text: string, patterns: readonly RegExp[]): string[] {
  return patterns
    .map((pattern) => pattern.exec(text)?.[0])
    .filter((match): match is string => match !== undefined);
}
