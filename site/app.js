// 카페·베이커리 입지 분석 — 화면 로직. 데이터는 data.js(window.DATA)에서 읽는다.
const D = window.DATA;
const $ = (id) => document.getElementById(id);
const won = (v) => (Math.abs(v) >= 1e8 ? (v / 1e8).toFixed(2) + '억' : Math.round(v / 1e4).toLocaleString() + '만');
const pct = (v, d = 1) => (v >= 0 ? '+' : '') + (v * 100).toFixed(d) + '%';
const val = (name) => document.querySelector(`input[name=${name}]:checked`).value;
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const KIND = { coffee: '카페', bakery: '베이커리', blend: '베이커리 카페' };

// ── 가정치 (모두 편집 가능, 화면에 '가정' 표시) ──
const PRESET = { // 평수, 인테리어(평당), 설비(업종별), 규모 보정(평균 점포 대비 매출), 직원 수
  take: { py: 10, intr: 150e4, eq: { coffee: 3000e4, bakery: 6000e4, blend: 6000e4 }, scale: 0.7, staff: 1 },
  seat: { py: 30, intr: 250e4, eq: { coffee: 4000e4, bakery: 8000e4, blend: 8000e4 }, scale: 1.0, staff: 3 },
  big: { py: 100, intr: 400e4, eq: { coffee: 1e8, bakery: 2e8, blend: 2e8 }, scale: 4.0, staff: 10 },
};
// 자치구별 1층 평당 월 임대료(원) — 한국부동산원 임대동향 수준을 참고한 가정치
const RENT = { 강남구: 28e4, 서초구: 22e4, 중구: 24e4, 종로구: 20e4, 마포구: 18e4, 용산구: 19e4, 영등포구: 17e4, 송파구: 18e4, 성동구: 17e4, 광진구: 15e4, 서대문구: 13e4, 동작구: 12e4, 관악구: 11e4, 강서구: 11e4, 양천구: 11e4, 구로구: 11e4, 금천구: 10e4, 동대문구: 12e4, 성북구: 11e4, 중랑구: 9e4, 강동구: 13e4, 노원구: 9e4, 도봉구: 8e4, 강북구: 9e4, 은평구: 10e4 };
const TYPE = { 관광특구: { r: 1.5, key: 24 }, 발달상권: { r: 1.3, key: 18 }, 골목상권: { r: 0.8, key: 10 }, 전통시장: { r: 0.9, key: 8 } };
const WAGE = 260e4; // 1인 월 인건비(4대보험 포함) 가정
// 업태별 동인 그룹 가중치 (모델 기여도에 곱함)
const MULT = {
  take: { D_lvl: 1.3, D_trd: 1.0, S_lvl: 1.3, S_trd: 1.2, S_cat: 1.2 },
  seat: { D_lvl: 1.0, D_trd: 1.0, S_lvl: 1.0, S_trd: 1.0, S_cat: 1.0 },
  big: { D_lvl: 1.2, D_trd: 1.2, S_lvl: 0.5, S_trd: 0.5, S_cat: 0.5 },
};
const GNAME = { D_lvl: '수요 수준', D_trd: '수요 추세', S_lvl: '공급 여유', S_trd: '공급 추세', S_cat: '공급 미래' };
const MODE_HELP = {
  growth: '<b>성장형</b>: 3년 뒤 점포당 실질 매출 증가율 예측치만으로 순위를 매깁니다. 지금은 작아도 앞으로 가장 많이 오를 상권을 찾습니다.',
  stable: '<b>안정형</b>: 성장 예측 50% + 현재 업종 매출 규모 50%로 순위를 매깁니다. 이미 수요가 검증된 큰 상권 중 성장도 괜찮은 곳을 찾습니다 (대형 자본·리스크 회피용).',
};
const BRANDS = [
  ['프리미엄', /스타벅스|투썸|폴바셋|커피빈|블루보틀|할리스|파스쿠찌|엔제리너스/],
  ['저가', /메가.?커피|메가엠지씨|컴포즈|빽다방|더벤티|매머드|이디야|하삼동/],
  ['베이커리 프랜차이즈', /파리바게|뚜레쥬르|던킨|크리스피/],
];
const TIER_COLOR = () => ({ 프리미엄: css('--good'), 저가: css('--bad'), '베이커리 프랜차이즈': css('--warn'), '개인 베이커리': css('--gold'), 개인: css('--mute') });

let map, layer, cmap, cLayer, top3 = [], pass = [], sel = 0, spot = null, medG = 0;

