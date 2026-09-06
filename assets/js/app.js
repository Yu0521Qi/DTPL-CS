/* ============================================================
 *  酒水地推话术陪练 · 交互逻辑
 * ============================================================ */

const $ = id => document.getElementById(id);

let sel = { product: null, persona: null, difficulty: 'normal', mode: 'full', exam: false };
let mode = 'rule';              // rule | llm
let S = null;                   // 会话状态
let lastCoach = '';             // 大模型本轮给的教练点评（写入教练面板）
let lastReview = null;
let editing = null;             // {kind:'product'|'persona', id} 正在编辑的自定义项
let pendingImage = '';          // 当前编辑器里待保存的产品图片 dataURL
let pendingImageName = '';
let custTier = 'all';              // 客户名单档位筛选：all | low | mid | high
let prodQuery = '';                // 产品页关键词搜索（空串=不过滤）
let undoStack = [];                // 每轮发言前的会话快照，供「↩ 撤回」回退
let sending = false;               // 发送进行中（含大模型流式/离线延迟），期间禁用撤回，避免中途撤回污染已还原的状态
let demoState = null;              // 完整演示模式：null | { round, maxRound, abort };跑起来时锁定输入框，每轮 AI 业务员 + AI 客户自动对话
// 把这两个模块级 let 暴露到 window，方便测试与外部脚本读取最新值（let 顶层声明不自动挂 window）
Object.defineProperty(window, 'demoState', { get: () => demoState, configurable: true });
Object.defineProperty(window, 'sending',   { get: () => sending,   configurable: true });
window.__demoDebug = () => ({ demoState, sending });

/* ---------------- 初始化 ---------------- */
function init() {
  Store.ensureSeed();           // 首次运行建示例团队（全员同级，无管理员/员工之分）
  Store.sync();                 // 把自定义产品/客户合并进运行时数据
  renderProducts();
  renderPersonas();
  renderDiffs();
  renderModes();
  renderPlaybook();
  renderLLMPresets();
  loadLLMConfig();
  bindLLMTest();
  bindPickPersona();
  bindPickProduct();
  $('btnProdBack').onclick = () => goCustomers();
  $('prodSearch').oninput = () => { prodQuery = $('prodSearch').value; renderProducts(); keepSelection(); };
  if (location.protocol === 'file:') { const w = $('llmCorsWarn'); if (w) w.style.display = ''; }

  $('productGrid').children[0].click();
  $('personaGrid').children[0].click();
  $('diffGrid').querySelector('[data-k="normal"]').click();
  $('modeGrid').querySelector('[data-k="full"]').click();

  $('btnStart').onclick = beginSession;
  $('btnSend').onclick = send;
  $('btnDemo').onclick = () => {
    if (demoState) { demoTakeOver(); return; }
    if (S && S.finished) beginSession();   // 会话已结束时点击：先重开同场景会话再演示
    aiDemoFull();
  };
  $('btnFinish').onclick = () => finish();
  $('btnUndo').onclick = undoLastTurn;
  $('btnRestart').onclick = () => go('screenSetup');
  $('btnSetupBack').onclick = () => go('screenProduct');
  bindSideTabs();
  $('btnGrowth').onclick = () => { renderGrowth(); go('screenGrowth'); };
  $('btnToGrowth').onclick = () => { renderGrowth(); go('screenGrowth'); };
  $('btnBackHome').onclick = () => go('screenSetup');
  $('btnClearHistory').onclick = clearHistory;
  $('btnAgain').onclick = () => beginSession();
  $('btnChange').onclick = () => go('screenSetup');
  $('btnExport').onclick = exportReport;
  $('examMode').onchange = e => { sel.exam = e.target.checked; updateSummary(); };

  // 成员切换（无身份选择界面，全员同级；头部下拉即可切换/新增）
  bindMemberSwitch();

  $('modeSwitch').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    mode = b.dataset.mode;
    [...$('modeSwitch').children].forEach(x => x.classList.toggle('on', x === b));
    $('llmBox').style.display = mode === 'llm' ? '' : 'none';
    syncDemoBtn();
  });
  $('llmKey').addEventListener('input', syncDemoBtn);
  if ($('llmToken')) $('llmToken').addEventListener('input', syncDemoBtn);
  if ($('llmProxy')) $('llmProxy').addEventListener('input', syncDemoBtn);
  syncDemoBtn();

  const ta = $('input');
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
  });

  bindModal();

  // 新增：主界面入口 + 客户名单（可搜索）
  $('btnHomeStart').onclick = goCustomers;
  $('btnCustBack').onclick = () => go('screenHome');
  $('custSearch').oninput = renderCustomers;
  // 客户名单档位筛选
  $('tierFilters').querySelectorAll('.tier-chip').forEach(b => {
    b.onclick = () => {
      custTier = b.dataset.tier;
      $('tierFilters').querySelectorAll('.tier-chip').forEach(x => x.classList.toggle('on', x === b));
      renderCustomers();
    };
  });

  ensureCurrent();            // 自动选定当前练习成员（全员同级，无需身份选择界面）
  go('screenHome');
}

function go(id) {
  ['screenHome', 'screenSetup', 'screenTrain', 'screenReport', 'screenGrowth', 'screenCustomers', 'screenProduct'].forEach(s => $(s).classList.toggle('on', s === id));
  $('btnRestart').style.display = (id === 'screenSetup' || id === 'screenHome' || id === 'screenCustomers' || id === 'screenProduct') ? 'none' : '';
  $('btnGrowth').style.display = (id === 'screenGrowth') ? 'none' : '';
  // 进入产品页时重渲染产品列表（含自定义产品）并恢复选中态
  if (id === 'screenProduct') {
    renderProducts();
    keepSelection();
  }
  // 进入配置页时重渲染列表（自定义项权限对所有成员一致）
  if (id === 'screenSetup') {
    renderProducts();
    renderPersonas();
    keepSelection();
    collapsePersonaGrid();   // 每次进配置页都回到「已选客户」形态，不重复铺开全部客户
  }
  refreshMemberSwitch();      // 同步头部成员下拉为当前练习成员
  window.scrollTo(0, 0);
}

/* ---------------- 配置页渲染 ---------------- */
function cardActs(kind, id) {
  return `<div class="card-acts">
    <button data-act="edit" data-kind="${kind}" data-id="${esc(id)}" title="编辑">✎</button>
    <button class="del" data-act="del" data-kind="${kind}" data-id="${esc(id)}" title="删除">✕</button>
  </div>`;
}

function renderProducts() {
  const all = allProducts();
  const q = (prodQuery || '').trim().toLowerCase();
  const kw = p => (p.name + ' ' + (p.category || '') + ' ' + (p.spec || '') + ' ' + (p.scene || '')).toLowerCase();
  const list = q ? all.filter(p => kw(p).includes(q)) : all;
  $('productGrid').innerHTML = (list.length ? list.map(p => `
    <div class="sel-card" data-k="${esc(p.id)}">
      ${p.custom ? cardActs('product', p.id) : ''}
      ${p.image ? `<img class="sel-thumb" src="${esc(p.image)}" alt="">` : ''}
      <div class="sel-head">
        <span class="sel-emoji">${esc(p.emoji || '🍷')}</span>
        <div>
          <div class="sel-name">${esc(p.name)}</div>
          <div class="sel-meta">${esc(p.category)} · ${esc(p.spec || '')}</div>
        </div>
      </div>
      <p class="sel-desc">${esc(p.scene || '')}</p>
      <div class="tag-row">
        <span class="tag">供货 ¥${p.cost}</span>
        <span class="tag">零售 ¥${p.retail}</span>
        <span class="tag ok">${esc(p.margin || '')}</span>
        ${p.custom ? '<span class="tag warn">自定义</span>' : ''}
      </div>
    </div>`).join('') : '<div class="search-empty">没有匹配的产品，换个关键词试试。</div>') + `
    <div class="add-card" id="addProduct">
      <span class="plus">＋</span>
      <span class="txt">自定义产品</span>
    </div>`;
  bindSel('productGrid', 'product');
  bindProductPick();
  const ap = $('addProduct');
  if (ap) ap.onclick = () => openEditor('product');
}

/* 在产品选择页点中某款产品 → 直接进入配置页确认（不重复铺开产品网格） */
function bindProductPick() {
  const g = $('productGrid');
  if (!g || g.dataset.pickBound === '1') return;
  g.dataset.pickBound = '1';
  g.addEventListener('click', e => {
    if (e.target.closest('[data-act]')) return;      // 编辑 / 删除自定义产品不跳转
    if (!e.target.closest('.sel-card')) return;
    if ($('screenProduct').classList.contains('on')) go('screenSetup');
  });
}

function renderPersonas() {
  const list = allPersonas();
  $('personaGrid').innerHTML = list.map(p => {
    const tier = PERSONA_TIERS[p.tier] || PERSONA_TIERS.mid;
    return `
    <div class="sel-card" data-k="${esc(p.id)}">
      ${p.custom ? cardActs('persona', p.id) : ''}
      <div class="sel-head">
        <span class="sel-emoji">${esc(p.emoji || '🧑‍💼')}</span>
        <div>
          <div class="sel-name">${esc(p.name)} · ${esc(p.title)}</div>
          <div class="sel-meta">${p.age || ''} 岁 · ${esc(p.scene || '')}</div>
        </div>
      </div>
      <p class="sel-desc">${esc(p.motive || '')}</p>
      <div class="tag-row">
        <span class="tag tier tier-${p.tier}">${esc(tier.name)}</span>
        ${(p.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        ${p.custom ? '<span class="tag warn">自定义</span>' : ''}
      </div>
    </div>`;
  }).join('') + `
    <div class="add-card" id="addPersona">
      <span class="plus">＋</span>
      <span class="txt">自定义客户</span>
    </div>`;
  bindSel('personaGrid', 'persona');
  $('addPersona').onclick = () => openEditor('persona');
}

/* 已选客户：配置页默认只展示「已选中的那一位」，
 * 避免与「客户名单」页重复铺开全部客户卡片；要更换时才展开下面那片网格。 */
