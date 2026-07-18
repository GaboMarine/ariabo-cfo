// ============================================================
// Ariabo CFO — app.js
// Firebase + estado + render. La lógica pura vive en logic.js.
// ============================================================

import{initializeApp}from"https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import{getAuth,GoogleAuthProvider,signInWithPopup,onAuthStateChanged,signOut}from"https://www.gstatic.com/firebasejs/12.12.0/firebase-auth.js";
import{getFirestore,collection,doc,setDoc,deleteDoc,onSnapshot,query,getDoc,getDocs}from"https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";
import{
  MONTHS,FIXED_CAT,VAR_CAT,WHO,FOR_W,BUDGET_PROFILES,
  inMonth,fmt,esc,recurringDate,
  hasBudget,catBudgetTotal,budgetTotal,spentByCat,catStatus,monthGrade,
  catBudgetProfile,profileBudgetTotal,spentByCatProfile,profileSpentTotal,
  applyFilters,computeFrequent,pendingRecurring,recurringToExpense,
  validExpense,validRecurring
}from"./logic.js";

const firebaseConfig={
  apiKey:"AIzaSyD-AvL9iINS1y0jfPlPvGONpSZCtrztvr4",
  authDomain:"ariabo-cfo.firebaseapp.com",
  projectId:"ariabo-cfo",
  storageBucket:"ariabo-cfo.firebasestorage.app",
  messagingSenderId:"1005627138974",
  appId:"1:1005627138974:web:eb3e09a500f9b7a2b5ec8f"
};

const app=initializeApp(firebaseConfig);
const auth=getAuth(app);
const db=getFirestore(app);

const EMAIL_NAME={"gabormarin13@gmail.com":"Gabo","ariannyrijo868@gmail.com":"Ari"};

// ---------- Multi-hogar ----------
// Todas las rutas de Firestore se derivan del hogar activo. Hoy es fijo
// ("ariabo"); cuando existan más hogares, basta resolver state.household
// desde un mapping usuario→hogar al hacer login.
const DEFAULT_HOUSEHOLD="ariabo";
function hhPath(sub){return `households/${state.household}/${sub}`}
function expCollPath(){return hhPath("expenses")}
function incCollPath(){return hhPath("income")}          // colección única; mes derivado de date
function recCollPath(){return hhPath("recurring")}
function budgetDocRef(){return doc(db,hhPath("budget")+"/template")}
function migrationsDocRef(){return doc(db,hhPath("meta")+"/migrations")}

// ---------- Estado ----------
let state={
  household:DEFAULT_HOUSEHOLD,
  month:new Date().getMonth(),
  year:new Date().getFullYear(),
  view:"summary",
  editId:null,
  user:null,
  userName:null,
  allExpenses:[],
  allIncome:[],          // colección única completa; se filtra por mes en cliente
  recurring:[],
  unsubs:[],
  showIncomeForm:false,
  // flujo de alta
  flowStep:0,            // 0=tipo, 1=categoría, 2=form
  flowType:null,
  flowCat:null,
  flowPrefill:null,      // datos pre-cargados por quick-add
  // filtros combinables
  fSearch:"",fCat:"Todas",fWho:"Todos",fFor:"Todos",fMin:"",fMax:"",fFrom:"",fTo:"",
  // presupuesto
  budget:null,
  budgetLoaded:false,
  budgetProfile:"Ariabo",
  budgetDraft:null,
  summaryProfile:"Total",   // tracking de presupuesto: Total | Ariabo | Gabo | Ari
  // recurrentes
  showRecForm:false,
  recEditId:null,
  // migración
  incomeMigrated:true,   // optimista; se corrige al leer meta/migrations
};

function monthExpenses(){return state.allExpenses.filter(e=>inMonth(e,state.month,state.year))}
function monthIncome(){return state.allIncome.filter(i=>inMonth(i,state.month,state.year))}

// ---------- Auth ----------
const provider=new GoogleAuthProvider();
window.handleGoogleAuth=async function(){
  const errEl=document.getElementById("loginError");
  errEl.textContent="";
  try{await signInWithPopup(auth,provider)}
  catch(e){
    if(e.code==="auth/popup-closed-by-user")return;
    errEl.textContent="Error: "+e.message;
  }
};
window.handleLogout=async function(){
  state.unsubs.forEach(u=>u&&u());
  state.unsubs=[];
  await signOut(auth);
};

onAuthStateChanged(auth,user=>{
  state.user=user;
  if(user){
    state.userName=EMAIL_NAME[user.email]||"Gabo";
    document.getElementById("loginScreen").classList.add("hidden");
    document.getElementById("appScreen").classList.remove("hidden");
    document.getElementById("bottomNav").classList.remove("hidden");
    document.getElementById("userBadge").textContent=state.userName;
    subscribeToData();
  }else{
    document.getElementById("loginScreen").classList.remove("hidden");
    document.getElementById("appScreen").classList.add("hidden");
    document.getElementById("bottomNav").classList.add("hidden");
    state.allExpenses=[];state.allIncome=[];state.recurring=[];
    state.budget=null;state.budgetLoaded=false;
  }
});

// ---------- Firestore: suscripciones ----------
function subscribeToData(){
  state.unsubs.forEach(u=>u&&u());
  state.unsubs=[];

  state.unsubs.push(onSnapshot(query(collection(db,expCollPath())),snap=>{
    state.allExpenses=snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    renderApp();
  }));

  state.unsubs.push(onSnapshot(query(collection(db,incCollPath())),snap=>{
    state.allIncome=snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.date||"").localeCompare(a.date||""));
    renderApp();
  }));

  state.unsubs.push(onSnapshot(query(collection(db,recCollPath())),snap=>{
    state.recurring=snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(a.day||1)-(b.day||1));
    renderApp();
  }));

  state.unsubs.push(onSnapshot(budgetDocRef(),snap=>{
    state.budget=snap.exists()?(snap.data().categories||{}):null;
    state.budgetLoaded=true;
    renderApp();
  },()=>{state.budgetLoaded=true;renderApp()}));

  // estado de migración de ingresos
  getDoc(migrationsDocRef()).then(snap=>{
    state.incomeMigrated=snap.exists()&&snap.data().incomeUnified===true;
    renderApp();
  }).catch(()=>{});

  renderApp();
}

