const test = require('node:test');
const assert = require('node:assert/strict');
const pz = require('../personalization.js');

test('personalization engine exposes all 6 personas and 10 widgets', () => {
  const personaKeys = Object.keys(pz.PERSONAS);
  assert.equal(personaKeys.length, 6);
  assert.ok(personaKeys.includes('sales_leader'));
  assert.ok(personaKeys.includes('call_center_mgr'));
  assert.ok(personaKeys.includes('executive'));
  assert.ok(personaKeys.includes('smb_founder'));
  assert.ok(personaKeys.includes('agency_admin'));
  assert.ok(personaKeys.includes('tech_dev'));

  const widgetKeys = Object.keys(pz.WIDGETS_CATALOG);
  assert.equal(widgetKeys.length, 10);
  assert.ok(widgetKeys.includes('w_kpi_ribbon'));
  assert.ok(widgetKeys.includes('w_quick_actions'));
  assert.ok(widgetKeys.includes('w_recent_calls'));
});

test('feature catalogue contains 31 distinct modules', () => {
  assert.equal(pz.MODULES_REGISTRY.length, 31);
  const ids = new Set(pz.MODULES_REGISTRY.map((m) => m.id));
  assert.equal(ids.size, 31, 'All module IDs must be unique');
  assert.ok(ids.has('overview'));
  assert.ok(ids.has('getstarted'));
  assert.ok(ids.has('tools'));
  assert.ok(ids.has('call'));
  assert.ok(ids.has('logs'));
  assert.ok(ids.has('studio'));
  assert.ok(ids.has('campaigns'));
  assert.ok(ids.has('admin'));
});

test('calculateModuleStates correctly distinguishes the 4 distinct states', () => {
  const standardUser = { id: 'u1', role: 'user', businessType: 'real_estate' };
  const adminUser = { id: 'u_admin', role: 'admin' };

  // Org disables 'export' at Level 1
  const orgSettings = { modules: { export: false } };
  
  // User hides 'blocklist' at Level 3
  const userPrefs = pz.getDefaultPersonalization('sales_leader', standardUser);
  userPrefs.hiddenModules = ['blocklist'];

  const standardStates = pz.calculateModuleStates(standardUser, orgSettings, userPrefs);
  const adminStates = pz.calculateModuleStates(adminUser, orgSettings, userPrefs);

  // Admin module: permitted for admin, forbidden for standard user
  const adminModForUser = standardStates.find((m) => m.id === 'admin');
  const adminModForAdmin = adminStates.find((m) => m.id === 'admin');
  assert.equal(adminModForUser.permitted, false, 'Standard user must not have permitted: true for admin module');
  assert.equal(adminModForAdmin.permitted, true, 'Admin user must have permitted: true for admin module');

  // Export module: disabled at Level 1 (org-wide)
  const exportMod = standardStates.find((m) => m.id === 'export');
  assert.equal(exportMod.available, true, 'Module is available in codebase');
  assert.equal(exportMod.enabled, false, 'Module is disabled by org admin');

  // Blocklist module: hidden by user at Level 3
  const blocklistMod = standardStates.find((m) => m.id === 'blocklist');
  assert.equal(blocklistMod.enabled, true, 'Blocklist is enabled by org');
  assert.equal(blocklistMod.permitted, true, 'User is permitted to use blocklist');
  assert.equal(blocklistMod.visible, false, 'User hid blocklist so visible is false');

  // Hiding from frontend does NOT grant or revoke permission
  assert.equal(blocklistMod.permitted, true);
});

test('sanitizePersonalization discards invalid widgets and malicious values', () => {
  const clean = pz.sanitizePersonalization({
    role: 'invalid_role_hack',
    widgets: ['w_kpi_ribbon', 'malicious_widget_script_tag', 'w_quick_actions'],
    industry: '<script>alert(1)</script>fintech',
    density: 'ultra_dense_hack',
    pinnedTools: ['overview', 'fake_tool', 'call']
  });

  assert.equal(clean.role, 'sales_leader', 'Falls back to valid role');
  assert.deepEqual(clean.widgets, ['w_kpi_ribbon', 'w_quick_actions'], 'Strips invalid widgets');
  assert.equal(clean.density, 'comfortable', 'Validates density options');
  assert.deepEqual(clean.pinnedTools, ['overview', 'call'], 'Strips non-existent module IDs');
});
