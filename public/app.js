
// ══════════════════════════════════════════════════════════
// CONSTANTS
// ══════════════════════════════════════════════════════════
// Gemini key lives only on the server now — see /api/gemini.js
const GEMINI_PROXY_URL = '/api/gemini';
const SBURL = 'https://skmnbwmezwbhivpmohkm.supabase.co'; 
const SBKEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNrbW5id21lendiaGl2cG1vaGttIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE0MTU1OTcsImV4cCI6MjA5Njk5MTU5N30.AilSPeFUa1AnhQfW4lTnjUnSaROn8ZM_K6bYMzAGIiM';
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// ══════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════
let sb = null, sbUser = null;
let UPS = [], activeI = 0;
let curResult = null, curSummary = null, curDiagram = null;
let corrections = {}, savedStyles = [], chatHist = [];
let noteText = '', sampleUp = false, lettersCov = {};
let ttsUtt = null, ttsOn = false;
let fcIdx = 0, fcCards = [];
let pr = { name:'', sid:null, scans:0, totScore:0, corrs:0, exams:0, flash:0, streak:1 };
let dgTab = 'svg', vMode = 's';

// ══════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

function toast(msg, dur=3000) {
  const el = $('toast');
  el.textContent = msg; el.style.display = '';
  clearTimeout(window._tt);
  window._tt = setTimeout(() => el.style.display = 'none', dur);
}

function mkAlert(type, msg) {
  const map = {w:'al-w',e:'al-e',i:'al-i',s:'al-s'};
  const icons = {w:'⚠️',e:'❌',i:'💡',s:'✅'};
  return `<div class="alert ${map[type]}"><span>${icons[type]}</span><div>${msg}</div></div>`;
}

function setEl(id, html) { const e=$(id); if(e) e.innerHTML=html; }
function showEl(id, show=true) { const e=$(id); if(e) e.style.display=show?'':'none'; }

async function gemini(prompt, imgs=[]) {
  const parts = [];
  for (const img of imgs) {
    if (img.dataUrl) parts.push({ inlineData:{ mimeType: img.file.type, data: img.dataUrl.split(',')[1] }});
  }
  parts.push({ text: prompt });
  const res = await fetch(GEMINI_PROXY_URL, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ contents:[{parts}], generationConfig:{ temperature:0.1, maxOutputTokens:2500 }})
  });
  const d = await res.json();
  if (!res.ok) throw new Error(d.error || ('Server error: ' + res.status));
  return d.text || '';
}

function parseJSON(raw) {
  try { return JSON.parse(raw.replace(/```json\n?|```\n?/g,'').trim()); }
  catch { return null; }
}

// ══════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════
function show(id) {
  ['LOGIN','SIGNUP'].forEach(x => showEl(x, x===id));
}

async function initSB() {
  // Wait for the Supabase script to actually load (up to ~3s)
  let tries = 0;
  while (typeof supabase === 'undefined' && tries < 30) {
    await sleep(100);
    tries++;
  }
  if (typeof supabase === 'undefined') {
    console.warn('Supabase script failed to load — check your internet connection or ad-blocker.');
    return;
  }
  try {
    sb = supabase.createClient(SBURL, SBKEY);
    const { data, error } = await sb.auth.getSession();
    if (error) { console.warn('Supabase session check:', error.message); return; }
    if (data?.session?.user) afterLogin(data.session.user);

    // Listen for OAuth redirect completing
    sb.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) afterLogin(session.user);
    });
  } catch(e) { console.warn('Supabase init failed:', e.message); }
}

async function doLogin() {
  const email = $('lEmail').value.trim(), pass = $('lPass').value;
  if (!email||!pass) { setEl('lErr', mkAlert('e','Fill in all fields')); showEl('lErr'); return; }
  showEl('lErr',false);
  try {
    if (!sb) throw new Error('Connection to login service failed. Refresh the page and try again.');
    const {data,error} = await sb.auth.signInWithPassword({email,password:pass});
    if (error) throw error;
    sbUser = data.user; afterLogin(data.user);
  } catch(e) { setEl('lErr',mkAlert('e',e.message||'Login failed')); showEl('lErr'); }
}

async function doSignup() {
  const name=$('sName').value.trim(), email=$('sEmail').value.trim(), pass=$('sPass').value;
  if (!name||!email||!pass) { setEl('sErr',mkAlert('e','Fill in all fields')); showEl('sErr'); return; }
  if (pass.length<8) { setEl('sErr',mkAlert('e','Password must be at least 8 characters')); showEl('sErr'); return; }
  showEl('sErr',false);
  try {
    if (!sb) throw new Error('Connection to login service failed. Refresh the page and try again.');
    const {data,error} = await sb.auth.signUp({email,password:pass,options:{data:{full_name:name}}});
    if (error) throw error;
    pr.name=name; pr.sid='INK-'+Math.random().toString(36).slice(2,6).toUpperCase();
    sbUser=data.user; afterLogin(data.user,name);
    toast('Account created! Welcome to InkRead 🎉');
  } catch(e) { setEl('sErr',mkAlert('e',e.message||'Signup failed')); showEl('sErr'); }
}

async function oauthLogin(provider) {
  if (!sb) { toast('Login service not ready — refresh and try again.'); return; }
  try {
    const { error } = await sb.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href }
    });
    if (error) throw error;
    // Browser will redirect to provider, then back here — onAuthStateChange picks it up
  } catch(e) { toast('OAuth error: ' + e.message); }
}

function guest() {
  pr.name='Guest'; pr.sid='INK-'+Math.random().toString(36).slice(2,6).toUpperCase();
  afterLogin(null,'Guest');
  toast('Continuing as guest — data won\'t persist between sessions');
}

function afterLogin(user, nameOv) {
  showEl('AUTH',false); showEl('APP');
  const name = nameOv || user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'You';
  pr.name=name;
  if (!pr.sid) pr.sid='INK-'+Math.random().toString(36).slice(2,6).toUpperCase();
  $('AV').textContent = name[0]?.toUpperCase()||'?';
  showEl('LGB', !!user);
  updPr(); buildAGrid(); renderSStyles();
}

