/* ===== MNB Research \u2014 Voice AI Platform (frontend) ===== */

const $ = (id) => document.getElementById(id);
const api = async (path, opts = {}) => {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data.message || `Request failed (${res.status})`);
  return data;
};

/* White-label scrub: the client only ever sees the MNB Research brand. */
const BRAND = 'MNB Research';
const scrub = (s) => String(s ?? '').replace(/omni\s?dimension|omnidim/gi, BRAND);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const show = (s) => esc(scrub(s));

let agents = [];
let numbers = [];
let logsPage = 1;
let charts = {};
let lastChartLogs = null;

/* ---------- Theme ---------- */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const btn = $('themeToggle');
  if (btn) btn.textContent = theme === 'light' ? '\u25D1 Dark mode' : '\u25D0 Light mode';
  localStorage.setItem('mnb_theme', theme);
  if (lastChartLogs) drawCharts(lastChartLogs);
}
function toggleTheme() {
  applyTheme((localStorage.getItem('mnb_theme') || 'dark') === 'dark' ? 'light' : 'dark');
}
applyTheme(localStorage.getItem('mnb_theme') || 'dark');

/* ---------- Boot & auth ---------- */
let me = null;

(async function boot() {
  const info = await api('/me');
  if (!info.authed) {
    $('loginGate').classList.remove('hidden');
    $('loginPassword').addEventListener('keydown', (e) => e.key === 'Enter' && doLogin());
    $('loginEmail').addEventListener('keydown', (e) => e.key === 'Enter' && $('loginPassword').focus());
    if (/signup/i.test(location.hash)) showSignup();
    return;
  }
  me = info.user;
  startApp();
})();

function showSignup() { $('loginForm').classList.add('hidden'); $('signupForm').classList.remove('hidden'); hideAuthMsgs(); }
function showLogin() { $('signupForm').classList.add('hidden'); $('loginForm').classList.remove('hidden'); hideAuthMsgs(); }
function hideAuthMsgs() { $('loginError').classList.add('hidden'); $('loginOk').classList.add('hidden'); }

async function doLogin() {
  hideAuthMsgs();
  try {
    await api('/auth/login', { method: 'POST', body: { email: $('loginEmail').value.trim(), password: $('loginPassword').value } });
    const info = await api('/me');
    me = info.user;
    $('loginGate').classList.add('hidden');
    startApp();
  } catch (e) {
    $('loginError').textContent = e.message;
    $('loginError').classList.remove('hidden');
  }
}

async function doSignup() {
  hideAuthMsgs();
  try {
    const r = await api('/auth/signup', {
      method: 'POST',
      body: {
        org: $('suOrg').value.trim(),
        contact: $('suContact').value.trim(),
        phone: $('suPhone').value.trim(),
        email: $('suEmail').value.trim(),
        password: $('suPassword').value,
        note: $('suNote').value.trim(),
      },
    });
    $('loginOk').textContent = '\u2705 ' + (r.message || 'Request sent.');
    $('loginOk').classList.remove('hidden');
    setTimeout(showLogin, 2500);
  } catch (e) {
    $('loginError').textContent = e.message;
    $('loginError').classList.remove('hidden');
  }
}

async function doDemo() {
  try {
    await api('/auth/demo', { method: 'POST' });
    location.href = '/app';
  } catch (e) {
    alert('Demo is warming up \u2014 please try again in a few seconds.');
  }
}

async function doLogout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.href = '/';
}

function applyRoleUi() {
  const admin = me && me.role === 'admin';
  const demo = me && me.demo;
  $('navAdmin').classList.toggle('hidden', !admin);
  $('newAgentBtn').classList.toggle('hidden', !admin);
  $('demoBanner').classList.toggle('hidden', !demo);
  const delBtn = document.querySelector('#view-studio .view-head .btn.ghost[onclick="deleteAgent()"]');
  if (delBtn) delBtn.classList.toggle('hidden', !admin);
  $('whoami').textContent = me ? `${me.org} \u00B7 ${me.email}` : '';
  if (!admin && me && me.minuteCap > 0) {
    $('usageMeter').classList.remove('hidden');
    const used = me.usedMinutes ?? 0;
    const pct = Math.min(100, Math.round((used / me.minuteCap) * 100));
    $('usageBar').style.width = pct + '%';
    $('usageText').textContent = `${used} / ${me.minuteCap} min used`;
  }
}

async function startApp() {
  $('appShell').classList.remove('hidden');
  applyRoleUi();
  document.querySelectorAll('.nav-item').forEach((el) =>
    el.addEventListener('click', () => switchView(el.dataset.view))
  );
  await loadAgents();
  await loadNumbers();
  addContextRow();
  switchView(location.hash.replace('#', '') || 'overview');
  window.addEventListener('hashchange', () => switchView(location.hash.replace('#', '')));
}

function switchView(view) {
  const known = ['overview', 'call', 'studio', 'logs', 'knowledge', 'campaigns', 'numbers', 'plan', 'admin'];
  if (!known.includes(view)) view = 'overview';
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-' + view).classList.remove('hidden');
  document.querySelectorAll('.nav-item').forEach((el) =>
    el.classList.toggle('active', el.dataset.view === view)
  );
  location.hash = view;
  if (view === 'overview') loadOverview();
  if (view === 'logs') loadLogs(1);
  if (view === 'studio') loadStudio();
  if (view === 'knowledge') loadKnowledge();
  if (view === 'campaigns') loadCampaigns();
  if (view === 'numbers') loadNumbersView();
  if (view === 'plan') loadPlan();
  if (view === 'admin') loadAdmin();
}

