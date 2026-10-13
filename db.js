/**
 * MNB Omni Caller \u2014 data store.
 * Uses Upstash Redis (via REDIS_URL) so client accounts persist across restarts
 * on Render's free plan. Falls back to a local JSON file if REDIS_URL is unset
 * (handy for local development).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REDIS_URL = process.env.REDIS_URL || '';
const REDIS_KEY = 'mnb:omnicaller:db';

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let state = {
  users: [], sessions: {}, kbOwners: {}, settings: {}, userData: {}, orders: {},
  resetTokens: {}, widgets: {},
  apiKeys: {},      // keyId -> {id, userId, name, hash, scopes, status, createdAt, expiresAt, lastUsedAt, rotatedFrom}
  auditLog: [],     // capped ring: {at, userId, action, target, meta} - never contains secrets
  events: [],       // capped ring of raw product-analytics events
  eventDaily: {},   // 'YYYY-MM-DD' -> { eventName: count } (small, keeps history after ring rolls)
};
const EVENT_RING_MAX = 5000;   // the whole DB is one JSON blob, so raw events are bounded
const AUDIT_RING_MAX = 2000;
let redis = null;
const memRL = new Map(); // in-memory rate-limit fallback when Redis is down

function normalize() {
  state.users ||= [];
  state.sessions ||= {};
  state.kbOwners ||= {};
  state.settings ||= {};
  state.userData ||= {};
  state.orders ||= {};
  state.resetTokens ||= {};
  state.widgets ||= {};
  state.apiKeys ||= {};
  state.auditLog ||= [];
  state.events ||= [];
  state.eventDaily ||= {};
}

/* ---------- persistence backend ---------- */
async function init() {
  if (REDIS_URL) {
    const Redis = require('ioredis');
    redis = new Redis(REDIS_URL, {
      tls: REDIS_URL.startsWith('rediss://') ? {} : { rejectUnauthorized: false },
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    redis.on('error', (e) => console.error('Redis error:', e.message));
    try {
      const raw = await redis.get(REDIS_KEY);
      if (raw) state = JSON.parse(raw);
      normalize();
      console.log('Loaded database from Upstash Redis');
    } catch (e) {
      console.error('Redis load failed, starting empty:', e.message);
      normalize();
    }
  } else {
    try {
      if (fs.existsSync(DB_FILE)) state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    } catch (e) { console.error('DB file load failed:', e.message); }
    normalize();
  }
}

function save() {
  if (redis) {
    redis.set(REDIS_KEY, JSON.stringify(state)).catch((e) => console.error('Redis save failed:', e.message));
  } else {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, DB_FILE);
    } catch (e) { console.error('DB file save failed:', e.message); }
  }
}

// Awaited flush \u2014 used on shutdown so the last write always lands.
async function flush() {
  try {
    if (redis) await redis.set(REDIS_KEY, JSON.stringify(state));
  } catch (e) { console.error('Flush failed:', e.message); }
}

/* ---------- passwords (scrypt, no native deps) ---------- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const check = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(check, 'hex'));
  } catch { return false; }
}

/* ---------- users ---------- */
function findUserByEmail(email) {
  return state.users.find((u) => u.email.toLowerCase() === String(email).toLowerCase());
}
function findUserById(id) {
  return state.users.find((u) => u.id === id);
}
function createUser({ email, password, org, role = 'client', status = 'pending', contact = '', phone = '', note = '', demo = false }) {
  const user = {
    id: crypto.randomUUID(),
    email: String(email).toLowerCase().trim(),
    passHash: hashPassword(password),
    org: String(org || '').trim(),
    contact: String(contact || '').trim(),
    phone: String(phone || '').trim(),
    note: String(note || '').trim(),
    role,
    status,
    demo: !!demo,
    agentIds: [],
    numberIds: [],
    minuteCap: 0,
    agentCap: 5,
    currency: 'INR', // per-account billing currency: 'INR' or 'USD'
    ratePerMin: 0,   // per-account price/min in the account currency; 0 = global default
    minReloadInr: 0, // per-account minimum reload in the account currency; 0 = default (10x rate)
    createdAt: new Date().toISOString(),
  };
  state.users.push(user);
  save();
  return user;
}
function updateUser(id, patch) {
  const u = findUserById(id);
  if (!u) return null;
  Object.assign(u, patch);
  save();
  return u;
}
function deleteUser(id) {
  state.users = state.users.filter((u) => u.id !== id);
  for (const [tok, s] of Object.entries(state.sessions)) if (s.userId === id) delete state.sessions[tok];
  // Clean up everything owned by this account. Leaving these behind orphaned
  // the account's contacts, Do-Not-Call list, API keys and widgets - which both
  // leaks personal data after a deletion request and lets a revoked tenant's
  // key keep working.
  for (const [kid, k] of Object.entries(state.apiKeys)) if (k.userId === id) delete state.apiKeys[kid];
  for (const [wk, w] of Object.entries(state.widgets)) if (w && w.userId === id) delete state.widgets[wk];
  for (const [fid, owner] of Object.entries(state.kbOwners)) if (owner === id) delete state.kbOwners[fid];
  delete state.userData[id]; // contacts, follow-ups, reminders, blocklist
  // Orders are retained (financial records) but no longer resolve to a person.
  audit(null, 'user.delete', id, {});
  save();
}
function listUsers() { return state.users; }

