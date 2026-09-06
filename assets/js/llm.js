/* ============================================================
 *  大模型驱动（可选）
 *  填入 OpenAI 兼容接口的 Key 即可切换为真实 LLM 扮演客户
 *  未填写时应用使用内置规则引擎，完全离线可用
 * ============================================================ */

const LLM_PRESETS = [
  { name: 'DeepSeek', url: 'https://api.deepseek.com/v1/chat/completions', model: 'deepseek-chat' },
  { name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
  { name: '月之暗面 Kimi', url: 'https://api.moonshot.cn/v1/chat/completions', model: 'moonshot-v1-8k' },
  { name: '智谱 GLM', url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions', model: 'glm-4-flash' },
  { name: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  { name: '自定义', url: '', model: '' }
];

function buildSystemPrompt(a, b, c, modeId) {
  // 兼容两种调用：buildSystemPrompt(state) 或 buildSystemPrompt(product, persona, difficulty[, modeId])
  let state = null, product, persona, difficulty, mode;
  if (a && a.product && a.persona) { state = a; product = a.product; persona = a.persona; difficulty = a.difficulty; mode = a.mode || MODES.full; }
  else { product = a; persona = b; difficulty = c; mode = MODES[modeId] || MODES.full; }
  const d = DIFFICULTIES[difficulty];
  const init = initStats(mode, persona, difficulty);   // 与 createState 同一套初值（含难度修正 + 态度下限）
  const opening = state && state.opening;
  const pending = state && state.pending;
  const objList = (persona.objections || []).map(id => `- ${id}：${OBJECTIONS[id].label}，例如「${OBJECTIONS[id].lines[0]}」`).join('\n');

  return `你是一名专业的「酒水终端门店老板」陪练演员。请严格按以下设定，与上门推销的业务员进行真实、有对抗性的对话，并同步输出教练级评分。你不是助手，绝不帮业务员说话、绝不给建议、绝不跳出角色。

<identity>
你是门店老板「${persona.name}」，${persona.age} 岁，${persona.title}。
- 场景：${persona.scene}
- 性格：${persona.tags.join('、')}
- 真正在意的：${persona.motive}
- 决策方式：${persona.decision}
- 吃这一套（业务员说这些你买账）：${persona.likes.join('、')}
- 禁忌（业务员说这些你会立刻反感）：${(persona.mines || []).map(m => m.r).join(' ') || '通用禁忌同样适用'}
</identity>

<product>
这是当前唯一被推销的产品，以下是它的全部事实，一切反应以它的品名为准：
- 品名：${product.name}（${product.category}），${product.spec}
- 适用场景：${product.scene}
- 供货价 ${product.cost} 元，建议零售价 ${product.retail} 元，${product.margin}
- 政策：${product.policies.join('；')}
- 卖点 FABE：
  F（特征）：${product.fabe.F.join('；')}
  A（优势）：${product.fabe.A.join('；')}
  B（利益）：${product.fabe.B.join('；')}
  E（证据）：${product.fabe.E.join('；')}
【铁律·严防张冠李戴】「${product.name}」是一款具体单品。即便你熟悉同品牌其他知名单品（如「牛栏山」旗下的牛栏山陈酿/白牛二、「茅台」旗下的茅台王子酒），也绝不能用它们来替代或类比本款，除非业务员自己先提起。本次对话只围绕「${product.name}」，不脑补其他产品信息，不默认本款=更出名的同门产品。
</product>

<objections>
你可能在自然时机抛出这些异议（一次只抛一个，被有效化解后再考虑下一个）：
${objList}
</objections>

<training_mode>
本次训练模式：${mode.name}（${mode.desc}）
${mode.id === 'objection' ? '你是“异议连打”陪练：对方每句回应后，只要没被有效化解，就继续抛新的异议（一次一个），逼他把“认同→举证→转嫁风险→确认”练成肌肉记忆。开局你已经抛出一个异议。' : mode.id === 'opening' ? '你是“开场突破”陪练：你冷淡、防备、话少。对方必须用“自报家门+来意+时间承诺+具体观察”敲开你的门，否则你一直冷处理。' : mode.id === 'closing' ? '你是“逼单收尾”陪练：你已对产品有兴趣，开局就处在收尾阶段。直接谈政策、算账、要订单；对方给出“低风险的试水方案+具体时间”你就松口。' : '你是“完整拜访”陪练：从陌生破冰走到成交的完整七步，自然推进即可。'}
${opening ? '你的开局白：「' + opening + '」' : ''}
${pending ? '当前存在一个待对方跟进的异议：【' + OBJECTIONS[pending.id].label + '】——例如「' + pending.line + '」。对方接下来会回应它。' : ''}
${mode.dims ? '本次只重点打磨维度：' + mode.dims.filter(x => x !== 'pro').map(id => (DIMENSIONS.find(z => z.id === id) || {}).name).join('、') + '，共 ' + mode.rounds + ' 轮。' : ''}
</training_mode>

<rules>
1. 第一人称口语，带括号动作/情绪描写，每轮≤3句，符合身份与文化程度。
2. 业务员说得好→态度松动；说得空、报价太急、诋毁同行、过度承诺→冷淡甚至逐客。
3. 【答其所问】业务员每提一个问题，先一句话正面、具体回答（他问价位你就报实际价位，他问客群你就说客群），再表达态度或抛下一步。严禁用「嗯/还行/就那样」回避，严禁复述他的话当答案。
4. 只回答「门店老板会知道的事」（价位、客群、动销、库存、货架、现合作对象、对本款第一印象）；产品工艺/口感等专业问题，用「你给我讲/我得尝了才知道」这类真实反应，绝不替业务员背书。
5. 不主动透露任何卖点，所有信息都由业务员自己讲出。
6. 他没问清你的经营情况前，不表现进货兴趣。
7. 你能自主判断成交：只有他讲清利益+给可信证据+降低你的风险，你才说「行，先来一点试试」。
8. 你绝对不能：跳出角色、给业务员建议、替产品背书、把同品牌其他单品套到本款、脑补产品信息、一次性抛多个异议、用空话回避问题。
9. 【回应陈述·反敷衍】业务员这一句如果不提问题、而是连续陈述（给数据、推价值、推进度），你必须给出实质性反应，三选一或组合，绝不可沉默只用「嗯/还行/就那样/行吧」敷衍：
   (a) **复述确认**：用你自己的话讲一遍他刚说的最关键数字 / 承诺 / 条款，证明你听进去了；
   (b) **抛具体追问**：挑一个落地细节追问（首批多少箱 / 哪个区铺 / 货款怎么结 / 滞销能否退 / 培训谁来做 / 票据怎么开），把对话推下去；
   (c) **表达你的反应**：被打动就用「（点头）……」开头并明确松动点，仍有顾虑就直说顾虑。需求未满足时态度不要上扬。
10. 【演得像真人】你是在演一个「有真实经营压力、时间和耐心都有限的老板」。以下任一情况触发时，**主动挑战、质疑、跑题、不耐烦**——这是核心要求，不是 bug：
   - 对方话术明显是「标准销售套话」或「堆砌术语 / 数字但没落地」（如一口气报价又算账又列政策、又讲基酒工艺又讲渠道支持）→ 你可以说「你这套词儿我听别的业务员讲过」「先把价格写下来我看看，别的先别说」
   - 对方连续 2 轮都在「铺垫价值/讲故事/背产品」而没问你的经营情况、没让你说话 → 你打断：「先停一下，你倒是先问我这边情况啊」
   - 对方开始用『咱们批发价 X 元 / 一瓶净赚 X / 月销 X 瓶』这种计算式催单 → 你不耐烦：「算账谁不会，你能不能讲点别的」
   - 对方对产品知识明显在背稿 → 你质疑：「这数据你背得挺熟，是你自己喝过还是公司培训教的」
   不要因为对方工整就敷衍，也不要因为对方流畅就买单——**只有对方做了「具体落地」才给正向反应**。
11. 【禁止复读】每一轮都要给出与前几轮不同的具体反应，不要连续两轮使用相同的话术、相同的异议或相同的关键词（例如反复只提「采委会」「签字按手印」「敲计算器」）。对话推进了，你的反应就要跟着变——上一轮要的是毛利明细，这一轮就该问动销或账期或试销，不要原地打转。
</rules>

<hard_command>【强命令 · 高优先级 · 不可违反】
此段优先级高于以上所有 rules 与身份设定。一旦你的输出与本段冲突，以本段为准。

每轮 reply 字段必须同时满足：
1. **实质字数**：去掉括号动作 / 标点 / 数字 / 称呼后，汉字 ≥ 15 个；
2. **具体反应**（至少一个，组合更好）：
   - 复述确认：用你自己的话讲出对方刚说的某个数字 / 条款 / 承诺；
   - 抛具体追问：首批多少箱 / 滞销退换怎么算 / 培训谁来做 / 货款怎么结 / 票据怎么开 等落地细节；
   - 表达真实态度变化：被打动就明确松动点，仍有顾虑就直说顾虑；
3. **有情绪**：不耐烦、质疑、松动、认真都行——但不要中性无表情。

绝对禁止的输出（含但不限）：
- 单字 / 虚词：嗯 / 啊 / 哦 / 噢 / 啧 / 行 / 好 / 吧 / 中 / 嗯嗯；
- 纯动作描写后无实质内容：「（沉默了一下）」「（想了想）」「（点头）」「（皱眉）」；
- 重复对方的话当回答（"你是说…"后无新增内容）；
- 模板式敷衍：「我再想想」「考虑一下再说」「回头联系」「行吧再说吧」「到时候再定」。

【关键 · 回应专业术语 / 堆砌数字】（直接回应你的诉求）
对方话术里出现批发价 / 陈列费 / 品鉴酒 / 渠道支持 / 终端动销 / FABE / 毛利空间 / 政策条款 等专业或数字堆砌时：
- 不允许用「听不懂」「没意思」「你讲得太专业了」敷衍；
- 必须挑一个**具体内容**认真分析后给出反应：
  ·「翻译」成自己的话：「你说一箱赚 60 块对吧？比我店里现在那款多挣多少？」
  · 质疑 / 戳穿：「这数你算过没？别是 PPT 上的吧」「陈列费按月结还是按年结？写进合同不？」
  · 跑题打断：「先别说这个，你先问我这边情况」；
  · 类比自己的现状：「毛利 60 一箱听着还行，但我要先算店里动销快不快。」

【输出格式铁律】
- 只输出一个 JSON 对象，不要 Markdown 代码块（不要用三连反引号包裹）/ 不要 <think> 标签 / 不要任何解释文字；
- JSON 必须严格可解析：所有键和字符串值都用半角双引号，数字不加引号。
</hard_command>

<output_contract>
每轮只输出一个严格 JSON 对象（不要 Markdown 代码块、不要多余文字），字段与含义：
- reply：你这轮说的话（可含动作描写）
- attitude / interest / trust：0-100 整数（相对上轮微调，通常幅度≤8）
- intent：greet | probe | present | policy | objection | close | follow | other
- score：本轮该维度得分（满分参考：greet 12 / probe 20 / present 20 / policy 12 / objection 22 / close 10 / follow 6 / other 0）
- level：good | mid | bad
- tags：2-4 个中文表现短语
- objection：本轮新抛出的异议 id 或 null
- coach：给业务员的一句教练点评（30 字内，具体、可操作）
- finished：固定 false；result：null | "deal" | "reject" | "warm"
</output_contract>

<example>
以下示范「答其所问 + 聚焦本款」的合格输出：
业务员说：「哥，您店里平时主推什么价位的白酒？」
你输出：
{"reply":"（抬眼打量你一下）我这儿走量的是 80 到 150 的口粮酒，百来块的最快。","attitude":40,"interest":30,"trust":30,"intent":"probe","score":18,"level":"good","tags":["正面回答问题","坦诚经营现状"],"objection":null,"coach":"问得准，先摸清客群再推。","finished":false,"result":null}

业务员介绍：「这款酒的口感比老款更柔和，利润空间比普通版高。」
你输出：
{"reply":"（摆摆手）别跟我扯老款，我就问这瓶，到我手上能赚几个点？","attitude":35,"interest":35,"trust":28,"intent":"present","score":14,"level":"mid","tags":["聚焦本款产品","追问利润"],"objection":null,"coach":"他提老款，你及时拉回本款，做得好。","finished":false,"result":null}
</example>

现在开始。当前难度：${d.name}（${d.desc}）；初始态度 ${Math.round(init.attitude)}、采购意向 ${Math.round(init.interest)}、信任度 ${Math.round(init.trust)}（均 0-100，已含难度修正），对话最多 ${mode.rounds || d.maxTurns} 轮。`;
}

function buildHistory(text, state, nudge) {
  const history = [];
  history.push({ role: 'system', content: buildSystemPrompt(state) });
  state.log.forEach(l => {
    history.push({ role: 'user', content: l.seller });
    history.push({ role: 'assistant', content: l.buyer });
  });
  if (nudge) history.push({ role: 'system', content: nudge });
  history.push({ role: 'user', content: text });
  return history;
}

function buildBody(cfg, text, state, stream, nudge) {
  return {
    model: cfg.model,
    messages: buildHistory(text, state, nudge),
    temperature: 0.6,
    max_tokens: 600,
    response_format: { type: 'json_object' },
    stream: !!stream
  };
}

/* 把模型原始输出解析成结构化结果；失败时保留台词并用离线引擎合成教练点评 */

/* 检测模型给的 reply 是否属于"敷衍型"（短、空、不接茬）。
 * 算法：
 *  1. 去掉括号动作描写 / 空白 / 标点，剥出"实际说的话"；
 *  2. 仅留汉字，看剩余汉字长度；超过 6 字一定不是敷衍（真实回话都 > 6 字）；
 *  3. ≤ 6 字时，若每个汉字都属于极弱集合（嗯/啊/行/行吧/再想想/再说吧 等），判为敷衍。*/
function isLazyReply(reply) {
  if (reply === null || reply === undefined) return true;
  let s = String(reply).trim();
  if (!s) return true;
  // 整段切走：全/半角括号动作、首尾引导符、空白
  s = s
    .replace(/[（(][^）)]*[）)]/g, ' ')
    .replace(/^[—\-–:：、/·…\s]+/, '')
    .replace(/[—\-–:：、/·…\s]+$/, '')
    .replace(/[\s\u3000,，。.!?！？:：;；;、「」『』《》"'"'…\-—_~～·]/g, '');
  const chars = s.replace(/[^一-龥]/g, '');
  if (!chars) return true;                // 纯动作 / 纯标点 → 敷衍
  if (chars.length > 6) return false;     // > 6 字实际回话，放行
  // ≤ 6 字且全是"极弱字"才认作敷衍
  const WEAK = new Set('嗯啊啊哦噢呃哎呵哈呀呐咧咯嘚哒呢嘛咪哇哟呗咯嗯啊哦呃行中吧的可也是在了嘛么没也还就那这看再想想一定可要好好随待有待就中再个了啊的你我吗他她它们对不没不不不不让我仔细再想想看看到定考虑下再决定待定再看看吧再说吧稍等改天再说先这样暂缓慢慢斟酌下下次再说回头再说不急');
  return [...chars].every(c => WEAK.has(c));
}

/* 客户侧抗懒重试：若模型原始 reply 敷衍/过短，最多再请求一次并带 anti-lazy 提示，从源头减少兜底依赖 */
const ANTI_LAZY_NUDGE = '注意：你上一轮的客户回应太短或像敷衍。请立刻给一句有实质内容、带具体动作或数字或条件的客户回应，并且绝对不要和前面任何一轮客户说过的话雷同。';
/* 只看模型原始 reply 是否敷衍（不触发兜底重写），供重试判断用；解析不出则交给 parseLLM 兜底 */
function rawReplyLazy(raw) {
  try { const o = tryParseLLMJSON(raw); if (o && typeof o === 'object' && !Array.isArray(o)) return isLazyReply(o.reply); } catch (e) {}
  return false;
}

/* 在线重写敷衍 reply：拿对方最后一句的关键数字/名词，按 persona 语气与
 * "复述确认 / 抛具体追问 / 表达反应" 三种模板，生成一段像样的客户台词。
 * 注意：只在 parseLLM 成功路径下调用，不影响评分/教练/态度等其它字段。*/
/* 归一化：去括号/标点/数字/称呼，只留汉字，用于跨轮去重比对 */
function normText(s) {
  s = String(s || '');
  s = s.replace(/[（(][^）)]*[）)]/g, ' ');
  s = s.replace(/[\s\u3000,，。.!?！？:：;；、「」『』《》"'"'…\-—_~～·*#]/g, '');
  return s.replace(/[^一-龥]/g, '');
}
/* 抽取主导签名词：决定一句话"像不像复读"的关键短语 */
const _REPLY_SIGS = ['签字按手印', '采委会', '敲一敲', '计算器', '书面方案', '白纸黑字', '原不原价', '毛利率', '扣点', '盖章', '合同', '品鉴', '试销', '动销', '账期', '退换', '培训', '首批', '毛利', '进场费', '堆头', '货架', '上会', '风险条款', '售后责任'];
function signatureOf(s) {
  const n = normText(s);
  return _REPLY_SIGS.filter(p => n.indexOf(p) >= 0);
}

/* 跨轮去重（整场）：拿全场客户发言比对。
 *  - 完全相同 → 判重复；
 *  - 共享领域关键词（白纸黑字/合同/账期…）且长度差 < 8 → 近似复读；
 *  - 末 8 字相同（同一模板"换前面具体内容、尾句照抄"，如大壮 R12↔R13）→ 判重复。
 * 覆盖整场而非仅最近 N 轮，可彻底消除 R5=R14、R12=R13 这类跨窗口复读。
 * 返回 null 表示重复（应换一条），否则返回原 reply。*/
function dedupeBuyerReply(reply, state) {
  if (!reply) return null;
  const nr = normText(reply);
  if (!nr) return null;
  const log = (state && state.log) || [];
  const recent = log.map(e => e && e.buyer).filter(Boolean).map(normText);
  const sig = signatureOf(reply);
  for (const r of recent) {
    if (!r) continue;
    if (r === nr) return null;                                   // 完全相同
    if (sig.length && signatureOf(r).some(s => sig.indexOf(s) >= 0) && Math.abs(nr.length - r.length) < 8) return null; // 近似复读
    // 同尾句（末 8 字相同）即同一模板：覆盖"换前方内容、尾句照抄"的复读
    if (nr.length > 14 && r.length > 14 && nr.slice(-8) === r.slice(-8)) return null;
  }
  return reply;
}

/* 在线重写敷衍 reply：拿对方最后一句的关键数字/名词，按 persona 语气与
 * "复述确认 / 抛具体追问 / 表达反应" 模板，生成一段像样的客户台词。
 * 去复读改进：
 *  - 模板池扩到 12 条，覆盖毛利/采委会/合同/方案/动销/账期/试销/货架/风险等多话题；
 *  - 用 state._rwIdx 轮换，绝不连续两轮选同一条；
 *  - 接受 avoid 签名集合（含近期客户语签名），跳过近似的那条，从根上避免"复读机"。
 * 注意：只在 parseLLM 成功路径下调用，不影响评分/教练/态度等其它字段。*/
function rewriteLazyReply(text, state, opts) {
  opts = opts || {};
  const persona = (state && state.persona) || { tags: [] };
  const log = (state && state.log) || [];
  const recentSigs = new Set();
  const recentNorm = new Set();
  log.forEach(e => { if (e && e.buyer) { signatureOf(e.buyer).forEach(s => recentSigs.add(s)); recentNorm.add(normText(e.buyer)); } });
  // 仅在"换一条"场景下用：把被换掉那句的归一化文本也拉黑，避免又选回它
  const avoidNorm = new Set((opts.avoid || []).map(normText));

  // 取对方最后一句里的数字串（任意单位/数字段，含"12家""15%""月销5箱"），取后两个作为引用锚
  const nums = (String(text || '').match(/\d+(?:\.\d+)?(?:%|[一-龥]{0,3})?|\d+\s*[%~]|\d+[年月日家个位瓶箱盒]?/g) || []);
  const seen = [];
  for (const n of nums) { if (!seen.includes(n)) seen.push(n); if (seen.length >= 3) break; }
  const numPart = seen.length ? '「' + seen.slice(0, 3).join(' / ') + '」' : '';
  // 抽 2-4 字中文词作为复述关键词
  const STOP = new Set('这是那个如果的话可以能够我们您看您这给您有的的一下一来以来还有要不要我来我给您你觉得我想一定不要紧其实不光不单不但并不有着这是这边这儿这些这个这样那样那个那边那时这么那么然后如果既然哪怕此外除非除了为何为什么那些这个那个我你他她它们的不不没也别还又只才也已正在将');
  const kwRaw = (String(text || '').match(/[一-龥]{2,5}/g) || []).filter(w => !STOP.has(w));
  const kw = (kwRaw.slice(-3).join('、')) || '刚这页';
  const personaTone = (persona.tags || []).some(t => /严|直接|急|冲|不耐烦/.test(t)) ? '（皱眉）' : '（点头）';
  const personaJob = persona.title || '采购';
  // 19 条多样化模板：复述+追问 / 要求落地 / 表达反应，话题横跨毛利·采委会·合同·方案·动销·账期·试销·货架·风险·竞品·临期·窜货·口感·搭赠·私域·宴席·订金·独家·复盘，确保整场去重后也不重复
  const pool = [
    personaTone + (numPart ? '你说的' + numPart + '我听见,' : '你说的我听进去了,') + '但得先问三件白纸黑字的事:首批多少箱、账期多久、卖不动原不原价收回——给我书面答复,再谈下一步。',
    '（指着价盘）' + (numPart || '这毛利') + '先别急着算。你隔壁那家竞品给的什么扣点?临期怎么调换、窜货谁担责——这三条你今天得给我交底。',
    personaTone + '纸面上看见了,' + (numPart ? '数字我信你一半,' : '承诺我信你一半,') + '但[' + kw + ']这一条得单独写进合同,签字按手印,我才往下走。',
    '（靠过来翻一翻）' + (numPart || '那一段') + (numPart ? '数字不错,' : '听着还行,') + '但光这点不够——你把[' + kw + ']那条单独列出来,这要是含糊后面全是扯皮。',
    personaTone + (numPart ? '「' + seen[0] + '」听着' : '听着') + '比上次来那个能讲,但' + personaJob + '的钱不是我一个人说了算,这份' + (numPart ? '数字' : '方案') + '我得带回采委会过一道,你给我留一份原件。',
    '（接过翻一翻）' + (numPart ? '这' + numPart + '我先收着,' : '我先收着,') + '但光凭这一页不够——培训谁来做、首批多少箱、滞销退换怎么算,你给我一份带签章的书面方案,我这边才好走流程。',
    personaTone + '你这毛利表我扫了一眼,可我店里的动销你还没摸过——平时走量的是哪档价位、周转几天,你先说说,别光算你赚多少。',
    '（摆手）' + (numPart ? '「' + seen[0] + '」' : '这数') + '先放着。我现合作那个牌子给的账期是月结,你这政策里没写清结款方式,我心里没底。',
    personaTone + '品鉴酒我收了,但试销我得控量——先给 2 箱铺通货架,卖不动你原不原价收,这条件写进补充条款我才点头。',
    '（靠回椅背）' + (numPart ? numPart + '听着还行,' : '') + '可我这店刚调了陈列位,新牌子进场费、堆头怎么算?这部分不谈,后面全是糊涂账。',
    personaTone + '你说培训、退换都包,我信一半。这样——你先派个人跟我跑一周门店,看真实动销再定首单量,空口承诺我不敢签。',
    '（皱眉）' + (numPart ? '「' + seen[0] + '」' : '这政策') + '是给面子,可采购委员会那关你过不去。你把风险条款、售后责任列明白,我好拿去上会。',
    '（抿一口）' + (numPart || '这酒') + '收尾会不会太冲?我客群喝惯重口精酿,配餐怎么搭、适不适合做小酌局,你先说清楚再谈进店。',
    '（翻手机）' + (numPart ? '「' + seen[0] + '」' : '这政策') + '听着还行,但首批能不能搭 2 瓶品鉴装、周末给我做个试饮台?光说包退换没动作,我不敢主推。',
    personaTone + '我私域 300 号常客都喝精酿,你这酒复购周期多长、有没有朋友圈素材帮我推?别只盯首单,后面动销你得出力。',
    '（靠门框）' + (numPart || '这酒') + '适不适合我做的小型品鉴局、朋友局?场景不对,我进了也动不了,先把喝的场景讲明白。',
    '（敲桌子）' + (numPart ? '「' + seen[0] + '」' : '先少进') + '可以,但你得给我个进货订金保护,别让我压一库底货砸手里——这要写进协议。',
    personaTone + '我腾了 C 位给你,你给不给阶段独家、陈列物料谁出?条件不给我凭什么把黄金位让给你这新牌子。',
    '（合上本子）' + (numPart || '卖一个月') + '你得来跟我复盘动销数据,不行就调方案,别丢下就不管——后续陪跑你得到位。'
  ];

  // 轮换 + 避让：从 state._rwIdx 起向后找第一条"整场还没出现过的整句"模板
  const base = (state && typeof state._rwIdx === 'number') ? state._rwIdx : 0;
  let idx = -1;
  for (let k = 0; k < pool.length; k++) {
    const cand = (base + k) % pool.length;
    const candNorm = normText(pool[cand]);
    // 按"整场已出现过的整句"去重（结合 dedupeBuyerReply 的签名近重复拦截），不做签名级互斥（否则共享关键词的模板会互相永久拉黑、池子被压扁）
    if (!recentNorm.has(candNorm) && !avoidNorm.has(candNorm)) { idx = cand; break; }
  }
  if (idx < 0) idx = base % pool.length;        // 极端：全撞，退回 base
  if (state) state._rwIdx = (idx + 1) % pool.length;
  return pool[idx];
}

/* 渐进式 JSON 修复 + parse：先尝试原始，再修未加引号键/单引号/多余逗号；任一成功即返回 */
function tryParseLLMJSON(raw) {
  const clean = raw.replace(/```json/gi, '').replace(/```/g, '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const slice = (s, e) => (s > -1 && e > s) ? clean.slice(s, e + 1) : clean;
  const repair = s => s
    .replace(/,(\s*[}\]])/g, '$1')                       // 末尾多余逗号
    .replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":')  // 未加引号键
    .replace(/'/g, '"');                                  // 单引号统一转双引号（已加引号键后再做，覆盖值与数组元素）
  const attempts = [
    clean,
    repair(clean),
    repair(slice(clean.indexOf('{'), clean.lastIndexOf('}')))
  ];
  let lastErr = null;
  for (const cand of attempts) {
    if (!cand) continue;
    try { return JSON.parse(cand); } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('JSON parse failed');
}

/* JSON 解析失败 / 字段缺失时的兜底：绝不返回 '嗯。' 这种敷衍，强制构造有实质内容的回复 */
function buildParseFallback(text, state, raw, err) {
  const it = detectIntent(text, state);
  const q = evaluate(it.primary, text, state);
  // 优先级 1: raw 里能抠出完整且非敷衍的 reply → 用它
  let reply = extractReply(raw);
  // 优先级 2: 抠出的也敷衍 / 抠不出 → 用 rewriteLazyReply 基于对方最后一句生成落地话
  if (!reply || isLazyReply(reply)) reply = rewriteLazyReply(text, state);
  // 跨轮去重护栏：避免兜底话术在多轮里复读
  if (!dedupeBuyerReply(reply, state)) reply = rewriteLazyReply(text, state, { avoid: signatureOf(reply) });
  if (typeof console !== 'undefined' && console.warn) {
    console.warn('[llm] parseLLM 失败：' + (err && err.message || err) + ' → 已用' + (extractReply(raw) && !isLazyReply(extractReply(raw)) ? 'extractReply' : 'rewriteLazyReply') + '兜底');
  }
  const tags = (q.tags || []).slice();
  tags.push('已防敷衍');
  return {
    reply,
    attitude: clamp(state.attitude + (q.level === 'good' ? 6 : q.level === 'bad' ? -6 : 1), 0, 100),
    interest: clamp(state.interest + (q.level === 'good' ? 7 : q.level === 'bad' ? -3 : 2), 0, 100),
    trust: clamp(state.trust + (q.level === 'good' ? 6 : q.level === 'bad' ? -4 : 1), 0, 100),
    intent: it.primary,
    score: q.score,
    level: q.level,
    tags: tags.slice(0, 4),
    objection: null,
    coach: synthCoach(q, it.primary, state),
    finished: false,
    result: null
  };
}

function parseLLM(raw, text, state) {
  // 空响应（网络超时/被中间层拦截/完全空 token）
  if (!raw || !String(raw).trim()) return buildParseFallback(text, state, '', new Error('empty raw'));
  let parsed;
  try { parsed = tryParseLLMJSON(raw); }
  catch (e) { return buildParseFallback(text, state, raw, e); }
  // parsed 可能是 null（JSON.parse('null')）、数组或标量——都不是有效回复
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return buildParseFallback(text, state, raw, new Error('parseLLM: result is not a JSON object'));
  }
  // 解析成功但 reply 字段缺失或敷衍 → 在线重写
  if (isLazyReply(parsed.reply)) {
    parsed.reply = rewriteLazyReply(text, state);
    const tags = (parsed.tags && parsed.tags.slice()) || [];
    tags.push('已防敷衍');
    parsed.tags = tags.slice(0, 4);
  }
  // 跨轮去重护栏：即便 LLM 原文不"懒"但和前面客户语重复，也要换一条
  if (!dedupeBuyerReply(parsed.reply, state)) {
    parsed.reply = rewriteLazyReply(text, state, { avoid: signatureOf(parsed.reply) });
  }
  // 教练评语去重护栏（覆盖 LLM 主路径的 parsed.coach，它不走 synthCoach 去重）：
  // 若与最近 4 句教练点评重复，则用 synthCoach 换一句（其内部按 _coachTail 去重，保证不连续重复）。
  // 注意：只用 parsed 自带的 tags/level/intent 构造 q，不调用 evaluate，避免对 state 产生副作用（覆盖计数/flags 重复累加）。
  if (typeof parsed.coach === 'string' && parsed.coach.trim()) {
    const _ct = (state && state._coachTail) || [];
    if (_ct.indexOf(parsed.coach) >= 0) {
      const q = { tags: parsed.tags || [], level: parsed.level || 'good' };
      parsed.coach = synthCoach(q, parsed.intent, state);
    } else if (state) {
      state._coachTail = _ct.concat([parsed.coach]).slice(-4);
    }
  }
  return parsed;
}

/* 代理(令牌)模式：有 proxyBase 时请求走自有后端 /api/chat，Authorization 带买家令牌；
 * 真实上游 Key 由后端注入，客户端永不持有。无 proxyBase 时退回 BYOK 直连（供本地开发/测试）。 */
function _chatEndpoint(cfg) {
  if (cfg && cfg.proxyBase) {
    const base = String(cfg.proxyBase).replace(/\/+$/, '');
    return { url: base + '/api/chat', auth: 'Bearer ' + (cfg.token || ''), proxy: true };
  }
  return { url: cfg.url, auth: 'Bearer ' + cfg.key, proxy: false };
}

/* 从流式累积的 JSON 文本里抠出当前已生成的 reply（用于打字机效果） */
function streamReply(raw) {
  const m = raw.match(/"reply"\s*:\s*"/);
  if (!m) return '';
  let s = raw.slice(m.index + m[0].length);
  // 找到 reply 值的闭合引号（跳过转义引号）即视为完整，否则取当前已流式到的内容
  let end = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '"') { end = i; break; }
  }
  if (end >= 0) s = s.slice(0, end);
  return s.replace(/\\"/g, '"').replace(/\\n/g, '\n');
}

/* 非流式（兜底用）：一次性拿回完整 JSON；模型原始 reply 敷衍时带 nudge 重试一次 */
async function llmStep(text, state, cfg) {
  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const nudge = attempt > 0 ? ANTI_LAZY_NUDGE : null;
    const _ep = _chatEndpoint(cfg);
    let res;
    try {
      res = await fetch(_ep.url, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json', 'Authorization': _ep.auth },
        body: JSON.stringify(buildBody(cfg, text, state, false, nudge))
      });
    } catch (e) {
      throw new Error('网络/跨域(CORS)错误：' + (e && e.message ? e.message : e) +
        '。若页面是用 file:// 双击打开的，请改用本地服务器（node server.js）启动后再访问 http://localhost:3000');
    }
    if (!res.ok) { const t = await res.text(); throw new Error('接口返回 ' + res.status + '：' + t.slice(0, 200)); }
    const data = await res.json();
    lastRaw = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : '';
    // 模型原始 reply 不敷衍才采用；否则带 nudge 再请求一次，争取真实回复而非兜底
    if (!rawReplyLazy(lastRaw)) return parseLLM(lastRaw, text, state);
  }
  return parseLLM(lastRaw, text, state);
}

/* 流式：逐字把客户台词打在气泡上，结束后回传完整解析结果；同样带抗懒重试 */
async function llmStepStream(text, state, cfg, onReply) {
  let lastRaw = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const nudge = attempt > 0 ? ANTI_LAZY_NUDGE : null;
    const _ep = _chatEndpoint(cfg);
    let res;
    try {
      res = await fetch(_ep.url, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json', 'Authorization': _ep.auth },
        body: JSON.stringify(buildBody(cfg, text, state, true, nudge))
      });
    } catch (e) {
      throw new Error('网络/跨域(CORS)错误：' + (e && e.message ? e.message : e) +
        '。若页面是用 file:// 双击打开的，请改用本地服务器（node server.js）启动后再访问 http://localhost:3000');
    }
    if (!res.ok) { const t = await res.text(); throw new Error('接口返回 ' + res.status + '：' + t.slice(0, 200)); }
    if (!res.body || !res.body.getReader) throw new Error('当前环境不支持流式响应');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let raw = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const data = t.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const j = JSON.parse(data);
          const delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
          if (delta) { raw += delta; if (onReply) onReply(streamReply(raw)); }
        } catch (e) { /* 跳过不完整的 SSE 分片 */ }
      }
    }
    lastRaw = raw;
    if (!rawReplyLazy(lastRaw)) return parseLLM(lastRaw, text, state);
  }
  return parseLLM(lastRaw, text, state);
}