// ───────────── 초기화 ─────────────
function init() {
  $('modeHelp').innerHTML = MODE_HELP[val('mode')];
  if (!D) { document.querySelector('main').insertAdjacentHTML('afterbegin', '<div class="empty">data.js가 없습니다. <code>python3 collector/build.py</code>를 먼저 실행하세요.</div>'); return; }
  const m = D.meta;
  $('stamps').innerHTML = [['기준', m.asOf], ['상권', m.counts.areas.toLocaleString() + '개'], ['점포', m.counts.shops.toLocaleString() + '개'], ['생성', m.built]].map(([k, v]) => `<span class="stamp">${k} <b>${v}</b></span>`).join('');
  $('buildInfo').textContent = `데이터 생성일 ${m.built} · collector/build.py로 재현 가능.`;
  map = makeMap('map');
  layer = L.layerGroup().addTo(map);
  cmap = makeMap('cmap');
  cLayer = L.layerGroup().addTo(cmap);
  cmap.on('click', (e) => { spot = { lat: e.latlng.lat, lng: e.latlng.lng, picked: true }; renderComp(); });
  document.querySelectorAll('.controls input').forEach((el) => el.addEventListener('change', () => { $('modeHelp').innerHTML = MODE_HELP[val('mode')]; run(); }));
  $('radius').addEventListener('input', () => { $('rlabel').textContent = $('radius').value + 'm'; renderComp(); });
  document.querySelectorAll('input[name=cmode]').forEach((el) => el.addEventListener('change', () => { spot = null; renderExec(); renderComp(); }));
  dataInfo();
  run();
}

function makeMap(id) {
  const mp = L.map(id, { scrollWheelZoom: false }).setView([37.55, 126.99], 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19, opacity: 0.75 }).addTo(mp);
  if (window.GU) { // 배경 타일이 막힌 환경(공유 페이지)에서도 위치를 알아볼 수 있도록 자치구 경계를 그린다
    L.geoJSON(window.GU, { style: { color: css('--mute'), weight: 1, fillColor: css('--surface'), fillOpacity: 0.35 }, interactive: false }).addTo(mp);
    window.GU.features.forEach((f) => {
      const ring = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0];
      const c = ring.reduce((s, p) => [s[0] + p[1] / ring.length, s[1] + p[0] / ring.length], [0, 0]);
      L.tooltip({ permanent: true, direction: 'center', className: 'gu-label' }).setLatLng(c).setContent(f.properties.name).addTo(mp);
    });
  }
  return mp;
}

function dataInfo() {
  const m = D.meta;
  $('dataInfo').textContent = `기준 시점 ${m.asOf} · 분석 기간 2021~2025년 매년 4분기 (계절성 제거) · 공간 단위 상권 ${m.counts.areas.toLocaleString()}개 · 금액은 소비자물가지수로 2025년 기준 실질화 · 좌표계는 역 이름 기준점으로 자동 판별 (상권 ${m.proj.relm[0]}, 점포 ${m.proj.shop[0]}).`;
  const rows = Object.entries(D.backtest).map(([k, b]) => `<tr><th>${KIND[k]}</th><td class="num">${b.n.toLocaleString()}</td><td class="num"><b>${b.rho_oos.toFixed(2)}</b></td><td class="num">${b.rho_momentum.toFixed(2)}</td><td class="num">${(b.top_decile_hit * 100).toFixed(0)}%</td><td class="num"><b>${pct(b.top_decile_median)}</b></td><td class="num">${pct(b.all_median)}</td></tr>`).join('');
  $('backtest').innerHTML = `<div class="tablewrap"><table><thead><tr><th>업종</th><th class="num">상권 수</th><th class="num">예측-실제 순위상관<br>(검증용 절반)</th><th class="num">단순 모멘텀<br>순위상관</th><th class="num">예측 상위 10%가<br>실제 상위 30%에 든 비율</th><th class="num">예측 상위 10%<br>실제 3년 성장</th><th class="num">전체 상권<br>실제 3년 성장</th></tr></thead><tbody>${rows}</tbody></table></div>
  <p class="note">2022년 4분기 시점의 동인으로 2022Q4→2025Q4 점포당 실질 매출 성장을 예측했습니다. 상권코드 짝수로 학습하고 홀수로 검증한 뒤 전체로 다시 학습합니다 (릿지 회귀, 무작위 요소 없음). 성장률은 중앙값입니다.</p>`;
}

// ───────────── L1 제약 · L2 점수 ─────────────
function contrib(z, kind) {
  const beta = D.coef[kind].beta, out = {};
  D.features.forEach(([g, k], i) => { out[g] = (out[g] || 0) + beta[k] * z[i]; });
  return out;
}

