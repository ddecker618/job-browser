import { Link } from 'react-router';

export function FirstRunPanel({ hasSources }: { hasSources: boolean }) {
  return (
    <section className="first-run" aria-label="Getting started">
      <div className="first-run-hero">
        <span className="eyebrow">Welcome to Job Browser</span>
        <h2>Set up discovery in three steps</h2>
        <p>
          Connect the job boards you trust, let discovery run on its own
          schedule, and review the strongest matches in one place.
        </p>
        <div className="first-run-actions">
          <Link className="button primary" to="/sources">
            {hasSources ? 'Manage sources' : 'Add your first source'}
          </Link>
          {hasSources ? (
            <Link className="button" to="/employers">
              Open discovery control
            </Link>
          ) : (
            <Link className="button" to="/jobs">
              Review jobs
            </Link>
          )}
        </div>
      </div>
      <ol className="first-run-steps">
        <li>
          <span className="first-run-step-number">1</span>
          <div>
            <strong>Add sources</strong>
            <p>
              Link public job boards and ATS career pages. Browser-backed
              sources open a login window on first use.
            </p>
          </div>
        </li>
        <li>
          <span className="first-run-step-number">2</span>
          <div>
            <strong>Let discovery run</strong>
            <p>
              Enabled sources run on your schedule. Matches are deduplicated and
              scored against your profile automatically.
            </p>
          </div>
        </li>
        <li>
          <span className="first-run-step-number">3</span>
          <div>
            <strong>Review and apply</strong>
            <p>
              Prioritize by match score, track applications, and keep the
              strongest opportunities front and center.
            </p>
          </div>
        </li>
      </ol>
    </section>
  );
}
