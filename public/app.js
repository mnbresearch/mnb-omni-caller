/* ===== MNB Research — Voice AI Platform (frontend) ===== */

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
  if (btn) btn.textContent = theme === 'light' ? '◑ Dark mode' : '◐ Light mode';
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
    $('loginOk').textContent = '✅ ' + (r.message || 'Request sent.');
    $('loginOk').classList.remove('hidden');
    setTimeout(showLogin, 2500);
  } catch (e) {
    $('loginError').textContent = e.message;
    $('loginError').classList.remove('hidden');
  }
}

async function doLogout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  location.reload();
}

function applyRoleUi() {
  const admin = me && me.role === 'admin';
  $('navAdmin').classList.toggle('hidden', !admin);
  $('newAgentBtn').classList.toggle('hidden', !admin);
  const delBtn = document.querySelector('#view-studio .view-head .btn.ghost[onclick="deleteAgent()"]');
  if (delBtn) delBtn.classList.toggle('hidden', !admin);
  $('whoami').textContent = me ? `${me.org} · ${me.email}` : '';
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
  toast('Preparing export…');
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
        <h3>MNB Research — Administrator</h3>
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
  const remaining = cap ? Math.max(0, cap - used) : '∞';
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
        <div class="muted" style="margin-top:6px">${used} of ${cap === 0 ? '∞' : cap} minutes · ${remaining === '∞' ? 'unlimited remaining' : remaining + ' remaining'}</div>
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
      ${u.phone ? ` · <b>${esc(u.phone)}</b>
        <a class="btn ghost small" style="padding:2px 8px;margin-left:6px" href="tel:${esc(phoneDigits)}">✆ Call</a>
        <a class="btn ghost small" style="padding:2px 8px" target="_blank" href="https://wa.me/${esc(waDigits)}">WhatsApp</a>` : ''}
      ${u.note ? `<div class="muted" style="margin-top:6px">“${show(u.note)}”</div>` : ''}
    </div>` : '';
  return `<div class="section-block">
    <div class="row-between">
      <div><b>${show(u.org || '—')}</b> · <span class="muted">${esc(u.email)}</span> ${statusBadge}
        ${u.usedMinutes != null ? `<span class="muted"> · ${u.usedMinutes}/${u.minuteCap} min this month</span>` : ''}
      </div>
      <div>
        ${u.status !== 'active' ? `<button class="btn primary small" onclick="adminSave('${u.id}','active')">✓ Approve</button>` : ''}
        ${u.status === 'active' ? `<button class="btn ghost small" onclick="adminSave('${u.id}','active')">Save changes</button>
          <button class="btn ghost small" style="color:var(--bad)" onclick="adminSave('${u.id}','rejected')">Revoke</button>` : ''}
        <button class="btn ghost small" style="color:var(--bad)" onclick="adminDelete('${u.id}')">✕ Delete</button>
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
    el.textContent = `✅ Agent "${name}" created.`;
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
    el.textContent = '❌ ' + scrub(e.message);
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
    $('statSentiment').textContent = sentiments.length ? Math.round((pos / sentiments.length) * 100) + '%' : '–';

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
    <button class="btn ghost small" onclick="this.parentElement.remove()">✕</button>`;
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
  $('dispatchBtn').textContent = 'Dialing…';
  try {
    const r = await api('/calls/dispatch', { method: 'POST', body });
    const el = $('dispatchResult');
    el.className = 'result ok';
    el.innerHTML = `✅ Call dispatched to <b>${esc(to)}</b> — status: <b>${show(r.status || 'queued')}</b>${r.requestId ? ` (ref #${r.requestId})` : ''}. The transcript will appear under Call Logs once the call ends.`;
    el.classList.remove('hidden');
    const agentName = agents.find((a) => a.id === agentId)?.name || 'Agent';
    const h = $('dispatchHistory');
    if (h.querySelector('p')) h.innerHTML = '';
    h.insertAdjacentHTML('afterbegin',
      `<div class="item"><b>${esc(to)}</b> · ${show(agentName)} · ${new Date().toLocaleTimeString()} · <span class="badge completed">dispatched</span></div>`);
    toast('Call placed ✆');
  } catch (e) {
    const el = $('dispatchResult');
    el.className = 'result err';
    el.textContent = '❌ ' + scrub(e.message);
    el.classList.remove('hidden');
  } finally {
    $('dispatchBtn').disabled = false;
    $('dispatchBtn').textContent = '✆ Place call';
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
    $('agVoice').value = scrub([studioAgent.voice_name, studioAgent.voice_provider, studioAgent.llm_service].filter(Boolean).join(' · '));
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
  sel.innerHTML = '<option value="">Loading voices…</option>';
  try {
    const data = await api('/voices?provider=' + encodeURIComponent(provider) + '&page=1&page_size=100');
    const voices = data.voices || [];
    sel.innerHTML = voices.length
      ? voices.map((v) => {
          const vid = v.name || v.voice_id || v.external_id || v.id;
          const label = [v.display_name || v.voice_name || v.name, v.gender, v.accent || v.language].filter(Boolean).join(' · ');
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
      <button class="btn ghost small" onclick="this.closest('.section-block').remove()">✕ Remove</button>
    </div>
    <textarea class="sec-body" rows="5" placeholder="Instructions for this part of the conversation…">${esc(scrub(body))}</textarea>`;
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
    el.textContent = '✅ Agent updated. New calls will use this training immediately.';
    el.classList.remove('hidden');
    toast('Agent saved');
    loadAgents();
  } catch (e) {
    const el = $('studioStatus');
    el.className = 'result err';
    el.textContent = '❌ ' + scrub(e.message);
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
    <td><span class="badge ${esc(l.call_status || 'neutral')}">${esc(l.call_status || '—')}</span></td>
    <td>${show(l.sentiment_score || '—')}</td>
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
    $('logsPageInfo').textContent = `Page ${page} · ${total} calls`;
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
      <dt>Time</dt><dd>${esc(log.time_of_call || '—')}</dd>
      <dt>Agent</dt><dd>${show(log.bot_name || '—')}</dd>
      <dt>Direction</dt><dd>${esc(log.call_direction || '—')}</dd>
      <dt>From → To</dt><dd>${esc(log.from_number || '—')} → ${esc(log.to_number || '—')}</dd>
      <dt>Duration</dt><dd>${esc(log.call_duration || '—')}</dd>
      <dt>Outcome</dt><dd><span class="badge ${esc(log.call_status || 'neutral')}">${esc(log.call_status || '—')}</span></dd>
      <dt>Sentiment</dt><dd>${show(log.sentiment_score || '—')}</dd>
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
  el.textContent = isPdf ? 'Uploading…' : 'Converting to PDF and uploading…';
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
    el.textContent = `✅ ${file.name} added as a source.`;
    $('kbFile').value = '';
    loadKnowledge();
  } catch (e) {
    el.className = 'result err';
    el.textContent = '❌ ' + scrub(e.message);
  }
}

