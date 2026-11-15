import { cpSync } from 'node:fs';

cpSync('src/data/schema.sql', 'dist/data/schema.sql');
