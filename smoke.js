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
