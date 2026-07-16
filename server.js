/**
 * MNB Omni Caller \u2014 multi-tenant Voice AI platform by MNB Research.
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
  resendSend({ to: MAIL_ADMIN, subject: `New access request \u2014 ${APP_NAME}: ${u.contact || u.org || u.email}`, html: accessEmailShell(adminInner) });

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
  resendSend({ to: u.email, subject: 'We received your access request \u2014 MNB Omni Caller', html: accessEmailShell(reqInner) });
}

app.post('/api/auth/signup', (req, res) => {
  const { org, email, password, contact, phone, note } = req.body || {};
  if (!org || !email || !password) return res.status(400).json({ error: 'Organization, email and password are required' });
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (db.findUserByEmail(email)) return res.status(409).json({ error: 'An account with this email already exists' });
  const user = db.createUser({ email, password, org, contact, phone, note });
  notifyNewLead(user);            // fire-and-forget push alert (ntfy)
  sendAccessRequestEmails(user);  // fire-and-forget Resend emails (admin + requester)
  onNewLead(user);                // fire-and-forget integration fan-out (Sheets/webhook/Slack/WhatsApp)
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

// One-click read-only demo login (no password) \u2014 powers "View live demo".
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
      businessType: user.businessType || 'general',
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
  // v6 read endpoints serve their own demo sample data -> let them through
  if (p === '/verticals' || p === '/analytics/overview' || p === '/calls/live' ||
      p.startsWith('/analytics/call/') || p.endsWith('/transcript')) return next();
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
    contact: u.contact || '', phone: u.phone || '', note: u.note || '', businessType: u.businessType || 'general',
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

/* ========================================================================
 * v6 PLATFORM LAYER
 * Business verticals, live-call AI analytics, and the India-first
 * integrations layer. Every secret lives ONLY on this server. Non-admin
 * clients never receive any key. Analytics works even with zero keys
 * configured (built-in heuristic engine) and upgrades automatically to a
 * free-tier LLM (Groq / Google Gemini) the moment a key is set.
 * ===================================================================== */

