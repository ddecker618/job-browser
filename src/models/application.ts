import type {
  ApplicationStatus,
  OccurrencePrecision,
} from '../domain/application-status.js';

export interface Application {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  appliedAt: string | null;
  appliedAtPrecision: OccurrencePrecision | null;
  lastEventAt: string | null;
  lastRecordedAt: string | null;
  titleAtApplication: string | null;
  companyAtApplication: string | null;
  companyId: string | null;
  locationAtApplication: string | null;
  applicationUrl: string | null;
  sourceId: string | null;
  providerId: string | null;
  sourceLabel: string | null;
  notes: string | null;
  legacyProvenance: string | null;
  submittedResumeSnapshotId: string | null;
  createdAt: string;
  updatedAt: string;
}