// ---------- Firestore: escrituras ----------
function newId(prefix){return prefix+"_"+Date.now()+"_"+Math.random().toString(36).substr(2,5)}

async function addExpense(data){
  const id=newId("exp");
  await setDoc(doc(db,expCollPath(),id),{...data,id,createdBy:state.user.email,createdAt:Date.now()});
}
async function updateExpense(id,data){
  await setDoc(doc(db,expCollPath(),id),{...data,id,updatedBy:state.user.email,updatedAt:Date.now()},{merge:true});
}
async function removeExpense(id){await deleteDoc(doc(db,expCollPath(),id))}

async function addIncome(data){
  const id=newId("inc");
  await setDoc(doc(db,incCollPath(),id),{...data,id,createdBy:state.user.email,createdAt:Date.now()});
}
async function removeIncome(id){await deleteDoc(doc(db,incCollPath(),id))}

async function saveBudget(categories){
  await setDoc(budgetDocRef(),{categories,updatedBy:state.user.email,updatedAt:Date.now()});
}

async function saveRecurring(id,data){
  await setDoc(doc(db,recCollPath(),id),{...data,id,updatedBy:state.user.email,updatedAt:Date.now()},{merge:true});
}
async function removeRecurring(id){await deleteDoc(doc(db,recCollPath(),id))}

// ---------- Migración de ingresos (una sola vez) ----------
// Copia los docs de las colecciones legacy income_YYYY-MM a la colección
// única income, con los mismos IDs (idempotente). Las colecciones viejas
// se conservan como respaldo; la app ya no las lee.
window._migrateIncome=async function(){
  const btn=document.getElementById("migBtn");
  if(btn){btn.disabled=true;btn.textContent="Migrando..."}
  try{
    let copied=0;
    const now=new Date();
    // ventana amplia: 24 meses hacia atrás desde el mes actual
    for(let i=0;i<24;i++){
      const d=new Date(now.getFullYear(),now.getMonth()-i,1);
      const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
      const snap=await getDocs(collection(db,hhPath("income_"+key)));
      for(const docu of snap.docs){
        const data=docu.data();
        if(!data.date)data.date=`${key}-01`; // tolerancia a registros sin fecha
        await setDoc(doc(db,incCollPath(),docu.id),data,{merge:true});
        copied++;
      }
    }
    await setDoc(migrationsDocRef(),{incomeUnified:true,migratedBy:state.user.email,migratedAt:Date.now(),copied},{merge:true});
    state.incomeMigrated=true;
    notify(`Migración completa: ${copied} registro(s)`);
  }catch(e){
    notify("Error en migración: "+(e.code||e.message));
  }
  renderApp();
};

// ---------- Helpers UI ----------
function notify(msg){
  const el=document.getElementById("notif");
  el.textContent=msg;el.classList.add("show");
  clearTimeout(window._nt);
  window._nt=setTimeout(()=>el.classList.remove("show"),2200);
}
function todayInMonth(){
  const d=new Date();
  const day=(d.getFullYear()===state.year&&d.getMonth()===state.month)
    ? String(d.getDate()).padStart(2,"0") : "01";
  return `${state.year}-${String(state.month+1).padStart(2,"0")}-${day}`;
}
function todayStr(){
  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

window.changeMonth=function(d){
  if(d<0){if(state.month===0){state.month=11;state.year--}else state.month--}
  else{if(state.month===11){state.month=0;state.year++}else state.month++}
  state.showIncomeForm=false;
  renderApp();
};

window.showView=function(v){
  if(state.view==="budget"&&v!=="budget")state.budgetDraft=null;
  state.view=v;state.editId=null;state.showIncomeForm=false;
  state.flowStep=0;state.flowType=null;state.flowCat=null;state.flowPrefill=null;
  state.showRecForm=false;state.recEditId=null;
  document.querySelector(".scroll-area").scrollTop=0;
  renderApp();
};

function updateNav(){
  const map={summary:"navSummary",list:"navList",budget:"navBudget",income:"navIncome"};
  ["navSummary","navList","navBudget","navIncome"].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.classList.toggle("active",map[state.view]===id);
  });
}

function renderApp(){
  document.getElementById("monthLabel").textContent=MONTHS[state.month]+" "+state.year;
  updateNav();
  const c=document.getElementById("content");
  if(state.view==="summary")renderSummary(c);
  else if(state.view==="list")renderList(c);
  else if(state.view==="add")renderFlow(c);
  else if(state.view==="income")renderIncome(c);
  else if(state.view==="budget")renderBudget(c);
  else if(state.view==="recurring")renderRecurring(c);
}