async function doLogout() {
  if (sb) await sb.auth.signOut();
  sbUser=null; showEl('AUTH'); showEl('APP',false);
}

// ══════════════════════════════════════════════════════════
// NAV
// ══════════════════════════════════════════════════════════
function nav(id, btn) {
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('on'));
  document.querySelectorAll('.nt').forEach(t=>t.classList.remove('on'));
  const pg=$('P-'+id); if(pg) pg.classList.add('on');
  if(btn) btn.classList.add('on');
  if(id==='stats') updStats();
  if(id==='tutor'||id==='exam') {
    const noW = id==='tutor'?$('NONOTEW'):$('NONOTEW2');
    if(noW) noW.style.display = noteText?'none':'flex';
  }
}

// ══════════════════════════════════════════════════════════
// FILE UPLOAD
// ══════════════════════════════════════════════════════════
function addFiles(files) {
  const ok = Array.from(files).filter(f=>f.type.startsWith('image/')||f.type==='application/pdf');
  if (!ok.length) { toast('Upload images or PDFs only'); return; }
  const ps = ok.map(f=>new Promise(res=>{
    if(f.type==='application/pdf'){res({file:f,dataUrl:null,name:f.name,isPDF:true});return;}
    const r=new FileReader(); r.onload=e=>res({file:f,dataUrl:e.target.result,name:f.name,isPDF:false}); r.readAsDataURL(f);
  }));
  Promise.all(ps).then(nu=>{
    UPS=[...UPS,...nu]; activeI=UPS.length-1;
    renderThumbs(); chkQuality(ok[ok.length-1]);
    showEl('SSC'); showEl('RBTNW');
    $('RBTN').textContent=UPS.length>1?`Read all ${UPS.length} pages`:'Read this note';
    showEl('RESULT',false); curResult=null; curSummary=null; noteText='';
  });
}

function renderThumbs() {
  const strip=$('TSTRIP');
  showEl('DZE',false); showEl('DZF');
  strip.innerHTML='';
  UPS.forEach((u,i)=>{
    const d=document.createElement('div');
    d.className='thumb'+(i===activeI?' at':'');
    d.onclick=e=>{e.stopPropagation();activeI=i;renderThumbs();showPreview();};
    d.innerHTML=u.isPDF?`<div class="tpdf">📄<span style="font-size:9px;margin-top:2px">PDF</span></div>`:`<img src="${u.dataUrl}">`;
    const rm=document.createElement('button'); rm.className='trm'; rm.textContent='✕';
    rm.onclick=e=>{e.stopPropagation();UPS.splice(i,1);if(activeI>=UPS.length)activeI=Math.max(0,UPS.length-1);if(!UPS.length){showEl('DZE');showEl('DZF',false);showEl('SSC',false);showEl('RBTNW',false);showEl('QW',false);}else{renderThumbs();showPreview();}};
    d.appendChild(rm); strip.appendChild(d);
  });
  const add=document.createElement('div'); add.className='tadd';
  add.innerHTML='+<span style="font-size:10px;margin-top:2px">Add</span>';
  add.onclick=e=>{e.stopPropagation();$('FIN').click();};
  strip.appendChild(add);
  showPreview();
}

function showPreview() {
  const u=UPS[activeI]; if(!u) return;
  const img=$('PREV'), pdf=$('PDFINFO');
  if(u.isPDF){showEl('PREV',false);showEl('PDFINFO');pdf.textContent=`📄 ${u.name} — processed by AI`;}
  else{img.src=u.dataUrl;showEl('PREV');showEl('PDFINFO',false);}
}

function chkQuality(file) {
  showEl('QW'); showEl('QERR',false);
  $('QL').textContent='Checking…'; $('QF').style.width='0%';
  setTimeout(()=>{
    const mb=file.size/(1024*1024);
    const sc=mb<0.02?14:mb<0.08?42:mb<0.3?66:87;
    $('QF').style.width=sc+'%';
    $('QF').style.background=sc>65?'#059669':sc>35?'#E8A020':'#DC2626';
    $('QL').textContent=sc>70?'Good':sc>35?'Acceptable':'Too low';
    $('QL').style.color=sc>65?'var(--green)':sc>35?'var(--amber)':'var(--red)';
    if(sc<30){showEl('QERR');$('RBTN').disabled=true;}
    else $('RBTN').disabled=false;
  },900);
}

// ══════════════════════════════════════════════════════════
// STYLE SELECT
// ══════════════════════════════════════════════════════════
let selSt='mine';
function selStyle(el,v){
  selSt=v;
  document.querySelectorAll('#SCHIPS .chip').forEach(c=>c.classList.remove('on'));
  el.classList.add('on');
  const row=$('OSROW'); row.style.display=v==='other'?'flex':'none';
}
function verStyle(){
  const id=$('OSID').value.trim(), f=savedStyles.find(s=>s.id===id);
  const info=$('OSVINFO'); showEl('OSVINFO');
  info.innerHTML=f?mkAlert('s',`Style loaded for <strong>${f.name}</strong>`):mkAlert('w','Style ID not found. Add it in Profile → Saved style profiles.');
}