function l1(a, kind, fmt, budget) {
  const k = a.k[kind], p = PRESET[fmt], t = TYPE[a.t] || TYPE['골목상권'];
  const rent = (RENT[a.g] || 12e4) * t.r * p.py * (fmt === 'big' ? 0.7 : 1);
  const deposit = rent * 10, key = rent * t.key;
  const fixed = p.py * p.intr + p.eq[kind] + 2000e4;
  const reserve = (rent + p.staff * WAGE + 300e4) * 3; // 운영자금: 고정비 3개월분
  const need = deposit + key + fixed + reserve;
  const sales = k.ps * p.scale; // 추정매출 THSMON_SELNG_AMT는 월 매출 (커피 점포당 중앙값 약 1,270만 원으로 검증)
  const cogs = kind === 'coffee' ? 0.28 : 0.33;
  const profit = sales * (1 - cogs - 0.03) - rent - p.staff * WAGE - 300e4 - (p.py * p.intr) / 60;
  const why = [];
  if (need > budget) why.push(`투자금 ${won(need - budget)} 부족`);
  if (rent / sales > 0.15) why.push(`임대료 비율 ${(rent / sales * 100).toFixed(0)}%`);
  if (profit <= 0) why.push(`예상 영업이익 ${won(profit)}`);
  if (k.st < 3) why.push('동종 점포 3개 미만');
  if (fmt === 'big' && (a.t === '전통시장' || (a.t === '골목상권' && a.ar < 150000))) why.push('대형 매장 부적합 상권');
  if (fmt === 'take' && k.pf && k.pf[1] / k.amt < 0.15) why.push('오전 매출 비중 낮음');
  return { rent, deposit, key, fixed, need, sales, profit, why };
}

function zs(v) {
  const m = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length) || 1;
  return v.map((x) => (x - m) / sd);
}

function scoreAll(list, kind, mode, mult) {
  list.forEach((x) => {
    x.c = contrib(x.a.k[kind].z, kind);
    x.g = D.coef[kind].b0 + Object.values(x.c).reduce((s, v) => s + v, 0); // 3년 로그 성장 예측 (업태 가중 전)
    x.raw = Object.entries(x.c).reduce((acc, [g, v]) => acc + (mult[g] ?? 1) * v, 0);
  });
  const zg = zs(list.map((x) => x.raw)), zsz = zs(list.map((x) => Math.log(x.a.k[kind].amt + 1)));
  list.forEach((x, i) => { x.s = mode === 'stable' ? 0.5 * zg[i] + 0.5 * zsz[i] : zg[i]; });
  return list.sort((p, q) => q.s - p.s);
}

function run() {
  const kind = val('kind'), fmt = val('fmt'), mode = val('mode'), budget = +$('budget').value * 1e8;
  const all = D.areas.filter((a) => a.k[kind]);
  const res = all.map((a) => ({ a, f: l1(a, kind, fmt, budget) }));
  const A = res.filter((x) => !x.f.why.some((w) => w.startsWith('투자금')));
  const B = A.filter((x) => !x.f.why.some((w) => w.startsWith('임대료') || w.startsWith('예상 영업이익')));
  pass = B.filter((x) => x.f.why.length === 0);
  const near = res.filter((x) => x.f.why.length === 1 && x.f.why[0].startsWith('투자금') && x.f.need - budget <= 0.5e8).length;
  const steps = [['전체 상권', all.length], ['투자금 안에 들어옴', A.length], ['임대료 비율·흑자 통과', B.length], ['업태에 맞음 → 순위 대상', pass.length]];
  $('funnel').innerHTML = steps.map(([n, v]) => `<div class="fstep"><span>${n}</span><div class="fbar"><i style="width:${(v / all.length * 100).toFixed(1)}%"></i></div><span class="num">${v.toLocaleString()}</span></div>`).join('') +
    `<p class="near">투자금을 5천만 원 늘리면 들어갈 수 있는 상권 <b>${near}개</b> 추가</p>`;
  if (!pass.length) {
    $('top3').innerHTML = '<div class="empty" style="grid-column:1/-1">조건을 통과한 상권이 없습니다. 투자금을 늘리거나 업태를 바꿔 보세요.</div>';
    ['exec', 'simOut', 'comp', 'rebut', 'sim'].forEach((id) => { $(id).innerHTML = ''; });
    $('selName').textContent = '-'; $('selSeg').innerHTML = ''; layer.clearLayers(); return;
  }
  scoreAll(pass, kind, mode, MULT[fmt]);
  top3 = pass.slice(0, 3);
  const allG = all.map((a) => Math.exp(D.coef[kind].b0 + Object.values(contrib(a.k[kind].z, kind)).reduce((s, v) => s + v, 0)) - 1).sort((p, q) => p - q);
  medG = allG[Math.floor(allG.length / 2)];
  // 민감도: 그룹 가중치를 하나씩 ±20% 바꿔 10번 다시 순위를 매기고, Top 3에 남는 횟수를 센다
  const keep = top3.map(() => 0); let runs = 0;
  for (const g of Object.keys(GNAME)) for (const d of [0.8, 1.2]) {
    const ids = scoreAll(pass.map((x) => ({ a: x.a, f: x.f })), kind, mode, { ...MULT[fmt], [g]: MULT[fmt][g] * d }).slice(0, 3).map((x) => x.a.c);
    top3.forEach((t, i) => { if (ids.includes(t.a.c)) keep[i]++; }); runs++;
  }
  top3.forEach((t, i) => { t.keep = keep[i]; t.runs = runs; });
  renderPicks(kind);
  drawMap();
  sel = 0;
  select(0);
}

