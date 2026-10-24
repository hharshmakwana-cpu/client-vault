// A stand-in for Firebase (sign-in + Firestore REST) for the browser tests. It follows the same
// access rules as firebase/firestore.rules, keeps document versions (updateTime) and honours
// save preconditions, so edits from two "devices" can conflict just like on the real server.
const ROOT = 'projects/p/databases/(default)/documents';

function makeFake({ ownerUid, ownerEmail = 'owner@example.com', ownerPass = 'ownerpass1' } = {}) {
  const users = new Map(ownerUid ? [[ownerUid, { email: ownerEmail, pw: ownerPass, verified: true }]] : []);
  const docs = new Map(); // path → { fields, t }
  const approved = new Map(), requests = new Map();
  const state = { offline: false, writes: 0, n: 0, clock: 0 };
  const stamp = () => new Date(Date.UTC(2026, 9, 24, 10, 0, 0) + ++state.clock).toISOString().replace('Z', '000Z');

  async function handler(route) {
    const req = route.request(), url = new URL(req.url());
    if (state.offline) return route.abort('internetdisconnected');
    const raw = req.postData();
    const body = raw ? (() => { try { return JSON.parse(raw); } catch { return Object.fromEntries(new URLSearchParams(raw)); } })() : {};
    const json = (o, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(o) });
    const err = (message, status = 400, st) => json({ error: { message, code: status, status: st || message } }, status);
    const tok = uid => ({ idToken: 'tok:' + uid, refreshToken: 'r:' + uid, expiresIn: '3600', localId: uid });

    if (url.host === 'securetoken.googleapis.com') {
      const uid = String(body.refresh_token).slice(2);
      return users.has(uid) ? json({ id_token: 'tok:' + uid, refresh_token: 'r:' + uid, expires_in: '3600' }) : err('USER_NOT_FOUND');
    }
    if (url.host === 'identitytoolkit.googleapis.com') {
      const op = url.pathname.split(':').pop(), me = body.idToken?.slice(4);
      const find = email => [...users].find(([, u]) => u.email === String(email).toLowerCase());
      if (op === 'signUp') {
        if (find(body.email)) return err('EMAIL_EXISTS');
        const uid = 'u' + (++state.n);
        users.set(uid, { email: body.email.toLowerCase(), pw: body.password, verified: false });
        return json({ ...tok(uid), email: body.email.toLowerCase() });
      }
      if (op === 'signInWithPassword') { const e = find(body.email); return e && e[1].pw === body.password ? json({ ...tok(e[0]), email: e[1].email }) : err('INVALID_LOGIN_CREDENTIALS'); }
      if (op === 'sendOobCode') return json({});
      if (op === 'lookup') { const u = users.get(me); return json({ users: [{ localId: me, email: u.email, emailVerified: u.verified, displayName: u.name }] }); }
      if (op === 'update') { if (me && body.displayName) users.get(me).name = body.displayName; return json({}); }
      if (op === 'delete') { users.delete(me); return json({}); }
      return err('UNKNOWN');
    }

    // Firestore
    const uid = (req.headers()['authorization'] || '').replace('Bearer tok:', ''), u = users.get(uid);
    if (!u) return err('unauth', 401, 'UNAUTHENTICATED');
    const path = decodeURIComponent(url.pathname.split('/documents')[1] || ''), m = req.method(), seg = path.split('/').filter(Boolean);
    const isOwner = uid === ownerUid, mine = seg[1] === u.email && u.verified;
    const fields = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? { integerValue: String(v) } : { stringValue: String(v) }]));
    const doc = p => ({ name: ROOT + p, fields: docs.get(p).fields, updateTime: docs.get(p).t });
    if (seg[0] === 'users') {
      const ok = seg[1] === uid && (isOwner || (u.verified && approved.has(u.email)));
      if (!ok) return err('denied', 403, 'PERMISSION_DENIED');
      if (m === 'GET') {
        if (path.endsWith('/clients')) return json({ documents: [...docs.keys()].filter(k => k.startsWith(path + '/')).map(doc) });
        return docs.has(path) ? json(doc(path)) : err('nf', 404, 'NOT_FOUND');
      }
      if (m === 'PATCH') {
        const exists = url.searchParams.get('currentDocument.exists'), at = url.searchParams.get('currentDocument.updateTime');
        if (exists === 'false' && docs.has(path)) return err('exists', 409, 'ALREADY_EXISTS');
        if (at && (!docs.has(path) || docs.get(path).t !== at)) return err('stale', 400, 'FAILED_PRECONDITION');
        const masks = url.searchParams.getAll('updateMask.fieldPaths'), incoming = JSON.parse(raw).fields;
        const next = masks.length ? { ...(docs.get(path)?.fields || {}), ...incoming } : incoming;
        docs.set(path, { fields: next, t: stamp() }); state.writes++;
        return json(doc(path));
      }
      if (m === 'DELETE') { docs.delete(path); state.writes++; return json({}); }
    }
    const col = seg[0] === 'approved' ? approved : seg[0] === 'requests' ? requests : null;
    if (!col) return err('denied', 403, 'PERMISSION_DENIED');
    if (seg.length === 1) return isOwner && m === 'GET' ? json({ documents: [...col].map(([e, d]) => ({ name: `${ROOT}/${seg[0]}/${e}`, fields: fields(d) })) }) : err('denied', 403, 'PERMISSION_DENIED');
    if (m === 'GET') return isOwner || mine ? (col.has(seg[1]) ? json({ name: ROOT + path, fields: fields(col.get(seg[1])) }) : err('nf', 404, 'NOT_FOUND')) : err('denied', 403, 'PERMISSION_DENIED');
    if (m === 'DELETE') return isOwner || (col === requests && mine) ? (col.delete(seg[1]), json({})) : err('denied', 403, 'PERMISSION_DENIED');
    if (m === 'PATCH') {
      const data = Object.fromEntries(Object.entries(JSON.parse(raw).fields).map(([k, v]) => [k, v.integerValue !== undefined ? +v.integerValue : v.stringValue]));
      if (col === approved) return isOwner ? (col.set(seg[1], data), json({})) : err('denied', 403, 'PERMISSION_DENIED');
      if (!mine || Object.keys(data).some(k => !['name', 'at'].includes(k))) return err('denied', 403, 'PERMISSION_DENIED');
      if (col.has(seg[1])) return err('denied', 403, 'PERMISSION_DENIED'); // an update isn't allowed by the rules
      col.set(seg[1], data); return json({});
    }
    return err('bad');
  }
  return { handler, users, docs, approved, requests, state };
}
module.exports = { makeFake, ROOT };
