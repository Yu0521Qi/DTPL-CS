/* ============================================================
 *  本地存储：练习历史 + 自定义产品与客户
 *  全部存在浏览器 localStorage，不上传任何服务器
 * ============================================================ */

const Store = {
  KEY_HISTORY: 'liquor_pt_history',
  KEY_CUSTOM: 'liquor_pt_custom',
  MAX_HISTORY: 300,

  /* ---------- 历史成绩 ---------- */
  loadHistory() {
    try {
      const a = JSON.parse(localStorage.getItem(this.KEY_HISTORY) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  },

  saveRecord(rec) {
    const h = this.loadHistory();
    h.unshift(rec);
    try {
      localStorage.setItem(this.KEY_HISTORY, JSON.stringify(h.slice(0, this.MAX_HISTORY)));
    } catch (e) {}
  },

  clearHistory() {
    try { localStorage.removeItem(this.KEY_HISTORY); } catch (e) {}
  },

  /* 汇总统计 + 趋势 + 薄弱项（可传 uid 只看某人自己的数据，满足隐私分层） */
  stats(uid) {
    let h = this.loadHistory();
    if (uid) h = h.filter(r => r.uid === uid);   // 员工只能看到自己的成长
    if (!h.length) return null;
    const sum = k => h.reduce((s, r) => s + (r[k] || 0), 0);
    const trend = h.slice(0, 20).map(r => ({
      total: r.total, grade: r.grade, date: r.date,
      persona: r.personaName, mode: r.modeName || '完整拜访'
    })).reverse();

    // 维度均值只统计完整拜访：专项模式只评部分维度，混进来会把没评的维度当成 0 分
    const fullOnly = h.filter(r => (r.mode || 'full') === 'full');
    const srcDims = fullOnly.length ? fullOnly : h;
    const dimAvg = {};
    DIMENSIONS.forEach(d => {
      dimAvg[d.id] = Math.round(sum2(srcDims, 'dims.' + d.id) / srcDims.length * 10) / 10;
    });
    function sum2(arr, path) {
      return arr.reduce((s, r) => {
        const v = path.split('.').reduce((o, k) => (o || {})[k], r);
        return s + (Number(v) || 0);
      }, 0);
    }

    // 按客户分组：练得最多的 & 得分最低的（薄弱项）
    const byPersona = {};
    h.forEach(r => {
      const k = r.personaName || '未知';
      byPersona[k] = byPersona[k] || { name: k, n: 0, sum: 0 };
      byPersona[k].n++;
      byPersona[k].sum += r.total;
    });
    const personaList = Object.values(byPersona)
      .map(p => ({ name: p.name, n: p.n, avg: Math.round(p.sum / p.n) }))
      .sort((a, b) => a.avg - b.avg);

    // 最近 5 次 vs 之前：看是否在进步
    const recent = h.slice(0, 5);
    const older = h.slice(5, 15);
    const avgOf = a => a.length ? Math.round(a.reduce((s, r) => s + r.total, 0) / a.length) : null;

    return {
      count: h.length,
      avg: Math.round(sum('total') / h.length),
      best: Math.max(...h.map(r => r.total)),
      deals: h.filter(r => r.result === 'deal').length,
      mines: sum('mines'),
      trend,
      dimAvg,
      personaList,
      recentAvg: avgOf(recent),
      olderAvg: avgOf(older),
      latest: h[0]
    };
  },

  /* ---------- 自定义产品与客户 ---------- */
  loadCustom() {
    try {
      const c = JSON.parse(localStorage.getItem(this.KEY_CUSTOM) || '{}');
      return { products: c.products || [], personas: c.personas || [] };
    } catch (e) { return { products: [], personas: [] }; }
  },

  saveCustom(c) {
    try { localStorage.setItem(this.KEY_CUSTOM, JSON.stringify(c)); } catch (e) {}
    this.sync();
  },

  saveProduct(p) {
    const c = this.loadCustom();
    const i = c.products.findIndex(x => x.id === p.id);
    if (i >= 0) c.products[i] = p; else c.products.push(p);
    this.saveCustom(c);
  },

  savePersona(p) {
    const c = this.loadCustom();
    const i = c.personas.findIndex(x => x.id === p.id);
    if (i >= 0) c.personas[i] = p; else c.personas.push(p);
    this.saveCustom(c);
  },

  remove(kind, id) {
    const c = this.loadCustom();
    const key = kind === 'product' ? 'products' : 'personas';
    c[key] = c[key].filter(x => x.id !== id);
    this.saveCustom(c);
  },

  /* 把自定义内容合并进运行时数据，让引擎与 UI 无需区分来源 */
  sync() {
    const c = this.loadCustom();
    c.products.forEach(p => {
      p.custom = true;
      if (!p.refs || !p.refs.length) p.refs = buildDefaultRefs(p);
      PRODUCTS[p.id] = p;
    });
    c.personas.forEach(p => {
      p.custom = true;
      // 反应库：保存时已生成，这里兜底（旧数据或手工改过的情况）
      if (!p.reactions || !Object.keys(p.reactions).length) {
        p.reactions = makeReactions(p.style, p.catchphrases);
      }
      // 正则无法 JSON 序列化，因此只存关键词字符串，每次同步时重建
      const rx = keywordsToRegExp(p.mineKeys);
      p.mines = rx
        ? [{ p: rx, r: p.mineReply || '（脸色一变）这话我听着不舒服。' }]
        : [];
      const i = PERSONAS.findIndex(x => x.id === p.id);
      if (i >= 0) PERSONAS[i] = p; else PERSONAS.push(p);
    });
  }
};

/* 自定义产品没填参考话术时，用它的卖点和政策拼一份可用的模板 */
function buildDefaultRefs(p) {
  const F = (p.fabe && p.fabe.F || [])[0] || '我们的产品';
  const B = (p.fabe && p.fabe.B || [])[0] || '对您的好处是能多赚钱';
  const E = (p.fabe && p.fabe.E || [])[0] || '周边已经有店在卖';
  const pol = (p.policies || [])[0] || '首单有政策支持';
  const gap = Math.max(0, Number(p.retail) - Number(p.cost)) || 0;
  return [
    { t: '开场', s: `老板您好，我是做${p.name}的，专门跑咱们这一片。不耽误您做生意，就两分钟。` },
    { t: '挖需', s: `您这边${p.category}主要卖什么价位？一个月能走多少？平时是自饮多还是送礼多？` },
    { t: '塑造', s: `${F}。对您来说，${B}。` },
    { t: '算账', s: `给您算笔账：供货${p.cost}，您卖${p.retail}，一瓶净赚${gap}，一个月走下来就是一笔稳定的收入。` },
    { t: '逼单', s: `${E}。这样，您先少拿一点试销，${pol}，卖不动我来处理。` }
  ];
}

/* 供引擎与 UI 使用的取值函数：永远返回「内置 + 自定义」的完整列表 */
function allProducts() { return Object.values(PRODUCTS); }
function allPersonas() { return PERSONAS.slice(); }

/* ============================================================
 *  账号 / 练习记录 / 统计
 *  —— 隐私红线：所有聚合只读取记录的「元数据」(次数/标签/分数/时长)，
 *     绝不读取也不会保存任何对话原文（对话原文根本不落盘）。
 * ============================================================ */
const KEY_USERS = 'liquor_pt_users';
const KEY_CUR = 'liquor_pt_cur';

function pad2(n) { return String(n).padStart(2, '0'); }
function weekStartTs(d) {                 // 周一为一周起点
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const day = x.getDay(); const diff = (day + 6) % 7;
  x.setDate(x.getDate() - diff);
  return x.getTime();
}
function median(arr) {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function dateKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

/* ---------- 账号 ---------- */
Store.users = function () {
  try { const a = JSON.parse(localStorage.getItem(KEY_USERS) || '[]'); return Array.isArray(a) ? a : []; }
  catch (e) { return []; }
};
Store.saveUsers = function (u) {
  try { localStorage.setItem(KEY_USERS, JSON.stringify(u)); } catch (e) {}
};
Store.addUser = function (u) {
  const list = this.users();
  if (list.find(x => x.id === u.id)) return;
  list.push(u);
  this.saveUsers(list);
};
Store.currentUid = function () { return localStorage.getItem(KEY_CUR) || ''; };
Store.setCurrent = function (uid) { try { localStorage.setItem(KEY_CUR, uid); } catch (e) {} };
Store.currentUser = function () { const id = this.currentUid(); return this.users().find(u => u.id === id) || null; };

Store.updateUser = function (uid, patch) {
  const list = this.users(); const i = list.findIndex(x => x.id === uid);
  if (i < 0) return;
  const merged = Object.assign({}, list[i], patch);
  if (patch.badges) merged.badges = patch.badges;
  list[i] = merged; this.saveUsers(list);
};
Store.addPoints = function (uid, pts) {
  const u = this.users().find(x => x.id === uid); if (!u) return;
  this.updateUser(uid, { points: (u.points || 0) + pts });
};

/* ---------- 首次运行：建示例团队（全员同级，无管理员/员工之分） ---------- */
Store.ensureSeed = function () {
  if (this.users().length) return;
  const base = { points: 0, badges: [], createdAt: Date.now() };
  const users = [
    Object.assign({ id: 'u_m1', name: '小明', emoji: '🧑' }, base),
    Object.assign({ id: 'u_m2', name: '阿强', emoji: '👨' }, base),
    Object.assign({ id: 'u_m3', name: '丽姐', emoji: '👩' }, base),
    Object.assign({ id: 'u_m4', name: '阿杰', emoji: '🧑‍💼' }, base)
  ];
  this.saveUsers(users);
  this._seedDemoHistory();
};
Store._seedDemoHistory = function () {
  const prods = allProducts(), pers = allPersonas();
  const modes = ['完整拜访', '异议连打', '开场突破', '逼单收尾'];
  const diffs = ['轻松', '标准实战', '地狱模式'];
  const rand = a => a[Math.floor(Math.random() * a.length)];
  const now = Date.now();
  const make = (uid, daysAgo, quality) => {
    const p = rand(prods), pe = rand(pers);
    const ts = now - daysAgo * 864e5 - Math.floor(Math.random() * 8e7);
    const total = Math.max(40, Math.min(98, Math.round(quality + (Math.random() * 16 - 8))));
    const grade = total >= 88 ? 'S' : total >= 78 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D';
    const result = total >= 75 ? 'deal' : total >= 55 ? 'warm' : 'reject';
    const turns = 2 + Math.floor(Math.random() * 6);
    return {
      ts, date: dateKey(ts), uid,
      product: p.id, productName: p.name, persona: pe.id, personaName: pe.name,
      difficulty: rand(diffs), difficultyName: rand(diffs),
      mode: 'full', modeName: rand(modes), exam: Math.random() < 0.15,
      total, grade, result, turns, msgs: turns, mines: Math.random() < 0.3 ? 1 : 0,
      dims: {}, durationMs: Math.round((4 + Math.random() * 9) * 60000)
    };
  };
  const recs = [];
  for (let i = 0; i < 8; i++) recs.push(make('u_m1', Math.floor(Math.random() * 13), 80));  // 小明：高频
  for (let i = 0; i < 4; i++) recs.push(make('u_m2', Math.floor(Math.random() * 13), 68));  // 阿强：中等
  recs.push(make('u_m3', 9, 60)); recs.push(make('u_m3', 11, 55));                          // 丽姐：低频预警
  for (let i = 0; i < 3; i++) recs.push(make('u_m4', Math.floor(Math.random() * 10), 85));  // 阿杰：自练
  recs.forEach(r => this.saveRecord(r));
};

/* ---------- 徽章：由历史派生（不单独存，避免脏数据） ---------- */
Store.userBadges = function (uid) {
  const h = this.loadHistory().filter(r => r.uid === uid);
  if (!h.length) return [];
  const badges = [{ e: '🌱', n: '初出茅庐' }];
  const deals = h.filter(r => r.result === 'deal').length;
  if (deals >= 1) badges.push({ e: '🤝', n: '首单达成' });
  if (deals >= 3) badges.push({ e: '🏆', n: '成交达人' });
  if (h.some(r => r.grade === 'S')) badges.push({ e: '⭐', n: '满分表现' });
  if (h.filter(r => r.mines === 0).length >= 3) badges.push({ e: '🛡️', n: '零踩雷' });
  if (h.length >= 10) badges.push({ e: '🔥', n: '勤奋十练' });
  const ws = weekStartTs(new Date());
  const days = new Set(h.filter(r => r.ts >= ws).map(r => { const d = new Date(r.ts); d.setHours(0, 0, 0, 0); return d.getTime(); }));
  if (days.size >= 4) badges.push({ e: '📅', n: '周常打卡' });
  return badges;
};
