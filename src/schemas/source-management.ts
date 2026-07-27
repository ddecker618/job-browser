import { z } from 'zod';

export const searchRequestSchema = z.strictObject({
  query: z.string().trim().max(200).default(''),
  location: z.string().trim().max(200).nullable().default(null),
  remoteOnly: z.boolean().default(false),
  limit: z.number().int().min(1).max(500).default(50),
});

export const sourceScheduleSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    cadence: z
      .enum([
        'manual',
        'every-6-hours',
        'every-12-hours',
        'every-24-hours',
        'daily',
      ])
      .default('manual'),
    dailyLocalTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .nullable()
      .default(null),
  })
  .superRefine((schedule, context) => {
    if (
      schedule.enabled &&
      schedule.cadence === 'daily' &&
      schedule.dailyLocalTime === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['dailyLocalTime'],
        message: 'Daily schedules require a local time',
      });
    }
  });

export const sourceInputSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(120),
  employer: z.string().trim().min(1).max(120),
  providerId: z.string().trim().min(1).max(80),
  careersUrl: z.url().nullable().default(null),
  configuration: z.record(z.string(), z.unknown()).default({}),
  searchCriteria: searchRequestSchema,
  enabled: z.boolean().default(false),
  schedule: sourceScheduleSchema,
});

export const sourcePatchSchema = sourceInputSchema.partial();

export const discoverySettingsSchema = z.strictObject({
  schedulerEnabled: z.boolean(),
});

export const atsDetectionRequestSchema = z.strictObject({
  url: z.url({ protocol: /^https?$/ }).max(2_048),
});

export const usaJobsCredentialSchema = z.strictObject({
  email: z.email(),
  apiKey: z.string().trim().min(8).max(500),
});
