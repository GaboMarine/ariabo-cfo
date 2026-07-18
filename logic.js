// ============================================================
// Ariabo CFO — logic.js
// Lógica pura: sin Firebase, sin DOM. Testeable en Node.
// ============================================================

export const MONTHS=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
export const FIXED_CAT=["Vivienda","Servicios","Seguros","Suscripciones","Ahorro/Inversión"];
export const VAR_CAT=["Restaurantes","Delivery","Supermercado","Uber","Gasolina","Salud","Cuidado personal","Entretenimiento","Compras","Varios"];
export const WHO=["Gabo","Ari"];
export const FOR_W=["Ariabo","Gabo","Ari"];
export const BUDGET_PROFILES=["Ariabo","Gabo","Ari"];

// ---------- Fechas y formato ----------
export function expMonthYear(dateStr){
  if(!dateStr||typeof dateStr!=="string")return{m:-1,y:-1};
  const p=dateStr.split("-");
  return{y:parseInt(p[0],10),m:parseInt(p[1],10)-1};
}
export function inMonth(item,month,year){
  const{m,y}=expMonthYear(item.date);
  return m===month&&y===year;
}
export function fmt(n){return "$"+Number(n||0).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",")}
export function esc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
export function daysInMonth(year,month){return new Date(year,month+1,0).getDate()}
// Fecha YYYY-MM-DD para un día fijo del mes, ajustado a meses cortos
export function recurringDate(year,month,day){
  const d=Math.min(Math.max(1,Number(day)||1),daysInMonth(year,month));
  return `${year}-${String(month+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

// ---------- Presupuesto ----------
export function hasBudget(budget){
  if(!budget)return false;
  return Object.values(budget).some(p=>p&&BUDGET_PROFILES.some(k=>Number(p[k])>0));
}
export function catBudgetTotal(budget,cat){
  const p=budget&&budget[cat];
  if(!p)return 0;
  return BUDGET_PROFILES.reduce((s,k)=>s+(Number(p[k])||0),0);
}
export function budgetTotal(budget){
  if(!budget)return 0;
  return Object.keys(budget).reduce((s,cat)=>s+catBudgetTotal(budget,cat),0);
}
export function spentByCat(expenses){
  const map={};
  expenses.forEach(e=>{map[e.category]=(map[e.category]||0)+e.amount});
  return map;
}
// ---------- Presupuesto por perfil ----------
// El presupuesto se mide contra "para quién" (forWhom), no "quién pagó".
export function catBudgetProfile(budget,cat,profile){
  const p=budget&&budget[cat];
  return p?(Number(p[profile])||0):0;
}
export function profileBudgetTotal(budget,profile){
  if(!budget)return 0;
  return Object.keys(budget).reduce((s,cat)=>s+catBudgetProfile(budget,cat,profile),0);
}
export function spentByCatProfile(expenses,profile){
  const map={};
  expenses.filter(e=>e.forWhom===profile)
    .forEach(e=>{map[e.category]=(map[e.category]||0)+e.amount});
  return map;
}
export function profileSpentTotal(expenses,profile){
  return expenses.filter(e=>e.forWhom===profile).reduce((s,e)=>s+e.amount,0);
}
export function catStatus(spent,budget){
  if(budget<=0)return"none";
  const r=spent/budget;
  if(r>1.15)return"rojo";
  if(r>1)return"amarillo";
  if(r>0.9)return"amarillo";
  return"verde";
}
// Umbrales aprobados: verde <=95% sin cat excedida >15%;
// amarillo 95-105% o alguna cat sobrepasada; rojo >105% o cat excedida >15%
export function monthGrade(expenses,budget){
  if(!hasBudget(budget))return{grade:"none",txt:"Sin presupuesto"};
  const total=expenses.reduce((s,e)=>s+e.amount,0);
  const bt=budgetTotal(budget);
  if(bt<=0)return{grade:"none",txt:"Sin presupuesto"};
  const spent=spentByCat(expenses);
  let catExcedida=false,catSobrepasada=false;
  Object.keys(budget).forEach(cat=>{
    const cb=catBudgetTotal(budget,cat);
    if(cb<=0)return;
    const sp=spent[cat]||0;
    if(sp/cb>1.15)catExcedida=true;
    if(sp>cb)catSobrepasada=true;
  });
  const ratio=total/bt;
  if(ratio>1.05||catExcedida)return{grade:"rojo",txt:"Sobre presupuesto"};
  if(ratio>=0.95||catSobrepasada)return{grade:"amarillo",txt:"Al límite"};
  return{grade:"verde",txt:"Dentro de presupuesto"};
}

// ---------- Filtros combinables ----------
// filters: {search, cat, who, forWhom, min, max, from, to}
export function applyFilters(exps,f){
  const q=(f.search||"").trim().toLowerCase();
  const min=f.min!==""&&f.min!=null?parseFloat(f.min):null;
  const max=f.max!==""&&f.max!=null?parseFloat(f.max):null;
  return exps.filter(e=>{
    if(q){
      const hay=(e.description||"").toLowerCase()+" "+(e.category||"").toLowerCase()+" "+(e.who||"").toLowerCase()+" "+(e.forWhom||"").toLowerCase();
      if(!hay.includes(q))return false;
    }
    if(f.cat&&f.cat!=="Todas"&&e.category!==f.cat)return false;
    if(f.who&&f.who!=="Todos"&&e.who!==f.who)return false;
    if(f.forWhom&&f.forWhom!=="Todos"&&e.forWhom!==f.forWhom)return false;
    if(min!==null&&e.amount<min)return false;
    if(max!==null&&e.amount>max)return false;
    if(f.from&&(e.date||"")<f.from)return false;
    if(f.to&&(e.date||"")>f.to)return false;
    return true;
  });
}

// ---------- Quick-add: gastos frecuentes ----------
// Agrupa por descripción normalizada + categoría dentro de una ventana de días.
// Devuelve hasta `limit` plantillas ordenadas por frecuencia, con el monto
// más reciente como sugerencia. Requiere frecuencia mínima de 2.
export function computeFrequent(allExpenses,refDateStr,windowDays=90,limit=6){
  const ref=new Date(refDateStr+"T00:00:00");
  const cutoff=new Date(ref.getTime()-windowDays*86400000);
  const groups={};
  allExpenses.forEach(e=>{
    if(!e.date||!e.description)return;
    const d=new Date(e.date+"T00:00:00");
    if(isNaN(d)||d<cutoff||d>ref)return;
    const key=e.description.trim().toLowerCase()+"|"+e.category;
    if(!groups[key])groups[key]={description:e.description.trim(),category:e.category,type:e.type,forWhom:e.forWhom,count:0,lastDate:"",lastAmount:0};
    const g=groups[key];
    g.count++;
    if(e.date>g.lastDate){g.lastDate=e.date;g.lastAmount=e.amount;g.type=e.type;g.forWhom=e.forWhom}
  });
  return Object.values(groups)
    .filter(g=>g.count>=2)
    .sort((a,b)=>b.count-a.count||b.lastDate.localeCompare(a.lastDate))
    .slice(0,limit);
}

// ---------- Gastos fijos recurrentes ----------
// Un recurrente está pendiente en el mes si ningún gasto del mes lo referencia
// vía recurringId.
export function pendingRecurring(recurringList,monthExps){
  const applied=new Set(monthExps.map(e=>e.recurringId).filter(Boolean));
  return recurringList.filter(r=>!applied.has(r.id));
}
// Convierte una plantilla recurrente en un gasto del mes indicado
export function recurringToExpense(r,year,month){
  return{
    date:recurringDate(year,month,r.day),
    who:r.who,
    forWhom:r.forWhom,
    type:r.type||"Fijo",
    category:r.category,
    description:r.description,
    amount:Number(r.amount),
    recurringId:r.id
  };
}

// ---------- Validaciones ----------
export function validExpense(e){
  return !!(e.description&&e.date&&Number(e.amount)>0);
}
export function validRecurring(r){
  const day=Number(r.day);
  return !!(r.description&&Number(r.amount)>0&&r.category&&day>=1&&day<=31);
}