/* ---------------- Business verticals (India-first templates) ---------- */
const VERTICALS = {
  general: {
    id: 'general', name: 'General Business', icon: 'briefcase',
    goal: 'qualify the lead and book a follow-up',
    fields: [
      { key: 'interest', label: 'Primary interest', type: 'text' },
      { key: 'budget', label: 'Budget (INR)', type: 'number' },
      { key: 'timeline', label: 'Timeline', type: 'text' },
      { key: 'followup', label: 'Follow-up booked?', type: 'bool' },
    ],
    kpis: [
      { key: 'conversion', label: 'Conversion rate' },
      { key: 'followups', label: 'Follow-ups booked' },
      { key: 'avg_score', label: 'Avg call score' },
    ],
    outcomes: ['interested', 'not_interested', 'callback', 'booked', 'complaint'],
  },
  restaurant: {
    id: 'restaurant', name: 'Restaurant & Cafe', icon: 'utensils',
    goal: 'take a reservation or an order and capture guest details',
    fields: [
      { key: 'party_size', label: 'Party size', type: 'number' },
      { key: 'reservation_time', label: 'Reservation date/time', type: 'text' },
      { key: 'order_value', label: 'Order value (INR)', type: 'number' },
      { key: 'occasion', label: 'Occasion', type: 'text' },
      { key: 'special_requests', label: 'Special requests', type: 'text' },
    ],
    kpis: [
      { key: 'reservations', label: 'Reservations' },
      { key: 'avg_order_value', label: 'Avg order value' },
      { key: 'no_show_rate', label: 'No-show rate' },
      { key: 'repeat_guests', label: 'Repeat guests' },
    ],
    outcomes: ['reservation_booked', 'order_placed', 'enquiry', 'no_availability', 'complaint'],
  },
  clinic: {
    id: 'clinic', name: 'Clinic & Hospital', icon: 'stethoscope',
    goal: 'book or reschedule an appointment and triage urgency',
    fields: [
      { key: 'appointment_time', label: 'Appointment date/time', type: 'text' },
      { key: 'department', label: 'Department / specialty', type: 'text' },
      { key: 'patient_type', label: 'New or returning patient', type: 'text' },
      { key: 'urgency', label: 'Urgency', type: 'text' },
      { key: 'insurance', label: 'Insurance / payment', type: 'text' },
    ],
    kpis: [
      { key: 'appointments', label: 'Appointments booked' },
      { key: 'reschedules', label: 'Reschedules' },
      { key: 'no_show_rate', label: 'No-show rate' },
      { key: 'urgent_flagged', label: 'Urgent cases flagged' },
    ],
    outcomes: ['appointment_booked', 'rescheduled', 'enquiry', 'urgent_referral', 'cancelled'],
  },
  realestate: {
    id: 'realestate', name: 'Real Estate', icon: 'home',
    goal: 'qualify the buyer/renter and book a site visit',
    fields: [
      { key: 'budget', label: 'Budget (INR)', type: 'number' },
      { key: 'locality', label: 'Preferred locality', type: 'text' },
      { key: 'config', label: 'Configuration (BHK)', type: 'text' },
      { key: 'buy_or_rent', label: 'Buy or rent', type: 'text' },
      { key: 'site_visit', label: 'Site visit booked?', type: 'bool' },
    ],
    kpis: [
      { key: 'site_visits', label: 'Site visits booked' },
      { key: 'hot_leads', label: 'Hot leads' },
      { key: 'avg_budget', label: 'Avg budget' },
      { key: 'conversion', label: 'Conversion rate' },
    ],
    outcomes: ['site_visit_booked', 'hot_lead', 'warm_lead', 'not_interested', 'callback'],
  },
  ecommerce: {
    id: 'ecommerce', name: 'E-commerce / D2C', icon: 'shopping-cart',
    goal: 'confirm the order, recover the cart or resolve the query',
    fields: [
      { key: 'order_id', label: 'Order ID', type: 'text' },
      { key: 'cod_confirmed', label: 'COD confirmed?', type: 'bool' },
      { key: 'issue_type', label: 'Issue type', type: 'text' },
      { key: 'cart_value', label: 'Cart value (INR)', type: 'number' },
      { key: 'resolution', label: 'Resolution', type: 'text' },
    ],
    kpis: [
      { key: 'cod_confirmed', label: 'COD confirmed' },
      { key: 'carts_recovered', label: 'Carts recovered' },
      { key: 'returns', label: 'Returns handled' },
      { key: 'csat', label: 'CSAT' },
    ],
    outcomes: ['confirmed', 'cart_recovered', 'return_initiated', 'resolved', 'escalated'],
  },
  education: {
    id: 'education', name: 'Education & Coaching', icon: 'graduation-cap',
    goal: 'capture course interest and book a counselling / demo session',
    fields: [
      { key: 'course', label: 'Course of interest', type: 'text' },
      { key: 'stage', label: 'Admission stage', type: 'text' },
      { key: 'demo_booked', label: 'Demo/counselling booked?', type: 'bool' },
      { key: 'fee_query', label: 'Fee query', type: 'text' },
      { key: 'city', label: 'City', type: 'text' },
    ],
    kpis: [
      { key: 'demos_booked', label: 'Demos booked' },
      { key: 'applications', label: 'Applications' },
      { key: 'fee_queries', label: 'Fee queries' },
      { key: 'conversion', label: 'Conversion rate' },
    ],
    outcomes: ['demo_booked', 'application_started', 'enquiry', 'not_interested', 'callback'],
  },
  lending: {
    id: 'lending', name: 'Lending & Financial Services', icon: 'landmark',
    goal: 'qualify eligibility and progress the loan / collection',
    fields: [
      { key: 'loan_type', label: 'Loan / product type', type: 'text' },
      { key: 'ticket_size', label: 'Ticket size (INR)', type: 'number' },
      { key: 'kyc_stage', label: 'KYC stage', type: 'text' },
      { key: 'emi_status', label: 'EMI / collection status', type: 'text' },
      { key: 'eligible', label: 'Eligible?', type: 'bool' },
    ],
    kpis: [
      { key: 'qualified', label: 'Qualified leads' },
      { key: 'kyc_done', label: 'KYC completed' },
      { key: 'promise_to_pay', label: 'Promise-to-pay' },
      { key: 'avg_ticket', label: 'Avg ticket size' },
    ],
    outcomes: ['qualified', 'kyc_pending', 'promise_to_pay', 'not_eligible', 'callback'],
  },
};
function verticalOf(user) { return VERTICALS[(user && user.businessType) || 'general'] || VERTICALS.general; }