// ============================================================
// RESUMEN
// ============================================================
function renderSummary(c){
  const exps=monthExpenses();
  const total=exps.reduce((s,e)=>s+e.amount,0);
  const fijos=exps.filter(e=>e.type==="Fijo").reduce((s,e)=>s+e.amount,0);
  const vars=exps.filter(e=>e.type==="Variable").reduce((s,e)=>s+e.amount,0);
  const gaboT=exps.filter(e=>e.who==="Gabo").reduce((s,e)=>s+e.amount,0);
  const ariT=exps.filter(e=>e.who==="Ari").reduce((s,e)=>s+e.amount,0);
  const ariaboT=exps.filter(e=>e.forWhom==="Ariabo").reduce((s,e)=>s+e.amount,0);
  const totalInc=monthIncome().reduce((s,i)=>s+i.amount,0);

  const g=monthGrade(exps,state.budget);
  const bt=budgetTotal(state.budget);
  const showBudget=hasBudget(state.budget)&&bt>0;

  let h=`
  <div class="card">
    <div class="card-label"><span class="sync-dot"></span> Total gastos del mes</div>
    <div class="card-value">${fmt(total)}</div>
    <div class="card-row">
      <div class="card-row-item"><label>Fijos</label><span style="color:var(--gabo)">${fmt(fijos)}</span></div>
      <div class="card-row-item"><label>Variables</label><span style="color:var(--accent-strong)">${fmt(vars)}</span></div>
      <div class="card-row-item"><label>Calificación</label><span><span class="grade-pill grade-${g.grade}">${g.txt}</span></span></div>
    </div>
  </div>`;

  // Fijos recurrentes pendientes del mes
  const pend=pendingRecurring(state.recurring,exps);
  {
    if(pend.length>0){
      h+=`<div class="card">
        <div class="income-header" style="margin-bottom:8px">
          <div class="card-label" style="margin:0">Fijos pendientes este mes</div>
          <button class="link-btn" onclick="showView('recurring')">Gestionar</button>
        </div>`;
      pend.forEach(r=>{
        h+=`<div class="rec-pending">
          <div class="rec-info">
            <div class="rec-name">${esc(r.description)}</div>
            <div class="rec-meta">${esc(r.category)} · día ${r.day} · ${esc(r.who)} → ${esc(r.forWhom)}</div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="rec-amt">${fmt(r.amount)}</span>
            <button class="btn-pill" onclick="window._applyRec('${r.id}')">Registrar</button>
          </div>
        </div>`;
      });
      if(pend.length>1){
        h+=`<button class="btn-pill ghost" style="width:100%;margin-top:12px;min-height:46px" onclick="window._applyAllRec()">Registrar todos (${pend.length})</button>`;
      }
      h+=`</div>`;
    }else if(state.recurring.length>0){
      h+=`<div class="card card-sm" style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;color:var(--text2)">Fijos recurrentes del mes: todos registrados</div>
        <button class="link-btn" onclick="showView('recurring')">Gestionar</button>
      </div>`;
    }else{
      h+=`<div class="card card-sm" style="display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;color:var(--text2)">Define tus gastos fijos recurrentes</div>
        <button class="btn-add-sm" onclick="showView('recurring')">Configurar</button>
      </div>`;
    }
  }

  // Tracking de presupuesto por perfil: Total | Ariabo | Gabo | Ari
  // Se mide contra "para quién" (forWhom), no contra "quién pagó".
  const prof=state.summaryProfile;
  const isTotal=prof==="Total";
  const profSpent=isTotal?total:profileSpentTotal(exps,prof);
  const profBudget=isTotal?bt:profileBudgetTotal(state.budget,prof);

  if(showBudget){
    const tabs=["Total",...BUDGET_PROFILES];
    h+=`<div class="bud-tabs" style="margin-bottom:12px">
      ${tabs.map(p=>`<button class="bud-tab ${prof===p?"active":""}" onclick="window._sumProfile('${p}')">${p}</button>`).join("")}
    </div>`;
    if(profBudget>0){
      const ratio=profSpent/profBudget;
      const barColor=ratio>1.05?"var(--red)":ratio>=0.95?"var(--yellow)":"var(--green)";
      h+=`<div class="card">
        <div class="card-label">Presupuesto ${isTotal?"del mes":"de "+esc(prof)}</div>
        <div class="cat-row" style="margin-bottom:7px">
          <span class="cat-name">${fmt(profSpent)} de ${fmt(profBudget)}</span>
          <span class="cat-amount" style="color:${barColor}">${(ratio*100).toFixed(0)}%</span>
        </div>
        <div class="cat-bar-track" style="height:10px">
          <div class="cat-bar-fill" style="width:${Math.min(ratio*100,100)}%;background:${barColor}"></div>
        </div>
      </div>`;
    }else{
      h+=`<div class="card card-sm" style="font-size:13px;color:var(--text2)">
        ${esc(prof)} no tiene montos asignados en la plantilla de presupuesto.
      </div>`;
    }
  }else if(state.budgetLoaded){
    h+=`<div class="card" style="display:flex;align-items:center;justify-content:space-between">
      <div><div class="card-label" style="margin:0">Presupuesto</div>
      <div style="font-size:13px;color:var(--text2);margin-top:4px">Aún no has definido un presupuesto</div></div>
      <button class="btn-add-sm" onclick="showView('budget')">Definir</button>
    </div>`;
  }

  h+=`<div class="split-cards">
    <div class="card card-sm"><div class="who-label" style="color:var(--gabo)">Gabo pagó</div><div class="who-value">${fmt(gaboT)}</div></div>
    <div class="card card-sm"><div class="who-label" style="color:var(--ari)">Ari pagó</div><div class="who-value">${fmt(ariT)}</div></div>
  </div>
  <div class="split-cards">
    <div class="card card-sm"><div class="who-label" style="color:var(--ariabo)">Compartido (Ariabo)</div><div class="who-value">${fmt(ariaboT)}</div></div>
    <div class="card card-sm"><div class="who-label" style="color:var(--green)">Ingresos variables</div><div class="who-value">${fmt(totalInc)}</div></div>
  </div>`;

  const byCat=isTotal?spentByCat(exps):spentByCatProfile(exps,prof);
  const sorted=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);

  if(showBudget){
    h+=`<div class="section-title">Gastado vs presupuesto por categoría${isTotal?"":" · "+esc(prof)}</div>`;
    if(sorted.length===0){
      h+=`<div class="empty"><span class="empty-ico">○</span>${isTotal?"No hay gastos registrados este mes":"Sin gastos para "+esc(prof)+" este mes"}</div>`;
    }else{
      h+=`<div class="card">`;
      sorted.forEach(([cat,amt])=>{
        const cb=isTotal?catBudgetTotal(state.budget,cat):catBudgetProfile(state.budget,cat,prof);
        const st=catStatus(amt,cb);
        const col=st==="rojo"?"var(--red)":st==="amarillo"?"var(--yellow)":st==="verde"?"var(--green)":"var(--text3)";
        const pct=cb>0?(amt/cb)*100:0;
        const sub=cb>0?`${fmt(amt)} / ${fmt(cb)}`:`${fmt(amt)} · sin presupuesto`;
        h+=`<div class="cat-block">
          <div class="cat-row">
            <span class="cat-name">${esc(cat)}</span>
            <span class="cat-amount" style="color:${col}">${sub}${cb>0?` · ${pct.toFixed(0)}%`:""}</span>
          </div>
          <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${cb>0?Math.min(pct,100):0}%;background:${col}"></div></div>
        </div>`;
      });
      h+=`</div>`;
    }
  }else{
    h+=`<div class="section-title">Distribución por categoría</div>`;
    if(sorted.length===0){
      h+=`<div class="empty"><span class="empty-ico">○</span>No hay gastos registrados este mes</div>`;
    }else{
      h+=`<div class="card">`;
      sorted.forEach(([cat,amt])=>{
        const pct=total>0?(amt/total)*100:0;
        h+=`<div class="cat-block">
          <div class="cat-row"><span class="cat-name">${esc(cat)}</span><span class="cat-amount">${fmt(amt)} <span style="color:var(--text3);font-size:11px">${pct.toFixed(0)}%</span></span></div>
          <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${Math.min(pct,100)}%"></div></div>
        </div>`;
      });
      h+=`</div>`;
    }
  }
  c.innerHTML=h;
}

