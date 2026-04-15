import { resolvePort } from './config.js';
import { createLucidHttpServer } from './router.js';

const PORT = resolvePort();

createLucidHttpServer(PORT);
process.stdout.write(`Lucid TS tRPC server listening on http://localhost:${PORT}\n`);
