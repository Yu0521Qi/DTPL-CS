/* ============================================================
 *  酒水地推话术陪练 · 规则引擎
 *  意图识别 → 质量评估 → 状态机 → 客户反应 → 评分
 * ============================================================ */

/* ---------- 意图关键词表 ---------- */
const INTENT_RULES = {
  greet: {
    kw: ['您好', '你好', '老板好', '打扰', '我是', '过来', '拜访', '认识一下', '耽误您', '几分钟', '两分钟', '看您', '路过', '第一次来', '幸会'],
    w: 1
  },
  probe: {
    kw: ['卖得怎么样', '主销', '主要卖', '什么价位', '哪个价位', '走量', '好不好卖', '多少箱', '一个月', '一天', '日均', '库存', '利润', '客群', '谁买', '平时', '生意', '缺不缺', '现在卖', '一年', '销量', '动销', '走得多', '客人', '喜欢喝', '什么酒', '哪些款', '货架', '周转'],
    w: 1
  },
  present: {
    kw: ['我们的酒', '这款', '采用', '工艺', '老窖', '纯粮', '口感', '入口', '不上头', '度数', '包装', '特点', '优势', '获得', '认证', '窖池', '发酵', '勾调', '香气', '泡沫', '基酒', '固态', '原料', '品质', '不上头', '口干', '风味', '绵甜', '净爽', '活性酵母', '冷链', '溯源'],
    w: 1
  },
  policy: {
    kw: ['价格', '供货价', '进货价', '毛利', '赚', '返利', '陈列', '政策', '折扣', '首单', '账期', '押金', '支持', '费用', '开瓶费', '品鉴酒', '送', '箱', '块', '元', '补贴', '条码费', '换货', '试销', '回收'],
    w: 1
  },
  objection: {
    kw: ['您说得对', '理解', '确实', '担心', '顾虑', '其实', '不会的', '您放心', '可以.*先', '承诺', '写进合同', '数据给您看', '周边', '我理解', '坦白说', '实话', '换个角度', '主要是', '您顾虑', '这一点', '放心', '保证', '没问题', '报|告', '后台', '验证'],
    w: 1
  },
  close: {
    kw: ['先拿', '先放', '订', '下单', '签', '送过来', '安排', '今天', '现在', '咱们', '怎么样', '行不行', '可以吗', '试试', '铺', '来几箱', '定下来', '就这', '合作', '开始', '搞起来', '拉一车', '先来'],
    w: 1
  },
  follow: {
    kw: ['微信', '电话', '下次', '明天', '后天', '再来', '留个', '联系', '资料留', '加一下', '方便.*找您', '改天', '过两天', '回头']
  }
};

/* ---------- 质量信号词 ---------- */
const QUALITY = {
  question: ['？', '?', '吗', '呢', '是不是', '对不对', '有没有', '能不能', '行不行', '干嘛', '为啥', '为什么'],
  profit: ['赚', '毛利', '利润', '收益', '客单价', '月', '天', '一年', '净'],
  evidence: ['数据', '周边', '隔壁', '店', '月销', '报告', '合同', '后台', '扫码', '案例', '销量', '补货', '走'],
  empathy: ['您说得对', '理解', '确实', '正常', '换我', '坦白说', '实话', '您担心的', '我明白'],
  riskShift: ['先拿', '先放', '试销', '回收', '换货', '拉走', '原价收', '卖完再', '小批量', '两箱', '一桶', '样品', '免费'],
  empty: ['您放心', '绝对', '肯定没问题', '不会的', '保证', '包你', '没问题', '放心吧'],
  attack: ['别家', '同行', '杂牌', '竞品', '不如', '差远了', '档次低', '小厂'],
  overPromise: ['包你', '保证卖', '稳赚', '一定赚', '肯定卖', '百分百', '绝对不亏', '卖不掉我赔']
};

/* ---------- 工具 ---------- */
function has(text, arr) {
  return arr.some(k => {
    try {
      return new RegExp(k, 'i').test(text);
    } catch (e) {
      return text.indexOf(k) > -1;
    }
  });
}
function countHit(text, arr) {
  let c = 0;
  arr.forEach(k => {
    try {
      if (new RegExp(k, 'i').test(text)) c++;
    } catch (e) {
      if (text.indexOf(k) > -1) c++;
    }
  });
  return c;
}
function pick(arr, avoid) {
  if (!arr || !arr.length) return '';
  const pool = arr.filter(x => x !== avoid);
  return (pool.length ? pool : arr)[Math.floor(Math.random() * (pool.length || arr.length))];
}
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

/* 初始三维：专项模式也吃难度修正，但态度带下限保护——
 * checkEnd 在态度 ≤8 时判负，若让「开场突破」(态度 20) 在困难难度被扣到判负线以下，
 * 开局第一句还没说就已经出局。下限 12 留出一点回旋余地。 */