// ============================================================
// GASTOS + FILTROS COMBINABLES
// ============================================================
function currentFilters(){
  return{search:state.fSearch,cat:state.fCat,who:state.fWho,forWhom:state.fFor,
    min:state.fMin,max:state.fMax,from:state.fFrom,to:state.fTo};
}

function renderList(c){
  const exps=monthExpenses();
  const filtered=applyFilters(exps,currentFilters());
  const filteredTotal=filtered.reduce((s,e)=>s+e.amount,0);
  const allCats=[...FIXED_CAT,...VAR_CAT];
  const hasActiveFilter=state.fSearch||state.fCat!=="Todas"||state.fWho!=="Todos"||state.fFor!=="Todos"||state.fMin||state.fMax||state.fFrom||state.fTo;

  let h=`<div class="filter-bar">
    <input class="filter-search" id="flt_q" placeholder="Buscar por palabra clave..." value="${esc(state.fSearch)}" oninput="window._setF('fSearch',this.value)">
    <div class="filter-grid">
      <select onchange="window._setF('fCat',this.value)">
        <option value="Todas" ${state.fCat==="Todas"?"selected":""}>Todas las categorías</option>
        ${allCats.map(cat=>`<option value="${cat}" ${state.fCat===cat?"selected":""}>${cat}</option>`).join("")}
      </select>
      <select onchange="window._setF('fWho',this.value)">
        <option value="Todos" ${state.fWho==="Todos"?"selected":""}>Pagó: todos</option>
        ${WHO.map(w=>`<option value="${w}" ${state.fWho===w?"selected":""}>Pagó: ${w}</option>`).join("")}
      </select>
      <select onchange="window._setF('fFor',this.value)">
        <option value="Todos" ${state.fFor==="Todos"?"selected":""}>Para: todos</option>
        ${FOR_W.map(w=>`<option value="${w}" ${state.fFor===w?"selected":""}>Para: ${w}</option>`).join("")}
      </select>
      <input type="number" inputmode="decimal" placeholder="Monto mín." value="${esc(state.fMin)}" oninput="window._setF('fMin',this.value)">
      <input type="number" inputmode="decimal" placeholder="Monto máx." value="${esc(state.fMax)}" oninput="window._setF('fMax',this.value)">
    </div>
    <div class="filter-row2">
      <div style="flex:1"><span class="field-hint">Desde</span><input type="date" value="${esc(state.fFrom)}" oninput="window._setF('fFrom',this.value)"></div>
      <div style="flex:1"><span class="field-hint">Hasta</span><input type="date" value="${esc(state.fTo)}" oninput="window._setF('fTo',this.value)"></div>
    </div>
    <div class="filter-foot">
      <span class="filter-count">${filtered.length} gasto(s) — ${fmt(filteredTotal)}</span>
      ${hasActiveFilter?`<button class="filter-clear" onclick="window._clearF()">Limpiar filtros</button>`:``}
    </div>
  </div>`;

  if(filtered.length===0){
    h+=`<div class="empty"><span class="empty-ico">○</span>${exps.length===0?"No hay gastos este mes":"Ningún gasto coincide con los filtros"}</div>`;
  }else{
    filtered.forEach(e=>{
      h+=`<div class="exp-item">
        <div class="exp-left">
          <div class="exp-desc">${esc(e.description)} <span class="exp-tag ${(e.type||"").toLowerCase()}">${esc(e.type)}</span>${e.recurringId?`<span class="exp-tag rec">Recurrente</span>`:``}</div>
          <div class="exp-meta">${esc(e.category)} · ${esc(e.who)} → ${esc(e.forWhom)}</div>
          <div class="exp-date">${esc(e.date)}</div>
        </div>
        <div class="exp-right">
          <div class="exp-amount">${fmt(e.amount)}</div>
          <div class="exp-actions">
            <button class="btn-edit" onclick="window._editExp('${e.id}')" aria-label="Editar">✎</button>
            <button class="btn-del" onclick="window._confirmDel('${e.id}','exp')" aria-label="Eliminar">×</button>
          </div>
        </div>
      </div>`;
    });
  }
  c.innerHTML=h;
}

// ============================================================
// FLUJO DE ALTA + QUICK-ADD
// ============================================================
function renderFlow(c){
  if(state.editId)return renderFlowForm(c,true);
  if(state.flowStep===0)return renderFlowType(c);
  if(state.flowStep===1)return renderFlowCat(c);
  return renderFlowForm(c,false);
}

function flowDots(active){
  return `<div class="flow-steps">
    <div class="flow-dot ${active>0?"done":active===0?"active":""}"></div>
    <div class="flow-dot ${active>1?"done":active===1?"active":""}"></div>
    <div class="flow-dot ${active===2?"active":""}"></div>
  </div>`;
}

