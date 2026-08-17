import { describe, expect, it } from 'vitest';

import {
  EMPLOYER_MANIFEST_VERSION,
  type EmployerManifest,
  type EmployerManifestRow,
} from '../src/models/employer-manifest.js';
import {
  EMPLOYER_MANIFEST_MAX_ROWS,
  parseEmployerManifest,
  validateEmployerManifest,
} from '../src/schemas/employer-manifest.js';

function manifest(imports: EmployerManifestRow[]): EmployerManifest {
  return { version: EMPLOYER_MANIFEST_VERSION, imports };
}

function oversizedImports(): EmployerManifestRow[] {
  return Array.from({ length: EMPLOYER_MANIFEST_MAX_ROWS + 1 }, (_, index) => ({
    employerName: `Employer ${String(index)}`,
    rootDomain: `employer-${String(index)}.com`,
    provenance: 'test',
    enabled: false,
  }));
}

describe('employer manifest JSON parsing', () => {
  it('parses a valid JSON manifest', () => {
    const parsed = parseEmployerManifest({
      format: 'json',
      contents: JSON.stringify(
        manifest([
          {
            employerName: 'Acme',
            careersUrl: 'https://boards.greenhouse.io/acme',
            provenance: 'test',
            enabled: true,
          },
        ]),
      ),
    });
    expect(parsed.version).toBe(EMPLOYER_MANIFEST_VERSION);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.invalidRows).toHaveLength(0);
    expect(parsed.rows[0]!.row).toMatchObject({
      employerName: 'Acme',
      careersUrl: 'https://boards.greenhouse.io/acme',
      provenance: 'test',
      enabled: true,
    });
  });

  it('defaults enabled to false', () => {
    const parsed = validateEmployerManifest(
      manifest([
        { rootDomain: 'acme.com', provenance: 'test', enabled: false },
      ]),
    );
    expect(parsed.rows[0]!.row.enabled).toBe(false);
  });

  it('collects rows missing every identity field as invalid', () => {
    const parsed = validateEmployerManifest(
      manifest([
        { provenance: 'test', enabled: false },
        { rootDomain: 'acme.com', provenance: 'test', enabled: false },
      ]),
    );
    expect(parsed.invalidRows).toHaveLength(1);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.invalidRows[0]!.reason).toMatch(/At least one of/);
  });

  it('rejects malformed JSON', () => {
    expect(() =>
      parseEmployerManifest({ format: 'json', contents: '{bad' }),
    ).toThrow(/not valid JSON/);
  });

  it('rejects JSON manifests that exceed the row cap', () => {
    expect(() =>
      parseEmployerManifest({
        format: 'json',
        contents: JSON.stringify(manifest(oversizedImports())),
      }),
    ).toThrow(/exceeds the maximum of 5,000 import rows/);
    expect(() =>
      validateEmployerManifest(manifest(oversizedImports())),
    ).toThrow(/exceeds the maximum of 5,000 import rows/);
  });

  it('rejects non-object manifests', () => {
    expect(() =>
      parseEmployerManifest({ format: 'json', contents: '[1,2,3]' }),
    ).toThrow(/must be a JSON object/);
  });

  it('rejects wrong versions and missing imports', () => {
    expect(() =>
      parseEmployerManifest({
        format: 'json',
        contents: JSON.stringify({ version: 'other', imports: [] }),
      }),
    ).toThrow(/version must be/);
    expect(() =>
      parseEmployerManifest({
        format: 'json',
        contents: JSON.stringify({ version: EMPLOYER_MANIFEST_VERSION }),
      }),
    ).toThrow(/imports/);
  });
});

describe('employer manifest CSV parsing', () => {
  const HEADER = [
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
  ].join(',');

  it('parses a valid CSV manifest', () => {
    const contents = [
      HEADER,
      `${EMPLOYER_MANIFEST_VERSION},Acme,,https://boards.greenhouse.io/acme,,,test,,,true`,
    ].join('\n');
    const parsed = parseEmployerManifest({ format: 'csv', contents });
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({
      index: 1,
      row: {
        employerName: 'Acme',
        careersUrl: 'https://boards.greenhouse.io/acme',
        provenance: 'test',
        enabled: true,
      },
    });
  });

  it('handles quoted fields containing commas', () => {
    const contents = [
      HEADER,
      `${EMPLOYER_MANIFEST_VERSION},"Acme, Inc.",,https://boards.greenhouse.io/acme,,,test,,,false`,
    ].join('\n');
    const parsed = parseEmployerManifest({ format: 'csv', contents });
    expect(parsed.rows[0]!.row.employerName).toBe('Acme, Inc.');
  });

  it('treats true/1/yes as enabled and false/0/no as disabled', () => {
    const contents = [
      HEADER,
      `${EMPLOYER_MANIFEST_VERSION},Acme,,https://boards.greenhouse.io/acme,,,test,,,1`,
      `${EMPLOYER_MANIFEST_VERSION},Globex,,https://jobs.lever.co/globex,,,test,,,no`,
      `${EMPLOYER_MANIFEST_VERSION},Initech,,https://jobs.ashbyhq.com/initech,,,test,,,`,
    ].join('\n');
    const parsed = parseEmployerManifest({ format: 'csv', contents });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[0]!.row.enabled).toBe(true);
    expect(parsed.rows[1]!.row.enabled).toBe(false);
    expect(parsed.rows[2]!.row.enabled).toBe(false);
  });

  it('rejects a missing required column', () => {
    const contents = 'version,employerName,rootDomain,careersUrl,enabled\n';
    expect(() => parseEmployerManifest({ format: 'csv', contents })).toThrow(
      /provenance/,
    );
  });

  it('rejects rows with the wrong version', () => {
    const contents = [
      HEADER,
      `other,Acme,,https://boards.greenhouse.io/acme,,,test,,,false`,
    ].join('\n');
    expect(() => parseEmployerManifest({ format: 'csv', contents })).toThrow(
      /version/,
    );
  });

  it('rejects rows with an invalid enabled value', () => {
    const contents = [
      HEADER,
      `${EMPLOYER_MANIFEST_VERSION},Acme,,https://boards.greenhouse.io/acme,,,test,,,maybe`,
    ].join('\n');
    expect(() => parseEmployerManifest({ format: 'csv', contents })).toThrow(
      /enabled/,
    );
  });

  it('rejects an empty CSV', () => {
    expect(() =>
      parseEmployerManifest({ format: 'csv', contents: '' }),
    ).toThrow(/empty/);
  });

  it('rejects CSV manifests that exceed the row cap', () => {
    const contents = [
      HEADER,
      ...oversizedImports().map(
        (row) =>
          `${EMPLOYER_MANIFEST_VERSION},${row.employerName ?? ''},${row.rootDomain ?? ''},,,,test,,,false`,
      ),
    ].join('\n');
    expect(() => parseEmployerManifest({ format: 'csv', contents })).toThrow(
      /exceeds the maximum of 5,000 import rows/,
    );
  });
});
