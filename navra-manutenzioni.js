/* NAVRA - Manutenzione per articolo, 2026-11-07.
 * Dopo navra-accorpa-impostazioni.js; usa i record 'cost' gia ammessi da Firestore.
 * Ogni intervento e' un solo movimento contabile: rimane legato all'articolo.
 * Nessuna migrazione, nessuna modifica automatica ai dati salvati.
 */
'use strict';
(() => {
  if (typeof state === 'undefined' || typeof render !== 'function' ||
      typeof editModal !== 'function' || typeof recordCard !== 'function' ||
      typeof putRecord !== 'function') return;

  const c = amount => Math.round((Number(amount) || 0) * 100);
  const e = cents => eur(cents / 100);
  const safe = value => esc(value ?? '');
  const people = ['Stefano', 'Oleg'];
  const today = () => {
    const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
  };
  const alive = type => state.records.filter(r => r.type === type && !r.deleted_at);
  const watch = id => alive('watch').find(r => r.id === id);
  const title = r => [r.data?.brand,r.data?.model].filter(Boolean).join(' ') || 'Articolo';
  const isMaintenance = r => r?.type === 'cost' && !r.deleted_at && r.data?.kind === 'expense' &&
    !!r.data?.watchId && (r.data.maintenance === true ||
      (r.data.category === 'Riparazione' && r.data.autoFromWatch !== true));
  const forWatch = id => alive('cost').filter(r => isMaintenance(r) && r.data.watchId === id)
    .sort((a,b) => (b.data?.date || '').localeCompare(a.data?.date || '') || b.updated_at.localeCompare(a.updated_at));
  const total = id => forWatch(id).reduce((sum,r) => sum + c(r.data.amount), 0);

  const css = document.createElement('style');
  css.textContent = `
    .nv-maint-btn {margin-left:4px!important}
    #nv-maint-dialog {width:calc(100% - 24px);max-width:590px;max-height:92vh;overflow:auto}
    #nv-maint-dialog .nv-maint-line {padding:11px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;justify-content:space-between;align-items:start}
    #nv-maint-dialog .nv-maint-line strong{display:block}
    #nv-maint-dialog .nv-maint-line small{display:block;color:var(--muted);margin-top:4px;overflow-wrap:anywhere}
    #nv-maint-dialog .nv-maint-line .nv-maint-actions {display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;margin-top:5px}
    #nv-maint-dialog .nv-maint-summary{background:#edf2f0;border-radius:10px;padding:12px;margin-bottom:12px}
    #nv-maint-dialog .nv-maint-fields{display:grid;grid-template-columns:1fr 1fr;gap:11px}
    #nv-maint-dialog .nv-maint-fields .wide{grid-column:1/-1}
    @media(max-width:370px){#nv-maint-dialog .nv-maint-fields{grid-template-columns:1fr}}
  `;
  document.head.appendChild(css);

  const dialog = document.createElement('dialog');
  dialog.id = 'nv-maint-dialog';
  dialog.innerHTML = `<div class="head"><h2 style="margin:0">Manutenzione articolo</h2>
    <button type="button" class="btn alt small" id="nv-maint-close">Chiudi</button></div>
    <p class="hint" id="nv-maint-article"></p>
    <div id="nv-maint-summary" class="nv-maint-summary"></div>
    <div id="nv-maint-list"></div>
    <form id="nv-maint-form">
      <h3 id="nv-maint-mode" style="font-size:16px;margin:16px 0 10px">+ Nuovo intervento</h3>
      <div class="nv-maint-fields">
        <div class="field wide"><label for="nv-maint-description">Tipo di manutenzione *</label>
          <input id="nv-maint-description" required maxlength="120" placeholder="Es. sostituzione batteria, pulizia, riparazione"></div>
        <div class="field"><label for="nv-maint-cost">Costo (€) *</label>
          <input id="nv-maint-cost" type="number" min="0.01" step="0.01" inputmode="decimal" required></div>
        <div class="field"><label for="nv-maint-date">Data *</label>
          <input id="nv-maint-date" type="date" required></div>
        <div class="field"><label for="nv-maint-payer">Pagato da *</label>
          <select id="nv-maint-payer" required><option value="Stefano">Stefano</option><option value="Oleg">Oleg</option></select></div>
        <div class="field"><label for="nv-maint-share">Quota Stefano (%) *</label>
          <input id="nv-maint-share" type="number" min="0" max="100" step="1" required></div>
        <div class="field wide"><label for="nv-maint-notes">Note</label>
          <textarea id="nv-maint-notes" rows="2" maxlength="500"></textarea></div>
      </div>
      <p class="hint">Il costo riduce l’utile della vendita dell’articolo. Il pagamento entra nei conti tra soci una sola volta.</p>
      <div class="actions"><button type="submit" class="btn">Salva manutenzione</button>
        <button type="button" id="nv-maint-cancel-edit" class="btn alt">Annulla modifica</button></div>
    </form>`;
  document.body.appendChild(dialog);
  const el = id => document.getElementById('nv-maint-'+id);
  let currentWatch = '', editing = '', saving = false;

  function resetForm() {
    editing = '';
    el('form').reset();
    el('mode').textContent = '+ Nuovo intervento';
    el('date').value=today();
    el('share').value=watch(currentWatch)?.data?.buyShareStefano ?? 50;
    if(!Number.isFinite(Number(el('share').value)) || el('share').value==='')el('share').value='50';
    el('payer').value='Stefano';
  }
  function list() {
    const r = watch(currentWatch);
    if(!r){dialog.close();return;}
    const entries = forWatch(r.id);
    el('article').textContent=title(r)+(r.data?.lotIndex?(' · N. '+r.data.lotIndex):'');
    el('summary').innerHTML='<strong>Totale manutenzione: '+safe(e(total(r.id)))+'</strong>'+
      '<div class="hint" style="margin:3px 0 0">'+entries.length+' intervent'+(entries.length===1?'o':'i')+' registrat'+(entries.length===1?'o':'i')+'</div>';
    el('list').innerHTML=entries.length ? entries.map(x=>{
      const d=x.data;
      const description=d.description||d.title?.replace(/^Manutenzione: /,'')||'Manutenzione';
      return '<div class="nv-maint-line"><div><strong>'+safe(description)+'</strong><small>'+safe(d.date||'')+
        ' · Pagato da '+safe(d.paidBy||'—')+' · Stefano '+safe(d.shareStefano??'—')+'%</small>'+
        (d.notes?'<small>'+safe(d.notes)+'</small>':'')+'</div><div style="text-align:right"><strong>'+safe(e(c(d.amount)))+'</strong>'+
        '<div class="nv-maint-actions"><button type="button" class="btn alt small" data-nv-maint-edit="'+safe(x.id)+'">Modifica</button>'+ 
        '<button type="button" class="btn warn small" data-nv-maint-delete="'+safe(x.id)+'">Elimina</button></div></div></div>';
    }).join('') : '<p class="hint">Nessuna manutenzione registrata per questo articolo.</p>';
  }
  function open(id) {
    const r=watch(id);
    if(!r)return alert('Articolo non trovato.');
    const mainEditor=document.getElementById('editor');
    if(mainEditor?.open){
      if(!confirm('Aprire la manutenzione? Eventuali modifiche non salvate alla scheda articolo saranno perse.'))return;
      mainEditor.close();
    }
    currentWatch=id;
    resetForm();list();dialog.showModal();
  }
  el('close').addEventListener('click',()=>dialog.close());
  el('cancel-edit').addEventListener('click',resetForm);
  el('list').addEventListener('click',async event=>{
    const edit=event.target.closest('[data-nv-maint-edit]');
    const del=event.target.closest('[data-nv-maint-delete]');
    if(!edit&&!del)return;
    const id=(edit||del).dataset.nvMaintEdit||(edit||del).dataset.nvMaintDelete;
    const r=forWatch(currentWatch).find(x=>x.id===id);
    if(!r)return;
    if(edit){
      editing=r.id;
      const d=r.data;
      el('mode').textContent='Modifica intervento';
      el('description').value=d.description||String(d.title||'').replace(/^Manutenzione: /,'');
      el('cost').value=(c(d.amount)/100).toFixed(2);
      el('date').value=d.date||today();
      el('payer').value=people.includes(d.paidBy)?d.paidBy:'Stefano';
      el('share').value=d.shareStefano??50;
      el('notes').value=d.notes||'';
      el('form').scrollIntoView({behavior:'smooth',block:'nearest'});
      return;
    }
    if(del){
      if(!confirm('Eliminare questa manutenzione? Verrà rimossa dai conti tra soci e dai margini, anche sul telefono di Oleg dopo la sincronizzazione.'))return;
      try{
        const now=new Date().toISOString();
        await putRecord({...r,updated_at:now,deleted_at:now});
        await reload(); if(typeof autoSync==='function')autoSync();
        if(editing===r.id)resetForm();list();
      }catch(err){alert('Impossibile eliminare: '+err.message);}
    }
  });
  el('form').addEventListener('submit',async event=>{
    event.preventDefault();if(saving)return;
    const w=watch(currentWatch);if(!w)return alert('Articolo non trovato.');
    const description=el('description').value.trim();
    const raw=el('cost').value.trim();
    const amount=Number(raw);
    const share=Number(el('share').value),payer=el('payer').value,date=el('date').value;
    if(!description)return alert('Inserisci la manutenzione effettuata.');
    if(!/^\d+(\.\d{1,2})?$/.test(raw) || !Number.isFinite(amount) || c(amount)<1 || c(amount)>10000000000)
      return alert('Inserisci un costo positivo, con massimo due decimali.');
    if(!Number.isInteger(share) || share<0 || share>100 || !people.includes(payer))
      return alert('Controlla il socio e la quota da 0 a 100%.');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return alert('Inserisci una data valida.');
    const old=editing ? forWatch(w.id).find(r=>r.id===editing) : null;
    saving=true;
    try{
      const now=new Date().toISOString();
      const data={...(old?.data||{}),kind:'expense',category:'Riparazione',
        maintenance:true,autoFromWatch:true,watchId:w.id,
        title:'Manutenzione: '+description,description,amount:c(amount)/100,date,paidBy:payer,
        shareStefano:share,notes:el('notes').value.trim()};
      await putRecord({id:old?.id||crypto.randomUUID(),type:'cost',data,
        created_at:old?.created_at||now,updated_at:now,deleted_at:null});
      await reload();if(typeof autoSync==='function')autoSync();
      resetForm();list();
    }catch(err){alert('Non riesco a salvare la manutenzione: '+err.message);}
    finally{saving=false;}
  });

  // Bottoni disponibili nello stock, negli ultimi articoli e nelle schede dei lotti.
  const oldCard=recordCard;
  recordCard=function(r){
    const html=oldCard(r);
    if(r.type!=='watch')return html;
    const entries=forWatch(r.id).length;
    return html.replace('</article>',
      '<button type="button" class="btn alt small nv-maint-btn" data-nv-maint-open="'+safe(r.id)+'">Manutenzione'+
      (entries?' · '+safe(e(total(r.id))):'')+'</button></article>');
  };
  const oldEditModal=editModal;
  editModal=function(type,id){
    oldEditModal(type,id);
    if(type!=='watch'||!id)return;
    const formFields=document.getElementById('form-fields');
    if(formFields)formFields.insertAdjacentHTML('beforeend',
      '<div class="field wide"><div class="nv-maint-summary"><strong>Manutenzione articolo</strong>'+ 
      '<p class="hint">'+safe(forWatch(id).length)+' interventi · Totale '+safe(e(total(id)))+'</p>'+ 
      '<button type="button" class="btn alt small" data-nv-maint-open="'+safe(id)+'">Gestisci manutenzioni</button></div></div>');
  };
  const oldRender=render;
  render=function(){
    oldRender();
    if(state.view==='sales') {
      document.querySelectorAll('#content [data-nv-sale-edit]').forEach(b=>{
        const id=b.dataset.nvSaleEdit;
        if(!id || b.parentElement.querySelector('[data-nv-maint-open]'))return;
        b.insertAdjacentHTML('afterend',' <button type="button" class="btn alt small" data-nv-maint-open="'+safe(id)+'">Manutenzione'+
          (total(id)?' · '+safe(e(total(id))):'')+'</button>');
      });
    }
    if(state.view==='lots' && state.navraLotId){
      document.querySelectorAll('#content [data-lot-action="watch"]').forEach(b=>{
        const id=b.dataset.watchId;
        if(!id || b.parentElement.querySelector('[data-nv-maint-open]'))return;
        b.insertAdjacentHTML('afterend',' <button type="button" class="btn alt small" data-nv-maint-open="'+safe(id)+'">Manutenzione</button>');
      });
    }
    if(state.view==='costs'){
      document.querySelectorAll('#content [data-cost-delete]').forEach(b=>{
        const rec=alive('cost').find(x=>x.id===b.dataset.costDelete);
        if(!rec || !isMaintenance(rec))return;
        const line=b.closest('.navra-costs-line');
        if(!line || line.querySelector('[data-nv-maint-open]'))return;
        const hint=line.querySelector('p:last-of-type');
        if(hint && rec.data.autoFromWatch)hint.textContent='Manutenzione collegata. Per modificare o eliminare, apri la manutenzione dell’articolo.';
        b.remove(); // Impedisce eliminazioni scollegate da questa pagina.
        line.querySelector('[data-cost-edit]')?.remove();
        line.querySelector('div[style*="text-align:right"]')?.insertAdjacentHTML('beforeend',
          '<button type="button" class="btn alt small" data-nv-maint-open="'+safe(rec.data.watchId)+'">Apri articolo</button>');
      });
    }
  };
  document.addEventListener('click',event=>{
    const b=event.target.closest?.('[data-nv-maint-open]');
    if(!b)return;
    event.preventDefault();event.stopImmediatePropagation();
    open(b.dataset.nvMaintOpen);
  },true);
  window.NavraManutenzione=Object.freeze({totalCents:total,forWatch});
})();