/* ---------- CSV export ---------- */
async function exportLogsCsv() {
  toast('Preparing export\u2026');
  try {
    let all = [];
    for (let p = 1; p <= 10; p++) {
      const q = new URLSearchParams({ pageno: p, pagesize: 100 });
      if ($('logStatus').value) q.set('call_status', $('logStatus').value);
      const data = await api('/calls/logs?' + q);
      const rows = data.call_log_data || [];
      all = all.concat(rows);
      if (rows.length < 100) break;
    }
    if (!all.length) return toast('No calls to export');
    const cols = ['time_of_call', 'bot_name', 'from_number', 'to_number', 'call_direction', 'call_duration', 'call_status', 'sentiment_score'];
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""').replace(/<br\/?>/gi, ' ')}"`;
    const csv = [cols.join(','), ...all.map((r) => cols.map((c) => esc(scrub(r[c]))).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `mnb-omni-caller-calls-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    toast(`Exported ${all.length} calls`);
  } catch (e) {
    toast('Export failed: ' + e.message, 5000);
  }
}

/* ---------- Plan & Usage ---------- */
async function loadPlan() {
  const info = await api('/me').catch(() => null);
  const u = info && info.user;
  if (!u) return;
  const admin = u.role === 'admin';
  if (admin) {
    let clients = 0, active = 0;
    try {
      const d = await api('/admin/users');
      const list = (d.users || []).filter((x) => x.role !== 'admin');
      clients = list.length;
      active = list.filter((x) => x.status === 'active').length;
    } catch {}
    $('planBody').innerHTML = `
      <div class="card">
        <h3>MNB Research \u2014 Administrator</h3>
        <p class="muted">You have full platform access. Manage organizations, agents, numbers and limits from the Admin tab.</p>
        <div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-top:16px">
          <div class="stat-card"><div class="stat-label">Client organizations</div><div class="stat-value">${clients}</div></div>
          <div class="stat-card"><div class="stat-label">Active clients</div><div class="stat-value good">${active}</div></div>
          <div class="stat-card"><div class="stat-label">Your plan</div><div class="stat-value">Unlimited</div></div>
        </div>
      </div>`;
    return;
  }
  const used = u.usedMinutes ?? 0;
  const cap = u.minuteCap || 0;
  const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const remaining = cap ? Math.max(0, cap - used) : '\u221E';
  const tier = cap === 0 ? 'Scale (Unlimited)' : cap <= 500 ? 'Starter' : cap <= 1500 ? 'Growth' : 'Scale';
  $('planBody').innerHTML = `
    <div class="two-col">
      <div class="card">
        <h3>Your plan</h3>
        <div style="font-size:1.8em;font-weight:800" class="grad-hint">${tier}</div>
        <p class="muted" style="margin-top:6px">${u.org}</p>
        <div class="spacer"></div>
        <label style="margin:0 0 6px">Minutes used this month</label>
        <div style="background:var(--panel-2);border-radius:8px;height:12px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:var(--accent-grad)"></div>
        </div>
        <div class="muted" style="margin-top:6px">${used} of ${cap === 0 ? '\u221E' : cap} minutes \u00B7 ${remaining === '\u221E' ? 'unlimited remaining' : remaining + ' remaining'}</div>
      </div>
      <div class="card">
        <h3>What's included</h3>
        <div class="stat-grid" style="grid-template-columns:1fr 1fr;margin-top:4px">
          <div class="stat-card"><div class="stat-label">Agents assigned</div><div class="stat-value">${u.agentIds ? u.agentIds.length : agents.length}</div></div>
          <div class="stat-card"><div class="stat-label">Numbers assigned</div><div class="stat-value">${u.numberIds ? u.numberIds.length : 0}</div></div>
        </div>
        <p class="muted" style="margin-top:14px">Need more minutes, agents or a dedicated number? Contact MNB Research to upgrade your plan.</p>
        <a class="btn primary" href="https://wa.me/919711488481?text=Hi%20MNB%20Research,%20I'd%20like%20to%20upgrade%20my%20Omni%20Caller%20plan." target="_blank" rel="noopener" style="margin-top:8px;display:inline-block">Request an upgrade</a>
      </div>
    </div>`;
}

/* ---------- Admin panel ---------- */
let adminAllAgents = [];
let adminAllNumbers = [];

async function loadAdmin() {
  if (!me || me.role !== 'admin') return;
  try {
    const [usersR, agentsR, numbersR] = await Promise.all([
      api('/admin/users'), api('/agents'), api('/numbers'),
    ]);
    adminAllAgents = agentsR.bots || [];
    adminAllNumbers = numbersR.phone_numbers || [];
    const users = (usersR.users || []).filter((u) => u.role !== 'admin');
    $('adminUsers').innerHTML = users.length
      ? users.map(adminUserRow).join('')
      : '<p class="muted">No client organizations yet. When someone requests access on the login page, they appear here.</p>';
  } catch (e) {
    toast('Could not load admin data: ' + e.message, 5000);
  }
}

function adminUserRow(u) {
  const agentChecks = adminAllAgents.map((a) =>
    `<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-weight:400">
      <input type="checkbox" class="ag-${u.id}" value="${a.id}" ${u.agentIds.includes(a.id) ? 'checked' : ''} style="width:auto" /> ${show(a.name)}
    </label>`).join('') || '<span class="muted">No agents on the account yet</span>';
  const numberChecks = adminAllNumbers.map((n) =>
    `<label style="display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;font-weight:400">
      <input type="checkbox" class="num-${u.id}" value="${n.id}" ${u.numberIds.includes(n.id) ? 'checked' : ''} style="width:auto" /> ${show(n.phone_number || n.number || 'Number #' + n.id)}
    </label>`).join('') || '<span class="muted">No phone numbers on the account</span>';
  const statusBadge = u.status === 'active' ? '<span class="badge completed">active</span>'
    : u.status === 'pending' ? '<span class="badge no-answer">new request</span>'
    : '<span class="badge failed">revoked</span>';
  const phoneDigits = (u.phone || '').replace(/[^\d+]/g, '');
  const waDigits = (u.phone || '').replace(/[^\d]/g, '');
  const lead = (u.contact || u.phone || u.note) ? `
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin:8px 0;font-size:.92em">
      <span class="muted">Lead contact:</span>
      ${u.contact ? ` <b>${show(u.contact)}</b>` : ''}
      ${u.phone ? ` \u00B7 <b>${esc(u.phone)}</b>
        <a class="btn ghost small" style="padding:2px 8px;margin-left:6px" href="tel:${esc(phoneDigits)}">\u2706 Call</a>
        <a class="btn ghost small" style="padding:2px 8px" target="_blank" href="https://wa.me/${esc(waDigits)}">WhatsApp</a>` : ''}
      ${u.note ? `<div class="muted" style="margin-top:6px">\u201C${show(u.note)}\u201D</div>` : ''}
    </div>` : '';
  return `<div class="section-block">
    <div class="row-between">
      <div><b>${show(u.org || '\u2014')}</b> \u00B7 <span class="muted">${esc(u.email)}</span> ${statusBadge}
        ${u.usedMinutes != null ? `<span class="muted"> \u00B7 ${u.usedMinutes}/${u.minuteCap} min this month</span>` : ''}
      </div>
      <div>
        ${u.status !== 'active' ? `<button class="btn primary small" onclick="adminSave('${u.id}','active')">\u2713 Approve</button>` : ''}
        ${u.status === 'active' ? `<button class="btn ghost small" onclick="adminSave('${u.id}','active')">Save changes</button>
          <button class="btn ghost small" style="color:var(--bad)" onclick="adminSave('${u.id}','rejected')">Revoke</button>` : ''}
        <button class="btn ghost small" style="color:var(--bad)" onclick="adminDelete('${u.id}')">\u2715 Delete</button>
      </div>
    </div>
    ${lead}
    <label>Delegated agents</label>
    <div>${agentChecks}</div>
    <label>Delegated phone numbers</label>
    <div>${numberChecks}</div>
    <label>Monthly minute limit <span class="muted">(0 = unlimited)</span></label>
    <input type="number" id="cap-${u.id}" value="${u.minuteCap}" min="0" style="max-width:160px" />
  </div>`;
}

async function adminSave(userId, status) {
  const agentIds = [...document.querySelectorAll('.ag-' + userId + ':checked')].map((c) => Number(c.value));
  const numberIds = [...document.querySelectorAll('.num-' + userId + ':checked')].map((c) => Number(c.value));
  const minuteCap = Number($('cap-' + userId).value) || 0;
  try {
    await api(`/admin/users/${userId}/update`, { method: 'POST', body: { status, agentIds, numberIds, minuteCap } });
    toast(status === 'rejected' ? 'Access revoked' : 'Saved');
    loadAdmin();
  } catch (e) { toast('Save failed: ' + e.message, 5000); }
}

async function adminDelete(userId) {
  if (!confirm('Delete this organization\'s account? They will no longer be able to sign in.')) return;
  try {
    await api('/admin/users/' + userId, { method: 'DELETE' });
    toast('Account deleted');
    loadAdmin();
  } catch (e) { toast('Delete failed: ' + e.message, 5000); }
}

function toast(msg, ms = 2600) {
  $('toast').textContent = msg;
  $('toast').classList.remove('hidden');
  setTimeout(() => $('toast').classList.add('hidden'), ms);
}

/* ---------- Agents & numbers ---------- */
async function loadAgents() {
  try {
    const data = await api('/agents?pageno=1&pagesize=150');
    agents = data.bots || [];
    const saved = localStorage.getItem('mnb_agent');
    const opts = agents.map((a) => `<option value="${a.id}">${show(a.name)}</option>`).join('');
    $('globalAgent').innerHTML = opts;
    $('callAgent').innerHTML = opts;
    if (saved && agents.some((a) => String(a.id) === saved)) {
      $('globalAgent').value = saved;
      $('callAgent').value = saved;
    }
    $('globalAgent').onchange = () => {
      localStorage.setItem('mnb_agent', $('globalAgent').value);
      $('callAgent').value = $('globalAgent').value;
      const active = document.querySelector('.nav-item.active')?.dataset.view;
      if (active === 'studio') loadStudio();
    };
    $('statAgents').textContent = data.total_records ?? agents.length;
  } catch (e) {
    toast('Could not load agents: ' + e.message, 5000);
  }
}

const activeAgentId = () => Number($('globalAgent').value || $('callAgent').value);

async function loadNumbers() {
  try {
    const data = await api('/numbers');
    numbers = data.phone_numbers || data.numbers || (Array.isArray(data) ? data : []) || [];
    if (numbers.length) {
      const opts = numbers.map((n) => `<option value="${n.id}">${show(n.phone_number || n.number || n.friendly_name || ('Number #' + n.id))}</option>`).join('');
      $('callFrom').innerHTML = '<option value="">Platform default number</option>' + opts;
      $('cpFrom').innerHTML = opts;
    }
  } catch { /* numbers are optional */ }
}

/* ---------- New agent modal ---------- */
function openAgentModal() { $('agentModal').classList.remove('hidden'); }
function closeAgentModal() { $('agentModal').classList.add('hidden'); }

async function createAgent() {
  const name = $('naName').value.trim();
  const welcome = $('naWelcome').value.trim();
  const purpose = $('naPurpose').value.trim();
  const el = $('naStatus');
  if (!name || !welcome || !purpose) return toast('Fill in all three fields');
  $('naCreateBtn').disabled = true;
  try {
    const r = await api('/agents', {
      method: 'POST',
      body: { name, welcome_message: welcome, context_breakdown: [{ title: 'Purpose', body: purpose }] },
    });
    el.className = 'result ok';
    el.textContent = `\u2705 Agent "${name}" created.`;
    el.classList.remove('hidden');
    toast('Agent created');
    await loadAgents();
    if (r.id) {
      $('globalAgent').value = r.id;
      localStorage.setItem('mnb_agent', String(r.id));
    }
    setTimeout(() => { closeAgentModal(); switchView('studio'); }, 800);
  } catch (e) {
    el.className = 'result err';
    el.textContent = '\u274C ' + scrub(e.message);
    el.classList.remove('hidden');
  } finally {
    $('naCreateBtn').disabled = false;
  }
}

async function deleteAgent() {
  const id = activeAgentId();
  const name = agents.find((a) => a.id === id)?.name || 'this agent';
  if (!confirm(`Delete "${scrub(name)}" permanently? Its call history stays, but the agent and its training are removed.`)) return;
  try {
    await api('/agents/' + id, { method: 'DELETE' });
    toast('Agent deleted');
    await loadAgents();
    loadStudio();
  } catch (e) {
    toast('Delete failed: ' + scrub(e.message), 5000);
  }
}

/* ---------- Overview ---------- */
async function loadOverview() {
  try {
    const data = await api('/calls/logs?pageno=1&pagesize=150');
    const logs = data.call_log_data || [];
    const total = data.total_records ?? logs.length;
    const completed = logs.filter((l) => l.call_status === 'completed').length;
    const failed = logs.filter((l) => ['failed', 'no-answer', 'busy'].includes(l.call_status)).length;
    const durs = logs.map((l) => parseDur(l.call_duration)).filter((d) => d > 0);
    const avg = durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
    const sentiments = logs.map((l) => (l.sentiment_score || '').toLowerCase()).filter(Boolean);
    const pos = sentiments.filter((s) => s.includes('positive')).length;

    $('statTotal').textContent = total;
    $('statCompleted').textContent = completed;
    $('statFailed').textContent = failed;
    $('statAvgDur').textContent = fmtDur(avg);
    $('statSentiment').textContent = sentiments.length ? Math.round((pos / sentiments.length) * 100) + '%' : '\u2013';

    drawCharts(logs);

    const rows = logs.slice(0, 8).map((l) => logRow(l)).join('');
    $('recentCalls').innerHTML = logs.length
      ? `<table><thead><tr><th>When</th><th>Agent</th><th>To</th><th>Duration</th><th>Outcome</th><th>Sentiment</th></tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="muted">No calls yet. Place your first call from the "Place a Call" tab.</p>';
    attachRowClicks($('recentCalls'), logs.slice(0, 8));
  } catch (e) {
    toast('Could not load overview: ' + e.message, 5000);
  }
}

function parseDur(d) {
  if (!d || typeof d !== 'string') return 0;
  const parts = d.split(':').map((x) => parseInt(x, 10) || 0);
  return parts.length === 2 ? parts[0] * 60 + parts[1] : parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
}
const fmtDur = (s) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

function countBy(arr, fn) {
  const m = {};
  arr.forEach((x) => { const k = fn(x) || 'unknown'; m[k] = (m[k] || 0) + 1; });
  return m;
}

function drawCharts(logs) {
  lastChartLogs = logs;
  const light = (document.documentElement.dataset.theme === 'light');
  const palette = ['#ff7a18', '#43b97f', '#e05d55', '#ffb347', '#8a8a8a', '#c96a1e'];
  Chart.defaults.color = light ? '#7c786f' : '#97938c';
  Chart.defaults.borderColor = light ? '#e0ddd6' : '#2b2b2f';

  const byDay = countBy(logs, (l) => (l.time_of_call || '').split(' ')[0]);
  const days = Object.keys(byDay).sort((a, b) => new Date(a) - new Date(b)).slice(-14);
  mkChart('chartVolume', 'bar', days, days.map((d) => byDay[d]), palette[0]);

  const st = countBy(logs, (l) => l.call_status);
  mkPie('chartStatus', Object.keys(st), Object.values(st), palette);

  const se = countBy(logs.filter((l) => l.sentiment_score), (l) => l.sentiment_score);
  mkPie('chartSentiment', Object.keys(se).map(scrub), Object.values(se), ['#3fb97f', '#8b93a7', '#e5645f', '#e0a83f']);

  const ch = countBy(logs, (l) => l.channel_type || l.call_direction);
  mkPie('chartChannel', Object.keys(ch).map(scrub), Object.values(ch), palette.slice(2));
}

function mkChart(id, type, labels, values, color) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), {
    type,
    data: { labels, datasets: [{ data: values, backgroundColor: color, borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}
function mkPie(id, labels, values, colors) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), {
    type: 'doughnut',
    data: { labels, datasets: [{ data: values, backgroundColor: colors, borderWidth: 0 }] },
    options: { plugins: { legend: { position: 'bottom' } }, cutout: '62%' },
  });
}

/* ---------- Place a Call ---------- */
function addContextRow(k = '', v = '') {
  const row = document.createElement('div');
  row.className = 'ctx-row';
  row.innerHTML = `<input placeholder="Field (e.g. customer_name)" value="${esc(k)}" />
    <input placeholder="Value" value="${esc(v)}" />
    <button class="btn ghost small" onclick="this.parentElement.remove()">\u2715</button>`;
  $('contextRows').appendChild(row);
}

async function dispatchCall() {
  const to = $('callNumber').value.trim();
  const agentId = Number($('callAgent').value);
  if (!/^\+\d{7,15}$/.test(to)) return toast('Enter a valid number with country code, e.g. +919876543210', 4000);
  const ctx = {};
  document.querySelectorAll('.ctx-row').forEach((r) => {
    const [k, v] = r.querySelectorAll('input');
    if (k.value.trim()) ctx[k.value.trim()] = v.value;
  });
  const body = { agent_id: agentId, to_number: to };
  if ($('callFrom').value) body.from_number_id = Number($('callFrom').value);
  if (Object.keys(ctx).length) body.call_context = ctx;

  $('dispatchBtn').disabled = true;
  $('dispatchBtn').textContent = 'Dialing\u2026';
  try {
    const r = await api('/calls/dispatch', { method: 'POST', body });
    const el = $('dispatchResult');
    el.className = 'result ok';
    el.innerHTML = `\u2705 Call dispatched to <b>${esc(to)}</b> \u2014 status: <b>${show(r.status || 'queued')}</b>${r.requestId ? ` (ref #${r.requestId})` : ''}. The transcript will appear under Call Logs once the call ends.`;
    el.classList.remove('hidden');
    const agentName = agents.find((a) => a.id === agentId)?.name || 'Agent';
    const h = $('dispatchHistory');
    if (h.querySelector('p')) h.innerHTML = '';
    h.insertAdjacentHTML('afterbegin',
      `<div class="item"><b>${esc(to)}</b> \u00B7 ${show(agentName)} \u00B7 ${new Date().toLocaleTimeString()} \u00B7 <span class="badge completed">dispatched</span></div>`);
    toast('Call placed \u2706');
  } catch (e) {
    const el = $('dispatchResult');
    el.className = 'result err';
    el.textContent = '\u274C ' + scrub(e.message);
    el.classList.remove('hidden');
  } finally {
    $('dispatchBtn').disabled = false;
    $('dispatchBtn').textContent = '\u2706 Place call';
  }
}

/* ---------- Agent Studio ---------- */
let studioAgent = null;
let llmsLoaded = false;

async function loadStudio() {
  const id = activeAgentId();
  if (!id) return;
  try {
    studioAgent = await api('/agents/' + id);
    $('agName').value = scrub(studioAgent.name || '');
    $('agWelcome').value = scrub(studioAgent.welcome_message || studioAgent.welcome_msg || '');
    $('agVoice').value = scrub([studioAgent.voice_name, studioAgent.voice_provider, studioAgent.llm_service].filter(Boolean).join(' \u00B7 '));
    $('agVoiceProvider').value = '';
    $('agVoiceId').innerHTML = '<option value="">Pick a provider first</option>';
    $('agVoiceId').disabled = true;
    $('agModel').value = '';
    $('agSpeed').value = '';
    const sections = studioAgent.context_breakdown || [];
    $('sections').innerHTML = '';
    sections.forEach((s) => addSection(s.context_title ?? s.title ?? '', s.context_body ?? s.body ?? ''));
    if (!sections.length) addSection();
    loadLlms();
  } catch (e) {
    toast('Could not load agent: ' + e.message, 5000);
  }
}

async function loadLlms() {
  if (llmsLoaded) return;
  try {
    const data = await api('/llms');
    const models = data.llms || data.models || data.providers || (Array.isArray(data) ? data : []);
    const names = models.map((m) => (typeof m === 'string' ? m : m.name || m.model || m.id)).filter(Boolean);
    if (names.length) {
      $('agModel').innerHTML = '<option value="">Keep current model</option>' +
        names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
      llmsLoaded = true;
    }
  } catch { /* optional */ }
}

async function loadVoiceOptions() {
  const provider = $('agVoiceProvider').value;
  const sel = $('agVoiceId');
  if (!provider) { sel.innerHTML = '<option value="">Pick a provider first</option>'; sel.disabled = true; return; }
  sel.disabled = false;
  sel.innerHTML = '<option value="">Loading voices\u2026</option>';
  try {
    const data = await api('/voices?provider=' + encodeURIComponent(provider) + '&page=1&page_size=100');
    const voices = data.voices || [];
    sel.innerHTML = voices.length
      ? voices.map((v) => {
          const vid = v.name || v.voice_id || v.external_id || v.id;
          const label = [v.display_name || v.voice_name || v.name, v.gender, v.accent || v.language].filter(Boolean).join(' \u00B7 ');
          return `<option value="${esc(vid)}">${show(label || vid)}</option>`;
        }).join('')
      : '<option value="">No voices found for this provider</option>';
  } catch (e) {
    sel.innerHTML = '<option value="">Could not load voices</option>';
  }
}

function addSection(title = '', body = '') {
  const div = document.createElement('div');
  div.className = 'section-block';
  div.innerHTML = `
    <div class="section-head">
      <input class="sec-title" placeholder="Section title (e.g. Greeting & Introduction)" value="${esc(scrub(title))}" />
      <button class="btn ghost small" onclick="this.closest('.section-block').remove()">\u2715 Remove</button>
    </div>
    <textarea class="sec-body" rows="5" placeholder="Instructions for this part of the conversation\u2026">${esc(scrub(body))}</textarea>`;
  $('sections').appendChild(div);
}

async function saveAgent() {
  const id = activeAgentId();
  if (!id) return;
  const context_breakdown = [...document.querySelectorAll('.section-block')]
    .map((b) => ({ title: b.querySelector('.sec-title').value.trim(), body: b.querySelector('.sec-body').value.trim() }))
    .filter((s) => s.title || s.body);
  const body = {
    name: $('agName').value.trim(),
    welcome_message: $('agWelcome').value.trim(),
    context_breakdown,
  };
  if ($('agVoiceProvider').value && $('agVoiceId').value) {
    body.voice = { provider: $('agVoiceProvider').value, voice_id: $('agVoiceId').value };
    if ($('agSpeed').value) body.voice.speech_speed = Number($('agSpeed').value);
  } else if ($('agSpeed').value) {
    body.voice = { speech_speed: Number($('agSpeed').value) };
  }
  if ($('agModel').value) body.model = { model: $('agModel').value };
  $('saveAgentBtn').disabled = true;
  try {
    await api('/agents/' + id, { method: 'PUT', body });
    const el = $('studioStatus');
    el.className = 'result ok';
    el.textContent = '\u2705 Agent updated. New calls will use this training immediately.';
    el.classList.remove('hidden');
    toast('Agent saved');
    loadAgents();
  } catch (e) {
    const el = $('studioStatus');
    el.className = 'result err';
    el.textContent = '\u274C ' + scrub(e.message);
    el.classList.remove('hidden');
  } finally {
    $('saveAgentBtn').disabled = false;
  }
}

/* ---------- Call Logs ---------- */
let logsCache = [];

function logRow(l) {
  return `<tr class="clickable" data-id="${l.id}">
    <td>${esc(l.time_of_call || '')}</td>
    <td>${show(l.bot_name || '')}</td>
    <td>${esc(l.to_number || '')}</td>
    <td>${esc(l.call_duration || '')}</td>
    <td><span class="badge ${esc(l.call_status || 'neutral')}">${esc(l.call_status || '\u2014')}</span></td>
    <td>${show(l.sentiment_score || '\u2014')}</td>
  </tr>`;
}

function attachRowClicks(container, logs) {
  container.querySelectorAll('tr.clickable').forEach((tr) => {
    tr.onclick = () => {
      const log = logs.find((l) => String(l.id) === tr.dataset.id);
      if (log) openDrawer(log);
    };
  });
}

async function loadLogs(page = 1) {
  if (page < 1) return;
  logsPage = page;
  try {
    const q = new URLSearchParams({ pageno: page, pagesize: 20 });
    if ($('logStatus').value) q.set('call_status', $('logStatus').value);
    const data = await api('/calls/logs?' + q);
    logsCache = data.call_log_data || [];
    const total = data.total_records ?? logsCache.length;
    $('logsTable').innerHTML = logsCache.length
      ? `<table><thead><tr><th>When</th><th>Agent</th><th>To</th><th>Duration</th><th>Outcome</th><th>Sentiment</th></tr></thead><tbody>${logsCache.map(logRow).join('')}</tbody></table>`
      : '<p class="muted">No calls found.</p>';
    $('logsPageInfo').textContent = `Page ${page} \u00B7 ${total} calls`;
    attachRowClicks($('logsTable'), logsCache);
  } catch (e) {
    toast('Could not load logs: ' + e.message, 5000);
  }
}

/* ---------- Call detail drawer ---------- */
function openDrawer(log) {
  $('drawerTitle').textContent = `Call #${log.id}`;
  let recUrl = '';
  const raw = String(log.recording_url || '');
  if (raw.startsWith('http')) recUrl = raw;
  else if (raw.startsWith('/api/v1/recording/')) recUrl = raw.replace('/api/v1/recording/', '/api/recording/');
  const rec = recUrl
    ? `<audio controls src="${esc(recUrl)}" style="width:100%"></audio>` : '<span class="muted">No recording</span>';
  const transcript = parseTranscript(log.call_conversation);
  $('drawerBody').innerHTML = `
    <dl class="kv">
      <dt>Time</dt><dd>${esc(log.time_of_call || '\u2014')}</dd>
      <dt>Agent</dt><dd>${show(log.bot_name || '\u2014')}</dd>
      <dt>Direction</dt><dd>${esc(log.call_direction || '\u2014')}</dd>
      <dt>From \u2192 To</dt><dd>${esc(log.from_number || '\u2014')} \u2192 ${esc(log.to_number || '\u2014')}</dd>
      <dt>Duration</dt><dd>${esc(log.call_duration || '\u2014')}</dd>
      <dt>Outcome</dt><dd><span class="badge ${esc(log.call_status || 'neutral')}">${esc(log.call_status || '\u2014')}</span></dd>
      <dt>Sentiment</dt><dd>${show(log.sentiment_score || '\u2014')}</dd>
      <dt>Recording</dt><dd>${rec}</dd>
    </dl>
    ${log.sentiment_analysis_details ? `<div class="card" style="margin:10px 0"><h3>Summary</h3><p>${show(log.sentiment_analysis_details)}</p></div>` : ''}
    <h3>Transcript</h3>
    <div class="transcript">${transcript || '<p class="muted">No transcript available.</p>'}</div>`;
  $('drawer').classList.remove('hidden');
}

function parseTranscript(conv) {
  if (!conv || typeof conv !== 'string') return '';
  return conv
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = /^(user|llm|agent|assistant)\s*:\s*(.*)$/i.exec(line);
      if (!m) return `<div class="msg user">${show(line)}</div>`;
      if (!m[2]) return '';
      const isAgent = /llm|agent|assistant/i.test(m[1]);
      return `<div class="msg ${isAgent ? 'agent' : 'user'}"><div class="who">${isAgent ? 'Agent' : 'Caller'}</div>${show(m[2])}</div>`;
    })
    .join('');
}

