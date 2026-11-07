/* NAVRA - Elimina lotti con due scelte esplicite.
 * Non cambia lo schema del database e funziona offline con IndexedDB/Firebase.
 * Caricare DOPO navra-manutenzioni.js.
 */
'use strict';
(() => {
  if (typeof state === 'undefined' || typeof render !== 'function' ||
      typeof reload !== 'function' || typeof db === 'undefined') return;

  const alive = type => state.records.filter(r => r.type === type && !r.deleted_at);
  const safe = value => esc(value ?? '');
  const names = r => [r?.data?.brand,r?.data?.model].filter(Boolean).join(' ') || 'Articolo';
  const lotById = id => alive('lot').find(r => r.id === id);
  let currentLotId = null;
  let busy = false;

  const css = document.createElement('style');
  css.textContent = `
    #nv-delete-lot-dialog {width:calc(100% - 24px);max-width:540px;max-height:90vh;overflow:auto}
    #nv-delete-lot-dialog .nv-delete-choices {display:grid;gap:12px;margin:15px 0}
    #nv-delete-lot-dialog .nv-delete-choice {padding:14px;border:1px solid var(--line);border-radius:11px}
    #nv-delete-lot-dialog .nv-delete-choice strong{display:block;margin-bottom:6px}
    #nv-delete-lot-dialog .nv-delete-choice small{display:block;color:var(--muted);font-size:12px;margin-bottom:10px}
    .nv-delete-lot-button {margin-left:6px}
  `;
  document.head.appendChild(css);

  const dialog=document.createElement('dialog');
  dialog.id='nv-delete-lot-dialog';
  dialog.innerHTML = '<h2 style="margin:0 0 12px">Elimina lotto</h2>'+
    '<p id="nv-delete-lot-description"></p>'+
    '<div class="nv-delete-choices">'+
    '<div class="nv-delete-choice"><strong>Elimina solo il lotto</strong>'+
    '<small>Tutti gli articoli restano in NAVRA come schede individuali. Vendite, acquisti, manutenzioni, rimborsi e cassa rimangono invariati.</small>'+
    '<button type="button" class="btn alt" data-nv-delete-mode="only">Elimina solo lotto</button></div>'+
    '<div class="nv-delete-choice"><strong>Elimina lotto e articoli</strong>'+
    '<small>Rimuove anche le schede associate, le vendite, le manutenzioni e i movimenti collegati. Cambieranno stock, utili, saldi e cassa. Operazione irreversibile senza backup.</small>'+
    '<button type="button" class="btn warn" data-nv-delete-mode="all">Elimina lotto e articoli</button></div></div>'+
    '<div class="actions"><button type="button" class="btn alt" id="nv-delete-lot-cancel">Annulla</button></div>';
  document.body.appendChild(dialog);
  const description=dialog.querySelector('#nv-delete-lot-description');
  const cancel=dialog.querySelector('#nv-delete-lot-cancel');
  cancel.addEventListener('click',()=>{if(!busy)dialog.close();});
  dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});

  function linked(lotId) {
    const watches=alive('watch').filter(r=>r.data?.lotId===lotId);
    const ids=new Set(watches.map(r=>r.id));
    // Le scritture automatiche acquisto e vendita usano cost con watchId.
    // Le manutenzioni e le spese manuali collegate usano lo stesso watchId.
    const costs=alive('cost').filter(r=>r.data?.lotId===lotId || ids.has(r.data?.watchId));
    const shipments=alive('shipment').filter(r=>r.data?.lotId===lotId || ids.has(r.data?.watchId));
    const sold=watches.filter(r=>r.data?.status==='Venduto');
    return {watches,costs,shipments,sold};
  }

  function openDelete(id) {
    if (busy) return;
    const lot=lotById(id);
    if (!lot) return alert('Lotto non trovato. Aggiorna NAVRA e riprova.');
    const rel=linked(id);
    currentLotId=id;
    description.textContent='Lotto: '+(lot.data?.name||'Senza nome')+'. '+
      rel.watches.length+' articoli collegati, '+rel.sold.length+' già venduti, '+
      rel.costs.length+' movimenti finanziari e '+rel.shipments.length+' spedizioni collegate.';
    dialog.showModal();
  }

  // Una sola transazione per tutte le schede: in caso di errore il database
  // locale non resta in uno stato parzialmente cancellato o parzialmente scollegato.
  function storeAtomically(records) {
    return new Promise((resolve,reject)=>{
      let tx;
      try{
        tx=db.transaction('records','readwrite');
        const store=tx.objectStore('records');
        for(const record of records)store.put(record);
        tx.oncomplete=()=>resolve();
        tx.onerror=()=>reject(tx.error||new Error('Errore IndexedDB'));
        tx.onabort=()=>reject(tx.error||new Error('Operazione annullata'));
      }catch(err){if(tx)try{tx.abort();}catch{}reject(err);}
    });
  }

  async function remove(mode) {
    if(busy || !currentLotId)return;
    const lot=lotById(currentLotId);
    if(!lot){dialog.close();return alert('Il lotto non esiste più.');}
    const rel=linked(lot.id);
    const stamp=new Date().toISOString();
    const changed=[];
    if(mode==='only'){
      const yes=confirm('Eliminare SOLO il lotto "'+(lot.data?.name||'')+'"?\n\n'+
        'I '+rel.watches.length+' articoli rimarranno singolarmente, con tutti i costi, le vendite e i rimborsi.');
      if(!yes)return;
      changed.push({...lot,updated_at:stamp,deleted_at:stamp});
      for(const r of rel.watches)changed.push({...r,updated_at:stamp,data:{...r.data,lotId:'',lotIndex:''}});
      // Scollega gli altri riferimenti al lotto senza cancellare la contabilità.
      for(const r of rel.costs.filter(x=>x.data?.lotId===lot.id))
        changed.push({...r,updated_at:stamp,data:{...r.data,lotId:''}});
      for(const r of rel.shipments.filter(x=>x.data?.lotId===lot.id))
        changed.push({...r,updated_at:stamp,data:{...r.data,lotId:''}});
    } else if(mode==='all'){
      const count=1+rel.watches.length+rel.costs.length+rel.shipments.length;
      const typed=prompt('ELIMINAZIONE COMPLETA: verranno cancellati '+count+' record, '+
        'incluse '+rel.sold.length+' vendite, '+rel.costs.length+' movimenti contabili e '+
        rel.shipments.length+' spedizioni.\n\n'+
        'I saldi tra soci, la cassa e gli utili saranno ricalcolati.\n'+
        'Scrivi ELIMINA per confermare:');
      if(typed!=='ELIMINA')return;
      for(const r of [lot,...rel.watches,...rel.costs,...rel.shipments])
        changed.push({...r,updated_at:stamp,deleted_at:stamp});
    } else return;

    busy=true;
    dialog.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{
      await storeAtomically(changed);
      currentLotId=null;
      state.navraLotId=null;
      dialog.close();
      await reload();
      if(typeof autoSync==='function')autoSync();
      alert(mode==='only'?'Lotto eliminato. Tutti gli articoli e i movimenti sono stati conservati.':
        'Lotto e dati collegati eliminati localmente. La cancellazione verrà sincronizzata con l’altro socio.');
    }catch(err){alert('Eliminazione non riuscita: '+err.message+'\nNessuna cancellazione parziale è stata applicata.');}
    finally{busy=false;dialog.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }

  dialog.addEventListener('click',event=>{
    const button=event.target.closest('[data-nv-delete-mode]');
    if(button)void remove(button.dataset.nvDeleteMode);
  });

  // Aggiunge il pulsante alla lista di lotti e alla scheda di ogni singolo lotto.
  const previousRender=render;
  render=function(){
    previousRender();
    if(state.view!=='lots')return;
    const content=document.getElementById('content');
    if(!content)return;
    for(const btn of content.querySelectorAll('[data-lot-action="detail"][data-lot-id]')){
      if([...btn.parentElement.querySelectorAll('[data-nv-delete-lot]')].some(x=>x.dataset.nvDeleteLot===btn.dataset.lotId))continue;
      const del=document.createElement('button');
      del.type='button';del.className='btn warn small nv-delete-lot-button';
      del.dataset.nvDeleteLot=btn.dataset.lotId;
      del.textContent='Elimina';
      btn.insertAdjacentElement('afterend',del);
    }
    if(state.navraLotId){
      const host=content.querySelector('.navra-lot-controls');
      if(host && !host.querySelector('[data-nv-delete-lot]')){
        const del=document.createElement('button');
        del.type='button';del.className='btn warn small';
        del.dataset.nvDeleteLot=state.navraLotId;
        del.textContent='Elimina lotto';
        host.appendChild(del);
      }
    }
  };

  document.getElementById('content')?.addEventListener('click',event=>{
    const button=event.target.closest('[data-nv-delete-lot]');
    if(!button)return;
    event.preventDefault();event.stopImmediatePropagation();
    openDelete(button.dataset.nvDeleteLot);
  },true);
})();
