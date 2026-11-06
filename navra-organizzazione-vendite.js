/* NAVRA - Riorganizzazione e Vendite, 2026-11-06.
 * Caricare DOPO navra-report-articoli.js.
 * Riutilizza gli stessi record IndexedDB e Firebase, senza migrazione.
 */
'use strict';
(() => {
  if (typeof state === 'undefined' || typeof SCHEMA === 'undefined' ||
      typeof render !== 'function' || typeof putRecord !== 'function') return;

  const safe = value => esc(value ?? '');
  const money = x => Math.round((Number(x) || 0) * 100) / 100;
  const validMoney = x => Number.isFinite(Number(x)) && Number(x) >= 0 && Number(x) < 100000000;
  const active = type => state.records.filter(r => r.type === type && !r.deleted_at);
  const watches = () => active('watch');
  const available = () => watches().filter(r => r.data?.status !== 'Venduto');
  const sales = () => watches().filter(r => r.data?.status === 'Venduto')
    .sort((a,b)=>(b.data?.saleDate||'').localeCompare(a.data?.saleDate||''));
  const title = r => [r?.data?.brand,r?.data?.model].filter(Boolean).join(' ') || 'Articolo senza nome';
  const category = r => r?.data?.category || 'Orologi';
  const dateLocal = () => { const d=new Date(); return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
  const costs = r => money(r.data?.purchase)+money(r.data?.purchaseShipping);
  const margin = r => money(money(r.data?.salePrice)-costs(r)-money(r.data?.fees));
  const share = r => { const v=r.data?.saleShareStefano; return v === '' || v == null ? Number(state.settings?.share ?? 50) : Number(v); };
  const saleMarket = r => r.data?.saleMarket || active('market').find(m=>m.id === r.data?.saleMarketId)?.data?.name || '';
  const PEOPLE = ['Stefano','Oleg'];

  // Protect sale metadata during subsequent edits in the existing article/photo editor.
  for(const key of ['soldBy','saleClient','salePlatform','saleMarket','saleMarketId','saleShareStefano']) {
    if (!SCHEMA.watch.fields.some(f=>f[0]===key)) SCHEMA.watch.fields.push([key,key,'hidden']);
  }
  for(const key of ['watchId','lotId']) {
    if(!SCHEMA.shipment.fields.some(f=>f[0]===key)) SCHEMA.shipment.fields.push([key,key,'hidden']);
  }
  const oldFiltered = filteredRecords;
  filteredRecords = function(type) {
    const found=oldFiltered(type);
    return type==='watch' ? found.filter(r=>r.data?.status!=='Venduto') : found;
  };

  // The original modules add buttons at startup; replace only the menu, not their features.
  const nav=document.getElementById('nav');
  nav.innerHTML = '<button type="button" data-view="home" class="active">Riepilogo</button>'+
    '<button type="button" data-view="acquisti">Acquisti</button>'+
    '<button type="button" data-view="sales">Vendite</button>'+
    '<button type="button" data-view="beni-spese">Beni e spese</button>'+
    '<button type="button" data-view="sync">Sincronizza</button>'+
    '<button type="button" data-view="settings">Impostazioni</button>';
  const style=document.createElement('style');
  style.textContent=`
    .nv-tabs{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 16px}
    .nv-tabs button{border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);padding:9px 12px;font-size:13px;font-weight:600}
    .nv-tabs button.active{background:var(--dark);color:#fff}
    .nv-boxes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px}
    .nv-boxes button{border:1px solid var(--line);border-radius:12px;background:#fff;padding:20px 12px;text-align:left;color:var(--ink)}
    .nv-boxes strong{display:block;margin-bottom:6px}.nv-boxes small{color:var(--muted)}
    .nv-line{padding:12px 0;border-bottom:1px solid var(--line)}.nv-line:last-child{border:0}
    .nv-line strong,.nv-line small{display:block}.nv-line small{color:var(--muted);margin-top:3px}
    #nv-sale-dialog .field{margin-bottom:8px}
    #nv-sale-market-row[hidden]{display:none}
    .nv-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}
    @media(max-width:380px){.nv-boxes{grid-template-columns:1fr}}
  `;document.head.appendChild(style);

  const groupOf = view => ['acquisti','lots','watch','supplier','shipment'].includes(view)?'acquisti':
    ['beni-spese','assets','costs','cash'].includes(view)?'beni-spese':view;
  const subnav = group => {
    const items=group==='acquisti' ? [['lots','Lotti'],['watch','Articoli / Stock'],['supplier','Fornitori']] :
      [['assets','Beni da ammortizzare'],['costs','Spese e rimborsi'],['cash','Cassa soci']];
    return '<div class="nv-tabs">'+items.map(([v,l])=>'<button type="button" data-view="'+v+'" class="'+(state.view===v?'active':'')+'">'+l+'</button>').join('')+'</div>';
  };
  const groupHome = group => {
    const purch=group==='acquisti';
    const items=purch ? [
      ['lots','Lotti','Acquisti multipli e spese di spedizione'],
      ['watch','Articoli','Magazzino disponibile, categorie e foto'],
      ['supplier','Fornitori','Contatti e provenienza']
    ] : [
      ['assets','Beni da ammortizzare','Teche, attrezzature e strumenti'],
      ['costs','Spese e rimborsi','Mercatini, trasporti e conti condivisi'],
      ['cash','Cassa soci','Denaro custodito da Stefano e Oleg']
    ];
    const orphans=purch?active('shipment').filter(r=>!r.data?.watchId&&!r.data?.lotId).length:0;
    return '<div class="head"><h1>'+ (purch?'Acquisti':'Beni e spese') +'</h1></div>'+
      '<div class="nv-boxes">'+items.map(([v,l,h])=>'<button type="button" data-view="'+v+'"><strong>'+l+'</strong><small>'+h+'</small></button>').join('')+'</div>'+
      (orphans?'<section class="panel" style="margin-top:15px"><strong>'+orphans+' spedizioni precedenti non collegate</strong><p class="hint">Puoi collegarle a un articolo o a un lotto.</p><button class="btn alt small" type="button" data-view="shipment">Vedi spedizioni precedenti</button></section>':'');
  };

  const sheetRecord = r => {
    const d=r.data||{}, net=margin(r), pct=share(r);
    return '<div class="nv-line"><strong>'+safe(title(r))+'</strong><small>'+safe(d.saleDate||'Data non indicata')+
      ' · '+safe(d.salePlatform||'Canale non indicato')+' · '+safe(d.soldBy||'Venditore non indicato')+
      (d.saleClient?' · '+safe(d.saleClient):'')+'</small><small>Incasso: '+safe(eur(d.salePrice))+' · Utile: '+safe(eur(net))+
      ' · Stefano '+safe(eur(net*pct/100))+' / Oleg '+safe(eur(net*(100-pct)/100))+'</small>'+
      '<div class="nv-actions"><button type="button" class="btn alt small" data-nv-sale-edit="'+safe(r.id)+'">Modifica vendita</button></div></div>';
  };
  function salesPage(){
    const sold=sales(), revenue=money(sold.reduce((a,r)=>a+money(r.data.salePrice),0)),
      profit=money(sold.reduce((a,r)=>a+margin(r),0));
    const view=state.navraSalesTab||'sales';
    return '<div class="head"><h1>Vendite</h1><button type="button" class="btn gold" data-nv-sale-new>+ Vendita</button></div>'+
      '<div class="metrics">'+metric('Articoli venduti',sold.length)+metric('Incassi',eur(revenue))+
      metric('Utile vendite',eur(profit))+metric('Stock disponibile',available().length)+'</div>'+
      '<p class="hint">Vendere un articolo lo rimuove dallo stock, ma conserva scheda, foto, lotto e storico. L’utile è distinto dall’incasso e dai saldi tra soci.</p>'+
      '<div class="nv-tabs"><button type="button" data-nv-sales-tab="sales" class="'+(view==='sales'?'active':'')+'">Vendite registrate</button>'+
      '<button type="button" data-nv-sales-tab="markets" class="'+(view==='markets'?'active':'')+'">Mercatini</button></div>'+
      (view==='sales' ? '<section class="panel">'+(sold.length?sold.map(sheetRecord).join(''):'<div class="empty">Non hai ancora registrato vendite.</div>')+'</section>' : marketPage());
  }
  function marketPage(){
    const entries=active('market').sort((a,b)=>(b.data?.date||'').localeCompare(a.data?.date||''));
    return '<section class="panel"><div class="head"><h2>Mercatini</h2><button class="btn alt small" type="button" data-nv-market-new>+ Mercatino</button></div>'+
    '<p class="hint">Registra nome, città, data e costo banco. Le vendite vengono collegate al mercatino dalla scheda Vendite. Non sommare due volte gli incassi.</p>'+
    (entries.length?entries.map(m=>'<div class="nv-line"><strong>'+safe(m.data?.name)+' · '+safe(m.data?.date||'')+'</strong><small>'+safe(m.data?.city||'')+' · Banco: '+safe(eur(m.data?.fee))+'</small><button type="button" class="btn alt small" data-nv-market-edit="'+safe(m.id)+'">Modifica</button></div>').join(''):'<div class="empty">Nessun mercatino registrato.</div>')+'</section>';
  }
  const oldDashboard=dashboard;
  dashboard=function() {
    let base=oldDashboard();
    const sold=sales();
    const ste=sold.reduce((a,r)=>a+margin(r)*share(r)/100,0);
    const ole=sold.reduce((a,r)=>a+margin(r)*(100-share(r))/100,0);
    const correct='<div class="panel" style="margin-top:14px"><strong>Utili ripartiti per vendita</strong>'+
      '<div class="table-row"><span>Stefano</span><strong>'+safe(eur(ste))+'</strong></div>'+
      '<div class="table-row"><span>Oleg</span><strong>'+safe(eur(ole))+'</strong></div>'+
      '<p class="hint">Ogni vendita usa la propria percentuale. Sono esclusi gli altri costi generali e di mercatino non attribuiti alla vendita.</p></div>';
    base=base.replace(/<div class="panel" style="margin-top:14px"><strong>Ripartizione utili realizzati<\/strong>[\s\S]*?<\/div>(?=<div class="head"><h2>)/,correct);
    const ledger=active('cost').filter(r=>['expense','settlement'].includes(r.data?.kind));
    const bal=window.NavraCosts?.calculate ? window.NavraCosts.calculate(ledger).balance : 0;
    const debt=bal>0?'Stefano deve '+eur(bal/100)+' a Oleg':bal<0?'Oleg deve '+eur(-bal/100)+' a Stefano':'Nessun saldo tra soci';
    return base+'<section class="panel" style="margin-top:15px"><h2>Conti tra Stefano e Oleg</h2><strong>'+safe(debt)+'</strong>'+
      '<p class="hint">Saldo anticipi e rimborsi condivisi. Non rappresenta gli utili né il denaro in cassa.</p>'+
      '<div class="nv-actions"><button type="button" class="btn alt small" data-view="costs">Apri spese e rimborsi</button>'+
      '<button type="button" class="btn alt small" data-view="sales">Apri vendite</button></div></section>';
  };

  const previousRender=render;
  render=function(){
    previousRender();
    const content=document.getElementById('content');
    if(!content)return;
    if(state.view==='acquisti'||state.view==='beni-spese') content.innerHTML=groupHome(state.view);
    if(state.view==='sales')content.innerHTML=salesPage();
    if(state.view==='watch'){
      content.querySelector('.head h1')?.replaceChildren(document.createTextNode('Articoli in stock'));
      const head=content.querySelector('.head');
      if(head) head.insertAdjacentHTML('afterend','<p class="hint">Sono mostrati soltanto gli articoli non venduti. Per consultare lo storico apri Vendite.</p>');
    }
    if(state.view==='costs'){
      content.innerHTML=content.innerHTML.replace('<h1>Costi condivisi</h1>','<h1>Spese e rimborsi</h1>')
        .replaceAll('nella sezione Costi','in Spese e rimborsi');
    }
    if(['lots','watch','supplier','shipment','assets','costs','cash'].includes(state.view)) {
      content.insertAdjacentHTML('afterbegin',subnav(groupOf(state.view)));
      if(state.view==='shipment')content.insertAdjacentHTML('afterbegin','<p class="hint">Spedizioni precedenti: collegale a un articolo o lotto dalla scheda spedizione.</p>');
    }
    if(state.view==='lots'&&state.navraLotId){
      const lot=active('lot').find(r=>r.id===state.navraLotId);
      if(lot)content.insertAdjacentHTML('beforeend',shipmentsPanel('lotId',lot.id));
    }
    if(state.view==='settings')content.querySelectorAll('[data-navra-excel]').forEach(b=>{
      b.removeAttribute('data-navra-excel');b.setAttribute('data-navra-export-sales','');
      b.textContent='Scarica Excel aggiornato';
    });
    if(state.view==='sync')content.insertAdjacentHTML('beforeend',
      '<section class="panel"><h2>Esporta e salva</h2><p class="hint">Il report Excel contiene Articoli, Lotti, Vendite, Mercatini, Finanza, Spese, Cassa, Beni e foto.</p>'+
      '<button type="button" class="btn gold" data-navra-export-sales>Scarica Excel completo</button> '+
      '<button type="button" class="btn alt" data-action="export">Backup JSON con foto</button>'+
      '<p id="nv-export-status" class="status"></p></section>');
    const group=groupOf(state.view);
    nav.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===group));
  };

  const dialog=document.createElement('dialog'); dialog.id='nv-sale-dialog';
  dialog.innerHTML=`<form id="nv-sale-form">
    <h2>Registra vendita</h2>
    <div class="field"><label>Articolo *</label><select id="nv-sale-item" required></select></div>
    <div class="fields">
      <div class="field"><label>Data *</label><input id="nv-sale-date" type="date" required></div>
      <div class="field"><label>Prezzo di vendita (€) *</label><input id="nv-sale-price" type="number" step="0.01" min="0.01" required></div>
      <div class="field"><label>Vendita effettuata da *</label><select id="nv-sale-seller"><option value="">Scegli</option><option>Stefano</option><option>Oleg</option></select></div>
      <div class="field"><label>Incasso ricevuto da *</label><select id="nv-sale-receiver"><option value="">Scegli</option><option>Stefano</option><option>Oleg</option></select></div>
      <div class="field wide"><label>Cliente (facoltativo)</label><input id="nv-sale-client" maxlength="150"></div>
      <div class="field"><label>Piattaforma / canale *</label><select id="nv-sale-channel"><option value="">Scegli</option><option>Vinted</option><option>eBay</option><option>Instagram</option><option>Mercatino</option><option>Vendita diretta</option><option>Altro</option></select></div>
      <div class="field"><label>Commissioni e spedizione di vendita (€)</label><input id="nv-sale-fees" type="number" min="0" step="0.01" value="0"></div>
      <div class="field wide" id="nv-sale-market-row"><label>Mercatino / evento</label><select id="nv-sale-market"></select></div>
      <div class="field"><label>Quota utile a Stefano (%)</label><input id="nv-sale-share" type="number" min="0" max="100" step="1" required></div>
    </div>
    <p class="hint">L’utile della vendita è: prezzo di vendita meno costo acquisto, spedizione acquisto e commissioni vendita. La quota di Stefano e Oleg è calcolata su questo risultato.</p>
    <div class="actions"><button class="btn" type="submit">Salva vendita</button><button class="btn alt" type="button" id="nv-sale-close">Annulla</button><button class="btn warn" type="button" id="nv-sale-undo" hidden>Annulla vendita</button></div>
  </form>`;
  document.body.appendChild(dialog);
  let saleId=null,saving=false;
  const form=id=>document.getElementById(id);
  form('nv-sale-close').addEventListener('click',()=>dialog.close());
  function openSale(id=null){
    saleId=id;
    const r=id?active('watch').find(w=>w.id===id):null;
    const choices=id?watches():available();
    if(!id && choices.length===0){alert('Nessun articolo disponibile: inseriscine uno in Acquisti > Articoli.');return;}
    const item=form('nv-sale-item');
    item.innerHTML='<option value="">Seleziona articolo</option>'+choices.map(w=>'<option value="'+safe(w.id)+'">'+safe(title(w))+' ('+safe(category(w))+')</option>').join('');
    item.value=id||'';item.disabled=!!id;
    const d=r?.data||{};
    for(const [key,val] of Object.entries({
      'nv-sale-date':d.saleDate||dateLocal(), 'nv-sale-price':d.salePrice||'',
      'nv-sale-seller':d.soldBy||'', 'nv-sale-receiver':d.saleCollectedBy||'',
      'nv-sale-client':d.saleClient||'', 'nv-sale-channel':d.salePlatform||'',
      'nv-sale-fees':d.fees||0, 'nv-sale-share':d.saleShareStefano??state.settings.share??50
    })) form(key).value=val;
    const mk=active('market');
    form('nv-sale-market').innerHTML='<option value="">Non collegato</option>'+mk.map(m=>'<option value="'+safe(m.id)+'">'+safe(m.data?.name||'Mercatino')+' - '+safe(m.data?.date||'')+'</option>').join('');
    form('nv-sale-market').value=d.saleMarketId||'';
    form('nv-sale-undo').hidden=!id;
    marketVisibility();
    dialog.showModal();
  }
  function marketVisibility(){form('nv-sale-market-row').hidden=form('nv-sale-channel').value!=='Mercatino';}
  form('nv-sale-channel').addEventListener('change',marketVisibility);
  form('nv-sale-form').addEventListener('submit',async e=>{
    e.preventDefault();if(saving)return;
    const id=saleId||form('nv-sale-item').value;
    const r=active('watch').find(w=>w.id===id);
    if(!r)return alert('Scegli un articolo disponibile.');
    if(!saleId&&r.data?.status==='Venduto')return alert('Questo articolo è già venduto.');
    const price=Number(form('nv-sale-price').value),fees=Number(form('nv-sale-fees').value||0),share=Number(form('nv-sale-share').value);
    const seller=form('nv-sale-seller').value,receiver=form('nv-sale-receiver').value,platform=form('nv-sale-channel').value;
    if(!validMoney(price)||price<=0||!validMoney(fees))return alert('Importi non validi.');
    if(!Number.isFinite(share)||share<0||share>100)return alert('Quota utili non valida.');
    if(!PEOPLE.includes(seller)||!PEOPLE.includes(receiver)||!platform)return alert('Seleziona venditore, chi ha incassato e canale.');
    const marketId=platform==='Mercatino'?form('nv-sale-market').value:'';
    const market=active('market').find(m=>m.id===marketId);
    if(platform==='Mercatino'&&!marketId)return alert('Registra prima il mercatino nella scheda Mercatini.');
    const d={...r.data,status:'Venduto', salePrice:money(price),saleDate:form('nv-sale-date').value, fees:money(fees),
      soldBy:seller, saleCollectedBy:receiver,saleClient:form('nv-sale-client').value.trim(),
      salePlatform:platform, saleMarketId:marketId, saleMarket:market?.data?.name||'', saleShareStefano:share};
    saving=true;
    try {await putRecord({...r,data:d,updated_at:new Date().toISOString()});dialog.close();await reload();autoSync();}
    catch(err){alert('Vendita non salvata: '+err.message);}finally{saving=false;}
  });
  form('nv-sale-undo').addEventListener('click',async()=>{
    const r=active('watch').find(w=>w.id===saleId);
    if(!r||!confirm('Annullare questa vendita? L’articolo torna disponibile e viene stornato l’incasso automatico.'))return;
    const d={...r.data,status:'Disponibile',salePrice:0,saleDate:'',fees:0,soldBy:'',saleCollectedBy:'',
      saleClient:'',salePlatform:'',saleMarketId:'',saleMarket:'',saleShareStefano:''};
    try{await putRecord({...r,data:d,updated_at:new Date().toISOString()});dialog.close();await reload();autoSync();}
    catch(err){alert('Impossibile annullare: '+err.message);}
  });

  function shipmentsPanel(link,id){
    const rows=active('shipment').filter(r=>r.data?.[link]===id);
    return '<section class="panel"><div class="head"><h2>Spedizioni collegate</h2>'+
      '<button type="button" class="btn alt small" data-nv-shipment-new="'+safe(link)+'" data-nv-parent-id="'+safe(id)+'">+ Spedizione</button></div>'+
      (rows.length?rows.map(r=>'<div class="nv-line"><strong>'+safe(r.data?.name||'Spedizione')+'</strong><small>'+safe(r.data?.carrier||'')+
        ' · '+safe(r.data?.tracking||'')+' · '+safe(r.data?.status||'')+'</small><button type="button" class="btn alt small" data-nv-shipment-edit="'+safe(r.id)+'">Modifica</button></div>').join(''):
        '<p class="hint">Nessuna spedizione collegata.</p>')+'</section>';
  }
  const oldEditModal=editModal;
  editModal=function(type,id){
    oldEditModal(type,id);
    if(type==='watch'&&(!id || state.records.find(r=>r.id===id)?.data?.status!=='Venduto')){
      const soldOption=form('f-status')?.querySelector('option[value="Venduto"]');
      if(soldOption)soldOption.remove();
    }
    if(type==='watch'&&id){
      form('form-fields')?.insertAdjacentHTML('beforeend',shipmentsPanel('watchId',id));
    }
  };
  // Delegated controls outside the old navigation.
  document.addEventListener('click',e=>{
    const b=e.target.closest('[data-nv-sale-new],[data-nv-sale-edit],[data-nv-sales-tab],'+
      '[data-nv-market-new],[data-nv-market-edit],[data-nv-shipment-new],[data-nv-shipment-edit],[data-navra-export-sales]');
    if(!b)return;
    if(b.hasAttribute('data-nv-sale-new')){openSale();return;}
    if(b.hasAttribute('data-nv-sale-edit')){openSale(b.dataset.nvSaleEdit);return;}
    if(b.dataset.nvSalesTab){state.navraSalesTab=b.dataset.nvSalesTab;render();return;}
    if(b.hasAttribute('data-nv-market-new')){editModal('market');return;}
    if(b.hasAttribute('data-nv-market-edit')){editModal('market',b.dataset.nvMarketEdit);return;}
    if(b.hasAttribute('data-nv-shipment-edit')){
      const editor=document.getElementById('editor');
      if(editor?.open){if(!confirm('Aprire la spedizione? Salva prima eventuali modifiche all’articolo.'))return;editor.close();}
      editModal('shipment',b.dataset.nvShipmentEdit);return;
    }
    if(b.hasAttribute('data-nv-shipment-new')){
      const link=b.dataset.nvShipmentNew,id=b.dataset.nvParentId;
      const editor=document.getElementById('editor');
      if(editor?.open){if(!confirm('Aprire una nuova spedizione? Salva prima eventuali modifiche all’articolo.'))return;editor.close();}
      editModal('shipment');
      const elem=form('f-'+link);if(elem)elem.value=id;
      return;
    }
    if(b.hasAttribute('data-navra-export-sales'))void exportExcelWithSales();
  },true);

  // Excel workbook: keep existing photos, finance, costs, cash, assets and lots.
  // Append sheet 10 with individual sales without changing the old formulas.
  const te=new TextEncoder(),td=new TextDecoder();
  const u16=(b,p)=>b[p]|b[p+1]<<8;
  const u32=(b,p)=>(b[p]|b[p+1]<<8|b[p+2]<<16|b[p+3]<<24)>>>0;
  const w16=(b,p,v)=>{b[p]=v&255;b[p+1]=v>>>8&255;};
  const w32=(b,p,v)=>{w16(b,p,v);w16(b,p+2,v>>>16);};
  const crcTable=Array.from({length:256},(_,i)=>{let c=i;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
  const crc=b=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
  function unzip(bytes){
    const result=new Map();let i=0;
    while(i+30<=bytes.length && u32(bytes,i)===0x04034b50){
      if(u16(bytes,i+8)!==0||(u16(bytes,i+6)&8))throw Error('Formato Excel inatteso');
      const len=u16(bytes,i+26),extra=u16(bytes,i+28),size=u32(bytes,i+18);
      const name=td.decode(bytes.subarray(i+30,i+30+len)),start=i+30+len+extra;
      result.set(name,bytes.slice(start,start+size));i=start+size;
    }
    return result;
  }
  function zip(files){
    const ls=[],cs=[];let offset=0,centralSize=0;
    for(const [path,data] of files){
      const name=te.encode(path),bytes=typeof data==='string'?te.encode(data):data;
      const lh=new Uint8Array(30+name.length),ch=new Uint8Array(46+name.length),sum=crc(bytes);
      w32(lh,0,0x04034b50);w16(lh,4,20);w32(lh,14,sum);w32(lh,18,bytes.length);w32(lh,22,bytes.length);
      w16(lh,26,name.length);lh.set(name,30);
      w32(ch,0,0x02014b50);w16(ch,4,20);w16(ch,6,20);w32(ch,16,sum);w32(ch,20,bytes.length);
      w32(ch,24,bytes.length);w16(ch,28,name.length);w32(ch,42,offset);ch.set(name,46);
      ls.push(lh,bytes);cs.push(ch);offset+=lh.length+bytes.length;centralSize+=ch.length;
    }
    const end=new Uint8Array(22);w32(end,0,0x06054b50);w16(end,8,files.size);w16(end,10,files.size);
    w32(end,12,centralSize);w32(end,16,offset);
    const out=new Uint8Array(offset+centralSize+22);let p=0;
    for(const b of [...ls,...cs,end]){out.set(b,p);p+=b.length;}
    return out;
  }
  const text=(files,path)=>{const b=files.get(path);if(!b)throw Error('Manca '+path);return td.decode(b);};
  const xml=v=>String(v??'').replace(/[\u0000-\u001f]/g,' ').replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').slice(0,30000);
  const exCol=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  const stringCell=(ref,v,style=0)=>'<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(v)+'</t></is></c>';
  const valueCell=(ref,v,style=3)=>'<c r="'+ref+'" s="'+style+'"><v>'+money(v)+'</v></c>';
  function saleSheet(records){
    const markets=new Map(records.filter(r=>r.type==='market'&&!r.deleted_at).map(r=>[r.id,r.data?.name||'']));
    const lots=new Map(records.filter(r=>r.type==='lot'&&!r.deleted_at).map(r=>[r.id,r.data?.name||'']));
    const items=records.filter(r=>r.type==='watch'&&!r.deleted_at&&r.data?.status==='Venduto')
      .sort((a,b)=>(b.data.saleDate||'').localeCompare(a.data.saleDate||''));
    const headers=['Data vendita','Articolo','Categoria','Lotto','Venduto da','Cliente','Piattaforma','Mercatino',
      'Prezzo vendita','Costo acquisto','Spedizione acquisto','Commissioni vendita','Utile netto vendita',
      'Quota Stefano (%)','Utile Stefano','Utile Oleg','Incasso ricevuto da','ID articolo'];
    const widths=[18,35,22,25,18,26,19,30,20,19,21,20,22,20,20,20,20,39];
    const row0='<row r="1" ht="32" customHeight="1">'+stringCell('A1','Vendite NAVRA',1)+'</row>'+
      '<row r="2" ht="23" customHeight="1">'+stringCell('A2','Ogni articolo venduto compare una volta; costi e ricavi provengono dalla scheda articolo.',6)+'</row>';
    const head='<row r="4" ht="28" customHeight="1">'+headers.map((h,i)=>stringCell(exCol(i)+'4',h,2)).join('')+'</row>';
    const body=items.map((r,i)=>{
      const d=r.data||{},row=5+i,p=money(d.purchase),ship=money(d.purchaseShipping),fees=money(d.fees),
        net=money(money(d.salePrice)-p-ship-fees),pct=d.saleShareStefano==null||d.saleShareStefano===''?Number(state.settings.share??50):Number(d.saleShareStefano);
      const vals=[d.saleDate||'',title(r),d.category||'Orologi',lots.get(d.lotId)||'',d.soldBy||'',d.saleClient||'',
        d.salePlatform||'',d.saleMarket||markets.get(d.saleMarketId)||'',money(d.salePrice),p,ship,fees,net,
        pct,money(net*pct/100),money(net*(100-pct)/100),d.saleCollectedBy||'',r.id];
      return '<row r="'+row+'" ht="22" customHeight="1">'+vals.map((v,j)=>
        [8,9,10,11,12,14,15].includes(j)?valueCell(exCol(j)+row,v):
        j===13?valueCell(exCol(j)+row,v,5):stringCell(exCol(j)+row,v)
      ).join('')+'</row>';
    }).join('');
    const last=Math.max(5,4+items.length);
    const cols=widths.map((w,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+w+'" customWidth="1"/>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<dimension ref="A1:R'+last+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="17"/><cols>'+cols+'</cols><sheetData>'+row0+head+body+'</sheetData><mergeCells count="2"><mergeCell ref="A1:R1"/><mergeCell ref="A2:R2"/></mergeCells><autoFilter ref="A4:R'+last+'"/></worksheet>';
  }
  function addSalesSheet(bytes,records){
    const files=unzip(bytes);
    let workbook=text(files,'xl/workbook.xml');
    const rels=text(files,'xl/_rels/workbook.xml.rels');
    if(!/<workbook\b[^>]*xmlns:r=/.test(workbook))workbook=workbook.replace('<workbook ',
      '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ');
    if(!workbook.includes('name="Lotti"')||!rels.includes('Id="rId10"'))throw Error('Aggiornamento Excel Lotti non riconosciuto.');
    files.set('xl/worksheets/sheet10.xml',saleSheet(records));
    files.set('xl/workbook.xml',workbook.replace('</sheets>','<sheet name="Vendite" sheetId="10" r:id="rId11"/></sheets>'));
    files.set('xl/_rels/workbook.xml.rels',rels.replace('</Relationships>',
      '<Relationship Id="rId11" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet10.xml"/></Relationships>'));
    files.set('[Content_Types].xml',text(files,'[Content_Types].xml').replace('</Types>',
      '<Override PartName="/xl/worksheets/sheet10.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'));
    return zip(files);
  }
  window.NavraVendite=Object.freeze({patchExcel:addSalesSheet,utile:margin,quotaStefano:share});
  let exporting=false;
  async function exportExcelWithSales(){
    if(exporting)return;
    exporting=true;
    const btn=document.querySelector('[data-navra-export-sales]');
    if(btn){btn.disabled=true;btn.textContent='Preparazione Excel...';}
    try {
      const records=await allRecords(),snapshot=new Date();
      const base=window.NavraExcel.createXlsx(records,snapshot);
      const withLots=window.NavraExcelArticoli.patchPackage(base.bytes,records);
      const file=addSalesSheet(withLots,records);
      const label='NAVRA-Report-Completo-'+snapshot.toISOString().slice(0,10)+'.xlsx';
      const blob=new Blob([file],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=label;
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),90000);
      const status=document.querySelector('#nv-export-status')||document.querySelector('#navra-export-status');
      if(status)status.textContent='Report completo creato: '+label;
    }catch(err){alert('Impossibile esportare il report: '+err.message);}
    finally{exporting=false;if(btn){btn.disabled=false;btn.textContent='Scarica Excel completo';}}
  }
})();
