(function(){
const TRAINER_KEY="bird-whistle-local-v3";
const KIT_KEY="bird-whistle-kit-v1";
const LISTA_KEY="bird-lista-kf-v1";
const SYNC_KEY="bird-whistle-sync-v1";
const CLOUD="https://jsonblob.iiif.arthistoricum.net/api/jsonBlob";
const UUID=/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;
const DEFAULT_KIT=[
  "Ralik whistle",
  "Ralik whistle + lip oscillation",
  "Ralik whistle: stretched",
  "Seagull whistle",
  "Slizzer roll whistle",
  "Hollow whistle",
  "Tooth whistle",
  "Inward tooth whistle",
  "Recorder whistle",
  "Poh snare"
];

function readJSON(k, fallback){
  try{
    const v=JSON.parse(localStorage.getItem(k)||"null");
    return v==null?fallback:v;
  }catch(e){ return fallback; }
}
function now(){ return Date.now(); }

const trainer=readJSON(TRAINER_KEY, {});
const lista=readJSON(LISTA_KEY, {});
function loadKit(){
  const raw=readJSON(KIT_KEY, null);
  if(Array.isArray(raw) && raw.every(x=>typeof x==="string")) return raw.filter(x=>x.trim());
  return DEFAULT_KIT.slice();
}
const kit=loadKit();
let kitStamp=localStorage.getItem(KIT_KEY)?now():0;
let syncId="";
try{ syncId=(readJSON(SYNC_KEY, {})||{}).id||""; }catch(e){}
let cloudTimer=null;
let pollTimer=null;
let pollBound=false;
let onRemote=()=>{};

function looksLikeRows(obj){
  if(!obj||typeof obj!=="object"||Array.isArray(obj)) return false;
  const keys=Object.keys(obj);
  return keys.length>0 && keys.every(k=>/^\d+$/.test(k) && obj[k] && typeof obj[k]==="object");
}
function mergeMap(local, remote){
  if(!remote||typeof remote!=="object"||Array.isArray(remote)) return false;
  let changed=false;
  for(const [id,row] of Object.entries(remote)){
    if(!row||typeof row!=="object") continue;
    const cur=local[id];
    if(!cur || (row.t||0)>=(cur.t||0)){
      local[id]={...cur, ...row};
      changed=true;
    }
  }
  return changed;
}
function stampMap(rows, t){
  if(!rows||typeof rows!=="object") return;
  for(const row of Object.values(rows)){
    if(row && typeof row==="object") row.t=t;
  }
}
function persistTrainer(){ localStorage.setItem(TRAINER_KEY, JSON.stringify(trainer)); }
function persistLista(){ localStorage.setItem(LISTA_KEY, JSON.stringify(lista)); }
function persistKit(){ localStorage.setItem(KIT_KEY, JSON.stringify(kit)); }
function payload(){
  return {v:2, t:now(), rows:trainer, kit, kitT:kitStamp, lista};
}
function mergeCloud(remote){
  if(!remote||typeof remote!=="object") return false;
  let changed=false;
  let rows=remote.rows;
  if(!rows && looksLikeRows(remote) && !remote.lista) rows=remote;
  if(rows && mergeMap(trainer, rows)) changed=true;
  if(remote.lista && mergeMap(lista, remote.lista)) changed=true;
  if(Array.isArray(remote.kit) && (remote.kitT||0)>=kitStamp){
    const next=remote.kit.filter(x=>typeof x==="string" && x.trim());
    kit.length=0;
    kit.push(...next);
    kitStamp=remote.kitT||now();
    persistKit();
    changed=true;
  }
  return changed;
}
function saveTrainer(){
  persistTrainer();
  scheduleCloud();
}
function saveLista(){
  persistLista();
  scheduleCloud();
}
function saveKit(){
  kitStamp=now();
  persistKit();
  scheduleCloud();
}
function b64fromBytes(bytes){
  let s="";
  bytes.forEach(b=>s+=String.fromCharCode(b));
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function bytesfromB64(s){
  s=s.replace(/-/g,"+").replace(/_/g,"/");
  while(s.length%4) s+="=";
  return Uint8Array.from(atob(s), c=>c.charCodeAt(0));
}
async function encodeSnap(obj){
  const text=JSON.stringify(obj);
  if(window.CompressionStream){
    const stream=new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const buf=await new Response(stream).arrayBuffer();
    return "z"+b64fromBytes(new Uint8Array(buf));
  }
  return "u"+btoa(unescape(encodeURIComponent(text))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function decodeSnap(s){
  s=decodeURIComponent(s);
  if(s.startsWith("z") && window.DecompressionStream){
    const bytes=bytesfromB64(s.slice(1));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return JSON.parse(await new Response(stream).text());
  }
  if(s.startsWith("u")){
    let b64=s.slice(1).replace(/-/g,"+").replace(/_/g,"/");
    while(b64.length%4) b64+="=";
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  }
  return JSON.parse(s);
}
async function cloudCreate(){
  const r=await fetch(CLOUD,{
    method:"POST",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify(payload())
  });
  if(!r.ok) throw new Error("create "+r.status);
  const id=r.headers.get("x-jsonblob")||(r.headers.get("location")||"").split("/").filter(Boolean).pop();
  if(!id) throw new Error("no id");
  return id;
}
async function cloudGet(id){
  const r=await fetch(CLOUD+"/"+id,{headers:{"Accept":"application/json"}});
  if(r.status===404) return null;
  if(!r.ok) throw new Error("get "+r.status);
  return r.json();
}
async function cloudPut(id){
  const r=await fetch(CLOUD+"/"+id,{
    method:"PUT",
    headers:{"Content-Type":"application/json","Accept":"application/json"},
    body:JSON.stringify(payload())
  });
  if(!r.ok) throw new Error("put "+r.status);
}
function shareUrl(){
  const u=new URL(location.href);
  u.hash="";
  if(syncId) u.searchParams.set("s", syncId);
  else u.searchParams.delete("s");
  return u.toString();
}
function snapUrl(){
  return location.origin+location.pathname.replace(/index\.html$|lista\.html$/,"")+"#d=";
}
function setSyncId(id){
  syncId=id||"";
  if(syncId) localStorage.setItem(SYNC_KEY, JSON.stringify({id:syncId}));
  else localStorage.removeItem(SYNC_KEY);
  const u=new URL(location.href);
  if(syncId) u.searchParams.set("s", syncId);
  else u.searchParams.delete("s");
  history.replaceState(null, "", u.pathname+u.search);
  renderSync();
}
function setSyncState(t){
  const el=document.getElementById("syncState");
  if(el) el.textContent=t;
}
function setSyncMsg(t){
  const el=document.getElementById("syncMsg");
  if(el) el.textContent=t||"";
}
function renderSync(){
  const on=document.getElementById("syncOn");
  const off=document.getElementById("syncOff");
  const link=document.getElementById("syncLink");
  if(!on) return;
  if(syncId){
    on.hidden=true;
    off.hidden=false;
    if(link) link.textContent="Kod: "+syncId+" · "+shareUrl();
    setSyncState("sync włączony");
  }else{
    on.hidden=false;
    off.hidden=true;
    if(link) link.textContent="";
    setSyncState("tylko to urządzenie");
  }
}
function scheduleCloud(){
  if(!syncId) return;
  clearTimeout(cloudTimer);
  setSyncState("zapisuję…");
  cloudTimer=setTimeout(()=>{
    cloudPut(syncId)
      .then(()=>setSyncState("zsynchronizowano"))
      .catch(()=>setSyncState("błąd zapisu, dane są lokalnie"));
  }, 700);
}
async function pullCloud(){
  if(!syncId) return;
  try{
    const remote=await cloudGet(syncId);
    if(remote && mergeCloud(remote)){
      persistTrainer();
      persistLista();
      onRemote();
    }
    setSyncState("zsynchronizowano");
  }catch(e){
    setSyncState("brak sieci, zapis lokalny");
  }
}
function startPoll(){
  clearInterval(pollTimer);
  if(!syncId) return;
  pollTimer=setInterval(pullCloud, 12000);
  if(!pollBound){
    pollBound=true;
    document.addEventListener("visibilitychange", ()=>{
      if(!document.hidden && syncId) pullCloud();
    });
  }
}
async function ingest(raw){
  if(raw==null) return false;
  if(typeof raw==="string"){
    raw=raw.trim();
    if(!raw) return false;
    if(raw.includes("#d=")){
      const packed=raw.slice(raw.indexOf("#d=")+3);
      return ingest(await decodeSnap(packed));
    }
    const id=(raw.match(UUID)||[])[0];
    if(id && !raw.startsWith("{") && !raw.startsWith("z") && !raw.startsWith("u")){
      setSyncId(id);
      await pullCloud();
      startPoll();
      return true;
    }
    if(raw.startsWith("z")||raw.startsWith("u")) return ingest(await decodeSnap(raw));
    raw=JSON.parse(raw);
  }
  const t=now();
  if(raw["bird-whistle-local-v3"]){
    let rows=raw["bird-whistle-local-v3"];
    if(typeof rows==="string") rows=JSON.parse(rows);
    stampMap(rows, t);
    mergeMap(trainer, rows);
  }
  if(raw["bird-whistle-kit-v1"]){
    let remoteKit=raw["bird-whistle-kit-v1"];
    if(typeof remoteKit==="string") remoteKit=JSON.parse(remoteKit);
    if(Array.isArray(remoteKit)){
      kit.length=0;
      kit.push(...remoteKit.filter(x=>typeof x==="string" && x.trim()));
      kitStamp=t;
      persistKit();
    }
  }
  if(raw["bird-lista-kf-v1"]){
    let rows=raw["bird-lista-kf-v1"];
    if(typeof rows==="string") rows=JSON.parse(rows);
    stampMap(rows, t);
    mergeMap(lista, rows);
  }
  if(raw.rows || raw.lista || Array.isArray(raw.kit)) mergeCloud(raw);
  else if(!raw["bird-whistle-local-v3"] && !raw["bird-lista-kf-v1"] && looksLikeRows(raw)) mergeMap(trainer, raw);
  persistTrainer();
  persistLista();
  onRemote();
  return true;
}
function pack(){
  return {
    "bird-whistle-local-v3": trainer,
    "bird-whistle-kit-v1": kit,
    "bird-lista-kf-v1": lista,
    ...payload()
  };
}
function bindUI(opts){
  onRemote=opts&&opts.onRemote?opts.onRemote:()=>{};
  const panel=document.getElementById("syncPanel");
  const syncBtn=document.getElementById("syncBtn");
  if(syncBtn) syncBtn.onclick=()=>{ if(panel) panel.hidden=!panel.hidden; };
  const syncOn=document.getElementById("syncOn");
  if(syncOn) syncOn.onclick=async()=>{
    try{
      setSyncMsg("łączę…");
      const id=await cloudCreate();
      setSyncId(id);
      startPoll();
      setSyncMsg("Sync włączony. Skopiuj link i otwórz go na telefonie. Twoje obecne notatki już tam weszły.");
    }catch(e){
      try{
        const url=snapUrl()+await encodeSnap(payload());
        const link=document.getElementById("syncLink");
        if(link) link.textContent=url;
        setSyncMsg("Chmura nie odpowiada. Skopiuj link poniżej i otwórz go na telefonie. To jednorazowa kopia notatek.");
      }catch(err){
        setSyncMsg("Chmura nie odpowiada. Użyj kopii zapasowej poniżej albo spróbuj za chwilę.");
      }
    }
  };
  const syncCopy=document.getElementById("syncCopy");
  if(syncCopy) syncCopy.onclick=async()=>{
    try{
      let url=shareUrl();
      if(!syncId) url=snapUrl()+await encodeSnap(payload());
      await navigator.clipboard.writeText(url);
      setSyncMsg("Link skopiowany. Otwórz go na telefonie.");
    }catch(e){
      setSyncMsg("Nie dało się skopiować. Zaznacz link ręcznie.");
    }
  };
  const syncOff=document.getElementById("syncOff");
  if(syncOff) syncOff.onclick=()=>{
    clearInterval(pollTimer);
    setSyncId("");
    setSyncMsg("To urządzenie jest odłączone. Notatki zostają tutaj.");
  };
  const syncJoin=document.getElementById("syncJoin");
  if(syncJoin) syncJoin.onsubmit=async e=>{
    e.preventDefault();
    const raw=document.getElementById("syncCode").value.trim();
    if(!raw) return;
    try{
      await ingest(raw);
      if(syncId) startPoll();
      setSyncMsg("Połączono. Dane z drugiego urządzenia są tutaj.");
      document.getElementById("syncCode").value="";
    }catch(err){
      setSyncMsg("Nie udało się wczytać tego kodu albo linku.");
    }
  };
  const syncExport=document.getElementById("syncExport");
  if(syncExport) syncExport.onclick=async()=>{
    const dump=JSON.stringify(pack(),null,2);
    try{
      await navigator.clipboard.writeText(dump);
      setSyncMsg("Dane skopiowane. Wklej je w kopii zapasowej na telefonie.");
    }catch(e){
      document.getElementById("syncPaste").value=dump;
      setSyncMsg("Wklejone do pola poniżej. Skopiuj ręcznie.");
    }
  };
  const syncImport=document.getElementById("syncImport");
  if(syncImport) syncImport.onclick=async()=>{
    const raw=document.getElementById("syncPaste").value.trim();
    if(!raw) return;
    try{
      await ingest(raw);
      if(syncId){
        await cloudPut(syncId).catch(()=>{});
        startPoll();
      }
      setSyncMsg("Wczytane. Te dane są teraz na tym urządzeniu.");
    }catch(e){
      setSyncMsg("To nie wygląda na poprawne dane.");
    }
  };
  (async function initSync(){
    const params=new URLSearchParams(location.search);
    let sid=params.get("s")||"";
    if(!sid && location.hash.startsWith("#s=")) sid=location.hash.slice(3);
    if(location.hash.startsWith("#d=")){
      try{
        await ingest(await decodeSnap(location.hash.slice(3)));
        setSyncMsg("Wczytano notatki z linku.");
      }catch(e){}
      history.replaceState(null, "", location.pathname+(sid?("?s="+sid):""));
    }
    if(!sid) sid=syncId;
    if(sid){
      setSyncId(sid);
      await pullCloud();
      startPoll();
    }else{
      renderSync();
    }
  })();
}

window.BirdSync={
  trainer, lista, kit,
  saveTrainer, saveLista, saveKit,
  bindUI
};

})();
