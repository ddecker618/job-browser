import { z } from 'zod';

export const SCORE_CATEGORY_NAMES = [
  'title',
  'skills',
  'certifications',
  'location',
  'remotePreference',
  'salary',
  'experience',
  'employmentType',
  'recency',
] as const;

const catalogEntrySchema = z.strictObject({
  name: z.string().trim().min(1),
  aliases: z.array(z.string().trim().min(1)).min(1),
});

export const scoringConfigSchema = z
  .strictObject({
    weights: z.strictObject({
      title: z.number().nonnegative(),
      skills: z.number().nonnegative(),
      certifications: z.number().nonnegative(),
      location: z.number().nonnegative(),
      remotePreference: z.number().nonnegative(),
      salary: z.number().nonnegative(),
      experience: z.number().nonnegative(),
      employmentType: z.number().nonnegative(),
      recency: z.number().nonnegative(),
    }),
    recommendationThresholds: z.strictObject({
      applyImmediately: z.number().min(0).max(100),
      strongMatch: z.number().min(0).max(100),
      possibleMatch: z.number().min(0).max(100),
    }),
    recency: z.strictObject({
      freshDays: z.number().int().nonnegative(),
      recentDays: z.number().int().nonnegative(),
    }),
    skills: z.array(catalogEntrySchema),
    certifications: z.array(catalogEntrySchema),
    verification: z.strictObject({
      enabled: z.boolean(),
      eligibilityGate: z.boolean(),
      scoreContribution: z.number().min(0).max(100),
    }).default({ enabled: true, eligibilityGate: true, scoreContribution: 100 }),
  })
  .superRefine((config, context) => {
    const totalWeight = Object.values(config.weights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (Math.abs(totalWeight - 100) > Number.EPSILON) {
      context.addIssue({
        code: 'custom',
        message: 'Scoring weights must total 100',
        path: ['weights'],
      });
    }
    const thresholds = config.recommendationThresholds;
    if (
      thresholds.applyImmediately < thresholds.strongMatch ||
      thresholds.strongMatch < thresholds.possibleMatch
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Recommendation thresholds must be in descending order',
        path: ['recommendationThresholds'],
      });
    }
    if (config.recency.recentDays < config.recency.freshDays) {
      context.addIssue({
        code: 'custom',
        message: 'Recent-day window cannot be shorter than fresh-day window',
        path: ['recency', 'recentDays'],
      });
    }
  });

export type ScoringConfig = z.infer<typeof scoringConfigSchema>;
export type ScoreCategoryName = (typeof SCORE_CATEGORY_NAMES)[number];
