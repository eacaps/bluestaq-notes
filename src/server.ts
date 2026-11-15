import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const dbPath = process.env.DB_PATH ?? './data/notes.db';

const DEV_JWT_SECRET = 'dev-only-insecure-secret-change-me';
let jwtSecret = process.env.JWT_SECRET;
const usingDevSecret = !jwtSecret;
if (usingDevSecret) {
  if (process.env.NODE_ENV === 'production') {
    console.error('JWT_SECRET must be set when NODE_ENV=production');
    process.exit(1);
  }
  jwtSecret = DEV_JWT_SECRET;
}
const jwtExpiresIn = process.env.JWT_EXPIRES_IN || '1h';

const app = await buildApp({ dbPath, jwtSecret: jwtSecret!, jwtExpiresIn });
if (usingDevSecret) {
  app.log.warn('JWT_SECRET is not set: using an insecure development secret. Set JWT_SECRET before deploying.');
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