function renderPickedPersona() {
  const box = $('pickedPersona');
  if (!box) return;
  const list = allPersonas();                       // 含自定义客户，不能只查内置 PERSONAS
  const p = list.find(x => x.id === sel.persona) || list[0];
  if (!p) { box.innerHTML = ''; return; }
  const tier = PERSONA_TIERS[p.tier] || PERSONA_TIERS.mid;
  box.innerHTML = `
    <div class="pk-head">
      <span class="pk-emoji">${esc(p.emoji || '🧑‍💼')}</span>
      <div class="pk-main">
        <div class="pk-name">${esc(p.name)} · ${esc(p.title || '')}</div>
        <div class="pk-meta">${p.age || ''} 岁 · ${esc(p.scene || '')}</div>
      </div>
      <div class="pk-tags">
        <span class="tag tier tier-${p.tier}">${esc(tier.name)}</span>
        ${p.custom ? '<span class="tag warn">自定义</span>' : ''}
      </div>
    </div>
    <p class="pk-desc">${esc(p.motive || '')}</p>
    <div class="tag-row">${(p.tags || []).slice(0, 4).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
}

function collapsePersonaGrid() {
  const g = $('personaGrid');
  if (g) g.style.display = 'none';
  const btn = $('btnPickPersona');
  if (btn) btn.textContent = '🔄 更换客户';
  const hint = $('pickPersonaHint');
  if (hint) hint.textContent = '默认已帮你选定，想换点这里展开全部客户';
}

function bindPickPersona() {
  const btn = $('btnPickPersona');
  if (!btn) return;
  btn.onclick = () => {
    const g = $('personaGrid');
    if (g.style.display !== 'none') { collapsePersonaGrid(); return; }
    renderPersonas();          // 展开时刷新，保证新建的自定义客户也在
    keepSelection();           // 恢复选中态与摘要
    g.style.display = '';
    btn.textContent = '收起客户列表';
    const hint = $('pickPersonaHint');
    if (hint) hint.textContent = '从下面挑一位，点一下即可切换';
  };
}

/* 已选产品：配置页只展示已选定的那一款，换品跳回产品页，避免重复铺开产品网格 */
function renderPickedProduct() {
  const box = $('pickedProduct');
  if (!box) return;
  const list = allProducts();                       // 含自定义产品
  const p = list.find(x => x.id === sel.product) || list[0];
  if (!p) { box.innerHTML = ''; return; }
  box.innerHTML = `
    <div class="pk-head">
      ${p.image ? `<img class="pk-thumb" src="${esc(p.image)}" alt="">` : `<span class="pk-emoji">${esc(p.emoji || '🍷')}</span>`}
      <div class="pk-main">
        <div class="pk-name">${esc(p.name)}</div>
        <div class="pk-meta">${esc(p.category || '')} · ${esc(p.spec || '')}</div>
      </div>
      <div class="pk-tags">
        <span class="tag ok">${esc(p.margin || '')}</span>
        ${p.custom ? '<span class="tag warn">自定义</span>' : ''}
      </div>
    </div>
    <p class="pk-desc">${esc(p.scene || '')}</p>
    <div class="tag-row">
      <span class="tag">供货 ¥${p.cost}</span>
      <span class="tag">零售 ¥${p.retail}</span>
    </div>`;
}

function bindPickProduct() {
  const btn = $('btnPickProduct');
  if (btn) btn.onclick = () => goProducts();
}

function goProducts() {
  $('prodSearch').value = '';
  prodQuery = '';
  renderProducts();
  keepSelection();
  go('screenProduct');
}

function renderDiffs() {
  $('diffGrid').innerHTML = Object.values(DIFFICULTIES).map(d => `
    <div class="sel-card" data-k="${esc(d.id)}">
      <div class="sel-head">
        <span class="sel-emoji">${d.emoji}</span>
        <div class="sel-name">${d.name}</div>
      </div>
      <p class="sel-desc">${d.desc}</p>
      <div class="tag-row">
        <span class="tag">异议频率 ${Math.round(d.objectionRate * 100)}%</span>
        <span class="tag">${d.maxTurns} 轮</span>
      </div>
    </div>`).join('');
  bindSel('diffGrid', 'difficulty');
}

function renderModes() {
  $('modeGrid').innerHTML = Object.values(MODES).map(m => `
    <div class="sel-card" data-k="${esc(m.id)}">
      <div class="sel-head">
        <span class="sel-emoji">${m.emoji}</span>
        <div>
          <div class="sel-name">${m.name}</div>
          <div class="sel-meta">${m.rounds ? m.rounds + ' 轮 · ' : ''}${m.dims ? '专项评分' : '七维度评分'}</div>
        </div>
      </div>
      <p class="sel-desc">${m.desc}</p>
    </div>`).join('');
  bindSel('modeGrid', 'mode');
}

function bindSel(gridId, key) {
  const g = $(gridId);
  if (g.dataset.bound === '1') return;   // 重渲染后不重复绑定
  g.dataset.bound = '1';
  g.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) {                            // 编辑 / 删除自定义项
      e.stopPropagation();
      if (act.dataset.act === 'edit') openEditor(act.dataset.kind, act.dataset.id);
      else removeCustom(act.dataset.kind, act.dataset.id);
      return;
    }
    const c = e.target.closest('.sel-card');
    if (!c) return;
    [...g.children].forEach(x => x.classList.toggle('on', x === c));
    sel[key] = c.dataset.k;
    updateSummary();
    // 选完即刷新对应「已选卡片」；客户顺带收起网格，避免与客户名单页重复铺开
    if (key === 'persona') { renderPickedPersona(); collapsePersonaGrid(); }
    if (key === 'product') renderPickedProduct();
  });
}

function updateSummary() {
  const ok = sel.exam || (sel.product && sel.persona);
  $('btnStart').disabled = !ok;
  if (sel.exam) {
    $('startSummary').innerHTML =
      `<b style="color:var(--wine)">考核模式</b>：大模型将<b>随机生成客户与产品</b>，请独立完成、过程中不给提示。` +
      `<br><span style="color:var(--ink-3)">结束后给出评分、问题诊断与一份「标准答案」供你对照参考、引发自行思考。</span>`;
    return;
  }
  if (!ok) { $('startSummary').textContent = '请完成上面的选择'; return; }
  const p = PRODUCTS[sel.product];
  const pe = PERSONAS.find(x => x.id === sel.persona);
  const d = DIFFICULTIES[sel.difficulty];
  const m = MODES[sel.mode];
  $('startSummary').innerHTML =
    `向 <b>${esc(pe.name)}</b>（${esc(pe.title)}）推销 <b>${esc(p.name)}</b>，` +
    `<b>${m.name}</b> · <b>${d.name}</b>${sel.exam ? ' · <b style="color:var(--wine)">考核模式</b>' : ''}<br>` +
    `<span style="color:var(--ink-3)">${m.dims ? '只评「' + m.dims.filter(x => x !== 'pro').map(id => (DIMENSIONS.find(z => z.id === id) || {}).name).join('、') + '」，归一化到百分制' : '七维度完整评分'}，` +
    `共 ${m.rounds || d.maxTurns} 轮${sel.exam ? '，过程中不给任何提示' : ''}。</span>`;
}

function renderPlaybook() {
  $('playbook').innerHTML = PLAYBOOK.map(g => `
    <div class="pb-group">
      <div class="h">${g.title}</div>
      <ul>${g.items.map(i => `<li>${i}</li>`).join('')}</ul>
    </div>`).join('');
}

/* ---------------- 自定义编辑弹窗 ---------------- */
const PRODUCT_FORM = [
  { sec: '基本信息' },
  { k: 'emoji', label: '图标', def: '🍷', half: true },
  { k: 'name', label: '品名', req: true, half: true, ph: '如：蜀韻·窖藏15' },
  { k: 'category', label: '品类', req: true, half: true, ph: '如：中高端浓香白酒' },
  { k: 'spec', label: '规格', half: true, ph: '如：52° / 500ml / 1×6' },
  { k: 'scene', label: '适用场景', ph: '如：宴席 · 商务送礼 · 年节团购' },
  { k: 'image', label: '产品图片（上传包装 / 实拍照片）', type: 'image' },
  { k: 'cost', label: '供货价（元）', type: 'number', req: true, half: true },
  { k: 'retail', label: '建议零售价（元）', type: 'number', req: true, half: true },
  { k: '_gen', type: 'genbtn', half: true, ph: '填好上面品名 / 品类 / 价格后，一键生成政策与卖点' },
  { sec: '政策与卖点　（每个 textarea 一行一条，可留空用「智能生成」填充）' },
  { k: 'policies', label: '进货政策 / 支持', type: 'textarea' },
  { k: 'fabeF', label: 'F 特点：产品本身是什么', type: 'textarea' },
  { k: 'fabeA', label: 'A 优势：比同类好在哪', type: 'textarea' },
  { k: 'fabeB', label: 'B 利益：对老板有什么好处', type: 'textarea' },
  { k: 'fabeE', label: 'E 证据：凭什么相信你', type: 'textarea' },
  { sec: '参考话术　（留空会自动按卖点生成）' },
  { k: 'refGreet', label: '开场', type: 'textarea' },
  { k: 'refProbe', label: '挖需', type: 'textarea' },
  { k: 'refPresent', label: '塑造', type: 'textarea' },
  { k: 'refPolicy', label: '算账', type: 'textarea' },
  { k: 'refClose', label: '逼单', type: 'textarea' }
];

const PERSONA_FORM = [
  { sec: '身份' },
  { k: 'emoji', label: '头像', def: '🧑‍💼', half: true },
  { k: 'name', label: '称呼', req: true, half: true, ph: '如：老张' },
  { k: 'title', label: '身份', req: true, half: true, ph: '如：社区烟酒店老板' },
  { k: 'age', label: '年龄', type: 'number', def: 42, half: true },
  { k: 'scene', label: '店铺 / 场景', ph: '如：城东老小区门口，30㎡ 店，做了 12 年' },
  { sec: '性格与诉求' },
  { k: 'tags', label: '性格标签（逗号分隔）', ph: '谨慎务实,只认利润,慢热' },
  { k: 'motive', label: '他真正在意什么', req: true, ph: '如：只关心能不能卖得动、一箱能赚多少' },
  { k: 'decision', label: '他怎么下决定', ph: '如：先小批量试销，动销好了再放量' },
  { k: 'likes', label: '他吃哪一套（逗号分隔）', ph: '帮他算账,周边店数据,小批量试销' },
  { k: 'opening', label: '开场白（他见到你的第一句话）', ph: '（抬头看了你一眼）有事？' },
  { sec: '说话风格' },
  { k: 'style', label: '说话风格', type: 'select', opts: 'SPEAK_STYLES', half: true },
  { k: 'catchphrases', label: '口头禅（逗号分隔，可留空）', half: true, ph: '哎呀,我跟你说' },
  { sec: '异议与雷区' },
  { k: 'objections', label: '他常用的异议（建议至少选 2 个）', type: 'objections' },
  { k: 'mineKeys', label: '禁忌关键词（说了他会翻脸，逗号分隔）', ph: '包赚,保证卖,别家不行' },
  { k: 'mineReply', label: '触发禁忌时他的反应', ph: '（摆手）小伙子，做生意没有「包」这个字。' },
  { sec: '初始状态（0-100，越低越难搞）' },
  { k: 'initA', label: '态度 / 好感', type: 'number', def: 45, third: true },
  { k: 'initI', label: '进货意向', type: 'number', def: 20, third: true },
  { k: 'initT', label: '信任度', type: 'number', def: 32, third: true }
];

function bindModal() {
  $('modalClose').onclick = closeEditor;
  $('modalCancel').onclick = closeEditor;
  $('modalMask').onclick = closeEditor;
  $('modalSave').onclick = saveEditor;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && $('modal').classList.contains('on')) closeEditor();
  });
}

function fieldHTML(f, val) {
  if (f.sec) return `<div class="form-sec">${f.sec}</div>`;
  const cls = 'fld' + ((f.half || f.third) ? '' : ' f-full');
  const v = val === undefined || val === null ? (f.def === undefined ? '' : f.def) : val;
  const lab = `<label>${f.label}${f.req ? ' <span class="req">*</span>' : ''}</label>`;
  let inner = '';
  if (f.type === 'textarea') {
    inner = `<textarea data-k="${f.k}" placeholder="${esc(f.ph || '')}">${esc(v)}</textarea>`;
  } else if (f.type === 'select') {
    const opts = Object.values(SPEAK_STYLES);
    inner = `<select data-k="${f.k}">` + opts.map(o =>
      `<option value="${o.id}"${o.id === v ? ' selected' : ''}>${o.name}</option>`).join('') + `</select>`;
  } else if (f.type === 'objections') {
    inner = `<div class="chk-grid" data-objc="${f.k}">` + Object.keys(OBJECTIONS).map(id =>
      `<label class="chk${(v || []).indexOf(id) >= 0 ? ' on' : ''}"><input type="checkbox" value="${id}"${(v || []).indexOf(id) >= 0 ? ' checked' : ''}>${OBJECTIONS[id].label}</label>`
    ).join('') + `</div>`;
  } else if (f.type === 'image') {
    inner = `<div class="img-upload">
      <img class="img-prev" id="imgPrev" src="${esc(v || '')}" style="${v ? '' : 'display:none'}">
      <div class="img-actions">
        <label class="btn-mini">选择图片<input type="file" accept="image/*" id="imgFile" hidden></label>
        <button type="button" class="btn-mini ghost" id="imgClear" ${v ? '' : 'style="display:none"'}>移除</button>
        <span class="img-tip">自动压缩，仅存于本机</span>
      </div>
    </div>`;
  } else if (f.type === 'genbtn') {
    inner = `<button type="button" class="gen-btn" id="genBtn">⚡ 根据基本信息智能生成政策与卖点</button><span class="img-tip" style="margin-left:8px">${esc(f.ph || '')}</span>`;
  } else {
    inner = `<input type="${f.type || 'text'}" data-k="${f.k}" value="${esc(v)}" placeholder="${esc(f.ph || '')}">`;
  }
  return `<div class="${cls}">${lab}${inner}</div>`;
}

function openEditor(kind, id) {
  editing = { kind, id: id || null };
  const isP = kind === 'product';
  $('modalTitle').textContent = (id ? '编辑' : '新建') + (isP ? '产品' : '客户');
  $('modalErr').textContent = '';

  const src = id
    ? (isP ? PRODUCTS[id] : PERSONAS.find(x => x.id === id))
    : null;
  pendingImage = src ? (src.image || '') : '';
  pendingImageName = src ? (src.imageName || '') : '';
  const vals = src ? objToForm(isP, src) : {};

  $('modalBody').innerHTML = '<div class="form-grid">'
    + (isP ? PRODUCT_FORM : PERSONA_FORM).map(f => fieldHTML(f, vals[f.k])).join('')
    + '</div>';

  // 异议勾选联动高亮
  $('modalBody').querySelectorAll('.chk input').forEach(cb => {
    cb.onchange = () => cb.closest('.chk').classList.toggle('on', cb.checked);
  });

  // 图片上传
  const imgFile = $('imgFile');
  if (imgFile) imgFile.onchange = e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    pendingImageName = f.name;
    compressImage(f, dataUrl => {
      pendingImage = dataUrl;
      const pv = $('imgPrev');
      if (pv) { pv.src = dataUrl; pv.style.display = ''; }
      const cl = $('imgClear');
      if (cl) cl.style.display = '';
    });
  };
  const imgClear = $('imgClear');
  if (imgClear) imgClear.onclick = () => {
    pendingImage = ''; pendingImageName = '';
    const f = $('imgFile'); if (f) f.value = '';
    const pv = $('imgPrev'); if (pv) { pv.src = ''; pv.style.display = 'none'; }
    imgClear.style.display = 'none';
  };

  // 智能生成政策与卖点
  const genBtn = $('genBtn');
  if (genBtn) genBtn.onclick = () => onGenerateClick(genBtn);

  $('modal').classList.add('on');
}

function closeEditor() {
  $('modal').classList.remove('on');
  editing = null;
}

/* ---------------- 图片压缩（上传后限制到长边 640px，避免 localStorage 爆掉） ---------------- */
function compressImage(file, cb) {
  if (!file || !file.type || !file.type.startsWith('image/')) { toast('请选择图片文件'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const MAX = 640;
      let w = img.width, h = img.height;
      if (w > h && w > MAX) { h = Math.round(h * MAX / w); w = MAX; }
      else if (h > MAX) { w = Math.round(w * MAX / h); h = MAX; }
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      cv.getContext('2d').drawImage(img, 0, 0, w, h);
      try { cb(cv.toDataURL('image/jpeg', 0.82)); }
      catch (e) { cb(reader.result); }      // 异常兜底用原图
    };
    img.onerror = () => cb(reader.result);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* ---------------- 当前 LLM 配置（复用设置页输入） ---------------- */
function currentLLMCfg() {
  const g = id => { const el = $(id); return el ? el.value.trim() : ''; };
  const token = g('llmToken');
  const proxy = g('llmProxy');
  if (token) {
    // 令牌模式：请求走卖家后端 /api/chat，客户端不持有真实 Key
    const base = proxy ? proxy.replace(/\/+$/, '') : '';
    return { proxyBase: base, token, url: (base ? base : '') + '/api/chat', model: 'proxy', key: token, _proxy: true };
  }
  return { url: g('llmUrl'), model: g('llmModel'), key: g('llmKey') };
}

/* 是否已具备调用大模型的条件：令牌模式 或 开发者直连(BYOK) */
function isLLMReady() {
  const g = id => { const el = $(id); return el ? el.value.trim() : ''; };
  if (g('llmToken')) return true;
  return !!(g('llmUrl') && g('llmKey'));
}

/* ---------------- 智能生成政策与卖点 ---------------- */
async function generateProductContent(basic) {
  const cfg = currentLLMCfg();
  if (cfg.key && cfg.url && cfg.model) {
    try { return await genWithLLM(basic, cfg); }
    catch (e) { console.warn('大模型生成失败，回退离线：', e.message); }
  }
  return genOfflineContent(basic);
}

async function genWithLLM(basic, cfg) {
  const catText = Object.values(CATEGORY_KB).map(c => `- ${c.name}：${c.marginHint}`).join('\n');
  const system = `你是酒水行业资深渠道操盘手，擅长为地推业务员设计「终端老板听得懂、愿意进货」的政策与卖点。
行业常识（各品类典型渠道利润与政策方向）：
${catText}
规则：
1. 输出严格 JSON，不要 Markdown 代码块，不要多余文字。
2. 卖点用 FABE 结构：F 特点 / A 优势 / B 对老板的利益 / E 证据。
3. 语言口语化、贴合终端老板视角，少用空话，多用具体数字与场景。
4. policies 给 5~6 条可执行的进货支持；fabe 各 3~4 条。`;
  const user = `产品基本信息：
- 品名：${basic.name}
- 品类：${basic.category}
- 规格：${basic.spec}
- 适用场景：${basic.scene}
- 供货价：${basic.cost} 元
- 建议零售价：${basic.retail} 元
- 单瓶毛利：${basic.gap} 元，毛利率 ${basic.rate}%

请结合「${basic.category}」所属品类的行业常识，生成这套产品的政策与卖点，输出 JSON：
{
  "category": "修正后的标准品类名",
  "policies": ["进货政策/支持1", "..."],
  "fabeF": ["特点1", "..."],
  "fabeA": ["优势1", "..."],
  "fabeB": ["对老板的好处1", "..."],
  "fabeE": ["可信证据/本地案例1", "..."]
}`;
  const r = await llmGenerate(system, user, cfg);
  return {
    category: r.category || basic.category,
    policies: Array.isArray(r.policies) ? r.policies : [],
    fabeF: Array.isArray(r.fabeF) ? r.fabeF : [],
    fabeA: Array.isArray(r.fabeA) ? r.fabeA : [],
    fabeB: Array.isArray(r.fabeB) ? r.fabeB : [],
    fabeE: Array.isArray(r.fabeE) ? r.fabeE : []
  };
}

function setFieldVal(k, val) {
  const el = document.querySelector(`[data-k="${k}"]`);
  if (el) { el.value = val || ''; el.dispatchEvent(new Event('input')); }
}

async function onGenerateClick(btn) {
  const v = formVals();
  if (!v.name || !v.name.trim()) return toast('先填「品名」再生成');
  if (!v.category || !v.category.trim()) return toast('先填「品类」再生成');
  const cost = Number(v.cost), retail = Number(v.retail);
  if (!(cost > 0) || !(retail > 0)) return toast('先填供货价和零售价（用于算毛利）');
  const gap = Math.max(0, Math.round((retail - cost) * 100) / 100);
  const rate = retail ? Math.round(gap / retail * 1000) / 10 : 0;
  const basic = { name: v.name.trim(), category: v.category.trim(), spec: v.spec || '', scene: v.scene || '', cost, retail, gap, rate };

  const old = btn.textContent;
  btn.disabled = true; btn.textContent = '⏳ 生成中…';
  try {
    const c = await generateProductContent(basic);
    setFieldVal('policies', c.policies.join('\n'));
    setFieldVal('fabeF', c.fabeF.join('\n'));
    setFieldVal('fabeA', c.fabeA.join('\n'));
    setFieldVal('fabeB', c.fabeB.join('\n'));
    setFieldVal('fabeE', c.fabeE.join('\n'));
    if (c.category && c.category !== v.category.trim()) setFieldVal('category', c.category);
    toast('已生成政策与卖点（' + c.category + '），可直接保存');
  } catch (e) {
    toast('生成失败：' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = old;
  }
}

function objToForm(isP, o) {
  if (isP) {
    const ref = t => { const r = (o.refs || []).find(x => x.t === t); return r ? r.s : ''; };
    return {
      emoji: o.emoji, name: o.name, category: o.category, spec: o.spec, scene: o.scene,
      image: o.image || '', imageName: o.imageName || '',
      cost: o.cost, retail: o.retail,
      policies: (o.policies || []).join('\n'),
      fabeF: (o.fabe.F || []).join('\n'), fabeA: (o.fabe.A || []).join('\n'),
      fabeB: (o.fabe.B || []).join('\n'), fabeE: (o.fabe.E || []).join('\n'),
      refGreet: ref('开场'), refProbe: ref('挖需'), refPresent: ref('塑造'),
      refPolicy: ref('算账'), refClose: ref('逼单')
    };
  }
  return {
    emoji: o.emoji, name: o.name, title: o.title, age: o.age, scene: o.scene,
    tags: (o.tags || []).join(','), motive: o.motive, decision: o.decision,
    likes: (o.likes || []).join(','), opening: o.opening,
    style: o.style || 'terse', catchphrases: (o.catchphrases || []).join(','),
    objections: o.objections || [],
    mineKeys: o.mineKeys || '',
    mineReply: (o.mines && o.mines[0] && o.mines[0].r) || '',
    initA: o.init.attitude, initI: o.init.interest, initT: o.init.trust
  };
}

function formVals() {
  const v = {};
  $('modalBody').querySelectorAll('[data-k]').forEach(el => { v[el.dataset.k] = el.value; });
  $('modalBody').querySelectorAll('[data-objc]').forEach(box => {
    v[box.dataset.objc] = [...box.querySelectorAll('input:checked')].map(i => i.value);
  });
  return v;
}

function saveEditor() {
  const v = formVals();
  const isP = editing.kind === 'product';
  const err = m => { $('modalErr').textContent = m; };

  if (isP) {
    if (!v.name.trim()) return err('请填写品名');
    if (!v.category.trim()) return err('请填写品类');
    if (!(Number(v.cost) > 0) || !(Number(v.retail) > 0)) return err('供货价和零售价都要填，且零售价应高于供货价');
    if (Number(v.retail) <= Number(v.cost)) return err('零售价要高于供货价，否则客户算不出利润');

    const gap = Math.round((Number(v.retail) - Number(v.cost)) * 100) / 100;
    const rate = Math.round(gap / Number(v.retail) * 1000) / 10;
    const lines = s => String(s || '').split('\n').map(x => x.trim()).filter(Boolean);
    const p = {
      id: editing.id || 'custom_p_' + Date.now(),
      custom: true,
      emoji: v.emoji.trim() || '🍷',
      name: v.name.trim(),
      category: v.category.trim(),
      spec: v.spec.trim(),
      scene: v.scene.trim(),
      image: pendingImage, imageName: pendingImageName,
      cost: Number(v.cost), retail: Number(v.retail),
      margin: `单瓶毛利 ${gap} 元，毛利率约 ${rate}%`,
      policies: lines(v.policies),
      fabe: { F: lines(v.fabeF), A: lines(v.fabeA), B: lines(v.fabeB), E: lines(v.fabeE) },
      refs: [
        { t: '开场', s: v.refGreet.trim() }, { t: '挖需', s: v.refProbe.trim() },
        { t: '塑造', s: v.refPresent.trim() }, { t: '算账', s: v.refPolicy.trim() },
        { t: '逼单', s: v.refClose.trim() }
      ].filter(r => r.s)
    };
    Store.saveProduct(p);
    sel.product = p.id;
  } else {
    if (!v.name.trim()) return err('请填写称呼');
    if (!v.title.trim()) return err('请填写身份');
    if (!v.motive.trim()) return err('请填写「他真正在意什么」——这决定客户怎么回应你');
    if (!v.objections || v.objections.length < 2) return err('至少勾选 2 个他常用的异议');

    const csv = s => String(s || '').split(/[,，]/).map(x => x.trim()).filter(Boolean);
    const pe = {
      id: editing.id || 'custom_c_' + Date.now(),
      custom: true,
      emoji: v.emoji.trim() || '🧑‍💼',
      name: v.name.trim(),
      title: v.title.trim(),
      age: Number(v.age) || 42,
      tier: 'mid',
      scene: v.scene.trim(),
      tags: csv(v.tags).length ? csv(v.tags) : ['自定义客户'],
      motive: v.motive.trim(),
      decision: v.decision.trim() || '看情况，聊得来就试试',
      likes: csv(v.likes),
      style: v.style,
      catchphrases: csv(v.catchphrases),
      objections: v.objections,
      mineKeys: v.mineKeys.trim(),
      mineReply: v.mineReply.trim(),
      init: {
        attitude: clamp(Number(v.initA) || 45, 0, 100),
        interest: clamp(Number(v.initI) || 20, 0, 100),
        trust: clamp(Number(v.initT) || 32, 0, 100)
      },
      opening: v.opening.trim() || '（抬头看了你一眼）有事？',
      reactions: makeReactions(v.style, csv(v.catchphrases))
    };
    Store.savePersona(pe);
    sel.persona = pe.id;
  }

  Store.sync();
  closeEditor();
  renderProducts();
  renderPersonas();
  keepSelection();
  toast('已保存');
}

function removeCustom(kind, id) {
  const isP = kind === 'product';
  const o = isP ? PRODUCTS[id] : PERSONAS.find(x => x.id === id);
  if (!o) return;
  if (!confirm(`确定删除「${o.name}」吗？此操作不可撤销。`)) return;
  Store.remove(kind, id);
  delete PRODUCTS[id];
  if (!isP) {
    const i = PERSONAS.findIndex(x => x.id === id);
    if (i >= 0) PERSONAS.splice(i, 1);
  }
  if (sel.product === id) sel.product = null;
  if (sel.persona === id) sel.persona = null;
  renderProducts();
  renderPersonas();
  keepSelection();
  toast('已删除');
}

/* 删除/新增后，保证选择仍然有效 */
function keepSelection() {
  if (!PRODUCTS[sel.product]) sel.product = allProducts()[0].id;
  if (!PERSONAS.find(x => x.id === sel.persona)) sel.persona = allPersonas()[0].id;
  [...$('productGrid').children].forEach(c => c.classList.toggle('on', c.dataset.k === sel.product));
  [...$('personaGrid').children].forEach(c => c.classList.toggle('on', c.dataset.k === sel.persona));
  renderPickedPersona();
  renderPickedProduct();
  updateSummary();
}

/* ---------------- LLM 配置 ---------------- */
function renderLLMPresets() {
  const s = $('llmPreset');
  s.innerHTML = LLM_PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
  s.onchange = () => {
    const p = LLM_PRESETS[s.value];
    if (p.url) { $('llmUrl').value = p.url; $('llmModel').value = p.model; }
    saveLLMConfig();
  };
  ['llmUrl', 'llmModel', 'llmKey'].forEach(id => { $(id).oninput = saveLLMConfig; });
}

/* ---------------- 测试连接 ---------------- */
function bindLLMTest() {
  const btn = $('btnTestLLM');
  if (btn) btn.onclick = testLLM;
}

async function testLLM() {
  const proxy = $('llmProxy').value.trim();
  const token = $('llmToken').value.trim();
  const msg = $('llmTestMsg');
  if (msg) msg.textContent = '';
  // 令牌模式：改测后端健康（不再直连上游，避免暴露 Key）
  if (token || proxy) {
    const base = (proxy || '').replace(/\/+$/, '');
    const url = (base ? base : '') + '/api/health';
    if (msg) msg.textContent = '正在连接后端…';
    try {
      const res = await fetch(url, { headers: token ? { Authorization: 'Bearer ' + token } : {} });
      const d = await res.json().catch(() => ({}));
      if (d.ok) {
        if (msg) msg.textContent = '✓ 后端已连接' + (d.hasUpstream ? '（上游 Key 已配置）' : '（上游 Key 未配置，请联系卖家）');
        toast('后端连接正常');
      } else if (msg) msg.textContent = '✗ 后端异常：' + JSON.stringify(d);
    } catch (e) { if (msg) msg.textContent = '✗ 无法连接后端：' + e.message; }
    return;
  }
  // 开发者直连（BYOK）自测
  const cfg = { url: $('llmUrl').value.trim(), model: $('llmModel').value.trim(), key: $('llmKey').value.trim() };
  const btn = $('btnTestLLM');
  if (!cfg.url || !cfg.model || !cfg.key) { if (msg) msg.textContent = '请先填好接口地址、模型名和 API Key'; return; }
  if (btn) { btn.disabled = true; btn.dataset.old = btn.textContent; btn.textContent = '测试中…'; }
  if (msg) msg.textContent = '正在连接 ' + cfg.url + ' …';
  try {
    const reply = await llmPing(cfg);
    if (msg) msg.textContent = '✓ 连接成功（模型回复：' + reply + '）';
    toast('连接成功，API Key 可用');
  } catch (e) {
    const cors = /CORS|Failed to fetch|NetworkError|跨域|网络\/跨域/i.test(e.message);
    if (msg) msg.textContent = '✗ 失败：' + e.message;
    toast('连接失败：' + e.message + (cors ? '（请用本地服务器打开页面）' : ''));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = btn.dataset.old || '测试连接'; }
  }
}
function saveLLMConfig() {
  try {
    localStorage.setItem('liquor_pt_llm', JSON.stringify({
      url: $('llmUrl').value, model: $('llmModel').value, key: $('llmKey').value, preset: $('llmPreset').value,
      token: $('llmToken').value, proxy: $('llmProxy').value
    }));
  } catch (e) {}
}
function loadLLMConfig() {
  try {
    const c = JSON.parse(localStorage.getItem('liquor_pt_llm') || '{}');
    if (c.preset) $('llmPreset').value = c.preset;
    if (c.url) $('llmUrl').value = c.url;
    if (c.model) $('llmModel').value = c.model;
    if (c.key) $('llmKey').value = c.key;
    if (c.token) $('llmToken').value = c.token;
    if (c.proxy) $('llmProxy').value = c.proxy;
    if (!c.url) { const p = LLM_PRESETS[0]; $('llmUrl').value = p.url; $('llmModel').value = p.model; }
  } catch (e) {}
}

/* ---------------- 会话 ---------------- */

/* 开始一次练习/考核的统一入口：
 *  - 考核模式 + 大模型：先让大模型随机出题（客户+产品+标准答案），merge 到随机内置基对象上后开练
 *  - 考核模式 + 规则：随机选内置客户/产品（无标准答案）
 *  - 普通模式：用 setup 里选定的客户/产品 */
async function beginSession() {
  // 考核 + 大模型：出题
  if (sel.exam && mode === 'llm' && isLLMReady()) {
    toast('🎲 考核出题：大模型正在随机生成客户与产品…');
    let gen = null;
    try { gen = await llmExamBootstrap(currentLLMCfg(), sel.difficulty, sel.mode); }
    catch (e) { console.warn('出题失败：', e && e.message); }
    if (gen && gen.persona && gen.product) {
      const baseP = randPick(allProducts());
      const basePe = randPick(allPersonas());
      const p = buildExamProduct(baseP, gen);
      const pe = buildExamPersona(basePe, gen);
      return startSession(p, pe, gen.modelApproach || null);
    }
    toast('出题失败，已改用内置随机场景');
    const p = randPick(allProducts()), pe = randPick(allPersonas());
    return startSession(p, pe, null);
  }
  // 考核 + 规则：随机内置场景
  if (sel.exam) {
    const p = randPick(allProducts()), pe = randPick(allPersonas());
    return startSession(p, pe, null);
  }
  // 普通模式
  return startSession();
}

function randPick(arr) { const a = arr || []; return a[Math.floor(Math.random() * a.length)]; }

/* 考核出题：让大模型随机生成客户画像 + 产品 + 标准答案（模型话术）。
 * 返回 { persona, product, modelApproach }，结构与 buildExam* 期望一致。 */
async function llmExamBootstrap(cfg, difficultyId, modeId) {
  const d = DIFFICULTIES[difficultyId] || DIFFICULTIES.normal;
  const m = MODES[modeId] || MODES.full;
  const diffHint = d.name === '地狱模式' ? '非常防备、很难搞、极易揪你话术漏洞'
    : d.name === '轻松' ? '偏友好、愿意聊' : '中性偏冷、不主动配合';
  const sys = `你是酒水销售「考核出题人」，也是资深渠道操盘手。
任务：为「陌生拜访话术考核」随机设计 1 份客户档案 + 1 款酒水产品 + 1 份标准参考答案。
要求：
1. 客户必须是酒水终端渠道的真实角色（如社区烟酒店老板 / 商超酒水采购 / 餐饮店老板 / 便利店主 / 连锁采购总监），有鲜明性格、口头禅式说话方式、具体在意的事。不要使用"老张/老李"这类程序内置固定人名，自行虚构有真实感的人。
2. 产品要具体：某款白酒/红酒/啤酒/洋酒，有差异化卖点与可算的账。
3. 难度「${d.name}」下，客户初始态度/意向/信任要匹配：${diffHint}；用 initA(态度)/initI(意向)/initT(信任) 三个 0-100 整数体现。
4. 同时给出"标准参考答案 modelApproach"：优秀业务员在 开场/挖需/塑造/算账/逼单/处理异议 各阶段会怎么讲（每阶段 1-2 句，口语、有具体动作、像真人）。这是考后给学员对照参考、引发其自行思考差距用的，不是唯一正确答案。
5. 严格输出 JSON，不要 Markdown 代码块、不要任何解释文字。字段结构：
{"persona":{"name":str,"title":str,"emoji":str,"scene":str,"motive":str,"decision":str,"tags":[str],"opening":str,"style":str,"likes":[str],"initA":int,"initI":int,"initT":int},
 "product":{"name":str,"category":str,"spec":str,"scene":str,"cost":int,"retail":int,"margin":str,"policies":[str],"fabeA":str,"fabeB":str,"fabeE":str,"refs":[{"t":str,"s":str}]},
 "modelApproach":{"greet":str,"probe":str,"present":str,"policy":str,"close":str,"antiObjection":str}}`;
  const user = `难度：${d.name}；训练模式：${m.name}（${m.dims ? '只评' + m.dims.filter(x => x !== 'pro').map(id => (DIMENSIONS.find(z => z.id === id) || {}).name).join('/') : '完整七步法'}）。请出题并返回上述 JSON。`;
  return await llmGenerate(sys, user, cfg);
}

/* 把大模型生成的客户 merge 到随机内置基对象上：保留 objections/mines/reactions 等结构字段，
 * 避免引擎因缺字段而报错；同时保证每次考核都不固定用那几个内置角色。 */
function buildExamPersona(base, g) {
  const gp = (g && g.persona) || {};
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
  return Object.assign({}, base, {
    id: 'exam-p-' + Date.now(),
    name: gp.name || base.name,
    title: gp.title || base.title,
    emoji: gp.emoji || base.emoji,
    scene: gp.scene || base.scene,
    motive: gp.motive || base.motive,
    decision: gp.decision || base.decision,
    tags: Array.isArray(gp.tags) && gp.tags.length ? gp.tags : base.tags,
    opening: gp.opening || base.opening,
    style: gp.style || base.style,
    likes: Array.isArray(gp.likes) && gp.likes.length ? gp.likes : base.likes,
    init: {
      attitude: clamp(num(gp.initA, base.init.attitude), 0, 100),
      interest: clamp(num(gp.initI, base.init.interest), 0, 100),
      trust: clamp(num(gp.initT, base.init.trust), 0, 100)
    }
  });
}

function buildExamProduct(base, g) {
  const gp = (g && g.product) || {};
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : d; };
  const fabe = {
    F: gp.fabeA ? [gp.fabeA] : (base.fabe && base.fabe.F),
    A: base.fabe && base.fabe.A,
    B: gp.fabeB ? [gp.fabeB] : (base.fabe && base.fabe.B),
    E: gp.fabeE ? [gp.fabeE] : (base.fabe && base.fabe.E)
  };
  return Object.assign({}, base, {
    id: 'exam-pr-' + Date.now(),
    name: gp.name || base.name,
    category: gp.category || base.category,
    spec: gp.spec || base.spec,
    scene: gp.scene || base.scene,
    cost: num(gp.cost, base.cost),
    retail: num(gp.retail, base.retail),
    margin: gp.margin || base.margin,
    policies: Array.isArray(gp.policies) && gp.policies.length ? gp.policies : base.policies,
    fabe: fabe,
    refs: Array.isArray(gp.refs) && gp.refs.length ? gp.refs : base.refs,
    priceBand: gp.priceBand || base.priceBand
  });
}

function startSession(forcedProduct, forcedPersona, forcedModel) {
  let p = forcedProduct, pe = forcedPersona;
  if (!p || !pe) {
    if (!PRODUCTS[sel.product]) sel.product = allProducts()[0].id;
    if (!PERSONAS.find(x => x.id === sel.persona)) sel.persona = allPersonas()[0].id;
    p = PRODUCTS[sel.product];
    pe = PERSONAS.find(x => x.id === sel.persona);
  }
  const m = MODES[sel.mode];
  S = createState(p, pe, sel.difficulty, sel.mode, sel.exam);
  S.startTs = Date.now();
  lastCoach = '';
  if (forcedModel) S.modelApproach = forcedModel;   // 考核模式：大模型生成的标准参考答案

  $('chatAvatar').textContent = pe.emoji || '🧑‍💼';
  const cpi = $('chatProdImg');
  if (cpi) {
    if (p.image) { cpi.src = p.image; cpi.style.display = ''; }
    else { cpi.src = ''; cpi.style.display = 'none'; }
  }
  $('chatWho').textContent = pe.name + ' · ' + pe.title;
  $('chatCtx').textContent = p.name + ' · ' + m.name + ' · ' + DIFFICULTIES[sel.difficulty].name;
  $('chatBody').innerHTML = '';
  undoStack = [];                 // 新会话清空撤回栈
  syncUndoBtn();
  $('input').value = '';
  $('input').disabled = false;
  $('btnSend').disabled = false;
  $('examTag').style.display = S.exam ? '' : 'none';
  document.querySelector('.side').classList.toggle('exam-on', !!S.exam);
  $('quickRow').style.display = S.exam ? 'none' : '';

  // 按训练模式决定"客户第一句话"：异议连打 / 逼单收尾开局即入戏，开场突破更冷，完整拜访用真实冷拜访开场白
  let opener;
  if (m.openObjection && OBJECTIONS[m.openObjection]) {
    const oid = m.openObjection;                      // OBJECTIONS 的 id 是键名而非对象属性
    const o = OBJECTIONS[oid];
    const line = pick(o.lines);
    S.pending = { id: oid, line };                   // 侧栏"当前异议"立即显示，教练同步点评
    opener = line;
  } else {
    opener = (typeof m.open === 'function') ? m.open(pe, p) : (m.open || pe.opening);
  }
  if (m.seedFlags) S.flags = { greeted: true, probed: true, presented: true, policied: true };
  S.opening = opener;                                // 供大模型系统提示复用，保持人设一致
  bubble('buyer', opener);
  const scope = m.dims
    ? `【本次只评】${m.dims.filter(x => x !== 'pro').map(id => (DIMENSIONS.find(z => z.id === id) || {}).name).join('、')}，共 ${m.rounds} 轮`
    : `【共 ${S.maxTurns} 轮】走完破冰 → 挖需 → 塑造 → 算账 → 异议 → 逼单`;
  bubble('sys', `【场景】${pe.scene}\n【客户在意】${pe.motive}\n【决策方式】${pe.decision}\n${scope}——开始你的拜访。`);

  updateSide();
  go('screenTrain');
  $('input').focus();
  syncDemoBtn();   // 新建会话后立刻刷新演示按钮状态（修复：开始后按钮仍灰的 bug）
}

function bubble(who, text, meta) {
  const d = document.createElement('div');
  d.className = 'msg ' + (who === 'me' ? 'me' : '');
  if (who === 'sys') {
    d.innerHTML = `<div class="bubble" style="max-width:100%;background:#fbf7f2;border-style:dashed;color:var(--ink-2);font-size:12.5px;">${esc(text)}</div>`;
  } else {
    d.innerHTML =
      `<div class="avatar">${who === 'me' ? '我' : (S.persona.emoji || '🧑‍💼')}</div>` +
      `<div class="bubble">${esc(text)}${meta ? `<span class="sys-note">${meta}</span>` : ''}</div>`;
  }
  $('chatBody').appendChild(d);
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
  return d;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderQuick() {
  const st = currentStage(S);
  const map = {
    greet: ['您好老板，我是…', '不耽误您，就两分钟', '路过看您店里挺整齐'],
    probe: ['您这边主销什么价位？', '一个月能走多少箱？', '平时是送礼多还是自饮多？', '现在跟哪家供货商合作？'],
    present: ['这款酒最大的特点是…', '对您来说好处是…', '给您看个数据…'],
    policy: ['给您算笔账…', '供货价 XX，您卖 XX', '首单有政策，陈列费也有'],
    objection: ['您说得对，这个担心很正常', '我给您一个方案…', '周边有家店已经上了'],
    close: ['先拿两箱试试？', '卖不动我原价收回', '今天先定下来，我明天送'],
    follow: ['加个微信吧', '我下周再过来', '资料我留这儿']
  };
  $('quickRow').innerHTML = (map[st] || map.probe).map(q => `<button class="quick">${q}</button>`).join('');
  [...$('quickRow').children].forEach(b => {
    b.onclick = () => { $('input').value = b.textContent; $('input').focus(); };
  });
}

function updateSide() {
  $('vA').textContent = Math.round(S.attitude);
  $('vI').textContent = Math.round(S.interest);
  $('vT').textContent = Math.round(S.trust);
  $('bA').style.width = S.attitude + '%';
  $('bI').style.width = S.interest + '%';
  $('bT').style.width = S.trust + '%';
  $('turnTag').textContent = '第 ' + S.turn + ' / ' + S.maxTurns + ' 轮';

  $('coachText').textContent = coachText();

  const st = currentStage(S);
  const refMap = { greet: '开场', probe: '挖需', present: '塑造', policy: '算账', objection: '逼单', close: '逼单', follow: '逼单' };
  const want = refMap[st];
  $('refBox').innerHTML = S.product.refs.filter(r => r.t === want || (st === 'objection' && r.t === '逼单'))
    .concat(S.product.refs.filter(r => r.t !== want).slice(0, 1))
    .map(r => `<div class="ref-item"><span class="t">${r.t}</span><div class="s">${esc(r.s)}</div></div>`).join('')
    + `<div style="font-size:11.5px;color:var(--ink-3);margin-top:8px;line-height:1.6;">参考话术是模板，务必按${esc(S.persona.name)}的性格改写后再说——${esc((S.persona.tags || [])[0] || '他')}这类客户照搬会有反效果。</div>`;

  if (S.pending) {
    const o = OBJECTIONS[S.pending.id];
    $('objCard').style.display = '';
    $('objLabel').textContent = o.label;
    $('objText').textContent = S.pending.line;
    $('objTip').textContent = '应对思路：' + o.tip;
  } else {
    $('objCard').style.display = 'none';
  }
  renderQuick();
}

/* 教练面板该显示什么：大模型建议优先，否则离线把最近一轮标签翻成句子 */
function coachText() {
  if (S.exam) return nextBestAction(S);              // 考核模式不剧透
  if (mode === 'llm' && lastCoach) return lastCoach; // 大模型给的教练建议
  return offlineCoach(S);                            // 离线：句子级反馈
}

/* 离线模式：把最近一轮 evaluate 的标签翻译成一句人话教练点评（多变体 + 整场去重，避免复读） */
function offlineCoach(S) {
  const last = S.log[S.log.length - 1];
  if (!last) return nextBestAction(S);
  const V = {
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
  const tail = S._coachTail || [];
  const pick = (arr) => {
    let cand = arr.find(v => tail.indexOf(v) < 0);
    if (cand === undefined) {
      // 变体全在最近 4 句里：排除上一句（tail 末尾），保证不连续重复同一句
      const prev = tail[tail.length - 1];
      const pool = arr.filter(v => v !== prev);
      const src = pool.length ? pool : arr;
      cand = src[Math.floor(Math.random() * src.length)];
    }
    S._coachTail = tail.concat([cand]).slice(-4);
    return cand;
  };
  for (const t of (last.tags || [])) if (V[t]) return pick(V[t]);
  if (last.level === 'good') return pick(['这句说得好，保持这个节奏。', '这步走得漂亮，节奏继续。']);
  if (last.level === 'bad') return pick(['这句效果偏弱，看看是不是缺了认同/证据/方案。', '这轮偏弱，认同/证据/方案少了一环。']);
  return nextBestAction(S);
}

/* 移动端：侧栏 5 个 Tab 切换卡片，桌面端默认全部展示 */
function bindSideTabs() {
  const tabs = $('sideTabs');
  if (!tabs) return;
  const cards = Array.from(document.querySelectorAll('.side-card'));
  const activate = (tab) => {
    tabs.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    cards.forEach(c => c.classList.toggle('tab-active', c.dataset.tab === tab));
  };
  tabs.querySelectorAll('button').forEach(b => { b.onclick = () => activate(b.dataset.tab); });
  activate('status');
}

/* ---------------- 撤回上一句 ---------------- */
/* product / persona / mode 不能直接 JSON 化：persona.mines 里存的是 RegExp，
 * product.image 可能是上百 KB 的 dataURL。先浅拷贝剥离三者，只克隆纯数据部分，再原样挂回引用。 */
function snapshotState(s) {
  const keep = { product: s.product, persona: s.persona, mode: s.mode };
  const light = Object.assign({}, s);
  delete light.product; delete light.persona; delete light.mode;
  return Object.assign(JSON.parse(JSON.stringify(light)), keep);
}

function syncUndoBtn() {
  const b = $('btnUndo');
  if (!b) return;
  b.disabled = !undoStack.length || !!(S && S.exam) || sending;   // 考核模式 / 发送进行中 不允许撤回
}

function undoLastTurn() {
  if (sending) return;            // 发送进行中不允许撤回，否则会污染已还原的会话状态
  const u = undoStack.pop();
  if (!u) return;
  S = u.state;
  const body = $('chatBody');
  while (body.children.length > u.mark) body.removeChild(body.lastChild);
  lastCoach = '';
  $('input').disabled = false;
  $('btnSend').disabled = false;
  syncUndoBtn();
  updateSide();
  $('input').focus();
  toast('已撤回上一句，重新说一次');
}

/* ---------------- 发送 ---------------- */
async function send() {
  const ta = $('input');
  const text = ta.value.trim();
  if (!text || !S || S.finished) return;

  // 撤回点：记下本轮开始前的状态与聊天区节点数，回退时直接截断到这个位置
  sending = true;
  undoStack.push({ state: snapshotState(S), mark: $('chatBody').children.length });
  syncUndoBtn();

  ta.value = ''; ta.style.height = 'auto';

  bubble('me', text);
  $('btnSend').disabled = true;

  const typing = document.createElement('div');
  typing.className = 'msg';
  typing.innerHTML = `<div class="avatar">${esc(S.persona.emoji || '🧑‍💼')}</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`;
  $('chatBody').appendChild(typing);
  $('chatBody').scrollTop = $('chatBody').scrollHeight;

  try {
    if (mode === 'llm' && isLLMReady()) {
      await sendLLM(text, typing);
    } else {
      await new Promise(r => setTimeout(r, 520));
      sendRule(text, typing);
    }
  } catch (e) {
    const cors = /CORS|Failed to fetch|NetworkError|跨域|网络\/跨域/i.test(e.message);
    toast('大模型调用失败，已回退离线引擎。' + (cors ? '（疑似 CORS/网络限制，请用「node server.js」启动后访问 http://localhost:3000）' : e.message));
    sendRule(text, typing);
  } finally {
    sending = false;
    $('btnSend').disabled = false;
    $('input').focus();
    syncUndoBtn();              // 发送结束后恢复撤回可用性
  }
  if (S.finished) setTimeout(() => finish(), 700);
}

function paintEntry(entry, node) {
  const lv = { good: 'good', mid: 'mid', bad: 'bad' }[entry.level] || 'mid';
  const dl = entry.delta;
  // 考核模式下不给任何实时提示
  const meta = S.exam ? '' :
    `<span class="eval-chip ${lv}">${esc(entry.intentName)} +${entry.score}</span>` +
    (entry.tags || []).map(t => `<span class="eval-chip">${esc(t)}</span>`).join('') +
    `<span class="eval-chip">态度 ${dl.a >= 0 ? '+' : ''}${dl.a} · 意向 ${dl.i >= 0 ? '+' : ''}${dl.i} · 信任 ${dl.t >= 0 ? '+' : ''}${dl.t}</span>`;
  node.outerHTML = `<div class="msg"><div class="avatar">${esc(S.persona.emoji || '🧑‍💼')}</div><div class="bubble">${esc(entry.buyer)}${meta ? `<span class="sys-note">${meta}</span>` : ''}</div></div>`;
  $('chatBody').scrollTop = $('chatBody').scrollHeight;
}

function sendRule(text, typing) {
  const entry = step(text, S);
  if (!entry) return;
  paintEntry(entry, typing);
  if (S.finished && S.closingLine) {
    setTimeout(() => bubble('buyer', S.closingLine), 500);
  }
  updateSide();
}

async function sendLLM(text, typing) {
  const cfg = currentLLMCfg();
  if (!isLLMReady()) throw new Error('请填写激活令牌（或开发者 Key）');

  let r;
  try {
    // 流式：先把手写占位换成客户气泡，再边收边把台词打上去（打字机效果）
    const bubble = makeBuyerBubble(typing);
    r = await llmStepStream(text, S, cfg, partial => {
      bubble.textContent = partial || '（思考中…）';
      $('chatBody').scrollTop = $('chatBody').scrollHeight;
    });
  } catch (e) {
    // 流式失败（服务商不支持 / 网络抖动）→ 回退普通模式
    r = await llmStep(text, S, cfg);
  }
  lastCoach = (r && r.coach) ? r.coach : '';
  applyLLMResult(r, typing, text);
}

/* ---------------- AI 示范回答：生成业务员下一句并自动代发 ---------------- */
/* 让大模型扮「业务员」，根据当前对话生成一句示范台词（纯文本，非 JSON） */
async function generateSalesLine(S, cfg) {
  const p = S.product, persona = S.persona, m = (MODES && MODES[S.mode]) || (MODES && MODES.full);
  const transcript = S.log.map(e => '[业务员] ' + e.seller + '\n[客户] ' + e.buyer).join('\n');
  const lastBuyer = S.log.length ? S.log[S.log.length - 1].buyer : '（还没有开场）';
  const system = `你是一名资深的白酒/酒水地推业务员教练。下面是一场终端拜访演练：你扮演业务员，对手是由 AI 扮演的门店老板（客户）。
产品背景：
- 品名：${p.name}（${p.category}），${p.spec}
- 供货价 ${p.cost} 元，建议零售价 ${p.retail} 元，${p.margin}
- 政策：${p.policies.join('；')}
客户画像：
- 姓名 ${persona.name}，${persona.age} 岁，${persona.title}
- 场景：${persona.scene}
- 真正在意的：${persona.motive}
- 吃这一套：${persona.likes.join('、')}
当前训练模式：${m ? m.name : ''}（${m ? m.desc : ''}）
${lastCoach ? '上一轮教练建议：' + lastCoach : ''}

规则：
1. 只写【业务员】接下来要说的一句话，第一人称、口语化、1-2 句、具体可操作。
2. 必须针对客户刚说的话，不要泛泛而谈。
3. 只输出这句话本身，不要解释、不要加引号、不要写「业务员：」前缀、不要 Markdown。`;
  const user = `最近一段对话：\n${transcript}\n客户刚说：「${lastBuyer}」\n请写出业务员下一句：`;
  const line = await llmChatText(system, user, cfg);
  return line && line.length > 1 ? line : '';
}

/* ---------------- 完整演示模式：3 轮 AI 业务员 × AI 客户自动对话 ---------------- */
/* 设计要点：
 *  - 复用 aiDemoReply 的"生成业务员台词→回填输入框→send()"路径，避免重写 send 管线
 *  - 演示中按钮变"⏸ 我接手(进度)"，可随时打断；输入框锁定、Send 锁定，避免用户介入污染演示
 *  - 任一环节报错立刻退出（toast 提示），不让半截状态留在 UI 上
 *  - 演完/接手都解锁 UI、按当前可发状态恢复按钮文案*/
async function aiDemoFull() {
  if (!S || S.finished) return;
  if (mode !== 'llm' || !isLLMReady()) {
    toast('完整演示需开启大模型模式并填写令牌');
    return;
  }
  if (sending || demoState) return;
  demoState = { round: 0, maxRound: 3, abort: false };
  syncDemoBtn();
  lockDemoUI(true);
  toast('🎬 演示开始：3 轮 AI 对 AI 自动跑，可点「我接手」随时退出');
  return demoRunOneRound();
}

async function demoRunOneRound() {
  if (!demoState) return;
  if (demoState.abort) return demoFinish('已接管，演示结束');
  if (demoState.round >= demoState.maxRound) return demoFinish('✅ 演示完成');
  demoState.round++;
  syncDemoBtn();
  const cfg = currentLLMCfg();
  try {
    const line = await generateSalesLine(S, cfg);
    if (demoState.abort) return demoFinish('已接管，演示结束');
    if (!line) throw new Error('业务员台词为空');
    // 演示模式专属标识：send() 走完后让 UI 把这条标成"AI 演示"气泡
    $('input').value = line;
    $('input').dataset.demo = '1';
    await send();
    $('input').dataset.demo = '';
    if (demoState.abort) return demoFinish('已接管，演示结束');
    if (S && S.finished) return demoFinish('客户已结束对话，演示终止');
    // 稍等让用户看清这一轮气泡与教练点评
    await new Promise(r => setTimeout(r, 400));
    if (demoState.abort) return demoFinish('已接管，演示结束');
    return demoRunOneRound();
  } catch (e) {
    toast('演示中断：' + (e && e.message ? e.message : e));
    return demoFinish('演示中断');
  }
}

function demoTakeOver() {
  if (!demoState) return;
  demoState.abort = true;
  // 让正在 await send() / 400ms 等待的那一拍醒来后走 demoFinish
}

function demoFinish(msg) {
  demoState = null;
  $('input').dataset.demo = '';
  lockDemoUI(false);
  syncDemoBtn();
  if (msg) setTimeout(() => toast(msg), 50);
}

/* 同步「完整演示」按钮状态：演示中显示"⏸ 我接手(进度)"且永远可点；
 * 空闲时按"模式/Key/Session"启用状态切文案（由 init() 与 key 输入触发同步）。*/
function syncDemoBtn() {
  const b = $('btnDemo');
  if (!b) return;
  if (demoState) {
    b.disabled = false;
    b.textContent = '⏸ 我接手 (' + demoState.round + '/' + demoState.maxRound + ')';
    b.classList.add('taking');
    b.title = '点此随时接管，退出演示';
    return;
  }
  b.classList.remove('taking');
  const hasKey = mode === 'llm' && isLLMReady();
  if (S && S.exam) {
    // 考核模式：不提供演示，让用户独立完成以测真实水平
    b.textContent = '🎬 完整演示(考核禁用)';
    b.disabled = true;
    b.title = '考核模式不提供演示，请独立完成';
    return;
  }
  if (!S) {
    // 硬性不可用：连会话都还没开始
    b.textContent = '🎬 完整演示(3轮)';
    b.disabled = true;
    b.title = '先选产品+客户，点「开始对话」后再演示';
  } else if (!hasKey) {
    // 硬性不可用：没开大模型模式或没填 Key
    b.textContent = '🎬 完整演示(3轮)';
    b.disabled = true;
    b.title = mode !== 'llm' ? '需切到「大模型模式」' : '需填写激活令牌或 Key';
  } else if (S.finished) {
    // 会话已结束：保持可点，点击会先开新会话再演示（不再死灰）
    b.textContent = '🎬 完整演示(新会话)';
    b.disabled = false;
    b.title = '当前会话已结束，点击将重新开始并演示';
  } else {
    b.textContent = '🎬 完整演示(3轮)';
    b.disabled = false;
    b.title = '';
  }
}

/* 演示中锁定/解锁输入区 UI。Send 也锁，避免用户想"我也发一句"导致演示轮与用户轮交叉。*/
function lockDemoUI(locked) {
  const ta = $('input'), snd = $('btnSend');
  if (ta) ta.disabled = !!locked;
  if (snd) snd.disabled = !!locked;
}

/* 把 typing 占位节点换成真正的客户气泡，返回可更新文字的节点 */
function makeBuyerBubble(typing) {
  typing.className = 'msg';
  typing.innerHTML = `<div class="avatar">${esc(S.persona.emoji || '🧑‍💼')}</div><div class="bubble"></div>`;
  return typing.querySelector('.bubble');
}

/* 流式 / 非流式共用：把模型结果落到会话状态并渲染最终气泡 */
function applyLLMResult(r, node, text) {
  const intent = r.intent || 'other';
  const score = Number(r.score) || 0;
  const before = { a: S.attitude, i: S.interest, t: S.trust };
  const tags = (r.tags || []).slice();
  bumpScores(intent, score);

  S.attitude = clamp(Number(r.attitude) || S.attitude, 0, 100);
  S.interest = clamp(Number(r.interest) || S.interest, 0, 100);
  S.trust = clamp(Number(r.trust) || S.trust, 0, 100);

  // 大模型不一定自己判雷，用离线雷区做一道旁路：只扣分 + 打标签，不覆盖它的台词（保留表演）
  const mines = detectMines(text, S);
  if (mines.length) {
    const m = mines[0];
    const d = DIFFICULTIES[S.difficulty] || DIFFICULTIES.normal;
    S.mines.push({ turn: S.turn + 1, type: m.type, text });
    S.attitude = clamp(S.attitude - 26 * (1 / d.tolerance), 0, 100);
    S.trust = clamp(S.trust - 22 * (1 / d.tolerance), 0, 100);
    S.interest = clamp(S.interest - 10, 0, 100);
    tags.push(m.type === 'attack' ? '诋毁竞品' : m.type === 'overPromise' ? '过度承诺' : '触碰客户禁忌');
  }

  // 与离线 step() 对齐：判为异议处理时先记「已化解」再决定是否挂新异议，
  // 否则复盘里「抛了 N 个 / 化解 M 个」在 LLM 局永远算不出来（entry 缺 objection 字段）
  if (S.pending && intent === 'objection') {
    if (r.level === 'good' || (r.level === 'mid' && Math.random() < 0.5)) {
      S.handled.push(S.pending.id);
      tags.push('异议已化解');
    }
    S.pending = null;
  }
  if (r.objection && OBJECTIONS[r.objection]) S.pending = { id: r.objection, line: OBJECTIONS[r.objection].lines[0] };

  const entry = {
    turn: S.turn + 1, seller: text, buyer: r.reply, intent,
    intentName: INTENT_NAMES[intent] || '其他',
    score: Math.round(score * 10) / 10,
    level: r.level || 'mid', tags,
    objection: (r.objection && OBJECTIONS[r.objection]) ? r.objection : null,
    delta: {
      a: Math.round(S.attitude - before.a),
      i: Math.round(S.interest - before.i),
      t: Math.round(S.trust - before.t)
    }
  };
  S.log.push(entry);
  S.turn++;
  S.lastReply = r.reply;
  if (r.coach && !S.exam) entry.tags.push('教练：' + r.coach);
  paintEntry(entry, node);

  if (r.finished || S.turn >= S.maxTurns) {
    // 与离线 / 手动结束共用同一套门槛（原先这里写死 interest>=60）
    const j = judgeResult(S, intent === 'close', true);
    S.finished = true;
    S.result = r.result || j.result;                 // 模型显式给了结局时优先采纳
    S.closingLine = S.result === 'deal' ? '（点头）行，那就按你说的先来一点试试。'
      : S.result === 'warm' ? '（犹豫）我再想想，你把资料留这儿。'
        : '（摇头）今天就这样吧。';
    setTimeout(() => bubble('buyer', S.closingLine), 500);
  }
  updateSide();
}

function bumpScores(intent, score) {
  S.covered[intent] = (S.covered[intent] || 0) + 1;
  const rep = S.covered[intent];
  const isDrill = !!(S.mode && S.mode.dims);
  const decay = isDrill ? Math.max(0.45, 1 - (rep - 1) * 0.12)
    : (rep === 1 ? 1 : rep === 2 ? 0.55 : rep === 3 ? 0.3 : 0.12);
  S.scores[intent] = (S.scores[intent] || 0) + score * decay;
  intent === 'probe' && (S.flags.probed = true);
  intent === 'present' && (S.flags.presented = true);
  intent === 'policy' && (S.flags.policied = true);
  intent === 'greet' && (S.flags.greeted = true);
}

/* ---------------- 复盘 ---------------- */
function finish() {
  if (!S || !S.log.length) { toast('先跟客户说两句话再复盘吧'); return; }
  if (!S.finished) {
    // 与自动结束共用 judgeResult：原来这里写死 interest>=50，会漏掉难度门槛、信任门槛和 deal
    const last = S.log[S.log.length - 1];
    const triedClose = !!last && (last.intent === 'close' || (last.secondary || []).indexOf('close') >= 0);
    S.finished = true;
    S.result = judgeResult(S, triedClose, true).result;
  }
  lastReview = review(S);
  saveHistory(lastReview);
  renderReport(lastReview);
  go('screenReport');
  syncDemoBtn();   // 会话已结束，刷新演示按钮为「新会话」可点状态
}

function saveHistory(R) {
  const dur = S.startTs ? Date.now() - S.startTs : 0;
  const uid = Store.currentUid() || (Store.users()[0] || {}).id || '';
  const msgs = S.log.filter(l => l.seller).length;
  Store.saveRecord({
    ts: Date.now(),
    date: new Date().toISOString().slice(0, 10),
    uid,                                            // 归属当前成员（隐私：仅记录归属，不存对话）
    product: S.product.id, productName: S.product.name,
    persona: S.persona.id, personaName: S.persona.name,
    difficulty: S.difficulty, difficultyName: DIFFICULTIES[S.difficulty].name,
    mode: S.mode.id, modeName: S.mode.name,
    exam: !!S.exam,
    total: R.total, grade: R.grade, result: S.result,
    turns: S.turn, msgs, mines: S.mines.length, dims: R.dims, durationMs: dur
  });
  // 自动积分：每局 +5，S 级 +10，成交再 +3
  if (uid) {
    let pts = 5;
    if (R.grade === 'S') pts += 10;
    if (S.result === 'deal') pts += 3;
    Store.addPoints(uid, pts);
  }
}

function renderReport(R) {
  $('rTotal').textContent = R.total;
  const g = $('rGrade');
  g.textContent = R.grade;
  g.className = 'grade g-' + R.grade;
  $('rResult').className = 'result-line ' + ({ deal: 'deal', warm: 'warm', reject: 'reject' }[S.result] || 'reject');
  $('rResult').textContent = R.resultText;

  const active = (S.mode && S.mode.dims)
    ? DIMENSIONS.filter(d => S.mode.dims.indexOf(d.id) >= 0) : DIMENSIONS;
  $('rDims').innerHTML = active.map(d => {
    const v = R.dims[d.id] || 0;
    return `<div class="dim-item">
      <span class="nm">${d.name}</span>
      <span class="bar i"><i style="width:${Math.round(v / d.max * 100)}%"></i></span>
      <span class="vl">${v}/${d.max}</span>
    </div>`;
  }).join('');

  const need = dealNeed(S);
  $('rStats').innerHTML =
    `客户最终状态：态度 <b>${Math.round(S.attitude)}</b> · 进货意向 <b>${Math.round(S.interest)}</b> · 信任 <b>${Math.round(S.trust)}</b>`
    + `<span class="hint">　（${DIFFICULTIES[S.difficulty].name}下，意向需到 ${need} 且信任过 45，客户才会真正下单；`
    + `分数评的是你的话术质量，结局评的是客户的决策，两者可能不一致）</span>`;

  $('rStrengths').innerHTML = R.strengths.length
    ? R.strengths.map(s => `<div class="kv"><b>${s.name}</b><span>${esc(s.text)}</span></div>`).join('')
    : '<div class="kv" style="color:var(--ink-3)">本轮没有明显得分项，建议先照着参考话术完整走一遍流程。</div>';

  $('rImproves').innerHTML = R.improves.length
    ? R.improves.map(s => `<div class="kv"><b>${s.name}</b><span>${esc(s.text)}</span></div>`).join('')
    : '<div class="kv" style="color:var(--green)">各维度均已达标，换更高难度试试。</div>';

  $('rNotes').innerHTML = R.notes.length
    ? R.notes.map(n => `<div class="note-li">${esc(n)}</div>`).join('')
    : '<div class="note-li" style="color:var(--green)">流程完整、无明显失误，可以挑战更高难度。</div>';

  // 考核模式：展示大模型生成的标准答案（供学员对照参考、引发自行思考）
  const ma = S.modelApproach;
  const wrap = $('rModelWrap'), box = $('rModel');
  if (S.exam && ma && typeof ma === 'object') {
    const items = [
      ['开场', ma.greet], ['挖需', ma.probe], ['塑造', ma.present],
      ['算账', ma.policy], ['逼单', ma.close], ['处理异议', ma.antiObjection]
    ].filter(x => x[1]);
    box.innerHTML = items.map(([k, v]) =>
      `<div class="ma-item"><span class="ma-k">${k}</span><div class="ma-s">${esc(v)}</div></div>`).join('')
      + `<div class="ma-tip">标准答案不是唯一正确答案。请对照你每一阶段的回应，想想差距在哪、下次怎么改。</div>`;
    wrap.style.display = '';
    wrap.open = true;
  } else {
    wrap.style.display = 'none';
  }

  drawRadarOn($('radar'), R.dims, active);

  $('rTurns').innerHTML = S.log.map(l => {
    const lv = { good: 'good', mid: 'mid', bad: 'bad' }[l.level] || 'mid';
    return `<div class="turn-item">
      <div class="th">
        <span class="tn">第 ${l.turn} 轮</span>
        <span class="eval-chip ${lv}">${esc(l.intentName)} +${l.score}</span>
        ${(l.tags || []).map(t => `<span class="eval-chip">${esc(t)}</span>`).join('')}
      </div>
      <div class="q"><b>你说：</b>${esc(l.seller)}</div>
      <div class="a"><b>客户：</b>${esc(l.buyer)}</div>
    </div>`;
  }).join('');
}

/* ---------------- 成长页 ---------------- */
function renderGrowth() {
  const me = Store.currentUser();
  const st = Store.stats(me ? me.id : '');
  renderMyPanel();             // 积分 / 徽章（与是否有历史无关）
  if (me) {                   // 本周练习概览（环比上周）
    const wk = myWeek(me.id);
    $('gWeek').innerHTML = `
      <div class="my-week">
        <div class="mw-num">${wk.tw}</div>
        <div class="mw-lbl">本周练习次数 · 环比 <b class="${wk.growth >= 0 ? 'up' : 'down'}">${wk.growth >= 0 ? '▲' : '▼'} ${Math.abs(wk.growth)}%</b></div>
        <div class="muted">上周 ${wk.lw} 局 · 多练几次比上周更顺手</div>
      </div>`;
  }
  if (!st) {
    $('gCards').innerHTML = '';
    $('gCharts').style.display = 'none';
    $('gPersona').innerHTML = '<div style="color:var(--ink-3);font-size:13px;">还没有练习记录，先去练一局吧。</div>';
    $('gList').innerHTML = '';
    return;
  }
  $('gCharts').style.display = '';

  const dealRate = Math.round(st.deals / st.count * 100);
  const cards = [
    { k: '练习次数', v: st.count, s: '共 ' + st.count + ' 局' },
    { k: '平均得分', v: st.avg, s: st.recentAvg !== null && st.olderAvg !== null
      ? (st.recentAvg >= st.olderAvg ? '近 5 局 ↑ ' + (st.recentAvg - st.olderAvg) : '近 5 局 ↓ ' + (st.olderAvg - st.recentAvg)) : '再练几局看趋势' },
    { k: '最佳成绩', v: st.best, s: '历史最高' },
    { k: '成交率', v: dealRate + '<small>%</small>', s: st.deals + ' / ' + st.count + ' 局拿下' },
    { k: '累计踩雷', v: st.mines, s: st.mines === 0 ? '一次没踩，漂亮' : '越少越好' }
  ];
  // 注：「本周练习次数」由左侧 gWeek 面板专门展示（含上周对比与环比），此处不再重复出卡
  $('gCards').innerHTML = cards.map(c => `<div class="stat-card"><div class="k">${c.k}</div><div class="v">${c.v}</div><div class="s">${c.s}</div></div>`).join('');

  drawTrend($('trendChart'), st.trend);
  drawRadarOn($('avgRadar'), st.dimAvg, DIMENSIONS);

  const delta = (st.recentAvg !== null && st.olderAvg !== null) ? st.recentAvg - st.olderAvg : null;
  $('trendNote').innerHTML = delta === null
    ? '再练几局就会出现进步对比'
    : (delta > 0 ? `近 5 局平均 <b>${st.recentAvg}</b>，比之前 <b>+${delta}</b> 分，在进步`
      : delta < 0 ? `近 5 局平均 <b class="down">${st.recentAvg}</b>，比之前 <b class="down">${delta}</b> 分，注意回看复盘`
        : '近 5 局与之前持平，试试换更高难度');

  const max = Math.max(...st.personaList.map(p => p.avg), 1);
  $('gPersona').innerHTML = st.personaList.map((p, i) => `
    <div class="g-row${i === 0 && st.personaList.length > 1 ? ' weak' : ''}">
      <span class="nm">${esc(p.name)}<span class="sub"><br>${p.n} 局</span></span>
      <span class="bar i"><i style="width:${Math.round(p.avg / max * 100)}%"></i></span>
      <span class="vl">${p.avg}</span>
    </div>`).join('');

  const h = Store.loadHistory();
  $('gList').innerHTML = h.map(r => `
    <div class="rec-row">
      <span class="d">${r.date}</span>
      <span class="who">${esc(r.personaName)}</span>
      <span class="tag">${esc(r.modeName || '完整拜访')}</span>
      <span class="tag">${esc(r.difficultyName || '')}</span>
      ${r.exam ? '<span class="tag warn">考核</span>' : ''}
      <span class="tag">${r.turns} 轮</span>
      <span class="sc ${r.grade}">${r.total} ${r.grade}</span>
      <span class="tag ${{ deal: 'ok', warm: '', reject: 'warn' }[r.result] || ''}">${{ deal: '成交', warm: '留意向', reject: '被拒' }[r.result] || ''}</span>
    </div>`).join('');
}

function clearHistory() {
  if (!confirm('确定清空全部练习记录吗？删除后无法恢复。')) return;
  Store.clearHistory();
  renderGrowth();
  toast('已清空练习记录');
}

/* ---------------- 图表 ---------------- */
function drawRadarOn(cv, dims, list) {
  const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
  if (!ctx) return;
  const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2;
  const scale = W / 360;                       // 支持不同尺寸的画布
  const R = W / 2 - 62 * scale;
  const n = list.length;
  if (n < 3) return;
  ctx.clearRect(0, 0, W, H);

  for (let g = 4; g >= 1; g--) {
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / n;
      const r = R * g / 4;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = g % 2 ? '#faf7f3' : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = '#ece6dd'; ctx.lineWidth = 2 * scale; ctx.stroke();
  }
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    ctx.beginPath(); ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    ctx.strokeStyle = '#ece6dd'; ctx.lineWidth = 2 * scale; ctx.stroke();
  }

  const pts = [];
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const d = list[i];
    const v = clamp((dims[d.id] || 0) / d.max, 0, 1);
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    const r = R * Math.max(0.04, v);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    pts.push([x, y]);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(155,44,44,.16)';
  ctx.fill();
  ctx.strokeStyle = '#9b2c2c'; ctx.lineWidth = 3 * scale; ctx.stroke();
  pts.forEach(p => {
    ctx.beginPath(); ctx.arc(p[0], p[1], 4 * scale, 0, Math.PI * 2);
    ctx.fillStyle = '#9b2c2c'; ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * scale; ctx.stroke();
  });

  ctx.font = `600 ${Math.round(19 * scale)}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
  ctx.fillStyle = '#5d564f';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / n;
    const x = cx + Math.cos(a) * (R + 30 * scale), y = cy + Math.sin(a) * (R + 30 * scale);
    ctx.fillText(list[i].name, x, y);
  }
}

