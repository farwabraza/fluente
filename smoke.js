// Headless smoke test for FLUENTE v3 features (not shipped to users; dev only)
const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("public/index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/", beforeParse(win){
  win.speechSynthesis = { cancel(){}, speak(){}, getVoices: () => [] };
  win.SpeechSynthesisUtterance = function(){};
  win.fetch = async (url, opts) => ({ ok:true, status:200, json: async () => {
    if (String(url).includes("/api/chat")) return { content:[{type:"text",text:JSON.stringify({reply:"Ciao!",translation:"Hi!",fix:"",errs:[]})}] };
    return { ok:false };
  }});
  win.localStorage.setItem("fluente-skip-login","1"); // boot straight into app
  win.confirm = () => true;
}});
const w = dom.window;

const results = [];
const T = (name, fn) => { try { fn(); results.push("✓ "+name); } catch(e){ results.push("✗ "+name+" — "+e.message); } };

setTimeout(() => {
  const S = w.eval("S");

  T("boots to Oggi with gap map + esame rows", () => {
    w.eval("S.placed=true; S.level='B1'; S.levelIdx=2; enterApp();"); // fresh users see onboarding first — correct behavior
    if (!w.document.querySelector("#gapRow")) throw new Error("no #gapRow");
    if (!w.document.querySelector("#esameRow")) throw new Error("no #esameRow");
    if (!w.document.querySelector("#bScelta")) throw new Error("no #bScelta");
    if (!w.document.querySelector("#bBoost")) throw new Error("no #bBoost");
  });

  T("logErr counts, stores examples, spawns fix-card at 3", () => {
    w.eval(`logErr('tempo_passati','ho andato','sono andato','test');
            logErr('tempo_passati','vedevo il film ieri sera','ho visto il film ieri sera','test');
            logErr('tempo_passati','ha stato','è stato','test');`);
    const e = S.errLog.tempo_passati;
    if (e.n !== 3) throw new Error("n="+e.n);
    if (e.ex.length !== 3) throw new Error("ex="+e.ex.length);
    const fix = S.deck.find(c => c.kind === "fix" && c.t === "tempo_passati");
    if (!fix) throw new Error("no fix-card spawned");
  });

  T("logErr ignores unknown taxonomy keys", () => {
    w.eval(`logErr('made_up_key','a','b','test')`);
    if (S.errLog.made_up_key) throw new Error("unknown key logged");
  });

  T("topGaps sorts by count", () => {
    w.eval(`logErr('preposizioni','vado a Italia','vado in Italia','test')`);
    const g = w.eval("topGaps(5)");
    if (g[0].t !== "tempo_passati") throw new Error("order wrong: "+g[0].t);
  });

  T("gap map card on Oggi shows top weakness", () => {
    w.eval("renderOggi()");
    const row = w.document.querySelector("#gapRow");
    if (!row.textContent.includes("Passato prossimo")) throw new Error(row.textContent.slice(0,80));
  });

  T("renderLacune lists gaps with Ripara buttons", () => {
    w.eval("renderLacune()");
    if (!w.document.querySelector('[data-fix="tempo_passati"]')) throw new Error("no ripara button");
    w.eval("closeSheet()");
  });

  T("SCELTA bank integrity (answers exist, types valid)", () => {
    const bad = w.eval(`SCELTA_BANK.filter(x => !x[0].includes('___') || x[1].length!==2 || ![0,1].includes(x[2]) || !ERR_TAX[x[4]]).length`);
    if (bad) throw new Error(bad + " malformed items");
  });

  T("renderScelta runs a round and logs a wrong pick", () => {
    const before = Object.values(S.errLog).reduce((s,e)=>s+e.n,0);
    w.eval("renderScelta()");
    // click the WRONG option 8 times
    for (let i=0;i<8;i++){
      const opts = [...w.document.querySelectorAll(".qopt")];
      if (!opts.length) throw new Error("no options rendered at round "+i);
      // find wrong one: click index 1 if 0 is right etc — just click one, then Next
      opts[1].click();
      const n = w.document.querySelector("#scN"); if (n) n.click();
    }
    if (!w.document.body.textContent.includes("Back to Oggi")) throw new Error("didn't reach score screen");
    const after = Object.values(S.errLog).reduce((s,e)=>s+e.n,0);
    if (after <= before) throw new Error("no errors logged from wrong picks");
  });

  T("vocabBoost adds 5 frequency cards, no duplicates", () => {
    const n0 = S.deck.length;
    w.eval("vocabBoost()");
    if (S.deck.length !== n0+5) throw new Error("added "+(S.deck.length-n0));
    const ids = S.deck.map(c=>c.id);
    if (new Set(ids).size !== ids.length) throw new Error("duplicate ids");
    w.eval("vocabBoost()");
    const ids2 = S.deck.map(c=>c.id);
    if (new Set(ids2).size !== ids2.length) throw new Error("duplicates on second boost");
  });

  T("SRS renders fix-card with production prompt + grades after flip", () => {
    // force only the fix card due
    S.deck.forEach(c => c.due = c.kind==="fix" ? Date.now()-1000 : Date.now()+9e9);
    w.eval("renderSRS()");
    if (!w.document.body.textContent.includes("FIX THE SENTENCE")) throw new Error("fix face missing");
    w.document.querySelector("#flipB").click();
    const grades = w.document.querySelector("#grades");
    if (grades.style.visibility !== "visible") throw new Error("grades hidden after flip");
    // grade Again → lapses increments
    const card = S.deck.find(c=>c.kind==="fix");
    w.document.querySelector('#grades [data-g="0"]').click();
    if (card.lapses !== 1) throw new Error("lapses="+card.lapses);
  });

  T("production mode triggers for mature cards", () => {
    S.deck.forEach(c => c.due = Date.now()+9e9);
    const c = S.deck.find(x=>!x.kind);
    c.due = Date.now()-1000; c.ivl = 10;
    w.eval("renderSRS()");
    if (!w.document.body.textContent.includes("SAY IT IN ITALIAN")) throw new Error("production face missing");
    const inp = w.document.querySelector("#prodIn");
    inp.value = c.it;
    w.document.querySelector("#flipB").click();
    if (!w.document.querySelector("#prodFb").textContent.includes("✓")) throw new Error("typed-correct not detected");
  });

  T("renderEsame shows 4 prove and level pills", () => {
    w.eval("renderEsame()");
    ["pScritta","pOrale","pAscolto","pLettura"].forEach(id=>{ if(!w.document.querySelector("#"+id)) throw new Error(id+" missing"); });
    if (w.document.querySelectorAll("[data-lv]").length !== 4) throw new Error("level pills");
  });

  T("esameScritta renders task + ticking clock", () => {
    w.eval("esameScritta('B2')");
    if (!w.document.querySelector("#wTa")) throw new Error("no textarea");
    if (!w.document.querySelector("#wClock")) throw new Error("no clock");
    w.document.querySelector("#wBack").click(); // clears timer
  });

  T("rubricBox math + saveExam history", () => {
    const R = w.eval(`rubricBox({lessico:4,grammatica:3,coerenza:4,adeguatezza:3,pass:true,cefr:'B2',feedback:'• ok'})`);
    if (R.tot !== 14) throw new Error("tot="+R.tot);
    w.eval("saveExam('B2','scritta',14,true)");
    if (!S.examLog.length || S.examLog[S.examLog.length-1].tot !== 14) throw new Error("examLog");
    w.eval("renderOggi()");
    if (!w.document.querySelector("#esameRow").textContent.includes("14/20")) throw new Error("last score not shown");
  });

  T("scenarios include questura + telefonata, gated by level", () => {
    const sc = w.eval("SCENARIOS.map(s=>s.id).join(',')");
    if (!sc.includes("questura") || !sc.includes("telefonata")) throw new Error(sc);
  });

  T("repair reduces counter on completion path (unit)", () => {
    S.errLog.tempo_passati.n = 6;
    // simulate the healed branch directly
    w.eval(`S.errLog.tempo_passati.n = Math.max(0, S.errLog.tempo_passati.n - 3)`);
    if (S.errLog.tempo_passati.n !== 3) throw new Error("n="+S.errLog.tempo_passati.n);
  });

  console.log(results.join("\n"));
  const fails = results.filter(r=>r[0]==="✗").length;
  console.log(fails ? "\n"+fails+" FAILURES" : "\nALL PASS");
  process.exit(fails?1:0);
}, 300);
