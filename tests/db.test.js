/* MNB Omni Caller - data-layer tests (API keys, analytics, deletion, DNC data)
 *
 * Runs on the built-in Node test runner: `npm test`. No network, no Redis -
 * db.js falls back to its in-memory/JSON store when REDIS_URL is unset, so
 * these tests use synthetic data only and never touch production.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.REDIS_URL = '';                 // force the local fallback store
process.env.DATA_DIR = require('node:os').tmpdir() + '/omni-test-' + Date.now();

const db = require('../db.js');

function freshUser(suffix) {
  return db.createUser({
    email: `t${suffix}-${Date.now()}@example.test`,
    password: 'synthetic-password-123',
    org: 'Test Org ' + suffix,
    status: 'active',
  });
}

/* ------------------------------ API keys ------------------------------ */

test('createApiKey returns a usable 256-bit secret and stores only a hash', () => {
  const u = freshUser('a');
  const { record, secret } = db.createApiKey(u.id, { name: 'CI key', scopes: ['calls:read'] });

  assert.match(secret, /^mnb_sk_[a-f0-9]{16}_[a-f0-9]{64}$/, 'key format');
  assert.equal(secret.split('_')[3].length, 64, '64 hex chars = 256 bits of entropy');

  // The plaintext must never be retrievable afterwards.
  assert.equal(record.secret, undefined);
  assert.equal(record.hash, undefined, 'hash must not be exposed to callers');
  const listed = db.listApiKeys(u.id).find((k) => k.id === record.id);
  assert.equal(listed.hash, undefined);
  assert.ok(listed.masked.includes('*'), 'listing shows a masked form only');

  const verified = db.verifyApiKey(secret);
  assert.ok(verified, 'the issued key authenticates');
  assert.equal(verified.userId, u.id);
});

test('verifyApiKey rejects garbage, wrong secret and tampered id', () => {
  const u = freshUser('b');
  const { record, secret } = db.createApiKey(u.id, { scopes: ['calls:read'] });

  assert.equal(db.verifyApiKey(''), null);
  assert.equal(db.verifyApiKey('not-a-key'), null);
  assert.equal(db.verifyApiKey('mnb_sk_short_abc'), null);
  // right id, wrong secret
  assert.equal(db.verifyApiKey('mnb_sk_' + record.id + '_' + 'f'.repeat(64)), null);
  // valid secret, unknown id
  assert.equal(db.verifyApiKey('mnb_sk_' + '0'.repeat(16) + '_' + secret.split('_')[3]), null);
});

test('revoked keys stop authenticating immediately', () => {
  const u = freshUser('c');
  const { record, secret } = db.createApiKey(u.id, { scopes: ['calls:read'] });
  assert.ok(db.verifyApiKey(secret));

  db.revokeApiKey(record.id, u.id);
  assert.equal(db.verifyApiKey(secret), null, 'revocation takes effect at once');
  assert.equal(db.getApiKey(record.id).status, 'revoked');
});

test('expired keys stop authenticating', () => {
  const u = freshUser('d');
  const { record, secret } = db.createApiKey(u.id, { scopes: ['calls:read'], expiresInDays: 1 });
  assert.ok(db.verifyApiKey(secret), 'valid before expiry');

  // Move expiry into the past through the public listing -> mutate via rotate-free path
  const all = db.listApiKeys(u.id);
  assert.ok(all.find((k) => k.id === record.id).expiresAt, 'expiry recorded');
  // Simulate the clock passing: re-create with a negative window.
  const past = db.createApiKey(u.id, { scopes: ['calls:read'], expiresInDays: -1 });
  assert.equal(db.verifyApiKey(past.secret), null, 'already-expired key is refused');
});

test('rotation issues a new secret and kills the old one when overlap is 0', () => {
  const u = freshUser('e');
  const first = db.createApiKey(u.id, { name: 'rotate-me', scopes: ['calls:read', 'agents:read'] });

  const next = db.rotateApiKey(first.record.id, { overlapMinutes: 0, byUserId: u.id });
  assert.ok(next, 'rotation returns the replacement');
  assert.notEqual(next.secret, first.secret, 'a brand new secret is issued');
  assert.deepEqual(next.record.scopes, first.record.scopes, 'scopes carry over');
  assert.equal(next.record.rotatedFrom, first.record.id, 'lineage recorded');

  assert.equal(db.verifyApiKey(first.secret), null, 'old secret dead with no overlap');
  assert.ok(db.verifyApiKey(next.secret), 'new secret works');
});

