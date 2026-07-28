import { z } from 'zod';

export interface RoleFamily {
  key: string;
  displayName: string;
  enabled: boolean;
  priority: number;
  titles: string[];
}

export interface SearchProfile {
  families: RoleFamily[];
  prioritizeRemote: boolean;
  maxOnsiteDistanceMiles: number;
  preferredLocation: string;
  maxExperienceYears: number;
  maxQueriesPerRun: number;
}

const roleFamilySchema = z.strictObject({
  key: z.string().min(1),
  displayName: z.string().min(1),
  enabled: z.boolean(),
  priority: z.number().int().min(0),
  titles: z.array(z.string().min(1)).min(1),
});

export const searchProfileSchema = z.strictObject({
  families: z.array(roleFamilySchema).min(1),
  prioritizeRemote: z.boolean().default(true),
  maxOnsiteDistanceMiles: z.number().int().min(0).default(50),
  preferredLocation: z.string().default('Highland, Illinois'),
  maxExperienceYears: z.number().int().min(0).default(4),
  maxQueriesPerRun: z.number().int().min(1).max(200).default(40),
});

export const DEFAULT_SEARCH_PROFILE: SearchProfile = {
  families: [
    {
      key: 'systems',
      displayName: 'Systems',
      enabled: true,
      priority: 1,
      titles: [
        'Systems Administrator',
        'System Administrator',
        'Junior Systems Administrator',
        'IT Systems Administrator',
        'Windows Administrator',
        'Linux Administrator',
        'Server Administrator',
        'Infrastructure Administrator',
        'Systems Analyst',
        'Systems Support Analyst',
        'Infrastructure Support Analyst',
        'IT Operations Analyst',
        'IT Operations Specialist',
        'Endpoint Administrator',
      ],
    },
    {
      key: 'network',
      displayName: 'Network',
      enabled: true,
      priority: 2,
      titles: [
        'Network Administrator',
        'Network Analyst',
        'Network Operations Analyst',
        'Network Operations Center Analyst',
        'NOC Analyst',
        'NOC Technician',
        'Network Support Specialist',
        'Network Support Engineer',
        'Network Monitoring Analyst',
        'Infrastructure Operations Analyst',
        'Network Technician',
      ],
    },
    {
      key: 'security',
      displayName: 'Security',
      enabled: true,
      priority: 3,
      titles: [
        'SOC Analyst',
        'Security Operations Analyst',
        'Cybersecurity Analyst',
        'Information Security Analyst',
        'Security Analyst',
        'SIEM Analyst',
        'Security Monitoring Analyst',
        'Threat Detection Analyst',
        'Incident Response Analyst',
        'Vulnerability Management Analyst',
        'Cybersecurity Support Analyst',
        'Security Operations Center Analyst',
        'Junior Security Engineer',
        'Security Engineer I',
      ],
    },
    {
      key: 'splunk',
      displayName: 'Splunk & SIEM',
      enabled: true,
      priority: 4,
      titles: [
        'Splunk Administrator',
        'Splunk Analyst',
        'Splunk Engineer',
        'SIEM Administrator',
        'SIEM Engineer',
        'Security Analytics Analyst',
        'Log Management Analyst',
        'Detection Analyst',
        'Detection and Response Analyst',
      ],
    },
    {
      key: 'support',
      displayName: 'Support',
      enabled: true,
      priority: 5,
      titles: [
        'Technical Support Engineer',
        'IT Support Analyst',
        'Systems Support Specialist',
        'Infrastructure Support Specialist',
        'Tier 2 Support Analyst',
        'Service Desk Analyst II',
        'Desktop Support Analyst',
        'Remote Support Engineer',
        'Application Support Analyst',
        'Cloud Support Associate',
        'Cloud Operations Analyst',
      ],
    },
  ],
  prioritizeRemote: true,
  maxOnsiteDistanceMiles: 50,
  preferredLocation: 'Highland, Illinois',
  maxExperienceYears: 4,
  maxQueriesPerRun: 40,
};

export function collectEnabledTitles(profile: SearchProfile): string[] {
  const result: string[] = [];
  const sorted = [...profile.families]
    .filter((f) => f.enabled)
    .sort((a, b) => a.priority - b.priority);
  for (const family of sorted) {
    for (const title of family.titles) {
      if (!result.includes(title)) result.push(title);
    }
  }
  return result;
}

export function familiesForJobTitle(
  title: string,
  profile: SearchProfile,
): string[] {
  const lower = title.toLowerCase();
  const matched: string[] = [];
  for (const family of profile.families) {
    if (!family.enabled) continue;
    for (const t of family.titles) {
      if (lower.includes(t.toLowerCase())) {
        matched.push(family.key);
        break;
      }
    }
  }
  return matched;
}

export function titleMatchScore(
  title: string,
  profile: SearchProfile,
): { families: string[]; score: number } {
  const lower = title.toLowerCase();
  const families: string[] = [];
  let maxFamilyPriority = 99;
  for (const family of profile.families) {
    if (!family.enabled) continue;
    for (const t of family.titles) {
      if (lower.includes(t.toLowerCase())) {
        families.push(family.key);
        if (family.priority < maxFamilyPriority) maxFamilyPriority = family.priority;
        break;
      }
    }
  }
  const seniorityKeywords = [
    'senior', 'sr.', 'sr ', 'lead', 'principal', 'staff',
    'manager', 'director', 'vice president', 'vp ', 'chief', 'cto',
  ];
  const hasSenior = seniorityKeywords.some((k) => lower.includes(k));
  const baseScore = families.length > 0
    ? Math.max(0, 1 - (maxFamilyPriority - 1) * 0.15)
    : 0.1;
  return {
    families,
    score: hasSenior ? baseScore * 0.5 : baseScore,
  };
}
