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
  preferredLocation: z.string().default('Example City, EX'),
  maxExperienceYears: z.number().int().min(0).default(4),
  maxQueriesPerRun: z.number().int().min(1).max(200).default(40),
});

export const DEFAULT_SEARCH_PROFILE: SearchProfile = {
  families: [
    {
      key: 'infrastructure',
      displayName: 'Infrastructure',
      enabled: true,
      priority: 1,
      titles: [
        'Systems Administrator',
        'Windows Systems Administrator',
        'Infrastructure Administrator',
        'Server Administrator',
        'Junior Systems Administrator',
        'Windows Administrator',
        'Linux Administrator',
      ],
    },
    {
      key: 'networking',
      displayName: 'Networking',
      enabled: true,
      priority: 2,
      titles: [
        'Network Administrator',
        'Network Analyst',
        'Network Support Engineer',
        'Network Operations Analyst',
        'NOC Analyst',
        'Junior NOC Analyst',
        'NOC Technician',
        'Network Operations Center Analyst',
        'Network Support Specialist',
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
        'Tier 1 SOC Analyst',
        'Junior SOC Analyst',
        'Cybersecurity Analyst',
        'Cyber Security Analyst',
        'IT Security Analyst',
        'Security Operations Analyst',
        'Information Security Analyst',
        'Vulnerability Analyst',
        'Vulnerability Management Analyst',
        'Risk & Vulnerability Analyst',
      ],
    },
    {
      key: 'splunk',
      displayName: 'Splunk',
      enabled: true,
      priority: 4,
      titles: [
        'Splunk Administrator',
        'Splunk Engineer',
        'Splunk Consultant',
        'SIEM Engineer',
        'SIEM Analyst',
      ],
    },
    {
      key: 'database',
      displayName: 'Database',
      enabled: true,
      priority: 5,
      titles: [
        'Junior Database Administrator',
        'Database Administrator',
        'SQL Database Administrator',
        'Database Support Analyst',
      ],
    },
    {
      key: 'support',
      displayName: 'Support',
      enabled: true,
      priority: 6,
      titles: [
        'Technical Support Engineer',
        'IT Support Specialist',
        'Desktop Support Technician',
        'IT Support Analyst',
        'Technical Support Specialist',
      ],
    },
  ],
  prioritizeRemote: true,
  maxOnsiteDistanceMiles: 50,
  preferredLocation: 'Example City, EX',
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
        if (family.priority < maxFamilyPriority)
          maxFamilyPriority = family.priority;
        break;
      }
    }
  }
  const seniorityKeywords = [
    'senior',
    'sr.',
    'sr ',
    'lead',
    'principal',
    'staff',
    'manager',
    'director',
    'vice president',
    'vp ',
    'chief',
    'cto',
  ];
  const hasSenior = seniorityKeywords.some((k) => lower.includes(k));
  const baseScore =
    families.length > 0 ? Math.max(0, 1 - (maxFamilyPriority - 1) * 0.15) : 0.1;
  return {
    families,
    score: hasSenior ? baseScore * 0.5 : baseScore,
  };
}
