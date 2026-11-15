# bluestaq-notes

Backend for a note-taking service used and shared by small teams. Notes can be labeled with one or more teams.

Built with Node, TypeScript, Fastify, TypeBox and SQLite (`better-sqlite3`). The code is split into four layers (presentation, services, data, domain). See [docs/DESIGN.md](docs/DESIGN.md) for the design and the staged plan.

**Stage 2a: bearer tokens without passwords.** Every route except `/auth/register`, `/auth/login` and `/docs` needs a token. Login takes only an email, so **anyone who knows an email can act as that user** until passwords arrive in stage 5. 

**Stage 2b: team access.** Notes are private to their owner unless they are labeled with teams. The owner and every member of any of a note's teams can read and edit it. Teams are the only way to share. All team members are equal, so any member can add or remove any member (themselves included). Something you are not allowed to see returns 404, as if it did not exist. See [Teams and access](#teams-and-access).

## Run

```
npm install
npm run dev
```

Other scripts: `npm run typecheck` (source and tests), `npm run build`, `npm start` (runs the built `dist/`).

## Tests

| Command | What it runs |
|---|---|
| `npm test` | All tests (unit and integration) |
| `npm run test:unit` | `test/unit/`: services with in-memory fake repositories |
| `npm run test:integration` | `test/integration/`: SQLite, routes, scenarios, OpenAPI, persistence |
| `npm run coverage` | All tests with a coverage report in `coverage/` (no minimum enforced) |

Both folders mirror `src/`. Integration tests build a fresh app on its own `:memory:` database through `buildTestApp()` in `test/helpers/`, so they do not read `DB_PATH` and can run in parallel. CI (`.github/workflows/ci.yml`) runs typecheck, build, unit and integration tests on pull requests.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `JWT_SECRET` | dev default, with a logged warning | Secret used to sign tokens. Required when `NODE_ENV=production`: the server refuses to start without it |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime, e.g. `30m`, `1h`, `7d` |
| `DB_PATH` | `./data/notes.db` | SQLite file (directory is created if needed). `:memory:` uses a throwaway in-memory database |

Timestamps are assigned by column defaults in the schema. `CREATE TABLE IF NOT EXISTS` does not change an existing table, so if you have a database file from before this change, delete it (default `./data/notes.db`) and it will be recreated with the new schema.

**A database file created before stage 2b must be deleted (`rm data/notes.db`).** There is no migration and no backfill: teams made before 2b have no members and notes would be invisible to everyone but their owners.

## API docs

Swagger UI (public) is at <http://localhost:3000/docs>. The OpenAPI 3 JSON is at `/docs/json`. Request and response models are defined once in TypeBox and shared across routes.

## Authentication

In Swagger UI (`/docs`): run **POST /auth/login** with `{"email":"eacaps@gmail.com"}` (the seeded user), copy the `token` from the response, click **Authorize**, paste the token (without the word `Bearer`), and every request from that page is authenticated. The same steps are written at the top of the Swagger page itself.

From the command line, register (or log in as the seeded `eacaps@gmail.com`), then send the token as a bearer token:

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

## Teams and access

Rules in plain words:

- A note with no `team_ids` is private to its owner.
- You can read and edit a note if you own it or belong to any of its teams. Only the owner will be able to delete it (delete arrives in stage 4).
- `GET /notes` lists only notes you can read, and `total` counts only those. `?team=` narrows within them: a team you are not in gives an empty page.
- To put a team on a note (create or `PATCH`), you must belong to it. An unknown team and a team you are not in give the same 400. `PATCH` with `team_ids` replaces the list, so a team you do not belong to cannot be kept or added, only dropped. Leave `team_ids` out to keep the list as it is.
- Nobody can join a team on their own. A team you are not in returns 404, even to add yourself.
- Removing the last member leaves a team nobody can see. This is a known limit.

```
# Create a team (you become a member)
curl -s -X POST localhost:3000/teams -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Platform"}'
TEAM=<id from the response>

# Add an existing user (204; repeating it is fine)
curl -s -X PUT localhost:3000/teams/$TEAM/members/$USER_ID -H "Authorization: Bearer $TOKEN"

# List members
curl -s localhost:3000/teams/$TEAM/members -H "Authorization: Bearer $TOKEN"

# Remove a member (204), yourself included
curl -s -X DELETE localhost:3000/teams/$TEAM/members/$USER_ID -H "Authorization: Bearer $TOKEN"

# Share a note with the team, then list your notes
curl -s -X POST localhost:3000/notes -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"title\":\"Plan\",\"body\":\"...\",\"team_ids\":[\"$TEAM\"]}"
curl -s "localhost:3000/notes?team=$TEAM" -H "Authorization: Bearer $TOKEN"
```

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
| POST | `/teams` | Create a team (`name`). You become its first member |
| GET | `/teams` | List the teams you belong to. Query: `limit`, `offset` |
| GET | `/teams/{id}` | Fetch one team (members only, otherwise 404) |
| GET | `/teams/{id}/members` | List the members (members only). Query: `limit`, `offset` |
| PUT | `/teams/{id}/members/{userId}` | Add an existing user (members only, idempotent, 204) |
| DELETE | `/teams/{id}/members/{userId}` | Remove a member, yourself included (members only, 204) |

Lists return `{ items, total, limit, offset }`. Errors return `{ error, message }`.
