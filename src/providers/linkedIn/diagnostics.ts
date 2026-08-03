import { log } from '../../logging/logger.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';

export function recordDiagnosticStage(stage: string, detail?: string): void {
  log('debug', `LinkedIn provider: ${stage}`, detail ? { detail } : {});
}

export function saveDiagnosticHtml(
  html: string,
  label: string,
  artifactsDir?: string,
): string | null {
  try {
    const dir =
      artifactsDir ?? process.env['JOB_BROWSER_ARTIFACTS'] ?? 'artifacts';
    mkdirSync(dir, { recursive: true });
    const filename = 'linkedin-' + label + '-' + String(Date.now()) + '.html';
    const path = resolve(dir, filename);

    const sanitized = sanitizeHtmlForDiagnostics(html);
    writeFileSync(path, sanitized, 'utf-8');
    log('debug', `Diagnostic HTML saved`, { path, label });
    return path;
  } catch (error) {
    log('error', 'Failed to save diagnostic HTML', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function sanitizeHtmlForDiagnostics(html: string): string {
  const document = parse(html);
  removeScriptElements(document);
  return serialize(document);
}

function removeScriptElements(node: DefaultTreeAdapterMap['node']): void {
  if (!('childNodes' in node)) return;
  for (let index = node.childNodes.length - 1; index >= 0; index -= 1) {
    const child = node.childNodes[index];
    if (child === undefined) continue;
    if ('tagName' in child && child.tagName.toLowerCase() === 'script') {
      node.childNodes.splice(index, 1);
    } else {
      removeScriptElements(child);
    }
  }
}

export function cleanDiagnosticScreenshotPath(
  path: string | null,
): string | null {
  return path;
}

export function redactSensitiveInfo(text: string): string {
  if (!text) return text;
  return text
    .replace(
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      '[email redacted]',
    )
    .replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[phone redacted]')
    .replace(
      /\blinkedin\.com\/in\/[\w-]+\b/g,
      'linkedin.com/in/[profile redacted]',
    );
}
