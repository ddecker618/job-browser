import { WorkableProvider } from '../dist/src/providers/workable.provider.js';

async function main() {
  const provider = new WorkableProvider();

  // Hugging Face
  console.log('=== Hugging Face (7 live jobs) ===');
  try {
    const result = await provider.validateConfiguration({
      subdomain: 'huggingface',
      company: 'Hugging Face',
    });
    console.log(
      'Validation:',
      result.valid ? 'PASS' : 'FAIL',
      '-',
      result.message,
    );
  } catch (e) {
    console.log('ERROR:', e.message);
  }

  try {
    const search = await provider.search(
      { query: '', location: null, remoteOnly: false, limit: 10 },
      { configuration: { subdomain: 'huggingface', company: 'Hugging Face' } },
    );
    const result = await provider.fetch(search);
    console.log(
      'Jobs:',
      result.records.length,
      'Rejected:',
      result.rejected,
      'Complete:',
      result.complete,
    );
    for (const job of result.records.slice(0, 3)) {
      const n = provider.normalize(job, new Date().toISOString());
      console.log(
        '  -',
        n.title,
        '|',
        n.company,
        '|',
        n.location,
        '|',
        n.remoteType,
        '|',
        n.department,
      );
    }
  } catch (e) {
    console.log('ERROR:', e.message);
  }

  // Samsung SDS America
  console.log('\n=== Samsung SDS America (18 live jobs) ===');
  try {
    const result = await provider.validateConfiguration({
      subdomain: 'samsung-sds-america',
      company: 'Samsung SDS America',
    });
    console.log(
      'Validation:',
      result.valid ? 'PASS' : 'FAIL',
      '-',
      result.message,
    );
  } catch (e) {
    console.log('ERROR:', e.message);
  }

  try {
    const search = await provider.search(
      { query: '', location: null, remoteOnly: false, limit: 5 },
      {
        configuration: {
          subdomain: 'samsung-sds-america',
          company: 'Samsung SDS America',
        },
      },
    );
    const result = await provider.fetch(search);
    console.log('Jobs:', result.records.length, 'Rejected:', result.rejected);
    for (const job of result.records.slice(0, 2)) {
      const n = provider.normalize(job, new Date().toISOString());
      console.log(
        '  -',
        n.title,
        '|',
        n.company,
        '|',
        n.remoteType,
        '|',
        n.department,
      );
    }
  } catch (e) {
    console.log('ERROR:', e.message);
  }

  // Invalid subdomain
  console.log('\n=== Invalid Subdomain ===');
  try {
    const result = await provider.validateConfiguration({
      subdomain: 'this-does-not-exist-12345',
      company: 'Nonexistent',
    });
    console.log(
      'Validation:',
      result.valid ? 'PASS' : 'FAIL',
      '-',
      result.message,
    );
  } catch (e) {
    console.log('ERROR:', e.message);
  }
}

main().catch((e) => console.error('FATAL:', e));
