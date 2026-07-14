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

let state = { users: [], sessions: {}, kbOwners: {}, settings: {} };
let redis = null;

function normalize() {
  state.users ||= [];
  state.sessions ||= {};
  state.kbOwners ||= {};
  state.settings ||= {};
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
    minuteCap: 500,
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

module.exports = {
  init, flush,
  hashPassword, verifyPassword,
  findUserByEmail, findUserById, createUser, updateUser, deleteUser, listUsers,
  createSession, getSession, destroySession,
  setKbOwner, getKbOwner, removeKbOwner,
  getSettings, setSettings, patchSettings,
  ensureAdmin, ensureDemo, getDemoUser,
};
/**
 * MNB Omni Caller — data store.
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

let state = { users: [], sessions: {}, kbOwners: {} };
let redis = null;

function normalize() {
  state.users ||= [];
  state.sessions ||= {};
  state.kbOwners ||= {};
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

// Awaited flush — used on shutdown so the last write always lands.
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
    minuteCap: 500,
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

/* ---------- knowledge-base file ownership ---------- */
function setKbOwner(fileId, userId) { state.kbOwners[String(fileId)] = userId; save(); }
function getKbOwner(fileId) { return state.kbOwners[String(fileId)]; }
function removeKbOwner(fileId) { delete state.kbOwners[String(fileId)]; save(); }

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

module.exports = {
  init, flush,
  hashPassword, verifyPassword,
  findUserByEmail, findUserById, createUser, updateUser, deleteUser, listUsers,
  createSession, getSession, destroySession,
  setKbOwner, getKbOwner, removeKbOwner,
  ensureAdmin, ensureDemo, getDemoUser,
};