function closeDrawer() { $('drawer').classList.add('hidden'); }
$('drawer').addEventListener('click', (e) => { if (e.target === $('drawer')) closeDrawer(); });

/* ---------- Knowledge Base ---------- */
let kbFiles = [];

async function loadKnowledge() {
  try {
    const data = await api('/knowledge');
    kbFiles = data.files || [];
    $('kbTable').innerHTML = kbFiles.length
      ? `<table><thead><tr><th></th><th>File</th><th>Size</th><th>Uploaded</th><th>Status</th><th></th></tr></thead><tbody>
        ${kbFiles.map((f) => `<tr>
          <td><input type="checkbox" class="kb-check" value="${f.id}" style="width:auto" /></td>
          <td>${show(f.name || f.original_filename)}</td>
          <td>${(f.file_size / 1024 / 1024).toFixed(2)} MB</td>
          <td>${esc(f.upload_date || '')}</td>
          <td><span class="badge completed">${esc(f.upload_status || 'ready')}</span></td>
          <td><button class="btn ghost small" onclick="deleteKb(${f.id})">Delete</button></td>
        </tr>`).join('')}</tbody></table>`
      : '<p class="muted">No documents yet. Upload a PDF to train the agent on your material.</p>';
  } catch (e) {
    toast('Could not load knowledge base: ' + e.message, 5000);
  }
}

