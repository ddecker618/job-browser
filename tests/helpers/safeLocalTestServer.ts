import type { Server } from 'node:http';
import type { Express } from 'express';

import { listenOnSafeLocalPort } from '../../src/server/safeLocalPort.js';

export function listenTestApp(
  app: Express,
  host = '127.0.0.1',
): Promise<Server> {
  return listenOnSafeLocalPort(
    host,
    0,
    (port, requestedHost) =>
      new Promise<Server>((resolve, reject) => {
        const server = app.listen(port, requestedHost, () => resolve(server));
        server.once('error', reject);
      }),
  );
}