// ───────────── L4 결론 ─────────────
function renderPicks(kind) {
  const sdv = D.backtest[kind].resid_sd;
  const maxAbs = Math.max(...top3.flatMap((x) => Object.values(x.c).map(Math.abs)), 0.01);
  $('top3').innerHTML = top3.map((x, i) => {
    const k = x.a.k[kind], g3 = Math.exp(x.g) - 1;
    const drv = Object.entries(x.c).sort((p, q) => Math.abs(q[1]) - Math.abs(p[1])).slice(0, 3).map(([g, v]) => {
      const w = Math.abs(v) / maxAbs * 50;
      return `<div class="drv"><span>${GNAME[g]}</span><div class="track"><i style="${v >= 0 ? `left:50%;width:${w}%;background:var(--accent)` : `right:50%;width:${w}%;background:var(--bad)`}"></i></div><span class="num">${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}</span></div>`;
    }).join('');
    return `<button class="pick" type="button" data-i="${i}" aria-pressed="${i === sel}">
      <div class="pick-top"><span class="rank">${i + 1}</span><div><h3>${x.a.n}</h3><div class="where">${x.a.g} ${x.a.d} · ${x.a.t}</div></div></div>
      <div class="growth"><b class="${g3 - medG >= 0 ? 'ok' : 'bad'}">${(g3 - medG >= 0 ? '+' : '') + ((g3 - medG) * 100).toFixed(1)}%p</b><span>서울 상권 중앙값(${pct(medG)}) 대비<br>3년 뒤 점포당 실질 매출</span></div>
      <p class="note" style="margin:0">예측 ${pct(g3)} · 범위 ${pct(Math.exp(x.g - sdv) - 1, 0)} ~ ${pct(Math.exp(x.g + sdv) - 1, 0)}</p>
      <div class="drivers">${drv}</div>
      <div class="chips"><span class="chip">동종 ${k.st}개</span><span class="chip">프랜차이즈 ${k.frc}개</span>${x.a.ix ? `<span class="chip">${x.a.ix}</span>` : ''}<span class="chip gold">필요 ${won(x.f.need)}</span><span class="chip ${x.keep >= 8 ? 'good' : 'bad'}">민감도 ${x.keep}/${x.runs}</span></div>
      <span class="cta">${i === sel ? '선택됨 · 아래 실행안에 반영' : '눌러서 실행안 보기'}</span></button>`;
  }).join('');
  document.querySelectorAll('.pick').forEach((b) => b.addEventListener('click', () => { select(+b.dataset.i); $('action').scrollIntoView({ behavior: 'smooth' }); }));
}

function drawMap() {
  layer.clearLayers();
  const acc = css('--accent'), gold = css('--gold');
  pass.slice(3, 150).forEach((x, i) => L.circleMarker([x.a.lat, x.a.lng], { radius: 4, color: acc, weight: 1, fillOpacity: 0.45 }).bindTooltip(`${i + 4}위 ${x.a.n}`).addTo(layer));
  top3.forEach((x, i) => L.circleMarker([x.a.lat, x.a.lng], { radius: 11, color: '#fff', weight: 2, fillColor: gold, fillOpacity: 1 }).bindTooltip(`${i + 1}위 ${x.a.n}`, { permanent: true, direction: 'right' }).on('click', () => select(i)).addTo(layer));
  map.fitBounds(L.latLngBounds(top3.map((x) => [x.a.lat, x.a.lng])).pad(0.6), { maxZoom: 13 });
}

function select(i) {
  sel = i; spot = null;
  const t = top3[i];
  document.querySelectorAll('.pick').forEach((b) => {
    const on = +b.dataset.i === i;
    b.setAttribute('aria-pressed', on);
    b.querySelector('.cta').textContent = on ? '선택됨 · 아래 실행안에 반영' : '눌러서 실행안 보기';
  });
  $('selName').textContent = `${i + 1}위 ${t.a.n}`;
  $('selSeg').innerHTML = top3.map((x, j) => `<label><input type="radio" name="selpick" value="${j}" ${j === i ? 'checked' : ''}><span>${j + 1}위</span></label>`).join('');
  document.querySelectorAll('input[name=selpick]').forEach((el) => el.addEventListener('change', () => select(+el.value)));
  $('rebutFor').textContent = `· ${i + 1}위 ${t.a.n} 기준`;
  renderRebut(); renderExec(); renderSim(); renderComp();
}

