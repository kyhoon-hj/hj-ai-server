// Read-only checks; never prints response bodies or credentials.
const base = process.env.DEPLOY_AI_BASE_URL;
if (!base) throw new Error('DEPLOY_AI_BASE_URL is required');
const checks = [
  ['AI liveness', new URL('health/live', `${base.replace(/\/$/, '')}/`), 200],
  ['AI readiness', new URL('health/ready', `${base.replace(/\/$/, '')}/`), 200],
];
if (process.env.DEPLOY_VALIDATION_URL) checks.push(['Validation access gate', new URL(process.env.DEPLOY_VALIDATION_URL), 401]);
let failed = false;
for (const [name, url, expected] of checks) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'manual' });
    await response.body?.cancel();
    const ok = response.status === expected;
    failed ||= !ok;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: HTTP ${response.status} (expected ${expected})`);
  } catch { failed = true; console.log(`FAIL ${name}: connection unavailable`); }
}
process.exitCode = failed ? 1 : 0;
