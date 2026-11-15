# Notes Service: Design

Backend for a note-taking service used and shared by several small teams.

## Scope

**Stage 1: single user.** No login and no team membership endpoints. One default user is seeded at startup. Notes can be labeled with one or more teams. Built without automated tests, which come in stage 1b.

**Stage 1b (next): automated tests.** A test suite for everything stage 1 built, plus a CI workflow. No production code changes except what testing requires. See "Testing (stage 1b)". Each later stage extends the suite as it lands.

**Stage 2 (later): multi-user.** Built in two parts. Stage 1 is built so this is a small change (see "Seams for stage 2").

- **2a, tokens without passwords (built).** `POST /auth/register` (`email`, `name`) creates a user and returns a JWT. `POST /auth/login` (`email` only) returns a JWT. `GET /users/me`. `getCurrentUser` reads the bearer token and returns 401 for a missing or invalid one. Notes record the real owner. Access rules stayed open in 2a (closed by 2b). Login proves nothing at this point, which is intended and is fixed in stage 5.
- **2b, team access (built).** Team membership endpoints, `POST /teams` makes the creator the first member, the real `canRead` and `canWrite`, `GET /notes` filtered to what the caller can see, and `team_ids` validation against membership. One endpoint beyond the list below: `GET /teams/{id}/members`, because members could not otherwise be seen. There is no backfill and no migration (see "Stage 2b decisions").

**Stage 3 (later): revisions.** Every edit to a note keeps a snapshot of its previous state, so history can be listed and restored. Built after stage 2 so each revision records a real editor (`edited_by`). See "Revisions (stage 3)".

**Stage 4 (later): deletion.** `DELETE /notes/{id}` (204, owner-only once stage 2 is in) and `DELETE /teams/{id}`. Stages 1 to 3 have no delete endpoints. The `ON DELETE CASCADE` constraints on `note_teams` are created in stage 1, so this needs no schema change.

**Stage 5 (later): passwords.** `register` takes a `password` (minimum 8 characters). It is hashed with `scrypt` from Node's `crypto`, using a 16-byte random salt per user, and stored as `scrypt$<salt hex>$<hash hex>` in `users.password_hash`. `login` recomputes the hash and compares with `crypto.timingSafeEqual`. An unknown email and a wrong password both return the same 401. The hash never appears in a response. The seeded user's password comes from an environment variable. Optional: `@fastify/rate-limit` on `/auth/login`. No other route changes, because they already depend only on the token.

**Stage 6 (later): Prisma.** Replace the hand-written SQL in `src/data/` with Prisma as the database layer. Behavior and the API do not change. See "Prisma (stage 6)".

## Stack

- Node + TypeScript
- Fastify, with schemas defined in TypeBox (`typebox`, `@fastify/type-provider-typebox` 6.x). Validation uses Fastify's built-in Ajv.
- SQLite via `better-sqlite3` and plain prepared statements. Zero setup: the database is a single file.
- Optional: `@fastify/swagger` and `@fastify/swagger-ui` for API docs generated from the schemas.

## Data model

Database is relational. The schema is applied at startup with `CREATE TABLE IF NOT EXISTS`, so a later stage can add its tables without touching existing data. `team_members` is created in stage 1 even though it is used from stage 2.

Timestamps are assigned by the database via column defaults (ISO 8601 UTC, millisecond precision, `Z` suffix), and `notes.updated_at` is refreshed in the repository's UPDATE.

**users**
- `id` TEXT (UUID) PK
- `email` TEXT UNIQUE
- `name` TEXT
- `password_hash` TEXT, nullable. Unused until stage 5, and it never appears in responses.
- `created_at` TEXT (ISO 8601)

**teams**
- `id` TEXT PK
- `name` TEXT
- `created_at` TEXT

**team_members** (stage 2)
- `team_id` FK teams, `user_id` FK users
- All members are equal. There are no roles.
- PK (`team_id`, `user_id`)

**notes**
- `id` TEXT PK
- `owner_id` FK users
- `title` TEXT
- `body` TEXT
- `created_at`, `updated_at` TEXT

**note_teams** (a note can belong to several teams)
- `note_id` FK notes ON DELETE CASCADE, `team_id` FK teams ON DELETE CASCADE
- PK (`note_id`, `team_id`)

