import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '../api.js';
import { PageHeader } from '../components/PageHeader.js';
import { EmptyState, ErrorState, LoadingState } from '../components/States.js';
import { invalidateScoreQueries } from '../scoreCache.js';

export function ResumesPage() {
  const resumes = useQuery({ queryKey: ['resumes'], queryFn: api.resumes });
  const client = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const invalidate = () => client.invalidateQueries({ queryKey: ['resumes'] });
  const upload = useMutation({
    mutationFn: () => {
      if (file === null) throw new Error('Select a resume first');
      const form = new FormData();
      form.append('resume', file);
      form.append('displayName', displayName || file.name);
      return api.uploadResume(form);
    },
    onSuccess: () => {
      setFile(null);
      setDisplayName('');
      void invalidate();
    },
  });
  const update = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { displayName?: string; isDefault?: boolean };
    }) => api.updateResume(id, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: api.deleteResume,
    onSuccess: invalidate,
  });
  const review = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: 'approved' | 'rejected';
    }) => api.reviewProposal(id, status),
    onSuccess: invalidate,
  });
  const reviewAll = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: 'approved' | 'rejected';
    }) => api.reviewAllProposals(id, status),
    onSuccess: invalidate,
  });
  const rescore = useMutation({
    mutationFn: api.rescoreResume,
    onSuccess: () => invalidateScoreQueries(client),
  });

  if (resumes.isPending) return <LoadingState label="Loading resumes" />;
  if (resumes.isError)
    return (
      <ErrorState error={resumes.error} title="Resume library unavailable" />
    );

  return (
    <>
      <PageHeader
        eyebrow="Career assets"
        title="Resume library"
        description="Manage resume variants, review extracted qualifications, and choose the default analysis context."
      />
      <section className="upload-panel" aria-label="Upload resume">
        <div>
          <h3>Upload a resume</h3>
          <p>
            Text files are parsed locally. PDF and DOCX files are retained with
            pending parsing status.
          </p>
        </div>
        <input
          aria-label="Resume display name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="Display name"
        />
        <label className="file-picker" htmlFor="resume-file-input">
          {file?.name ?? 'Choose file'}
          <input
            id="resume-file-input"
            aria-label="Resume file"
            type="file"
            accept=".pdf,.doc,.docx,.txt,.md"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              upload.reset();
            }}
          />
        </label>
        <button
          type="button"
          className="button primary"
          disabled={file === null || upload.isPending}
          onClick={() => upload.mutate()}
        >
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </section>
      {upload.isError ? (
        <p className="source-error" role="alert">
          {upload.error instanceof Error
            ? upload.error.message
            : 'Resume upload failed. Please try again.'}
        </p>
      ) : null}
      {resumes.data.length === 0 ? (
        <EmptyState title="No resumes yet">
          Upload a resume to create your local resume library.
        </EmptyState>
      ) : (
        <div className="resume-grid">
          {resumes.data.map((resume) => (
            <article className="resume-card" key={resume.id}>
              <div className="resume-card-head">
                <div className="file-icon">CV</div>
                <div>
                  <h3>{resume.displayName}</h3>
                  <p>
                    {resume.originalFilename} ·{' '}
                    {(resume.sizeBytes / 1024).toFixed(1)} KB
                  </p>
                </div>
                {resume.isDefault ? (
                  <span className="default-badge">Default</span>
                ) : null}
              </div>
              <div className="resume-meta">
                <span className={`parse-status ${resume.parsingStatus}`}>
                  {resume.parsingStatus}
                </span>
                <span>
                  Updated {new Date(resume.updatedAt).toLocaleDateString()}
                </span>
              </div>
              {resume.parsingError === null ? null : (
                <p className="source-error" role="alert">
                  {resume.parsingError}
                </p>
              )}
              <div>
                <h4>Extracted skills</h4>
                <div className="tag-list">
                  {resume.extractedSkills.length === 0 ? (
                    <span>None yet</span>
                  ) : (
                    resume.extractedSkills.map((skill) => (
                      <span key={skill}>{skill}</span>
                    ))
                  )}
                </div>
              </div>
              <div>
                <h4>Certifications</h4>
                <div className="tag-list">
                  {resume.extractedCertifications.length === 0 ? (
                    <span>None yet</span>
                  ) : (
                    resume.extractedCertifications.map((certification) => (
                      <span key={certification}>{certification}</span>
                    ))
                  )}
                </div>
              </div>
              {resume.proposals.some(
                (proposal) => proposal.status === 'pending',
              ) ? (
                <div className="proposal-list">
                  <div className="proposal-heading">
                    <h4>Proposed profile changes</h4>
                    <div>
                      <button
                        onClick={() =>
                          reviewAll.mutate({
                            id: resume.id,
                            status: 'approved',
                          })
                        }
                      >
                        Approve all
                      </button>
                      <button
                        onClick={() =>
                          reviewAll.mutate({
                            id: resume.id,
                            status: 'rejected',
                          })
                        }
                      >
                        Reject all
                      </button>
                    </div>
                  </div>
                  {resume.proposals
                    .filter((proposal) => proposal.status === 'pending')
                    .map((proposal) => (
                      <div key={proposal.id}>
                        <span>
                          <strong>{proposal.proposedValue}</strong>
                          <small>{proposal.fieldName}</small>
                        </span>
                        <button
                          aria-label={`Approve ${proposal.proposedValue}`}
                          onClick={() =>
                            review.mutate({
                              id: proposal.id,
                              status: 'approved',
                            })
                          }
                        >
                          ✓
                        </button>
                        <button
                          aria-label={`Reject ${proposal.proposedValue}`}
                          onClick={() =>
                            review.mutate({
                              id: proposal.id,
                              status: 'rejected',
                            })
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                </div>
              ) : null}
              <div className="card-actions">
                <button
                  onClick={() => {
                    const name = window.prompt(
                      'Rename resume',
                      resume.displayName,
                    );
                    if (name)
                      update.mutate({
                        id: resume.id,
                        body: { displayName: name },
                      });
                  }}
                >
                  Rename
                </button>
                {resume.isDefault ? null : (
                  <button
                    onClick={() =>
                      update.mutate({
                        id: resume.id,
                        body: { isDefault: true },
                      })
                    }
                  >
                    Set default
                  </button>
                )}
                <button onClick={() => rescore.mutate(resume.id)}>
                  Re-score jobs
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    if (window.confirm('Delete this resume?'))
                      remove.mutate(resume.id);
                  }}
                >
                  Delete
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