/* ---------- sessions ---------- */
const SESSION_TTL = 1000 * 60 * 60 * 24 * 14; // 14 days
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  state.sessions[token] = { userId, expires: Date.now() + SESSION_TTL };
  save();
  return token;
}
function getSession(token) {
  const s = state.sessions[token];
  if (!s) return null;
  if (s.expires < Date.now()) { delete state.sessions[token]; save(); return null; }
  return s;
}
function destroySession(token) { delete state.sessions[token]; save(); }
function destroyUserSessions(userId) {
  for (const [tok, s] of Object.entries(state.sessions)) if (s.userId === userId) delete state.sessions[tok];
  save();
}

/* ---------- password-reset tokens (hashed, single-use, expiring) ---------- */
function createResetToken(email, ttlMs = 1800000) {
  const user = findUserByEmail(email);
  if (!user) return null;
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  state.resetTokens ||= {};
  state.resetTokens[hash] = { email: user.email, expires: Date.now() + ttlMs };
  save();
  return raw;
}
function consumeResetToken(raw) {
  if (!raw) return null;
  const hash = crypto.createHash('sha256').update(String(raw)).digest('hex');
  const rec = (state.resetTokens || {})[hash];
  if (!rec) return null;
  delete state.resetTokens[hash];
  save();
  if (rec.expires < Date.now()) return null;
  return rec.email;
}

/* ---------- knowledge-base file ownership ---------- */
function setKbOwner(fileId, userId) { state.kbOwners[String(fileId)] = userId; save(); }
function getKbOwner(fileId) { return state.kbOwners[String(fileId)]; }
function removeKbOwner(fileId) { delete state.kbOwners[String(fileId)]; save(); }

/* ---------- platform settings (integration keys, per-platform config) ----------
 * Stored server-side only. Integration secrets never leave the server except
 * masked (last 4 chars) via the admin-only settings endpoint. */
function getSettings() { return state.settings || (state.settings = {}); }
function setSettings(next) { state.settings = next || {}; save(); return state.settings; }
function patchSettings(section, patch) {
  state.settings ||= {};
  state.settings[section] = Object.assign({}, state.settings[section] || {}, patch || {});
  save();
  return state.settings[section];
}

/* ---------- per-user data (CRM: contacts, follow-ups) ---------- */
function getUserData(userId) { state.userData ||= {}; return state.userData[userId] || (state.userData[userId] = {}); }
function setUserBucket(userId, key, val) { getUserData(userId)[key] = val; save(); return val; }

/* ---------- payment orders (Cashfree) ----------
 * Stores one record per created order so payments can be reconciled and
 * credited exactly once. No card data is ever stored here - only our own
 * order id, the plan, amount, the owning user, and the status. */
function saveOrder(order) {
  if (!order || !order.orderId) return null;
  state.orders ||= {};
  state.orders[order.orderId] = order;
  save();
  return order;
}
function getOrder(orderId) { return (state.orders || {})[String(orderId)] || null; }
function listOrders() { return Object.values(state.orders || {}); }
function listOrdersByUser(userId) { return listOrders().filter((o) => o.userId === userId); }

/* ---------- web voice widgets (public embeddable "talk to agent") ----------
 * A widget maps a public, unguessable key to one owner + one agent. Visitors on
 * the owner's own website can start a browser voice call without an MNB login;
 * the call still draws down the owner's prepaid minutes, checked server-side. */
