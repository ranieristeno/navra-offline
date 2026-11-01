/* NAVRA upgrade v1.5 - Foto, Costi, Cassa, Beni, Excel.
   Caricare dopo app.js e firebase-adapter.js.
   Usa il database locale corrente e lo stesso backend Firebase. */

// ===== photo-addon.js =====
/* NAVRA: one compressed offline photo per watch. Compatible with app.js + firebase-adapter.js.
   Photo stays in the watch's IndexedDB record and synchronizes inside Firestore records.
   This intentionally does NOT use Firebase Storage or require a paid plan. */
'use strict';
(() => {
  const PHOTO_FIELD = 'photoDataUrl';
  const MAX_DATA_URL_CHARS = 145000; // About 109 KB of JPEG data, well below Firestore's 1 MiB document limit.
  const MIME_PREFIX = 'data:image/jpeg;base64,';
  const oldEditModal = editModal;
  const oldRecordCard = recordCard;
  let draft = null;
  let saving = false;

  function safePhoto(value) {
    return typeof value === 'string' && value.startsWith(MIME_PREFIX) &&
      value.length <= MAX_DATA_URL_CHARS ? value : '';
  }

  const style = document.createElement('style');
  style.textContent = `
    .navra-watch-thumb { width: 72px; height: 72px; flex: 0 0 72px;
      object-fit: cover; border-radius: 10px; background: #eef0ed; }
    .navra-photo-preview { max-height: 240px; max-width: 100%; width: auto;
      object-fit: contain; border: 1px solid #e4e7e3; border-radius: 12px;
      background: #f7f6f1; margin: 10px 0; }
    .navra-photo-preview[hidden] { display: none; }
    .navra-photo-note { font-size: 12px; color: #647377; margin: 8px 0; }
    .navra-photo-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .navra-photo-actions label { display: inline-block; padding: 10px 12px;
      border-radius: 9px; background: #ebefed; color: #233235; font-size: 14px;
      font-weight: 600; cursor: pointer; }
    .navra-photo-actions input { position: absolute; width: 1px; height: 1px;
      opacity: 0; overflow: hidden; pointer-events: none; }
    .navra-photo-actions button { border: 0; border-radius: 9px; padding: 10px 12px;
      background: #fff0ed; color: #a13828; font-size: 14px; }
    .navra-photo-status { color: #647377; font-size: 12px; min-height: 16px; }
  `;
  document.head.appendChild(style);

  recordCard = function (record) {
    const html = oldRecordCard(record);
    const photo = record.type === 'watch' ? safePhoto(record.data?.[PHOTO_FIELD]) : '';
    if (!photo) return html;
    return html.replace('<article class="item">',
      '<article class="item"><img class="navra-watch-thumb" loading="lazy" alt="Foto di ' +
      esc(recordTitle(record)) + '" src="' + photo + '">');
  };

  async function readImage(file) {
    if (!file || !file.type.startsWith('image/'))
      throw new Error('Seleziona una fotografia dalla fotocamera o dalla libreria.');
    if (file.size > 30 * 1024 * 1024)
      throw new Error('La foto originale è troppo grande (oltre 30 MB).');
    const blobUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error('Impossibile leggere la foto. Prova con JPG o PNG.'));
        candidate.src = blobUrl;
      });
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) throw new Error('Foto non valida.');
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('Compressione non supportata dal browser.');
      for (const maxSide of [960, 800, 680, 560, 440, 340]) {
        const scale = Math.min(1, maxSide / Math.max(w, h));
        canvas.width = Math.max(1, Math.round(w * scale));
        canvas.height = Math.max(1, Math.round(h * scale));
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.78, 0.66, 0.54, 0.42]) {
          const result = canvas.toDataURL('image/jpeg', quality);
          if (result.startsWith(MIME_PREFIX) && result.length <= MAX_DATA_URL_CHARS)
            return result;
        }
      }
      throw new Error('Impossibile comprimere questa foto. Prova con una diversa.');
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  function showPreview(value) {
    const img = document.getElementById('navra-photo-preview');
    if (!img) return;
    const valid = safePhoto(value);
    if (valid) { img.src = valid; img.hidden = false; }
    else { img.removeAttribute('src'); img.hidden = true; }
    const remove = document.getElementById('navra-photo-remove');
    if (remove) remove.hidden = !valid;
  }

  editModal = function (type, id) {
    oldEditModal(type, id);
    draft = null;
    if (type !== 'watch') return;
    const record = id ? state.records.find(r => r.id === id) : null;
    const previous = safePhoto(record?.data?.[PHOTO_FIELD]);
    draft = { value: previous, loading: false, version: 0 };
    const host = document.getElementById('form-fields');
    if (!host) return;
    const section = document.createElement('div');
    section.className = 'field wide';
    section.innerHTML = `
      <label for="navra-photo-file">Fotografia dell'orologio (massimo una)</label>
      <div class="navra-photo-actions">
        <label for="navra-photo-file">📷 Scatta o scegli foto</label>
        <input id="navra-photo-file" type="file" accept="image/*">
        <button type="button" id="navra-photo-remove">Rimuovi foto</button>
      </div>
      <img id="navra-photo-preview" class="navra-photo-preview" alt="Anteprima orologio" hidden>
      <div class="navra-photo-note">Compressa automaticamente (circa 110 KB al massimo). Disponibile offline e sincronizzata con l'altro socio.</div>
      <div class="navra-photo-status" id="navra-photo-status" role="status"></div>`;
    host.appendChild(section);
    showPreview(draft.value);
    const fileInput = section.querySelector('#navra-photo-file');
    const info = section.querySelector('#navra-photo-status');
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files?.[0];
      if (!file || !draft) return;
      const current = draft;
      const seq = ++current.version;
      current.loading = true;
      info.textContent = 'Compressione della foto...';
      try {
        const photo = await readImage(file);
        if (draft !== current || seq !== current.version) return;
        current.value = photo;
        showPreview(photo);
        info.textContent = 'Foto pronta. Premi Salva per registrarla.';
      } catch (e) {
        if (draft === current && seq === current.version) {
          info.textContent = e.message;
          fileInput.value = '';
        }
      } finally {
        if (draft === current && seq === current.version) current.loading = false;
      }
    });
    section.querySelector('#navra-photo-remove').addEventListener('click', () => {
      if (!draft) return;
      ++draft.version;
      draft.loading = false;
      draft.value = '';
      fileInput.value = '';
      showPreview('');
      info.textContent = 'Foto rimossa dalla scheda. Premi Salva per confermare.';
    });
  };

  // Capture the watch submission before app.js's existing handler.
  // Supplier, market and shipment forms continue to use their original handler.
  document.getElementById('record-form')?.addEventListener('submit', async event => {
    if (state.editing?.type !== 'watch') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (saving) return;
    if (draft?.loading) {
      document.getElementById('navra-photo-status').textContent = 'Attendi la fine della compressione prima di salvare.';
      return;
    }
    saving = true;
    try {
      const id = state.editing.id;
      const data = {};
      for (const [key, , kind] of SCHEMA.watch.fields) {
        const el = document.getElementById('f-' + key);
        data[key] = kind === 'number' ? num(el.value) : el.value.trim();
      }
      if (!data.status) data.status = 'Disponibile';
      if (draft?.value) data[PHOTO_FIELD] = draft.value;
      const old = id ? state.records.find(r => r.id === id) : null;
      const now = new Date().toISOString();
      const newRecord = {
        id: id || crypto.randomUUID(), type: 'watch', data,
        created_at: old?.created_at || now, updated_at: now, deleted_at: null
      };
      await putRecord(newRecord);
      document.getElementById('editor').close();
      state.search = '';
      draft = null;
      await reload();
      autoSync();
    } catch (e) {
      alert('Impossibile salvare l’orologio: ' + e.message);
    } finally { saving = false; }
  }, true);
})();

;

// ===== costs-addon.js =====
/* NAVRA 1.3: Costi condivisi e saldi tipo Splitwise.
   Si integra con app.js, firebase-adapter.js e, facoltativamente, photo-addon.js.
   Gli acquisti degli orologi diventano spese in automatico solo se si sceglie "Acquisto pagato da".
   Le spese restano nello storico anche quando la scheda orologio viene eliminata.
   Richiede che Firestore permetta anche il tipo 'cost'. */
