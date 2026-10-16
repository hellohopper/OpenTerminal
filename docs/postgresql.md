# PostgreSQL storage

SQLite remains the default. Set **DATABASE_URL** on the API process to use PostgreSQL for portfolios, trades, cash events, journal entries and images, briefings, price-alert rules and trigger history. Workspace layouts, chart annotations and notification preferences remain in browser storage.

## Connect an existing PostgreSQL server

Create a dedicated empty database (or schema) and give the application role permission to create its tables and sequences. PostgreSQL 17 is exercised in CI and integration tests.

```bash
export DATABASE_URL='postgresql://openterminal:password@127.0.0.1:5432/openterminal'
npm run dev
```

The API initializes its schema and a default Main portfolio before accepting requests. `/api/status` reports `database: "postgres"` or `"sqlite"` without exposing connection details. A PostgreSQL connection or initialization failure stops startup; it does not silently switch to SQLite.

For a remote server, configure TLS using the provider's connection string and CA instructions; for example, `?sslmode=verify-full`. Certificate verification is not disabled by the application. Credentials containing reserved URI characters must be percent-encoded. The [node-postgres connection documentation](https://node-postgres.com/features/ssl) explains the driver's TLS options.

`DATA_DIR` is still used for the generated API key when API_KEY is unset. Keep the same API_KEY on API and web instances. Existing SQLite files are not automatically migrated, deleted or synchronized when DATABASE_URL changes. Unset DATABASE_URL to use the SQLite file again.

## Docker with a local PostgreSQL service

Choose a URI-safe password, such as a generated hexadecimal secret, and keep it in your shell environment or deployment secrets.

```bash
export POSTGRES_PASSWORD='replace-with-a-generated-hex-secret'
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up --build
```

The override starts PostgreSQL 17, waits for its health check, and connects the API. Database files persist in the `postgres-data` volume. The database port is internal to the Compose network. The existing `terminal-data` volume still holds API-key files and any previous SQLite database. Avoid deleting either volume unless you intend to remove its stored data.

The base Compose file also accepts DATABASE_URL directly for an externally managed PostgreSQL service. The default `docker compose up --build` continues to use SQLite when that variable is unset. Docker Compose was not available in the local verification environment; the configuration is provided with the tested database connection settings.

## Import an existing SQLite database

The importer copies all supported tables in one PostgreSQL transaction, retaining IDs, timestamps, attachments and alert-event snapshots. It refuses a destination with any existing application rows, including an automatically seeded Main portfolio. Run it **before starting the API against the new destination**.

1. Stop the current API and take a backup of its SQLite database. The default file is `data/terminal.db`, or `DATA_DIR/terminal.db` when configured. Upgrade/run the current SQLite version first if importing an older schema.
2. Create an empty PostgreSQL database/schema. Configure DATABASE_URL for that destination.
3. Build and run the import:

```bash
npm run build -w server
export DATABASE_URL='postgresql://openterminal:password@127.0.0.1:5432/openterminal'
npm run db:migrate -w server -- --sqlite /absolute/path/to/terminal.db
```

4. The command prints imported counts per table. Start the API and verify your portfolios, journal and history.

For the production Docker image, the equivalent command is `node dist/migrate-sqlite.js --sqlite /path/to/terminal.db`, with DATABASE_URL set and the source file mounted. Use a one-off API container before bringing up the normal API service; the PostgreSQL service must already be healthy.

The source is opened read-only and checked for broken foreign keys. The importer reads a consistent source snapshot into memory, so provide enough memory for the database, including images. It does not overwrite destination rows. An insert failure rolls back the imported rows; a second successful import into the same populated destination is refused. PostgreSQL sequences are advanced to the imported maximum IDs so later inserts work normally. Browser-local layouts and annotations are not part of this database import.

## Transaction behavior and verification

The API uses an asynchronous database interface for both backends. SQLite queues database work and uses BEGIN IMMEDIATE for mutations. PostgreSQL uses a connection pool, a single checked-out connection per transaction, and a transaction-scoped advisory lock for application mutations and consistent ledger reads. This keeps ledger validation and alert limits atomic across API processes; it deliberately serializes those operations rather than aiming for high write throughput. Direct SQL writers do not participate in that application lock.

PostgreSQL pool size is five per API process, connection timeout five seconds, and statement/lock timeouts ten seconds. Nested application transactions are rejected. Graceful shutdown drains the alert monitor, HTTP requests and database connections. IDs/counts use safe JavaScript integers and timestamps preserve the existing API's UTC text format.

The regular suite runs SQLite tests without a database service; PostgreSQL integration tests are skipped unless TEST_DATABASE_URL is set. To run real PostgreSQL checks:

```bash
TEST_DATABASE_URL='postgresql://openterminal:password@127.0.0.1:5432/openterminal_test' npm test
# Or only the PostgreSQL integration tests:
TEST_DATABASE_URL='postgresql://openterminal:password@127.0.0.1:5432/openterminal_test' npm run test:postgres -w server
```

Tests ignore the application DATABASE_URL so unit fixtures cannot connect to an exported production connection string. Use a disposable test database for TEST_DATABASE_URL. The integration suite creates and removes uniquely named schemas and needs CREATE SCHEMA permission. CI provisions PostgreSQL 17 and runs both backends. Tests cover async transaction isolation, rollback, concurrent oversell prevention, alert limits and duplicate triggers, API metadata types, migration fidelity, sequences, failed imports and nonempty-target refusal. Browser integration with fixture market providers verifies journal screenshots, portfolio performance, briefings and private AI source collection through the PostgreSQL-backed API. API restart and the migration CLI are also verified locally.
