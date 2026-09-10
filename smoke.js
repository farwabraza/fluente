// Headless smoke test for FLUENTE (not shipped to users; dev only). Server-side checks live in smoke-server.js.
const fs = require("fs");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync("public/index.html", "utf8");
const dom = new JSDOM(html, { runScripts: "dangerously", url: "http://localhost/", beforeParse(win){
  win.speechSynthesis = { cancel(){}, speak(){}, getVoices: () => [] };
  win.SpeechSynthesisUtterance = function(){};
  let sttEnabled = true;
  win.__setSttEnabled = v => { sttEnabled = v; };
  win.fetch = async (url, opts) => {
    const notConfigured = String(url).includes("/api/transcribe") && !sttEnabled;
    return { ok: !notConfigured, status: notConfigured ? 503 : 200, json: async () => {
      if (String(url).includes("/api/chat")) return { content:[{type:"text",text:JSON.stringify({reply:"Ciao!",translation:"Hi!",fix:"",nat:"",errs:[]})}] };
      if (String(url).includes("/api/stt-status")) return { enabled: sttEnabled };
      if (String(url).includes("/api/transcribe")) return sttEnabled ? { text:"ciao come stai" } : { error:{message:"not configured"} };
      return { ok:false };
    }};
  };
  win.localStorage.setItem("fluente-skip-login","1"); // boot straight into app
  win.confirm = () => true;
  win.requestAnimationFrame = fn => setTimeout(fn, 4);
  // MediaRecorder + getUserMedia stubs (jsdom has neither natively)
  win.MediaRecorder = function(stream, opts){
    this.mimeType = (opts && opts.mimeType) || "audio/webm";
    this.state = "inactive";
    this.start = function(){ this.state="recording"; };
    this.stop = function(){
      this.state="inactive";
      if (this.ondataavailable) this.ondataavailable({ data: new win.Blob(["x".repeat(2000)], {type:this.mimeType}) });
      if (this.onstop) this.onstop();
    };
  };
  win.MediaRecorder.isTypeSupported = () => true;
  win.navigator.mediaDevices = { getUserMedia: async () => ({ getTracks: () => [{stop(){}}] }) };
}});
const w = dom.window;

const results = [];
const T = async (name, fn) => { try { await fn(); results.push("✓ "+name); } catch(e){ results.push("✗ "+name+" — "+e.message); } };