function renderFlowType(c){
  // Quick-add: frecuentes de los últimos 90 días
  const freq=computeFrequent(state.allExpenses,todayStr());
  let quick="";
  if(freq.length>0){
    quick=`<div class="quick-wrap">
      <div class="section-title" style="margin-top:4px">Frecuentes</div>
      <div class="quick-chips">
        ${freq.map((f,i)=>`<button class="quick-chip" onclick="window._quickAdd(${i})">
          <div>
            <div class="q-desc">${esc(f.description)}</div>
            <div class="q-meta">${esc(f.category)} · ${f.count} veces en 90 días</div>
          </div>
          <span class="q-amt">${fmt(f.lastAmount)}</span>
        </button>`).join("")}
      </div>
    </div>`;
    window._freqCache=freq;
  }
  c.innerHTML=`
  <div class="flow-head"><div class="flow-title">Nuevo gasto</div></div>
  ${quick}
  ${flowDots(0)}
  <div class="flow-sub">Paso 1 de 3 · ¿Qué tipo de gasto es?</div>
  <div class="choice-grid">
    <button class="choice-btn" onclick="window._flowType('Fijo')">
      <span class="ch-ico">FIJO</span>
      <span class="ch-main">Fijo</span>
      <span class="ch-sub">Recurrente y predecible</span>
    </button>
    <button class="choice-btn accent" onclick="window._flowType('Variable')">
      <span class="ch-ico">VAR</span>
      <span class="ch-main">Variable</span>
      <span class="ch-sub">Cambia mes a mes</span>
    </button>
  </div>`;
}

function renderFlowCat(c){
  const cats=state.flowType==="Fijo"?FIXED_CAT:VAR_CAT;
  c.innerHTML=`
  <div class="flow-head">
    <button class="flow-back" onclick="window._flowBack()" aria-label="Atrás">‹</button>
    <div class="flow-title">${state.flowType}</div>
  </div>
  ${flowDots(1)}
  <div class="flow-sub">Paso 2 de 3 · Elige la categoría</div>
  <div class="choice-grid">
    ${cats.map(cat=>`<button class="choice-btn" onclick="window._flowCat('${cat}')">
      <span class="ch-main">${cat}</span>
    </button>`).join("")}
  </div>`;
}

function renderFlowForm(c,isEdit){
  let e;
  if(isEdit){
    e=state.allExpenses.find(x=>x.id===state.editId);
    if(!e){showView("list");return}
  }else if(state.flowPrefill){
    e={...state.flowPrefill,date:todayInMonth()};
  }else{
    e={
      date:todayInMonth(),
      who:state.userName,
      forWhom:"Ariabo",
      type:state.flowType,
      category:state.flowCat,
      description:"",
      amount:""
    };
  }
  const whoOpts=WHO.map(x=>`<option value="${x}" ${e.who===x?"selected":""}>${x}</option>`).join("");
  const forOpts=FOR_W.map(x=>`<option value="${x}" ${e.forWhom===x?"selected":""}>${x}</option>`).join("");
  const allCats=(e.type==="Fijo")?FIXED_CAT:VAR_CAT;
  const catOpts=allCats.map(x=>`<option value="${x}" ${e.category===x?"selected":""}>${x}</option>`).join("");

  c.innerHTML=`
  <div class="flow-head">
    <button class="flow-back" onclick="${isEdit?"window._cancelEdit()":"window._flowBack()"}" aria-label="Atrás">‹</button>
    <div class="flow-title">${isEdit?"Editar gasto":esc(e.category)}</div>
  </div>
  ${isEdit?"":flowDots(2)}
  ${isEdit?"":`<div class="flow-sub">Paso 3 de 3 · ${esc(e.type)} · ${esc(e.category)}</div>`}
  <div class="form-fields">
    <div><label class="form-label">Descripción</label>
      <input type="text" class="form-input" id="fDesc" placeholder="Ej: Super El Rey, Uber al trabajo..." value="${esc(e.description)}"></div>
    <div class="form-row">
      <div><label class="form-label">Monto (USD)</label>
        <input type="number" inputmode="decimal" class="form-input" id="fAmt" placeholder="0.00" step="0.01" value="${e.amount||""}"></div>
      <div><label class="form-label">Fecha</label>
        <input type="date" class="form-input" id="fDate" value="${esc(e.date)}"></div>
    </div>
    <div class="form-row">
      <div><label class="form-label">Quién pagó</label><select class="form-input" id="fWho">${whoOpts}</select></div>
      <div><label class="form-label">Para quién</label><select class="form-input" id="fFor">${forOpts}</select></div>
    </div>
    ${isEdit?`<div><label class="form-label">Categoría</label><select class="form-input" id="fCatEdit">${catOpts}</select></div>`:``}
    <button class="btn-accent" onclick="window._submitExp(${isEdit})">${isEdit?"Guardar cambios":"Registrar gasto"}</button>
    <button class="btn-secondary" onclick="${isEdit?"window._cancelEdit()":"window._flowBack()"}">${isEdit?"Cancelar":"Atrás"}</button>
  </div>`;
}