function selectedKbIds() {
  return [...document.querySelectorAll('.kb-check:checked')].map((c) => Number(c.value));
}

async function uploadKb() {
  const file = $('kbFile').files[0];
  const el = $('kbUploadStatus');
  if (!file) return toast('Choose a file first');
  const isPdf = /\.pdf$/i.test(file.name);
  const isText = /\.(txt|md|markdown|text)$/i.test(file.name);
  if (!isPdf && !isText) return toast('Supported: .pdf, .txt, .md', 4000);
  el.className = 'result';
  el.textContent = isPdf ? 'Uploading\u2026' : 'Converting to PDF and uploading\u2026';
  el.classList.remove('hidden');
  try {
    if (isPdf) {
      const b64 = await new Promise((ok, bad) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1]);
        r.onerror = bad;
        r.readAsDataURL(file);
      });
      await api('/knowledge/upload', { method: 'POST', body: { file: b64, filename: file.name } });
    } else {
      const text = await file.text();
      await api('/knowledge/upload-text', { method: 'POST', body: { title: file.name, text } });
    }
    el.className = 'result ok';
    el.textContent = `\u2705 ${file.name} added as a source.`;
    $('kbFile').value = '';
    loadKnowledge();
  } catch (e) {
    el.className = 'result err';
    el.textContent = '\u274C ' + scrub(e.message);
  }
}

