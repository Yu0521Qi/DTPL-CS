/* ============================================================
 *  零依赖代理后端（Node 内置模块，无需 npm install）
 *  - 托管前端静态资源（index.html / assets / admin.html）
 *  - /api/chat：买家令牌代理，校验令牌+额度，注入真实 Key 转发上游
 *  - /api/admin/*：卖家管理后台（设置上游Key、买家增删改、额度、吊销）
 *  真实 API Key 只存在于本服务端（data/store.json），永不下发到浏览器。
 *
 *  启动：node server.js   （端口取环境变量 PORT，默认 3000）
 * ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
// 数据目录默认可被环境变量覆盖，便于在 Railway 等平台挂载持久盘（否则免费实例重启会清空配置与买家数据）
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const PORT = process.env.PORT || 3000;

const MIME = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8'
};

/* ---------------- 数据存储（单文件 JSON，低并发足够） ---------------- */
function defaultStore() {
  return {
    adminSalt: '',
    adminHash: '',          // sha256(salt + password)，空表示尚未初始化
    adminSession: null,      // 当前登录的管理员会话令牌
    upstream: { url: '', model: '', key: '' },
    buyers: []
  };
}

let store = defaultStore();

function loadStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
      store = Object.assign(defaultStore(), raw);
      store.upstream = Object.assign({ url: '', model: '', key: '' }, raw.upstream || {});
      if (!Array.isArray(store.buyers)) store.buyers = [];
    }
  } catch (e) {
    console.error('[store] 读取失败，使用默认空配置：', e.message);
  }
}

let saveTimer = null;
function saveStore() {
  // 轻量防抖，避免高频写盘
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf8');
    } catch (e) {
      console.error('[store] 写入失败：', e.message);
    }
  }, 50);
}

loadStore();

/* ---------------- 工具函数 ---------------- */
function sha256(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function randToken(bytes) { return crypto.randomBytes(bytes || 24).toString('hex'); }
function newId() { return 'b_' + crypto.randomBytes(6).toString('hex'); }

function sendJSON(res, code, obj) {
  if (res.headersSent) return;
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 1e6) { reject(new Error('请求体过大')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

function cors(res, req) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/* 极简限流：每令牌/每管理员 每分钟最多 30 次，挡住被转卖后的滥用 */
const RL = {};
function rateOk(key, limit) {
  const now = Date.now();
  const arr = RL[key] || (RL[key] = []);
  while (arr.length && now - arr[0] > 60000) arr.shift();
  if (arr.length >= (limit || 30)) return false;
  arr.push(now);
  return true;
}

/* ---------------- 鉴权 ---------------- */
function adminAuthed(req) {
  const h = req.headers['authorization'] || '';
  const t = h.startsWith('Bearer ') ? h.slice(7) : '';
  return !!(t && t === store.adminSession);
}
function findBuyer(token) {
  return store.buyers.find(b => b.token === token);
}

/* ---------------- 聊天代理 ---------------- */
async function handleChat(req, res, token) {
  const buyer = findBuyer(token);
  if (!buyer) return sendJSON(res, 401, { error: '无效或已失效的令牌，请联系卖家获取' });
  if (!buyer.active) return sendJSON(res, 403, { error: '该令牌已被卖家吊销' });
  if (buyer.used >= buyer.quota) return sendJSON(res, 429, { error: '本月额度已用尽，请联系卖家续费' });
  if (!rateOk('chat:' + buyer.id, 30)) return sendJSON(res, 429, { error: '请求过于频繁，请稍后再试' });

  const up = store.upstream;
  if (!up.url || !up.key) return sendJSON(res, 503, { error: '服务端尚未配置上游模型，请联系卖家' });

  let body;
  try { body = await parseBody(req); }
  catch (e) { return sendJSON(res, 400, { error: e.message }); }

  const payload = {
    model: up.model,
    messages: Array.isArray(body.messages) ? body.messages : [],
    temperature: typeof body.temperature === 'number' ? body.temperature : 0.6,
    max_tokens: typeof body.max_tokens === 'number' ? body.max_tokens : 600,
    stream: !!body.stream,
    response_format: body.response_format || { type: 'json_object' }
  };

  // 计一次用量（无论成败都计，避免被空跑刷接口而不计数）
  buyer.used += 1;
  buyer.lastUsed = new Date().toISOString();
  saveStore();

  try {
    const upstream = await fetch(up.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + up.key },
      body: JSON.stringify(payload)
    });
    res.statusCode = upstream.status;
    const ct = upstream.headers.get('content-type');
    if (ct) res.setHeader('Content-Type', ct);

    if (payload.stream && upstream.body) {
      res.setHeader('Cache-Control', 'no-cache');
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!res.writableEnded) res.write(Buffer.from(value));
      }
      if (!res.writableEnded) res.end();
      return;
    }
    const txt = await upstream.text();
    if (!res.writableEnded) res.end(txt);
  } catch (e) {
    if (!res.writableEnded) sendJSON(res, 502, { error: '上游调用失败：' + e.message });
  }
}

