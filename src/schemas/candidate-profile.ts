import { z } from 'zod';

import { EMPLOYMENT_TYPES } from '../domain/job.js';

export const candidateProfileSchema = z
  .strictObject({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1),
    preferredLocations: z
      .array(
        z.strictObject({
          city: z.string().trim().min(1),
          state: z.string().trim().min(1),
        }),
      )
      .min(1),
    searchRadiusMiles: z.number().int().positive(),
    secondarySearchRadiusMiles: z.number().int().positive(),
    remotePreference: z.enum(['preferred', 'accepted', 'not-preferred']),
    desiredSalary: z
      .strictObject({
        minimum: z.number().nonnegative(),
        target: z.number().nonnegative(),
        currency: z.string().trim().length(3),
      })
      .refine((salary) => salary.target >= salary.minimum, {
        message: 'Target salary cannot be below minimum salary',
        path: ['target'],
      })
      .nullable(),
    certifications: z.array(z.string().trim().min(1)),
    degrees: z.array(
      z.strictObject({
        name: z.string().trim().min(1),
        institution: z.string().trim().min(1),
        status: z.string().trim().min(1),
        expectedCompletion: z
          .string()
          .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
          .nullable(),
      }),
    ),
    skills: z.array(z.string().trim().min(1)),
    clearanceEligibility: z.enum(['eligible', 'not-eligible', 'unknown']),
    yearsOfExperience: z.number().nonnegative().nullable(),
    desiredJobTitles: z.array(z.string().trim().min(1)).min(1),
    excludedJobTitles: z.array(z.string().trim().min(1)),
    desiredEmploymentTypes: z.array(z.enum(EMPLOYMENT_TYPES)).min(1),
  })
  .refine(
    (profile) =>
      profile.secondarySearchRadiusMiles >= profile.searchRadiusMiles,
    {
      message: 'Secondary radius cannot be smaller than primary radius',
      path: ['secondarySearchRadiusMiles'],
    },
  );

export type CandidateProfile = z.infer<typeof candidateProfileSchema>;