// ============================================================
// RECURRENTES (gestión)
// ============================================================
function renderRecurring(c){
  const allCats=[...FIXED_CAT,...VAR_CAT];
  const editing=state.recEditId?state.recurring.find(r=>r.id===state.recEditId):null;
  const showForm=state.showRecForm||!!editing;
  const f=editing||{description:"",amount:"",category:FIXED_CAT[0],type:"Fijo",who:state.userName,forWhom:"Ariabo",day:1};

  let h=`<div class="flow-head">
    <button class="flow-back" onclick="showView('summary')" aria-label="Atrás">‹</button>
    <div class="flow-title">Gastos recurrentes</div>
  </div>
  <div class="flow-sub">Plantillas de gastos fijos que se repiten cada mes. Desde Resumen los registras con un toque.</div>`;

  h+=`<div class="card">
    <div class="income-header">
      <div class="card-label" style="margin:0">Plantillas</div>
      <button class="btn-add-sm" onclick="window._toggleRecForm()">${showForm?"Cerrar":"+ Agregar"}</button>
    </div>`;

  if(showForm){
    const catOpts=allCats.map(x=>`<option value="${x}" ${f.category===x?"selected":""}>${x}</option>`).join("");
    h+=`<div class="income-form">
      <input class="form-input" id="rDesc" placeholder="Descripción (ej: Alquiler, Internet)" value="${esc(f.description)}">
      <div class="form-row">
        <input type="number" inputmode="decimal" class="form-input" id="rAmt" placeholder="Monto" step="0.01" value="${f.amount||""}">
        <input type="number" inputmode="numeric" class="form-input" id="rDay" placeholder="Día del mes (1-31)" min="1" max="31" value="${f.day||""}">
      </div>
      <div class="form-row">
        <select class="form-input" id="rType" onchange="window._recTypeChange(this.value)">
          <option ${f.type==="Fijo"?"selected":""}>Fijo</option>
          <option ${f.type==="Variable"?"selected":""}>Variable</option>
        </select>
        <select class="form-input" id="rCat">${catOpts}</select>
      </div>
      <div class="form-row">
        <select class="form-input" id="rWho">${WHO.map(x=>`<option ${f.who===x?"selected":""}>${x}</option>`).join("")}</select>
        <select class="form-input" id="rFor">${FOR_W.map(x=>`<option ${f.forWhom===x?"selected":""}>${x}</option>`).join("")}</select>
      </div>
      <button class="btn-accent" onclick="window._saveRec()">${editing?"Guardar cambios":"Crear plantilla"}</button>
      ${editing?`<button class="btn-secondary" onclick="window._cancelRecEdit()">Cancelar</button>`:``}
    </div>`;
  }

  if(state.recurring.length===0&&!showForm){
    h+=`<div class="empty" style="padding:28px 0"><span class="empty-ico">○</span>Sin plantillas recurrentes.<br>Crea una para registrar tus fijos con un toque.</div>`;
  }
  state.recurring.forEach(r=>{
    h+=`<div class="rec-pending">
      <div class="rec-info">
        <div class="rec-name">${esc(r.description)}</div>
        <div class="rec-meta">${esc(r.category)} · día ${r.day} · ${esc(r.who)} → ${esc(r.forWhom)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <span class="rec-amt">${fmt(r.amount)}</span>
        <button class="btn-edit" style="width:34px;height:34px;border-radius:999px" onclick="window._editRec('${r.id}')" aria-label="Editar">✎</button>
        <button class="btn-del" style="width:34px;height:34px;border-radius:999px" onclick="window._confirmDel('${r.id}','rec')" aria-label="Eliminar">×</button>
      </div>
    </div>`;
  });
  h+=`</div>`;
  c.innerHTML=h;
}

// ============================================================
// PRESUPUESTO
// ============================================================
function currentBudgetData(){
  if(!state.budgetDraft){
    state.budgetDraft={};
    const all=[...FIXED_CAT,...VAR_CAT];
    all.forEach(cat=>{
      const ex=state.budget&&state.budget[cat];
      state.budgetDraft[cat]={
        Gabo:ex&&ex.Gabo!=null?ex.Gabo:"",
        Ari:ex&&ex.Ari!=null?ex.Ari:"",
        Ariabo:ex&&ex.Ariabo!=null?ex.Ariabo:""
      };
    });
  }
  return state.budgetDraft;
}

function renderBudget(c){
  const draft=currentBudgetData();
  const prof=state.budgetProfile;
  const all=[...FIXED_CAT,...VAR_CAT];

  let profTotal=0,globalTotal=0;
  all.forEach(cat=>{
    BUDGET_PROFILES.forEach(p=>{
      const v=parseFloat(draft[cat][p])||0;
      globalTotal+=v;
      if(p===prof)profTotal+=v;
    });
  });

  const tabBtn=(p)=>`<button class="bud-tab ${prof===p?"active":""}" onclick="window._budProfile('${p}')">${p}</button>`;

  let h=`<div class="flow-head"><div class="flow-title">Presupuesto</div></div>
  <div class="flow-sub">Plantilla mensual · se aplica a todos los meses. Medido contra "para quién".</div>
  <div class="bud-tabs">${BUDGET_PROFILES.map(tabBtn).join("")}</div>
  <div class="card" style="margin-bottom:14px;display:flex;justify-content:space-between;align-items:center">
    <div><div class="card-label" style="margin:0">Total ${esc(prof)}</div>
      <div class="card-value" style="font-size:22px;margin-top:4px">${fmt(profTotal)}</div></div>
    <div style="text-align:right"><div class="card-label" style="margin:0">Total hogar</div>
      <div class="who-value" style="margin-top:4px">${fmt(globalTotal)}</div></div>
  </div>`;

  const renderGroup=(title,cats)=>{
    let g=`<div class="section-title">${title}</div><div class="card">`;
    cats.forEach((cat,i)=>{
      g+=`<div class="bud-row" ${i===cats.length-1?'style="border-bottom:none"':''}>
        <span class="bud-cat">${esc(cat)}</span>
        <div class="bud-input-wrap">
          <span class="bud-currency">$</span>
          <input type="number" inputmode="decimal" class="bud-input" step="0.01" min="0"
            placeholder="0.00" value="${draft[cat][prof]}"
            oninput="window._budSet('${esc(cat)}','${prof}',this.value)">
        </div>
      </div>`;
    });
    g+=`</div>`;
    return g;
  };

  h+=renderGroup("Categorías fijas",FIXED_CAT);
  h+=renderGroup("Categorías variables",VAR_CAT);

  h+=`<button class="btn-accent" style="margin-top:6px" onclick="window._budSave()">Guardar presupuesto</button>
  <button class="btn-secondary" onclick="window._budReset()">Descartar cambios</button>`;

  c.innerHTML=h;
}

