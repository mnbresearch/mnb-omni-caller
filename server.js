/**
 * MNB Omni Caller — multi-tenant Voice AI platform by MNB Research.
 * Admin trains agents and delegates them to client organizations.
 * Clients see only their own agents, calls, numbers, and documents.
 * The OmniDim API key lives only on this server.
 */
require('dotenv').config();
const express = require('express');
const path = require('path');
const db = require('./db');

const app = express();
app.use(express.json({ limit: '30mb' }));

const BASE = process.env.OMNIDIM_API_BASE || 'https://backend.omnidim.io/api/v1';
const KEY = process.env.OMNIDIM_API_KEY;
const BRAND = process.env.BRAND_NAME || 'MNB Omni Caller';
const PORT = process.env.PORT || 3000;

if (!KEY) { console.error('Missing OMNIDIM_API_KEY in .env'); process.exit(1); }

/* ================= Auth ================= */
function getToken(req) {
  const m = /mnb_session=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function currentUser(req) {
  const s = db.getSession(getToken(req) || '');
  return s ? db.findUserById(s.userId) : null;
}

app.post('/api/auth/signup', (req, res) => {
  const { org, email, password } = req.body || {};
  if (!org || !email || !password) return res.status(400).json({ error: 'Organization, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.findUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  db.createUser({ email, password, org });
  res.json({ ok: true, message: 'Access requested. The administrator will review your request.' });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = email && db.findUserByEmail(email);
  if (!user || !db.verifyPassword(password || '', user.passHash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  if (user.status === 'pending') return res.status(403).json({ error: 'Your access request is still pending approval' });
  if (user.status !== 'active') return res.status(403).json({ error: 'Your access has been revoked' });
  const token = db.createSession(user.id);
  res.setHeader('Set-Cookie', `mnb_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=1209600`);
  res.json({ ok: true });
});

app.post('/api/auth/logout', (req, res) => {
  db.destroySession(getToken(req) || '');
  res.setHeader('Set-Cookie', 'mnb_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.json({ authed: false, brand: BRAND });
  const usage = user.role === 'client' ? await getUsageMinutes(user).catch(() => null) : null;
  res.json({
    authed: true, brand: BRAND,
    user: { email: user.email, org: user.org, role: user.role, minuteCap: user.minuteCap, usedMinutes: usage },
  });
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/me') return next();
  const user = currentUser(req);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
});

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}
const isAdmin = (req) => req.user.role === 'admin';
const ownsAgent = (req, agentId) => isAdmin(req) || req.user.agentIds.includes(Number(agentId));

/* ================= OmniDim proxy helpers ================= */
async function omni(method, upstreamPath, { query, body } = {}) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const resp = await fetch(BASE + upstreamPath + qs, {
    method,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: resp.status, data };
}

function relay(method, upstreamPathFn, opts = {}) {
  return async (req, res) => {
    try {
      const upstreamPath = typeof upstreamPathFn === 'function' ? upstreamPathFn(req) : upstreamPathFn;
      const { status, data } = await omni(method, upstreamPath, {
        query: opts.passQuery ? req.query : undefined,
        body: ['POST', 'PUT', 'PATCH'].includes(method) ? req.body : undefined,
      });
      res.status(status).json(data);
    } catch (err) {
      console.error(err);
      res.status(502).json({ error: 'Upstream request failed', detail: String(err.message || err) });
    }
  };
}

/* ================= Usage tracking (minutes per client, current month) ================= */
const usageCache = new Map(); // userId -> {at, minutes}
function parseDur(d) {
  if (!d || typeof d !== 'string') return 0;
  const p = d.split(':').map((x) => parseFloat(x) || 0);
  return p.length === 2 ? p[0] * 60 + p[1] : p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0;
}
async function getUsageMinutes(user) {
  const cached = usageCache.get(user.id);
  if (cached && Date.now() - cached.at < 60000) return cached.minutes;
  const now = new Date();
  let seconds = 0;
  for (const agentId of user.agentIds) {
    const { data } = await omni('GET', '/calls/logs', { query: { pageno: 1, pagesize: 150, agentid: agentId } });
    for (const log of data.call_log_data || []) {
      const [mm, , yyyy] = String(log.time_of_call || '').split(/[\/ ]/);
      if (Number(mm) === now.getMonth() + 1 && Number(yyyy) === now.getFullYear()) seconds += parseDur(log.call_duration);
    }
  }
  const minutes = Math.round(seconds / 60);
  usageCache.set(user.id, { at: Date.now(), minutes });
  return minutes;
}

/* ================= Admin: user management ================= */
app.get('/api/admin/users', adminOnly, async (req, res) => {
  const users = await Promise.all(db.listUsers().map(async (u) => ({
    id: u.id, email: u.email, org: u.org, role: u.role, status: u.status,
    agentIds: u.agentIds, numberIds: u.numberIds, minuteCap: u.minuteCap, createdAt: u.createdAt,
    usedMinutes: u.role === 'client' && u.status === 'active' ? await getUsageMinutes(u).catch(() => null) : null,
  })));
  res.json({ users });
});
app.post('/api/admin/users/:id/update', adminOnly, (req, res) => {
  const { status, agentIds, numberIds, minuteCap } = req.body || {};
  const patch = {};
  if (status) patch.status = status;
  if (Array.isArray(agentIds)) patch.agentIds = agentIds.map(Number);
  if (Array.isArray(numberIds)) patch.numberIds = numberIds.map(Number);
  if (minuteCap !== undefined) patch.minuteCap = Number(minuteCap) || 0;
  const u = db.updateUser(req.params.id, patch);
  if (!u) return res.status(404).json({ error: 'User not found' });
  usageCache.delete(u.id);
  res.json({ ok: true });
});
app.delete('/api/admin/users/:id', adminOnly, (req, res) => {
  db.deleteUser(req.params.id);
  res.json({ ok: true });
});

/* ================= Agents (scoped) ================= */
app.get('/api/agents', async (req, res) => {
  try {
    const { status, data } = await omni('GET', '/agents', { query: { pageno: 1, pagesize: 150 } });
    if (status !== 200) return res.status(status).json(data);
    let bots = data.bots || [];
    if (!isAdmin(req)) bots = bots.filter((b) => req.user.agentIds.includes(b.id));
    res.json({ bots, total_records: bots.length });
  } catch (e) { res.status(502).json({ error: 'Upstream request failed' }); }
});
app.get('/api/agents/:id', (req, res, next) => {
  if (!ownsAgent(req, req.params.id)) return res.status(403).json({ error: 'This agent is not assigned to your organization' });
  next();
}, relay('GET', (r) => `/agents/${r.params.id}`));
app.put('/api/agents/:id', (req, res, next) => {
  if (!ownsAgent(req, req.params.id)) return res.status(403).json({ error: 'This agent is not assigned to your organization' });
  next();
}, relay('PUT', (r) => `/agents/${r.params.id}`));
app.delete('/api/agents/:id', adminOnly, relay('DELETE', (r) => `/agents/${r.params.id}`));
app.post('/api/agents', adminOnly, relay('POST', '/agents/create'));

/* ================= Calls (scoped + caps) ================= */
app.post('/api/calls/dispatch', async (req, res) => {
  const agentId = Number((req.body || {}).agent_id);
  if (!ownsAgent(req, agentId)) return res.status(403).json({ error: 'This agent is not assigned to your organization' });
  if (!isAdmin(req)) {
    const used = await getUsageMinutes(req.user).catch(() => 0);
    if (req.user.minuteCap > 0 && used >= req.user.minuteCap) {
      return res.status(403).json({ error: `Monthly limit reached (${used}/${req.user.minuteCap} minutes). Contact MNB Research to increase your plan.` });
    }
  }
  return relay('POST', '/calls/dispatch')(req, res);
});

app.get('/api/calls/logs', async (req, res) => {
  try {
    if (isAdmin(req)) return relay('GET', '/calls/logs', { passQuery: true })(req, res);
    // Clients: merge logs across their assigned agents only
    let all = [];
    for (const agentId of req.user.agentIds) {
      const q = { pageno: 1, pagesize: 100, agentid: agentId };
      if (req.query.call_status) q.call_status = req.query.call_status;
      const { data } = await omni('GET', '/calls/logs', { query: q });
      all = all.concat(data.call_log_data || []);
    }
    all.sort((a, b) => new Date(b.time_of_call) - new Date(a.time_of_call));
    const page = Number(req.query.pageno) || 1;
    const size = Number(req.query.pagesize) || 20;
    res.json({ call_log_data: all.slice((page - 1) * size, page * size), total_records: all.length });
  } catch (e) { res.status(502).json({ error: 'Upstream request failed' }); }
});
app.get('/api/calls/logs/:id', relay('GET', (r) => `/calls/logs/${r.params.id}`));

/* ================= Campaigns (scoped) ================= */
app.get('/api/campaigns', relay('GET', '/calls/bulk_call', { passQuery: true }));
app.post('/api/campaigns', (req, res, next) => {
  if (!isAdmin(req)) {
    const numId = Number((req.body || {}).phone_number_id);
    if (!req.user.numberIds.includes(numId)) return res.status(403).json({ error: 'This phone number is not assigned to your organization' });
  }
  next();
}, relay('POST', '/calls/bulk_call/create'));
app.get('/api/campaigns/:id', relay('GET', (r) => `/calls/bulk_call/${r.params.id}`));
app.put('/api/campaigns/:id', relay('PUT', (r) => `/calls/bulk_call/${r.params.id}`));
app.delete('/api/campaigns/:id', relay('DELETE', (r) => `/calls/bulk_call/${r.params.id}`));
app.post('/api/campaigns/:id/contact', relay('POST', (r) => `/calls/bulk_call/${r.params.id}/add_contact`));
app.get('/api/campaigns/:id/live', relay('GET', (r) => `/bulk-call/${r.params.id}/live-status`));

/* ================= Knowledge base (per-tenant ownership) ================= */
app.get('/api/knowledge', async (req, res) => {
  try {
    const { status, data } = await omni('GET', '/knowledge_base/list');
    if (status !== 200) return res.status(status).json(data);
    let files = data.files || [];
    if (!isAdmin(req)) files = files.filter((f) => db.getKbOwner(f.id) === req.user.id);
    res.json({ success: true, files });
  } catch (e) { res.status(502).json({ error: 'Upstream request failed' }); }
});

async function forwardKbUpload(req, res, filename, base64) {
  const { status, data } = await omni('POST', '/knowledge_base/create', { body: { file: base64, filename } });
  if (status === 200 && data.file && data.file.id) db.setKbOwner(data.file.id, req.user.id);
  res.status(status).json(data);
}
app.post('/api/knowledge/upload', async (req, res) => {
  try { await forwardKbUpload(req, res, (req.body || {}).filename, (req.body || {}).file); }
  catch (e) { res.status(502).json({ error: 'Upload failed' }); }
});

const PDFDocument = require('pdfkit');
function textToPdfBase64(title, text) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);
    doc.fontSize(16).text(title, { underline: true });
    doc.moveDown();
    doc.fontSize(11).text(text, { lineGap: 3 });
    doc.end();
  });
}
function safePdfName(title) {
  const base = String(title).replace(/\.(txt|md|markdown|text)$/i, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 60) || 'document';
  return base + '.pdf';
}
app.post('/api/knowledge/upload-text', async (req, res) => {
  try {
    const { title, text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'No text provided' });
    const b64 = await textToPdfBase64(title || 'Document', String(text));
    await forwardKbUpload(req, res, safePdfName(title || 'document'), b64);
  } catch (err) { res.status(500).json({ error: 'Conversion failed', detail: String(err.message || err) }); }
});
app.post('/api/knowledge/upload-url', async (req, res) => {
  try {
    let { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'No URL provided' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const page = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MNB Omni Caller KB fetcher)' }, redirect: 'follow' });
    if (!page.ok) return res.status(400).json({ error: `Could not fetch page (HTTP ${page.status})` });
    const html = await page.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
    if (text.length < 50) return res.status(400).json({ error: 'Page had no readable text (it may need JavaScript to render)' });
    const host = new URL(url).hostname.replace(/^www\./, '');
    const b64 = await textToPdfBase64(`Source: ${url}`, text.slice(0, 200000));
    await forwardKbUpload(req, res, safePdfName(host), b64);
  } catch (err) { res.status(500).json({ error: 'URL import failed', detail: String(err.message || err) }); }
});