/* ---------------- Integration config resolver (env OR admin-set) ------ */
function integCfg() { const s = db.getSettings(); return s.integrations || (s.integrations = {}); }
function cfg(section) { return integCfg()[section] || {}; }
function saveIntegSection(section, values) {
  const all = integCfg();
  all[section] = Object.assign({}, all[section] || {}, values || {});
  db.setSettings(Object.assign({}, db.getSettings(), { integrations: all }));
  return all[section];
}
function pref(section, field, envName) {
  const c = cfg(section);
  if (c[field] !== undefined && c[field] !== '') return c[field];
  return envName ? (process.env[envName] || '') : '';
}
const mask = (s) => { s = String(s || ''); return s ? '****' + s.slice(-4) : ''; };

/* ---------------- Free-tier LLM (Groq primary, Gemini fallback) ------- */
function aiProvider() {
  const c = cfg('ai');
  if (c.provider) return c.provider;
  if (pref('ai', 'groqKey', 'GROQ_API_KEY')) return 'groq';
  if (pref('ai', 'geminiKey', 'GEMINI_API_KEY')) return 'gemini';
  return 'none';
}
async function callLLM(system, user) {
  const provider = aiProvider();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 14000);
  try {
    if (provider === 'groq') {
      const key = pref('ai', 'groqKey', 'GROQ_API_KEY');
      if (!key) return null;
      const model = cfg('ai').model || 'llama-3.3-70b-versatile';
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model, temperature: 0.2, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.choices && j.choices[0] && j.choices[0].message ? j.choices[0].message.content : null;
    }
    if (provider === 'gemini') {
      const key = pref('ai', 'geminiKey', 'GEMINI_API_KEY');
      if (!key) return null;
      const model = cfg('ai').model || 'gemini-1.5-flash';
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: system + '\n\n' + user }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
        }),
      });
      if (!r.ok) return null;
      const j = await r.json();
      return j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts
        ? j.candidates[0].content.parts.map((p) => p.text).join('') : null;
    }
    return null;
  } catch (e) { return null; } finally { clearTimeout(t); }
}

