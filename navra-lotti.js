/* NAVRA • Lotti acquistati v2.0
   Si carica DOPO app.js, firebase-adapter.js e navra-upgrade.js.
   Nessuna modifica al database IndexedDB: salva record type='lot' e orologi type='watch'.
   Tutti gli importi sono arrotondati ai centesimi. */
'use strict';
(() => {
  const TYPE = 'lot';
  if (typeof SCHEMA === 'undefined' || typeof state === 'undefined' || typeof putRecord !== 'function') {
    console.error('NAVRA Lotti: caricare dopo il nucleo dell’app.');
    return;
  }
  SCHEMA[TYPE] ||= {title:'Lotto', plural:'Lotti', fields:[]}; // Supporta anche il backup JSON già esistente.
  // Fondamentale: il salvataggio dell'orologio già esistente ricrea i campi da SCHEMA.watch.fields.
  // Questi campi nascosti preservano il collegamento al lotto anche quando si carica una nuova foto.
  for (const key of ['lotId','lotIndex']) {
    if (!SCHEMA.watch.fields.some(f => f[0] === key)) SCHEMA.watch.fields.push([key, key, 'hidden']);
  }
  const prevRender = render;
  const prevEditModal = editModal;
  const prevRecordCard = recordCard;
  const money = value => Number((Number(value) || 0).toFixed(2));
  const cent = v => Math.round((Number(v) || 0) * 100);
  const euros = c => c / 100;
  const now = () => new Date().toISOString();
  const safe = v => esc(v ?? '');
  const alive = t => state.records.filter(r => r.type === t && !r.deleted_at);
  const allLots = () => alive(TYPE).sort((a,b) => b.updated_at.localeCompare(a.updated_at));
  const lotWatches = id => alive('watch').filter(r => r.data?.lotId === id).sort((a,b) => Number(a.data?.lotIndex)-Number(b.data?.lotIndex));
  const unitName = r => [r.data?.brand, r.data?.model].filter(Boolean).join(' ') || 'Orologio da catalogare';
  const selectedLot = () => state.navraLotId && allLots().find(r => r.id === state.navraLotId);
  const split = (total,n) => {
    if (!Number.isSafeInteger(total) || n <= 0) throw new Error('Totale o quantità del lotto non validi.');
    const each = Math.floor(total/n), remainder = total - each*n;
    return Array.from({length:n},(_,i)=>each+(i<remainder?1:0));
  };
  const dateDisplay = date => /^\d{4}-\d{2}-\d{2}$/.test(date||'') ? date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4) : '—';
  const lotTitle = lot => lot?.data?.name || 'Lotto senza nome';
  const key = (d,i) => d.allocations?.[String(i)];
  function allocations(lot,units) {
    const d=lot.data, n=Number(d.quantity), items=units||lotWatches(lot.id);
    if (!Number.isInteger(n) || n<1 || n>250) throw new Error('Quantità non valida (1-250).');
    const purchases=split(cent(d.totalPurchase),n), extras=split(cent(d.shippingCost)+cent(d.otherCosts),n);
    const result=[];
    for(let i=1;i<=n;i++) {
      const manual = d.mode==='manual' ? key(d,i) : null;
      const purchase = manual && Number.isSafeInteger(manual.purchase) ? manual.purchase : purchases[i-1];
      const shared = manual && Number.isSafeInteger(manual.shared) ? manual.shared : extras[i-1];
      result.push({index:i,purchase,shared,watch:items.find(w=>Number(w.data.lotIndex)===i)||null});
    }
    return result;
  }
  function checkAllocations(lot,rows) {
    if(rows.some(a => !Number.isSafeInteger(a.purchase)||!Number.isSafeInteger(a.shared)||a.purchase<0||a.shared<0))
      throw new Error('Ogni importo deve essere un valore non negativo in euro.');
    const p = rows.reduce((s,r)=>s+r.purchase,0), e=rows.reduce((s,r)=>s+r.shared,0);
    if(p!==cent(lot.data.totalPurchase) || e!==cent(lot.data.shippingCost)+cent(lot.data.otherCosts))
      throw new Error('Le quote non tornano. Acquisto: '+eur(euros(p))+' su '+eur(lot.data.totalPurchase)+'. Spese: '+eur(euros(e))+' su '+eur(euros(cent(lot.data.shippingCost)+cent(lot.data.otherCosts)))+'.');
  }
  function makeWatch(lot,i,purchase,shared,date) {
    const d=lot.data;
    return {id:crypto.randomUUID(), type:'watch', created_at:date,updated_at:date,deleted_at:null,data:{
      brand:'Da catalogare', model:lotTitle(lot)+' #'+i,
      status:'Disponibile',supplier:d.supplier||'',buyDate:d.purchaseDate||'',
      purchase:euros(purchase),purchaseShipping:euros(shared),
      purchaseBy:d.paidBy||'',boughtBy:d.paidBy||'',buyShareStefano:d.shareStefano,
      lotId:lot.id,lotIndex:String(i),notes:'Acquistato nel lotto '+lotTitle(lot)
    }};
  }
  function addNav() {
    const nav=document.getElementById('nav');
    if (!nav || nav.querySelector('[data-view="lots"]')) return;
    const btn=document.createElement('button');btn.type='button';btn.dataset.view='lots';btn.textContent='Lotti';
    nav.insertBefore(btn,nav.querySelector('[data-view="watch"]')||nav.firstChild);
  }
  addNav();
  const style=document.createElement('style');
  style.textContent=`
    #navra-lot-form .field{margin-bottom:10px}
    .navra-lot-controls{display:flex;gap:9px;flex-wrap:wrap;margin:12px 0}
    .navra-lot-info{font-size:12px;color:var(--muted);margin:7px 0}
    .navra-lot-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .navra-lot-unit{display:flex;align-items:start;justify-content:space-between;gap:12px;padding:13px 0;border-bottom:1px solid var(--line)}
    .navra-lot-unit:last-child{border-bottom:0}
    .navra-lot-unit strong{overflow-wrap:anywhere}
    .navra-lot-unit .meta{font-size:12px;color:var(--muted);margin-top:3px}
    .navra-lot-unit .btn{margin-top:6px}
    .navra-lot-summary{display:flex;flex-wrap:wrap;gap:10px;margin:10px 0}
    .navra-lot-tag{font-size:11px;color:#6b5230;margin-top:3px}
    #navra-lot-dialog{border:0;border-radius:17px;padding:20px;width:calc(100% - 24px);max-width:590px;max-height:91vh;overflow:auto}
    #navra-lot-dialog::backdrop{background:#16282daa}
    .navra-alloc-table{display:grid;gap:8px}
    .navra-alloc-row{display:grid;grid-template-columns:minmax(80px,1fr) 100px 100px;gap:8px;align-items:center;border-bottom:1px solid var(--line);padding:8px 0}
    .navra-alloc-row input{min-width:0;padding:9px 6px}
    .navra-alloc-row .name{font-size:12px;overflow-wrap:anywhere}
    .navra-alloc-heading{font-size:11px;color:var(--muted);text-align:center}
    .navra-lot-locked{background:#f5f3ed;border-radius:8px;padding:10px;margin-top:8px}
    .field:has(input[type="hidden"]){display:none}
    @media(max-width:390px){.navra-alloc-row{grid-template-columns:minmax(65px,1fr) 82px 82px}}
  `;
  document.head.appendChild(style);
  const dialog=document.createElement('dialog');dialog.id='navra-lot-dialog';
  dialog.innerHTML=`<form id="navra-lot-form">
    <h2 id="navra-lot-dialog-title">Nuovo lotto</h2>
    <p class="navra-lot-info">Ogni lotto genera una scheda per ciascun orologio: potrai poi aggiungere le foto, il modello e la vendita.</p>
    <div class="fields">
      <div class="field wide"><label for="nl-name">Nome lotto *</label><input required maxlength="160" id="nl-name" placeholder="Es. Lotto Uzbekistan 001"></div>
      <div class="field"><label for="nl-quantity">Numero orologi *</label><input required type="number" min="1" max="250" step="1" id="nl-quantity"></div>
      <div class="field"><label for="nl-supplier">Fornitore</label><input id="nl-supplier"></div>
      <div class="field"><label for="nl-purchase-date">Data acquisto</label><input type="date" id="nl-purchase-date"></div>
      <div class="field"><label for="nl-shipping-date">Data spedizione</label><input type="date" id="nl-shipping-date"></div>
      <div class="field"><label for="nl-arrival-date">Data arrivo</label><input type="date" id="nl-arrival-date"></div>
      <div class="field"><label for="nl-paidby">Pagato da</label><select id="nl-paidby"><option value="">Non specificato</option><option>Stefano</option><option>Oleg</option></select></div>
      <div class="field"><label for="nl-share">Quota Stefano sui costi (%)</label><input type="number" min="0" max="100" step="1" id="nl-share" value="50"></div>
      <div class="field"><label for="nl-purchase">Prezzo lotto (€) *</label><input required type="number" min="0" step="0.01" id="nl-purchase"></div>
      <div class="field"><label for="nl-shipping">Spedizione (€)</label><input type="number" min="0" step="0.01" id="nl-shipping" value="0"></div>
      <div class="field"><label for="nl-extras">Altre spese comuni (€)</label><input type="number" min="0" step="0.01" id="nl-extras" value="0"></div>
      <div class="field wide"><label for="nl-notes">Note</label><textarea id="nl-notes"></textarea></div>
    </div>
    <div class="notice">Il costo di acquisto sarà attribuito agli orologi una sola volta. NON registrare di nuovo il totale lotto nella sezione Costi.</div>
    <div class="actions"><button type="submit" class="btn">Salva lotto</button><button type="button" id="nl-cancel" class="btn alt">Annulla</button></div>
  </form>`;
  document.body.appendChild(dialog);
  dialog.querySelector('#nl-cancel').addEventListener('click',()=>dialog.close());
  let editingLotId=null;
  let isSaving=false;
  function openLotDialog(id) {
    const lot=id?allLots().find(r=>r.id===id):null; editingLotId=lot?.id||null;
    const d=lot?.data||{};
    const inputs={name:d.name||'',quantity:d.quantity||'',supplier:d.supplier||'',
      purchaseDate:d.purchaseDate||'',shippingDate:d.shippingDate||'',arrivalDate:d.arrivalDate||'',
      paidBy:d.paidBy||'',share:d.shareStefano??50,purchase:d.totalPurchase??'',
      shipping:d.shippingCost??0,extras:d.otherCosts??0,notes:d.notes||''};
    for(const [field,val] of Object.entries(inputs)) {
      const el=document.getElementById(field==='paidBy'?'nl-paidby':'nl-'+field.replace(/[A-Z]/g,ch=>'-'+ch.toLowerCase()));
      if(el)el.value=String(val);
    }
    const qty=document.getElementById('nl-quantity');qty.readOnly=!!lot;
    document.getElementById('navra-lot-dialog-title').textContent=lot?'Modifica lotto':'Nuovo lotto';
    dialog.showModal();
  }
  const readMoney=id=>{const el=document.getElementById(id),n=Number(el?.value||0);
    if (!Number.isFinite(n)||n<0||n>100000000)throw new Error('Importo non valido: '+id);
    return euros(cent(n));};
  function readLotData(old) {
    const get=id=>document.getElementById(id)?.value.trim()||'';
    const quantity=Number(get('nl-quantity'));
    if(!Number.isInteger(quantity)||quantity<1||quantity>250)throw new Error('Inserisci una quantità tra 1 e 250.');
    const share=Number(get('nl-share'));
    if (!Number.isInteger(share)||share<0||share>100)throw new Error('La quota di Stefano deve essere tra 0 e 100%.');
    const name=get('nl-name');if(!name)throw new Error('Indica il nome del lotto.');
    return {...(old?.data||{}),name,quantity,supplier:get('nl-supplier'),
      purchaseDate:get('nl-purchase-date'),shippingDate:get('nl-shipping-date'),arrivalDate:get('nl-arrival-date'),
      paidBy:get('nl-paidby'),shareStefano:share,totalPurchase:readMoney('nl-purchase'),
      shippingCost:readMoney('nl-shipping'),otherCosts:readMoney('nl-extras'),notes:get('nl-notes'),
      mode:old?.data?.mode||'auto',allocations:old?.data?.allocations||{}};
  }
  async function commitLot(lot, manualRows) {
    const isNew=!state.records.some(r=>r.id===lot.id);
    const n=Number(lot.data.quantity), known=isNew?[]:lotWatches(lot.id);
    if(!isNew && known.length!==n)throw new Error('Questo lotto non ha più '+n+' schede orologio. Ripristina un backup prima di modificarlo, per evitare costi errati.');
    const rows=manualRows||allocations(lot,known);
    checkAllocations(lot,rows);
    const timestamp=now();lot.updated_at=timestamp;lot.created_at ||=timestamp;
    const updated=[];
    for(const row of rows) {
      const old=row.watch;
      const data=old?{...old.data}:{...makeWatch(lot,row.index,row.purchase,row.shared,timestamp).data};
      data.lotId=lot.id;data.lotIndex=String(row.index);
      data.purchase=euros(row.purchase);data.purchaseShipping=euros(row.shared);
      data.supplier=lot.data.supplier||'';
      data.buyDate=lot.data.purchaseDate||'';
      if(lot.data.paidBy){data.purchaseBy=lot.data.paidBy;data.boughtBy=lot.data.paidBy;}
      else data.purchaseBy='';
      data.buyShareStefano=lot.data.shareStefano;
      updated.push({id:old?.id||crypto.randomUUID(),type:'watch',
        data, created_at:old?.created_at||timestamp,updated_at:timestamp,deleted_at:null});
    }
    // Commit the batch to IndexedDB through the existing putRecord hooks so the Costi ledger stays consistent.
    // Crash recovery: lot and watch data use the same deterministic linkage.
    await putRecord(lot);
    for(const watch of updated) await putRecord(watch);
    await reload();
    if(typeof autoSync==='function')autoSync();
  }
  dialog.querySelector('#navra-lot-form').addEventListener('submit',async event=>{
    event.preventDefault();if(isSaving)return;isSaving=true;
    try {
      const old=editingLotId?allLots().find(r=>r.id===editingLotId):null;
      let data=readLotData(old);
      if(old && data.mode==='manual' && (cent(data.totalPurchase)!==cent(old.data.totalPurchase) || cent(data.shippingCost)+cent(data.otherCosts)!==cent(old.data.shippingCost)+cent(old.data.otherCosts))) {
        if(!confirm('Sono cambiati i totali: le quote personalizzate saranno ripartite di nuovo in parti uguali. Potrai personalizzarle subito dopo. Continuare?'))return;
        data={...data,mode:'auto',allocations:{}};
      }
      const lot={id:old?.id||crypto.randomUUID(),type:TYPE,data,created_at:old?.created_at||now(),updated_at:now(),deleted_at:null};
      await commitLot(lot);
      state.navraLotId=lot.id;dialog.close();render();
    } catch(e){alert('Lotto non salvato: '+e.message);}
    finally{isSaving=false;}
  });
  function unitRow(u,mode) {
    const w=u.watch;
    const title=w?unitName(w):'Orologio #'+u.index;
    if(mode===true || mode==='manual') return `<div class="navra-alloc-row">
      <div class="name"><strong>#${u.index} ${safe(title)}</strong><div class="navra-lot-info">${w?.data?.status==='Venduto'?'Venduto':'In magazzino'}</div></div>
      <div><label class="navra-alloc-heading" for="nla-buy-${u.index}">Acquisto €</label><input id="nla-buy-${u.index}" type="number" step="0.01" min="0" data-lot-buy="${u.index}" value="${euros(u.purchase).toFixed(2)}"></div>
      <div><label class="navra-alloc-heading" for="nla-cost-${u.index}">Spese €</label><input id="nla-cost-${u.index}" type="number" step="0.01" min="0" data-lot-cost="${u.index}" value="${euros(u.shared).toFixed(2)}"></div>
    </div>`;
    const status=w?.data?.status||'Disponibile';
    const cost=eur(euros(u.purchase+u.shared));
    const sale=status==='Venduto'?' · Venduto a '+eur(w?.data?.salePrice||0):'';
    return `<div class="navra-lot-unit"><div style="flex:1;min-width:0"><strong>#${u.index} · ${safe(title)}</strong>
      <div class="meta">Costo attribuito: ${safe(cost)} (${safe(eur(euros(u.purchase)))} + ${safe(eur(euros(u.shared)))})</div>
      <div class="meta">${safe(status)}${safe(sale)}</div></div>
      ${w?`<button type="button" class="btn alt small" data-lot-action="watch" data-watch-id="${safe(w.id)}">Apri</button>`:''}
      </div>`;
  }
  function lotsPage() {
    const lots=allLots(), total=lots.reduce((s,r)=>s+cent(r.data.totalPurchase)+cent(r.data.shippingCost)+cent(r.data.otherCosts),0);
    const count=lots.reduce((s,r)=>s+Number(r.data.quantity||0),0);
    return `<div class="head"><h1>Lotti acquistati</h1><button class="btn gold" data-lot-action="create">+ Lotto</button></div>
      <div class="metrics">${metric('Lotti',lots.length)}${metric('Orologi acquistati',count)}${metric('Investimento lotti',eur(euros(total)))}${metric('Costo medio',count?eur(euros(total/count)):'—')}</div>
      <p class="navra-lot-info">I lotti restano disponibili offline e si sincronizzano insieme agli orologi quando torna Internet.</p>
      <div class="list">${lots.length?lots.map(lot=>{
        const d=lot.data,items=lotWatches(lot.id),sold=items.filter(w=>w.data.status==='Venduto').length;
        const total=cent(d.totalPurchase)+cent(d.shippingCost)+cent(d.otherCosts);
        return `<article class="item"><div style="min-width:0"><h3>${safe(lotTitle(lot))}</h3>
          <div class="minor">${safe(d.supplier||'Fornitore non indicato')} · ${safe(dateDisplay(d.purchaseDate))}</div>
          <span class="pill">${items.length} orologi · ${sold} venduti</span></div>
          <div style="text-align:right"><strong>${safe(eur(euros(total)))}</strong><div class="navra-lot-info">${d.mode==='manual'?'Manuale':'Equa'}</div>
          <button class="btn alt small" data-lot-action="detail" data-lot-id="${safe(lot.id)}">Apri</button></div></article>`;
      }).join(''):'<div class="empty">Non hai ancora inserito lotti acquistati.</div>'}</div>`;
  }
  function detailPage(lot) {
    const d=lot.data,units=lotWatches(lot.id),rows=allocations(lot,units);
    const total=cent(d.totalPurchase)+cent(d.shippingCost)+cent(d.otherCosts);
    const sold=units.filter(w=>w.data?.status==='Venduto');
    const realized=cent(sold.reduce((s,w)=>s+Number(w.data.salePrice||0)-Number(w.data.purchase||0)-Number(w.data.purchaseShipping||0)-Number(w.data.fees||0),0));
    const revenue=cent(sold.reduce((s,w)=>s+Number(w.data.salePrice||0),0));
    const manual=d.mode==='manual';
    return `<div class="head"><h1>${safe(lotTitle(lot))}</h1><button class="btn alt small" data-lot-action="back">Tutti i lotti</button></div>
      <div class="navra-lot-controls"><button class="btn alt small" data-lot-action="edit" data-lot-id="${safe(lot.id)}">Modifica lotto</button>
      <button class="btn ${manual?'alt':''} small" data-lot-action="mode" data-mode="manual">Ripartizione manuale</button>
      <button class="btn ${!manual?'alt':''} small" data-lot-action="mode" data-mode="auto">Ripartizione equa</button></div>
      <div class="metrics">${metric('Orologi',units.length+' / '+d.quantity)}${metric('Costo lotto',eur(euros(total)))}${metric('Incassi vendite',eur(euros(revenue)))}${metric('Margine vendite',eur(euros(realized)))}</div>
      <section class="panel" style="margin-top:13px"><h2 style="margin-top:0">Dati acquisto</h2>
        <div class="table-row"><span>Fornitore</span><strong>${safe(d.supplier||'—')}</strong></div>
        <div class="table-row"><span>Data acquisto</span><strong>${safe(dateDisplay(d.purchaseDate))}</strong></div>
        <div class="table-row"><span>Data spedizione</span><strong>${safe(dateDisplay(d.shippingDate))}</strong></div>
        <div class="table-row"><span>Data arrivo</span><strong>${safe(dateDisplay(d.arrivalDate))}</strong></div>
        <div class="table-row"><span>Prezzo acquisto</span><strong>${safe(eur(d.totalPurchase))}</strong></div>
        <div class="table-row"><span>Spedizione</span><strong>${safe(eur(d.shippingCost))}</strong></div>
        <div class="table-row"><span>Altre spese</span><strong>${safe(eur(d.otherCosts))}</strong></div>
        <div class="table-row"><span>Pagato da</span><strong>${safe(d.paidBy||'Da indicare')}</strong></div>
        <div class="table-row"><span>Quota sui costi Stefano</span><strong>${safe(d.shareStefano)}%</strong></div>
        ${d.notes?`<p>${safe(d.notes)}</p>`:''}
      </section>
      <section class="panel"><h2 style="margin-top:0">Orologi del lotto</h2>
        <p class="navra-lot-info">${manual?'Inserisci il costo di acquisto e le spese per ogni orologio. La somma deve tornare esattamente con il totale.':'Il costo è diviso automaticamente in parti uguali, con arrotondamento esatto ai centesimi.'}</p>
        <div class="${manual?'navra-alloc-table':''}">${rows.map(row=>unitRow(row,manual)).join('')}</div>
        ${manual?`<div class="actions"><button type="button" class="btn" data-lot-action="save-alloc">Salva ripartizione</button><button type="button" class="btn alt" data-lot-action="equal-values">Compila importi uguali</button></div>`:''}
      </section><div class="notice">I costi del lotto vengono registrati negli orologi associati e NON devono essere aggiunti una seconda volta nella pagina Costi. I profitti sono calcolati sulle vendite effettive.</div>`;
  }
  render=function(){prevRender();if(state.view==='lots'){
    const el=document.getElementById('content');if(el) el.innerHTML=selectedLot()?detailPage(selectedLot()):lotsPage();
  }};
  editModal=function(type,id){
    prevEditModal(type,id);
    if(type!=='watch')return;
    const watch=id?state.records.find(r=>r.id===id):null;
    if(!watch?.data?.lotId)return;
    for(const f of ['purchase','purchaseShipping','purchaseBy','buyShareStefano']) {
      const el=document.getElementById('f-'+f);if(!el)continue;
      el.style.background='#f3f3ee';el.style.pointerEvents='none';el.tabIndex=-1;
      if(el.tagName==='INPUT')el.readOnly=true;
    }
    const lot=allLots().find(r=>r.id===watch.data.lotId);
    const el=document.getElementById('form-fields');if(el)el.insertAdjacentHTML('afterbegin',
      `<div class="field wide navra-lot-locked"><strong>Acquisto dal lotto ${safe(lotTitle(lot))}</strong><div class="navra-lot-info">Il prezzo d'acquisto, le spese e le quote si modificano nella sezione Lotti, non in questa scheda. Puoi modificare marca, modello, foto e vendita.</div></div>`);
  };
  recordCard=function(record){
    const html=prevRecordCard(record);
    if(record.type!=='watch'||!record.data?.lotId)return html;
    const lot=allLots().find(l=>l.id===record.data.lotId);
    return html.replace('</h3>',`</h3><div class="navra-lot-tag">Lotto: ${safe(lotTitle(lot))}</div>`);
  };
  document.getElementById('content')?.addEventListener('click',async event=>{
    const btn=event.target.closest('[data-lot-action]');if(!btn)return;
    event.preventDefault();event.stopImmediatePropagation();
    const action=btn.dataset.lotAction,lot=selectedLot();
    try {
      if(action==='create'){openLotDialog();return;}
      if(action==='back'){state.navraLotId=null;render();return;}
      if(action==='detail'){state.navraLotId=btn.dataset.lotId;render();return;}
      if(action==='edit'){openLotDialog(btn.dataset.lotId);return;}
      if(action==='watch'){editModal('watch',btn.dataset.watchId);return;}
      if(!lot)return;
      if(action==='equal-values'){
        const rows=allocations({...lot,data:{...lot.data,mode:'auto'}},lotWatches(lot.id));
        for(const row of rows) {
          document.getElementById('nla-buy-'+row.index).value=euros(row.purchase).toFixed(2);
          document.getElementById('nla-cost-'+row.index).value=euros(row.shared).toFixed(2);
        }
        return;
      }
      if(action==='mode'){
        const mode=btn.dataset.mode;
        if(mode===lot.data.mode)return;
        if(mode==='auto'&&!confirm('Ritornare alla divisione equa? Le quote personalizzate saranno sostituite.'))return;
        const data={...lot.data,mode,allocations:mode==='manual'? Object.fromEntries(allocations(lot,lotWatches(lot.id)).map(a=>[String(a.index),{purchase:a.purchase,shared:a.shared}])):{}};
        await commitLot({...lot,data});render();return;
      }
      if(action==='save-alloc'){
        if(lot.data.mode!=='manual')return;
        const rows=allocations(lot,lotWatches(lot.id)).map(row=>{
          const p=document.getElementById('nla-buy-'+row.index),e=document.getElementById('nla-cost-'+row.index);
          if(!p||!e||p.value===''||e.value==='')throw new Error('Compila tutte le quote in euro.');
          return {...row,purchase:cent(p.value),shared:cent(e.value)};
        });
        checkAllocations(lot,rows);
        const updated={...lot,data:{...lot.data,allocations:Object.fromEntries(rows.map(r=>[String(r.index),{purchase:r.purchase,shared:r.shared}]))}};
        await commitLot(updated,rows);render();return;
      }
    }catch(e){alert('Operazione non riuscita: '+e.message);}
  },true);
})();