function kbFileGuard(req, res, next) {
  const ids = (req.body || {}).file_ids || [(req.body || {}).file_id].filter(Boolean);
  if (!isAdmin(req)) {
    for (const id of ids) {
      if (db.getKbOwner(id) !== req.user.id) return res.status(403).json({ error: 'One of these documents does not belong to your organization' });
    }
    if ((req.body || {}).agent_id && !ownsAgent(req, req.body.agent_id)) {
      return res.status(403).json({ error: 'This agent is not assigned to your organization' });
    }
  }
  next();
}
app.post('/api/knowledge/attach', kbFileGuard, relay('POST', '/knowledge_base/attach'));
app.post('/api/knowledge/detach', kbFileGuard, relay('POST', '/knowledge_base/detach'));
app.post('/api/knowledge/delete', kbFileGuard, (req, res, next) => {
  db.removeKbOwner((req.body || {}).file_id);
  next();
}, relay('POST', '/knowledge_base/delete'));

/* ================= Recordings ================= */
app.get('/api/recording/:id', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const upstream = await fetch(`${BASE}/recording/${req.params.id}${qs ? '?' + qs : ''}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    if (!upstream.ok) return res.status(upstream.status).end();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch { res.status(502).json({ error: 'Recording fetch failed' }); }
});

/* ================= Phone numbers & providers (scoped) ================= */
app.get('/api/numbers', async (req, res) => {
  try {
    const { status, data } = await omni('GET', '/phone_number/list');
    if (status !== 200) return res.status(status).json(data);
    let numbers = data.phone_numbers || data.numbers || [];
    if (!isAdmin(req)) numbers = numbers.filter((n) => req.user.numberIds.includes(n.id));
    res.json({ success: true, phone_numbers: numbers });
  } catch (e) { res.status(502).json({ error: 'Upstream request failed' }); }
});
app.post('/api/numbers/attach', adminOnly, relay('POST', '/phone_number/attach'));
app.post('/api/numbers/detach', adminOnly, relay('POST', '/phone_number/detach'));
app.get('/api/voices', relay('GET', '/providers/voices', { passQuery: true }));
app.get('/api/llms', relay('GET', '/providers/llms'));

/* ================= Static frontend ================= */
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => {
  await db.init();
  db.ensureAdmin(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  app.listen(PORT, () => console.log(`${BRAND} running at http://localhost:${PORT}`));
})();

// Flush the last write to Redis before Render stops the instance.
process.on('SIGTERM', async () => { await db.flush(); process.exit(0); });
process.on('SIGINT', async () => { await db.flush(); process.exit(0); });