/* ---------------- Transcript parsing + heuristic analytics ------------ */
function convToText(log) {
  const raw = log.call_conversation || log.transcript || log.call_transcript || log.conversation || '';
  return String(raw).replace(/<br\s*\/?>/gi, '\n').replace(/\s+\n/g, '\n').trim();
}
function turns(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = /^(LLM|assistant|agent|bot|user|customer|caller)\s*[:\-]\s*(.*)$/i.exec(l);
    if (m) { const who = /user|customer|caller/i.test(m[1]) ? 'user' : 'agent'; return { who, text: m[2] }; }
    return { who: 'agent', text: l };
  });
}
const POS = ['yes', 'sure', 'great', 'perfect', 'interested', 'book', 'booked', 'sounds good', 'go for it', 'definitely', 'useful', 'relief', 'works'];
const NEG = ['no', 'not interested', 'do not call', "don't call", 'busy', 'stop', 'remove', 'angry', 'refund', 'complaint', 'unhappy', 'never'];
function heuristicAnalyze(log, vertical) {
  const text = convToText(log);
  const low = text.toLowerCase();
  const ts = turns(text);
  let sentiment = (log.sentiment_score || '').toLowerCase() || 'neutral';
  if (!['positive', 'neutral', 'negative'].includes(sentiment)) {
    const pos = POS.filter((w) => low.includes(w)).length;
    const neg = NEG.filter((w) => low.includes(w)).length;
    sentiment = neg > pos ? 'negative' : pos > 0 ? 'positive' : 'neutral';
  }
  let outcome = 'enquiry', intent = 'general enquiry';
  if (/\b(book|booked|schedule|set up|site visit|appointment|demo)\b/.test(low)) { outcome = 'booked'; intent = 'booking'; }
  else if (/\b(price|pricing|quote|cost|fee|email me)\b/.test(low)) { intent = 'pricing enquiry'; }
  else if (/\b(call me|callback|next week|later)\b/.test(low)) { outcome = 'callback'; intent = 'callback requested'; }
  else if (NEG.some((w) => low.includes(w))) { outcome = 'not_interested'; intent = 'not interested'; }
  else if (sentiment === 'positive') { outcome = 'interested'; intent = 'interested'; }
  const dur = parseDur(log.call_duration);
  let score = 40;
  if (sentiment === 'positive') score += 30; if (sentiment === 'negative') score -= 20;
  if (outcome === 'booked') score += 25; if (outcome === 'callback') score += 8;
  if (dur > 90) score += 10; if (dur > 0 && dur < 20) score -= 10;
  if (log.call_status && log.call_status !== 'completed') score = Math.min(score, 25);
  score = Math.max(0, Math.min(100, score));
  const userTurns = ts.filter((t) => t.who === 'user').length;
  const agentTurns = ts.filter((t) => t.who === 'agent').length;
  const talkRatio = agentTurns + userTurns ? Math.round((agentTurns / (agentTurns + userTurns)) * 100) : 0;
  const fields = {};
  const money = low.match(/(?:rs\.?|inr|\u20B9)\s*([\d,]+)/i);
  if (money) fields.budget = money[1].replace(/,/g, '');
  const party = low.match(/\b(\d{1,2})\s*(?:people|pax|guests|persons?)\b/);
  if (party) fields.party_size = party[1];
  const coaching = [];
  if (talkRatio > 70) coaching.push('Agent dominated the conversation - ask more open questions and let the customer talk.');
  if (outcome === 'booked') coaching.push('Strong close. Confirm the details over WhatsApp/email to lock it in.');
  if (intent === 'pricing enquiry') coaching.push('Pricing interest detected - send the price sheet immediately while intent is warm.');
  if (sentiment === 'negative') coaching.push('Negative sentiment - suppress from re-dial list and log a do-not-call note.');
  if (!coaching.length) coaching.push('Solid call. A quick follow-up message will keep momentum.');
  const summary = log.sentiment_analysis_details || (ts.find((t) => t.who === 'user') ? 'Customer: ' + ts.find((t) => t.who === 'user').text : 'Call completed.');
  return { engine: 'heuristic', summary, sentiment, intent, outcome, score, talkRatio, fields, coaching };
}
async function analyzeCall(log, vertical) {
  const text = convToText(log);
  if (!text || text.length < 12) return heuristicAnalyze(log, vertical);
  if (aiProvider() === 'none') return heuristicAnalyze(log, vertical);
  const fieldList = vertical.fields.map((f) => `"${f.key}" (${f.label})`).join(', ');
  const sys = 'You are a call-analytics engine for a voice-AI platform. Analyze the sales/support call transcript. Respond ONLY with a compact JSON object, no prose.';
  const usr = `Business type: ${vertical.name}. Goal of the call: ${vertical.goal}.
Extract these vertical fields if present: ${fieldList}.
Return JSON with keys: summary (1-2 sentences), sentiment ("positive"|"neutral"|"negative"), intent (short phrase), outcome (one of ${JSON.stringify(vertical.outcomes)}), score (0-100 integer for call quality/likelihood to convert), talkRatio (0-100 integer, percent the agent spoke), fields (object of the extracted vertical fields, omit unknown), coaching (array of 1-3 short coaching tips).
Transcript:
${text.slice(0, 6000)}`;
  const out = await callLLM(sys, usr);
  if (!out) return heuristicAnalyze(log, vertical);
  try {
    const j = JSON.parse(out);
    j.engine = 'ai'; j.score = Math.max(0, Math.min(100, Math.round(Number(j.score) || 0)));
    if (!j.coaching) j.coaching = [];
    if (!j.fields) j.fields = {};
    return j;
  } catch (e) { return heuristicAnalyze(log, vertical); }
}

