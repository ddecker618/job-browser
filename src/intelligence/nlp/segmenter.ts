import { normalizeText } from '../../utilities/normalization.js';
import type {
  NlpEvidenceSource,
  NlpSegment,
  NlpSegmentKind,
} from '../../schemas/job-nlp.js';

// ---------------------------------------------------------------------------
// Stage 2 - sentence / segment intelligence.
//
// Robust segmentation of job-description prose (sentences, bullet lists,
// HTML-derived text, headings, fragments, colon-delimited requirements,
// semicolon lists, malformed provider formatting).
//
// Spans are relative to a POSITION-PRESERVING cleaned view of the source
// field: HTML tags are blanked to whitespace (block tags to newlines) and
// common HTML entities are unescaped with equal-length padding, so every
// cleaned character position maps 1:1 to the original field text. Evidence
// text is always the verbatim original slice at [charStart, charEnd).
// ---------------------------------------------------------------------------

export interface RoleDescriptionParts {
  title: string;
  location: string | null;
  description: string | null;
  requirements: string | null;
  preferredQualifications: string | null;
}

const BLOCK_TAG_PATTERN =
  /<\s*\/(?:p|li|ul|ol|div|h[1-6]|section|tr|br|table|blockquote)\s*>|<\s*(?:br|li)\s*\/?\s*>/gi;

const ANY_TAG_PATTERN = /<[^>]*>/g;

const HTML_ENTITIES: readonly { entity: string; value: string }[] = [
  { entity: '&nbsp;', value: ' ' },
  { entity: '&amp;', value: '&' },
  { entity: '&lt;', value: '<' },
  { entity: '&gt;', value: '>' },
  { entity: '&quot;', value: '"' },
  { entity: '&#39;', value: "'" },
  { entity: '&apos;', value: "'" },
];

const BULLET_START_PATTERN = /^\s*(?:[-*•▪◦]|\d{1,2}[.)])\s+/;

const ORDERED_BULLET_START_PATTERN = /^\s*\d{1,2}[.)]\s+/;

const PROSE_PUNCTUATION_PATTERN = /[.?!;,]/;

