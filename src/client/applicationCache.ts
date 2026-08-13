import type { QueryClient } from '@tanstack/react-query';

export async function invalidateApplicationQueries(
  client: QueryClient,
  applicationId?: string,
  jobId?: string,
): Promise<void> {
  const invalidations: Promise<void>[] = [
    client.invalidateQueries({ queryKey: ['applications'] }),
    client.invalidateQueries({ queryKey: ['jobs'] }),
    client.invalidateQueries({ queryKey: ['dashboard'] }),
  ];
  if (applicationId !== undefined) {
    invalidations.push(
      client.invalidateQueries({ queryKey: ['application', applicationId] }),
      client.invalidateQueries({
        queryKey: ['application-timeline', applicationId],
      }),
    );
  }
  if (jobId !== undefined) {
    invalidations.push(client.invalidateQueries({ queryKey: ['job', jobId] }));
  }
  await Promise.all(invalidations);
}