/* ---------------- Analytics endpoints --------------------------------- */
const analysisCache = new Map(); // callId -> {at, analysis}
async function fetchLog(req, id) {
  if (req.user.demo) return demo.logs.find((l) => l.id === Number(id)) || null;
  const { status, data } = await omni('GET', `/calls/logs/${id}`);
  return status === 200 ? data : null;
}
async function recentLogs(req, limit) {
  if (req.user.demo) return demo.logs.slice(0, limit);
  if (isAdmin(req)) {
    const { data } = await omni('GET', '/calls/logs', { query: { pageno: 1, pagesize: limit } });
    return data.call_log_data || [];
  }
  let all = [];
  for (const agentId of req.user.agentIds) {
    const { data } = await omni('GET', '/calls/logs', { query: { pageno: 1, pagesize: 100, agentid: agentId } });
    all = all.concat(data.call_log_data || []);
  }
  all.sort((a, b) => new Date(b.time_of_call) - new Date(a.time_of_call));
  return all.slice(0, limit);
}

app.get('/api/verticals', (req, res) => {
  res.json({ verticals: VERTICALS, current: (req.user && req.user.businessType) || 'general' });
});
app.post('/api/my/vertical', (req, res) => {
  const bt = String((req.body || {}).businessType || '');
  if (!VERTICALS[bt]) return res.status(400).json({ error: 'Unknown business type' });
  db.updateUser(req.user.id, { businessType: bt });
  res.json({ ok: true, businessType: bt, vertical: VERTICALS[bt] });
});
app.post('/api/admin/org/:id/vertical', adminOnly, (req, res) => {
  const bt = String((req.body || {}).businessType || '');
  if (!VERTICALS[bt]) return res.status(400).json({ error: 'Unknown business type' });
  const u = db.updateUser(req.params.id, { businessType: bt });
  if (!u) return res.status(404).json({ error: 'Org not found' });
  res.json({ ok: true });
});

app.get('/api/analytics/call/:id', async (req, res) => {
  try {
    const cached = analysisCache.get(String(req.params.id));
    if (cached && Date.now() - cached.at < 3600000) return res.json({ analysis: cached.analysis, cached: true });
    const log = await fetchLog(req, req.params.id);
    if (!log) return res.status(404).json({ error: 'Call not found' });
    const analysis = await analyzeCall(log, verticalOf(req.user));
    analysisCache.set(String(req.params.id), { at: Date.now(), analysis });
    res.json({ analysis });
  } catch (e) { res.status(502).json({ error: 'Analysis failed', detail: String(e.message || e) }); }
});

