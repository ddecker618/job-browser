-- Milestone 8.7 query-driven index for effective outcome cohort reads.

CREATE INDEX application_history_event_occurrence_application_idx
  ON application_history(event_type, occurred_at_sort, application_id);