function initStats(md, persona, difficulty) {
  const d = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const src = md.init || persona.init;
  const guard = md.init ? 12 : 0;
  return {
    attitude: clamp(Math.max(src.attitude + d.mod.attitude, guard), 0, 100),
    interest: clamp(src.interest + d.mod.interest, 0, 100),
    trust: clamp(src.trust + d.mod.trust, 0, 100)
  };
}

/* ---------- 会话状态 ---------- */
function createState(product, persona, difficulty, modeId, exam) {
  const d = DIFFICULTIES[difficulty] || DIFFICULTIES.normal;
  const md = MODES[modeId] || MODES.full;
  const st = initStats(md, persona, difficulty);
  return {
    product,
    persona,
    difficulty,
    mode: md,
    exam: !!exam,
    maxTurns: md.rounds || d.maxTurns,
    turn: 0,
    attitude: st.attitude,
    interest: st.interest,
    trust: st.trust,
    covered: {},          // 各意图有效覆盖次数
    scores: {},           // 累计原始分
    pending: null,        // 待处理异议
    handled: [],
    lastHandledTurn: -9,  // 上次化解异议的轮次（用于抛出冷却）
    mines: [],
    log: [],
    lastReply: '',
    finished: false,
    result: null,
    flags: { greeted: false, probed: false, presented: false, policied: false }
  };
}

/* ---------- 意图识别 ---------- */
function detectIntent(text, state) {
  const scores = {};
  Object.keys(INTENT_RULES).forEach(k => {
    scores[k] = countHit(text, INTENT_RULES[k].kw);
  });

  // 首轮强制归为开场
  if (state.turn === 0 && scores.greet > 0) scores.greet += 3;
  // 仅"真正在问客户"才指向挖需（弱疑问词如"什么/哪/怎么"不再算提问，避免把介绍误判成提问）
  const isQ = isGenuineQuestion(text);
  if (isQ) scores.probe += 2;
  // 数字 + 利润词 → 算账
  if (/\d/.test(text) && has(text, QUALITY.profit)) scores.policy += 2;
  // 正在处理异议时，回应优先判为异议处理
  if (state.pending && (scores.objection > 0 || scores.close > 0)) scores.objection += 2;

  let primary = 'other';
  let best = 0;
  Object.keys(scores).forEach(k => {
    if (scores[k] > best) { best = scores[k]; primary = k; }
  });
  if (best === 0) primary = 'other';

  const secondary = Object.keys(scores).filter(k => k !== primary && scores[k] > 0);
  return { primary, secondary, isQuestion: isQ, raw: scores };
}

/* ---------- 踩雷检测 ---------- */
function detectMines(text, state) {
  const hits = [];
  // 画像专属雷区
  (state.persona.mines || []).forEach(m => {
    if (m.p.test(text)) hits.push({ type: 'persona', reply: m.r });
  });
  // 通用雷区
  if (has(text, QUALITY.attack) && !/我们(自己|这边)/.test(text)) {
    hits.push({
      type: 'attack',
      reply: '（脸色一变）哥们儿，别在我这儿说同行不好。各做各的生意，你这么说我听着不舒服。'
    });
  }
  if (has(text, QUALITY.overPromise)) {
    hits.push({
      type: 'overPromise',
      reply: '（摆手）行了行了，做生意哪有"保证"这一说。你越说我越不敢信。'
    });
  }
  return hits;
}

/* ---------- 答问引擎：让客户针对具体问题作答 ---------- */
/* 仅在出现真正疑问标记时才算"提问"。弱词（什么/哪/怎么/多少…）常见于陈述与介绍，
 * 不能据此把一句话当成问题——否则客户会把产品介绍误当成提问去作答，答非所问。 */
const Q_WORDS = ['吗', '呢', '是不是', '有没有', '能不能', '行不行', '对不对', '干嘛', '为啥', '为什么', '怎样', '如何', '怎么样', '啥', '几点', '哪天'];

function isGenuineQuestion(text) {
  if (!text) return false;
  if (/[?？]/.test(text)) return true;
  return Q_WORDS.some(w => text.indexOf(w) > -1);
}

function pickLevel(v, level) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  return v[level] || v.mid || v.good || v.bad || '';
}

/* 识别"你在问哪件事"，用该客户人设里的真实情况作答。
 * 仅在你【提了问题】时触发；陈述 / 介绍类话术交回 customerReact 处理。
 * 返回作答文本或 null。 */
function buildAnswer(text, state, level) {
  if (!text) return null;
  const isQ = isGenuineQuestion(text);
  if (!isQ) return null;
  let topic = null;
  for (const t of Object.keys(TOPIC_ANSWERS)) {
    if (has(text, TOPIC_ANSWERS[t])) { topic = t; break; }
  }
  if (!topic) return null;
  const facts = (typeof PERSONA_FACTS !== 'undefined' && PERSONA_FACTS[state.persona.type || state.persona.id]) || {};
  let ans = pickLevel(facts[topic], level);
  if (!ans && typeof genAnswerFallback === 'function') ans = genAnswerFallback(topic, state);
  return ans || null;
}