app.get('/api/analytics/overview', async (req, res) => {
  try {
    const vertical = verticalOf(req.user);
    const logs = await recentLogs(req, 60);
    const done = logs.filter((l) => convToText(l).length > 12);
    const analyses = done.map((l) => heuristicAnalyze(l, vertical)); // fast, no external call
    const n = analyses.length || 1;
    const sent = { positive: 0, neutral: 0, negative: 0 };
    const outcomes = {}; const intents = {};
    let scoreSum = 0, talkSum = 0, booked = 0;
    for (const a of analyses) {
      sent[a.sentiment] = (sent[a.sentiment] || 0) + 1;
      outcomes[a.outcome] = (outcomes[a.outcome] || 0) + 1;
      intents[a.intent] = (intents[a.intent] || 0) + 1;
      scoreSum += a.score; talkSum += a.talkRatio;
      if (['booked', 'reservation_booked', 'appointment_booked', 'site_visit_booked', 'demo_booked', 'qualified', 'order_placed', 'confirmed'].includes(a.outcome)) booked++;
    }
    const total = logs.length;
    const connected = logs.filter((l) => l.call_status === 'completed').length;
    res.json({
      vertical: { id: vertical.id, name: vertical.name, kpis: vertical.kpis },
      totals: { calls: total, connected, analyzed: analyses.length },
      avgScore: Math.round(scoreSum / n),
      avgTalkRatio: Math.round(talkSum / n),
      conversion: total ? Math.round((booked / total) * 100) : 0,
      booked,
      sentiment: sent,
      outcomes: Object.entries(outcomes).sort((a, b) => b[1] - a[1]),
      topIntents: Object.entries(intents).sort((a, b) => b[1] - a[1]).slice(0, 6),
      aiEngine: aiProvider() === 'none' ? 'heuristic' : aiProvider(),
    });
  } catch (e) { res.status(502).json({ error: 'Overview failed', detail: String(e.message || e) }); }
});

/* ---------------- Live calls (near-real-time via polling) ------------- */
const LIVE_STATES = ['in-progress', 'in_progress', 'ongoing', 'ringing', 'initiated', 'live', 'active'];
app.get('/api/calls/live', async (req, res) => {
  try {
    if (req.user.demo) {
      // Synthesize a believable live call that grows over a ~90s loop.
      const script = [
        { who: 'agent', text: 'Hi, this is Riya from MNB Research. Am I speaking with Aditya?' },
        { who: 'user', text: 'Yes, that is me.' },
        { who: 'agent', text: 'You had enquired about AI voice agents for your clinic. What takes up most of your front-desk time?' },
        { who: 'user', text: 'Honestly, appointment calls all day long.' },
        { who: 'agent', text: 'Our AI can answer and book those 24/7 in Hindi and English. Shall I set up a quick demo?' },
        { who: 'user', text: 'Yes, that would really help us.' },
        { who: 'agent', text: 'Wonderful. Booking you for Thursday at 4 PM. Confirmation on WhatsApp now.' },
      ];
      const secs = Math.floor((Date.now() / 1000) % 90);
      const shown = Math.max(1, Math.min(script.length, Math.floor(secs / 12) + 1));
      return res.json({
        live: [{
          id: 999001, bot_name: demo.agent.name, to_number: '+91 98111 45522',
          call_status: 'in-progress', started_secs_ago: secs,
          transcript: script.slice(0, shown),
          done: shown >= script.length,
        }],
      });
    }
    const logs = await recentLogs(req, 40);
    const live = logs.filter((l) => LIVE_STATES.includes(String(l.call_status || '').toLowerCase()))
      .map((l) => ({ id: l.id, bot_name: l.bot_name, to_number: l.to_number, call_status: l.call_status, transcript: turns(convToText(l)) }));
    res.json({ live });
  } catch (e) { res.status(502).json({ error: 'Live fetch failed' }); }
});
app.get('/api/calls/:id/transcript', async (req, res) => {
  try {
    const log = await fetchLog(req, req.params.id);
    if (!log) return res.status(404).json({ error: 'Call not found' });
    res.json({ id: log.id, call_status: log.call_status, transcript: turns(convToText(log)), duration: log.call_duration });
  } catch (e) { res.status(502).json({ error: 'Transcript fetch failed' }); }
});

