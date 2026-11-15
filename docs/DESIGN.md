# Notes Service: Design

Backend for a note-taking service used and shared by several small teams.

## Scope

**Stage 1 (this pass): single user.** No login and no team membership endpoints. One default user is seeded at startup. Notes can be labeled with one or more teams.

**Stage 2 (later): multi-user.** Built in two parts. Stage 1 is built so this is a small change (see "Seams for stage 2").

- **2a, tokens without passwords.** `POST /auth/register` (`email`, `name`) creates a user and returns a JWT. `POST /auth/login` (`email` only) returns a JWT. `GET /users/me`. `getCurrentUser` reads the bearer token and returns 401 for a missing or invalid one. Notes record the real owner. Access rules stay open, so any logged-in user can still read and edit any note. Login proves nothing at this point, which is intended and is fixed in stage 5.
- **2b, team access.** Team membership endpoints, `POST /teams` makes the creator the first member, the real `canRead` and `canWrite`, `GET /notes` filtered to what the caller can see, and `team_ids` validation against membership.

**Stage 3 (later): revisions.** Every edit to a note keeps a snapshot of its previous state, so history can be listed and restored. Built after stage 2 so each revision records a real editor (`edited_by`). See "Revisions (stage 3)".

**Stage 4 (later): deletion.** `DELETE /notes/{id}` (204, owner-only once stage 2 is in) and `DELETE /teams/{id}`. Stages 1 to 3 have no delete endpoints. The `ON DELETE CASCADE` constraints on `note_teams` are created in stage 1, so this needs no schema change.

**Stage 5 (later): passwords.** `register` takes a `password` (minimum 8 characters). It is hashed with `scrypt` from Node's `crypto`, using a 16-byte random salt per user, and stored as `scrypt$<salt hex>$<hash hex>` in `users.password_hash`. `login` recomputes the hash and compares with `crypto.timingSafeEqual`. An unknown email and a wrong password both return the same 401. The hash never appears in a response. The seeded user's password comes from an environment variable. Optional: `@fastify/rate-limit` on `/auth/login`. No other route changes, because they already depend only on the token.

## Stack

- Node + TypeScript
- Fastify, with schemas defined in TypeBox (`@sinclair/typebox`, `@fastify/type-provider-typebox`). Validation uses Fastify's built-in Ajv.
- SQLite via `better-sqlite3` and plain prepared statements. Zero setup: the database is a single file.
- Optional: `@fastify/swagger` and `@fastify/swagger-ui` for API docs generated from the schemas.

## Data model

Database is relational. The schema is applied at startup with `CREATE TABLE IF NOT EXISTS`, so a later stage can add its tables without touching existing data. `team_members` is created in stage 1 even though it is used from stage 2.

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
| GET | `/teams` | List |
| GET | `/teams/{id}` | Fetch one |

### Conventions
- JSON in and out. IDs are UUIDs.
- Errors use one shape: `{ "error": string, "message": string }`, with 400 (validation), 404 (not found).
- `POST` returns 201 with the created resource.
- List responses: `{ "items": [...], "total": number, "limit": number, "offset": number }`.
- Unknown `team_ids` on create or update return 400.

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
  services/         notes, teams, access, (later) auth, revisions
  presentation/
    routes/         notes.ts, teams.ts (one FastifyPluginAsync each)
    schemas/        TypeBox schemas: note, team, error, pagination
    error-handler.ts
```

Routes follow the pattern used in the reference example: `instance.withTypeProvider<TypeBoxTypeProvider>()`, per-status response schemas, and types derived with `Static<typeof schema>`. The difference is that handlers receive their service through the plugin's options, not from a decorated `app` property, and they map domain errors to responses in the shared error handler instead of checking for `undefined`.

Later stages fit the same layers: stage 2a adds `auth` and the token check (presentation) with a user lookup (data). Stage 2b changes the access service only. Stage 3 adds a `RevisionRepository` and a revision service, and the note service calls it inside the edit transaction. Stage 5 changes the auth service and the `users` repository.

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

## Seams for stage 2

1. **Current user.** Routes get the user from `getCurrentUser(request)`. Stage 1 returns the seeded default user. Stage 2a changes this one function to read the bearer token and reject missing or invalid ones with 401. The JWT uses `JWT_SECRET` (a dev default with a logged warning) and has an expiry.
2. **Access control.** Services call `canRead(user, note)` and `canWrite(user, note)` from the access service. Routes never check access themselves. Stages 1 and 2a allow everything. Stage 2b implements the rule below. Delete stays owner-only.
3. **Schema.** `team_members` already exists.

### Stage 2b access rule
Sharing is team-based only. There are no per-user shares and no roles.

- A note with an empty `team_ids` is private to its owner.
- A user can read and edit a note if they own it or belong to any team in its `team_ids`.
- Only the owner can delete a note.
- When setting `team_ids`, the user must belong to each team.

Team rules in 2b: anyone logged in can create a team and becomes its first member. Any member can add any existing user (`PUT /teams/{id}/members/{userId}`) or remove any member (`DELETE`), including themselves. Self-join is not allowed, since it would let anyone read any team's notes. Equal members can remove each other, which is a known limit of having no roles.

## Decisions and non-goals

- Hard delete for notes. No soft delete.
- Revisions are full snapshots, not diffs, with no cap on history length.
- Search is a simple case-insensitive `LIKE` over title and body. No full-text index.
- No tags. Teams serve as the grouping mechanism.
- SQLite is single-writer, which is acceptable for this scope.
- Tests, when added, use `app.inject()` against an in-memory SQLite database.

## Open questions

- None.

## Resolved decisions

- Data persists across restarts. SQLite is file-backed by default (path set by a `DB_PATH` environment variable, with a default such as `./data/notes.db`). `DB_PATH=:memory:` switches to an in-memory database, which tests use.
- Stage 4 team deletion cascades: `DELETE /teams/{id}` removes the team from every note's `team_ids`. A note left with no teams becomes private to its owner. Blocking with 409 was rejected because, with no admin role, a blocked team could become undeletable.