/* ---------- 质量评估 ---------- */
function evaluate(intent, text, state) {
  const q = { score: 0, tags: [], level: 'mid' };
  const evi = has(text, QUALITY.evidence);
  const emp = has(text, QUALITY.empathy);
  const risk = has(text, QUALITY.riskShift);
  const empty = has(text, QUALITY.empty);
  const profitCount = countHit(text, QUALITY.profit);

  switch (intent) {
    case 'greet': {
      let s = 4;
      if (/(我是|叫).{1,8}(公司|酒业|酒厂|厂家)/.test(text)) { s += 2; q.tags.push('自报家门'); }
      if (/(不耽误|就.*两分钟|几分钟|耽误您)/.test(text)) { s += 2; q.tags.push('时间承诺'); }
      if (/(您|老板)/.test(text)) { s += 1; q.tags.push('有称呼'); }
      if (text.length < 12) { s -= 2; q.tags.push('过于简短'); }
      q.score = clamp(s, 0, 12);
      q.level = q.score >= 7 ? 'good' : q.score >= 4 ? 'mid' : 'bad';
      break;
    }
    case 'probe': {
      let s = 5;
      if (state.intent_isQ || has(text, QUALITY.question)) { s += 5; q.tags.push('开放式提问'); }
      if (/(价位|多少|什么|哪|谁)/.test(text)) { s += 2; q.tags.push('问到关键信息'); }
      if (/(箱|月|天|日均|销量|动销|周转|库存)/.test(text)) { s += 3; q.tags.push('问到量化指标'); }
      if (!has(text, QUALITY.question)) { s -= 3; q.tags.push('陈述多于提问'); }
      q.score = clamp(s, 0, 20);
      q.level = q.score >= 12 ? 'good' : q.score >= 7 ? 'mid' : 'bad';
      break;
    }
    case 'present': {
      let s = 5;
      const f = countHit(text, ['老窖', '纯粮', '工艺', '固态', '发酵', '基酒', '原料', '窖池', '冷链', '度数', '规格']);
      const b = countHit(text, ['您', '老板', '客人', '复购', '动销', '客单价', '赚', '毛利', '回头', '拍照', '带客']);
      const e = evi ? 1 : 0;
      if (f) { s += 3; q.tags.push('讲了产品特点'); }
      if (b >= 2) { s += 6; q.tags.push('讲了客户利益'); }
      if (e) { s += 4; q.tags.push('给了证据'); }
      if (f && b && e) { s += 3; q.tags.push('完整 FABE'); }
      if (state.flags && !state.flags.probed && s > 8) { s -= 3; q.tags.push('未挖需先介绍'); }
      q.score = clamp(s, 0, 20);
      q.level = q.score >= 14 ? 'good' : q.score >= 8 ? 'mid' : 'bad';
      break;
    }
    case 'policy': {
      let s = 4;
      if (/\d/.test(text)) { s += 2; q.tags.push('有数字'); }
      if (profitCount >= 2) { s += 4; q.tags.push('算了收益账'); }
      if (/(陈列|返利|开瓶|品鉴|支持|换货|账期|补贴)/.test(text)) { s += 3; q.tags.push('用政策不降价'); }
      if (/(便宜|降价|再低点|最低|给你.*价)/.test(text)) { s -= 3; q.tags.push('轻易让价'); }
      if (!state.flags.presented && !state.flags.probed) { s -= 3; q.tags.push('未塑造价值先报价'); }
      q.score = clamp(s, 0, 12);
      q.level = q.score >= 8 ? 'good' : q.score >= 5 ? 'mid' : 'bad';
      break;
    }
    case 'objection': {
      let s = 4;
      if (emp) { s += 4; q.tags.push('先认同'); }
      if (evi) { s += 6; q.tags.push('给证据'); }
      if (risk) { s += 6; q.tags.push('给方案/转嫁风险'); }
      if (empty && !evi && !risk) { s -= 5; q.tags.push('空洞安抚'); }
      if (has(text, QUALITY.question)) { s += 2; q.tags.push('反问确认'); }
      if (state.pending) { s += 3; q.tags.push('正面回应异议'); }
      q.score = clamp(s, 0, 22);
      q.level = q.score >= 14 ? 'good' : q.score >= 7 ? 'mid' : 'bad';
      break;
    }
    case 'close': {
      let s = 3;
      if (risk) { s += 4; q.tags.push('降低决策门槛'); }
      if (/(微信|明天|下周|什么时候送|加个)/.test(text)) { s += 2; q.tags.push('锁定下一步'); }
      if (has(text, QUALITY.question)) { s += 2; q.tags.push('征询式收尾'); }
      if (/(买点吧|来几箱|定下来|签了吧)/.test(text) && !risk) { s -= 2; q.tags.push('硬推'); }
      q.score = clamp(s, 0, 10);
      q.level = q.score >= 7 ? 'good' : q.score >= 4 ? 'mid' : 'bad';
      break;
    }
    case 'follow': {
      let s = 2;
      if (/(微信|加一下|扫码)/.test(text)) { s += 2; q.tags.push('留联系方式'); }
      if (/(明天|后天|下周|周.|几号)/.test(text)) { s += 2; q.tags.push('约定具体时间'); }
      q.score = clamp(s, 0, 6);
      q.level = q.score >= 4 ? 'good' : 'mid';
      break;
    }
    default: {
      q.score = 1;
      q.level = 'bad';
      q.tags.push('未识别到有效动作');
    }
  }
  return q;
}