function createWidget(userId, agentId, opts = {}) {
  const key = 'w_' + crypto.randomBytes(18).toString('hex');
  state.widgets ||= {};
  const w = {
    key, userId, agentId: Number(agentId),
    label: String(opts.label || '').slice(0, 80),
    disabled: false,
    createdAt: new Date().toISOString(),
  };
  state.widgets[key] = w;
  save();
  return w;
}
function getWidget(key) { return (state.widgets || {})[String(key)] || null; }
function listWidgets() { return Object.values(state.widgets || {}); }
function listWidgetsByUser(userId) { return listWidgets().filter((w) => w.userId === userId); }
function updateWidget(key, patch) {
  const w = getWidget(key); if (!w) return null;
  Object.assign(w, patch || {}); save(); return w;
}
function deleteWidget(key) { delete (state.widgets || {})[String(key)]; save(); }

/* ---------- bootstrap admin ---------- */
function ensureAdmin(email, password) {
  if (!email || !password) return;
  let admin = findUserByEmail(email);
  if (!admin) {
    admin = createUser({ email, password, org: 'MNB Research', role: 'admin', status: 'active' });
    console.log(`Admin account created: ${email}`);
    return;
  }
  const patch = {};
  if (admin.role !== 'admin') patch.role = 'admin';
  if (admin.status !== 'active') patch.status = 'active';
  // Keep the admin password in sync with ADMIN_PASSWORD so the owner can always
  // recover access: set a new value in the host env, redeploy, and log in. (The
  // env var is the source of truth for the admin login.)
  if (!verifyPassword(password, admin.passHash)) patch.passHash = hashPassword(password);
  if (Object.keys(patch).length) { updateUser(admin.id, patch); console.log(`Admin account synced from env: ${email}`); }
}

/* ---------- bootstrap read-only demo account ---------- */
const DEMO_EMAIL = 'demo@mnbomnicaller.local';
function ensureDemo(demoAgentId) {
  let demo = findUserByEmail(DEMO_EMAIL);
  if (!demo) {
    demo = createUser({
      email: DEMO_EMAIL, password: crypto.randomBytes(12).toString('hex'),
      org: 'Demo Organization', role: 'client', status: 'active', demo: true,
    });
  }
  updateUser(demo.id, { demo: true, status: 'active', role: 'client', agentIds: [demoAgentId], minuteCap: 1500, org: 'Demo Organization' });
  return findUserByEmail(DEMO_EMAIL);
}
function getDemoUser() { return findUserByEmail(DEMO_EMAIL); }

/* ---------- rate limiting (Redis-backed, in-memory fallback) ----------
 * Returns true if ALLOWED, false if the key exceeded `max` hits within
 * `windowSec`. Fails open so a Redis hiccup never blocks real users. */
async function rateHit(key, max, windowSec) {
  if (redis) {
    try {
      const k = 'rl:' + key;
      const n = await redis.incr(k);
      if (n === 1) await redis.expire(k, windowSec);
      return n <= max;
    } catch (e) { return true; }
  }
  const now = Date.now();
  const e = memRL.get(key);
  if (!e || now > e.reset) { memRL.set(key, { count: 1, reset: now + windowSec * 1000 }); return true; }
  e.count++;
  return e.count <= max;
}

/* =======================================================================
 * API keys (customer-facing credentials for the public /api/v1 surface)
 *
 * Format: mnb_sk_<keyId>_<secret>
 *   keyId  = 16 hex chars  -> lets us look the record up directly instead of
 *            hashing against every stored key (no O(n) scan, no timing leak)
 *   secret = 64 hex chars  = 256 bits of entropy from crypto.randomBytes(32)
 *
 * Only a SHA-256 hash of the secret is ever stored. The plaintext is returned
 * exactly once, at creation (or rotation), and cannot be recovered afterwards.
 * ===================================================================== */
const API_KEY_PREFIX = 'mnb_sk_';
const ALL_SCOPES = ['calls:read', 'calls:write', 'agents:read', 'contacts:read', 'contacts:write', 'analytics:read'];

function sha256(s) { return crypto.createHash('sha256').update(String(s)).digest('hex'); }

