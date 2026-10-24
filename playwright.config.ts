import {defineConfig} from '@playwright/test';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'terminal-e2e-'));
const env={TRUST_PROXY:'1',ANTHROPIC_API_KEY:'',ANTHROPIC_AUTH_TOKEN:'',API_KEY:'fixture-api-key-'.repeat(4),API_PORT:'4100',API_URL:'http://127.0.0.1:4100',DATA_DIR:dir,DATABASE_URL:'',WEB_PASSWORD:'fixture owner password',WEB_SESSION_SECRET:'fixture-session-secret-'.repeat(3),WEB_ORIGIN:'http://127.0.0.1:3100',WEB_AUTH_DISABLED:''};
export default defineConfig({testDir:'./tests/e2e',workers:1,use:{baseURL:'http://127.0.0.1:3100',headless:true,viewport:{width:1600,height:1100}},webServer:[{command:'node --import ./tests/fixtures/providers.mjs server/dist/index.js',url:'http://127.0.0.1:4100/api/status',env,reuseExistingServer:false},{command:'npm run start -w web -- --hostname 127.0.0.1 --port 3100',url:'http://127.0.0.1:3100/login',env,reuseExistingServer:false}],reporter:'list'});
