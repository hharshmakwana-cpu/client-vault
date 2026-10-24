'use strict';
// Start-up.

// ---------- start ----------
addEventListener('unhandledrejection', e => { console.error(e.reason); toast(errText(e.reason || {})); });
if (!window.isSecureContext || !crypto.subtle) {
  app.innerHTML = `<main class="lock"><h1>Needs a secure connection</h1><p class="sub">Open this app from its https:// address.</p></main>`;
} else {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.();
  bioAvailable().then(ok_ => { BIO_OK = ok_; if (S && cur.v === 'list') renderList(); });
  const qs = new URLSearchParams(location.search);
  if (qs.get('mode') === 'resetPassword' && qs.get('oobCode')) renderReset(qs.get('oobCode'));
  else openVault();
}
