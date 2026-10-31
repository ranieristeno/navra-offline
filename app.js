/* NAVRA: offline-first watch business tracker, optional Supabase multi-device sync. */
'use strict';
const DB_NAME = 'navra-local-v1';
const SCHEMA = {
  watch: {title:'Orologio',plural:'Orologi',fields:[
    ['brand','Marca','text',true],['model','Modello','text',true],['reference','Referenza / calibro','text'],['serial','Numero seriale','text'],
    ['condition','Condizione','select',false,['Da verificare','Da revisionare','Buono','Ottimo','NOS']],
    ['purchase','Prezzo acquisto (€)','number'],['buyDate','Data acquisto','date'],['supplier','Fornitore','text'],['purchaseShipping','Spese acquisto / spedizione (€)','number'],
    ['status','Stato','select',false,['Disponibile','Venduto','Riservato']],['salePrice','Prezzo vendita (€)','number'],['saleDate','Data vendita','date'],['fees','Commissioni / spese vendita (€)','number'],
    ['notes','Note','textarea']]},
  supplier:{title:'Fornitore',plural:'Fornitori',fields:[['name','Nome / attività','text',true],['country','Paese','text'],['contact','Contatto','text'],['channel','Telegram / WhatsApp / Instagram','text'],['website','Link / profilo','text'],['notes','Note','textarea']]},
  shipment:{title:'Spedizione',plural:'Spedizioni',fields:[['name','Riferimento / descrizione','text',true],['from','Da','text'],['to','A','text'],['carrier','Corriere','text'],['tracking','Tracking','text'],['date','Data','date'],['cost','Costo (€)','number'],['status','Stato','select',false,['Da spedire','In transito','Consegnata','Problema']],['notes','Note','textarea']]},
  market:{title:'Mercatino',plural:'Mercatini',fields:[['name','Nome mercatino','text',true],['city','Città','text'],['date','Data','date'],['fee','Costo banco (€)','number'],['revenue','Incassi (€)','number'],['notes','Note','textarea']]}
};
const $ = (s)=>document.querySelector(s);
const esc = (v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const eur = (x)=>new Intl.NumberFormat('it-IT',{style:'currency',currency:'EUR'}).format(Number(x)||0);
const num = (x)=>Number(x)||0;
const dbDate = (x)=>x ? new Date(x).toLocaleDateString('it-IT') : '—';
let db;
let state={view:'home',records:[],settings:{owner:'Socio 1',partner:'Socio 2',share:50},search:'',editing:null,busy:false};
function reqPromise(req){return new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function initDB(){db=await new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const d=req.result;d.createObjectStore('records',{keyPath:'id'});d.createObjectStore('settings',{keyPath:'key'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function allRecords(){return reqPromise(db.transaction('records','readonly').objectStore('records').getAll());}
async function putRecord(record){await reqPromise(db.transaction('records','readwrite').objectStore('records').put(record));}
async function getSetting(key){const result=await reqPromise(db.transaction('settings','readonly').objectStore('settings').get(key));return result?.value;}
async function setSetting(key,value){await reqPromise(db.transaction('settings','readwrite').objectStore('settings').put({key,value}));}
async function reload(){state.records=(await allRecords()).filter(r=>!r.deleted_at).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));render();}
function setStatus(message){const el=$('#status');if(el) el.textContent=message;}
function updateNetwork(){const el=$('#connection');if(!el)return;el.className='connect'+(navigator.onLine?' online':'');el.innerHTML='<i></i>'+(navigator.onLine?'Online':'Offline');}
function button(label,action,extra=''){return '<button type="button" class="btn '+extra+'" data-action="'+action+'">'+esc(label)+'</button>';}
function metric(label,value){return '<div class="metric"><div class="label">'+esc(label)+'</div><div class="num">'+esc(value)+'</div></div>';}
function dashboard(){const watches=state.records.filter(r=>r.type==='watch');const available=watches.filter(r=>r.data.status!=='Venduto');const sold=watches.filter(r=>r.data.status==='Venduto');const profit=sold.reduce((s,r)=>s+num(r.data.salePrice)-num(r.data.purchase)-num(r.data.purchaseShipping)-num(r.data.fees),0);
const invested=available.reduce((s,r)=>s+num(r.data.purchase)+num(r.data.purchaseShipping),0);
const percent=Math.max(0,Math.min(100,num(state.settings.share)));
const recent=state.records.filter(r=>r.type==='watch').slice(0,4);
return '<div class="head"><h1>La tua collezione</h1>'+button('+ Orologio','add-watch','gold')+'</div><div class="metrics">'+metric('In magazzino',available.length)+metric('Venduti',sold.length)+metric('Capitale in stock',eur(invested))+metric('Utile netto vendite',eur(profit))+'</div>'+ 
'<div class="panel" style="margin-top:14px"><strong>Ripartizione utili realizzati</strong><div class="table-row"><span>'+esc(state.settings.owner)+' ('+percent+'%)</span><strong>'+eur(profit*percent/100)+'</strong></div><div class="table-row"><span>'+esc(state.settings.partner)+' ('+(100-percent)+'%)</span><strong>'+eur(profit*(100-percent)/100)+'</strong></div><p class="hint">Utile calcolato sui soli orologi venduti: ricavi meno acquisto, spedizione d’acquisto e commissioni. I costi dei mercatini e delle spedizioni separate non sono ancora sottratti automaticamente.</p></div>'+ 
'<div class="head"><h2>Ultimi orologi</h2><button class="btn alt small" data-view="watch">Vedi tutti</button></div>'+(recent.length?'<div class="list">'+recent.map(recordCard).join('')+'</div>':'<div class="empty">Nessun orologio ancora inserito.<p>Premi “+ Orologio” per aggiungere il primo.</p></div>');}
function recordTitle(r){const d=r.data;return r.type==='watch'?[d.brand,d.model].filter(Boolean).join(' ') : d.name||'Senza nome';}
function recordCard(r){const d=r.data;let minor='',amount='',tag='';
if(r.type==='watch'){minor=[d.reference,d.serial].filter(Boolean).join(' · ');amount=d.status==='Venduto'?eur(d.salePrice):eur(d.purchase);tag=d.status||'Disponibile';}
if(r.type==='supplier'){minor=[d.country,d.channel,d.contact].filter(Boolean).join(' · ');}
if(r.type==='shipment'){minor=[d.carrier,d.tracking,d.to].filter(Boolean).join(' · ');amount=eur(d.cost);tag=d.status||'';}
if(r.type==='market'){minor=[d.city,dbDate(d.date)].filter(Boolean).join(' · ');amount=eur(d.revenue);}
return '<article class="item"><div style="min-width:0"><h3>'+esc(recordTitle(r))+'</h3><div class="minor">'+esc(minor||d.notes||'')+'</div>'+(tag?'<span class="pill">'+esc(tag)+'</span>':'')+'</div><div><div class="amount">'+esc(amount)+'</div><button type="button" class="btn alt small" data-edit="'+esc(r.id)+'">Modifica</button></div></article>';}
function recordsView(type){const schema=SCHEMA[type];return '<div class="head"><h1>'+schema.plural+'</h1>'+button('+ Aggiungi','add-'+type,'gold')+'</div><input id="search" class="searchbar" type="search" placeholder="Cerca per nome, codice, note..." value="'+esc(state.search)+'" aria-label="Cerca"><div id="record-list"></div>';}
function filteredRecords(type){return state.records.filter(r=>r.type===type&&JSON.stringify(r.data).toLowerCase().includes(state.search.trim().toLowerCase()));}
function renderList(){let el=$('#record-list');if(!el)return;const records=filteredRecords(state.view);el.innerHTML=records.length?'<div class="list">'+records.map(recordCard).join('')+'</div>':'<div class="empty">Nessun risultato. Puoi aggiungere una nuova scheda con il pulsante in alto.</div>';}
function settingsView(){const s=state.settings;return '<div class="head"><h1>Impostazioni</h1></div><section class="panel"><h2>Soci e percentuali</h2><div class="fields"><div class="field"><label for="owner">Primo socio</label><input id="owner" value="'+esc(s.owner)+'"></div><div class="field"><label for="partner">Secondo socio</label><input id="partner" value="'+esc(s.partner)+'"></div><div class="field"><label for="share">Quota primo socio (%)</label><input id="share" type="number" min="0" max="100" step="1" value="'+esc(s.share)+'"></div></div><div class="actions">'+button('Salva impostazioni','settings-save')+'</div></section><section class="panel"><h2>Backup dei dati</h2><p class="hint">Esporta regolarmente un backup JSON. I dati offline sono salvati in questo iPhone, non su GitHub. Se Safari elimina i dati del sito prima di aver attivato la sincronizzazione, potresti perderli.</p><div class="actions">'+button('Scarica backup','export','alt')+'<label class="btn alt" for="import-file" style="color:var(--dark);font-size:15px">Importa backup</label><input id="import-file" style="display:none" type="file" accept=".json,application/json"></div></section>';
}
function syncView(){const conf=state.syncConfig||{},auth=state.auth,work=state.workspace;
let result='<div class="head"><h1>Sincronizzazione</h1></div><div class="notice">NAVRA funziona offline fin da subito. Per condividere i dati tra due iPhone occorre configurare un progetto Supabase privato con le regole di sicurezza incluse nel pacchetto dell’app. Non inserire chiavi segrete o service_role.</div>';
if(!conf.url||!conf.key){return result+'<section class="panel"><h2>1. Collega il database</h2><p class="hint">Inserisci solo il Project URL e la chiave pubblica anon / publishable di Supabase.</p><div class="fields"><div class="field wide"><label>Supabase Project URL</label><input id="sb-url" placeholder="https://progetto.supabase.co"></div><div class="field wide"><label>Public anon / publishable key</label><input id="sb-key" placeholder="sb_publishable_... oppure eyJ..."></div></div><div class="actions">'+button('Salva collegamento','sync-config')+'</div></section>';}
result+='<section class="panel"><h2>Database collegato</h2><p class="hint">'+esc(conf.url)+'</p><div class="actions">'+button('Cambia configurazione','sync-reset','alt')+'</div></section>';
if(!auth?.access_token){return result+'<section class="panel"><h2>2. Accesso dei soci</h2><div class="fields"><div class="field wide"><label>Email</label><input type="email" id="auth-email" autocomplete="email"></div><div class="field wide"><label>Password</label><input type="password" id="auth-password" autocomplete="current-password" minlength="8"></div></div><div class="actions">'+button('Accedi','signin')+button('Crea account','signup','alt')+'</div><p class="hint">Ogni socio usa il proprio account. Supabase potrebbe richiedere di verificare l’email prima dell’accesso.</p><p id="status" class="status"></p></section>';}
result+='<section class="panel"><div class="flex"><h2>Account connesso</h2>'+button('Esci','signout','alt small')+'</div>';
if(!work?.workspace_id){result+='<h2>3. Crea o raggiungi il gruppo NAVRA</h2><div class="fields"><div class="field wide"><label>Nome gruppo</label><input id="workspace-name" value="NAVRA"></div></div><div class="actions">'+button('Crea gruppo','workspace-create')+'</div><hr style="border:0;border-top:1px solid var(--line);margin:22px 0"><div class="field"><label>Codice invito ricevuto dal socio</label><input id="invite-code" placeholder="Codice invito"></div><div class="actions">'+button('Entra nel gruppo','workspace-join','alt')+'</div>';
}else{result+='<p><strong>Gruppo attivo:</strong> '+esc(work.name||'NAVRA')+'</p>'+(work.invite_code?'<p class="hint">Codice da inviare esclusivamente al tuo socio: <strong>'+esc(work.invite_code)+'</strong></p>':'')+'<div class="actions">'+button('Sincronizza ora','sync-now')+button('Copia invito','copy-code','alt')+'</div><p class="hint">Una volta attiva, la sincronizzazione avviene all’apertura dell’app, al ritorno di Internet e periodicamente mentre l’app è aperta. Due modifiche contemporanee alla stessa scheda usano la più recente.</p>';}
result+='<p id="status" class="status">'+esc(state.syncMessage||'')+'</p></section>';return result;
}
function render(){updateNetwork();$$('#nav [data-view]').forEach(btn=>btn.classList.toggle('active',btn.dataset.view===state.view));let html='';if(state.view==='home')html=dashboard();else if(SCHEMA[state.view])html=recordsView(state.view);else if(state.view==='settings')html=settingsView();else if(state.view==='sync')html=syncView();$('#content').innerHTML=html;if(SCHEMA[state.view])renderList();}
function $$(s){return Array.from(document.querySelectorAll(s));}
function editModal(type,id){const schema=SCHEMA[type],record=id?state.records.find(r=>r.id===id):null;state.editing={type,id};$('#form-title').textContent=(id?'Modifica ':'Nuovo ')+schema.title.toLowerCase();
$('#form-fields').innerHTML=schema.fields.map(([key,label,kind,required,options])=>{const value=record?.data[key]??'';let input='';const common=' id="f-'+esc(key)+'" name="'+esc(key)+'"'+(required?' required':'');if(kind==='select'){input='<select'+common+'>'+['',...(options||[])].map(o=>'<option value="'+esc(o)+'"'+(value===o?' selected':'')+'>'+esc(o||'Seleziona...')+'</option>').join('')+'</select>';}else if(kind==='textarea'){input='<textarea'+common+'>'+esc(value)+'</textarea>';}else{input='<input'+common+' type="'+kind+'"'+(kind==='number'?' inputmode="decimal" step="0.01" min="0"':'')+' value="'+esc(value)+'">';}return '<div class="field'+(kind==='textarea'?' wide':'')+'"><label for="f-'+esc(key)+'">'+esc(label)+'</label>'+input+'</div>';}).join('');
if(id){$('#form-fields').insertAdjacentHTML('beforeend','<div class="field wide">'+button('Elimina questa scheda','delete-record','warn')+'</div>');}
$('#editor').showModal();}
async function saveEdit(evt){evt.preventDefault();const type=state.editing?.type,id=state.editing?.id;if(!type)return;const obj={};for(const [key,,kind] of SCHEMA[type].fields){const el=$('#f-'+key);obj[key]=kind==='number'?num(el.value):el.value.trim();}if(type==='watch'&&!obj.status)obj.status='Disponibile';const old=id?state.records.find(r=>r.id===id):null;const record={id:id||crypto.randomUUID(),type,data:obj,updated_at:new Date().toISOString(),deleted_at:null};if(old?.created_at)record.created_at=old.created_at;else record.created_at=record.updated_at;
await putRecord(record);$('#editor').close();state.search='';await reload();autoSync();}
async function deleteEdit(){const id=state.editing?.id;if(!id||!confirm('Eliminare questa scheda? Sarà rimossa anche dagli altri dispositivi alla prossima sincronizzazione.'))return;const old=state.records.find(r=>r.id===id);if(!old)return;await putRecord({...old,updated_at:new Date().toISOString(),deleted_at:new Date().toISOString()});$('#editor').close();await reload();autoSync();}
async function exportBackup(){const all=await allRecords();const data={format:'navra-backup-v1',exported_at:new Date().toISOString(),records:all,settings:state.settings};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='NAVRA-backup-'+new Date().toISOString().slice(0,10)+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function importBackup(file){try{const data=JSON.parse(await file.text());if(data.format!=='navra-backup-v1'||!Array.isArray(data.records))throw Error('File di backup NAVRA non valido');if(!confirm('Importare '+data.records.length+' schede? Le schede con ID uguale verranno aggiornate solo se più recenti.'))return;const existing=new Map((await allRecords()).map(r=>[r.id,r]));for(const r of data.records){if(!r.id||!SCHEMA[r.type]||typeof r.data!=='object'||!r.updated_at)continue;const old=existing.get(r.id);if(!old||r.updated_at>old.updated_at)await putRecord(r);}if(data.settings&&typeof data.settings==='object'){state.settings={...state.settings,...data.settings};await setSetting('preferences',state.settings);}await reload();alert('Backup importato.');autoSync();}catch(e){alert('Importazione non riuscita: '+e.message);}}
function validConfig(){return state.syncConfig?.url&&state.syncConfig?.key;}
function sbBase(){return state.syncConfig.url.replace(/\/+$/,'');}
async function sbRequest(path,method='GET',body=null,authenticated=true,extraHeaders={}){
if(!navigator.onLine)throw Error('Nessuna connessione Internet');const headers={'apikey':state.syncConfig.key,'Content-Type':'application/json',...extraHeaders};
if(authenticated&&state.auth?.access_token){if(state.auth.expires_at&&Date.now()>state.auth.expires_at-60000)await refreshToken();headers.Authorization='Bearer '+state.auth.access_token;}
// Auth signup/login need only the apikey header; publishable keys are not JWTs.
const res=await fetch(sbBase()+path,{method,headers,body:body===null?undefined:JSON.stringify(body)});const text=await res.text();let json=null;try{json=text?JSON.parse(text):null;}catch{json=text;}
if(!res.ok)throw Error(json?.msg||json?.message||json?.error_description||json?.error||'Errore di connessione ('+res.status+')');return json;
}
async function refreshToken(){const token=state.auth?.refresh_token;if(!token)throw Error('Sessione scaduta, accedi di nuovo');const a=await sbRequest('/auth/v1/token?grant_type=refresh_token','POST',{refresh_token:token},false);await saveAuth(a);}
async function saveAuth(a){if(!a?.access_token)return;state.auth={access_token:a.access_token,refresh_token:a.refresh_token,expires_at:Date.now()+(a.expires_in||3600)*1000};await setSetting('auth',state.auth);}
async function authenticate(action){const email=$('#auth-email')?.value.trim(),password=$('#auth-password')?.value;if(!email||!password){setStatus('Inserisci email e password.');return;}try{setStatus('Collegamento...');const auth=action==='signup'?await sbRequest('/auth/v1/signup','POST',{email,password},false):await sbRequest('/auth/v1/token?grant_type=password','POST',{email,password},false);if(!auth?.access_token){setStatus('Account creato. Controlla l’email per la conferma, poi accedi.');return;}await saveAuth(auth);await findWorkspace();render();}catch(e){setStatus(e.message);}}
async function findWorkspace(){const all=await sbRequest('/rest/v1/navra_workspaces?select=id,name,invite_code&limit=1');if(all?.length){state.workspace={workspace_id:all[0].id,name:all[0].name,invite_code:all[0].invite_code};await setSetting('workspace',state.workspace);}else{state.workspace=null;await setSetting('workspace',null);}}
async function workspace(action){try{if(state.records.length&&!confirm('Le '+state.records.length+' schede salvate su questo dispositivo saranno condivise con tutti i membri del gruppo. Continuare?'))return;setStatus('Collegamento...');let reply;
if(action==='workspace-create'){reply=await sbRequest('/rest/v1/rpc/navra_create_workspace','POST',{p_name:$('#workspace-name')?.value.trim()||'NAVRA'});}
else{const code=$('#invite-code')?.value.trim();if(!code)throw Error('Inserisci il codice invito');reply=await sbRequest('/rest/v1/rpc/navra_join_workspace','POST',{p_code:code});}
if(typeof reply==='string')reply={workspace_id:reply};state.workspace={workspace_id:reply.workspace_id,invite_code:reply.invite_code||'',name:reply.name||'NAVRA'};await setSetting('workspace',state.workspace);state.syncMessage='Gruppo collegato';render();await syncNow();}catch(e){setStatus(e.message);}}
let syncInProgress=false;
async function syncNow(){if(syncInProgress||!validConfig()||!state.auth?.access_token||!state.workspace?.workspace_id||!navigator.onLine)return;syncInProgress=true;state.syncMessage='Sincronizzazione...';setStatus(state.syncMessage);
try{
const ws=state.workspace.workspace_id;const remote=await sbRequest('/rest/v1/navra_records?select=id,workspace_id,type,data,updated_at,deleted_at&workspace_id=eq.'+encodeURIComponent(ws));const locals=await allRecords();const remoteById=new Map(remote.map(r=>[r.id,r]));const push=[];let pulled=0;
for(const local of locals){const server=remoteById.get(local.id);if(!server||Date.parse(local.updated_at)>Date.parse(server.updated_at)){push.push({id:local.id,workspace_id:ws,type:local.type,data:local.data,updated_at:local.updated_at,deleted_at:local.deleted_at||null});}}
for(const server of remote){const local=locals.find(r=>r.id===server.id);if(!local||Date.parse(server.updated_at)>Date.parse(local.updated_at)){await putRecord({id:server.id,type:server.type,data:server.data,updated_at:server.updated_at,deleted_at:server.deleted_at||null});pulled++;}}
if(push.length)await sbRequest('/rest/v1/navra_records?on_conflict=id','POST',push,true,{'Prefer':'resolution=merge-duplicates,return=minimal'});
state.syncMessage='Sincronizzato · '+new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})+' · '+push.length+' inviati, '+pulled+' ricevuti';await reload();setStatus(state.syncMessage);
}catch(e){state.syncMessage='Sync non riuscita: '+e.message;setStatus(state.syncMessage);}finally{syncInProgress=false;}}
function autoSync(){if(navigator.onLine&&state.auth?.access_token&&state.workspace?.workspace_id)syncNow();}
async function action(name){try{
if(name.startsWith('add-'))return editModal(name.slice(4));
if(name==='settings-save'){const share=Number($('#share').value);if(!Number.isFinite(share)||share<0||share>100){alert('Quota non valida (0–100)');return;}state.settings={owner:$('#owner').value.trim()||'Socio 1',partner:$('#partner').value.trim()||'Socio 2',share};await setSetting('preferences',state.settings);render();}
if(name==='export')return exportBackup();if(name==='delete-record')return deleteEdit();
if(name==='sync-config'){let url=$('#sb-url').value.trim(),key=$('#sb-key').value.trim();if(!/^https:\/\/[a-z0-9.-]+\.supabase\.co\/?$/i.test(url)||!key){alert('Inserisci un URL Supabase e la chiave pubblica validi.');return;}state.syncConfig={url,key};await setSetting('syncConfig',state.syncConfig);render();}
if(name==='sync-reset'){if(!confirm('Cambiare database? I dati salvati offline rimarranno su questo dispositivo.'))return;state.syncConfig=null;state.auth=null;state.workspace=null;await Promise.all([setSetting('syncConfig',null),setSetting('auth',null),setSetting('workspace',null)]);render();}
if(name==='signin'||name==='signup')return authenticate(name);
if(name==='workspace-create'||name==='workspace-join')return workspace(name);
if(name==='sync-now')return syncNow();
if(name==='signout'){if(!confirm('Uscire? Le schede offline rimangono su questo iPhone.'))return;state.auth=null;state.workspace=null;await setSetting('auth',null);await setSetting('workspace',null);render();}
if(name==='copy-code'){const code=state.workspace?.invite_code||'';if(!code){alert('Codice non disponibile');return;}await navigator.clipboard.writeText(code);setStatus('Codice copiato. Condividilo solo con il tuo socio.');}
}catch(e){alert('Operazione non riuscita: '+e.message);}}
async function boot(){try{await initDB();state.settings={...state.settings,...(await getSetting('preferences')||{})};state.syncConfig=await getSetting('syncConfig');state.auth=await getSetting('auth');state.workspace=await getSetting('workspace');
$('#nav').addEventListener('click',e=>{const btn=e.target.closest('[data-view]');if(!btn)return;state.view=btn.dataset.view;state.search='';render();});
$('#content').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b){action(b.dataset.action);return;}const edit=e.target.closest('[data-edit]');if(edit){const r=state.records.find(r=>r.id===edit.dataset.edit);if(r)editModal(r.type,r.id);return;}const view=e.target.closest('[data-view]');if(view){state.view=view.dataset.view;render();}});
$('#content').addEventListener('input',e=>{if(e.target.id==='search'){state.search=e.target.value;renderList();}});
$('#content').addEventListener('change',e=>{if(e.target.id==='import-file'&&e.target.files[0])importBackup(e.target.files[0]);});
$('#record-form').addEventListener('submit',saveEdit);$('#close-editor').addEventListener('click',()=>$('#editor').close());
window.addEventListener('online',()=>{updateNetwork();autoSync();});window.addEventListener('offline',updateNetwork);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)autoSync();});setInterval(()=>{if(!document.hidden)autoSync();},60000);
await reload();autoSync();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
}catch(e){$('#content').innerHTML='<div class="notice">Errore inizializzazione: '+esc(e.message)+'</div>';}}
boot();
