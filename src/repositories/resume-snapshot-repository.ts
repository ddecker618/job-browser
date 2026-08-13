import type { JobDatabase } from '../db/database.js';
import type { ResumeSnapshotParsingStatus } from '../domain/resume-snapshot.js';
import type {
  ResumeSnapshot,
  ResumeSnapshotCertification,
  ResumeSnapshotDetail,
  ResumeSnapshotInsertInput,
  ResumeSnapshotInterpretation,
  ResumeSnapshotSkill,
} from '../models/resume-snapshot.js';

interface ResumeSnapshotRow {
  id: string;
  source_resume_id: string | null;
  live_resume_id: string | null;
  content_hash: string;
  storage_key: string;
  original_filename: string;
  mime_type: string;
  extension: string;
  size_bytes: number;
  parser_version: string;
  normalization_version: string;
  parsing_status: string;
  parsing_error: string | null;
  reuse_key: string | null;
  created_at: string;
}

interface ResumeSnapshotInterpretationRow {
  id: string;
  snapshot_id: string;
  schema_version: number;
  parser_version: string;
  normalization_version: string;
  parsing_status: string;
  parsing_error: string | null;
  normalized_payload_json: string;
  created_at: string;
}

interface ResumeSnapshotSkillRow {
  interpretation_id: string;
  skill_id: string | null;
  raw_label: string;
  provenance: string;
}

interface ResumeSnapshotCertificationRow {
  interpretation_id: string;
  certification_id: string | null;
  raw_label: string;
  provenance: string;
}

export interface ResumeSnapshotArtifactRow {
  id: string;
  storageKey: string;
  contentHash: string;
  sizeBytes: number;
}

export class ResumeSnapshotRepository {
  public constructor(private readonly database: JobDatabase) {}

  public findById(id: string): ResumeSnapshotDetail | null {
    const row = this.database
      .prepare<
        [string],
        ResumeSnapshotRow
      >('SELECT * FROM resume_snapshots WHERE id = ?')
      .get(id);
    return row === undefined ? null : this.detail(row);
  }

  public findReusable(reuseKey: string): ResumeSnapshot | null {
    const row = this.database
      .prepare<
        [string],
        ResumeSnapshotRow
      >('SELECT * FROM resume_snapshots WHERE reuse_key = ?')
      .get(reuseKey);
    return row === undefined ? null : mapSnapshot(row);
  }

  public listStorageKeys(): string[] {
    return this.database
      .prepare<[], { storage_key: string }>(
        'SELECT storage_key FROM resume_snapshots',
      )
      .all()
      .map((row) => row.storage_key);
  }

  public listArtifacts(): ResumeSnapshotArtifactRow[] {
    const rows = this.database
      .prepare<
        [],
        {
          id: string;
          storage_key: string;
          content_hash: string;
          size_bytes: number;
        }
      >(
        `SELECT id, storage_key, content_hash, size_bytes
           FROM resume_snapshots`,
      )
      .all();
    return rows.map((row) => ({
      id: row.id,
      storageKey: row.storage_key,
      contentHash: row.content_hash,
      sizeBytes: row.size_bytes,
    }));
  }