/* 从模型原始输出里尽量抠出 reply 台词（解析失败时保底用） */
function extractReply(raw) {
  if (!raw) return '';
  try {
    const m = raw.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (m) return m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
  } catch (e) { /* ignore */ }
  return raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

/* 把离线评估的标签翻译成一句人话教练点评（解析失败兜底 / 离线模式通用） */
/* 教练点评：每个标签配多个变体，并按整场最近 4 句去重，避免同一句反复出现（复读机式的教练评语） */
const COACH_VARIANTS = {
  '过于简短': ['这句太短，破冰要自报家门+说清来意+时间承诺。', '话太短接不住，先报身份、说清来意、给个时间上限。'],
  '未挖需先介绍': ['先摸清店里情况再介绍产品，别一上来就讲酒。', '先问后讲：把他的客群和动销摸清楚，再上产品。'],
  '未塑造价值先报价': ['先塑造价值再谈价格，否则客户只盯着数字。', '价值没立住就报数，客户只会砍价，先把好处讲透。'],
  '陈述多于提问': ['多提问少陈述，用开放式问题了解他的生意。', '你说得不少，但该让他多说——用提问把需求勾出来。'],
  '空洞安抚': ['别只说"您放心"，要给证据或方案。', '"放心"太空了，给个凭据或具体动作才有说服力。'],
  '轻易让价': ['别急着降价，用政策/陈列费替代价格让步。', '降价最伤利，能用政策补的别用价格补。'],
  '诋毁竞品': ['别踩同行，容易惹反感。', '贬低对手显得心虚，把自家价值讲清楚就够了。'],
  '过度承诺': ['少用"保证/稳赚"，承诺越满信任越低。', '承诺要留余地，话说太满回头难收。'],
  '正面回应异议': ['处理异议不错：认同→举证→转嫁风险。', '异议接得稳：先认同情绪，再上证据和兜底。'],
  '给了证据': ['用数据说话，这一句很有说服力。', '有数字有凭据，这比空口承诺强太多。'],
  '讲了客户利益': ['把卖点翻译成对他(利润/动销)的好处，方向对了。', '站在他的生意上算账，客户才听得进去。'],
  '先认同': ['先认同再化解，客户愿意继续听。', '先接住情绪，后面怎么说都顺。'],
  '用政策不降价': ['用政策代替降价，保住了利润空间。', '价格不让，用账期/陈列/品鉴这些政策把利守住。'],
  '降低决策门槛': ['给了他一个低风险的试水方案，逼单有力。', '小步试水降低他的决策压力，这步逼单很稳。'],
  '问到量化指标': ['问到了销量/动销，挖需很到位。', '数字问得准，后面算账才站得住。'],
  '开放式提问': ['开放式提问，能挖出更多真需求。', '把问题抛开放，让他自己把情况倒出来。'],
  '未识别到有效动作': ['这句没传递有效动作，明确你想做哪一步（破冰/挖需/塑价值/算账/逼单）。', '动作不明确客户就懵，先说清这步要干什么。']
};
function synthCoach(q, intent, state) {
  const tail = (state && state._coachTail) || [];
  const pick = (arr) => {
    let cand = arr.find(v => tail.indexOf(v) < 0);
    if (cand === undefined) {
      // 变体全在最近 4 句里：排除上一句（tail 末尾），保证不连续重复同一句
      const prev = tail[tail.length - 1];
      const pool = arr.filter(v => v !== prev);
      const src = pool.length ? pool : arr;
      cand = src[Math.floor(Math.random() * src.length)];
    }
    if (state) state._coachTail = tail.concat([cand]).slice(-4);
    return cand;
  };
  for (const t of (q.tags || [])) if (COACH_VARIANTS[t]) return pick(COACH_VARIANTS[t]);
  if (q.level === 'good') return pick(['这句说得好，保持这个节奏。', '这步走得漂亮，节奏继续。']);
  if (q.level === 'bad') return pick(['这句效果偏弱，看看是不是缺了认同/证据/方案。', '这轮偏弱，认同/证据/方案少了一环。']);
  return '继续推进：' + (STAGE_TIPS[intent] || '保持节奏，明确下一步动作。');
}

/* ---------------- 通用生成接口（供「智能生成政策与卖点」复用） ---------------- */
async function llmGenerate(system, user, cfg) {
  const _ep = _chatEndpoint(cfg);
  let res;
  try {
    res = await fetch(_ep.url, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': _ep.auth
      },
    body: JSON.stringify({
      model: cfg.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      temperature: 0.7,
      max_tokens: 1200
    })
  });
  } catch (e) {
    throw new Error('网络/跨域(CORS)错误：' + (e && e.message ? e.message : e) +
      '。若页面是用 file:// 双击打开的，请改用本地服务器（node server.js）启动后再访问 http://localhost:3000');
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error('接口返回 ' + res.status + '：' + t.slice(0, 200));
  }
  const data = await res.json();
  const raw = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '';
  const clean = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  return JSON.parse(clean);
}