async function uploadKbText() {
  const el = $('kbUploadStatus');
  const title = $('kbTextTitle').value.trim();
  const text = $('kbText').value.trim();
  if (!text) return toast('Paste some text first');
  el.className = 'result';
  el.textContent = 'Converting to PDF and uploading\u2026';
  el.classList.remove('hidden');
  try {
    await api('/knowledge/upload-text', { method: 'POST', body: { title: title || 'Pasted text', text } });
    el.className = 'result ok';
    el.textContent = `\u2705 "${title || 'Pasted text'}" added as a source.`;
    $('kbTextTitle').value = '';
    $('kbText').value = '';
    loadKnowledge();
  } catch (e) {
    el.className = 'result err';
    el.textContent = '\u274C ' + scrub(e.message);
  }
}

async function uploadKbUrl() {
  const el = $('kbUploadStatus');
  const url = $('kbUrl').value.trim();
  if (!url) return toast('Enter a web page URL first');
  el.className = 'result';
  el.textContent = 'Fetching page, converting to PDF\u2026';
  el.classList.remove('hidden');
  try {
    await api('/knowledge/upload-url', { method: 'POST', body: { url } });
    el.className = 'result ok';
    el.textContent = `\u2705 Page imported as a source.`;
    $('kbUrl').value = '';
    loadKnowledge();
  } catch (e) {
    el.className = 'result err';
    el.textContent = '\u274C ' + scrub(e.message);
  }
}

async function attachKb() {
  const ids = selectedKbIds();
  const el = $('kbAttachStatus');
  if (!ids.length) return toast('Select at least one document below');
  try {
    const body = { file_ids: ids, agent_id: activeAgentId() };
    if ($('kbWhen').value.trim()) body.when_to_use = $('kbWhen').value.trim();
    const r = await api('/knowledge/attach', { method: 'POST', body });
    el.className = 'result ok';
    el.textContent = '\u2705 ' + scrub(r.message || 'Attached to agent.');
    el.classList.remove('hidden');
  } catch (e) {
    el.className = 'result err';
    el.textContent = '\u274C ' + scrub(e.message);
    el.classList.remove('hidden');
  }
}

async function detachKb() {
  const ids = selectedKbIds();
  const el = $('kbAttachStatus');
  if (!ids.length) return toast('Select at least one document below');
  try {
    const r = await api('/knowledge/detach', { method: 'POST', body: { file_ids: ids, agent_id: activeAgentId() } });
    el.className = 'result ok';
    el.textContent = '\u2705 ' + scrub(r.message || 'Detached from agent.');
    el.classList.remove('hidden');
  } catch (e) {
    el.className = 'result err';
    el.textContent = '\u274C ' + scrub(e.message);
    el.classList.remove('hidden');
  }
}

async function deleteKb(id) {
  if (!confirm('Delete this document permanently?')) return;
  try {
    await api('/knowledge/delete', { method: 'POST', body: { file_id: id } });
    toast('Document deleted');
    loadKnowledge();
  } catch (e) {
    toast('Delete failed: ' + e.message, 5000);
  }
}

/* ---------- Campaigns ---------- */
async function loadCampaigns() {
  loadNumbers();
  try {
    const data = await api('/campaigns');
    const list = data.bulk_calls || data.campaigns || (Array.isArray(data) ? data : []);
    $('campaignsTable').innerHTML = list.length
      ? `<table><thead><tr><th>ID</th><th>Name</th><th>Agent</th><th>Status</th><th>Contacts</th><th>Created</th><th>Actions</th></tr></thead><tbody>
        ${list.map((c) => `<tr>
          <td>${esc(c.id)}</td>
          <td>${show(c.name || c.campaign_name || '\u2014')}</td>
          <td>${show(c.bot_name || c.agent_name || '\u2014')}</td>
          <td><span class="badge neutral">${esc(c.status || '\u2014')}</span></td>
          <td>${esc(c.total_contacts ?? c.contacts_count ?? '\u2014')}</td>
          <td>${esc(c.created_at || c.created_date || '\u2014')}</td>
          <td>
            <button class="btn ghost small" onclick="campaignAction(${c.id}, 'pause')">Pause</button>
            <button class="btn ghost small" onclick="campaignAction(${c.id}, 'resume')">Resume</button>
            <button class="btn ghost small" style="color:var(--bad)" onclick="cancelCampaign(${c.id})">Cancel</button>
          </td>
        </tr>`).join('')}</tbody></table>`
      : '<p class="muted">No bulk-call campaigns yet.</p>';
  } catch (e) {
    $('campaignsTable').innerHTML = '<p class="muted">Could not load campaigns: ' + esc(scrub(e.message)) + '</p>';
  }
}

async function createCampaign() {
  const el = $('cpStatus');
  const name = $('cpName').value.trim();
  const fromId = $('cpFrom').value;
  if (!name) return toast('Give the campaign a name');
  if (!fromId) return toast('A phone number on the account is required for campaigns \u2014 see the Phone Numbers tab', 6000);
  const contacts = $('cpContacts').value.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const [num, ...rest] = line.split(',').map((x) => x.trim());
    const c = { phone_number: num };
    if (rest.length && rest[0]) c.customer_name = rest.join(', ');
    return c;
  });
  if (!contacts.length) return toast('Add at least one contact');
  const bad = contacts.find((c) => !/^\+\d{7,15}$/.test(c.phone_number));
  if (bad) return toast(`Invalid number: ${bad.phone_number} (use +countrycode format)`, 5000);
  el.className = 'result';
  el.textContent = 'Launching campaign\u2026';
  el.classList.remove('hidden');
  try {
    await api('/campaigns', { method: 'POST', body: { name, phone_number_id: String(fromId), contact_list: contacts } });
    el.className = 'result ok';
    el.textContent = `\u2705 Campaign "${name}" launched with ${contacts.length} contact(s).`;
    $('cpName').value = ''; $('cpContacts').value = '';
    loadCampaigns();
  } catch (e) {
    el.className = 'result err';
    el.textContent = '\u274C ' + scrub(e.message);
  }
}

