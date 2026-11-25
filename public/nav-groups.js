/* MNB Omni Caller — grouped sidebar.
 *
 * The sidebar grew to ~30 links added by many feature blocks in app.js, each
 * inserting itself next to a sibling. This file runs last and arranges them
 * into six headed, foldable groups by the job somebody opened the app to do.
 *
 * It never wraps links in containers: every feature block finds its anchor
 * with `anchor.parentNode === nav`, so links stay direct children of <nav>.
 * Headings are plain <div>s placed between them, and a group folds by hiding
 * its links. A MutationObserver re-sorts when a block adds a link later (some
 * run only after sign-in). A link with no group stays in "More", so nothing
 * added in future can disappear.
 */
(function () {
  'use strict';
  var GROUPS = [
    { key: 'home', label: 'Home', views: ['getstarted', 'overview', 'tools', 'live', 'call'] },
    { key: 'build', label: 'Build agents', views: ['studio', 'templates', 'knowledge', 'testing', 'versions', 'voicewidget'] },
    { key: 'calls', label: 'Calls & leads', views: ['logs', 'campaigns', 'contacts', 'followups', 'reminders', 'lookup', 'blocklist'] },
    { key: 'insights', label: 'Insights', views: ['analytics', 'trends', 'coaching', 'leaderboard', 'export'] },
    { key: 'numbers', label: 'Numbers & billing', views: ['numbers', 'plan', 'billing'] },
    { key: 'settings', label: 'Settings', views: ['account', 'apikeys', 'integrations', 'help', 'admin'] },
  ];
  var MORE = { key: 'more', label: 'More', views: [] };
  var STORE = 'mnb_nav_closed_v1';
  var closed = {};
  try { closed = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch (e) { closed = {}; }

  function groupOf(view) {
    for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].views.indexOf(view) !== -1) return GROUPS[i];
    return MORE;
  }

  function desired(nav) {
    var links = Array.prototype.slice.call(nav.querySelectorAll(':scope > .nav-item'));
    var out = [];
    GROUPS.concat([MORE]).forEach(function (g) {
      var members = links.filter(function (a) { return groupOf(a.getAttribute('data-view')) === g; });
      if (!members.length) return;
      members.sort(function (a, b) {
        var ia = g.views.indexOf(a.getAttribute('data-view'));
        var ib = g.views.indexOf(b.getAttribute('data-view'));
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      });
      var head = nav.querySelector(':scope > .nav-group[data-group="' + g.key + '"]');
      if (!head) {
        head = document.createElement('button');
        head.type = 'button';
        head.className = 'nav-group';
        head.setAttribute('data-group', g.key);
        head.innerHTML = '<span>' + g.label + '</span><span class="nav-group-chev" aria-hidden="true">&#9662;</span>';
        head.addEventListener('click', function () { toggle(g.key); });
      }
      out.push(head);
      members.forEach(function (a) { if (a.getAttribute('data-group') !== g.key) a.setAttribute('data-group', g.key); out.push(a); });
    });
    return out;
  }

  // Re-sorts only when the order is actually wrong, so its own moves settle
  // after one pass instead of feeding the observer forever.
  function arrange() {
    var nav = document.querySelector('.sidebar nav');
    if (!nav) return;
    var want = desired(nav);
    var have = Array.prototype.slice.call(nav.querySelectorAll(':scope > .nav-item, :scope > .nav-group'));
    var same = want.length === have.length && want.every(function (el, i) { return el === have[i]; });
    if (!same) {
      have.forEach(function (el) { if (want.indexOf(el) === -1 && el.classList.contains('nav-group')) el.remove(); });
      var frag = document.createDocumentFragment();
      want.forEach(function (el) { frag.appendChild(el); });
      nav.appendChild(frag);
    }
    paint(nav);
  }

  function paint(nav) {
    nav = nav || document.querySelector('.sidebar nav');
    if (!nav) return;
    var active = nav.querySelector(':scope > .nav-item.active');
    var activeGroup = active ? active.getAttribute('data-group') : null;
    Array.prototype.slice.call(nav.querySelectorAll(':scope > .nav-group')).forEach(function (h) {
      var key = h.getAttribute('data-group');
      // Home never folds; the group holding the open page is always open.
      var isClosed = key !== 'home' && !!closed[key] && key !== activeGroup;
      h.setAttribute('aria-expanded', String(!isClosed));
      h.classList.toggle('closed', isClosed);
      h.classList.toggle('static', key === 'home');
    });
    Array.prototype.slice.call(nav.querySelectorAll(':scope > .nav-item')).forEach(function (a) {
      if (a.classList.contains('pz-nav-hidden')) {
        a.style.display = 'none';
        return;
      } else {
        a.style.display = '';
      }
      var key = a.getAttribute('data-group');
      var isClosed = key !== 'home' && !!closed[key] && key !== activeGroup;
      a.classList.toggle('nav-folded', isClosed);
    });
  }

  function toggle(key) {
    if (key === 'home') return;
    closed[key] = !closed[key];
    try { localStorage.setItem(STORE, JSON.stringify(closed)); } catch (e) { /* ignore */ }
    paint();
  }

  window.__mnbArrangeNav = arrange;

  function start() {
    var nav = document.querySelector('.sidebar nav');
    if (!nav) return;
    arrange();
    var pending = null;
    new MutationObserver(function () {
      clearTimeout(pending);
      pending = setTimeout(arrange, 30);
    }).observe(nav, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
