/**
 * MNB Research — Voice AI Dashboard
 * Backend proxy for the OmniDim API. The API key lives only on this server;
 * the browser never sees it.
 */
require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(express.json({ limit: '30mb' }));

const BASE = process.env.OMNIDIM_API_BASE || 'https://backend.omnidim.io/api/v1';
const KEY = process.env.OMNIDIM_API_KEY;
const PASSWORD = process.env.DASHBOARD_PASSWORD || '';
const BRAND = process.env.BRAND_NAME || 'MNB Research';
const PORT = process.env.PORT || 3000;

if (!KEY) {
  console.error('Missing OMNIDIM_API_KEY in .env');
  process.exit(1);
}

// ---------- Simple session auth (optional, enabled when DASHBOARD_PASSWORD is set) ----------
const sessions = new Set();

function getSessionToken(req) {
  const m = /mnb_session=([a-f0-9]{48})/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}

app.post('/api/login', (req, res) => {
  if (!PASSWORD) return res.json({ ok: true, authRequired: false });
  if ((req.body && req.body.password) === PASSWORD) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    res.setHeader('Set-Cookie', `mnb_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800`);
    return res.json({ ok: true });
  }
  res.status(401).json({ ok: false, error: 'Wrong password' });
});

app.get('/api/config', (req, res) => {
  const authed = !PASSWORD || sessions.has(getSessionToken(req));
  res.json({ brand: BRAND, authRequired: !!PASSWORD, authed });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/login' || req.path === '/config') return next();
  if (PASSWORD && !sessions.has(getSessionToken(req))) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

// ---------- OmniDim proxy helper ----------
async function omni(method, upstreamPath, { query, body } = {}) {
  const qs = query ? '?' + new URLSearchParams(query).toString() : '';
  const resp = await fetch(BASE + upstreamPath + qs, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    },
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

// ---------- Agents ----------
app.get('/api/agents', relay('GET', '/agents', { passQuery: true }));
app.get('/api/agents/:id', relay('GET', r => `/agents/${r.params.id}`));
app.put('/api/agents/:id', relay('PUT', r => `/agents/${r.params.id}`));
app.delete('/api/agents/:id', relay('DELETE', r => `/agents/${r.params.id}`));
app.post('/api/agents', relay('POST', '/agents/create'));

// ---------- Calls ----------
app.post('/api/calls/dispatch', relay('POST', '/calls/dispatch'));
app.get('/api/calls/logs', relay('GET', '/calls/logs', { passQuery: true }));
app.get('/api/calls/logs/:id', relay('GET', r => `/calls/logs/${r.params.id}`));

// ---------- Bulk calls / campaigns ----------
app.get('/api/campaigns', relay('GET', '/calls/bulk_call', { passQuery: true }));
app.post('/api/campaigns', relay('POST', '/calls/bulk_call/create'));
app.get('/api/campaigns/:id', relay('GET', r => `/calls/bulk_call/${r.params.id}`));
app.put('/api/campaigns/:id', relay('PUT', r => `/calls/bulk_call/${r.params.id}`));
app.delete('/api/campaigns/:id', relay('DELETE', r => `/calls/bulk_call/${r.params.id}`));
app.post('/api/campaigns/:id/contact', relay('POST', r => `/calls/bulk_call/${r.params.id}/add_contact`));
app.get('/api/campaigns/:id/live', relay('GET', r => `/bulk-call/${r.params.id}/live-status`));

// ---------- Knowledge base ----------
app.get('/api/knowledge', relay('GET', '/knowledge_base/list'));
app.post('/api/knowledge/can-upload', relay('POST', '/knowledge_base/can_upload'));
app.post('/api/knowledge/upload', relay('POST', '/knowledge_base/create'));
app.post('/api/knowledge/attach', relay('POST', '/knowledge_base/attach'));
app.post('/api/knowledge/detach', relay('POST', '/knowledge_base/detach'));
app.post('/api/knowledge/delete', relay('POST', '/knowledge_base/delete'));

// ---------- Call recordings (streams tokenized audio through this server) ----------
app.get('/api/recording/:id', async (req, res) => {
  try {
    const qs = new URLSearchParams(req.query).toString();
    const upstream = await fetch(`${BASE}/recording/${req.params.id}${qs ? '?' + qs : ''}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    if (!upstream.ok) return res.status(upstream.status).end();
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.status(502).json({ error: 'Recording fetch failed' });
  }
});

// ---------- Phone numbers & providers ----------
app.get('/api/numbers', relay('GET', '/phone_number/list', { passQuery: true }));
app.post('/api/numbers/attach', relay('POST', '/phone_number/attach'));
app.post('/api/numbers/detach', relay('POST', '/phone_number/detach'));
app.get('/api/voices', relay('GET', '/providers/voices', { passQuery: true }));
app.get('/api/llms', relay('GET', '/providers/llms'));

// ---------- Text / URL → PDF sources ----------
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

// Upload pasted text or a .txt/.md file's contents as a knowledge source
app.post('/api/knowledge/upload-text', async (req, res) => {
  try {
    const { title, text } = req.body || {};
    if (!text || !String(text).trim()) return res.status(400).json({ error: 'No text provided' });
    const b64 = await textToPdfBase64(title || 'Document', String(text));
    const { status, data } = await omni('POST', '/knowledge_base/create', {
      body: { file: b64, filename: safePdfName(title || 'document') },
    });
    res.status(status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Conversion failed', detail: String(err.message || err) });
  }
});

// Fetch a web page, extract its text, convert to PDF, upload as a source
app.post('/api/knowledge/upload-url', async (req, res) => {
  try {
    let { url } = req.body || {};
    if (!url) return res.status(400).json({ error: 'No URL provided' });
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    const page = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (MNB Research KB fetcher)' }, redirect: 'follow' });
    if (!page.ok) return res.status(400).json({ error: `Could not fetch page (HTTP ${page.status})` });
    const html = await page.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
    if (text.length < 50) return res.status(400).json({ error: 'Page had no readable text (it may need JavaScript to render)' });
    const host = new URL(url).hostname.replace(/^www\./, '');
    const b64 = await textToPdfBase64(`Source: ${url}`, text.slice(0, 200000));
    const { status, data } = await omni('POST', '/knowledge_base/create', {
      body: { file: b64, filename: safePdfName(host) },
    });
    res.status(status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'URL import failed', detail: String(err.message || err) });
  }
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`${BRAND} dashboard running at http://localhost:${PORT}`);
});
