/* NAVRA - Accorpa lotti nelle viste Stock e Spese, unifica Sincronizza e Impostazioni.
 * Solo interfaccia: nessuna scrittura o migrazione ai record salvati.
 * Da caricare dopo navra-organizzazione-vendite.js.
 */
'use strict';
(() => {
  if (typeof render !== 'function' || typeof state === 'undefined' ||
      typeof renderList !== 'function' || typeof filteredRecords !== 'function') return;

  const safe = v => esc(v ?? '');
  const cents = v => Math.round((Number(v) || 0) * 100);
  const price = v => eur(v / 100);
  const people = ['Stefano', 'Oleg'];
  const lotRecords = () => new Map(state.records.filter(r => r.type === 'lot' && !r.deleted_at).map(r => [r.id, r]));
  const watchRecords = () => new Map(state.records.filter(r => r.type === 'watch' && !r.deleted_at).map(r => [r.id, r]));
  const expenses = () => new Map(state.records.filter(r => r.type === 'cost' && !r.deleted_at).map(r => [r.id, r]));
  const stockOpened = new Set();
  const expenseOpened = new Set();
  let stockGrouped = false;
  let expensesGrouped = false;
  let syncTab = 'sync';

  // Non si tocca la configurazione né il backup: la pagina originale rimane disponibile.
  const nav = document.getElementById('nav');
  const settingsButton = nav?.querySelector('[data-view="settings"]');
  settingsButton?.remove();
  const syncButton = nav?.querySelector('[data-view="sync"]');
  if (syncButton) syncButton.textContent = 'Sincronizza e impostazioni';

  const style = document.createElement('style');
  style.textContent = `
    .nv-accorpa-controls {display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin:13px 0 16px}
    .nv-accorpa-toggle {display:inline-flex;gap:8px;align-items:center;border:1px solid #bdc8c2;
      border-radius:10px;padding:10px 14px;background:white;color:var(--dark);font-weight:700}
    .nv-accorpa-toggle[aria-pressed="true"] {background:var(--dark);color:#fff;border-color:var(--dark)}
    .nv-accorpa-controls .hint {margin:0;font-size:12px}
    .nv-accorpa-group {background:#fff;border:1px solid var(--line);border-radius:14px;margin-bottom:12px;overflow:hidden}
    .nv-accorpa-group > summary {cursor:pointer;list-style:none;padding:16px;display:flex;
      justify-content:space-between;align-items:center;gap:12px}
    .nv-accorpa-group > summary::-webkit-details-marker{display:none}
    .nv-accorpa-group > summary strong{display:block;overflow-wrap:anywhere}
    .nv-accorpa-group > summary small{display:block;color:var(--muted);font-size:12px;margin-top:5px}
    .nv-accorpa-group .nv-accorpa-arrow{font-size:20px;color:var(--muted);flex:0 0 auto}
    .nv-accorpa-group[open] .nv-accorpa-arrow{transform:rotate(180deg)}
    .nv-accorpa-inner{padding:0 12px 12px;border-top:1px solid var(--line)}
    .nv-accorpa-inner .list{margin-top:12px}
    .nv-accorpa-inner .item{border-radius:10px}
    .nv-accorpa-inner .navra-costs-line{padding:13px 5px}
    .nv-accorpa-standalone{padding:0 2px}
    .nv-settings-tabs{margin-bottom:16px}
  `;
  document.head.appendChild(style);

  function toggleButton(kind, enabled) {
    return '<div class="nv-accorpa-controls"><button type="button" class="nv-accorpa-toggle" '+
      'data-nv-group-toggle="'+kind+'" aria-pressed="'+enabled+'">'+
      (enabled ? '✓ Lotti accorpati' : 'Accorpa lotti')+'</button>'+
      '<p class="hint">'+(enabled ? 'Tocca un lotto per vedere i singoli articoli.' : 'Raggruppa gli articoli dello stesso lotto senza cambiare i dati.')+'</p></div>';
  }

  function groupDetails(id, heading, description, open) {
    const details = document.createElement('details');
    details.className = 'nv-accorpa-group';
    details.dataset.nvGroupKey = id;
    details.open = open;
    details.innerHTML = '<summary><span><strong>'+safe(heading)+'</strong><small>'+safe(description)+
      '</small></span><span class="nv-accorpa-arrow" aria-hidden="true">⌄</span></summary><div class="nv-accorpa-inner"></div>';
    return details;
  }

  function applyStockGroups() {
    const list = document.getElementById('record-list');
    if (!list || state.view !== 'watch' || !stockGrouped) return;
    const rows = filteredRecords('watch'); // Rispetta ricerca, lotto, categoria ed esclusione dei venduti.
    if (!rows.length) return; // Mantiene il messaggio originale "Nessun risultato".
    const lots = lotRecords();
    const grouped = new Map();
    for (const item of rows) {
      const id = item.data?.lotId && lots.has(item.data.lotId) ? item.data.lotId : '';
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(item);
    }
    list.replaceChildren();
    for (const [id, items] of grouped) {
      const total = items.reduce((sum, r) => sum+cents(r.data?.purchase)+cents(r.data?.purchaseShipping),0);
      const payers = [...new Set(items.map(r => r.data?.purchaseBy).filter(v => people.includes(v)))];
      const payerText = payers.length === 1 ? 'Pagato da '+payers[0] :
        payers.length > 1 ? 'Pagamenti misti' : 'Pagatore non indicato';
      const heading = id ? lots.get(id)?.data?.name || 'Lotto senza nome' : 'Articoli senza lotto';
      const description = items.length+' articol'+(items.length===1?'o':'i')+
        ' in stock · Valore '+price(total)+' · '+payerText;
      const details = groupDetails(id || 'senza-lotto', heading, description, stockOpened.has(id || 'senza-lotto'));
      const content = details.querySelector('.nv-accorpa-inner');
      const grid = document.createElement('div'); grid.className = 'list';
      grid.innerHTML = items.map(recordCard).join('');
      content.appendChild(grid);
      list.appendChild(details);
    }
  }

  // Il filtro di ricerca della versione precedente chiama renderList direttamente.
  const previousRenderList = renderList;
  renderList = function() {
    previousRenderList();
    applyStockGroups();
  };

  function applyExpenseGroups() {
    const panel = [...document.querySelectorAll('#content section.panel')]
      .find(p => [...p.querySelectorAll('h2')].some(h => h.textContent?.trim() === 'Storico movimenti'));
    if (!panel || !expensesGrouped) return;
    const rows = [...panel.querySelectorAll('.navra-costs-line')];
    if (!rows.length) return;
    const lots = lotRecords(), watches = watchRecords(), ledger = expenses();
    const grouped = new Map();
    const layout = [];
    for (const row of rows) {
      const id = row.querySelector('[data-cost-delete]')?.dataset.costDelete;
      const record = ledger.get(id);
      const lotId = record?.data?.kind === 'expense' && record.data?.autoFromWatch &&
        record.data?.watchId ? watches.get(record.data.watchId)?.data?.lotId : null;
      if (lotId && lots.has(lotId)) {
        if (!grouped.has(lotId)) { grouped.set(lotId, []); layout.push({kind:'lot',id:lotId}); }
        grouped.get(lotId).push({record,row});
      } else layout.push({kind:'single',row});
    }
    const host = document.createElement('div'); host.className = 'nv-accorpa-expenses';
    for (const entry of layout) {
      if (entry.kind === 'single') {
        const line = document.createElement('div'); line.className='nv-accorpa-standalone';
        line.appendChild(entry.row); host.appendChild(line); continue;
      }
      const group = grouped.get(entry.id);
      const total = group.reduce((sum, x) => sum+cents(x.record.data?.amount),0);
      const payers = [...new Set(group.map(x => x.record.data?.paidBy).filter(v => people.includes(v)))];
      const shares = [...new Set(group.map(x => String(x.record.data?.shareStefano ?? '')))];
      const payerLabel = payers.length===1 ? 'Pagato da '+payers[0] : 'Pagamenti misti';
      const shareLabel = shares.length===1 && shares[0]!=='' ? ' · Stefano '+shares[0]+'% / Oleg '+(100-Number(shares[0]))+'%' : '';
      const lotTitle = lots.get(entry.id)?.data?.name || 'Lotto';
      const details = groupDetails(entry.id,lotTitle,
        group.length+' moviment'+(group.length===1?'o':'i')+' · Totale '+price(total)+' · '+payerLabel+shareLabel,
        expenseOpened.has(entry.id));
      const container=details.querySelector('.nv-accorpa-inner');
      group.forEach(x=>container.appendChild(x.row));
      host.appendChild(details);
    }
    panel.appendChild(host);
  }

  function renderSyncTabs() {
    const content=document.getElementById('content');
    if (!content) return;
    if (syncTab === 'settings') {
      // Reuse original settings HTML and native save/import/export handlers.
      content.innerHTML = settingsView();
    }
    const tabs = '<div class="nv-tabs nv-settings-tabs">'+
      '<button type="button" data-nv-sync-tab="sync" class="'+(syncTab==='sync'?'active':'')+'">Sincronizzazione ed export</button>'+
      '<button type="button" data-nv-sync-tab="settings" class="'+(syncTab==='settings'?'active':'')+'">Impostazioni</button></div>';
    content.insertAdjacentHTML('afterbegin', tabs);
  }

  const previousRender = render;
  render = function() {
    if (state.view === 'settings') {state.view = 'sync'; syncTab = 'settings';}
    previousRender();
    const content = document.getElementById('content');
    if (!content) return;
    if (state.view === 'watch') {
      const list = document.getElementById('record-list');
      if (list) list.insertAdjacentHTML('beforebegin',toggleButton('stock',stockGrouped));
      applyStockGroups();
    }
    if (state.view === 'costs') {
      const panel = [...content.querySelectorAll('section.panel')]
        .find(p => [...p.querySelectorAll('h2')].some(h => h.textContent?.trim() === 'Storico movimenti'));
      if (panel) panel.insertAdjacentHTML('beforebegin',toggleButton('expenses',expensesGrouped));
      applyExpenseGroups();
    }
    if (state.view === 'sync') renderSyncTabs();
  };

  document.addEventListener('click', e => {
    const button = e.target.closest?.('[data-nv-group-toggle],[data-nv-sync-tab]');
    if (!button) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (button.dataset.nvGroupToggle === 'stock') stockGrouped = !stockGrouped;
    if (button.dataset.nvGroupToggle === 'expenses') expensesGrouped = !expensesGrouped;
    if (button.dataset.nvSyncTab) syncTab = button.dataset.nvSyncTab;
    render();
  }, true);
  document.addEventListener('toggle', e => {
    const details = e.target;
    if (!details?.matches?.('details[data-nv-group-key]')) return;
    const group = state.view === 'watch' ? stockOpened : state.view === 'costs' ? expenseOpened : null;
    if (!group) return;
    if (details.open) group.add(details.dataset.nvGroupKey);
    else group.delete(details.dataset.nvGroupKey);
  }, true);
})();
