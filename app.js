// ---------- 기본 상태 ----------
const INITIAL_CASH = 1000000; // 100만
const STORAGE_KEY = "mockx-state-v1";

const defaultStocks = [
  { code: "PXA", name: "Passa A", price: 100, prevClose: 100 },
  { code: "PBK", name: "Bank of Prokoland", price: 250, prevClose: 250 },
  { code: "RFE", name: "Raffine Electronics", price: 80, prevClose: 80 },
  { code: "AER", name: "Aetherion Space", price: 320, prevClose: 320 }
];

let state = loadState() || {
  cash: INITIAL_CASH,
  holdings: {},             // code -> { qty, avg }
  fills: [],                // [{ts, side, code, qty, price}]
  stocks: defaultStocks,
  circuit: { active:false, triggerPct: 10 }, // 전장 대비 ±10%에 서킷브레이커
  sim: { running:false, tickMs: 1500 }
};

// ---------- 유틸 ----------
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function loadState(){ try{ return JSON.parse(localStorage.getItem(STORAGE_KEY)); }catch(e){ return null; } }
function fmt(n){ return n.toLocaleString("ko-KR", {maximumFractionDigits:2}); }
function nowStr(){ return new Date().toLocaleTimeString(); }

// ---------- 시세 시뮬 ----------
function randomWalk(p){
  // 작은 표준편차의 로그수익 랜덤
  const drift = 0.000;
  const vol = 0.01; // 1% 수준
  const shock = (Math.random() - 0.5) * 2 * vol;
  let np = Math.max(1, p * (1 + drift + shock));
  return Math.round(np*100)/100;
}

function applyCircuitBreaker(stock){
  const limitUp = stock.prevClose * (1 + state.circuit.triggerPct/100);
  const limitDn = stock.prevClose * (1 - state.circuit.triggerPct/100);
  if (stock.price >= limitUp || stock.price <= limitDn){
    state.circuit.active = true;
    return true;
  }
  return false;
}

let timer = null;
function tick(){
  if(state.circuit.active){ updateUI(); return; }
  state.stocks = state.stocks.map(s=>{
    const old = s.price;
    const np = randomWalk(old);
    const next = { ...s, price: np };
    applyCircuitBreaker(next);
    return next;
  });
  saveState();
  updateUI();
}

// ---------- 주문/체결 ----------
function placeOrder(side, code, qty){
  const stock = state.stocks.find(s=>s.code===code);
  if(!stock) return alert("종목 없음");
  qty = parseInt(qty,10);
  if(!qty || qty<=0) return alert("수량 오류");

  const price = stock.price; // 시장가=현재가 체결
  const cost = Math.round(price * qty * 100)/100;

  if(side==="BUY"){
    if(state.cash < cost) return alert("현금 부족");
    // 평균단가 재계산
    const h = state.holdings[code] || { qty:0, avg:0 };
    const newQty = h.qty + qty;
    const newAvg = (h.qty*h.avg + cost) / newQty;
    state.holdings[code] = { qty: newQty, avg: Math.round(newAvg*100)/100 };
    state.cash -= cost;
  }else{
    const h = state.holdings[code] || { qty:0, avg:0 };
    if(h.qty < qty) return alert("보유 수량 부족");
    state.holdings[code] = { qty: h.qty - qty, avg: h.avg };
    state.cash += cost;
  }

  state.fills.unshift({ ts: nowStr(), side, code, qty, price });
  saveState();
  updateUI();
}

// ---------- UI ----------
const $ = sel => document.querySelector(sel);
const stocksBody = $("#stocksTable tbody");
const holdingsBody = $("#holdingsTable tbody");
const fillsBody = $("#fillsTable tbody");
const cashEl = $("#cash");
const equityEl = $("#equity");
const totalEl = $("#total");
const pnlEl = $("#pnl");
const cbStatus = $("#cbStatus");
const tickMsInput = $("#tickMs");
const toggleBtn = $("#toggleSim");

