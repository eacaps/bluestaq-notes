# bluestaq-notes

Backend for a note-taking service used and shared by small teams. Notes can be labeled with one or more teams.

Built with Node, TypeScript, Fastify, TypeBox and SQLite (`better-sqlite3`). The code is split into four layers (presentation, services, data, domain). See [docs/DESIGN.md](docs/DESIGN.md) for the design and the staged plan.

**Stage 1 has no authentication.** Every request acts as a single default user that is seeded at startup.

## Run

```
npm install
npm run dev
```

Other scripts: `npm run typecheck`, `npm run build`, `npm start` (runs the built `dist/`).

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_PATH` | `./data/notes.db` | SQLite file (directory is created if needed). `:memory:` uses a throwaway in-memory database |

Timestamps are assigned by column defaults in the schema. `CREATE TABLE IF NOT EXISTS` does not change an existing table, so if you have a database file from before this change, delete it (default `./data/notes.db`) and it will be recreated with the new schema.

## API docs

Swagger UI is at <http://localhost:3000/docs>. The OpenAPI 3 JSON is at `/docs/json`. Request and response models are defined once in TypeBox and shared across routes.

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/notes` | Create a note (`title`, `body`, optional `team_ids`) |
| GET | `/notes` | List notes. Query: `q`, `team`, `limit`, `offset` |
| GET | `/notes/{id}` | Fetch one note |
| PATCH | `/notes/{id}` | Partial update, including `team_ids` |
| POST | `/teams` | Create a team (`name`) |
| GET | `/teams` | List teams. Query: `limit`, `offset` |
| GET | `/teams/{id}` | Fetch one team |

Lists return `{ items, total, limit, offset }`. Errors return `{ error, message }`.
