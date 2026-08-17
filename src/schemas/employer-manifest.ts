import { z } from 'zod';

import {
  EMPLOYER_MANIFEST_VERSION,
  type EmployerManifest,
  type EmployerManifestRow,
} from '../models/employer-manifest.js';

export const EMPLOYER_MANIFEST_MAX_ROWS = 5_000;

export const employerManifestRowSchema = z
  .strictObject({
    employerName: z.string().trim().min(1).max(120).optional(),
    rootDomain: z.string().trim().min(1).max(255).optional(),
    careersUrl: z.string().trim().min(1).max(2_048).optional(),
    expectedAtsFamily: z.string().trim().min(1).max(60).optional(),
    atsTenant: z.string().trim().min(1).max(200).optional(),
    provenance: z.string().trim().min(1).max(120),
    batchId: z.string().trim().min(1).max(120).optional(),
    notes: z.string().trim().min(1).max(500).optional(),
    enabled: z.boolean().default(false),
  })
  .superRefine((row, context) => {
    if (
      row.employerName === undefined &&
      row.rootDomain === undefined &&
      row.careersUrl === undefined
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'At least one of employerName, rootDomain, or careersUrl is required',
      });
    }
  });

export const employerManifestSchema = z.strictObject({
  version: z.literal(EMPLOYER_MANIFEST_VERSION),
  imports: z.array(employerManifestRowSchema).max(EMPLOYER_MANIFEST_MAX_ROWS),
});

export interface ParsedEmployerManifestRow {
  row: EmployerManifestRow;
  index: number;
}

export interface EmployerManifestParseResult {
  version: typeof EMPLOYER_MANIFEST_VERSION;
  rows: ParsedEmployerManifestRow[];
  invalidRows: { index: number; reason: string }[];
}

const REQUIRED_CSV_COLUMNS = ['version', 'provenance'] as const;
const CSV_COLUMNS = [
  'version',
  'employerName',
  'rootDomain',
  'careersUrl',
  'expectedAtsFamily',
  'atsTenant',
  'provenance',
  'batchId',
  'notes',
  'enabled',
] as const;

export function parseEmployerManifest(input: {
  format: 'json' | 'csv';
  contents: string;
}): EmployerManifestParseResult {
  if (input.format === 'csv') {
    return parseCsvManifest(input.contents);
  }
  return parseJsonManifest(input.contents);
}

export function validateEmployerManifest(
  manifest: EmployerManifest,
): EmployerManifestParseResult {
  const rows = validateRows(manifest.imports);
  return { version: EMPLOYER_MANIFEST_VERSION, ...rows };
}

function parseJsonManifest(contents: string): EmployerManifestParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new Error(
      `Employer manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const candidate = parsed as {
    version?: unknown;
    imports?: unknown;
  };
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Employer manifest must be a JSON object');
  }
  if (candidate.version !== EMPLOYER_MANIFEST_VERSION) {
    throw new Error(
      `Employer manifest version must be ${EMPLOYER_MANIFEST_VERSION}`,
    );
  }
  if (!Array.isArray(candidate.imports)) {
    throw new Error('Employer manifest must contain an "imports" array');
  }
  const rows = validateRows(candidate.imports as readonly unknown[]);
  return { version: EMPLOYER_MANIFEST_VERSION, ...rows };
}

function parseCsvManifest(contents: string): EmployerManifestParseResult {
  const records = parseCsvRecords(contents);
  if (records.length === 0) {
    throw new Error('Employer manifest CSV is empty');
  }
  const first = records[0];
  if (first === undefined) {
    throw new Error('Employer manifest CSV is missing its header row');
  }
  const header = first.map((cell) => cell.trim().toLowerCase());
  for (const required of REQUIRED_CSV_COLUMNS) {
    if (!header.includes(required)) {
      throw new Error(
        `Employer manifest CSV is missing the required "${required}" column`,
      );
    }
  }
  const columnIndex = new Map<string, number>();
  for (const column of CSV_COLUMNS) {
    const index = header.indexOf(column.toLowerCase());
    if (index >= 0) columnIndex.set(column.toLowerCase(), index);
  }
  const cell = (row: string[], column: string): string | undefined => {
    const index = columnIndex.get(column.toLowerCase());
    return index === undefined ? undefined : (row[index] ?? '').trim();
  };
  const rows: EmployerManifestRow[] = [];
  for (let index = 1; index < records.length; index += 1) {
    const record = records[index];
    if (record === undefined) continue;
    if (record.every((value) => value.trim() === '')) continue;
    const version = cell(record, 'version');
    if (version !== EMPLOYER_MANIFEST_VERSION) {
      throw new Error(
        `Employer manifest CSV row ${String(index + 1)} has version "${version ?? ''}"; expected ${EMPLOYER_MANIFEST_VERSION}`,
      );
    }
    const enabledCell = cell(record, 'enabled');
    let enabled: boolean;
    if (enabledCell === undefined || enabledCell === '') {
      enabled = false;
    } else if (['true', '1', 'yes'].includes(enabledCell.toLowerCase())) {
      enabled = true;
    } else if (['false', '0', 'no'].includes(enabledCell.toLowerCase())) {
      enabled = false;
    } else {
      throw new Error(
        `Employer manifest CSV row ${String(index + 1)} has an invalid enabled value "${enabledCell}"`,
      );
    }
    const row: EmployerManifestRow = {
      employerName: optionalCell(cell(record, 'employerName')),
      rootDomain: optionalCell(cell(record, 'rootDomain')),
      careersUrl: optionalCell(cell(record, 'careersUrl')),
      expectedAtsFamily: optionalCell(cell(record, 'expectedAtsFamily')),
      atsTenant: optionalCell(cell(record, 'atsTenant')),
      provenance: cell(record, 'provenance') ?? '',
      batchId: optionalCell(cell(record, 'batchId')),
      notes: optionalCell(cell(record, 'notes')),
      enabled,
    };
    rows.push(row);
  }
  return { version: EMPLOYER_MANIFEST_VERSION, ...validateRows(rows, 1) };
}

function validateRows(
  rows: readonly unknown[],
  rowOffset = 0,
): {
  rows: ParsedEmployerManifestRow[];
  invalidRows: { index: number; reason: string }[];
} {
  if (rows.length > EMPLOYER_MANIFEST_MAX_ROWS) {
    throw new Error(
      `Employer manifest exceeds the maximum of ${EMPLOYER_MANIFEST_MAX_ROWS.toLocaleString('en-US')} import rows (received ${rows.length.toLocaleString('en-US')})`,
    );
  }
  const valid: ParsedEmployerManifestRow[] = [];
  const invalidRows: { index: number; reason: string }[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const sourceIndex = index + rowOffset;
    const result = employerManifestRowSchema.safeParse(rows[index]);
    if (!result.success) {
      invalidRows.push({
        index: sourceIndex,
        reason: z.prettifyError(result.error),
      });
      continue;
    }
    valid.push({ row: result.data, index: sourceIndex });
  }
  return { rows: valid, invalidRows };
}

function optionalCell(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function parseCsvRecords(contents: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let inQuotes = false;
  const text = contents.replace(/^\uFEFF/, '');
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      inQuotes = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else {
      field += character;
    }
  }
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}
