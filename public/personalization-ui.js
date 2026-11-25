/**
 * MNB Omni Caller — Universal Enterprise Personalisation & Workspace Manager
 * 
 * Drives:
 *   1. Intelligent Onboarding & Role Discovery Wizard (#getstarted)
 *   2. Personal Modular Dashboard Architecture (#overview)
 *   3. Central Enterprise Tools & Modules Directory (#tools)
 *   4. Four-Level Configuration Hierarchy & Sidebar Personalization
 */

(function () {
  'use strict';

  // State container
  var state = {
    user: null,
    pz: null,
    personas: {},
    widgetsCatalog: {},
    modules: [],
    orgModules: {},
    loaded: false
  };

  function E(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function T(msg, duration) {
    if (typeof window.toast === 'function') {
      window.toast(msg, duration);
    } else {
      console.log('[Toast]', msg);
    }
  }

  // Fetch personalization configuration from API
  async function fetchPersonalization() {
    try {
      var res = await fetch('/api/personalization', { cache: 'no-store' });
      if (!res.ok) return null;
      var data = await res.json();
      if (!data.ok) return null;
      state.pz = data.personalization || {};
      state.personas = data.personas || {};
      state.widgetsCatalog = data.widgetsCatalog || {};
      state.modules = data.modules || [];
      state.orgModules = data.orgModules || {};
      state.loaded = true;
      return state;
    } catch (e) {
      console.warn('[Personalization] fetch failed:', e.message);
      return null;
    }
  }

  // Save personalization configuration to API
  async function savePersonalization(patch) {
    try {
      var merged = Object.assign({}, state.pz || {}, patch || {});
      var res = await fetch('/api/personalization', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(merged)
      });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok) {
        state.pz = data.personalization;
        if (data.modules) state.modules = data.modules;
        applySidebarPersonalization();
        T('Workspace preferences saved');
        return true;
      } else {
        T(data.error || 'Failed to save preferences');
        return false;
      }
    } catch (e) {
      T('Network error saving preferences');
      return false;
    }
  }

  // Reset personalization to persona defaults
  async function resetPersonalization(roleId) {
    try {
      var url = '/api/personalization/reset' + (roleId ? '?role=' + encodeURIComponent(roleId) : '');
      var res = await fetch(url, { method: 'POST' });
      var data = await res.json().catch(function () { return {}; });
      if (res.ok && data.ok) {
        state.pz = data.personalization;
        if (data.modules) state.modules = data.modules;
        applySidebarPersonalization();
        T('Reset to ' + (state.personas[roleId] ? state.personas[roleId].name : 'defaults'));
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  // Hide / show sidebar items based on Level 1 (Org enabled), Level 3 (User visible), and Level 4 (User permitted)
  function applySidebarPersonalization() {
    if (!state.loaded || !state.pz) return;
    var hiddenSet = new Set(state.pz.hiddenModules || []);
    var pinnedSet = new Set(state.pz.pinnedTools || []);
    var disabledOrgSet = new Set();
    Object.keys(state.orgModules || {}).forEach(function (k) {
      if (state.orgModules[k] === false) disabledOrgSet.add(k);
    });

    // Check each module in registry
    state.modules.forEach(function (mod) {
      var el = document.querySelector('.nav-item[data-view="' + mod.id + '"]');
      if (!el) return;

      // Level 1: Disabled by org admin -> completely hide
      if (disabledOrgSet.has(mod.id)) {
        el.style.display = 'none';
        return;
      }

      // Level 4: Not permitted (e.g. non-admin for admin view) -> hide
      if (mod.permitted === false) {
        el.style.display = 'none';
        return;
      }

      // Level 3: User hidden
      var isHidden = hiddenSet.has(mod.id) && !pinnedSet.has(mod.id);
      if (isHidden) {
        el.classList.add('pz-nav-hidden');
      } else {
        el.classList.remove('pz-nav-hidden');
        el.style.display = '';
      }
    });

    // Trigger nav-groups arrange if available
    if (typeof window.__mnbArrangeNav === 'function') {
      window.__mnbArrangeNav();
    }
  }

  /* =======================================================================
   * VIEW: Central Tools & Capabilities Directory (#tools)
   * ==================================================================== */
  function mkView(id) {
    var m = document.querySelector('main.main') || (document.getElementById('view-overview') || {}).parentNode;
    if (!m) return null;
    var existing = document.getElementById('view-' + id);
    if (existing) return existing;
    var s = document.createElement('section');
    s.id = 'view-' + id;
    s.className = 'view hidden';
    m.appendChild(s);
    return s;
  }

  function mkNav(id, ico, label, before) {
    var nav = document.querySelector('.sidebar nav') || document.querySelector('nav');
    if (!nav) return false;
    var existing = document.querySelector('.nav-item[data-view="' + id + '"]');
    if (existing) return true;
    var a = document.createElement('a');
    a.href = '#' + id;
    a.className = 'nav-item';
    a.setAttribute('data-view', id);
    a.innerHTML = '<span class="ico">' + ico + '</span> ' + label;
    var anchor = document.querySelector('.nav-item[data-view="' + before + '"]');
    if (anchor && anchor.parentNode === nav) {
      nav.insertBefore(a, anchor);
    } else {
      nav.appendChild(a);
    }
    a.addEventListener('click', function (e) {
      e.preventDefault();
      if (typeof window.switchView === 'function') window.switchView(id);
    });
    return true;
  }

  var toolsView = null;
  var toolsFilter = { query: '', category: 'all', role: 'all', tab: 'all' };

  function renderToolsView() {
    if (!toolsView) toolsView = mkView('tools');
    if (!toolsView) return;

    var pz = state.pz || {};
    var pinnedSet = new Set(pz.pinnedTools || []);
    var hiddenSet = new Set(pz.hiddenModules || []);
    var favSet = new Set(pz.favorites || []);
    var widgetSet = new Set(pz.widgets || []);

    var categories = [
      { id: 'all', label: 'All Capabilities' },
      { id: 'calling', label: 'Calling & Telephony' },
      { id: 'agents', label: 'Agent Studio & AI' },
      { id: 'campaigns', label: 'Campaigns & Leads' },
      { id: 'insights', label: 'Insights & Analytics' },
      { id: 'numbers', label: 'Numbers & Billing' },
      { id: 'settings', label: 'Settings & Enterprise' }
    ];

    var roles = [
      { id: 'all', label: 'All Roles' },
      { id: 'sales_leader', label: 'Sales & Growth' },
      { id: 'call_center_mgr', label: 'Call Center' },
      { id: 'executive', label: 'Executive' },
      { id: 'smb_founder', label: 'Founder / SMB' },
      { id: 'agency_admin', label: 'Agency' },
      { id: 'tech_dev', label: 'Developer' }
    ];

    // Filter modules
    var q = toolsFilter.query.toLowerCase().trim();
    var filtered = state.modules.filter(function (m) {
      if (toolsFilter.category !== 'all' && m.category !== toolsFilter.category) return false;
      if (toolsFilter.role !== 'all' && m.targetRoles && !m.targetRoles.includes(toolsFilter.role)) return false;
      if (toolsFilter.tab === 'pinned' && !pinnedSet.has(m.id)) return false;
      if (toolsFilter.tab === 'favorites' && !favSet.has(m.id)) return false;
      if (q) {
        var match = (m.name || '').toLowerCase().includes(q) ||
                    (m.description || '').toLowerCase().includes(q) ||
                    (m.categoryLabel || '').toLowerCase().includes(q) ||
                    (m.id || '').toLowerCase().includes(q);
        if (!match) return false;
      }
      return true;
    });

    var html = [
      '<header class="view-head">',
      '  <div class="row-between" style="flex-wrap:wrap;gap:12px">',
      '    <div>',
      '      <h2>Tools & Capabilities Directory</h2>',
      '      <p class="muted">Explore, personalize, and launch all 31 Voice AI capabilities across your organization.</p>',
      '    </div>',
      '    <div style="display:flex;gap:8px;align-items:center">',
      '      <button class="btn ghost small" id="pz-open-customizer-btn">&#9881; Customize Dashboard</button>',
      '      <button class="btn primary small" onclick="window.switchView(\'getstarted\')">&#128640; Personalization Wizard</button>',
      '    </div>',
      '  </div>',
      '</header>',

      '<div class="pz-tools-filter-bar glass">',
      '  <div class="pz-search-box">',
      '    <span class="ico">&#128269;</span>',
      '    <input type="text" id="pz-tools-search" placeholder="Search capabilities by name, purpose, or keyword..." value="' + E(toolsFilter.query) + '" />',
      '  </div>',
      '  <div class="pz-filter-tabs">',
      '    <button class="pz-tab-btn ' + (toolsFilter.tab === 'all' ? 'active' : '') + '" data-tab="all">All (' + state.modules.length + ')</button>',
      '    <button class="pz-tab-btn ' + (toolsFilter.tab === 'pinned' ? 'active' : '') + '" data-tab="pinned">Active on Sidebar (' + pinnedSet.size + ')</button>',
      '    <button class="pz-tab-btn ' + (toolsFilter.tab === 'favorites' ? 'active' : '') + '" data-tab="favorites">&#9733; Favorites (' + favSet.size + ')</button>',
      '  </div>',
      '  <div class="pz-pill-row">',
      '    <span class="pz-pill-label">Category:</span>',
      categories.map(function (c) {
        return '<button class="pz-pill-btn ' + (toolsFilter.category === c.id ? 'active' : '') + '" data-cat="' + c.id + '">' + E(c.label) + '</button>';
      }).join(''),
      '  </div>',
      '  <div class="pz-pill-row" style="margin-top:6px">',
      '    <span class="pz-pill-label">Role Focus:</span>',
      roles.map(function (r) {
        return '<button class="pz-pill-btn ' + (toolsFilter.role === r.id ? 'active' : '') + '" data-role="' + r.id + '">' + E(r.label) + '</button>';
      }).join(''),
      '  </div>',
      '</div>',

      '<div class="pz-tools-grid">'
    ];

    if (!filtered.length) {
      html.push(
        '<div class="pz-empty-state glass" style="grid-column:1/-1;text-align:center;padding:48px 24px">',
        '  <div style="font-size:32px;margin-bottom:12px">&#128269;</div>',
        '  <h3 style="margin:0 0 8px">No matching capabilities found</h3>',
        '  <p class="muted" style="margin:0 0 16px">Try clearing your search query or switching category filters.</p>',
        '  <button class="btn ghost small" id="pz-clear-filters">Reset All Filters</button>',
        '</div>'
      );
    } else {
      filtered.forEach(function (m) {
        var isPinned = pinnedSet.has(m.id);
        var isFav = favSet.has(m.id);
        var hasActiveWidget = m.widgetId ? widgetSet.has(m.widgetId) : false;
        var isPermitted = m.permitted !== false;
        var isEnabled = m.enabled !== false;

        var statusBadges = [];
        if (!isEnabled) {
          statusBadges.push('<span class="pz-badge danger">Disabled by Admin</span>');
        } else if (!isPermitted) {
          statusBadges.push('<span class="pz-badge warn">Admin Only</span>');
        } else {
          if (isPinned) statusBadges.push('<span class="pz-badge success">Active on Nav</span>');
          if (hasActiveWidget) statusBadges.push('<span class="pz-badge info">Dashboard Widget</span>');
          if (m.badge) statusBadges.push('<span class="pz-badge neutral">' + E(m.badge) + '</span>');
        }

        html.push(
          '<div class="pz-module-card glass ' + (!isEnabled || !isPermitted ? 'pz-disabled' : '') + '" data-id="' + E(m.id) + '">',
          '  <div class="pz-card-header">',
          '    <div class="pz-card-icon-title">',
          '      <span class="pz-mod-icon">' + m.icon + '</span>',
          '      <div>',
          '        <h4 class="pz-mod-title">' + E(m.name) + '</h4>',
          '        <span class="pz-mod-category">' + E(m.categoryLabel) + '</span>',
          '      </div>',
          '    </div>',
          '    <button class="pz-fav-btn ' + (isFav ? 'starred' : '') + '" title="Favorite" data-act="fav" data-id="' + E(m.id) + '">&#9733;</button>',
          '  </div>',
          '  <p class="pz-mod-desc">' + E(m.description) + '</p>',
          '  <div class="pz-card-badges">' + statusBadges.join('') + '</div>',
          '  <div class="pz-card-footer">',
          '    <button class="btn primary small" data-act="open" data-route="' + E(m.route) + '" ' + (!isPermitted || !isEnabled ? 'disabled' : '') + '>Open Tool &rarr;</button>',
          '    <div class="pz-card-toggles">',
          '      <button class="pz-toggle-btn ' + (isPinned ? 'active' : '') + '" data-act="pin" data-id="' + E(m.id) + '" title="Toggle sidebar visibility">',
          isPinned ? '&#10003; Pinned' : '+ Pin to Nav',
          '      </button>',
          m.widgetId ? (
            '      <button class="pz-toggle-btn ' + (hasActiveWidget ? 'active' : '') + '" data-act="widget" data-wid="' + E(m.widgetId) + '" title="Toggle dashboard widget">' +
            (hasActiveWidget ? '&#10003; On Dashboard' : '+ Widget') +
            '      </button>'
          ) : '',
          '    </div>',
          '  </div>',
          '</div>'
        );
      });
    }

    html.push('</div>');
    toolsView.innerHTML = html.join('\n');

    // Wire listeners
    var searchInput = document.getElementById('pz-tools-search');
    if (searchInput) {
      searchInput.addEventListener('input', function (e) {
        toolsFilter.query = e.target.value;
        renderToolsView();
        var reInput = document.getElementById('pz-tools-search');
        if (reInput) { reInput.focus(); reInput.setSelectionRange(reInput.value.length, reInput.value.length); }
      });
    }

    var clearBtn = document.getElementById('pz-clear-filters');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        toolsFilter = { query: '', category: 'all', role: 'all', tab: 'all' };
        renderToolsView();
      });
    }

    toolsView.querySelectorAll('.pz-tab-btn').forEach(function (b) {
      b.addEventListener('click', function () {
        toolsFilter.tab = b.getAttribute('data-tab');
        renderToolsView();
      });
    });

    toolsView.querySelectorAll('.pz-pill-btn[data-cat]').forEach(function (b) {
      b.addEventListener('click', function () {
        toolsFilter.category = b.getAttribute('data-cat');
        renderToolsView();
      });
    });

    toolsView.querySelectorAll('.pz-pill-btn[data-role]').forEach(function (b) {
      b.addEventListener('click', function () {
        toolsFilter.role = b.getAttribute('data-role');
        renderToolsView();
      });
    });

    var customizerBtn = document.getElementById('pz-open-customizer-btn');
    if (customizerBtn) {
      customizerBtn.addEventListener('click', openDashboardCustomizer);
    }

    // Card Actions
    toolsView.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', async function (e) {
        e.stopPropagation();
        var act = b.getAttribute('data-act');
        var id = b.getAttribute('data-id');

        if (act === 'open') {
          var route = b.getAttribute('data-route');
          if (typeof window.switchView === 'function') window.switchView(route);
          return;
        }

        if (act === 'fav') {
          var favs = new Set(pz.favorites || []);
          if (favs.has(id)) favs.delete(id); else favs.add(id);
          pz.favorites = Array.from(favs);
          await savePersonalization({ favorites: pz.favorites });
          renderToolsView();
          return;
        }

        if (act === 'pin') {
          var pins = new Set(pz.pinnedTools || []);
          var hids = new Set(pz.hiddenModules || []);
          if (pins.has(id)) {
            pins.delete(id);
            hids.add(id);
          } else {
            pins.add(id);
            hids.delete(id);
          }
          pz.pinnedTools = Array.from(pins);
          pz.hiddenModules = Array.from(hids);
          await savePersonalization({ pinnedTools: pz.pinnedTools, hiddenModules: pz.hiddenModules });
          renderToolsView();
          return;
        }

        if (act === 'widget') {
          var wid = b.getAttribute('data-wid');
          var wids = new Set(pz.widgets || []);
          if (wids.has(wid)) {
            wids.delete(wid);
          } else {
            wids.add(wid);
          }
          pz.widgets = Array.from(wids);
          await savePersonalization({ widgets: pz.widgets });
          renderToolsView();
          renderDashboard();
          return;
        }
      });
    });
  }

  /* =======================================================================
   * VIEW: Modular Personal Dashboard Architecture (#overview)
   * ==================================================================== */
  function renderDashboard() {
    var viewOverview = document.getElementById('view-overview');
    if (!viewOverview) return;

    var pz = state.pz || {};
    var persona = state.personas[pz.role] || state.personas.sales_leader || {};
    var activeWidgets = pz.widgets || persona.recommendedWidgets || ['w_kpi_ribbon', 'w_quick_actions', 'w_recent_calls'];

    // Ensure header banner
    var existingHead = document.getElementById('pz-dashboard-header');
    if (!existingHead) {
      existingHead = document.createElement('div');
      existingHead.id = 'pz-dashboard-header';
      existingHead.className = 'pz-dash-header glass';
      viewOverview.insertBefore(existingHead, viewOverview.firstChild);
    }

    var orgTitle = (state.user && state.user.org) || 'Enterprise Workspace';
    var personaOptions = Object.keys(state.personas).map(function (k) {
      var p = state.personas[k];
      return '<option value="' + E(p.id) + '" ' + (pz.role === p.id ? 'selected' : '') + '>' + E(p.name) + '</option>';
    }).join('');

    existingHead.innerHTML = [
      '<div class="pz-dash-banner-left">',
      '  <div class="pz-persona-badge">&#9672; ' + E(persona.roleTitle || 'Enterprise Workspace') + '</div>',
      '  <h2 style="margin:4px 0 2px;font-size:1.35rem">' + E(orgTitle) + '</h2>',
      '  <p class="muted" style="margin:0;font-size:0.85rem">' + E(persona.description || 'Configured personal workspace') + '</p>',
      '</div>',
      '<div class="pz-dash-banner-right">',
      '  <div class="pz-persona-selector-wrap">',
      '    <label for="pz-persona-select" class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.05em">Active Persona View:</label>',
      '    <select id="pz-persona-select" class="pz-select">' + personaOptions + '</select>',
      '  </div>',
      '  <button class="btn ghost small" id="pz-dash-customize-btn">&#9881; Customize Layout</button>',
      '  <button class="btn primary small" onclick="window.switchView(\'tools\')">&#8862; Tools Directory</button>',
      '</div>'
    ].join('\n');

    var personaSelect = document.getElementById('pz-persona-select');
    if (personaSelect) {
      personaSelect.addEventListener('change', async function (e) {
        var newRole = e.target.value;
        await resetPersonalization(newRole);
        renderDashboard();
        renderToolsView();
      });
    }

    var customizeBtn = document.getElementById('pz-dash-customize-btn');
    if (customizeBtn) {
      customizeBtn.addEventListener('click', openDashboardCustomizer);
    }

    // Ensure grid container
    var grid = document.getElementById('pz-dashboard-grid');
    if (!grid) {
      grid = document.createElement('div');
      grid.id = 'pz-dashboard-grid';
      grid.className = 'pz-dashboard-grid';
      // Place right after header
      existingHead.insertAdjacentElement('afterend', grid);
    }

    // Hide legacy unorganized overview elements so the new modular grid is primary
    var legacyMetrics = viewOverview.querySelector(':scope > .metrics');
    if (legacyMetrics) legacyMetrics.style.display = 'none';
    var legacyAttention = viewOverview.querySelector(':scope > .attention');
    if (legacyAttention) legacyAttention.style.display = 'none';
    var legacyQuickTools = viewOverview.querySelector(':scope > .quick-tools');
    if (legacyQuickTools) legacyQuickTools.style.display = 'none';

    // Move existing table card into our w_recent_calls widget container
    var legacyTableCard = viewOverview.querySelector(':scope > .table-card');
    if (legacyTableCard) legacyTableCard.style.display = 'none';

    // Render widgets
    var widgetHtml = [];
    activeWidgets.forEach(function (wId) {
      var w = state.widgetsCatalog[wId];
      if (!w) return;
      widgetHtml.push(renderWidgetHtml(wId, w));
    });

    grid.innerHTML = widgetHtml.join('\n');

    // Post-mount widget population
    populateWidgets(viewOverview);
  }

  function renderWidgetHtml(wId, w) {
    var sizeClass = w.size === 'full' ? 'pz-col-full' : 'pz-col-half';
    return [
      '<div class="pz-widget-card glass ' + sizeClass + '" id="widget-' + E(wId) + '">',
      '  <div class="pz-widget-header">',
      '    <div class="pz-widget-title-wrap">',
      '      <span class="pz-widget-dot"></span>',
      '      <h3 class="pz-widget-title">' + E(w.title) + '</h3>',
      '    </div>',
      '    <div class="pz-widget-actions" id="wact-' + E(wId) + '"></div>',
      '  </div>',
      '  <div class="pz-widget-body" id="wbody-' + E(wId) + '">',
      '    <div class="muted" style="padding:16px;text-align:center">Loading data&hellip;</div>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  async function populateWidgets(viewOverview) {
    // 1. KPI Ribbon (w_kpi_ribbon)
    var kpiBody = document.getElementById('wbody-w_kpi_ribbon');
    if (kpiBody) {
      kpiBody.innerHTML = [
        '<div class="pz-kpi-row">',
        '  <div class="pz-kpi-item">',
        '    <div class="pz-kpi-val" id="pzKpiMins">&mdash;</div>',
        '    <div class="pz-kpi-lbl">Minutes Balance</div>',
        '    <div class="pz-kpi-sub" id="pzKpiCap">Pay as you go</div>',
        '  </div>',
        '  <div class="pz-kpi-item">',
        '    <div class="pz-kpi-val" id="pzKpiCalls">&mdash;</div>',
        '    <div class="pz-kpi-lbl">Total Calls</div>',
        '    <div class="pz-kpi-sub">Lifetime volume</div>',
        '  </div>',
        '  <div class="pz-kpi-item">',
        '    <div class="pz-kpi-val" id="pzKpiConnect">&mdash;</div>',
        '    <div class="pz-kpi-lbl">Connect Rate</div>',
        '    <div class="pz-kpi-sub">Successful pickup</div>',
        '  </div>',
        '  <div class="pz-kpi-item">',
        '    <div class="pz-kpi-val" id="pzKpiDuration">&mdash;</div>',
        '    <div class="pz-kpi-lbl">Avg Duration</div>',
        '    <div class="pz-kpi-sub">mm:ss</div>',
        '  </div>',
        '  <div class="pz-kpi-item">',
        '    <div class="pz-kpi-val" id="pzKpiSentiment">&mdash;</div>',
        '    <div class="pz-kpi-lbl">Sentiment Score</div>',
        '    <div class="pz-kpi-sub">AI analyzed</div>',
        '  </div>',
        '</div>'
      ].join('\n');

      var kpiAct = document.getElementById('wact-w_kpi_ribbon');
      if (kpiAct) {
        kpiAct.innerHTML = '<button class="btn ghost small" onclick="window.switchView(\'billing\')">+ Top Up</button>';
      }

      // Sync data from overview metric elements if available
      setTimeout(function () {
        var mMin = document.getElementById('metricMinutes');
        var mCap = document.getElementById('metricCap');
        var mCal = document.getElementById('metricCalls');
        var mRat = document.getElementById('metricRate');
        var mDur = document.getElementById('metricDuration');
        var mSen = document.getElementById('metricSentiment');

        var pMin = document.getElementById('pzKpiMins');
        var pCap = document.getElementById('pzKpiCap');
        var pCal = document.getElementById('pzKpiCalls');
        var pRat = document.getElementById('pzKpiConnect');
        var pDur = document.getElementById('pzKpiDuration');
        var pSen = document.getElementById('pzKpiSentiment');

        if (mMin && pMin) pMin.textContent = mMin.textContent;
        if (mCap && pCap && mCap.textContent) pCap.textContent = mCap.textContent;
        if (mCal && pCal) pCal.textContent = mCal.textContent;
        if (mRat && pRat) pRat.textContent = mRat.textContent;
        if (mDur && pDur) pDur.textContent = mDur.textContent;
        if (mSen && pSen) pSen.textContent = mSen.textContent;
      }, 300);
    }

    // 2. Quick Actions (w_quick_actions)
    var qaBody = document.getElementById('wbody-w_quick_actions');
    if (qaBody) {
      qaBody.innerHTML = [
        '<div class="pz-quick-actions-grid">',
        '  <button class="pz-qa-btn" onclick="window.switchView(\'call\')">',
        '    <span class="pz-qa-ico">&#9990;</span>',
        '    <span class="pz-qa-txt">Place Call</span>',
        '  </button>',
        '  <button class="pz-qa-btn" onclick="window.switchView(\'studio\')">',
        '    <span class="pz-qa-ico">&#9998;</span>',
        '    <span class="pz-qa-txt">New Agent</span>',
        '  </button>',
        '  <button class="pz-qa-btn" onclick="window.switchView(\'campaigns\')">',
        '    <span class="pz-qa-ico">&#8694;</span>',
        '    <span class="pz-qa-txt">Campaign</span>',
        '  </button>',
        '  <button class="pz-qa-btn" onclick="window.switchView(\'voicewidget\')">',
        '    <span class="pz-qa-ico">&#127908;</span>',
        '    <span class="pz-qa-txt">Web Widget</span>',
        '  </button>',
        '  <button class="pz-qa-btn" onclick="window.switchView(\'contacts\')">',
        '    <span class="pz-qa-ico">&#128101;</span>',
        '    <span class="pz-qa-txt">Add Contact</span>',
        '  </button>',
        '  <button class="pz-qa-btn" onclick="window.switchView(\'billing\')">',
        '    <span class="pz-qa-ico">&#128179;</span>',
        '    <span class="pz-qa-txt">Buy Minutes</span>',
        '  </button>',
        '</div>'
      ].join('\n');
    }

    // 3. Live Concurrent Calls Monitor (w_live_monitor)
    var liveBody = document.getElementById('wbody-w_live_monitor');
    if (liveBody) {
      try {
        var liveData = await fetch('/api/calls/live').then(function (r) { return r.json(); }).catch(function () { return {}; });
        var activeCalls = liveData.active_calls || liveData.calls || [];
        if (!activeCalls.length) {
          liveBody.innerHTML = '<div class="muted" style="padding:18px;text-align:center">&#9673; No active calls right now. When an agent dials or receives a call, it streams live here.</div>';
        } else {
          liveBody.innerHTML = activeCalls.map(function (c) {
            return '<div class="pz-live-call-row"><b>' + E(c.bot_name || 'Agent') + '</b> &rarr; ' + E(c.to_number || c.number) + ' <span class="pz-badge success">Live</span></div>';
          }).join('');
        }
      } catch (e) {
        liveBody.innerHTML = '<div class="muted" style="padding:14px;text-align:center">Ready to monitor live calls.</div>';
      }
    }

    // 4. Recent Calls & Audio Feed (w_recent_calls)
    var recentBody = document.getElementById('wbody-w_recent_calls');
    if (recentBody) {
      try {
        var logsData = await fetch('/api/calls/logs?pageno=1&pagesize=6').then(function (r) { return r.json(); }).catch(function () { return {}; });
        var rows = logsData.call_log_data || [];
        if (!rows.length) {
          recentBody.innerHTML = '<div class="muted" style="padding:24px;text-align:center">No call records yet. Dispatch your first AI call to see transcripts and recordings here.</div>';
        } else {
          var rowsHtml = rows.map(function (log) {
            var sentScore = Number(log.sentiment_score || 0);
            var sentColor = sentScore > 0.2 ? 'var(--good,#43b97f)' : (sentScore < -0.2 ? 'var(--bad,#e05d55)' : 'var(--muted,#97938c)');
            var dur = log.call_duration != null ? Math.round(Number(log.call_duration)) + 's' : '&mdash;';
            return [
              '<tr class="pz-log-row" data-id="' + E(log.id) + '">',
              '  <td><b>' + E(log.bot_name || 'Agent') + '</b></td>',
              '  <td>' + E(log.to_number || '&mdash;') + '</td>',
              '  <td><span class="pz-chip ' + (log.call_status === 'completed' ? 'good' : 'warn') + '">' + E(log.call_status || 'ended') + '</span></td>',
              '  <td>' + dur + '</td>',
              '  <td style="color:' + sentColor + ';font-weight:600">' + (log.sentiment_score != null ? log.sentiment_score : '&mdash;') + '</td>',
              '  <td><button class="btn ghost small" onclick="openCallDrawer(\'' + E(log.id) + '\')">Inspect</button></td>',
              '</tr>'
            ].join('\n');
          }).join('\n');

          recentBody.innerHTML = [
            '<table class="table" style="width:100%;font-size:0.9rem">',
            '  <thead><tr><th>Agent</th><th>Recipient</th><th>Status</th><th>Duration</th><th>Sentiment</th><th>Action</th></tr></thead>',
            '  <tbody>' + rowsHtml + '</tbody>',
            '</table>'
          ].join('\n');

          var recAct = document.getElementById('wact-w_recent_calls');
          if (recAct) {
            recAct.innerHTML = '<button class="btn ghost small" onclick="window.switchView(\'logs\')">View All Logs &rarr;</button>';
          }
        }
      } catch (e) {
        recentBody.innerHTML = '<div class="muted" style="padding:16px;text-align:center">Call log feed available in Call Logs tab.</div>';
      }
    }

    // 5. Agent Performance (w_agent_performance)
    var agentBody = document.getElementById('wbody-w_agent_performance');
    if (agentBody) {
      try {
        var agentsData = await fetch('/api/agents').then(function (r) { return r.json(); }).catch(function () { return {}; });
        var bots = agentsData.bots || [];
        if (!bots.length) {
          agentBody.innerHTML = '<div class="muted" style="padding:18px;text-align:center">No agents deployed. Create your first voice agent in Agent Studio.</div>';
        } else {
          agentBody.innerHTML = bots.slice(0, 4).map(function (b) {
            return [
              '<div class="pz-agent-row">',
              '  <div>',
              '    <div style="font-weight:600">' + E(b.bot_name || b.name || 'AI Voice Agent') + '</div>',
              '    <div class="muted" style="font-size:12px">' + E(b.llm_model || 'Omni-v2') + ' &bull; ' + E(b.voice || 'Natural') + '</div>',
              '  </div>',
              '  <button class="btn ghost small" onclick="window.switchView(\'studio\')">Edit Agent</button>',
              '</div>'
            ].join('\n');
          }).join('\n');
        }
      } catch (e) {
        agentBody.innerHTML = '<div class="muted" style="padding:14px;text-align:center">Voice agents active.</div>';
      }
    }

    // 6. Campaign Progress (w_campaign_progress)
    var campBody = document.getElementById('wbody-w_campaign_progress');
    if (campBody) {
      try {
        var campData = await fetch('/api/campaigns').then(function (r) { return r.json(); }).catch(function () { return {}; });
        var camps = campData.bulk_calls || campData.campaigns || [];
        if (!camps.length) {
          campBody.innerHTML = '<div class="muted" style="padding:18px;text-align:center">No bulk campaigns running. Upload lead lists in Campaigns to start high-volume outreach.</div>';
        } else {
          campBody.innerHTML = camps.slice(0, 3).map(function (c) {
            var total = Number(c.total_contacts || c.total || 0);
            var comp = Number(c.completed_contacts || c.completed || 0);
            var pct = total > 0 ? Math.round((comp / total) * 100) : 0;
            return [
              '<div style="margin-bottom:12px">',
              '  <div class="row-between" style="font-size:13px;margin-bottom:4px">',
              '    <b>' + E(c.campaign_name || c.name || 'Outbound Campaign') + '</b>',
              '    <span class="muted">' + comp + '/' + total + ' (' + pct + '%)</span>',
              '  </div>',
              '  <div class="pz-progress-track"><div class="pz-progress-bar" style="width:' + pct + '%"></div></div>',
              '</div>'
            ].join('\n');
          }).join('\n');
        }
      } catch (e) {
        campBody.innerHTML = '<div class="muted" style="padding:14px;text-align:center">Bulk outbound engine ready.</div>';
      }
    }

    // 7. AI Coaching (w_ai_coaching)
    var coachBody = document.getElementById('wbody-w_ai_coaching');
    if (coachBody) {
      coachBody.innerHTML = [
        '<div class="pz-coaching-box">',
        '  <div class="pz-coach-item">',
        '    <div class="pz-coach-badge">Objection Discovery</div>',
        '    <p style="margin:4px 0 0;font-size:13px">Callers frequently ask about setup timeline. Recommended instruction update: <i>"We provision numbers and deploy within 1 business day."</i></p>',
        '  </div>',
        '  <div class="pz-coach-item" style="margin-top:10px">',
        '    <div class="pz-coach-badge">Pricing Transparency</div>',
        '    <p style="margin:4px 0 0;font-size:13px">Lead connect rate jumps 22% when agent mentions pay-as-you-go rate (&#8377;12/min) in initial pitch.</p>',
        '  </div>',
        '</div>'
      ].join('\n');
    }

    // 8. Reminders & Tasks (w_reminders_tasks)
    var remBody = document.getElementById('wbody-w_reminders_tasks');
    if (remBody) {
      try {
        var crmData = await fetch('/api/crm').then(function (r) { return r.json(); }).catch(function () { return {}; });
        var followups = crmData.followups || {};
        var pending = Object.keys(followups).filter(function (k) { return followups[k] && !followups[k].done; });
        if (!pending.length) {
          remBody.innerHTML = '<div class="muted" style="padding:18px;text-align:center">&#10003; No pending callbacks. All scheduled lead follow-ups are up to date.</div>';
        } else {
          remBody.innerHTML = pending.slice(0, 3).map(function (k) {
            var f = followups[k];
            return '<div class="pz-reminder-row"><b>' + E(f.number || k) + '</b> &bull; ' + E(f.note || 'Callback requested') + '</div>';
          }).join('');
        }
      } catch (e) {
        remBody.innerHTML = '<div class="muted" style="padding:14px;text-align:center">Follow-up scheduler active.</div>';
      }
    }

    // 9. DNC Safety (w_dnc_safety)
    var dncBody = document.getElementById('wbody-w_dnc_safety');
    if (dncBody) {
      try {
        var dncData = await fetch('/api/blocklist').then(function (r) { return r.json(); }).catch(function () { return {}; });
        var blocked = dncData.blocked || [];
        dncBody.innerHTML = [
          '<div style="display:flex;align-items:center;gap:12px;padding:8px 0">',
          '  <span style="font-size:28px;color:var(--good,#43b97f)">&#128737;</span>',
          '  <div>',
          '    <div style="font-weight:700;font-size:1.1rem">' + blocked.length + ' Numbers Blocked</div>',
          '    <div class="muted" style="font-size:12.5px">Do-Not-Call compliance active. Blocked numbers will be automatically skipped in campaigns and direct dials.</div>',
          '  </div>',
          '</div>'
        ].join('\n');
      } catch (e) {
        dncBody.innerHTML = '<div class="muted" style="padding:14px;text-align:center">DNC protection active.</div>';
      }
    }

    // 10. Developer API Health (w_api_health)
    var apiBody = document.getElementById('wbody-w_api_health');
    if (apiBody) {
      apiBody.innerHTML = [
        '<div style="font-size:13px">',
        '  <div class="row-between" style="margin-bottom:8px">',
        '    <span>REST API Endpoint:</span>',
        '    <code>https://omni.mnbresearch.com/api/v1</code>',
        '  </div>',
        '  <div class="row-between" style="margin-bottom:8px">',
        '    <span>OpenAPI Spec:</span>',
        '    <a href="/api/v1-openapi.json" target="_blank" style="color:var(--accent,#ff7a18)">v1-openapi.json &rarr;</a>',
        '  </div>',
        '  <div class="row-between">',
        '    <span>Authentication:</span>',
        '    <span class="pz-badge success">Bearer Key Active</span>',
        '  </div>',
        '</div>'
      ].join('\n');

      var apiAct = document.getElementById('wact-w_api_health');
      if (apiAct) {
        apiAct.innerHTML = '<button class="btn ghost small" onclick="window.switchView(\'apikeys\')">Manage Keys</button>';
      }
    }
  }

  /* =======================================================================
   * SLIDE-OVER: Dashboard Customizer Drawer (#pz-customizer-drawer)
   * ==================================================================== */
  function openDashboardCustomizer() {
    var drawer = document.getElementById('pz-customizer-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'pz-customizer-drawer';
      drawer.className = 'pz-customizer-drawer hidden';
      document.body.appendChild(drawer);
    }

    var pz = state.pz || {};
    var activeSet = new Set(pz.widgets || []);
    var catalogKeys = Object.keys(state.widgetsCatalog);

    var presetsHtml = Object.keys(state.personas).map(function (k) {
      var p = state.personas[k];
      return '<button class="btn ghost small ' + (pz.role === p.id ? 'active' : '') + '" data-preset="' + E(p.id) + '">' + E(p.name) + '</button>';
    }).join('');

    var widgetsListHtml = catalogKeys.map(function (wId, idx) {
      var w = state.widgetsCatalog[wId];
      var isChecked = activeSet.has(wId);
      return [
        '<div class="pz-customizer-item glass ' + (isChecked ? 'checked' : '') + '" data-wid="' + E(wId) + '">',
        '  <div class="row-between">',
        '    <label class="pz-checkbox-label">',
        '      <input type="checkbox" ' + (isChecked ? 'checked' : '') + ' data-wid-check="' + E(wId) + '" />',
        '      <b style="margin-left:8px">' + E(w.title) + '</b>',
        '    </label>',
        '    <div class="pz-order-btns">',
        '      <button class="btn ghost small" data-move="up" data-wid="' + E(wId) + '" title="Move Up">&#9650;</button>',
        '      <button class="btn ghost small" data-move="down" data-wid="' + E(wId) + '" title="Move Down">&#9660;</button>',
        '    </div>',
        '  </div>',
        '  <p class="muted" style="margin:4px 0 0 24px;font-size:12px">' + E(w.description) + '</p>',
        '</div>'
      ].join('\n');
    }).join('\n');

    drawer.innerHTML = [
      '<div class="pz-customizer-backdrop" id="pz-customizer-backdrop"></div>',
      '<div class="pz-customizer-panel glass">',
      '  <div class="row-between pz-customizer-header">',
      '    <h3 style="margin:0">&#9881; Customize Dashboard Layout</h3>',
      '    <button class="btn ghost small" id="pz-close-customizer-btn">&#10005; Close</button>',
      '  </div>',
      '  <div class="pz-customizer-body">',
      '    <div style="margin-bottom:18px">',
      '      <h4 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;color:var(--muted)">1-Click Layout Presets</h4>',
      '      <div style="display:flex;flex-wrap:wrap;gap:6px">' + presetsHtml + '</div>',
      '    </div>',
      '    <div>',
      '      <h4 style="margin:0 0 8px;font-size:13px;text-transform:uppercase;color:var(--muted)">Active Widgets &amp; Ordering</h4>',
      '      <div id="pz-customizer-widget-list">' + widgetsListHtml + '</div>',
      '    </div>',
      '  </div>',
      '  <div class="row-between pz-customizer-footer">',
      '    <button class="btn ghost" id="pz-reset-customizer-btn">Reset to Role Defaults</button>',
      '    <button class="btn primary" id="pz-save-customizer-btn">Save &amp; Apply Layout</button>',
      '  </div>',
      '</div>'
    ].join('\n');

    drawer.classList.remove('hidden');

    // Close handlers
    document.getElementById('pz-close-customizer-btn').addEventListener('click', closeDashboardCustomizer);
    document.getElementById('pz-customizer-backdrop').addEventListener('click', closeDashboardCustomizer);

    // Preset handlers
    drawer.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var presetRole = btn.getAttribute('data-preset');
        var p = state.personas[presetRole];
        if (p) {
          pz.role = p.id;
          pz.widgets = [...p.recommendedWidgets];
          await savePersonalization({ role: pz.role, widgets: pz.widgets });
          closeDashboardCustomizer();
          renderDashboard();
          renderToolsView();
        }
      });
    });

    // Move Up / Down handlers
    drawer.querySelectorAll('[data-move]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var dir = btn.getAttribute('data-move');
        var wid = btn.getAttribute('data-wid');
        var curWidgets = pz.widgets || [];
        var idx = curWidgets.indexOf(wid);
        if (idx === -1) return;
        if (dir === 'up' && idx > 0) {
          var temp = curWidgets[idx - 1];
          curWidgets[idx - 1] = curWidgets[idx];
          curWidgets[idx] = temp;
        } else if (dir === 'down' && idx < curWidgets.length - 1) {
          var temp2 = curWidgets[idx + 1];
          curWidgets[idx + 1] = curWidgets[idx];
          curWidgets[idx] = temp2;
        }
        pz.widgets = curWidgets;
        openDashboardCustomizer(); // re-render drawer
      });
    });

    // Reset button
    document.getElementById('pz-reset-customizer-btn').addEventListener('click', async function () {
      await resetPersonalization(pz.role);
      closeDashboardCustomizer();
      renderDashboard();
    });

    // Save button
    document.getElementById('pz-save-customizer-btn').addEventListener('click', async function () {
      var selected = [];
      drawer.querySelectorAll('[data-wid-check]').forEach(function (cb) {
        if (cb.checked) selected.push(cb.getAttribute('data-wid-check'));
      });
      pz.widgets = selected.length ? selected : ['w_kpi_ribbon', 'w_quick_actions', 'w_recent_calls'];
      await savePersonalization({ widgets: pz.widgets });
      closeDashboardCustomizer();
      renderDashboard();
    });
  }

  function closeDashboardCustomizer() {
    var drawer = document.getElementById('pz-customizer-drawer');
    if (drawer) drawer.classList.add('hidden');
  }

  /* =======================================================================
   * VIEW: Intelligent Progressive Onboarding & Role Discovery (#getstarted)
   * ==================================================================== */
  var onboardingView = null;
  var onbStep = 1;
  var onbData = {
    industry: 'general',
    callVolume: 'moderate',
    role: 'sales_leader',
    objective: 'lead_qualification',
    priorities: {} // moduleId -> 'essential' | 'important' | 'optional'
  };

  function renderOnboardingWizard() {
    if (!onboardingView) onboardingView = mkView('getstarted');
    if (!onboardingView) return;

    var pz = state.pz || {};
    if (pz.role && !onbData.role) onbData.role = pz.role;
    if (pz.industry && !onbData.industry) onbData.industry = pz.industry;

    var steps = [
      { num: 1, title: 'Business Profile' },
      { num: 2, title: 'Your Role' },
      { num: 3, title: 'Feature Priorities' },
      { num: 4, title: 'Layout Preview' },
      { num: 5, title: 'Operational Setup' }
    ];

    var stepperHtml = steps.map(function (s) {
      var activeClass = onbStep === s.num ? 'active' : (onbStep > s.num ? 'done' : '');
      return [
        '<div class="pz-step-node ' + activeClass + '" data-step="' + s.num + '">',
        '  <div class="pz-step-circle">' + (onbStep > s.num ? '&#10003;' : s.num) + '</div>',
        '  <span class="pz-step-title">' + E(s.title) + '</span>',
        '</div>'
      ].join('');
    }).join('<div class="pz-step-line"></div>');

    var stepContent = '';
    if (onbStep === 1) stepContent = renderOnbStep1();
    else if (onbStep === 2) stepContent = renderOnbStep2();
    else if (onbStep === 3) stepContent = renderOnbStep3();
    else if (onbStep === 4) stepContent = renderOnbStep4();
    else if (onbStep === 5) stepContent = renderOnbStep5();

    onboardingView.innerHTML = [
      '<header class="view-head">',
      '  <div class="row-between">',
      '    <div>',
      '      <span class="pz-badge neutral" style="margin-bottom:6px">MNB RESEARCH &bull; WORKSPACE PERSONALIZATION</span>',
      '      <h2>Intelligent Onboarding &amp; Workspace Setup</h2>',
      '      <p class="muted">Transform your Voice AI console into a personal command center tailored to your responsibilities.</p>',
      '    </div>',
      '    <button class="btn ghost small" onclick="window.switchView(\'overview\')">Skip to Dashboard &rarr;</button>',
      '  </div>',
      '</header>',
      '<div class="pz-onb-container glass">',
      '  <div class="pz-stepper-bar">' + stepperHtml + '</div>',
      '  <div class="pz-onb-body">' + stepContent + '</div>',
      '</div>'
    ].join('\n');

    wireOnboardingEvents();
  }

  function renderOnbStep1() {
    var industries = [
      { id: 'real_estate', icon: '&#127968;', name: 'Real Estate & Property', desc: 'Buyer lead qualification & site visit confirmations' },
      { id: 'healthcare', icon: '&#127973;', name: 'Healthcare & Clinics', desc: 'Patient appointment scheduling & pre-consultation reminders' },
      { id: 'ecommerce', icon: '&#128722;', name: 'E-Commerce & Retail', desc: 'Order confirmation (COD), shipping updates & abandoned cart calls' },
      { id: 'financial', icon: '&#128181;', name: 'Financial & FinTech', desc: 'Loan qualification, KYC follow-ups & payment reminders' },
      { id: 'education', icon: '&#127891;', name: 'Education & EdTech', desc: 'Course inquiry counseling & admissions follow-up' },
      { id: 'b2b_services', icon: '&#128188;', name: 'B2B & Professional', desc: 'Inbound demo qualification, partner outreach & meeting booking' },
      { id: 'logistics', icon: '&#128666;', name: 'Logistics & Dispatch', desc: 'Delivery confirmation, driver routing & address verification' },
      { id: 'general', icon: '&#127760;', name: 'Other / Multi-Industry', desc: 'General business voice automation' }
    ];

    var volumeOptions = [
      { id: 'starter', label: '< 500 calls/month', sub: 'Single agent, initial validation' },
      { id: 'moderate', label: '500 - 2,500 calls/month', sub: 'Growing sales or customer support pipeline' },
      { id: 'scale', label: '2,500 - 10,000 calls/month', sub: 'Multi-agent high-scale outreach' },
      { id: 'enterprise', label: '10,000+ calls/month', sub: 'Enterprise concurrent telephony & CRM sync' }
    ];

    return [
      '<div class="pz-step-inner">',
      '  <h3>Step 1: Understand your business context</h3>',
      '  <p class="muted">Which industry best represents your primary operations?</p>',
      '  <div class="pz-industry-grid">',
      industries.map(function (ind) {
        var isSel = onbData.industry === ind.id;
        return [
          '<div class="pz-choice-card glass ' + (isSel ? 'selected' : '') + '" data-industry="' + ind.id + '">',
          '  <div class="pz-choice-icon">' + ind.icon + '</div>',
          '  <h4 style="margin:4px 0 2px">' + E(ind.name) + '</h4>',
          '  <p class="muted" style="font-size:12px;margin:0">' + E(ind.desc) + '</p>',
          '</div>'
        ].join('\n');
      }).join('\n'),
      '  </div>',
      '  <h4 style="margin:24px 0 8px">Expected Monthly Calling Volume:</h4>',
      '  <div class="pz-vol-row">',
      volumeOptions.map(function (v) {
        var isSel = onbData.callVolume === v.id;
        return [
          '<div class="pz-vol-card ' + (isSel ? 'selected' : '') + '" data-volume="' + v.id + '">',
          '  <b>' + E(v.label) + '</b>',
          '  <div class="muted" style="font-size:11.5px">' + E(v.sub) + '</div>',
          '</div>'
        ].join('\n');
      }).join('\n'),
      '  </div>',
      '  <div class="pz-onb-nav-footer">',
      '    <div></div>',
      '    <button class="btn primary" id="pz-onb-next">Continue to Role Selection &rarr;</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  function renderOnbStep2() {
    var personasList = Object.keys(state.personas).map(function (k) { return state.personas[k]; });
    return [
      '<div class="pz-step-inner">',
      '  <h3>Step 2: What is your primary professional role?</h3>',
      '  <p class="muted">We will tailor your command center, KPIs, and tool navigation to how you work.</p>',
      '  <div class="pz-persona-grid">',
      personasList.map(function (p) {
        var isSel = onbData.role === p.id;
        return [
          '<div class="pz-persona-card glass ' + (isSel ? 'selected' : '') + '" data-role="' + p.id + '">',
          '  <div class="row-between">',
          '    <h4 style="margin:0;font-size:1.05rem">' + E(p.name) + '</h4>',
          '    <span class="pz-badge ' + (isSel ? 'success' : 'neutral') + '">' + (isSel ? 'Selected' : 'Select') + '</span>',
          '  </div>',
          '  <div class="muted" style="font-size:12px;margin:4px 0 8px;font-weight:600">' + E(p.roleTitle) + '</div>',
          '  <p class="muted" style="font-size:12.5px;margin:0 0 12px">' + E(p.description) + '</p>',
          '  <div class="pz-rec-pill">Recommended Widgets: ' + (p.recommendedWidgets || []).length + '</div>',
          '</div>'
        ].join('\n');
      }).join('\n'),
      '  </div>',
      '  <div class="pz-onb-nav-footer">',
      '    <button class="btn ghost" id="pz-onb-back">&larr; Back</button>',
      '    <button class="btn primary" id="pz-onb-next">Continue to Feature Prioritization &rarr;</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  function renderOnbStep3() {
    var selectedPersona = state.personas[onbData.role] || state.personas.sales_leader;
    var essentialCats = new Set(selectedPersona.essentialCategories || ['calling', 'campaigns']);
    var recommendedPinned = new Set(selectedPersona.recommendedPinned || []);

    return [
      '<div class="pz-step-inner">',
      '  <div class="row-between">',
      '    <div>',
      '      <h3>Step 3: Feature Prioritization</h3>',
      '      <p class="muted">Tag which capabilities are Essential (pinned to primary navigation), Important, or Optional.</p>',
      '    </div>',
      '    <span class="pz-badge info">Tailored for ' + E(selectedPersona.name) + '</span>',
      '  </div>',
      '  <div class="pz-onb-modules-list">',
      state.modules.map(function (m) {
        if (!m.permitted || !m.enabled) return '';
        var defaultPrio = 'optional';
        if (recommendedPinned.has(m.id)) defaultPrio = 'essential';
        else if (essentialCats.has(m.category)) defaultPrio = 'important';

        var currentPrio = onbData.priorities[m.id] || defaultPrio;

        return [
          '<div class="pz-prio-row glass">',
          '  <div class="pz-prio-left">',
          '    <span class="pz-mod-icon" style="font-size:20px">' + m.icon + '</span>',
          '    <div>',
          '      <b>' + E(m.name) + '</b>',
          '      <p class="muted" style="margin:2px 0 0;font-size:12px">' + E(m.description) + '</p>',
          '    </div>',
          '  </div>',
          '  <div class="pz-prio-buttons" data-mod="' + E(m.id) + '">',
          '    <button class="pz-prio-btn ' + (currentPrio === 'essential' ? 'sel-essential' : '') + '" data-val="essential">&starf; Essential</button>',
          '    <button class="pz-prio-btn ' + (currentPrio === 'important' ? 'sel-important' : '') + '" data-val="important">&bull; Important</button>',
          '    <button class="pz-prio-btn ' + (currentPrio === 'optional' ? 'sel-optional' : '') + '" data-val="optional">&#8862; Optional</button>',
          '  </div>',
          '</div>'
        ].join('\n');
      }).join('\n'),
      '  </div>',
      '  <div class="pz-onb-nav-footer">',
      '    <button class="btn ghost" id="pz-onb-back">&larr; Back</button>',
      '    <button class="btn primary" id="pz-onb-next">Preview Dashboard Layout &rarr;</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  function renderOnbStep4() {
    var p = state.personas[onbData.role] || state.personas.sales_leader;
    var widgets = p.recommendedWidgets || ['w_kpi_ribbon', 'w_quick_actions', 'w_recent_calls'];

    var pinnedList = [];
    Object.keys(onbData.priorities).forEach(function (k) {
      if (onbData.priorities[k] === 'essential') pinnedList.push(k);
    });
    if (!pinnedList.length) pinnedList = p.recommendedPinned || ['overview', 'call', 'logs', 'studio'];

    return [
      '<div class="pz-step-inner">',
      '  <h3>Step 4: Your Personalized Workspace is Ready</h3>',
      '  <p class="muted">Review the configuration generated specifically for your role and industry.</p>',
      '  <div class="pz-preview-card glass" style="margin:16px 0 24px">',
      '    <div class="row-between" style="padding-bottom:12px;border-bottom:1px solid var(--border)">',
      '      <div>',
      '        <span class="pz-badge success">&#9672; ' + E(p.name) + '</span>',
      '        <h4 style="margin:6px 0 2px">Workspace Profile: ' + E(onbData.industry) + '</h4>',
      '      </div>',
      '      <span class="muted" style="font-size:12px">Auto-Configured by MNB Personalisation Engine</span>',
      '    </div>',
      '    <div style="margin-top:14px">',
      '      <b>Configured Dashboard Widgets (' + widgets.length + '):</b>',
      '      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">',
      widgets.map(function (wId) {
        var w = state.widgetsCatalog[wId];
        return '<span class="pz-chip good">&#10003; ' + E((w && w.title) || wId) + '</span>';
      }).join(''),
      '      </div>',
      '    </div>',
      '    <div style="margin-top:14px">',
      '      <b>Primary Navigation Shortcuts:</b>',
      '      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">',
      pinnedList.map(function (mId) {
        var mod = state.modules.find(function (m) { return m.id === mId; });
        return '<span class="pz-chip info">' + (mod ? mod.icon + ' ' + E(mod.shortName) : mId) + '</span>';
      }).join(''),
      '      </div>',
      '    </div>',
      '  </div>',
      '  <div class="pz-onb-nav-footer">',
      '    <button class="btn ghost" id="pz-onb-back">&larr; Back</button>',
      '    <button class="btn primary big" id="pz-onb-apply">&#10003; Apply Configuration &amp; Proceed to Launch &rarr;</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  async function renderOnbStep5() {
    var s = { minutes: 0, cap: 0, agents: 0, numbers: 0, calls: 0 };
    try {
      var me = await fetch('/api/me').then(function (r) { return r.json(); });
      var u = me.user || {};
      s.cap = Number(u.minuteCap) || 0;
      s.minutes = u.remainingMinutes != null ? u.remainingMinutes : s.cap;
    } catch (e) {}
    try { s.agents = ((await fetch('/api/agents').then(function (r) { return r.json(); })).bots || []).length; } catch (e) {}
    try { s.numbers = ((await fetch('/api/numbers').then(function (r) { return r.json(); })).phone_numbers || []).length; } catch (e) {}
    try { var l = await fetch('/api/calls/logs?pageno=1&pagesize=1').then(function (r) { return r.json(); }); s.calls = l.total_records != null ? l.total_records : 0; } catch (e) {}

    var steps = [
      { done: s.cap > 0, t: 'Top up calling minutes', d: 'Pay as you go at &#8377;12/min via secure Cashfree checkout.', act: 'billing', btn: 'Add Minutes' },
      { done: s.agents > 0, t: 'Configure your voice agent', d: 'Choose voice, conversational flow, and knowledge base.', act: 'studio', btn: 'Open Studio' },
      { done: s.numbers > 0, t: 'Connect dedicated caller ID number', d: 'Virtual local/toll-free number or bring your own SIP / Twilio trunk.', act: 'numbers', btn: 'Manage Numbers' },
      { done: s.calls > 0, t: 'Place your first live AI call', d: 'Test live speech recognition, conversational intelligence, and transcript synthesis.', act: 'call', btn: 'Make Test Call' }
    ];

    var doneCount = steps.filter(function (x) { return x.done; }).length;
    var pct = Math.round((doneCount / steps.length) * 100);

    return [
      '<div class="pz-step-inner">',
      '  <h3>Step 5: Operational Launch Checklist</h3>',
      '  <p class="muted">Four practical steps to dispatch your first live AI voice call.</p>',
      '  <div class="pz-progress-track" style="margin:16px 0 20px"><div class="pz-progress-bar" style="width:' + pct + '%"></div></div>',
      '  <div style="font-size:13px;color:var(--muted);margin-top:-14px;margin-bottom:18px">' + doneCount + ' of ' + steps.length + ' milestones complete' + (doneCount === 4 ? ' &mdash; Platform fully operational!' : '') + '</div>',
      steps.map(function (st, idx) {
        return [
          '<div class="pz-milestone-row glass ' + (st.done ? 'done' : '') + '">',
          '  <div class="pz-mile-num">' + (st.done ? '&#10003;' : (idx + 1)) + '</div>',
          '  <div style="flex:1">',
          '    <h4 style="margin:0 0 2px">' + E(st.t) + '</h4>',
          '    <p class="muted" style="margin:0;font-size:12.5px">' + st.d + '</p>',
          '  </div>',
          '  <button class="btn ' + (st.done ? 'ghost' : 'primary') + ' small" onclick="window.switchView(\'' + st.act + '\')">' + (st.done ? 'Review' : st.btn) + '</button>',
          '</div>'
        ].join('\n');
      }).join('\n'),
      '  <div class="pz-onb-nav-footer">',
      '    <button class="btn ghost" id="pz-onb-back">&larr; Back to Preview</button>',
      '    <button class="btn primary big" onclick="window.switchView(\'overview\')">Open My Personal Dashboard &rarr;</button>',
      '  </div>',
      '</div>'
    ].join('\n');
  }

  function wireOnboardingEvents() {
    if (!onboardingView) return;

    // Stepper node clicks
    onboardingView.querySelectorAll('.pz-step-node').forEach(function (node) {
      node.addEventListener('click', function () {
        var s = Number(node.getAttribute('data-step'));
        if (s <= onbStep || s === onbStep + 1) {
          onbStep = s;
          renderOnboardingWizard();
        }
      });
    });

    // Step 1: Industry click
    onboardingView.querySelectorAll('[data-industry]').forEach(function (card) {
      card.addEventListener('click', function () {
        onbData.industry = card.getAttribute('data-industry');
        renderOnboardingWizard();
      });
    });

    // Step 1: Volume click
    onboardingView.querySelectorAll('[data-volume]').forEach(function (card) {
      card.addEventListener('click', function () {
        onbData.callVolume = card.getAttribute('data-volume');
        renderOnboardingWizard();
      });
    });

    // Step 2: Persona click
    onboardingView.querySelectorAll('[data-role]').forEach(function (card) {
      card.addEventListener('click', function () {
        onbData.role = card.getAttribute('data-role');
        renderOnboardingWizard();
      });
    });

    // Step 3: Priority buttons
    onboardingView.querySelectorAll('.pz-prio-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var parent = btn.closest('.pz-prio-buttons');
        if (!parent) return;
        var modId = parent.getAttribute('data-mod');
        var val = btn.getAttribute('data-val');
        onbData.priorities[modId] = val;
        parent.querySelectorAll('.pz-prio-btn').forEach(function (b) {
          b.className = 'pz-prio-btn';
        });
        btn.classList.add('sel-' + val);
      });
    });

    // Nav buttons
    var nextBtn = document.getElementById('pz-onb-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', function () {
        onbStep++;
        renderOnboardingWizard();
      });
    }

    var backBtn = document.getElementById('pz-onb-back');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        onbStep--;
        renderOnboardingWizard();
      });
    }

    // Step 4 Apply button
    var applyBtn = document.getElementById('pz-onb-apply');
    if (applyBtn) {
      applyBtn.addEventListener('click', async function () {
        var p = state.personas[onbData.role] || state.personas.sales_leader;
        var widgets = p.recommendedWidgets || ['w_kpi_ribbon', 'w_quick_actions', 'w_recent_calls'];

        var pinned = [];
        var hidden = [];
        Object.keys(onbData.priorities).forEach(function (k) {
          if (onbData.priorities[k] === 'essential') pinned.push(k);
          if (onbData.priorities[k] === 'optional') hidden.push(k);
        });

        if (!pinned.length) pinned = p.recommendedPinned || ['overview', 'call', 'logs', 'studio'];

        await savePersonalization({
          role: onbData.role,
          industry: onbData.industry,
          widgets: widgets,
          pinnedTools: pinned,
          hiddenModules: hidden,
          onboardingCompleted: true
        });

        onbStep = 5;
        renderOnboardingWizard();
      });
    }
  }

  /* =======================================================================
   * Global Hook & View Switcher Integration
   * ==================================================================== */
  function hookViewSwitcher() {
    // Add Tools Directory to sidebar if missing
    mkNav('tools', '&#8862;', 'Tools Directory', 'call');

    var prevSwitch = window.switchView;
    window.switchView = function (view) {
      if (view === 'tools') {
        document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
        if (!toolsView) toolsView = mkView('tools');
        if (toolsView) toolsView.classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(function (n) {
          n.classList.toggle('active', n.getAttribute('data-view') === 'tools');
        });
        location.hash = 'tools';
        renderToolsView();
        return;
      }

      if (view === 'getstarted') {
        document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); });
        if (!onboardingView) onboardingView = mkView('getstarted');
        if (onboardingView) onboardingView.classList.remove('hidden');
        document.querySelectorAll('.nav-item').forEach(function (n) {
          n.classList.toggle('active', n.getAttribute('data-view') === 'getstarted');
        });
        location.hash = 'getstarted';
        renderOnboardingWizard();
        return;
      }

      var res = prevSwitch ? prevSwitch.apply(this, arguments) : null;

      if (view === 'overview') {
        setTimeout(renderDashboard, 100);
      }
      return res;
    };
  }

  /* Bootstrapping */
  async function boot() {
    await fetchPersonalization();
    hookViewSwitcher();
    applySidebarPersonalization();

    var curHash = (location.hash || '').replace('#', '');
    if (curHash === 'tools') {
      window.switchView('tools');
    } else if (curHash === 'getstarted') {
      window.switchView('getstarted');
    } else if (!curHash || curHash === 'overview') {
      renderDashboard();
    }
  }

  // Expose API on window
  window.__MNB_PZ = {
    state: state,
    fetch: fetchPersonalization,
    save: savePersonalization,
    reset: resetPersonalization,
    renderDashboard: renderDashboard,
    renderToolsView: renderToolsView,
    renderOnboardingWizard: renderOnboardingWizard,
    openCustomizer: openDashboardCustomizer,
    closeCustomizer: closeDashboardCustomizer
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    setTimeout(boot, 200);
  }
})();