  public insertSnapshot(input: ResumeSnapshotInsertInput): void {
    this.database
      .prepare(
        `INSERT INTO resume_snapshots (
          id, source_resume_id, live_resume_id, content_hash, storage_key,
          original_filename, mime_type, extension, size_bytes, parser_version,
          normalization_version, parsing_status, parsing_error, reuse_key,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.sourceResumeId,
        input.liveResumeId,
        input.contentHash,
        input.storageKey,
        input.originalFilename,
        input.mimeType,
        input.extension,
        input.sizeBytes,
        input.parserVersion,
        input.normalizationVersion,
        input.parsingStatus,
        input.parsingError,
        input.reuseKey,
        input.createdAt,
      );
    this.database
      .prepare(
        `INSERT INTO resume_snapshot_interpretations (
          id, snapshot_id, schema_version, parser_version,
          normalization_version, parsing_status, parsing_error,
          normalized_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.interpretationId,
        input.id,
        input.interpretationSchemaVersion,
        input.parserVersion,
        input.normalizationVersion,
        input.parsingStatus,
        input.parsingError,
        input.normalizedPayloadJson,
        input.createdAt,
      );
    const insertSkill = this.database.prepare(
      `INSERT INTO resume_snapshot_interpretation_skills (
        interpretation_id, skill_id, raw_label, provenance
      ) VALUES (?, ?, ?, ?)`,
    );
    for (const skill of input.skills) {
      insertSkill.run(
        input.interpretationId,
        skill.skillId,
        skill.rawLabel,
        skill.provenance,
      );
    }
    const insertCertification = this.database.prepare(
      `INSERT INTO resume_snapshot_interpretation_certifications (
        interpretation_id, certification_id, raw_label, provenance
      ) VALUES (?, ?, ?, ?)`,
    );
    for (const certification of input.certifications) {
      insertCertification.run(
        input.interpretationId,
        certification.certificationId,
        certification.rawLabel,
        certification.provenance,
      );
    }
  }

  private detail(row: ResumeSnapshotRow): ResumeSnapshotDetail {
    const interpretation = this.interpretation(row.id);
    if (interpretation === null) {
      throw new Error(
        `ResumeSnapshot ${row.id} is missing its capture-time interpretation`,
      );
    }
    return {
      ...mapSnapshot(row),
      interpretation,
    };
  }

  private interpretation(
    snapshotId: string,
  ): ResumeSnapshotInterpretation | null {
    const row = this.database
      .prepare<[string], ResumeSnapshotInterpretationRow>(
        `SELECT * FROM resume_snapshot_interpretations
          WHERE snapshot_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
      )
      .get(snapshotId);
    if (row === undefined) return null;
    const skills = this.database
      .prepare<[string], ResumeSnapshotSkillRow>(
        `SELECT interpretation_id, skill_id, raw_label, provenance
           FROM resume_snapshot_interpretation_skills
          WHERE interpretation_id = ?
          ORDER BY raw_label`,
      )
      .all(row.id)
      .map(mapSkill);
    const certifications = this.database
      .prepare<[string], ResumeSnapshotCertificationRow>(
        `SELECT interpretation_id, certification_id, raw_label, provenance
           FROM resume_snapshot_interpretation_certifications
          WHERE interpretation_id = ?
          ORDER BY raw_label`,
      )
      .all(row.id)
      .map(mapCertification);
    return {
      id: row.id,
      snapshotId: row.snapshot_id,
      schemaVersion: row.schema_version,
      parserVersion: row.parser_version,
      normalizationVersion: row.normalization_version,
      parsingStatus: parsingStatus(row.parsing_status),
      parsingError: row.parsing_error,
      skills,
      certifications,
      createdAt: row.created_at,
    };
  }
}

function mapSnapshot(row: ResumeSnapshotRow): ResumeSnapshot {
  return {
    id: row.id,
    sourceResumeId: row.source_resume_id,
    liveResumeId: row.live_resume_id,
    contentHash: row.content_hash,
    storageKey: row.storage_key,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    extension: row.extension,
    sizeBytes: row.size_bytes,
    parserVersion: row.parser_version,
    normalizationVersion: row.normalization_version,
    parsingStatus: parsingStatus(row.parsing_status),
    parsingError: row.parsing_error,
    reuseKey: row.reuse_key,
    createdAt: row.created_at,
  };
}

function mapSkill(row: ResumeSnapshotSkillRow): ResumeSnapshotSkill {
  return {
    rawLabel: row.raw_label,
    provenance: row.provenance,
    skillId: row.skill_id,
  };
}

function mapCertification(
  row: ResumeSnapshotCertificationRow,
): ResumeSnapshotCertification {
  return {
    rawLabel: row.raw_label,
    provenance: row.provenance,
    certificationId: row.certification_id,
  };
}

function parsingStatus(value: string): ResumeSnapshotParsingStatus {
  if (value !== 'parsed' && value !== 'failed') {
    throw new Error(`Invalid ResumeSnapshot parsing status: ${value}`);
  }
  return value;
}