/* ---------- 客户反应 ---------- */
function customerReact(intent, level, state) {
  const p = state.persona;
  const key = GENERIC_REACTIONS[intent] ? intent : 'other';
  const own = (p.reactions && p.reactions[key]) || null;
  const src = (own && own[level] && own[level].length)
    ? own[level]
    : (GENERIC_REACTIONS[key][level] || GENERIC_REACTIONS[key].mid);
  return pick(src, state.lastReply);
}

/* 识别用户这句话"在讲哪个主题"，用于让客户做主题对应的反应。
 * 复用 TOPIC_ANSWERS 的关键词集，与答问引擎同源，保证"问"和"讲"都指向同一主题。 */
function detectTheme(text) {
  for (const t of Object.keys(TOPIC_ANSWERS)) {
    if (has(text, TOPIC_ANSWERS[t])) return t;
  }
  return null;
}

/* 主题反应：当业务员做的是陈述 / 介绍 / 算账（而非提问）时，
 * 客户按他刚说的"主题"给对应反应，而不是回一句与内容无关的套话。
 * 优先级：该客户在 PERSONA_FACTS[id].react[主题][情绪] → THEME_REACTIONS[主题][情绪] 兜底。
 * 不拦截 greet / objection 意图（开场与异议处理另有专门逻辑）。 */
function themeReact(text, intent, level, state) {
  if (intent === 'greet' || intent === 'objection') return null;
  const theme = detectTheme(text);
  if (!theme) return null;
  // 兼容：人设覆盖（PERSONA_FACTS[id].react[主题][情绪]）与通用库可能是「单条字符串」或「数组」
  const poolOf = (v) => Array.isArray(v) ? v : (typeof v === 'string' ? [v] : null);
  const facts = (typeof PERSONA_FACTS !== 'undefined' && PERSONA_FACTS[state.persona.type || state.persona.id]) || null;
  const own = (facts && facts.react && facts.react[theme]) || null;
  const src = (own && (poolOf(own[level]) || poolOf(own.mid)))
    || (THEME_REACTIONS[theme] && (poolOf(THEME_REACTIONS[theme][level]) || poolOf(THEME_REACTIONS[theme].mid)));
  if (!src || !src.length) return null;
  return pick(src, state.lastReply);
}

function moodLevel(state) {
  const v = state.attitude * 0.45 + state.interest * 0.35 + state.trust * 0.2;
  const r = Math.random();
  if (v >= 62) return r < 0.7 ? 'good' : r < 0.95 ? 'mid' : 'bad';
  if (v >= 42) return r < 0.35 ? 'good' : r < 0.85 ? 'mid' : 'bad';
  if (v >= 25) return r < 0.15 ? 'good' : r < 0.6 ? 'mid' : 'bad';
  return r < 0.08 ? 'good' : r < 0.4 ? 'mid' : 'bad';
}

/* 异议的前置条件：没介绍产品就嫌贵是不合理的，按流程阶段过滤 */
const OBJ_GATE = {
  price_high: s => s.flags.presented || s.flags.policied,
  slow_moving: s => s.flags.presented || s.flags.policied,
  brand_unknown: s => s.flags.presented,
  no_space: s => s.flags.presented,
  quality: s => s.flags.presented,
  need_gift: s => s.flags.policied,
  credit: s => s.flags.policied,
  have_supplier: () => true,
  boss_away: () => true,
  look_later: s => s.turn >= 3
};

function throwObjection(state) {
  // 异议连打：不限画像自带的异议，从全库抽，逼你练遍所有类型
  const all = state.mode && state.mode.forceObjection === 'all';
  const src = all ? Object.keys(OBJECTIONS) : (state.persona.objections || []);
  let pool = src.filter(o => OBJECTIONS[o] && state.handled.indexOf(o) < 0);
  // 连打模式跳过流程类门槛（本来就没走介绍流程），只排除需要铺垫的收尾型异议
  pool = all
    ? pool.filter(o => o !== 'look_later')
    : pool.filter(o => (OBJ_GATE[o] || (() => true))(state));
  if (!pool.length) return null;
  const id = pool[Math.floor(Math.random() * pool.length)];
  return { id, line: pick(OBJECTIONS[id].lines) };
}

