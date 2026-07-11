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
const demo = require('./demo');

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

// Instant alert to the admin when a new organization requests access.
// Set NTFY_TOPIC to a private topic name; install the free "ntfy" app and
// subscribe to the same topic to get push notifications on your phone.
async function notifyNewLead(u) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return;
  const body = [
    `Org: ${u.org}`,
    u.contact ? `Name: ${u.contact}` : '',
    u.phone ? `Phone: ${u.phone}` : '',
    `Email: ${u.email}`,
    u.note ? `Wants: ${u.note}` : '',
  ].filter(Boolean).join('\n');
  try {
    const headers = { Title: 'New MNB Omni Caller lead', Priority: 'high', Tags: 'telephone_receiver,rotating_light' };
    if (u.phone) headers.Actions = `view, WhatsApp this lead, https://wa.me/${u.phone.replace(/[^\d]/g, '')}`;
    await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: 'POST', headers, body });
  } catch (e) { console.error('Lead alert failed:', e.message); }
  // Optional WhatsApp alert via CallMeBot (set CALLMEBOT_APIKEY + CALLMEBOT_PHONE)
  const cbKey = process.env.CALLMEBOT_APIKEY;
  const cbPhone = process.env.CALLMEBOT_PHONE;
  if (cbKey && cbPhone) {
    try {
      const text = encodeURIComponent('New MNB Omni Caller lead\n' + body);
      await fetch(`https://api.callmebot.com/whatsapp.php?phone=${cbPhone}&text=${text}&apikey=${cbKey}`);
    } catch (e) { console.error('WhatsApp alert failed:', e.message); }
  }
}

/* ============ Resend transactional emails (access-request flow) ============
 * On every access request the platform sends two emails via Resend:
 *   1) admin notification (to RESEND_ADMIN_EMAIL) with the requester details
 *   2) a friendly confirmation to the requester
 * The API key lives ONLY in the RESEND_API_KEY server env var - never in the
 * frontend. If the key is absent, sending is skipped silently so nothing breaks.
 * Everything runs fire-and-forget and is wrapped in try/catch.
 */
const RESEND_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.RESEND_FROM || 'MNB Omni Caller <hello@updates.mnbresearch.com>';
const MAIL_ADMIN = process.env.RESEND_ADMIN_EMAIL || 'mnbgotyou@gmail.com';
const MAIL_REPLY_TO = process.env.RESEND_REPLY_TO || 'mnbgotyou@gmail.com';
const APP_NAME = 'MNB Omni Caller';
const DEMO_URL = process.env.APP_PUBLIC_URL || 'https://mnb-omni-caller.onrender.com/';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const eesc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function resendSend({ to, subject, html }) {
  if (!RESEND_KEY) return; // not configured yet -> skip silently
  try {
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({ from: MAIL_FROM, to: Array.isArray(to) ? to : [to], reply_to: MAIL_REPLY_TO, subject, html }),
    });
    if (!resp.ok) console.error('Resend send failed:', resp.status, await resp.text().catch(() => ''));
  } catch (e) { console.error('Resend error:', e.message); }
}

const LOGO_URL = process.env.EMAIL_LOGO_URL || 'https://www.mnbresearch.com/web/image/2429';
const OR_GRAD = 'linear-gradient(135deg,#ee6c0a,#ffab5e)';

function accessEmailShell(inner) {
  return `<div style="background:#f4f4f5;padding:28px 12px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">
    <div style="max-width:580px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #ececec;box-shadow:0 8px 30px rgba(0,0,0,.06)">
      <div style="background:linear-gradient(135deg,#0c0c0d,#1a1310);padding:24px 28px">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:middle"><img src="${LOGO_URL}" width="46" height="46" alt="MNB Omni Caller" style="display:block;border-radius:11px;border:0" /></td>
          <td style="vertical-align:middle;padding-left:14px">
            <div style="color:#fff;font-weight:800;font-size:18px;letter-spacing:-.3px">MNB Omni Caller</div>
            <div style="color:#ff9a4d;font-weight:700;font-size:11px;letter-spacing:1.2px;text-transform:uppercase;margin-top:3px">AI Voice Agents &middot; by MNB Research</div>
          </td>
        </tr></table>
      </div>
      <div style="padding:28px 28px 24px">${inner}</div>
      <div style="border-top:1px solid #eee;padding:20px 28px;background:#fafafa">
        <div style="font-size:13px;color:#666;margin-bottom:10px">
          <a href="${DEMO_URL}" style="color:#ee6c0a;text-decoration:none;font-weight:600">Live demo</a> &nbsp;&middot;&nbsp;
          <a href="https://www.mnbresearch.com/mnb-omni-caller" style="color:#ee6c0a;text-decoration:none;font-weight:600">Product page</a> &nbsp;&middot;&nbsp;
          <a href="https://wa.me/919711488481" style="color:#ee6c0a;text-decoration:none;font-weight:600">WhatsApp</a> &nbsp;&middot;&nbsp;
          <a href="mailto:contact@mnbresearch.com" style="color:#ee6c0a;text-decoration:none;font-weight:600">Email</a>
        </div>
        <div style="font-size:11px;color:#9a9a9a;line-height:1.7">
          MNB Omni Caller &middot; MNB Research &middot; +91 97114 88481<br/>
          <span style="color:#b0b0b0">Shark Tank India featured &middot; DPIIT-recognised</span>
        </div>
      </div>
    </div>
  </div>`;
}

