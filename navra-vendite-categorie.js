/* NAVRA v23: dettaglio esplorabile Fatturato per categoria (sola UI).
 * Caricare dopo navra-bi-acquisti-vendite.js; non cambia database,
 * Firebase, ordini, prezzi, categorie o salvataggio delle vendite.
 */
'use strict';
(() => {
  if (typeof state === 'undefined' || typeof render !== 'function') return;
  const target = document.getElementById('content');
  if (!target) return;

  const norm = value => String(value ?? '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('it');
  const safe = value => typeof esc === 'function' ? esc(String(value ?? '')) :
    String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cents = n => Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) : 0;
  const euro = n => (n / 100).toLocaleString('it-IT', {style:'currency',currency:'EUR'});
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value+'T12:00:00Z')) && new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
  const dateIt = date => validDate(date) ? `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(0,4)}` : 'Data non indicata';
  const active = type => (state.records || []).filter(r => r.type === type && !r.deleted_at);

  function getSales() {
    const year = document.getElementById('nv-bi-sales-year')?.value;
    const category = document.getElementById('nv-bi-sales-cat')?.value || '';
    const channel = document.getElementById('nv-bi-sales-channel')?.value || '';
    if (!year) return [];
    const maintenance = new Map();
    for (const r of active('cost')) {
      const d = r.data || {};
      if (d.kind !== 'expense' || !d.watchId) continue;
      if (d.maintenance !== true && !(d.category === 'Riparazione' && d.autoFromWatch !== true)) continue;
      maintenance.set(d.watchId, (maintenance.get(d.watchId) || 0) + cents(d.amount));
    }
    const lots = new Map(active('lot').map(r => [r.id, r]));
    return active('watch').filter(r => {
      const d = r.data || {};
      return d.status === 'Venduto' && validDate(d.saleDate) &&
        d.saleDate.startsWith(year+'-') &&
        (!category || d.category === category) &&
        (!channel || d.salePlatform === channel);
    }).map(r => {
      const d = r.data || {};
      const amount = cents(d.salePrice);
      return {id:r.id, category:d.category || 'Orologi',
        title:[d.brand,d.model].filter(Boolean).join(' ') || 'Articolo',
        date:d.saleDate, channel:d.salePlatform || 'Non indicato',
        client:d.saleClient || '', lot:lots.get(d.lotId)?.data?.name || '',
        amount, profit:amount - cents(d.purchase) - cents(d.purchaseShipping) -
          cents(d.fees) - (maintenance.get(r.id) || 0)};
    });
  }

  function inject() {
    if (state.view !== 'sales' || state.navraSalesTab !== 'bi') return;
    const panel = document.getElementById('nv-sales-bi');
    if (!panel || panel.querySelector('#nv-sales-category-drilldown')) return;
    const heading = [...panel.querySelectorAll('h3')]
      .find(h => h.textContent.trim().startsWith('Fatturato per categoria'));
    if (!heading) return;

    // Sostituisce solo le righe semplici delle categorie della BI, senza toccare
    // il resto della schermata (rotazione, mesi/giorni, filtri o riepiloghi).
    let next = heading.nextElementSibling;
    while (next && next.classList.contains('nv-bi-row')) {
      const old = next;
      next = next.nextElementSibling;
      old.remove();
    }

    const groups = new Map();
    for (const sale of getSales()) {
      const key = norm(sale.category);
      if (!groups.has(key)) groups.set(key, {name:sale.category, amount:0, profit:0, sales:[]});
      const g = groups.get(key);
      g.amount += sale.amount; g.profit += sale.profit; g.sales.push(sale);
    }
    const sorted = [...groups.values()].sort((a,b) => b.amount-a.amount || a.name.localeCompare(b.name,'it'));
    const fragment = document.createElement('div');
    fragment.id = 'nv-sales-category-drilldown';
    fragment.innerHTML = sorted.length ? sorted.map(group => {
      const sales = group.sales.sort((a,b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title,'it'));
      return `<details class="nv23-cat">
        <summary class="nv23-cat-summary"><span class="nv23-cat-head"><strong>${safe(group.name)}</strong><small>${sales.length} ${sales.length === 1 ? 'vendita' : 'vendite'}</small></span>
          <span class="nv23-cat-amount">${euro(group.amount)}<small>Utile ${euro(group.profit)}</small></span></summary>
        <div class="nv23-cat-body"><p class="hint">Tocca Apri vendita per visualizzare o modificare la registrazione originale.</p>
          ${sales.map(sale => `<div class="nv23-sale"><div class="nv23-sale-description"><strong>${safe(sale.title)}</strong>
          <small>${safe(dateIt(sale.date))} · ${safe(sale.channel)}${sale.client ? ' · '+safe(sale.client):''}</small>
          ${sale.lot ? `<small>Lotto: ${safe(sale.lot)}</small>` : ''}
          <small>Utile: ${euro(sale.profit)}</small></div>
          <div class="nv23-sale-right"><strong>${euro(sale.amount)}</strong>
          <button type="button" class="btn alt small" data-nv-sale-edit="${safe(sale.id)}">Apri vendita</button></div></div>`).join('')}
        </div></details>`;
    }).join('') : '<p class="hint">Nessuna vendita per i filtri selezionati.</p>';
    heading.insertAdjacentElement('afterend',fragment);
  }

  const style = document.createElement('style');
  style.textContent = `
  #nv-sales-category-drilldown{margin:8px 0 4px}
  .nv23-cat{border-bottom:1px solid var(--line);padding:0}
  .nv23-cat-summary{list-style:none;cursor:pointer;position:relative;padding:14px 22px 14px 0;display:flex;justify-content:space-between;gap:10px;align-items:center}
  .nv23-cat-summary::-webkit-details-marker{display:none}
  .nv23-cat-summary:after{content:'▸';position:absolute;right:2px;top:18px;color:var(--gold)}
  .nv23-cat[open]>.nv23-cat-summary:after{content:'▾'}
  .nv23-cat-head{min-width:0;flex:1}
  .nv23-cat-head strong,.nv23-cat-amount{display:block;font-size:15px;color:var(--dark)}
  .nv23-cat-head small,.nv23-cat-amount small{display:block;font-weight:400;font-size:12px;color:var(--muted);margin-top:5px}
  .nv23-cat-amount{text-align:right;white-space:nowrap}
  .nv23-cat-body{padding:8px 11px 10px;background:var(--paper);border-radius:9px;margin-bottom:12px}
  .nv23-cat-body>.hint{margin:2px 0 9px;font-size:12px}
  .nv23-sale{display:flex;justify-content:space-between;gap:10px;align-items:center;border-top:1px solid var(--line);padding:13px 0}
  .nv23-sale-description{min-width:0;flex:1;overflow-wrap:anywhere}
  .nv23-sale-description strong{font-size:14px}
  .nv23-sale-description small{display:block;margin-top:4px;color:var(--muted);font-size:12px}
  .nv23-sale-right{display:flex;flex-direction:column;align-items:flex-end;gap:9px;flex:none;white-space:nowrap}
  .nv23-sale-right strong{font-size:14px}
  .nv23-sale-right .btn{font-size:12px}
  @media(max-width:400px){.nv23-cat-summary{gap:6px}.nv23-sale{align-items:start}.nv23-sale-right .btn{padding:8px}}
  `;
  document.head.appendChild(style);

  const previousRender = render;
  render = function (...args) { const result = previousRender.apply(this,args); inject(); return result; };
  // La BI v22 aggiorna il contenuto con change() senza richiamare render().
  // Questa callback viene registrata dopo la sua, e aggiorna il dettaglio coerentemente.
  target.addEventListener('change', e => {
    if (['nv-bi-sales-year','nv-bi-sales-cat','nv-bi-sales-channel'].includes(e.target.id)) inject();
  });
  inject();
})();
