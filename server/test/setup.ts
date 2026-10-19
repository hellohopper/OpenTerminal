// A developer may have DATABASE_URL exported for the app. Unit-test fixtures
// must never connect to that database. PostgreSQL tests explicitly opt in with
// TEST_DATABASE_URL and create their own temporary schemas in beforeAll.
delete process.env.DATABASE_URL;

// Every suite starts with a disposable default, including modules imported at top level.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll} from 'vitest';
const fixtureDirectory=mkdtempSync(join(tmpdir(),'terminal-suite-'));
process.env.DATA_DIR=fixtureDirectory;
afterAll(()=>rmSync(fixtureDirectory,{recursive:true,force:true}));
