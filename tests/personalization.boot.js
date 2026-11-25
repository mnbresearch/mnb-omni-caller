const path = require('path');
const os = require('os');
const assert = require('assert/strict');

// Set isolated test environment
process.env.REDIS_URL = '';
process.env.OMNIDIM_API_KEY = 'test-key-not-real';
process.env.DATA_DIR = path.join(os.tmpdir(), 'omni-pz-boot-' + Date.now());
process.env.NODE_ENV = 'test';
process.env.PORT = '4833';
process.env.ADMIN_EMAIL = 'admin@pz.test';
process.env.ADMIN_PASSWORD = 'admin-pw-for-test-123';
delete process.env.VERCEL;

const db = require('../db.js');
const server = require('../server.js');
const base = 'http://127.0.0.1:4833';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await sleep(1500);

  console.log('Running Personalization Boot & API Integration Tests...');

  // Create two separate tenant users and an admin
  const userA = db.createUser({ email: 'userA@pz.test', password: 'passwordA-123', org: 'Org A', status: 'active' });
  const userB = db.createUser({ email: 'userB@pz.test', password: 'passwordB-123', org: 'Org B', status: 'active' });
  db.ensureAdmin('admin@pz.test', 'admin-pw-for-test-123');
  const admin = db.findUserByEmail('admin@pz.test');

  const tokenA = db.createSession(userA.id);
  const tokenB = db.createSession(userB.id);
  const tokenAdmin = db.createSession(admin.id);

  const cookieA = `mnb_session=${tokenA}`;
  const cookieB = `mnb_session=${tokenB}`;
  const cookieAdmin = `mnb_session=${tokenAdmin}`;

  // 1. Unauthenticated request should fail with 401
  const unauth = await fetch(`${base}/api/personalization`);
  assert.equal(unauth.status, 401, 'Unauthenticated request must be rejected with 401');
  console.log('PASS: Unauthenticated request rejected (401)');

  // 2. User A fetches initial personalization
  const resA = await fetch(`${base}/api/personalization`, { headers: { Cookie: cookieA } });
  assert.equal(resA.status, 200);
  const dataA = await resA.json();
  assert.equal(dataA.ok, true);
  assert.ok(dataA.personalization);
  assert.equal(dataA.personalization.role, 'sales_leader');
  assert.ok(Array.isArray(dataA.modules));
  assert.equal(dataA.modules.length, 31);
  console.log('PASS: Initial personalization returned 31 modules and role defaults');

  // 3. User A updates personalization (Level 3 configuration)
  const customPayload = {
    role: 'call_center_mgr',
    industry: 'healthcare',
    primaryObjective: 'appointment_booking',
    widgets: ['w_live_monitor', 'w_recent_calls', 'w_kpi_ribbon'],
    pinnedTools: ['overview', 'tools', 'live', 'logs', 'reminders'],
    hiddenModules: ['campaigns'],
    favorites: ['live', 'logs']
  };

  const updateA = await fetch(`${base}/api/personalization`, {
    method: 'PUT',
    headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify(customPayload)
  });
  assert.equal(updateA.status, 200);
  const updatedDataA = await updateA.json();
  assert.equal(updatedDataA.ok, true);
  assert.equal(updatedDataA.personalization.role, 'call_center_mgr');
  assert.deepEqual(updatedDataA.personalization.widgets, ['w_live_monitor', 'w_recent_calls', 'w_kpi_ribbon']);
  assert.deepEqual(updatedDataA.personalization.hiddenModules, ['campaigns']);
  console.log('PASS: User A successfully customized Level 3 configuration');

  // 4. Verify tenant isolation: User B's personalization remains unchanged and isolated!
  const resB = await fetch(`${base}/api/personalization`, { headers: { Cookie: cookieB } });
  assert.equal(resB.status, 200);
  const dataB = await resB.json();
  assert.equal(dataB.personalization.role, 'sales_leader', 'User B must not have User A role');
  assert.notDeepEqual(dataB.personalization.widgets, customPayload.widgets, 'User B must not have User A widgets');
  console.log('PASS: Multi-tenant isolation verified (User A != User B)');

  // 5. Test module states for User A: 'campaigns' must have visible: false because User A hid it
  const campaignsModA = updatedDataA.modules.find((m) => m.id === 'campaigns');
  assert.equal(campaignsModA.visible, false, 'Hidden module must have visible: false');
  assert.equal(campaignsModA.enabled, true, 'Org still enabled it');
  assert.equal(campaignsModA.permitted, true, 'User is permitted');
  console.log('PASS: Module 4-state matrix accurately computed (available, enabled, visible, permitted)');

  // 6. Non-admin trying to update org modules should be rejected with 403
  const forbiddenOrgUpdate = await fetch(`${base}/api/admin/org/modules`, {
    method: 'PUT',
    headers: { Cookie: cookieA, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modules: { export: false } })
  });
  assert.equal(forbiddenOrgUpdate.status, 403, 'Non-admin cannot update org modules');
  console.log('PASS: Level 1 Org configuration protected against non-admins (403)');

  // 7. Admin can update org modules (Level 1)
  const adminOrgUpdate = await fetch(`${base}/api/admin/org/modules`, {
    method: 'PUT',
    headers: { Cookie: cookieAdmin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ modules: { export: false } })
  });
  assert.equal(adminOrgUpdate.status, 200);
  console.log('PASS: Admin updated Level 1 Org modules');

  // 8. User A re-fetches modules: 'export' should now have enabled: false
  const modulesA = await fetch(`${base}/api/modules`, { headers: { Cookie: cookieA } }).then((r) => r.json());
  const exportMod = modulesA.modules.find((m) => m.id === 'export');
  assert.equal(exportMod.enabled, false, 'Export module must now be disabled org-wide');
  console.log('PASS: Level 1 org-wide disable propagates to tenant users');

  // 9. Reset endpoint
  const resetRes = await fetch(`${base}/api/personalization/reset?role=executive`, {
    method: 'POST',
    headers: { Cookie: cookieA }
  });
  assert.equal(resetRes.status, 200);
  const resetData = await resetRes.json();
  assert.equal(resetData.personalization.role, 'executive');
  assert.ok(resetData.personalization.widgets.includes('w_agent_performance'));
  console.log('PASS: Reset to executive role layout verified');

  console.log('\nAll 9 Personalization & Feature Registry tests passed successfully!');
  process.exit(0);
})().catch((err) => {
  console.error('Test Failed:', err);
  process.exit(1);
});