/* ---------------- Integration send helpers (all guarded, fail-safe) --- */
async function sendWhatsApp(to, text) {
  const c = cfg('whatsapp');
  const token = pref('whatsapp', 'token', 'WHATSAPP_TOKEN');
  const phoneId = pref('whatsapp', 'phoneId', 'WHATSAPP_PHONE_ID');
  if (!c.enabled || !token || !phoneId) return { ok: false, skipped: true };
  const digits = String(to || '').replace(/[^\d]/g, '');
  if (!digits) return { ok: false, error: 'no number' };
  try {
    const r = await fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: digits, type: 'text', text: { body: text } }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, id: (j.messages && j.messages[0] && j.messages[0].id) || '' } : { ok: false, error: (j.error && j.error.message) || r.status };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
async function postJson(url, payload) {
  if (!url) return { ok: false, skipped: true };
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}
async function pushToSheet(obj) { const c = cfg('sheets'); if (!c.enabled || !c.webhookUrl) return { ok: false, skipped: true }; return postJson(c.webhookUrl, obj); }
async function fireWebhook(payload) { const c = cfg('webhook'); if (!c.enabled || !c.url) return { ok: false, skipped: true }; return postJson(c.url, payload); }
async function sendSlack(text) { const c = cfg('slack'); if (!c.enabled || !c.webhookUrl) return { ok: false, skipped: true }; return postJson(c.webhookUrl, { text }); }
async function razorpayOrder(amountPaise, receipt) {
  const c = cfg('razorpay');
  const keyId = pref('razorpay', 'keyId', 'RAZORPAY_KEY_ID');
  const keySecret = pref('razorpay', 'keySecret', 'RAZORPAY_KEY_SECRET');
  if (!c.enabled || !keyId || !keySecret) return { ok: false, skipped: true };
  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const r = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt: receipt || ('mnb_' + Date.now()) }),
    });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true, order: j } : { ok: false, error: (j.error && j.error.description) || r.status };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// Fan out a new access-request lead to whichever integrations are enabled.
function onNewLead(u) {
  try {
    const row = { event: 'new_lead', org: u.org, name: u.contact || '', email: u.email, phone: u.phone || '', looking_for: u.note || '', at: new Date().toISOString() };
    pushToSheet(row).catch(() => {});
    fireWebhook(row).catch(() => {});
    sendSlack(`New MNB Omni Caller lead: *${u.org}* (${u.contact || u.email})${u.phone ? ' - ' + u.phone : ''}${u.note ? '\nWants: ' + u.note : ''}`).catch(() => {});
    if (cfg('whatsapp').welcomeLeads && u.phone) {
      sendWhatsApp(u.phone, `Hi ${(u.contact || '').split(' ')[0] || 'there'}, thanks for requesting access to MNB Omni Caller. Our team will reach out shortly. - MNB Research`).catch(() => {});
    }
  } catch (e) { /* never block signup */ }
}

