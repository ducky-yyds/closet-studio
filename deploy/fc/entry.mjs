import { pathToFileURL } from 'node:url';
import { createFlatlayServer } from './server/flatlay-server.mjs';

export function createFcServer(env = process.env, options = {}) {
  const server = createFlatlayServer({
    ...env,
    FLATLAY_PROVIDER: 'dashscope',
    FLATLAY_HOST: '0.0.0.0',
    FLATLAY_PORT: '9000',
    ALLOWED_ORIGINS: 'https://ducky-yyds.github.io'
  }, { ...options, requireAccessToken: true });
  // Function Compute reuses HTTP connections. The 120 s image timeout remains
  // inside the shared handler; the platform function timeout is set to 180 s.
  server.timeout = 0;
  server.keepAliveTimeout = 86_400_000;
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createFcServer().listen(9000, '0.0.0.0', () => {
    console.log('Closet flatlay proxy is ready on port 9000.');
  });
}
