export const RESUME_SNAPSHOT_SCHEMA_VERSION = 1;

export const RESUME_SNAPSHOT_PARSER_VERSION = 'resume-parser-v1';

export const RESUME_SNAPSHOT_NORMALIZATION_VERSION = 'resume-normalization-v1';

export const RESUME_SNAPSHOT_PARSING_STATUSES = ['parsed', 'failed'] as const;

export type ResumeSnapshotParsingStatus =
  (typeof RESUME_SNAPSHOT_PARSING_STATUSES)[number];

export const SNAPSHOT_MANAGED_DIRECTORY = 'snapshots';

export const SNAPSHOT_STAGING_DIRECTORY = 'tmp';

export const SNAPSHOT_QUARANTINE_DIRECTORY = 'quarantine';

export class ResumeSnapshotCaptureError extends Error {
  public constructor(
    message: string,
    public readonly code: string,
    options: ErrorOptions = {},
    public readonly status = 409,
  ) {
    super(message, options);
    this.name = 'ResumeSnapshotCaptureError';
  }
}

export class ResumeSnapshotIntegrityError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'ResumeSnapshotIntegrityError';
  }
}