test('rotation with an overlap window keeps the old key alive briefly', () => {
  const u = freshUser('f');
  const first = db.createApiKey(u.id, { scopes: ['calls:read'] });
  const next = db.rotateApiKey(first.record.id, { overlapMinutes: 10, byUserId: u.id });

  assert.ok(db.verifyApiKey(first.secret), 'old key still valid during overlap');
  assert.ok(db.verifyApiKey(next.secret), 'new key valid too');
  const old = db.getApiKey(first.record.id);
  assert.ok(Date.parse(old.expiresAt) > Date.now(), 'old key now has a short expiry');
});

test('only whitelisted scopes are stored', () => {
  const u = freshUser('g');
  const { record } = db.createApiKey(u.id, { scopes: ['calls:read', 'totally:fake', 'admin:*'] });
  assert.deepEqual(record.scopes, ['calls:read'], 'unknown scopes are dropped, not stored');
});

test('keys are isolated per account (no cross-tenant listing)', () => {
  const a = freshUser('h1');
  const b = freshUser('h2');
  const ka = db.createApiKey(a.id, { scopes: ['calls:read'] });
  db.createApiKey(b.id, { scopes: ['calls:read'] });

  const bKeys = db.listApiKeys(b.id).map((k) => k.id);
  assert.ok(!bKeys.includes(ka.record.id), "account B cannot see account A's key");

  // A's key resolves to A, never to B.
  assert.equal(db.verifyApiKey(ka.secret).userId, a.id);
});

test('audit log records key lifecycle without ever storing the secret', () => {
  const u = freshUser('i');
  const { record, secret } = db.createApiKey(u.id, { scopes: ['calls:read'] });
  db.revokeApiKey(record.id, u.id);

  const entries = db.listAudit(50, u.id);
  const actions = entries.map((e) => e.action);
  assert.ok(actions.includes('apikey.create'));
  assert.ok(actions.includes('apikey.revoke'));

  const blob = JSON.stringify(entries);
  const rawSecret = secret.split('_')[3];
  assert.ok(!blob.includes(rawSecret), 'secret value never appears in the audit log');
});

/* ---------------------------- account deletion ---------------------------- */

test('deleting an account removes its keys and personal data', () => {
  const u = freshUser('j');
  const { secret } = db.createApiKey(u.id, { scopes: ['calls:read'] });
  db.setUserBucket(u.id, 'contacts', [{ name: 'Synthetic', phone: '+910000000000' }]);
  db.setUserBucket(u.id, 'blocklist', ['+919999999999']);
  assert.ok(db.verifyApiKey(secret));

  db.deleteUser(u.id);

  assert.equal(db.verifyApiKey(secret), null, "a deleted account's key must stop working");
  assert.equal(db.findUserById(u.id), undefined);
  const left = db.getUserData(u.id);
  assert.ok(!left.contacts || !left.contacts.length, 'contacts removed');
  assert.ok(!left.blocklist || !left.blocklist.length, 'Do-Not-Call list removed');
});

/* ------------------------------- analytics ------------------------------- */

test('trackEvent aggregates daily counters and keeps a bounded raw ring', () => {
  const u = freshUser('k');
  const before = db.eventTotals(30)['test.event'] || 0;
  db.trackEvent('test.event', { userId: u.id, props: { n: 1 } });
  db.trackEvent('test.event', { userId: u.id, props: { n: 2 } });

  assert.equal((db.eventTotals(30)['test.event'] || 0), before + 2, 'daily totals add up');
  const mine = db.listEvents({ name: 'test.event', userId: u.id });
  assert.ok(mine.length >= 2);
  assert.equal(mine[0].name, 'test.event');

  const daily = db.eventDaily(30);
  const today = new Date().toISOString().slice(0, 10);
  assert.ok(daily[today]['test.event'] >= 2);
});

test('backup snapshot strips password and key hashes', () => {
  const u = freshUser('l');
  db.createApiKey(u.id, { scopes: ['calls:read'] });
  const snap = db.exportSnapshot();

  const blob = JSON.stringify(snap);
  assert.ok(!blob.includes('passHash":"'), 'no password hashes in the export');
  for (const k of snap.apiKeys) assert.equal(k.hash, undefined, 'no API-key hashes in the export');
  assert.ok(snap.counts.users >= 1);
  assert.ok(snap.exportedAt);
})