async function campaignAction(id, action) {
  try {
    await api('/campaigns/' + id, { method: 'PUT', body: { action } });
    toast(`Campaign ${action}d`);
    loadCampaigns();
  } catch (e) {
    toast(`${action} failed: ` + scrub(e.message), 5000);
  }
}

async function cancelCampaign(id) {
  if (!confirm('Cancel this campaign? Remaining contacts will not be called.')) return;
  try {
    await api('/campaigns/' + id, { method: 'DELETE' });
    toast('Campaign cancelled');
    loadCampaigns();
  } catch (e) {
    toast('Cancel failed: ' + scrub(e.message), 5000);
  }
}

/* ---------- Phone Numbers view ---------- */
async function loadNumbersView() {
  try {
    const data = await api('/numbers');
    const list = data.phone_numbers || data.numbers || (Array.isArray(data) ? data : []);
    const agentOpts = agents.map((a) => `<option value="${a.id}">${show(a.name)}</option>`).join('');
    $('numbersTable').innerHTML = list.length
      ? `<table><thead><tr><th>Number</th><th>Attached agent</th><th>Actions</th></tr></thead><tbody>
        ${list.map((n) => `<tr>
          <td><b>${show(n.phone_number || n.number || '\u2014')}</b></td>
          <td>${show(n.bot_name || n.agent_name || (n.attached_agent_id ? 'Agent #' + n.attached_agent_id : 'Not attached'))}</td>
          <td>
            <select id="numAg${n.id}" style="width:auto;display:inline-block;margin-right:8px">${agentOpts}</select>
            <button class="btn ghost small" onclick="attachNumber(${n.id})">Attach</button>
            <button class="btn ghost small" onclick="detachNumber(${n.id})">Detach</button>
          </td>
        </tr>`).join('')}</tbody></table>`
      : `<p class="muted">No phone numbers on this account yet. Single outbound calls still work using the platform's default number. To get a dedicated number for inbound calls and campaigns, one can be purchased in the account's Numbers Shop \u2014 ask your platform admin (that's you, MNB Research).</p>`;
  } catch (e) {
    $('numbersTable').innerHTML = '<p class="muted">Could not load numbers: ' + esc(scrub(e.message)) + '</p>';
  }
}

async function attachNumber(numberId) {
  const agentId = Number($('numAg' + numberId).value);
  try {
    await api('/numbers/attach', { method: 'POST', body: { phone_number_id: numberId, agent_id: agentId } });
    toast('Number attached');
    loadNumbersView();
  } catch (e) {
    toast('Attach failed: ' + scrub(e.message), 5000);
  }
}

async function detachNumber(numberId) {
  try {
    await api('/numbers/detach', { method: 'POST', body: { phone_number_id: numberId } });
    toast('Number detached');
    loadNumbersView();
  } catch (e) {
    toast('Detach failed: ' + scrub(e.message), 5000);
  }
}

/* ===== Dashboard UX enhancements: command palette, quick actions, logs search, mobile nav ===== */
(function () {
  if (window.__mnbEnhanced) return; window.__mnbEnhanced = true;

  var css = ''
    + '.qa-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:18px}'
    + '@media(max-width:1000px){.qa-grid{grid-template-columns:repeat(2,1fr)}}'
    + '.qa-card{display:flex;gap:12px;align-items:center;text-align:left;cursor:pointer;background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;transition:.15s;color:var(--text);font:inherit}'
    + '.qa-card:hover{border-color:var(--accent);transform:translateY(-2px)}'
    + '.qa-ic{width:38px;height:38px;flex-shrink:0;border-radius:10px;background:var(--accent-grad);color:#111;display:flex;align-items:center;justify-content:center;font-size:19px;font-weight:800}'
    + '.qa-t{font-weight:700;font-size:.95em}.qa-s{color:var(--muted);font-size:.8em}'
    + '.logs-search{max-width:280px}'
    + '.cmdk-back{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:200;display:none;align-items:flex-start;justify-content:center}'
    + '.cmdk-back.on{display:flex}'
    + '.cmdk{margin-top:12vh;width:560px;max-width:92vw;background:var(--panel);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.5)}'
    + '.cmdk input{width:100%;border:none;border-bottom:1px solid var(--border);background:transparent;color:var(--text);font-size:1.05em;padding:16px 18px;outline:none;margin:0;border-radius:0}'
    + '.cmdk-list{max-height:340px;overflow-y:auto;padding:6px}'
    + '.cmdk-item{display:flex;gap:12px;align-items:center;padding:11px 14px;border-radius:8px;cursor:pointer;color:var(--text)}'
    + '.cmdk-item .ic{width:26px;text-align:center;color:var(--accent)}'
    + '.cmdk-item small{color:var(--muted);margin-left:auto;font-size:.75em}'
    + '.cmdk-item.sel,.cmdk-item:hover{background:var(--panel-2)}'
    + '.kbd{display:inline-block;border:1px solid var(--border);border-bottom-width:2px;border-radius:5px;padding:1px 6px;font-size:.72em;color:var(--muted);font-family:monospace}'
    + '.mnav{display:none;position:fixed;top:12px;left:12px;z-index:80;width:42px;height:42px;border-radius:10px;background:var(--panel);border:1px solid var(--border);color:var(--text);font-size:20px;cursor:pointer}'
    + '@media(max-width:820px){.mnav{display:block}.sidebar{position:fixed;z-index:70;left:0;top:0;transform:translateX(-100%);transition:.25s;box-shadow:0 0 40px rgba(0,0,0,.4)}.shell.navopen .sidebar{transform:none}.main{padding-top:64px}}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var VIEWS = [
    { v: 'overview', ic: '&#9703;', t: 'Overview', s: 'Dashboard' },
    { v: 'call', ic: '&#9990;', t: 'Place a Call', s: 'Dispatch' },
    { v: 'studio', ic: '&#9998;', t: 'Agent Studio', s: 'Train agents' },
    { v: 'logs', ic: '&#8801;', t: 'Call Logs', s: 'History' },
    { v: 'knowledge', ic: '&#9636;', t: 'Knowledge Base', s: 'Sources' },
    { v: 'campaigns', ic: '&#8694;', t: 'Campaigns', s: 'Bulk calls' },
    { v: 'numbers', ic: '&#9742;', t: 'Phone Numbers', s: 'Numbers' },
    { v: 'plan', ic: '&#9672;', t: 'Plan & Usage', s: 'Account' }
  ];
  function isAdmin() { try { return !document.getElementById('navAdmin').classList.contains('hidden'); } catch (e) { return false; } }

  function injectQuickActions() {
    var ov = document.getElementById('view-overview');
    if (!ov || ov.querySelector('.qa-grid')) return;
    var acts = [
      { v: 'call', ic: '&#9990;', t: 'Place a call', s: 'Dial a number now' },
      { v: 'studio', ic: '&#9998;', t: 'Train an agent', s: 'Edit voice and script' },
      { v: 'knowledge', ic: '&#9636;', t: 'Add knowledge', s: 'Upload a source' },
      { v: 'campaigns', ic: '&#8694;', t: 'Launch a campaign', s: 'Bulk outbound' }
    ];
    var grid = document.createElement('div'); grid.className = 'qa-grid';
    grid.innerHTML = acts.map(function (a) {
      return '<button class="qa-card" data-v="' + a.v + '"><span class="qa-ic">' + a.ic + '</span><span><span class="qa-t">' + a.t + '</span><br><span class="qa-s">' + a.s + '</span></span></button>';
    }).join('');
    var head = ov.querySelector('.view-head');
    if (head && head.nextSibling) ov.insertBefore(grid, head.nextSibling); else ov.insertBefore(grid, ov.firstChild);
    grid.addEventListener('click', function (e) { var b = e.target.closest('.qa-card'); if (b) switchView(b.dataset.v); });
  }

  function injectLogsSearch() {
    var head = document.querySelector('#view-logs .view-head .filters');
    if (!head || head.querySelector('.logs-search')) return;
    var inp = document.createElement('input'); inp.className = 'logs-search'; inp.type = 'search';
    inp.placeholder = 'Search calls...';
    head.insertBefore(inp, head.firstChild);
    inp.addEventListener('input', function () {
      var q = inp.value.toLowerCase();
      document.querySelectorAll('#logsTable table tbody tr').forEach(function (tr) {
        tr.style.display = tr.textContent.toLowerCase().indexOf(q) > -1 ? '' : 'none';
      });
    });
  }

  var back = document.createElement('div'); back.className = 'cmdk-back';
  back.innerHTML = '<div class="cmdk"><input type="text" placeholder="Jump to a section or action..." /><div class="cmdk-list"></div></div>';
  document.body.appendChild(back);
  var input = back.querySelector('input'), list = back.querySelector('.cmdk-list'), sel = 0, items = [];

  function buildCmds() {
    var vs = VIEWS.slice();
    if (isAdmin()) vs.push({ v: 'admin', ic: '&#9881;', t: 'Admin', s: 'Clients' });
    var cmds = vs.map(function (x) { return { ic: x.ic, t: x.t, s: x.s, run: function () { switchView(x.v); } }; });
    cmds.push({ ic: '&#9681;', t: 'Toggle light / dark theme', s: 'Theme', run: function () { toggleTheme(); } });
    cmds.push({ ic: '&#8617;', t: 'Sign out', s: 'Session', run: function () { doLogout(); } });
    return cmds;
  }
  function render(q) {
    var all = buildCmds().filter(function (c) { return (c.t + ' ' + c.s).toLowerCase().indexOf(q.toLowerCase()) > -1; });
    items = all; if (sel >= all.length) sel = 0;
    list.innerHTML = all.map(function (c, i) {
      return '<div class="cmdk-item' + (i === sel ? ' sel' : '') + '" data-i="' + i + '"><span class="ic">' + c.ic + '</span><span>' + c.t + '</span><small>' + c.s + '</small></div>';
    }).join('') || '<div class="cmdk-item"><span>No matches</span></div>';
  }
  function openK() { back.classList.add('on'); input.value = ''; sel = 0; render(''); setTimeout(function () { input.focus(); }, 20); }
  function closeK() { back.classList.remove('on'); }
  input.addEventListener('input', function () { sel = 0; render(input.value); });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); render(input.value); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(input.value); e.preventDefault(); }
    else if (e.key === 'Enter') { if (items[sel]) { closeK(); items[sel].run(); } }
    else if (e.key === 'Escape') { closeK(); }
  });
  list.addEventListener('click', function (e) { var it = e.target.closest('.cmdk-item'); if (it && it.dataset.i != null) { var c = items[+it.dataset.i]; closeK(); if (c) c.run(); } });
  back.addEventListener('click', function (e) { if (e.target === back) closeK(); });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); back.classList.contains('on') ? closeK() : openK(); }
  });

  var mnav = document.createElement('button'); mnav.className = 'mnav'; mnav.innerHTML = '&#9776;'; mnav.setAttribute('aria-label', 'Menu');
  document.body.appendChild(mnav);
  mnav.addEventListener('click', function () { var sh = document.querySelector('.shell'); if (sh) sh.classList.toggle('navopen'); });
  document.addEventListener('click', function (e) { if (e.target.closest('.nav-item')) { var sh = document.querySelector('.shell'); if (sh) sh.classList.remove('navopen'); } });

  try {
    var foot = document.querySelector('.sidebar-foot');
    if (foot && !foot.querySelector('.cmdk-hint')) {
      var h = document.createElement('div'); h.className = 'foot-note cmdk-hint';
      h.innerHTML = 'Press <span class="kbd">Ctrl</span> <span class="kbd">K</span> to search';
      foot.appendChild(h);
    }
  } catch (e) { }

  function enhance() { injectQuickActions(); injectLogsSearch(); }
  enhance();
  window.addEventListener('load', enhance);
  setTimeout(enhance, 800);
  var _sv = window.switchView;
  if (typeof _sv === 'function' && !_sv.__wrapped) {
    window.switchView = function () { var r = _sv.apply(this, arguments); setTimeout(enhance, 60); return r; };
    window.switchView.__wrapped = true;
  }
})();

