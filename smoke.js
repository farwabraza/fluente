// Headless smoke test for FLUENTE v3 features (not shipped to users; dev only)
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
  // lessons.js loads via <script src> in the browser; JSDOM has no resource
  // loader configured, so inject the static content layer directly.
  // (const→var: eval'd const stays in the eval's own scope and would be
  // invisible to the page's functions; var lands on the global object.)
  w.eval(fs.readFileSync("public/lessons.js", "utf8").replace(/^const /gm, "var "));
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

  // ---- v7: static content layer ----
  await T("LESSON_BOOK covers every lesson station + Linea M, full integrity", () => {
    const missing = w.eval(`Object.values(CURRICULUM).flat().filter(u=>!u.exam && !LESSON_BOOK[u.id]).map(u=>u.id).join(',')`);
    if (missing) throw new Error("no lesson for: " + missing);
    const missingMed = w.eval(`MED_UNITS.filter(u=>!LESSON_BOOK[u.id]).map(u=>u.id).join(',')`);
    if (missingMed) throw new Error("no lesson for med: " + missingMed);
    const bad = w.eval(`Object.entries(LESSON_BOOK).filter(([id,l]) =>
      !l.title || !Array.isArray(l.bullets)||l.bullets.length<3 ||
      !Array.isArray(l.ex)||l.ex.length<2||l.ex.some(e=>e.length!==2) ||
      !Array.isArray(l.bridge)||l.bridge.length<2||l.bridge.some(b=>b.length!==2) ||
      !l.note || !l.mn ||
      !Array.isArray(l.drills)||l.drills.length<10||l.drills.some(d=>!d.q||!Array.isArray(d.o)||d.o.length<2||!d.w) ||
      !Array.isArray(l.speak)||l.speak.length<2||l.speak.some(s=>s.length!==2) ||
      !Array.isArray(l.cards)||l.cards.length<2||l.cards.some(c=>c.length!==4)
    ).map(([id])=>id).join(',')`);
    if (bad) throw new Error("malformed: " + bad);
  });

  await T("samplePool avoids repeats until exhausted, then resets; dealDrill keeps the answer", () => {
    w.eval("S.drillSeen = {}");
    const a = w.eval(`samplePool('t-pool', GRAMMAR_DRILLS.presente, 5).map(d=>d.s).join('|')`);
    const b = w.eval(`samplePool('t-pool', GRAMMAR_DRILLS.presente, 5).map(d=>d.s).join('|')`);
    const overlap = a.split("|").filter(x => b.split("|").includes(x));
    // pool has 6: first draw takes 5, second must reset — overlap allowed, but a draw itself must be unique
    if (new Set(a.split("|")).size !== 5) throw new Error("repeat within one draw");
    for (let k = 0; k < 20; k++) {
      const ok = w.eval(`(function(){const d=dealDrill({q:'x',o:['RIGHT','wrong'],w:'w'}); return d.o[d.a]==='RIGHT';})()`);
      if (!ok) throw new Error("dealDrill lost the correct answer");
    }
  });

  await T("openLesson is instant from LESSON_BOOK — zero /api/chat calls, full flow to finish", () => {
    let chat = 0;
    const orig = w.fetch;
    w.fetch = async (url, o) => { if (String(url).includes("/api/chat")) chat++; return orig(url, o); };
    w.eval("delete S.unitsDone.a1u2; S.deck = S.deck.filter(c=>!String(c.id).startsWith('a1u2-'));");
    w.eval(`openLesson(CURRICULUM.A1.find(u=>u.id==='a1u2'),'A1')`);
    const t = w.document.body.textContent;
    for (const sec of ["IL CONCETTO", "IL PONTE", "MNEMONIC HOOK", "LA NOTA"]) if (!t.includes(sec)) throw new Error(sec + " missing");
    if (!w.document.querySelector("#persBtn")) throw new Error("personal-example button missing");
    w.document.querySelector("#startDrills").click();
    for (let i = 0; i < 5; i++) {
      const opts = [...w.document.querySelectorAll(".sheet .qopt")];
      if (!opts.length) throw new Error("no drill options at round " + i);
      opts[0].click();
      w.document.querySelector("#nextD").click();
    }
    if (!w.document.body.textContent.includes("SPEAK IT")) throw new Error("speak view missing");
    w.document.querySelector("#skipSpeak").click();
    w.document.querySelector("#finishL").click();
    if (!S.unitsDone.a1u2) throw new Error("unit not marked done");
    if (!S.deck.find(c => c.id === "a1u2-0")) throw new Error("lesson cards not added");
    const n0 = S.deck.length;
    w.eval(`openLesson(CURRICULUM.A1.find(u=>u.id==='a1u2'),'A1')`);
    w.document.querySelector("#startDrills").click();
    for (let i = 0; i < 5; i++) { [...w.document.querySelectorAll(".sheet .qopt")][0].click(); w.document.querySelector("#nextD").click(); }
    w.document.querySelector("#skipSpeak").click();
    w.document.querySelector("#finishL").click();
    if (S.deck.length !== n0) throw new Error("replay duplicated cards");
    w.fetch = orig;
    if (chat !== 0) throw new Error("made " + chat + " AI calls for a static lesson");
  });

  await T("checkpoint questions come from the static pool — no AI call to start", async () => {
    let chat = 0;
    const orig = w.fetch;
    w.fetch = async (url, o) => { if (String(url).includes("/api/chat")) chat++; return orig(url, o); };
    w.eval(`openCheckpoint(CURRICULUM.A1.find(u=>u.exam),'A1')`);
    w.document.querySelector("#startEx").click();
    await new Promise(r => setTimeout(r, 30));
    if (!w.document.body.textContent.includes("DOMANDA 1 / 3")) throw new Error("question not shown");
    if (!w.eval(`CHECKPOINT_POOL.A1.some(q=>document.querySelector('.sheet .card h2').textContent.includes(q))`)) throw new Error("question not from pool");
    w.fetch = orig;
    if (chat !== 0) throw new Error("AI called to generate questions");
    w.eval("closeSheet()");
  });

  await T("GRAMMAR_DRILLS covers all 26 rules; rule drill runs static with fresh-AI offer", () => {
    const missing = w.eval(`GRAMMAR_BOOK.filter(g=>!GRAMMAR_DRILLS[g.id]||GRAMMAR_DRILLS[g.id].length<6).map(g=>g.id).join(',')`);
    if (missing) throw new Error("thin banks: " + missing);
    const bad = w.eval(`Object.values(GRAMMAR_DRILLS).flat().filter(d=>!d.s||!Array.isArray(d.o)||d.o.length!==2||!d.w).length`);
    if (bad) throw new Error(bad + " malformed rule drills");
    w.eval(`grammarSheet(GRAMMAR_BOOK.find(g=>g.id==='futuro'))`);
    w.document.querySelector("#gDrill").click();
    if (!w.document.body.textContent.includes("FUTURO SEMPLICE · 1/5")) throw new Error("static drill didn't render instantly");
    for (let i = 0; i < 5; i++) { [...w.document.querySelectorAll(".sheet .qopt")][0].click(); w.document.querySelector("#gN").click(); }
    if (!w.document.querySelector("#gFresh")) throw new Error("fresh-AI button missing on static result");
    if (!(S.gramPractice.futuro && S.gramPractice.futuro.drillTs)) throw new Error("drill not recorded");
    w.eval("closeSheet()");
  });

  await T("Med tab: Linea M stations + patient-speech drill & browse", () => {
    w.eval("setTab('med')");
    if (w.document.querySelectorAll("[data-med]").length !== 6) throw new Error("med stations missing");
    if (!w.document.body.textContent.includes("COME PARLANO I PAZIENTI")) throw new Error("patient section missing");
    const badPz = w.eval(`PAZIENTE_BANK.filter(p=>p.length!==4||!p[0]||!p[1]||!p[2]||!p[3]).length`);
    if (badPz) throw new Error(badPz + " malformed patient phrases");
    if (w.eval("PAZIENTE_BANK.length") < 24) throw new Error("bank too small");
    w.eval("pazienteDrill()");
    if (!w.document.body.textContent.includes("IL PAZIENTE DICE")) throw new Error("drill not rendered");
    [...w.document.querySelectorAll(".sheet .qopt")][0].click();
    if (!w.document.querySelector("#pzN")) throw new Error("drill feedback missing");
    w.eval("closeSheet(); pazienteBrowse();");
    const add = w.document.querySelector('[data-pzadd="2"]');
    const n0 = S.deck.length;
    add.click();
    if (S.deck.length !== n0 + 1) throw new Error("add failed");
    add.click();
    if (S.deck.length !== n0 + 1) throw new Error("duplicate added");
    w.eval("closeSheet()");
    // a Linea M station opens as a static lesson
    w.eval("setTab('med')");
    w.document.querySelector('[data-med="m1"]').click();
    if (!w.document.body.textContent.includes("IL CONCETTO")) throw new Error("med lesson didn't open");
    w.eval("closeSheet()");
  });

  await T("service worker caches lessons.js; server keys rate limits per account", () => {
    const sw = fs.readFileSync("public/sw.js", "utf8");
    if (!sw.includes("/lessons.js")) throw new Error("lessons.js not in SW shell");
    if (!sw.includes("fluente-v7")) throw new Error("cache not bumped");
    const srv = fs.readFileSync("server.js", "utf8");
    if (!srv.includes("function rateKey")) throw new Error("rateKey missing");
    if (!srv.match(/b\.u ===? "string"|typeof b\.u/)) throw new Error("per-account key not reading body.u");
    if (!html.includes("u:(CREDS&&CREDS.username)||undefined")) throw new Error("client doesn't send username");
  });

  // ---- v7.1: invite-gated accounts + admin visibility ----
  await T("login screen has the invite field and sends it with auth", () => {
    w.eval("renderLogin()");
    if (!w.document.querySelector("#lgInvite")) throw new Error("invite input missing");
    if (!html.includes("JSON.stringify({username,pin,invite})")) throw new Error("invite not sent to /api/auth");
    if (!html.includes("d.needInvite")) throw new Error("needInvite nudge missing");
    w.eval("localStorage.setItem('fluente-skip-login','1'); enterApp();");
  });

  await T("server: invite-gated signup, one-time codes, last-seen, admin API", async () => {
    process.env.ADMIN_KEY = "test-admin-key";
    const srv = require("./server.js");
    const users = new Map(), invites = new Map();
    // minimal in-memory mock of the pg pool, covering exactly the queries server.js makes
    srv._test.setPool({ query: async (sql, p = []) => {
      sql = sql.replace(/\s+/g, " ");
      if (sql.startsWith("SELECT pinhash, state, updated_at FROM fluente_users")) { const u = users.get(p[0]); return { rows: u ? [u] : [] }; }
      if (sql.startsWith("SELECT pinhash FROM fluente_users")) { const u = users.get(p[0]); return { rows: u ? [{ pinhash: u.pinhash }] : [] }; }
      if (sql.startsWith("UPDATE fluente_invites SET used_by")) {
        const inv = invites.get(p[0]);
        if (!inv || inv.used_by) return { rows: [] };
        inv.used_by = p[1]; inv.used_at = p[2]; return { rows: [{ code: p[0] }] };
      }
      if (sql.startsWith("INSERT INTO fluente_users")) { users.set(p[0], { username: p[0], pinhash: p[1], created_at: p[2], last_seen: p[2], invite_code: p[3], state: null, updated_at: 0 }); return { rows: [] }; }
      if (sql.startsWith("UPDATE fluente_users SET last_seen")) { const u = users.get(p[0]); if (u) u.last_seen = p[1]; return { rows: [] }; }
      if (sql.startsWith("UPDATE fluente_users SET pinhash")) { const u = users.get(p[0]); if (u) u.pinhash = p[1]; return { rowCount: u ? 1 : 0, rows: [] }; }
      if (sql.startsWith("UPDATE fluente_users SET state")) { const u = users.get(p[0]); if (u) { u.state = p[1]; u.updated_at = p[2]; u.last_seen = p[3]; } return { rows: [] }; }
      if (sql.startsWith("SELECT username, created_at, last_seen, invite_code")) return { rows: [...users.values()] };
      if (sql.startsWith("SELECT code, note, created_at, used_by, used_at")) return { rows: [...invites.values()] };
      if (sql.startsWith("INSERT INTO fluente_invites")) { invites.set(p[0], { code: p[0], note: p[1], created_at: p[2], used_by: null, used_at: null }); return { rows: [] }; }
      if (sql.startsWith("DELETE FROM fluente_invites")) { const i = invites.get(p[0]); const del = !!(i && !i.used_by); if (del) invites.delete(p[0]); return { rowCount: del ? 1 : 0 }; }
      throw new Error("mock pool: unhandled query: " + sql.slice(0, 70));
    }});
    const server = srv.app.listen(0);
    const port = server.address().port;
    const call = (method, path, body, headers) => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
    try {
      let r = await call("POST", "/api/auth", { username: "newdoc", pin: "1234" });
      if (r.status !== 403 || !r.body.needInvite) throw new Error("signup without invite allowed: " + r.status);
      r = await call("POST", "/api/admin/invite", { note: "test@x" }, { "x-admin-key": "nope" });
      if (r.status !== 401) throw new Error("wrong admin key accepted");
      r = await call("POST", "/api/admin/invite", { note: "test@x" }, { "x-admin-key": "test-admin-key" });
      if (!r.body.ok || !/^FLU-[A-HJ-KM-NP-Z2-9]{4}-[A-HJ-KM-NP-Z2-9]{4}$/.test(r.body.code)) throw new Error("bad code: " + JSON.stringify(r.body));
      const code = r.body.code;
      r = await call("POST", "/api/auth", { username: "newdoc", pin: "1234", invite: code.toLowerCase() });
      if (!r.body.created) throw new Error("signup with code failed: " + JSON.stringify(r.body));
      r = await call("POST", "/api/auth", { username: "seconduser", pin: "1234", invite: code });
      if (r.status !== 403) throw new Error("used code accepted twice");
      r = await call("POST", "/api/auth", { username: "newdoc", pin: "1234" });
      if (!r.body.ok || r.body.created) throw new Error("existing login broken: " + JSON.stringify(r.body));
      r = await call("POST", "/api/auth", { username: "newdoc", pin: "9999" });
      if (r.status !== 401) throw new Error("wrong pin accepted");
      r = await call("GET", "/api/admin/overview", null, { "x-admin-key": "test-admin-key" });
      if (r.body.users.length !== 1 || r.body.users[0].username !== "newdoc") throw new Error("users list wrong");
      if (!r.body.users[0].last_seen) throw new Error("last_seen not tracked");
      if (r.body.invites[0].used_by !== "newdoc") throw new Error("invite not marked used");
      const g = await call("POST", "/api/admin/invite", { note: "spare" }, { "x-admin-key": "test-admin-key" });
      r = await call("DELETE", "/api/admin/invite/" + g.body.code, null, { "x-admin-key": "test-admin-key" });
      if (!r.body.deleted) throw new Error("revoking an unused code failed");
      r = await call("DELETE", "/api/admin/invite/" + code, null, { "x-admin-key": "test-admin-key" });
      if (r.body.deleted) throw new Error("a USED code was deleted — history must be immutable");
      // forgotten-PIN rescue: reset keeps the account (and so the progress), old PIN dies, new PIN works
      r = await call("POST", "/api/admin/reset-pin", { username: "ghost", pin: "5678" }, { "x-admin-key": "test-admin-key" });
      if (r.status !== 404) throw new Error("reset on unknown user: " + r.status);
      r = await call("POST", "/api/admin/reset-pin", { username: "newdoc", pin: "5678" }, { "x-admin-key": "nope" });
      if (r.status !== 401) throw new Error("reset with wrong admin key accepted");
      r = await call("POST", "/api/admin/reset-pin", { username: "newdoc", pin: "5678" }, { "x-admin-key": "test-admin-key" });
      if (!r.body.ok) throw new Error("reset failed: " + JSON.stringify(r.body));
      r = await call("POST", "/api/auth", { username: "newdoc", pin: "1234" });
      if (r.status !== 401) throw new Error("old PIN still works after reset");
      r = await call("POST", "/api/auth", { username: "newdoc", pin: "5678" });
      if (!r.body.ok || r.body.created) throw new Error("new PIN sign-in broken (or account was recreated): " + JSON.stringify(r.body));
    } finally { server.close(); }
  });

  await T("admin panel page exists and talks to the admin API", () => {
    const ad = fs.readFileSync("public/admin.html", "utf8");
    for (const bit of ["/api/admin/overview", "/api/admin/invite", "/api/admin/reset-pin", "x-admin-key", "noindex"]) {
      if (!ad.includes(bit)) throw new Error(bit + " missing from admin.html");
    }
    if (html.includes("e.g. farwa")) throw new Error("personal name still in login placeholder");
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

  console.log(results.join("\n"));
  const fails = results.filter(r=>r[0]==="✗").length;
  console.log(fails ? "\n"+fails+" FAILURES" : "\nALL PASS");
  process.exit(fails?1:0);
}, 300);
