'use strict';
// Client Vault — all client data is encrypted in the browser (AES-256-GCM) before it is
// stored or uploaded. The server only ever sees ciphertext.
//
// Key design: a random 256-bit data key (DEK) encrypts every record. The DEK itself is
// encrypted ("wrapped") with a key derived from the master password (PBKDF2-SHA256).
// Changing the master password only re-wraps the DEK.
//
// Face ID / biometric unlock uses a passkey with the WebAuthn PRF extension: the passkey
// produces a secret only after Face ID succeeds, and that secret wraps a second copy of the
// DEK kept on this device. The master password is never stored.
//
// The app is split into plain scripts (js/*.js) loaded in order by index.html. They share one
// global scope, so a name declared in an earlier file can be used in a later one.
// This file: settings from config.js, small helpers, local storage and encryption.

const CFG = window.CLIENT_VAULT_CONFIG || {};
const DEMO = !CFG.apiKey || CFG.apiKey === 'demo';
const ITER = 600000;
const enc = new TextEncoder(), dec = new TextDecoder();
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const UA = navigator.userAgent;
const IOS = /iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
const BIO = IOS ? 'Face ID' : /Macintosh/.test(UA) ? 'Touch ID' : /Windows/.test(UA) ? 'Windows Hello' : 'fingerprint';

// ---------- small utils ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rand = n => crypto.getRandomValues(new Uint8Array(n));
const uid = () => [...rand(9)].map(b => b.toString(16).padStart(2, '0')).join('');
function toB64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function fromB64(s) { const b = atob(s), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
function readLS(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }
function writeLS(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch {} }
const fmtDate = t => t ? new Date(typeof t === 'string' ? t + 'T00:00:00' : t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
const fmtTime = t => new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
let toastTimer;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800); }

// ---------- local key-value store (IndexedDB) ----------
const store = (() => {
  let p;
  const db = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('client-vault', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => db().then(d => new Promise((res, rej) => {
    const t = d.transaction('kv', mode); const r = fn(t.objectStore('kv'));
    t.oncomplete = () => res(r.result); t.onerror = () => rej(t.error);
  }));
  return { get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(v, k)), del: k => tx('readwrite', s => s.delete(k)) };
})();

// ---------- crypto ----------
async function passwordKey(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const dataKey = raw => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
async function encJSON(key, obj) {
  const iv = rand(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}
async function decJSON(key, { iv, ct }) {
  return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv) }, key, fromB64(ct))));
}
async function wrapDek(pw, raw) {
  const salt = rand(16), iv = rand(12);
  const k = await passwordKey(pw, salt, ITER);
  const w = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, raw);
  return { salt: toB64(salt), iter: ITER, wiv: toB64(iv), wkey: toB64(new Uint8Array(w)) };
}
async function unwrapDek(pw, v) {
  const k = await passwordKey(pw, fromB64(v.salt), +v.iter);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(v.wiv) }, k, fromB64(v.wkey)));
}
