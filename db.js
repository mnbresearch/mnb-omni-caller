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

let state = { users: [], sessions: {}, kbOwners: {}, settings: {}, userData: {}, orders: {}, resetTokens: {}, widgets: {} };
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
    ratePerMin: 0,   // per-account price/min in INR; 0 = use global CLIENT_RATE_INR
    minReloadInr: 0, // per-account minimum reload in INR; 0 = default (10x rate)
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
  } else if (admin.role !== 'admin' || admin.status !== 'active') {
    updateUser(admin.id, { role: 'admin', status: 'active' });
  }
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

module.exports = {
  init, flush, rateHit,
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
