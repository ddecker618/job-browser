import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import { api } from '../api.js';

const STORAGE_KEY = 'job-browser-notified-jobs';
const SCORE_THRESHOLD = 75;
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

function loadNotified(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveNotified(ids: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

function showNotification(title: string, body: string): void {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    new Notification(title, { body });
  } else if (Notification.permission !== 'denied') {
    void Notification.requestPermission().then((permission) => {
      if (permission === 'granted') {
        new Notification(title, { body });
      }
    });
  }
}

export function NotificationManager() {
  const notified = useRef<Set<string>>(loadNotified());
  const topJobs = useQuery({
    queryKey: ['notifications', 'top-jobs'],
    queryFn: () =>
      api.searchJobs(
        { minScore: SCORE_THRESHOLD, sort: 'firstSeenAt', pageSize: 20 },
      ),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (topJobs.data === undefined) return;
    const cutoff = Date.now() - RECENT_WINDOW_MS;
    const jobs = topJobs.data.items;
    if (jobs.length === 0) return;
    const current = notified.current;
    let changed = false;
    for (const job of jobs) {
      if (current.has(job.id)) continue;
      const seenAt = Date.parse(job.firstSeenAt);
      if (!Number.isFinite(seenAt) || seenAt < cutoff) {
        current.add(job.id);
        changed = true;
        continue;
      }
      current.add(job.id);
      changed = true;
      showNotification(
        `Strong match: ${job.title}`,
        `${job.company} · Score: ${job.score?.toFixed(0) ?? '?'}`,
      );
    }
    if (changed) {
      saveNotified(current);
    }
  }, [topJobs.data]);

  return null;
}
