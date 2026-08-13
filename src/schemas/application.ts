import { z } from 'zod';

import {
  APPLICATION_LIFECYCLE_STATUSES,
  APPLICATION_STATUSES,
  USER_OCCURRENCE_PRECISIONS,
  USER_SELECTABLE_APPLICATION_STATUSES,
} from '../domain/application-status.js';
import { isValidOccurrenceInput } from '../utilities/timestamps.js';

export const APPLICATION_OPAQUE_ID_MAX_LENGTH = 200;
export const APPLICATION_CURSOR_MAX_LENGTH = 4_096;
const CONTEXT_MAX_LENGTH = 500;
const URL_MAX_LENGTH = 2_048;
const EVENT_TEXT_MAX_LENGTH = 4_000;
const SUMMARY_NOTES_MAX_LENGTH = 10_000;

export const applicationOpaqueIdSchema = z
  .string()
  .max(APPLICATION_OPAQUE_ID_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, 'ID cannot be blank');

const occurrenceFields = {
  occurredAt: z.string().trim().min(1).max(80),
  occurrencePrecision: z.enum(USER_OCCURRENCE_PRECISIONS),
} as const;

const optionalContext = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .transform((value) => (value === null || value === '' ? null : value));

const nullableEventText = z
  .string()
  .max(EVENT_TEXT_MAX_LENGTH)
  .nullable()
  .transform((value) =>
    value === null || value.trim().length === 0 ? null : value,
  );

const optionalEventText = nullableEventText.optional();

const noteText = z
  .string()
  .max(EVENT_TEXT_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, 'Note text cannot be blank');

const applicationUrl = z
  .string()
  .trim()
  .max(URL_MAX_LENGTH)
  .nullable()
  .transform((value, context) => {
    if (value === null || value === '') return null;
    if (!/^https?:\/\//i.test(value) || containsUrlWhitespaceOrControl(value)) {
      context.addIssue({
        code: 'custom',
        message: 'Application URL must be an absolute HTTP or HTTPS URL',
      });
      return z.NEVER;
    }
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          message: 'Application URL must use HTTP or HTTPS',
        });
        return z.NEVER;
      }
      return value;
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Application URL must be an absolute HTTP or HTTPS URL',
      });
      return z.NEVER;
    }
  });

const queryLimit = z.preprocess(
  (value) =>
    value === undefined
      ? 25
      : typeof value === 'string' && value !== ''
        ? Number(value)
        : value,
  z.number().int().min(1).max(100),
);

export const applicationListQuerySchema = z.strictObject({
  limit: queryLimit,
  status: z.enum(APPLICATION_STATUSES).optional(),
  company: z.string().trim().min(1).max(CONTEXT_MAX_LENGTH).optional(),
  cursor: z
    .string()
    .trim()
    .min(1)
    .max(APPLICATION_CURSOR_MAX_LENGTH)
    .optional(),
});

export const createApplicationSchema = withOccurrenceValidation(
  z.strictObject({
    eventId: applicationOpaqueIdSchema,
    jobId: applicationOpaqueIdSchema,
    ...occurrenceFields,
    titleAtApplication: z.string().trim().min(1).max(CONTEXT_MAX_LENGTH),
    companyAtApplication: z.string().trim().min(1).max(CONTEXT_MAX_LENGTH),
    locationAtApplication: optionalContext(CONTEXT_MAX_LENGTH),
    applicationUrl,
    sourceId: applicationOpaqueIdSchema.nullable(),
    notes: optionalEventText,
    resumeId: applicationOpaqueIdSchema.nullish(),
  }),
);

const lifecycleEventSchema = withOccurrenceValidation(
  z.strictObject({
    kind: z.literal('lifecycle'),
    eventId: applicationOpaqueIdSchema,
    eventType: z.enum(APPLICATION_LIFECYCLE_STATUSES),
    ...occurrenceFields,
    notes: optionalEventText,
  }),
);

const noteEventSchema = withOccurrenceValidation(
  z.strictObject({
    kind: z.literal('note'),
    eventId: applicationOpaqueIdSchema,
    ...occurrenceFields,
    text: noteText,
  }),
);

const replaceEventSchema = withOccurrenceValidation(
  z
    .strictObject({
      kind: z.literal('replace'),
      eventId: applicationOpaqueIdSchema,
      targetEventId: applicationOpaqueIdSchema,
      replacementEventType: z.union([
        z.enum(USER_SELECTABLE_APPLICATION_STATUSES),
        z.literal('note'),
      ]),
      ...occurrenceFields,
      text: noteText.optional(),
      reason: optionalEventText,
      resumeId: applicationOpaqueIdSchema.nullish(),
    })
    .superRefine((command, context) => {
      if (
        command.replacementEventType === 'note' &&
        command.text === undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['text'],
          message: 'A Note replacement requires complete text',
        });
      }
      if (
        command.replacementEventType !== 'note' &&
        command.text !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['text'],
          message: 'Replacement text is only valid for a Note replacement',
        });
      }
      if (
        command.replacementEventType !== 'applied' &&
        command.resumeId !== null &&
        command.resumeId !== undefined
      ) {
        context.addIssue({
          code: 'custom',
          path: ['resumeId'],
          message: 'A Resume snapshot can only be attached to an Applied event',
        });
      }
    }),
);

const voidEventSchema = z.strictObject({
  kind: z.literal('void'),
  eventId: applicationOpaqueIdSchema,
  targetEventId: applicationOpaqueIdSchema,
  reason: optionalEventText,
});

export const applicationEventSchema = z.discriminatedUnion('kind', [
  lifecycleEventSchema,
  noteEventSchema,
  replaceEventSchema,
  voidEventSchema,
]);

export const applicationSummaryNotesSchema = z.strictObject({
  notes: z
    .string()
    .max(SUMMARY_NOTES_MAX_LENGTH)
    .nullable()
    .transform((value) =>
      value === null || value.trim().length === 0 ? null : value,
    ),
});

export const applicationCreateSchema = createApplicationSchema;
export const applicationEventCommandSchema = applicationEventSchema;
export const applicationNotesSchema = applicationSummaryNotesSchema;

export type ParsedApplicationListQuery = z.infer<
  typeof applicationListQuerySchema
>;
export type ParsedCreateApplicationCommand = z.infer<
  typeof createApplicationSchema
>;
export type ParsedApplicationEventCommand = z.infer<
  typeof applicationEventSchema
>;
export type ParsedApplicationSummaryNotesCommand = z.infer<
  typeof applicationSummaryNotesSchema
>;

function withOccurrenceValidation<T extends z.ZodType>(schema: T): T {
  return schema.superRefine((value: unknown, context) => {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('occurredAt' in value) ||
      !('occurrencePrecision' in value)
    ) {
      return;
    }
    const occurredAt = value.occurredAt;
    const precision = value.occurrencePrecision;
    if (
      typeof occurredAt === 'string' &&
      (precision === 'exact' || precision === 'date') &&
      !isValidOccurrenceInput(occurredAt, precision)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['occurredAt'],
        message:
          precision === 'exact'
            ? 'Exact occurrence must be a real ISO 8601 date-time with Z or an explicit offset'
            : 'Date occurrence must be a real YYYY-MM-DD date',
      });
    }
  });
}

function containsUrlWhitespaceOrControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 32 || code === 127) return true;
  }
  return false;
}