function sendAccessRequestEmails(u) {
  if (!u || !u.email || !EMAIL_RE.test(String(u.email))) return;
  const name = u.contact || u.org || 'there';
  const firstName = String(name).trim().split(/\s+/)[0] || 'there';
  const when = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
  const waDigits = (u.phone || '').replace(/[^\d]/g, '');
  const btn = (href, label) => `<a href="${href}" style="display:inline-block;background:${OR_GRAD};color:#111;font-weight:700;font-size:14px;text-decoration:none;padding:12px 24px;border-radius:8px">${label}</a>`;

  // 1) Admin notification
  const row = (k, v) => v ? `<tr><td style="padding:8px 0;color:#888;font-size:13px;width:130px;vertical-align:top">${k}</td><td style="padding:8px 0;font-size:14px;color:#1a1a1a">${v}</td></tr>` : '';
  const adminInner = `
    <div style="display:inline-block;background:rgba(238,108,10,.1);color:#c25a08;font-weight:700;font-size:11px;letter-spacing:.6px;text-transform:uppercase;padding:5px 12px;border-radius:20px;margin-bottom:14px">New access request</div>
    <p style="margin:0 0 18px;font-size:15px;color:#1a1a1a;line-height:1.6">A new organization just requested access to <b>${APP_NAME}</b>. Here are their details:</p>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #f0f0f0">
      ${row('Name', eesc(u.contact || ''))}
      ${row('Organization', eesc(u.org || ''))}
      ${row('Email', `<a href="mailto:${eesc(u.email)}" style="color:#ee6c0a;text-decoration:none">${eesc(u.email)}</a>`)}
      ${row('Phone', eesc(u.phone || ''))}
      ${row('Looking for', eesc(u.note || ''))}
      ${row('Requested', eesc(when) + ' IST')}
    </table>
    <div style="margin-top:22px">
      ${btn('mailto:' + eesc(u.email), 'Reply to ' + eesc(firstName))}
      ${waDigits ? '&nbsp;&nbsp;<a href="https://wa.me/' + waDigits + '" style="display:inline-block;border:1px solid #25D366;color:#128C4B;font-weight:700;font-size:14px;text-decoration:none;padding:11px 22px;border-radius:8px">WhatsApp</a>' : ''}
    </div>`;
  resendSend({ to: MAIL_ADMIN, subject: `New access request — ${APP_NAME}: ${u.contact || u.org || u.email}`, html: accessEmailShell(adminInner) });

  // 2) Requester confirmation
  const step = (n, t) => `<tr><td style="vertical-align:top;padding:5px 12px 5px 0"><div style="width:24px;height:24px;border-radius:50%;background:${OR_GRAD};color:#111;font-weight:800;font-size:12px;text-align:center;line-height:24px">${n}</div></td><td style="vertical-align:middle;font-size:14px;color:#3a3a3a;padding:5px 0">${t}</td></tr>`;
  const reqInner = `
    <p style="margin:0 0 14px;font-size:16px;color:#1a1a1a">Hi ${eesc(firstName)},</p>
    <p style="margin:0 0 18px;font-size:15px;color:#3a3a3a;line-height:1.65">Thank you for requesting access to <b>MNB Omni Caller</b> &mdash; MNB Research's human-sounding AI voice-agent platform that places real calls, qualifies leads, books appointments and answers customers 24/7 in 90+ languages. Your request is in, and our team will review it and get back to you shortly (usually within one business day).</p>
    <div style="background:#faf7f3;border:1px solid #f0e6da;border-radius:12px;padding:16px 18px;margin:0 0 22px">
      <div style="font-weight:700;font-size:12px;letter-spacing:.6px;text-transform:uppercase;color:#c25a08;margin-bottom:10px">What happens next</div>
      <table style="border-collapse:collapse">
        ${step(1, 'We review your request')}
        ${step(2, 'We approve access and set up your agent')}
        ${step(3, "You're placing live calls &mdash; often the same day")}
      </table>
    </div>
    <p style="margin:0 0 16px;font-size:15px;color:#3a3a3a;line-height:1.65">While you wait, explore the platform live:</p>
    <div>${btn(eesc(DEMO_URL), '&#9654; View the live demo')}</div>
    <p style="margin:26px 0 0;font-size:14px;color:#3a3a3a">Warm regards,<br/><b>The MNB Research team</b></p>`;
  resendSend({ to: u.email, subject: 'We received your access request — MNB Omni Caller', html: accessEmailShell(reqInner) });
}

