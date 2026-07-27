export const APPLICATION_EVENT_TYPES = [
  'applied',
  'interview',
  'rejected',
  'offer',
  'note',
] as const;

export type ApplicationEventType = (typeof APPLICATION_EVENT_TYPES)[number];

export interface ApplicationHistory {
  id: string;
  jobId: string;
  eventType: ApplicationEventType;
  occurredAt: string;
  notes: string | null;
  source: string;
  createdAt: string;
}