/* ===== Dashboard enhancements v2: sortable logs, copy in call drawer, setup checklist ===== */
(function () {
  if (window.__mnbEnhanced2) return; window.__mnbEnhanced2 = true;

  var css = ''
    + '#logsTable table thead th{cursor:pointer;user-select:none;white-space:nowrap}'
    + '#logsTable table thead th .srt{opacity:.4;font-size:.8em;margin-left:4px}'
    + '#logsTable table thead th.act .srt{opacity:1;color:var(--accent)}'
    + '.copy-btn{cursor:pointer;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:6px 12px;font:inherit;font-size:.82em;font-weight:600}'
    + '.copy-btn:hover{border-color:var(--accent);color:var(--accent)}'
    + '.setup-card{background:var(--panel);border:1px solid var(--border);border-radius:var(--radius);padding:18px 20px;margin-bottom:18px}'
    + '.setup-card h3{margin:0 0 4px;font-size:1.02em}'
    + '.setup-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:14px}'
    + '@media(max-width:1000px){.setup-steps{grid-template-columns:repeat(2,1fr)}}'
    + '.setup-step{display:flex;gap:10px;align-items:center;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;cursor:pointer;color:var(--text)}'
    + '.setup-step .tick{width:22px;height:22px;flex-shrink:0;border-radius:50%;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:12px;color:var(--muted)}'
    + '.setup-step.done .tick{background:var(--good);border-color:var(--good);color:#fff}'
    + '.setup-step .lbl{font-size:.88em;font-weight:600}'
    + '.setup-bar{height:6px;border-radius:6px;background:var(--panel-2);overflow:hidden;margin-top:12px}'
    + '.setup-bar > div{height:100%;background:var(--accent-grad)}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var sortState = { col: -1, dir: 1 };
  function makeSortable() {
    var table = document.querySelector('#logsTable table');
    if (!table) return;
    var ths = table.querySelectorAll('thead th');
    if (!ths.length || ths[0].__srt) return;
    ths.forEach(function (th, i) {
      th.__srt = true;
      var s = document.createElement('span'); s.className = 'srt'; s.innerHTML = '&#8645;'; th.appendChild(s);
      th.addEventListener('click', function () { sortLogs(i, table, ths); });
    });
  }
  function cellVal(tr, i) {
    var td = tr.children[i]; if (!td) return '';
    var t = td.textContent.trim();
    var dm = t.match(/^(\d+)m\s*(\d+)s$/); if (dm) return (+dm[1]) * 60 + (+dm[2]);
    var d2 = t.match(/^(\d+):(\d+)$/); if (d2) return (+d2[1]) * 60 + (+d2[2]);
    var n = t.replace(/[%,]/g, ''); if (n !== '' && !isNaN(n)) return parseFloat(n);
    var dt = Date.parse(t); if (!isNaN(dt)) return dt;
    return t.toLowerCase();
  }
  function sortLogs(i, table, ths) {
    var dir = (sortState.col === i) ? -sortState.dir : 1; sortState = { col: i, dir: dir };
    ths.forEach(function (th, j) { th.classList.toggle('act', j === i); var s = th.querySelector('.srt'); if (s) s.innerHTML = j === i ? (dir > 0 ? '&#9650;' : '&#9660;') : '&#8645;'; });
    var tb = table.querySelector('tbody'); if (!tb) return;
    var rows = [].slice.call(tb.querySelectorAll('tr'));
    rows.sort(function (a, b) { var va = cellVal(a, i), vb = cellVal(b, i); if (va < vb) return -1 * dir; if (va > vb) return 1 * dir; return 0; });
    rows.forEach(function (r) { tb.appendChild(r); });
  }
  var logsWrap = document.getElementById('logsTable');
  if (logsWrap) { new MutationObserver(function () { makeSortable(); }).observe(logsWrap, { childList: true, subtree: true }); }
  makeSortable();

  function addCopy() {
    var body = document.getElementById('drawerBody');
    if (!body || body.querySelector('.copy-btn') || !body.textContent.trim()) return;
    var btn = document.createElement('button'); btn.className = 'copy-btn'; btn.textContent = 'Copy details';
    btn.style.marginBottom = '12px';
    btn.addEventListener('click', function () {
      var txt = body.innerText || body.textContent;
      (navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(txt) : Promise.reject())
        .then(function () { btn.textContent = 'Copied!'; setTimeout(function () { btn.textContent = 'Copy details'; }, 1500); if (window.toast) toast('Call details copied'); })
        .catch(function () { if (window.toast) toast('Copy not available in this browser'); });
    });
    body.insertBefore(btn, body.firstChild);
  }
  var drawer = document.getElementById('drawer');
  if (drawer) { new MutationObserver(function () { if (!drawer.classList.contains('hidden')) setTimeout(addCopy, 120); }).observe(drawer, { attributes: true, attributeFilter: ['class'] }); }

  async function buildSetup() {
    try {
      var ov = document.getElementById('view-overview');
      if (!ov || document.getElementById('setupCard')) return;
      var me = await fetch('/api/me', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return {}; });
      var u = me.user || {};
      if (u.role === 'admin') return;
      var dismissed = false; try { dismissed = localStorage.getItem('mnb_setup_hide') === '1'; } catch (e) { }
      if (dismissed) return;
      var agents = 0, numbers = 0, kb = 0, calls = 0;
      try { var a = await fetch('/api/agents').then(function (r) { return r.json(); }); agents = (a.bots || []).length; } catch (e) { }
      try { var n = await fetch('/api/numbers').then(function (r) { return r.json(); }); numbers = (n.phone_numbers || []).length; } catch (e) { }
      try { var k = await fetch('/api/knowledge').then(function (r) { return r.json(); }); kb = (k.files || []).length; } catch (e) { }
      try { var l = await fetch('/api/calls/logs?pageno=1&pagesize=1').then(function (r) { return r.json(); }); calls = (l.total_records != null ? l.total_records : (l.call_log_data || []).length); } catch (e) { }
      var steps = [
        { done: agents > 0, lbl: 'Train an agent', v: 'studio' },
        { done: kb > 0, lbl: 'Add knowledge', v: 'knowledge' },
        { done: numbers > 0, lbl: 'Add a number', v: 'numbers' },
        { done: calls > 0, lbl: 'Place a call', v: 'call' }
      ];
      var doneCount = steps.filter(function (s) { return s.done; }).length;
      if (doneCount === steps.length) return;
      var card = document.createElement('div'); card.className = 'setup-card'; card.id = 'setupCard';
      card.innerHTML = '<div class="row-between"><div><h3>Get started with MNB Omni Caller</h3><div class="muted" style="font-size:.86em">Finish setup to start running live calls under your brand.</div></div>'
        + '<button class="btn ghost small" id="setupHide">Dismiss</button></div>'
        + '<div class="setup-bar"><div style="width:' + Math.round(doneCount / steps.length * 100) + '%"></div></div>'
        + '<div class="setup-steps">' + steps.map(function (s) { return '<div class="setup-step' + (s.done ? ' done' : '') + '" data-v="' + s.v + '"><span class="tick">' + (s.done ? '&#10003;' : '') + '</span><span class="lbl">' + s.lbl + '</span></div>'; }).join('') + '</div>';
      var qa = ov.querySelector('.qa-grid');
      if (qa && qa.nextSibling) ov.insertBefore(card, qa.nextSibling);
      else { var head = ov.querySelector('.view-head'); if (head && head.nextSibling) ov.insertBefore(card, head.nextSibling); else ov.insertBefore(card, ov.firstChild); }
      card.addEventListener('click', function (e) {
        if (e.target.id === 'setupHide') { try { localStorage.setItem('mnb_setup_hide', '1'); } catch (x) { } card.remove(); return; }
        var s = e.target.closest('.setup-step'); if (s) switchView(s.dataset.v);
      });
    } catch (e) { }
  }
  buildSetup();
})();