/* ---------- 主推进函数 ---------- */
function step(text, state) {
  if (state.finished) return null;
  const d = DIFFICULTIES[state.difficulty];
  const T = state.difficulty === 'easy' ? 1.2 : state.difficulty === 'hard' ? 0.8 : 1;
  const before = { a: state.attitude, i: state.interest, t: state.trust };

  // 1) 踩雷
  const mines = detectMines(text, state);
  if (mines.length) {
    const m = mines[0];
    state.mines.push({ turn: state.turn + 1, type: m.type, text });
    state.attitude = clamp(state.attitude - 26 * (1 / d.tolerance), 0, 100);
    state.trust = clamp(state.trust - 22 * (1 / d.tolerance), 0, 100);
    state.interest = clamp(state.interest - 10, 0, 100);
    const reply = m.reply + (state.attitude <= 12 ? ' （转身忙自己的去了）' : '');
    state.lastReply = reply;
    state.turn++;
    state.log.push({
      turn: state.turn, seller: text, buyer: reply,
      intent: 'mine', intentName: '踩雷', score: 0, level: 'bad',
      tags: [m.type === 'attack' ? '诋毁竞品' : m.type === 'overPromise' ? '过度承诺' : '触碰客户禁忌'],
      delta: { a: Math.round(state.attitude - before.a), i: Math.round(state.interest - before.i), t: Math.round(state.trust - before.t) }
    });
    checkEnd(state);
    return state.log[state.log.length - 1];
  }

  // 2) 意图 + 质量
  const it = detectIntent(text, state);
  state.intent_isQ = it.isQuestion;
  const q = evaluate(it.primary, text, state);

  // 3) 累计得分（覆盖越多边际递减）
  state.covered[it.primary] = (state.covered[it.primary] || 0) + 1;
  const rep = state.covered[it.primary];
  // 专项训练里重复做同一件事正是目的，边际递减要缓得多
  const isDrill = !!(state.mode && state.mode.dims);
  const decay = isDrill
    ? Math.max(0.45, 1 - (rep - 1) * 0.12)
    : (rep === 1 ? 1 : rep === 2 ? 0.55 : rep === 3 ? 0.3 : 0.12);
  const gain = q.score * decay;
  state.scores[it.primary] = (state.scores[it.primary] || 0) + gain;
  it.primary === 'probe' && (state.flags.probed = true);
  it.primary === 'present' && (state.flags.presented = true);
  it.primary === 'policy' && (state.flags.policied = true);
  it.primary === 'greet' && (state.flags.greeted = true);

  // 3.1) 次要意图：一句复合话术不该只算一个维度（例如"处理异议 + 顺手逼单"）
  const secGain = {};
  (it.secondary || []).forEach(k => {
    if ((it.raw[k] || 0) < 1) return;
    const sq = evaluate(k, text, state);
    const g2 = sq.score * 0.32 * decay;
    state.scores[k] = (state.scores[k] || 0) + g2;
    secGain[k] = Math.round(g2 * 10) / 10;
    k === 'probe' && (state.flags.probed = true);
    k === 'present' && (state.flags.presented = true);
    k === 'policy' && (state.flags.policied = true);
    k === 'greet' && (state.flags.greeted = true);
    if (sq.tags.length) q.tags = q.tags.concat(sq.tags.map(t => '兼' + t));
  });

  // 4) 状态变化
  const tol = d.tolerance * T;
  let da = 0, di = 0, dt = 0;
  const base = { good: 1, mid: 0.35, bad: -0.6 }[q.level];
  switch (it.primary) {
    case 'greet':
      da += base * 8 * tol; dt += base * 4 * tol;
      break;
    case 'probe':
      da += base * 6 * tol; dt += base * 7 * tol; di += base * 3 * tol;
      if (!state.flags.greeted) da -= 4;
      break;
    case 'present':
      di += base * 9 * tol; da += base * 3 * tol;
      if (!state.flags.probed) { di -= 3; da -= 2; q.tags.push('缺挖需铺垫'); }
      break;
    case 'policy':
      di += base * 8 * tol;
      if (!state.flags.presented) { di -= 4; da -= 2; }
      break;
    case 'objection':
      da += base * 7 * tol; dt += base * 9 * tol; di += base * 6 * tol;
      if (state.pending) {
        if (q.level === 'good') {
          state.handled.push(state.pending.id);
          state.pending = null;
          state.lastHandledTurn = state.turn;
          q.tags.push('异议已化解');
        } else if (q.level === 'mid') {
          if (Math.random() < 0.5) {
            state.handled.push(state.pending.id);
            state.pending = null;
            state.lastHandledTurn = state.turn;
            q.tags.push('勉强过关');
          }
        }
      }
      break;
    case 'close':
      di += base * 10 * tol; da += base * 3 * tol;
      if (state.pending) { di -= 6; da -= 4; q.tags.push('带着未解决的异议硬推'); }
      if (!state.flags.presented) { di -= 5; q.tags.push('没塑造价值就要单'); }
      break;
    case 'follow':
      da += base * 4 * tol; dt += base * 3 * tol;
      break;
    default:
      da -= 5 * (1 / d.tolerance); dt -= 2;
  }

  state.attitude = clamp(state.attitude + da, 0, 100);
  state.interest = clamp(state.interest + di, 0, 100);
  state.trust = clamp(state.trust + dt, 0, 100);

  // 5) 客户反应 + 是否抛异议
  const level = moodLevel(state);
  // 先尝试"答问引擎"：如果你提了具体问题，客户用自己人设里的真实情况作答，
  // 避免"你问 A 他答 B"的违和感；否则按你这句话的"主题"给对应反应（贴近真实场景）；
  // 再不行才退回按意图大类的通用反应库。
  let reply = buildAnswer(text, state, level)
    || themeReact(text, it.primary, level, state)
    || customerReact(it.primary, level, state);
  let newObj = null;

  const shouldObject = () => {
    if (state.pending) return false;
    // 异议连打：每轮都发难，且从全库抽题
    if (state.mode && state.mode.forceObjection === 'all') return Math.random() < 0.9;
    if (state.turn < 2) return false;                       // 开场阶段不急着发难
    // 刚化解完一个异议，给销售留出推进的空间
    const cool = (state.turn - (state.lastHandledTurn || -9)) <= 1 ? 0.3 : 1;
    if (it.primary === 'close' || it.primary === 'policy') return Math.random() < (d.objectionRate + 0.2) * cool;
    return Math.random() < d.objectionRate * 0.6 * cool;
  };

  if (state.pending && it.primary !== 'objection') {
    // 销售没有正面处理异议，但可能"顺带"回应了（认同/举证/方案）
    const partial = has(text, QUALITY.empathy) || has(text, QUALITY.evidence) || has(text, QUALITY.riskShift);
    if (partial) {
      state.attitude = clamp(state.attitude - 1, 0, 100);
      q.tags.push('顺带回应了异议');
      if (Math.random() < 0.3) {
        state.handled.push(state.pending.id);
        state.pending = null;
        state.lastHandledTurn = state.turn;
        q.tags.push('异议被带过');
      }
    } else {
      const chase = (state.pending.chase || 0) + 1;
      state.pending.chase = chase;
      const line = pick(OBJECTIONS[state.pending.id].lines, state.pending.line);
      if (chase === 1) {
        reply = '（打断）不是，我刚才问的你还没答呢——' + line;
        state.attitude = clamp(state.attitude - 5 * (1 / d.tolerance), 0, 100);
      } else if (chase === 2) {
        reply = '（皱眉）小伙子，我问的那个事儿你一直没接。' + line;
        state.attitude = clamp(state.attitude - 10 * (1 / d.tolerance), 0, 100);
      } else {
        reply = '（摆手）算了算了，我问的话你都不接，还谈什么合作。';
        state.attitude = clamp(state.attitude - 22 * (1 / d.tolerance), 0, 100);
        state.interest = clamp(state.interest - 15, 0, 100);
      }
      q.tags.push('回避了客户的异议');
    }
  } else if (shouldObject()) {
    newObj = throwObjection(state);
    if (newObj) {
      state.pending = { id: newObj.id, line: newObj.line };
      reply = reply + '\n' + newObj.line;
      state.attitude = clamp(state.attitude - 3, 0, 100);
    }
  }

  state.lastReply = reply;
  state.turn++;
  const entry = {
    turn: state.turn,
    seller: text,
    buyer: reply,
    intent: it.primary,
    intentName: INTENT_NAMES[it.primary] || '其他',
    secondary: Object.keys(secGain),
    secGain,
    score: Math.round(gain * 10) / 10,
    level: q.level,
    tags: q.tags,
    objection: newObj ? newObj.id : null,
    delta: {
      a: Math.round(state.attitude - before.a),
      i: Math.round(state.interest - before.i),
      t: Math.round(state.trust - before.t)
    }
  };
  state.log.push(entry);
  checkEnd(state, entry);
  return entry;
}