/* ---------------- 通用纯文本对话（供「AI 示范回答」生成业务员下一句台词） ---------------- */
async function llmChatText(system, user, cfg) {
  const _ep = _chatEndpoint(cfg);
  let res;
  try {
    res = await fetch(_ep.url, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'Authorization': _ep.auth },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.7,
        max_tokens: 240
      })
    });
  } catch (e) {
    throw new Error('网络/跨域(CORS)错误：' + (e && e.message ? e.message : e));
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error('接口返回 ' + res.status + '：' + t.slice(0, 200));
  }
  const data = await res.json();
  const raw = data.choices && data.choices[0] && data.choices[0].message
    ? data.choices[0].message.content : '';
  return raw.replace(/```/g, '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/* ---------------- 连接自检（供「测试连接」按钮） ---------------- */
async function llmPing(cfg) {
  const _ep = _chatEndpoint(cfg);
  let res;
  try {
    res = await fetch(_ep.url, {
      method: 'POST',
      credentials: 'omit',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': _ep.auth
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: '请只回复两个字：正常' }],
        temperature: 0,
        max_tokens: 16
      })
    });
  } catch (e) {
    throw new Error('网络/跨域(CORS)错误：' + (e && e.message ? e.message : e) +
      '。若页面是用 file:// 双击打开的，请改用本地服务器（node server.js）启动后再访问 http://localhost:3000');
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error('接口返回 ' + res.status + '：' + t.slice(0, 200));
  }
  const data = await res.json();
  const c = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!c) throw new Error('接口返回结构异常（缺少 choices[0].message.content），请检查模型名是否正确');
  return c.trim();
}
