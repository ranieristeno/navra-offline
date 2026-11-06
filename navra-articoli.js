/* NAVRA - Articoli e categorie. I precedenti orologi restano intatti. */
'use strict';
(() => {
  if (typeof SCHEMA === 'undefined' || !SCHEMA.watch) return;
  const DEFAULTS = ['Orologi', 'Borse', 'Occhiali'];
  const schema = SCHEMA.watch;
  schema.title = 'Articolo';
  schema.plural = 'Articoli';
  if (!schema.fields.some(f => f[0] === 'category')) {
    schema.fields.unshift(['category', 'Categoria', 'text', true]);
  }
  const categoryOf = r => String(r?.data?.category || 'Orologi').trim() || 'Orologi';
  const categories = () => [...new Set([...DEFAULTS, ...state.records.filter(r => r.type === 'watch' && !r.deleted_at).map(categoryOf)])]
    .sort((a, b) => a.localeCompare(b, 'it'));

  const prevRecordsView = recordsView;
  recordsView = function(type) {
    const html = prevRecordsView(type);
    if (type !== 'watch') return html;
    const options = categories().map(cat => '<option value="' + esc(cat) + '"' +
      (state.navraCategoryFilter === cat ? ' selected' : '') + '>' + esc(cat) + '</option>').join('');
    const filter = '<div class="field" style="margin:0 0 12px"><label for="navra-category-filter">Categoria articoli</label>' +
      '<select id="navra-category-filter"><option value="">Tutte le categorie</option>' + options + '</select></div>';
    return html.replace('<div id="record-list"></div>', filter + '<div id="record-list"></div>');
  };
  const prevFiltered = filteredRecords;
  filteredRecords = function(type) {
    const found = prevFiltered(type);
    return (type === 'watch' && state.navraCategoryFilter) ? found.filter(r => categoryOf(r) === state.navraCategoryFilter) : found;
  };
  const prevEditModal = editModal;
  editModal = function(type, id) {
    prevEditModal(type, id);
    if (type !== 'watch') return;
    const input = document.getElementById('f-category');
    if (!input) return;
    const existing = id ? state.records.find(r => r.id === id) : null;
    input.value = categoryOf(existing);
    input.setAttribute('list', 'navra-category-list');
    input.placeholder = 'Orologi, Borse, Occhiali o nuova categoria';
    const datalist = document.createElement('datalist');
    datalist.id = 'navra-category-list';
    categories().forEach(cat => {
      const option = document.createElement('option');
      option.value = cat;
      datalist.appendChild(option);
    });
    document.getElementById('form-fields')?.appendChild(datalist);
  };
  const prevRecordCard = recordCard;
  recordCard = function(r) {
    const html = prevRecordCard(r);
    return r.type === 'watch' ? html.replace('</h3>', '</h3><div class="minor">Categoria: ' + esc(categoryOf(r)) + '</div>') : html;
  };
  const prevDashboard = dashboard;
  dashboard = function() {
    return prevDashboard()
      .replaceAll('+ Orologio', '+ Articolo')
      .replaceAll('Ultimi orologi', 'Ultimi articoli')
      .replaceAll('Nessun orologio ancora inserito.', 'Nessun articolo ancora inserito.')
      .replaceAll('orologi venduti', 'articoli venduti')
      .replaceAll('aggiungere il primo.', 'aggiungere il primo articolo.');
  };
  document.getElementById('content')?.addEventListener('change', e => {
    if (e.target.id !== 'navra-category-filter') return;
    state.navraCategoryFilter = e.target.value;
    if (state.view === 'watch') renderList();
  });
})();
