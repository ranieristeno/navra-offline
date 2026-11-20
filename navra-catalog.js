/* NAVRA catalog projection: never copy the private record wholesale. */
function navraCatalogProjection(record, workspaceId) {
  const d=record?.data, s=d?.webshop;
  if(record?.type!=='watch'||record.deleted_at||s?.published!==true||d.status!=='Disponibile')return null;
  const price=Number(s.price);
  const title=String(s.title||'').trim();
  const photo=typeof d.photoDataUrl==='string'&&/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(d.photoDataUrl)&&d.photoDataUrl.length<=145000?d.photoDataUrl:'';
  if(!title||!Number.isFinite(price)||price<=0||!photo)return null;
  return {workspaceId,recordId:record.id,title:title.slice(0,160),description:String(s.description||'').slice(0,3000),category:['Orologi','Borse','Occhiali','Cinturini','Accessori'].includes(s.category)?s.category:'Orologi',price,photo,sourceUpdatedAt:record.updated_at};
}
if(typeof module!=='undefined')module.exports=navraCatalogProjection;
if(typeof document!=='undefined')(() => {
 const previousRender=render, previousPut=putRecord;
 let saving=false;
 // Existing editors may rebuild data from their schema. Preserve publication settings.
 putRecord=async function(r){if(r.type==='watch'&&!Object.prototype.hasOwnProperty.call(r.data||{},'webshop')){const old=(await allRecords()).find(x=>x.id===r.id);if(old?.data?.webshop)r={...r,data:{...r.data,webshop:old.data.webshop}};}return previousPut(r);};
 const dialog=document.createElement('dialog');dialog.id='webshop-editor';document.body.append(dialog);
 render=function(){
   previousRender();
   const nav=document.getElementById('nav');
   if(nav&&!nav.querySelector('[data-view="webshop"]'))nav.insertAdjacentHTML('beforeend','<button data-view="webshop">Catalogo sito</button>');
   if(state.view!=='webshop')return;
   const rows=state.records.filter(r=>r.type==='watch');
   document.getElementById('content').innerHTML='<div class="head"><h1>Catalogo sito</h1><button class="btn" id="web-sync">Sincronizza catalogo</button></div><p class="notice">Pubblica solo gli articoli che vuoi mostrare sul sito. Le informazioni selezionate saranno leggibili dai visitatori dopo l’attivazione delle regole catalogo. Costi, fornitori e note interne non vengono copiati. Le vendite offline arrivano al sito alla successiva sincronizzazione.</p><p id="catalog-status" role="status"></p><div class="list">'+rows.map(r=>{const s=r.data.webshop||{},valid=navraCatalogProjection(r,state.firebaseWorkspace?.id);return '<article class="item"><div><h3>'+esc(recordTitle(r))+'</h3><div class="minor">'+esc(r.data.status||'Stato non definito')+' · '+(valid?'Selezionato per il sito':s.published?'Non pubblicabile: verifica stato, prezzo e foto':'Non pubblicato')+'</div></div><button class="btn alt" data-web-edit="'+esc(r.id)+'">Scheda sito</button></article>';}).join('')+'</div>';
   document.getElementById('web-sync').onclick=async()=>{if(!state.firebaseWorkspace?.id){alert('Accedi a Firebase e al gruppo dalla sezione Sincronizza.');return;}await syncNow();const el=document.getElementById('catalog-status');if(el)el.textContent=state.syncMessage||'Controlla lo stato nella sezione Sincronizza.';};
   document.querySelectorAll('[data-web-edit]').forEach(b=>b.onclick=()=>edit(b.dataset.webEdit));
 };
 function edit(id){const r=state.records.find(r=>r.id===id),s=r.data.webshop||{};
 dialog.innerHTML='<form id="web-form"><h2>Scheda sito</h2><label>Titolo pubblico<input name="title" required maxlength="160" value="'+esc(s.title||recordTitle(r))+'"></label><label>Categoria<select name="category">'+['Orologi','Borse','Occhiali','Cinturini','Accessori'].map(c=>'<option'+(s.category===c?' selected':'')+'>'+c+'</option>').join('')+'</select></label><label>Prezzo online (€)<input name="price" type="number" min="0.01" step="0.01" value="'+esc(s.price||'')+'"></label><label>Descrizione pubblica<textarea name="description" maxlength="3000">'+esc(s.description||'')+'</textarea></label><label class="flex"><input name="published" type="checkbox" style="width:auto" '+(s.published?'checked':'')+'>Pubblica sul sito</label><p class="hint">Viene usata la foto dell’articolo. Per pubblicare servono foto, prezzo e stato Disponibile. Le note interne non vengono usate.</p><p id="web-error" role="alert"></p><div class="actions"><button class="btn" type="submit">Salva</button><button class="btn alt" type="button" id="web-close">Chiudi</button></div></form>';
 document.getElementById('web-close').onclick=()=>dialog.close();
 document.getElementById('web-form').onsubmit=async e=>{e.preventDefault();if(saving)return;saving=true;try{const latest=(await allRecords()).find(x=>x.id===id);if(!latest||latest.deleted_at)throw Error('Articolo eliminato.');const f=new FormData(e.target);const webshop={title:String(f.get('title')).trim(),category:String(f.get('category')),price:Number(f.get('price')),description:String(f.get('description')),published:f.has('published')};const updated={...latest,data:{...latest.data,webshop},updated_at:new Date().toISOString()};if(webshop.published&&!navraCatalogProjection(updated,state.firebaseWorkspace?.id))throw Error('Per pubblicare: aggiungi una foto, un prezzo maggiore di zero e imposta Disponibile.');await putRecord(updated);dialog.close();await reload();autoSync();}catch(err){document.getElementById('web-error').textContent=err.message;}finally{saving=false;}};
 dialog.showModal();
 }
})();