'use strict';
(() => {
  const PEOPLE = ['Stefano', 'Oleg'];
  const COST_TYPE = 'cost';
  const COST_CATEGORIES = ['Acquisto orologio', 'Spedizione', 'Riparazione', 'Mercatino', 'Materiali', 'Trasferta', 'Altro'];
  const oldPutRecord = putRecord;
  const oldRender = render;
  const oldEditModal = editModal;
  const oldRecordCard = recordCard;
  let saving = false;
  let editId = null;

  const toCents = value => Math.round((Number(value) || 0) * 100);
  const fromCents = cents => cents / 100;
  const validPayer = value => PEOPLE.includes(value);
  const eurCost = cents => eur(fromCents(cents));
  const today = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };
  const safeText = value => esc(value ?? '');
  const watchName = r => [r?.data?.brand, r?.data?.model].filter(Boolean).join(' ') || 'Orologio';
  const aliveCosts = () => state.records.filter(r => r.type === COST_TYPE && !r.deleted_at && ['expense', 'settlement'].includes(r.data?.kind));
  const formatDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}` : '—';

  // Permette di importare correttamente i costi dai backup JSON già esistenti.
  if (!SCHEMA[COST_TYPE]) SCHEMA[COST_TYPE] = {title: 'Costo', plural: 'Costi', fields: []};
  if (!SCHEMA.watch.fields.some(f => f[0] === 'purchaseBy')) {
    SCHEMA.watch.fields.push(['purchaseBy', 'Acquisto pagato da', 'select', false, PEOPLE]);
    SCHEMA.watch.fields.push(['buyShareStefano', 'Quota acquisto Stefano (%)', 'number']);
  }

  // Collega automaticamente il costo dell'acquisto all'orologio, senza duplicati.
  // Quando un orologio viene cancellato, il movimento di denaro resta nello storico.
  // Identificativo deterministico: lo stesso acquisto non viene conteggiato due volte.
  putRecord = async function (record) {
    await oldPutRecord(record);
    if (record?.type !== 'watch' || record.deleted_at) return;
    const buyId = `watch-buy-${record.id}`;
    const existing = await reqPromise(db.transaction('records', 'readonly').objectStore('records').get(buyId));
    if (existing && existing.updated_at >= record.updated_at) return;
    const purchaseCents = toCents(record.data?.purchase) + toCents(record.data?.purchaseShipping);
    const payer = record.data?.purchaseBy;
    // Una riga esistente può essere annullata se l'acquisto è corretto a zero.
    if (!validPayer(payer) && !existing) return;
    if (purchaseCents <= 0 && !existing) return;
    const split = record.data?.buyShareStefano === '' || record.data?.buyShareStefano == null
      ? 50 : Number(record.data.buyShareStefano);
    if (!Number.isFinite(split) || split < 0 || split > 100) return;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(record.data?.buyDate || '') ? record.data.buyDate : today();
    const purchase = {
      id: buyId, type: COST_TYPE,
      data: {
        kind: 'expense', category: 'Acquisto orologio',
        title: watchName(record), amount: fromCents(purchaseCents),
        paidBy: payer, shareStefano: split, date,
        watchId: record.id, autoFromWatch: true,
        notes: 'Acquisto e spese di acquisto dalla scheda orologio'
      },
      created_at: existing?.created_at || record.created_at || record.updated_at,
      updated_at: record.updated_at,
      deleted_at: purchaseCents > 0 && validPayer(payer) ? null : record.updated_at
    };
    await oldPutRecord(purchase);
  };

  // Aggiunta al menu NAVRA, senza modificare app.js.
  const nav = document.getElementById('nav');
  if (nav && !nav.querySelector('[data-view="costs"]')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-view', 'costs');
    btn.textContent = 'Costi';
    nav.insertBefore(btn, nav.querySelector('[data-view="sync"]'));
  }

  const css = document.createElement('style');
  css.textContent = `
    .navra-costs-summary {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .navra-costs-summary .metric {min-width:0}
    .navra-costs-summary .num {font-size:19px;overflow-wrap:anywhere}
    .navra-costs-amount {font-size:18px;font-weight:700;white-space:nowrap}
    .navra-costs-line {display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:13px 0;border-bottom:1px solid var(--line)}
    .navra-costs-line:last-child{border:0}
    .navra-costs-line p{font-size:12px;color:var(--muted);margin:4px 0 0}
    .navra-costs-line .btn{margin-top:7px}
    .navra-costs-options {display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}
    .navra-cost-dialog {border:0;border-radius:16px;padding:20px;width:calc(100% - 24px);max-width:530px;max-height:90vh;overflow:auto}
    .navra-cost-dialog::backdrop {background:#17282daa}
    .navra-cost-dialog .field {margin-top:11px}
    .navra-cost-hint {font-size:12px;color:var(--muted);line-height:1.5}
    .navra-costs-balance {font-size:20px;font-weight:700;color:var(--dark)}
    .navra-cost-danger {background:#fff0ed;color:#a13828;border:0;border-radius:8px;padding:8px 12px;font-size:13px}
    .navra-watch-delete {background:#fff0ed;color:#a13828!important;margin-left:5px}
    @media (max-width:420px){.navra-costs-summary{grid-template-columns:1fr 1fr}}
  `;
  document.head.appendChild(css);

  function calcBalance(records) {
    let balance = 0, totalExpenses = 0, expenses = 0, settlements = 0;
    for (const r of records) {
      const d = r.data || {};
      const cents = toCents(d.amount);
      if (!Number.isSafeInteger(cents) || cents <= 0 || !validPayer(d.paidBy)) continue;
      if (d.kind === 'settlement') {
        balance += d.paidBy === 'Stefano' ? -cents : cents;
        settlements++;
      } else if (d.kind === 'expense') {
        const share = Number(d.shareStefano);
        if (!Number.isFinite(share) || share < 0 || share > 100) continue;
        balance += Math.round(cents * share / 100) - (d.paidBy === 'Stefano' ? cents : 0);
        totalExpenses += cents;
        expenses++;
      }
    }
    return { balance, totalExpenses, expenses, settlements };
  }

  function costsPage() {
    const records = aliveCosts().sort((a,b) => (b.data?.date || '').localeCompare(a.data?.date || '') || b.updated_at.localeCompare(a.updated_at));
    const s = calcBalance(records);
    const debtLabel = s.balance > 0
      ? `Stefano deve ${eurCost(s.balance)} a Oleg`
      : s.balance < 0
        ? `Oleg deve ${eurCost(-s.balance)} a Stefano`
        : 'Siete in pari: nessun rimborso dovuto';
    const ledger = records.length ? records.map(r => {
      const d = r.data || {}, amount = eurCost(toCents(d.amount));
      const isTransfer = d.kind === 'settlement';
      const isAuto = !!d.autoFromWatch;
      const sub = isTransfer ? `${safeText(d.paidBy)} ha rimborsato ${d.paidBy === 'Stefano' ? 'Oleg' : 'Stefano'}` :
        `Pagato da ${safeText(d.paidBy)} · Stefano ${safeText(d.shareStefano)}% / Oleg ${safeText(100 - Number(d.shareStefano))}%`;
      const title = isTransfer ? 'Rimborso tra soci' : d.title || d.category || 'Spesa';
      return `<div class="navra-costs-line"><div style="min-width:0;flex:1"><strong>${safeText(title)}</strong>
        <p>${safeText(formatDate(d.date))} · ${isTransfer ? 'Rimborso' : safeText(d.category || 'Spesa')}</p><p>${sub}</p>
        ${d.notes ? `<p>${safeText(d.notes)}</p>` : ''}
        ${isAuto ? '<p>Collegato alla scheda orologio. Per cambiare importo o quote, modifica quella scheda.</p>' : ''}
        </div><div style="text-align:right"><div class="navra-costs-amount">${safeText(amount)}</div>
        ${!isAuto ? `<button class="btn alt small" type="button" data-cost-edit="${safeText(r.id)}">Modifica</button>` : ''}
        <button class="navra-cost-danger" type="button" data-cost-delete="${safeText(r.id)}">Elimina</button>
        </div></div>`;
    }).join('') : '<div class="empty">Nessuna spesa registrata. Inserisci una spesa oppure indica chi ha pagato l’acquisto in una scheda orologio.</div>';
    return `<div class="head"><h1>Costi condivisi</h1></div>
      <div class="navra-costs-summary">
        <div class="metric"><div class="label">Spese registrate</div><div class="num">${safeText(eurCost(s.totalExpenses))}</div></div>
        <div class="metric"><div class="label">Movimenti</div><div class="num">${s.expenses} spese · ${s.settlements} rimborsi</div></div>
      </div>
      <section class="panel" style="margin-top:13px"><div class="label">Saldo tra i soci</div>
        <p class="navra-costs-balance">${safeText(debtLabel)}</p>
        <p class="navra-cost-hint">Ogni spesa è divisa secondo le quote indicate. Chi paga anticipa tutto; i rimborsi già effettuati riducono il debito.</p></section>
      <div class="navra-costs-options">
        <button class="btn" type="button" data-cost-new="expense">+ Aggiungi spesa</button>
        <button class="btn alt" type="button" data-cost-new="settlement">+ Registra rimborso</button>
      </div>
      <section class="panel"><h2 style="margin-top:0">Storico movimenti</h2>${ledger}</section>
      <p class="navra-cost-hint">Gli acquisti registrati nelle schede Orologi entrano nei Costi quando selezioni “Acquisto pagato da”. Non inserirli anche come spesa manuale, per non contarli due volte. I costi restano nello storico anche se elimini una scheda orologio. I dati sono salvati offline e sincronizzati con Oleg quando possibile.</p>`;
  }

  render = function () {
    oldRender();
    if (state.view === 'costs') document.getElementById('content').innerHTML = costsPage();
  };

  // Aggiunge il comando Elimina direttamente sulle schede orologio.
  recordCard = function (r) {
    const html = oldRecordCard(r);
    if (r.type !== 'watch') return html;
    return html.replace('</article>', `<button type="button" class="btn alt small navra-watch-delete" data-watch-delete="${safeText(r.id)}">Elimina</button></article>`);
  };

  editModal = function (type, id) {
    oldEditModal(type, id);
    if (type !== 'watch') return;
    const split = document.getElementById('f-buyShareStefano');
    if (split) {
      const old = id ? state.records.find(r => r.id === id) : null;
      if (old?.data?.buyShareStefano == null || old?.data?.buyShareStefano === '') split.value = '50';
      split.min = '0'; split.max = '100'; split.step = '1';
    }
    const who = document.getElementById('f-purchaseBy');
    if (who) who.setAttribute('aria-label', 'Chi ha pagato l’acquisto dell’orologio');
    const info = document.createElement('p');
    info.className = 'field wide navra-cost-hint';
    info.textContent = 'Se scegli chi ha pagato e inserisci un prezzo di acquisto, NAVRA aggiungerà automaticamente la spesa nei Costi. Le altre spese si inseriscono in Costi.';
    document.getElementById('form-fields')?.appendChild(info);
  };

  const dialog = document.createElement('dialog');
  dialog.id = 'navra-cost-dialog'; dialog.className = 'navra-cost-dialog';
  dialog.innerHTML = `<form id="navra-cost-form">
    <h2 id="navra-cost-title">Nuova spesa</h2>
    <div class="field"><label for="navra-cost-kind">Tipo movimento</label>
      <select id="navra-cost-kind"><option value="expense">Spesa</option><option value="settlement">Rimborso</option></select></div>
    <div class="field" id="navra-cost-description-group"><label for="navra-cost-description">Descrizione</label>
      <input id="navra-cost-description" maxlength="120" placeholder="Es. Spedizione 20 orologi"></div>
    <div class="field" id="navra-cost-category-group"><label for="navra-cost-category">Categoria</label>
      <select id="navra-cost-category">${COST_CATEGORIES.map(c => `<option>${safeText(c)}</option>`).join('')}</select></div>
    <div class="field"><label for="navra-cost-amount">Importo (€)</label>
      <input id="navra-cost-amount" type="number" inputmode="decimal" step="0.01" min="0.01" required></div>
    <div class="field"><label for="navra-cost-date">Data</label><input id="navra-cost-date" type="date" required></div>
    <div class="field"><label id="navra-cost-paid-label" for="navra-cost-paid">Chi ha pagato?</label>
      <select id="navra-cost-paid"><option value="Stefano">Stefano</option><option value="Oleg">Oleg</option></select></div>
    <div class="field" id="navra-cost-split-group"><label for="navra-cost-share">Quota a carico di Stefano (%)</label>
      <input id="navra-cost-share" type="number" min="0" max="100" step="1" value="50" required>
      <p class="navra-cost-hint">Esempio: 50% = metà ciascuno; 30% = Stefano 30% e Oleg 70%.</p></div>
    <div class="field" id="navra-cost-watch-group"><label for="navra-cost-watch">Orologio collegato (facoltativo)</label>
      <select id="navra-cost-watch"><option value="">Nessuno</option></select></div>
    <div class="field"><label for="navra-cost-notes">Note</label><textarea id="navra-cost-notes" rows="2" maxlength="500"></textarea></div>
    <div class="actions"><button type="submit" class="btn">Salva</button>
      <button type="button" class="btn alt" id="navra-cost-cancel">Annulla</button></div>
    </form>`;
  document.body.appendChild(dialog);
  const getEl = id => document.getElementById(id);
  const getVal = id => getEl(id).value;
  const setVal = (id, value) => { getEl(id).value = value ?? ''; };

  function kindUi() {
    const isSettlement = getVal('navra-cost-kind') === 'settlement';
    ['navra-cost-description-group','navra-cost-category-group','navra-cost-split-group','navra-cost-watch-group']
      .forEach(id => getEl(id).classList.toggle('hidden', isSettlement));
    getEl('navra-cost-paid-label').textContent = isSettlement ? 'Chi sta rimborsando?' : 'Chi ha pagato?';
    getEl('navra-cost-title').textContent = isSettlement ? 'Rimborso tra soci' : 'Spesa condivisa';
  }
  getEl('navra-cost-kind').addEventListener('change',kindUi);
  getEl('navra-cost-cancel').addEventListener('click', () => dialog.close());

  function openCost(kind = 'expense', record = null) {
    editId = record?.id || null;
    const d = record?.data || {};
    setVal('navra-cost-kind', d.kind || kind);
    getEl('navra-cost-kind').disabled = !!record;
    setVal('navra-cost-description', d.title || '');
    setVal('navra-cost-category', d.category || 'Altro');
    setVal('navra-cost-amount', d.amount || '');
    setVal('navra-cost-date', d.date || today());
    setVal('navra-cost-paid', d.paidBy || 'Stefano');
    setVal('navra-cost-share', d.shareStefano ?? 50);
    setVal('navra-cost-notes', d.notes || '');
    const sel = getEl('navra-cost-watch');
    sel.innerHTML = '<option value="">Nessuno</option>' +
      state.records.filter(r => r.type === 'watch').map(r => `<option value="${safeText(r.id)}">${safeText(watchName(r))}</option>`).join('');
    setVal('navra-cost-watch', d.watchId || '');
    kindUi(); dialog.showModal();
  }
  getEl('navra-cost-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    if (saving) return;
    const kind = getVal('navra-cost-kind');
    const cents = toCents(getVal('navra-cost-amount'));
    const share = Number(getVal('navra-cost-share'));
    if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10000000000) return alert('Inserisci un importo valido.');
    if (kind === 'expense' && (!Number.isFinite(share) || share < 0 || share > 100)) return alert('La quota di Stefano deve essere tra 0 e 100%.');
    const label = getVal('navra-cost-description').trim();
    if (kind === 'expense' && !label) return alert('Inserisci una descrizione della spesa.');
    saving = true;
    try {
      const old = editId ? state.records.find(r => r.id === editId) : null;
      const now = new Date().toISOString();
      const data = {
        kind,
        title: kind === 'settlement' ? 'Rimborso tra soci' : label,
        category: kind === 'settlement' ? 'Rimborso' : getVal('navra-cost-category'),
        amount: fromCents(cents), date: getVal('navra-cost-date'),
        paidBy: getVal('navra-cost-paid'),
        shareStefano: kind === 'settlement' ? 0 : share,
        watchId: kind === 'settlement' ? '' : getVal('navra-cost-watch'),
        notes: getVal('navra-cost-notes').trim(), autoFromWatch: false
      };
      await putRecord({
        id: editId || crypto.randomUUID(), type: COST_TYPE, data,
        created_at: old?.created_at || now, updated_at: now, deleted_at: null
      });
      dialog.close(); await reload(); autoSync();
    } catch (e) { alert('Impossibile salvare: ' + e.message); }
    finally { saving = false; }
  });

  document.getElementById('content')?.addEventListener('click', async e => {
    const add = e.target.closest('[data-cost-new]');
    if (add) { e.preventDefault(); openCost(add.dataset.costNew); return; }
    const edit = e.target.closest('[data-cost-edit]');
    if (edit) { const r = aliveCosts().find(x => x.id === edit.dataset.costEdit); if (r && !r.data?.autoFromWatch) openCost(r.data.kind, r); return; }
    const del = e.target.closest('[data-cost-delete]');
    if (del) {
      const r = aliveCosts().find(x => x.id === del.dataset.costDelete);
      if (!r) return;
      if (r.data?.autoFromWatch && state.records.some(w => w.type === 'watch' && w.id === r.data.watchId)) {
        alert('Questa spesa deriva da un orologio ancora presente. Per correggerla modifica prezzo, quota o pagatore nella scheda Orologi.'); return;
      }
      if (!confirm('Eliminare questo movimento dai Costi di entrambi i soci?')) return;
      const now = new Date().toISOString();
      await putRecord({...r, deleted_at: now, updated_at: now});
      await reload(); autoSync(); return;
    }
    const watchDel = e.target.closest('[data-watch-delete]');
    if (watchDel) {
      const r = state.records.find(x => x.type === 'watch' && x.id === watchDel.dataset.watchDelete);
      if (!r || !confirm(`Eliminare la scheda ${watchName(r)} da entrambi i telefoni? Le spese pagate restano nello storico Costi.`)) return;
      const now = new Date().toISOString();
      await putRecord({...r, deleted_at: now, updated_at: now});
      await reload(); autoSync();
    }
  }, true);

  // Consente il test del calcolo senza accedere a Firebase e senza modificare i dati.
  window.NavraCosts = Object.freeze({calculate: calcBalance});
})();

;

// ===== cassa-addon.js =====
/* NAVRA v1.4 - Cassa soci: who bought a watch, who received a sale, and who physically holds cash.
   Add after app.js, firebase-adapter.js, photo-addon.js, costs-addon.js.
   Uses existing Firestore cost record type. Does not change existing IndexedDB schema.
   Cash custody is separate from Splitwise debts and separate from profit. */
'use strict';
(() => {
  const PEOPLE = ['Stefano', 'Oleg'];
  const MONEY_KINDS = ['cash_in', 'cash_out', 'cash_transfer', 'sale_receipt'];
  const previousPutRecord = putRecord;
  const previousRender = render;
  const previousRecordCard = recordCard;
  const previousEditModal = editModal;
  let editingId = null;
  let saving = false;

  const cents = x => Math.round((Number(x) || 0) * 100);
  const euros = x => eur(x / 100);
  const personOK = p => PEOPLE.includes(p);
  const safe = x => esc(x ?? '');
  const watchTitle = r => [r?.data?.brand, r?.data?.model].filter(Boolean).join(' ') || 'Orologio';
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10); };
  const dateText = x => /^\d{4}-\d{2}-\d{2}$/.test(x || '') ? x.slice(8,10)+'/'+x.slice(5,7)+'/'+x.slice(0,4) : '—';
  const cashRecords = () => state.records.filter(x => x.type === 'cost' && !x.deleted_at && MONEY_KINDS.includes(x.data?.kind));

  if (!SCHEMA.cost) SCHEMA.cost = {title:'Costo', plural:'Costi',fields:[]};
  if (!SCHEMA.watch.fields.some(f => f[0] === 'boughtBy'))
    SCHEMA.watch.fields.push(['boughtBy','Acquisto effettuato da','select',false, PEOPLE]);
  if (!SCHEMA.watch.fields.some(f => f[0] === 'saleCollectedBy'))
    SCHEMA.watch.fields.push(['saleCollectedBy','Incasso vendita ricevuto da','select',false, PEOPLE]);

  // Store automatic sale receipt with a deterministic ID, to prevent double-counting.
  // Never infer who holds a sale payment: only post when user has explicitly selected it.
  putRecord = async function (record) {
    await previousPutRecord(record);
    if (record?.type !== 'watch' || record.deleted_at) return;
    const receiptId = `watch-sale-${record.id}`;
    const found = await reqPromise(db.transaction('records','readonly').objectStore('records').get(receiptId));
    if (found && found.updated_at >= record.updated_at) return;
    const amount = cents(record.data?.salePrice);
    const eligible = record.data?.status === 'Venduto' && amount > 0 && personOK(record.data?.saleCollectedBy);
    if (!eligible && !found) return;
    const data = {
      kind:'sale_receipt', title:'Vendita '+watchTitle(record), amount:eligible ? amount/100 : (found?.data?.amount||0),
      holder:record.data?.saleCollectedBy || found?.data?.holder || '',
      date:/^\d{4}-\d{2}-\d{2}$/.test(record.data?.saleDate||'') ? record.data.saleDate : today(),
      watchId:record.id, autoFromWatch:true,
      notes:'Incasso registrato automaticamente dalla scheda orologio'
    };
    await previousPutRecord({
      id:receiptId, type:'cost', data,
      created_at:found?.created_at || record.created_at || record.updated_at,
      updated_at:record.updated_at, deleted_at:eligible ? null : record.updated_at
    });
  };

  const nav = document.getElementById('nav');
  if (nav && !nav.querySelector('[data-view="cash"]')) {
    const btn=document.createElement('button'); btn.type='button'; btn.dataset.view='cash'; btn.textContent='Cassa';
    nav.insertBefore(btn,nav.querySelector('[data-view="sync"]'));
  }

  const style=document.createElement('style');
  style.textContent=`
    .navra-cash-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
    .navra-cash-summary .metric{min-width:0}
    .navra-cash-summary .num{font-size:20px;overflow-wrap:anywhere}
    .navra-cash-summary .metric .label{font-weight:600}
    .navra-cash-line{border-bottom:1px solid var(--line);padding:13px 0;display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
    .navra-cash-line:last-child{border:0}
    .navra-cash-line .mini{color:var(--muted);font-size:12px;margin-top:4px}
    .navra-cash-line button{margin-top:8px}
    .navra-cash-actions{display:flex;gap:8px;flex-wrap:wrap;margin:16px 0}
    .navra-cash-hint{font-size:12px;line-height:1.5;color:var(--muted)}
    .navra-cash-dialog{border:0;border-radius:16px;padding:20px;width:calc(100% - 26px);max-width:530px;max-height:90vh;overflow:auto}
    .navra-cash-dialog::backdrop{background:#16282daa}
    .navra-cash-dialog .field{margin-bottom:11px}
    .navra-cash-watch-info{font-size:11px;color:var(--muted);margin:2px 0 7px}
    .navra-cash-alert{color:#a13828}
  `;
  document.head.appendChild(style);

  function calculateCash(records) {
    const balances={Stefano:0,Oleg:0};
    let receipts=0, outgoings=0, transfers=0;
    for (const r of records) {
      if (r.deleted_at || r.type !== 'cost') continue;
      const d=r.data||{}, value=cents(d.amount);
      if (!Number.isSafeInteger(value) || value <= 0 || value > 100000000000) continue;
      if ((d.kind === 'cash_in' || d.kind === 'sale_receipt') && personOK(d.holder)) {
        balances[d.holder] += value; receipts += value;
      } else if (d.kind === 'cash_out' && personOK(d.holder)) {
        balances[d.holder] -= value; outgoings += value;
      } else if (d.kind === 'cash_transfer' && personOK(d.from) && personOK(d.to) && d.from !== d.to) {
        balances[d.from] -= value; balances[d.to] += value; transfers += value;
      }
    }
    return { ...balances, total:balances.Stefano + balances.Oleg, receipts, outgoings, transfers };
  }

  function cashPage() {
    const records=cashRecords().sort((a,b)=>(b.data?.date||'').localeCompare(a.data?.date||'')||b.updated_at.localeCompare(a.updated_at));
    const total=calculateCash(records);
    const lines=records.length ? records.map(r=>{
      const d=r.data||{};
      const text=d.kind==='cash_transfer'? `${safe(d.from)} → ${safe(d.to)}`:
        d.kind==='cash_out'?`Uscita da cassa di ${safe(d.holder)}`:
        d.kind==='sale_receipt'?`Vendita incassata da ${safe(d.holder)}`:`Entrata nella cassa di ${safe(d.holder)}`;
      const locked=!!d.autoFromWatch && state.records.some(w=>w.type==='watch' && w.id===d.watchId);
      return `<div class="navra-cash-line"><div style="flex:1;min-width:0"><strong>${safe(d.title || 'Movimento')}</strong>
        <div class="mini">${safe(dateText(d.date))} · ${text}</div>
        ${d.notes?`<div class="mini">${safe(d.notes)}</div>`:''}
        ${locked?'<div class="mini">Collegato a un orologio: modifica la scheda per correggere l’incasso.</div>':''}</div>
        <div style="text-align:right;white-space:nowrap"><strong>${safe(euros(cents(d.amount)))}</strong><div>
        ${!locked ? `<button class="btn alt small" data-cash-edit="${safe(r.id)}">Modifica</button>` : ''}
        ${!locked ? `<button class="btn alt small" data-cash-delete="${safe(r.id)}">Elimina</button>` : ''}
        </div></div></div>`;
    }).join('') : '<div class="empty">Ancora nessun incasso o movimento di cassa.</div>';
    const debts=total.Stefano<0 || total.Oleg<0 ? `<p class="navra-cash-hint navra-cash-alert">Attenzione: un saldo negativo indica che mancano incassi o versamenti oppure sono state registrate uscite superiori alla cassa disponibile.</p>`:'';
    return `<div class="head"><h1>Cassa soci</h1></div>
      <p class="navra-cash-hint">Mostra quanti soldi dell’attività sono materialmente in mano a ciascun socio. Non è il saldo debiti di Splitwise né l’utile da dividere.</p>
      <div class="navra-cash-summary">
        <div class="metric"><div class="label">In mano a Stefano</div><div class="num">${safe(euros(total.Stefano))}</div></div>
        <div class="metric"><div class="label">In mano a Oleg</div><div class="num">${safe(euros(total.Oleg))}</div></div>
        <div class="metric"><div class="label">Cassa totale</div><div class="num">${safe(euros(total.total))}</div></div>
        <div class="metric"><div class="label">Incassi/versamenti</div><div class="num">${safe(euros(total.receipts))}</div></div>
      </div>${debts}
      <div class="navra-cash-actions"><button class="btn" data-cash-add="cash_in">+ Entrata</button>
        <button class="btn alt" data-cash-add="cash_out">+ Uscita</button>
        <button class="btn alt" data-cash-add="cash_transfer">Trasferimento</button></div>
      <section class="panel"><h2 style="margin-top:0">Movimenti di cassa</h2>${lines}</section>
      <p class="navra-cash-hint">Quando vendi un orologio, imposta Stato «Venduto», Prezzo vendita e «Incasso vendita ricevuto da»: l’incasso apparirà qui automaticamente. Un pagamento di spesa con soldi personali non riduce questa cassa: registralo in Costi. Per i soldi già disponibili prima di usare NAVRA, crea una «Entrata» come saldo iniziale per ogni socio. Non registrare due volte gli stessi incassi.</p>`;
  }

  render=function(){ previousRender(); if(state.view==='cash') document.getElementById('content').innerHTML=cashPage(); };

  recordCard=function(r){
    const html=previousRecordCard(r);
    if(r.type!=='watch')return html;
    const payer=personOK(r.data?.purchaseBy)? `Pagato da ${safe(r.data.purchaseBy)}`:'';
    const buyer=personOK(r.data?.boughtBy)? `Comprato da ${safe(r.data.boughtBy)}`:'';
    const holder= r.data?.status==='Venduto' && personOK(r.data?.saleCollectedBy)?`Incassato da ${safe(r.data.saleCollectedBy)}`:'';
    const bits=[buyer,payer,holder].filter(Boolean);
    return bits.length?html.replace('</h3>',`</h3><div class="navra-cash-watch-info">${bits.join(' · ')}</div>`):html;
  };

  editModal=function(type,id){
    previousEditModal(type,id);
    if(type!=='watch')return;
    const holder=document.getElementById('f-saleCollectedBy');
    if(holder)holder.closest('.field')?.insertAdjacentHTML('beforeend',
      '<p class="navra-cash-hint">Compila soltanto quando lo stato è Venduto e sai chi ha ricevuto il denaro. L’incasso sarà registrato automaticamente in Cassa.</p>');
    const buyer=document.getElementById('f-boughtBy');
    if(buyer)buyer.closest('.field')?.insertAdjacentHTML('beforeend',
      '<p class="navra-cash-hint">Chi ha effettuato l’acquisto, anche se ha pagato l’altro socio.</p>');
  };

  const dialog=document.createElement('dialog');dialog.id='navra-cash-dialog';dialog.className='navra-cash-dialog';
  dialog.innerHTML=`<form id="navra-cash-form"><h2>Movimento di cassa</h2>
    <div class="field"><label for="navra-cash-kind">Tipo</label><select id="navra-cash-kind">
      <option value="cash_in">Entrata o saldo iniziale</option>
      <option value="cash_out">Uscita dalla cassa</option>
      <option value="cash_transfer">Trasferimento tra soci</option></select></div>
    <div class="field"><label for="navra-cash-title">Descrizione</label><input id="navra-cash-title" maxlength="120" placeholder="Es. Incasso mercatino Cherasco" required></div>
    <div class="field"><label for="navra-cash-amount">Importo (€)</label><input id="navra-cash-amount" type="number" inputmode="decimal" min="0.01" step="0.01" required></div>
    <div class="field"><label for="navra-cash-date">Data</label><input id="navra-cash-date" type="date" required></div>
    <div class="field" id="navra-cash-holder-group"><label id="navra-cash-holder-label" for="navra-cash-holder">Chi tiene / riceve i soldi?</label>
      <select id="navra-cash-holder"><option>Stefano</option><option>Oleg</option></select></div>
    <div class="field hidden" id="navra-cash-from-group"><label for="navra-cash-from">Da</label><select id="navra-cash-from"><option>Stefano</option><option>Oleg</option></select></div>
    <div class="field hidden" id="navra-cash-to-group"><label for="navra-cash-to">A</label><select id="navra-cash-to"><option>Oleg</option><option>Stefano</option></select></div>
    <div class="field"><label for="navra-cash-notes">Note</label><textarea id="navra-cash-notes" rows="2" maxlength="500"></textarea></div>
    <div class="actions"><button type="submit" class="btn">Salva</button><button id="navra-cash-cancel" type="button" class="btn alt">Annulla</button></div>
  </form>`;
  document.body.appendChild(dialog);
  const $id=id=>document.getElementById(id);
  const get=id=>$id(id).value;
  const set=(id,v)=>{$id(id).value=v??'';};
  function refreshKind(){
    const transfer=get('navra-cash-kind')==='cash_transfer';
    $id('navra-cash-holder-group').classList.toggle('hidden',transfer);
    $id('navra-cash-from-group').classList.toggle('hidden',!transfer);
    $id('navra-cash-to-group').classList.toggle('hidden',!transfer);
    $id('navra-cash-holder-label').textContent=get('navra-cash-kind')==='cash_out'?'Chi ha speso i soldi della cassa?':'Chi tiene / riceve i soldi?';
  }
  $id('navra-cash-kind').addEventListener('change',refreshKind);
  $id('navra-cash-cancel').addEventListener('click',()=>dialog.close());
  function openMovement(kind,record=null){
    editingId=record?.id||null;
    const d=record?.data||{};
    set('navra-cash-kind',d.kind||kind);$id('navra-cash-kind').disabled=!!record;
    set('navra-cash-title',d.title||'');set('navra-cash-amount',d.amount||'');set('navra-cash-date',d.date||today());
    set('navra-cash-holder',d.holder||'Stefano');set('navra-cash-from',d.from||'Stefano');set('navra-cash-to',d.to||'Oleg');
    set('navra-cash-notes',d.notes||'');refreshKind();dialog.showModal();
  }
  $id('navra-cash-form').addEventListener('submit',async event=>{
    event.preventDefault();if(saving)return;
    const kind=get('navra-cash-kind'),amount=cents(get('navra-cash-amount'));
    if(!MONEY_KINDS.includes(kind)||kind==='sale_receipt')return alert('Tipo movimento non valido.');
    if(!Number.isSafeInteger(amount)||amount<=0||amount>10000000000)return alert('Importo non valido.');
    const from=get('navra-cash-from'),to=get('navra-cash-to'),holder=get('navra-cash-holder');
    if(kind==='cash_transfer' && (!personOK(from)||!personOK(to)||from===to))return alert('Scegli due soci diversi per il trasferimento.');
    if(kind!=='cash_transfer'&&!personOK(holder))return alert('Seleziona chi tiene i soldi.');
    saving=true;
    try{
      const old=editingId?state.records.find(x=>x.id===editingId):null;
      const now=new Date().toISOString();
      const data={kind,title:get('navra-cash-title').trim(), amount:amount/100,date:get('navra-cash-date'),
        holder:kind==='cash_transfer'?'':holder,from:kind==='cash_transfer'?from:'',to:kind==='cash_transfer'?to:'',
        notes:get('navra-cash-notes').trim(),autoFromWatch:false};
      if(!data.title)return alert('Inserisci una descrizione.');
      await putRecord({id:editingId||crypto.randomUUID(),type:'cost',data,created_at:old?.created_at||now,updated_at:now,deleted_at:null});
      dialog.close();await reload();autoSync();
    }catch(e){alert('Salvataggio non riuscito: '+e.message);}finally{saving=false;}
  });
  document.getElementById('content')?.addEventListener('click',async e=>{
    const add=e.target.closest('[data-cash-add]');if(add){openMovement(add.dataset.cashAdd);return;}
    const edit=e.target.closest('[data-cash-edit]');if(edit){const r=cashRecords().find(x=>x.id===edit.dataset.cashEdit);if(r&& !r.data?.autoFromWatch)openMovement(r.data.kind,r);return;}
    const del=e.target.closest('[data-cash-delete]');if(del){
      const r=cashRecords().find(x=>x.id===del.dataset.cashDelete);if(!r||r.data?.autoFromWatch)return;
      if(!confirm('Eliminare questo movimento di cassa da entrambi i telefoni?'))return;
      const now=new Date().toISOString();await putRecord({...r,updated_at:now,deleted_at:now});await reload();autoSync();
    }
  },true);

  window.NavraCassa=Object.freeze({calculate:calculateCash});
})();

;

// ===== beni-addon.js =====
/* NAVRA 1.5 – Beni ammortizzabili, con acquisto e costo condiviso.
 * Usa record type='cost', kind='asset' per non cambiare le regole Firestore per i tipi.
 * Caricare dopo app.js, firebase-adapter.js, photo-addon.js, costs-addon.js, cassa-addon.js.
 */
'use strict';
(() => {
  const oldRender = render;
  const escape = x => esc(x ?? '');
  const euro = x => eur(Number(x) || 0);
  const day = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0,10);
  const people = ['Stefano','Oleg'];
  const el = id => document.getElementById(id);
  let editId = null, busy = false;
  const assets = () => state.records.filter(r => r.type === 'cost' && r.data?.kind === 'asset' && !r.deleted_at);
  const toCents = n => Math.round((Number(n) || 0) * 100);

  function currentDepreciation(d, today = new Date()) {
    const amount = Math.max(0, toCents(d.amount));
    const salvage = Math.min(amount, Math.max(0, toCents(d.residual)));
    const months = Math.max(1, Math.floor(Number(d.lifeMonths)||36));
    const start = /^\d{4}-\d{2}-\d{2}$/.test(d.date || '') ? new Date(d.date + 'T12:00:00') : today;
    if (!Number.isFinite(start.getTime())) return { accumulated:0, book:amount/100, monthly:(amount-salvage)/months/100 };
    // Stima gestionale: mesi interi trascorsi dal mese d'acquisto, massimo vita utile.
    let elapsed = (today.getFullYear()-start.getFullYear())*12 + today.getMonth()-start.getMonth();
    elapsed = Math.max(0, Math.min(months, elapsed));
    const accum = Math.round((amount-salvage)*elapsed/months);
    return {accumulated:accum/100, book:(amount-accum)/100, monthly:(amount-salvage)/months/100};
  }

  const nav=el('nav');
  if(nav && !nav.querySelector('[data-view="assets"]')) {
    const b=document.createElement('button');b.dataset.view='assets';b.textContent='Beni';b.type='button';
    nav.insertBefore(b,nav.querySelector('[data-view="sync"]'));
  }

  function page() {
    const rows=assets().sort((a,b)=>(b.data.date||'').localeCompare(a.data.date||''));
    const purchase=rows.reduce((sum,r)=>sum+(Number(r.data.amount)||0),0);
    const book=rows.reduce((sum,r)=>sum+currentDepreciation(r.data).book,0);
    return `<div class="head"><h1>Beni da ammortizzare</h1><button class="btn gold" type="button" data-asset-new>+ Bene</button></div>
      <p class="hint">Teca, custodie, espositori, attrezzatura, materiale durevole. Ammortamento lineare indicativo, non fiscale.</p>
      <div class="metrics"><div class="metric"><div class="label">Costo acquisto</div><div class="num">${escape(euro(purchase))}</div></div><div class="metric"><div class="label">Valore residuo contabile</div><div class="num">${escape(euro(book))}</div></div></div>
      <section class="panel" style="margin-top:14px"><h2>Elenco beni</h2>
      ${rows.length?rows.map(r=>{const d=r.data, dep=currentDepreciation(d);return `<div class="item"><div style="flex:1;min-width:0"><strong>${escape(d.title)}</strong><div class="minor">${escape(d.category)} · ${escape(d.date)} · ${escape(d.paidBy)} paga · ${escape(d.lifeMonths)} mesi</div><div class="minor">Ammortamento maturato: ${escape(euro(dep.accumulated))} · Residuo: ${escape(euro(dep.book))}</div></div><div><strong>${escape(euro(d.amount))}</strong><div><button class="btn alt small" type="button" data-asset-edit="${escape(r.id)}">Modifica</button></div></div></div>`}).join(''):'<div class="empty">Nessun bene registrato.</div>'}</section>
      <p class="hint">Se indichi chi ha pagato, l'acquisto compare anche in Costi per dividere il denaro anticipato. Nel calcolo dell'utile gestionale va conteggiato l'ammortamento, non l'intero acquisto una seconda volta.</p>`;
  }
  render=function(){oldRender();if(state.view==='assets')el('content').innerHTML=page();};

  const dialog=document.createElement('dialog');dialog.id='navra-asset-dialog';
  dialog.innerHTML=`<form id="navra-asset-form"><h2>Bene da ammortizzare</h2>
    <div class="field"><label>Descrizione</label><input id="as-title" required placeholder="Teca espositiva"></div>
    <div class="field"><label>Categoria</label><select id="as-category"><option>Teca / Espositore</option><option>Attrezzatura</option><option>Arredo</option><option>Custodia / Allestimento</option><option>Altro</option></select></div>
    <div class="fields"><div class="field"><label>Costo (€)</label><input id="as-amount" type="number" min="0.01" step="0.01" required></div>
    <div class="field"><label>Data acquisto</label><input id="as-date" type="date" required></div>
    <div class="field"><label>Acquistato da</label><select id="as-buyer"><option>Stefano</option><option>Oleg</option></select></div>
    <div class="field"><label>Pagato da</label><select id="as-paid"><option>Stefano</option><option>Oleg</option></select></div>
    <div class="field"><label>Quota Stefano (%)</label><input id="as-share" type="number" min="0" max="100" step="1" value="50" required></div>
    <div class="field"><label>Vita utile (mesi)</label><input id="as-months" type="number" min="1" max="360" step="1" value="36" required></div>
    <div class="field"><label>Valore residuo (€)</label><input id="as-residual" type="number" min="0" step="0.01" value="0"></div></div>
    <div class="field"><label>Note</label><textarea id="as-notes"></textarea></div>
    <div class="actions"><button type="submit" class="btn">Salva bene</button><button type="button" class="btn alt" id="as-close">Annulla</button><button type="button" class="btn warn" id="as-delete">Elimina bene</button></div>
  </form>`;
  document.body.appendChild(dialog);
  el('as-close').addEventListener('click',()=>dialog.close());
  const keys=['title','category','amount','date','buyer','paid','share','months','residual','notes'];
  const fields={title:'title',category:'category',amount:'amount',date:'date',buyer:'boughtBy',paid:'paidBy',share:'shareStefano',months:'lifeMonths',residual:'residual',notes:'notes'};
  function show(record){editId=record?.id||null;const d=record?.data||{};for(const key of keys)el('as-'+key).value=d[fields[key]]??(key==='date'?day():key==='months'?36:key==='share'?50:key==='residual'?0:key==='buyer'||key==='paid'?'Stefano':'');el('as-delete').style.display=editId?'':'none';dialog.showModal();}
  async function writePair(asset, deleted=false) {
    const id='asset-buy-'+asset.id;
    const d=asset.data;
    const old = await reqPromise(db.transaction('records','readonly').objectStore('records').get(id));
    const expense={id,type:'cost',data:{kind:'expense',title:d.title,category:'Bene ammortizzabile',amount:d.amount,date:d.date,paidBy:d.paidBy,shareStefano:d.shareStefano,notes:'Costo iniziale del bene. Non sottrarre due volte dal risultato: usare ammortamento.',assetId:asset.id,autoFromAsset:true},created_at:old?.created_at||asset.created_at,updated_at:asset.updated_at,deleted_at:deleted?asset.updated_at:null};
    await putRecord(expense);
  }
  el('navra-asset-form').addEventListener('submit',async e=>{
    e.preventDefault();if(busy)return;
    const amount=Number(el('as-amount').value),residual=Number(el('as-residual').value||0),share=Number(el('as-share').value),months=Number(el('as-months').value);
    if(!(amount>0)||residual<0||residual>amount||!Number.isInteger(months)||months<1||months>360||share<0||share>100)return alert('Verifica costo, valore residuo, durata e quote.');
    const title=el('as-title').value.trim();if(!title)return;
    busy=true;
    try{
      const old=editId?assets().find(r=>r.id===editId):null,now=new Date().toISOString();
      const d={kind:'asset',title,category:el('as-category').value,amount:Math.round(amount*100)/100,date:el('as-date').value,boughtBy:el('as-buyer').value,paidBy:el('as-paid').value,shareStefano:share,lifeMonths:months,residual:Math.round(residual*100)/100,notes:el('as-notes').value.trim()};
      const r={id:editId||crypto.randomUUID(),type:'cost',data:d,created_at:old?.created_at||now,updated_at:now,deleted_at:null};
      await putRecord(r);await writePair(r);dialog.close();await reload();autoSync();
    }catch(e){alert('Non salvato: '+e.message);}finally{busy=false;}
  });
  el('as-delete').addEventListener('click',async ()=>{
    const old=assets().find(r=>r.id===editId);if(!old||!confirm('Eliminare questo bene dall’elenco e annullare anche il suo costo condiviso?'))return;
    const now=new Date().toISOString();try{const r={...old,updated_at:now,deleted_at:now};await putRecord(r);await writePair(r,true);dialog.close();await reload();autoSync();}catch(e){alert(e.message);}
  });
  el('content')?.addEventListener('click',e=>{
    if(e.target.closest('[data-asset-new]'))return show(null);
    const b=e.target.closest('[data-asset-edit]');if(b){const r=assets().find(x=>x.id===b.dataset.assetEdit);if(r)show(r);}
  },true);
  window.NavraAssets=Object.freeze({depreciation:currentDepreciation});
})();

;

// ===== excel-addon.js =====
/* NAVRA 1.5 – Esporta Excel .xlsx completo, foto incluse, OFFLINE.
   Nessuna libreria esterna. Legge i record IndexedDB dell'app (non serve internet).
   Va caricato alla fine, dopo beni-addon.js. Non modifica il database. */
'use strict';
(() => {
  const buf = new TextEncoder();
  const x = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const txt = value => String(value ?? '').slice(0,32000);
  const amount = value => Number.isFinite(Number(value))?Number(value):0;
  const cents = value => Math.round(amount(value)*100);
  const money = value => Math.round(amount(value)*100)/100;
  const positive = value => Math.max(0,amount(value));
  const stamp = () => new Date().toLocaleString('it-IT');
  const isoDay = value => /^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:'';
  const active = records => records.filter(r => r && !r.deleted_at && r.data && typeof r.data === 'object');
  const sorted = arr => arr.sort((a,b)=>(a.data?.date||a.data?.buyDate||a.data?.saleDate||'').localeCompare(b.data?.date||b.data?.buyDate||b.data?.saleDate||''));
  const PEOPLE = ['Stefano','Oleg'];
  function depreciation(d,now=new Date()){
    const initial=cents(d.amount), residual=Math.min(initial,Math.max(0,cents(d.residual)));
    const months=Math.max(1,Math.floor(amount(d.lifeMonths)||36));
    const start=new Date((isoDay(d.date)||now.toISOString().slice(0,10))+'T12:00:00');
    const elapsed=Math.min(months,Math.max(0,(now.getFullYear()-start.getFullYear())*12+now.getMonth()-start.getMonth()));
    const dep=Math.round((initial-residual)*elapsed/months)/100;
    return {accumulated:dep,monthly:money((initial-residual)/months/100),book:money(initial/100-dep)};
  }

  // Minimal ZIP writer (store-only). JPEG images are already compressed.
  const crcTable=(()=>{const out=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);out[n]=c>>>0;}return out;})();
  function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
  function put16(b,p,v){b[p]=v&255;b[p+1]=(v>>>8)&255;}
  function put32(b,p,v){put16(b,p,v);put16(b,p+2,v>>>16);}
  function zipFiles(files){
    const local=[],central=[];let position=0;
    for(const file of files){
      const name=buf.encode(file.path), data=typeof file.data==='string'?buf.encode(file.data):file.data;
      if(!data||!(data instanceof Uint8Array))throw Error('File ZIP non valido: '+file.path);
      if(name.length>65535)throw Error('Nome troppo lungo');
      const crc=crc32(data), lh=new Uint8Array(30+name.length);
      put32(lh,0,0x04034b50);put16(lh,4,20);put16(lh,6,0);put16(lh,8,0);
      put32(lh,14,crc);put32(lh,18,data.length);put32(lh,22,data.length);put16(lh,26,name.length);lh.set(name,30);
      const ch=new Uint8Array(46+name.length);
      put32(ch,0,0x02014b50);put16(ch,4,20);put16(ch,6,20);put32(ch,16,crc);
      put32(ch,20,data.length);put32(ch,24,data.length);put16(ch,28,name.length);put32(ch,42,position);ch.set(name,46);
      local.push(lh,data);central.push(ch);position+=lh.length+data.length;
    }
    const centralBytes=central.reduce((sum,p)=>sum+p.length,0);
    const end=new Uint8Array(22);put32(end,0,0x06054b50);put16(end,8,files.length);put16(end,10,files.length);put32(end,12,centralBytes);put32(end,16,position);
    const out=new Uint8Array(position+centralBytes+end.length);let at=0;
    for(const b of [...local,...central,end]){out.set(b,at);at+=b.length;}
    return out;
  }
  function b64jpeg(source){
    const match=/^data:image\/(jpeg|jpg);base64,([A-Za-z0-9+/=]+)$/i.exec(source||'');
    if(!match)return null;
    const binary=atob(match[2]);if(binary.length>220000)return null;
    const out=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)out[i]=binary.charCodeAt(i);return out;
  }
  const colName = idx => {let s='';for(let i=idx;i>0;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
  const SS={plain:0,title:1,header:2,currency:3,date:4,number:5,subtitle:6,percent:7,highlight:8};
  function cellXML(value,r,c,kind){
    const ref=colName(c)+r;
    if(value && typeof value==='object' && Object.hasOwn(value,'f')){
      const s=value.style??SS.currency;
      return `<c r="${ref}" s="${s}"><f>${x(value.f)}</f><v>${amount(value.v)}</v></c>`;
    }
    const s=kind==='money'?SS.currency:kind==='date'?SS.date:kind==='percent'?SS.percent:typeof value==='number'?SS.number:SS.plain;
    if(value===null||value===undefined||value==='')return '';
    if(typeof value==='number' && Number.isFinite(value))return `<c r="${ref}" s="${s}"><v>${value}</v></c>`;
    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(txt(value))}</t></is></c>`;
  }
  function worksheetXML(sheet,hasDrawing){
    const n=sheet.headers.length,last=colName(n),data=sheet.rows;
    const cols=sheet.widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join('');
    const titles=`<row r="1" ht="31" customHeight="1"><c r="A1" s="1" t="inlineStr"><is><t>${x(sheet.name)}</t></is></c></row>`+
      `<row r="2" ht="24" customHeight="1"><c r="A2" s="6" t="inlineStr"><is><t>${x(sheet.description)}</t></is></c></row>`;
    const headers=`<row r="4" ht="29" customHeight="1">${sheet.headers.map((v,i)=>`<c r="${colName(i+1)}4" s="2" t="inlineStr"><is><t>${x(v)}</t></is></c>`).join('')}</row>`;
    const body=data.map((row,idx)=>{
      const r=5+idx,photo=sheet.name==='Orologi';
      return `<row r="${r}" ht="${photo?'95':'23'}" customHeight="1">${row.map((v,i)=>cellXML(v,r,i+1,sheet.types?.[i])).join('')}</row>`;
    }).join('');
    const nLast=Math.max(5,4+data.length);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><dimension ref="A1:${last}${nLast}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="17"/><cols>${cols}</cols><sheetData>${titles}${headers}${body}</sheetData><mergeCells count="2"><mergeCell ref="A1:${last}1"/><mergeCell ref="A2:${last}2"/></mergeCells><autoFilter ref="A4:${last}${nLast}"/>${hasDrawing?'<drawing r:id="rId1"/>':''}</worksheet>`;
  }
  function drawingXML(photos){
    return `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`+
      photos.map((p,i)=>{
        const id=i+1,cy=112*9525,cx=110*9525;
        return `<xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>9525</xdr:colOff><xdr:row>${p.row-1}</xdr:row><xdr:rowOff>9525</xdr:rowOff></xdr:from><xdr:ext cx="${cx}" cy="${cy}"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${id}" name="Foto NAVRA ${id}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>`;
      }).join('')+'</xdr:wsDr>';
  }
  function excelStyles(){
    return `<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Aptos"/><color rgb="FF243638"/></font><font><sz val="17"/><b/><color rgb="FFFFFFFF"/><name val="Aptos Display"/></font><font><sz val="10"/><b/><color rgb="FFFFFFFF"/></font><font><sz val="10"/><color rgb="FF63777B"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17282D"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFAE884C"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00 &quot;€&quot;"/></numFmts><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
  function sheetsFrom(records, snapshot=new Date()){
    const all=active(records);
    const watches=all.filter(r=>r.type==='watch');
    const suppliers=all.filter(r=>r.type==='supplier');
    const shipments=all.filter(r=>r.type==='shipment');
    const markets=all.filter(r=>r.type==='market');
    const costs=all.filter(r=>r.type==='cost');
    const expenses=costs.filter(r=>r.data.kind==='expense'||r.data.kind==='settlement');
    const cash=costs.filter(r=>['cash_in','cash_out','cash_transfer','sale_receipt'].includes(r.data.kind));
    const assets=costs.filter(r=>r.data.kind==='asset');
    const sold=watches.filter(r=>r.data.status==='Venduto');
    const current=watches.filter(r=>r.data.status!=='Venduto');
    const turnover=money(sold.reduce((s,r)=>s+positive(r.data.salePrice),0));
    const costOfSales=money(sold.reduce((s,r)=>s+positive(r.data.purchase)+positive(r.data.purchaseShipping),0));
    const saleFees=money(sold.reduce((s,r)=>s+positive(r.data.fees),0));
    const gross=money(turnover-costOfSales-saleFees);
    const stock=money(current.reduce((s,r)=>s+positive(r.data.purchase)+positive(r.data.purchaseShipping),0));
    let costTotal=0,operational=0,marketsCost=0,debts=0;
    for(const r of expenses){const d=r.data;const v=cents(d.amount);if(v<=0)continue;
      if(d.kind==='settlement'){if(d.paidBy==='Stefano')debts-=v;else if(d.paidBy==='Oleg')debts+=v;continue;}
      costTotal+=v;
      if(!['Acquisto orologio','Bene ammortizzabile'].includes(d.category)) operational+=v;
      if(d.category==='Mercatino') marketsCost+=v;
      const share=Number(d.shareStefano);if(share>=0&&share<=100){
        // Positive means Stefano owes Oleg, negative means Oleg owes Stefano.
        debts+=Math.round(v*share/100)-(d.paidBy==='Stefano'?v:0);
      }
    }
    const balances={Stefano:0,Oleg:0};
    const cashFlows=[];
    for(const r of cash){const d=r.data, v=cents(d.amount),delta={Stefano:0,Oleg:0};
      if((d.kind==='cash_in'||d.kind==='sale_receipt')&&PEOPLE.includes(d.holder))delta[d.holder]+=v;
      if(d.kind==='cash_out'&&PEOPLE.includes(d.holder))delta[d.holder]-=v;
      if(d.kind==='cash_transfer'&&PEOPLE.includes(d.from)&&PEOPLE.includes(d.to)&&d.from!==d.to){delta[d.from]-=v;delta[d.to]+=v;}
      balances.Stefano+=delta.Stefano;balances.Oleg+=delta.Oleg;
      cashFlows.push([d.date||'',d.kind||'',d.title||'',money(v/100),d.holder||'',d.from||'',d.to||'',money(delta.Stefano/100),money(delta.Oleg/100),d.notes||'',r.id]);
    }
    const depreciationTotal=money(assets.reduce((s,r)=>s+depreciation(r.data,snapshot).accumulated,0));
    const assetAcquisition=money(assets.reduce((s,r)=>s+positive(r.data.amount),0));
    const assetBook=money(assets.reduce((s,r)=>s+depreciation(r.data,snapshot).book,0));
    const op=money(operational/100),estimated=money(gross-op-depreciationTotal);
    const metadata=`Esportato da NAVRA il ${snapshot.toLocaleString('it-IT')} · Dati salvati sul dispositivo · Valori in EUR`;
    const fmt=(name,headers,widths,types,rows,description=metadata)=>({name,headers,widths,types,rows,description});
    const photoList=[];
    const watchesRows=watches.map((r,idx)=>{const d=r.data, photo=b64jpeg(d.photoDataUrl);if(photo)photoList.push({row:idx+5,bytes:photo});
      const row=idx+5,p=positive(d.purchase)+positive(d.purchaseShipping),soldFlag=d.status==='Venduto';
      return [photo?'':'—',d.brand||'',d.model||'',d.reference||'',d.serial||'',d.condition||'',d.status||'Disponibile',d.notes||'',d.supplier||'',d.boughtBy||'',d.purchaseBy||'',isoDay(d.buyDate),money(d.purchase),money(d.purchaseShipping),{f:`M${row}+N${row}`,v:money(p)},money(d.salePrice),isoDay(d.saleDate),money(d.fees),{f:`IF(G${row}="Venduto",P${row}-O${row}-R${row},0)`,v:soldFlag?money(positive(d.salePrice)-p-positive(d.fees)):0},d.saleCollectedBy||'',d.buyShareStefano??'',r.id];
    });
    const sheetW=fmt('Orologi',['Foto','Marca','Modello','Referenza / Calibro','Seriale','Condizione','Stato','Descrizione / Note','Fornitore','Acquistato da','Pagato da','Data acquisto','Prezzo acquisto','Spese acquisto','Costo totale','Prezzo vendita','Data vendita','Commissioni vendita','Utile lordo vendita','Incasso ricevuto da','Quota Stefano (%)','ID'],[18,19,20,23,19,17,16,40,23,19,18,17,18,18,18,18,17,18,20,20,21,38],['','', '', '', '', '', '', '', '', '', '', 'date','money','money','money','money','date','money','money','','number',''],watchesRows);
    // Finanza (management view): do not mix inventory costs, cash custody and debt settlements.
    const finance=fmt('Finanza',['Indicatore','Valore (€)','Spiegazione / Metodo'],[35,22,82],['','money',''],[
      ['Fatturato vendite',turnover,'Prezzi di vendita degli orologi con stato Venduto'],
      ['Costo merce venduta',costOfSales,'Acquisto + spedizione di acquisto degli orologi venduti'],
      ['Commissioni sulle vendite',saleFees,'Commissioni associate agli orologi venduti'],
      ['Margine vendite',gross,'Fatturato - costo merce venduta - commissioni'],
      ['Spese operative registrate',op,'Spese in Costi escluse acquisti orologi e beni durevoli; verificare assenza duplicati'],
      ['Ammortamenti maturati (stimati)',depreciationTotal,'Quota lineare cumulata dei beni registrati; non equivalente ad ammortamento fiscale'],
      ['Risultato gestionale indicativo',estimated,'Margine vendite - spese operative - ammortamenti cumulati; attenzione ai periodi'],
      ['Valore orologi in stock',stock,'Costo acquisto + spedizione di acquisto di orologi non venduti'],
      ['Beni durevoli: costo',assetAcquisition,'Importo speso per teche, espositori e attrezzature'],
      ['Beni durevoli: valore residuo',assetBook,'Costo beni meno quote maturate, secondo vita utile inserita'],
      ['Costi di mercatini',money(marketsCost/100),'Spese categorizzate Mercatino nel registro Costi; evitare doppioni con Mercatini'],
      ['Spese condivise totali',money(costTotal/100),'Somma spese Splitwise (include merce e beni, non sottrarre nuovamente ai margini)'],
      ['Saldo Splitwise: Stefano deve Oleg',money(Math.max(0,debts)/100),'Anticipi netti ancora da rimborsare'],
      ['Saldo Splitwise: Oleg deve Stefano',money(Math.max(0,-debts)/100),'Anticipi netti ancora da rimborsare'],
      ['Cassa in mano a Stefano',money(balances.Stefano/100),'Incassi + entrate - uscite +/- trasferimenti registrati'],
      ['Cassa in mano a Oleg',money(balances.Oleg/100),'Incassi + entrate - uscite +/- trasferimenti registrati'],
      ['Cassa totale',money((balances.Stefano+balances.Oleg)/100),'Somma cassa dei due soci; NON equivale a utile'],
      ['Orologi venduti (n.)',sold.length,'Numero di orologi con stato Venduto'],
      ['Orologi in stock (n.)',current.length,'Numero di orologi non venduti'],
      ['Nota','','È un prospetto gestionale. Per utile di periodo serve una corretta competenza temporale e verifica delle duplicazioni.']
    ]);
    const detailCosts=fmt('Costi',['Data','Tipo','Categoria','Descrizione','Importo','Pagato da','Quota Stefano (%)','Quota Stefano (€)','Quota Oleg (€)','ID orologio','ID bene','Origine automatica','Note','ID movimento'],[17,18,26,32,17,18,22,19,19,36,36,18,45,36],['date','','','','money','','number','money','money','','','','',''],sorted([...expenses]).map(r=>{const d=r.data,share=amount(d.shareStefano),isExpense=d.kind==='expense';return [isoDay(d.date),d.kind,d.category||'',d.title||'',money(d.amount),d.paidBy||'',isExpense?share:'',isExpense?money(d.amount*share/100):'',isExpense?money(d.amount*(100-share)/100):'',d.watchId||'',d.assetId||'',d.autoFromWatch||d.autoFromAsset?'Sì':'No',d.notes||'',r.id]}));
    const detailCash=fmt('Cassa',['Data','Tipo','Descrizione','Importo','Detentore / Ricevente','Da','A','Delta Stefano','Delta Oleg','Note','ID movimento'],[17,20,34,18,23,17,17,20,20,45,36],['date','','','money','','','','money','money','',''],cashFlows.sort((a,b)=>String(a[0]).localeCompare(String(b[0]))));
    const assetRows=sorted([...assets]).map(r=>{const d=r.data,dep=depreciation(d,snapshot);return [d.title||'',d.category||'',isoDay(d.date),money(d.amount),d.boughtBy||'',d.paidBy||'',amount(d.shareStefano),Math.floor(amount(d.lifeMonths)||36),money(d.residual),dep.monthly,dep.accumulated,dep.book,d.notes||'',r.id]});
    const detailAssets=fmt('Beni',['Bene / Descrizione','Categoria','Data acquisto','Costo','Acquistato da','Pagato da','Quota Stefano (%)','Durata mesi','Valore residuo finale','Quota mensile','Ammortamento maturato','Valore non ammortizzato','Note','ID'],[36,22,17,18,18,18,19,16,24,18,25,25,40,36],['','','date','money','','','number','','money','money','money','money','',''],assetRows);
    const detailMarkets=fmt('Mercatini',['Nome','Città','Data','Costo banco','Incassi','Saldo mercatino (lordo)','Note','ID'],[28,20,17,18,18,24,50,36],['','','date','money','money','money','',''],markets.map(r=>{const d=r.data;return [d.name||'',d.city||'',isoDay(d.date),money(d.fee),money(d.revenue),money(amount(d.revenue)-amount(d.fee)),d.notes||'',r.id]}));
    const detailShipments=fmt('Spedizioni',['Descrizione','Da','A','Corriere','Tracking','Data','Costo','Stato','Note','ID'],[30,20,20,18,30,17,18,18,45,36],['','','','','','date','money','','',''],shipments.map(r=>{const d=r.data;return [d.name||'',d.from||'',d.to||'',d.carrier||'',d.tracking||'',isoDay(d.date),money(d.cost),d.status||'',d.notes||'',r.id]}));
    const detailSuppliers=fmt('Fornitori',['Nome','Paese','Contatto','Canale','Sito / Profilo','Note','ID'],[28,20,28,28,40,55,36],[],suppliers.map(r=>{const d=r.data;return [d.name||'',d.country||'',d.contact||'',d.channel||'',d.website||'',d.notes||'',r.id]}));
    return {sheets:[sheetW,finance,detailCosts,detailCash,detailAssets,detailMarkets,detailShipments,detailSuppliers],photos:photoList,totals:{watches:watches.length,photos:photoList.length,cash:balances,turnover}};
  }
  function createXlsx(records,now=new Date()) {
    const {sheets,photos,totals}=sheetsFrom(records,now), files=[];
    const overrides=[];
    files.push({path:'docProps/app.xml',data:`<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>NAVRA</Application></Properties>`});
    files.push({path:'docProps/core.xml',data:`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>NAVRA - Export completo</dc:title><dc:creator>NAVRA</dc:creator></cp:coreProperties>`});
    files.push({path:'_rels/.rels',data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`});
    files.push({path:'xl/workbook.xml',data:`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${x(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`});
    files.push({path:'xl/_rels/workbook.xml.rels',data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`});
    files.push({path:'xl/styles.xml',data:excelStyles()});overrides.push('<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>');
    sheets.forEach((s,i)=>{const hasDrawing=(i===0&&photos.length>0);
      files.push({path:`xl/worksheets/sheet${i+1}.xml`,data:worksheetXML(s,hasDrawing)});
      overrides.push(`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`);
      if(hasDrawing)files.push({path:`xl/worksheets/_rels/sheet${i+1}.xml.rels`,data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`});
    });
    if(photos.length){
      files.push({path:'xl/drawings/drawing1.xml',data:drawingXML(photos)});
      overrides.push('<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>');
      files.push({path:'xl/drawings/_rels/drawing1.xml.rels',data:`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${photos.map((p,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/navra-photo-${i+1}.jpg"/>`).join('')}</Relationships>`});
      photos.forEach((p,i)=>files.push({path:`xl/media/navra-photo-${i+1}.jpg`,data:p.bytes}));
    }
    files.push({path:'[Content_Types].xml',data:`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${photos.length?'<Default Extension="jpg" ContentType="image/jpeg"/>':''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides.join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`});
    return {bytes:zipFiles(files),totals};
  }
  let exporting=false;
  async function exportExcel(){
    if(exporting)return;exporting=true;
    const button=document.querySelector('[data-navra-excel]');if(button){button.disabled=true;button.textContent='Preparazione Excel...';}
    try{
      // Foto e schede provengono dal database locale; funziona anche in modalità aereo.
      const records=await allRecords(),snapshot=new Date(),result=createXlsx(records,snapshot);
      const name=`NAVRA-Report-${snapshot.getFullYear()}-${String(snapshot.getMonth()+1).padStart(2,'0')}-${String(snapshot.getDate()).padStart(2,'0')}.xlsx`;
      const blob=new Blob([result.bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),90000);
      const el=document.getElementById('navra-export-status');if(el)el.textContent=`Creato ${name}: ${result.totals.watches} orologi, ${result.totals.photos} fotografie. Salva il file nell'app File.`;
    }catch(e){alert('Non riesco a creare il file Excel: '+e.message);}finally{exporting=false;if(button){button.disabled=false;button.textContent='Scarica Excel completo';}}
  }
  const oldRender=render;
  const nav=document.getElementById('nav');
  if(nav&&!nav.querySelector('[data-view="report"]')){
    const btn=document.createElement('button');btn.type='button';btn.dataset.view='report';btn.textContent='Excel';
    nav.insertBefore(btn,nav.querySelector('[data-view="sync"]'));
  }
  function renderReport(){return `<div class="head"><h1>Report NAVRA in Excel</h1></div><section class="panel"><h2>Esporta tutto dall'iPhone</h2><p>Un file Excel con Orologi (foto incluse), Finanza, Costi, Cassa, Beni da ammortizzare, Mercatini, Spedizioni e Fornitori.</p>
    <button class="btn gold" type="button" data-navra-excel>Scarica Excel completo</button><p id="navra-export-status" class="status"></p>
    <p class="hint">L'Excel è una fotografia dei dati presenti su questo dispositivo al momento del download. Se vuoi prima ottenere le novità di Oleg, vai in Sincronizza e premi Sincronizza ora. Funziona anche offline; non sostituisce il backup JSON.</p>
    <p class="hint">Finanza separa fatturato, margine delle vendite, cassa materialmente detenuta e debiti tra soci. I beni hanno un ammortamento gestionale lineare, non un calcolo fiscale.</p></section>`;}
  render=function(){oldRender();if(state.view==='report'){document.getElementById('content').innerHTML=renderReport();}else if(state.view==='settings'){
    const section=document.createElement('section');section.className='panel';section.innerHTML='<h2>Report Excel</h2><p class="hint">Scarica foto e riepilogo di orologi, finanza, costi, cassa e beni.</p><button class="btn gold" type="button" data-navra-excel>Scarica Excel completo</button><p class="status" id="navra-export-status"></p>';
    document.getElementById('content').appendChild(section);
  }};
  document.getElementById('content')?.addEventListener('click',e=>{if(e.target.closest('[data-navra-excel]'))void exportExcel();},true);
  window.NavraExcel=Object.freeze({createXlsx,sheetsFrom,exportExcel});
})();

;