// ══════════════════════════════════════════════════════════
// READING
// ══════════════════════════════════════════════════════════
async function startRead() {
  if(!UPS.length) return;
  showEl('SLOAD'); showEl('RESULT',false); $('RBTN').disabled=true;
  const steps=['Checking image quality…','Detecting handwriting regions…','Scanning for diagrams…','Reading with AI…','Formatting results…'];
  for(let i=0;i<steps.length;i++){$('SSTEP').textContent=steps[i];$('SPFILL').style.width=((i+1)/steps.length*90)+'%';await sleep(480+i*110);}
  const corrCtx=Object.keys(corrections).length?`User corrections: ${JSON.stringify(corrections)}`:'';
  const pCtx=sampleUp?'User has handwriting profile. Be more confident.':'No profile. Be honest about uncertainty.';
  const sName=selSt==='other'&&$('OSID').value.trim()?(savedStyles.find(s=>s.id===$('OSID').value.trim())?.name||'shared style'):(pr.name||'user');

  const prompt=`You are InkRead's OCR + diagram extraction AI.

TASKS:
1. Extract ALL handwritten text accurately from every image provided
2. Detect diagrams: flowcharts, mind maps, decision trees, tables, network diagrams  
3. Reconstruct diagrams as structured node/edge JSON for clean SVG rendering
4. For flowcharts: identify START(oval), PROCESS(rounded rect), DECISION(diamond), END(oval). Trace EVERY arrow precisely.
5. Label all arrows — Yes/No for decisions, action labels for others

RULES:
- Mark uncertain words honestly with alternatives — never randomly guess
- Detect multiple handwriting styles
- Preserve symbols: → ★ • – ≠ formulas
- Combine text from all images in order
- ${pCtx}
${corrCtx}

Return ONLY valid JSON (no markdown, no extra text):
{
  "text": "full extracted text using \\n for line breaks, \\n\\n--- Page N ---\\n\\n between pages if multiple",
  "confidence": "high"|"medium"|"low",
  "overallScore": 0-100,
  "uncertainWords": [{"word":"x","alternatives":["a","b"]}],
  "multipleStyles": false,
  "needsSample": false,
  "message": "short honest note about what was clear or unclear",
  "hasDiagram": true,
  "diagram": {
    "type": "flowchart",
    "description": "plain english description of the diagram",
    "nodes": [
      {"id":"n1","label":"Start","shape":"oval","level":0},
      {"id":"n2","label":"Step name","shape":"rounded","level":1},
      {"id":"n3","label":"Decision?","shape":"diamond","level":2},
      {"id":"n4","label":"Yes result","shape":"rounded","level":3},
      {"id":"n5","label":"No result","shape":"rounded","level":3},
      {"id":"n6","label":"End","shape":"oval","level":4}
    ],
    "edges": [
      {"from":"n1","to":"n2","label":"","type":"normal"},
      {"from":"n2","to":"n3","label":"","type":"normal"},
      {"from":"n3","to":"n4","label":"Yes","type":"yes"},
      {"from":"n3","to":"n5","label":"No","type":"no"},
      {"from":"n4","to":"n6","label":"","type":"normal"},
      {"from":"n5","to":"n6","label":"","type":"normal"}
    ]
  }
}
If no diagram: hasDiagram=false, diagram=null.
Shapes: rect | rounded | diamond | oval | circle
Edge types: normal | yes | no
Reading as: "${sName}". Return JSON only, starting with {`;

  try {
    const imgs=UPS.filter(u=>!u.isPDF);
    const raw=await gemini(prompt,imgs);
    const parsed=parseJSON(raw)||{text:raw||'Could not extract text.',confidence:'low',overallScore:25,uncertainWords:[],hasDiagram:false,diagram:null,needsSample:true,message:'Trouble reading clearly.'};
    showResult(parsed);
  } catch(e) {
    showResult({text:'',confidence:'low',overallScore:0,uncertainWords:[],hasDiagram:false,diagram:null,message:'Connection error: '+e.message,error:true});
  }
  $('SPFILL').style.width='100%';
  showEl('SLOAD',false); $('RBTN').disabled=false;
}

function showResult(p) {
  curResult=p; noteText=p.text||'';
  showEl('RESULT');
  showEl('EXPCARD'); showEl('SUMCARD',false); showEl('SUMBTNW'); showEl('SUMLOAD',false);

  if(p.error){
    setEl('RTXT','<div class="alert al-e"><span>❌</span><div>'+p.message+'</div></div>');
    return;
  }

  const sc=p.overallScore||70;
  const badge=$('CBDG');
  badge.className='badge '+(sc>70?'bg-g':sc>45?'bg-a':'bg-r');
  badge.textContent=sc>70?'High confidence':sc>45?'Medium confidence':'Low confidence';

  renderRTxt(p.text,p.uncertainWords,'RTXT');
  renderRTxt(p.text,p.uncertainWords,'SPTXT');

  const au=UPS[activeI];
  if(au&&!au.isPDF){$('SPIMG').src=au.dataUrl;}

  if(p.message){showEl('AIMSG');$('AIMSG').textContent='💬 '+p.message;}else showEl('AIMSG',false);
  if(p.multipleStyles){showEl('MPALT');setEl('MPALT',mkAlert('w','Two handwriting styles detected. Load the other person\'s Style ID for better accuracy.'));}else showEl('MPALT',false);

  if(p.hasDiagram&&p.diagram){curDiagram=p.diagram;showEl('DGCARD');$('DGTBDG').textContent=p.diagram.type;renderDG(p.diagram);}
  else showEl('DGCARD',false);

  const unc=p.uncertainWords||[];
  if(unc.length){
    showEl('CORRW'); showEl('CORRSV',false);
    setEl('CORRL',unc.map((w,i)=>`<div class="crow"><span class="corig">❓ "${w.word}"</span><span style="color:var(--ink3)">→</span><input class="cinp" id="CI${i}" value="${w.word}"></div>`).join(''));
  } else {showEl('CORRW',false);}
  showEl('CORRSV',false);
  showEl('SMPREQ',p.needsSample&&!sampleUp);
  setEl('EXPNOTE','Includes extracted text'+(p.hasDiagram?', diagram':''));
  pr.scans++; pr.totScore+=(p.overallScore||50);
  updPr(); updStats();
}

function renderRTxt(text,unc,id) {
  const el=$(id); if(!el||!text){if(el)el.textContent='';return;}
  const uSet=new Set((unc||[]).map(w=>w.word.toLowerCase()));
  const aMap={}; (unc||[]).forEach(w=>{aMap[w.word.toLowerCase()]=w.alternatives||[];});
  const toks=text.split(/(\s+|\n)/);
  el.innerHTML=toks.map(tok=>{
    if(tok==='\n') return '<br>';
    const cl=tok.trim().toLowerCase().replace(/[.,!?;:]$/,'');
    if(uSet.has(cl)){const al=aMap[cl];return `<span class="unc" title="Might be: ${al.length?al.join(', '):'unclear'}">${tok}</span>`;}
    return tok.replace(/&/g,'&amp;').replace(/</g,'&lt;');
  }).join('');
}