function drawTrend(cv, pts) {
  const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
  if (!ctx || !pts.length) return;
  const W = cv.width, H = cv.height;
  const padL = 70, padR = 30, padT = 46, padB = 64;
  const w = W - padL - padR, h = H - padT - padB;
  ctx.clearRect(0, 0, W, H);

  // 背景网格与刻度
  ctx.font = '500 20px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = '#a49c92'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  [0, 25, 50, 75, 100].forEach(v => {
    const y = padT + h - (v / 100) * h;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y);
    ctx.strokeStyle = v === 0 ? '#ddd6cb' : '#f0ebe3'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillText(String(v), padL - 14, y);
  });
  // 60 分及格参考线
  const y60 = padT + h - 0.6 * h;
  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.beginPath(); ctx.moveTo(padL, y60); ctx.lineTo(W - padR, y60);
  ctx.strokeStyle = '#e3c9c4'; ctx.lineWidth = 2; ctx.stroke();
  ctx.restore();
  ctx.fillStyle = '#c0a09a'; ctx.textAlign = 'left';
  ctx.fillText('60 分', padL + 6, y60 - 14);

  const n = pts.length;
  const X = i => n === 1 ? padL + w / 2 : padL + (i / (n - 1)) * w;
  const Y = v => padT + h - (clamp(v, 0, 100) / 100) * h;

  // 面积
  ctx.beginPath();
  pts.forEach((p, i) => { const x = X(i), y = Y(p.total); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  if (n > 1) {
    ctx.lineTo(X(n - 1), padT + h); ctx.lineTo(X(0), padT + h); ctx.closePath();
    const grd = ctx.createLinearGradient(0, padT, 0, padT + h);
    grd.addColorStop(0, 'rgba(155,44,44,.16)');
    grd.addColorStop(1, 'rgba(155,44,44,.02)');
    ctx.fillStyle = grd; ctx.fill();
  }
  // 折线
  ctx.beginPath();
  pts.forEach((p, i) => { const x = X(i), y = Y(p.total); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#9b2c2c'; ctx.lineWidth = 4; ctx.lineJoin = 'round'; ctx.stroke();

  // 点与数值
  pts.forEach((p, i) => {
    const x = X(i), y = Y(p.total);
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill();
    ctx.strokeStyle = '#9b2c2c'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#6b6560'; ctx.font = '600 19px -apple-system, "PingFang SC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillText(String(p.total), x, y - 14);
    // x 轴标签：客户 + 日期
    ctx.font = '500 17px -apple-system, "PingFang SC", sans-serif';
    ctx.fillStyle = '#a49c92'; ctx.textBaseline = 'top';
    const lab = n <= 8 ? `${p.persona}\n${p.date.slice(5)}` : p.date.slice(5);
    lab.split('\n').forEach((line, li) => {
      ctx.fillText(line, x, padT + h + 12 + li * 20);
    });
  });
}

/* ---------------- 导出 ---------------- */
function exportReport() {
  if (!lastReview) return;
  const R = lastReview, p = S.product, pe = S.persona;
  const L = [];
  L.push('# 酒水地推话术陪练 · 复盘报告', '');
  L.push('- 产品：' + p.name + '（' + p.category + '）');
  L.push('- 客户：' + pe.name + ' · ' + pe.title);
  L.push('- 难度：' + DIFFICULTIES[S.difficulty].name + '　模式：' + S.mode.name + (S.exam ? '（考核）' : ''));
  L.push('- 结果：' + R.resultText);
  L.push('- 总分：' + R.total + ' / 100（' + R.grade + ' 级）', '');
  L.push('## 维度得分');
  ((S.mode && S.mode.dims) ? DIMENSIONS.filter(d => S.mode.dims.indexOf(d.id) >= 0) : DIMENSIONS)
    .forEach(d => L.push('- ' + d.name + '：' + (R.dims[d.id] || 0) + ' / ' + d.max));
  L.push('');
  L.push('## 做得好的地方');
  R.strengths.forEach(s => L.push('- ' + s.name + '：' + s.text));
  L.push('');
  L.push('## 优先改进项');
  R.improves.forEach(s => L.push('- ' + s.name + '：' + s.text));
  L.push('');
  L.push('## 关键问题诊断');
  (R.notes.length ? R.notes : ['无明显失误']).forEach(n => L.push('- ' + n));
  L.push('');
  L.push('## 逐轮记录');
  S.log.forEach(l => {
    L.push('### 第 ' + l.turn + ' 轮 · ' + l.intentName + '（+' + l.score + '）');
    L.push('- 销售：' + l.seller);
    L.push('- 客户：' + l.buyer.replace(/\n/g, ' / '));
    if (l.tags && l.tags.length) L.push('- 标签：' + l.tags.join('、'));
    L.push('');
  });

  const blob = new Blob([L.join('\n')], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = '地推话术复盘_' + pe.name + '_' + new Date().toISOString().slice(0, 10) + '.md';
  a.click();
  toast('复盘报告已导出');
}

/* ---------------- toast ---------------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ============================================================
 *  身份（同级成员）/ 练习记录 / 统计 / 积分
 * ============================================================ */

/* ---------------- 主界面 / 客户名单 ---------------- */
function goCustomers() {
  $('custSearch').value = '';
  renderCustomers();
  go('screenCustomers');
}

function renderCustomers() {
  const list = allPersonas();
  const q = ($('custSearch').value || '').trim().toLowerCase();
  const kw = p => (p.name + ' ' + (p.title || '') + ' ' + (p.tags || []).join(' ') + ' ' + (p.scene || '') + ' ' + ((PERSONA_TIERS[p.tier] || {}).name || '')).toLowerCase();
  let filtered = q ? list.filter(p => kw(p).includes(q)) : list.slice();
  if (custTier !== 'all') filtered = filtered.filter(p => p.tier === custTier);

  $('custList').innerHTML = (filtered.length ? filtered.map(p => {
    const tier = PERSONA_TIERS[p.tier] || PERSONA_TIERS.mid;
    return `
    <div class="sel-card" data-k="${esc(p.id)}">
      <div class="sel-head">
        <span class="sel-emoji">${esc(p.emoji || '🧑‍💼')}</span>
        <div>
          <div class="sel-name">${esc(p.name)} · ${esc(p.title)}</div>
          <div class="sel-meta">${esc(p.scene || '')}</div>
        </div>
      </div>
      <p class="sel-desc">${esc(p.motive || '')}</p>
      <div class="tag-row">
        <span class="tag tier tier-${p.tier}">${esc(tier.name)}</span>
        ${(p.tags || []).slice(0, 3).map(t => `<span class="tag">${esc(t)}</span>`).join('')}
        ${p.custom ? '<span class="tag warn">自定义</span>' : ''}
      </div>
    </div>`;
  }).join('') : '<div class="search-empty">没有匹配的客户，换个关键词或档位试试。</div>') + `
    <div class="add-card" id="addCustomer">
      <span class="plus">＋</span>
      <span class="txt">新建客户</span>
    </div>`;

  $('custList').querySelectorAll('.sel-card').forEach(c => c.onclick = () => {
    sel.persona = c.dataset.k;
    keepSelection();
    goProducts();            // 选完客户 → 进入产品页（产品单独一屏，不再挤在配置页）
  });
  const add = $('addCustomer');
  if (add) add.onclick = () => openEditor('persona');
}

/* ---------------- 成员切换（无身份选择界面，全员同级） ---------------- */
function ensureCurrent() {
  if (Store.currentUser()) return;          // 已选定则不动
  const first = Store.users()[0];           // 首次使用自动取第一个成员作为当前练习者
  if (first) Store.setCurrent(first.id);
}

function refreshMemberSwitch() {
  const sw = $('memberSwitch');
  if (!sw) return;
  const cur = Store.currentUid();
  sw.innerHTML = Store.users().map(u =>
    `<option value="${u.id}"${u.id === cur ? ' selected' : ''}>${esc(u.emoji || '🧑')} ${esc(u.name)}</option>`
  ).join('') + `<option value="__add__">＋ 新增成员</option>`;
}

function bindMemberSwitch() {
  const sw = $('memberSwitch');
  if (!sw) return;
  refreshMemberSwitch();
  sw.onchange = () => {
    const v = sw.value;
    if (v === '__add__') {
      let name = null;
      try { if (window.prompt) name = window.prompt('新成员姓名（仅用于本机练习统计，不保存任何对话原文）：'); } catch (e) {}
      name = (name || '').trim();
      if (name) {
        const id = 'u_m' + Date.now();
        Store.addUser({ id, name, emoji: '🧑‍💼', points: 0, badges: [], createdAt: Date.now() });
        Store.setCurrent(id);
        toast('已添加成员：' + name);
      }
      refreshMemberSwitch();
    } else if (v) {
      Store.setCurrent(v);
      const u = Store.currentUser();
      toast('已切换到：' + (u ? u.name : ''));
      if ($('screenGrowth').classList.contains('on')) renderGrowth();
    }
  };
}


/* ---------------- 员工：积分 / 徽章 / 任务 ---------------- */
function myWeek(uid) {
  const h = Store.loadHistory();
  const ws = weekStartTs(new Date());
  const lws = ws - 7 * 864e5;
  const tw = h.filter(r => r.uid === uid && r.ts >= ws).length;
  const lw = h.filter(r => r.uid === uid && r.ts >= lws && r.ts < ws).length;
  const growth = lw > 0 ? Math.round((tw - lw) / lw * 100) : (tw > 0 ? 100 : 0);
  return { tw, lw, growth };
}

function renderMyPanel() {
  const me = Store.currentUser();
  const box = $('gPoints');
  if (!me) { box.innerHTML = ''; return; }
  const badges = Store.userBadges(me.id);
  box.innerHTML = `
    <div class="my-points">
      <span class="mp-num">${me.points || 0}</span><span class="mp-lbl">积分</span>
      ${me.likes ? `<span class="mp-like">👍 ${me.likes} 次认可</span>` : ''}
    </div>
    <div class="my-badges">${badges.length
      ? badges.map(b => `<span class="badge" title="${b.n}">${b.e} ${b.n}</span>`).join('')
      : '<span class="muted">完成练习即可解锁徽章</span>'}</div>
    <div class="muted" style="margin-top:6px">积分由系统按练习自动累计，和小伙伴多练多刷分。</div>`;
}

/* ---------------- 通用折线图（全员活跃趋势） ---------------- */
function drawLineChart(cv, pts) {
  const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
  if (!ctx || !pts.length) return;
  const W = cv.width, H = cv.height, padL = 44, padR = 16, padT = 18, padB = 30;
  const w = W - padL - padR, h = H - padT - padB;
  ctx.clearRect(0, 0, W, H);
  const maxY = Math.max(1, ...pts.map(p => p.y));
  ctx.font = '500 13px -apple-system, "PingFang SC", sans-serif';
  ctx.fillStyle = '#a49c92'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  [0, maxY].forEach(v => {
    const y = padT + h - (v / maxY) * h;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y);
    ctx.strokeStyle = '#ece5dc'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillText(String(v), padL - 8, y);
  });
  const n = pts.length;
  const X = i => n === 1 ? padL + w / 2 : padL + (i / (n - 1)) * w;
  const Y = v => padT + h - (v / maxY) * h;
  if (n > 1) {
    ctx.beginPath();
    pts.forEach((p, i) => { const x = X(i), y = Y(p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.lineTo(X(n - 1), padT + h); ctx.lineTo(X(0), padT + h); ctx.closePath();
    const g = ctx.createLinearGradient(0, padT, 0, padT + h);
    g.addColorStop(0, 'rgba(155,44,44,.18)'); g.addColorStop(1, 'rgba(155,44,44,.02)');
    ctx.fillStyle = g; ctx.fill();
  }
  ctx.beginPath();
  pts.forEach((p, i) => { const x = X(i), y = Y(p.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.strokeStyle = '#9b2c2c'; ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.stroke();
  pts.forEach((p, i) => {
    const x = X(i), y = Y(p.y);
    ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#9b2c2c'; ctx.lineWidth = 2.5; ctx.stroke();
    if (i % 2 === 0 || n <= 8) {
      ctx.fillStyle = '#a49c92'; ctx.font = '500 11px sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(p.x, x, padT + h + 8);
    }
  });
}

init();
