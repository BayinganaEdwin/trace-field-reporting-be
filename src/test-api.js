/**
 * test-api.js — smoke-test the running backend
 * Run: node src/test-api.js
 * Requires backend to be running on localhost:3000
 */

const BASE = 'http://localhost:3000';

async function req(method, path, body, userId = 'user-manager-1') {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  const ok = res.ok ? '✓' : '✗';
  console.log(`${ok}  ${method.padEnd(6)} ${path.padEnd(40)} → ${res.status}`);
  if (!res.ok) console.log('   ', JSON.stringify(data));
  return data;
}

async function main() {
  console.log('═'.repeat(60));
  console.log('SiteLog API smoke test');
  console.log('═'.repeat(60));

  await req('GET', '/health');

  // Users
  await req('GET', '/users/me');
  await req('GET', '/users/me', null, 'user-worker-1');

  // Sites
  const sites = await req('GET', '/sites');
  const siteId = sites[0]?.id;
  if (siteId) await req('GET', `/sites/${siteId}`);

  // Reports (as manager)
  const reports = await req('GET', '/reports');
  const reportId = reports[0]?.id;
  if (reportId) {
    await req('GET', `/reports/${reportId}`);
  }

  // Reports (as worker)
  await req('GET', '/reports', null, 'user-worker-1');

  // Analytics
  await req('GET', '/analytics/summary');

  // Notifications
  await req('GET', '/notifications');

  console.log('\n' + '═'.repeat(60));
  console.log('Smoke test complete.');
}

main().catch(console.error);
