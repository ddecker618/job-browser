import type { QueryClient } from '@tanstack/react-query';

export async function invalidateScoreQueries(
  client: QueryClient,
): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: ['jobs'] }),
    client.invalidateQueries({ queryKey: ['job'] }),
    client.invalidateQueries({ queryKey: ['dashboard'] }),
    client.invalidateQueries({ queryKey: ['analytics'] }),
    client.invalidateQueries({ queryKey: ['notifications'] }),
  ]);
}