The API exposes a note's teams as a plain list, `team_ids: string[]`. The join table is an implementation detail.

## API (stage 1)

### Notes
| Method | Path | Description |
|---|---|---|
| POST | `/notes` | Create. Body: `title`, `body`, optional `team_ids` |
| GET | `/notes` | List. Query: `q` (search title and body), `team`, `limit`, `offset` |
| GET | `/notes/{id}` | Fetch one |
| PATCH | `/notes/{id}` | Partial update, including `team_ids` |

### Teams
| Method | Path | Description |
|---|---|---|
| POST | `/teams` | Create. Body: `name` |
| GET | `/teams` | List the teams the caller belongs to (stage 2b) |
| GET | `/teams/{id}` | Fetch one. Members only: 404 for non-members (stage 2b) |

### Team membership (stage 2b)
| Method | Path | Description |
|---|---|---|
| PUT | `/teams/{id}/members/{userId}` | Any member adds an existing user. Idempotent, 204. Unknown user: 404 |
| DELETE | `/teams/{id}/members/{userId}` | Any member removes any member, including themselves. 204, also when the user was not a member |
| GET | `/teams/{id}/members` | Addition beyond the original endpoint list. Members only. Paginated `User` list (`id`, `email`, `name`, `created_at`) |

Every membership route returns 404 for the team when the caller is not a member, so a team's existence is never revealed and nobody can join by themselves.
### Conventions
- JSON in and out. IDs are UUIDs.
- Errors use one shape: `{ "error": string, "message": string }`, with 400 (validation), 404 (not found).
- `POST` returns 201 with the created resource.
- List responses: `{ "items": [...], "total": number, "limit": number, "offset": number }`.
- Unknown `team_ids`, and `team_ids` of teams the caller does not belong to, return 400 on create or update. Both cases use the same fixed message (`team_ids must be existing teams that you belong to`), so it does not reveal which ids exist.
- Note `title` and team `name` are trimmed (`String.prototype.trim`) on create and update, and the trimmed value is stored and returned. A value that is empty after trimming returns 400. Length limits (title 200, name 100) apply to the trimmed value. Team names are not unique, so there is no uniqueness comparison.

## Architecture: N-layer

