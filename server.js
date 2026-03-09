const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('MONGO_URI fehlt! Bitte in Render als Environment Variable setzen.');
  process.exit(1);
}

let db;
const client = new MongoClient(MONGO_URI);

async function connectDB() {
  await client.connect();
  db = client.db('skibiditiers');
  console.log('MongoDB verbunden');
}

// ── SUPER-ADMIN (fest kodiert) ──
const SUPER_ADMIN = {
  name: Buffer.from('Tm9haGFkbWlubjE1Ng==', 'base64').toString(),
  pass: Buffer.from('MTIzTm9haGRpbzJ3cg==', 'base64').toString(),
  code: Buffer.from('NzM5MjE0', 'base64').toString(),
  role: 'superadmin'
};

// ── DB HELFER ──
async function getData() {
  const doc = await db.collection('data').findOne({ _id: 'main' });
  return doc || { players: [], admins: [], cats: null, log: [], settings: {} };
}
async function saveData(updates) {
  await db.collection('data').updateOne(
    { _id: 'main' },
    { $set: updates },
    { upsert: true }
  );
}
async function getSession(token) {
  if (!token) return null;
  const s = await db.collection('sessions').findOne({ _id: token });
  if (!s) return null;
  if (Date.now() - s.created > 24 * 60 * 60 * 1000) {
    await db.collection('sessions').deleteOne({ _id: token });
    return null;
  }
  return s;
}
async function createSession(name, role) {
  const token = crypto.randomBytes(32).toString('hex');
  await db.collection('sessions').insertOne({ _id: token, name, role, created: Date.now() });
  return token;
}
async function deleteSession(token) {
  if (token) await db.collection('sessions').deleteOne({ _id: token });
}
function addLogEntry(data, who, action) {
  data.log = data.log || [];
  data.log.unshift({ t: new Date().toLocaleString('de-DE'), who, action });
  if (data.log.length > 300) data.log.pop();
}

// ── HTTP HELFER ──
function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch(e) { resolve({}); } });
  });
}
function getToken(req) {
  return (req.headers['authorization'] || '').replace('Bearer ', '').trim() || null;
}
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization'
  });
  res.end(JSON.stringify(data));
}
async function requireAuth(req, res) {
  const session = await getSession(getToken(req));
  if (!session) { json(res, 401, { error: 'Nicht eingeloggt' }); return null; }
  return session;
}
async function requireSuperAdmin(req, res) {
  const session = await requireAuth(req, res);
  if (!session) return null;
  if (session.role !== 'superadmin') { json(res, 403, { error: 'Keine Berechtigung' }); return null; }
  return session;
}

