import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runMigrations } from '../src/db/migration-runner.js';
import { openDatabase } from '../src/db/database.js';
import { inspectJobNlp } from '../src/intelligence/nlp/inspector.js';
import { NLP_EXTRACTION_VERSION } from '../src/schemas/job-nlp.js';

const root = process.cwd();
const productionNlpFiles = [
  ...walk(join(root, 'src', 'intelligence', 'nlp')),
  join(root, 'src', 'schemas', 'job-nlp.ts'),
  join(root, 'src', 'database', 'jobNlpEnrichmentRepository.ts'),
  join(root, 'src', 'database', 'nlpRelevanceRepository.ts'),
  join(root, 'src', 'database', 'nlpComparisonRepository.ts'),
  ...walk(join(root, 'src', 'db', 'migrations')).filter((file) =>
    /0(?:31|32|33|34)_.*nlp.*\.sql$/.test(file),
  ),
];

describe('NLP security, privacy, and packaging audit (Stage 25)', () => {
  it('has no model, hosted AI, network, developer-path, or secret markers', () => {
    const contents = productionNlpFiles.map((file) =>
      readFileSync(file, 'utf8'),
    );
    const forbiddenPatterns = [
      /\b(?:openai|anthropic|cohere|huggingface|transformers|onnxruntime|tensorflow)\b/i,
      /\b(?:fetch|axios|XMLHttpRequest|WebSocket)\s*\(/,
      /https?:\/\//i,
      /(?:[A-Z]:\\(?:Users|Documents|Desktop)|\/(?:Users|home|private)\/)/,
      /(?:sk-[A-Za-z0-9]{12,}|AKIA[A-Z0-9]{12,}|BEGIN (?:RSA |EC )?PRIVATE KEY)/,
    ];

    for (const content of contents) {
      for (const pattern of forbiddenPatterns) {
        expect(content).not.toMatch(pattern);
      }
    }

    expect(
      productionNlpFiles.some((file) =>
        /\.(?:onnx|bin|safetensors|gguf|pt|pth)$/.test(file),
      ),
    ).toBe(false);
    const packageJson = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    expect(
      dependencyNames.filter((name) =>
        /(?:openai|anthropic|cohere|huggingface|transformers|onnxruntime|tensorflow)/i.test(
          name,
        ),
      ),
    ).toEqual([]);
  });

  it('keeps fresh NLP persistence neutral and preserves the separate shadow table', () => {
    const database = openDatabase(':memory:');
    try {
      runMigrations(database);
      for (const table of [
        'job_nlp_enrichments',
        'job_nlp_relevance',
        'job_nlp_comparisons',
      ]) {
        expect(
          database
            .prepare<
              [],
              { count: number }
            >('SELECT COUNT(*) AS count FROM ' + table)
            .get()?.count,
        ).toBe(0);
      }
      expect(
        database
          .prepare<[], { columns: number }>(
            `SELECT COUNT(*) AS columns FROM pragma_table_info('jobs')
             WHERE name IN ('score', 'recommendation', 'active', 'status')`,
          )
          .get()?.columns,
      ).toBe(4);
    } finally {
      database.close();
    }
  });

  it('redacts diagnostic values and leaves the production effect absent', () => {
    const inspection = inspectJobNlp('security-audit-job', {
      version: NLP_EXTRACTION_VERSION,
      generatedAt: '2026-09-10T00:00:00.000Z',
      sourceTextHash: 'hash-only',
      segmentation: { segments: [], method: 'segmentation-v1' },
      facts: [
        {
          factId: 'fact-email@example.com',
          category: 'skill',
          strength: 'required',
          entities: [
            {
              id: 'entity-555-123-4567',
              raw: 'email@example.com',
              normalized: '555-123-4567',
              type: 'text',
              confidence: 0.9,
              evidenceText: 'Contact email@example.com or 555-123-4567',
            },
          ],
          confidence: 0.9,
          extractionMethod: 'deterministic-pattern',
          extractionVersion: NLP_EXTRACTION_VERSION,
          evidence: {
            segmentText: 'Contact email@example.com or 555-123-4567',
            sourceField: 'description',
            segmentIndex: 0,
            charStart: 0,
            charEnd: 43,
          },
          conflict: {
            state: 'agreement',
            nature: [],
            deterministicValue: null,
            nlpValue: null,
            note: null,
          },
        },
      ],
    });

    expect(inspection.redactedValueCount).toBeGreaterThan(0);
    expect(JSON.stringify(inspection)).not.toContain('email@example.com');
    expect(JSON.stringify(inspection)).not.toContain('555-123-4567');
    expect(inspection).not.toHaveProperty('productionScore');
  });
});

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}
