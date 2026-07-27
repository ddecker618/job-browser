import { z } from 'zod';

import { JOB_STATUSES } from '../domain/job-status.js';
import { JOB_SEARCH_SORT_FIELDS } from '../models/job-search.js';

const trimmed = z.string().trim().min(1).max(200);
const identifier = z.string().trim().min(1).max(200);
const queryNumber = z.preprocess(
  (value) =>
    typeof value === 'string' && value !== '' ? Number(value) : value,
  z.number(),
);
const queryInteger = (minimum: number, maximum: number, fallback: number) =>
  z.preprocess(
    (value) =>
      value === undefined
        ? fallback
        : typeof value === 'string' && value !== ''
          ? Number(value)
          : value,
    z.number().int().min(minimum).max(maximum),
  );
const queryBoolean = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');
const dateTime = z
  .string()
  .trim()
  .max(40)
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value) &&
      !Number.isNaN(Date.parse(value)),
    'Expected an ISO date or UTC timestamp',
  );

export const jobSearchQuerySchema = z
  .strictObject({
    q: trimmed.optional(),
    title: trimmed.optional(),
    company: identifier.optional(),
    location: identifier.optional(),
    remoteType: z.enum(['onsite', 'hybrid', 'remote', 'unknown']).optional(),
    provider: identifier.optional(),
    sourceId: identifier.optional(),
    minScore: queryNumber.pipe(z.number().min(0).max(100)).optional(),
    maxScore: queryNumber.pipe(z.number().min(0).max(100)).optional(),
    minSalary: queryNumber.pipe(z.number().min(0)).optional(),
    recommendation: identifier.optional(),
    status: z.enum(JOB_STATUSES).optional(),
    firstDiscoveredFrom: dateTime.optional(),
    firstDiscoveredTo: dateTime.optional(),
    lastVerifiedFrom: dateTime.optional(),
    lastVerifiedTo: dateTime.optional(),
    newlyDiscovered: queryBoolean.optional(),
    materiallyUpdated: queryBoolean.optional(),
    closingSoon: queryBoolean.optional(),
    active: z.enum(['active', 'removed']).optional(),
    multipleSource: queryBoolean.optional(),
    page: queryInteger(1, 1_000_000, 1),
    pageSize: queryInteger(1, 100, 25),
    sort: z.enum(JOB_SEARCH_SORT_FIELDS).default('score'),
    direction: z.enum(['asc', 'desc']).default('desc'),
  })
  .superRefine((query, context) => {
    if (
      query.minScore !== undefined &&
      query.maxScore !== undefined &&
      query.minScore > query.maxScore
    ) {
      context.addIssue({
        code: 'custom',
        path: ['minScore'],
        message: 'minScore must not exceed maxScore',
      });
    }
    for (const [from, to] of [
      [query.firstDiscoveredFrom, query.firstDiscoveredTo],
      [query.lastVerifiedFrom, query.lastVerifiedTo],
    ]) {
      if (from !== undefined && to !== undefined && from > to) {
        context.addIssue({
          code: 'custom',
          message: 'Date range start must not exceed its end',
        });
      }
    }
  });

export type ParsedJobSearchQuery = z.infer<typeof jobSearchQuerySchema>;