// ── SERVER ──
const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  const method = req.method;

  if (method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' });
    res.end(); return;
  }

  // Statische Dateien
  if (method === 'GET' && !url.startsWith('/api/')) {
    let filePath = path.join(__dirname, 'public', url === '/' ? 'index.html' : url);
    if (!fs.existsSync(filePath)) filePath = path.join(__dirname, 'public', 'index.html');
    const ext = path.extname(filePath);
    const mime = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css' }[ext] || 'text/plain';
    try { const content = fs.readFileSync(filePath); res.writeHead(200, { 'Content-Type': mime }); res.end(content); }
    catch(e) { json(res, 404, { error: 'Nicht gefunden' }); }
    return;
  }

  try {

  // POST /api/login
  if (url === '/api/login' && method === 'POST') {
    const { username, password, code } = await parseBody(req);
    if (username === SUPER_ADMIN.name && password === SUPER_ADMIN.pass && code === SUPER_ADMIN.code) {
      const token = await createSession(SUPER_ADMIN.name, 'superadmin');
      return json(res, 200, { token, role: 'superadmin', name: SUPER_ADMIN.name });
    }
    const data = await getData();
    const admin = (data.admins || []).find(a => a.name === username && a.pass === password && a.code === code && a.active);
    if (admin) {
      const token = await createSession(admin.name, admin.role || 'subadmin');
      return json(res, 200, { token, role: admin.role || 'subadmin', name: admin.name });
    }
    return json(res, 401, { error: 'Falsche Zugangsdaten oder 2FA-Code' });
  }

  // POST /api/logout
  if (url === '/api/logout' && method === 'POST') {
    await deleteSession(getToken(req));
    return json(res, 200, { ok: true });
  }

  // GET /api/me
  if (url === '/api/me' && method === 'GET') {
    const session = await getSession(getToken(req));
    if (!session) return json(res, 401, { error: 'Nicht eingeloggt' });
    return json(res, 200, { name: session.name, role: session.role });
  }

  // GET /api/data
  if (url === '/api/data' && method === 'GET') {
    const data = await getData();
    return json(res, 200, { players: data.players || [], cats: data.cats, settings: data.settings || {} });
  }

  // GET /api/admin/data
  if (url === '/api/admin/data' && method === 'GET') {
    const session = await requireAuth(req, res); if (!session) return;
    const data = await getData();
    const isSA = session.role === 'superadmin';
    return json(res, 200, { players: data.players || [], cats: data.cats, settings: data.settings || {}, admins: isSA ? (data.admins || []) : [], log: isSA ? (data.log || []) : [] });
  }

  // POST /api/players
  if (url === '/api/players' && method === 'POST') {
    const session = await requireAuth(req, res); if (!session) return;
    const body = await parseBody(req);
    if (!body.name) return json(res, 400, { error: 'Name fehlt' });
    const data = await getData();
    data.players = data.players || [];
    if (data.players.find(p => p.name.toLowerCase() === body.name.toLowerCase()))
      return json(res, 409, { error: 'Spieler existiert bereits' });
    const player = { id: Date.now(), name: body.name, ranks: body.ranks || {} };
    data.players.push(player);
    addLogEntry(data, session.name, 'Spieler hinzugefügt: ' + body.name);
    await saveData({ players: data.players, log: data.log });
    return json(res, 200, player);
  }

  // DELETE /api/players/:id
  if (url.startsWith('/api/players/') && method === 'DELETE') {
    const session = await requireAuth(req, res); if (!session) return;
    const id = parseInt(url.split('/')[3]);
    const data = await getData();
    const p = (data.players || []).find(x => x.id === id);
    if (!p) return json(res, 404, { error: 'Nicht gefunden' });
    data.players = data.players.filter(x => x.id !== id);
    addLogEntry(data, session.name, 'Spieler gelöscht: ' + p.name);
    await saveData({ players: data.players, log: data.log });
    return json(res, 200, { ok: true });
  }

  // PUT /api/players/:id/ranks
  if (url.match(/^\/api\/players\/\d+\/ranks$/) && method === 'PUT') {
    const session = await requireAuth(req, res); if (!session) return;
    const id = parseInt(url.split('/')[3]);
    const body = await parseBody(req);
    const data = await getData();
    const p = (data.players || []).find(x => x.id === id);
    if (!p) return json(res, 404, { error: 'Nicht gefunden' });
    p.ranks = body.ranks || {};
    addLogEntry(data, session.name, 'Ränge gespeichert für: ' + p.name);
    await saveData({ players: data.players, log: data.log });
    return json(res, 200, p);
  }

  // PUT /api/cats
  if (url === '/api/cats' && method === 'PUT') {
    const session = await requireSuperAdmin(req, res); if (!session) return;
    const body = await parseBody(req);
    const data = await getData();
    addLogEntry(data, session.name, 'Kategorien aktualisiert');
    await saveData({ cats: body.cats, log: data.log });
    return json(res, 200, { ok: true });
  }

  // PUT /api/settings
  if (url === '/api/settings' && method === 'PUT') {
    const session = await requireSuperAdmin(req, res); if (!session) return;
    const body = await parseBody(req);
    const data = await getData();
    const settings = Object.assign(data.settings || {}, body);
    await saveData({ settings });
    return json(res, 200, { ok: true });
  }

  // POST /api/admins
  if (url === '/api/admins' && method === 'POST') {
    const session = await requireSuperAdmin(req, res); if (!session) return;
    const body = await parseBody(req);
    if (!body.name || !body.pass || !body.code) return json(res, 400, { error: 'Felder fehlen' });
    if (body.name === SUPER_ADMIN.name) return json(res, 409, { error: 'Username reserviert' });
    const data = await getData();
    data.admins = data.admins || [];
    if (data.admins.find(a => a.name === body.name)) return json(res, 409, { error: 'Username vergeben' });
    const admin = { id: Date.now(), name: body.name, pass: body.pass, code: body.code, role: body.role || 'subadmin', active: true, created: new Date().toLocaleDateString('de-DE') };
    data.admins.push(admin);
    addLogEntry(data, session.name, 'Admin erstellt: ' + body.name);
    await saveData({ admins: data.admins, log: data.log });
    return json(res, 200, admin);
  }

  // PUT /api/admins/:id/toggle
  if (url.match(/^\/api\/admins\/\d+\/toggle$/) && method === 'PUT') {
    const session = await requireSuperAdmin(req, res); if (!session) return;
    const id = parseInt(url.split('/')[3]);
    const data = await getData();
    const a = (data.admins || []).find(x => x.id === id);
    if (!a) return json(res, 404, { error: 'Nicht gefunden' });
    a.active = !a.active;
    addLogEntry(data, session.name, 'Admin ' + (a.active ? 'aktiviert' : 'deaktiviert') + ': ' + a.name);
    await saveData({ admins: data.admins, log: data.log });
    return json(res, 200, a);
  }

  // DELETE /api/admins/:id
  if (url.match(/^\/api\/admins\/\d+$/) && method === 'DELETE') {
    const session = await requireSuperAdmin(req, res); if (!session) return;
    const id = parseInt(url.split('/')[3]);
    const data = await getData();
    const a = (data.admins || []).find(x => x.id === id);
    data.admins = (data.admins || []).filter(x => x.id !== id);
    if (a) addLogEntry(data, session.name, 'Admin gelöscht: ' + a.name);
    await saveData({ admins: data.admins, log: data.log });
    return json(res, 200, { ok: true });
  }

  // DELETE /api/log
  if (url === '/api/log' && method === 'DELETE') {
    const session = await requireSuperAdmin(req, res); if (!session) return;
    await saveData({ log: [] });
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'Route nicht gefunden' });

  } catch(e) {
    console.error(e);
    json(res, 500, { error: 'Server Fehler' });
  }
});

connectDB().then(() => {
  server.listen(PORT, () => console.log('SkibidiTiers läuft auf Port ' + PORT));
});