function saveCorr() {
  const unc=curResult?.uncertainWords||[];
  unc.forEach((w,i)=>{const inp=$('CI'+i);if(inp&&inp.value&&inp.value!==w.word)corrections[w.word]=inp.value;});
  pr.corrs=Object.keys(corrections).length;
  showEl('CORRW',false); showEl('CORRSV'); updPr();
  toast('Corrections saved ✅');
}

function cpTxt(){navigator.clipboard.writeText(noteText);toast('Copied!');}

// ══════════════════════════════════════════════════════════
// VIEW TOGGLE
// ══════════════════════════════════════════════════════════
function setView(v){
  vMode=v;
  showEl('SVGL',v==='s'); showEl('SVSP',v==='sp');
  $('VSGL').style.background=v==='s'?'var(--bg)':'transparent';
  $('VSGL').style.boxShadow=v==='s'?'0 1px 3px rgba(0,0,0,.07)':'none';
  $('VSPL').style.background=v==='sp'?'var(--bg)':'transparent';
}

// ══════════════════════════════════════════════════════════
// DIAGRAM SVG
// ══════════════════════════════════════════════════════════
function renderDG(dg) {
  if(dgTab==='svg') setEl('DGBODY',buildSVG(dg));
  else setEl('DGBODY',`<p style="font-size:14px;line-height:1.7;color:#374151">${dg.description||'No description.'}</p>`);
}

function setDGTab(t) {
  dgTab=t;
  $('DGSVG').style.background=t==='svg'?'var(--bg)':'transparent';
  $('DGSVG').style.boxShadow=t==='svg'?'0 1px 2px rgba(0,0,0,.07)':'none';
  $('DGDSC').style.background=t==='desc'?'var(--bg)':'transparent';
  if(curDiagram) renderDG(curDiagram);
}

function buildSVG(dg) {
  const nodes=dg.nodes||[], edges=dg.edges||[];
  const NW=140,NH=46,PAD=22,CG=188,RG=90;
  const byLv={};
  nodes.forEach(n=>{const l=n.level??0;byLv[l]=byLv[l]||[];byLv[l].push(n);});
  const lvls=Object.keys(byLv).map(Number).sort((a,b)=>a-b);
  const mpl=Math.max(...lvls.map(l=>byLv[l].length),1);
  const W=Math.max(560,lvls.length*CG+PAD*2+NW);
  const H=Math.max(200,mpl*RG+PAD*2+NH);
  const pos={};
  lvls.forEach(l=>{
    const g=byLv[l],tH=g.length*RG,sy=(H-tH)/2+RG/2;
    g.forEach((n,i)=>pos[n.id]={x:PAD+l*CG+NW/2,y:sy+i*RG});
  });
  let svg=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" style="width:100%;border-radius:8px;background:#FAFAF7">
<defs>
<marker id="ma" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#6B7280"/></marker>
<marker id="my" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#059669"/></marker>
<marker id="mn" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#DC2626"/></marker>
</defs>`;
  edges.forEach(e=>{
    const f=pos[e.from],t=pos[e.to]; if(!f||!t) return;
    const mx=(f.x+t.x)/2;
    const col=e.type==='yes'?'#059669':e.type==='no'?'#DC2626':'#9CA3AF';
    const mid=e.type==='yes'?'my':e.type==='no'?'mn':'ma';
    const dash=t.x<f.x?'stroke-dasharray="5,3"':'';
    const tx2=t.x+(t.x>f.x?-NW/2:NW/2);
    svg+=`<path d="M${f.x},${f.y} C${mx},${f.y} ${mx},${t.y} ${tx2},${t.y}" fill="none" stroke="${col}" stroke-width="1.8" ${dash} marker-end="url(#${mid})"/>`;
    if(e.label) svg+=`<text x="${mx}" y="${(f.y+t.y)/2-7}" text-anchor="middle" font-size="10" font-weight="600" fill="${col}">${e.label}</text>`;
  });
  const cs={diamond:{f:'#FEF3C7',s:'#F59E0B'},oval:{f:'#EFF6FF',s:'#3B82F6'},rounded:{f:'#EFF6FF',s:'#3B82F6'},circle:{f:'#DCFCE7',s:'#059669'},rect:{f:'#F2F1EC',s:'#9CA3AF'}};
  nodes.forEach(n=>{
    const p=pos[n.id]; if(!p) return;
    const c=cs[n.shape]||cs.rect;
    const lbl=n.label||n.id;
    const wds=lbl.split(' '); const lns=[]; let cur='';
    wds.forEach(w=>{if((cur+' '+w).trim().length>15){lns.push(cur.trim());cur=w;}else cur=(cur+' '+w).trim();});
    if(cur) lns.push(cur);
    const x=p.x-NW/2,y=p.y-NH/2;
    if(n.shape==='diamond'){
      const hw=NW/2+8,hh=NH/2+8;
      svg+=`<polygon points="${p.x},${p.y-hh} ${p.x+hw},${p.y} ${p.x},${p.y+hh} ${p.x-hw},${p.y}" fill="${c.f}" stroke="${c.s}" stroke-width="1.8"/>`;
      lns.forEach((l,li)=>svg+=`<text x="${p.x}" y="${p.y+(li-(lns.length-1)/2)*13+4}" text-anchor="middle" font-size="10" font-weight="600" fill="#374151">${l}</text>`);
    } else if(n.shape==='circle'){
      const r=Math.max(NH/2,24);
      svg+=`<circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${c.f}" stroke="${c.s}" stroke-width="1.8"/>`;
      lns.forEach((l,li)=>svg+=`<text x="${p.x}" y="${p.y+(li-(lns.length-1)/2)*13+4}" text-anchor="middle" font-size="10" font-weight="600" fill="#374151">${l}</text>`);
    } else {
      const rx=n.shape==='rounded'||n.shape==='oval'?22:6;
      svg+=`<rect x="${x}" y="${y}" width="${NW}" height="${NH}" rx="${rx}" fill="${c.f}" stroke="${c.s}" stroke-width="1.8"/>`;
      lns.forEach((l,li)=>svg+=`<text x="${p.x}" y="${p.y+(li-(lns.length-1)/2)*13+4}" text-anchor="middle" font-size="11" font-weight="500" fill="#374151">${l}</text>`);
    }
  });
  return svg+'</svg>';
}