const INTENT_NAMES = {
  greet: '开场破冰', probe: '需求挖掘', present: '价值塑造',
  policy: '政策算账', objection: '异议处理', close: '成交推进',
  follow: '收尾跟进', mine: '踩雷', other: '无效表达'
};

/* ---------- 结束判定 ---------- */
/* 成交意向门槛：结束判定、手动复盘、复盘页展示三处共用，避免门槛漂移 */
function dealNeed(state) {
  return state.difficulty === 'easy' ? 52 : state.difficulty === 'hard' ? 72 : 63;
}

/* 结局判定：自动结束（checkEnd）与手动「结束并复盘」（finish）共用，
 * 避免同一局因为结束方式不同而拿到不同结果。
 * triedClose：本轮是否推进过成交；ended：会话是否走到尽头（轮次用尽 / 用户手动结束）。
 * 返回 { result, closingLine }；尚未触发结束条件则返回 null。 */
function judgeResult(state, triedClose, ended) {
  const need = dealNeed(state);
  const trustLine = state.difficulty === 'hard' ? 62 : 52;
  if (triedClose && state.interest >= need && state.trust >= trustLine && !state.pending) {
    return { result: 'deal', closingLine: '（点头）行吧，那就按你说的来。你把货和资料一起送来，咱们把手续办了。' };
  }
  if (state.attitude <= 8) {
    return { result: 'reject', closingLine: '（摆手）行了行了，我这儿还有事，你先回去吧。' };
  }
  if (!ended) return null;
  // 分数评价话术质量，结局评价客户决策——两者独立，话术好但客户太硬也会拿不到单
  if (state.interest >= need - 8 && state.trust >= 45) {
    return { result: 'deal', closingLine: '（笑了笑）行，你这个人说话还算实在，那就先来一点试试。' };
  }
  if (state.interest >= 42 || totalScore(state, state.mode && state.mode.dims).total >= 70) {
    return { result: 'warm', closingLine: '（犹豫）我再考虑考虑，你把资料留这儿，回头我联系你。' };
  }
  return { result: 'reject', closingLine: '（摇头）今天就这样吧，我这边暂时不需要。' };
}

