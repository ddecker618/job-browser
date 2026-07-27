-- Idempotent cleanup of the fixed demo source ID (Touchette / Employer Name) and related demo records

-- Delete application history for the demo job
DELETE FROM application_history WHERE job_id = '00000000-0000-4000-8000-000000000002';

-- Delete application records for the demo job
DELETE FROM applications WHERE job_id = '00000000-0000-4000-8000-000000000002';

-- Delete job status history for the demo job
DELETE FROM job_status_history WHERE job_id = '00000000-0000-4000-8000-000000000002';

-- Delete recommendations for the demo job
DELETE FROM recommendations WHERE job_id = '00000000-0000-4000-8000-000000000002';

-- Delete score history for the demo job
DELETE FROM score_history WHERE job_id = '00000000-0000-4000-8000-000000000002';

-- Delete job skills for the demo job
DELETE FROM job_skills WHERE job_id = '00000000-0000-4000-8000-000000000002';

-- Delete job certifications for the demo job
DELETE FROM job_certifications WHERE job_id = '00000000-0000-4000-8000-000000000002';

-- Delete identity conflict diagnostics for the demo source or job
DELETE FROM identity_conflict_diagnostics 
WHERE source_id = '00000000-0000-4000-8000-000000000001' 
   OR selected_job_id = '00000000-0000-4000-8000-000000000002' 
   OR conflicting_job_id = '00000000-0000-4000-8000-000000000002';

-- Delete job sources for the demo source or job
DELETE FROM job_sources 
WHERE source_id = '00000000-0000-4000-8000-000000000001' 
   OR job_id = '00000000-0000-4000-8000-000000000002';

-- Delete job observations for the demo source or job
DELETE FROM job_observations 
WHERE source_id = '00000000-0000-4000-8000-000000000001' 
   OR job_id = '00000000-0000-4000-8000-000000000002';

-- Delete runs for the demo source
DELETE FROM runs WHERE source_id = '00000000-0000-4000-8000-000000000001';

-- Delete source schedules for the demo source
DELETE FROM source_schedules WHERE source_id = '00000000-0000-4000-8000-000000000001';

-- Delete the demo job
DELETE FROM jobs WHERE id = '00000000-0000-4000-8000-000000000002';

-- Delete the demo source
DELETE FROM sources WHERE id = '00000000-0000-4000-8000-000000000001';