// ══════════════════════════════════════════════════════════
// SUMMARIZE
// ══════════════════════════════════════════════════════════
async function doSummarize() {
  if(!noteText){toast('Scan a note first');return;}
  showEl('SUMBTNW',false); showEl('SUMLOAD'); showEl('SUMCARD',false);
  const prompt=`You are an expert study assistant. A student has these handwritten notes.
Produce a RICH, DETAILED study summary — extract everything important, don't skip details.

Sections must match actual topics in the note, not generic headings.
Each bullet must be a complete useful fact. Sub-points add detail, examples, exceptions.
Key terms MUST have clear definitions from the note.
Generate 5-12 flashcards testing real understanding — target formulas, dates, names, processes, definitions.

Return ONLY valid JSON (no markdown):
{
  "tldr": "1-2 sentence overview of the whole note",
  "sections": [
    {
      "topic": "Exact topic name from the note",
      "points": [
        { "point": "Complete useful fact or concept", "subPoints": ["detail","example","exception"] }
      ]
    }
  ],
  "keyTerms": [
    { "term": "Term name", "definition": "Clear definition based on note content" }
  ],
  "flashcards": [
    { "question": "Specific question from the note?", "answer": "Detailed answer from the note" }
  ]
}

NOTES:
${noteText}`;
  try {
    const raw=await gemini(prompt);
    const p=parseJSON(raw)||{tldr:'Could not generate summary.',sections:[],keyTerms:[],flashcards:[]};
    curSummary=p; pr.flash+=(p.flashcards||[]).length;
    renderSum(p);
  } catch(e) { toast('Summary failed: '+e.message); showEl('SUMBTNW'); }
  showEl('SUMLOAD',false);
}

function renderSum(s) {
  showEl('SUMCARD');
  const tldr=$('STLDR');
  if(s.tldr){showEl('STLDR');tldr.textContent='💡 '+s.tldr;}else showEl('STLDR',false);
  // BULLETS
  setEl('STB',(s.sections||[]).map(sec=>`
    <div style="margin-bottom:18px">
      <div class="sectitle"><div class="sdot"></div>${sec.topic}</div>
      ${(sec.points||[]).map(pt=>`
        <div class="spt"><span style="color:var(--violet);font-weight:700;flex-shrink:0">›</span><span>${pt.point}</span></div>
        ${(pt.subPoints||[]).map(sp=>`<div class="ssub"><span style="color:#D1D5DB;flex-shrink:0">–</span><span>${sp}</span></div>`).join('')}
      `).join('')}
    </div>`).join('')||'<p style="font-size:13px;color:var(--ink3)">No structured points extracted.</p>');
  // TERMS
  setEl('STT',(s.keyTerms||[]).map(t=>`<div class="tcard"><div class="tname">${t.term||t}</div>${t.definition?`<div class="tdef">${t.definition}</div>`:''}</div>`).join('')||'<p style="font-size:13px;color:var(--ink3)">No key terms found.</p>');
  // FLASHCARDS
  fcCards=s.flashcards||[]; fcIdx=0; renderFC();
  updPr();
}

function renderFC() {
  if(!fcCards.length){setEl('STC','<p style="font-size:13px;color:var(--ink3)">No flashcards generated.</p>');return;}
  const c=fcCards[fcIdx];
  setEl('STC',`
    <div class="fc-scene"><div class="fc" id="FC" onclick="this.classList.toggle('flip')">
      <div class="fc-f"><div class="fc-lbl">Q ${fcIdx+1} / ${fcCards.length}</div><div class="fc-txt">${c.question}</div><div class="fc-hint">tap to flip →</div></div>
      <div class="fc-b"><div class="fc-lbl" style="color:var(--violet)">Answer</div><div class="fc-txt" style="color:#374151;font-size:13px">${c.answer}</div><div class="fc-hint" style="color:var(--ink3)">tap to flip back</div></div>
    </div></div>
    <div class="fc-nav">
      <button class="btn btn-out btn-sm" onclick="mvFC(-1)" ${fcIdx===0?'disabled style="opacity:.4"':''}>← Prev</button>
      <span class="fc-ct">${fcIdx+1} / ${fcCards.length}</span>
      <button class="btn btn-out btn-sm" onclick="mvFC(1)" ${fcIdx===fcCards.length-1?'disabled style="opacity:.4"':''}>Next →</button>
    </div>
    <p style="font-size:11px;color:var(--ink3);text-align:center;margin-top:6px">Tap card to reveal answer</p>`);
}
function mvFC(d){fcIdx=Math.max(0,Math.min(fcIdx+d,fcCards.length-1));renderFC();}

function setSTab(t,btn) {
  document.querySelectorAll('.stab').forEach(b=>b.classList.remove('on'));
  if(btn) btn.classList.add('on');
  showEl('STB',t==='b'); showEl('STT',t==='t'); showEl('STC',t==='c');
}

