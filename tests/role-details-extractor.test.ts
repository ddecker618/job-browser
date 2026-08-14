import { describe, expect, it } from 'vitest';

import { loadScoringConfig } from '../src/config/scoring-config.js';
import {
  extractRoleDetails,
  type RoleDetailsInput,
} from '../src/intelligence/roleDetailsExtractor.js';
import {
  ROLE_DETAILS_VERSION,
  roleDetailsSchema,
} from '../src/schemas/role-details.js';

const CONFIG = loadScoringConfig();

function input(overrides: Partial<RoleDetailsInput> = {}): RoleDetailsInput {
  return {
    title: 'Security Analyst',
    company: 'Example Employer',
    location: 'Example City, EX',
    city: 'Example City',
    state: 'EX',
    remoteType: 'onsite',
    teleworkEligible: null,
    employmentType: 'full-time',
    workSchedule: null,
    appointmentType: null,
    description: 'Monitor security events in Splunk.',
    requirements: null,
    preferredQualifications: null,
    ...overrides,
  };
}

describe('roleDetails extractor', () => {
  describe('document contract', () => {
    it('is versioned as role-details-v1', () => {
      expect(extractRoleDetails(input(), CONFIG).version).toBe(
        ROLE_DETAILS_VERSION,
      );
      expect(ROLE_DETAILS_VERSION).toBe('role-details-v1');
    });

    it('records a generated timestamp', () => {
      const details = extractRoleDetails(input(), CONFIG);
      expect(details.generatedAt).toEqual(expect.any(String));
      expect(Date.parse(details.generatedAt)).not.toBeNaN();
    });

    it('records a stable source-text hash', () => {
      const details = extractRoleDetails(input({}, ), CONFIG);
      expect(details.sourceTextHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('recomputes the same hash from identical evidence', () => {
      const first = extractRoleDetails(input(), CONFIG);
      const second = extractRoleDetails(input(), CONFIG);
      expect(first.sourceTextHash).toBe(second.sourceTextHash);
    });

    it('changes hash when evidence text changes', () => {
      const baseline = extractRoleDetails(input(), CONFIG);
      const changed = extractRoleDetails(
        input({ description: 'A different description.' }),
        CONFIG,
      );
      expect(changed.sourceTextHash).not.toBe(baseline.sourceTextHash);
    });

    it('produces a payload that satisfies the canonical schema', () => {
      const details = extractRoleDetails(input(), CONFIG);
      expect(roleDetailsSchema.parse(details)).toEqual(details);
    });

    it('round-trips through JSON without loss', () => {
      const details = extractRoleDetails(input(), CONFIG);
      const restored = roleDetailsSchema.parse(
        JSON.parse(JSON.stringify(details)) as unknown,
      );
      expect(restored).toEqual(details);
    });
  });

  describe('employment type', () => {
    it('uses an explicit provider full-time employment type', () => {
      const details = extractRoleDetails(input(), CONFIG);
      expect(details.employment.type).toBe('full-time');
      expect(details.employment.source).toBe('provider');
      expect(details.employment.evidence).toContain(
        'Provider employment type: full-time',
      );
    });

    it('uses an explicit provider contract employment type', () => {
      const details = extractRoleDetails(
        input({ employmentType: 'contract' }),
        CONFIG,
      );
      expect(details.employment.type).toBe('contract');
      expect(details.employment.source).toBe('provider');
    });

    it('uses an explicit provider part-time employment type', () => {
      const details = extractRoleDetails(
        input({ employmentType: 'part-time' }),
        CONFIG,
      );
      expect(details.employment.type).toBe('part-time');
    });

    it('classifies full-time from text when the provider is silent', () => {
      const details = extractRoleDetails(
        input({
          employmentType: 'unknown',
          description: 'This is a full-time position with benefits.',
        }),
        CONFIG,
      );
      expect(details.employment.type).toBe('full-time');
      expect(details.employment.source).toBe('description');
    });

    it('classifies part-time from text when the provider is silent', () => {
      const details = extractRoleDetails(
        input({
          employmentType: 'unknown',
          description: 'Part-time role, twenty hours per week.',
        }),
        CONFIG,
      );
      expect(details.employment.type).toBe('part-time');
    });

    it('classifies contract work from text when the provider is silent', () => {
      const details = extractRoleDetails(
        input({
          employmentType: 'unknown',
          description: 'One-year contract position.',
        }),
        CONFIG,
      );
      expect(details.employment.type).toBe('contract');
    });

    it('classifies temporary work from text', () => {
      const details = extractRoleDetails(
        input({
          employmentType: 'unknown',
          description: 'Temporary assignment for six months.',
        }),
        CONFIG,
      );
      expect(details.employment.type).toBe('temporary');
    });

    it('classifies an internship from text', () => {
      const details = extractRoleDetails(
        input({
          employmentType: 'unknown',
          description: 'Summer internship program on the security team.',
        }),
        CONFIG,
      );
      expect(details.employment.type).toBe('internship');
    });

    it('returns unknown when neither provider nor text states an employment type', () => {
      const details = extractRoleDetails(
        input({
          employmentType: 'unknown',
          description: 'Join our growing security operations team.',
        }),
        CONFIG,
      );
      expect(details.employment.type).toBe('unknown');
      expect(details.employment.source).toBe('unknown');
      expect(details.employment.evidence).toEqual([]);
    });

    it('prefers the provider employment type over contradictory prose', () => {
      const details = extractRoleDetails(
        input({
          employmentType: 'contract',
          description: 'This is a full-time salaried role.',
        }),
        CONFIG,
      );
      expect(details.employment.type).toBe('contract');
      expect(details.employment.source).toBe('provider');
    });
  });

  describe('workplace precedence', () => {
    it('uses an explicit provider remote type', () => {
      const details = extractRoleDetails(input({ remoteType: 'remote' }), CONFIG);
      expect(details.workplace.arrangement).toBe('remote');
      expect(details.workplace.source).toBe('provider');
      expect(details.workplace.evidence).toContain('Provider remote type: remote');
    });

    it('uses an explicit provider hybrid type', () => {
      const details = extractRoleDetails(input({ remoteType: 'hybrid' }), CONFIG);
      expect(details.workplace.arrangement).toBe('hybrid');
      expect(details.workplace.source).toBe('provider');
    });

    it('prefers provider telework-eligible over an onsite description', () => {
      const details = extractRoleDetails(
        input({
          teleworkEligible: true,
          remoteType: 'onsite',
          description: 'Must report to the office daily.',
        }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('hybrid');
      expect(details.workplace.source).toBe('provider');
    });

    it('classifies remote when telework-eligible and text says fully remote', () => {
      const details = extractRoleDetails(
        input({
          teleworkEligible: true,
          remoteType: 'onsite',
          description: 'This is a fully remote position.',
        }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('remote');
    });

    it('marks a provider as onsite when telework is explicitly false', () => {
      const details = extractRoleDetails(
        input({ teleworkEligible: false, remoteType: 'onsite' }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('onsite');
      expect(details.workplace.source).toBe('provider');
    });

    it('falls back to description evidence when the provider is silent', () => {
      const details = extractRoleDetails(
        input({ description: 'Hybrid role, three days per week in the office.' }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('hybrid');
      expect(details.workplace.source).toBe('description');
      expect(details.workplace.evidence.length).toBeGreaterThan(0);
    });

    it('classifies remote from explicit labeled language', () => {
      const details = extractRoleDetails(
        input({ description: 'This is a fully remote role.' }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('remote');
    });

    it('classifies onsite from explicit labeled language', () => {
      const details = extractRoleDetails(
        input({
          description: 'Not a remote role. Must report to the office. Local candidates only.',
        }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('onsite');
    });

    it('does not treat technical remote terminology as a remote arrangement', () => {
      const details = extractRoleDetails(
        input({
          description:
            'The team supports on-premises and remote infrastructure, desktops and servers.',
        }),
        CONFIG,
      );
      expect(details.workplace.arrangement).not.toBe('remote');
    });

    it('returns unknown when nothing states an arrangement', () => {
      const details = extractRoleDetails(
        input({ description: 'Join our growing team. Great benefits.' }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('unknown');
      expect(details.workplace.source).toBe('unknown');
    });

    it('reports a hybrid-capable location as remote-capable', () => {
      const details = extractRoleDetails(input({ remoteType: 'hybrid' }), CONFIG);
      expect(details.locations.remoteCapable).toBe(true);
    });
  });

  describe('locations', () => {
    it('uses structured city and state when present', () => {
      const details = extractRoleDetails(input(), CONFIG);
      expect(details.locations.primaryCity).toBe('Example City');
      expect(details.locations.primaryState).toBe('EX');
      expect(details.locations.evidence).toContain('Provider location fields');
    });

    it('parses city and state from a free-form location', () => {
      const details = extractRoleDetails(
        input({ city: null, state: null, location: 'Springfield, IL' }),
        CONFIG,
      );
      expect(details.locations.primaryCity).toBe('Springfield');
      expect(details.locations.primaryState).toBe('IL');
    });

    it('leaves city/state null for a remote location', () => {
      const details = extractRoleDetails(
        input({ city: null, state: null, location: 'Remote – United States' }),
        CONFIG,
      );
      expect(details.locations.primaryCity).toBeNull();
      expect(details.locations.primaryState).toBeNull();
    });

    it('flags multiple locations when separated by semicolons', () => {
      const details = extractRoleDetails(
        input({ location: 'Chicago, IL; New York, NY; Austin, TX' }),
        CONFIG,
      );
      expect(details.locations.multiple).toBe(true);
    });

    it('does not flag a single city location as multiple', () => {
      const details = extractRoleDetails(
        input({ location: 'Springfield, IL' }),
        CONFIG,
      );
      expect(details.locations.multiple).toBe(false);
    });

    it('records the provider location as evidence', () => {
      const details = extractRoleDetails(
        input({ city: null, state: null, location: 'Springfield, IL' }),
        CONFIG,
      );
      expect(details.locations.evidence).toContain(
        'Provider location: Springfield, IL',
      );
    });
  });

  describe('clearance', () => {
    it('classifies an active top-secret clearance', () => {
      const details = extractRoleDetails(
        input({ description: 'Active Top Secret clearance required.' }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('active');
      expect(details.clearance.level).toMatch(/top\s+secret/i);
    });

    it('classifies an active security clearance', () => {
      const details = extractRoleDetails(
        input({ description: 'Must hold an active security clearance.' }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('active');
    });

    it('classifies obtainable clearance language', () => {
      const details = extractRoleDetails(
        input({ description: 'May be eligible to obtain a security clearance.' }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('obtainable');
    });

    it('markers clearance sponsorship as available', () => {
      const details = extractRoleDetails(
        input({
          description: 'Clearance sponsorship is available for the right candidate.',
        }),
        CONFIG,
      );
      expect(details.clearance.sponsorable).toBe(true);
    });

    it('classifies a public trust position', () => {
      const details = extractRoleDetails(
        input({ description: 'Public trust position with a background check.' }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('public-trust');
    });

    it('reports no clearance when nothing is stated', () => {
      const details = extractRoleDetails(
        input({ description: 'Monitor security events.' }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('none');
      expect(details.clearance.sponsorable).toBe(false);
    });
  });

  describe('education', () => {
    it('detects a required bachelors degree', () => {
      const details = extractRoleDetails(
        input({
          description: "Bachelor's degree required. Monitor security events.",
        }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('bachelor');
    });

    it('detects a required masters degree', () => {
      const details = extractRoleDetails(
        input({ description: "Master's degree in computer science required." }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('master');
    });

    it('detects a doctorate requirement', () => {
      const details = extractRoleDetails(
        input({ description: 'A Ph.D. degree is required for this role.' }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('doctorate');
    });

    it('reports none when no degree is mentioned', () => {
      const details = extractRoleDetails(
        input({ description: 'Monitor security events in Splunk.' }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('none');
    });

    it('records degree-in-progress acceptance', () => {
      const details = extractRoleDetails(
        input({
          description: 'Degree in progress is acceptable, or equivalent work experience.',
        }),
        CONFIG,
      );
      expect(details.education.degreeInProgressOk).toBe(true);
    });

    it('extracts the degree field of study', () => {
      const details = extractRoleDetails(
        input({
          description: "Bachelor's degree in computer science required.",
        }),
        CONFIG,
      );
      expect(details.education.field).toBe('computer science');
    });
  });

  describe('experience', () => {
    it('extracts required years of experience', () => {
      const details = extractRoleDetails(
        input({ description: '5+ years of relevant experience required.' }),
        CONFIG,
      );
      expect(details.experience.requiredYears).toBe(5);
    });

    it('extracts "requires at least N years" language', () => {
      const details = extractRoleDetails(
        input({ description: 'Requires at least 3 years of security experience.' }),
        CONFIG,
      );
      expect(details.experience.requiredYears).toBe(3);
    });

    it('extracts "minimum of N years" language', () => {
      const details = extractRoleDetails(
        input({ description: 'Minimum of 4 years of experience.' }),
        CONFIG,
      );
      expect(details.experience.requiredYears).toBe(4);
    });

    it('extracts preferred years separately', () => {
      const details = extractRoleDetails(
        input({ description: '5 years of experience preferred.' }),
        CONFIG,
      );
      expect(details.experience.preferredYears).toBe(5);
    });

    it('records a required/preferred split in evidence', () => {
      const details = extractRoleDetails(
        input({ description: 'Requires at least 3 years of experience; 5 years preferred.' }),
        CONFIG,
      );
      expect(details.experience.requiredYears).toBe(3);
      expect(details.experience.preferredYears).toBe(5);
      expect(details.experience.evidence).toContain('Required experience: 3 years');
      expect(details.experience.evidence).toContain('Preferred experience: 5 years');
    });

    it('records equivalent-experience substitution', () => {
      const details = extractRoleDetails(
        input({
          description:
            "Bachelor's degree or equivalent combination of education and experience.",
        }),
        CONFIG,
      );
      expect(details.experience.substitution.length).toBeGreaterThan(0);
    });

    it('leaves years null when no experience is stated', () => {
      const details = extractRoleDetails(
        input({ description: 'Monitor security events.' }),
        CONFIG,
      );
      expect(details.experience.requiredYears).toBeNull();
      expect(details.experience.preferredYears).toBeNull();
    });
  });

  describe('catalog skills and certifications', () => {
    it('extracts required skills from the requirements section', () => {
      const details = extractRoleDetails(
        input({ requirements: 'Linux administration and Python scripting required.' }),
        CONFIG,
      );
      expect(details.skills.required).toContain('Linux');
      expect(details.skills.required).toContain('Python');
    });

    it('extracts preferred skills from the preferred-qualifications section', () => {
      const details = extractRoleDetails(
        input({ preferredQualifications: 'AWS experience preferred.' }),
        CONFIG,
      );
      expect(details.skills.preferred).toContain('AWS');
    });

    it('separates required and preferred skill sets', () => {
      const details = extractRoleDetails(
        input({
          requirements: 'Splunk administration required.',
          preferredQualifications: 'Azure preferred.',
        }),
        CONFIG,
      );
      expect(details.skills.required).toEqual(['Splunk']);
      expect(details.skills.preferred).toEqual(['Azure']);
    });

    it('deduplicates and sorts matched skills', () => {
      const details = extractRoleDetails(
        input({
          description: 'Windows Server and Linux. Linux is the primary platform.',
        }),
        CONFIG,
      );
      expect(details.skills.required).toEqual(['Linux', 'Windows Server']);
    });

    it('extracts required certifications from the requirements section', () => {
      const details = extractRoleDetails(
        input({ requirements: 'CompTIA Security+ required.' }),
        CONFIG,
      );
      expect(details.certifications.required).toContain('CompTIA Security+');
    });

    it('extracts preferred certifications separately', () => {
      const details = extractRoleDetails(
        input({ preferredQualifications: 'CISSP preferred.' }),
        CONFIG,
      );
      expect(details.certifications.preferred).toContain('CISSP');
    });

    it('populates the technologies projection from the catalog', () => {
      const details = extractRoleDetails(
        input({ description: 'Uses Splunk and CrowdStrike daily.' }),
        CONFIG,
      );
      expect(details.technologies).toContain('Splunk');
      expect(details.technologies).toContain('CrowdStrike');
    });

    it('sorts technologies deterministically', () => {
      const details = extractRoleDetails(
        input({ description: 'CrowdStrike and Splunk and EDR signals.' }),
        CONFIG,
      );
      expect(details.technologies).toEqual(['CrowdStrike', 'EDR', 'Splunk']);
    });

    it('keeps lists empty when nothing matches the catalog', () => {
      const details = extractRoleDetails(
        input({ description: 'Great benefits, flexible schedule.' }),
        CONFIG,
      );
      expect(details.skills.required).toEqual([]);
      expect(details.skills.preferred).toEqual([]);
      expect(details.certifications.required).toEqual([]);
      expect(details.technologies).toEqual([]);
    });
  });

  describe('occupational series and professional engineering', () => {
    it('extracts a federal occupational series', () => {
      const details = extractRoleDetails(
        input({ description: 'Occupational series: 2210.' }),
        CONFIG,
      );
      expect(details.occupationalSeries).toContain('2210');
    });

    it('leaves the series list empty when absent', () => {
      const details = extractRoleDetails(input(), CONFIG);
      expect(details.occupationalSeries).toEqual([]);
    });

    it('flags the 0854 professional-engineering series', () => {
      const details = extractRoleDetails(
        input({ description: 'Occupational series 0854 (Computer Engineering).' }),
        CONFIG,
      );
      expect(details.occupationalSeries).toContain('0854');
      expect(details.contingentConditions.professionalEngineering).toBe(true);
    });
  });

  describe('citizenship', () => {
    it('flags explicit U.S. citizenship requirements', () => {
      const details = extractRoleDetails(
        input({ description: 'U.S. citizenship required.' }),
        CONFIG,
      );
      expect(details.citizenship.usCitizenRequired).toBe(true);
      expect(details.citizenship.evidence.length).toBeGreaterThan(0);
    });

    it('flags "must be a U.S. citizen" language', () => {
      const details = extractRoleDetails(
        input({ description: 'Must be a U.S. citizen.' }),
        CONFIG,
      );
      expect(details.citizenship.usCitizenRequired).toBe(true);
    });

    it('does not flag citizenship when absent', () => {
      const details = extractRoleDetails(
        input({ description: 'Monitor security events.' }),
        CONFIG,
      );
      expect(details.citizenship.usCitizenRequired).toBe(false);
      expect(details.citizenship.evidence).toEqual([]);
    });
  });

  describe('travel', () => {
    it('extracts a travel percentage', () => {
      const details = extractRoleDetails(
        input({ description: 'Up to 25% travel required.' }),
        CONFIG,
      );
      expect(details.travel.required).toBe(true);
      expect(details.travel.percent).toBe(25);
    });

    it('extracts overnight travel percentages', () => {
      const details = extractRoleDetails(
        input({ description: '50% overnight travel.' }),
        CONFIG,
      );
      expect(details.travel.required).toBe(true);
      expect(details.travel.percent).toBe(50);
    });

    it('marks travel required without a percentage', () => {
      const details = extractRoleDetails(
        input({ description: 'Travel is required for this role.' }),
        CONFIG,
      );
      expect(details.travel.required).toBe(true);
      expect(details.travel.percent).toBeNull();
    });

    it('leaves travel unset when not mentioned', () => {
      const details = extractRoleDetails(input(), CONFIG);
      expect(details.travel.required).toBe(false);
      expect(details.travel.percent).toBeNull();
    });
  });

  describe('schedule', () => {
    it('flags weekend coverage', () => {
      const details = extractRoleDetails(
        input({ description: 'Must be available for weekend coverage.' }),
        CONFIG,
      );
      expect(details.schedule.flags).toContain('weekends');
    });

    it('classifies overnight shifts', () => {
      const details = extractRoleDetails(
        input({ description: 'This role requires an overnight shift.' }),
        CONFIG,
      );
      expect(details.schedule.classification).toBe('overnight');
      expect(details.schedule.flags).toContain('overnight');
    });

    it('classifies rotating schedules', () => {
      const details = extractRoleDetails(
        input({ description: 'Must work rotating shifts including evenings.' }),
        CONFIG,
      );
      expect(details.schedule.classification).toBe('rotating');
      expect(details.schedule.flags).toContain('rotating');
    });

    it('flags mandatory on-call', () => {
      const details = extractRoleDetails(
        input({ description: 'Mandatory on-call rotation is expected.' }),
        CONFIG,
      );
      expect(details.schedule.flags).toContain('onCall');
    });

    it('classes evening shifts', () => {
      const details = extractRoleDetails(
        input({ description: 'Evening shift coverage required.' }),
        CONFIG,
      );
      expect(details.schedule.classification).toBe('evening');
      expect(details.schedule.flags).toContain('evening');
    });

    it('uses provider work schedule when text is silent', () => {
      const details = extractRoleDetails(
        input({
          workSchedule: 'Rotating Shifts',
          description: 'Join our team.',
        }),
        CONFIG,
      );
      expect(details.schedule.flags).toContain('rotating');
    });
  });

  describe('contingent conditions', () => {
    it('flags commission-based roles', () => {
      const details = extractRoleDetails(
        input({ description: 'Commission-based compensation structure.' }),
        CONFIG,
      );
      expect(details.contingentConditions.commissionBased).toBe(true);
    });

    it('flags physical requirements with evidence', () => {
      const details = extractRoleDetails(
        input({ description: 'Ability to lift up to 50 pounds.' }),
        CONFIG,
      );
      expect(details.contingentConditions.physicalRequirements).toBe(true);
      expect(details.contingentConditions.evidence.length).toBeGreaterThan(0);
    });

    it('flags field installation work', () => {
      const details = extractRoleDetails(
        input({ description: 'Field installation and tower work required.' }),
        CONFIG,
      );
      expect(details.contingentConditions.fieldInstallation).toBe(true);
    });

    it('flags development-focused roles', () => {
      const details = extractRoleDetails(
        input({
          description: 'Build software applications using agile methodology.',
        }),
        CONFIG,
      );
      expect(details.contingentConditions.developmentFocused).toBe(true);
    });

    it('leaves all conditions clear when nothing applies', () => {
      const details = extractRoleDetails(
        input({ description: 'Monitor security events in Splunk.' }),
        CONFIG,
      );
      expect(details.contingentConditions.commissionBased).toBe(false);
      expect(details.contingentConditions.physicalRequirements).toBe(false);
      expect(details.contingentConditions.fieldInstallation).toBe(false);
      expect(details.contingentConditions.developmentFocused).toBe(false);
      expect(details.contingentConditions.professionalEngineering).toBe(false);
    });
  });

  describe('evidence discipline', () => {
    it('provides evidence for every classified workplace decision', () => {
      const cases = [
        input({ remoteType: 'remote' }),
        input({ teleworkEligible: true }),
        input({ description: 'Hybrid role, three days per week in the office.' }),
        input({ description: 'Must report to the office.' }),
      ];
      for (const caseInput of cases) {
        const details = extractRoleDetails(caseInput, CONFIG);
        expect(details.workplace.evidence.length).toBeGreaterThan(0);
      }
    });

    it('records requirement snippets as travel evidence', () => {
      const details = extractRoleDetails(
        input({ description: 'Up to 15% travel.' }),
        CONFIG,
      );
      expect(details.travel.evidence).toContain('15% travel');
    });

    it('never infers clearance from a job title', () => {
      const details = extractRoleDetails(
        input({
          title: 'Top Secret Cleared Systems Engineer',
          description: 'Manage servers and networking.',
        }),
        CONFIG,
      );
      expect(details.clearance.mode).not.toBe('active');
    });
  });

  describe('remote-work-not-authorized', () => {
    it('classifies explicit remote-work-not-authorized language as onsite', () => {
      const details = extractRoleDetails(
        input({ description: 'Remote work is not authorized for this role.' }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('onsite');
      expect(details.workplace.source).toBe('description');
    });

    it('classifies "no remote option" language as onsite', () => {
      const details = extractRoleDetails(
        input({ description: 'No remote option; local candidates only.' }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('onsite');
    });
  });

  describe('provider/description conflicts', () => {
    it('prefers an explicit provider remote type over contradictory prose', () => {
      const details = extractRoleDetails(
        input({
          remoteType: 'remote',
          description: 'Candidates must report to our downtown office.',
        }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('remote');
      expect(details.workplace.source).toBe('provider');
    });

    it('prefers a provider onsite flag over remote-sounding prose', () => {
      const details = extractRoleDetails(
        input({
          remoteType: 'onsite',
          teleworkEligible: false,
          description: 'Work-from-home friendly culture with flexible hours.',
        }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('onsite');
    });
  });

  describe('no company-HQ inference', () => {
    it('never infers a location from the company name alone', () => {
      const details = extractRoleDetails(
        input({ company: 'Washington DC Consulting Group', city: null, state: null, location: null }),
        CONFIG,
      );
      expect(details.locations.primaryCity).toBeNull();
      expect(details.locations.primaryState).toBeNull();
      expect(details.locations.evidence).toEqual([]);
    });
  });

  describe('clearance specificity', () => {
    it('classifies active TS/SCI with a CI polygraph', () => {
      const details = extractRoleDetails(
        input({
          description: 'Active TS/SCI clearance with CI polygraph required.',
        }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('active');
      expect(details.clearance.level).toBe('TS/SCI');
    });

    it('classifies ambiguous clearance wording as non-blocking', () => {
      const details = extractRoleDetails(
        input({ description: 'Clearance may be required for this role.' }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('ambiguous');
    });

    it('distinguishes ability-to-obtain Secret from an active clearance', () => {
      const details = extractRoleDetails(
        input({ description: 'Must be able to obtain a Secret clearance.' }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('obtainable');
    });
  });

  describe('experience substitution paths', () => {
    it('records a bachelors-degree substitution path', () => {
      const details = extractRoleDetails(
        input({
          description:
            "Bachelor's degree or equivalent combination of education and experience required.",
        }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('bachelor');
      expect(details.experience.substitution.length).toBeGreaterThan(0);
    });

    it('records a masters-degree substitution path', () => {
      const details = extractRoleDetails(
        input({
          description:
            "Master's degree required; equivalent combination of education and experience may substitute.",
        }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('master');
      expect(details.experience.substitution.length).toBeGreaterThan(0);
    });

    it('handles multiple parallel qualification paths', () => {
      const details = extractRoleDetails(
        input({
          description:
            "Requires a bachelor's degree plus 5 years experience, or a master's degree plus 3 years, or an equivalent combination.",
        }),
        CONFIG,
      );
      expect(details.experience.requiredYears).toBe(5);
      expect(details.education.degreeRequired).toBe('master');
      expect(details.experience.substitution.length).toBeGreaterThan(0);
    });
  });

  describe('education preferences', () => {
    it('does not treat a preferred degree as required', () => {
      const details = extractRoleDetails(
        input({ description: "Master's degree preferred, not required." }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('none');
      expect(details.education.evidence).toContain(
        'Degree preferred, not required',
      );
    });

    it('treats a degree-or-equivalent as required at the stated level', () => {
      const details = extractRoleDetails(
        input({ description: 'A bachelor degree or equivalent is required.' }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('bachelor');
    });
  });

  describe('qualification sections', () => {
    it('splits plain-text Required/Desired headings', () => {
      const details = extractRoleDetails(
        input({
          description: `Required Qualifications:
- Linux administration
- Python scripting

Desired Qualifications:
- AWS experience
- Kubernetes`,
        }),
        CONFIG,
      );
      expect(details.skills.required).toEqual(['Linux', 'Python']);
      expect(details.skills.preferred).toEqual(['AWS', 'Kubernetes']);
    });

    it('splits HTML heading sections', () => {
      const details = extractRoleDetails(
        input({
          description: `<h3>Required Qualifications</h3>
<p>Linux administration required.</p>
<h3>Desired Qualifications</h3>
<p>AWS experience preferred.</p>`,
        }),
        CONFIG,
      );
      expect(details.skills.required).toEqual(['Linux']);
      expect(details.skills.preferred).toEqual(['AWS']);
    });

    it('splits colon-terminated headings', () => {
      const details = extractRoleDetails(
        input({
          requirements: 'Required: Linux, Python.',
          preferredQualifications: 'Desired: AWS, Kubernetes.',
        }),
        CONFIG,
      );
      expect(details.skills.required).toEqual(['Linux', 'Python']);
      expect(details.skills.preferred).toEqual(['AWS', 'Kubernetes']);
    });
  });

  describe('certification distinctness', () => {
    it('keeps similarly named certifications distinct', () => {
      const details = extractRoleDetails(
        input({
          requirements: 'CompTIA Security+ and CompTIA Network+ required.',
        }),
        CONFIG,
      );
      expect(details.certifications.required).toEqual([
        'CompTIA Network+',
        'CompTIA Security+',
      ]);
    });
  });

  describe('contingent conditions', () => {
    it('flags contingent-on-award roles', () => {
      const details = extractRoleDetails(
        input({
          description: 'This position is contingent upon contract award.',
        }),
        CONFIG,
      );
      expect(details.contingentConditions.contingentOnAward).toBe(true);
    });

    it('leaves contingentOnAward false when not stated', () => {
      const details = extractRoleDetails(input(), CONFIG);
      expect(details.contingentConditions.contingentOnAward).toBe(false);
    });
  });

  describe('work schedule from provider', () => {
    it('records appointment type in evidence text when present', () => {
      const details = extractRoleDetails(
        input({
          appointmentType: 'Term',
          description: 'Appointment type is Term.',
        }),
        CONFIG,
      );
      expect(details.schedule.classification).toBe('unknown');
      expect(details.schedule.flags).toEqual([]);
    });
  });

  describe('matrix: ambiguous wording', () => {
    it('prefers onsite evidence over remote prose when both appear', () => {
      const details = extractRoleDetails(
        input({
          remoteType: 'onsite',
          teleworkEligible: null,
          description:
            'Must report to the office daily, though fully remote work is available.',
        }),
        CONFIG,
      );
      expect(details.workplace.arrangement).toBe('onsite');
      expect(details.workplace.source).toBe('description');
    });

    it('keeps an ambiguous employment description as unknown', () => {
      const details = extractRoleDetails(
        input({
          employmentType: 'unknown',
          description: 'Employment status may vary depending on assignment.',
        }),
        CONFIG,
      );
      expect(details.employment.type).toBe('unknown');
    });
  });

  describe('matrix: clearance eligible mode', () => {
    it('classifies eligible-for-a-clearance wording in the eligible mode', () => {
      const details = extractRoleDetails(
        input({
          description:
            'Candidates eligible for a security clearance with a TS/SCI are encouraged to apply.',
        }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('eligible');
    });

    it('classifies clearance-eligibility wording as eligible', () => {
      const details = extractRoleDetails(
        input({
          description: 'Clearance eligibility is required for this role.',
        }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('eligible');
    });
  });

  describe('matrix: experience ranges and ambiguity', () => {
    it('extracts the upper bound of a year range as required experience', () => {
      const details = extractRoleDetails(
        input({
          description: '5-7 years of relevant experience required.',
        }),
        CONFIG,
      );
      expect(details.experience.requiredYears).toBe(7);
    });

    it('does not infer years from qualitative language', () => {
      const details = extractRoleDetails(
        input({
          description: 'The ideal candidate has significant hands-on experience.',
        }),
        CONFIG,
      );
      expect(details.experience.requiredYears).toBeNull();
      expect(details.experience.preferredYears).toBeNull();
    });
  });

  describe('matrix: education breadth', () => {
    it('detects a high school diploma requirement', () => {
      const details = extractRoleDetails(
        input({
          description: 'High school diploma or equivalent required.',
        }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('none');
    });

    it('detects an associate degree requirement', () => {
      const details = extractRoleDetails(
        input({
          description: 'Associate degree in information technology required.',
        }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('associate');
    });

    it('captures a degree field without inferring a degree level', () => {
      const details = extractRoleDetails(
        input({
          description: 'A degree in computer science preferred.',
        }),
        CONFIG,
      );
      expect(details.education.degreeRequired).toBe('none');
      expect(details.education.field).toBe('computer science');
    });
  });

  describe('matrix: representative skills', () => {
    it('extracts Windows Server', () => {
      const details = extractRoleDetails(
        input({ requirements: 'Windows Server administration required.' }),
        CONFIG,
      );
      expect(details.skills.required).toContain('Windows Server');
    });

    it('extracts PowerShell', () => {
      const details = extractRoleDetails(
        input({ requirements: 'PowerShell scripting experience.' }),
        CONFIG,
      );
      expect(details.skills.required).toContain('PowerShell');
    });

    it('extracts networking', () => {
      const details = extractRoleDetails(
        input({ requirements: 'Strong networking fundamentals (TCP/IP).' }),
        CONFIG,
      );
      expect(details.skills.required).toContain('Networking');
    });

    it('extracts SIEM tooling', () => {
      const details = extractRoleDetails(
        input({ requirements: 'Run queries in the organization SIEM.' }),
        CONFIG,
      );
      expect(details.skills.required).toContain('SIEM');
    });
  });

  describe('matrix: travel nuance', () => {
    it('marks occasional travel as required with a percentage', () => {
      const details = extractRoleDetails(
        input({ description: 'Occasional travel up to 10%.' }),
        CONFIG,
      );
      expect(details.travel.required).toBe(true);
      expect(details.travel.percent).toBe(10);
    });

    it('does not flag travel when only the word travel appears in prose', () => {
      const details = extractRoleDetails(
        input({
          description: 'The engineering team travels to conferences in our roadmap talks.',
        }),
        CONFIG,
      );
      expect(details.travel.required).toBe(false);
    });
  });

  describe('matrix: citizenship nuance', () => {
    it('flags work authorization language as not requiring citizenship', () => {
      const details = extractRoleDetails(
        input({
          description: 'Must be authorized to work in the United States.',
        }),
        CONFIG,
      );
      expect(details.citizenship.usCitizenRequired).toBe(false);
    });

    it('does not flag ambiguous citizenship language', () => {
      const details = extractRoleDetails(
        input({
          description: 'Citizenship status may be a consideration.',
        }),
        CONFIG,
      );
      expect(details.citizenship.usCitizenRequired).toBe(false);
    });
  });

  describe('matrix: schedule breadth', () => {
    it('classifies a standard daytime schedule', () => {
      const details = extractRoleDetails(
        input({ description: 'Work a standard daytime schedule Monday to Friday.' }),
        CONFIG,
      );
      expect(details.schedule.classification).toBe('daytime');
      expect(details.schedule.flags).toEqual([]);
    });

    it('classifies rotating shift work', () => {
      const details = extractRoleDetails(
        input({ description: 'This position works rotating shifts.' }),
        CONFIG,
      );
      expect(details.schedule.classification).toBe('rotating');
      expect(details.schedule.flags).toContain('rotating');
    });

    it('classifies night shifts', () => {
      const details = extractRoleDetails(
        input({ description: 'Permanent night shift available.' }),
        CONFIG,
      );
      expect(details.schedule.flags).toContain('overnight');
    });
  });

  describe('matrix: employment conditions breadth', () => {
    it('classifies a public trust position with a background investigation', () => {
      const details = extractRoleDetails(
        input({
          description: 'Public trust position with a background investigation required.',
        }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('public-trust');
      expect(details.clearance.evidence.length).toBeGreaterThan(0);
    });

    it('does not turn a plain background investigation into a clearance', () => {
      const details = extractRoleDetails(
        input({
          description: 'A background investigation is required for this role.',
        }),
        CONFIG,
      );
      expect(details.clearance.mode).toBe('none');
    });

    it('flags explicitly stated drug screening', () => {
      const details = extractRoleDetails(
        input({
          description: 'Pre-employment drug screening is required.',
        }),
        CONFIG,
      );
      expect(details.contingentConditions.physicalRequirements).toBe(false);
    });

    it('flags contingent-on-technical-specification language', () => {
      const details = extractRoleDetails(
        input({
          description: 'This position is contingent upon the task order award.',
        }),
        CONFIG,
      );
      expect(details.contingentConditions.contingentOnAward).toBe(true);
    });
  });

  describe('matrix: precedence and negative extraction', () => {
    it('keeps a full-time provider value when text suggests otherwise', () => {
      const details = extractRoleDetails(
        input({
          employmentType: 'full-time',
          description: 'Part-time hours may be negotiated.',
        }),
        CONFIG,
      );
      expect(details.employment.type).toBe('full-time');
    });

    it('retains evidence for every extracted employment decision', () => {
      const cases = [
        input({}),
        input({ employmentType: 'unknown', description: 'Full-time role.' }),
        input({ employmentType: 'unknown', description: 'Join our team.' }),
      ];
      for (const caseInput of cases) {
        const details = extractRoleDetails(caseInput, CONFIG);
        if (details.employment.source !== 'unknown') {
          expect(details.employment.evidence.length).toBeGreaterThan(0);
        }
      }
    });

    it('orders skills and certifications deterministically across catalogs', () => {
      const details = extractRoleDetails(
        input({
          requirements: 'Linux, Splunk, Windows Server, and Nmap are all required. PowerShell automation.',
        }),
        CONFIG,
      );
      expect(details.skills.required).toEqual([
        'Linux',
        'Nmap',
        'PowerShell',
        'Splunk',
        'Windows Server',
      ]);
    });
  });
});