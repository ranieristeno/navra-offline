/* NAVRA v26 | Ripartizione incassi (utile + capitale) e cassa per posizione.
   Modulo aggiuntivo. Caricare DOPO navra-catalog.js e tutti gli altri addon.
   Non cambia i record esistenti; usa type:'cost' nello stesso IndexedDB/Firebase.
   Nota: la ripartizione e' contabile; non certifica un pagamento a un socio.
 */
'use strict';
(() => {
  if (typeof state === 'undefined' || typeof render !== 'function' ||
      typeof putRecord !== 'function' || typeof reload !== 'function') return;
  const PARTNERS = ['Stefano', 'Oleg'];
  const LOCATIONS = ['Vinted', 'eBay', 'PayPal', 'Contanti', 'Conto bancario', 'Altro'];
  const RECEIPT = 'profit_receipt';
  const RECEIPT_VOID = 'profit_receipt_void';
  const SPLIT = 'profit_distribution';
  const VOID = 'profit_distribution_void';
  let saving = false, modal = null;
  const safe = v => typeof esc === 'function' ? esc(String(v ?? '')) : String(v ?? '');
  const cents = v => Number.isFinite(Number(v)) ? Math.round(Number(v)*100) : NaN;
  const money = v => (v/100).toLocaleString('it-IT', {style:'currency',currency:'EUR'});
  const today = () => {const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10);};
  const isDate = x => /^\d{4}-\d{2}-\d{2}$/.test(String(x||'')) && !Number.isNaN(Date.parse(x+'T12:00:00Z')) && new Date(x+'T12:00:00Z').toISOString().slice(0,10)===x;
  const pretty = x => isDate(x) ? x.slice(8,10)+'/'+x.slice(5,7)+'/'+x.slice(0,4) : '—';
  const valid = x => Number.isSafeInteger(x) && x >= 0 && x <= 100000000000;
  const alive = (type) => (state.records||[]).filter(r => !r.deleted_at && (!type || r.type===type));
  const costs = () => alive('cost');
  const lastDate = (r) => isDate(r.data?.date) ? r.data.date : (isDate(r.updated_at?.slice(0,10))?r.updated_at.slice(0,10):'');
  const at = (r,date) => !date || (lastDate(r) && lastDate(r)<=date);
  const walletKey = (person,location) => person+'::'+location;
  const labelWallet = (person,location) => location+' · '+person;
  const own = x => PARTNERS.includes(x);
  const place = x => LOCATIONS.includes(x) ? x : 'Contanti';
  const isoNow = () => new Date().toISOString();
  const regular = () => {
    const r=state.settings?.share;
    return Number.isFinite(Number(r)) && r!=='' && r!=null ? Math.max(0,Math.min(100,Number(r))) : 50;
  };
  const voidedIds = date => new Set(costs().filter(r=>r.data?.kind===VOID && at(r,date)).map(r=>r.data?.targetId).filter(Boolean));
  const splits = date => {const voided=voidedIds(date);return costs().filter(r=>r.data?.kind===SPLIT && at(r,date) && !voided.has(r.id));};
  const receiptVoidIds = () => new Set(costs().filter(r=>r.data?.kind===RECEIPT_VOID).map(r=>r.data?.targetId).filter(Boolean));
  const allReceipts = () => costs().filter(r=>r.data?.kind===RECEIPT).sort((a,b)=>(b.data?.date||'').localeCompare(a.data?.date||''));
  const receipts = () => {const removed=receiptVoidIds();return allReceipts().filter(r=>!removed.has(r.id));};
  const receiptLeft = r => Math.max(0,(cents(r.data?.amount)||0)-splits().filter(x=>x.data?.receiptId===r.id).reduce((a,x)=>a+(cents(x.data?.amount)||0),0));
  const allSplits = () => costs().filter(r=>r.data?.kind===SPLIT).sort((a,b)=>(b.data?.date||'').localeCompare(a.data?.date||''));
  function debtAt(date) {
    // Match the existing NAVRA Splitwise balance; do not count cash or profit twice.
    const records=costs().filter(r=>['expense','settlement'].includes(r.data?.kind) && at(r,date));
    if (window.NavraCosts?.calculate) return window.NavraCosts.calculate(records).balance;
    let n=0;
    for(const r of records) {
      const d=r.data||{},value=cents(d.amount);
      if(!valid(value)||!value||!own(d.paidBy))continue;
      if(d.kind==='settlement')n+=d.paidBy==='Stefano'?-value:value;
      else if(d.kind==='expense'){
        const share=Number(d.shareStefano);
        if(!Number.isFinite(share)||share<0||share>100)continue;
        n+=Math.round(value*share/100)-(d.paidBy==='Stefano'?value:0);
      }
    }
    return n;
  }
  function netSale(w) {
    if(window.NavraVendite?.utile) return cents(window.NavraVendite.utile(w));
    const d=w.data||{};
    let maintenance=0;
    for(const c of costs()) if(c.data?.kind==='expense' && c.data?.watchId===w.id &&
      (c.data?.maintenance===true || (c.data?.category==='Riparazione' && c.data?.autoFromWatch!==true)))
      maintenance+=cents(c.data.amount)||0;
    return (cents(d.salePrice)||0)-(cents(d.purchase)||0)-(cents(d.purchaseShipping)||0)-(cents(d.fees)||0)-maintenance;
  }
  function earned(date) {
    return alive('watch').filter(w=>w.data?.status==='Venduto'&&(!date || (isDate(w.data?.saleDate)&&w.data.saleDate<=date)))
      .reduce((n,w)=>n+netSale(w),0);
  }
  const already = date => splits(date).reduce((n,r)=>n+(cents(r.data?.profitAllocated)||0),0);
  const cashAllocated = () => splits().reduce((n,r)=>n+(cents(r.data?.cashDistributed ?? r.data?.profitAllocated)||0),0);
  const pending = date => Math.max(0,earned(date)-already(date));
  const defaultLocation = channel => {
    const c=String(channel||'').toLowerCase();
    return c.includes('vinted')?'Vinted':c.includes('ebay')?'eBay':c.includes('paypal')?'PayPal':'Contanti';
  };
  function cashLedger(date) {
    const ledger=new Map();const watches=new Map(alive('watch').map(w=>[w.id,w]));
    const add=(person,where,delta)=>{
      if(!own(person))return;
      const loc=place(where),key=walletKey(person,loc);
      ledger.set(key,(ledger.get(key)||0)+delta);
    };
    for(const r of costs().filter(r=>at(r,date))) {
      const d=r.data||{},value=cents(d.amount);
      if(!valid(value)||!value)continue;
      if(d.kind==='sale_receipt') {
        const watch=watches.get(d.watchId);
        add(d.holder,d.location||defaultLocation(watch?.data?.salePlatform),value);
      } else if(d.kind==='cash_in')add(d.holder,d.location,value);
      else if(d.kind==='cash_out')add(d.holder,d.location,-value);
      else if(d.kind==='cash_transfer'||d.kind==='cash_location_transfer'){
        add(d.from,d.fromLocation||'Contanti',-value);
        add(d.to,d.toLocation||'Contanti',value);
      }
    }
    return ledger;
  }
  function sumWallets(map,owner){let n=0;for(const [key,v] of map)if(!owner||key.startsWith(owner+'::'))n+=v;return n;}
  function walletOptions(selected='',nonempty=false) {
    const map=cashLedger(today());
    return PARTNERS.flatMap(p=>LOCATIONS.map(loc=>{
      const key=walletKey(p,loc),value=map.get(key)||0;
      if(nonempty&&value<=0&&key!==selected)return '';
      return `<option value="${safe(key)}" ${selected===key?'selected':''}>${safe(labelWallet(p,loc))} · ${money(value)}</option>`;
    })).join('');
  }
  function balanceLabel(value) {
    return value>0?'Stefano deve '+money(value)+' a Oleg':value<0?'Oleg deve '+money(-value)+' a Stefano':'Nessun debito tra soci';
  }
  function distribute(gross,share,offset,debts) {
    const baseSte=Math.round(gross*share/100),baseOle=gross-baseSte;
    const applied=offset ? (debts>0?Math.min(debts,baseSte): -Math.min(-debts,baseOle)) : 0;
    // Positive B: Stefano owes Oleg, who receives a larger share.
    return {ste:baseSte-applied,ole:baseOle+applied,baseSte,baseOle,applied};
  }
  function panel() {
    const profit=earned(),distributed=already(),left=Math.max(0,profit-distributed);
    const assignedCash=cashAllocated();
    const expense=splits().reduce((a,r)=>a+(cents(r.data?.reserve)||0),0);
    const records=allSplits(), reversed=voidedIds(), registered=receipts(), allRegistered=allReceipts(), cancelledReceipts=receiptVoidIds();
    const receiptPending=registered.reduce((n,r)=>n+receiptLeft(r),0);
    const history=records.map(r=>{
      const d=r.data||{},rev=reversed.has(r.id);
      const a=cents(d.profitAllocated)||0,b=cents(d.amount)||0,ste=cents(d.stefano)||0,ole=cents(d.oleg)||0;
      const distributedCash=cents(d.cashDistributed ?? d.profitAllocated)||0;
      return `<div class="nv26-ledger ${rev?'nv26-reversed':''}"><div><strong>${safe(d.title||'Ripartizione incasso')}</strong>
        <small>${pretty(d.date)} · ${safe(d.sourceOwner||'')} / ${safe(d.sourceLocation||'')} ${rev?' · STORNATA':''}</small>
        <small>Incasso utilizzato ${money(b)} · Somma assegnata ${money(distributedCash)} · Di cui utile ${money(a)}</small>
        <small>Di cui recupero capitale ${money(Math.max(0,distributedCash-a))} · Riserva spese ${money(cents(d.reserve)||0)}</small>
        <small>Stefano ${money(ste)} · Oleg ${money(ole)}${d.compensated?` · Debito compensato ${money(Math.abs(cents(d.compensated)||0))}`:''}</small>
        <small>Saldo debiti prima: ${safe(balanceLabel(cents(d.debtBefore)||0))}</small></div>
        ${!rev?`<button type="button" class="btn alt small" data-nv26-void="${safe(r.id)}">Storna</button>`:d.compensated && !costs().some(x=>x.id==='profit-offset-reversal-'+r.id && !x.deleted_at)?`<button type="button" class="btn alt small" data-nv26-void="${safe(r.id)}">Completa storno</button>`:''}
      </div>`;
    }).join('')||'<p class="hint">Nessuna ripartizione registrata.</p>';
    const pendingList=allRegistered.map(r=>{const d=r.data||{},cancelled=cancelledReceipts.has(r.id),rest=cancelled?0:receiptLeft(r);return `<div class="nv26-ledger ${cancelled?'nv26-reversed':''}"><div><strong>${safe(d.title||'Incasso')}</strong><small>${pretty(d.date)} · ${safe(d.sourceLocation)} · ${safe(d.sourceOwner)}</small><small>Registrato ${money(cents(d.amount)||0)} · ${cancelled?'STORNATO':'ancora da gestire '+money(rest)}</small></div><div class="nv26-receipt-actions">${rest?`<button type="button" class="btn alt small" data-nv26-receipt="${safe(r.id)}">Ripartisci</button>`:''}${!cancelled&&!splits().some(x=>x.data?.receiptId===r.id)?`<button type="button" class="btn alt small" data-nv26-void-receipt="${safe(r.id)}">Storna</button>`:''}</div></div>`;}).join('')||'<p class="hint">Nessun incasso registrato per la ripartizione.</p>';
    return `<section id="nv26-profit" class="panel"><div class="nv26-head"><h2>Ripartizione utili e incassi</h2>
      <button type="button" class="btn" data-nv26-open="receipt">+ Registra incasso</button></div>
      <p class="hint">Registra manualmente un incasso già presente in Cassa, poi decidi se ripartirlo tutto o in parte. Puoi assegnare anche capitale recuperato, distinguendolo dall'utile netto. Nessuna seconda entrata viene creata.</p>
      <div class="nv26-metrics"><div><small>Utile realizzato</small><strong>${money(profit)}</strong></div>
      <div><small>Utile già ripartito</small><strong>${money(distributed)}</strong></div>
      <div><small>Utile da ripartire</small><strong>${money(left)}</strong></div>
      <div><small>Cassa già assegnata ai soci</small><strong>${money(assignedCash)}</strong></div>
      <div><small>Incassi ancora da gestire</small><strong>${money(receiptPending)}</strong></div></div>
      <p class="hint">Saldo attuale: <strong>${safe(balanceLabel(debtAt()))}</strong>. Puoi compensarlo nella prossima ripartizione, mantenendo lo storico del saldo alla data.</p>
      <h3>Incassi registrati</h3>${pendingList}
      <p class="hint">Accantonamenti spese nelle ripartizioni: ${money(expense)}.</p>
      <details class="nv26-history"><summary>Storico ripartizioni (${records.length})</summary>${history}</details>
      <p class="hint">Le quote assegnate non certificano trasferimenti bancari o pagamenti. Se il denaro viene realmente versato ai soci, registra la relativa uscita in Cassa. Evita ripartizioni contemporanee dai due dispositivi.</p>
      </section>`;
  }
  function walletPanel() {
    const ledger=cashLedger(),total=sumWallets(ledger),cash=costs().filter(r=>['sale_receipt','cash_in','cash_out','cash_transfer','cash_location_transfer'].includes(r.data?.kind)).length;
    const rows=PARTNERS.map(p=>{
      const entries=LOCATIONS.filter(loc=>ledger.get(walletKey(p,loc)));
      return `<div class="nv26-wallet-owner"><h3>${safe(p)} <span>${money(sumWallets(ledger,p))}</span></h3>
      ${entries.length?entries.map(loc=>`<div class="nv26-wallet-row"><span>${safe(loc)}</span><strong>${money(ledger.get(walletKey(p,loc)))}</strong></div>`).join(''):'<p class="hint">Nessun movimento attribuito.</p>'}</div>`;
    }).join('');
    return `<div class="nv26-wallet"><h3>Dove si trovano i soldi</h3>
      <p class="hint">Vinted, eBay, PayPal, contanti e conto bancario sono distinti per socio. I vecchi movimenti senza posizione vengono classificati come contanti; puoi correggere la posizione con un trasferimento.</p>
      <div class="nv26-wallets">${rows}</div>
      <div class="nv26-cash-actions"><button class="btn small" data-nv26-open="transfer">Sposta fondi</button>
      <button class="btn alt small" data-nv26-open="adjust">Rettifica saldo</button></div>
      <p class="hint">Spostare fondi non crea incassi. Totale registrato nelle posizioni: <strong>${money(total)}</strong> · ${cash} movimenti. Un saldo negativo indica una posizione da riconciliare.</p></div>`;
  }
  function inject() {
    if(state.view!=='home')return;
    const content=document.getElementById('content');if(!content)return;
    const cash=content.querySelector('.nv-cash-home');
    if(!content.querySelector('#nv26-profit')) {
      if(cash) cash.insertAdjacentHTML('beforebegin',panel());
      else content.insertAdjacentHTML('beforeend',panel());
    }
    if(cash&&!cash.querySelector('.nv26-wallet')){
      const metrics=cash.querySelector('.nv-cash-metrics');
      if(metrics)metrics.insertAdjacentHTML('afterend',walletPanel());
      else cash.insertAdjacentHTML('beforeend',walletPanel());
    }
  }
  const style=document.createElement('style');
  style.textContent=`
   .nv26-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
   .nv26-head h2{margin:0}.nv26-head .btn{white-space:nowrap}
   .nv26-metrics{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin:13px 0}
   .nv26-metrics>div{background:var(--paper);padding:12px;border:1px solid var(--line);border-radius:10px;min-width:0}
   .nv26-metrics small{display:block;color:var(--muted);font-size:12px}.nv26-metrics strong{display:block;font-size:18px;margin-top:4px;overflow-wrap:anywhere}
   .nv26-history summary{cursor:pointer;font-weight:600;padding:12px 0}.nv26-ledger{display:flex;justify-content:space-between;align-items:start;gap:10px;border-top:1px solid var(--line);padding:12px 0}
   .nv26-ledger small{display:block;color:var(--muted);margin-top:5px;font-size:12px}.nv26-receipt-actions{display:flex;flex-direction:column;gap:5px;align-items:flex-end}.nv26-reversed{opacity:.65;text-decoration:line-through}.nv26-receipt-actions{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
   .nv26-wallet{border-top:1px solid var(--line);margin-top:16px;padding-top:13px}.nv26-wallet h3{margin:3px 0 10px;font-size:16px}
   .nv26-wallets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.nv26-wallet-owner{border:1px solid var(--line);border-radius:9px;padding:11px;min-width:0}
   .nv26-wallet-owner h3{display:flex;flex-direction:column;gap:5px;font-size:14px}.nv26-wallet-owner h3 span{font-size:19px;overflow-wrap:anywhere}
   .nv26-wallet-row{display:flex;justify-content:space-between;gap:6px;padding:8px 0;border-top:1px solid var(--line);font-size:12px}
   .nv26-wallet-row strong{overflow-wrap:anywhere;text-align:right}.nv26-cash-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
   .nv26-form .field{margin-bottom:12px}.nv26-form .field>label{display:block;margin-bottom:4px}
   .nv26-preview{background:var(--paper);border:1px solid var(--line);border-radius:10px;padding:12px;margin:12px 0}
   .nv26-preview p{font-size:13px;margin:5px 0}.nv26-preview strong{color:var(--dark)}
   .nv26-form .nv26-checkbox{display:flex;align-items:flex-start;gap:10px;margin:10px 0;font-weight:600}
   .nv26-checkbox input{width:19px;height:19px;min-height:19px;flex:none;margin-top:1px}
   .nv26-warning{color:#934f21;background:#fff6e8;padding:10px;border-radius:8px;font-size:12px}
   @media(max-width:480px){.nv26-wallets{grid-template-columns:1fr}.nv26-metrics strong{font-size:16px}}
  `;
  document.head.appendChild(style);

  function open(type,linkedId='') {
    if(!modal){modal=document.createElement('dialog');modal.id='nv26-dialog';document.body.appendChild(modal);}
    if(type==='receipt') {
      modal.innerHTML=`<form class="nv26-form" id="nv26-receipt-form"><h2>Registra incasso disponibile</h2>
        <p class="hint">Questo importo è già compreso nella cassa delle vendite, e viene soltanto contrassegnato come disponibile per decidere la ripartizione. Non genera un'entrata aggiuntiva.</p>
        <div class="field"><label>Data</label><input id="nv26-rdate" type="date" max="${today()}" value="${today()}" required></div>
        <div class="field"><label>Descrizione</label><input id="nv26-rtitle" maxlength="120" placeholder="Es. Vinted novembre" required></div>
        <div class="field"><label>Dove sono i soldi?</label><select id="nv26-rsource">${walletOptions('',true)}</select></div>
        <div class="field"><label>Importo incassato (€)</label><input id="nv26-ramount" type="number" inputmode="decimal" min="0.01" step="0.01" required></div>
        <div class="actions"><button class="btn" type="submit">Registra incasso</button><button class="btn alt" type="button" data-nv26-close>Chiudi</button></div></form>`;
      const q=id=>modal.querySelector('#'+id);
      q('nv26-receipt-form').addEventListener('submit',async e=>{
        e.preventDefault();if(saving)return;
        const date=q('nv26-rdate').value,source=q('nv26-rsource').value,amount=cents(q('nv26-ramount').value),title=q('nv26-rtitle').value.trim();
        const [owner,location]=source.split('::');
        if(!title||!own(owner)||!LOCATIONS.includes(location)||!valid(amount)||amount<=0||!isDate(date)||date>today())return alert('Compila tutti i campi correttamente.');
        if(amount>(cashLedger(date).get(source)||0))return alert('L’importo supera il saldo registrato in questa posizione. Controlla o rettifica prima la Cassa.');
        if(receipts().some(r=>r.data?.date===date&&r.data?.sourceOwner===owner&&r.data?.sourceLocation===location&&cents(r.data?.amount)===amount)
          && !confirm('Un incasso identico è già registrato nella stessa data e posizione. Confermi che sia un secondo incasso distinto?'))return;
        saving=true;
        try{const now=isoNow();await putRecord({id:crypto.randomUUID(),type:'cost',data:{kind:RECEIPT,date,title,amount:amount/100,sourceOwner:owner,sourceLocation:location,
          notes:'Incasso confermato per eventuale ripartizione. Non modifica la cassa.'},created_at:now,updated_at:now,deleted_at:null});
          modal.close();await reload();if(typeof autoSync==='function')autoSync();}
        catch(err){alert('Registrazione non riuscita: '+err.message);}finally{saving=false;}
      });
    } else if(type==='split') {
      const linked=receipts().find(r=>r.id===linkedId);
      if(!linked||!receiptLeft(linked))return alert('Incasso non disponibile o già interamente gestito.');
      const wallet=walletKey(linked.data.sourceOwner,linked.data.sourceLocation);
      modal.innerHTML=`<form class="nv26-form" id="nv26-split-form"><h2>Registra incasso e ripartizione</h2>
       <p class="hint">Confermi una parte di denaro già presente in cassa e scegli quanto utile distribuire. Nessun nuovo incasso viene aggiunto automaticamente.</p>
       <div class="field"><label>Data della ripartizione</label><input id="nv26-date" type="date" max="${today()}" value="${today()}" required></div>
       <div class="field"><label>Descrizione</label><input id="nv26-title" maxlength="120" placeholder="Es. Incasso Vinted di novembre" required></div>
       <div class="field"><label>Origine dell’incasso</label><input value="${safe(labelWallet(linked.data.sourceOwner,linked.data.sourceLocation))}" disabled></div>
       <div class="field"><label>Incasso disponibile per questa operazione (€)</label><input id="nv26-receipt" type="number" inputmode="decimal" min="0.01" step="0.01" required></div>
       <label class="nv26-checkbox"><input type="checkbox" id="nv26-expenses">Accantona una parte per spese</label>
       <div class="field" id="nv26-reserve-wrapper" hidden><label>Riserva spese (€)</label><input id="nv26-reserve" type="number" inputmode="decimal" min="0" step="0.01" value="0"></div>
       <div class="field"><label>Di quanto assegni ai soci, quale parte è utile netto? (€)</label><input id="nv26-profit-amount" type="number" inputmode="decimal" min="0" step="0.01" value="0" required></div>
       <div class="field"><label>Quota Stefano (%)</label><input id="nv26-share" type="number" min="0" max="100" step="0.01" value="${regular()}" required></div>
       <label class="nv26-checkbox"><input type="checkbox" id="nv26-offset">Compensa il debito esistente tra i soci (alla data scelta)</label>
       <div id="nv26-preview" class="nv26-preview" aria-live="polite"></div>
       <p class="nv26-warning">Il denaro da assegnare ai soci è l'incasso scelto meno l'eventuale riserva spese. Solo la parte indicata come utile riduce l'utile da ripartire. Le spese già anticipate dai soci sono nel saldo debiti: non accantonarle nuovamente se le stai compensando. La ripartizione non esegue bonifici.</p>
       <div class="actions"><button class="btn" type="submit">Conferma ripartizione</button><button class="btn alt" type="button" data-nv26-close>Chiudi</button></div></form>`;
      const q=id=>modal.querySelector('#'+id);
      let manualProfit=false;
      const num=id=>Number(q(id)?.value||0);
      const expected=()=>{
        const date=q('nv26-date').value, walletKeyValue=wallet, [owner,loc]=walletKeyValue.split('::');
        const amount=cents(q('nv26-receipt').value),reserve=q('nv26-expenses').checked?cents(q('nv26-reserve').value):0;
        const maxProfit=pending(date);
        const available=receiptLeft(linked);
        const distribution=amount-reserve,profitPart=cents(q('nv26-profit-amount').value),share=num('nv26-share'),debt=debtAt(date);
        const choice=distribute(valid(distribution)?distribution:0,Number.isFinite(share)?share:50,q('nv26-offset').checked,debt);
        const warnings=[];
        if(!isDate(date)||date>today())warnings.push('Data non valida o futura.');
        if(!valid(amount)||!amount)warnings.push('Inserisci un incasso positivo.');
        if(!valid(reserve)||reserve>amount)warnings.push('Riserva spese superiore all’incasso.');
        if(!valid(distribution)||distribution<=0)warnings.push('Dopo la riserva deve restare un importo positivo da assegnare ai soci.');
        if(!valid(profitPart)||profitPart>distribution)warnings.push('La parte indicata come utile non può superare quanto assegni ai soci.');
        if(profitPart>maxProfit)warnings.push('La parte indicata come utile supera l’utile effettivamente ancora disponibile.');
        if(amount>available)warnings.push('L’importo supera quello ancora da gestire di questo incasso.');
        if(!Number.isFinite(share)||share<0||share>100)warnings.push('Percentuale non valida.');
        return {date,owner,loc,amount,reserve,distribution,profitPart,share,debt,available,maxProfit,choice,warnings};
      };
      function preview() {
        const v=expected();
        q('nv26-preview').innerHTML=`<p>Disponibile in ${safe(v.loc)} · ${safe(v.owner)}: <strong>${money(v.available)}</strong></p>
          <p>Utile non ancora ripartito al ${pretty(v.date)}: <strong>${money(v.maxProfit)}</strong></p>
          <p>Debiti prima: <strong>${safe(balanceLabel(v.debt))}</strong></p>
          <p>Denaro da assegnare ai soci: <strong>${money(Math.max(0,v.distribution))}</strong> (incasso meno riserva)</p>
          <p>Di cui utile netto: <strong>${money(valid(v.profitPart)?v.profitPart:0)}</strong> · Recupero capitale: <strong>${money(Math.max(0,v.distribution-(valid(v.profitPart)?v.profitPart:0)))}</strong></p>
          <p>Quota Stefano: <strong>${money(v.choice.ste)}</strong> · Quota Oleg: <strong>${money(v.choice.ole)}</strong></p>
          <p>Debito compensato: <strong>${money(Math.abs(v.choice.applied))}</strong> · Debito dopo: <strong>${safe(balanceLabel(v.debt-v.choice.applied))}</strong></p>
          <p>Utile che rimarrà da ripartire: <strong>${money(Math.max(0,v.maxProfit-(valid(v.profitPart)?v.profitPart:0)))}</strong></p>
          ${v.warnings.length?`<p class="nv26-warning">${v.warnings.map(safe).join(' ')}</p>`:''}`;
      }
      function updateAuto() {
        const available=Math.max(0,Number(q('nv26-receipt').value||0)-Number(q('nv26-expenses').checked?q('nv26-reserve').value||0:0));
        q('nv26-profit-amount').value=(Math.min(available,pending(q('nv26-date').value)/100)).toFixed(2);
      }
      for(const id of ['nv26-date','nv26-receipt','nv26-reserve','nv26-share','nv26-offset','nv26-expenses','nv26-profit-amount']) {
        q(id).addEventListener('input',()=>{
          if(id==='nv26-expenses')q('nv26-reserve-wrapper').hidden=!q(id).checked;
          if(id==='nv26-profit-amount')manualProfit=true;
          else if(['nv26-receipt','nv26-reserve','nv26-date','nv26-expenses'].includes(id)&&!manualProfit)updateAuto();
          preview();
        });
        q(id).addEventListener('change',preview);
      }
      q('nv26-split-form').addEventListener('submit',async e=>{
        e.preventDefault();if(saving)return;
        const v=expected();
        if(v.warnings.length)return alert(v.warnings.join('\n'));
        if(v.choice.applied && !confirm('La compensazione ridurrà il saldo debiti tra soci di '+money(Math.abs(v.choice.applied))+'. Confermi?'))return;
        if(!confirm('Confermi di assegnare '+money(v.distribution)+' ai soci, di cui '+money(v.profitPart)+' di utile? Non vengono eseguiti trasferimenti reali.'))return;
        saving=true;
        try {
          const id=crypto.randomUUID(),now=isoNow();
          const data={kind:SPLIT,receiptId:linked.id,amount:v.amount/100,date:v.date,title:q('nv26-title').value.trim(),
            sourceOwner:v.owner,sourceLocation:v.loc,reserve:v.reserve/100,cashDistributed:v.distribution/100,
            capitalReturned:(v.distribution-v.profitPart)/100,profitAllocated:v.profitPart/100,
            shareStefano:v.share,stefano:v.choice.ste/100,oleg:v.choice.ole/100,
            baseStefano:v.choice.baseSte/100,baseOleg:v.choice.baseOle/100,
            compensated:v.choice.applied/100,debtBefore:v.debt/100,debtAfter:(v.debt-v.choice.applied)/100,
            profitBefore:v.maxProfit/100,notes:'Ripartizione contabile. Non è un movimento aggiuntivo di cassa.'};
          if(!data.title)throw new Error('Inserisci una descrizione.');
          // Use stable deterministic ID for the compensation: safe to retry after interrupted writes.
          const splitRecord={id,type:'cost',data,created_at:now,updated_at:now,deleted_at:null};
          await putRecord(splitRecord);
          if(v.choice.applied){
            const settlement={id:'profit-offset-'+id,type:'cost',
              data:{kind:'settlement',title:'Compensazione utili '+data.title,
                category:'Compensazione utili',amount:Math.abs(v.choice.applied)/100,
                paidBy:v.choice.applied>0?'Stefano':'Oleg',shareStefano:0,date:v.date,
                profitDistributionId:id,autoProfitOffset:true,
                notes:'Compensazione contabile concordata nella ripartizione; nessun movimento fisico di denaro.'},
              created_at:now,updated_at:now,deleted_at:null};
            await putRecord(settlement);
          }
          modal.close();await reload();if(typeof autoSync==='function')autoSync();
        }catch(err){alert('Salvataggio non completato: '+err.message+'; verifica lo storico e sincronizza prima di riprovare.');await reload();}
        finally{saving=false;}
      });
      q('nv26-date').value=linked.data.date||today();
      q('nv26-title').value=linked.data.title||'Ripartizione incasso';
      q('nv26-receipt').value=(receiptLeft(linked)/100).toFixed(2);
      updateAuto();preview();
    } else if(type==='transfer') {
      modal.innerHTML=`<form class="nv26-form" id="nv26-transfer-form"><h2>Sposta fondi tra posizioni</h2>
        <p class="hint">Esempio: 200 € da Vinted Stefano a Conto bancario Stefano. Nessun nuovo incasso.</p>
        <div class="field"><label>Data</label><input id="nv26-transfer-date" type="date" max="${today()}" value="${today()}" required></div>
        <div class="field"><label>Da</label><select id="nv26-from">${walletOptions('',true)}</select></div>
        <div class="field"><label>A</label><select id="nv26-to">${walletOptions()}</select></div>
        <div class="field"><label>Importo (€)</label><input id="nv26-transfer-amount" type="number" inputmode="decimal" step="0.01" min="0.01" required></div>
        <div class="field"><label>Note</label><input id="nv26-transfer-notes" maxlength="200" placeholder="Es. Prelievo Vinted"></div>
        <div class="actions"><button class="btn" type="submit">Registra spostamento</button><button class="btn alt" type="button" data-nv26-close>Chiudi</button></div></form>`;
      const q=id=>modal.querySelector('#'+id);
      q('nv26-transfer-form').addEventListener('submit',async e=>{
        e.preventDefault();if(saving)return;
        const from=q('nv26-from').value,to=q('nv26-to').value,value=cents(q('nv26-transfer-amount').value),date=q('nv26-transfer-date').value;
        if(!isDate(date)||date>today()||!valid(value)||value<=0||!from||!to||from===to)return alert('Controlla data, importo e posizioni.');
        if(value>(cashLedger(date).get(from)||0))return alert('Il saldo della posizione di partenza non è sufficiente.');
        const [fromOwner,fromLocation]=from.split('::'),[toOwner,toLocation]=to.split('::');
        if(!own(fromOwner)||!own(toOwner)||!LOCATIONS.includes(fromLocation)||!LOCATIONS.includes(toLocation))return alert('Posizioni non valide.');
        saving=true;
        try{const now=isoNow();await putRecord({id:crypto.randomUUID(),type:'cost',
          data:{kind:'cash_transfer',title:'Spostamento '+fromLocation+' → '+toLocation,
            amount:value/100,date,from:fromOwner,to:toOwner,fromLocation,toLocation,
            navraFinance:true,notes:q('nv26-transfer-notes').value.trim()},created_at:now,updated_at:now,deleted_at:null});
          modal.close();await reload();if(typeof autoSync==='function')autoSync();}
        catch(err){alert('Impossibile salvare: '+err.message);}finally{saving=false;}
      });
    } else if(type==='adjust') {
      modal.innerHTML=`<form class="nv26-form" id="nv26-adjust-form"><h2>Rettifica saldo posizione</h2>
        <p class="nv26-warning">Usa questa funzione solo per correggere un saldo iniziale o una differenza verificata. Gli incassi delle vendite sono già registrati automaticamente: non inserirli due volte.</p>
        <div class="field"><label>Data</label><input id="nv26-adjust-date" type="date" max="${today()}" value="${today()}" required></div>
        <div class="field"><label>Posizione</label><select id="nv26-adjust-wallet">${walletOptions()}</select></div>
        <div class="field"><label>Tipo rettifica</label><select id="nv26-adjust-kind"><option value="cash_in">Aumento saldo</option><option value="cash_out">Riduzione saldo</option></select></div>
        <div class="field"><label>Importo (€)</label><input id="nv26-adjust-amount" type="number" inputmode="decimal" step="0.01" min="0.01" required></div>
        <div class="field"><label>Motivo</label><input id="nv26-adjust-notes" maxlength="180" required placeholder="Es. saldo iniziale Vinted verificato"></div>
        <div class="actions"><button class="btn" type="submit">Registra rettifica</button><button class="btn alt" type="button" data-nv26-close>Chiudi</button></div></form>`;
      const q=id=>modal.querySelector('#'+id);
      q('nv26-adjust-form').addEventListener('submit',async e=>{
        e.preventDefault();if(saving)return;
        const [person,loc]=q('nv26-adjust-wallet').value.split('::'),kind=q('nv26-adjust-kind').value;
        const value=cents(q('nv26-adjust-amount').value),date=q('nv26-adjust-date').value,note=q('nv26-adjust-notes').value.trim();
        if(!own(person)||!LOCATIONS.includes(loc)||!['cash_in','cash_out'].includes(kind)||!valid(value)||!value||!note||!isDate(date)||date>today())return alert('Compila i dati correttamente.');
        if(kind==='cash_out'&&value>(cashLedger(date).get(walletKey(person,loc))||0))return alert('La posizione non ha saldo sufficiente.');
        if(!confirm('Hai verificato che questo importo non sia già presente in Cassa?'))return;
        saving=true;
        try{const now=isoNow();await putRecord({id:crypto.randomUUID(),type:'cost',
          data:{kind,title:'Rettifica '+loc,amount:value/100,date,holder:person,location:loc,
            notes:note,navraFinance:true,autoFromWatch:false},created_at:now,updated_at:now,deleted_at:null});
          modal.close();await reload();if(typeof autoSync==='function')autoSync();}
        catch(err){alert('Salvataggio non riuscito: '+err.message);}finally{saving=false;}
      });
    }
    modal.querySelectorAll('[data-nv26-close]').forEach(b=>b.addEventListener('click',()=>modal.close()));
    modal.showModal();
  }

  async function voidSplit(id){
    const r=allSplits().find(x=>x.id===id),reversed=voidedIds();
    const offset=cents(r?.data?.compensated)||0;
    const needsReverse=offset && costs().some(x=>x.id==='profit-offset-'+id) && !costs().some(x=>x.id==='profit-offset-reversal-'+id);
    if(!r||(reversed.has(id)&&!needsReverse)||saving)return;
    if(!confirm('Stornare questa ripartizione? Le quote torneranno da ripartire e l’eventuale compensazione debiti sarà invertita. L’operazione resta nello storico.'))return;
    saving=true;
    try{
      const now=isoNow(),old=r.data||{};
      const voidId='profit-void-'+id;
      const oldVoided=costs().find(x=>x.id===voidId);
      if(!oldVoided)await putRecord({id:voidId,type:'cost',data:{kind:VOID,targetId:id,date:today(),title:'Storno '+(old.title||'ripartizione'),notes:'Operazione originale mantenuta nello storico'},created_at:now,updated_at:now,deleted_at:null});
      if(offset && costs().some(x=>x.id==='profit-offset-'+id)){
        const reverseId='profit-offset-reversal-'+id;
        if(!costs().some(x=>x.id===reverseId)) await putRecord({id:reverseId,type:'cost',data:{kind:'settlement',title:'Storno compensazione utili',category:'Storno compensazione',amount:Math.abs(offset)/100,
          paidBy:offset>0?'Oleg':'Stefano',shareStefano:0,date:today(),profitDistributionId:id,autoProfitOffset:true,
          notes:'Inverte la compensazione contabile della ripartizione stornata.'},created_at:now,updated_at:now,deleted_at:null});
      }
      await reload();if(typeof autoSync==='function')autoSync();
    }catch(err){alert('Storno incompleto: '+err.message+'. Sincronizza e controlla lo storico.');await reload();}
    finally{saving=false;}
  }
  async function voidReceipt(id) {
    const record=receipts().find(r=>r.id===id);
    if(!record||saving||splits().some(x=>x.data?.receiptId===id))return alert('Prima devi stornare le ripartizioni collegate a questo incasso.');
    if(!confirm('Stornare questo incasso registrato per ripartizione? Non cambierà il saldo di cassa.'))return;
    saving=true;
    try{const now=isoNow();await putRecord({id:'profit-receipt-void-'+id,type:'cost',data:{kind:RECEIPT_VOID,targetId:id,date:today(),title:'Storno incasso',notes:'Incasso originale conservato nello storico.'},created_at:now,updated_at:now,deleted_at:null});
      await reload();if(typeof autoSync==='function')autoSync();}
    catch(e){alert('Storno non riuscito: '+e.message);}finally{saving=false;}
  }
  // The existing Cassa editor does not know fromLocation/toLocation.
  // Protect v26 transfers from being inadvertently rewritten without their positions.
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-nv26-open],[data-nv26-receipt],[data-nv26-void],[data-nv26-void-receipt],[data-cash-edit],[data-cash-delete],[data-cost-edit],[data-cost-delete]');
    if(!button)return;
    if(button.matches('[data-nv26-open]')){e.preventDefault();e.stopPropagation();open(button.dataset.nv26Open);return;}
    if(button.matches('[data-nv26-receipt]')){e.preventDefault();e.stopPropagation();open('split',button.dataset.nv26Receipt);return;}
    if(button.matches('[data-nv26-void]')){e.preventDefault();e.stopPropagation();void voidSplit(button.dataset.nv26Void);return;}
    if(button.matches('[data-nv26-void-receipt]')){e.preventDefault();e.stopPropagation();void voidReceipt(button.dataset.nv26VoidReceipt);return;}
    if(button.matches('[data-cost-edit],[data-cost-delete]')){
      const id=button.getAttribute('data-cost-edit')||button.getAttribute('data-cost-delete');
      if(costs().some(r=>r.id===id&&r.data?.autoProfitOffset)){e.preventDefault();e.stopPropagation();alert('Questa compensazione è collegata a una ripartizione. Per correggerla, storna la ripartizione dal Riepilogo.');return;}
    }
    if(button.matches('[data-cash-edit],[data-cash-delete]')){
      const id=button.getAttribute('data-cash-edit')||button.getAttribute('data-cash-delete');
      if(costs().some(r=>r.id===id&&r.data?.navraFinance)){
        e.preventDefault();e.stopPropagation();alert('Questo movimento conserva le posizioni dei fondi. Per correggerlo registra uno spostamento inverso dalla Cassa per posizione.');
      }
    }
  },true);
  const previousRender=render;
  render=function(...args){const result=previousRender.apply(this,args);inject();return result;};
  inject();
  // Pure calculation interface for local tests and independent audit of the totals.
  window.NavraFinance=Object.freeze({calculateCash:cashLedger,calculateDebt:debtAt,earned,already,pending,cashAllocated,distribute,receiptLeft});
})();