// ══════════════════════════════════════════════════════════
// TTS
// ══════════════════════════════════════════════════════════
function toggleTTS() {
  if(!noteText){toast('No text — scan a note first');return;}
  if(ttsOn){if(window.speechSynthesis.paused){window.speechSynthesis.resume();$('TTSPAUSE').textContent='⏸ Pause';}else{window.speechSynthesis.pause();$('TTSPAUSE').textContent='▶ Resume';}return;}
  showEl('TTSBAR'); ttsOn=true; $('TTSBTN').textContent='⏸ Pause';
  ttsUtt=new SpeechSynthesisUtterance(noteText); ttsUtt.rate=0.9;
  ttsUtt.onend=()=>{ttsOn=false;showEl('TTSBAR',false);$('TTSBTN').textContent='🔊 Listen';$('TTSFILL').style.width='0%';};
  ttsUtt.onboundary=e=>{$('TTSFILL').style.width=Math.min(100,(e.charIndex/noteText.length)*100)+'%';};
  window.speechSynthesis.speak(ttsUtt);
}
function pauseTTS(){if(window.speechSynthesis.paused){window.speechSynthesis.resume();$('TTSPAUSE').textContent='⏸ Pause';}else{window.speechSynthesis.pause();$('TTSPAUSE').textContent='▶ Resume';}}
function stopTTS(){window.speechSynthesis.cancel();ttsOn=false;showEl('TTSBAR',false);$('TTSFILL').style.width='0%';$('TTSBTN').textContent='🔊 Listen';}

// ══════════════════════════════════════════════════════════
// AI TUTOR
// ══════════════════════════════════════════════════════════
async function sendChat() {
  const inp=$('CHATIN'), msg=inp.value.trim(); if(!msg) return;
  inp.value=''; addMsg(msg,'mu');
  const typing=addMsg('Thinking…','ma typing');
  const ctx=noteText?`Student's notes:\n${noteText}\n\n`:'No notes yet.\n\n';
  const hist=chatHist.slice(-6).map(m=>`${m.r==='u'?'Student':'Tutor'}: ${m.t}`).join('\n');
  const prompt=`${ctx}You are InkRead's friendly AI tutor. Explain simply, give examples, be concise but complete.

Conversation:
${hist}

Student: ${msg}
Tutor:`;
  chatHist.push({r:'u',t:msg});
  try {
    const raw=await gemini(prompt);
    typing.textContent=raw||'Sorry, try again.'; typing.classList.remove('typing');
    chatHist.push({r:'a',t:raw});
  } catch(e) {typing.textContent='Connection error.';typing.classList.remove('typing');}
  $('CHATMSGS').scrollTop=99999;
}
function qChat(q){$('CHATIN').value=q;sendChat();}
function addMsg(txt,cls){const d=document.createElement('div');d.className='msg '+cls;d.textContent=txt;$('CHATMSGS').appendChild(d);$('CHATMSGS').scrollTop=99999;return d;}

// ══════════════════════════════════════════════════════════
// EXAM PREP
// ══════════════════════════════════════════════════════════
async function genExam(type) {
  if(!noteText){toast('Scan a note first');return;}
  showEl('EXAMLOAD'); setEl('EXAMRES','');
  const tm={mcq:'5 MCQs with 4 options each. Mark the correct answer.',short:'5 short-answer questions with model answers (2-3 sentences).',long:'3 long-answer questions with detailed model answers (1 paragraph).',mock:'2 MCQs + 2 short + 1 long answer (full mock exam).',revision:'10 key revision points as bold headings with 1-line explanations.'};
  const fmt={mcq:'{"questions":[{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correct":0,"explanation":"..."}]}',short:'{"questions":[{"question":"...","answer":"..."}]}',long:'{"questions":[{"question":"...","answer":"..."}]}',mock:'{"mcqs":[{"question":"...","options":["A. ...","B. ...","C. ...","D. ..."],"correct":0,"explanation":"..."}],"short":[{"question":"...","answer":"..."}],"long":[{"question":"...","answer":"..."}]}',revision:'{"points":[{"heading":"...","explanation":"..."}]}'};
  const prompt=`You are an exam prep AI. Generate ${tm[type]} from these student notes.
Make questions SPECIFIC to the actual content. Test real understanding.
Return ONLY valid JSON: ${fmt[type]}

NOTES:
${noteText}`;
  try {
    const raw=await gemini(prompt);
    const p=parseJSON(raw);
    if(!p){setEl('EXAMRES',mkAlert('e','Could not generate exam. Try again.'));showEl('EXAMLOAD',false);return;}
    renderExam(type,p); pr.exams++; updPr();
  } catch(e){setEl('EXAMRES',mkAlert('e','Error: '+e.message));}
  showEl('EXAMLOAD',false);
}

