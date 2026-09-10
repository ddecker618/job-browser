import type { JobDetail } from '../../models/dashboard.js';

type PreviewSource =
  | 'requirements'
  | 'preferred qualifications'
  | 'capability catalog';
type PreviewModality = 'required' | 'preferred' | 'mentioned';

interface PreviewRequirement {
  id: string;
  phrase: string;
  source: PreviewSource;
  modality: PreviewModality;
  interpretedAs: string;
}

export function JobIntelligencePreview({
  job,
}: {
  job: Pick<
    JobDetail,
    'requirements' | 'preferredQualifications' | 'skills' | 'certifications'
  >;
}) {
  const requirements = previewRequirements(job);
  const requiredCount = requirements.filter(
    (item) => item.modality === 'required',
  ).length;
  const preferredCount = requirements.filter(
    (item) => item.modality === 'preferred',
  ).length;
  const mentionedCount = requirements.filter(
    (item) => item.modality === 'mentioned',
  ).length;

  return (
    <section
      className="job-intelligence-preview"
      aria-labelledby="job-intelligence-preview-title"
    >
      <div className="job-intelligence-preview-heading">
        <div>
          <span className="eyebrow">Local shadow mode</span>
          <h3 id="job-intelligence-preview-title">Job Intelligence</h3>
          <p>
            A traceable preview of job requirements. Resume evidence is not
            connected in this prototype, so coverage remains unknown.
          </p>
        </div>
        <span className="job-intelligence-preview-status">Preview</span>
      </div>
      <div
        className="job-intelligence-preview-summary"
        aria-label="Job intelligence requirement summary"
      >
        <article>
          <span>Required</span>
          <strong>{requiredCount}</strong>
        </article>
        <article>
          <span>Preferred</span>
          <strong>{preferredCount}</strong>
        </article>
        <article>
          <span>Mentioned</span>
          <strong>{mentionedCount}</strong>
        </article>
        <article className="is-unknown">
          <span>Coverage unknown</span>
          <strong>{requirements.length}</strong>
        </article>
      </div>
      {requirements.length === 0 ? (
        <p className="job-intelligence-preview-empty">
          No requirement text or capability mentions are available for preview.
        </p>
      ) : (
        <div className="job-intelligence-preview-list">
          {requirements.map((requirement) => (
            <article key={requirement.id}>
              <div className="job-intelligence-preview-row">
                <strong>{requirement.phrase}</strong>
                <span className="job-intelligence-preview-unknown">
                  Unknown
                </span>
              </div>
              <p>
                Interpreted as: {requirement.interpretedAs}. Source:{' '}
                {requirement.source}.
              </p>
            </article>
          ))}
        </div>
      )}
      <p className="job-intelligence-preview-boundary">
        Shadow preview only. It does not change score, eligibility, ranking,
        filtering, lifecycle, or saved job data.
      </p>
    </section>
  );
}

function previewRequirements(
  job: Pick<
    JobDetail,
    'requirements' | 'preferredQualifications' | 'skills' | 'certifications'
  >,
): PreviewRequirement[] {
  const items: PreviewRequirement[] = [];
  addTextRequirements(
    items,
    job.requirements,
    'requirements',
    'required',
    'Job requirement statement',
  );
  addTextRequirements(
    items,
    job.preferredQualifications,
    'preferred qualifications',
    'preferred',
    'Preferred qualification statement',
  );
  for (const label of [...job.skills, ...job.certifications]) {
    const phrase = label.trim();
    if (phrase.length === 0 || items.some((item) => item.phrase === phrase)) {
      continue;
    }
    items.push({
      id: `capability-${String(items.length)}`,
      phrase,
      source: 'capability catalog',
      modality: 'mentioned',
      interpretedAs: 'Catalog capability mention',
    });
  }
  return items;
}

function addTextRequirements(
  items: PreviewRequirement[],
  text: string | null,
  source: Exclude<PreviewSource, 'capability catalog'>,
  modality: Exclude<PreviewModality, 'mentioned'>,
  interpretedAs: string,
): void {
  if (text === null) return;
  for (const phrase of text
    .split(/\r?\n|[.;](?=\s+)/)
    .map((item) =>
      item
        .replace(/^\s*(?:[-*•▪◦]|\d{1,2}[.)])\s*/, '')
        .replace(/[.;:]$/, '')
        .trim(),
    )
    .filter((item) => item.length > 0)) {
    if (items.some((item) => item.phrase === phrase)) continue;
    items.push({
      id: `${source}-${String(items.length)}`,
      phrase,
      source,
      modality,
      interpretedAs,
    });
  }
}
