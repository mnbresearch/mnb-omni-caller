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
    $('loginOk').textContent = '\u2705 ' + (r.message || 'Account created.');
    $('loginOk').classList.remove('hidden');
    if (r.activated) { setTimeout(function () { location.href = '/app'; }, 1200); } else { setTimeout(showLogin, 2500); }
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
  // Self-service SaaS: any signed-in account (admin or client) can create and
  // train its own agents. Only the read-only demo is prevented from writing.
  $('newAgentBtn').classList.toggle('hidden', !!demo);
  $('demoBanner').classList.toggle('hidden', !demo);
  const delBtn = document.querySelector('#view-studio .view-head .btn.ghost[onclick="deleteAgent()"]');
  if (delBtn) delBtn.classList.toggle('hidden', !!demo);
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
    <label>Agent limit <span class="muted">(max agents this client can create)</span></label>
    <input type="number" id="acap-${u.id}" value="${u.agentCap != null ? u.agentCap : 5}" min="0" style="max-width:160px" />
  </div>`;
}

async function adminSave(userId, status) {
  const agentIds = [...document.querySelectorAll('.ag-' + userId + ':checked')].map((c) => Number(c.value));
  const numberIds = [...document.querySelectorAll('.num-' + userId + ':checked')].map((c) => Number(c.value));
  const minuteCap = Number($('cap-' + userId).value) || 0;
  const acEl = $('acap-' + userId);
  const agentCap = acEl ? (Number(acEl.value) || 0) : undefined;
  try {
    await api(`/admin/users/${userId}/update`, { method: 'POST', body: { status, agentIds, numberIds, minuteCap, agentCap } });
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

/* ===== Dashboard enhancements v4: export current view, saved filters, number-key nav ===== */
(function () {
  if (window.__mnbEnhanced4) return; window.__mnbEnhanced4 = true;

  var css = ''
    + '.saved-chip{display:inline-flex;align-items:center;gap:7px}'
    + '.saved-chip .x{cursor:pointer;opacity:.55;font-weight:700;line-height:1}'
    + '.saved-chip .x:hover{opacity:1;color:var(--bad)}'
    + '.log-chip.add{border-style:dashed;color:var(--muted)}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function csvQuote(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/\s+/g, ' ').trim() + '"'; }
  function download(name, text) {
    var blob = new Blob([text], { type: 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  }
  function headerLabel(th) { var c = th.cloneNode(true); var s = c.querySelector('.srt'); if (s) s.remove(); return c.textContent.trim(); }

  function injectExportView() {
    var filters = document.querySelector('#view-logs .view-head .filters');
    if (!filters || document.getElementById('exportViewBtn')) return;
    var b = document.createElement('button'); b.id = 'exportViewBtn'; b.className = 'btn ghost'; b.innerHTML = '&#8615; Export view';
    filters.appendChild(b);
    b.addEventListener('click', function () {
      var table = document.querySelector('#logsTable table'); if (!table) return;
      var ths = [].slice.call(table.querySelectorAll('thead th'));
      var head = ths.map(headerLabel);
      var rows = [].slice.call(table.querySelectorAll('tbody tr')).filter(function (tr) { return tr.style.display !== 'none'; });
      if (!rows.length) { if (window.toast) toast('No rows to export'); return; }
      var lines = [head.map(csvQuote).join(',')];
      rows.forEach(function (tr) { lines.push([].slice.call(tr.children).map(function (td) { return csvQuote(td.textContent); }).join(',')); });
      download('mnb-omni-caller-view-' + new Date().toISOString().slice(0, 10) + '.csv', lines.join('\n'));
      if (window.toast) toast('Exported ' + rows.length + ' calls');
    });
  }

  function getSaved() { try { return JSON.parse(localStorage.getItem('mnb_saved_filters') || '[]'); } catch (e) { return []; } }
  function setSaved(a) { try { localStorage.setItem('mnb_saved_filters', JSON.stringify(a)); } catch (e) { } }

  function statusChip(s) { return document.querySelector('#view-logs .log-chip[data-s="' + s + '"]'); }
  function weekChip() { return document.querySelector('#view-logs .log-chip[data-week]'); }
  function applySaved(f) {
    var sc = statusChip(f.status || ''); if (sc) sc.click();
    var wc = weekChip(); if (wc && wc.classList.contains('on') !== !!f.week) wc.click();
  }
  function renderSaved() {
    var chipsRow = document.querySelector('#view-logs .log-chips'); if (!chipsRow) return;
    var old = chipsRow.querySelector('.saved-wrap'); if (old) old.remove();
    var wrap = document.createElement('span'); wrap.className = 'saved-wrap'; wrap.style.display = 'inline-flex'; wrap.style.gap = '8px'; wrap.style.flexWrap = 'wrap';
    getSaved().forEach(function (f, i) {
      var c = document.createElement('button'); c.className = 'log-chip saved-chip';
      c.innerHTML = '<span class="nm">' + f.name.replace(/[<>&]/g, '') + '</span><span class="x" data-i="' + i + '">&#215;</span>';
      c.addEventListener('click', function (e) {
        if (e.target.classList.contains('x')) { var arr = getSaved(); arr.splice(+e.target.dataset.i, 1); setSaved(arr); renderSaved(); return; }
        applySaved(f);
      });
      wrap.appendChild(c);
    });
    var add = document.createElement('button'); add.className = 'log-chip add'; add.innerHTML = '&#43; Save filter';
    add.addEventListener('click', function () {
      var sel = document.getElementById('logStatus'); var wc = weekChip();
      var status = sel ? sel.value : ''; var week = wc ? wc.classList.contains('on') : false;
      var name = window.prompt('Name this filter:', (status || 'All') + (week ? ' - this week' : ''));
      if (!name) return;
      var arr = getSaved(); arr.push({ name: name.slice(0, 24), status: status, week: week }); setSaved(arr); renderSaved();
      if (window.toast) toast('Filter saved');
    });
    wrap.appendChild(add);
    chipsRow.appendChild(wrap);
  }

  var NAV = ['overview', 'call', 'studio', 'logs', 'knowledge', 'campaigns', 'numbers', 'plan', 'admin'];
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target; var tn = (t && t.tagName) || '';
    if (tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT' || (t && t.isContentEditable)) return;
    var back = document.querySelector('.cmdk-back'); if (back && back.classList.contains('on')) return;
    if (e.key >= '1' && e.key <= '9') {
      var v = NAV[(+e.key) - 1];
      if (v === 'admin') { var na = document.getElementById('navAdmin'); if (!na || na.classList.contains('hidden')) return; }
      if (v && typeof switchView === 'function') { switchView(v); }
    }
  });

  function run() { injectExportView(); renderSaved(); }
  run();
  window.addEventListener('load', run);
  setTimeout(run, 1000);
})();

/* ===== Dashboard enhancements v5: admin bell, duplicate agent, shortcuts help, auto-refresh ===== */
(function () {
  if (window.__mnbEnhanced5) return; window.__mnbEnhanced5 = true;

  var css = ''
    + '.mnb-bell{position:fixed;top:14px;right:18px;z-index:85;width:42px;height:42px;border-radius:10px;background:var(--panel);border:1px solid var(--border);color:var(--text);font-size:18px;cursor:pointer}'
    + '.mnb-bell .bdg{position:absolute;top:-6px;right:-6px;background:var(--bad);color:#fff;border-radius:10px;font-size:11px;font-weight:700;padding:1px 6px;min-width:18px;text-align:center}'
    + '.bell-panel{position:fixed;top:64px;right:18px;z-index:85;width:330px;max-width:92vw;background:var(--panel);border:1px solid var(--border);border-radius:12px;box-shadow:0 20px 60px rgba(0,0,0,.45);display:none;overflow:hidden}'
    + '.bell-panel.on{display:block}'
    + '.bell-panel h4{margin:0;padding:14px 16px;border-bottom:1px solid var(--border);font-size:.95em}'
    + '.bell-list{max-height:360px;overflow-y:auto}'
    + '.bell-item{padding:12px 16px;border-bottom:1px solid var(--border);font-size:.9em}'
    + '.bell-item b{display:block}'
    + '.bell-item .em{color:var(--muted);font-size:.85em}'
    + '.bell-item .act{margin-top:8px;display:flex;gap:8px;flex-wrap:wrap}'
    + '.sc-back{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:210;display:none;align-items:center;justify-content:center}'
    + '.sc-back.on{display:flex}'
    + '.sc-modal{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:22px 26px;width:420px;max-width:92vw}'
    + '.sc-modal h3{margin:0 0 14px}'
    + '.sc-row{display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:.92em}'
    + '.sc-row:last-child{border-bottom:none}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  function esc2(s) { return String(s == null ? '' : s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); }

  var scBack = document.createElement('div'); scBack.className = 'sc-back';
  var shortcuts = [['Ctrl / Cmd + K', 'Open command palette'], ['1 - 9', 'Jump to a section'], ['?', 'Show this help'], ['Esc', 'Close dialogs']];
  scBack.innerHTML = '<div class="sc-modal"><h3>Keyboard shortcuts</h3>' + shortcuts.map(function (s) { return '<div class="sc-row"><span class="kbd">' + s[0] + '</span><span>' + s[1] + '</span></div>'; }).join('') + '<div style="margin-top:16px;text-align:right"><button class="btn ghost small" id="scClose">Close</button></div></div>';
  document.body.appendChild(scBack);
  function scOpen() { scBack.classList.add('on'); }
  function scClose() { scBack.classList.remove('on'); }
  scBack.addEventListener('click', function (e) { if (e.target === scBack || e.target.id === 'scClose') scClose(); });
  document.addEventListener('keydown', function (e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    var t = e.target; var tn = (t && t.tagName) || '';
    if (tn === 'INPUT' || tn === 'TEXTAREA' || tn === 'SELECT' || (t && t.isContentEditable)) return;
    if (e.key === '?') { e.preventDefault(); scBack.classList.contains('on') ? scClose() : scOpen(); }
    else if (e.key === 'Escape') scClose();
  });

  var autoTimer = null;
  function injectAutoRefresh() {
    var head = document.querySelector('#view-overview .view-head');
    if (!head || document.getElementById('autoRefreshBtn')) return;
    var b = document.createElement('button'); b.id = 'autoRefreshBtn'; b.className = 'btn ghost'; b.style.marginRight = '8px';
    function lbl() { b.textContent = autoTimer ? 'Auto-refresh: on' : 'Auto-refresh: off'; b.classList.toggle('primary', !!autoTimer); }
    lbl();
    b.addEventListener('click', function () {
      if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
      else { autoTimer = setInterval(function () { var ov = document.getElementById('view-overview'); if (typeof loadOverview === 'function' && ov && !ov.classList.contains('hidden')) loadOverview(); }, 30000); if (window.toast) toast('Auto-refresh every 30s'); }
      lbl();
    });
    var refreshBtn = head.querySelector('button'); if (refreshBtn) head.insertBefore(b, refreshBtn); else head.appendChild(b);
  }

  function initBell() {
    if (document.getElementById('mnbBell')) return;
    var btn = document.createElement('button'); btn.id = 'mnbBell'; btn.className = 'mnb-bell'; btn.setAttribute('aria-label', 'Access requests'); btn.innerHTML = '&#128276;<span class="bdg" style="display:none">0</span>';
    var panel = document.createElement('div'); panel.className = 'bell-panel'; panel.innerHTML = '<h4>Access requests</h4><div class="bell-list"></div>';
    document.body.appendChild(btn); document.body.appendChild(panel);
    var badge = btn.querySelector('.bdg'); var list = panel.querySelector('.bell-list');
    btn.addEventListener('click', function (e) { e.stopPropagation(); panel.classList.toggle('on'); if (panel.classList.contains('on')) refresh(); });
    document.addEventListener('click', function (e) { if (!panel.contains(e.target) && e.target !== btn) panel.classList.remove('on'); });
    async function refresh() {
      var d = await fetch('/api/admin/users').then(function (r) { return r.json(); }).catch(function () { return { users: [] }; });
      var pending = (d.users || []).filter(function (u) { return u.status === 'pending' && !u.demo; });
      badge.textContent = pending.length; badge.style.display = pending.length ? '' : 'none';
      list.innerHTML = pending.length ? pending.map(function (u) {
        var wa = (u.phone || '').replace(/[^\d]/g, '');
        return '<div class="bell-item"><b>' + esc2(u.org || u.contact || u.email) + '</b><span class="em">' + esc2(u.email) + (u.phone ? ' &middot; ' + esc2(u.phone) : '') + '</span>'
          + (u.note ? '<div class="em" style="margin-top:4px">' + esc2(u.note) + '</div>' : '')
          + '<div class="act"><button class="btn primary small" data-approve="' + u.id + '">Approve</button>'
          + (wa ? '<a class="btn ghost small" target="_blank" href="https://wa.me/' + wa + '">WhatsApp</a>' : '')
          + '<button class="btn ghost small" data-openadmin="1">Open Admin</button></div></div>';
      }).join('') : '<div class="bell-item em">No pending requests</div>';
    }
    list.addEventListener('click', function (e) {
      var ap = e.target.getAttribute('data-approve');
      if (ap) { fetch('/api/admin/users/' + ap + '/update', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'active' }) }).then(function () { if (window.toast) toast('Access approved'); refresh(); if (typeof loadAdmin === 'function') loadAdmin(); }); return; }
      if (e.target.getAttribute('data-openadmin')) { panel.classList.remove('on'); if (typeof switchView === 'function') switchView('admin'); }
    });
    refresh(); setInterval(refresh, 60000);
  }

  function studioDuplicateBtn() {
    var head = document.querySelector('#view-studio .view-head > div');
    if (!head || document.getElementById('dupAgentBtn')) return;
    var b = document.createElement('button'); b.id = 'dupAgentBtn'; b.className = 'btn ghost'; b.textContent = 'Duplicate';
    head.insertBefore(b, head.firstChild);
    b.addEventListener('click', function () {
      if (typeof openAgentModal === 'function') openAgentModal();
      setTimeout(function () {
        var n = document.getElementById('naName'), w = document.getElementById('naWelcome');
        var cn = document.getElementById('agName'), cw = document.getElementById('agWelcome');
        if (n && cn) n.value = (cn.value || 'Agent') + ' (copy)';
        if (w && cw) w.value = cw.value || '';
        if (window.toast) toast('Review and create your duplicated agent');
      }, 250);
    });
  }

  function run() { injectAutoRefresh(); }
  run();
  window.addEventListener('load', run);
  setTimeout(run, 1000);
  (async function () {
    var me = await fetch('/api/me', { cache: 'no-store' }).then(function (r) { return r.json(); }).catch(function () { return {}; });
    if (me.user && me.user.role === 'admin') { initBell(); studioDuplicateBtn(); }
  })();
})();


/* =======================================================================
 * MNB Omni Caller - v6 platform layer (frontend)
 * Live call monitoring + AI analytics, per-vertical intelligence, and the
 * super-admin Integrations Control Center. Everything here is additive and
 * guarded: non-admin dashboards are never impacted, and admin-only tools
 * only appear for the super admin.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced6) return; window.__mnbEnhanced6 = true;
  var API = function (p, o) { return api(p, o); };
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var meV6 = null, VERT = {}, curVert = 'general';

  /* ---------- styles ---------- */
  var css = document.createElement('style'); css.id = 'mnb-v6-css';
  css.textContent =
    '.v6-grid{display:grid;gap:14px}' +
    '.v6-kpis{grid-template-columns:repeat(auto-fit,minmax(150px,1fr))}' +
    '.v6-kpi{background:var(--card,#15161a);border:1px solid var(--line,#26272e);border-radius:14px;padding:16px}' +
    '.v6-kpi .l{font-size:12px;color:var(--muted,#9aa0aa);letter-spacing:.3px;text-transform:uppercase}' +
    '.v6-kpi .v{font-size:26px;font-weight:800;margin-top:6px;color:var(--text,#eef)}' +
    '.v6-kpi .s{font-size:12px;color:var(--muted,#9aa0aa);margin-top:2px}' +
    '.v6-badge{display:inline-block;font-size:11px;font-weight:700;padding:3px 9px;border-radius:20px;letter-spacing:.4px}' +
    '.v6-pos{background:rgba(34,197,94,.16);color:#22c55e}.v6-neg{background:rgba(239,68,68,.16);color:#ef4444}.v6-neu{background:rgba(148,163,184,.16);color:#94a3b8}' +
    '.v6-ai{background:linear-gradient(135deg,#ee6c0a,#ffab5e);color:#111}' +
    '.v6-bar{height:9px;border-radius:6px;background:var(--line,#26272e);overflow:hidden}' +
    '.v6-bar > i{display:block;height:100%;background:linear-gradient(90deg,#ee6c0a,#ffab5e)}' +
    '.v6-live-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#ef4444;margin-right:7px;animation:v6pulse 1.2s infinite}' +
    '@keyframes v6pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.6)}70%{box-shadow:0 0 0 8px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}' +
    '.v6-tx{max-height:340px;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:4px 2px}' +
    '.v6-turn{max-width:82%;padding:9px 13px;border-radius:14px;font-size:14px;line-height:1.4}' +
    '.v6-turn.agent{align-self:flex-start;background:var(--line,#22232a);color:var(--text,#eef);border-bottom-left-radius:4px}' +
    '.v6-turn.user{align-self:flex-end;background:linear-gradient(135deg,#ee6c0a,#ff9a4d);color:#111;border-bottom-right-radius:4px}' +
    '.v6-who{font-size:10px;text-transform:uppercase;letter-spacing:.5px;opacity:.7;margin-bottom:2px}' +
    '.v6-chip{display:inline-block;background:var(--line,#22232a);border:1px solid var(--line,#2b2c34);color:var(--text,#dfe3ea);border-radius:20px;padding:6px 12px;font-size:13px;margin:4px 6px 0 0;cursor:pointer}' +
    '.v6-chip.on{background:linear-gradient(135deg,#ee6c0a,#ffab5e);color:#111;border-color:transparent;font-weight:700}' +
    '.v6-int{border:1px solid var(--line,#26272e);border-radius:14px;padding:16px;margin-bottom:14px;background:var(--card,#15161a)}' +
    '.v6-int h4{margin:0 0 3px;font-size:16px}.v6-int .tier{font-size:12px;color:#22c55e;font-weight:600}' +
    '.v6-int .setup{font-size:12.5px;color:var(--muted,#9aa0aa);margin:8px 0 12px;line-height:1.5}' +
    '.v6-field{display:flex;flex-direction:column;gap:4px;margin:8px 0}' +
    '.v6-field label{font-size:12px;color:var(--muted,#9aa0aa)}' +
    '.v6-field input{background:var(--bg,#0e0f12);border:1px solid var(--line,#2b2c34);color:var(--text,#eef);border-radius:9px;padding:9px 11px;font-size:13px;width:100%;box-sizing:border-box}' +
    '.v6-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}' +
    '.v6-tog{display:flex;align-items:center;gap:7px;font-size:13px;color:var(--text,#dfe3ea)}' +
    '.v6-list{display:flex;flex-direction:column;gap:8px}' +
    '.v6-lc{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--line,#26272e);border-radius:12px;padding:11px 13px;background:var(--card,#15161a);cursor:pointer}' +
    '.v6-lc:hover{border-color:#ee6c0a}' +
    '.v6-muted{color:var(--muted,#9aa0aa)}.v6-mt{margin-top:16px}';
  document.head.appendChild(css);

  /* ---------- helpers ---------- */
  function sentBadge(s) {
    s = (s || 'neutral').toLowerCase();
    var c = s === 'positive' ? 'v6-pos' : s === 'negative' ? 'v6-neg' : 'v6-neu';
    return '<span class="v6-badge ' + c + '">' + E(s) + '</span>';
  }
  function pct(n) { return Math.max(0, Math.min(100, Math.round(n || 0))); }

  // Lightweight client-side read of a transcript for the instant live panel.
  function quickRead(turnsArr) {
    var txt = turnsArr.map(function (t) { return t.text; }).join(' ').toLowerCase();
    var pos = ['yes', 'sure', 'great', 'perfect', 'interested', 'book', 'sounds good', 'definitely', 'useful', 'works', 'help'];
    var neg = ['no', 'not interested', 'do not call', 'busy', 'stop', 'complaint', 'refund'];
    var p = pos.filter(function (w) { return txt.indexOf(w) >= 0; }).length;
    var n = neg.filter(function (w) { return txt.indexOf(w) >= 0; }).length;
    var sentiment = n > p ? 'negative' : p > 0 ? 'positive' : 'neutral';
    var intent = /book|schedule|appointment|demo|site visit/.test(txt) ? 'booking' :
      /price|pricing|cost|fee/.test(txt) ? 'pricing enquiry' :
      /callback|call me|next week/.test(txt) ? 'callback' : 'in discovery';
    var a = turnsArr.filter(function (t) { return t.who === 'agent'; }).length;
    var u = turnsArr.filter(function (t) { return t.who === 'user'; }).length;
    var talk = a + u ? Math.round(a / (a + u) * 100) : 0;
    return { sentiment: sentiment, intent: intent, talk: talk };
  }
  function renderTurns(turnsArr) {
    if (!turnsArr || !turnsArr.length) return '<div class="v6-muted">Waiting for the conversation to start...</div>';
    return turnsArr.map(function (t) {
      return '<div class="v6-turn ' + (t.who === 'user' ? 'user' : 'agent') + '">' +
        '<div class="v6-who">' + (t.who === 'user' ? 'Customer' : 'AI Agent') + '</div>' + E(t.text) + '</div>';
    }).join('');
  }

  /* ---------- view scaffolding ---------- */
  function mkView(id) {
    var main = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode;
    if (!main) return null;
    var sec = document.createElement('section');
    sec.id = 'view-' + id; sec.className = 'view hidden';
    main.appendChild(sec);
    return sec;
  }
  function mkNav(id, ico, label, adminOnly) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav');
    if (!nav) return;
    if (document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a');
    a.href = '#' + id; a.className = 'nav-item' + (adminOnly ? ' hidden' : '');
    a.setAttribute('data-view', id);
    if (adminOnly) a.id = 'navV6' + id;
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    // place admin item near the end, others before Plan
    var anchor = document.querySelector('.nav-item[data-view="' + (adminOnly ? 'admin' : 'plan') + '"]');
    if (anchor && anchor.parentNode === nav) nav.insertBefore(a, anchor); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }

  var vLive = mkView('live'), vAna = mkView('analytics'), vInt = mkView('integrations');
  mkNav('live', '&#9673;', 'Live Calls', false);
  mkNav('analytics', '&#9636;', 'Call Analytics', false);
  mkNav('integrations', '&#9881;', 'Integrations', true);

  /* ---------- route override ---------- */
  var MY = { live: loadLive, analytics: loadAnalytics, integrations: loadIntegrations };
  var origSwitch = window.switchView;
  window.switchView = function (view) {
    if (MY[view]) {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      var el = document.getElementById('view-' + view); if (el) el.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === view); });
      if (location.hash.replace('#', '') !== view) location.hash = view;
      stopLivePoll(); if (view === 'live') startLivePoll();
      try { MY[view](); } catch (e) { console.error(e); }
      return;
    }
    stopLivePoll();
    return origSwitch.apply(this, arguments);
  };

  /* ---------- fetch role + verticals, reveal admin nav ---------- */
  (async function boot() {
    try { var info = await API('/me'); meV6 = info && info.user; } catch (e) {}
    if (meV6 && meV6.role === 'admin') { var ni = document.getElementById('navV6integrations'); if (ni) ni.classList.remove('hidden'); }
    try { var vd = await API('/verticals'); VERT = vd.verticals || {}; curVert = (meV6 && meV6.businessType) || vd.current || 'general'; } catch (e) {}
    // deep link support if we loaded straight into one of our views
    var h = location.hash.replace('#', '');
    if (MY[h]) window.switchView(h);
  })();

  /* ================= LIVE CALLS ================= */
  var livePoll = null, liveSel = null;
  function stopLivePoll() { if (livePoll) { clearInterval(livePoll); livePoll = null; } }
  function startLivePoll() { stopLivePoll(); pollLive(); livePoll = setInterval(pollLive, 4000); }
  async function pollLive() {
    var host = document.getElementById('view-live'); if (!host || host.classList.contains('hidden')) { stopLivePoll(); return; }
    var data; try { data = await API('/calls/live'); } catch (e) { return; }
    renderLive(data.live || []);
  }
  function loadLive() {
    vLive.innerHTML =
      '<header class="view-head"><h2><span class="v6-live-dot"></span>Live Calls</h2>' +
      '<p class="muted">Watch calls as they happen with a rolling transcript and real-time AI read-out. Auto-refreshes every few seconds.</p></header>' +
      '<div id="v6LiveWrap"><div class="v6-muted">Checking for live calls...</div></div>';
    pollLive();
  }
  function renderLive(list) {
    var wrap = document.getElementById('v6LiveWrap'); if (!wrap) return;
    if (!list.length) {
      wrap.innerHTML = '<div class="card"><h3>No calls in progress right now</h3>' +
        '<p class="muted">When your agents are on a call, they will appear here live with transcript and AI analysis. Start a call from <b>Place a Call</b> or run a campaign to see this light up.</p></div>';
      return;
    }
    if (!liveSel || !list.some(function (c) { return c.id === liveSel; })) liveSel = list[0].id;
    var sel = list.filter(function (c) { return c.id === liveSel; })[0] || list[0];
    var read = quickRead(sel.transcript || []);
    var tabs = list.map(function (c) {
      return '<span class="v6-chip ' + (c.id === liveSel ? 'on' : '') + '" data-live="' + c.id + '">' +
        '<span class="v6-live-dot"></span>' + E(c.to_number || ('Call ' + c.id)) + '</span>';
    }).join('');
    wrap.innerHTML =
      '<div style="margin-bottom:10px">' + tabs + '</div>' +
      '<div class="v6-grid" style="grid-template-columns:1.4fr 1fr">' +
        '<div class="card"><h3 style="margin-top:0">' + E(sel.bot_name || 'AI Agent') + ' &rarr; ' + E(sel.to_number || '') + '</h3>' +
          '<div class="v6-tx" id="v6Tx">' + renderTurns(sel.transcript) + '</div></div>' +
        '<div class="card"><h3 style="margin-top:0">Live AI read-out</h3>' +
          '<div class="v6-row"><span class="v6-muted">Sentiment</span> ' + sentBadge(read.sentiment) + '</div>' +
          '<div class="v6-row"><span class="v6-muted">Intent</span> <b>' + E(read.intent) + '</b></div>' +
          '<div class="v6-mt"><div class="v6-muted" style="font-size:12px">Agent talk-ratio ' + read.talk + '%</div><div class="v6-bar"><i style="width:' + read.talk + '%"></i></div></div>' +
          '<div class="v6-mt"><button class="btn" id="v6AnalyzeBtn" data-id="' + sel.id + '">Deep AI analysis</button></div>' +
          '<div id="v6AnaOut" class="v6-mt"></div>' +
        '</div>' +
      '</div>';
    var tx = document.getElementById('v6Tx'); if (tx) tx.scrollTop = tx.scrollHeight;
    wrap.querySelectorAll('[data-live]').forEach(function (el) {
      el.addEventListener('click', function () { liveSel = Number(el.getAttribute('data-live')); pollLive(); });
    });
    var ab = document.getElementById('v6AnalyzeBtn');
    if (ab) ab.addEventListener('click', function () { runAnalysis(ab.getAttribute('data-id'), 'v6AnaOut'); });
  }

  /* ================= per-call AI analysis ================= */
  async function runAnalysis(id, outId) {
    var out = document.getElementById(outId); if (out) out.innerHTML = '<div class="v6-muted">Analyzing call with AI...</div>';
    try {
      var d = await API('/analytics/call/' + id);
      var a = d.analysis || {};
      var fields = a.fields && Object.keys(a.fields).length
        ? '<div class="v6-mt"><div class="v6-muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.4px">Captured details</div>' +
          Object.keys(a.fields).map(function (k) { return '<div><b>' + E(k.replace(/_/g, ' ')) + ':</b> ' + E(a.fields[k]) + '</div>'; }).join('') + '</div>'
        : '';
      var coach = (a.coaching || []).map(function (c) { return '<li>' + E(c) + '</li>'; }).join('');
      if (out) out.innerHTML =
        '<div class="v6-int" style="margin:0">' +
          '<div class="v6-row"><span class="v6-badge ' + (a.engine === 'ai' ? 'v6-ai' : 'v6-neu') + '">' + (a.engine === 'ai' ? 'AI engine' : 'built-in engine') + '</span> ' +
            sentBadge(a.sentiment) + ' <span class="v6-badge v6-neu">score ' + pct(a.score) + '</span></div>' +
          '<p style="margin:10px 0 6px">' + E(a.summary || '') + '</p>' +
          '<div class="v6-muted" style="font-size:13px">Intent: <b>' + E(a.intent || '') + '</b> &middot; Outcome: <b>' + E((a.outcome || '').replace(/_/g, ' ')) + '</b></div>' +
          fields +
          (coach ? '<div class="v6-mt"><div class="v6-muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.4px">Coaching</div><ul style="margin:6px 0 0;padding-left:18px">' + coach + '</ul></div>' : '') +
        '</div>';
    } catch (e) { if (out) out.innerHTML = '<div class="v6-neg">Analysis failed: ' + E(e.message) + '</div>'; }
  }

  /* ================= CALL ANALYTICS ================= */
  async function loadAnalytics() {
    vAna.innerHTML = '<header class="view-head"><h2>Call Analytics</h2><p class="muted">Loading intelligence across your calls...</p></header>';
    var o; try { o = await API('/analytics/overview'); } catch (e) { vAna.innerHTML = '<div class="card v6-neg">Could not load analytics: ' + E(e.message) + '</div>'; return; }
    var sent = o.sentiment || {}; var totSent = (sent.positive || 0) + (sent.neutral || 0) + (sent.negative || 0) || 1;
    var engine = o.aiEngine === 'groq' ? 'Groq AI' : o.aiEngine === 'gemini' ? 'Gemini AI' : 'Built-in engine (free)';
    var kpiCards =
      kpi('Avg call score', pct(o.avgScore), 'out of 100') +
      kpi('Conversion', o.conversion + '%', o.booked + ' of ' + (o.totals ? o.totals.calls : 0) + ' calls') +
      kpi('Connected', (o.totals ? o.totals.connected : 0), 'of ' + (o.totals ? o.totals.calls : 0) + ' dialled') +
      kpi('Agent talk-ratio', pct(o.avgTalkRatio) + '%', 'lower = more listening');
    var outcomes = (o.outcomes || []).map(function (x) {
      return '<div class="v6-row" style="justify-content:space-between"><span>' + E(x[0].replace(/_/g, ' ')) + '</span><b>' + x[1] + '</b></div>';
    }).join('') || '<div class="v6-muted">No outcomes yet</div>';
    var intents = (o.topIntents || []).map(function (x) { return '<span class="v6-chip">' + E(x[0]) + ' &middot; ' + x[1] + '</span>'; }).join('') || '<span class="v6-muted">No data yet</span>';
    var sbar = function (label, n, cls) {
      var w = Math.round(n / totSent * 100);
      return '<div class="v6-mt"><div class="v6-row" style="justify-content:space-between"><span>' + label + '</span><span class="v6-muted">' + n + '</span></div><div class="v6-bar"><i style="width:' + w + '%' + (cls ? ';background:' + cls : '') + '"></i></div></div>';
    };
    var kpiName = (o.vertical && o.vertical.kpis) ? o.vertical.kpis.map(function (k) { return '<span class="v6-chip">' + E(k.label) + '</span>'; }).join('') : '';
    vAna.innerHTML =
      '<header class="view-head"><h2>Call Analytics</h2>' +
      '<p class="muted">' + E((o.vertical && o.vertical.name) || 'General') + ' &middot; analysis engine: <b>' + engine + '</b></p></header>' +
      '<div id="v6VertPick"></div>' +
      '<div class="v6-grid v6-kpis v6-mt">' + kpiCards + '</div>' +
      '<div class="v6-grid v6-mt" style="grid-template-columns:1fr 1fr">' +
        '<div class="card"><h3 style="margin-top:0">Sentiment mix</h3>' +
          sbar('Positive', sent.positive || 0, '#22c55e') + sbar('Neutral', sent.neutral || 0, '#94a3b8') + sbar('Negative', sent.negative || 0, '#ef4444') +
        '</div>' +
        '<div class="card"><h3 style="margin-top:0">Outcomes</h3>' + outcomes +
          '<div class="v6-mt"><div class="v6-muted" style="font-size:12px;text-transform:uppercase;letter-spacing:.4px">Top intents</div><div style="margin-top:6px">' + intents + '</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="card v6-mt"><h3 style="margin-top:0">Vertical KPIs tracked for you</h3><div>' + (kpiName || '<span class="v6-muted">Pick a business type to tailor KPIs</span>') + '</div></div>' +
      '<div class="card v6-mt"><h3 style="margin-top:0">Recent calls &middot; tap for AI analysis</h3><div id="v6Recent" class="v6-list"><div class="v6-muted">Loading...</div></div></div>';
    renderVertPicker();
    loadRecentForAnalysis();
  }
  function kpi(l, v, s) { return '<div class="v6-kpi"><div class="l">' + l + '</div><div class="v">' + v + '</div><div class="s">' + (s || '') + '</div></div>'; }

  function renderVertPicker() {
    var host = document.getElementById('v6VertPick'); if (!host) return;
    if (meV6 && meV6.demo) { host.innerHTML = '<div class="card"><b>Business type:</b> read-only in demo. Real accounts pick their vertical to auto-tailor captured fields, KPIs and AI analysis.</div>'; return; }
    var ids = Object.keys(VERT);
    var chips = ids.map(function (id) {
      return '<span class="v6-chip ' + (id === curVert ? 'on' : '') + '" data-vert="' + id + '">' + E(VERT[id].name) + '</span>';
    }).join('');
    host.innerHTML = '<div class="card"><h3 style="margin-top:0">Your business type</h3>' +
      '<p class="muted" style="margin:0 0 8px">Sets the custom details each call captures, the KPIs you track, and how the AI scores calls.</p>' + chips + '</div>';
    host.querySelectorAll('[data-vert]').forEach(function (el) {
      el.addEventListener('click', async function () {
        var id = el.getAttribute('data-vert');
        try { await API('/my/vertical', { method: 'POST', body: { businessType: id } }); curVert = id; T('Business type set to ' + VERT[id].name); loadAnalytics(); }
        catch (e) { T('Could not update: ' + e.message, 4000); }
      });
    });
  }
  async function loadRecentForAnalysis() {
    var host = document.getElementById('v6Recent'); if (!host) return;
    var rows = [];
    try { var d = await API('/calls/logs?pageno=1&pagesize=12'); rows = d.call_log_data || []; } catch (e) {}
    rows = rows.filter(function (r) { return (r.call_conversation || r.transcript || '').length > 12; });
    if (!rows.length) { host.innerHTML = '<div class="v6-muted">No completed calls with transcripts yet.</div>'; return; }
    host.innerHTML = rows.map(function (r) {
      return '<div class="v6-lc" data-cid="' + r.id + '"><div><b>' + E(r.to_number || ('Call ' + r.id)) + '</b> <span class="v6-muted">&middot; ' + E(r.call_duration || '') + '</span><div class="v6-muted" style="font-size:12px">' + E(r.time_of_call || '') + '</div></div>' +
        sentBadge(r.sentiment_score || 'neutral') + '</div>' +
        '<div id="v6ana_' + r.id + '"></div>';
    }).join('');
    host.querySelectorAll('.v6-lc').forEach(function (el) {
      el.addEventListener('click', function () { runAnalysis(el.getAttribute('data-cid'), 'v6ana_' + el.getAttribute('data-cid')); });
    });
  }

  /* ================= INTEGRATIONS (super-admin only) ================= */
  async function loadIntegrations() {
    if (!meV6 || meV6.role !== 'admin') { vInt.innerHTML = '<div class="card">This area is for the platform administrator.</div>'; return; }
    vInt.innerHTML = '<header class="view-head"><h2>Integrations Control Center</h2><p class="muted">Loading...</p></header>';
    var d; try { d = await API('/admin/integrations'); } catch (e) { vInt.innerHTML = '<div class="card v6-neg">Could not load: ' + E(e.message) + '</div>'; return; }
    var cfg = d.config || {}, cat = d.catalog || [], env = d.env || {};
    var fieldsFor = {
      ai: [{ k: 'provider', l: 'Provider (groq or gemini)', ph: 'groq' }, { k: 'groqKey', l: 'Groq API key', ph: 'gsk_...' }, { k: 'geminiKey', l: 'Gemini API key', ph: 'AIza...' }, { k: 'model', l: 'Model (optional)', ph: 'llama-3.3-70b-versatile' }],
      whatsapp: [{ k: 'token', l: 'Permanent token', ph: 'EAAG...' }, { k: 'phoneId', l: 'Phone number ID', ph: '1234567890' }],
      razorpay: [{ k: 'keyId', l: 'Key ID', ph: 'rzp_test_...' }, { k: 'keySecret', l: 'Key secret', ph: '...' }],
      sheets: [{ k: 'webhookUrl', l: 'Apps Script Web App URL', ph: 'https://script.google.com/macros/s/.../exec' }],
      calendar: [{ k: 'webhookUrl', l: 'Apps Script / Cal.com URL', ph: 'https://...' }],
      webhook: [{ k: 'url', l: 'Webhook URL (Zapier/Make/any)', ph: 'https://hooks.zapier.com/...' }],
      slack: [{ k: 'webhookUrl', l: 'Slack/Discord incoming webhook', ph: 'https://hooks.slack.com/services/...' }],
    };
    var cards = cat.map(function (item) {
      var c = cfg[item.key] || {}; var fs = fieldsFor[item.key] || [];
      var inputs = fs.map(function (f) {
        var val = c[f.k] != null ? c[f.k] : '';
        return '<div class="v6-field"><label>' + E(f.l) + '</label><input data-sec="' + item.key + '" data-k="' + f.k + '" value="' + E(val) + '" placeholder="' + E(f.ph) + '"></div>';
      }).join('');
      var extraTog = item.key === 'whatsapp' ? '<label class="v6-tog"><input type="checkbox" data-sec="whatsapp" data-k="welcomeLeads" ' + (c.welcomeLeads ? 'checked' : '') + '> Auto-WhatsApp new leads</label>' : '';
      return '<div class="v6-int">' +
        '<div class="v6-row" style="justify-content:space-between"><h4>' + E(item.name) + '</h4>' +
          '<label class="v6-tog"><input type="checkbox" data-sec="' + item.key + '" data-k="enabled" ' + (c.enabled ? 'checked' : '') + '> Enabled</label></div>' +
        '<div class="tier">Free: ' + E(item.tier) + '</div>' +
        '<div class="setup">' + E(item.setup) + '</div>' + inputs + extraTog +
        '<div class="v6-row"><button class="btn" data-save="' + item.key + '">Save</button>' +
          '<button class="btn" data-test="' + item.key + '" style="background:transparent;border:1px solid var(--line,#2b2c34)">Test</button>' +
          '<span class="v6-muted" id="v6ires_' + item.key + '"></span></div>' +
      '</div>';
    }).join('');
    var envNote = Object.keys(env).filter(function (k) { return env[k]; }).map(function (k) { return k; });
    vInt.innerHTML =
      '<header class="view-head"><h2>Integrations Control Center</h2>' +
      '<p class="muted">Only you (the platform admin) can see and set these. Keys are stored server-side and never sent to client dashboards. Everything below has a free or generous-free tier.</p></header>' +
      (envNote.length ? '<div class="card v6-mt"><b>From environment:</b> <span class="v6-muted">' + envNote.join(', ') + ' detected. Admin values below override env if set.</span></div>' : '') +
      '<div class="v6-mt">' + cards + '</div>' +
      '<div class="card v6-mt"><h3 style="margin-top:0">Assign business type to organizations</h3><div id="v6Orgs" class="v6-list"><div class="v6-muted">Loading orgs...</div></div></div>';
    bindIntegrations();
    loadOrgVerticals();
  }
  function collect(sec) {
    var body = {};
    document.querySelectorAll('[data-sec="' + sec + '"]').forEach(function (el) {
      var k = el.getAttribute('data-k');
      body[k] = el.type === 'checkbox' ? el.checked : el.value.trim();
    });
    return body;
  }
  function bindIntegrations() {
    vInt.querySelectorAll('[data-save]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var sec = b.getAttribute('data-save');
        try { await API('/admin/integrations', { method: 'POST', body: { section: sec, values: collect(sec) } }); T('Saved ' + sec); }
        catch (e) { T('Save failed: ' + e.message, 4000); }
      });
    });
    vInt.querySelectorAll('[data-test]').forEach(function (b) {
      b.addEventListener('click', async function () {
        var sec = b.getAttribute('data-test'); var out = document.getElementById('v6ires_' + sec);
        if (out) out.textContent = 'Testing...';
        // save first so the test uses fresh values
        try { await API('/admin/integrations', { method: 'POST', body: { section: sec, values: collect(sec) } }); } catch (e) {}
        var to = '';
        if (sec === 'whatsapp') { to = prompt('Send WhatsApp test to (number with country code):', meV6.phone || ''); if (!to) { if (out) out.textContent = ''; return; } }
        try { var r = await API('/admin/integrations/test/' + sec, { method: 'POST', body: { to: to } });
          if (out) out.innerHTML = r.ok ? '<span class="v6-pos">OK</span> ' + E(r.sample || r.provider || '') : (r.skipped ? 'Not configured yet' : '<span class="v6-neg">Failed: ' + E(r.error || '') + '</span>');
        } catch (e) { if (out) out.innerHTML = '<span class="v6-neg">' + E(e.message) + '</span>'; }
      });
    });
  }
  async function loadOrgVerticals() {
    var host = document.getElementById('v6Orgs'); if (!host) return;
    var users = [];
    try { var d = await API('/admin/users'); users = (d.users || []).filter(function (u) { return u.role !== 'admin'; }); } catch (e) {}
    if (!users.length) { host.innerHTML = '<div class="v6-muted">No client organizations yet.</div>'; return; }
    var opts = Object.keys(VERT);
    host.innerHTML = users.map(function (u) {
      var sel = opts.map(function (id) { return '<option value="' + id + '"' + ((u.businessType || 'general') === id ? ' selected' : '') + '>' + E(VERT[id].name) + '</option>'; }).join('');
      return '<div class="v6-lc" style="cursor:default"><div><b>' + E(u.org || u.email) + '</b><div class="v6-muted" style="font-size:12px">' + E(u.email) + '</div></div>' +
        '<select data-org="' + u.id + '" style="background:var(--bg,#0e0f12);color:var(--text,#eef);border:1px solid var(--line,#2b2c34);border-radius:8px;padding:7px 9px">' + sel + '</select></div>';
    }).join('');
    host.querySelectorAll('[data-org]').forEach(function (s) {
      s.addEventListener('change', async function () {
        try { await API('/admin/org/' + s.getAttribute('data-org') + '/vertical', { method: 'POST', body: { businessType: s.value } }); T('Updated'); }
        catch (e) { T('Failed: ' + e.message, 4000); }
      });
    });
  }
})();


/* =======================================================================
 * MNB Omni Caller - v7 layer
 * Adds a lightweight CRM to the calling workflow: Contacts + Quick Dial,
 * a Follow-ups tracker (flag any call, add notes, work the list), and an
 * Analytics report export/print. All additive and guarded; stored per
 * browser (localStorage) so nothing touches other users' data.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced7) return; window.__mnbEnhanced7 = true;
  var API = function (p, o) { return api(p, o); };
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var digits = function (s) { return String(s || '').replace(/[^\d]/g, ''); };

  /* ---------- storage helpers (local cache + server sync) ---------- */
  var meV7 = null;
  function load(key, def) { try { return JSON.parse(localStorage.getItem(key)) || def; } catch (e) { return def; } }
  function pushCRM() {
    if (meV7 && meV7.demo) return; // demo stays local-only
    try { api('/crm', { method: 'PUT', body: { contacts: load(CKEY, []), followups: load(FKEY, {}) } }); } catch (e) {}
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
    if (key === CKEY || key === FKEY) pushCRM();
  }
  var CKEY = 'mnb_contacts', FKEY = 'mnb_followups';
  // Pull the server copy on load so Contacts and Follow-ups sync across devices.
  (function () {
    api('/me').then(function (info) {
      meV7 = info && info.user;
      if (!meV7 || meV7.demo) return;
      api('/crm').then(function (d) {
        if (!d) return;
        try { localStorage.setItem(CKEY, JSON.stringify(d.contacts || [])); localStorage.setItem(FKEY, JSON.stringify(d.followups || {})); } catch (e) {}
        try { refreshFuBadge(); } catch (e) {}
        var h = location.hash.replace('#', '');
        if (h === 'contacts') loadContacts(); else if (h === 'followups') loadFollowups();
      }).catch(function () {});
    }).catch(function () {});
  })();

  /* ---------- styles ---------- */
  var css = document.createElement('style'); css.id = 'mnb-v7-css';
  css.textContent =
    '.v7-form{display:grid;grid-template-columns:1fr 1fr 1.4fr auto;gap:8px;margin-bottom:16px}' +
    '@media(max-width:720px){.v7-form{grid-template-columns:1fr}}' +
    '.v7-form input{background:var(--bg,#0e0f12);border:1px solid var(--line,#2b2c34);color:var(--text,#eef);border-radius:9px;padding:10px 12px;font-size:13px}' +
    '.v7-row{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--line,#26272e);border-radius:12px;padding:12px 14px;background:var(--card,#15161a);margin-bottom:8px}' +
    '.v7-row .m{color:var(--muted,#9aa0aa);font-size:12px}' +
    '.v7-actions{display:flex;gap:6px;flex-wrap:wrap}' +
    '.v7-mini{border:1px solid var(--line,#2b2c34);background:transparent;color:var(--text,#dfe3ea);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;font-weight:600}' +
    '.v7-mini:hover{border-color:#ee6c0a;color:#ee6c0a}' +
    '.v7-mini.pri{background:linear-gradient(135deg,#ee6c0a,#ffab5e);color:#111;border:none}' +
    '.v7-mini.wa{border-color:#25D366;color:#25D366}' +
    '.v7-fu{margin-top:14px;border-top:1px dashed var(--line,#2b2c34);padding-top:12px}' +
    '.v7-fu label{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text,#dfe3ea);margin-bottom:8px}' +
    '.v7-fu textarea{width:100%;box-sizing:border-box;background:var(--bg,#0e0f12);border:1px solid var(--line,#2b2c34);color:var(--text,#eef);border-radius:9px;padding:9px 11px;font-size:13px;min-height:56px}' +
    '.v7-count{display:inline-block;min-width:18px;height:18px;line-height:18px;text-align:center;background:#ee6c0a;color:#111;border-radius:9px;font-size:11px;font-weight:800;margin-left:6px;padding:0 5px}';
  document.head.appendChild(css);

  /* ---------- view + nav scaffolding ---------- */
  function mkView(id) {
    var main = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode;
    if (!main) return null;
    var sec = document.createElement('section'); sec.id = 'view-' + id; sec.className = 'view hidden';
    main.appendChild(sec); return sec;
  }
  function mkNav(id, ico, label, beforeView) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav');
    if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="' + beforeView + '"]');
    if (anchor && anchor.parentNode === nav) nav.insertBefore(a, anchor); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vContacts = mkView('contacts'), vFollow = mkView('followups');
  mkNav('contacts', '&#128100;', 'Contacts', 'plan');
  mkNav('followups', '&#9873;', 'Follow-ups', 'plan');

  /* ---------- routing (chain on top of existing switchView) ---------- */
  var MY = { contacts: loadContacts, followups: loadFollowups };
  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (MY[view]) {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      var el = document.getElementById('view-' + view); if (el) el.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === view); });
      if (location.hash.replace('#', '') !== view) location.hash = view;
      try { MY[view](); } catch (e) { console.error(e); }
      return;
    }
    return prevSwitch.apply(this, arguments);
  };

  function fuCount() { var f = load(FKEY, {}); return Object.keys(f).filter(function (k) { return !f[k].done; }).length; }
  function refreshFuBadge() {
    var nav = document.querySelector('.nav-item[data-view="followups"]'); if (!nav) return;
    var c = fuCount(); var b = nav.querySelector('.v7-count');
    if (c > 0) { if (!b) { b = document.createElement('span'); b.className = 'v7-count'; nav.appendChild(b); } b.textContent = c; }
    else if (b) { b.remove(); }
  }

  /* ---------- Contacts + Quick Dial ---------- */
  function loadContacts() {
    var list = load(CKEY, []);
    vContacts.innerHTML =
      '<header class="view-head"><h2>Contacts</h2><p class="muted">Save the numbers you call often and dial them in one tap. Stored privately in this browser.</p></header>' +
      '<div class="card"><div class="v7-form">' +
        '<input id="v7cName" placeholder="Name">' +
        '<input id="v7cNum" placeholder="+9198XXXXXXXX">' +
        '<input id="v7cNote" placeholder="Note (optional)">' +
        '<button class="v7-mini pri" id="v7cAdd">Add contact</button>' +
      '</div><div id="v7cList"></div></div>';
    document.getElementById('v7cAdd').addEventListener('click', function () {
      var name = document.getElementById('v7cName').value.trim();
      var num = document.getElementById('v7cNum').value.trim();
      if (!name || !num) return T('Add a name and number');
      var l = load(CKEY, []); l.unshift({ id: Date.now(), name: name, num: num, note: document.getElementById('v7cNote').value.trim() });
      save(CKEY, l); T('Contact saved'); loadContacts();
    });
    renderContacts(list);
  }
  function renderContacts(list) {
    var host = document.getElementById('v7cList'); if (!host) return;
    if (!list.length) { host.innerHTML = '<p class="muted">No contacts yet. Add your first above.</p>'; return; }
    host.innerHTML = list.map(function (c) {
      return '<div class="v7-row"><div><b>' + E(c.name) + '</b> <span class="m">' + E(c.num) + '</span>' +
        (c.note ? '<div class="m">' + E(c.note) + '</div>' : '') + '</div>' +
        '<div class="v7-actions">' +
          '<button class="v7-mini pri" data-dial="' + E(c.num) + '">Dial</button>' +
          '<a class="v7-mini wa" target="_blank" rel="noopener" href="https://wa.me/' + digits(c.num) + '">WhatsApp</a>' +
          '<button class="v7-mini" data-del="' + c.id + '">Delete</button>' +
        '</div></div>';
    }).join('');
    host.querySelectorAll('[data-dial]').forEach(function (b) { b.addEventListener('click', function () { quickDial(b.getAttribute('data-dial')); }); });
    host.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () {
      save(CKEY, load(CKEY, []).filter(function (c) { return String(c.id) !== b.getAttribute('data-del'); })); loadContacts();
    }); });
  }
  function quickDial(num) {
    window.switchView('call');
    setTimeout(function () {
      var f = document.getElementById('callNumber');
      if (f) { f.value = num; f.focus(); f.dispatchEvent(new Event('input', { bubbles: true })); T('Number ready - press Place call'); }
    }, 120);
  }

  /* ---------- Follow-ups ---------- */
  function loadFollowups() {
    var f = load(FKEY, {});
    var items = Object.keys(f).map(function (k) { return Object.assign({ id: k }, f[k]); })
      .sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
    var pending = items.filter(function (i) { return !i.done; });
    var done = items.filter(function (i) { return i.done; });
    vFollow.innerHTML =
      '<header class="view-head"><h2>Follow-ups</h2><p class="muted">Calls you flagged to circle back on. Open any call, tick "Flag for follow-up", and it lands here.</p></header>' +
      '<div class="card"><h3 style="margin-top:0">Pending (' + pending.length + ')</h3><div id="v7fPending"></div></div>' +
      (done.length ? '<div class="card" style="margin-top:14px"><h3 style="margin-top:0">Done</h3><div id="v7fDone"></div></div>' : '');
    renderFu('v7fPending', pending, false);
    if (done.length) renderFu('v7fDone', done, true);
    refreshFuBadge();
  }
  function renderFu(hostId, arr, isDone) {
    var host = document.getElementById(hostId); if (!host) return;
    if (!arr.length) { host.innerHTML = '<p class="muted">Nothing here.</p>'; return; }
    host.innerHTML = arr.map(function (i) {
      var when = i.at ? new Date(i.at).toLocaleString() : '';
      return '<div class="v7-row"><div><b>' + E(i.number || ('Call ' + i.id)) + '</b>' +
        (i.name ? ' <span class="m">' + E(i.name) + '</span>' : '') +
        (i.note ? '<div class="m">' + E(i.note) + '</div>' : '') +
        '<div class="m">' + E(i.time || when) + '</div></div>' +
        '<div class="v7-actions">' +
          (i.number ? '<button class="v7-mini pri" data-dial="' + E(i.number) + '">Call</button>' +
            '<a class="v7-mini wa" target="_blank" rel="noopener" href="https://wa.me/' + digits(i.number) + '">WhatsApp</a>' : '') +
          (isDone ? '<button class="v7-mini" data-reopen="' + i.id + '">Reopen</button>' : '<button class="v7-mini" data-done="' + i.id + '">Mark done</button>') +
          '<button class="v7-mini" data-fdel="' + i.id + '">Delete</button>' +
        '</div></div>';
    }).join('');
    host.querySelectorAll('[data-dial]').forEach(function (b) { b.addEventListener('click', function () { quickDial(b.getAttribute('data-dial')); }); });
    host.querySelectorAll('[data-done]').forEach(function (b) { b.addEventListener('click', function () { setFu(b.getAttribute('data-done'), { done: true }); loadFollowups(); }); });
    host.querySelectorAll('[data-reopen]').forEach(function (b) { b.addEventListener('click', function () { setFu(b.getAttribute('data-reopen'), { done: false }); loadFollowups(); }); });
    host.querySelectorAll('[data-fdel]').forEach(function (b) { b.addEventListener('click', function () { var f = load(FKEY, {}); delete f[b.getAttribute('data-fdel')]; save(FKEY, f); loadFollowups(); }); });
  }
  function setFu(id, patch) { var f = load(FKEY, {}); f[id] = Object.assign({}, f[id] || {}, patch); save(FKEY, f); refreshFuBadge(); }

  /* ---------- inject follow-up control into the call drawer ---------- */
  var _openDrawer = window.openDrawer;
  if (typeof _openDrawer === 'function') {
    window.openDrawer = function (log) {
      var r = _openDrawer.apply(this, arguments);
      try { injectFu(log); } catch (e) {}
      return r;
    };
  }
  function injectFu(log) {
    if (!log) return;
    var body = document.getElementById('drawerBody'); if (!body) return;
    if (body.querySelector('.v7-fu')) return;
    var f = load(FKEY, {}); var cur = f[log.id] || {};
    var box = document.createElement('div'); box.className = 'v7-fu';
    box.innerHTML =
      '<label><input type="checkbox" id="v7fFlag" ' + (cur.note !== undefined && !cur.done ? 'checked' : '') + '> Flag this call for follow-up</label>' +
      '<textarea id="v7fNote" placeholder="Add a note (what to do next)...">' + E(cur.note || '') + '</textarea>' +
      '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><button class="v7-mini pri" id="v7fSave">Save follow-up</button>' +
      '<button class="v7-mini" id="v7fSum">&#128172; WhatsApp AI summary</button>' +
      (log.to_number ? '<a class="v7-mini wa" target="_blank" rel="noopener" href="https://wa.me/' + digits(log.to_number) + '">WhatsApp</a>' : '') + '</div>';
    body.appendChild(box);
    var sumBtn = document.getElementById('v7fSum');
    if (sumBtn) sumBtn.addEventListener('click', async function () {
      var to = prompt('Send the AI call summary on WhatsApp to (number with country code):', log.to_number || '');
      if (!to) return;
      sumBtn.disabled = true; sumBtn.textContent = 'Sending...';
      try { var r = await api('/calls/' + log.id + '/whatsapp-summary', { method: 'POST', body: { to: to } }); T(r && r.ok ? 'AI summary sent on WhatsApp' : 'Sent'); }
      catch (e) { T(e.message || 'Could not send', 5000); }
      finally { sumBtn.disabled = false; sumBtn.innerHTML = '&#128172; WhatsApp AI summary'; }
    });
    document.getElementById('v7fSave').addEventListener('click', function () {
      var flagged = document.getElementById('v7fFlag').checked;
      var note = document.getElementById('v7fNote').value.trim();
      var store = load(FKEY, {});
      if (flagged) {
        store[log.id] = { number: log.to_number || '', name: log.bot_name || '', time: log.time_of_call || '', note: note, at: Date.now(), done: false };
        T('Added to Follow-ups');
      } else { delete store[log.id]; T('Follow-up cleared'); }
      save(FKEY, store); refreshFuBadge();
    });
  }

  /* ---------- Analytics export / print (button injected into analytics view) ---------- */
  var vAnalytics = document.getElementById('view-analytics');
  if (vAnalytics) {
    new MutationObserver(function () {
      var head = vAnalytics.querySelector('.view-head');
      if (head && !head.querySelector('#v7expBtn') && !vAnalytics.classList.contains('hidden')) {
        var b = document.createElement('button'); b.id = 'v7expBtn'; b.className = 'v7-mini pri';
        b.style.cssText = 'margin-top:10px'; b.textContent = 'Export / print report';
        b.addEventListener('click', exportReport); head.appendChild(b);
      }
    }).observe(vAnalytics, { childList: true, subtree: true });
  }
  async function exportReport() {
    T('Building report...');
    var o = null; try { o = await API('/analytics/overview'); } catch (e) { return T('Could not build report'); }
    var sent = o.sentiment || {};
    var rows = (o.outcomes || []).map(function (x) { return '<tr><td>' + E(x[0].replace(/_/g, ' ')) + '</td><td style="text-align:right">' + x[1] + '</td></tr>'; }).join('');
    var intents = (o.topIntents || []).map(function (x) { return '<tr><td>' + E(x[0]) + '</td><td style="text-align:right">' + x[1] + '</td></tr>'; }).join('');
    var html =
      '<html><head><title>MNB Omni Caller - Call Analytics Report</title><meta charset="utf-8"><style>' +
      'body{font-family:Segoe UI,Arial,sans-serif;color:#111;padding:32px;max-width:760px;margin:0 auto}' +
      'h1{color:#ee6c0a;margin:0 0 4px}.sub{color:#666;margin-bottom:22px}' +
      '.kpis{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:22px}' +
      '.kpi{border:1px solid #eee;border-radius:12px;padding:14px 18px;min-width:140px}' +
      '.kpi .n{font-size:26px;font-weight:800}.kpi .l{color:#888;font-size:12px;text-transform:uppercase}' +
      'table{width:100%;border-collapse:collapse;margin:10px 0 22px}td{padding:8px 6px;border-bottom:1px solid #eee;font-size:14px}' +
      'h3{margin:18px 0 6px}.foot{color:#999;font-size:12px;border-top:1px solid #eee;padding-top:14px;margin-top:24px}' +
      '</style></head><body>' +
      '<h1>Call Analytics Report</h1><div class="sub">MNB Omni Caller by MNB Research &#183; ' + new Date().toLocaleString() + ' &#183; ' + E((o.vertical && o.vertical.name) || 'General') + '</div>' +
      '<div class="kpis">' +
        '<div class="kpi"><div class="n">' + (o.avgScore || 0) + '</div><div class="l">Avg score</div></div>' +
        '<div class="kpi"><div class="n">' + (o.conversion || 0) + '%</div><div class="l">Conversion</div></div>' +
        '<div class="kpi"><div class="n">' + ((o.totals && o.totals.connected) || 0) + '</div><div class="l">Connected</div></div>' +
        '<div class="kpi"><div class="n">' + (o.booked || 0) + '</div><div class="l">Booked</div></div>' +
      '</div>' +
      '<h3>Sentiment</h3><table><tr><td>Positive</td><td style="text-align:right">' + (sent.positive || 0) + '</td></tr>' +
      '<tr><td>Neutral</td><td style="text-align:right">' + (sent.neutral || 0) + '</td></tr>' +
      '<tr><td>Negative</td><td style="text-align:right">' + (sent.negative || 0) + '</td></tr></table>' +
      '<h3>Outcomes</h3><table>' + (rows || '<tr><td>No data</td><td></td></tr>') + '</table>' +
      '<h3>Top intents</h3><table>' + (intents || '<tr><td>No data</td><td></td></tr>') + '</table>' +
      '<div class="foot">Generated by MNB Omni Caller &#183; Shark Tank India featured &#183; DPIIT-recognised</div>' +
      '<script>window.onload=function(){setTimeout(function(){window.print()},350)}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (w) { w.document.write(html); w.document.close(); } else { T('Allow pop-ups to export the report'); }
  }

  /* keep the follow-up badge fresh on load */
  refreshFuBadge();
})();


/* =======================================================================
 * MNB Omni Caller - v8 layer
 * Bulk-campaign dashboard: an at-a-glance KPI ribbon + progress bars over
 * the existing Campaigns view. Additive and guarded.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced8) return; window.__mnbEnhanced8 = true;
  var css = document.createElement('style'); css.id = 'mnb-v8-css';
  css.textContent =
    '.v8-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:4px 0 18px}' +
    '.v8-k{background:var(--card,#15161a);border:1px solid var(--line,#26272e);border-radius:14px;padding:16px;text-align:center}' +
    '.v8-k .n{font-size:26px;font-weight:800;background:linear-gradient(135deg,#ee6c0a,#ffab5e);-webkit-background-clip:text;background-clip:text;color:transparent}' +
    '.v8-k .l{font-size:12px;color:var(--muted,#9aa0aa);text-transform:uppercase;letter-spacing:.3px;margin-top:4px}' +
    '.v8-prog{display:flex;flex-direction:column;gap:10px;margin:4px 0 18px}' +
    '.v8-pc{background:var(--card,#15161a);border:1px solid var(--line,#26272e);border-radius:12px;padding:12px 14px}' +
    '.v8-pc .top{display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px}' +
    '.v8-pc .bar{height:8px;border-radius:6px;background:var(--line,#26272e);overflow:hidden;margin-top:8px}' +
    '.v8-pc .bar>i{display:block;height:100%;background:linear-gradient(90deg,#ee6c0a,#ffab5e)}' +
    '.v8-pill{font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px}' +
    '.v8-run{background:rgba(37,208,245,.16);color:#25d0f5}.v8-done{background:rgba(67,224,143,.16);color:#43e08f}.v8-idle{background:rgba(148,163,184,.16);color:#94a3b8}';
  document.head.appendChild(css);

  function pill(status) {
    var s = String(status || '').toLowerCase();
    if (/run|progress|active|live/.test(s)) return '<span class="v8-pill v8-run">' + (status || 'running') + '</span>';
    if (/complete|done|finish/.test(s)) return '<span class="v8-pill v8-done">' + (status || 'completed') + '</span>';
    return '<span class="v8-pill v8-idle">' + (status || 'idle') + '</span>';
  }

  var orig = window.loadCampaigns;
  if (typeof orig === 'function') {
    window.loadCampaigns = function () { var r = orig.apply(this, arguments); setTimeout(inject, 450); return r; };
  }

  async function inject() {
    var host = document.getElementById('campaignsTable'); if (!host) return;
    var data; try { data = await api('/campaigns'); } catch (e) { return; }
    var list = data.bulk_calls || data.campaigns || (Array.isArray(data) ? data : []);
    var total = list.length;
    var running = list.filter(function (c) { return /run|progress|active|live/i.test(c.status || ''); }).length;
    var done = list.filter(function (c) { return /complete|done|finish/i.test(c.status || ''); }).length;
    var contacts = list.reduce(function (s, c) { return s + (Number(c.total_contacts || c.contacts_count || 0) || 0); }, 0);

    var rib = document.getElementById('v8ribbon'); if (rib) rib.remove();
    var box = document.createElement('div'); box.id = 'v8ribbon';
    var k = function (n, l) { return '<div class="v8-k"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; };
    var prog = list.slice(0, 12).map(function (c) {
      var tot = Number(c.total_contacts || c.contacts_count || 0) || 0;
      var doneN = Number(c.completed || c.calls_completed || c.done || 0) || 0;
      var s = String(c.status || '').toLowerCase();
      var w = tot ? Math.round(doneN / tot * 100) : (/complete|done|finish/.test(s) ? 100 : /run|progress|active|live/.test(s) ? 45 : 0);
      var nm = (c.name || c.campaign_name || ('Campaign ' + c.id));
      try { nm = scrub(nm); } catch (e) {}
      return '<div class="v8-pc"><div class="top"><b>' + nm + '</b>' + pill(c.status) + '</div>' +
        '<div class="bar"><i style="width:' + w + '%"></i></div>' +
        '<div style="font-size:12px;color:var(--muted,#9aa0aa);margin-top:6px">' + (tot ? (doneN + ' / ' + tot + ' contacts') : (tot + ' contacts')) + '</div></div>';
    }).join('');
    box.innerHTML = '<div class="v8-kpis">' + k(total, 'Campaigns') + k(running, 'Running') + k(done, 'Completed') + k(contacts, 'Total contacts') + '</div>' +
      (prog ? '<div class="v8-prog">' + prog + '</div>' : '');
    host.parentNode.insertBefore(box, host);
  }
})();


/* =======================================================================
 * MNB Omni Caller - v9 layer
 * Export Center (CSV/JSON), a theme + accent customizer, and a guided
 * product tour. All additive, guarded, frontend-only.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced9) return; window.__mnbEnhanced9 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var SC = function (s) { try { return scrub(s); } catch (e) { return s; } };

  var css = document.createElement('style'); css.id = 'mnb-v9-css';
  css.textContent =
    '.v9-fab{position:fixed;right:20px;bottom:20px;z-index:900;width:48px;height:48px;border-radius:50%;border:none;cursor:pointer;background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111;font-size:22px;box-shadow:0 10px 30px rgba(0,0,0,.4);transition:transform .2s}' +
    '.v9-fab:hover{transform:scale(1.08) rotate(20deg)}' +
    '.v9-panel{position:fixed;right:20px;bottom:78px;z-index:900;width:280px;background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:16px;padding:16px;box-shadow:0 20px 60px rgba(0,0,0,.5);display:none}' +
    '.v9-panel.on{display:block;animation:v9pop .18s ease}' +
    '@keyframes v9pop{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}' +
    '.v9-panel h4{margin:0 0 4px;font-size:14px}.v9-panel .m{color:var(--muted,#97938c);font-size:12px;margin-bottom:10px}' +
    '.v9-sw{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}' +
    '.v9-sw b{width:26px;height:26px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:.15s}' +
    '.v9-sw b:hover{transform:scale(1.15)}.v9-sw b.on{border-color:var(--text,#fff)}' +
    '.v9-mini{display:block;width:100%;text-align:left;border:1px solid var(--border,#2b2b2f);background:transparent;color:var(--text,#eee);border-radius:9px;padding:9px 11px;font-size:13px;cursor:pointer;margin-top:6px;font-weight:600}' +
    '.v9-mini:hover{border-color:var(--accent,#ff7a18);color:var(--accent,#ff7a18)}' +
    '.v9-exp{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:640px){.v9-exp{grid-template-columns:1fr}}' +
    '.v9-card{background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:14px;padding:18px}' +
    '.v9-card h3{margin:0 0 4px;font-size:15px}.v9-card p{color:var(--muted,#97938c);font-size:13px;margin-bottom:12px}' +
    '.v9-tour-ov{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.6);display:none}' +
    '.v9-tour-ov.on{display:block}' +
    '.v9-ring{position:absolute;border:2px solid var(--accent,#ff7a18);border-radius:12px;box-shadow:0 0 0 4px rgba(255,122,24,.25),0 0 0 4000px rgba(0,0,0,.55);transition:.25s}' +
    '.v9-tip{position:absolute;max-width:280px;background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:12px;padding:14px 16px;box-shadow:0 20px 50px rgba(0,0,0,.5)}' +
    '.v9-tip h4{margin:0 0 6px;font-size:15px}.v9-tip p{color:var(--muted,#97938c);font-size:13px;margin-bottom:12px}' +
    '.v9-tip .row{display:flex;justify-content:space-between;align-items:center}' +
    '.v9-tip .step{color:var(--muted,#97938c);font-size:12px}' +
    '.v9-tip button{border:none;border-radius:8px;padding:7px 14px;font-weight:700;font-size:13px;cursor:pointer;background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111}' +
    '.v9-tip .skip{background:transparent;color:var(--muted,#97938c);border:1px solid var(--border,#2b2b2f)}';
  document.head.appendChild(css);

  /* ---------------- Export Center (new view) ---------------- */
  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="plan"]');
    if (anchor && anchor.parentNode === nav) nav.insertBefore(a, anchor); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vExport = mkView('export');
  mkNav('export', '&#8681;', 'Export');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'export') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vExport) vExport.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'export'); });
      if (location.hash.replace('#', '') !== 'export') location.hash = 'export';
      loadExport(); return;
    }
    return prevSwitch.apply(this, arguments);
  };

  function dl(name, text, type) {
    var blob = new Blob([text], { type: type || 'text/csv' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
  function csvEsc(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""').replace(/<br\/?>(?=)/gi, ' ') + '"'; }
  function toCsv(cols, rows) { return [cols.join(',')].concat(rows.map(function (r) { return r.map(csvEsc).join(','); })).join('\n'); }
  function stamp() { return new Date().toISOString().slice(0, 10); }

  function loadExport() {
    vExport.innerHTML =
      '<header class="view-head"><h2>Export Center</h2><p class="muted">Download your data anytime - calls, contacts, follow-ups and analytics.</p></header>' +
      '<div class="v9-exp">' +
        card('Call logs', 'Every call with time, number, duration, status and sentiment.', 'v9xCalls', 'Export calls CSV') +
        card('Contacts', 'Your saved contacts and notes.', 'v9xContacts', 'Export contacts CSV') +
        card('Follow-ups', 'Flagged calls and their notes.', 'v9xFollow', 'Export follow-ups CSV') +
        card('Analytics', 'Full analytics snapshot as JSON.', 'v9xAna', 'Export analytics JSON') +
      '</div>';
    function card(h, p, id, label) { return '<div class="v9-card"><h3>' + h + '</h3><p>' + p + '</p><button class="v9-mini" id="' + id + '">' + label + '</button></div>'; }
    document.getElementById('v9xCalls').addEventListener('click', exportCalls);
    document.getElementById('v9xContacts').addEventListener('click', function () {
      var c = JSON.parse(localStorage.getItem('mnb_contacts') || '[]');
      dl('mnb-contacts-' + stamp() + '.csv', toCsv(['name', 'number', 'note'], c.map(function (x) { return [x.name, x.num, x.note || '']; })));
      T('Contacts exported');
    });
    document.getElementById('v9xFollow').addEventListener('click', function () {
      var f = JSON.parse(localStorage.getItem('mnb_followups') || '{}');
      var rows = Object.keys(f).map(function (k) { var i = f[k]; return [i.number || '', i.note || '', i.done ? 'done' : 'pending', i.time || (i.at ? new Date(i.at).toLocaleString() : '')]; });
      dl('mnb-followups-' + stamp() + '.csv', toCsv(['number', 'note', 'status', 'when'], rows));
      T('Follow-ups exported');
    });
    document.getElementById('v9xAna').addEventListener('click', async function () {
      try { var o = await api('/analytics/overview'); dl('mnb-analytics-' + stamp() + '.json', JSON.stringify(o, null, 2), 'application/json'); T('Analytics exported'); }
      catch (e) { T('Could not export analytics', 4000); }
    });
  }
  async function exportCalls() {
    T('Preparing calls...');
    var all = [];
    try {
      for (var p = 1; p <= 10; p++) {
        var d = await api('/calls/logs?pageno=' + p + '&pagesize=100');
        var rows = d.call_log_data || [];
        all = all.concat(rows);
        if (rows.length < 100) break;
      }
    } catch (e) {}
    if (!all.length) return T('No calls to export');
    var cols = ['time_of_call', 'bot_name', 'from_number', 'to_number', 'call_duration', 'call_status', 'sentiment_score'];
    var rows = all.map(function (r) { return cols.map(function (c) { return SC(r[c]); }); });
    dl('mnb-calls-' + stamp() + '.csv', toCsv(cols, rows));
    T('Exported ' + all.length + ' calls');
  }

  /* ---------------- Theme + accent customizer ---------------- */
  var ACCENTS = [
    ['#ff7a18', '#ffab5e'], ['#2f7bff', '#6aa8ff'], ['#8b5cff', '#b79bff'],
    ['#16b981', '#4fd6a8'], ['#ff5e9a', '#ff97c0'], ['#22c3e6', '#67e0f5']
  ];
  function applyAccent(pair) {
    var r = document.documentElement.style;
    r.setProperty('--accent', pair[0]); r.setProperty('--accent-2', pair[1]);
    r.setProperty('--accent-grad', 'linear-gradient(135deg,' + pair[0] + ',' + pair[1] + ')');
  }
  (function () { try { var s = JSON.parse(localStorage.getItem('mnb_accent')); if (s && s.length === 2) applyAccent(s); } catch (e) {} })();

  var fab = document.createElement('button'); fab.className = 'v9-fab'; fab.title = 'Personalize'; fab.innerHTML = '&#9881;';
  var panel = document.createElement('div'); panel.className = 'v9-panel';
  panel.innerHTML =
    '<h4>Personalize</h4><div class="m">Make it yours - saved to this browser.</div>' +
    '<div class="v9-sw" id="v9sw">' + ACCENTS.map(function (a, i) { return '<b data-i="' + i + '" style="background:linear-gradient(135deg,' + a[0] + ',' + a[1] + ')"></b>'; }).join('') + '</div>' +
    '<button class="v9-mini" id="v9theme">&#9681; Toggle light / dark</button>' +
    '<button class="v9-mini" id="v9tour">&#9658; Take the product tour</button>';
  document.body.appendChild(fab); document.body.appendChild(panel);
  fab.addEventListener('click', function () { panel.classList.toggle('on'); markAccent(); });
  panel.querySelector('#v9sw').addEventListener('click', function (e) {
    var b = e.target.closest('b[data-i]'); if (!b) return;
    var pair = ACCENTS[Number(b.getAttribute('data-i'))]; applyAccent(pair); save('mnb_accent', pair); markAccent(); T('Accent updated');
  });
  panel.querySelector('#v9theme').addEventListener('click', function () { try { toggleTheme(); } catch (e) {} });
  panel.querySelector('#v9tour').addEventListener('click', function () { panel.classList.remove('on'); startTour(); });
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function markAccent() {
    var cur = null; try { cur = JSON.parse(localStorage.getItem('mnb_accent')); } catch (e) {}
    panel.querySelectorAll('#v9sw b').forEach(function (b, i) { b.classList.toggle('on', cur ? (ACCENTS[i][0] === cur[0]) : i === 0); });
  }

  /* ---------------- Product tour ---------------- */
  var TOUR = [
    { v: 'overview', h: 'Your command center', p: 'Live KPIs, quick actions and a snapshot of every call your agents make.' },
    { v: 'call', h: 'Place a call', p: 'Pick an agent, enter a number and dispatch a real AI call in seconds.' },
    { v: 'studio', h: 'Agent Studio', p: 'Create and train your own AI agents - purpose, voice, knowledge and flow.' },
    { v: 'live', h: 'Live Calls', p: 'Watch calls as they happen with a rolling transcript and real-time AI read-out.' },
    { v: 'analytics', h: 'Call Analytics', p: 'AI scoring, sentiment, outcomes and coaching on every conversation.' },
    { v: 'contacts', h: 'Contacts', p: 'Save the numbers you call often and dial them in one tap.' },
    { v: 'followups', h: 'Follow-ups', p: 'Flag any call to circle back on - nothing slips through.' },
    { v: 'export', h: 'Export Center', p: 'Download your calls, contacts and analytics whenever you need.' }
  ];
  var ov = document.createElement('div'); ov.className = 'v9-tour-ov';
  ov.innerHTML = '<div class="v9-ring" id="v9ring"></div><div class="v9-tip" id="v9tip"></div>';
  document.body.appendChild(ov);
  var ti = 0;
  function startTour() { ti = 0; ov.classList.add('on'); showStep(); }
  function endTour() { ov.classList.remove('on'); try { localStorage.setItem('mnb_tour_done', '1'); } catch (e) {} }
  function showStep() {
    while (ti < TOUR.length && !document.querySelector('.nav-item[data-view="' + TOUR[ti].v + '"]')) ti++;
    if (ti >= TOUR.length) return endTour();
    var step = TOUR[ti];
    var el = document.querySelector('.nav-item[data-view="' + step.v + '"]');
    var r = el.getBoundingClientRect();
    var ring = document.getElementById('v9ring');
    ring.style.left = (r.left - 6) + 'px'; ring.style.top = (r.top - 6) + 'px';
    ring.style.width = (r.width + 12) + 'px'; ring.style.height = (r.height + 12) + 'px';
    var tip = document.getElementById('v9tip');
    tip.innerHTML = '<h4>' + E(step.h) + '</h4><p>' + E(step.p) + '</p>' +
      '<div class="row"><span class="step">' + (ti + 1) + ' / ' + TOUR.length + '</span><span>' +
      '<button class="skip" id="v9skip">Skip</button> <button id="v9next">' + (ti === TOUR.length - 1 ? 'Done' : 'Next') + '</button></span></div>';
    var top = Math.min(r.top, window.innerHeight - 160);
    tip.style.left = Math.min(r.right + 16, window.innerWidth - 300) + 'px';
    tip.style.top = top + 'px';
    document.getElementById('v9next').addEventListener('click', function () { ti++; showStep(); });
    document.getElementById('v9skip').addEventListener('click', endTour);
  }
  ov.addEventListener('click', function (e) { if (e.target === ov) endTour(); });

  /* auto-run the tour once for first-time users */
  setTimeout(function () {
    try { if (!localStorage.getItem('mnb_tour_done') && document.getElementById('appShell') && !document.getElementById('appShell').classList.contains('hidden')) startTour(); } catch (e) {}
  }, 2500);
})();


/* =======================================================================
 * MNB Omni Caller - v10 layer
 * Agent Templates gallery (ready-made vertical blueprints that pre-fill the
 * New Agent form) + Spotlight search (Ctrl/Cmd+/) across calls & contacts.
 * Additive, guarded, frontend-only.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced10) return; window.__mnbEnhanced10 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var digits = function (s) { return String(s || '').replace(/[^\d]/g, ''); };

  var css = document.createElement('style'); css.id = 'mnb-v10-css';
  css.textContent =
    '.v10-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}@media(max-width:900px){.v10-grid{grid-template-columns:1fr}}' +
    '.v10-tpl{background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:16px;padding:20px;transition:.2s}' +
    '.v10-tpl:hover{border-color:var(--accent,#ff7a18);transform:translateY(-3px)}' +
    '.v10-tpl .e{font-size:30px}.v10-tpl h3{margin:8px 0 4px;font-size:16px}.v10-tpl p{color:var(--muted,#97938c);font-size:13px;min-height:56px}' +
    '.v10-tpl button{border:none;border-radius:9px;padding:9px 14px;font-weight:700;font-size:13px;cursor:pointer;background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111;width:100%}' +
    '.v10-spot-ov{position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.5);display:none;align-items:flex-start;justify-content:center}' +
    '.v10-spot-ov.on{display:flex}' +
    '.v10-spot{width:min(620px,92vw);margin-top:12vh;background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.6);overflow:hidden}' +
    '.v10-spot input{width:100%;box-sizing:border-box;border:none;background:transparent;color:var(--text,#eee);padding:18px 20px;font-size:17px;outline:none;border-bottom:1px solid var(--border,#2b2b2f)}' +
    '.v10-res{max-height:50vh;overflow:auto}' +
    '.v10-r{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 18px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04)}' +
    '.v10-r:hover,.v10-r.sel{background:rgba(255,122,24,.10)}' +
    '.v10-r .m{color:var(--muted,#97938c);font-size:12px}' +
    '.v10-tag{font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px;background:rgba(255,122,24,.16);color:var(--accent-2,#ffa64d)}';
  document.head.appendChild(css);

  /* ---------------- view + nav ---------------- */
  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="studio"]');
    if (anchor && anchor.nextSibling) nav.insertBefore(a, anchor.nextSibling); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vTpl = mkView('templates');
  mkNav('templates', '&#9733;', 'Templates');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'templates') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vTpl) vTpl.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'templates'); });
      if (location.hash.replace('#', '') !== 'templates') location.hash = 'templates';
      loadTemplates(); return;
    }
    return prevSwitch.apply(this, arguments);
  };

  /* ---------------- Agent Templates ---------------- */
  var TPL = [
    { e: '&#127869;&#65039;', name: 'Restaurant Reservation Assistant', desc: 'Takes table bookings and orders, captures party size, timing and special requests.',
      welcome: 'Hi, thanks for calling! I can help you book a table or place an order. How can I help today?',
      purpose: 'You take restaurant reservations and orders. Capture party size, preferred date and time, occasion and any special requests. Confirm the booking clearly and offer to send a WhatsApp confirmation. Be warm, quick and friendly.' },
    { e: '&#129466;', name: 'Clinic Appointment Desk', desc: 'Books and reschedules appointments, triages urgency, captures patient details.',
      welcome: 'Hello, thank you for calling. I can help you book or reschedule an appointment. How can I help?',
      purpose: 'You are a clinic front-desk assistant. Book or reschedule appointments; capture the department/specialty, preferred date and time, whether the patient is new or returning, and the reason. Politely flag anything urgent for immediate attention.' },
    { e: '&#127968;', name: 'Real Estate Qualifier', desc: 'Qualifies buyers and renters and books site visits.',
      welcome: 'Hi! Thanks for your interest. I can help you find the right property. May I ask a few quick questions?',
      purpose: 'You qualify real-estate leads. Capture budget, preferred locality, configuration (BHK), whether they want to buy or rent, and their timeline. If they are a good fit, book a site visit and confirm contact details.' },
    { e: '&#128722;', name: 'E-commerce Order & Support', desc: 'Confirms COD orders, recovers carts, handles returns and order status.',
      welcome: 'Hi, thanks for shopping with us! I can help with your order. What do you need?',
      purpose: 'You handle e-commerce order support. Confirm COD orders, recover abandoned carts by offering help, handle return/replacement requests, and answer order-status questions. Capture the order ID and resolution.' },
    { e: '&#127891;', name: 'Admissions Counselor', desc: 'Captures course interest and books counselling or demo sessions.',
      welcome: 'Hello! Thanks for your interest in our courses. I can help you with details and admissions.',
      purpose: 'You are an admissions counselor. Capture the course of interest, the admission stage, and any fee questions. Answer clearly and book a counselling or demo session. Capture the city and preferred contact time.' },
    { e: '&#127974;', name: 'Lending & Loan Assistant', desc: 'Qualifies eligibility and progresses loan applications or collections.',
      welcome: 'Hi, thanks for calling. I can help with your loan enquiry. May I ask a few details?',
      purpose: 'You assist with lending. Capture the loan/product type, ticket size, KYC stage and EMI/collection status. Assess basic eligibility politely and progress the application or arrange a callback with a specialist.' }
  ];
  function loadTemplates() {
    vTpl.innerHTML =
      '<header class="view-head"><h2>Agent Templates</h2><p class="muted">Start from a proven blueprint - pick one and it pre-fills a new agent you can tweak and train.</p></header>' +
      '<div class="v10-grid">' + TPL.map(function (t, i) {
        return '<div class="v10-tpl"><div class="e">' + t.e + '</div><h3>' + E(t.name) + '</h3><p>' + E(t.desc) + '</p>' +
          '<button data-tpl="' + i + '">Use this template</button></div>';
      }).join('') + '</div>';
    vTpl.querySelectorAll('[data-tpl]').forEach(function (b) {
      b.addEventListener('click', function () { useTemplate(TPL[Number(b.getAttribute('data-tpl'))]); });
    });
  }
  function useTemplate(t) {
    if (typeof openAgentModal !== 'function') { T('Open Agent Studio to create an agent'); return; }
    openAgentModal();
    setTimeout(function () {
      var n = document.getElementById('naName'), w = document.getElementById('naWelcome'), p = document.getElementById('naPurpose');
      if (n) n.value = t.name; if (w) w.value = t.welcome; if (p) p.value = t.purpose;
      if (n) n.focus();
      T('Template loaded - review and Create agent');
    }, 120);
  }

  /* ---------------- Spotlight search (Ctrl/Cmd + /) ---------------- */
  var ov = document.createElement('div'); ov.className = 'v10-spot-ov';
  ov.innerHTML = '<div class="v10-spot"><input id="v10q" placeholder="Search calls and contacts..." autocomplete="off"><div class="v10-res" id="v10res"></div></div>';
  document.body.appendChild(ov);
  var callCache = null, sel = 0, results = [];
  function openSpot() {
    ov.classList.add('on'); var q = document.getElementById('v10q'); q.value = ''; document.getElementById('v10res').innerHTML = '<div class="v10-r"><span class="m">Type to search your recent calls and saved contacts</span></div>';
    q.focus(); if (!callCache) primeCalls();
  }
  function closeSpot() { ov.classList.remove('on'); }
  async function primeCalls() {
    try { var d = await api('/calls/logs?pageno=1&pagesize=100'); callCache = d.call_log_data || []; } catch (e) { callCache = []; }
  }
  function contacts() { try { return JSON.parse(localStorage.getItem('mnb_contacts') || '[]'); } catch (e) { return []; } }
  function run(q) {
    q = (q || '').toLowerCase().trim(); var out = [];
    if (q) {
      contacts().forEach(function (c) {
        if ((c.name + ' ' + c.num + ' ' + (c.note || '')).toLowerCase().indexOf(q) >= 0)
          out.push({ type: 'Contact', title: c.name, sub: c.num, num: c.num });
      });
      (callCache || []).forEach(function (l) {
        var hay = ((l.to_number || '') + ' ' + (l.from_number || '') + ' ' + (l.call_status || '') + ' ' + (l.bot_name || '')).toLowerCase();
        if (hay.indexOf(q) >= 0) out.push({ type: 'Call', title: l.to_number || ('Call ' + l.id), sub: (l.call_status || '') + ' - ' + (l.time_of_call || ''), log: l });
      });
    }
    results = out.slice(0, 40); sel = 0; render();
  }
  function render() {
    var host = document.getElementById('v10res');
    if (!results.length) { host.innerHTML = '<div class="v10-r"><span class="m">No matches</span></div>'; return; }
    host.innerHTML = results.map(function (r, i) {
      return '<div class="v10-r' + (i === sel ? ' sel' : '') + '" data-i="' + i + '"><div><b>' + E(r.title) + '</b><div class="m">' + E(r.sub) + '</div></div><span class="v10-tag">' + r.type + '</span></div>';
    }).join('');
    host.querySelectorAll('[data-i]').forEach(function (el) { el.addEventListener('click', function () { pick(results[Number(el.getAttribute('data-i'))]); }); });
  }
  function pick(r) {
    if (!r) return; closeSpot();
    if (r.type === 'Contact') {
      window.switchView('call');
      setTimeout(function () { var f = document.getElementById('callNumber'); if (f) { f.value = r.num; f.focus(); } }, 150);
    } else if (r.log) {
      if (typeof openDrawer === 'function') { window.switchView('logs'); setTimeout(function () { openDrawer(r.log); }, 200); }
      else window.switchView('logs');
    }
  }
  document.getElementById('v10q').addEventListener('input', function (e) { run(e.target.value); });
  ov.addEventListener('click', function (e) { if (e.target === ov) closeSpot(); });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.code === 'Slash')) { e.preventDefault(); openSpot(); return; }
    if (!ov.classList.contains('on')) return;
    if (e.key === 'Escape') { closeSpot(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(results.length - 1, sel + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === 'Enter') { pick(results[sel]); }
  });
})();


/* =======================================================================
 * MNB Omni Caller - v11 layer
 * Reminders hub: schedule callbacks/tasks with due date-times, get a live
 * sidebar badge for what's due, and optional desktop notifications.
 * Additive, guarded, frontend-only (synced to this browser).
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced11) return; window.__mnbEnhanced11 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var KEY = 'mnb_reminders';
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} refreshBadge(); }

  var css = document.createElement('style'); css.id = 'mnb-v11-css';
  css.textContent =
    '.v11-form{display:grid;grid-template-columns:1.6fr 1fr 1fr auto;gap:8px;margin-bottom:16px}@media(max-width:760px){.v11-form{grid-template-columns:1fr}}' +
    '.v11-form input{background:var(--bg,#0e0f12);border:1px solid var(--border,#2b2b2f);color:var(--text,#eee);border-radius:9px;padding:10px 12px;font-size:13px}' +
    '.v11-row{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--border,#2b2b2f);border-radius:12px;padding:12px 14px;background:var(--panel,#141416);margin-bottom:8px}' +
    '.v11-row.due{border-color:#e05d55;box-shadow:0 0 0 1px rgba(224,93,85,.3)}' +
    '.v11-row.soon{border-color:var(--accent,#ff7a18)}' +
    '.v11-row .m{color:var(--muted,#97938c);font-size:12px}' +
    '.v11-mini{border:1px solid var(--border,#2b2b2f);background:transparent;color:var(--text,#eee);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;font-weight:600}' +
    '.v11-mini:hover{border-color:var(--accent,#ff7a18);color:var(--accent,#ff7a18)}' +
    '.v11-mini.pri{background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111;border:none}' +
    '.v11-mini.wa{border-color:#25D366;color:#25D366}' +
    '.v11-badge{display:inline-block;min-width:18px;height:18px;line-height:18px;text-align:center;background:#e05d55;color:#fff;border-radius:9px;font-size:11px;font-weight:800;margin-left:6px;padding:0 5px}' +
    '.v11-sechdr{font-size:12px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted,#97938c);margin:14px 0 6px}';
  document.head.appendChild(css);

  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="plan"]');
    if (anchor && anchor.parentNode === nav) nav.insertBefore(a, anchor); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vRem = mkView('reminders');
  mkNav('reminders', '&#9200;', 'Reminders');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'reminders') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vRem) vRem.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'reminders'); });
      if (location.hash.replace('#', '') !== 'reminders') location.hash = 'reminders';
      loadReminders(); return;
    }
    return prevSwitch.apply(this, arguments);
  };

  function fmt(ts) { if (!ts) return ''; try { return new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; } }
  function dueCount() { var now = Date.now(); return load().filter(function (r) { return !r.done && r.when && r.when <= now; }).length; }
  function refreshBadge() {
    var nav = document.querySelector('.nav-item[data-view="reminders"]'); if (!nav) return;
    var c = dueCount(); var b = nav.querySelector('.v11-badge');
    if (c > 0) { if (!b) { b = document.createElement('span'); b.className = 'v11-badge'; nav.appendChild(b); } b.textContent = c; }
    else if (b) { b.remove(); }
  }

  function loadReminders() {
    vRem.innerHTML =
      '<header class="view-head"><h2>Reminders</h2><p class="muted">Schedule callbacks and tasks. You will get a badge - and a desktop alert - when one is due.</p></header>' +
      '<div class="card"><div class="v11-form">' +
        '<input id="v11t" placeholder="What to do (e.g. call Aarav back)">' +
        '<input id="v11n" placeholder="Number (optional)">' +
        '<input id="v11d" type="datetime-local">' +
        '<button class="v11-mini pri" id="v11add">Add reminder</button>' +
      '</div><div id="v11list"></div></div>';
    document.getElementById('v11add').addEventListener('click', function () {
      var t = document.getElementById('v11t').value.trim();
      var n = document.getElementById('v11n').value.trim();
      var d = document.getElementById('v11d').value;
      if (!t) return T('Add a description');
      var when = d ? new Date(d).getTime() : 0;
      var l = load(); l.push({ id: Date.now(), text: t, num: n, when: when, done: false, notified: false }); save(l);
      askNotify(); T('Reminder added'); loadReminders();
    });
    render();
  }
  function render() {
    var host = document.getElementById('v11list'); if (!host) return;
    var l = load().filter(function (r) { return !r.done; }).sort(function (a, b) { return (a.when || 9e15) - (b.when || 9e15); });
    var done = load().filter(function (r) { return r.done; });
    if (!l.length && !done.length) { host.innerHTML = '<p class="muted">No reminders yet.</p>'; return; }
    var now = Date.now();
    var html = l.map(function (r) {
      var cls = r.when && r.when <= now ? ' due' : (r.when && r.when - now < 3600000 ? ' soon' : '');
      var digits = (r.num || '').replace(/[^\d]/g, '');
      return '<div class="v11-row' + cls + '"><div><b>' + E(r.text) + '</b>' + (r.num ? ' <span class="m">' + E(r.num) + '</span>' : '') +
        '<div class="m">' + (r.when ? fmt(r.when) : 'No time set') + (r.when && r.when <= now ? ' - DUE' : '') + '</div></div>' +
        '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
          (r.num ? '<button class="v11-mini pri" data-call="' + E(r.num) + '">Call</button><a class="v11-mini wa" target="_blank" rel="noopener" href="https://wa.me/' + digits + '">WhatsApp</a>' : '') +
          '<button class="v11-mini" data-done="' + r.id + '">Done</button><button class="v11-mini" data-del="' + r.id + '">Delete</button>' +
        '</div></div>';
    }).join('');
    if (done.length) html += '<div class="v11-sechdr">Completed</div>' + done.slice(-10).reverse().map(function (r) {
      return '<div class="v11-row" style="opacity:.6"><div><b>' + E(r.text) + '</b><div class="m">' + fmt(r.when) + '</div></div><button class="v11-mini" data-del="' + r.id + '">Delete</button></div>';
    }).join('');
    host.innerHTML = html;
    host.querySelectorAll('[data-call]').forEach(function (b) { b.addEventListener('click', function () {
      window.switchView('call'); setTimeout(function () { var f = document.getElementById('callNumber'); if (f) { f.value = b.getAttribute('data-call'); f.focus(); } }, 150);
    }); });
    host.querySelectorAll('[data-done]').forEach(function (b) { b.addEventListener('click', function () { var l = load(); var r = l.filter(function (x) { return String(x.id) === b.getAttribute('data-done'); })[0]; if (r) r.done = true; save(l); render(); }); });
    host.querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () { save(load().filter(function (x) { return String(x.id) !== b.getAttribute('data-del'); })); render(); }); });
  }

  function askNotify() { try { if (window.Notification && Notification.permission === 'default') Notification.requestPermission(); } catch (e) {} }
  function checkDue() {
    var l = load(); var now = Date.now(); var changed = false;
    l.forEach(function (r) {
      if (!r.done && !r.notified && r.when && r.when <= now) {
        r.notified = true; changed = true;
        T('Reminder due: ' + r.text, 6000);
        try { if (window.Notification && Notification.permission === 'granted') new Notification('MNB Omni Caller - reminder due', { body: r.text + (r.num ? ' (' + r.num + ')' : '') }); } catch (e) {}
      }
    });
    if (changed) { try { localStorage.setItem(KEY, JSON.stringify(l)); } catch (e) {} }
    refreshBadge();
  }
  setInterval(checkDue, 60000);
  setTimeout(function () { refreshBadge(); checkDue(); }, 3000);
})();


/* =======================================================================
 * MNB Omni Caller - v12 layer
 * Do-Not-Call safeguard: a managed blocklist, a warning before dialing a
 * blocked number, and one-click "block" from any call. Compliance-friendly.
 * Additive, guarded, frontend-only.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced12) return; window.__mnbEnhanced12 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var KEY = 'mnb_dnc';
  var d10 = function (s) { var d = String(s || '').replace(/[^\d]/g, ''); return d.length > 10 ? d.slice(-10) : d; };
  function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} refreshBadge(); }
  function isDnc(num) { var k = d10(num); if (!k) return false; return load().some(function (x) { return d10(x.num) === k; }); }
  function addDnc(num, reason) { if (!num) return; var l = load(); if (isDnc(num)) return; l.unshift({ num: num, reason: reason || '', at: Date.now() }); save(l); }

  var css = document.createElement('style'); css.id = 'mnb-v12-css';
  css.textContent =
    '.v12-form{display:grid;grid-template-columns:1fr 1.6fr auto;gap:8px;margin-bottom:16px}@media(max-width:640px){.v12-form{grid-template-columns:1fr}}' +
    '.v12-form input{background:var(--bg,#0e0f12);border:1px solid var(--border,#2b2b2f);color:var(--text,#eee);border-radius:9px;padding:10px 12px;font-size:13px}' +
    '.v12-row{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--border,#2b2b2f);border-radius:12px;padding:12px 14px;background:var(--panel,#141416);margin-bottom:8px}' +
    '.v12-row .m{color:var(--muted,#97938c);font-size:12px}' +
    '.v12-mini{border:1px solid var(--border,#2b2b2f);background:transparent;color:var(--text,#eee);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;font-weight:600}' +
    '.v12-mini:hover{border-color:#e05d55;color:#e05d55}' +
    '.v12-mini.pri{background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111;border:none}' +
    '.v12-mini.blk{border-color:#e05d55;color:#e05d55}';
  document.head.appendChild(css);

  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="plan"]');
    if (anchor && anchor.parentNode === nav) nav.insertBefore(a, anchor); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vDnc = mkView('blocklist');
  mkNav('blocklist', '&#128683;', 'Do-Not-Call');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'blocklist') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vDnc) vDnc.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'blocklist'); });
      if (location.hash.replace('#', '') !== 'blocklist') location.hash = 'blocklist';
      loadDnc(); return;
    }
    return prevSwitch.apply(this, arguments);
  };

  function refreshBadge() {
    var nav = document.querySelector('.nav-item[data-view="blocklist"]'); if (!nav) return;
    var c = load().length; var b = nav.querySelector('.v12-b');
    if (c > 0) { if (!b) { b = document.createElement('span'); b.className = 'v12-b'; b.style.cssText = 'margin-left:6px;font-size:11px;color:var(--muted,#97938c)'; nav.appendChild(b); } b.textContent = '(' + c + ')'; }
    else if (b) { b.remove(); }
  }

  function loadDnc() {
    var l = load();
    vDnc.innerHTML =
      '<header class="view-head"><h2>Do-Not-Call list</h2><p class="muted">Numbers here are blocked from dialing - you get a warning before any call. Great for compliance and opt-outs.</p></header>' +
      '<div class="card"><div class="v12-form">' +
        '<input id="v12n" placeholder="+9198XXXXXXXX">' +
        '<input id="v12r" placeholder="Reason (optional) - e.g. asked not to be called">' +
        '<button class="v12-mini pri" id="v12add">Block number</button>' +
      '</div><div id="v12list"></div></div>';
    document.getElementById('v12add').addEventListener('click', function () {
      var n = document.getElementById('v12n').value.trim(); if (!n) return T('Enter a number');
      addDnc(n, document.getElementById('v12r').value.trim()); T('Number blocked'); loadDnc();
    });
    var host = document.getElementById('v12list');
    host.innerHTML = l.length ? l.map(function (x) {
      return '<div class="v12-row"><div><b>' + E(x.num) + '</b>' + (x.reason ? '<div class="m">' + E(x.reason) + '</div>' : '') +
        '<div class="m">Blocked ' + (x.at ? new Date(x.at).toLocaleDateString() : '') + '</div></div>' +
        '<button class="v12-mini" data-un="' + E(x.num) + '">Remove</button></div>';
    }).join('') : '<p class="muted">No blocked numbers. Add one above, or block from any call.</p>';
    host.querySelectorAll('[data-un]').forEach(function (b) {
      b.addEventListener('click', function () { var k = d10(b.getAttribute('data-un')); save(load().filter(function (x) { return d10(x.num) !== k; })); loadDnc(); });
    });
  }

  /* ---- guard the dialer ---- */
  var _dispatch = window.dispatchCall;
  if (typeof _dispatch === 'function') {
    window.dispatchCall = function () {
      try {
        var f = document.getElementById('callNumber');
        if (f && isDnc(f.value)) {
          if (!confirm('This number is on your Do-Not-Call list.\n\nCall anyway?')) { T('Call blocked (Do-Not-Call)'); return; }
        }
      } catch (e) {}
      return _dispatch.apply(this, arguments);
    };
  }

  /* ---- add a "Block number" action into the call drawer ---- */
  var _openDrawer = window.openDrawer;
  if (typeof _openDrawer === 'function') {
    window.openDrawer = function (log) {
      var r = _openDrawer.apply(this, arguments);
      try {
        var body = document.getElementById('drawerBody');
        if (body && log && log.to_number && !body.querySelector('.v12-blkwrap')) {
          var wrap = document.createElement('div'); wrap.className = 'v12-blkwrap'; wrap.style.marginTop = '10px';
          var blocked = isDnc(log.to_number);
          wrap.innerHTML = '<button class="v12-mini blk" id="v12blk">' + (blocked ? '&#9989; On Do-Not-Call list' : '&#128683; Add to Do-Not-Call') + '</button>';
          body.appendChild(wrap);
          var btn = document.getElementById('v12blk');
          if (btn && !blocked) btn.addEventListener('click', function () { addDnc(log.to_number, 'Blocked from call log'); btn.innerHTML = '&#9989; On Do-Not-Call list'; btn.disabled = true; T('Added to Do-Not-Call'); });
        }
      } catch (e) {}
      return r;
    };
  }

  setTimeout(refreshBadge, 2500);
})();


/* =======================================================================
 * MNB Omni Caller - v13 layer
 * Recent-numbers quick-redial on the Place a Call screen + a Help / What's
 * New center listing every feature and shortcut. Additive, guarded.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced13) return; window.__mnbEnhanced13 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var RKEY = 'mnb_recent_dials';

  var css = document.createElement('style'); css.id = 'mnb-v13-css';
  css.textContent =
    '.v13-recent{margin:10px 0 4px}.v13-recent .lbl{font-size:12px;color:var(--muted,#97938c);margin-bottom:6px}' +
    '.v13-chip{display:inline-block;background:var(--panel-2,#1d1d20);border:1px solid var(--border,#2b2b2f);color:var(--text,#eee);border-radius:20px;padding:6px 12px;font-size:13px;margin:0 6px 6px 0;cursor:pointer}' +
    '.v13-chip:hover{border-color:var(--accent,#ff7a18);color:var(--accent,#ff7a18)}' +
    '.v13-help h3{margin:18px 0 8px;font-size:15px}.v13-help .kbd{display:inline-block;background:var(--panel-2,#1d1d20);border:1px solid var(--border,#2b2b2f);border-radius:6px;padding:2px 8px;font-size:12px;font-family:monospace}' +
    '.v13-feat{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}' +
    '.v13-fc{background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:12px;padding:14px}' +
    '.v13-fc b{display:block;margin-bottom:3px}.v13-fc span{color:var(--muted,#97938c);font-size:13px}';
  document.head.appendChild(css);

  /* ---------------- recent redial ---------------- */
  function loadR() { try { return JSON.parse(localStorage.getItem(RKEY)) || []; } catch (e) { return []; } }
  function pushR(num) {
    num = String(num || '').trim(); if (!num) return;
    var l = loadR().filter(function (x) { return x !== num; }); l.unshift(num); l = l.slice(0, 8);
    try { localStorage.setItem(RKEY, JSON.stringify(l)); } catch (e) {}
  }
  var _dispatch = window.dispatchCall;
  if (typeof _dispatch === 'function') {
    window.dispatchCall = function () {
      try { var f = document.getElementById('callNumber'); if (f && f.value.trim()) pushR(f.value.trim()); } catch (e) {}
      return _dispatch.apply(this, arguments);
    };
  }
  function renderRecent() {
    var input = document.getElementById('callNumber'); if (!input) return;
    var host = document.getElementById('v13recent');
    var l = loadR();
    if (!l.length) { if (host) host.remove(); return; }
    if (!host) { host = document.createElement('div'); host.id = 'v13recent'; host.className = 'v13-recent'; input.parentNode.insertBefore(host, input.nextSibling); }
    host.innerHTML = '<div class="lbl">Recent numbers</div>' + l.map(function (n) { return '<span class="v13-chip" data-n="' + E(n) + '">' + E(n) + '</span>'; }).join('');
    host.querySelectorAll('[data-n]').forEach(function (c) { c.addEventListener('click', function () { input.value = c.getAttribute('data-n'); input.focus(); }); });
  }

  /* ---------------- Help / What's New center ---------------- */
  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label; nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vHelp = mkView('help');
  mkNav('help', '&#9432;', 'Help');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'help') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vHelp) vHelp.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'help'); });
      if (location.hash.replace('#', '') !== 'help') location.hash = 'help';
      loadHelp(); return;
    }
    var r = prevSwitch.apply(this, arguments);
    if (view === 'call') setTimeout(renderRecent, 120);
    return r;
  };

  var FEATURES = [
    ['Place a Call', 'Dispatch real AI calls with custom context.'],
    ['Agent Studio', 'Create and train your own AI agents.'],
    ['Templates', 'Start an agent from a ready-made vertical blueprint.'],
    ['Live Calls', 'Watch calls live with transcript + AI read-out.'],
    ['Call Analytics', 'AI scoring, sentiment, outcomes, coaching, export.'],
    ['Contacts', 'Saved numbers with one-tap dial (synced to your account).'],
    ['Follow-ups', 'Flag calls to circle back on, with notes.'],
    ['Reminders', 'Schedule callbacks with due alerts + desktop notifications.'],
    ['Do-Not-Call', 'Block numbers; get a warning before dialing them.'],
    ['Campaigns', 'Bulk outbound with a KPI + progress dashboard.'],
    ['Export Center', 'Download calls, contacts, follow-ups and analytics.'],
    ['Integrations', 'WhatsApp, Razorpay, Sheets, Slack, Groq/Gemini (admin).'],
    ['Personalize', 'Accent colors, light/dark, and a guided tour (gear button).']
  ];
  function loadHelp() {
    vHelp.innerHTML =
      '<header class="view-head"><h2>Help &amp; What\'s New</h2><p class="muted">Everything MNB Omni Caller can do, and the shortcuts to move fast.</p></header>' +
      '<div class="card v13-help">' +
        '<h3>Keyboard shortcuts</h3>' +
        '<p><span class="kbd">Ctrl / Cmd + K</span> Command palette &nbsp; ' +
        '<span class="kbd">Ctrl / Cmd + /</span> Spotlight search &nbsp; ' +
        '<span class="kbd">?</span> Shortcuts help &nbsp; ' +
        '<span class="kbd">1 - 9</span> Jump to a section</p>' +
        '<h3 style="margin-top:20px">Everything in your platform</h3>' +
        '<div class="v13-feat">' + FEATURES.map(function (f) { return '<div class="v13-fc"><b>' + E(f[0]) + '</b><span>' + E(f[1]) + '</span></div>'; }).join('') + '</div>' +
        '<p class="muted" style="margin-top:18px">Tip: open the <b>&#9881; gear</b> (bottom-right) to change accent colors, toggle light/dark, or replay the product tour.</p>' +
      '</div>';
  }

  setTimeout(renderRecent, 1500);
})();


/* =======================================================================
 * MNB Omni Caller - v14 layer
 * AI Coaching Inbox (aggregated coaching tips across recent calls) +
 * Overview mission-control ribbon (greeting, live clock, key counters).
 * Additive, guarded, frontend-only.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced14) return; window.__mnbEnhanced14 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };

  var css = document.createElement('style'); css.id = 'mnb-v14-css';
  css.textContent =
    '.v14-mc{display:grid;grid-template-columns:1.4fr repeat(4,1fr);gap:12px;margin-bottom:18px}@media(max-width:900px){.v14-mc{grid-template-columns:1fr 1fr}}' +
    '.v14-hello{background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111;border-radius:16px;padding:16px 18px}' +
    '.v14-hello .g{font-size:18px;font-weight:800}.v14-hello .c{font-size:13px;opacity:.85;margin-top:2px}' +
    '.v14-mk{background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:16px;padding:14px 16px}' +
    '.v14-mk .n{font-size:24px;font-weight:800}.v14-mk .l{font-size:11px;color:var(--muted,#97938c);text-transform:uppercase;letter-spacing:.3px;margin-top:2px}' +
    '.v14-mk.due .n{color:#e05d55}' +
    '.v14-co{border:1px solid var(--border,#2b2b2f);border-radius:14px;padding:16px;margin-bottom:10px;background:var(--panel,#141416)}' +
    '.v14-co .h{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:8px}' +
    '.v14-co ul{margin:6px 0 0;padding-left:18px}.v14-co li{margin:3px 0;font-size:14px}' +
    '.v14-b{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px}' +
    '.v14-pos{background:rgba(67,185,127,.18);color:#43b97f}.v14-neg{background:rgba(224,93,85,.18);color:#e05d55}.v14-neu{background:rgba(148,163,184,.18);color:#94a3b8}';
  document.head.appendChild(css);

  function badge(s) { s = (s || 'neutral').toLowerCase(); var c = s === 'positive' ? 'v14-pos' : s === 'negative' ? 'v14-neg' : 'v14-neu'; return '<span class="v14-b ' + c + '">' + E(s) + '</span>'; }

  /* ---------------- Coaching Inbox (new view) ---------------- */
  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label, before) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="' + before + '"]');
    if (anchor && anchor.nextSibling) nav.insertBefore(a, anchor.nextSibling); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vCo = mkView('coaching');
  mkNav('coaching', '&#128161;', 'Coaching', 'analytics');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'coaching') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vCo) vCo.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'coaching'); });
      if (location.hash.replace('#', '') !== 'coaching') location.hash = 'coaching';
      loadCoaching(); return;
    }
    var r = prevSwitch.apply(this, arguments);
    if (view === 'overview') setTimeout(ensureRibbon, 150);
    return r;
  };

  async function loadCoaching() {
    vCo.innerHTML = '<header class="view-head"><h2>AI Coaching Inbox</h2><p class="muted">Concrete, per-call coaching from the AI across your recent conversations - so every call gets better.</p></header><div id="v14co"><p class="muted">Analyzing recent calls...</p></div>';
    var rows = [];
    try { var d = await api('/calls/logs?pageno=1&pagesize=20'); rows = (d.call_log_data || []).filter(function (r) { return (r.call_conversation || r.transcript || '').length > 12; }).slice(0, 12); } catch (e) {}
    if (!rows.length) { document.getElementById('v14co').innerHTML = '<p class="muted">No completed calls with transcripts yet. Place a few calls and coaching will appear here.</p>'; return; }
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      try { var a = await api('/analytics/call/' + rows[i].id); out.push({ log: rows[i], a: a.analysis || {} }); } catch (e) {}
    }
    var host = document.getElementById('v14co'); if (!host) return;
    host.innerHTML = out.map(function (x) {
      var tips = (x.a.coaching || []).map(function (c) { return '<li>' + E(c) + '</li>'; }).join('');
      return '<div class="v14-co"><div class="h"><b>' + E(x.log.to_number || ('Call ' + x.log.id)) + '</b>' +
        '<span>' + badge(x.a.sentiment) + ' <span class="v14-b v14-neu">score ' + (x.a.score || 0) + '</span></span></div>' +
        '<div class="muted" style="font-size:13px">' + E(x.a.summary || '') + '</div>' +
        (tips ? '<ul>' + tips + '</ul>' : '') + '</div>';
    }).join('');
  }

  /* ---------------- Overview mission-control ribbon ---------------- */
  var lastRibbon = 0, ribbonCache = null;
  function greeting() { var h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
  function lsLen(key, filterDone) {
    try { var v = JSON.parse(localStorage.getItem(key) || (key === 'mnb_followups' ? '{}' : '[]'));
      if (key === 'mnb_followups') return Object.keys(v).filter(function (k) { return !v[k].done; }).length;
      if (key === 'mnb_reminders') { var now = Date.now(); return v.filter(function (r) { return !r.done && r.when && r.when <= now; }).length; }
      return (v || []).length;
    } catch (e) { return 0; }
  }
  function ensureRibbon() {
    var ov = document.getElementById('view-overview'); if (!ov || ov.classList.contains('hidden')) return;
    if (document.getElementById('v14ribbon')) { updateClock(); return; }
    var box = document.createElement('div'); box.id = 'v14ribbon';
    box.innerHTML = '<div class="v14-mc">' +
      '<div class="v14-hello"><div class="g" id="v14greet">' + greeting() + '</div><div class="c" id="v14clock"></div></div>' +
      mk('v14mCalls', 'Recent calls', '') + mk('v14mConn', 'Connected', '') +
      mk('v14mFu', 'Follow-ups due', ' due') + mk('v14mRem', 'Reminders due', ' due') +
      '</div>';
    ov.insertBefore(box, ov.firstChild);
    updateClock();
    refreshRibbon();
    function mk(id, label, cls) { return '<div class="v14-mk' + (cls ? ' due' : '') + '"><div class="n" id="' + id + '">-</div><div class="l">' + label + '</div></div>'; }
  }
  function updateClock() { var c = document.getElementById('v14clock'); if (c) c.textContent = new Date().toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }); }
  async function refreshRibbon() {
    var now = Date.now(); var total = '-', conn = '-';
    if (ribbonCache && now - lastRibbon < 60000) { total = ribbonCache.total; conn = ribbonCache.conn; }
    else {
      try { var d = await api('/calls/logs?pageno=1&pagesize=100'); var rows = d.call_log_data || [];
        total = rows.length; conn = rows.filter(function (r) { return String(r.call_status || '').toLowerCase() === 'completed'; }).length;
        ribbonCache = { total: total, conn: conn }; lastRibbon = now;
      } catch (e) {}
    }
    set('v14mCalls', total); set('v14mConn', conn); set('v14mFu', lsLen('mnb_followups')); set('v14mRem', lsLen('mnb_reminders'));
    function set(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  }
  // keep ribbon present even if Overview re-renders
  var ovEl = document.getElementById('view-overview');
  if (ovEl) { new MutationObserver(function () { if (!ovEl.classList.contains('hidden')) setTimeout(ensureRibbon, 60); }).observe(ovEl, { childList: true }); }
  setInterval(function () { if (document.getElementById('v14ribbon')) { updateClock(); } }, 30000);
  setTimeout(ensureRibbon, 2000);
})();


/* =======================================================================
 * MNB Omni Caller - v15 layer
 * Agent Performance Leaderboard - ranks agents by volume, connect rate,
 * positive sentiment and average duration. Additive, guarded, frontend-only.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced15) return; window.__mnbEnhanced15 = true;
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var SC = function (s) { try { return scrub(s); } catch (e) { return s; } };

  var css = document.createElement('style'); css.id = 'mnb-v15-css';
  css.textContent =
    '.v15-tbl{width:100%;border-collapse:collapse}' +
    '.v15-tbl th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted,#97938c);padding:10px 8px;border-bottom:1px solid var(--border,#2b2b2f)}' +
    '.v15-tbl td{padding:12px 8px;border-bottom:1px solid rgba(255,255,255,.05);font-size:14px}' +
    '.v15-rank{font-weight:800;width:34px}' +
    '.v15-bar{height:7px;border-radius:5px;background:var(--panel-2,#1d1d20);overflow:hidden;margin-top:4px;min-width:80px}' +
    '.v15-bar>i{display:block;height:100%;background:var(--accent-grad,linear-gradient(90deg,#ff7a18,#ffab5e))}';
  document.head.appendChild(css);

  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label, before) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="' + before + '"]');
    if (anchor && anchor.nextSibling) nav.insertBefore(a, anchor.nextSibling); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vLb = mkView('leaderboard');
  mkNav('leaderboard', '&#127942;', 'Leaderboard', 'coaching');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'leaderboard') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vLb) vLb.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'leaderboard'); });
      if (location.hash.replace('#', '') !== 'leaderboard') location.hash = 'leaderboard';
      loadLb(); return;
    }
    return prevSwitch.apply(this, arguments);
  };

  function dur(d) { if (!d) return 0; var p = String(d).split(':').map(function (x) { return parseFloat(x) || 0; }); return p.length === 2 ? p[0] * 60 + p[1] : p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0; }
  function mmss(s) { s = Math.round(s); var m = Math.floor(s / 60), r = s % 60; return m + ':' + (r < 10 ? '0' : '') + r; }

  async function loadLb() {
    vLb.innerHTML = '<header class="view-head"><h2>Agent Leaderboard</h2><p class="muted">How each agent is performing across recent calls - ranked by connected conversations.</p></header><div id="v15b"><p class="muted">Crunching the numbers...</p></div>';
    var rows = [];
    try { for (var p = 1; p <= 3; p++) { var d = await api('/calls/logs?pageno=' + p + '&pagesize=100'); var r = d.call_log_data || []; rows = rows.concat(r); if (r.length < 100) break; } } catch (e) {}
    if (!rows.length) { document.getElementById('v15b').innerHTML = '<p class="muted">No calls yet.</p>'; return; }
    var by = {};
    rows.forEach(function (l) {
      var name = SC(l.bot_name || l.agent_name || 'Agent');
      var a = by[name] || (by[name] = { name: name, calls: 0, conn: 0, pos: 0, secs: 0 });
      a.calls++;
      if (String(l.call_status || '').toLowerCase() === 'completed') a.conn++;
      if (/positive/i.test(l.sentiment_score || '')) a.pos++;
      a.secs += dur(l.call_duration);
    });
    var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.conn - a.conn || b.calls - a.calls; });
    var max = Math.max.apply(null, list.map(function (a) { return a.conn; }).concat([1]));
    var medal = ['&#129351;', '&#129352;', '&#129353;'];
    var body = list.map(function (a, i) {
      var cr = a.calls ? Math.round(a.conn / a.calls * 100) : 0;
      var pr = a.conn ? Math.round(a.pos / a.conn * 100) : 0;
      return '<tr><td class="v15-rank">' + (i < 3 ? medal[i] : (i + 1)) + '</td>' +
        '<td><b>' + E(a.name) + '</b></td>' +
        '<td>' + a.calls + '</td>' +
        '<td>' + a.conn + ' <span class="muted">(' + cr + '%)</span><div class="v15-bar"><i style="width:' + Math.round(a.conn / max * 100) + '%"></i></div></td>' +
        '<td>' + pr + '%</td>' +
        '<td>' + mmss(a.calls ? a.secs / a.calls : 0) + '</td></tr>';
    }).join('');
    document.getElementById('v15b').innerHTML = '<div class="card"><table class="v15-tbl"><thead><tr><th></th><th>Agent</th><th>Calls</th><th>Connected</th><th>Positive</th><th>Avg length</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }
})();


/* =======================================================================
 * MNB Omni Caller - v16 layer
 * Contacts CSV / paste bulk import (merges into your synced contacts).
 * Injected into the Contacts view. Additive, guarded, frontend-only.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced16) return; window.__mnbEnhanced16 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var CKEY = 'mnb_contacts';
  var d10 = function (s) { var d = String(s || '').replace(/[^\d]/g, ''); return d.length > 10 ? d.slice(-10) : d; };
  function load() { try { return JSON.parse(localStorage.getItem(CKEY)) || []; } catch (e) { return []; } }
  function isDemo() { try { return /demo/i.test(document.getElementById('whoami') && document.getElementById('whoami').textContent || ''); } catch (e) { return false; } }

  var css = document.createElement('style'); css.id = 'mnb-v16-css';
  css.textContent =
    '#v16imp textarea{width:100%;box-sizing:border-box;background:var(--bg,#0e0f12);border:1px solid var(--border,#2b2b2f);color:var(--text,#eee);border-radius:9px;padding:10px 12px;font-size:13px;min-height:80px;font-family:monospace}' +
    '#v16imp .btn2{border:none;border-radius:9px;padding:9px 16px;font-weight:700;font-size:13px;cursor:pointer;background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111;margin-top:8px}';
  document.head.appendChild(css);

  function ensureImport() {
    var view = document.getElementById('view-contacts');
    if (!view || view.classList.contains('hidden')) return;
    if (document.getElementById('v16imp')) return;
    var card = document.createElement('div'); card.className = 'card'; card.id = 'v16imp'; card.style.marginTop = '14px';
    card.innerHTML = '<h3 style="margin-top:0">Bulk import contacts</h3>' +
      '<p class="muted" style="margin:0 0 8px">Paste one contact per line: <b>Name, Number, Note</b> (Note optional). CSV pasted from a sheet works too.</p>' +
      '<textarea id="v16ta" placeholder="Aarav Shah, +919812345678, VIP&#10;Priya, +919876500011"></textarea>' +
      '<button class="btn2" id="v16go">Import contacts</button> <span class="muted" id="v16msg"></span>';
    view.appendChild(card);
    document.getElementById('v16go').addEventListener('click', doImport);
  }

  function doImport() {
    var ta = document.getElementById('v16ta'); if (!ta) return;
    var lines = ta.value.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return T('Paste some contacts first');
    var list = load(); var have = {}; list.forEach(function (c) { have[d10(c.num)] = true; });
    var added = 0;
    lines.forEach(function (line) {
      var parts = line.split(/[,\t]/).map(function (x) { return x.trim(); });
      var name = '', num = '', note = '';
      // find the part that looks like a number
      var numIdx = -1;
      for (var i = 0; i < parts.length; i++) { if ((parts[i].replace(/[^\d]/g, '') || '').length >= 7) { numIdx = i; break; } }
      if (numIdx === -1) return;
      num = parts[numIdx];
      var rest = parts.filter(function (_, i) { return i !== numIdx; });
      name = rest[0] || ('Contact ' + num.slice(-4));
      note = rest.slice(1).join(' ');
      var key = d10(num);
      if (!key || have[key]) return;
      have[key] = true; list.unshift({ id: Date.now() + added, name: name, num: num, note: note }); added++;
    });
    if (!added) { document.getElementById('v16msg').textContent = 'No new contacts found (duplicates skipped).'; return; }
    try { localStorage.setItem(CKEY, JSON.stringify(list)); } catch (e) {}
    if (!isDemo()) { try { api('/crm', { method: 'PUT', body: { contacts: list, followups: JSON.parse(localStorage.getItem('mnb_followups') || '{}') } }); } catch (e) {} }
    T('Imported ' + added + ' contacts');
    if (typeof window.switchView === 'function') window.switchView('contacts');
  }

  var view = document.getElementById('view-contacts');
  if (view) { new MutationObserver(function () { if (!view.classList.contains('hidden')) setTimeout(ensureImport, 60); }).observe(view, { childList: true }); }
  var prevSwitch = window.switchView;
  window.switchView = function (v) { var r = prevSwitch.apply(this, arguments); if (v === 'contacts') setTimeout(ensureImport, 150); return r; };
})();


/* =======================================================================
 * MNB Omni Caller - v17 layer
 * Call Snippets library - save reusable context notes and insert them into
 * a call in one click. Injected on the Place a Call screen. Guarded.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced17) return; window.__mnbEnhanced17 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var KEY = 'mnb_snippets';
  function load() { try { var v = JSON.parse(localStorage.getItem(KEY)); return v && v.length ? v : DEFAULTS.slice(); } catch (e) { return DEFAULTS.slice(); } }
  function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} }
  var DEFAULTS = [
    { label: 'Qualify budget', text: 'Ask about their budget range and decision timeline before pitching.' },
    { label: 'Book a demo', text: 'Offer a free 30-minute demo and confirm a preferred day and time.' },
    { label: 'Handle objection', text: 'If they hesitate on price, focus on ROI and offer a trial. Never be pushy.' }
  ];

  var css = document.createElement('style'); css.id = 'mnb-v17-css';
  css.textContent =
    '#v17snip{margin:12px 0}#v17snip .lbl{font-size:12px;color:var(--muted,#97938c);margin-bottom:6px}' +
    '#v17snip .chip{display:inline-flex;align-items:center;gap:6px;background:var(--panel-2,#1d1d20);border:1px solid var(--border,#2b2b2f);color:var(--text,#eee);border-radius:20px;padding:6px 12px;font-size:13px;margin:0 6px 6px 0;cursor:pointer}' +
    '#v17snip .chip:hover{border-color:var(--accent,#ff7a18)}' +
    '#v17snip .chip .x{color:var(--muted,#97938c);font-weight:800}#v17snip .chip .x:hover{color:#e05d55}' +
    '#v17snip .add{border:1px dashed var(--border,#2b2b2f);background:transparent;color:var(--muted,#97938c);border-radius:20px;padding:6px 12px;font-size:13px;cursor:pointer}';
  document.head.appendChild(css);

  function ensure() {
    var view = document.getElementById('view-call'); if (!view || view.classList.contains('hidden')) return;
    var anchor = document.getElementById('contextRows') || document.getElementById('callNumber');
    if (!anchor) return;
    var box = document.getElementById('v17snip');
    if (!box) { box = document.createElement('div'); box.id = 'v17snip'; anchor.parentNode.insertBefore(box, anchor); }
    render(box);
  }
  function render(box) {
    var l = load();
    box.innerHTML = '<div class="lbl">Call snippets - click to add as call context</div>' +
      l.map(function (s, i) { return '<span class="chip" data-i="' + i + '">' + E(s.label) + ' <span class="x" data-del="' + i + '">&#215;</span></span>'; }).join('') +
      '<button class="add" id="v17add">+ New snippet</button>';
    box.querySelectorAll('.chip').forEach(function (c) {
      c.addEventListener('click', function (e) {
        if (e.target.getAttribute('data-del') != null) { var l2 = load(); l2.splice(Number(e.target.getAttribute('data-del')), 1); save(l2); render(box); return; }
        var s = load()[Number(c.getAttribute('data-i'))];
        if (s && typeof window.addContextRow === 'function') { window.addContextRow('Context', s.text); T('Snippet added to call context'); }
        else T('Open the context section to add snippets');
      });
    });
    document.getElementById('v17add').addEventListener('click', function () {
      var label = prompt('Snippet label (short):'); if (!label) return;
      var text = prompt('Snippet text (the context to add to the call):'); if (!text) return;
      var l3 = load(); l3.push({ label: label.trim(), text: text.trim() }); save(l3); render(box); T('Snippet saved');
    });
  }

  var view = document.getElementById('view-call');
  if (view) { new MutationObserver(function () { if (!view.classList.contains('hidden') && !document.getElementById('v17snip')) setTimeout(ensure, 60); }).observe(view, { childList: true }); }
  var prevSwitch = window.switchView;
  window.switchView = function (v) { var r = prevSwitch.apply(this, arguments); if (v === 'call') setTimeout(ensure, 150); return r; };
  setTimeout(ensure, 1800);
})();


/* =======================================================================
 * MNB Omni Caller - v18 layer
 * Trends - call volume, connect rate and sentiment over time, drawn on a
 * lightweight canvas (no libraries). Additive, guarded, frontend-only.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced18) return; window.__mnbEnhanced18 = true;
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };

  var css = document.createElement('style'); css.id = 'mnb-v18-css';
  css.textContent =
    '.v18-k{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:16px}' +
    '.v18-c{background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:14px;padding:16px}' +
    '.v18-c .n{font-size:24px;font-weight:800}.v18-c .l{font-size:11px;color:var(--muted,#97938c);text-transform:uppercase;letter-spacing:.3px;margin-top:2px}' +
    '.v18-chart{background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:14px;padding:16px;margin-bottom:14px}' +
    '.v18-chart h3{margin:0 0 10px;font-size:15px}';
  document.head.appendChild(css);

  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label, before) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="' + before + '"]');
    if (anchor && anchor.nextSibling) nav.insertBefore(a, anchor.nextSibling); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vTr = mkView('trends');
  mkNav('trends', '&#128200;', 'Trends', 'leaderboard');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'trends') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vTr) vTr.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'trends'); });
      if (location.hash.replace('#', '') !== 'trends') location.hash = 'trends';
      loadTrends(); return;
    }
    return prevSwitch.apply(this, arguments);
  };

  function dayKey(t) {
    if (!t) return ''; var s = String(t).trim();
    var m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) { var y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2); }
    var d = new Date(s); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  function shortDay(k) { var p = k.split('-'); return p[2] + '/' + p[1]; }

  async function loadTrends() {
    vTr.innerHTML = '<header class="view-head"><h2>Trends</h2><p class="muted">Call volume, connect rate and sentiment over time.</p></header><div id="v18b"><p class="muted">Building charts...</p></div>';
    var rows = [];
    try { for (var p = 1; p <= 3; p++) { var d = await api('/calls/logs?pageno=' + p + '&pagesize=100'); var r = d.call_log_data || []; rows = rows.concat(r); if (r.length < 100) break; } } catch (e) {}
    if (!rows.length) { document.getElementById('v18b').innerHTML = '<p class="muted">No calls yet.</p>'; return; }
    var days = {};
    rows.forEach(function (l) {
      var k = dayKey(l.time_of_call); if (!k) return;
      var a = days[k] || (days[k] = { calls: 0, conn: 0, pos: 0 });
      a.calls++; if (String(l.call_status || '').toLowerCase() === 'completed') a.conn++; if (/positive/i.test(l.sentiment_score || '')) a.pos++;
    });
    var keys = Object.keys(days).sort().slice(-14);
    var total = rows.length, conn = rows.filter(function (l) { return String(l.call_status || '').toLowerCase() === 'completed'; }).length;
    var pos = rows.filter(function (l) { return /positive/i.test(l.sentiment_score || ''); }).length;
    var cr = total ? Math.round(conn / total * 100) : 0;
    document.getElementById('v18b').innerHTML =
      '<div class="v18-k">' +
        kc(total, 'Total calls') + kc(conn, 'Connected') + kc(cr + '%', 'Connect rate') + kc(pos, 'Positive') +
      '</div>' +
      '<div class="v18-chart"><h3>Calls per day</h3><canvas id="v18cv" height="180"></canvas></div>' +
      '<div class="v18-chart"><h3>Connect rate per day</h3><canvas id="v18cv2" height="140"></canvas></div>';
    setTimeout(function () { drawBars('v18cv', keys.map(function (k) { return { x: shortDay(k), y: days[k].calls }; }), '#ff8c3c'); drawBars('v18cv2', keys.map(function (k) { return { x: shortDay(k), y: days[k].calls ? Math.round(days[k].conn / days[k].calls * 100) : 0 }; }), '#43b97f', '%'); }, 60);
    function kc(n, l) { return '<div class="v18-c"><div class="n">' + n + '</div><div class="l">' + l + '</div></div>'; }
  }

  function drawBars(id, data, color, suffix) {
    var cv = document.getElementById(id); if (!cv) return;
    var W = cv.clientWidth || cv.parentNode.clientWidth - 32; cv.width = W; var H = cv.height;
    var x = cv.getContext('2d'); x.clearRect(0, 0, W, H);
    if (!data.length) return;
    var max = Math.max.apply(null, data.map(function (d) { return d.y; }).concat([1]));
    var pad = 26, bw = (W - pad) / data.length, gap = bw * 0.28;
    x.font = '10px system-ui'; x.textAlign = 'center';
    data.forEach(function (d, i) {
      var bh = (d.y / max) * (H - 40);
      var bx = pad / 2 + i * bw + gap / 2, by = H - 22 - bh;
      var g = x.createLinearGradient(0, by, 0, H - 22); g.addColorStop(0, color); g.addColorStop(1, color + '55');
      x.fillStyle = g; x.fillRect(bx, by, bw - gap, bh);
      x.fillStyle = 'rgba(255,255,255,.85)'; x.fillText(d.y + (suffix || ''), bx + (bw - gap) / 2, by - 4);
      x.fillStyle = 'rgba(255,255,255,.5)'; x.fillText(d.x, bx + (bw - gap) / 2, H - 8);
    });
  }
})();


/* =======================================================================
 * MNB Omni Caller - v19 layer
 * Contact 360 / Number Lookup - full call history for any number with AI
 * analysis and quick actions. Additive, guarded, frontend-only.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced19) return; window.__mnbEnhanced19 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var d10 = function (s) { var d = String(s || '').replace(/[^\d]/g, ''); return d.length > 10 ? d.slice(-10) : d; };

  var css = document.createElement('style'); css.id = 'mnb-v19-css';
  css.textContent =
    '.v19-search{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}' +
    '.v19-search input{flex:1;min-width:200px;background:var(--bg,#0e0f12);border:1px solid var(--border,#2b2b2f);color:var(--text,#eee);border-radius:9px;padding:11px 13px;font-size:14px}' +
    '.v19-search button{border:none;border-radius:9px;padding:11px 18px;font-weight:700;cursor:pointer;background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111}' +
    '.v19-tl{position:relative;margin-left:8px;padding-left:20px;border-left:2px solid var(--border,#2b2b2f)}' +
    '.v19-ev{position:relative;margin-bottom:12px}' +
    '.v19-ev::before{content:"";position:absolute;left:-27px;top:4px;width:12px;height:12px;border-radius:50%;background:var(--accent,#ff7a18);border:2px solid var(--bg,#0e0f12)}' +
    '.v19-ev .card2{background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:12px;padding:12px 14px}' +
    '.v19-b{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px}' +
    '.v19-pos{background:rgba(67,185,127,.18);color:#43b97f}.v19-neg{background:rgba(224,93,85,.18);color:#e05d55}.v19-neu{background:rgba(148,163,184,.18);color:#94a3b8}' +
    '.v19-mini{border:1px solid var(--border,#2b2b2f);background:transparent;color:var(--text,#eee);border-radius:8px;padding:6px 10px;font-size:12px;cursor:pointer;font-weight:600;margin:6px 6px 0 0}' +
    '.v19-mini:hover{border-color:var(--accent,#ff7a18);color:var(--accent,#ff7a18)}' +
    '.v19-pick{display:inline-block;background:var(--panel-2,#1d1d20);border:1px solid var(--border,#2b2b2f);border-radius:20px;padding:5px 11px;font-size:12px;margin:0 6px 6px 0;cursor:pointer}';
  document.head.appendChild(css);

  function badge(s) { s = (s || 'neutral').toLowerCase(); var c = s === 'positive' ? 'v19-pos' : s === 'negative' ? 'v19-neg' : 'v19-neu'; return '<span class="v19-b ' + c + '">' + E(s || 'n/a') + '</span>'; }

  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label, before) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="' + before + '"]');
    if (anchor && anchor.nextSibling) nav.insertBefore(a, anchor.nextSibling); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vLk = mkView('lookup');
  mkNav('lookup', '&#128269;', 'Lookup', 'contacts');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'lookup') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vLk) vLk.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'lookup'); });
      if (location.hash.replace('#', '') !== 'lookup') location.hash = 'lookup';
      loadLookup(); return;
    }
    return prevSwitch.apply(this, arguments);
  };

  var cacheLogs = null;
  function contacts() { try { return JSON.parse(localStorage.getItem('mnb_contacts') || '[]'); } catch (e) { return []; } }
  function loadLookup() {
    var picks = contacts().slice(0, 12).map(function (c) { return '<span class="v19-pick" data-n="' + E(c.num) + '">' + E(c.name) + '</span>'; }).join('');
    vLk.innerHTML =
      '<header class="view-head"><h2>Contact 360</h2><p class="muted">Look up any number to see its full call history, AI read-outs and quick actions.</p></header>' +
      '<div class="v19-search"><input id="v19q" placeholder="Enter a phone number..."><button id="v19go">Look up</button></div>' +
      (picks ? '<div style="margin-bottom:12px"><span class="muted" style="font-size:12px">Your contacts: </span>' + picks + '</div>' : '') +
      '<div id="v19res"></div>';
    document.getElementById('v19go').addEventListener('click', function () { run(document.getElementById('v19q').value); });
    document.getElementById('v19q').addEventListener('keydown', function (e) { if (e.key === 'Enter') run(e.target.value); });
    vLk.querySelectorAll('[data-n]').forEach(function (p) { p.addEventListener('click', function () { document.getElementById('v19q').value = p.getAttribute('data-n'); run(p.getAttribute('data-n')); }); });
  }

  async function run(num) {
    var key = d10(num); if (!key) return T('Enter a number');
    var res = document.getElementById('v19res'); res.innerHTML = '<p class="muted">Searching call history...</p>';
    if (!cacheLogs) { cacheLogs = []; try { for (var p = 1; p <= 3; p++) { var d = await api('/calls/logs?pageno=' + p + '&pagesize=100'); var r = d.call_log_data || []; cacheLogs = cacheLogs.concat(r); if (r.length < 100) break; } } catch (e) {} }
    var hits = cacheLogs.filter(function (l) { return d10(l.to_number) === key || d10(l.from_number) === key; });
    var c = contacts().filter(function (x) { return d10(x.num) === key; })[0];
    var digits = key;
    var header = '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
      '<div><h3 style="margin:0">' + E(c ? c.name : num) + '</h3><div class="muted">' + E(num) + (c && c.note ? ' - ' + E(c.note) : '') + '</div></div>' +
      '<div><button class="v19-mini" data-act="call">Call</button>' +
      '<a class="v19-mini" target="_blank" rel="noopener" href="https://wa.me/' + digits + '">WhatsApp</a>' +
      '<button class="v19-mini" data-act="remind">Remind</button>' +
      '<button class="v19-mini" data-act="block">Block</button></div></div>' +
      '<div class="muted" style="margin:12px 0 8px">' + hits.length + ' call(s) found</div>';
    if (!hits.length) { res.innerHTML = header + '<p class="muted">No calls to this number yet.</p>'; bindActs(num, digits); return; }
    hits.sort(function (a, b) { return new Date(b.time_of_call) - new Date(a.time_of_call); });
    res.innerHTML = header + '<div class="v19-tl">' + hits.map(function (l) {
      return '<div class="v19-ev"><div class="card2"><div style="display:flex;justify-content:space-between;gap:10px"><b>' + E(l.time_of_call || '') + '</b>' + badge(l.sentiment_score) + '</div>' +
        '<div class="muted" style="font-size:13px;margin-top:2px">' + E(l.call_status || '') + ' - ' + E(l.call_duration || '0:00') + '</div>' +
        '<button class="v19-mini" data-an="' + l.id + '">AI analysis</button><div id="v19an_' + l.id + '"></div></div></div>';
    }).join('') + '</div>';
    res.querySelectorAll('[data-an]').forEach(function (b) { b.addEventListener('click', function () { analyze(b.getAttribute('data-an')); }); });
    bindActs(num, digits);
  }
  function bindActs(num, digits) {
    var res = document.getElementById('v19res'); if (!res) return;
    res.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.getAttribute('data-act');
        if (act === 'call') { window.switchView('call'); setTimeout(function () { var f = document.getElementById('callNumber'); if (f) { f.value = num; f.focus(); } }, 150); }
        else if (act === 'remind') { var t = prompt('Reminder note for ' + num + ':', 'Call back ' + num); if (!t) return; try { var l = JSON.parse(localStorage.getItem('mnb_reminders') || '[]'); l.push({ id: Date.now(), text: t, num: num, when: Date.now() + 3600000, done: false, notified: false }); localStorage.setItem('mnb_reminders', JSON.stringify(l)); T('Reminder set for 1 hour from now'); } catch (e) {} }
        else if (act === 'block') { try { var dnc = JSON.parse(localStorage.getItem('mnb_dnc') || '[]'); dnc.unshift({ num: num, reason: 'Blocked from Lookup', at: Date.now() }); localStorage.setItem('mnb_dnc', JSON.stringify(dnc)); T('Added to Do-Not-Call'); } catch (e) {} }
      });
    });
  }
  async function analyze(id) {
    var out = document.getElementById('v19an_' + id); if (out) out.innerHTML = '<div class="muted">Analyzing...</div>';
    try { var d = await api('/analytics/call/' + id); var a = d.analysis || {};
      var tips = (a.coaching || []).map(function (c) { return '<li>' + E(c) + '</li>'; }).join('');
      if (out) out.innerHTML = '<div style="margin-top:8px;font-size:13px">' + badge(a.sentiment) + ' <b>score ' + (a.score || 0) + '</b> - ' + E(a.summary || '') + (tips ? '<ul style="margin:6px 0 0;padding-left:18px">' + tips + '</ul>' : '') + '</div>';
    } catch (e) { if (out) out.innerHTML = '<div class="v19-neg">Analysis failed</div>'; }
  }
})();

/* =======================================================================
 * MNB Omni Caller - v20 layer
 * Billing / Upgrade - buy call minutes with Cashfree (secure checkout).
 * Amounts and crediting are enforced server-side; this layer only starts
 * the hosted checkout and polls order status. Additive, guarded, frontend.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced20) return; window.__mnbEnhanced20 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var CF_SDK = 'https://sdk.cashfree.com/js/v3/cashfree.js';

  var css = document.createElement('style'); css.id = 'mnb-v20-css';
  css.textContent =
    '.v20-tiers{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin-top:14px}' +
    '@media(max-width:900px){.v20-tiers{grid-template-columns:1fr}}' +
    '.v20-tier{background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:16px;padding:24px;display:flex;flex-direction:column}' +
    '.v20-tier.pop{border-color:var(--accent,#ff7a18);box-shadow:0 16px 46px rgba(255,122,24,.12);position:relative}' +
    '.v20-tag{position:absolute;top:-11px;left:50%;transform:translateX(-50%);background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111;font-weight:800;font-size:11px;padding:4px 12px;border-radius:20px}' +
    '.v20-tier h3{font-size:18px;margin:0 0 4px}' +
    '.v20-price{font-size:34px;font-weight:800;margin:6px 0}' +
    '.v20-price span{font-size:13px;color:var(--muted,#9a958c);font-weight:500}' +
    '.v20-tier ul{list-style:none;margin:14px 0;padding:0;flex:1}' +
    '.v20-tier li{padding:6px 0;color:var(--muted,#9a958c);font-size:13.5px;display:flex;gap:9px}' +
    '.v20-tier li::before{content:"\\2713";color:var(--accent2,#ffab5e);font-weight:800}' +
    '.v20-buy{border:none;border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111}' +
    '.v20-buy:disabled{opacity:.6;cursor:not-allowed}' +
    '.v20-alt{border:1px solid var(--border,#2b2b2f);background:transparent;color:var(--text,#eee);border-radius:10px;padding:13px;font-size:15px;font-weight:700;cursor:pointer;text-align:center;text-decoration:none;display:block}' +
    '.v20-note{background:var(--panel-2,#1d1d20);border:1px solid var(--border,#2b2b2f);border-radius:12px;padding:14px 16px;margin-top:16px;color:var(--muted,#9a958c);font-size:13px}' +
    '.v20-ok{background:rgba(67,185,127,.14);border:1px solid rgba(67,185,127,.4);color:#8fe4b8;border-radius:12px;padding:14px 16px;margin-bottom:14px;font-size:14.5px}';
  document.head.appendChild(css);

  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label, before) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="' + before + '"]');
    if (anchor) nav.insertBefore(a, anchor); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vB = mkView('billing');
  mkNav('billing', '&#128179;', 'Billing', 'overview');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'billing') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vB) vB.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'billing'); });
      if (location.hash.replace('#', '') !== 'billing') location.hash = 'billing';
      loadBilling(); return;
    }
    return prevSwitch.apply(this, arguments);
  };

  var meCache = null, sdkPromise = null;
  function loadSdk() { if (sdkPromise) return sdkPromise; sdkPromise = new Promise(function (res, rej) { if (window.Cashfree) return res(window.Cashfree); var s = document.createElement('script'); s.src = CF_SDK; s.onload = function () { res(window.Cashfree); }; s.onerror = function () { rej(new Error('sdk')); }; document.head.appendChild(s); }); return sdkPromise; }

  async function getMe() { if (meCache) return meCache; try { meCache = await fetch('/api/me', { cache: 'no-store' }).then(function (r) { return r.json(); }); } catch (e) { meCache = {}; } return meCache; }

  async function loadBilling() {
    if (!vB) return;
    vB.innerHTML = '<header class="view-head"><h2>Billing</h2><p class="muted">Top up call minutes for your organization. Secure payments by Cashfree.</p></header><div id="v20body"><p class="muted">Loading plans...</p></div>';
    var body = document.getElementById('v20body');
    var meResp = await getMe();
    var user = (meResp && meResp.user) || {};
    var pd;
    try { pd = await fetch('/api/pay/plans').then(function (r) { return r.json(); }); } catch (e) { pd = { plans: [] }; }

    var banner = '';
    var used = (user.usedMinutes != null) ? user.usedMinutes : null;
    var cap = (user.minuteCap != null) ? user.minuteCap : null;
    var rem = (user.remainingMinutes != null) ? user.remainingMinutes : ((cap != null && used != null) ? Math.max(0, cap - used) : null);
    if (cap != null) banner = '<div class="v20-note" style="margin-top:0;margin-bottom:14px">Minute balance: <b style="color:var(--text,#eee)">' + (rem != null ? E(rem) : E(cap)) + ' remaining</b>' + (used != null ? ' &#183; ' + E(used) + ' used of ' + E(cap) + ' purchased' : '') + '</div>';

    if (user.demo) { body.innerHTML = banner + '<div class="v20-note">You are exploring the read-only demo. Sign up for your own account to purchase minutes.</div>'; return; }
    if (!pd || !pd.ready) { body.innerHTML = banner + '<div class="v20-note">Online payments are being set up. To buy minutes now, contact us at <a href="/contact.html" style="color:var(--accent2,#ffab5e)">contact@mnbresearch.com</a> and we will help you right away.</div>'; return; }

    var plans = pd.plans || [];
    var feat = {
      starter: ['500 call minutes', '1 trained agent', 'Knowledge base & transcripts', 'Analytics dashboard', 'Email support'],
      growth: ['1,500 call minutes', 'Up to 5 agents', 'Bulk call campaigns', 'Dedicated phone number', 'Priority support']
    };
    var cards = plans.map(function (p) {
      var pop = p.id === 'growth' ? ' pop' : '';
      var tag = p.id === 'growth' ? '<span class="v20-tag">MOST POPULAR</span>' : '';
      var li = (feat[p.id] || [p.minutes + ' call minutes']).map(function (f) { return '<li>' + E(f) + '</li>'; }).join('');
      return '<div class="v20-tier' + pop + '">' + tag + '<h3>' + E(p.name) + '</h3>' +
        '<div class="v20-price">&#8377;' + E(Number(p.amount).toLocaleString('en-IN')) + ' <span>one-time</span></div>' +
        '<ul>' + li + '</ul>' +
        '<button class="v20-buy" data-plan="' + E(p.id) + '">Buy ' + E(p.name) + '</button></div>';
    }).join('');
    // Scale card -> contact
    cards += '<div class="v20-tier"><h3>Scale</h3><div class="v20-price">Custom</div>' +
      '<ul><li>High-volume minute packs (fair-use)</li><li>Unlimited agents & numbers</li><li>Multi-client delegation</li><li>Voice cloning & custom flows</li><li>White-glove onboarding</li></ul>' +
      '<a class="v20-alt" href="/contact.html">Talk to us</a></div>';

    body.innerHTML = banner + '<div class="v20-tiers">' + cards + '</div>' +
      '<div class="v20-note">Payments are processed securely by Cashfree. Minutes are added to your account automatically once your payment is confirmed. See our <a href="/refund.html" style="color:var(--accent2,#ffab5e)">Refund policy</a>.</div>';

    body.querySelectorAll('.v20-buy').forEach(function (b) { b.addEventListener('click', function () { buy(b.getAttribute('data-plan'), b); }); });
  }

  async function buy(planId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Starting...'; }
    try {
      var r = await fetch('/api/pay/create-order', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ planId: planId }) });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok || !j.payment_session_id) { T(j.error || 'Could not start checkout'); if (btn) { btn.disabled = false; btn.textContent = 'Try again'; } return; }
      var Cashfree = await loadSdk();
      var cf = Cashfree({ mode: (j.mode === 'sandbox' ? 'sandbox' : 'production') });
      cf.checkout({ paymentSessionId: j.payment_session_id, redirectTarget: '_self' });
    } catch (e) { T('Checkout failed to load. Please try again.'); if (btn) { btn.disabled = false; btn.textContent = 'Try again'; } }
  }

  // On return from Cashfree (return_url carries ?order_id=...), confirm + credit.
  async function checkReturn() {
    var q = new URLSearchParams(location.search);
    var oid = q.get('order_id'); if (!oid) return;
    // Clean the URL so a refresh does not re-trigger.
    try { history.replaceState({}, '', location.pathname + '#billing'); } catch (e) {}
    window.switchView('billing');
    var body = document.getElementById('v20body');
    if (body) body.insertAdjacentHTML('afterbegin', '<div class="v20-ok" id="v20ret">Confirming your payment...</div>');
    var ret = document.getElementById('v20ret');
    for (var i = 0; i < 6; i++) {
      try {
        var s = await fetch('/api/pay/status/' + encodeURIComponent(oid)).then(function (r) { return r.json(); });
        if (s && s.status === 'PAID') { meCache = null; if (ret) ret.innerHTML = 'Payment successful! ' + (s.minutes || 0) + ' minutes added to your account.'; T('Payment successful'); setTimeout(loadBilling, 1200); return; }
      } catch (e) {}
      await new Promise(function (r) { setTimeout(r, 2500); });
    }
    if (ret) { ret.className = 'v20-note'; ret.innerHTML = 'We could not confirm the payment yet. If money was debited it will reflect shortly; you can refresh this page.'; }
  }
  setTimeout(checkReturn, 800);
})();

/* =======================================================================
 * MNB Omni Caller - v21 layer
 * Account self-service: change password, purchase history (receipts),
 * a low-balance top-up nudge, and a "Forgot password?" link on the login
 * screen. Additive, guarded, frontend-only.
 * ==================================================================== */
(function () {
  if (window.__mnbEnhanced21) return; window.__mnbEnhanced21 = true;
  var T = function (m, ms) { try { toast(m, ms); } catch (e) {} };
  var E = function (s) { try { return esc(s); } catch (e) { return String(s == null ? '' : s); } };
  var jpost = function (url, body) { return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }); };

  var css = document.createElement('style'); css.id = 'mnb-v21-css';
  css.textContent =
    '.v21-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:14px}' +
    '@media(max-width:820px){.v21-grid{grid-template-columns:1fr}}' +
    '.v21-card{background:var(--panel,#141416);border:1px solid var(--border,#2b2b2f);border-radius:16px;padding:22px}' +
    '.v21-card h3{margin:0 0 12px;font-size:16px}' +
    '.v21-card label{display:block;font-size:12px;color:var(--muted,#9a958c);margin:10px 0 5px;font-weight:600}' +
    '.v21-card input{width:100%;background:var(--bg,#0e0f12);border:1px solid var(--border,#2b2b2f);color:var(--text,#eee);border-radius:9px;padding:10px 12px;font-size:14px;font-family:inherit}' +
    '.v21-card input:focus{outline:none;border-color:var(--accent,#ff7a18)}' +
    '.v21-btn{margin-top:14px;border:none;border-radius:9px;padding:11px 16px;font-weight:700;cursor:pointer;background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111;font-size:14px}' +
    '.v21-btn:disabled{opacity:.6;cursor:not-allowed}' +
    '.v21-kv{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--border,#2b2b2f);font-size:14px}' +
    '.v21-kv:last-child{border-bottom:none}.v21-kv span:first-child{color:var(--muted,#9a958c)}' +
    '.v21-tbl{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:4px}' +
    '.v21-tbl th,.v21-tbl td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--border,#2b2b2f)}' +
    '.v21-tbl th{color:var(--muted,#9a958c);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.04em}' +
    '.v21-badge{font-size:11px;font-weight:700;padding:2px 9px;border-radius:20px}' +
    '.v21-paid{background:rgba(67,185,127,.18);color:#43b97f}.v21-pend{background:rgba(148,163,184,.18);color:#94a3b8}' +
    '.v21-low{position:sticky;top:0;z-index:50;background:linear-gradient(135deg,rgba(255,122,24,.18),rgba(255,179,71,.10));border-bottom:1px solid rgba(255,122,24,.4);color:#ffd9b3;padding:10px 16px;display:flex;gap:12px;align-items:center;justify-content:center;font-size:14px;flex-wrap:wrap}' +
    '.v21-low b{color:#fff}.v21-low button{border:none;border-radius:8px;padding:7px 14px;font-weight:700;cursor:pointer;background:var(--accent-grad,linear-gradient(135deg,#ff7a18,#ffab5e));color:#111;font-size:13px}' +
    '.v21-low .x{background:transparent;color:#ffd9b3;border:1px solid rgba(255,255,255,.25);padding:6px 10px}' +
    '.v21-forgot{display:block;margin-top:12px;text-align:center;font-size:13px;color:var(--accent2,#ffab5e);cursor:pointer;background:none;border:none;width:100%}';
  document.head.appendChild(css);

  function mkView(id) { var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode; if (!m) return null; var s = document.createElement('section'); s.id = 'view-' + id; s.className = 'view hidden'; m.appendChild(s); return s; }
  function mkNav(id, ico, label, before) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav'); if (!nav || document.querySelector('.nav-item[data-view="' + id + '"]')) return;
    var a = document.createElement('a'); a.href = '#' + id; a.className = 'nav-item'; a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="' + before + '"]');
    if (anchor) nav.insertBefore(a, anchor); else nav.appendChild(a);
    a.addEventListener('click', function (e) { e.preventDefault(); window.switchView(id); });
  }
  var vAcc = mkView('account');
  mkNav('account', '&#128100;', 'Account', 'billing');

  var prevSwitch = window.switchView;
  window.switchView = function (view) {
    if (view === 'account') {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
      if (vAcc) vAcc.classList.remove('hidden');
      document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-view') === 'account'); });
      if (location.hash.replace('#', '') !== 'account') location.hash = 'account';
      loadAccount(); return;
    }
    return prevSwitch.apply(this, arguments);
  };

  async function loadAccount() {
    if (!vAcc) return;
    vAcc.innerHTML = '<header class="view-head"><h2>Account</h2><p class="muted">Manage your login and view your purchase history.</p></header><div id="v21body"><p class="muted">Loading...</p></div>';
    var me = {};
    try { me = await fetch('/api/me', { cache: 'no-store' }).then(function (r) { return r.json(); }); } catch (e) {}
    var u = (me && me.user) || {};
    var info = '<div class="v21-card"><h3>Your account</h3>' +
      '<div class="v21-kv"><span>Email</span><span>' + E(u.email || '') + '</span></div>' +
      '<div class="v21-kv"><span>Organization</span><span>' + E(u.org || '') + '</span></div>' +
      '<div class="v21-kv"><span>Plan</span><span>' + E(u.plan || 'prepaid') + '</span></div>' +
      '<div class="v21-kv"><span>Minute balance</span><span><b>' + (u.remainingMinutes != null ? E(u.remainingMinutes) : E(u.minuteCap || 0)) + '</b> remaining</span></div>' +
      '</div>';
    var pw = u.demo
      ? '<div class="v21-card"><h3>Password</h3><p class="muted" style="font-size:13.5px">The demo account password cannot be changed.</p></div>'
      : '<div class="v21-card"><h3>Change password</h3>' +
        '<label>Current password</label><input id="v21cur" type="password" autocomplete="current-password">' +
        '<label>New password</label><input id="v21new" type="password" autocomplete="new-password" placeholder="At least 6 characters">' +
        '<label>Confirm new password</label><input id="v21conf" type="password" autocomplete="new-password">' +
        '<button class="v21-btn" id="v21pwbtn">Update password</button></div>';
    vAcc.querySelector('#v21body').innerHTML = '<div class="v21-grid">' + info + pw + '</div>' +
      '<div class="v21-card" style="margin-top:18px"><h3>Purchase history</h3><div id="v21orders"><p class="muted" style="font-size:13.5px">Loading receipts...</p></div></div>';

    var b = document.getElementById('v21pwbtn');
    if (b) b.addEventListener('click', changePw);
    loadOrders();
  }

  async function changePw() {
    var cur = document.getElementById('v21cur').value, nw = document.getElementById('v21new').value, cf = document.getElementById('v21conf').value;
    if (nw.length < 6) return T('New password must be at least 6 characters');
    if (nw !== cf) return T('New passwords do not match');
    var b = document.getElementById('v21pwbtn'); b.disabled = true; var old = b.textContent; b.textContent = 'Updating...';
    try {
      var r = await jpost('/api/auth/change-password', { currentPassword: cur, newPassword: nw });
      if (r.ok && r.j.ok) { T('Password updated'); document.getElementById('v21cur').value = ''; document.getElementById('v21new').value = ''; document.getElementById('v21conf').value = ''; }
      else T(r.j.error || 'Could not update password');
    } catch (e) { T('Network error'); }
    b.disabled = false; b.textContent = old;
  }

  async function loadOrders() {
    var el = document.getElementById('v21orders'); if (!el) return;
    var orders = [];
    try { orders = (await fetch('/api/pay/orders').then(function (r) { return r.json(); })).orders || []; } catch (e) {}
    if (!orders.length) { el.innerHTML = '<p class="muted" style="font-size:13.5px">No purchases yet. Buy a minute pack from the Billing tab to get started.</p>'; return; }
    var rows = orders.map(function (o) {
      var d = o.createdAt ? new Date(o.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      var paid = o.status === 'PAID' || o.credited;
      return '<tr><td>' + E(d) + '</td><td>' + E((o.plan || '').charAt(0).toUpperCase() + (o.plan || '').slice(1)) + '</td><td>&#8377;' + E(o.amount) + '</td><td>' + E(o.minutes) + ' min</td>' +
        '<td><span class="v21-badge ' + (paid ? 'v21-paid' : 'v21-pend') + '">' + (paid ? 'Paid' : E(o.status || 'Pending')) + '</span></td></tr>';
    }).join('');
    el.innerHTML = '<table class="v21-tbl"><thead><tr><th>Date</th><th>Plan</th><th>Amount</th><th>Minutes</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ---- Low-balance nudge ---- */
  var lowShown = false;
  async function checkLowBalance() {
    if (lowShown) return;
    try {
      var me = await fetch('/api/me', { cache: 'no-store' }).then(function (r) { return r.json(); });
      var u = (me && me.user) || {};
      if (!me.authed || u.demo || u.role === 'admin') return;
      var rem = u.remainingMinutes;
      if (rem == null || rem > 60) return;
      if (sessionStorage.getItem('mnb_low_dismissed') === '1') return;
      lowShown = true;
      var bar = document.createElement('div'); bar.className = 'v21-low';
      bar.innerHTML = '<span>' + (rem <= 0 ? 'You have <b>no calling minutes</b> left.' : 'Low balance: <b>' + E(rem) + ' minutes</b> left.') + '</span>' +
        '<button id="v21buy">Buy minutes</button><button class="x" id="v21x">Dismiss</button>';
      var main = document.querySelector('main.main') || document.body;
      main.insertBefore(bar, main.firstChild);
      document.getElementById('v21buy').addEventListener('click', function () { window.switchView('billing'); });
      document.getElementById('v21x').addEventListener('click', function () { try { sessionStorage.setItem('mnb_low_dismissed', '1'); } catch (e) {} bar.remove(); });
    } catch (e) {}
  }
  setTimeout(checkLowBalance, 1500);

  /* ---- "Forgot password?" on the login screen ---- */
  function injectForgot() {
    var lf = document.getElementById('loginForm'); if (!lf || document.getElementById('v21forgot')) return;
    var link = document.createElement('button'); link.type = 'button'; link.id = 'v21forgot'; link.className = 'v21-forgot'; link.textContent = 'Forgot password?';
    lf.appendChild(link);
    link.addEventListener('click', async function () {
      var email = prompt('Enter your account email and we will send you a password reset link:');
      if (!email) return;
      try { var r = await jpost('/api/auth/forgot-password', { email: email.trim() }); T((r.j && r.j.message) || 'If that email exists, a reset link is on its way.', 5000); }
      catch (e) { T('Could not send reset link. Please try again.'); }
    });
  }
  injectForgot();
  setTimeout(injectForgot, 1200);
})();
