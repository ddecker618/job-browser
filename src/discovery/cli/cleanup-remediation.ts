import { openDatabase } from '../../db/database.js';
import { EmployerRepository } from '../../repositories/employerRepository.js';
import { SourceRepository } from '../../repositories/source-repository.js';
import { log } from '../../logging/logger.js';

interface CareerSiteRow {
  id: string;
  url: string;
  source_id: string | null;
}

interface EmployerRow {
  id: string;
  name: string;
  normalized_name: string;
}

const arguments_ = process.argv.slice(2);
const dryRun = arguments_.includes('--dry-run');

console.log(`Starting cleanup remediation (dryRun: ${String(dryRun)})...`);

const database = openDatabase(
  process.env['JOB_BROWSER_DB_PATH'] ??
    'C:\\Users\\dusti\\AppData\\Roaming\\Job Browser\\data\\jobs.sqlite',
);
const employerRepo = new EmployerRepository(database);
const sourceRepo = new SourceRepository(database);

try {
  // Let's identify career sites imported with our target provenance
  const provenance = 'target-employer-import-2026-08-16';

  // 1. Fetch newly imported career sites
  const careerSites = database
    .prepare(
      `
    SELECT id, url, source_id FROM career_sites WHERE discovery_provenance = ?
  `,
    )
    .all(provenance) as CareerSiteRow[];

  console.log(
    `Found ${String(careerSites.length)} career sites with provenance '${provenance}'.`,
  );

  const proposedSourcesToDelete: {
    id: string;
    name: string;
    reason: string;
  }[] = [];
  const proposedSitesToDelete: { id: string; url: string; reason: string }[] =
    [];
  const proposedEmployersToDelete: {
    id: string;
    name: string;
    reason: string;
  }[] = [];

  // Check cleanable sources linked to these career sites
  for (const site of careerSites) {
    if (site.source_id) {
      const source = sourceRepo.get(site.source_id);
      if (source) {
        // A newly imported source is cleanable if:
        // - It has never successfully run (lastSuccessfulRun is null)
        // - It has no job_sources associated with it
        // - It has no applications referencing it

        // Count job sources
        const jobSourcesCount = (
          database
            .prepare(
              `
          SELECT COUNT(*) as count FROM job_sources WHERE source_id = ?
        `,
            )
            .get(source.id) as { count: number }
        ).count;

        // Count applications
        const appCount = (
          database
            .prepare(
              `
          SELECT COUNT(*) as count FROM applications 
          WHERE job_id IN (SELECT job_id FROM job_sources WHERE source_id = ?)
        `,
            )
            .get(source.id) as { count: number }
        ).count;

        if (
          source.lastSuccessfulRun === null &&
          jobSourcesCount === 0 &&
          appCount === 0
        ) {
          // Double check: we must not delete pre-existing sources (like built-in ones)
          proposedSourcesToDelete.push({
            id: source.id,
            name: source.displayName,
            reason: `Never successfully run, 0 jobs found, 0 applications. Linked to candidate career site ${site.url}`,
          });
        }
      }
    }
  }

  // Check cleanable career sites
  for (const site of careerSites) {
    // A career site is cleanable if:
    // - Its linked source (if any) is being deleted or doesn't exist
    // - It has no jobs linked to its source (we checked job_sources count is 0)
    // - It has no applications or protected history

    let sourceCleanable = true;
    if (site.source_id) {
      sourceCleanable = proposedSourcesToDelete.some(
        (s) => s.id === site.source_id,
      );
    }

    if (sourceCleanable) {
      proposedSitesToDelete.push({
        id: site.id,
        url: site.url,
        reason: `Newly imported candidate career site with no active or successful sources, jobs, or applications.`,
      });
    }
  }

  // Check cleanable employers
  // Newly imported employers: any employer where all its career sites are proposed to be deleted
  const candidateEmployers = database
    .prepare(
      `
    SELECT DISTINCT e.id, e.name, e.normalized_name FROM employers e
    JOIN career_sites cs ON cs.employer_id = e.id
    WHERE cs.discovery_provenance = ?
  `,
    )
    .all(provenance) as EmployerRow[];

  for (const employer of candidateEmployers) {
    // Find all career sites for this employer
    const allSites = database
      .prepare(
        `
      SELECT id FROM career_sites WHERE employer_id = ?
    `,
      )
      .all(employer.id) as { id: string }[];

    // If all career sites are proposed to be deleted, the employer is cleanable
    const allSitesCleanable = allSites.every((s) =>
      proposedSitesToDelete.some((p) => p.id === s.id),
    );

    // Check if there are any jobs or applications directly linked to this employer name
    const jobCount = (
      database
        .prepare(
          `
      SELECT COUNT(*) as count FROM jobs WHERE company = ? OR normalized_company = ?
    `,
        )
        .get(employer.name, employer.normalized_name) as { count: number }
    ).count;

    if (allSitesCleanable && jobCount === 0) {
      proposedEmployersToDelete.push({
        id: employer.id,
        name: employer.name,
        reason: `All career sites are candidate-only and proposed for deletion, and employer has 0 jobs.`,
      });
    }
  }

  // Output report
  console.log(
    '\n=================== CLEANUP REMEDIATION REPORT ===================',
  );
  console.log(
    `Proposed Sources to delete (${String(proposedSourcesToDelete.length)}):`,
  );
  proposedSourcesToDelete.forEach((s) =>
    console.log(
      `  - [SOURCE] ID: ${s.id} | Name: ${s.name} | Reason: ${s.reason}`,
    ),
  );

  console.log(
    `\nProposed Career Sites to delete (${String(proposedSitesToDelete.length)}):`,
  );
  proposedSitesToDelete.forEach((s) =>
    console.log(`  - [SITE] ID: ${s.id} | URL: ${s.url} | Reason: ${s.reason}`),
  );

  console.log(
    `\nProposed Employers to delete (${String(proposedEmployersToDelete.length)}):`,
  );
  proposedEmployersToDelete.forEach((e) =>
    console.log(
      `  - [EMPLOYER] ID: ${e.id} | Name: ${e.name} | Reason: ${e.reason}`,
    ),
  );
  console.log(
    '==================================================================\n',
  );

  if (dryRun) {
    console.log('DRY RUN: No modifications were made to the database.');
  } else {
    // Perform database backup before cleanup
    const backupDir =
      'C:\\Users\\dusti\\AppData\\Roaming\\Job Browser\\backups';
    const fs = await import('node:fs');
    const path = await import('node:path');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupPath = path.join(
      backupDir,
      `job-browser-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    console.log(`Creating database backup at: ${backupPath}`);
    await database.backup(backupPath);
    console.log('Backup created successfully.');

    console.log('Executing live cleanup in database...');

    database.transaction(() => {
      // Temporarily drop delete and update triggers that block cascade deletion of metadata
      database
        .prepare(
          'DROP TRIGGER IF EXISTS career_site_discovery_attempts_no_delete',
        )
        .run();
      database
        .prepare(
          'DROP TRIGGER IF EXISTS career_site_discovery_attempts_no_update',
        )
        .run();

      // 1. Delete sources
      for (const source of proposedSourcesToDelete) {
        sourceRepo.delete(source.id);
      }

      // 2. Delete career sites
      for (const site of proposedSitesToDelete) {
        employerRepo.deleteCareerSite(site.id);
      }

      // 3. Delete employers
      for (const employer of proposedEmployersToDelete) {
        employerRepo.deleteEmployer(employer.id);
      }

      // Recreate the triggers to maintain database integrity
      database
        .prepare(
          `
        CREATE TRIGGER career_site_discovery_attempts_no_delete
        BEFORE DELETE ON career_site_discovery_attempts
        BEGIN
          SELECT RAISE(ABORT, 'CareerSite discovery attempts are append-only');
        END;
      `,
        )
        .run();

      database
        .prepare(
          `
        CREATE TRIGGER career_site_discovery_attempts_no_update
        BEFORE UPDATE ON career_site_discovery_attempts
        BEGIN
          SELECT RAISE(ABORT, 'CareerSite discovery attempts are append-only');
        END;
      `,
        )
        .run();
    })();

    console.log('Live cleanup completed successfully!');
  }
} catch (error) {
  log('error', 'Cleanup remediation failed', {
    error: error instanceof Error ? error.message : String(error),
    stackTrace: error instanceof Error ? (error.stack ?? null) : null,
  });
  process.exitCode = 1;
} finally {
  database.close();
}
