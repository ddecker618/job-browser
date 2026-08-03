import { describe, expect, it } from 'vitest';

import { sanitizeHtmlForDiagnostics } from '../src/providers/linkedIn/diagnostics.js';

describe('LinkedIn diagnostic HTML sanitization', () => {
  it('removes script elements while preserving surrounding diagnostics', () => {
    const sanitized = sanitizeHtmlForDiagnostics(`
      <!doctype html>
      <html><body>
        <p>before</p>
        <script>window.__diagnostic_attack = true;</script>
        <p>after</p>
      </body></html>
    `);

    expect(sanitized).not.toMatch(/<script/i);
    expect(sanitized).not.toContain('window.__diagnostic_attack');
    expect(sanitized).toContain('<p>before</p>');
    expect(sanitized).toContain('<p>after</p>');
  });

  it('removes scripts whose closing tag contains legal whitespace', () => {
    const sanitized = sanitizeHtmlForDiagnostics(
      '<main>safe<script>alert("unsafe")</script ></main>',
    );

    expect(sanitized).not.toMatch(/<script/i);
    expect(sanitized).not.toContain('alert("unsafe")');
    expect(sanitized).toContain('<main>safe</main>');
  });

  it('handles a greater-than sign inside a quoted script attribute', () => {
    const sanitized = sanitizeHtmlForDiagnostics(
      '<p>start</p><script data-condition="1 > 0">alert(1)</script><p>end</p>',
    );

    expect(sanitized).not.toMatch(/<script/i);
    expect(sanitized).not.toContain('alert(1)');
    expect(sanitized).toContain('<p>start</p>');
    expect(sanitized).toContain('<p>end</p>');
  });
});