function checkEnd(state, entry) {
  const d = DIFFICULTIES[state.difficulty];
  if (state.finished) return;

  const triedClose = entry && (entry.intent === 'close' || (entry.secondary || []).indexOf('close') >= 0);
  const ended = state.turn >= (state.maxTurns || d.maxTurns);
  const j = judgeResult(state, triedClose, ended);
  if (!j) return;
  state.finished = true;
  state.result = j.result;
  state.closingLine = j.closingLine;
}

/* ---------- 计分 ----------
 * dimIds 为空时按完整七维度评分（满分 100）；
 * 专项模式只评指定维度，再归一化到 100，便于跨模式比较
 */
function totalScore(state, dimIds) {
  const out = {};
  let total = 0;
  let maxTotal = 0;
  const active = dimIds
    ? DIMENSIONS.filter(d => dimIds.indexOf(d.id) >= 0)
    : DIMENSIONS;

  active.forEach(dim => {
    let v = state.scores[dim.id] || 0;
    if (dim.id === 'pro') {
      // 职业素养 = 全程不踩雷；踩一次只剩三成，两次及以上归零
      v = state.mines.length === 0
        ? dim.max * clamp(state.turn / 6, 0.35, 1)
        : (state.mines.length === 1 ? dim.max * 0.3 : 0);
    }
    v = clamp(v, 0, dim.max);
    out[dim.id] = Math.round(v * 10) / 10;
    total += out[dim.id];
    maxTotal += dim.max;
  });

  const normalized = maxTotal ? Math.round(total / maxTotal * 100) : 0;
  const score = clamp(normalized, 0, 100);

  let grade = 'D';
  if (score >= 88) grade = 'S';
  else if (score >= 78) grade = 'A';
  else if (score >= 65) grade = 'B';
  else if (score >= 50) grade = 'C';

  return { dims: out, total: score, raw: Math.round(total), maxTotal, grade };
}