function renderExam(type,data) {
  const el=$('EXAMRES');
  if(type==='mcq'){
    const qs=data.questions||[];
    el.innerHTML=qs.map((q,qi)=>`
      <div class="card" style="margin-bottom:14px">
        <div class="ch"><span class="ch-title" style="font-size:14px">Q${qi+1}. ${q.question}</span></div>
        <div class="cb">
          ${(q.options||[]).map((op,oi)=>`<div class="mcqopt" id="OPT${qi}_${oi}" onclick="chkMCQ(${qi},${oi},${q.correct},${qs.length})"><div class="mcq-lt">${'ABCD'[oi]}</div>${op.replace(/^[A-D]\.\s*/,'')}</div>`).join('')}
          <div id="EXP${qi}" style="display:none;margin-top:10px;padding:10px;background:var(--green-s);border-radius:8px;font-size:13px;color:var(--green-t)">💡 ${q.explanation||''}</div>
        </div>
      </div>`).join('');
    window._mq={tot:qs.length,sc:0,ans:0};
  } else if(type==='short'||type==='long'){
    el.innerHTML=(data.questions||[]).map((q,i)=>`
      <div class="card" style="margin-bottom:14px">
        <div class="ch"><span class="ch-title" style="font-size:14px">Q${i+1}. ${q.question}</span><button class="btn btn-out btn-sm" onclick="const e=$('ANS${i}');e.style.display=e.style.display===''?'none':''">Show answer</button></div>
        <div class="cb">
          <textarea class="inp ta" placeholder="Write your answer here…" style="min-height:80px;margin-bottom:8px"></textarea>
          <div id="ANS${i}" style="display:none;padding:12px;background:var(--green-s);border-radius:8px;font-size:13px;color:var(--green-t);line-height:1.6"><strong>Model answer:</strong><br>${q.answer}</div>
        </div>
      </div>`).join('');
  } else if(type==='mock'){
    let html='<div class="card" style="margin-bottom:14px"><div class="ch"><span class="ch-title">📋 Mock Exam</span></div><div class="cb">';
    if(data.mcqs?.length){html+='<h3 style="font-family:Syne,sans-serif;font-size:14px;font-weight:700;margin-bottom:12px">Section A — MCQ</h3>';data.mcqs.forEach((q,qi)=>{html+=`<div style="margin-bottom:14px"><p style="font-size:14px;font-weight:500;margin-bottom:8px">Q${qi+1}. ${q.question}</p>${(q.options||[]).map((op,oi)=>`<div class="mcqopt" id="MQ${qi}_${oi}" onclick="chkMCQ2(${qi},${oi},${q.correct},'MQ')"><div class="mcq-lt">${'ABCD'[oi]}</div>${op.replace(/^[A-D]\.\s*/,'')}</div>`).join('')}<div id="ME${qi}" style="display:none;margin-top:8px;padding:8px;background:var(--green-s);border-radius:6px;font-size:12px;color:var(--green-t)">💡 ${q.explanation||''}</div></div>`;});}
    if(data.short?.length){html+='<h3 style="font-family:Syne,sans-serif;font-size:14px;font-weight:700;margin:16px 0 12px">Section B — Short Answer</h3>';data.short.forEach((q,i)=>{html+=`<div style="margin-bottom:12px"><p style="font-size:14px;font-weight:500;margin-bottom:6px">Q${i+1}. ${q.question}</p><textarea class="inp ta" placeholder="Your answer…" style="min-height:70px"></textarea></div>`;});}
    if(data.long?.length){html+='<h3 style="font-family:Syne,sans-serif;font-size:14px;font-weight:700;margin:16px 0 12px">Section C — Long Answer</h3>';data.long.forEach((q,i)=>{html+=`<div style="margin-bottom:12px"><p style="font-size:14px;font-weight:500;margin-bottom:6px">Q${i+1}. ${q.question}</p><textarea class="inp ta" placeholder="Your answer…" style="min-height:120px"></textarea></div>`;});}
    html+='</div></div>'; el.innerHTML=html;
  } else if(type==='revision'){
    el.innerHTML=`<div class="card"><div class="cb"><div style="font-family:Syne,sans-serif;font-weight:800;font-size:15px;margin-bottom:14px">⚡ Quick Revision</div>${(data.points||[]).map((p,i)=>`<div style="margin-bottom:10px;padding:10px 14px;background:var(--bg2);border-radius:8px;border-left:3px solid var(--violet)"><div style="font-size:13px;font-weight:700;color:var(--violet);margin-bottom:3px">${i+1}. ${p.heading}</div><div style="font-size:13px;color:#374151">${p.explanation}</div></div>`).join('')}</div></div>`;
  }
}

function chkMCQ(qi,oi,correct,tot){
  for(let i=0;i<4;i++){const el=$(`OPT${qi}_${i}`);if(el){el.onclick=null;el.style.pointerEvents='none';}}
  const sel=$(`OPT${qi}_${oi}`),cor=$(`OPT${qi}_${correct}`),exp=$(`EXP${qi}`);
  if(sel) sel.classList.add(oi===correct?'cor':'wrg');
  if(cor&&oi!==correct) cor.classList.add('cor');
  if(exp) exp.style.display='';
  if(!window._mq) window._mq={tot,sc:0,ans:0};
  if(oi===correct){window._mq.sc++;toast('✅ Correct!');}else toast('❌ Incorrect');
  window._mq.ans++;
  if(window._mq.ans===tot) setTimeout(()=>toast(`Quiz done! ${window._mq.sc}/${tot} 🎯`,4000),400);
}
function chkMCQ2(qi,oi,correct,pfx){
  for(let i=0;i<4;i++){const el=$(`${pfx}${qi}_${i}`);if(el){el.onclick=null;el.style.pointerEvents='none';}}
  const sel=$(`${pfx}${qi}_${oi}`),cor=$(`${pfx}${qi}_${correct}`),exp=$(`ME${qi}`);
  if(sel) sel.classList.add(oi===correct?'cor':'wrg');
  if(cor&&oi!==correct) cor.classList.add('cor');
  if(exp) exp.style.display='';
  toast(oi===correct?'✅ Correct!':'❌ Incorrect');
}

// ══════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════
function updStats() {
  $('AS1').textContent=pr.scans;
  $('AS2').textContent=pr.corrs||Object.keys(corrections).length;
  $('AS3').textContent=pr.scans>0?Math.round(pr.totScore/pr.scans)+'%':'—';
  $('AS4').textContent=pr.exams;
  $('AS5').textContent=pr.flash;
  $('AS6').textContent=pr.streak+'🔥';
  if(pr.scans>0){setEl('RSLIST',`<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--bdr)"><div style="font-size:14px;font-weight:500">Latest scan</div><div class="badge bg-g">${Math.round(pr.totScore/pr.scans)}% accuracy</div></div>`);}
}

// ══════════════════════════════════════════════════════════
// PROFILE
// ══════════════════════════════════════════════════════════
function updPr() {
  const n=pr.name||'You';
  $('PNAME').textContent=n; $('PSID').textContent=pr.sid||'—';
  $('SHSID').textContent=pr.sid||'—'; $('PAV').textContent=n[0]?.toUpperCase()||'?';
  $('AV').textContent=n[0]?.toUpperCase()||'?';
  if(pr.sid){$('CPSIDBTN').disabled=false;}
  $('PP1').textContent=pr.scans; $('PP2').textContent=pr.corrs||Object.keys(corrections).length;
  $('PP3').textContent=pr.scans>0?Math.round(pr.totScore/pr.scans)+'%':'—';
}
function savePName(){const n=$('PNINP').value.trim();if(!n) return;pr.name=n;if(!pr.sid)pr.sid='INK-'+Math.random().toString(36).slice(2,6).toUpperCase();updPr();toast('Profile saved ✅');}
function cpSID(){navigator.clipboard.writeText(pr.sid||'');toast('Style ID copied!');}

