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
