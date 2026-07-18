// Tests aislados de logic.js — node test_logic.mjs
import{
  expMonthYear,inMonth,fmt,recurringDate,daysInMonth,
  hasBudget,catBudgetTotal,budgetTotal,catStatus,monthGrade,
  applyFilters,computeFrequent,pendingRecurring,recurringToExpense,
  validExpense,validRecurring,
  catBudgetProfile,profileBudgetTotal,spentByCatProfile,profileSpentTotal
}from"./logic.js";

let pass=0,fail=0;
function eq(name,a,b){
  const ok=JSON.stringify(a)===JSON.stringify(b);
  if(ok){pass++}else{fail++;console.log(`FAIL ${name}\n  got:      ${JSON.stringify(a)}\n  expected: ${JSON.stringify(b)}`)}
}

// --- Fechas ---
eq("expMonthYear",expMonthYear("2026-06-12"),{y:2026,m:5});
eq("expMonthYear inválido",expMonthYear(null),{m:-1,y:-1});
eq("inMonth true",inMonth({date:"2026-06-01"},5,2026),true);
eq("inMonth false",inMonth({date:"2026-05-31"},5,2026),false);
eq("fmt",fmt(1234.5),"$1,234.50");
eq("daysInMonth feb 2026",daysInMonth(2026,1),28);
eq("recurringDate normal",recurringDate(2026,5,15),"2026-06-15");
eq("recurringDate día 31 en junio",recurringDate(2026,5,31),"2026-06-30");
eq("recurringDate día 31 en febrero",recurringDate(2026,1,31),"2026-02-28");

// --- Presupuesto / grading ---
const budget={Vivienda:{Ariabo:1000},Supermercado:{Gabo:200,Ari:200}};
eq("hasBudget",hasBudget(budget),true);
eq("hasBudget vacío",hasBudget(null),false);
eq("catBudgetTotal",catBudgetTotal(budget,"Supermercado"),400);
eq("budgetTotal",budgetTotal(budget),1400);
eq("catStatus verde",catStatus(300,400),"verde");
eq("catStatus amarillo 0.95",catStatus(380,400),"amarillo");
eq("catStatus rojo",catStatus(470,400),"rojo");
eq("catStatus sin presupuesto",catStatus(100,0),"none");

// verde: total 80% sin categorías excedidas
eq("monthGrade verde",
  monthGrade([{category:"Vivienda",amount:800},{category:"Supermercado",amount:320}],budget).grade,
  "verde");
// amarillo: total dentro pero una categoría sobrepasada
eq("monthGrade amarillo por categoría",
  monthGrade([{category:"Supermercado",amount:430}],budget).grade,
  "amarillo");
// rojo: una categoría excedida >15%
eq("monthGrade rojo por categoría >15%",
  monthGrade([{category:"Supermercado",amount:470}],budget).grade,
  "rojo");
// rojo: total >105%
eq("monthGrade rojo por total",
  monthGrade([{category:"Vivienda",amount:1000},{category:"Supermercado",amount:400},{category:"Varios",amount:200}],budget).grade,
  "rojo");
// categorías sin presupuesto suman al total pero no disparan alerta por sí solas
eq("monthGrade cat sin presupuesto no alerta",
  monthGrade([{category:"Varios",amount:50},{category:"Vivienda",amount:500}],budget).grade,
  "verde");

// --- Filtros combinables ---
const exps=[
  {description:"Super El Rey",category:"Supermercado",who:"Gabo",forWhom:"Ariabo",amount:80,date:"2026-06-02"},
  {description:"Uber oficina",category:"Uber",who:"Ari",forWhom:"Ari",amount:6,date:"2026-06-03"},
  {description:"Netflix",category:"Suscripciones",who:"Gabo",forWhom:"Ariabo",amount:15,date:"2026-06-05"},
  {description:"Almuerzo",category:"Restaurantes",who:"Ari",forWhom:"Ariabo",amount:25,date:"2026-06-10"},
];
eq("filtro persona",applyFilters(exps,{who:"Ari"}).length,2);
eq("filtro persona+categoría combinados",applyFilters(exps,{who:"Ari",cat:"Uber"}).length,1);
eq("filtro forWhom",applyFilters(exps,{forWhom:"Ariabo"}).length,3);
eq("filtro persona+forWhom",applyFilters(exps,{who:"Ari",forWhom:"Ariabo"}).length,1);
eq("filtro search+persona",applyFilters(exps,{search:"uber",who:"Ari"}).length,1);
eq("filtro monto+persona",applyFilters(exps,{who:"Gabo",min:50}).length,1);
eq("filtro fechas",applyFilters(exps,{from:"2026-06-04",to:"2026-06-30"}).length,2);
eq("sin filtros devuelve todo",applyFilters(exps,{}).length,4);

