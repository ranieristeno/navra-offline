/* NAVRA · Firebase bridge, keeps the existing IndexedDB records intact.
   Load AFTER app.js as a classic deferred script. Requires firebase.rules in Firestore. */
'use strict';
(() => {
  const SDK_VERSION = '13.1.0';
  const sdkRoot = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
  let cloudPromise = null;
  let syncBusy = false;
  let initializing = false;
  let fb = null;
  let firebaseMessage = '';
  const legacyAction = action;
  const safeError = (e) => ({
    'auth/email-already-in-use': 'Questa email è già registrata. Premi Accedi.',
    'auth/invalid-email': 'Controlla l’indirizzo email.',
    'auth/weak-password': 'La password deve contenere almeno 6 caratteri.',
    'auth/invalid-credential': 'Email o password non corretti.',
    'auth/too-many-requests': 'Troppi tentativi. Riprova più tardi.',
    'permission-denied': 'Permesso negato. Verifica di aver pubblicato le regole Firestore.',
    'unavailable': 'Server non raggiungibile. I dati restano sull’iPhone.'
  }[e?.code] || e?.message || 'Operazione non riuscita');
  const status = (message) => { firebaseMessage = message; state.syncMessage = message; setStatus(message); };
  const configReady = () => !!(state.firebaseConfig?.apiKey && state.firebaseConfig?.projectId && state.firebaseConfig?.appId && state.firebaseConfig?.authDomain);
  const connected = () => !!(state.firebaseUser?.uid && state.firebaseWorkspace?.id);
  const input = (id) => document.getElementById(id)?.value?.trim() || '';

  async function cloud() {
    if (!navigator.onLine) throw new Error('Nessuna connessione. NAVRA continua a funzionare offline.');
    if (!configReady()) throw new Error('Prima collega il tuo progetto Firebase.');
    if (fb) return fb;
    if (!cloudPromise) cloudPromise = Promise.all([
      import(sdkRoot + 'firebase-app.js'), import(sdkRoot + 'firebase-auth.js'), import(sdkRoot + 'firebase-firestore.js')
    ]).then(async ([appSdk, authSdk, storeSdk]) => {
      const appName = 'navra-' + state.firebaseConfig.projectId;
      const app = appSdk.getApps().find(x => x.name === appName) || appSdk.initializeApp(state.firebaseConfig, appName);
      const auth = authSdk.getAuth(app);
      const store = storeSdk.getFirestore(app);
      if (typeof auth.authStateReady === 'function') await auth.authStateReady();
      else await new Promise(resolve => authSdk.onAuthStateChanged(auth, () => resolve(), () => resolve()));
      fb = { app, auth, store, a: authSdk, f: storeSdk };
      return fb;
    }).catch(e => { cloudPromise = null; throw e; });
    return cloudPromise;
  }

  async function findGroup() {
    const f = await cloud(), u = f.auth.currentUser;
    if (!u) return null;
    const q = f.f.query(f.f.collection(f.store, 'navra_workspaces'), f.f.where('memberUids', 'array-contains', u.uid), f.f.limit(2));
    const result = await f.f.getDocsFromServer(q);
    const d = result.docs[0];
    state.firebaseWorkspace = d ? { id: d.id, name: d.data().name, members: d.data().memberUids.length } : null;
    return state.firebaseWorkspace;
  }

  async function initialize() {
    if (initializing || !configReady() || !navigator.onLine) return;
    initializing = true;
    try {
      const f = await cloud(), u = f.auth.currentUser;
      if (u) {
        state.firebaseUser = { uid: u.uid, email: u.email };
        await findGroup();
        render();
        if (connected()) autoSync();
      } else {
        state.firebaseUser = null;
        state.firebaseWorkspace = null;
        render();
      }
    } catch (e) {
      status('Firebase: ' + safeError(e));
    } finally { initializing = false; }
  }

  syncView = function () {
    const conf = state.firebaseConfig, u = state.firebaseUser, w = state.firebaseWorkspace;
    let html = '<div class="head"><h1>Sincronizzazione Firebase</h1></div>' +
      '<div class="notice">NAVRA salva sempre i dati sul tuo iPhone. Quando sei online puoi sincronizzarli con l’altro socio. Prima di collegare il gruppo, scarica un backup da Impostazioni.</div>';
    if (conf === undefined) return html + '<p>Caricamento configurazione...</p>';
    if (!configReady()) return html + '<section class="panel"><h2>1. Configura Firebase</h2>' +
      '<p class="hint">Da Firebase Console: Impostazioni progetto → Le tue app → App web. Puoi incollare l’intero blocco firebaseConfig oppure inserire i quattro campi.</p>' +
      '<div class="field"><label for="fb-snippet">Configurazione Firebase da incollare (facoltativa)</label><textarea id="fb-snippet" placeholder="const firebaseConfig = { apiKey: ... }"></textarea></div>' +
      '<div class="fields" style="margin-top:12px"><div class="field wide"><label for="fb-api-key">apiKey</label><input id="fb-api-key" autocomplete="off"></div>' +
      '<div class="field wide"><label for="fb-auth-domain">authDomain</label><input id="fb-auth-domain" placeholder="nome-progetto.firebaseapp.com"></div>' +
      '<div class="field wide"><label for="fb-project-id">projectId</label><input id="fb-project-id"></div>' +
      '<div class="field wide"><label for="fb-app-id">appId</label><input id="fb-app-id"></div></div>' +
      '<div class="actions">' + button('Salva Firebase', 'firebase-config') + '</div></section>';
    html += '<section class="panel"><h2>Database collegato</h2><p class="hint">' + esc(conf.projectId) + '</p>' +
      '<div class="actions">' + button('Cambia progetto', 'firebase-reset', 'alt') + '</div></section>';
    if (!u) return html + '<section class="panel"><h2>2. Accesso dei soci</h2><p class="hint">Ognuno usa il proprio account. Attiva prima Email/Password in Firebase → Authentication.</p>' +
      '<div class="fields"><div class="field wide"><label>Email</label><input id="fb-email" type="email" autocomplete="email"></div>' +
      '<div class="field wide"><label>Password (almeno 6 caratteri)</label><input id="fb-password" type="password" autocomplete="current-password"></div></div>' +
      '<div class="actions">' + button('Accedi', 'firebase-signin') + '</div>' +
      '<p class="hint">Utilizza gli account che avete già creato in Firebase Authentication. Non serve registrarsi di nuovo.</p><p class="status" id="status">' + esc(firebaseMessage) + '</p></section>';
    html += '<section class="panel"><div class="flex"><h2>Account</h2>' + button('Esci', 'firebase-signout', 'alt small') + '</div><p class="hint">' + esc(u.email) + '</p>';
    if (!w) html += '<h2>3. Crea o raggiungi il gruppo</h2>' +
      '<div class="field"><label>Nome gruppo</label><input id="fb-group-name" value="NAVRA"></div>' +
      '<div class="actions">' + button('Crea gruppo', 'firebase-create-group') + '</div><hr style="border:0;border-top:1px solid var(--line);margin:20px 0">' +
      '<div class="field"><label>Codice invito ricevuto dal socio</label><input id="fb-invite" placeholder="Codice invito"></div>' +
      '<div class="actions">' + button('Entra nel gruppo', 'firebase-join-group', 'alt') + '</div>';
    else html += '<p><strong>Gruppo attivo:</strong> ' + esc(w.name) + ' · ' + esc(w.members) + '/2 soci</p>' +
      '<p class="hint">Codice invito privato (condividilo solo con il socio): <strong>' + esc(w.id) + '</strong></p>' +
      '<div class="actions">' + button('Sincronizza ora', 'firebase-sync') + button('Copia codice invito', 'firebase-copy', 'alt') + '</div>' +
      '<p class="hint">La sincronizzazione avviene all’apertura, al ritorno di Internet, ogni minuto quando l’app è aperta e dopo le modifiche. Se entrambi modificate la stessa scheda offline, prevale quella con data di modifica più recente.</p>';
    html += '<p class="status" id="status">' + esc(firebaseMessage) + '</p></section>';
    return html;
  };

  async function sign(actionName) {
    const email = input('fb-email'), password = document.getElementById('fb-password')?.value || '';
    if (!email || password.length < 6) throw new Error('Inserisci email e password di almeno 6 caratteri.');
    status('Collegamento a Firebase...');
    const f = await cloud();
    if (actionName === 'firebase-signup') throw new Error('Usa l’account creato in Firebase Authentication.');
    const user = (await f.a.signInWithEmailAndPassword(f.auth, email, password)).user;
    state.firebaseUser = { uid: user.uid, email: user.email };
    await findGroup();
    status('Accesso riuscito.');
    render();
    if (connected()) autoSync();
  }

  async function approveImport() {
    const count = (await allRecords()).filter(x => !x.deleted_at).length;
    if (!count) return true;
    return confirm('Condividerai ' + count + ' schede presenti in questo iPhone con il gruppo. Prima scarica un backup da Impostazioni. Hai già il backup e vuoi procedere?');
  }

  async function createGroup() {
    if (!(await approveImport())) return;
    const f = await cloud(), uid = f.auth.currentUser?.uid;
    if (!uid || !state.firebaseUser) throw new Error('Prima accedi con uno dei due account autorizzati.');
    if (await findGroup()) throw new Error('Sei già membro di un gruppo.');
    const id = crypto.randomUUID();
    const name = input('fb-group-name').slice(0, 80) || 'NAVRA';
    await f.f.setDoc(f.f.doc(f.store, 'navra_workspaces', id), { name, ownerUid: uid, memberUids: [uid], createdAt: f.f.serverTimestamp() });
    state.firebaseWorkspace = {id, name, members: 1};
    status('Gruppo creato. Copia il codice invito e consegnalo solo al tuo socio.');
    render();
    await syncNow();
  }

  async function joinGroup() {
    if (!(await approveImport())) return;
    const code = input('fb-invite');
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(code)) throw new Error('Il codice invito non è valido.');
    const f = await cloud(), uid = f.auth.currentUser?.uid;
    if (!uid || !state.firebaseUser) throw new Error('Prima accedi con uno dei due account autorizzati.');
    if (await findGroup()) throw new Error('Sei già membro di un gruppo.');
    const group = f.f.doc(f.store, 'navra_workspaces', code);
    await f.f.runTransaction(f.store, async transaction => {
      const d = await transaction.get(group);
      if (!d.exists()) throw new Error('Gruppo non trovato. Controlla il codice.');
      const members = d.data().memberUids || [];
      if (members.includes(uid)) return;
      if (members.length >= 2) throw new Error('Il gruppo ha già due soci.');
      transaction.update(group, { memberUids: [...members, uid] });
    });
    await findGroup();
    status('Sei entrato nel gruppo.');
    render();
    await syncNow();
  }

  syncNow = async function () {
    if (syncBusy || !connected() || !navigator.onLine) return;
    syncBusy = true;
    status('Sincronizzazione in corso...');
    try {
      const f = await cloud();
      const recordsRef = f.f.collection(f.store, 'navra_workspaces', state.firebaseWorkspace.id, 'records');
      // Only compare against confirmed SERVER state; an empty browser cache is not an empty database.
      const snapshot = await f.f.getDocsFromServer(recordsRef);
      const remote = new Map(snapshot.docs.map(d => [d.id, d.data()]));
      const local = await allRecords();
      const pending = [], pulled = [];
      for (const r of local) {
        const cloudRecord = remote.get(r.id);
        if (!cloudRecord || Date.parse(r.updated_at) > Date.parse(cloudRecord.updated_at)) pending.push(r);
      }
      for (const [id, r] of remote) {
        const mine = local.find(x => x.id === id);
        if (!mine || Date.parse(r.updated_at) > Date.parse(mine.updated_at)) pulled.push(r);
      }
      for (let i = 0; i < pending.length; i += 400) {
        const batch = f.f.writeBatch(f.store);
        for (const r of pending.slice(i, i + 400)) {
          const payload = {id: r.id, type: r.type, data: r.data, updated_at: r.updated_at, deleted_at: r.deleted_at || null, created_at: r.created_at || r.updated_at};
          batch.set(f.f.doc(recordsRef, r.id), payload);
        }
        await batch.commit();
      }
      for (const r of pulled) await putRecord(r);
      await reload();
      status('Sincronizzato · ' + new Date().toLocaleTimeString('it-IT', {hour:'2-digit', minute:'2-digit'}) + ' · ' + pending.length + ' inviati, ' + pulled.length + ' ricevuti');
    } catch (e) { status('Sincronizzazione non riuscita: ' + safeError(e) + '. I dati locali restano salvati.'); }
    finally { syncBusy = false; }
  };

  autoSync = function () { if (navigator.onLine && connected()) void syncNow(); };

  async function firebaseAction(name) {
    if (name === 'firebase-config') {
      const snippet = input('fb-snippet');
      const findVal = (key) => {
        const match = snippet.match(new RegExp('\\b' + key + '\\s*:\\s*["\\\x27]([^"\\\x27]+)'));
        return match?.[1] || '';
      };
      const conf = {
        apiKey: input('fb-api-key') || findVal('apiKey'),
        authDomain: input('fb-auth-domain') || findVal('authDomain'),
        projectId: input('fb-project-id') || findVal('projectId'),
        appId: input('fb-app-id') || findVal('appId')
      };
      if (!conf.apiKey || !conf.projectId || !conf.appId || !/^[-\w.]+\.firebaseapp\.com$/.test(conf.authDomain)) throw new Error('Configurazione incompleta. Controlla apiKey, authDomain, projectId e appId.');
      state.firebaseConfig = conf;
      await setSetting('firebaseConfig', conf);
      status('Progetto salvato.');
      render();
      await initialize();
    } else if (name === 'firebase-reset') {
      if (!confirm('Cambiare progetto Firebase? I dati offline resteranno su questo iPhone.')) return;
      if (fb) await fb.a.signOut(fb.auth);
      fb = null; cloudPromise = null; state.firebaseConfig = null; state.firebaseUser = null; state.firebaseWorkspace = null;
      await setSetting('firebaseConfig', null); status('Configurazione rimossa.'); render();
    } else if (name === 'firebase-signin' || name === 'firebase-signup') await sign(name);
    else if (name === 'firebase-create-group') await createGroup();
    else if (name === 'firebase-join-group') await joinGroup();
    else if (name === 'firebase-sync') await syncNow();
    else if (name === 'firebase-signout') {
      if (!confirm('Uscire da Firebase? Le schede offline resteranno sull’iPhone.')) return;
      const f = await cloud(); await f.a.signOut(f.auth);
      state.firebaseUser = null; state.firebaseWorkspace = null; status('Disconnesso.'); render();
    } else if (name === 'firebase-copy') {
      const code = state.firebaseWorkspace?.id;
      if (!code) throw new Error('Codice non disponibile.');
      try { await navigator.clipboard.writeText(code); status('Codice copiato.'); }
      catch { window.prompt('Copia il codice e invialo solo al socio:', code); }
    }
  }
  action = async function (name) {
    if (name.startsWith('firebase-')) {
      try { await firebaseAction(name); }
      catch (e) { status(safeError(e)); }
      return;
    }
    return legacyAction(name);
  };

  async function onReady() {
    for (let i = 0; i < 80 && !db; i++) await new Promise(resolve => setTimeout(resolve, 100));
    if (!db) return;
    state.firebaseConfig = (await getSetting('firebaseConfig')) || null;
    if (state.view === 'sync') render();
    await initialize();
    window.addEventListener('online', () => void initialize());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) void initialize(); });
  }
  // The original boot() opens the existing IndexedDB. Wait for it; never reset its schema.
  void onReady();
})();
