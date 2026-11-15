# bluestaq-notes

Backend for a note-taking service used and shared by small teams. Notes can be labeled with one or more teams.

Built with Node, TypeScript, Fastify, TypeBox and SQLite (`better-sqlite3`). The code is split into four layers (presentation, services, data, domain). See [docs/DESIGN.md](docs/DESIGN.md) for the design and the staged plan.

**Stage 2a: bearer tokens without passwords.** Every route except `/auth/register`, `/auth/login` and `/docs` needs a token. Login takes only an email, so **anyone who knows an email can act as that user** until passwords arrive in stage 5. Access rules are still open until stage 2b: any logged-in user can read and edit any note and list every team.

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
| `JWT_SECRET` | dev default, with a logged warning | Secret used to sign tokens. Required when `NODE_ENV=production`: the server refuses to start without it |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime, e.g. `30m`, `1h`, `7d` |
| `DB_PATH` | `./data/notes.db` | SQLite file (directory is created if needed). `:memory:` uses a throwaway in-memory database |

Timestamps are assigned by column defaults in the schema. `CREATE TABLE IF NOT EXISTS` does not change an existing table, so if you have a database file from before this change, delete it (default `./data/notes.db`) and it will be recreated with the new schema.

## API docs

Swagger UI (public) is at <http://localhost:3000/docs>. The OpenAPI 3 JSON is at `/docs/json`. Request and response models are defined once in TypeBox and shared across routes.

## Authentication

Register (or log in as the seeded `default@example.com`), then send the token as a bearer token:

```
# Register: returns 201 {token, user}
curl -s -X POST localhost:3000/auth/register -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","name":"Alice"}'

# Log in: returns 200 {token, user}. No password in this stage.
curl -s -X POST localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@example.com"}'

# Use the token
TOKEN=<token from the response>
curl -s localhost:3000/users/me -H "Authorization: Bearer $TOKEN"
curl -s localhost:3000/notes -H "Authorization: Bearer $TOKEN"
```

Notes record the caller as `owner_id`. A missing, invalid or expired token returns 401 with a `WWW-Authenticate: Bearer` header. Registering an email that exists returns 409. In Swagger UI, use **Authorize** and paste the token.

## Endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/auth/register` | Create a user (`email`, `name`), returns `{token, user}`. Public |
| POST | `/auth/login` | Returns `{token, user}` for a registered `email`. No password yet. Public |
| GET | `/users/me` | The authenticated user |
| POST | `/notes` | Create a note (`title`, `body`, optional `team_ids`) |
| GET | `/notes` | List notes. Query: `q`, `team`, `limit`, `offset` |
| GET | `/notes/{id}` | Fetch one note |
| PATCH | `/notes/{id}` | Partial update, including `team_ids` |
| POST | `/teams` | Create a team (`name`) |
| GET | `/teams` | List teams. Query: `limit`, `offset` |
| GET | `/teams/{id}` | Fetch one team |

Lists return `{ items, total, limit, offset }`. Errors return `{ error, message }`.
