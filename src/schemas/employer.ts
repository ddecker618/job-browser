import { z } from 'zod';

export const employerInputSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  websiteUrl: z.url().nullable().default(null),
});

export const careerSiteInputSchema = z.strictObject({
  url: z
    .url({ protocol: /^https?$/ })
    .max(2_048)
    .transform((value) => value.trim()),
});
