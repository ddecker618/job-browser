CREATE INDEX jobs_salary_search_idx
  ON jobs(COALESCE(salary_maximum, salary_minimum, 0), id);