/* ---------------- 管理后台 API ---------------- */
function buyersView() {
  const totalUsed = store.buyers.reduce((s, b) => s + (b.used || 0), 0);
  return {
    adminSet: !!store.adminHash,
    hasUpstream: !!(store.upstream.url && store.upstream.key),
    upstream: { url: store.upstream.url, model: store.upstream.model },  // 不回传 key
    buyers: store.buyers.map(b => ({
      id: b.id, name: b.name, quota: b.quota, used: b.used || 0,
      active: b.active, createdAt: b.createdAt, lastUsed: b.lastUsed
    })),
    totalUsed
  };
}

function handleAdmin(req, res, pathname, method) {
  // 首次初始化管理员密码（仅当尚未设置）
  if (pathname === '/api/admin/setup' && method === 'POST') {
    if (store.adminHash) return sendJSON(res, 400, { error: '管理员已初始化，请直接登录' });
    return parseBody(req).then(b => {
      if (!b.password || String(b.password).length < 6) return sendJSON(res, 400, { error: '密码至少 6 位' });
      store.adminSalt = randToken(16);
      store.adminHash = sha256(store.adminSalt + b.password);
      saveStore();
      return sendJSON(res, 200, { ok: true });
    }).catch(() => sendJSON(res, 400, { error: '请求体解析失败' }));
  }

  // 登录
  if (pathname === '/api/admin/login' && method === 'POST') {
    return parseBody(req).then(b => {
      if (!store.adminHash) return sendJSON(res, 400, { error: '请先初始化管理员密码' });
      if (!b.password || sha256(store.adminSalt + b.password) !== store.adminHash)
        return sendJSON(res, 401, { error: '密码错误' });
      store.adminSession = randToken(24);
      saveStore();
      return sendJSON(res, 200, { ok: true, adminToken: store.adminSession });
    }).catch(() => sendJSON(res, 400, { error: '请求体解析失败' }));
  }

  // 以下接口均需登录
  if (!adminAuthed(req)) return sendJSON(res, 401, { error: '未登录或会话已失效' });

  if (pathname === '/api/admin/logout' && method === 'POST') {
    store.adminSession = null; saveStore();
    return sendJSON(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/state' && method === 'GET') {
    return sendJSON(res, 200, buyersView());
  }

  if (pathname === '/api/admin/setkey' && method === 'POST') {
    return parseBody(req).then(b => {
      store.upstream.url = String(b.url || '').trim();
      store.upstream.model = String(b.model || '').trim();
      store.upstream.key = String(b.key || '').trim();   // 仅存服务端
      saveStore();
      return sendJSON(res, 200, { ok: true, hasUpstream: !!(store.upstream.url && store.upstream.key) });
    }).catch(() => sendJSON(res, 400, { error: '请求体解析失败' }));
  }

  // 新建买家（返回一次性令牌）
  if (pathname === '/api/admin/buyers' && method === 'POST') {
    return parseBody(req).then(b => {
      const name = String(b.name || '').trim() || ('买家' + (store.buyers.length + 1));
      const quota = Math.max(1, parseInt(b.quota, 10) || 1000);
      const buyer = {
        id: newId(), name, token: randToken(24), quota, used: 0, active: true,
        createdAt: new Date().toISOString(), lastUsed: null
      };
      store.buyers.push(buyer);
      saveStore();
      return sendJSON(res, 200, { ok: true, id: buyer.id, name: buyer.name, token: buyer.token, quota: buyer.quota });
    }).catch(() => sendJSON(res, 400, { error: '请求体解析失败' }));
  }

  // /api/admin/buyers/:id/quota | /revoke | /reactivate | DELETE
  const m = pathname.match(/^\/api\/admin\/buyers\/([^/]+)\/(quota|revoke|reactivate)$/);
  if (m && method === 'POST') {
    const buyer = store.buyers.find(x => x.id === m[1]);
    if (!buyer) return sendJSON(res, 404, { error: '买家不存在' });
    return parseBody(req).then(b => {
      if (m[2] === 'quota') { buyer.quota = Math.max(1, parseInt(b.quota, 10) || buyer.quota); }
      else if (m[2] === 'revoke') { buyer.active = false; }
      else if (m[2] === 'reactivate') { buyer.active = true; }
      saveStore();
      return sendJSON(res, 200, { ok: true, buyer: { id: buyer.id, name: buyer.name, quota: buyer.quota, used: buyer.used, active: buyer.active } });
    }).catch(() => sendJSON(res, 400, { error: '请求体解析失败' }));
  }

  const md = pathname.match(/^\/api\/admin\/buyers\/([^/]+)$/);
  if (md && method === 'DELETE') {
    const i = store.buyers.findIndex(x => x.id === md[1]);
    if (i < 0) return sendJSON(res, 404, { error: '买家不存在' });
    store.buyers.splice(i, 1);
    saveStore();
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 404, { error: '未知管理接口' });
}

/* ---------------- 静态托管 ---------------- */
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';
  const filePath = path.normalize(path.join(ROOT, rel));
  const rel2root = path.relative(ROOT, filePath);
  if (rel2root.startsWith('..') || rel2root.startsWith('data' + path.sep) || rel2root === 'data') {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(filePath).slice(1).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------------- 路由入口 ---------------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);
  cors(res, req);

  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  try {
    // 健康检查（供前端"测试连接"用，无需令牌）
    if (pathname === '/api/health' && req.method === 'GET') {
      return sendJSON(res, 200, { ok: true, hasUpstream: !!(store.upstream.url && store.upstream.key), buyers: store.buyers.length });
    }

    // 聊天代理：Bearer = 买家令牌
    if (pathname === '/api/chat' && req.method === 'POST') {
      if (!rateOk('chatGlobal', 60)) return sendJSON(res, 429, { error: '全局限流，请稍后再试' });
      const h = req.headers['authorization'] || '';
      const token = h.startsWith('Bearer ') ? h.slice(7) : '';
      return handleChat(req, res, token);
    }

    // 管理后台
    if (pathname.startsWith('/api/admin')) {
      return handleAdmin(req, res, pathname, req.method);
    }

    // 其余走静态
    return serveStatic(req, res, pathname);
  } catch (e) {
    if (!res.writableEnded) sendJSON(res, 500, { error: '服务器内部错误：' + e.message });
  }
});

server.listen(PORT, () => {
  console.log('[server] 酒水话术训练器后端已启动： http://localhost:' + PORT);
  if (!store.adminHash) console.log('[server] 首次使用请打开 /admin.html 初始化管理员密码');
});