// ============================================================
// INGRESOS
// ============================================================
function renderIncome(c){
  const incs=monthIncome();
  const totalInc=incs.reduce((s,i)=>s+i.amount,0);
  let h=`<div class="card">
    <div class="card-label"><span class="sync-dot"></span> Ingresos variables del mes</div>
    <div class="card-value">${fmt(totalInc)}</div>
  </div>`;

  if(!state.incomeMigrated){
    h+=`<div class="card" style="border-color:var(--accent)">
      <div class="card-label" style="margin-bottom:6px">Migración pendiente</div>
      <div style="font-size:13px;color:var(--text2);line-height:1.5;margin-bottom:14px">
        Los ingresos pasan a una colección única con el mes derivado de la fecha,
        igual que los gastos. Esta migración copia los registros existentes y se
        ejecuta una sola vez. Los datos originales se conservan como respaldo.
      </div>
      <button class="btn-accent" id="migBtn" onclick="window._migrateIncome()">Migrar ingresos ahora</button>
    </div>`;
  }

  h+=`<div class="card">
    <div class="income-header">
      <div class="card-label" style="margin:0">Registros</div>
      <button class="btn-add-sm" onclick="window._toggleIncForm()">${state.showIncomeForm?"Cerrar":"+ Agregar"}</button>
    </div>`;
  if(state.showIncomeForm){
    h+=`<div class="income-form">
      <input type="date" class="form-input" id="iDate" value="${todayInMonth()}">
      <select class="form-input" id="iWho"><option ${state.userName==="Gabo"?"selected":""}>Gabo</option><option ${state.userName==="Ari"?"selected":""}>Ari</option></select>
      <input class="form-input" id="iSrc" placeholder="Fuente (ej: Comisión, Bono)">
      <input type="number" inputmode="decimal" class="form-input" id="iAmt" placeholder="Monto" step="0.01">
      <button class="btn-accent" onclick="window._addIncome()">Registrar ingreso</button>
    </div>`;
  }
  if(incs.length===0&&!state.showIncomeForm){
    h+=`<div class="empty" style="padding:28px 0"><span class="empty-ico">○</span>Sin ingresos variables este mes</div>`;
  }
  incs.forEach(inc=>{
    h+=`<div class="income-item">
      <div><div style="font-size:14px;font-weight:700">${esc(inc.source)}</div>
        <div style="font-size:12px;color:var(--text2);margin-top:2px">${esc(inc.who)} · ${esc(inc.date)}</div></div>
      <div style="display:flex;align-items:center;gap:12px">
        <div class="income-amount">+${fmt(inc.amount)}</div>
        <button class="btn-del" onclick="window._confirmDel('${inc.id}','inc')" style="width:34px;height:34px;border-radius:999px;font-size:15px;color:var(--red)">×</button>
      </div>
    </div>`;
  });
  h+=`</div>`;
  c.innerHTML=h;
}

// ============================================================
// Diálogo
// ============================================================
function showDialog(title,msg,onConfirm){
  const d=document.getElementById("dialog");
  d.className="dialog-overlay center";
  d.innerHTML=`<div class="dialog-box">
    <div class="dialog-title">${title}</div>
    <div class="dialog-msg">${msg}</div>
    <div class="dialog-btns">
      <button class="dialog-cancel" onclick="window._closeDialog()">Cancelar</button>
      <button class="dialog-confirm" onclick="window._dialogConfirm()">Eliminar</button>
    </div>
  </div>`;
  window._dialogOnConfirm=onConfirm;
}
window._closeDialog=function(){const d=document.getElementById("dialog");d.className="dialog-overlay hidden"};
window._dialogConfirm=function(){if(window._dialogOnConfirm)window._dialogOnConfirm();window._closeDialog()};

// ============================================================
// Handlers
// ============================================================
window._setF=function(k,v){
  state[k]=v;
  const act=document.activeElement;
  const id=act&&act.id?act.id:null;
  const pos=act&&typeof act.selectionStart==="number"?act.selectionStart:null;
  renderApp();
  if(id){
    const el=document.getElementById(id);
    if(el){
      el.focus();
      if(pos!==null&&typeof el.setSelectionRange==="function"){
        try{el.setSelectionRange(pos,pos)}catch(_){}
      }
    }
  }
};
window._clearF=function(){
  state.fSearch="";state.fCat="Todas";state.fWho="Todos";state.fFor="Todos";
  state.fMin="";state.fMax="";state.fFrom="";state.fTo="";
  renderApp();
};

// --- Presupuesto ---
window._budSet=function(cat,prof,val){
  const d=currentBudgetData();
  if(!d[cat])d[cat]={Gabo:"",Ari:"",Ariabo:""};
  d[cat][prof]=val;
};
window._budProfile=function(p){state.budgetProfile=p;renderApp()};
window._sumProfile=function(p){state.summaryProfile=p;renderApp()};
window._budReset=function(){state.budgetDraft=null;notify("Cambios descartados");renderApp()};
window._budSave=async function(){
  const d=currentBudgetData();
  const clean={};
  Object.keys(d).forEach(cat=>{
    const row={};
    let any=false;
    BUDGET_PROFILES.forEach(p=>{
      const n=parseFloat(d[cat][p]);
      if(!isNaN(n)&&n>0){row[p]=n;any=true}
    });
    if(any)clean[cat]=row;
  });
  try{
    await saveBudget(clean);
    state.budgetDraft=null;
    notify("Presupuesto guardado");
    showView("summary");
  }catch(e){
    notify("Error al guardar: "+(e.code||e.message||"desconocido"));
  }
};

// --- Flujo de alta ---
window._flowType=function(t){state.flowType=t;state.flowStep=1;renderApp()};
window._flowCat=function(cat){state.flowCat=cat;state.flowStep=2;renderApp()};
window._flowBack=function(){
  if(state.flowPrefill){state.flowPrefill=null;state.flowStep=0;renderApp();return}
  if(state.flowStep<=0){showView("summary");return}
  state.flowStep--;renderApp();
};
window._cancelEdit=function(){state.editId=null;showView("list")};
window._editExp=function(id){state.editId=id;state.view="add";document.querySelector(".scroll-area").scrollTop=0;renderApp()};

