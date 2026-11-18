/* NAVRA · Vendite per categoria e ricerca (2026-11-18).
   Aggiungere come ultimo script defer in index.html.
   Non modifica record, Firebase, IndexedDB o vendite esistenti.
*/
'use strict';
(() => {
  if (typeof state === 'undefined' || typeof render !== 'function' || typeof eur !== 'function') return;

  const el = id => document.getElementById(id);
  const norm = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('it');
  const cents = value => Math.round((Number(value) || 0) * 100);
  const roundMoney = value => cents(value) / 100;
  const clean = value => (typeof esc === 'function' ? esc(value) : String(value ?? ''));
  let search = '';
  let chosenCategory = '';

  const alive = type => (state.records || []).filter(r => r.type === type && !r.deleted_at);
  const sales = () => alive('watch').filter(r => r.data?.status === 'Venduto')
    .sort((a,b) => (b.data?.saleDate || '').localeCompare(a.data?.saleDate || ''));
  const category = r => String(r.data?.category || 'Orologi').trim() || 'Orologi';
  const costs = () => alive('cost').filter(r => r.data?.kind === 'expense' && r.data?.watchId &&
    (r.data?.maintenance === true || (r.data?.category === 'Riparazione' && r.data?.autoFromWatch !== true)));
  const margins = () => {
    const maintenance = new Map();
    for (const c of costs()) maintenance.set(c.data.watchId, (maintenance.get(c.data.watchId) || 0) + cents(c.data.amount));
    const result = new Map();
    for (const r of sales()) {
      const d = r.data || {};
      // Allineato con Vendite: prezzo - acquisto - spedizione acquisto - commissioni - manutenzione.
      const base = roundMoney(roundMoney(d.salePrice) - roundMoney(d.purchase) -
        roundMoney(d.purchaseShipping) - roundMoney(d.fees));
      result.set(r.id, cents(base) - (maintenance.get(r.id) || 0));
    }
    return result;
  };
  const lookup = () => new Map(alive('lot').map(r => [r.id, r]));
  const matches = (r, terms, lotMap) => {
    if (!terms.length) return true;
    const d = r.data || {}, l = lotMap.get(d.lotId)?.data || {};
    const combined = [
      d.category || 'Orologi', d.brand, d.model, d.reference, d.serial, d.notes,
      d.condition, d.supplier, d.saleClient, d.salePlatform, d.saleMarket,
      d.soldBy, d.saleCollectedBy, d.saleDate, d.buyDate,
      l.name, l.title, l.description, l.notes, d.lotIndex
    ].map(x => String(x ?? '')).join(' ');
    const hay = norm(combined);
    return terms.every(term => hay.includes(term));
  };
  const getFiltered = () => {
    const terms = norm(search).split(/\s+/).filter(Boolean);
    const lots = lookup();
    return sales().filter(r => (!chosenCategory || norm(category(r)) === norm(chosenCategory)) && matches(r, terms, lots));
  };

  function totals(records, marginMap) {
    return records.reduce((a,r) => {
      a.count++;
      a.revenue += cents(r.data?.salePrice);
      a.profit += marginMap.get(r.id) || 0;
      return a;
    }, {count:0,revenue:0,profit:0});
  }
  function viewBreakdown(records, marginMap) {
    const grouped = new Map();
    for (const r of records) {
      const cat = category(r), key = norm(cat);
      if (!grouped.has(key)) grouped.set(key, {name:cat,count:0,revenue:0,profit:0});
      const g = grouped.get(key);
      g.count++;
      g.revenue += cents(r.data?.salePrice);
      g.profit += marginMap.get(r.id) || 0;
    }
    return [...grouped.values()].sort((a,b)=>b.revenue-a.revenue || a.name.localeCompare(b.name,'it'));
  }

  const style = document.createElement('style');
  style.textContent = `
    #nv-sales-analytics{margin:14px 0 17px}
    #content .nv-tabs + section.panel .nv-line[hidden], #nv-sales-filter-empty[hidden]{display:none!important}
    #nv-sales-analytics h2{margin:0 0 12px;font-size:18px}
    #nv-sales-analytics .nv-search-row{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:9px}
    #nv-sales-analytics .nv-search-row .field{min-width:0}
    #nv-sales-analytics .nv-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:14px 0}
    #nv-sales-analytics .nv-summary>div{background:var(--paper);border:1px solid var(--line);border-radius:9px;padding:10px 12px;min-width:0}
    #nv-sales-analytics .nv-summary span{display:block;font-size:12px;color:var(--muted)}
    #nv-sales-analytics .nv-summary strong{display:block;margin-top:5px;font-size:19px;color:var(--dark);overflow-wrap:anywhere}
    #nv-sales-analytics .nv-cat-row{padding:11px 0;border-bottom:1px solid var(--line)}
    #nv-sales-analytics .nv-cat-row:last-child{border:0}
    #nv-sales-analytics .nv-cat-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
    #nv-sales-analytics .nv-cat-top strong{font-size:15px}
    #nv-sales-analytics .nv-cat-top small{color:var(--muted)}
    #nv-sales-analytics .nv-cat-amounts{display:flex;flex-wrap:wrap;column-gap:16px;row-gap:4px;font-size:13px;margin:5px 0 7px}
    #nv-sales-analytics .nv-cat-bar{height:5px;border-radius:6px;background:#e6e9e5;overflow:hidden}
    #nv-sales-analytics .nv-cat-bar i{display:block;height:100%;background:var(--gold);border-radius:6px}
    #nv-sales-analytics .nv-clear{margin-top:10px}
    @media(max-width:540px){#nv-sales-analytics .nv-search-row{grid-template-columns:1fr}
    #nv-sales-analytics .nv-summary strong{font-size:16px}
    #nv-sales-analytics .nv-summary>div{padding:9px}}
  `;
  document.head.appendChild(style);

  const previousRender = render;
  render = function () {
    previousRender();
    if (state.view !== 'sales' || (state.navraSalesTab || 'sales') !== 'sales') return;
    const content = el('content');
    const tabBar = content?.querySelector('.nv-tabs');
    if (!tabBar || el('nv-sales-analytics')) return;
    const categories = [...new Set(sales().map(category))].sort((a,b)=>a.localeCompare(b,'it'));
    const section = document.createElement('section');
    section.id = 'nv-sales-analytics';
    section.className = 'panel';
    section.innerHTML = `<h2>Fatturato per categoria e ricerca</h2>
      <div class="nv-search-row">
        <div class="field"><label for="nv-sales-search">Cerca nelle vendite</label>
          <input id="nv-sales-search" type="search" autocomplete="off" placeholder="Es. Cinturini, Vinted, Seiko, cliente…" value="${clean(search)}"></div>
        <div class="field"><label for="nv-sales-category">Categoria</label>
          <select id="nv-sales-category"><option value="">Tutte le categorie</option>
          ${categories.map(c=>`<option value="${clean(c)}"${norm(c)===norm(chosenCategory)?' selected':''}>${clean(c)}</option>`).join('')}</select></div>
      </div>
      <div class="nv-summary" aria-live="polite">
        <div><span>Articoli trovati</span><strong id="nv-filter-count">0</strong></div>
        <div><span>Incasso selezione</span><strong id="nv-filter-revenue">0,00 €</strong></div>
        <div><span>Utile selezione</span><strong id="nv-filter-profit">0,00 €</strong></div>
      </div>
      <div class="flex" style="justify-content:space-between;align-items:center">
        <strong>Dettaglio per categoria</strong>
        <button type="button" class="btn alt small nv-clear" id="nv-sales-reset">Azzera filtri</button>
      </div>
      <div id="nv-sales-breakdown"></div>
      <p class="hint">I totali cambiano con la ricerca e con la categoria. L'utile sottrae acquisto, spedizione acquisto, commissioni e manutenzioni collegate. Non include le spese generali non attribuite all'articolo.</p>`;
    tabBar.parentNode.insertBefore(section,tabBar);
    applyFilter();
  };

  function applyFilter() {
    const panel = el('nv-sales-analytics');
    if (!panel) return;
    const filtered = getFiltered();
    const ids = new Set(filtered.map(r => r.id));
    const marginMap = margins();
    const t = totals(filtered,marginMap);
    const count = el('nv-filter-count'),rev=el('nv-filter-revenue'),profit=el('nv-filter-profit');
    if (count) count.textContent = String(t.count);
    if (rev) rev.textContent = eur(t.revenue / 100);
    if (profit) profit.textContent = eur(t.profit / 100);
    const groups = viewBreakdown(filtered,marginMap),max = Math.max(1,...groups.map(g=>g.revenue));
    const breakdown=el('nv-sales-breakdown');
    if (breakdown) breakdown.innerHTML = groups.length ? groups.map(g=>
      `<div class="nv-cat-row"><div class="nv-cat-top"><strong>${clean(g.name)}</strong><small>${g.count} ${g.count===1?'articolo':'articoli'}</small></div>`+
      `<div class="nv-cat-amounts"><span>Fatturato: <strong>${clean(eur(g.revenue/100))}</strong></span><span>Utile: <strong>${clean(eur(g.profit/100))}</strong></span></div>`+
      `<div class="nv-cat-bar"><i style="width:${Math.max(0,Math.min(100,g.revenue/max*100)).toFixed(2)}%"></i></div></div>`
    ).join('') : '<p class="hint">Nessuna vendita corrisponde alla ricerca.</p>';
    const list = panel.parentElement?.querySelector('.nv-tabs + section.panel');
    if (list) {
      for (const row of list.querySelectorAll('.nv-line')) {
        const id = row.querySelector('[data-nv-sale-edit]')?.getAttribute('data-nv-sale-edit');
        if (id) row.hidden = !ids.has(id);
      }
      let empty = el('nv-sales-filter-empty');
      if (!empty) {
        empty = document.createElement('div'); empty.id='nv-sales-filter-empty';
        empty.className='empty'; empty.textContent='Nessuna vendita trovata con questi filtri.';
        list.appendChild(empty);
      }
      empty.hidden = filtered.length !== 0 || sales().length === 0;
    }
  }

  document.getElementById('content')?.addEventListener('input', event => {
    if (event.target.id === 'nv-sales-search') {
      search = event.target.value;
      applyFilter();
    }
  });
  document.getElementById('content')?.addEventListener('change', event => {
    if (event.target.id === 'nv-sales-category') {
      chosenCategory = event.target.value;
      applyFilter();
    }
  });
  document.getElementById('content')?.addEventListener('click', event => {
    if (event.target.closest('#nv-sales-reset')) {
      search=''; chosenCategory='';
      if (el('nv-sales-search')) el('nv-sales-search').value='';
      if (el('nv-sales-category')) el('nv-sales-category').value='';
      applyFilter();
    }
  });
})();