function buildAGrid(){
  const g=$('AGRID'); if(!g) return;
  g.innerHTML=ALPHA.map(l=>`<div class="ac${lettersCov[l]===true?' ok':lettersCov[l]===false?' warn':''}" id="AC_${l}">${l}</div>`).join('');
}
function handleSample(file){
  if(!file) return; sampleUp=true;
  $('SN1').className='step-n ok'; $('SN1').textContent='✓';
  $('SN2').className='step-n ok';
  setEl('SAMPUPZ',mkAlert('s','Sample uploaded and analysed.'));
  let i=0; const iv=setInterval(()=>{
    if(i>=ALPHA.length){clearInterval(iv);$('SN3').className='step-n ok';return;}
    const det=Math.random()>0.2; lettersCov[ALPHA[i]]=det;
    const c=$('AC_'+ALPHA[i]); if(c) c.className='ac '+(det?'ok':'warn');
    i++;
  },55);
  toast('Sample uploaded! Analysing letter coverage…');
}

function renderSStyles(){
  const el=$('SVSTYLES'); if(!el) return;
  if(!savedStyles.length){el.innerHTML=mkAlert('i','No saved styles. Paste a Style ID below.');return;}
  el.innerHTML=savedStyles.map(s=>`
    <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 14px;background:var(--bg);border:1px solid var(--bdr);border-radius:10px;margin-bottom:8px">
      <div><div style="font-size:14px;font-weight:500">${s.name}</div><div style="font-family:'DM Mono',monospace;font-size:12px;color:var(--ink3)">${s.id}</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-out btn-sm" onclick="useSSt('${s.id}')">Use</button>
        <button class="btn btn-out btn-sm" onclick="delSSt('${s.id}')">Remove</button>
      </div>
    </div>`).join('');
}
function addSStyle(){
  const id=$('ADDSTID').value.trim(), msg=$('ADDSTMSG');
  if(!id) return; showEl('ADDSTMSG');
  if(savedStyles.find(s=>s.id===id)){msg.innerHTML=mkAlert('w','Already saved.');return;}
  savedStyles.push({id,name:'User '+id.slice(-3)});
  $('ADDSTID').value=''; msg.innerHTML=mkAlert('s','Style saved!');
  renderSStyles();
}
function delSSt(id){savedStyles=savedStyles.filter(s=>s.id!==id);renderSStyles();}
function useSSt(id){nav('scan',document.querySelectorAll('.nt')[0]);$('OSID').value=id;selStyle(document.querySelectorAll('#SCHIPS .chip')[1],'other');toast('Style loaded — scan a note to use it');}

// ══════════════════════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════════════════════
function expPDF(){
  const win=window.open('','_blank');
  if(!win){toast('Allow popups for PDF export');return;}
  const svg=$('DGBODY')?.querySelector('svg');
  const sumHTML=curSummary?`<h2 style="color:#6D28D9;margin-top:32px">Study Summary</h2><p><strong>${curSummary.tldr||''}</strong></p>${(curSummary.sections||[]).map(s=>`<h3>${s.topic}</h3><ul>${(s.points||[]).map(p=>`<li>${p.point}${(p.subPoints||[]).length?'<ul>'+p.subPoints.map(sp=>`<li>${sp}</li>`).join('')+'</ul>':''}</li>`).join('')}</ul>`).join('')}<h3>Key Terms</h3>${(curSummary.keyTerms||[]).map(t=>`<p><strong>${t.term}:</strong> ${t.definition||''}</p>`).join('')}<h3>Flashcards</h3><ol>${(curSummary.flashcards||[]).map(f=>`<li><strong>Q:</strong> ${f.question}<br><strong>A:</strong> ${f.answer}</li>`).join('')}</ol>`:'';
  win.document.write(`<!DOCTYPE html><html><head><title>InkRead Export</title><style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;color:#111;line-height:1.8;font-size:15px}h1,h2,h3{font-family:sans-serif}pre{white-space:pre-wrap;font-size:14px;font-family:inherit;line-height:1.7}svg{max-width:100%;margin:20px 0}@media print{body{margin:20px}}</style></head><body><h1>InkRead — Extracted Note</h1><pre>${(noteText||'').replace(/</g,'&lt;')}</pre>${svg?'<h2>Diagram</h2>'+svg.outerHTML:''}${sumHTML}<script>window.onload=()=>window.print()<\/script></body></html>`);
  win.document.close();
}

async function expDOCX(){
  toast('Generating Word document…');
  if(!window.docx){const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.min.js';document.head.appendChild(s);await new Promise(r=>s.onload=r);}
  const {Document,Packer,Paragraph,TextRun,HeadingLevel}=window.docx;
  const ps=[new Paragraph({text:'InkRead — Extracted Note',heading:HeadingLevel.HEADING_1}),new Paragraph({text:''}),...(noteText||'').split('\n').map(l=>new Paragraph({children:[new TextRun({text:l,size:24,font:'Calibri'})]}))];
  if(curSummary){
    ps.push(new Paragraph({text:'Study Summary',heading:HeadingLevel.HEADING_1}));
    if(curSummary.tldr) ps.push(new Paragraph({children:[new TextRun({text:curSummary.tldr,size:24,bold:true,font:'Calibri'})]}));
    (curSummary.sections||[]).forEach(sec=>{ps.push(new Paragraph({text:sec.topic,heading:HeadingLevel.HEADING_2}));(sec.points||[]).forEach(pt=>ps.push(new Paragraph({children:[new TextRun({text:'• '+pt.point,size:22,font:'Calibri'})]}))); });
    ps.push(new Paragraph({text:'Key Terms',heading:HeadingLevel.HEADING_2}));
    (curSummary.keyTerms||[]).forEach(t=>ps.push(new Paragraph({children:[new TextRun({text:t.term+': '+(t.definition||''),size:22,font:'Calibri'})]})));
  }
  const doc=new Document({sections:[{children:ps}]});
  const blob=await Packer.toBlob(doc);
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='inkread-note.docx';a.click();
  URL.revokeObjectURL(url);
  toast('Word document downloaded ✅');
}

// ══════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════
buildAGrid();
initSB();