async function uploadKbText() {
  const el = $('kbUploadStatus');
  const title = $('kbTextTitle').value.trim();
  const text = $('kbText').value.trim();
  if (!text) return toast('Paste some text first');
  el.className = 'result';
  el.textContent = 'Converting to PDF and uploading…';
  el.classList.remove('hidden');
  try {
    await api('/knowledge/upload-text', { method: 'POST', body: { title: title || 'Pasted text', text } });
    el.className = 'result ok';
    el.textContent = `✅ "${title || 'Pasted text'}" added as a source.`;
    $('kbTextTitle').value = '';
    $('kbText').value = '';
    loadKnowledge();
  } catch (e) {
    el.className = 'result err';
    el.textContent = '❌ ' + scrub(e.message);
  }
}

async function uploadKbUrl() {
  const el = $('kbUploadStatus');
  const url = $('kbUrl').value.trim();
  if (!url) return toast('Enter a web page URL first');
  el.className = 'result';
  el.textContent = 'Fetching page, converting to PDF…';
  el.classList.remove('hidden');
  try {
    await api('/knowledge/upload-url', { method: 'POST', body: { url } });
    el.className = 'result ok';
    el.textContent = `✅ Page imported as a source.`;
    $('kbUrl').value = '';
    loadKnowledge();
  } catch (e) {
    el.className = 'result err';
    el.textContent = '❌ ' + scrub(e.message);
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
    el.textContent = '✅ ' + scrub(r.message || 'Attached to agent.');
    el.classList.remove('hidden');
  } catch (e) {
    el.className = 'result err';
    el.textContent = '❌ ' + scrub(e.message);
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
    el.textContent = '✅ ' + scrub(r.message || 'Detached from agent.');
    el.classList.remove('hidden');
  } catch (e) {
    el.className = 'result err';
    el.textContent = '❌ ' + scrub(e.message);
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
          <td>${show(c.name || c.campaign_name || '—')}</td>
          <td>${show(c.bot_name || c.agent_name || '—')}</td>
          <td><span class="badge neutral">${esc(c.status || '—')}</span></td>
          <td>${esc(c.total_contacts ?? c.contacts_count ?? '—')}</td>
          <td>${esc(c.created_at || c.created_date || '—')}</td>
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
  if (!fromId) return toast('A phone number on the account is required for campaigns — see the Phone Numbers tab', 6000);
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
  el.textContent = 'Launching campaign…';
  el.classList.remove('hidden');
  try {
    await api('/campaigns', { method: 'POST', body: { name, phone_number_id: String(fromId), contact_list: contacts } });
    el.className = 'result ok';
    el.textContent = `✅ Campaign "${name}" launched with ${contacts.length} contact(s).`;
    $('cpName').value = ''; $('cpContacts').value = '';
    loadCampaigns();
  } catch (e) {
    el.className = 'result err';
    el.textContent = '❌ ' + scrub(e.message);
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
          <td><b>${show(n.phone_number || n.number || '—')}</b></td>
          <td>${show(n.bot_name || n.agent_name || (n.attached_agent_id ? 'Agent #' + n.attached_agent_id : 'Not attached'))}</td>
          <td>
            <select id="numAg${n.id}" style="width:auto;display:inline-block;margin-right:8px">${agentOpts}</select>
            <button class="btn ghost small" onclick="attachNumber(${n.id})">Attach</button>
            <button class="btn ghost small" onclick="detachNumber(${n.id})">Detach</button>
          </td>
        </tr>`).join('')}</tbody></table>`
      : `<p class="muted">No phone numbers on this account yet. Single outbound calls still work using the platform's default number. To get a dedicated number for inbound calls and campaigns, one can be purchased in the account's Numbers Shop — ask your platform admin (that's you, MNB Research).</p>`;
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