// --- Quick-add frecuentes ---
const hist=[
  {description:"Super El Rey",category:"Supermercado",type:"Variable",forWhom:"Ariabo",amount:75,date:"2026-05-10"},
  {description:"Super El Rey",category:"Supermercado",type:"Variable",forWhom:"Ariabo",amount:82,date:"2026-06-01"},
  {description:"super el rey",category:"Supermercado",type:"Variable",forWhom:"Ariabo",amount:90,date:"2026-06-08"},
  {description:"Uber oficina",category:"Uber",type:"Variable",forWhom:"Ari",amount:6,date:"2026-06-03"},
  {description:"Gasto viejo",category:"Varios",type:"Variable",forWhom:"Ariabo",amount:10,date:"2025-01-01"},
  {description:"Gasto viejo",category:"Varios",type:"Variable",forWhom:"Ariabo",amount:10,date:"2025-01-15"},
];
const freq=computeFrequent(hist,"2026-06-12");
eq("frecuentes: solo grupos con 2+ dentro de ventana",freq.length,1);
eq("frecuentes: agrupa case-insensitive",freq[0].count,3);
eq("frecuentes: monto más reciente",freq[0].lastAmount,90);
eq("frecuentes: fuera de ventana excluido",freq.some(f=>f.description==="Gasto viejo"),false);

// --- Recurrentes ---
const recs=[
  {id:"rec_1",description:"Alquiler",amount:900,category:"Vivienda",type:"Fijo",who:"Gabo",forWhom:"Ariabo",day:1},
  {id:"rec_2",description:"Internet",amount:45,category:"Servicios",type:"Fijo",who:"Ari",forWhom:"Ariabo",day:5},
];
const monthExps=[{id:"e1",recurringId:"rec_1",date:"2026-06-01",amount:900}];
const pend=pendingRecurring(recs,monthExps);
eq("recurrentes pendientes",pend.map(r=>r.id),["rec_2"]);
const gen=recurringToExpense(recs[1],2026,5);
eq("recurrente→gasto fecha",gen.date,"2026-06-05");
eq("recurrente→gasto vincula plantilla",gen.recurringId,"rec_2");
eq("recurrente→gasto campos",[gen.who,gen.forWhom,gen.type,gen.category,gen.amount],["Ari","Ariabo","Fijo","Servicios",45]);

// --- Validaciones ---
eq("validExpense ok",validExpense({description:"x",amount:5,date:"2026-06-01"}),true);
eq("validExpense sin monto",validExpense({description:"x",amount:0,date:"2026-06-01"}),false);
eq("validRecurring ok",validRecurring({description:"x",amount:5,category:"Vivienda",day:15}),true);
eq("validRecurring día inválido",validRecurring({description:"x",amount:5,category:"Vivienda",day:32}),false);


// --- Presupuesto por perfil ---
const budgetP={Vivienda:{Ariabo:1000},Supermercado:{Gabo:200,Ari:150,Ariabo:100},Uber:{Ari:80}};
eq("catBudgetProfile",catBudgetProfile(budgetP,"Supermercado","Ari"),150);
eq("catBudgetProfile sin monto",catBudgetProfile(budgetP,"Vivienda","Gabo"),0);
eq("profileBudgetTotal Ari",profileBudgetTotal(budgetP,"Ari"),230);
eq("profileBudgetTotal Ariabo",profileBudgetTotal(budgetP,"Ariabo"),1100);
const expsP=[
  {category:"Supermercado",forWhom:"Ariabo",amount:60},
  {category:"Supermercado",forWhom:"Ari",amount:40},
  {category:"Uber",forWhom:"Ari",amount:25},
  {category:"Vivienda",forWhom:"Ariabo",amount:1000},
];
eq("spentByCatProfile Ari",spentByCatProfile(expsP,"Ari"),{Supermercado:40,Uber:25});
eq("profileSpentTotal Ari",profileSpentTotal(expsP,"Ari"),65);
eq("profileSpentTotal Ariabo",profileSpentTotal(expsP,"Ariabo"),1060);
eq("profileSpentTotal sin gastos",profileSpentTotal(expsP,"Gabo"),0);

console.log(`\n${pass} pasaron, ${fail} fallaron`);
process.exit(fail?1:0);