function renderStocks(){
  stocksBody.innerHTML = "";
  state.stocks.forEach(s=>{
    const chg = s.price - s.prevClose;
    const pct = (chg / s.prevClose) * 100;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${s.code}</td>
      <td>${s.name}</td>
      <td>${fmt(s.price)}</td>
      <td class="${chg>=0?'up':'down'}">${(chg>=0?'+':'')+fmt(chg)}</td>
      <td class="${pct>=0?'up':'down'}">${(pct>=0?'+':'')+fmt(pct)}%</td>
      <td>
        <input type="number" min="1" value="1" id="buy-${s.code}" />
        <button class="buy" data-code="${s.code}">매수</button>
      </td>
      <td>
        <input type="number" min="1" value="1" id="sell-${s.code}" />
        <button class="sell" data-code="${s.code}">매도</button>
      </td>`;
    stocksBody.appendChild(tr);
  });

  // 버튼 이벤트
  stocksBody.querySelectorAll("button.buy").forEach(b=>{
    b.onclick = () => {
      const code = b.dataset.code;
      const q = document.getElementById(`buy-${code}`).value;
      if(state.circuit.active) return alert("서킷브레이커 발동 중. 거래 정지");
      placeOrder("BUY", code, q);
    };
  });
  stocksBody.querySelectorAll("button.sell").forEach(b=>{
    b.onclick = () => {
      const code = b.dataset.code;
      const q = document.getElementById(`sell-${code}`).value;
      if(state.circuit.active) return alert("서킷브레이커 발동 중. 거래 정지");
      placeOrder("SELL", code, q);
    };
  });
}

function renderPortfolio(){
  // 평가액/손익 계산
  let equity = 0;
  holdingsBody.innerHTML = "";
  Object.entries(state.holdings).forEach(([code, h])=>{
    if(h.qty<=0) return;
    const price = state.stocks.find(s=>s.code===code)?.price ?? 0;
    const value = price * h.qty;
    const pnl = (price - h.avg) * h.qty;
    equity += value;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${code}</td>
      <td>${fmt(h.qty)}</td>
      <td>${fmt(h.avg)}</td>
      <td>${fmt(price)}</td>
      <td class="${pnl>=0?'up':'down'}">${(pnl>=0?'+':'')+fmt(pnl)}</td>`;
    holdingsBody.appendChild(tr);
  });

  cashEl.textContent = fmt(state.cash);
  equityEl.textContent = fmt(equity);
  totalEl.textContent = fmt(state.cash + equity);

  const invested = INITIAL_CASH;
  const pnl = state.cash + equity - invested;
  pnlEl.textContent = (pnl>=0?'+':'') + fmt(pnl);
  pnlEl.className = pnl>=0 ? 'up' : 'down';

  // 체결
  fillsBody.innerHTML = "";
  state.fills.slice(0,50).forEach(f=>{
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${f.ts}</td><td>${f.code}</td>
      <td>${fmt(f.qty)}</td><td>${fmt(f.price)}</td>
      <td class="${f.side==='BUY'?'up':'down'}">${f.side==='BUY'?'매수':'매도'}</td>`;
    fillsBody.appendChild(tr);
  });
}

function updateUI(){
  renderStocks();
  renderPortfolio();
  cbStatus.textContent = state.circuit.active ? `⚠️ 서킷브레이커 발동 (±${state.circuit.triggerPct}%)` : "";
}

// 탭 전환
document.getElementById("tab-market").onclick = ()=>{
  document.getElementById("market").classList.add("active");
  document.getElementById("portfolio").classList.remove("active");
};
document.getElementById("tab-portfolio").onclick = ()=>{
  document.getElementById("portfolio").classList.add("active");
  document.getElementById("market").classList.remove("active");
};

// 시뮬 토글
toggleBtn.onclick = ()=>{
  state.sim.tickMs = Math.max(300, parseInt(tickMsInput.value,10) || 1500);
  if(state.sim.running){
    clearInterval(timer);
    state.sim.running = false;
    toggleBtn.textContent = "시뮬레이션 시작";
  }else{
    timer = setInterval(tick, state.sim.tickMs);
    state.sim.running = true;
    toggleBtn.textContent = "시뮬레이션 정지";
  }
};
tickMsInput.onchange = ()=>{ state.sim.tickMs = parseInt(tickMsInput.value,10)||1500; saveState(); };

updateUI();
