import type { JobDatabase } from '../database.js';
import type { EmployerSeed } from '../../models/employer.js';
import { EmployerRepository } from '../../repositories/employerRepository.js';

const CURATED_PROVENANCE = 'curated-starter-v1';

const CURATED_EMPLOYERS: readonly EmployerSeed[] = [
  seed('Adobe', 'https://www.adobe.com', 'https://careers.adobe.com/us/en'),
  seed(
    'Airbnb',
    'https://www.airbnb.com',
    'https://careers.airbnb.com/positions/',
  ),
  seed('Amazon', 'https://www.amazon.com', 'https://www.amazon.jobs/en/'),
  seed(
    'AMD',
    'https://www.amd.com',
    'https://careers.amd.com/careers-home/jobs',
  ),
  seed('Apple', 'https://www.apple.com', 'https://jobs.apple.com/en-us/search'),
  seed(
    'Atlassian',
    'https://www.atlassian.com',
    'https://www.atlassian.com/company/careers/all-jobs',
  ),
  seed('Cisco', 'https://www.cisco.com', 'https://jobs.cisco.com/'),
  seed(
    'Cloudflare',
    'https://www.cloudflare.com',
    'https://www.cloudflare.com/careers/jobs/',
  ),
  seed(
    'Datadog',
    'https://www.datadoghq.com',
    'https://careers.datadoghq.com/',
  ),
  seed('Dell Technologies', 'https://www.dell.com', 'https://jobs.dell.com/'),
  seed(
    'GitHub',
    'https://github.com',
    'https://www.github.careers/careers-home/jobs',
  ),
  seed(
    'Google',
    'https://www.google.com',
    'https://www.google.com/about/careers/applications/jobs/results/',
  ),
  seed('IBM', 'https://www.ibm.com', 'https://www.ibm.com/careers/search'),
  seed('Intel', 'https://www.intel.com', 'https://jobs.intel.com/'),
  seed('Meta', 'https://www.meta.com', 'https://www.metacareers.com/jobs/'),
  seed(
    'Microsoft',
    'https://www.microsoft.com',
    'https://jobs.careers.microsoft.com/global/en/search',
  ),
  seed(
    'MongoDB',
    'https://www.mongodb.com',
    'https://www.mongodb.com/company/careers/jobs',
  ),
  seed(
    'NVIDIA',
    'https://www.nvidia.com',
    'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
  ),
  seed(
    'Oracle',
    'https://www.oracle.com',
    'https://careers.oracle.com/en/sites/jobsearch/jobs',
  ),
  seed(
    'Salesforce',
    'https://www.salesforce.com',
    'https://careers.salesforce.com/en/jobs/',
  ),
  seed(
    'ServiceNow',
    'https://www.servicenow.com',
    'https://careers.servicenow.com/jobs/',
  ),
  seed(
    'Spotify',
    'https://www.spotify.com',
    'https://www.lifeatspotify.com/jobs',
  ),
  seed('Stripe', 'https://stripe.com', 'https://stripe.com/jobs/search'),
  seed(
    'Uber',
    'https://www.uber.com',
    'https://www.uber.com/us/en/careers/list/',
  ),
  seed(
    'Workday',
    'https://www.workday.com',
    'https://workday.wd5.myworkdayjobs.com/Workday',
  ),
];

const LEGACY_FIXTURES = [
  ['Acme Corporation', 'https://boards.greenhouse.io/acme'],
  ['Globex Corporation', 'https://jobs.lever.co/globex'],
  ['Initech', 'https://jobs.ashbyhq.com/initech'],
  ['Hooli', 'https://careers.smartrecruiters.com/hooli'],
  ['Umbrella Corp', 'https://www.umbrellacorp.com/careers'],
  ['Stark Industries', 'https://apply.workable.com/starkindustries'],
  ['Wayne Enterprises', 'https://wayne-enterprises.teamtailor.com'],
] as const;

export function seedEmployerRegistry(database: JobDatabase): void {
  const repository = new EmployerRepository(database);
  database.transaction(() => {
    retireLegacyFixtures(database, repository);
    repository.importSeeds(CURATED_EMPLOYERS);
  })();
}

function seed(
  name: string,
  websiteUrl: string,
  careerSiteUrl: string,
): EmployerSeed {
  return {
    name,
    websiteUrl,
    careerSiteUrls: [careerSiteUrl],
    provenance: CURATED_PROVENANCE,
  };
}

function retireLegacyFixtures(
  database: JobDatabase,
  repository: EmployerRepository,
): void {
  for (const [name, url] of LEGACY_FIXTURES) {
    const site = database
      .prepare<[string, string], { id: string; health_status: string }>(
        `SELECT cs.id, cs.health_status
           FROM career_sites cs
           JOIN employers e ON e.id = cs.employer_id
          WHERE e.normalized_name = ? AND cs.normalized_url = ?`,
      )
      .get(name.toLocaleLowerCase('en-US'), new URL(url).toString());
    if (site !== undefined && site.health_status !== 'retired') {
      repository.retireCareerSite(
        site.id,
        'Retired legacy fictional starter fixture; history retained',
      );
    }
  }
}