/* ===== Dashboard enhancements v3: log filter chips, density toggle, studio test-call ===== */
(function () {
  if (window.__mnbEnhanced3) return; window.__mnbEnhanced3 = true;

  var css = ''
    + '.log-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}'
    + '.log-chip{cursor:pointer;background:var(--panel);border:1px solid var(--border);color:var(--muted);border-radius:20px;padding:5px 14px;font:inherit;font-size:.85em;font-weight:600}'
    + '.log-chip:hover{border-color:var(--accent);color:var(--text)}'
    + '.log-chip.on{background:var(--accent-grad);border-color:transparent;color:#111}'
    + '.compact .main{padding:16px 22px}'
    + '.compact .card{padding:14px 16px;margin-bottom:14px}'
    + '.compact .stat-card{padding:12px}'
    + '.compact .stat-value{font-size:1.35em}'
    + '.compact table th,.compact table td{padding:7px 10px}'
    + '.compact .view-head{margin-bottom:12px}'
    + '.compact .qa-card{padding:10px 12px}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var weekOn = false;
  function applyWeek(on) {
    weekOn = on; var cut = Date.now() - 7 * 864e5;
    document.querySelectorAll('#logsTable table tbody tr').forEach(function (tr) {
      if (!on) { if (tr.dataset.weekHidden) { tr.style.display = ''; tr.removeAttribute('data-week-hidden'); } return; }
      var c = tr.children[0]; var t = c ? c.textContent.trim() : ''; var d = Date.parse(t);
      if (!isNaN(d) && d < cut) { tr.style.display = 'none'; tr.dataset.weekHidden = '1'; }
      else if (tr.dataset.weekHidden) { tr.style.display = ''; tr.removeAttribute('data-week-hidden'); }
    });
  }
  function injectLogChips() {
    var v = document.getElementById('view-logs'); if (!v || v.querySelector('.log-chips')) return;
    var sel = document.getElementById('logStatus'); if (!sel) return;
    var chips = [['All', ''], ['Completed', 'completed'], ['Busy', 'busy'], ['Failed', 'failed'], ['No answer', 'no-answer']];
    var wrap = document.createElement('div'); wrap.className = 'log-chips';
    wrap.innerHTML = chips.map(function (c, i) { return '<button class="log-chip' + (i === 0 ? ' on' : '') + '" data-s="' + c[1] + '">' + c[0] + '</button>'; }).join('')
      + '<button class="log-chip" data-week="1">This week</button>';
    var head = v.querySelector('.view-head');
    if (head && head.nextSibling) v.insertBefore(wrap, head.nextSibling); else v.insertBefore(wrap, v.firstChild);
    wrap.addEventListener('click', function (e) {
      var b = e.target.closest('.log-chip'); if (!b) return;
      if (b.dataset.week != null) { b.classList.toggle('on'); applyWeek(b.classList.contains('on')); return; }
      [].forEach.call(wrap.querySelectorAll('.log-chip[data-s]'), function (x) { x.classList.toggle('on', x === b); });
      sel.value = b.dataset.s; sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  var lw = document.getElementById('logsTable');
  if (lw) { new MutationObserver(function () { if (weekOn) applyWeek(true); }).observe(lw, { childList: true, subtree: true }); }

  function densityInit() {
    var foot = document.querySelector('.sidebar-foot'); if (!foot || document.getElementById('densToggle')) return;
    var saved = ''; try { saved = localStorage.getItem('mnb_density') || ''; } catch (e) { }
    if (saved === 'compact') document.body.classList.add('compact');
    var b = document.createElement('button'); b.id = 'densToggle'; b.className = 'btn ghost small'; b.style.width = '100%'; b.style.marginTop = '8px';
    function lbl() { b.textContent = document.body.classList.contains('compact') ? 'Comfortable view' : 'Compact view'; }
    lbl();
    b.addEventListener('click', function () { document.body.classList.toggle('compact'); try { localStorage.setItem('mnb_density', document.body.classList.contains('compact') ? 'compact' : ''); } catch (e) { } lbl(); });
    var theme = document.getElementById('themeToggle');
    if (theme && theme.parentNode) theme.parentNode.insertBefore(b, theme.nextSibling); else foot.insertBefore(b, foot.firstChild);
  }

  function studioTestBtn() {
    var head = document.querySelector('#view-studio .view-head > div');
    if (!head || document.getElementById('testCallBtn')) return;
    var b = document.createElement('button'); b.id = 'testCallBtn'; b.className = 'btn ghost'; b.innerHTML = '&#9990; Test call';
    head.insertBefore(b, head.firstChild);
    b.addEventListener('click', function () {
      var ga = document.getElementById('globalAgent');
      switchView('call');
      setTimeout(function () { var ca = document.getElementById('callAgent'); if (ca && ga) { ca.value = ga.value; ca.dispatchEvent(new Event('change', { bubbles: true })); } if (window.toast) toast('Loaded this agent in Place a Call'); }, 350);
    });
  }

  function run() { injectLogChips(); densityInit(); studioTestBtn(); }
  run();
  window.addEventListener('load', run);
  setTimeout(run, 900);
})();
