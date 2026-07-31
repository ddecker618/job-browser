-- Disable legacy Remote OK sources.
-- Remote OK is no longer supported, so existing Remote OK sources are turned
-- off and marked invalid rather than deleted. Their jobs, runs, and
-- observations are preserved for history.

UPDATE sources SET
  enabled = 0,
  configuration_status = 'invalid',
  health_status = 'failed',
  health_message = 'Remote OK is no longer supported',
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE provider_id = 'remote-ok'
   OR connector = 'remote-ok'
   OR id = 'provider:remote-ok';

UPDATE source_schedules SET
  enabled = 0,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE source_id IN (
  SELECT id FROM sources
  WHERE provider_id = 'remote-ok'
     OR connector = 'remote-ok'
     OR id = 'provider:remote-ok'
);
