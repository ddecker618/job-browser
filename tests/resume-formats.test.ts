import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import JSZip from 'jszip';
import { afterEach, describe, expect, it } from 'vitest';

import { loadCandidateProfile } from '../src/config/candidate-profile.js';
import { loadScoringConfig } from '../src/config/scoring-config.js';
import { extractResume } from '../src/resumes/resumeService.js';

let directory = '';
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  directory = '';
});

describe('local resume parsing', () => {
  it.each(['txt', 'md'])('retains %s extraction', async (extension) => {
    const path = temporary(`resume.${extension}`);
    writeFileSync(path, 'Splunk Linux CompTIA Security+');
    const result = await parse(path);
    expect(result.parsingStatus).toBe('parsed');
    expect(result.skills).toEqual(expect.arrayContaining(['Splunk', 'Linux']));
  });

  it('parses text-based PDF files and rejects scanned PDFs without OCR', async () => {
    const textPdf = temporary('resume.pdf');
    writeFileSync(textPdf, minimalPdf('Splunk Linux Security+'));
    expect((await parse(textPdf)).parsingStatus).toBe('parsed');
    const emptyPdf = temporary('scan.pdf');
    writeFileSync(emptyPdf, minimalPdf(''));
    const failed = await parse(emptyPdf);
    expect(failed.parsingStatus).toBe('failed');
    expect(failed.parsingError).toContain('OCR');
  });

  it('parses DOCX files locally', async () => {
    const path = temporary('resume.docx');
    const zip = new JSZip();
    zip.file(
      '[Content_Types].xml',
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    );
    zip
      .folder('_rels')
      ?.file(
        '.rels',
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      );
    zip
      .folder('word')
      ?.file(
        'document.xml',
        '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Splunk Linux Security+</w:t></w:r></w:p></w:body></w:document>',
      );
    writeFileSync(path, await zip.generateAsync({ type: 'nodebuffer' }));
    const result = await parse(path);
    expect(result.parsingStatus).toBe('parsed');
    expect(result.skills).toContain('Splunk');
  });
});

function temporary(filename: string): string {
  if (!directory)
    directory = mkdtempSync(join(tmpdir(), 'job-browser-resume-'));
  return join(directory, filename);
}

function parse(path: string) {
  return extractResume(path, path, loadCandidateProfile(), loadScoringConfig());
}

function minimalPdf(text: string): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${String(text.length + 34)} >>\nstream\nBT /F1 12 Tf 72 720 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer << /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF`;
  return Buffer.from(body);
}