function renderRebut() {
  const kind = val('kind'), t = top3[sel], k = t.a.k[kind], b = D.backtest[kind];
  const sh = k.sh.filter((v) => v), last = sh.length > 1 ? sh.at(-1) / sh.at(-2) - 1 : 0;
  const fl = t.a.flHist, flg = fl[3] ? fl[4] / fl[3] - 1 : 0;
  const stDelta = k.sth.at(-1) - (k.sth.at(-2) || 0);
  const same = Math.sign(last) === Math.sign(flg);
  $('rebut').innerHTML = `<div class="tablewrap"><table><thead><tr><th>예상 반론</th><th>데이터로 본 대응</th></tr></thead><tbody>
  <tr><th>이미 뜬 곳, 지금이 고점 아닌가?</th><td>최근 1년 업종 실질 매출 ${pct(last)}, 동종 점포 ${k.sth.at(-2) ?? '-'}→${k.sth.at(-1)}개. ${last > 0 && stDelta <= 2 ? '<span class="ok">매출은 늘고 점포 증가는 제한적 → 고점 신호 약함</span>' : '<span class="bad">최근 매출 감소 또는 점포 급증 → 진입 시점 신중</span>'}</td></tr>
  <tr><th>추정매출은 카드 추정치일 뿐</th><td>유동인구 1년 변화 ${pct(flg)} → 매출과 ${same ? '<span class="ok">같은 방향</span>' : '<span class="bad">반대 방향, 추가 확인 필요</span>'}</td></tr>
  <tr><th>가중치가 임의적이다</th><td>동인 가중치는 2022→2025 실제 성장으로 학습. 업태 가중치를 ±20%씩 바꿔도 Top 3에 남은 횟수 ${t.keep}/${t.runs}</td></tr>
  <tr><th>과거 추세가 미래를 보장하지 않는다</th><td>검증용 절반에서 예측-실제 순위상관 ${b.rho_oos.toFixed(2)} (단순 모멘텀 ${b.rho_momentum.toFixed(2)}). 카드에 예측 범위를 함께 표시</td></tr>
  <tr><th>대형 자본이면 강남이 낫다</th><td>상단에서 투자금·업태를 바꾸면 그 조건의 Top 3로 바로 다시 계산 (예: 15억 · 대형·목적지형)</td></tr></tbody></table></div>`;
}

// ───────────── L5 실행 ─────────────
function profileOf(t, kind) {
  const k = t.a.k[kind], pf = k.pf || [];
  const amt = pf.slice(0, 6).reduce((s, v) => s + v, 0) || 1;
  const age = pf.slice(10, 16), at = age.reduce((s, v) => s + v, 0) || 1;
  return { pf, amt, age, at, morning: pf[1] / amt, wkend: pf[7] / (pf[6] + pf[7] || 1), fem: pf[9] / (pf[8] + pf[9] || 1), a20: age[1] / at, a3040: (age[2] + age[3]) / at, ticket: k.amt / (k.cnt || 1) };
}

