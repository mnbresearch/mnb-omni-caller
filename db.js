/**
 * MNB Omni Caller — tiny JSON file database.
 * Good for tens of organizations; swap for Postgres later if needed.
 * Data lives in DATA_DIR/db.json (default ./data/db.json) and persists on VPS disk.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let state = { users: [], sessions: {}, kbOwners: {} };

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      state = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      state.users ||= [];
      state.sessions ||= {};
      state.kbOwners ||= {};
    }
  } catch (e) {
    console.error('DB load failed, starting fresh:', e.message);
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, DB_FILE);
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
function createUser({ email, password, org, role = 'client', status = 'pending' }) {
  const user = {
    id: crypto.randomUUID(),
    email: String(email).toLowerCase().trim(),
    passHash: hashPassword(password),
    org: String(org || '').trim(),
    role,
    status, // pending | active | rejected
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
  } else if (admin.role !== 'admin') {
    updateUser(admin.id, { role: 'admin', status: 'active' });
  }
}

load();

module.exports = {
  hashPassword, verifyPassword,
  findUserByEmail, findUserById, createUser, updateUser, deleteUser, listUsers,
  createSession, getSession, destroySession,
  setKbOwner, getKbOwner, removeKbOwner,
  ensureAdmin,
};
