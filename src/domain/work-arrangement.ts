import type { RemoteType } from './job.js';

const ONSITE_EVIDENCE: readonly RegExp[] = [
  /(?:this\s+is\s+)?on[- ]?site\s+(?:role|position|job|opportunity)/i,
  /\bon[- ]?site\b/i,
  /\bin[- ]?person\s+(?:role|position|work)/i,
  /not\s+a\s+remote\s+(?:role|position|job|opportunity)/i,
  /remote\s+work\s+(?:is\s+)?not\s+(?:authorized|available|permitted|offered)/i,
  /not\s+authorized\s+to\s+work\s+remotely/i,
  /no\s+remote\s+(?:work|option|positions?)/i,
  /must\s+(?:live|reside|be\s+located)\s+within\s+(?:commuting\s+)?distance/i,
  /must\s+report\s+to\s+(?:the\s+)?office/i,
  /work\s+from\s+our\s+office/i,
  /local\s+candidates?\s+only/i,
  /commutable\s+distance/i,
  /relocation\s+(?:assistance\s+)?is\s+not\s+available/i,
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
];

const TECHNICAL_REMOTE_LANGUAGE: readonly RegExp[] = [
  /\bremote\s+(?:support|access|systems|monitoring|administration|troubleshooting|desktop|server|network|maintenance|diagnostics|infrastructure)\b/i,
  /\bon[- ]?premises\s+and\s+remote\s+infrastructure\b/i,
];

export interface WorkArrangementClassification {
  arrangement: RemoteType;
  evidence: string[];
}

export function classifyWorkArrangement(
  text: string,
): WorkArrangementClassification {
  const onsite = matches(text, ONSITE_EVIDENCE);
  const hybrid = matches(text, HYBRID_EVIDENCE);
  const remote = matches(text, REMOTE_EVIDENCE);
  const technicalRemote = matches(text, TECHNICAL_REMOTE_LANGUAGE);

  if (onsite.length > 0) {
    return { arrangement: 'onsite', evidence: onsite };
  }
  if (hybrid.length > 0) {
    return { arrangement: 'hybrid', evidence: hybrid };
  }
  if (remote.length > 0 && technicalRemote.length === 0) {
    return { arrangement: 'remote', evidence: remote };
  }
  if (technicalRemote.length > 0) {
    return {
      arrangement: 'unknown',
      evidence: technicalRemote.map(
        (indicator) =>
          `${indicator} (technical terminology, not work arrangement)`,
      ),
    };
  }
  return { arrangement: 'unknown', evidence: [] };
}

function matches(text: string, patterns: readonly RegExp[]): string[] {
  return patterns
    .map((pattern) => pattern.exec(text)?.[0])
    .filter((match): match is string => match !== undefined);
}