/* ---------- 复盘建议 ---------- */
function review(state) {
  const dimIds = state.mode && state.mode.dims;
  const { dims, total, grade } = totalScore(state, dimIds);
  const list = dimIds ? DIMENSIONS.filter(d => dimIds.indexOf(d.id) >= 0) : DIMENSIONS;
  const strengths = [];
  const improves = [];
  const ratio = {};
  list.forEach(d => {
    ratio[d.id] = (dims[d.id] || 0) / d.max;
    if (ratio[d.id] >= 0.7) strengths.push({ name: d.name, text: d.tip });
    else if (ratio[d.id] < 0.4) improves.push({ name: d.name, text: d.tip, r: ratio[d.id] });
  });
  improves.sort((a, b) => a.r - b.r);

  const notes = [];
  const isFull = !dimIds;   // 流程类诊断只在完整拜访下有意义

  if (isFull) {
    if (!state.flags.greeted) notes.push('全程没有正式开场，客户一开始就没建立对你的基本认知。');
    if (!state.flags.probed) notes.push('没有做任何需求挖掘——不了解店里主销价位、动销情况，后面说的一切都是自说自话。');
    if (state.covered.probe >= 3 && !state.flags.presented) notes.push('问得够多但没有转化成价值塑造，客户会觉得你在查户口。');
    if (!state.flags.policied) notes.push('没有给出任何政策或算账，客户拿不到决策依据。');
    if (!state.covered.close) notes.push('全程没有推进成交——拜访结束时一定要拿到一个最小的下一步。');
  }

  const raised = state.log.filter(l => l.objection).length;
  if (state.handled.length === 0 && raised > 0) notes.push('客户提出了 ' + raised + ' 个异议，一个都没被有效化解，这是本次最大的失分点。');
  else if (raised > 0 && state.handled.length < raised) notes.push('客户抛了 ' + raised + ' 个异议，你只化解了 ' + state.handled.length + ' 个，剩下的会一直卡在客户心里。');
  else if (raised === 0) {
    // LLM 模式下客户多用兜底模板（不带 objection id），但对话里明显在设条件/挑刺：补一句可执行的异议处理提示，避免 0 分却无反馈
    const CH = ['采委会', '签字按手印', '原不原价', '白纸黑字', '账期', '试销', '进场费', '堆头', '风险条款', '书面方案', '上会', '含糊', '扯皮', '交底', '担责'];
    const challenge = state.log.filter(l => l.buyer && CH.some(s => l.buyer.indexOf(s) >= 0)).length;
    if (challenge >= 2) notes.push('客户全程在设条件/挑刺（采委会、签字、账期、试销…），但你没用「认同→举证→给方案→确认」的异议公式逐条接住，所以异议处理 0 分。下次遇到客户抛条件，先接住情绪再给证据。');
  }
  if (state.mines.length) {
    const mc = {};
    state.mines.forEach(m => { const t = m.type === 'attack' ? '诋毁竞品' : m.type === 'overPromise' ? '过度承诺' : '触碰客户禁忌'; mc[t] = (mc[t] || 0) + 1; });
    const parts = Object.keys(mc).map(t => mc[t] > 1 ? (t + ' ×' + mc[t]) : t);
    notes.push('踩了 ' + state.mines.length + ' 次雷区：' + parts.join('、') + '。');
  }

  if (state.mode && state.mode.id === 'objection') {
    notes.push('异议连打：化解 ' + state.handled.length + ' 个。标准动作是「认同 → 举证 → 转嫁风险 → 确认」，缺一步就只能拿一半分。');
  }
  if (state.mode && state.mode.id === 'opening') {
    notes.push('开场突破：客户最终态度 ' + Math.round(state.attitude) + '。破冰的关键是「自报家门 + 来意 + 时间承诺」，再用一个具体的观察（比如他柜台上的货）打开话题。');
  }
  if (state.mode && state.mode.id === 'closing') {
    notes.push('逼单收尾：客户最终意向 ' + Math.round(state.interest) + '。收尾要给具体动作和具体时间，别问「您考虑得怎么样」。');
  }

  const resultText = {
    deal: '成交！客户愿意进货 / 启动试销。',
    warm: '留下意向，客户让你留资料、下次再谈。',
    reject: '被拒绝。客户态度转冷，本次拜访没有拿到下一步。'
  }[state.result] || '未分出结果，练习中途结束。';

  return { dims, total, grade, strengths, improves, notes, resultText, ratio };
}

/* ---------- 阶段判定与教练建议 ---------- */
const FLOW_STAGES = ['greet', 'probe', 'present', 'policy', 'close'];

const STAGE_TIPS = {
  greet: '先破冰：自报家门 + 说清来意 + 承诺不占用太多时间。',
  probe: '开始挖需：问清主销价位、动销情况、客群结构、现在跟谁合作。',
  present: '做价值塑造：用 FABE 讲，重点讲 B（对他的利益）和 E（本地证据）。',
  policy: '算账 + 谈政策：把供货价翻译成毛利和月收益，用政策替代降价。',
  close: '推进成交：给一个最小的下一步（先拿 2 箱试销 / 留一瓶品鉴 / 加微信约下次）。',
  follow: '收尾锁客：约定具体下次时间，加微信，留下资料，别空手走。'
};

/* 专项训练走自己的短流程，完整拜访走七步法 */
function stagePlan(state) {
  if (state.mode && state.mode.dims) {
    const p = state.mode.dims.filter(d => FLOW_STAGES.indexOf(d) >= 0);
    if (p.length) return p;
  }
  return FLOW_STAGES;
}

function stageDone(state, st) {
  if (st === 'greet') return state.flags.greeted;
  if (st === 'probe') return state.flags.probed;
  if (st === 'present') return state.flags.presented;
  if (st === 'policy') return state.flags.policied;
  if (st === 'close') return !!state.covered.close;
  return false;
}

function currentStage(state) {
  if (state.pending) return 'objection';
  const plan = stagePlan(state);
  for (let i = 0; i < plan.length; i++) {
    if (!stageDone(state, plan[i])) return plan[i];
  }
  return 'follow';
}

function nextBestAction(state) {
  if (state.finished) return '本轮已结束，点「结束并复盘」看完整点评。';
  if (state.pending) {
    const o = OBJECTIONS[state.pending.id];
    return '客户抛出了异议【' + o.label + '】——' + o.tip.split('。')[0] + '。';
  }
  return STAGE_TIPS[currentStage(state)] || STAGE_TIPS.follow;
}
