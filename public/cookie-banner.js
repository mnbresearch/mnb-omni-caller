/* MNB Omni Caller - cookie consent banner (self-injecting, dependency-free).
 * Shows once until the visitor chooses; choice stored in localStorage.
 * Include on any page with: <script src="/cookie-banner.js" defer></script> */
(function () {
  var KEY = 'mnb_cookie_consent';
  try { if (localStorage.getItem(KEY)) return; } catch (e) { /* storage blocked -> still show */ }

  function make() {
    if (document.getElementById('mnb-cookie')) return;

    var css = document.createElement('style');
    css.textContent =
      '#mnb-cookie{position:fixed;left:16px;right:16px;bottom:16px;z-index:99999;max-width:820px;margin:0 auto;' +
      'background:rgba(20,20,22,.97);color:#f4f2ee;border:1px solid #2a2a2f;border-radius:16px;' +
      'box-shadow:0 18px 50px rgba(0,0,0,.5);padding:18px 20px;' +
      'font-family:"Segoe UI",system-ui,-apple-system,sans-serif;' +
      'display:flex;gap:16px;align-items:center;flex-wrap:wrap;' +
      'transform:translateY(140%);transition:transform .45s cubic-bezier(.16,1,.3,1)}' +
      '#mnb-cookie.in{transform:translateY(0)}' +
      '#mnb-cookie .txt{flex:1;min-width:240px;font-size:14px;line-height:1.6;color:#cfcabf}' +
      '#mnb-cookie .txt b{color:#f4f2ee}' +
      '#mnb-cookie a{color:#ffab5e;text-decoration:none}' +
      '#mnb-cookie a:hover{text-decoration:underline}' +
      '#mnb-cookie .btns{display:flex;gap:10px;flex-wrap:wrap}' +
      '#mnb-cookie button{border:0;border-radius:9px;padding:11px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit}' +
      '#mnb-cookie .decline{background:transparent;color:#f4f2ee;border:1px solid #3a3a40}' +
      '#mnb-cookie .decline:hover{border-color:#ff7a18;color:#ffab5e}' +
      '#mnb-cookie .accept{background:linear-gradient(135deg,#ff7a18,#ffb347);color:#111}' +
      '#mnb-cookie .accept:hover{transform:translateY(-1px)}' +
      '@media(max-width:560px){#mnb-cookie{flex-direction:column;align-items:stretch}#mnb-cookie .btns{justify-content:stretch}#mnb-cookie button{flex:1}}';
    document.head.appendChild(css);

    var bar = document.createElement('div');
    bar.id = 'mnb-cookie';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Cookie consent');
    bar.innerHTML =
      '<div class="txt"><b>We use cookies.</b> We use strictly necessary cookies to run this site and, with your consent, a little analytics to improve it. ' +
      'See our <a href="/privacy.html">Privacy Policy</a>.</div>' +
      '<div class="btns">' +
      '<button type="button" class="decline">Decline non-essential</button>' +
      '<button type="button" class="accept">Accept all</button>' +
      '</div>';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add('in'); });

    function choose(v) {
      try { localStorage.setItem(KEY, JSON.stringify({ choice: v, at: Date.now() })); } catch (e) {}
      window.mnbCookieConsent = v;
      bar.classList.remove('in');
      setTimeout(function () { if (bar.parentNode) bar.parentNode.removeChild(bar); }, 450);
    }
    bar.querySelector('.accept').addEventListener('click', function () { choose('all'); });
    bar.querySelector('.decline').addEventListener('click', function () { choose('essential'); });
  }

  if (document.body) make();
  else document.addEventListener('DOMContentLoaded', make);
})();