app.post('/api/auth/signup', (req, res) => {
  const { org, email, password, contact, phone, note } = req.body || {};
  if (!org || !email || !password) return res.status(400).json({ error: 'Organization, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.findUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = db.createUser({ email, password, org, contact, phone, note });
  notifyNewLead(user);            // fire-and-forget push alert (ntfy)
  sendAccessRequestEmails(user);  // fire-and-forget Resend emails (admin + requester)
  res.json({ ok: true, message: 'Thanks! Your request is in. MNB Research will reach out and approve your access shortly.' });
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

// One-click read-only demo login (no password) — powers "View live demo".
app.post('/api/auth/demo', (req, res) => {
  const u = db.getDemoUser();
  if (!u) return res.status(503).json({ error: 'Demo is warming up, please try again in a moment.' });
  const token = db.createSession(u.id);
  res.setHeader('Set-Cookie', `mnb_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=86400`);
  res.json({ ok: true });
});

app.get('/api/me', async (req, res) => {
  const user = currentUser(req);
  if (!user) return res.json({ authed: false, brand: BRAND });
  let usage = null;
  if (user.demo) usage = 372;
  else if (user.role === 'client') usage = await getUsageMinutes(user).catch(() => null);
  res.json({
    authed: true, brand: BRAND,
    user: {
      email: user.email, org: user.org, role: user.role, demo: !!user.demo,
      minuteCap: user.minuteCap, usedMinutes: usage,
      agentIds: user.agentIds || [], numberIds: user.numberIds || [],
    },
  });
});

app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/auth/') || req.path === '/me') return next();
  const user = currentUser(req);
  if (!user || user.status !== 'active') return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
});

// Demo users: read-only. Serve realistic sample data for reads; block every write.
const DEMO_WRITE_MSG = 'This is a read-only live demo. Request access to place real calls, train agents and manage your own clients.';
app.use('/api', (req, res, next) => {
  if (!req.user || !req.user.demo) return next();
  if (req.method !== 'GET') return res.status(403).json({ error: DEMO_WRITE_MSG });
  const p = req.path;
  if (p === '/agents') return res.json({ bots: [demo.agent], total_records: 1 });
  if (p.startsWith('/agents/')) return res.json(demo.agent);
  if (p === '/calls/logs') return res.json(demo.pagedLogs(Number(req.query.pageno) || 1, Number(req.query.pagesize) || 20, req.query.call_status || ''));
  if (p.startsWith('/calls/logs/')) { const id = Number(p.split('/').pop()); return res.json(demo.logs.find((l) => l.id === id) || {}); }
  if (p === '/knowledge') return res.json({ success: true, files: demo.knowledge });
  if (p === '/numbers') return res.json({ success: true, phone_numbers: demo.numbers });
  if (p === '/campaigns') return res.json({ records: demo.campaigns, bulk_calls: demo.campaigns });
  if (p === '/voices') return res.json({ voices: [] });
  if (p === '/llms') return res.json({ llms: [] });
  return res.json({});
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
  const users = await Promise.all(db.listUsers().filter((u) => !u.demo).map(async (u) => ({
    id: u.id, email: u.email, org: u.org, role: u.role, status: u.status,
    contact: u.contact || '', phone: u.phone || '', note: u.note || '',
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
// Public marketing site at the root; the dashboard SPA lives at /app.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

(async () => {
  await db.init();
  db.ensureAdmin(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  db.ensureDemo(demo.AGENT_ID);
  app.listen(PORT, () => console.log(`${BRAND} running at http://localhost:${PORT}`));
})();

// Flush the last write to Redis before Render stops the instance.
process.on('SIGTERM', async () => { await db.flush(); process.exit(0); });
process.on('SIGINT', async () => { await db.flush(); process.exit(0); });