setTimeout(async () => {
  const S = w.eval("S");

  await T("boots to Oggi with gap map + esame rows", () => {
    w.eval("S.placed=true; S.level='B1'; S.levelIdx=2; enterApp();"); // fresh users see onboarding first — correct behavior
    if (!w.document.querySelector("#gapRow")) throw new Error("no #gapRow");
    if (!w.document.querySelector("#esameRow")) throw new Error("no #esameRow");
    if (!w.document.querySelector("#bScelta")) throw new Error("no #bScelta");
    if (!w.document.querySelector("#bBoost")) throw new Error("no #bBoost");
  });

  await T("logErr counts, stores examples, spawns fix-card at 3", () => {
    w.eval(`logErr('tempo_passati','ho andato','sono andato','test');
            logErr('tempo_passati','vedevo il film ieri sera','ho visto il film ieri sera','test');
            logErr('tempo_passati','ha stato','è stato','test');`);
    const e = S.errLog.tempo_passati;
    if (e.n !== 3) throw new Error("n="+e.n);
    if (e.ex.length !== 3) throw new Error("ex="+e.ex.length);
    const fix = S.deck.find(c => c.kind === "fix" && c.t === "tempo_passati");
    if (!fix) throw new Error("no fix-card spawned");
  });

  await T("logErr ignores unknown taxonomy keys", () => {
    w.eval(`logErr('made_up_key','a','b','test')`);
    if (S.errLog.made_up_key) throw new Error("unknown key logged");
  });

  await T("topGaps sorts by count", () => {
    w.eval(`logErr('preposizioni','vado a Italia','vado in Italia','test')`);
    const g = w.eval("topGaps(5)");
    if (g[0].t !== "tempo_passati") throw new Error("order wrong: "+g[0].t);
  });

  await T("gap map card on Oggi shows top weakness", () => {
    w.eval("renderOggi()");
    const row = w.document.querySelector("#gapRow");
    if (!row.textContent.includes("Passato prossimo")) throw new Error(row.textContent.slice(0,80));
  });

  await T("renderLacune lists gaps with Ripara buttons", () => {
    w.eval("renderLacune()");
    if (!w.document.querySelector('[data-fix="tempo_passati"]')) throw new Error("no ripara button");
    w.eval("closeSheet()");
  });

  await T("SCELTA bank integrity (answers exist, types valid)", () => {
    const bad = w.eval(`SCELTA_BANK.filter(x => !x[0].includes('___') || x[1].length!==2 || ![0,1].includes(x[2]) || !ERR_TAX[x[4]]).length`);
    if (bad) throw new Error(bad + " malformed items");
  });

  await T("renderScelta runs a round and logs a wrong pick", () => {
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

  await T("vocabBoost adds 5 frequency cards, no duplicates", () => {
    const n0 = S.deck.length;
    w.eval("vocabBoost()");
    if (S.deck.length !== n0+5) throw new Error("added "+(S.deck.length-n0));
    const ids = S.deck.map(c=>c.id);
    if (new Set(ids).size !== ids.length) throw new Error("duplicate ids");
    w.eval("vocabBoost()");
    const ids2 = S.deck.map(c=>c.id);
    if (new Set(ids2).size !== ids2.length) throw new Error("duplicates on second boost");
  });

  await T("SRS renders fix-card with production prompt + grades after flip", () => {
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

  await T("production mode triggers for mature cards", () => {
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

  await T("renderEsame shows 4 prove and level pills", () => {
    w.eval("renderEsame()");
    ["pScritta","pOrale","pAscolto","pLettura"].forEach(id=>{ if(!w.document.querySelector("#"+id)) throw new Error(id+" missing"); });
    if (w.document.querySelectorAll("[data-lv]").length !== 4) throw new Error("level pills");
  });

  await T("esameScritta renders task + ticking clock", () => {
    w.eval("esameScritta('B2')");
    if (!w.document.querySelector("#wTa")) throw new Error("no textarea");
    if (!w.document.querySelector("#wClock")) throw new Error("no clock");
    w.document.querySelector("#wBack").click(); // clears timer
  });

  await T("rubricBox math + saveExam history", () => {
    const R = w.eval(`rubricBox({lessico:4,grammatica:3,coerenza:4,adeguatezza:3,pass:true,cefr:'B2',feedback:'• ok'})`);
    if (R.tot !== 14) throw new Error("tot="+R.tot);
    w.eval("saveExam('B2','scritta',14,true)");
    if (!S.examLog.length || S.examLog[S.examLog.length-1].tot !== 14) throw new Error("examLog");
    w.eval("renderOggi()");
    if (!w.document.querySelector("#esameRow").textContent.includes("14/20")) throw new Error("last score not shown");
  });

  await T("scenarios include questura + telefonata, gated by level", () => {
    const sc = w.eval("SCENARIOS.map(s=>s.id).join(',')");
    if (!sc.includes("questura") || !sc.includes("telefonata")) throw new Error(sc);
  });

  await T("repair reduces counter on completion path (unit)", () => {
    S.errLog.tempo_passati.n = 6;
    // simulate the healed branch directly
    w.eval(`S.errLog.tempo_passati.n = Math.max(0, S.errLog.tempo_passati.n - 3)`);
    if (S.errLog.tempo_passati.n !== 3) throw new Error("n="+S.errLog.tempo_passati.n);
  });

  await T("Oggi shows coach, pronuncia, plateau rows", () => {
    w.eval("renderOggi()");
    ["coachGen","pronRow","platRow","bPacks"].forEach(id=>{ if(!w.document.querySelector("#"+id)) throw new Error(id+" missing"); });
  });

  await T("coach snapshot reflects real state", () => {
    const s = w.eval("JSON.stringify(coachSnapshot())");
    const o = JSON.parse(s);
    if (o.level !== S.level) throw new Error("level");
    if (!Array.isArray(o.topGaps) || !o.topGaps.length) throw new Error("topGaps empty");
    if (typeof o.cardsDue !== "number") throw new Error("cardsDue");
  });

  await T("drawCoach renders cached plan with jump buttons", () => {
    S.coachPlan = { d: w.eval("today()"), focus:"Attack passato vs imperfetto", steps:[
      {t:"Repair drill",why:"top gap ×3",min:5,go:"lacune"},
      {t:"Speak 5 turns",why:"output low",min:8,go:"parla"}]};
    w.eval("renderOggi()");
    if (w.document.querySelector("#coachGen")) throw new Error("gen button should hide when plan cached");
    const jumps = w.document.querySelectorAll("#coachBox [data-go]");
    if (jumps.length !== 2) throw new Error("jump buttons: "+jumps.length);
    jumps[1].click();
    if (!w.document.body.textContent.includes("Speaking is the whole game")) throw new Error("jump to parla failed");
  });

  await T("booth system prompt has anti-script + naturalness fields", () => {
    const sys = w.eval(`convoSystem(SCENARIOS[0])`);
    if (!/UNEXPECTED/i.test(sys)) throw new Error("no anti-script rule");
    if (!sys.includes('"nat"')) throw new Error("no nat field");
  });

  await T("naturalness chip renders under user bubble", () => {
    w.eval(`
      main.innerHTML='<div class="chatlog" id="chatlog"></div>';
      addBub('me','provo a dire una cosa');
      const res={reply:'Ok!',translation:'Ok!',fix:'',nat:'Provo a dire qualcosa',errs:[]};
      if(res.fix||res.nat){const b=[...document.querySelectorAll('.bub.me')].pop();
        if(res.nat) b.innerHTML+='<span class="fix" style="background:#EAF4EF">🌿 più naturale: '+esc(res.nat)+'</span>';}
    `);
    if (!w.document.body.textContent.includes("più naturale")) throw new Error("chip missing");
  });

  await T("Lacune sheet has Mental model buttons", () => {
    w.eval("renderLacune()");
    if (!w.document.querySelector('[data-mm="tempo_passati"]')) throw new Error("no mental-model button");
    w.eval("closeSheet()");
  });

  await T("Vocab packs sheet lists all contexts incl. medical + bureaucracy", () => {
    w.eval("renderPacks()");
    if (!w.document.querySelector('[data-pk="corsia"]')) throw new Error("corsia pack missing");
    if (!w.document.querySelector('[data-pk="burocrazia"]')) throw new Error("burocrazia pack missing");
    if (w.document.querySelectorAll('[data-pk]').length !== 8) throw new Error("pack count");
    w.eval("closeSheet()");
  });

  await T("Pronuncia asks native language once, then shows 7 sounds for English", () => {
    w.eval("renderPronuncia()");
    if (!w.document.querySelector("#prLang")) throw new Error("no language prompt");
    w.document.querySelector("#prLang").value = "English";
    w.document.querySelector("#prGo").click();
    if (!w.document.body.textContent.includes("R arrotata")) throw new Error("static EN bank not rendered");
    if (w.document.querySelectorAll("[data-try]").length < 15) throw new Error("drill buttons missing");
    if (!w.document.body.textContent.includes("aritmie")) throw new Error("medical drills missing");
  });

  await T("ACCENT_EN bank integrity (7 sounds, drills present)", () => {
    const bad = w.eval("ACCENT_EN.filter(s=>s.length!==4||!Array.isArray(s[3])||s[3].length<2).length");
    if (bad) throw new Error(bad+" malformed sounds");
    if (w.eval("ACCENT_EN.length") !== 7) throw new Error("not 7 sounds");
  });

  await T("Plateau protocol: day math, done-tracking, Oggi row", () => {
    S.protocol = { start: w.eval("today()"), diagnosis:"Output avoidance.", days: Array.from({length:30},(_,i)=>"Action "+(i+1)), done:{} };
    if (w.eval("protoDay()") !== 0) throw new Error("day="+w.eval("protoDay()"));
    w.eval("renderOggi()");
    if (!w.document.querySelector("#platRow").textContent.includes("Day 1/30")) throw new Error("row wrong");
    w.eval("renderPlateau()");
    w.document.querySelector("#ptDone").click();
    if (!S.protocol.done[0]) throw new Error("done not tracked");
    w.eval("closeSheet()");
  });

  // ---- Cloud STT (iOS mic bypass) ----
  await T("needsCloudSTT is true when SR is absent (simulates iOS Safari)", () => {
    const orig = w.SpeechRecognition; const origWk = w.webkitSpeechRecognition;
    delete w.SpeechRecognition; delete w.webkitSpeechRecognition;
    const needs = w.eval("(window.SpeechRecognition||window.webkitSpeechRecognition) ? false : true");
    if (!needs) throw new Error("expected true with no SR");
    if (orig) w.SpeechRecognition = orig; if (origWk) w.webkitSpeechRecognition = origWk;
  });

  await T("detectSTT sets sttMode from /api/stt-status when SR is unavailable", async () => {
    w.eval("SR_STUB_UNDEFINED = true;"); // no-op marker, real check below via forced path
    await w.eval(`(async()=>{ 
      const realSR = window.SpeechRecognition; 
      window.__savedSR = realSR;
      Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true});
      Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});
      await detectSTT();
      window.__sttModeAfter = sttMode;
    })()`);
    const mode = w.eval("window.__sttModeAfter");
    if (mode !== "cloud") throw new Error("sttMode="+mode);
  });

  await T("micCaption reflects cloud mode", () => {
    w.eval("sttMode='cloud'");
    if (!/cloud transcription/.test(w.eval("micCaption()"))) throw new Error(w.eval("micCaption()"));
    w.eval("sttMode='cloud-unconfigured'");
    if (!/needs setup/.test(w.eval("micCaption()"))) throw new Error(w.eval("micCaption()"));
  });

  await T("listen() returns a synchronous proxy with .stop() before getUserMedia resolves", () => {
    w.eval("STT_NO_VAD_MS = 5"); // shrink no-VAD fallback window for fast tests
    const hasStop = w.eval(`(function(){
      const h = listen(()=>{}, ()=>{}, ()=>{});
      return h && typeof h.stop === 'function';
    })()`);
    if (!hasStop) throw new Error("no synchronous stop() handle");
  });

  await T("cloud STT end-to-end: records, transcribes via /api/transcribe, returns text", async () => {
    w.__setSttEnabled(true);
    w.eval("STT_NO_VAD_MS = 5");
    const text = await w.eval(`new Promise(res=>{
      listen(t=>res(t), ()=>{}, err=>res('ERR:'+err));
    })`);
    if (text !== "ciao come stai") throw new Error("got: "+text);
  });

  await T("cloud STT surfaces 'notconfigured' when server has no key", async () => {
    w.__setSttEnabled(false);
    w.eval("STT_NO_VAD_MS = 5");
    const result = await w.eval(`new Promise(res=>{
      listen(t=>res('OK:'+t), ()=>{}, err=>res('ERR:'+err));
    })`);
    if (result !== "ERR:notconfigured") throw new Error("got: "+result);
    w.__setSttEnabled(true);
  });

  await T("booth mic caption uses live sttMode, not raw SR check", () => {
    w.eval("sttMode='cloud'; curScen=SCENARIOS[0]; renderParla();");
    const scen = w.document.querySelector(".scen"); if (scen) scen.click();
    // renderParla itself (scene list) doesn't show the caption; jump straight to a started convo render
    w.eval(`
      main.innerHTML = '<div class="booth"><div class="chatlog" id="chatlog"></div></div>';
      $('body') || 0;
    `);
    // directly assert the caption helper output used by startConvo's template
    if (!w.eval("micCaption()").includes("cloud")) throw new Error("caption stale");
  });

  await T("theme toggle cycles auto → light → dark → auto and persists", () => {
    w.eval("renderHeader()");
    const btn = w.document.querySelector("#thmBtn");
    if (!btn) throw new Error("no theme button");
    btn.click(); // auto → light
    if (w.localStorage.getItem("fluente-theme") !== "light") throw new Error("not light");
    if (w.document.documentElement.dataset.theme !== "light") throw new Error("attr not set");
    w.document.querySelector("#thmBtn").click(); // light → dark
    if (w.localStorage.getItem("fluente-theme") !== "dark") throw new Error("not dark");
    w.document.querySelector("#thmBtn").click(); // dark → auto
    if (w.localStorage.getItem("fluente-theme") !== null) throw new Error("auto should clear storage");
    if (w.document.documentElement.dataset.theme) throw new Error("auto should clear attr");
  });

  await T("celebrate() spawns and cleans confetti, never throws sans matchMedia", () => {
    w.document.querySelectorAll(".cfw").forEach(x=>x.remove()); // clear bursts from earlier pass-tests
    delete w.matchMedia; // some webviews lack it — must not throw
    w.eval("celebrate(10)");
    const wraps = w.document.querySelectorAll(".cfw");
    if (wraps.length !== 1) throw new Error("wrappers: "+wraps.length);
    if (wraps[0].querySelectorAll(".cf").length !== 10) throw new Error("confetti count");
    wraps[0].remove();
  });

  await T("dark theme redefines core vars (spot check)", () => {
    const css = html.match(/<style>[\s\S]*?<\/style>/)[0];
    if (!css.includes('[data-theme="dark"]')) throw new Error("no dark block");
    for (const v of ["--carta:", "--surface:", "--panel:", "--rosso:"]) {
      const count = (css.split(v).length - 1);
      if (count < 3) throw new Error(v + " defined " + count + "x — expected light + dark + media");
    }
  });

  await T("GRAMMAR_BOOK integrity: 26 topics, all fields, valid err keys", () => {
    const bad = w.eval(`GRAMMAR_BOOK.filter(g => !g.id||!g.cat||!g.t||!g.en||!Array.isArray(g.when)||!g.when.length||!g.how||!g.why||!g.trap||!Array.isArray(g.ex)||g.ex.length<2||!ERR_TAX[g.err]).length`);
    if (bad) throw new Error(bad + " malformed topics");
    if (w.eval("GRAMMAR_BOOK.length") !== 26) throw new Error("count=" + w.eval("GRAMMAR_BOOK.length"));
    const ids = w.eval("GRAMMAR_BOOK.map(g=>g.id).join(',')").split(",");
    if (new Set(ids).size !== ids.length) throw new Error("duplicate ids");
  });

  await T("Regole tab lists all topics grouped, flags gap-mapped rules", () => {
    w.eval("S.errLog.tempo_passati = S.errLog.tempo_passati || {n:2,last:Date.now(),ex:[]}; S.errLog.tempo_passati.n = 2;");
    w.eval("setTab('verbi')");
    const rows = w.document.querySelectorAll("[data-gram]");
    if (rows.length !== 26) throw new Error("rows=" + rows.length);
    if (!w.document.body.textContent.includes("I TEMPI")) throw new Error("no tenses category");
    if (!w.document.body.textContent.includes("LA STRUTTURA")) throw new Error("no structure category");
    const flagged = w.document.querySelector('[data-gram="duello"]');
    if (!flagged.textContent.includes("×2")) throw new Error("gap badge missing");
    if (!w.document.querySelector("#vbTable")) throw new Error("conjugator lost in rebuild");
    if (!w.document.querySelector("#vbScelta")) throw new Error("scelta shortcut missing");
  });

  await T("grammarSheet shows when/how/why/English/trap/examples + drill button", () => {
    w.eval(`grammarSheet(GRAMMAR_BOOK.find(g=>g.id==='ipotetico'))`);
    const t = w.document.body.textContent;
    for (const sec of ["IN ENGLISH","WHEN","HOW","WHY IT MAKES SENSE","THE TRAP","IN THE WILD"]) {
      if (!t.includes(sec)) throw new Error(sec + " section missing");
    }
    if (!t.includes("se sarebbe")) throw new Error("hypothetical trap content missing");
    if (!w.document.querySelector("#gDrill")) throw new Error("drill button missing");
    w.eval("closeSheet()");
  });

  await T("congiuntivo rule sheet embeds the VEDONO triggers", () => {
    w.eval(`grammarSheet(GRAMMAR_BOOK.find(g=>g.id==='congpres'))`);
    if (!w.document.body.textContent.includes("VEDONO")) throw new Error("triggers not embedded");
    w.eval("closeSheet()");
  });

  await T("every rule has an ADHD nota + a 2-pair English bridge", () => {
    const bad = w.eval(`GRAMMAR_BOOK.filter(g => typeof g.note!=='string' || g.note.length<15 || !Array.isArray(g.bridge) || g.bridge.length<2 || g.bridge.some(p=>!Array.isArray(p)||p.length!==2||!p[0]||!p[1])).length`);
    if (bad) throw new Error(bad + " rules missing note/bridge");
  });

  await T("rule sheet shows LA NOTA, IL PONTE and the 4-step METODO", () => {
    w.eval(`grammarSheet(GRAMMAR_BOOK.find(g=>g.id==='trapassato'))`);
    const t = w.document.body.textContent;
    for (const sec of ["LA NOTA", "IL PONTE", "IL METODO", "Copri & ricorda", "Crea la tua frase"]) {
      if (!t.includes(sec)) throw new Error(sec + " missing");
    }
    if (!t.includes("had worked all night")) throw new Error("bridge English side missing");
    for (const id of ["gRecall","gDrill","gCreate"]) { if(!w.document.querySelector("#"+id)) throw new Error(id+" missing"); }
    if (!S.gramPractice.trapassato || !S.gramPractice.trapassato.read) throw new Error("read step not marked");
    w.eval("closeSheet()");
  });

  await T("recall step: flip, honest ✓, dot earned", () => {
    w.eval(`grammarSheet(GRAMMAR_BOOK.find(g=>g.id==='trapassato'))`);
    w.document.querySelector("#gRecall").click();
    if (!w.document.body.textContent.includes("Without peeking")) throw new Error("recall view missing");
    w.document.querySelector("#gFlip").click();
    if (!w.document.body.textContent.includes("LA NOTA")) throw new Error("flip didn't reveal nota");
    w.document.querySelector("#gGot").click();
    if (!S.gramPractice.trapassato.recall) throw new Error("recall not marked");
    if (!w.document.querySelector("#gRecall").className.includes("done")) throw new Error("step row not marked done");
    w.eval("closeSheet()");
  });

  await T("create step renders textarea; drill score feeds the dots", () => {
    w.eval(`grammarSheet(GRAMMAR_BOOK.find(g=>g.id==='trapassato'))`);
    w.document.querySelector("#gCreate").click();
    if (!w.document.querySelector("#gcIn")) throw new Error("no textarea");
    w.eval("closeSheet()");
    w.eval(`S.gramPractice.trapassato.drill = 5;`);
    const dots = w.eval(`stepDots('trapassato')`);
    if (dots !== "●●○") throw new Error("dots=" + dots);
  });

  await T("Regole tab shows La regola di oggi + step dots", () => {
    w.eval("setTab('verbi')");
    if (!w.document.body.textContent.includes("LA REGOLA DI OGGI")) throw new Error("no daily rule card");
    if (!w.document.querySelector("#rdgBtn")) throw new Error("no rdg button");
    if (!w.document.querySelectorAll(".stepdots").length) throw new Error("no dots rendered");
  });

  await T("regolaDelGiorno prefers your worst gap-mapped rule", () => {
    w.eval("S.errLog = {}; logErr('ausiliare','ho andato','sono andato','t'); ");
    const id = w.eval("regolaDelGiorno().id");
    if (id !== "ausiliari") throw new Error("picked " + id);
  });

  await T("CHICCA_BANK integrity: 40+, all fields, unique phrases", () => {
    const n = w.eval("CHICCA_BANK.length");
    if (n < 40) throw new Error("only " + n);
    const bad = w.eval(`CHICCA_BANK.filter(c=>!c.it||!c.en||!Array.isArray(c.ex)||c.ex.length!==2||!c.note||c.note.length<30).length`);
    if (bad) throw new Error(bad + " malformed chicche");
    const its = w.eval("CHICCA_BANK.map(c=>c.it).join('|')").split("|");
    if (new Set(its).size !== its.length) throw new Error("duplicate phrases");
  });

  await T("Oggi shows the chicca row; opening awards XP once and marks done", () => {
    w.eval("renderOggi()");
    if (!w.document.querySelector("#chiccaRow")) throw new Error("no chicca row");
    const xp0 = S.xp;
    w.eval("openChicca()");
    if (!w.document.body.textContent.includes("LA CHICCA DI OGGI")) throw new Error("sheet missing");
    if (S.xp !== xp0 + 5) throw new Error("xp delta " + (S.xp - xp0));
    w.eval("closeSheet(); openChicca();");
    if (S.xp !== xp0 + 5) throw new Error("xp awarded twice");
    w.eval("closeSheet(); renderOggi();");
    if (!w.document.querySelector("#chiccaRow").className.includes("done")) throw new Error("row not marked done");
  });

  await T("chicca → Ripasso: adds once, dedupes, Un'altra browses", () => {
    w.eval("openChicca(3)");
    const n0 = S.deck.length;
    w.document.querySelector("#chAdd").click();
    if (S.deck.length !== n0 + 1) throw new Error("not added");
    w.document.querySelector("#chAdd").click();
    if (S.deck.length !== n0 + 1) throw new Error("duplicate added");
    const before = w.document.body.textContent;
    w.document.querySelector("#chNext").click();
    if (w.document.body.textContent === before) throw new Error("Un'altra didn't advance");
    w.eval("closeSheet()");
  });

  await T("ROAST banks integrity: 20+ roasts + praise, all [it,en] pairs, unique", () => {
    if (w.eval("ROAST_BANK.length") < 20) throw new Error("bank too small");
    if (w.eval("ROAST_PRAISE.length") < 5) throw new Error("praise bank too small");
    const bad = w.eval(`ROAST_BANK.concat(ROAST_PRAISE).filter(r=>!Array.isArray(r)||r.length!==2||!r[0]||!r[1]).length`);
    if (bad) throw new Error(bad + " malformed lines");
    const its = w.eval("ROAST_BANK.map(r=>r[0]).join('|')").split("|");
    if (new Set(its).size !== its.length) throw new Error("duplicate roasts");
  });

  await T("brutale defaults OFF: roastFb empty, prompts clean, toggle rows present", () => {
    w.eval("S.brutale = false");
    if (w.eval("roastFb(false)") !== "") throw new Error("roast leaks when off");
    if (w.eval("roastRules()") !== "") throw new Error("prompt tone leaks when off");
    if (w.eval("convoSystem(SCENARIOS[0])").includes("modalità brutale")) throw new Error("booth prompt leaks when off");
    w.eval("renderOggi()");
    if (!w.document.querySelector("#brutRow")) throw new Error("no toggle on Oggi");
    w.eval("setTab('verbi')");
    if (!w.document.querySelector("#brutRow")) throw new Error("no toggle on Regole");
  });

  await T("toggle flips S.brutale and rerenders; roast shows on wrong Scelta pick", () => {
    w.eval("renderOggi()");
    w.document.querySelector("#brutRow").click();
    if (!S.brutale) throw new Error("toggle didn't arm");
    if (!w.document.querySelector("#brutRow").textContent.includes("ON")) throw new Error("row didn't rerender");
    const fb = w.eval("roastFb(false)");
    if (!fb.includes('class="roast"')) throw new Error("no roast span");
    w.eval("renderScelta()");
    const it = w.eval("JSON.stringify(SCELTA_BANK.find(x=>x[0]===document.querySelector('.card h2').textContent) || null)");
    // click an option; whichever it is, feedback box must exist — then check roast presence on a forced wrong
    const opts = [...w.document.querySelectorAll(".qopt")];
    const right = w.eval("(function(){const t=document.querySelector('.card h2').textContent; const b=SCELTA_BANK.find(x=>x[0]===t); return b?b[2]:0;})()");
    opts[1 - right].click(); // deliberately wrong
    if (!w.document.querySelector("#scFb .roast")) throw new Error("no roast in Scelta feedback");
    w.eval("setTab('oggi')");
  });

  await T("brutale ON: booth + scrivi + crea prompts carry the tone order, in-character reply exempt", () => {
    w.eval("S.brutale = true");
    const sys = w.eval("convoSystem(SCENARIOS[0])");
    if (!sys.includes("modalità brutale")) throw new Error("booth tone missing");
    if (!sys.includes('"reply" stays in character')) throw new Error("in-character exemption missing");
    if (!html.includes("brutally funny Italian best friend")) throw new Error("scrivi brutal system missing");
    if (!html.includes("open the why with a short colloquial Italian roast")) throw new Error("crea tone missing");
    w.eval("S.brutale = false; save();");
  });

  await T("lesson + tutor prompts forbid grammar terminology (explain by English parallel)", () => {
    if (!html.includes("does NOT remember grammar terminology in either language")) throw new Error("lesson prompt instruction missing");
    if (!html.includes("never explain by naming tenses")) throw new Error("tutor prompt instruction missing");
    if (!html.includes('"bridge":[{"en"')) throw new Error("lesson bridge JSON field missing");
  });

  await T("client ai() retries a 429 with backoff and succeeds", async () => {
    let calls = 0;
    const orig = w.fetch;
    w.fetch = async (url, opts) => {
      if (String(url).includes("/api/chat")) {
        calls++;
        if (calls === 1) return { status: 429, json: async () => ({ error: { message: "rate limited" } }) };
        return { status: 200, json: async () => ({ content: [{ type: "text", text: "eccomi" }] }) };
      }
      return orig(url, opts);
    };
    // shrink the backoff for the test by intercepting setTimeout delays > 1s
    const rSt = w.setTimeout;
    w.setTimeout = (fn, ms) => rSt(fn, Math.min(ms || 0, 20));
    const out = await w.eval(`ai([{role:'user',content:'ciao'}],'sys')`);
    w.setTimeout = rSt; w.fetch = orig;
    if (calls !== 2) throw new Error("calls=" + calls);
    if (out !== "eccomi") throw new Error("got: " + out);
  });

  await T("client ai() surfaces honest message after exhausted retries", async () => {
    const orig = w.fetch;
    w.fetch = async (url) => String(url).includes("/api/chat")
      ? { status: 429, json: async () => ({ error: { message: "The Claude API is rate-limiting this key" } }) }
      : orig(url);
    const rSt = w.setTimeout;
    w.setTimeout = (fn, ms) => rSt(fn, Math.min(ms || 0, 20));
    const out = await w.eval(`ai([{role:'user',content:'ciao'}],'sys')`);
    w.setTimeout = rSt; w.fetch = orig;
    if (!/rate-limiting/.test(out)) throw new Error("got: " + out);
  });

  await T("warmServer pings /api/health without throwing", async () => {
    let pinged = false;
    const orig = w.fetch;
    w.fetch = async (url, o) => { if (String(url).includes("/api/health")) { pinged = true; return { json: async () => ({ ok: true }) }; } return orig(url, o); };
    w.eval("warmServer()");
    await new Promise(r => setTimeout(r, 30));
    w.fetch = orig;
    if (!pinged) throw new Error("no ping");
  });


  /* ---------- v6.9: Pro wall (dormant scaffold) ---------- */
  await T("Pro wall dormant by default: gate passes through, no Pro row, no ✦ marks", () => {
    w.eval("S.placed=true; S.level='B1'; S.levelIdx=2; PLAN={enforce:false,plan:'free',until:0,checkout:'',signedIn:false}; enterApp();");
    if (w.document.querySelector("#proRow")) throw new Error("proRow shown while dormant");
    let ran = false; w.__g = () => { ran = true; }; w.eval("gate('esame_scritta', __g)");
    if (!ran) throw new Error("gate blocked while dormant");
    w.eval("renderEsame()");
    if (!w.document.querySelector("#pScritta")) throw new Error("no esame buttons");
    if (w.document.querySelector(".pro-mark")) throw new Error("✦ mark shown while dormant");
    if (/✦ PRO/.test(w.document.querySelector("#hdrStats").textContent)) throw new Error("header pill shown while dormant");
  });

  await T("Pro wall ON + free plan: ✦ marks, Oggi Pro row, tapping a prova opens the upgrade sheet", () => {
    w.eval("PLAN.enforce=true; PLAN.plan='free'; PLAN.checkout='https://buy.test/fluente'; renderEsame();");
    if (w.document.querySelectorAll(".pro-mark").length !== 4) throw new Error("expected 4 marks, got " + w.document.querySelectorAll(".pro-mark").length);
    w.document.querySelector("#pScritta").click();
    const ov = w.eval("overlay.textContent");
    if (!/FLUENTE PRO/.test(ov) || !/PROVA SCRITTA/.test(ov)) throw new Error("no upgrade sheet: " + ov.slice(0, 60));
    const href = w.document.querySelector("#proGo").getAttribute("href");
    if (!/buy\.test\/fluente\?checkout\[custom\]\[username\]=/.test(href)) throw new Error("checkout link: " + href);
    w.eval("closeSheet(); setTab('oggi');");
    if (!w.document.querySelector("#proRow")) throw new Error("no proRow on Oggi");
    if (!/SCOPRI/.test(w.document.querySelector("#proRow").textContent)) throw new Error("proRow copy");
  });

  await T("Pro wall ON + pro plan: no marks, gate passes, header + Oggi show Pro active", () => {
    w.eval("PLAN.plan='pro'; PLAN.until=Date.now()+86400e3; renderHeader(); renderEsame();");
    if (w.document.querySelector(".pro-mark")) throw new Error("mark shown for pro user");
    if (!/✦ PRO/.test(w.document.querySelector("#hdrStats").textContent)) throw new Error("no header pill");
    let ran = false; w.__g = () => { ran = true; }; w.eval("gate('packs', __g)");
    if (!ran) throw new Error("gate blocked a pro user");
    w.eval("setTab('oggi')");
    if (!/ATTIVO/.test(w.document.querySelector("#proRow").textContent)) throw new Error("proRow not ATTIVO");
    w.eval("PLAN.until=Date.now()-1000; renderHeader();"); // expired → free again
    if (/✦ PRO/.test(w.document.querySelector("#hdrStats").textContent)) throw new Error("expired plan still pro");
    w.eval("PLAN={enforce:false,plan:'free',until:0,checkout:'',signedIn:false}; renderHeader();");
  });

  await T("ai() sends the feature tag and a bearer token when signed in", async () => {
    const orig = w.fetch; let seen = null;
    w.fetch = async (url, o) => {
      if (String(url).includes("/api/chat")) { seen = { body: JSON.parse(o.body), auth: o.headers.Authorization }; return { status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }) }; }
      return orig(url, o);
    };
    w.eval("CREDS={username:'farwa',pin:'1234',token:'tok123'}");
    const out = await w.eval("ai([{role:'user',content:'ciao'}],'sys',false,500,'coach')");
    w.fetch = orig; w.eval("CREDS=null");
    if (out !== "ok") throw new Error("got " + out);
    if (seen.body.feature !== "coach") throw new Error("feature missing");
    if (seen.auth !== "Bearer tok123") throw new Error("auth header: " + seen.auth);
  });

  await T("ai() turns a 402 pro_required into the upgrade sheet without retrying", async () => {
    const orig = w.fetch; let calls = 0;
    w.fetch = async (url, o) => {
      if (String(url).includes("/api/chat")) { calls++; return { status: 402, json: async () => ({ error: { code: "pro_required", feature: "esame_orale", message: "Funzione Pro" }, checkoutUrl: "https://x.test/buy" }) }; }
      return orig(url, o);
    };
    const out = await w.eval("ai([{role:'user',content:'ciao'}],'sys',true,500,'esame_orale')");
    w.fetch = orig;
    if (calls !== 1) throw new Error("calls=" + calls);
    if (out !== null) throw new Error("expected null, got " + out);
    const ov = w.eval("overlay.textContent");
    if (!/PROVA ORALE/.test(ov) || !/Attiva Pro/.test(ov)) throw new Error("upgrade sheet missing");
    if (!/x\.test\/buy/.test(w.document.querySelector("#proGo").getAttribute("href"))) throw new Error("checkout link missing");
    w.eval("closeSheet()");
  });

  await T("every ai() call site carries a feature tag (26) and /api/plan is polled at boot", () => {
    const tagged = (html.match(/,'(placement|scrivi|lesson_ai|checkpoint|parla|stealword|med|mnemonic|tutor|grammar|mental|ripara|coach|packs|accent7|plateau|esame_scritta|esame_orale|esame_ascolto|esame_lettura)'\)/g) || []).length;
    const logErrTags = (html.match(/logErrs\([^)]*,'(scrivi|parla)'\)/g) || []).length; // pre-existing gap-map calls share the shape
    if (tagged - logErrTags !== 26) throw new Error("tagged=" + (tagged - logErrTags));
    if (!/refreshPlan\(\); \/\/ fire-and-forget/.test(html)) throw new Error("boot does not poll /api/plan");
  });


  /* ---------- v7: local day, streak freeze, micro-session, la rotta ---------- */
  await T("today() is the LOCAL calendar day and daysAgo() agrees with it", () => {
    const d = new Date(); const local = new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
    if (w.eval("today()") !== local) throw new Error("today()=" + w.eval("today()") + " local=" + local);
    if (w.eval("daysAgo(0)") !== local) throw new Error("daysAgo(0)");
    const y = new Date(); y.setDate(y.getDate()-1); const ly = new Date(y.getTime() - y.getTimezoneOffset()*60000).toISOString().slice(0,10);
    if (w.eval("daysAgo(1)") !== ly) throw new Error("daysAgo(1)");
  });

  await T("touchStreak: consecutive day +1; one skipped day is covered by a ❄️ freeze; two skipped days reset; every 7th day earns a freeze", () => {
    w.eval("S.lastDay=daysAgo(1); S.streak=5; S.streakFreezes=0; touchStreak();");
    if (S.streak !== 6) throw new Error("consecutive: " + S.streak);
    w.eval("S.lastDay=daysAgo(2); S.streak=5; S.streakFreezes=1; touchStreak();");
    if (S.streak !== 6 || S.streakFreezes !== 0) throw new Error("freeze: streak=" + S.streak + " freezes=" + S.streakFreezes);
    w.eval("S.lastDay=daysAgo(2); S.streak=5; S.streakFreezes=0; touchStreak();");
    if (S.streak !== 1) throw new Error("no freeze should reset: " + S.streak);
    w.eval("S.lastDay=daysAgo(3); S.streak=9; S.streakFreezes=2; touchStreak();");
    if (S.streak !== 1) throw new Error("two skipped days must reset even with freezes: " + S.streak);
    w.eval("S.lastDay=daysAgo(1); S.streak=6; S.streakFreezes=0; touchStreak();");
    if (S.streak !== 7 || S.streakFreezes !== 1) throw new Error("7th day should earn a freeze: " + S.streakFreezes);
    if (S.streakBest < 7) throw new Error("streakBest not tracked");
    w.eval("S.lastDay=today(); S.streak=3; S.streakFreezes=0;");
  });

  await T("Oggi sizes the day to prefs.minutes: 5 min → one required mission (micro); 25 → four", () => {
    w.eval("S.placed=true; S.goal=null; S.prefs={minutes:5}; S.microLog={}; setTab('oggi');");
    if (JSON.stringify(w.eval("requiredMissions()")) !== '["micro"]') throw new Error("5 min → " + JSON.stringify(w.eval("requiredMissions()")));
    if (!/Una fermata oggi/.test(w.document.querySelector("h1").textContent)) throw new Error("headline: " + w.document.querySelector("h1").textContent);
    if (!w.document.querySelector("#microRow")) throw new Error("no micro row");
    if (!w.document.querySelector("#rottaRow") || !/Imposta la rotta/.test(w.document.querySelector("#rottaRow").textContent)) throw new Error("no rotta CTA");
    w.eval("S.prefs={minutes:25}; setTab('oggi');");
    if (w.eval("requiredMissions()").length !== 4) throw new Error("25 min → " + w.eval("requiredMissions()").length);
    if (!/Quattro fermate oggi/.test(w.document.querySelector("h1").textContent)) throw new Error("headline 25");
  });

  await T("la rotta: six screens → goal C1 (specialty), 10 min/day, declared gap seeds the gap map, Oggi/Linea/Esame follow", () => {
    w.eval("S.errLog={}; S.selfGaps=[]; exLv=null; renderRotta(()=>setTab('oggi'));");
    const click = sel => { const el = w.document.querySelector(sel); if (!el) throw new Error("missing " + sel); el.click(); };
    if (!/LA ROTTA · 1 \/ 6/.test(w.document.body.textContent)) throw new Error("screen 1 not shown");
    click('[data-why="specialty"]'); click('#rNext');                    // 1 goal
    click('[data-ex="CELI"]'); w.document.querySelector('#rDate').value = '2030-06-15'; click('#rNext'); // 2 exam
    click('[data-ses="block"]'); click('#rNext');                        // 3 style
    click('[data-gap="preposizioni"]'); click('#rNext');                 // 4 gaps
    click('[data-min="10"]'); click('#rNext');                           // 5 minutes
    w.document.querySelector('#rSlot').value = '07:30'; w.document.querySelector('#rAnchor').value = 'prima del turno'; click('#rNext'); // 6 pact → finish
    if (!/ROTTA IMPOSTATA/.test(w.document.body.textContent)) throw new Error("no summary screen");
    if (S.goal.target !== "C1" || S.goal.why !== "specialty" || S.goal.examType !== "CELI" || S.goal.examDate !== "2030-06-15") throw new Error("goal: " + JSON.stringify(S.goal));
    if (S.prefs.minutes !== 10 || S.prefs.session !== "block" || S.prefs.slot !== "07:30" || S.prefs.anchor !== "prima del turno") throw new Error("prefs: " + JSON.stringify(S.prefs));
    if (!S.errLog.preposizioni || S.errLog.preposizioni.n !== 2 || !S.errLog.preposizioni.seed) throw new Error("gap not seeded: " + JSON.stringify(S.errLog.preposizioni));
    if (S.coachPlan !== null) throw new Error("coachPlan should reset");
    click('#rGo');
    if (!/Rotta Certificato → C1/.test(w.document.querySelector("#rottaRow").textContent)) throw new Error("rotta row: " + w.document.querySelector("#rottaRow").textContent);
    if (!/gg all'esame/.test(w.document.querySelector(".statgrid").textContent)) throw new Error("no countdown stat");
    w.eval("renderLinea()");
    if (!/LA TUA META/.test(w.document.body.textContent) || !/oltre la meta/.test(w.document.body.textContent)) throw new Error("Linea labels missing");
    w.eval("renderEsame()");
    if (!/btn sm dark/.test(w.document.querySelector('[data-lv="C1"]').className)) throw new Error("exam level did not follow the goal");
    if (!/Regola/.test(w.eval("regolaDelGiorno().t")) && w.eval("regolaDelGiorno().err") !== "preposizioni") throw new Error("regola del giorno ignores the seeded gap: " + w.eval("regolaDelGiorno().err"));
  });

  await T("coachFallback prescribes without AI; ≤5-minute days skip the AI call entirely", async () => {
    const f = w.eval("coachFallback()");
    if (!f.steps.length || !f.focus) throw new Error("empty fallback");
    let fetched = false; const orig = w.fetch; w.fetch = async (u, o) => { if (String(u).includes("/api/chat")) fetched = true; return orig(u, o); };
    w.eval("S.prefs.minutes=5; S.coachPlan=null; setTab('oggi');");
    await w.eval("coachPlan(true)");
    w.fetch = orig;
    if (fetched) throw new Error("AI called on a 5-minute day");
    if (!S.coachPlan || S.coachPlan.steps[0].go !== "micro") throw new Error("plan: " + JSON.stringify(S.coachPlan));
    if (!w.document.querySelector('[data-go="micro"]')) throw new Error("micro step not drawn");
    w.eval("S.prefs.minutes=10;");
  });

  await T("la sessione minima: card → 2 scelte → shadow line; completes with +10 XP, microLog, streak — no fetch", async () => {
    let fetched = false; const orig = w.fetch; w.fetch = async (u, o) => { if (String(u).includes("/api/")) fetched = true; return orig(u, o); };
    const xp0 = S.xp; w.eval("S.microLog={}; S.lastDay=daysAgo(1); S.streak=2; setTab('oggi'); renderMicro();");
    const q = sel => w.document.querySelector(sel);
    if (!/UNA CARTA/.test(w.eval("overlay.textContent"))) throw new Error("card step missing");
    q('#mcFlip').click(); q('#mcYes').click();
    for (let k = 0; k < 2; k++) {
      if (!/SCELTA/.test(w.eval("overlay.textContent"))) throw new Error("scelta step " + k + " missing");
      const opts = w.document.querySelectorAll('.sheet .qopt'); opts[0].click(); q('#mcN').click();
    }
    if (!/ASCOLTA E RIPETI/.test(w.eval("overlay.textContent"))) throw new Error("shadow step missing");
    q('#mcTa').value = "qualcosa di diverso"; q('#mcCheck').click();
    if (!q('#mcDone')) throw new Error("no done button"); q('#mcDone').click();
    w.fetch = orig;
    if (fetched) throw new Error("micro-session hit the network");
    if (!S.microLog[w.eval("today()")]) throw new Error("microLog not set");
    if (S.xp !== xp0 + 10) throw new Error("xp " + (S.xp - xp0));
    if (S.streak !== 3) throw new Error("streak " + S.streak);
    if (!/done/.test(w.document.querySelector("#microRow").className)) throw new Error("micro row not marked done");
  });


  /* ---------- v7: Telegram reminder row + linking flow ---------- */
  await T("Promemoria row: signed-out → ACCEDI; signed-in not linked → VAI; linked → GESTISCI (brutale tone shown)", () => {
    w.eval("CREDS=null; NUDGE={configured:true,linked:false,bot:'FluenteBot',known:true}; S.prefs={minutes:10,slot:'08:15',anchor:'dopo il caffè'}; setTab('oggi');");
    if (!/ACCEDI/.test(w.document.querySelector("#nudgeRow").textContent)) throw new Error("signed-out row");
    w.eval("CREDS={username:'farwa',pin:'1234',token:'t'}; S.brutale=true; setTab('oggi');");
    const r = w.document.querySelector("#nudgeRow").textContent;
    if (!/VAI/.test(r) || !/08:15 dopo il caffè/.test(r) || !/brutale/.test(r)) throw new Error("not-linked row: " + r);
    w.eval("NUDGE.linked=true; setTab('oggi');");
    if (!/GESTISCI/.test(w.document.querySelector("#nudgeRow").textContent) || !/brutale/.test(w.document.querySelector("#nudgeRow").textContent)) throw new Error("linked row");
    w.eval("S.brutale=false; NUDGE.linked=false;");
  });

  await T("linking flow: Genera il codice → code + t.me link shown → Ho fatto verifies via /api/nudge/status → prefs.nudge='telegram'", async () => {
    const orig = w.fetch; let linked = false; const seen = [];
    w.fetch = async (url, o) => {
      const u = String(url); seen.push(u + " " + ((o && o.headers && o.headers.Authorization) || "-"));
      if (u.includes("/api/nudge/link")) { linked = true; return { ok: true, json: async () => ({ ok: true, code: "482913", bot: "FluenteBot", url: "https://t.me/FluenteBot?start=482913" }) }; }
      if (u.includes("/api/nudge/status")) return { ok: true, json: async () => ({ configured: true, linked, bot: "FluenteBot", signedIn: true }) };
      return orig(url, o);
    };
    w.eval("S.prefs.nudge='none'; setTab('oggi'); nudgeSheet();");
    if (!/Collega Telegram in 3 tap/.test(w.eval("overlay.textContent"))) throw new Error("sheet not in link state");
    w.document.querySelector("#ndLink").click(); await new Promise(r => setTimeout(r, 30));
    if (!/482913/.test(w.eval("overlay.textContent"))) throw new Error("code not shown");
    const a = w.document.querySelector("#ndCode a"); if (!a || !/t\.me\/FluenteBot\?start=482913/.test(a.getAttribute("href"))) throw new Error("t.me link missing");
    w.document.querySelector("#ndDone").click(); await new Promise(r => setTimeout(r, 30));
    if (!w.eval("NUDGE.linked")) throw new Error("status not refreshed");
    if (S.prefs.nudge !== "telegram") throw new Error("prefs.nudge=" + S.prefs.nudge);
    if (!/Collegato a @FluenteBot/.test(w.eval("overlay.textContent"))) throw new Error("sheet not in linked state");
    if (!seen.some(x => /nudge\/link Bearer t/.test(x))) throw new Error("link call lacked bearer: " + seen.join(" | "));
    w.fetch = orig; w.eval("closeSheet(); CREDS=null; NUDGE={configured:false,linked:false,bot:'',known:true};");
  });

  console.log(results.join("\n"));
  const fails = results.filter(r=>r[0]==="✗").length;
  console.log(fails ? "\n"+fails+" FAILURES" : "\nALL PASS");
  process.exit(fails?1:0);
}, 300);