The code is split into four layers, following the [N-tier pattern](https://medium.com/@segekaratas/understanding-n-tier-architecture-building-robust-and-scalable-applications-62db30a40b5). The layers are separate modules in one deployable process, not separate services. The goal is that one layer can be replaced later (for example SQLite for Postgres, or Fastify for another HTTP framework) without touching the others.

| Layer | Responsibility | Lives in |
|---|---|---|
| Presentation | HTTP only: routes, TypeBox request and response schemas, status codes, reading the bearer token. No business rules and no SQL. | `src/presentation/` |
| Business logic | Rules and orchestration: validating `team_ids`, access checks, the revision snapshot on edit, the cascade behavior. Throws domain errors. Knows nothing about HTTP or SQL. | `src/services/` |
| Data access | All SQL and `better-sqlite3` usage. Repositories return entities. Transactions are exposed as a function the services call, so services never see the database handle. | `src/data/` |
| Entity (domain) | Plain TypeScript types for `User`, `Team`, `Note`, and the domain error classes. No dependencies on other layers. | `src/domain/` |

### Dependency rules
- Presentation depends on services and entities.
- Services depend on repository interfaces and entities.
- Data access implements the repository interfaces and depends on entities.
- Entities depend on nothing.
- Dependencies point downward only. A layer never imports from one above it.

### Decoupling
- Repositories are defined as interfaces in `src/domain/` (for example `NoteRepository`). `src/data/` provides the SQLite implementation. Services receive repositories through their constructors (dependency injection), so tests can pass fakes and a storage change touches only `src/data/`.
- Services throw domain errors (`NotFoundError`, `ValidationError`, later `UnauthorizedError` and `ForbiddenError`). One Fastify error handler in the presentation layer maps them to 404, 400, 401 and 403 and the standard `{ error, message }` shape. Services never touch `reply`.
- TypeBox schemas are presentation types. They describe the HTTP shape and are not reused as entities. Mapping between the two happens in the route handlers, so the API shape can change without changing the domain.
- A composition root, `app.ts`, creates the connection, repositories and services, and registers the routes. It is the only place that knows all the layers.
- Logging and error handling apply in every layer. The Fastify logger is created in `app.ts` and passed down.

### Layout

```
src/
  app.ts            composition root: wire repositories, services, routes
  server.ts         listen
  domain/           entities, repository interfaces, domain errors
  data/             SQLite connection, schema.sql, seed, repositories
  services/         notes, teams, access, auth, (later) revisions
  presentation/
    routes/         auth.ts, notes.ts, teams.ts (one FastifyPluginAsync each)
    schemas/        TypeBox schemas: note, team, user, error, pagination
    current-user.ts authentication hook and getCurrentUser
    error-handler.ts
```

Routes follow the pattern used in the reference example: `instance.withTypeProvider<TypeBoxTypeProvider>()`, per-status response schemas, and types derived with `Static<typeof schema>`. The difference is that handlers receive their service through the plugin's options, not from a decorated `app` property, and they map domain errors to responses in the shared error handler instead of checking for `undefined`.

Later stages fit the same layers: stage 2a adds `auth` and the token check (presentation) with a user lookup (data). Stage 2b changes the access service, adds a membership repository (defined in `src/domain/`, injected into the access, team and note services) and makes the note list query visibility-aware. Stage 3 adds a `RevisionRepository` and a revision service, and the note service calls it inside the edit transaction. Stage 5 changes the auth service and the `users` repository.

## Revisions (stage 3)

**note_revisions** (new table, added in stage 3)
- `id` TEXT PK
- `note_id` FK notes ON DELETE CASCADE
- `title`, `body` TEXT
- `team_ids` TEXT (JSON array), the teams at the time of the snapshot
- `edited_by` FK users, the user who made the edit that replaced this state
- `created_at` TEXT

Inside the same transaction as each `PATCH`, the service copies the note's current state into `note_revisions` before applying the change. The first revision is therefore the original note.

| Method | Path | Description |
|---|---|---|
| GET | `/notes/{id}/revisions` | List, newest first, paginated |
| GET | `/notes/{id}/revisions/{revId}` | Fetch one |
| POST | `/notes/{id}/revisions/{revId}/restore` | Apply it to the note as a new edit, which creates a revision of its own. History is never rewritten |

Anyone who can read the note can read its revisions. Anyone who can edit it can restore. Deleting a note deletes its revisions.

## Testing (stage 1b)

Each layer is tested the way that is cheapest for it. Tests are split into two folders that each mirror `src/`: `test/unit/` and `test/integration/`.

### Unit tests (`test/unit/`)
| Layer | What is tested | How |
|---|---|---|
| Services | Business rules: unknown `team_ids` rejected, owner set from the current user, PATCH replaces `team_ids`, not-found errors, access checks | In-memory fake repositories passed to the constructors. No database and no HTTP. |

### Integration tests (`test/integration/`)
| Area | What is tested | How |
|---|---|---|
| Data | SQL behavior: `q` and `team` filters, pagination and `total`, ordering, LIKE escaping of `%` and `_`, cascade on `note_teams`, timestamp defaults and the `updated_at` bump | Real SQLite on `:memory:`. |
| API, per route | Status codes, request validation (bad uuid, empty title), the `{error,message}` shape, response shapes, mapping of domain errors | `app.inject()` against the full app. A few broad tests per route, not one per field. |
| API, scenarios | Flows through the whole stack that per-layer tests miss. For example: create two teams, create a note in both, filter by each team, PATCH `team_ids` to one and confirm the filters change; search for text containing `%` and `_`; page through 25 notes with `limit` and `offset` and confirm `total` and ordering | `app.inject()`, several requests per test. |
| Persistence | Data survives a restart | A file-backed database in a temp directory: write a note, close the app, open a new app on the same file, read the note back. |
| OpenAPI | The spec generates, every route has response schemas, and each shared model appears once under `components/schemas` | One test on `app.swagger()`. |

Each integration test builds a fresh app with its own `:memory:` database through a `buildTestApp()` helper, so tests do not depend on order and can run in parallel. There are no socket-level end-to-end tests: they would repeat the `inject()` tests, and the persistence test covers the one thing they would add.

### Tooling
- Vitest, with npm scripts `test:unit`, `test:integration` and `test` (runs both).
- A coverage report is produced, with no minimum enforced.
- A GitHub Actions workflow runs typecheck, build and `test` on pull requests, in one job.
- Later stages extend the suite. Stage 2b's access rules are covered by service unit tests with fake repositories, plus integration scenarios with two users.

## Seams for stage 2

1. **Current user.** Stage 1 resolved every request to the seeded default user through `getCurrentUser(request)`. Stage 2a turned this into a shared `onRequest` hook (`registerAuthentication` in `src/presentation/current-user.ts`), registered on the root instance before any route. It verifies the bearer token, loads the user through `AuthService.findById`, and stores it on `request.currentUser`. Handlers call `getCurrentUser(request)` to read it. Every route requires a token except an explicit allow-list, so a route added later is protected by default.
2. **Access control.** Services call `canRead(user, note)` and `canWrite(user, note)` from the access service. Routes never check access themselves. Stages 1 and 2a allowed everything. Stage 2b (built) implements the rule below, with a membership repository injected into `AccessService`. `canDelete` (owner only) exists but is unused until stage 4.
3. **Schema.** `team_members` already exists.

### Stage 2b access rule
Sharing is team-based only. There are no per-user shares and no roles.

- A note with an empty `team_ids` is private to its owner.
- A user can read and edit a note if they own it or belong to any team in its `team_ids`.
- Only the owner can delete a note.
- When setting `team_ids`, the user must belong to each team.

Team rules in 2b: anyone logged in can create a team and becomes its first member. Any member can add any existing user (`PUT /teams/{id}/members/{userId}`) or remove any member (`DELETE`), including themselves. Self-join is not allowed, since it would let anyone read any team's notes. Equal members can remove each other, which is a known limit of having no roles.

### Stage 2b decisions
- **404, not 403.** A team the caller is not in, and a note the caller cannot read, both return 404 with the same message as a missing one. Readers can edit, so the 403 path in `NoteService.update` is not reachable today.
- **`team_ids` validation.** The caller must belong to every listed team, on create and on PATCH. Unknown ids and non-member teams both return 400 with the same fixed message. The cap of 50 ids stays.
- **PATCH `team_ids` replaces the list.** The caller must belong to every team in the new list. A non-member cannot add a team, and re-sending a team they are not in also fails with 400, so such a team can only be dropped, never kept. Omit `team_ids` to leave the teams unchanged. `team_ids: []` makes the note private to its owner.
- **`GET /notes`.** Only notes the caller can read, with an exact `total`. Visibility is applied in SQL, before paging. The `team` filter intersects with visibility: filtering by a team the caller is not in returns an empty page, not an error.
- **Two copies of the visibility rule.** `AccessService` (per note) and `SqliteNoteRepository.list` (SQL) must say the same thing. Each has a comment pointing at the other. Change both together.
- **Last member.** Removing the last member leaves a team nobody can see or rejoin. This is accepted: there are no roles and no admin, and stage 4 adds team deletion, which also needs a member.
- **Equal members.** Any member can add or remove any member, themselves included.
- **No backfill, no migration.** Teams and notes created before 2b can have no members, so they would be invisible. A database file from before 2b must be deleted (`rm data/notes.db`). The only schema change is an extra index, `idx_team_members_user_id`.

## Prisma (stage 6)

Goal: replace the hand-written SQL, prepared statements and row types with Prisma Client, without changing the API, the services or the domain entities. Done last so the schema has stopped moving and the test suite from stage 1b protects the swap.

**What changes**
- `prisma/schema.prisma` replaces `src/data/schema.sql` and `scripts/copy-schema.mjs`. Prisma Migrate replaces the `CREATE TABLE IF NOT EXISTS` run at startup. The initial migration must reproduce the existing tables, indexes and `ON DELETE CASCADE` constraints, and existing `data/notes.db` files are baselined with `prisma migrate resolve` instead of being recreated.
- Use `@map` and `@@map` so the Prisma models use camelCase fields (`ownerId`, `createdAt`) over the existing snake_case columns.
- The SQLite repositories in `src/data/` are rewritten over Prisma Client: `LIKE` search becomes `contains` filters, the team filter becomes a relation filter, pagination becomes `skip` and `take`, and the batched `note_teams` lookup becomes `include` of the relation (still mapped to `teamIds`).
- Timestamps stay ISO 8601 UTC strings in the domain. Prisma returns `Date`, so the repositories convert in one place.

**What does not change**
- `src/domain/` entities and repository interfaces. Prisma's generated types stay inside `src/data/`, so nothing above the data layer imports `@prisma/client`.
- Services, routes, schemas, mappers and the error handler, apart from the async changes below.

**Consequences to plan for**
- Prisma is async only. Every repository and service method returns a `Promise`, routes `await` them, and `RunInTransaction` becomes `<T>(fn: () => Promise<T>) => Promise<T>`, implemented with `prisma.$transaction(async (tx) => ...)`. This is the largest part of the change. It is the same signature change a move to Postgres would need.
- Inside an interactive transaction, repositories must use the `tx` client. Pass it through an `AsyncLocalStorage` context or give repositories a per-transaction instance.
- The team check in `create` and `update` and the read-modify-write in `update` must stay inside the transaction callback.
- SQLite transactions in Prisma do not offer `BEGIN IMMEDIATE`. Writes are serialized, which is enough for one process.
- Tests that pass fakes to services keep working. Integration tests use a temporary SQLite file or `:memory:` through Prisma's SQLite URL, and run migrations before each suite.

**Done when:** the full stage 1b suite passes unchanged apart from the async signatures, `npm run build` and `typecheck` pass, `better-sqlite3` and `schema.sql` are removed, and an existing `data/notes.db` opens without data loss.

## Decisions and non-goals

- Hard delete for notes. No soft delete.
- Revisions are full snapshots, not diffs, with no cap on history length.
- Search is a simple case-insensitive `LIKE` over title and body. No full-text index.
- No tags. Teams serve as the grouping mechanism.
- SQLite is single-writer, which is acceptable for this scope.
- Tests arrive in stage 1b, not stage 1.

## Open questions

- None.

## Resolved decisions

- Stage 1b testing: Vitest, with `test/unit/` and `test/integration/` folders that each mirror `src/`. Both per-route and scenario integration tests are included. A coverage report with no enforced threshold, and one GitHub Actions job running typecheck, build, unit and integration tests on pull requests.
- Data persists across restarts. SQLite is file-backed by default (path set by a `DB_PATH` environment variable, with a default such as `./data/notes.db`). `DB_PATH=:memory:` switches to an in-memory database, which tests use.
- Stage 2a auth:
  - Tokens are JWTs from `@fastify/jwt`, signed and verified with HS256 only. The `sub` claim is the user id. Signing and verification live in the presentation layer and `app.ts`; services never import a JWT library.
  - `JWT_SECRET` signs tokens. With `NODE_ENV=production` and no secret, startup fails with an error. Otherwise a development default is used and a warning is logged once. `JWT_EXPIRES_IN` sets the lifetime and defaults to `1h`.
  - Public routes: `POST /auth/register`, `POST /auth/login`, and everything under `/docs` (Swagger UI and the spec JSON). The allow-list matches the method and route pattern, not the raw URL. Unmatched routes are not public, so an unknown path without a token returns 401 instead of 404.
  - A missing, malformed, expired or badly signed token, or a token for a deleted user, returns 401 `{ error: "Unauthorized", message }` with `WWW-Authenticate: Bearer`. Authentication runs before body validation, so an invalid body without a token is also 401.
  - An unknown email on login returns 401 with the generic message "Invalid credentials". A duplicate email on register returns 409 `{ error: "Conflict", message }`. The `UNIQUE` index on `users.email` is the final guard, so a race between two registrations also ends in 409.
  - Emails are trimmed and lower-cased before they are stored or looked up, and limited to 254 characters. Names follow the `normalizeLabel` rule (trimmed, not blank, at most 100 characters).
  - `POST /teams` passes the caller to `TeamService.create`, which ignores it until 2b.
- Stage 4 team deletion cascades: `DELETE /teams/{id}` removes the team from every note's `team_ids`. A note left with no teams becomes private to its owner. Blocking with 409 was rejected because, with no admin role, a blocked team could become undeletable.