function renderExec() {
  const kind = val('kind'), fmt = val('fmt'), cmode = val('cmode'), t = top3[sel], P = profileOf(t, kind);
  const tickets = D.areas.filter((a) => a.k[kind] && a.k[kind].cnt > 0).map((a) => a.k[kind].amt / a.k[kind].cnt).sort((p, q) => p - q);
  const priceIdx = Math.min(1.25, Math.max(0.85, P.ticket / tickets[Math.floor(tickets.length / 2)]));
  let persona, palette, concept, menu, mkt;
  if (P.morning > 0.3) { persona = '출근길 직장인'; palette = ['#2f3a45', '#c9b79c', '#f4f1ea', '#d4693b']; concept = '빠른 동선의 그랩앤고, 바 좌석 위주, 주문 대기 최소화'; menu = ['아메리카노·라떼 세트', '버터 스콘', '햄치즈 샌드위치']; mkt = '오전 7~10시 세트 할인, 사전 주문 앱, 인근 오피스 제휴'; }
  else if (P.wkend > 0.35 || (P.a20 > 0.3 && P.fem > 0.55)) { persona = '주말 방문 20대'; palette = ['#f6e7d8', '#e8b4a0', '#7a5c58', '#ffffff']; concept = '포토 스팟이 있는 체류형 공간, 자연광, 시그니처 진열대'; menu = ['시그니처 크림 라떼', '비주얼 디저트(시즌 한정)', '소금빵']; mkt = '인스타그램 시즌 한정 메뉴, 주말 오후 웨이팅 관리'; }
  else if (P.a3040 > 0.45) { persona = '동네 30·40대 거주민'; palette = ['#efe6d6', '#8a6b4e', '#3e4a3d', '#fafaf7']; concept = '따뜻한 동네 베이커리, 오픈 키친, 가족석'; menu = ['식빵·캄파뉴(식사빵)', '드립 커피', '키즈 우유 메뉴']; mkt = '정기 구매 쿠폰, 갓 구운 빵 시간 알림, 아침 7시 오픈'; }
  else { persona = '점심·오후 혼합 수요'; palette = ['#ece8e1', '#a3896b', '#33302b', '#ffffff']; concept = '모던 미니멀, 2인석 위주, 회전율과 체류의 균형'; menu = ['라떼', '크루아상', '오후 디저트 플레이트']; mkt = '점심 직후(13~15시) 디저트 세트, 테이크아웃 할인'; }
  const p = PRESET[fmt], seats = Math.round(p.py * (fmt === 'take' ? 0.6 : 1.1));
  if (!spot) spot = bestSpot(t.a, cmode);
  const goNow = t.c.D_trd > 0 && (RENT[t.a.g] || 0) <= 15e4;
  $('exec').innerHTML = `<div class="stats">
    <div class="stat"><span>타깃 페르소나</span><b style="font-family:var(--f-body);font-size:18px">${persona}</b></div>
    <div class="stat"><span>오전 6~11시 매출 비중</span><b>${(P.morning * 100).toFixed(0)}%</b></div>
    <div class="stat"><span>주말 매출 비중</span><b>${(P.wkend * 100).toFixed(0)}%</b></div>
    <div class="stat"><span>상권 평균 객단가</span><b>${Math.round(P.ticket).toLocaleString()}원</b></div></div>
  <div class="tablewrap" style="margin-top:12px"><table><tbody>
  <tr><th>출점: 어디</th><td>${t.a.n} 안의 추천 자리 (${cmode === 'avoid' ? '회피 모드: 반경 100m 경쟁 최소' : '벤치마킹 모드: 반경 300m 프리미엄 프랜차이즈 근처'}) — 아래 경쟁 체크 지도에 ★로 표시</td></tr>
  <tr><th>출점: 언제</th><td>${goNow ? '<span class="verdict good">지금 진입</span> 수요 추세가 오르는데 임대료 수준이 아직 낮음' : '<span class="verdict bad">관망</span> 다음 분기 데이터로 수요 추세와 임대료를 다시 확인'}</td></tr>
  <tr><th>인테리어</th><td>${concept} · ${p.py}평 · 약 ${seats}석<div class="pal">${palette.map((c) => `<i style="background:${c}" title="${c}"></i>`).join('')}</div></td></tr>
  <tr><th>메뉴</th><td>${menu.map((m, i) => `${m} <b class="num">${(Math.round([5000, 4200, 6500][i] * priceIdx / 100) * 100).toLocaleString()}원</b>`).join(' · ')}<p class="note">서울 기준가 × 상권 가격지수 ${priceIdx.toFixed(2)} (이 상권 객단가 ÷ 서울 중앙값, 0.85~1.25로 제한)</p></td></tr>
  <tr><th>마케팅</th><td>${mkt}</td></tr>
  <tr><th>추적 지표</th><td>분기마다 상권 업종 매출 증가율, 동종 점포 순증, 프랜차이즈 신규 진입, 내 매장 일 객수를 확인. 업종 매출이 2분기 연속 줄고 점포가 늘면 철수·전환 검토</td></tr></tbody></table></div>`;
  const ink = css('--mute'), line = css('--line');
  const axis = { axisLabel: { color: ink }, axisLine: { lineStyle: { color: line } } };
  const opt = (title, labels, data, color) => ({ title: { text: title, textStyle: { fontSize: 13, color: css('--ink'), fontFamily: css('--f-body') } }, grid: { left: 42, right: 8, bottom: 26, top: 36 }, tooltip: { valueFormatter: (v) => v + '%' },
    xAxis: { type: 'category', data: labels, ...axis }, yAxis: { type: 'value', axisLabel: { color: ink, formatter: '{value}%' }, splitLine: { lineStyle: { color: line } } },
    series: [{ type: 'bar', data, itemStyle: { color, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 36 }] });
  (echarts.getInstanceByDom($('chTime')) || echarts.init($('chTime'))).setOption(opt('시간대별 매출 비중', ['0-6시', '6-11시', '11-14시', '14-17시', '17-21시', '21-24시'], P.pf.slice(0, 6).map((v) => +(v / P.amt * 100).toFixed(1)), css('--accent')));
  (echarts.getInstanceByDom($('chAge')) || echarts.init($('chAge'))).setOption(opt('연령대별 매출 비중', ['10대', '20대', '30대', '40대', '50대', '60+'], P.age.map((v) => +(v / P.at * 100).toFixed(1)), css('--gold')));
}

function shopsAround(lat, lng, r) {
  const out = [];
  const kx = 111000 * Math.cos(lat * Math.PI / 180);
  for (const s of D.shops) {
    const dy = (s[0] - lat) * 111000; if (dy > r || dy < -r) continue;
    const dx = (s[1] - lng) * kx; if (dx * dx + dy * dy <= r * r) out.push(s);
  }
  return out;
}
const tier = (s) => { const b = BRANDS.find(([, re]) => re.test(s[2])); return b ? b[0] : (s[3] === 'b' ? '개인 베이커리' : '개인'); };

function bestSpot(a, cmode) {
  const r = Math.min(400, Math.max(120, Math.sqrt(a.ar / Math.PI)));
  const pool = shopsAround(a.lat, a.lng, r + 350).filter((s) => !s[5]);
  const kx = 111000 * Math.cos(a.lat * Math.PI / 180);
  const count = (lat, lng, rad, f) => pool.filter((s) => { const dy = (s[0] - lat) * 111000, dx = (s[1] - lng) * kx; return dx * dx + dy * dy <= rad * rad && (!f || f(s)); }).length;
  let best = null;
  for (let dx = -r; dx <= r; dx += 50) for (let dy = -r; dy <= r; dy += 50) {
    if (dx * dx + dy * dy > r * r) continue;
    const lat = a.lat + dy / 111000, lng = a.lng + dx / kx;
    const n100 = count(lat, lng, 100), low100 = count(lat, lng, 100, (s) => tier(s) === '저가');
    const prem = cmode === 'bench' ? count(lat, lng, 300, (s) => tier(s) === '프리미엄') : 0;
    const score = cmode === 'bench' ? 2 * prem - n100 : -(n100 + 2 * low100);
    const v = score - Math.hypot(dx, dy) / 400; // 상권 중심(수요)에서 멀수록 소폭 감점
    if (!best || v > best.v) best = { lat, lng, v };
  }
  return best;
}

function renderComp() {
  if (!top3.length) return;
  const cmode = val('cmode'), r = +$('radius').value, t = top3[sel];
  if (!spot) spot = bestSpot(t.a, cmode);
  const list = shopsAround(spot.lat, spot.lng, r), open = list.filter((s) => !s[5]), closed = list.length - open.length;
  const cnt = {}; open.forEach((s) => { const k = tier(s); cnt[k] = (cnt[k] || 0) + 1; });
  const col = TIER_COLOR();
  cLayer.clearLayers();
  L.circle([spot.lat, spot.lng], { radius: r, color: css('--accent'), weight: 1.5, fillOpacity: 0.06 }).addTo(cLayer);
  open.forEach((s) => L.circleMarker([s[0], s[1]], { radius: 4, color: col[tier(s)], weight: 1, fillOpacity: 0.85 }).bindTooltip(`${s[2]} · ${tier(s)}`).addTo(cLayer));
  L.marker([spot.lat, spot.lng], { icon: L.divIcon({ className: '', html: `<div style="font-size:22px;line-height:1;color:${css('--gold')};text-shadow:0 0 3px #000">★</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) }).bindTooltip(spot.picked ? '선택한 지점' : '추천 자리').addTo(cLayer);
  cmap.setView([spot.lat, spot.lng], r > 600 ? 14 : 15);
  const low = cnt['저가'] || 0, prem = cnt['프리미엄'] || 0, pressure = open.length + low * 2;
  const verdict = cmode === 'avoid'
    ? (pressure <= r / 50 ? '<span class="verdict good">경쟁 압력 낮음</span>' : '<span class="verdict bad">경쟁 압력 높음</span>') + (low ? ` 저가 커피 ${low}곳 — 커피 중심 매장은 가격 경쟁 위험` : '')
    : (prem ? `<span class="verdict good">프리미엄 ${prem}곳</span> 검증된 유동. 베이커리·디저트로 차별화하면 편승 가능` : '<span class="verdict bad">프리미엄 없음</span> 벤치마킹 근거가 약함');
  const rows = ['프리미엄', '저가', '베이커리 프랜차이즈', '개인 베이커리', '개인'].map((k) => `<tr><th><i style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${col[k]};margin-right:6px"></i>${k}</th><td class="num">${cnt[k] || 0}</td></tr>`).join('');
  $('comp').innerHTML = `<div style="display:grid;gap:10px"><p style="margin:0">${spot.picked ? '지도에서 선택한 지점' : `${t.a.n} 추천 자리`} · 반경 ${r}m · 영업 중 <b class="num">${open.length}</b>곳</p><p style="margin:0">${verdict}</p>
  <div class="tablewrap"><table><tbody>${rows}<tr><th>최근 폐업 (2024년 이후)</th><td class="num">${closed}</td></tr></tbody></table></div>
  <p class="note">반경 안에 점포가 없으면 수요가 없을 가능성도 있으니 위의 수요 지표와 함께 판단하세요. 프랜차이즈는 상호명 패턴으로 분류해 일부 누락·오분류가 있을 수 있습니다.</p></div>`;
}

const SIM = [ // [그룹, 라벨, 단위]
  ['초기 투자', '보증금', '원'], ['초기 투자', '권리금', '원'], ['초기 투자', '인테리어', '원'], ['초기 투자', '설비', '원'], ['초기 투자', '기타 초기비용', '원'],
  ['고정비', '월 임대료', '원'], ['매출', '일 객수', '명'], ['매출', '객단가', '원'], ['변동비', '원가율', '%'], ['고정비', '직원 수', '명'], ['고정비', '1인 월 인건비', '원'],
  ['고정비', '기타 고정비(월)', '원'], ['변동비', '카드·배달 수수료', '%'], ['매출', '월 영업일', '일'], ['금융', '대출금', '원'], ['금융', '대출 금리', '%'], ['매출', '정상 매출까지', '개월'],
];

function renderSim() {
  const kind = val('kind'), fmt = val('fmt'), t = top3[sel], k = t.a.k[kind], p = PRESET[fmt], f = t.f;
  const ticket = Math.round(k.amt / (k.cnt || 1));
  const daily = Math.round(f.sales / ticket / 30);
  const v = [f.deposit, f.key, p.py * p.intr, p.eq[kind], 2000e4, f.rent, daily, ticket, kind === 'coffee' ? 28 : 33, p.staff, WAGE, 300e4, 3, 30, 0, 5, 4];
  const groups = ['초기 투자', '매출', '변동비', '고정비', '금융'];
  $('sim').innerHTML = groups.filter((g) => g !== '금융').map((g) => `<fieldset><legend>${g}</legend>${SIM.map((s, i) => s[0] === g || (g === '고정비' && s[0] === '금융') ? `<label>${s[1]} (${s[2]})<input type="number" id="s${i}" value="${Math.round(v[i])}"></label>` : '').join('')}</fieldset>`).join('');
  SIM.forEach((_, i) => $('s' + i).addEventListener('input', calc));
  calc();
}

function calc() {
  const g = (i) => +$('s' + i).value || 0;
  const invest = g(0) + g(1) + g(2) + g(3) + g(4), budget = +$('budget').value * 1e8;
  const fixed = g(5) + g(9) * g(10) + g(11) + g(14) * g(15) / 1200 + g(2) / 60;
  const month = (factor) => { const sales = g(6) * g(7) * g(13) * factor; return { sales, profit: sales * (1 - (g(8) + g(12)) / 100) - fixed }; };
  const base = month(1), unit = g(7) * g(13) * (1 - (g(8) + g(12)) / 100);
  const bepDaily = unit > 0 ? fixed / unit : Infinity;
  const cf = []; let cum = -invest;
  for (let m = 1; m <= 36; m++) { const r = Math.min(1, 0.6 + 0.4 * (m - 1) / Math.max(1, g(16))); cum += month(r).profit + g(2) / 60; cf.push(Math.round(cum)); }
  const pay = cf.findIndex((x) => x >= 0);
  const rentRatio = g(5) / (base.sales || 1);
  const go = pay >= 0 && rentRatio <= 0.15 && invest <= budget;
  const sc = [['보수 (객수 −20%)', 0.8], ['기본', 1], ['낙관 (객수 +20%)', 1.2]].map(([n, fct]) => { const m = month(fct); return `<tr><th>${n}</th><td class="num">${won(m.sales)}</td><td class="num ${m.profit >= 0 ? 'ok' : 'bad'}">${won(m.profit)}</td></tr>`; }).join('');
  $('simOut').innerHTML = `<div class="stats">
    <div class="stat"><span>월 매출</span><b>${won(base.sales)}</b></div>
    <div class="stat"><span>월 영업이익</span><b class="${base.profit >= 0 ? 'ok' : 'bad'}">${won(base.profit)}</b></div>
    <div class="stat"><span>손익분기 일 객수</span><b>${isFinite(bepDaily) ? Math.ceil(bepDaily) + '명' : '-'}</b><small>현재 ${g(6)}명</small></div>
    <div class="stat"><span>투자금 회수</span><b>${pay >= 0 ? pay + 1 + '개월' : '36개월+'}</b><small>초기 투자 ${won(invest)}</small></div></div>
  <div class="two" style="margin-top:12px"><div class="tablewrap"><table><thead><tr><th>시나리오</th><th class="num">월 매출</th><th class="num">월 영업이익</th></tr></thead><tbody>${sc}</tbody></table></div>
  <div style="display:grid;gap:6px;align-content:start"><p style="margin:0">진행/중단 판단 ${go ? '<span class="verdict good">진행</span>' : '<span class="verdict bad">재검토</span>'}</p>
  <p class="note">기준: 36개월 안에 회수 · 임대료가 매출의 15% 이하 (현재 ${(rentRatio * 100).toFixed(0)}%) · 초기 투자 ≤ 투자금</p>
  <p class="note">손익분기 일 객수 = 월 고정비 ÷ (객단가 × 영업일 × (1 − 원가율 − 수수료)). 인테리어는 5년 감가상각, 오픈 첫 달 매출 60%에서 정상까지 선형으로 오른다고 가정.</p></div></div>`;
  const ch = echarts.getInstanceByDom($('chCash')) || echarts.init($('chCash'));
  const ink = css('--mute'), line = css('--line');
  ch.setOption({ title: { text: '3년 누적 현금흐름', textStyle: { fontSize: 13, color: css('--ink'), fontFamily: css('--f-body') } }, grid: { left: 54, right: 10, bottom: 26, top: 36 },
    tooltip: { trigger: 'axis', valueFormatter: (x) => won(x) },
    xAxis: { type: 'category', data: cf.map((_, i) => i + 1 + '월'), axisLabel: { color: ink }, axisLine: { lineStyle: { color: line } } },
    yAxis: { type: 'value', axisLabel: { color: ink, formatter: (x) => (x / 1e8).toFixed(1) + '억' }, splitLine: { lineStyle: { color: line } } },
    series: [{ type: 'line', data: cf, smooth: true, showSymbol: false, lineStyle: { width: 2, color: css('--accent') }, areaStyle: { color: css('--accent'), opacity: 0.08 },
      markLine: { symbol: 'none', data: [{ yAxis: 0 }], lineStyle: { color: css('--gold'), type: 'dashed' }, label: { show: false } } }] }, true);
}

window.addEventListener('resize', () => ['chTime', 'chAge', 'chCash'].forEach((id) => echarts.getInstanceByDom($(id))?.resize()));
init();