function parseApiKey(raw) {
  const s = String(raw || '').trim();
  if (!s.startsWith(API_KEY_PREFIX)) return null;
  const rest = s.slice(API_KEY_PREFIX.length);
  const i = rest.indexOf('_');
  if (i < 1) return null;
  const id = rest.slice(0, i);
  const secret = rest.slice(i + 1);
  if (!/^[a-f0-9]{16}$/.test(id) || !/^[a-f0-9]{64}$/.test(secret)) return null;
  return { id, secret };
}

function createApiKey(userId, { name, scopes, expiresInDays } = {}) {
  const id = crypto.randomBytes(8).toString('hex');
  const secret = crypto.randomBytes(32).toString('hex'); // 256-bit
  const wanted = Array.isArray(scopes) && scopes.length ? scopes : ['calls:read', 'agents:read'];
  const rec = {
    id,
    userId,
    name: String(name || 'API key').slice(0, 80),
    hash: sha256(secret),
    scopes: wanted.filter((s) => ALL_SCOPES.includes(s)),
    status: 'active',
    createdAt: new Date().toISOString(),
    expiresAt: expiresInDays ? new Date(Date.now() + Number(expiresInDays) * 86400000).toISOString() : null,
    lastUsedAt: null,
    rotatedFrom: null,
  };
  state.apiKeys[id] = rec;
  audit(userId, 'apikey.create', id, { scopes: rec.scopes, expiresAt: rec.expiresAt });
  save();
  return { record: publicApiKey(rec), secret: API_KEY_PREFIX + id + '_' + secret };
}

// Verify a presented key. Returns the record only when it is genuinely usable.
function verifyApiKey(raw) {
  const p = parseApiKey(raw);
  if (!p) return null;
  const rec = state.apiKeys[p.id];
  if (!rec || rec.status !== 'active') return null;
  if (rec.expiresAt && Date.parse(rec.expiresAt) < Date.now()) return null;
  const a = Buffer.from(sha256(p.secret), 'hex');
  const b = Buffer.from(String(rec.hash || ''), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return rec;
}

function touchApiKey(id) {
  const rec = state.apiKeys[id];
  if (!rec) return;
  rec.lastUsedAt = new Date().toISOString();
  save(); // best-effort; flushed with the next write
}

function listApiKeys(userId) {
  return Object.values(state.apiKeys)
    .filter((k) => !userId || k.userId === userId)
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))
    .map(publicApiKey);
}
function getApiKey(id) { const r = state.apiKeys[id]; return r ? publicApiKey(r) : null; }

// Never leak the hash to any caller.
function publicApiKey(r) {
  return {
    id: r.id, userId: r.userId, name: r.name, scopes: r.scopes, status: r.status,
    createdAt: r.createdAt, expiresAt: r.expiresAt, lastUsedAt: r.lastUsedAt,
    rotatedFrom: r.rotatedFrom || null,
    masked: API_KEY_PREFIX + r.id + '_' + '*'.repeat(8),
  };
}

function revokeApiKey(id, byUserId) {
  const rec = state.apiKeys[id];
  if (!rec) return false;
  rec.status = 'revoked';
  rec.revokedAt = new Date().toISOString();
  audit(byUserId || rec.userId, 'apikey.revoke', id, {});
  save();
  return true;
}

// Rotation issues a NEW secret and optionally keeps the old key alive for a
// short overlap window so a running integration is not broken mid-deploy.
function rotateApiKey(id, { overlapMinutes = 0, byUserId } = {}) {
  const old = state.apiKeys[id];
  if (!old || old.status !== 'active') return null;
  const next = createApiKey(old.userId, {
    name: old.name,
    scopes: old.scopes,
    expiresInDays: old.expiresAt ? Math.max(1, Math.ceil((Date.parse(old.expiresAt) - Date.now()) / 86400000)) : null,
  });
  state.apiKeys[next.record.id].rotatedFrom = id;
  // createApiKey already snapshotted the record, so refresh the copy we return
  // or the caller/API response would report rotatedFrom: null.
  next.record = publicApiKey(state.apiKeys[next.record.id]);
  if (Number(overlapMinutes) > 0) {
    old.status = 'active';
    old.expiresAt = new Date(Date.now() + Number(overlapMinutes) * 60000).toISOString();
    audit(byUserId || old.userId, 'apikey.rotate', id, { overlapMinutes: Number(overlapMinutes), replacedBy: next.record.id });
  } else {
    old.status = 'revoked';
    old.revokedAt = new Date().toISOString();
    audit(byUserId || old.userId, 'apikey.rotate', id, { overlapMinutes: 0, replacedBy: next.record.id });
  }
  save();
  return next;
}