const HEADING_PATTERNS: readonly RegExp[] = [
  /^(?:required|minimum)\s+(?:qualifications?|requirements?|skills?)/i,
  /^(?:preferred|desired|nice[- ]to[- ]have|bonus)\s+(?:qualifications?|requirements?|skills?|experience)/i,
  /^(?:essential|core)\s+(?:qualifications?|requirements?|skills?)/i,
  /^(?:job|role|position)\s+(?:summary|description|overview)/i,
  /^(?:responsibilities?|what\s+(?:you'?ll|you\s+will)\s+(?:do|be\s+doing))/i,
  /^(?:education|experience|skills?|certifications?\b|compensation|benefits?|perks?)\b/i,
  /^(?:about\b|who\s+we\s+are\b|company\s+overview\b)/i,
  /^(?:location\b|work\s+(?:arrangement|schedule)\b|remote\b|travel\b|schedule\b)/i,
];

interface Span {
  start: number;
  end: number;
}

interface Boundary {
  position: number;
  kind: Exclude<NlpSegmentKind, 'heading' | 'unknown'>;
}

const SENTENCE_END_PATTERN = /[.!?]/g;

const SENTENCE_CONTINUATION_PATTERN = /^\s+[('"`“]?[A-Z0-9"'“]/;

const ABBREVIATIONS = new Set([
  'u.s',
  'u.s.a',
  'a.m',
  'p.m',
  'e.g',
  'i.e',
  'etc',
  'ph.d',
  'dr',
  'mr',
  'mrs',
  'ms',
  'st',
  'no',
  'inc',
  'ltd',
  'jr',
  'sr',
  'm.s',
  'b.s',
  'b.a',
]);

export function cleanForSegmentation(text: string): string {
  let cleaned = text;
  cleaned = cleaned.replace(
    BLOCK_TAG_PATTERN,
    (match) => `\n${' '.repeat(Math.max(0, match.length - 1))}`,
  );
  cleaned = cleaned.replace(ANY_TAG_PATTERN, (match) =>
    ' '.repeat(match.length),
  );
  for (const { entity, value } of HTML_ENTITIES) {
    cleaned = cleaned.replace(
      new RegExp(entity, 'g'),
      (match) => value + ' '.repeat(Math.max(0, match.length - value.length)),
    );
  }
  return cleaned;
}

export function segmentRoleDescription(
  parts: RoleDescriptionParts,
): NlpSegment[] {
  const segments: NlpSegment[] = [];

  const title = parts.title.trim();
  if (title.length > 0) {
    segments.push(
      makeSegment(
        parts.title,
        'title',
        'heading',
        parts.title.indexOf(title),
        parts.title.indexOf(title) + title.length,
        segments.length,
      ),
    );
  }

  for (const field of [
    'location',
    'description',
    'requirements',
    'preferredQualifications',
  ] as const) {
    const value = parts[field];
    if (value === null || value.trim().length === 0) continue;
    segments.push(...segmentField(value, field, segments.length));
  }

  return segments;
}

export function cleanedRoleDescription(parts: RoleDescriptionParts): string {
  const pieces: string[] = [parts.title];
  for (const field of [
    'location',
    'description',
    'requirements',
    'preferredQualifications',
  ] as const) {
    const value = parts[field];
    if (value !== null) pieces.push(value);
  }
  return cleanForSegmentation(pieces.join('\n\n'));
}

function segmentField(
  text: string,
  sourceField: NlpEvidenceSource,
  firstIndex: number,
): NlpSegment[] {
  const view = cleanForSegmentation(text);
  const items = extractItems(view);
  const segments: NlpSegment[] = [];
  let index = firstIndex;

  for (const item of items) {
    if (item.kind === 'heading') {
      const inner = trimSpan(view, item.start, item.end);
      if (inner.end > inner.start) {
        segments.push(
          makeSegment(
            view,
            sourceField,
            'heading',
            inner.start,
            inner.end,
            index,
          ),
        );
        index += 1;
      }
      continue;
    }

    const boundaries = fragmentBoundaries(view, item.start, item.end);
    let cursor = item.start;
    for (const boundary of boundaries) {
      const inner = trimSpan(view, cursor, boundary.position);
      if (inner.end > inner.start) {
        segments.push(
          makeSegment(
            view,
            sourceField,
            boundary.kind,
            inner.start,
            inner.end,
            index,
          ),
        );
        index += 1;
      }
      cursor = boundary.position;
    }
    const tail = trimSpan(view, cursor, item.end);
    if (tail.end > tail.start) {
      segments.push(
        makeSegment(view, sourceField, item.kind, tail.start, tail.end, index),
      );
      index += 1;
    }
  }

  return segments;
}

function extractItems(
  view: string,
): { start: number; end: number; kind: NlpSegmentKind }[] {
  const lines = splitLines(view);
  const items: { start: number; end: number; kind: NlpSegmentKind }[] = [];
  let current: { start: number; end: number; kind: NlpSegmentKind } | null =
    null;

  const flush = () => {
    if (current !== null) {
      items.push(current);
      current = null;
    }
  };

  for (const line of lines) {
    const trimmed = line.text.trim();
    if (trimmed.length === 0) {
      flush();
      continue;
    }
    if (isHeading(trimmed)) {
      flush();
      items.push({ start: line.start, end: line.end, kind: 'heading' });
      continue;
    }
    if (BULLET_START_PATTERN.test(trimmed)) {
      flush();
      current = {
        start: line.start,
        end: line.end,
        kind: ORDERED_BULLET_START_PATTERN.test(trimmed)
          ? 'list-item'
          : 'bullet',
      };
    } else if (current === null) {
      current = { start: line.start, end: line.end, kind: 'sentence' };
    } else {
      current.end = line.end;
    }
  }
  flush();
  return items;
}

function splitLines(
  view: string,
): { start: number; end: number; text: string }[] {
  const lines: { start: number; end: number; text: string }[] = [];
  let start = 0;
  for (let i = 0; i < view.length; i += 1) {
    if (view[i] === '\n') {
      lines.push({ start, end: i, text: view.slice(start, i) });
      start = i + 1;
    }
  }
  if (start < view.length) {
    lines.push({ start, end: view.length, text: view.slice(start) });
  }
  return lines;
}

function isHeading(trimmed: string): boolean {
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (trimmed.endsWith(':')) return true;
  if (PROSE_PUNCTUATION_PATTERN.test(trimmed)) return false;
  return HEADING_PATTERNS.some((pattern) => {
    const match = pattern.exec(trimmed);
    return match !== null && match[0].length === trimmed.length;
  });
}

function fragmentBoundaries(
  view: string,
  start: number,
  end: number,
): Boundary[] {
  const boundaries: Boundary[] = [];
  const fragmentPositions: number[] = [];

  for (let i = start; i < end; i += 1) {
    const ch = view[i];
    const next = view[i + 1];
    if ((ch === ':' || ch === ';') && next !== undefined && /\s/.test(next)) {
      fragmentPositions.push(i + 1);
    }
  }

  SENTENCE_END_PATTERN.lastIndex = start;
  let match: RegExpExecArray | null;
  while ((match = SENTENCE_END_PATTERN.exec(view)) !== null) {
    const pos = match.index;
    if (pos >= end) break;
    if (pos < start) continue;
    if (!isSentenceBreak(view, pos)) continue;
    if (
      fragmentPositions.some(
        (fragment) => fragment > pos && fragment - pos < 40,
      )
    ) {
      continue;
    }
    boundaries.push({ position: pos + 1, kind: 'sentence' });
  }

  for (const position of fragmentPositions) {
    if (position <= start || position >= end) continue;
    if (!boundaries.some((b) => b.position === position)) {
      boundaries.push({ position, kind: 'fragment' });
    }
  }

  return boundaries.sort((left, right) => left.position - right.position);
}

function isSentenceBreak(view: string, endPosition: number): boolean {
  const remainder = view.slice(endPosition + 1);
  if (!SENTENCE_CONTINUATION_PATTERN.test(remainder)) return false;

  const before = view.slice(0, endPosition + 1).replace(/\.+$/, '');
  const lastToken =
    before
      .split(/[\s,;/:()[\]]+/)
      .filter(Boolean)
      .pop() ?? '';
  if (ABBREVIATIONS.has(lastToken.replace(/[.)]$/g, '').toLowerCase())) {
    return false;
  }
  return true;
}

function makeSegment(
  original: string,
  sourceField: NlpEvidenceSource,
  kind: NlpSegmentKind,
  charStart: number,
  charEnd: number,
  index: number,
): NlpSegment {
  const text = original.slice(charStart, charEnd).trim();
  return {
    index,
    text,
    normalized: normalizeText(text),
    kind,
    sourceField,
    charStart,
    charEnd,
  };
}

function trimSpan(view: string, start: number, end: number): Span {
  let s = start;
  let e = end;
  while (s < e && /\s/.test(view.charAt(s))) s += 1;
  while (e > s && /\s/.test(view.charAt(e - 1))) e -= 1;
  return { start: s, end: e };
}