// --- Quick-add ---
window._quickAdd=function(i){
  const f=window._freqCache&&window._freqCache[i];
  if(!f)return;
  state.flowPrefill={
    type:f.type||"Variable",
    category:f.category,
    description:f.description,
    amount:f.lastAmount,
    who:state.userName,
    forWhom:f.forWhom||"Ariabo"
  };
  state.flowType=state.flowPrefill.type;
  state.flowCat=state.flowPrefill.category;
  state.flowStep=2;
  renderApp();
};

window._confirmDel=function(id,type){
  const msgs={exp:"gasto",inc:"ingreso",rec:"plantilla recurrente"};
  showDialog("Eliminar registro",`¿Seguro que quieres eliminar este ${msgs[type]||"registro"}? Esta acción no se puede deshacer.`,async()=>{
    if(type==="exp"){await removeExpense(id);notify("Gasto eliminado")}
    else if(type==="inc"){await removeIncome(id);notify("Ingreso eliminado")}
    else if(type==="rec"){await removeRecurring(id);notify("Plantilla eliminada")}
  });
};

window._submitExp=async function(isEdit){
  const desc=document.getElementById("fDesc").value.trim();
  const amt=parseFloat(document.getElementById("fAmt").value);
  const date=document.getElementById("fDate").value;
  if(!validExpense({description:desc,amount:amt,date})){notify("Completa descripción, monto y fecha");return}
  const entry={
    date,
    who:document.getElementById("fWho").value,
    forWhom:document.getElementById("fFor").value,
    description:desc,
    amount:amt,
  };
  if(isEdit){
    const e=state.allExpenses.find(x=>x.id===state.editId);
    entry.type=e.type;
    entry.category=document.getElementById("fCatEdit").value;
    if(e.recurringId)entry.recurringId=e.recurringId;
    await updateExpense(state.editId,entry);
    state.editId=null;
    notify("Gasto actualizado");
    showView("list");
  }else{
    entry.type=state.flowType;
    entry.category=state.flowCat;
    await addExpense(entry);
    notify("Gasto registrado");
    showView("summary");
  }
};

// --- Recurrentes ---
window._toggleRecForm=function(){state.showRecForm=!state.showRecForm;state.recEditId=null;renderApp()};
window._editRec=function(id){state.recEditId=id;state.showRecForm=false;renderApp()};
window._cancelRecEdit=function(){state.recEditId=null;renderApp()};
window._recTypeChange=function(type){
  // repoblar categorías según tipo sin perder el resto del form
  const sel=document.getElementById("rCat");
  const cats=type==="Fijo"?FIXED_CAT:VAR_CAT;
  sel.innerHTML=cats.map(x=>`<option>${x}</option>`).join("");
};
window._saveRec=async function(){
  const r={
    description:document.getElementById("rDesc").value.trim(),
    amount:parseFloat(document.getElementById("rAmt").value),
    day:parseInt(document.getElementById("rDay").value,10),
    type:document.getElementById("rType").value,
    category:document.getElementById("rCat").value,
    who:document.getElementById("rWho").value,
    forWhom:document.getElementById("rFor").value,
  };
  if(!validRecurring(r)){notify("Completa descripción, monto y día (1-31)");return}
  const wasEdit=!!state.recEditId;
  const id=state.recEditId||newId("rec");
  try{
    await saveRecurring(id,r);
    state.recEditId=null;state.showRecForm=false;
    notify(wasEdit?"Plantilla actualizada":"Plantilla guardada");
    renderApp();
  }catch(e){
    notify("Error al guardar: "+(e.code||e.message));
  }
};
window._applyRec=async function(id){
  const r=state.recurring.find(x=>x.id===id);
  if(!r)return;
  await addExpense(recurringToExpense(r,state.year,state.month));
  notify("Gasto registrado: "+r.description);
};
window._applyAllRec=async function(){
  const pend=pendingRecurring(state.recurring,monthExpenses());
  for(const r of pend){
    await addExpense(recurringToExpense(r,state.year,state.month));
  }
  notify(`${pend.length} gasto(s) registrados`);
};

// --- Ingresos ---
window._toggleIncForm=function(){state.showIncomeForm=!state.showIncomeForm;renderApp()};
window._addIncome=async function(){
  const date=document.getElementById("iDate").value;
  const who=document.getElementById("iWho").value;
  const source=document.getElementById("iSrc").value.trim();
  const amount=parseFloat(document.getElementById("iAmt").value);
  if(!date||!source||!amount){notify("Completa todos los campos");return}
  await addIncome({date,who,source,amount});
  state.showIncomeForm=false;
  notify("Ingreso registrado");
  renderApp();
};

// --- Export CSV (formato estable: el pipeline de reportes depende de él) ---
window.exportCSV=function(){
  const exps=monthExpenses();
  const incs=monthIncome();
  if(exps.length===0&&incs.length===0){notify("No hay datos para exportar");return}
  const header="Fecha,Quien Pago,Para Quien,Tipo,Categoria,Descripcion,Monto\n";
  const rows=exps.map(e=>`${e.date},${e.who},${e.forWhom},${e.type},${e.category},"${(e.description||"").replace(/"/g,'""')}",${e.amount}`).join("\n");
  let incSection="";
  if(incs.length>0){
    incSection="\n\nIngresos Variables\nFecha,Quien,Fuente,Monto\n";
    incSection+=incs.map(i=>`${i.date},${i.who},"${(i.source||"").replace(/"/g,'""')}",${i.amount}`).join("\n");
  }
  const csv="\uFEFF"+header+rows+incSection;
  const blob=new Blob([csv],{type:"text/csv;charset=utf-8;"});
  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=`Ariabo_${MONTHS[state.month]}_${state.year}.csv`;
  a.click();URL.revokeObjectURL(url);
  notify("CSV descargado");
};

// Service worker
if("serviceWorker" in navigator){
  navigator.serviceWorker.register("sw.js").catch(()=>{});
}