/* ---------------- Admin: integrations control center ------------------ */
const FREE_CATALOG = [
  { key: 'ai', name: 'AI Call Analytics', tier: 'Groq free tier (very generous) or Google Gemini free tier', setup: 'Create a free key at console.groq.com or aistudio.google.com and paste it here. Until then, the built-in heuristic engine runs free with no key.' },
  { key: 'whatsapp', name: 'WhatsApp Business', tier: 'Meta WhatsApp Cloud API - 1,000 free service conversations/month', setup: 'Create a Meta app, get a permanent token + phone number ID, paste below.' },
  { key: 'razorpay', name: 'Razorpay Billing (INR)', tier: 'No monthly fee - pay only per transaction; Test mode is free', setup: 'Use Test keys from Razorpay Dashboard > Settings > API Keys to try it free.' },
  { key: 'sheets', name: 'Google Sheets / CRM sync', tier: '100% free via a Google Apps Script Web App (no OAuth needed)', setup: 'Create a Sheet, add an Apps Script doPost that appends rows, Deploy as Web App, paste the URL.' },
  { key: 'calendar', name: 'Calendar booking', tier: 'Free via Google Apps Script or Cal.com free tier', setup: 'Deploy an Apps Script that creates a Calendar event, paste the webhook URL.' },
  { key: 'webhook', name: 'Generic Webhook / Zapier / Make', tier: 'Free - Zapier and Make both have free tiers; raw webhooks are free', setup: 'Paste any URL. We POST every lead and call event to it as JSON.' },
  { key: 'slack', name: 'Slack / Discord alerts', tier: 'Free incoming webhooks', setup: 'Create an Incoming Webhook in Slack or Discord and paste the URL.' },
];
function maskedConfig() {
  const c = integCfg();
  const secretFields = { ai: ['groqKey', 'geminiKey'], whatsapp: ['token'], razorpay: ['keyId', 'keySecret'], sheets: ['webhookUrl'], calendar: ['webhookUrl'], webhook: ['url'], slack: ['webhookUrl'] };
  const out = {};
  for (const [sec, fields] of Object.entries(secretFields)) {
    const s = c[sec] || {};
    out[sec] = Object.assign({}, s);
    for (const f of fields) if (s[f]) out[sec][f] = mask(s[f]);
  }
  return out;
}
function envPresence() {
  const names = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
  const o = {}; for (const n of names) o[n] = !!process.env[n]; return o;
}
app.get('/api/admin/integrations', adminOnly, (req, res) => {
  res.json({ config: maskedConfig(), env: envPresence(), catalog: FREE_CATALOG, aiProvider: aiProvider(), verticals: VERTICALS });
});
app.post('/api/admin/integrations', adminOnly, (req, res) => {
  const { section, values } = req.body || {};
  const allowed = ['ai', 'whatsapp', 'razorpay', 'sheets', 'calendar', 'webhook', 'slack'];
  if (!allowed.includes(section)) return res.status(400).json({ error: 'Unknown section' });
  // Do not overwrite a stored secret with a masked placeholder coming back from the UI.
  const clean = {};
  for (const [k, v] of Object.entries(values || {})) {
    if (typeof v === 'string' && v.startsWith('****')) continue;
    clean[k] = v;
  }
  saveIntegSection(section, clean);
  res.json({ ok: true, config: maskedConfig(), aiProvider: aiProvider() });
});
app.post('/api/admin/integrations/test/:name', adminOnly, async (req, res) => {
  const name = req.params.name;
  const to = (req.body || {}).to || '';
  try {
    if (name === 'ai') {
      const out = await callLLM('Respond only with JSON.', 'Return {"ok":true,"engine":"live"} as JSON.');
      return res.json({ ok: !!out, provider: aiProvider(), sample: out ? out.slice(0, 120) : 'No key set - heuristic engine active (free).' });
    }
    if (name === 'whatsapp') return res.json(await sendWhatsApp(to, 'Test message from MNB Omni Caller. Your WhatsApp integration works.'));
    if (name === 'sheets') return res.json(await pushToSheet({ event: 'test', at: new Date().toISOString(), note: 'MNB Omni Caller test row' }));
    if (name === 'webhook') return res.json(await fireWebhook({ event: 'test', at: new Date().toISOString() }));
    if (name === 'slack') return res.json(await sendSlack('Test alert from MNB Omni Caller. Integration works.'));
    if (name === 'calendar') { const c = cfg('calendar'); return res.json(await postJson(c.webhookUrl, { event: 'test', title: 'MNB Omni Caller test event' })); }
    if (name === 'razorpay') return res.json(await razorpayOrder(100, 'mnb_test_' + Date.now()));
    return res.status(400).json({ error: 'Unknown integration' });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

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
