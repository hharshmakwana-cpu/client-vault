'use strict';
// Start-up.

// ---------- start ----------
// Behave like an installed app: iPhone Safari ignores "no zoom" in the page settings, so stop
// its pinch gestures here (scrolling, typing and copying still work normally).
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, e => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', e => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

addEventListener('unhandledrejection', e => { console.error(e.reason); toast(errText(e.reason || {})); });
if (!window.isSecureContext || !crypto.subtle) {
  app.innerHTML = `<main class="lock"><h1>Needs a secure connection</h1><p class="sub">Open this app from its https:// address.</p></main>`;
} else {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.();
  bioAvailable().then(ok_ => { BIO_OK = ok_; if (S && cur.v === 'list') renderList(); });
  const qs = new URLSearchParams(location.search);
  if (qs.get('mode') === 'resetPassword' && qs.get('oobCode')) renderReset(qs.get('oobCode'));
  else if (qs.get('mode') === 'verifyEmail' && qs.get('oobCode') && !DB.demo) {
    // Opened from the verification email: confirm it, then carry on.
    history.replaceState(null, '', location.pathname);
    DB.applyVerify(qs.get('oobCode')).then(() => toast('Email verified'), e => toast(e.message)).finally(openVault);
  }
  else openVault();
}
