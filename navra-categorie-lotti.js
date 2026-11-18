/* NAVRA: categoria del lotto e applicazione controllata agli articoli, 2026-11.
 * Caricare DOPO navra-lotti.js, navra-elimina-lotti.js e navra-vendite-analisi.js.
 * Non migra né elimina dati. Prezzi, quantità, quote e vendite rimangono invariati.
 */
'use strict';
(() => {
  if (typeof state === 'undefined' || typeof render !== 'function' ||
      typeof putRecord !== 'function' || typeof reload !== 'function') return;

  const dialog = document.getElementById('navra-lot-dialog');
  const form = document.getElementById('navra-lot-form');
  const nameField = document.getElementById('nl-name')?.closest('.field');
  if (!dialog || !form || !nameField || document.getElementById('nl-category')) return;

  const standardCategories = ['Orologi', 'Cinturini', 'Borse', 'Occhiali', 'Accessori', 'Misto'];
  const getLot = id => state.records.find(r => r.type === 'lot' && !r.deleted_at && r.id === id);
  const watchesInLot = id => state.records.filter(r => r.type === 'watch' && !r.deleted_at && r.data?.lotId === id);
  const normalize = value => String(value ?? '').trim().slice(0, 100);
  const label = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uniqueCategories = () => [...new Set([
    ...standardCategories,
    ...state.records.filter(r => !r.deleted_at && ['lot','watch'].includes(r.type))
      .map(r => normalize(r.data?.category)).filter(Boolean)
  ])].sort((a,b) => a.localeCompare(b, 'it'));

  const field = document.createElement('div');
  field.className = 'field wide';
  field.innerHTML = '<label for="nl-category">Categoria del lotto *</label>'+
    '<input id="nl-category" list="nl-category-options" maxlength="100" required '+
    'placeholder="Orologi, Cinturini, Borse..." autocomplete="off">'+
    '<datalist id="nl-category-options"></datalist>'+
    '<small class="navra-lot-info">Ai nuovi articoli viene assegnata automaticamente. Per quelli già esistenti usa “Applica a tutti” dopo aver salvato.</small>';
  nameField.insertAdjacentElement('afterend', field);
  const catInput = field.querySelector('#nl-category');
  const options = field.querySelector('#nl-category-options');
  let requestedLotId = null;
  const newLotCategories = new Map();
  let applying = false;

  function fillCategory() {
    options.innerHTML = uniqueCategories().map(c => '<option value="'+label(c)+'"></option>').join('');
    const lot = getLot(requestedLotId);
    if (!lot) {catInput.value = 'Orologi'; return;}
    const existing = normalize(lot.data?.category);
    const childCats = [...new Set(watchesInLot(lot.id).map(w => normalize(w.data?.category) || 'Orologi'))];
    catInput.value = existing || (childCats.length === 1 ? childCats[0] : 'Misto');
  }

  // I pulsanti del lotto sono intercettati in capture da NAVRA: registriamo
  // l'ID prima che la finestra venga aperta. L'observer agisce dopo il riempimento dei campi.
  document.addEventListener('click', e => {
    const target = e.target.closest('[data-lot-action="create"],[data-lot-action="edit"]');
    if (!target) return;
    requestedLotId = target.dataset.lotAction === 'edit' ? target.dataset.lotId : null;
  }, true);
  new MutationObserver(() => {if(dialog.open) fillCategory();}).observe(dialog, {attributes:true,attributeFilter:['open']});

  // Integra il salvataggio corrente senza toccare il riparto dei costi.
  // Per un lotto nuovo la categoria passa anche alle schede generate.
  const previousPut = putRecord;
  putRecord = async function (record) {
    if (record?.type === 'lot' && dialog.open) {
      const category = normalize(catInput.value);
      if (!category) throw new Error('Inserisci una categoria del lotto.');
      const isNew = !getLot(record.id);
      if (isNew) newLotCategories.set(record.id, category);
      record = {...record, data:{...record.data, category}};
    } else if (record?.type === 'watch' && newLotCategories.has(record.data?.lotId) &&
               !state.records.some(r => r.id === record.id)) {
      record = {...record, data:{...record.data, category:newLotCategories.get(record.data.lotId)}};
    }
    return previousPut(record);
  };

  function addCategoryControls() {
    if (state.view !== 'lots') return;
    const content = document.getElementById('content');
    if (!content) return;
    const lotId = state.navraLotId;
    const lot = getLot(lotId);
    if (lot) {
      const group = content.querySelector('.navra-lot-controls');
      if (!group || group.querySelector('[data-nl-apply-category]')) return;
      const category = normalize(lot.data?.category) || 'Da definire';
      const count = watchesInLot(lot.id).length;
      const box = document.createElement('div');
      box.className = 'panel';
      box.style.marginTop = '12px';
      box.innerHTML = '<strong>Categoria del lotto: '+label(category)+'</strong>'+
        '<p class="navra-lot-info">Cambiare la categoria del lotto non modifica da solo gli articoli già catalogati.</p>'+
        '<button type="button" class="btn alt" data-nl-apply-category="'+label(lot.id)+'" '+
        ((!category || ['Da definire','Misto'].includes(category) || !count) ? 'disabled' : '') +
        '>Applica la categoria a tutti gli articoli ('+count+')</button>';
      group.insertAdjacentElement('afterend', box);
    } else {
      for (const btn of content.querySelectorAll('[data-lot-action="detail"]')) {
        const card = btn.closest('article.item');
        const item = getLot(btn.dataset.lotId);
        if (!card || !item || card.querySelector('.nl-lot-category')) continue;
        const info = card.querySelector('.minor');
        if (info) info.insertAdjacentHTML('afterend', '<div class="minor nl-lot-category">Categoria: '+
          label(normalize(item.data?.category) || 'Da definire')+'</div>');
      }
    }
  }

  const oldRender = render;
  render = function () { oldRender(); addCategoryControls(); };

  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-nl-apply-category]');
    if (!btn || applying) return;
    e.preventDefault();
    const lot = getLot(btn.dataset.nlApplyCategory);
    if (!lot) return;
    const category = normalize(lot.data?.category);
    if (!category || category === 'Misto') return alert('Scegli prima una categoria specifica dal pulsante Modifica lotto.');
    const articles = watchesInLot(lot.id);
    const changes = articles.filter(r => (normalize(r.data?.category) || 'Orologi') !== category);
    const sold = changes.filter(r => r.data?.status === 'Venduto').length;
    if (!changes.length) return alert('Tutti gli articoli hanno già questa categoria.');
    if (!confirm('Applicare la categoria "'+category+'" a '+changes.length+' articoli del lotto'+
       (sold ? ', inclusi '+sold+' già venduti' : '')+'? Le categorie precedenti dei singoli articoli saranno sostituite. Prezzi e vendite rimarranno invariati.')) return;
    applying = true;
    btn.disabled = true;
    try {
      for (const article of changes) {
        await putRecord({...article, data:{...article.data,category}, updated_at:new Date().toISOString()});
      }
      await reload();
      if (typeof autoSync === 'function') autoSync();
      alert('Categoria "'+category+'" applicata a '+changes.length+' articoli.');
    } catch (err) {
      alert('Aggiornamento non completato: '+err.message+'; puoi ripetere l’operazione sui rimanenti.');
    } finally { applying = false; }
  }, true);

  addCategoryControls();
})();
