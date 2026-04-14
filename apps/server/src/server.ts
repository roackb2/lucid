import { createLucidHttpServer } from './router.js';

const PORT = Number.parseInt(process.env.PORT ?? '8081', 10);

createLucidHttpServer(PORT);
process.stdout.write(`Lucid TS tRPC server listening on http://localhost:${PORT}\n`);