function deleteUserApiKeys(userId) {
  for (const [id, k] of Object.entries(state.apiKeys)) if (k.userId === userId) delete state.apiKeys[id];
  save();
}

/* ---------- audit log (never stores secret values) ---------- */
function audit(userId, action, target, meta) {
  state.auditLog.push({ at: new Date().toISOString(), userId: userId || null, action, target: target || null, meta: meta || {} });
  if (state.auditLog.length > AUDIT_RING_MAX) state.auditLog.splice(0, state.auditLog.length - AUDIT_RING_MAX);
}
function listAudit(limit = 200, userId) {
  const rows = userId ? state.auditLog.filter((r) => r.userId === userId) : state.auditLog;
  return rows.slice(-Math.max(1, Math.min(2000, limit))).reverse();
}

/* =======================================================================
 * Product analytics. Raw events are a bounded ring (the whole DB is one JSON
 * blob), while small per-day counters keep the funnel history after the ring
 * rolls over. Never record passwords, card data or tokens here.
 * ===================================================================== */
function trackEvent(name, { userId, props } = {}) {
  const at = new Date();
  const day = at.toISOString().slice(0, 10);
  state.events.push({ at: at.toISOString(), name: String(name).slice(0, 60), userId: userId || null, props: props || {} });
  if (state.events.length > EVENT_RING_MAX) state.events.splice(0, state.events.length - EVENT_RING_MAX);
  state.eventDaily[day] ||= {};
  state.eventDaily[day][name] = (state.eventDaily[day][name] || 0) + 1;
  save();
}
function listEvents({ limit = 200, name, userId } = {}) {
  let rows = state.events;
  if (name) rows = rows.filter((e) => e.name === name);
  if (userId) rows = rows.filter((e) => e.userId === userId);
  return rows.slice(-Math.max(1, Math.min(2000, limit))).reverse();
}
function eventTotals(days = 30) {
  const out = {}; const since = Date.now() - days * 86400000;
  for (const [day, counts] of Object.entries(state.eventDaily)) {
    if (Date.parse(day + 'T00:00:00Z') < since) continue;
    for (const [n, c] of Object.entries(counts)) out[n] = (out[n] || 0) + c;
  }
  return out;
}
function eventDaily(days = 30) {
  const since = Date.now() - days * 86400000;
  return Object.fromEntries(Object.entries(state.eventDaily).filter(([d]) => Date.parse(d + 'T00:00:00Z') >= since).sort());
}

/* ---------- full-state export for backups (admin only, secrets stripped) --- */
function exportSnapshot() {
  return {
    exportedAt: new Date().toISOString(),
    counts: {
      users: state.users.length, apiKeys: Object.keys(state.apiKeys).length,
      orders: Object.keys(state.orders).length, widgets: Object.keys(state.widgets).length,
      events: state.events.length,
    },
    // passHash / api-key hash / session tokens are deliberately omitted so a
    // backup file cannot be replayed to impersonate anyone.
    users: state.users.map((u) => ({ ...u, passHash: undefined })),
    apiKeys: Object.values(state.apiKeys).map(publicApiKey),
    orders: state.orders,
    widgets: state.widgets,
    userData: state.userData,
    settings: state.settings,
    eventDaily: state.eventDaily,
    auditLog: state.auditLog,
  };
}

module.exports = {
  init, flush, rateHit,
  ALL_SCOPES,
  createApiKey, verifyApiKey, touchApiKey, listApiKeys, getApiKey,
  revokeApiKey, rotateApiKey, deleteUserApiKeys, parseApiKey,
  audit, listAudit,
  trackEvent, listEvents, eventTotals, eventDaily,
  exportSnapshot,
  hashPassword, verifyPassword,
  findUserByEmail, findUserById, createUser, updateUser, deleteUser, listUsers,
  createSession, getSession, destroySession, destroyUserSessions,
  createResetToken, consumeResetToken,
  setKbOwner, getKbOwner, removeKbOwner,
  getSettings, setSettings, patchSettings,
  getUserData, setUserBucket,
  saveOrder, getOrder, listOrders, listOrdersByUser,
  createWidget, getWidget, listWidgets, listWidgetsByUser, updateWidget, deleteWidget,
  ensureAdmin, ensureDemo, getDemoUser,
};
