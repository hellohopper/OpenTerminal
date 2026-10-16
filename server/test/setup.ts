// A developer may have DATABASE_URL exported for the app. Unit-test fixtures
// must never connect to that database. PostgreSQL tests explicitly opt in with
// TEST_DATABASE_URL and create their own temporary schemas in beforeAll.
delete process.env.DATABASE_URL;
