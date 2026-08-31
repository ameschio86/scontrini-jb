'use strict';

/* =========================================================
   COSTANTI E UTILITY DATA
   ========================================================= */

const DB_NAME = 'ScontriniDB';
const DB_VERSION = 4;
const STORE_RICEVUTE = 'ricevute';
const STORE_STATO_MESI = 'statoMesi';
const STORE_SPESE = 'spese';
const STORE_STATO_MESI_RIMBORSO = 'statoMesiRimborso';
const STORE_FIRME = 'firme';
const STORE_ANAGRAFICA_ATTIVITA = 'anagraficaAttivita';
const STORE_ATTIVITA_GIORNI = 'attivitaGiorni';
const STORE_STATO_MESI_ATTIVITA = 'statoMesiAttivita';
const CLIENTE_PERMESSO = '__PERMESSO__';
const MAX_LATO_LUNGO = 2200;
const JPEG_QUALITY = 0.85;

const MESI_IT = [
  'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
  'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
];

function meseAnnoCorrente() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function scomponiMeseAnno(meseAnno) {
  const [anno, mese] = meseAnno.split('-').map(Number);
  return { anno, mese };
}

function aggiungiMesi(meseAnno, delta) {
  const { anno, mese } = scomponiMeseAnno(meseAnno);
  const totale = (anno * 12 + (mese - 1)) + delta;
  const nuovoAnno = Math.floor(totale / 12);
  const nuovoMese = (totale % 12) + 1;
  return `${nuovoAnno}-${String(nuovoMese).padStart(2, '0')}`;
}

function etichettaMese(meseAnno) {
  const { anno, mese } = scomponiMeseAnno(meseAnno);
  return `${MESI_IT[mese - 1]} ${anno}`;
}

function dataISOCorrente() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dataOdiernaCompatta() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function invertiNomeCognome(nomeCognome) {
  const parti = nomeCognome.trim().split(/\s+/);
  if (parti.length < 2) return nomeCognome;
  const cognome = parti[parti.length - 1];
  const nome = parti.slice(0, -1).join(' ');
  return `${cognome} ${nome}`;
}

function nomeFileExport(categoria, meseAnno) {
  const { mese } = scomponiMeseAnno(meseAnno);
  const nomeMese = MESI_IT[mese - 1];
  const dipendente = localStorage.getItem('dipendenteAttivo');
  const cognomeNome = dipendente ? invertiNomeCognome(dipendente) : 'Dipendente non impostato';
  const tipo = categoria === 'gasolio' ? 'Rimborso gasolio' : 'Rimborso scontrini';
  return `${dataOdiernaCompatta()} - ${tipo} ${nomeMese} - ${cognomeNome}.pdf`;
}

function parseDataISO(str) {
  const [anno, mese, giorno] = str.split('-').map(Number);
  return new Date(anno, mese - 1, giorno);
}

function etichettaDataScontrino(str) {
  return parseDataISO(str).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' });
}

function chiaveOrdinamento(ricevuta) {
  return ricevuta.dataScontrino || ricevuta.timestamp.slice(0, 10);
}

/* =========================================================
   LAYER INDEXEDDB
   ========================================================= */

let dbPromise = null;

function apriDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_RICEVUTE)) {
        const store = db.createObjectStore(STORE_RICEVUTE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('meseAnno', 'meseAnno', { unique: false });
        store.createIndex('categoria', 'categoria', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_STATO_MESI)) {
        db.createObjectStore(STORE_STATO_MESI, { keyPath: 'meseAnno' });
      }
      if (!db.objectStoreNames.contains(STORE_SPESE)) {
        const storeSpese = db.createObjectStore(STORE_SPESE, { keyPath: 'id', autoIncrement: true });
        storeSpese.createIndex('meseAnno', 'meseAnno', { unique: false });
        storeSpese.createIndex('esercente', 'esercente', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_STATO_MESI_RIMBORSO)) {
        db.createObjectStore(STORE_STATO_MESI_RIMBORSO, { keyPath: 'meseAnno' });
      }
      if (!db.objectStoreNames.contains(STORE_FIRME)) {
        db.createObjectStore(STORE_FIRME, { keyPath: 'dipendente' });
      }
      if (!db.objectStoreNames.contains(STORE_ANAGRAFICA_ATTIVITA)) {
        db.createObjectStore(STORE_ANAGRAFICA_ATTIVITA, { keyPath: 'dipendente' });
      }
      if (!db.objectStoreNames.contains(STORE_ATTIVITA_GIORNI)) {
        const storeGiorni = db.createObjectStore(STORE_ATTIVITA_GIORNI, { keyPath: 'id', autoIncrement: true });
        storeGiorni.createIndex('meseAnno', 'meseAnno', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_STATO_MESI_ATTIVITA)) {
        db.createObjectStore(STORE_STATO_MESI_ATTIVITA, { keyPath: 'meseAnno' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function txStore(storeName, mode) {
  const db = await apriDB();
  const tx = db.transaction(storeName, mode);
  return { tx, store: tx.objectStore(storeName) };
}

function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function salvaRicevuta(ricevuta) {
  const { store } = await txStore(STORE_RICEVUTE, 'readwrite');
  return reqAsPromise(store.add(ricevuta));
}

async function eliminaRicevuta(id) {
  const { store } = await txStore(STORE_RICEVUTE, 'readwrite');
  return reqAsPromise(store.delete(id));
}

async function getRicevuteDelMese(meseAnno) {
  const { store } = await txStore(STORE_RICEVUTE, 'readonly');
  const idx = store.index('meseAnno');
  const result = await reqAsPromise(idx.getAll(meseAnno));
  return result.sort((a, b) => chiaveOrdinamento(a).localeCompare(chiaveOrdinamento(b)) || a.timestamp.localeCompare(b.timestamp));
}

async function getRicevuteDelMesePerCategoria(meseAnno, categoria) {
  const tutte = await getRicevuteDelMese(meseAnno);
  return tutte.filter(r => r.categoria === categoria);
}

async function salvaSpesa(spesa) {
  const { store } = await txStore(STORE_SPESE, 'readwrite');
  return reqAsPromise(store.add(spesa));
}

async function eliminaSpesa(id) {
  const { store } = await txStore(STORE_SPESE, 'readwrite');
  return reqAsPromise(store.delete(id));
}

async function getSpeseDelMese(meseAnno) {
  const { store } = await txStore(STORE_SPESE, 'readonly');
  const idx = store.index('meseAnno');
  const result = await reqAsPromise(idx.getAll(meseAnno));
  return result.sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
}

async function getTutteLeSpese() {
  const { store } = await txStore(STORE_SPESE, 'readonly');
  return reqAsPromise(store.getAll());
}

async function getUltimaSpesaPerEsercente(esercente) {
  const { store } = await txStore(STORE_SPESE, 'readonly');
  const idx = store.index('esercente');
  const result = await reqAsPromise(idx.getAll(esercente));
  if (result.length === 0) return null;
  return result.sort((a, b) => b.id - a.id)[0];
}

async function getStatoMese(meseAnno) {
  const { store } = await txStore(STORE_STATO_MESI, 'readonly');
  const result = await reqAsPromise(store.get(meseAnno));
  return result || { meseAnno, chiuso: false, dataChiusura: null };
}

async function setStatoMese(meseAnno, chiuso) {
  const { store } = await txStore(STORE_STATO_MESI, 'readwrite');
  const record = { meseAnno, chiuso, dataChiusura: chiuso ? new Date().toISOString() : null };
  return reqAsPromise(store.put(record));
}

async function getStatoMeseRimborso(meseAnno) {
  const { store } = await txStore(STORE_STATO_MESI_RIMBORSO, 'readonly');
  const result = await reqAsPromise(store.get(meseAnno));
  return result || { meseAnno, chiuso: false, dataChiusura: null };
}

async function setStatoMeseRimborso(meseAnno, chiuso) {
  const { store } = await txStore(STORE_STATO_MESI_RIMBORSO, 'readwrite');
  const record = { meseAnno, chiuso, dataChiusura: chiuso ? new Date().toISOString() : null };
  return reqAsPromise(store.put(record));
}

async function determinaMeseAttivoRimborsoIniziale() {
  const correnteMese = meseAnnoCorrente();
  const [tutteSpese, statiDb] = await Promise.all([
    getTutteLeSpese(),
    (async () => {
      const { store } = await txStore(STORE_STATO_MESI_RIMBORSO, 'readonly');
      return reqAsPromise(store.getAll());
    })()
  ]);

  const conteggi = new Map();
  for (const s of tutteSpese) conteggi.set(s.meseAnno, (conteggi.get(s.meseAnno) || 0) + 1);
  const statiMap = new Map(statiDb.map(s => [s.meseAnno, s]));

  const precedentiAperti = [...conteggi.keys()]
    .filter(m => m < correnteMese && !statiMap.get(m)?.chiuso && conteggi.get(m) > 0)
    .sort();

  return precedentiAperti.length > 0 ? precedentiAperti[0] : correnteMese;
}

/* =========================================================
   ATTIVITÀ — anagrafica clienti/cantieri e giorni
   ========================================================= */

function suggerisciSiglaTC(nomeCognome) {
  if (!nomeCognome) return '';
  const invertito = invertiNomeCognome(nomeCognome);
  const parti = invertito.split(/\s+/).filter(Boolean);
  const iniziali = parti.map(p => p[0]).join('');
  return iniziali.slice(0, 2).toUpperCase();
}

async function getAnagraficaAttivita(dipendente) {
  if (!dipendente) return null;
  const { store } = await txStore(STORE_ANAGRAFICA_ATTIVITA, 'readonly');
  const result = await reqAsPromise(store.get(dipendente));
  return result || { dipendente, tc: suggerisciSiglaTC(dipendente), orarioInizio: '08:00', orarioFine: '17:00', clienti: [] };
}

async function salvaAnagraficaAttivita(record) {
  const { store } = await txStore(STORE_ANAGRAFICA_ATTIVITA, 'readwrite');
  return reqAsPromise(store.put(record));
}

async function salvaGiornoAttivita(record) {
  const { store } = await txStore(STORE_ATTIVITA_GIORNI, 'readwrite');
  return reqAsPromise(store.put(record));
}

async function eliminaGiornoAttivita(id) {
  const { store } = await txStore(STORE_ATTIVITA_GIORNI, 'readwrite');
  return reqAsPromise(store.delete(id));
}

async function getGiorniAttivitaDelMese(meseAnno, dipendente) {
  const { store } = await txStore(STORE_ATTIVITA_GIORNI, 'readonly');
  const idx = store.index('meseAnno');
  const result = await reqAsPromise(idx.getAll(meseAnno));
  return result
    .filter(g => g.dipendente === dipendente)
    .sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
}

async function getTuttiIGiorniAttivita(dipendente) {
  const { store } = await txStore(STORE_ATTIVITA_GIORNI, 'readonly');
  const result = await reqAsPromise(store.getAll());
  return result.filter(g => g.dipendente === dipendente);
}

async function getStatoMeseAttivita(meseAnno) {
  const { store } = await txStore(STORE_STATO_MESI_ATTIVITA, 'readonly');
  const result = await reqAsPromise(store.get(meseAnno));
  return result || { meseAnno, chiuso: false, dataChiusura: null };
}

async function setStatoMeseAttivita(meseAnno, chiuso) {
  const { store } = await txStore(STORE_STATO_MESI_ATTIVITA, 'readwrite');
  const record = { meseAnno, chiuso, dataChiusura: chiuso ? new Date().toISOString() : null };
  return reqAsPromise(store.put(record));
}

async function determinaMeseAttivoAttivitaIniziale(dipendente) {
  const correnteMese = meseAnnoCorrente();
  const [tuttiGiorni, statiDb] = await Promise.all([
    getTuttiIGiorniAttivita(dipendente),
    (async () => {
      const { store } = await txStore(STORE_STATO_MESI_ATTIVITA, 'readonly');
      return reqAsPromise(store.getAll());
    })()
  ]);

  const conteggi = new Map();
  for (const g of tuttiGiorni) conteggi.set(g.meseAnno, (conteggi.get(g.meseAnno) || 0) + 1);
  const statiMap = new Map(statiDb.map(s => [s.meseAnno, s]));

  const precedentiAperti = [...conteggi.keys()]
    .filter(m => m < correnteMese && !statiMap.get(m)?.chiuso && conteggi.get(m) > 0)
    .sort();

  return precedentiAperti.length > 0 ? precedentiAperti[0] : correnteMese;
}

async function getFirma(dipendente) {
  if (!dipendente) return null;
  const { store } = await txStore(STORE_FIRME, 'readonly');
  const result = await reqAsPromise(store.get(dipendente));
  return result ? result.immagine : null;
}

async function salvaFirma(dipendente, blob) {
  const { store } = await txStore(STORE_FIRME, 'readwrite');
  return reqAsPromise(store.put({ dipendente, immagine: blob }));
}

async function eliminaFirma(dipendente) {
  const { store } = await txStore(STORE_FIRME, 'readwrite');
  return reqAsPromise(store.delete(dipendente));
}

function pulisciFirma(sourceCanvas) {
  const { width, height } = sourceCanvas;
  const ctx = sourceCanvas.getContext('2d');
  const dati = ctx.getImageData(0, 0, width, height);
  const px = dati.data;

  const SOGLIA_SCURA = 90;
  const SOGLIA_CHIARA = 110;
  const [inkR, inkG, inkB] = [20, 20, 90];

  for (let i = 0; i < px.length; i += 4) {
    const r = px[i], g = px[i + 1], b = px[i + 2];
    const luminosita = 0.299 * r + 0.587 * g + 0.114 * b;

    let alpha;
    if (luminosita <= SOGLIA_SCURA) alpha = 255;
    else if (luminosita >= SOGLIA_CHIARA) alpha = 0;
    else alpha = Math.round(255 * (SOGLIA_CHIARA - luminosita) / (SOGLIA_CHIARA - SOGLIA_SCURA));

    px[i] = inkR;
    px[i + 1] = inkG;
    px[i + 2] = inkB;
    px[i + 3] = alpha;
  }

  ctx.putImageData(dati, 0, 0);
  return new Promise((resolve) => sourceCanvas.toBlob(resolve, 'image/png'));
}

async function gestisciCaricamentoFirma(file) {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  if (!dipendente) {
    alert('Seleziona prima un dipendente nell\'hub.');
    return;
  }

  const img = new Image();
  const url = URL.createObjectURL(file);
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  URL.revokeObjectURL(url);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d').drawImage(img, 0, 0);

  const blobPulito = await pulisciFirma(canvas);
  await salvaFirma(dipendente, blobPulito);
  await aggiornaStatoFirma();
  alert(`Firma salvata per ${dipendente}.`);
}

async function aggiornaStatoFirma() {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  if (!dipendente) {
    el.statoFirma.textContent = 'Seleziona un dipendente nell\'hub per gestire la firma.';
    el.btnEliminaFirma.classList.add('hidden');
    return;
  }
  const firma = await getFirma(dipendente);
  el.statoFirma.textContent = firma
    ? `Firma salvata per ${dipendente}.`
    : `Nessuna firma salvata per ${dipendente} (il PDF verrà esportato senza firma).`;
  el.btnEliminaFirma.classList.toggle('hidden', !firma);
}

async function getTuttiIMesi() {
  const [ricevuteDb, statiDb] = await Promise.all([
    (async () => {
      const { store } = await txStore(STORE_RICEVUTE, 'readonly');
      return reqAsPromise(store.getAll());
    })(),
    (async () => {
      const { store } = await txStore(STORE_STATO_MESI, 'readonly');
      return reqAsPromise(store.getAll());
    })()
  ]);

  const conteggi = new Map();
  for (const r of ricevuteDb) {
    if (!conteggi.has(r.meseAnno)) conteggi.set(r.meseAnno, { generico: 0, gasolio: 0 });
    conteggi.get(r.meseAnno)[r.categoria === 'gasolio' ? 'gasolio' : 'generico']++;
  }

  const statiMap = new Map(statiDb.map(s => [s.meseAnno, s]));

  const mesi = new Set([...conteggi.keys(), ...statiMap.keys()]);
  const lista = [...mesi].map(meseAnno => ({
    meseAnno,
    generico: conteggi.get(meseAnno)?.generico || 0,
    gasolio: conteggi.get(meseAnno)?.gasolio || 0,
    chiuso: statiMap.get(meseAnno)?.chiuso || false
  }));

  lista.sort((a, b) => b.meseAnno.localeCompare(a.meseAnno));
  return lista;
}

/* =========================================================
   STATO APPLICAZIONE
   ========================================================= */

const stato = {
  meseAttivo: meseAnnoCorrente(),
  cameraCategoria: null,
  cameraStream: null,
  overlayRicevutaId: null,
  dataScontrino: dataISOCorrente(),
  fotoGrezza: null,
  angoli: null,
  angoloTrascinato: null,
  meseAttivoRimborso: meseAnnoCorrente(),
  meseAttivoAttivita: meseAnnoCorrente(),
  anagraficaClienti: [],
  anagraficaCorrente: null,
  tappeCounter: 0,
  giornoInModifica: null
};

/* =========================================================
   RIFERIMENTI DOM
   ========================================================= */

const el = {
  splashScreen: document.getElementById('splash-screen'),
  viewHub: document.getElementById('view-hub'),
  selectDipendente: document.getElementById('select-dipendente'),
  cardScontrini: document.getElementById('card-scontrini'),
  cardRimborso: document.getElementById('card-rimborso'),
  cardAttivita: document.getElementById('card-attivita'),

  viewAttivita: document.getElementById('view-attivita'),
  btnTornaHubAttivita: document.getElementById('btn-torna-hub-attivita'),
  btnPrevMonthAttivita: document.getElementById('btn-prev-month-attivita'),
  btnNextMonthAttivita: document.getElementById('btn-next-month-attivita'),
  monthLabelAttivita: document.getElementById('month-label-attivita'),
  monthClosedBadgeAttivita: document.getElementById('month-closed-badge-attivita'),
  btnReopenMonthAttivita: document.getElementById('btn-reopen-month-attivita'),
  btnAddGiorno: document.getElementById('btn-add-giorno'),
  listaGiorniAttivita: document.getElementById('lista-giorni-attivita'),
  listaGiorniAttivitaEmpty: document.getElementById('lista-giorni-attivita-empty'),
  btnExportAttivita: document.getElementById('btn-export-attivita'),
  btnCloseMonthAttivita: document.getElementById('btn-close-month-attivita'),
  btnApriAnagrafica: document.getElementById('btn-apri-anagrafica'),
  btnImportaAttivita: document.getElementById('btn-importa-attivita'),
  inputImportaAttivita: document.getElementById('input-importa-attivita'),

  viewAnagrafica: document.getElementById('view-attivita-anagrafica'),
  btnAnagraficaAnnulla: document.getElementById('btn-anagrafica-annulla'),
  inputTC: document.getElementById('input-tc'),
  inputOrarioInizio: document.getElementById('input-orario-inizio'),
  inputOrarioFine: document.getElementById('input-orario-fine'),
  listaClientiAnagrafica: document.getElementById('lista-clienti-anagrafica'),
  btnAggiungiCliente: document.getElementById('btn-aggiungi-cliente'),
  btnSalvaAnagrafica: document.getElementById('btn-salva-anagrafica'),

  viewGiornoForm: document.getElementById('view-giorno-form'),
  btnGiornoFormAnnulla: document.getElementById('btn-giorno-form-annulla'),
  formGiorno: document.getElementById('form-giorno'),
  inputGiornoData: document.getElementById('input-giorno-data'),
  bloccoFerie: document.getElementById('blocco-ferie'),
  inputFerieLuogo: document.getElementById('input-ferie-luogo'),
  bloccoMalattia: document.getElementById('blocco-malattia'),
  inputMalattiaNote: document.getElementById('input-malattia-note'),
  bloccoInfortunio: document.getElementById('blocco-infortunio'),
  inputInfortunioNote: document.getElementById('input-infortunio-note'),
  bloccoSmart: document.getElementById('blocco-smart'),
  selectSmartCliente: document.getElementById('select-smart-cliente'),
  inputSmartNote: document.getElementById('input-smart-note'),
  btnMicSmartNote: document.getElementById('btn-mic-smart-note'),
  bloccoNormale: document.getElementById('blocco-normale'),
  listaTappe: document.getElementById('lista-tappe'),
  btnAggiungiTappa: document.getElementById('btn-aggiungi-tappa'),
  avvisoMultiCliente: document.getElementById('avviso-multi-cliente'),
  titoloGiornoForm: document.getElementById('titolo-giorno-form'),
  btnSalvaGiorno: document.getElementById('btn-salva-giorno'),
  btnMicGiornata: document.getElementById('btn-mic-giornata'),
  statoDettaturaGiornata: document.getElementById('stato-dettatura-giornata'),

  btnEsportaBackup: document.getElementById('btn-esporta-backup'),
  btnImportaBackup: document.getElementById('btn-importa-backup'),
  inputImportaBackup: document.getElementById('input-importa-backup'),
  btnDatiFatturazione: document.getElementById('btn-dati-fatturazione'),
  viewFatturazione: document.getElementById('view-fatturazione'),
  btnTornaHubFatturazione: document.getElementById('btn-torna-hub-fatturazione'),
  imgQrFatturazione: document.getElementById('img-qr-fatturazione'),
  btnTornaHub: document.getElementById('btn-torna-hub'),

  viewRimborso: document.getElementById('view-rimborso'),
  btnTornaHubRimborso: document.getElementById('btn-torna-hub-rimborso'),
  btnPrevMonthRimborso: document.getElementById('btn-prev-month-rimborso'),
  btnNextMonthRimborso: document.getElementById('btn-next-month-rimborso'),
  monthLabelRimborso: document.getElementById('month-label-rimborso'),
  monthClosedBadgeRimborso: document.getElementById('month-closed-badge-rimborso'),
  btnReopenMonthRimborso: document.getElementById('btn-reopen-month-rimborso'),
  btnCloseMonthRimborso: document.getElementById('btn-close-month-rimborso'),
  btnExportRimborso: document.getElementById('btn-export-rimborso'),
  statoFirma: document.getElementById('stato-firma'),
  btnCaricaFirma: document.getElementById('btn-carica-firma'),
  btnEliminaFirma: document.getElementById('btn-elimina-firma'),
  inputFirmaUpload: document.getElementById('input-firma-upload'),
  btnAddSpesa: document.getElementById('btn-add-spesa'),
  listaSpese: document.getElementById('lista-spese'),
  listaSpeseEmpty: document.getElementById('lista-spese-empty'),
  totaleCarta: document.getElementById('totale-carta'),
  totaleDipendente: document.getElementById('totale-dipendente'),

  viewSpesaForm: document.getElementById('view-spesa-form'),
  formSpesa: document.getElementById('form-spesa'),
  btnSpesaFormAnnulla: document.getElementById('btn-spesa-form-annulla'),
  inputSpesaData: document.getElementById('input-spesa-data'),
  inputSpesaEsercente: document.getElementById('input-spesa-esercente'),
  listaEsercenti: document.getElementById('lista-esercenti'),
  inputSpesaLuogo: document.getElementById('input-spesa-luogo'),
  inputSpesaDescrizione: document.getElementById('input-spesa-descrizione'),
  inputSpesaImporto: document.getElementById('input-spesa-importo'),
  inputSpesaNote: document.getElementById('input-spesa-note'),

  viewDashboard: document.getElementById('view-dashboard'),
  viewArchive: document.getElementById('view-archive'),
  viewCamera: document.getElementById('view-camera'),

  btnPrevMonth: document.getElementById('btn-prev-month'),
  btnNextMonth: document.getElementById('btn-next-month'),
  monthLabel: document.getElementById('month-label'),
  monthClosedBadge: document.getElementById('month-closed-badge'),
  counterText: document.getElementById('counter-text'),

  btnCaptureGenerico: document.getElementById('btn-capture-generico'),
  btnCaptureGasolio: document.getElementById('btn-capture-gasolio'),
  btnReopenMonth: document.getElementById('btn-reopen-month'),

  gallery: document.getElementById('gallery'),
  galleryEmpty: document.getElementById('gallery-empty'),

  btnExportGenerico: document.getElementById('btn-export-generico'),
  btnExportGasolio: document.getElementById('btn-export-gasolio'),
  btnCloseMonth: document.getElementById('btn-close-month'),

  linkArchive: document.getElementById('link-archive'),
  btnArchiveBack: document.getElementById('btn-archive-back'),
  archiveList: document.getElementById('archive-list'),

  cameraVideo: document.getElementById('camera-video'),
  cameraCanvas: document.getElementById('camera-canvas'),
  cameraFlash: document.getElementById('camera-flash'),
  cameraCategoryLabel: document.getElementById('camera-category-label'),
  btnCameraShutter: document.getElementById('btn-camera-shutter'),
  btnCameraCancel: document.getElementById('btn-camera-cancel'),

  viewRifinisci: document.getElementById('view-rifinisci'),
  rifinisciStage: document.getElementById('rifinisci-stage'),
  rifinisciImg: document.getElementById('rifinisci-img'),
  rifinisciPoly: document.getElementById('rifinisci-poly'),
  rifinisciHandles: [
    document.getElementById('handle-0'),
    document.getElementById('handle-1'),
    document.getElementById('handle-2'),
    document.getElementById('handle-3')
  ],
  rifinisciFlash: document.getElementById('rifinisci-flash'),
  inputDataRifinisci: document.getElementById('input-data-rifinisci'),
  btnRifinisciAnnulla: document.getElementById('btn-rifinisci-annulla'),
  btnRifinisciConferma: document.getElementById('btn-rifinisci-conferma'),
  rifinisciLoading: document.getElementById('rifinisci-loading'),

  photoOverlay: document.getElementById('photo-overlay'),
  overlayImage: document.getElementById('overlay-image'),
  overlayTimestamp: document.getElementById('overlay-timestamp'),
  btnOverlayClose: document.getElementById('btn-overlay-close'),
  btnOverlayDelete: document.getElementById('btn-overlay-delete'),

  confirmDialog: document.getElementById('confirm-dialog'),
  confirmMessage: document.getElementById('confirm-message'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmOk: document.getElementById('confirm-ok')
};

/* =========================================================
   DIALOGO DI CONFERMA GENERICO
   ========================================================= */

function chiediConferma(messaggio) {
  return new Promise((resolve) => {
    el.confirmMessage.textContent = messaggio;
    el.confirmDialog.classList.remove('hidden');

    const onOk = () => { pulisci(); resolve(true); };
    const onCancel = () => { pulisci(); resolve(false); };
    function pulisci() {
      el.confirmDialog.classList.add('hidden');
      el.confirmOk.removeEventListener('click', onOk);
      el.confirmCancel.removeEventListener('click', onCancel);
    }
    el.confirmOk.addEventListener('click', onOk);
    el.confirmCancel.addEventListener('click', onCancel);
  });
}

/* =========================================================
   NAVIGAZIONE MESE ATTIVO
   ========================================================= */

async function determinaMeseAttivoIniziale() {
  const correnteMese = meseAnnoCorrente();
  const mesi = await getTuttiIMesi();
  const precedentiAperti = mesi
    .filter(m => m.meseAnno < correnteMese && !m.chiuso && (m.generico + m.gasolio) > 0)
    .sort((a, b) => a.meseAnno.localeCompare(b.meseAnno));

  return precedentiAperti.length > 0 ? precedentiAperti[0].meseAnno : correnteMese;
}

async function cambiaMese(delta) {
  stato.meseAttivo = aggiungiMesi(stato.meseAttivo, delta);
  await aggiornaDashboard();
}

/* =========================================================
   RENDER DASHBOARD
   ========================================================= */

async function aggiornaDashboard() {
  el.monthLabel.textContent = etichettaMese(stato.meseAttivo);

  const [statoMese, ricevute] = await Promise.all([
    getStatoMese(stato.meseAttivo),
    getRicevuteDelMese(stato.meseAttivo)
  ]);

  const chiuso = statoMese.chiuso;
  el.monthClosedBadge.classList.toggle('hidden', !chiuso);
  el.btnCaptureGenerico.disabled = chiuso;
  el.btnCaptureGasolio.disabled = chiuso;
  el.btnReopenMonth.classList.toggle('hidden', !chiuso);

  const generico = ricevute.filter(r => r.categoria === 'generico').length;
  const gasolio = ricevute.filter(r => r.categoria === 'gasolio').length;
  el.counterText.textContent = `${generico} rimborsi · ${gasolio} gasolio`;

  renderGalleria(ricevute);
}

function renderGalleria(ricevute) {
  el.gallery.innerHTML = '';
  const ordinate = [...ricevute].sort((a, b) => chiaveOrdinamento(b).localeCompare(chiaveOrdinamento(a)) || b.timestamp.localeCompare(a.timestamp));

  el.galleryEmpty.classList.toggle('hidden', ordinate.length > 0);

  for (const r of ordinate) {
    const div = document.createElement('div');
    div.className = 'thumb';
    div.dataset.id = r.id;

    const img = document.createElement('img');
    img.src = URL.createObjectURL(r.immagine);
    img.loading = 'lazy';
    div.appendChild(img);

    const badge = document.createElement('span');
    badge.className = 'thumb-badge';
    badge.textContent = r.categoria === 'gasolio' ? '⛽' : '📷';
    div.appendChild(badge);

    div.addEventListener('click', () => apriOverlay(r));
    el.gallery.appendChild(div);
  }
}

/* =========================================================
   OVERLAY ANTEPRIMA / ELIMINAZIONE
   ========================================================= */

function apriOverlay(ricevuta) {
  stato.overlayRicevutaId = ricevuta.id;
  el.overlayImage.src = URL.createObjectURL(ricevuta.immagine);
  const caricata = new Date(ricevuta.timestamp).toLocaleString('it-IT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  if (ricevuta.dataScontrino) {
    el.overlayTimestamp.textContent = `Scontrino del ${etichettaDataScontrino(ricevuta.dataScontrino)} · caricato il ${caricata}`;
  } else {
    el.overlayTimestamp.textContent = `Caricato il ${caricata}`;
  }
  el.photoOverlay.classList.remove('hidden');
}

function chiudiOverlay() {
  el.photoOverlay.classList.add('hidden');
  stato.overlayRicevutaId = null;
}

async function eliminaRicevutaCorrente() {
  const conferma = await chiediConferma('Eliminare definitivamente questa ricevuta?');
  if (!conferma) return;
  await eliminaRicevuta(stato.overlayRicevutaId);
  chiudiOverlay();
  await aggiornaDashboard();
}

/* =========================================================
   FOTOCAMERA
   ========================================================= */

async function apriFotocamera(categoria) {
  stato.cameraCategoria = categoria;
  el.cameraCategoryLabel.textContent = categoria === 'gasolio' ? '⛽ Gasolio' : '📷 Rimborso';
  el.viewCamera.classList.remove('hidden');

  try {
    stato.cameraStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 2560 },
        height: { ideal: 1440 }
      },
      audio: false
    });
    el.cameraVideo.srcObject = stato.cameraStream;
  } catch (err) {
    alert('Impossibile accedere alla fotocamera: ' + err.message);
    chiudiFotocamera();
  }
}

function chiudiFotocamera() {
  if (stato.cameraStream) {
    stato.cameraStream.getTracks().forEach(t => t.stop());
    stato.cameraStream = null;
  }
  el.viewCamera.classList.add('hidden');
}

function comprimiImmagine(sourceCanvas) {
  const { width, height } = sourceCanvas;
  const latoLungo = Math.max(width, height);
  const scala = latoLungo > MAX_LATO_LUNGO ? MAX_LATO_LUNGO / latoLungo : 1;
  const targetW = Math.round(width * scala);
  const targetH = Math.round(height * scala);

  const outCanvas = document.createElement('canvas');
  outCanvas.width = targetW;
  outCanvas.height = targetH;
  const ctx = outCanvas.getContext('2d');
  ctx.filter = 'contrast(1.15) saturate(1.05)';
  ctx.drawImage(sourceCanvas, 0, 0, targetW, targetH);

  return new Promise((resolve) => {
    outCanvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY);
  });
}

function scattaFoto() {
  const video = el.cameraVideo;
  const canvas = el.cameraCanvas;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  const grezza = document.createElement('canvas');
  grezza.width = canvas.width;
  grezza.height = canvas.height;
  grezza.getContext('2d').drawImage(canvas, 0, 0);
  stato.fotoGrezza = grezza;

  if (navigator.vibrate) navigator.vibrate(60);

  chiudiFotocamera();
  apriRifinisci();
}

function mostraFlash(elemento) {
  return new Promise((resolve) => {
    elemento.classList.remove('hidden');
    void elemento.offsetWidth;
    elemento.classList.remove('hidden');
    setTimeout(() => {
      elemento.classList.add('hidden');
      resolve();
    }, 350);
  });
}

/* =========================================================
   RIFINITURA: SELEZIONE ANGOLI + CORREZIONE PROSPETTICA
   ========================================================= */

function apriRifinisci() {
  const url = URL.createObjectURL(dataURLtoBlobSync(stato.fotoGrezza));
  el.rifinisciImg.onload = () => {
    URL.revokeObjectURL(url);
    inizializzaAngoliDefault();
    renderPoligono();
  };
  el.rifinisciImg.src = url;

  el.inputDataRifinisci.value = stato.dataScontrino;
  el.viewRifinisci.classList.remove('hidden');
}

function dataURLtoBlobSync(canvas) {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)[1];
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function inizializzaAngoliDefault() {
  const rect = el.rifinisciImg.getBoundingClientRect();
  const stageRect = el.rifinisciStage.getBoundingClientRect();
  const left = rect.left - stageRect.left;
  const top = rect.top - stageRect.top;
  const margineX = rect.width * 0.1;
  const margineY = rect.height * 0.1;

  stato.angoli = [
    { x: left + margineX, y: top + margineY },
    { x: left + rect.width - margineX, y: top + margineY },
    { x: left + rect.width - margineX, y: top + rect.height - margineY },
    { x: left + margineX, y: top + rect.height - margineY }
  ];
}

function renderPoligono() {
  const punti = stato.angoli.map(p => `${p.x},${p.y}`).join(' ');
  el.rifinisciPoly.setAttribute('points', punti);
  stato.angoli.forEach((p, i) => {
    el.rifinisciHandles[i].style.left = `${p.x}px`;
    el.rifinisciHandles[i].style.top = `${p.y}px`;
  });
}

function limitaAlloStage(x, y) {
  const stageRect = el.rifinisciStage.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(stageRect.width, x)),
    y: Math.max(0, Math.min(stageRect.height, y))
  };
}

function onHandlePointerDown(e) {
  const idx = Number(e.currentTarget.dataset.idx);
  stato.angoloTrascinato = idx;
  e.currentTarget.setPointerCapture(e.pointerId);
  e.preventDefault();
}

function onStagePointerMove(e) {
  if (stato.angoloTrascinato === null) return;
  const stageRect = el.rifinisciStage.getBoundingClientRect();
  const punto = limitaAlloStage(e.clientX - stageRect.left, e.clientY - stageRect.top);
  stato.angoli[stato.angoloTrascinato] = punto;
  renderPoligono();
  e.preventDefault();
}

function onStagePointerUp() {
  stato.angoloTrascinato = null;
}

function chiudiRifinisci() {
  el.viewRifinisci.classList.add('hidden');
  stato.fotoGrezza = null;
  stato.angoli = null;
  stato.angoloTrascinato = null;
}

function annullaRifinisci() {
  chiudiRifinisci();
}

function mappaAngoliSuSorgente() {
  const imgRect = el.rifinisciImg.getBoundingClientRect();
  const stageRect = el.rifinisciStage.getBoundingClientRect();
  const natW = el.rifinisciImg.naturalWidth;
  const natH = el.rifinisciImg.naturalHeight;
  const scala = Math.min(imgRect.width / natW, imgRect.height / natH);

  const imgLeft = imgRect.left - stageRect.left;
  const imgTop = imgRect.top - stageRect.top;

  return stato.angoli.map(p => ({
    x: (p.x - imgLeft) / scala,
    y: (p.y - imgTop) / scala
  }));
}

function invertiMat3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];

  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const Dd = c * h - b * i;
  const E = a * i - c * g;
  const F = b * g - a * h;
  const G = b * f - c * e;
  const H = c * d - a * f;
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  const invDet = 1 / det;

  return [
    A * invDet, Dd * invDet, G * invDet,
    B * invDet, E * invDet, H * invDet,
    C * invDet, F * invDet, I * invDet
  ];
}

function moltiplicaMat3(A, B) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i * 3 + k] * B[k * 3 + j];
      r[i * 3 + j] = s;
    }
  }
  return r;
}

function affineDaTriangoli(src, dst) {
  const P = [src[0].x, src[1].x, src[2].x, src[0].y, src[1].y, src[2].y, 1, 1, 1];
  const Q = [dst[0].x, dst[1].x, dst[2].x, dst[0].y, dst[1].y, dst[2].y, 1, 1, 1];
  const M = moltiplicaMat3(Q, invertiMat3(P));
  return { a: M[0], c: M[1], e: M[2], b: M[3], d: M[4], f: M[5] };
}

function disegnaTriangoloWarp(ctx, sorgente, src3, dst3) {
  const minX = Math.max(0, Math.floor(Math.min(src3[0].x, src3[1].x, src3[2].x)) - 1);
  const minY = Math.max(0, Math.floor(Math.min(src3[0].y, src3[1].y, src3[2].y)) - 1);
  const maxX = Math.min(sorgente.width, Math.ceil(Math.max(src3[0].x, src3[1].x, src3[2].x)) + 1);
  const maxY = Math.min(sorgente.height, Math.ceil(Math.max(src3[0].y, src3[1].y, src3[2].y)) + 1);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  const srcRel = src3.map(p => ({ x: p.x - minX, y: p.y - minY }));
  const { a, b, c, d, e, f } = affineDaTriangoli(srcRel, dst3);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(dst3[0].x, dst3[0].y);
  ctx.lineTo(dst3[1].x, dst3[1].y);
  ctx.lineTo(dst3[2].x, dst3[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(sorgente, minX, minY, w, h, 0, 0, w, h);
  ctx.restore();
}

function correggiProspettiva(sorgente, angoliSorgente, largOutput, altOutput) {
  const outCanvas = document.createElement('canvas');
  outCanvas.width = largOutput;
  outCanvas.height = altOutput;
  const ctx = outCanvas.getContext('2d');

  const COLONNE = 18, RIGHE = 24;
  const [tl, tr, br, bl] = angoliSorgente;

  function puntoSorgente(u, v) {
    const top = { x: tl.x + (tr.x - tl.x) * u, y: tl.y + (tr.y - tl.y) * u };
    const bottom = { x: bl.x + (br.x - bl.x) * u, y: bl.y + (br.y - bl.y) * u };
    return { x: top.x + (bottom.x - top.x) * v, y: top.y + (bottom.y - top.y) * v };
  }

  for (let riga = 0; riga < RIGHE; riga++) {
    for (let col = 0; col < COLONNE; col++) {
      const u0 = col / COLONNE, u1 = (col + 1) / COLONNE;
      const v0 = riga / RIGHE, v1 = (riga + 1) / RIGHE;

      const sTL = puntoSorgente(u0, v0);
      const sTR = puntoSorgente(u1, v0);
      const sBR = puntoSorgente(u1, v1);
      const sBL = puntoSorgente(u0, v1);

      const dTL = { x: u0 * largOutput, y: v0 * altOutput };
      const dTR = { x: u1 * largOutput, y: v0 * altOutput };
      const dBR = { x: u1 * largOutput, y: v1 * altOutput };
      const dBL = { x: u0 * largOutput, y: v1 * altOutput };

      disegnaTriangoloWarp(ctx, sorgente, [sTL, sTR, sBR], [dTL, dTR, dBR]);
      disegnaTriangoloWarp(ctx, sorgente, [sTL, sBR, sBL], [dTL, dBR, dBL]);
    }
  }

  return outCanvas;
}

function lunghezza(p1, p2) {
  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

async function confermaRifinisci() {
  el.rifinisciLoading.classList.remove('hidden');

  await new Promise((resolve) => setTimeout(resolve, 20));

  try {
    const angoliSorgente = mappaAngoliSuSorgente();
    const [tl, tr, br, bl] = angoliSorgente;

    const largOutput = Math.round((lunghezza(tl, tr) + lunghezza(bl, br)) / 2);
    const altOutput = Math.round((lunghezza(tl, bl) + lunghezza(tr, br)) / 2);

    const warpCanvas = correggiProspettiva(
      stato.fotoGrezza,
      angoliSorgente,
      Math.max(200, largOutput),
      Math.max(200, altOutput)
    );

    const blob = await comprimiImmagine(warpCanvas);
    const dataScontrino = el.inputDataRifinisci.value || dataISOCorrente();
    stato.dataScontrino = dataScontrino;

    await salvaRicevuta({
      categoria: stato.cameraCategoria,
      timestamp: new Date().toISOString(),
      meseAnno: stato.meseAttivo,
      dataScontrino,
      immagine: blob
    });

    await mostraFlash(el.rifinisciFlash);
    chiudiRifinisci();
    await aggiornaDashboard();
  } finally {
    el.rifinisciLoading.classList.add('hidden');
  }
}

/* =========================================================
   CHIUSURA / RIAPERTURA MESE
   ========================================================= */

async function chiudiMese() {
  const conferma = await chiediConferma(
    `Hai già esportato i PDF di ${etichettaMese(stato.meseAttivo)}? Chiudendo il mese, i pulsanti di scatto verranno disattivati (potrai comunque riaprirlo in seguito).`
  );
  if (!conferma) return;
  await setStatoMese(stato.meseAttivo, true);
  await aggiornaDashboard();
}

async function riapriMese() {
  const conferma = await chiediConferma(`Riaprire ${etichettaMese(stato.meseAttivo)} per modificarlo?`);
  if (!conferma) return;
  await setStatoMese(stato.meseAttivo, false);
  await aggiornaDashboard();
}

/* =========================================================
   EXPORT PDF
   ========================================================= */

function blobADataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function caricaImmagine(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function esportaPdf(categoria, meseAnno) {
  // Il rimborso ("generico") include anche gli scontrini gasolio: un gasolio
  // e' comunque un rimborso, oltre a comparire nel suo export specifico.
  const ricevute = categoria === 'generico'
    ? await getRicevuteDelMese(meseAnno)
    : await getRicevuteDelMesePerCategoria(meseAnno, categoria);

  if (ricevute.length === 0) {
    alert(`Nessuna ricevuta ${categoria === 'gasolio' ? 'gasolio' : 'rimborso'} da esportare per ${etichettaMese(meseAnno)}.`);
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margine = 10;

  for (let i = 0; i < ricevute.length; i++) {
    if (i > 0) doc.addPage();

    const dataUrl = await blobADataUrl(ricevute[i].immagine);
    const img = await caricaImmagine(dataUrl);

    const maxW = pageW - margine * 2;
    const maxH = pageH - margine * 2;
    const scala = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * scala;
    const h = img.height * scala;
    const x = (pageW - w) / 2;
    const y = (pageH - h) / 2;

    doc.addImage(dataUrl, 'JPEG', x, y, w, h);
  }

  doc.save(nomeFileExport(categoria, meseAnno));
}

/* =========================================================
   ARCHIVIO MESI PRECEDENTI
   ========================================================= */

async function apriArchivio() {
  el.viewDashboard.classList.add('hidden');
  el.viewArchive.classList.remove('hidden');
  await renderArchivio();
}

function chiudiArchivio() {
  el.viewArchive.classList.add('hidden');
  el.viewDashboard.classList.remove('hidden');
}

async function renderArchivio() {
  const mesi = await getTuttiIMesi();
  el.archiveList.innerHTML = '';

  if (mesi.length === 0) {
    const p = document.createElement('p');
    p.className = 'archive-empty';
    p.textContent = 'Nessun mese registrato ancora.';
    el.archiveList.appendChild(p);
    return;
  }

  for (const m of mesi) {
    const div = document.createElement('div');
    div.className = 'archive-item';

    const info = document.createElement('div');
    info.className = 'archive-item-info';

    const titolo = document.createElement('span');
    titolo.className = 'archive-item-month';
    titolo.textContent = etichettaMese(m.meseAnno);
    info.appendChild(titolo);

    const conteggio = document.createElement('span');
    conteggio.className = 'archive-item-count';
    conteggio.textContent = `${m.generico} rimborsi · ${m.gasolio} gasolio`;
    info.appendChild(conteggio);

    div.appendChild(info);

    const badge = document.createElement('span');
    badge.className = 'archive-item-status ' + (m.chiuso ? 'status-closed' : 'status-open');
    badge.textContent = m.chiuso ? 'Chiuso' : 'Aperto';
    div.appendChild(badge);

    div.addEventListener('click', async () => {
      stato.meseAttivo = m.meseAnno;
      chiudiArchivio();
      await aggiornaDashboard();
    });

    el.archiveList.appendChild(div);
  }
}

/* =========================================================
   EVENT LISTENER
   ========================================================= */

el.btnPrevMonth.addEventListener('click', () => cambiaMese(-1));
el.btnNextMonth.addEventListener('click', () => cambiaMese(1));

el.btnCaptureGenerico.addEventListener('click', () => apriFotocamera('generico'));
el.btnCaptureGasolio.addEventListener('click', () => apriFotocamera('gasolio'));
el.btnCameraShutter.addEventListener('click', scattaFoto);
el.btnCameraCancel.addEventListener('click', chiudiFotocamera);

el.rifinisciHandles.forEach(handle => handle.addEventListener('pointerdown', onHandlePointerDown));
el.rifinisciStage.addEventListener('pointermove', onStagePointerMove);
el.rifinisciStage.addEventListener('pointerup', onStagePointerUp);
el.rifinisciStage.addEventListener('pointercancel', onStagePointerUp);
el.btnRifinisciAnnulla.addEventListener('click', annullaRifinisci);
el.btnRifinisciConferma.addEventListener('click', confermaRifinisci);

el.btnReopenMonth.addEventListener('click', riapriMese);
el.btnCloseMonth.addEventListener('click', chiudiMese);

el.btnExportGenerico.addEventListener('click', () => esportaPdf('generico', stato.meseAttivo));
el.btnExportGasolio.addEventListener('click', () => esportaPdf('gasolio', stato.meseAttivo));

el.linkArchive.addEventListener('click', (e) => { e.preventDefault(); apriArchivio(); });
el.btnArchiveBack.addEventListener('click', chiudiArchivio);

el.btnOverlayClose.addEventListener('click', chiudiOverlay);
el.btnOverlayDelete.addEventListener('click', eliminaRicevutaCorrente);

/* =========================================================
   HUB / DIPENDENTE ATTIVO
   ========================================================= */

function inizializzaDipendente() {
  const salvato = localStorage.getItem('dipendenteAttivo');
  if (salvato) el.selectDipendente.value = salvato;
}

function apriScontrini() {
  el.viewHub.classList.add('hidden');
  el.viewDashboard.classList.remove('hidden');
}

function tornaAllHub() {
  el.viewDashboard.classList.add('hidden');
  el.viewHub.classList.remove('hidden');
}

function apriFatturazione() {
  el.viewHub.classList.add('hidden');
  el.viewFatturazione.classList.remove('hidden');
}

function tornaAllHubDaFatturazione() {
  el.viewFatturazione.classList.add('hidden');
  el.viewHub.classList.remove('hidden');
}

function verificaQrFatturazione() {
  if (el.imgQrFatturazione.complete && el.imgQrFatturazione.naturalWidth === 0) {
    el.imgQrFatturazione.closest('.fatturazione-qr').classList.add('hidden');
  }
}
el.imgQrFatturazione.addEventListener('error', verificaQrFatturazione);
verificaQrFatturazione();

/* =========================================================
   ATTIVITÀ — navigazione e rendering
   ========================================================= */

async function apriAttivita() {
  el.viewHub.classList.add('hidden');
  el.viewAttivita.classList.remove('hidden');
  await aggiornaAttivita();
}

function tornaAllHubDaAttivita() {
  el.viewAttivita.classList.add('hidden');
  el.viewHub.classList.remove('hidden');
}

async function cambiaMeseAttivita(delta) {
  stato.meseAttivoAttivita = aggiungiMesi(stato.meseAttivoAttivita, delta);
  await aggiornaAttivita();
}

async function aggiornaAttivita() {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  el.monthLabelAttivita.textContent = etichettaMese(stato.meseAttivoAttivita);

  const [statoMese, giorni] = await Promise.all([
    getStatoMeseAttivita(stato.meseAttivoAttivita),
    getGiorniAttivitaDelMese(stato.meseAttivoAttivita, dipendente)
  ]);

  const chiuso = statoMese.chiuso;
  el.monthClosedBadgeAttivita.classList.toggle('hidden', !chiuso);
  el.btnAddGiorno.disabled = chiuso;
  el.btnReopenMonthAttivita.classList.toggle('hidden', !chiuso);

  renderListaGiorniAttivita(giorni, chiuso);
}

function renderListaGiorniAttivita(giorni, meseChiuso) {
  el.listaGiorniAttivita.innerHTML = '';
  el.listaGiorniAttivitaEmpty.classList.toggle('hidden', giorni.length > 0);

  for (const g of giorni) {
    const item = document.createElement('div');
    item.className = 'giorno-item';

    const header = document.createElement('div');
    header.className = 'giorno-item-header';

    const info = document.createElement('div');
    info.className = 'spesa-item-info';

    const dataFormattata = parseDataISO(g.data).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const etichettaTipo = g.tipoGiorno === 'ferie' ? 'Ferie'
      : g.tipoGiorno === 'malattia' ? 'Malattia'
      : g.tipoGiorno === 'infortunio' ? 'Infortunio'
      : g.tipoGiorno === 'smart' ? 'Smart working'
      : `${g.righe.length} ${g.righe.length === 1 ? 'tappa' : 'tappe'}`;

    const titolo = document.createElement('span');
    titolo.className = 'spesa-item-titolo';
    titolo.textContent = `${dataFormattata} · ${etichettaTipo}`;
    info.appendChild(titolo);

    const dettaglio = document.createElement('span');
    dettaglio.className = 'spesa-item-dettaglio';
    const clientiElencati = [...new Set(g.righe.map(r => r.cliente).filter(Boolean))].join(', ');
    dettaglio.textContent = clientiElencati || (g.righe[0] ? g.righe[0].note : '');
    info.appendChild(dettaglio);

    header.appendChild(info);

    if (g.multiClienteNonRisolto) {
      const avviso = document.createElement('span');
      avviso.className = 'spesa-item-importo';
      avviso.style.color = 'var(--danger)';
      avviso.textContent = '⚠ % da fare';
      header.appendChild(avviso);
    }

    item.appendChild(header);

    const dettaglioEspanso = document.createElement('div');
    dettaglioEspanso.className = 'giorno-item-dettaglio-espanso hidden';

    for (const r of g.righe) {
      const riga = document.createElement('p');
      riga.className = 'giorno-riga-dettaglio';
      const parti = [];
      const ePermesso = r.cliente === CLIENTE_PERMESSO;
      if (ePermesso) {
        if (r.orarioInizioPermesso) parti.push(`dalle ${r.orarioInizioPermesso}`);
        if (r.orarioFinePermesso) parti.push(`alle ${r.orarioFinePermesso}`);
        parti.push('<strong>Permesso</strong>');
      } else {
        if (r.orarioSwitch) parti.push(`dalle ${r.orarioSwitch}`);
        if (r.cliente) parti.push(`<strong>${r.cliente}${r.codice ? ' ' + r.codice : ''}</strong>`);
        if (r.cantiere) parti.push(r.cantiere);
      }
      if (r.percentuale !== null && r.percentuale !== undefined) parti.push(`${r.percentuale}%`);
      if (r.note) parti.push(r.note);
      riga.innerHTML = parti.join(' · ');
      dettaglioEspanso.appendChild(riga);
    }

    const rigaAzioni = document.createElement('div');
    rigaAzioni.className = 'giorno-azioni-espanse';

    const btnModifica = document.createElement('button');
    btnModifica.type = 'button';
    btnModifica.className = 'btn-secondary';
    btnModifica.textContent = '✏️ Modifica';
    btnModifica.disabled = meseChiuso;
    btnModifica.addEventListener('click', (e) => {
      e.stopPropagation();
      apriGiornoForm(g);
    });
    rigaAzioni.appendChild(btnModifica);

    const btnElimina = document.createElement('button');
    btnElimina.type = 'button';
    btnElimina.className = 'btn-elimina-giorno';
    btnElimina.textContent = '🗑 Elimina giornata';
    btnElimina.addEventListener('click', (e) => {
      e.stopPropagation();
      eliminaGiornoAttivitaConferma(g);
    });
    rigaAzioni.appendChild(btnElimina);

    dettaglioEspanso.appendChild(rigaAzioni);

    item.appendChild(dettaglioEspanso);

    header.addEventListener('click', () => {
      dettaglioEspanso.classList.toggle('hidden');
    });

    el.listaGiorniAttivita.appendChild(item);
  }
}

async function eliminaGiornoAttivitaConferma(giorno) {
  const dataEtichetta = parseDataISO(giorno.data).toLocaleDateString('it-IT');
  const conferma = await chiediConferma(`Eliminare la giornata del ${dataEtichetta}?`);
  if (!conferma) return;
  await eliminaGiornoAttivita(giorno.id);
  await aggiornaAttivita();
}

async function chiudiMeseAttivita() {
  const conferma = await chiediConferma(
    `Chiudere ${etichettaMese(stato.meseAttivoAttivita)}? Potrai comunque riaprirlo in seguito.`
  );
  if (!conferma) return;
  await setStatoMeseAttivita(stato.meseAttivoAttivita, true);
  await aggiornaAttivita();
}

async function riapriMeseAttivita() {
  const conferma = await chiediConferma(`Riaprire ${etichettaMese(stato.meseAttivoAttivita)} per modificarlo?`);
  if (!conferma) return;
  await setStatoMeseAttivita(stato.meseAttivoAttivita, false);
  await aggiornaAttivita();
}

/* =========================================================
   ATTIVITÀ — anagrafica clienti/cantieri
   ========================================================= */

async function apriAnagrafica() {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  if (!dipendente) {
    alert('Seleziona prima un dipendente nell\'hub.');
    return;
  }
  const anagrafica = await getAnagraficaAttivita(dipendente);
  stato.anagraficaClienti = JSON.parse(JSON.stringify(anagrafica.clienti || []));
  el.inputTC.value = anagrafica.tc || suggerisciSiglaTC(dipendente);
  el.inputOrarioInizio.value = anagrafica.orarioInizio || '08:00';
  el.inputOrarioFine.value = anagrafica.orarioFine || '17:00';
  renderAnagraficaClienti();

  el.viewAttivita.classList.add('hidden');
  el.viewAnagrafica.classList.remove('hidden');
}

function chiudiAnagrafica() {
  el.viewAnagrafica.classList.add('hidden');
  el.viewAttivita.classList.remove('hidden');
}

function renderAnagraficaClienti() {
  el.listaClientiAnagrafica.innerHTML = '';

  stato.anagraficaClienti.forEach((cliente, ci) => {
    const div = document.createElement('div');
    div.className = 'anagrafica-cliente';

    const inputNome = document.createElement('input');
    inputNome.className = 'anagrafica-cliente-nome';
    inputNome.type = 'text';
    inputNome.placeholder = 'Nome cliente (es. PEI)';
    inputNome.value = cliente.nome;
    inputNome.addEventListener('input', () => { cliente.nome = inputNome.value; });
    div.appendChild(inputNome);

    const subContainer = document.createElement('div');
    subContainer.className = 'anagrafica-sottoclienti';

    cliente.sottoclienti.forEach((sc, si) => {
      const subDiv = document.createElement('div');
      subDiv.className = 'anagrafica-sottocliente';

      const inputCodice = document.createElement('input');
      inputCodice.type = 'text';
      inputCodice.placeholder = 'Codice (es. P.223)';
      inputCodice.value = sc.codice;
      inputCodice.addEventListener('input', () => { sc.codice = inputCodice.value; });

      const inputCantieri = document.createElement('input');
      inputCantieri.type = 'text';
      inputCantieri.placeholder = 'Cantieri tipici, separati da virgola';
      inputCantieri.value = sc.cantieri.join(', ');
      inputCantieri.addEventListener('input', () => {
        sc.cantieri = inputCantieri.value.split(',').map(s => s.trim()).filter(Boolean);
      });

      const rigaAzioni = document.createElement('div');
      rigaAzioni.className = 'anagrafica-riga-azioni';
      const btnRimuoviSub = document.createElement('button');
      btnRimuoviSub.type = 'button';
      btnRimuoviSub.className = 'btn-rimuovi-mini';
      btnRimuoviSub.textContent = '✕ Rimuovi codice';
      btnRimuoviSub.addEventListener('click', () => {
        cliente.sottoclienti.splice(si, 1);
        renderAnagraficaClienti();
      });
      rigaAzioni.appendChild(btnRimuoviSub);

      subDiv.appendChild(inputCodice);
      subDiv.appendChild(inputCantieri);
      subDiv.appendChild(rigaAzioni);
      subContainer.appendChild(subDiv);
    });
    div.appendChild(subContainer);

    const azioniCliente = document.createElement('div');
    azioniCliente.className = 'anagrafica-cliente-azioni';

    const btnAggiungiSub = document.createElement('button');
    btnAggiungiSub.type = 'button';
    btnAggiungiSub.className = 'btn-testo-mini';
    btnAggiungiSub.textContent = '+ Aggiungi codice';
    btnAggiungiSub.addEventListener('click', () => {
      cliente.sottoclienti.push({ codice: '', cantieri: [] });
      renderAnagraficaClienti();
    });

    const btnRimuoviCliente = document.createElement('button');
    btnRimuoviCliente.type = 'button';
    btnRimuoviCliente.className = 'btn-rimuovi-mini';
    btnRimuoviCliente.textContent = '🗑 Elimina cliente';
    btnRimuoviCliente.addEventListener('click', () => {
      stato.anagraficaClienti.splice(ci, 1);
      renderAnagraficaClienti();
    });

    azioniCliente.appendChild(btnAggiungiSub);
    azioniCliente.appendChild(btnRimuoviCliente);
    div.appendChild(azioniCliente);

    el.listaClientiAnagrafica.appendChild(div);
  });
}

async function salvaAnagraficaDaForm() {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  if (!dipendente) return;

  const clientiPuliti = stato.anagraficaClienti
    .filter(c => c.nome.trim())
    .map(c => ({
      nome: c.nome.trim(),
      sottoclienti: c.sottoclienti
        .filter(sc => sc.codice.trim())
        .map(sc => ({ codice: sc.codice.trim(), cantieri: sc.cantieri }))
    }));

  await salvaAnagraficaAttivita({
    dipendente,
    tc: (el.inputTC.value || '').trim().toUpperCase(),
    orarioInizio: el.inputOrarioInizio.value || '08:00',
    orarioFine: el.inputOrarioFine.value || '17:00',
    clienti: clientiPuliti
  });

  chiudiAnagrafica();
}

/* =========================================================
   ATTIVITÀ — dettatura vocale note
   ========================================================= */

function correggiTestoDettato(testo) {
  let t = testo.trim().replace(/\s+/g, ' ');
  if (!t) return t;

  const sostituzioni = [
    [/\bpunto e virgola\b/gi, ';'],
    [/\bpunto interrogativo\b/gi, '?'],
    [/\bpunto esclamativo\b/gi, '!'],
    [/\bdue punti\b/gi, ':'],
    [/\bvirgola\b/gi, ','],
    [/\bpunto\b/gi, '.']
  ];
  for (const [regex, sostituto] of sostituzioni) t = t.replace(regex, sostituto);

  t = t.replace(/\s+([,.;:!?])/g, '$1');
  t = t.charAt(0).toUpperCase() + t.slice(1);
  t = t.replace(/([.!?]\s+)([a-zàèéìòù])/g, (m, sep, lettera) => sep + lettera.toUpperCase());
  if (!/[.!?]$/.test(t)) t += '.';
  return t;
}

function abilitaDettatura(input, btnMic) {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    btnMic.classList.add('hidden');
    return;
  }

  let riconoscimento = null;

  btnMic.addEventListener('click', () => {
    if (riconoscimento) return;
    riconoscimento = new SpeechRecognitionCtor();
    riconoscimento.lang = 'it-IT';
    riconoscimento.interimResults = false;
    riconoscimento.maxAlternatives = 1;

    btnMic.classList.add('mic-attivo');

    riconoscimento.addEventListener('result', (e) => {
      const testoGrezzo = e.results[0][0].transcript;
      input.value = correggiTestoDettato(testoGrezzo);
      input.dispatchEvent(new Event('input'));
    });
    riconoscimento.addEventListener('end', () => {
      btnMic.classList.remove('mic-attivo');
      riconoscimento = null;
    });
    riconoscimento.addEventListener('error', () => {
      btnMic.classList.remove('mic-attivo');
      riconoscimento = null;
    });

    riconoscimento.start();
  });
}

/* =========================================================
   ATTIVITÀ — dettatura vocale intera giornata (AI)
   ========================================================= */

const AI_WORKER_URL = 'https://lb-gestionale-ai.arianuova.workers.dev';

function formGiornoHaContenuto() {
  const tappaConDati = [...el.listaTappe.children].some(div => div.querySelector('.tappa-cliente').value);
  return Boolean(
    tappaConDati ||
    el.inputFerieLuogo.value ||
    el.inputMalattiaNote.value ||
    el.inputInfortunioNote.value ||
    el.inputSmartNote.value ||
    el.selectSmartCliente.value
  );
}

function applicaTappaAI(div, tappa) {
  const ePermesso = tappa.cliente === 'PERMESSO';
  const selectCliente = div.querySelector('.tappa-cliente');
  selectCliente.value = ePermesso ? CLIENTE_PERMESSO : (tappa.cliente || '');
  selectCliente.dispatchEvent(new Event('change'));
  if (ePermesso) {
    div.querySelector('.tappa-permesso-inizio').value = tappa.orario || '';
    div.querySelector('.tappa-permesso-fine').value = tappa.orarioFinePermesso || '';
  } else {
    const selectCantiere = div.querySelector('.tappa-cantiere');
    selectCantiere.value = tappa.cantiere || '';
    selectCantiere.dispatchEvent(new Event('change'));
    div.querySelector('.tappa-orario-switch').value = tappa.orario || '';
  }
  div.querySelector('.tappa-note').value = tappa.note || '';
}

function applicaRisultatoAI(risultato) {
  const tipiValidi = ['normale', 'ferie', 'malattia', 'infortunio', 'smart'];
  if (!tipiValidi.includes(risultato.tipoGiorno)) return false;

  const radio = document.querySelector(`input[name="tipo-giorno"][value="${risultato.tipoGiorno}"]`);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));

  if (risultato.tipoGiorno === 'ferie') {
    el.inputFerieLuogo.value = risultato.note || '';
  } else if (risultato.tipoGiorno === 'malattia') {
    el.inputMalattiaNote.value = risultato.note || '';
  } else if (risultato.tipoGiorno === 'infortunio') {
    el.inputInfortunioNote.value = risultato.note || '';
  } else if (risultato.tipoGiorno === 'smart') {
    const tappa = (risultato.tappe || [])[0];
    if (tappa) {
      el.selectSmartCliente.value = tappa.cliente || '';
      el.inputSmartNote.value = tappa.note || '';
    }
  } else {
    el.listaTappe.innerHTML = '';
    stato.tappeCounter = 0;
    for (const tappa of (risultato.tappe || [])) {
      aggiungiTappaVuota();
      applicaTappaAI(el.listaTappe.lastElementChild, tappa);
    }
    if (el.listaTappe.children.length === 0) aggiungiTappaVuota();
    aggiornaAvvisoMultiCliente();
    aggiornaOrariTappe();
  }
  return true;
}

function costruisciClientiPerAI() {
  return stato.anagraficaCorrente.clienti.map(c => ({
    nome: c.nome,
    cantieri: [...new Set(c.sottoclienti.flatMap(sc => sc.cantieri))]
  }));
}

async function elaboraRaccontoGiornata(testo) {
  el.statoDettaturaGiornata.classList.remove('hidden');
  el.statoDettaturaGiornata.textContent = 'Sto elaborando quello che hai detto...';

  try {
    const risposta = await fetch(AI_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testo, clienti: costruisciClientiPerAI(), modalita: 'giornata' })
    });
    if (!risposta.ok) throw new Error('il servizio non ha risposto correttamente');
    const risultato = await risposta.json();
    if (risultato.errore) throw new Error(risultato.errore);

    if (formGiornoHaContenuto()) {
      const procedi = await chiediConferma('Questo sostituirà i dati già inseriti nel modulo. Continuare?');
      if (!procedi) {
        el.statoDettaturaGiornata.classList.add('hidden');
        return;
      }
    }

    const applicato = applicaRisultatoAI(risultato);
    if (!applicato) throw new Error('risposta non riconosciuta');

    el.statoDettaturaGiornata.textContent = '✅ Fatto! Controlla i dati prima di salvare.';
    setTimeout(() => el.statoDettaturaGiornata.classList.add('hidden'), 5000);
  } catch (err) {
    el.statoDettaturaGiornata.textContent = `⚠ Non sono riuscito a elaborare il racconto (${err.message}). Riprova o compila a mano.`;
  }
}

async function elaboraRaccontoTappa(testo, div, statoTesto) {
  statoTesto.classList.remove('hidden');
  statoTesto.textContent = 'Sto elaborando quello che hai detto...';

  try {
    const risposta = await fetch(AI_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testo, clienti: costruisciClientiPerAI(), modalita: 'tappa' })
    });
    if (!risposta.ok) throw new Error('il servizio non ha risposto correttamente');
    const risultato = await risposta.json();
    if (risultato.errore) throw new Error(risultato.errore);
    const tappa = (risultato.tappe || [])[0];
    if (!tappa) throw new Error('nessuna tappa riconosciuta');

    applicaTappaAI(div, tappa);
    aggiornaAvvisoMultiCliente();
    aggiornaOrariTappe();

    statoTesto.textContent = '✅ Fatto! Controlla i dati.';
    setTimeout(() => statoTesto.classList.add('hidden'), 4000);
  } catch (err) {
    statoTesto.textContent = `⚠ Non sono riuscito a elaborare (${err.message}). Riprova o compila a mano.`;
  }
}

function avviaCatturaVocaleContinua(btnMic, statoTesto, onTrascrizioneCompleta) {
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionCtor) {
    btnMic.classList.add('hidden');
    return;
  }

  let riconoscimento = null;
  const testoBase = btnMic.textContent;

  btnMic.addEventListener('click', () => {
    if (riconoscimento) {
      riconoscimento.stop();
      return;
    }

    let trascrizioneFinale = '';
    riconoscimento = new SpeechRecognitionCtor();
    riconoscimento.lang = 'it-IT';
    riconoscimento.continuous = true;
    riconoscimento.interimResults = true;

    btnMic.classList.add('mic-attivo');
    btnMic.textContent = '⏹ Ferma registrazione';
    statoTesto.classList.remove('hidden');
    statoTesto.textContent = 'In ascolto... poi tocca "Ferma registrazione".';

    riconoscimento.addEventListener('result', (e) => {
      // Ricostruisce l'intera trascrizione da zero ad ogni evento (non concatena)
      // per evitare che alcuni motori vocali (es. Android) riemettano più volte
      // lo stesso risultato "finale", duplicando le parole.
      let finale = '';
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) {
          finale += e.results[i][0].transcript + ' ';
        } else {
          interim += e.results[i][0].transcript;
        }
      }
      trascrizioneFinale = finale;
      statoTesto.textContent = (finale + interim).trim() || 'In ascolto...';
    });

    riconoscimento.addEventListener('end', async () => {
      btnMic.classList.remove('mic-attivo');
      btnMic.textContent = testoBase;
      riconoscimento = null;

      const testo = trascrizioneFinale.trim();
      if (!testo) {
        statoTesto.classList.add('hidden');
        return;
      }
      await onTrascrizioneCompleta(testo);
    });
    riconoscimento.addEventListener('error', () => {
      btnMic.classList.remove('mic-attivo');
      btnMic.textContent = testoBase;
      statoTesto.classList.add('hidden');
      riconoscimento = null;
    });

    riconoscimento.start();
  });
}

function abilitaDettaturaGiornata(btnMic, statoTesto) {
  avviaCatturaVocaleContinua(btnMic, statoTesto, (testo) => elaboraRaccontoGiornata(testo));
}

function abilitaDettaturaTappa(btnMic, statoTesto, div) {
  avviaCatturaVocaleContinua(btnMic, statoTesto, (testo) => elaboraRaccontoTappa(testo, div, statoTesto));
}

function recordGiornoValido(r) {
  return r && typeof r === 'object' &&
    typeof r.dipendente === 'string' && r.dipendente &&
    typeof r.meseAnno === 'string' &&
    typeof r.data === 'string' &&
    typeof r.tipoGiorno === 'string' &&
    Array.isArray(r.righe);
}

async function importaAttivitaDaFile(file) {
  let record;
  try {
    const testo = await file.text();
    record = JSON.parse(testo);
  } catch (e) {
    alert('File non valido: non è un JSON leggibile.');
    return;
  }
  if (!Array.isArray(record) || record.length === 0 || !record.every(recordGiornoValido)) {
    alert('File non valido: non contiene un elenco di giornate nel formato atteso.');
    return;
  }

  const dipendenteFile = record[0].dipendente;
  const dipendenteAttivo = localStorage.getItem('dipendenteAttivo');
  const date = [...record].map(r => r.data).sort();
  const primaData = parseDataISO(date[0]).toLocaleDateString('it-IT');
  const ultimaData = parseDataISO(date[date.length - 1]).toLocaleDateString('it-IT');

  let messaggio = `Importare ${record.length} giornate per ${dipendenteFile} (dal ${primaData} al ${ultimaData})? Verranno aggiunte solo alle Attività: Rimborsi e Scontrini non vengono toccati.`;
  if (dipendenteFile !== dipendenteAttivo) {
    messaggio += `\n\nAttenzione: il dipendente attualmente selezionato è "${dipendenteAttivo}", diverso da quello nel file.`;
  }

  const mesiCoinvolti = [...new Set(record.map(r => r.meseAnno))];
  const esistentiPerMese = await Promise.all(mesiCoinvolti.map(mese => getGiorniAttivitaDelMese(mese, dipendenteFile)));
  const dateEsistenti = new Set(esistentiPerMese.flat().map(g => g.data));
  const sovrapposizioni = record.filter(r => dateEsistenti.has(r.data)).length;
  if (sovrapposizioni > 0) {
    messaggio += `\n\nAttenzione: ${sovrapposizioni} di queste giornate esistono già e verrebbero duplicate.`;
  }

  const procedi = await chiediConferma(messaggio);
  if (!procedi) return;

  for (const r of record) {
    const { id, ...senzaId } = r;
    await salvaGiornoAttivita(senzaId);
  }

  alert(`Importazione completata: ${record.length} giornate aggiunte.`);
  if (dipendenteFile === dipendenteAttivo) {
    await aggiornaAttivita();
  }
}

/* =========================================================
   ATTIVITÀ — form nuova giornata
   ========================================================= */

function popolaSelectClienti(selectEl, includiPermesso = false) {
  selectEl.innerHTML = '<option value="" disabled selected>— Seleziona —</option>';
  for (const cliente of stato.anagraficaCorrente.clienti) {
    const opt = document.createElement('option');
    opt.value = cliente.nome;
    opt.textContent = cliente.nome;
    selectEl.appendChild(opt);
  }
  if (includiPermesso) {
    const optPermesso = document.createElement('option');
    optPermesso.value = CLIENTE_PERMESSO;
    optPermesso.textContent = '🕐 Permesso';
    selectEl.appendChild(optPermesso);
  }
}

function estraiNoteSemplice(nota, prefisso) {
  if (!nota) return '';
  const conTrattino = `${prefisso} - `;
  return nota.startsWith(conTrattino) ? nota.slice(conTrattino.length) : '';
}

async function apriGiornoForm(giornoEsistente = null) {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  if (!dipendente) {
    alert('Seleziona prima un dipendente nell\'hub.');
    return;
  }

  stato.giornoInModifica = giornoEsistente;
  el.titoloGiornoForm.textContent = giornoEsistente ? 'Modifica giornata' : 'Nuova giornata';
  el.btnSalvaGiorno.textContent = giornoEsistente ? 'Salva modifiche' : 'Salva giornata';

  el.formGiorno.reset();
  el.inputGiornoData.value = giornoEsistente ? giornoEsistente.data : dataISOCorrente();
  el.bloccoFerie.classList.add('hidden');
  el.bloccoMalattia.classList.add('hidden');
  el.bloccoInfortunio.classList.add('hidden');
  el.bloccoSmart.classList.add('hidden');
  el.bloccoNormale.classList.remove('hidden');
  el.avvisoMultiCliente.classList.add('hidden');
  el.listaTappe.innerHTML = '';

  stato.anagraficaCorrente = await getAnagraficaAttivita(dipendente);

  if (!giornoEsistente && stato.anagraficaCorrente.clienti.length === 0) {
    const vaiAnagrafica = await chiediConferma('Non hai ancora nessun cliente in anagrafica. Vuoi aggiungerlo ora?');
    if (vaiAnagrafica) {
      await apriAnagrafica();
      return;
    }
  }

  popolaSelectClienti(el.selectSmartCliente);
  stato.tappeCounter = 0;

  if (!giornoEsistente) {
    aggiungiTappaVuota();
  } else {
    const radio = document.querySelector(`input[name="tipo-giorno"][value="${giornoEsistente.tipoGiorno}"]`);
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));

    const primaRiga = giornoEsistente.righe[0];
    if (giornoEsistente.tipoGiorno === 'ferie') {
      el.inputFerieLuogo.value = estraiNoteSemplice(primaRiga.note, 'FERIE');
    } else if (giornoEsistente.tipoGiorno === 'malattia') {
      el.inputMalattiaNote.value = estraiNoteSemplice(primaRiga.note, 'MALATTIA');
    } else if (giornoEsistente.tipoGiorno === 'infortunio') {
      el.inputInfortunioNote.value = estraiNoteSemplice(primaRiga.note, 'INFORTUNIO');
    } else if (giornoEsistente.tipoGiorno === 'smart') {
      el.selectSmartCliente.value = primaRiga.cliente;
      el.inputSmartNote.value = primaRiga.note || '';
    } else {
      for (const riga of giornoEsistente.righe) {
        aggiungiTappaVuota();
        popolaTappaDaRiga(el.listaTappe.lastElementChild, riga);
      }
      aggiornaAvvisoMultiCliente();
      aggiornaOrariTappe();
    }
  }

  el.viewAttivita.classList.add('hidden');
  el.viewGiornoForm.classList.remove('hidden');
}

function chiudiGiornoForm() {
  stato.giornoInModifica = null;
  el.viewGiornoForm.classList.add('hidden');
  el.viewAttivita.classList.remove('hidden');
}

function rinumeraTappe() {
  [...el.listaTappe.children].forEach((div, i) => {
    div.querySelector('.tappa-titolo-riga span').textContent = `Tappa ${i + 1}`;
  });
}

function aggiornaAvvisoMultiCliente() {
  const clientiScelti = new Set(
    [...el.listaTappe.querySelectorAll('.tappa-cliente')]
      .map(s => s.value)
      .filter(Boolean)
  );
  el.avvisoMultiCliente.classList.toggle('hidden', clientiScelti.size <= 1);
}

function aggiornaOrariTappe() {
  const divs = [...el.listaTappe.children];
  divs.forEach((div, i) => {
    const selectCliente = div.querySelector('.tappa-cliente');
    const clienteAttuale = selectCliente.value;
    const ePermesso = clienteAttuale === CLIENTE_PERMESSO;
    const clientePrecedente = i > 0 ? divs[i - 1].querySelector('.tappa-cliente').value : null;
    const precedenteEPermesso = clientePrecedente === CLIENTE_PERMESSO;

    const labelCodice = div.querySelector('.tappa-codice-label');
    const labelCantiere = div.querySelector('.tappa-cantiere-label');
    labelCodice.classList.toggle('hidden', ePermesso);
    labelCantiere.classList.toggle('hidden', ePermesso);
    if (ePermesso) {
      div.querySelector('.tappa-codice').value = '';
      div.querySelector('.tappa-cantiere').value = '';
    }

    const labelOrario = div.querySelector('.tappa-orario-label');
    const inputOrario = div.querySelector('.tappa-orario-switch');
    const bloccoPermessoOrari = div.querySelector('.tappa-permesso-orari');
    const labelPermessoInizio = div.querySelector('.tappa-permesso-inizio-label');
    const inputPermessoInizio = div.querySelector('.tappa-permesso-inizio');
    const labelPermessoFine = div.querySelector('.tappa-permesso-fine-label');
    const inputPermessoFine = div.querySelector('.tappa-permesso-fine');

    if (ePermesso) {
      bloccoPermessoOrari.classList.remove('hidden');
      labelOrario.classList.add('hidden');
      inputOrario.value = '';
      labelPermessoInizio.classList.remove('hidden');
      labelPermessoFine.classList.remove('hidden');
    } else {
      bloccoPermessoOrari.classList.add('hidden');
      inputPermessoInizio.value = '';
      inputPermessoFine.value = '';

      const eSwitch = i > 0 && !precedenteEPermesso && clienteAttuale && clientePrecedente && clienteAttuale !== clientePrecedente;
      labelOrario.classList.toggle('hidden', !eSwitch);
      if (!eSwitch) inputOrario.value = '';
    }
  });
}

function popolaSelectCantieri(nomeCliente, selectCantiere) {
  selectCantiere.innerHTML = '<option value="" disabled selected>— Seleziona —</option>';
  const cliente = stato.anagraficaCorrente.clienti.find(c => c.nome === nomeCliente);
  if (!cliente) return;
  for (const sc of cliente.sottoclienti) {
    for (const cantiere of sc.cantieri) {
      const opt = document.createElement('option');
      opt.value = cantiere;
      opt.textContent = cantiere;
      opt.dataset.codice = sc.codice;
      selectCantiere.appendChild(opt);
    }
  }
}

function aggiungiTappaVuota() {
  const index = stato.tappeCounter++;
  const div = document.createElement('div');
  div.className = 'tappa-blocco';
  div.dataset.tappaIndex = index;

  const titolo = document.createElement('div');
  titolo.className = 'tappa-titolo-riga';
  const spanTitolo = document.createElement('span');
  spanTitolo.textContent = `Tappa ${el.listaTappe.children.length + 1}`;
  titolo.appendChild(spanTitolo);

  const btnRimuovi = document.createElement('button');
  btnRimuovi.type = 'button';
  btnRimuovi.className = 'btn-rimuovi-mini';
  btnRimuovi.textContent = '✕ Rimuovi';
  btnRimuovi.addEventListener('click', () => {
    div.remove();
    rinumeraTappe();
    aggiornaAvvisoMultiCliente();
    aggiornaOrariTappe();
  });
  titolo.appendChild(btnRimuovi);
  div.appendChild(titolo);

  const btnMicTappa = document.createElement('button');
  btnMicTappa.type = 'button';
  btnMicTappa.className = 'btn-dettatura-giornata btn-dettatura-tappa';
  btnMicTappa.textContent = '🎤 Racconta questa tappa a voce';
  div.appendChild(btnMicTappa);
  const statoDettaturaTappa = document.createElement('p');
  statoDettaturaTappa.className = 'stato-dettatura hidden';
  div.appendChild(statoDettaturaTappa);
  abilitaDettaturaTappa(btnMicTappa, statoDettaturaTappa, div);

  const labelCliente = document.createElement('label');
  labelCliente.className = 'campo-label';
  labelCliente.append('Cliente');
  const selectCliente = document.createElement('select');
  selectCliente.className = 'tappa-cliente';
  labelCliente.appendChild(selectCliente);
  div.appendChild(labelCliente);

  const labelOrarioSwitch = document.createElement('label');
  labelOrarioSwitch.className = 'campo-label tappa-orario-label hidden';
  labelOrarioSwitch.append('Orario switch (cambio cliente)');
  const inputOrarioSwitch = document.createElement('input');
  inputOrarioSwitch.type = 'time';
  inputOrarioSwitch.className = 'tappa-orario-switch';
  labelOrarioSwitch.appendChild(inputOrarioSwitch);
  div.appendChild(labelOrarioSwitch);

  const bloccoPermessoOrari = document.createElement('div');
  bloccoPermessoOrari.className = 'campo-riga-doppia tappa-permesso-orari hidden';
  const labelPermessoInizio = document.createElement('label');
  labelPermessoInizio.className = 'campo-label tappa-permesso-inizio-label';
  labelPermessoInizio.append('Orario inizio permesso');
  const inputPermessoInizio = document.createElement('input');
  inputPermessoInizio.type = 'time';
  inputPermessoInizio.step = '3600';
  inputPermessoInizio.className = 'tappa-permesso-inizio';
  labelPermessoInizio.appendChild(inputPermessoInizio);
  const labelPermessoFine = document.createElement('label');
  labelPermessoFine.className = 'campo-label tappa-permesso-fine-label';
  labelPermessoFine.append('Orario fine permesso');
  const inputPermessoFine = document.createElement('input');
  inputPermessoFine.type = 'time';
  inputPermessoFine.step = '3600';
  inputPermessoFine.className = 'tappa-permesso-fine';
  labelPermessoFine.appendChild(inputPermessoFine);
  bloccoPermessoOrari.appendChild(labelPermessoInizio);
  bloccoPermessoOrari.appendChild(labelPermessoFine);
  div.appendChild(bloccoPermessoOrari);
  abilitaArrotondamentoOraIntera(inputPermessoInizio);
  abilitaArrotondamentoOraIntera(inputPermessoFine);

  const labelCantiere = document.createElement('label');
  labelCantiere.className = 'campo-label tappa-cantiere-label';
  labelCantiere.append('Cantiere');
  const selectCantiere = document.createElement('select');
  selectCantiere.className = 'tappa-cantiere';
  labelCantiere.appendChild(selectCantiere);
  div.appendChild(labelCantiere);

  const labelCodice = document.createElement('label');
  labelCodice.className = 'campo-label tappa-codice-label';
  labelCodice.append('Codice');
  const inputCodice = document.createElement('input');
  inputCodice.type = 'text';
  inputCodice.className = 'tappa-codice';
  inputCodice.readOnly = true;
  labelCodice.appendChild(inputCodice);
  div.appendChild(labelCodice);

  const labelNote = document.createElement('label');
  labelNote.className = 'campo-label';
  labelNote.append('Note');
  const wrapperNote = document.createElement('div');
  wrapperNote.className = 'campo-con-microfono';
  const inputNote = document.createElement('input');
  inputNote.type = 'text';
  inputNote.className = 'tappa-note';
  const btnMicNote = document.createElement('button');
  btnMicNote.type = 'button';
  btnMicNote.className = 'btn-microfono';
  btnMicNote.setAttribute('aria-label', 'Detta nota');
  btnMicNote.textContent = '🎤';
  wrapperNote.appendChild(inputNote);
  wrapperNote.appendChild(btnMicNote);
  labelNote.appendChild(wrapperNote);
  div.appendChild(labelNote);
  abilitaDettatura(inputNote, btnMicNote);

  popolaSelectClienti(selectCliente, true);

  selectCliente.addEventListener('change', () => {
    inputCodice.value = '';
    if (selectCliente.value !== CLIENTE_PERMESSO) {
      popolaSelectCantieri(selectCliente.value, selectCantiere);
    } else {
      selectCantiere.innerHTML = '';
    }
    aggiornaAvvisoMultiCliente();
    aggiornaOrariTappe();
  });
  selectCantiere.addEventListener('change', () => {
    const opt = selectCantiere.selectedOptions[0];
    inputCodice.value = opt ? (opt.dataset.codice || '') : '';
  });

  el.listaTappe.appendChild(div);
}

function popolaTappaDaRiga(div, riga) {
  const selectCliente = div.querySelector('.tappa-cliente');
  const selectCantiere = div.querySelector('.tappa-cantiere');
  const inputCodice = div.querySelector('.tappa-codice');
  const inputNote = div.querySelector('.tappa-note');
  const inputOrarioSwitch = div.querySelector('.tappa-orario-switch');
  const inputPermessoInizio = div.querySelector('.tappa-permesso-inizio');
  const inputPermessoFine = div.querySelector('.tappa-permesso-fine');

  selectCliente.value = riga.cliente;
  if (riga.cliente !== CLIENTE_PERMESSO) {
    popolaSelectCantieri(riga.cliente, selectCantiere);
    if (riga.cantiere && ![...selectCantiere.options].some(o => o.value === riga.cantiere)) {
      const opt = document.createElement('option');
      opt.value = riga.cantiere;
      opt.textContent = `${riga.cantiere} (non più in anagrafica)`;
      opt.dataset.codice = riga.codice || '';
      selectCantiere.appendChild(opt);
    }
    selectCantiere.value = riga.cantiere || '';
    inputCodice.value = riga.codice || '';
  }
  inputNote.value = riga.note || '';
  inputOrarioSwitch.value = riga.orarioSwitch || '';
  inputPermessoInizio.value = riga.orarioInizioPermesso || '';
  inputPermessoFine.value = riga.orarioFinePermesso || '';
}

function raggruppaInBlocchi(righe) {
  const blocchi = [];
  for (const r of righe) {
    const ultimo = blocchi[blocchi.length - 1];
    if (ultimo && ultimo.cliente === r.cliente) {
      ultimo.righe.push(r);
    } else {
      blocchi.push({ cliente: r.cliente, righe: [r] });
    }
  }
  return blocchi;
}

function orarioAMinuti(hhmm) {
  if (!hhmm) return null;
  const parti = hhmm.split(':');
  if (parti.length !== 2) return null;
  const h = Number(parti[0]);
  const m = Number(parti[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function orarioPermessoAMinuti(hhmm) {
  const minuti = orarioAMinuti(hhmm);
  if (minuti === null) return null;
  return Math.round(minuti / 60) * 60;
}

function abilitaArrotondamentoOraIntera(input) {
  input.addEventListener('change', () => {
    const minuti = orarioPermessoAMinuti(input.value);
    if (minuti === null) return;
    const ore = String(Math.floor(minuti / 60)).padStart(2, '0');
    input.value = `${ore}:00`;
  });
}

function calcolaPercentualiBlocchi(blocchi, orarioInizio, orarioFine) {
  const inizioGiorno = orarioAMinuti(orarioInizio);
  const fineGiorno = orarioAMinuti(orarioFine);
  if (inizioGiorno === null || fineGiorno === null || fineGiorno <= inizioGiorno) return false;

  const inizi = [];
  const fini = [];

  for (let i = 0; i < blocchi.length; i++) {
    const blocco = blocchi[i];
    if (blocco.cliente === CLIENTE_PERMESSO) {
      const inizio = orarioPermessoAMinuti(blocco.righe[0].orarioInizioPermesso);
      const fine = orarioPermessoAMinuti(blocco.righe[blocco.righe.length - 1].orarioFinePermesso);
      inizi.push(inizio);
      fini.push(fine);
    } else {
      let inizio;
      if (i === 0) {
        inizio = inizioGiorno;
      } else if (blocchi[i - 1].cliente === CLIENTE_PERMESSO) {
        inizio = fini[i - 1];
      } else {
        inizio = orarioAMinuti(blocco.righe[0].orarioSwitch);
      }
      inizi.push(inizio);
      fini.push(null);
    }
  }

  for (let i = 0; i < blocchi.length; i++) {
    if (fini[i] === null) {
      fini[i] = (i === blocchi.length - 1) ? fineGiorno : inizi[i + 1];
    }
  }

  let cursore = inizioGiorno;
  for (let i = 0; i < blocchi.length; i++) {
    if (inizi[i] === null || fini[i] === null) return false;
    if (inizi[i] !== cursore) return false;
    if (fini[i] <= inizi[i]) return false;
    cursore = fini[i];
  }
  if (cursore !== fineGiorno) return false;

  const totale = fineGiorno - inizioGiorno;
  const percentuali = blocchi.map((_, i) => Math.round((fini[i] - inizi[i]) / totale * 100));
  const somma = percentuali.reduce((a, b) => a + b, 0);
  percentuali[percentuali.length - 1] += 100 - somma;

  blocchi.forEach((blocco, i) => {
    blocco.righe[blocco.righe.length - 1].percentuale = percentuali[i];
  });
  return true;
}

function unisciPercentualiClientiRipetuti(blocchi) {
  const primaRigaPerCliente = new Map();
  for (const blocco of blocchi) {
    const rigaConPercentuale = blocco.righe[blocco.righe.length - 1];
    if (rigaConPercentuale.percentuale === null) continue;
    const ancora = primaRigaPerCliente.get(blocco.cliente);
    if (ancora) {
      ancora.percentuale += rigaConPercentuale.percentuale;
      rigaConPercentuale.percentuale = null;
    } else {
      primaRigaPerCliente.set(blocco.cliente, rigaConPercentuale);
    }
  }
}

async function salvaFormGiorno(e) {
  e.preventDefault();
  const dipendente = localStorage.getItem('dipendenteAttivo');
  const tipoGiorno = document.querySelector('input[name="tipo-giorno"]:checked').value;
  const data = el.inputGiornoData.value;
  const meseAnno = data.slice(0, 7);

  let righe = [];
  let percentualiRisolte = true;

  if (tipoGiorno === 'ferie') {
    const luogo = el.inputFerieLuogo.value.trim();
    righe = [{ cliente: '', codice: '', cantiere: '', note: luogo ? `FERIE - ${luogo}` : 'FERIE', percentuale: null }];
  } else if (tipoGiorno === 'malattia') {
    const nota = el.inputMalattiaNote.value.trim();
    righe = [{ cliente: '', codice: '', cantiere: '', note: nota ? `MALATTIA - ${nota}` : 'MALATTIA', percentuale: null }];
  } else if (tipoGiorno === 'infortunio') {
    const nota = el.inputInfortunioNote.value.trim();
    righe = [{ cliente: '', codice: '', cantiere: '', note: nota ? `INFORTUNIO - ${nota}` : 'INFORTUNIO', percentuale: null }];
  } else if (tipoGiorno === 'smart') {
    const cliente = el.selectSmartCliente.value;
    if (!cliente) {
      alert('Seleziona il cliente per cui stai lavorando in smart working.');
      return;
    }
    righe = [{ cliente, codice: '', cantiere: 'Smart working', note: el.inputSmartNote.value.trim(), percentuale: 100 }];
  } else {
    const blocchi = [...el.listaTappe.children];
    if (blocchi.length === 0) {
      alert('Aggiungi almeno una tappa.');
      return;
    }
    righe = blocchi.map(div => ({
      cliente: div.querySelector('.tappa-cliente').value,
      codice: div.querySelector('.tappa-codice').value,
      cantiere: div.querySelector('.tappa-cantiere').value.trim(),
      note: div.querySelector('.tappa-note').value.trim(),
      orarioSwitch: div.querySelector('.tappa-orario-switch').value || '',
      orarioInizioPermesso: div.querySelector('.tappa-permesso-inizio').value || '',
      orarioFinePermesso: div.querySelector('.tappa-permesso-fine').value || '',
      percentuale: null
    }));

    if (righe.some(r => !r.cliente || (r.cliente !== CLIENTE_PERMESSO && !r.cantiere))) {
      alert('Ogni tappa deve avere almeno cliente e cantiere (o essere un permesso).');
      return;
    }

    const blocchiCliente = raggruppaInBlocchi(righe);
    if (blocchiCliente.length === 1) {
      righe[righe.length - 1].percentuale = 100;
      percentualiRisolte = true;
    } else {
      percentualiRisolte = calcolaPercentualiBlocchi(blocchiCliente, stato.anagraficaCorrente.orarioInizio, stato.anagraficaCorrente.orarioFine);
      if (percentualiRisolte) {
        unisciPercentualiClientiRipetuti(blocchiCliente);
      } else {
        alert('Non riesco a calcolare le percentuali: controlla di aver indicato l\'orario di switch per ogni cambio cliente, in ordine crescente e compreso nell\'orario di lavoro standard. Salvo comunque la giornata, ma dovrai completare le percentuali in seguito.');
      }
    }
  }

  const multiClienteNonRisolto = tipoGiorno === 'normale' && !percentualiRisolte;

  const record = {
    dipendente,
    meseAnno,
    data,
    tipoGiorno,
    righe,
    multiClienteNonRisolto
  };
  if (stato.giornoInModifica) {
    record.id = stato.giornoInModifica.id;
  }

  await salvaGiornoAttivita(record);

  chiudiGiornoForm();
  await aggiornaAttivita();
}

document.querySelectorAll('input[name="tipo-giorno"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const tipo = document.querySelector('input[name="tipo-giorno"]:checked').value;
    el.bloccoFerie.classList.toggle('hidden', tipo !== 'ferie');
    el.bloccoMalattia.classList.toggle('hidden', tipo !== 'malattia');
    el.bloccoInfortunio.classList.toggle('hidden', tipo !== 'infortunio');
    el.bloccoSmart.classList.toggle('hidden', tipo !== 'smart');
    el.bloccoNormale.classList.toggle('hidden', tipo !== 'normale');
  });
});

el.selectDipendente.addEventListener('change', async () => {
  localStorage.setItem('dipendenteAttivo', el.selectDipendente.value);
  stato.meseAttivoAttivita = await determinaMeseAttivoAttivitaIniziale(el.selectDipendente.value);
});

el.cardScontrini.addEventListener('click', apriScontrini);
el.cardRimborso.addEventListener('click', apriRimborso);
el.cardAttivita.addEventListener('click', apriAttivita);
el.btnTornaHub.addEventListener('click', tornaAllHub);
el.btnDatiFatturazione.addEventListener('click', apriFatturazione);
el.btnTornaHubFatturazione.addEventListener('click', tornaAllHubDaFatturazione);

el.btnTornaHubAttivita.addEventListener('click', tornaAllHubDaAttivita);
el.btnPrevMonthAttivita.addEventListener('click', () => cambiaMeseAttivita(-1));
el.btnNextMonthAttivita.addEventListener('click', () => cambiaMeseAttivita(1));
el.btnReopenMonthAttivita.addEventListener('click', riapriMeseAttivita);
el.btnCloseMonthAttivita.addEventListener('click', chiudiMeseAttivita);
el.btnAddGiorno.addEventListener('click', () => apriGiornoForm());
el.btnApriAnagrafica.addEventListener('click', apriAnagrafica);
el.btnImportaAttivita.addEventListener('click', () => el.inputImportaAttivita.click());
el.inputImportaAttivita.addEventListener('change', async () => {
  const file = el.inputImportaAttivita.files[0];
  if (file) await importaAttivitaDaFile(file);
  el.inputImportaAttivita.value = '';
});
el.btnExportAttivita.addEventListener('click', async () => {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  const giorni = await getGiorniAttivitaDelMese(stato.meseAttivoAttivita, dipendente);
  const mancanti = trovaGiorniLavorativiMancanti(stato.meseAttivoAttivita, giorni);
  if (mancanti.length > 0) {
    const elenco = mancanti.map(d => parseDataISO(d).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })).join(', ');
    const procedi = await chiediConferma(`Mancano dati per questi giorni lavorativi: ${elenco}. Esportare comunque?`);
    if (!procedi) return;
  }
  await generaPdfAttivita(stato.meseAttivoAttivita);
  await generaPdfPresenze(stato.meseAttivoAttivita);
});

el.btnAnagraficaAnnulla.addEventListener('click', chiudiAnagrafica);
el.btnAggiungiCliente.addEventListener('click', () => {
  stato.anagraficaClienti.push({ nome: '', sottoclienti: [{ codice: '', cantieri: [] }] });
  renderAnagraficaClienti();
});
el.btnSalvaAnagrafica.addEventListener('click', salvaAnagraficaDaForm);

el.btnGiornoFormAnnulla.addEventListener('click', chiudiGiornoForm);
el.btnAggiungiTappa.addEventListener('click', () => {
  aggiungiTappaVuota();
  aggiornaOrariTappe();
});
el.formGiorno.addEventListener('submit', salvaFormGiorno);
abilitaDettatura(el.inputSmartNote, el.btnMicSmartNote);
abilitaDettaturaGiornata(el.btnMicGiornata, el.statoDettaturaGiornata);

/* =========================================================
   RIMBORSO
   ========================================================= */

function formatoImporto(numero) {
  return `${(numero || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

function etichettaPagamento(pagamento) {
  if (pagamento === 'carta_aziendale') return 'Carta aziendale';
  if (pagamento === 'pagato_dipendente') return 'Pagato dal dipendente';
  return 'Convenzione';
}

async function apriRimborso() {
  el.viewHub.classList.add('hidden');
  el.viewRimborso.classList.remove('hidden');
  await aggiornaRimborso();
}

function tornaAllHubDaRimborso() {
  el.viewRimborso.classList.add('hidden');
  el.viewHub.classList.remove('hidden');
}

async function cambiaMeseRimborso(delta) {
  stato.meseAttivoRimborso = aggiungiMesi(stato.meseAttivoRimborso, delta);
  await aggiornaRimborso();
}

async function aggiornaRimborso() {
  el.monthLabelRimborso.textContent = etichettaMese(stato.meseAttivoRimborso);

  const [statoMese, spese] = await Promise.all([
    getStatoMeseRimborso(stato.meseAttivoRimborso),
    getSpeseDelMese(stato.meseAttivoRimborso)
  ]);

  const chiuso = statoMese.chiuso;
  el.monthClosedBadgeRimborso.classList.toggle('hidden', !chiuso);
  el.btnAddSpesa.disabled = chiuso;
  el.btnReopenMonthRimborso.classList.toggle('hidden', !chiuso);

  let totaleCarta = 0, totaleOggettoRimborso = 0;
  for (const s of spese) {
    if (s.pagamento === 'carta_aziendale') totaleCarta += s.importo;
    else totaleOggettoRimborso += s.importo;
  }
  el.totaleCarta.textContent = formatoImporto(totaleCarta);
  el.totaleDipendente.textContent = formatoImporto(totaleOggettoRimborso);

  renderListaSpese(spese);
  await aggiornaStatoFirma();
}

function renderListaSpese(spese) {
  el.listaSpese.innerHTML = '';
  el.listaSpeseEmpty.classList.toggle('hidden', spese.length > 0);

  for (const s of spese) {
    const div = document.createElement('div');
    div.className = 'spesa-item';

    const info = document.createElement('div');
    info.className = 'spesa-item-info';

    const titolo = document.createElement('span');
    titolo.className = 'spesa-item-titolo';
    titolo.textContent = `${parseDataISO(s.data).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })} · ${s.esercente}`;
    info.appendChild(titolo);

    const dettaglioParti = [s.luogo, s.descrizione, etichettaPagamento(s.pagamento)].filter(Boolean);
    const dettaglio = document.createElement('span');
    dettaglio.className = 'spesa-item-dettaglio';
    dettaglio.textContent = dettaglioParti.join(' · ');
    info.appendChild(dettaglio);

    div.appendChild(info);

    const importo = document.createElement('span');
    importo.className = 'spesa-item-importo';
    importo.textContent = formatoImporto(s.importo);
    div.appendChild(importo);

    div.addEventListener('click', () => eliminaSpesaConferma(s));
    el.listaSpese.appendChild(div);
  }
}

async function eliminaSpesaConferma(spesa) {
  const dataEtichetta = parseDataISO(spesa.data).toLocaleDateString('it-IT');
  const conferma = await chiediConferma(`Eliminare la spesa "${spesa.esercente}" del ${dataEtichetta}?`);
  if (!conferma) return;
  await eliminaSpesa(spesa.id);
  await aggiornaRimborso();
}

async function chiudiMeseRimborso() {
  const conferma = await chiediConferma(
    `Hai già esportato il PDF di ${etichettaMese(stato.meseAttivoRimborso)}? Chiudendo il mese, l'inserimento spese verrà disattivato (potrai comunque riaprirlo in seguito).`
  );
  if (!conferma) return;
  await setStatoMeseRimborso(stato.meseAttivoRimborso, true);
  await aggiornaRimborso();
}

async function riapriMeseRimborso() {
  const conferma = await chiediConferma(`Riaprire ${etichettaMese(stato.meseAttivoRimborso)} per modificarlo?`);
  if (!conferma) return;
  await setStatoMeseRimborso(stato.meseAttivoRimborso, false);
  await aggiornaRimborso();
}

/* =========================================================
   EXPORT PDF RIMBORSO (overlay sul modulo aziendale originale)
   ========================================================= */

const RIMBORSO_TEMPLATE = {
  basePdfPath: 'templates/rimborso_spese_base.pdf',
  pageHeight: 595.2,
  colonne: {
    DATA: [23.7, 83.9],
    ESERCENTE: [83.9, 203.2],
    LUOGO: [203.2, 316.8],
    DESCRIZIONE: [316.8, 385.7],
    FATTURA: [385.7, 407.9],
    SCONTRINO: [407.9, 430.1],
    CONVENZIONE: [430.1, 453.7],
    CARTA_AZIENDALE: [453.7, 481.4],
    PAGATO_DIPENDENTE: [481.4, 509.2],
    IMPORTO_CARTA: [509.2, 571.3],
    IMPORTO_DIPENDENTE: [571.3, 633.5],
    IMPORTO_CONVENZIONE: [633.5, 707.1],
    NOTE: [707.1, 817.5]
  },
  righePagina1: [231.6, 251.9, 272.6, 293.2, 313.9, 334.5, 355.2, 375.8, 396.5, 417.1, 437.8, 458.4, 479.0, 499.7, 520.4],
  righePagina2: [161.3, 181.97, 202.63, 223.3, 243.97, 264.63, 285.3, 305.97, 326.63, 347.3, 367.97, 388.63],
  campiFissi: {
    mese: { x: 495.5, top: 119.0 },
    anno: { x: 660.3, top: 119.0 },
    nomeIncarico: { x: 136.6, top: 138.9 },
    paginaNum: { x: 763.1, top: 120.7 },
    paginaTot: { x: 798.1, top: 120.7 }
  },
  totali: {
    totCarta: { top: 409.2 },
    totOggettoRimborso: { top: 430.0 }
  },
  attestazione: {
    nome: { x: 118.0, top: 466.4 },
    firma: { x: 546.2, top: 454.56, width: 72.8, height: 62.0 }
  }
};

function pdfLibY(top, altezzaTesto = 8) {
  return RIMBORSO_TEMPLATE.pageHeight - top - altezzaTesto;
}

async function caricaBytes(percorso) {
  const risposta = await fetch(percorso);
  return risposta.arrayBuffer();
}

function centraTestoInColonna(font, testo, dimensione, colonna) {
  const larghezza = font.widthOfTextAtSize(testo, dimensione);
  const centro = (colonna[0] + colonna[1]) / 2;
  return centro - larghezza / 2;
}

function allineaADestraInColonna(font, testo, dimensione, colonna, margineDestro = 4) {
  const larghezza = font.widthOfTextAtSize(testo, dimensione);
  return colonna[1] - margineDestro - larghezza;
}

function suddividiTestoInRighe(font, testo, dimensione, larghezzaMax) {
  const parole = testo.split(/\s+/).filter(Boolean);
  const righe = [];
  let rigaCorrente = '';

  for (const parola of parole) {
    const prova = rigaCorrente ? `${rigaCorrente} ${parola}` : parola;
    if (font.widthOfTextAtSize(prova, dimensione) <= larghezzaMax || !rigaCorrente) {
      rigaCorrente = prova;
    } else {
      righe.push(rigaCorrente);
      rigaCorrente = parola;
    }
  }
  if (rigaCorrente) righe.push(rigaCorrente);
  return righe;
}

function nomeFileExportRimborso(meseAnno) {
  const { mese } = scomponiMeseAnno(meseAnno);
  const nomeMese = MESI_IT[mese - 1];
  const dipendente = localStorage.getItem('dipendenteAttivo');
  const cognomeNome = dipendente ? invertiNomeCognome(dipendente) : 'Dipendente non impostato';
  return `${dataOdiernaCompatta()} - Rimborso spese ${nomeMese} - ${cognomeNome}.pdf`;
}

async function generaPdfRimborso(meseAnno) {
  const spese = await getSpeseDelMese(meseAnno);
  if (spese.length === 0) {
    alert(`Nessuna spesa da esportare per ${etichettaMese(meseAnno)}.`);
    return;
  }

  const capienzaP1 = RIMBORSO_TEMPLATE.righePagina1.length;
  const capienzaP2 = RIMBORSO_TEMPLATE.righePagina2.length;
  if (spese.length > capienzaP1 + capienzaP2) {
    alert(`Questo mese ha ${spese.length} spese, più delle ${capienzaP1 + capienzaP2} righe disponibili sul modulo (2 pagine). Elimina o sposta qualche voce prima di esportare: la gestione di una terza pagina non è ancora disponibile.`);
    return;
  }

  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const dipendenteAttivo = localStorage.getItem('dipendenteAttivo');

  const baseBytes = await caricaBytes(RIMBORSO_TEMPLATE.basePdfPath);
  const doc = await PDFDocument.load(baseBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const nero = rgb(0, 0, 0);
  const DIM = 8;

  const pagina1 = doc.getPage(0);
  const pagina2 = doc.getPage(1);

  const { anno, mese } = scomponiMeseAnno(meseAnno);
  const nomeMese = MESI_IT[mese - 1].toUpperCase();
  const cognomeNome = dipendenteAttivo ? invertiNomeCognome(dipendenteAttivo).toUpperCase() : '';

  function scriviCampiFissi(page, numeroPagina) {
    const cf = RIMBORSO_TEMPLATE.campiFissi;
    page.drawText(nomeMese, { x: cf.mese.x, y: pdfLibY(cf.mese.top), size: DIM, font, color: nero });
    page.drawText(String(anno), { x: cf.anno.x, y: pdfLibY(cf.anno.top), size: DIM, font, color: nero });
    page.drawText(String(numeroPagina), { x: cf.paginaNum.x, y: pdfLibY(cf.paginaNum.top), size: DIM, font, color: nero });
    page.drawText('2', { x: cf.paginaTot.x, y: pdfLibY(cf.paginaTot.top), size: DIM, font, color: nero });
    if (cognomeNome) {
      page.drawText(cognomeNome, { x: cf.nomeIncarico.x, y: pdfLibY(cf.nomeIncarico.top), size: DIM, font: fontBold, color: nero });
    }
  }

  function scriviRiga(page, rigaTop, spesa) {
    const c = RIMBORSO_TEMPLATE.colonne;
    const y = pdfLibY(rigaTop);

    const dataFormattata = parseDataISO(spesa.data).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    page.drawText(dataFormattata, { x: centraTestoInColonna(font, dataFormattata, DIM, c.DATA), y, size: DIM, font, color: nero });
    page.drawText((spesa.esercente || '').toUpperCase(), { x: c.ESERCENTE[0] + 3, y, size: DIM, font, color: nero });
    page.drawText((spesa.luogo || '').toUpperCase(), { x: c.LUOGO[0] + 3, y, size: DIM, font, color: nero });
    page.drawText((spesa.descrizione || '').toUpperCase(), { x: c.DESCRIZIONE[0] + 3, y, size: DIM, font, color: nero });

    const colonnaGiustificativo = spesa.giustificativo === 'scontrino' ? c.SCONTRINO : c.FATTURA;
    page.drawText('X', { x: centraTestoInColonna(fontBold, 'X', DIM, colonnaGiustificativo), y, size: DIM, font: fontBold, color: nero });

    const colonnaPagamento = spesa.pagamento === 'pagato_dipendente' ? c.PAGATO_DIPENDENTE
      : spesa.pagamento === 'convenzione' ? c.CONVENZIONE
      : c.CARTA_AZIENDALE;
    page.drawText('X', { x: centraTestoInColonna(fontBold, 'X', DIM, colonnaPagamento), y, size: DIM, font: fontBold, color: nero });

    const colonnaImporto = spesa.pagamento === 'pagato_dipendente' ? c.IMPORTO_DIPENDENTE
      : spesa.pagamento === 'convenzione' ? c.IMPORTO_CONVENZIONE
      : c.IMPORTO_CARTA;
    const importoFormattato = formatoImporto(spesa.importo);
    page.drawText(importoFormattato, { x: allineaADestraInColonna(font, importoFormattato, DIM, colonnaImporto), y, size: DIM, font, color: nero });

    if (spesa.note) {
      const DIM_NOTE = 6;
      const larghezzaNote = c.NOTE[1] - c.NOTE[0] - 6;
      const righeNote = suddividiTestoInRighe(font, spesa.note.toUpperCase(), DIM_NOTE, larghezzaNote).slice(0, 2);
      righeNote.forEach((riga, i) => {
        page.drawText(riga, { x: c.NOTE[0] + 3, y: y - i * (DIM_NOTE + 1), size: DIM_NOTE, font, color: nero });
      });
    }
  }

  scriviCampiFissi(pagina1, 1);
  scriviCampiFissi(pagina2, 2);

  const spesePagina1 = spese.slice(0, capienzaP1);
  const spesePagina2 = spese.slice(capienzaP1);
  spesePagina1.forEach((s, i) => scriviRiga(pagina1, RIMBORSO_TEMPLATE.righePagina1[i], s));
  spesePagina2.forEach((s, i) => scriviRiga(pagina2, RIMBORSO_TEMPLATE.righePagina2[i], s));

  let totaleCarta = 0, totaleOggettoRimborso = 0;
  for (const s of spese) {
    if (s.pagamento === 'carta_aziendale') totaleCarta += s.importo;
    else totaleOggettoRimborso += s.importo;
  }

  const testoTotCarta = formatoImporto(totaleCarta);
  pagina2.drawText(testoTotCarta, {
    x: allineaADestraInColonna(font, testoTotCarta, DIM, RIMBORSO_TEMPLATE.colonne.IMPORTO_CARTA),
    y: pdfLibY(RIMBORSO_TEMPLATE.totali.totCarta.top), size: DIM, font, color: nero
  });

  const testoTotOggetto = formatoImporto(totaleOggettoRimborso);
  pagina2.drawText(testoTotOggetto, {
    x: allineaADestraInColonna(font, testoTotOggetto, DIM, RIMBORSO_TEMPLATE.colonne.IMPORTO_DIPENDENTE),
    y: pdfLibY(RIMBORSO_TEMPLATE.totali.totOggettoRimborso.top), size: DIM, font, color: nero
  });

  if (cognomeNome) {
    pagina2.drawText(cognomeNome, {
      x: RIMBORSO_TEMPLATE.attestazione.nome.x, y: pdfLibY(RIMBORSO_TEMPLATE.attestazione.nome.top), size: DIM, font: fontBold, color: nero
    });
  }

  const firmaBlob = await getFirma(dipendenteAttivo);
  if (firmaBlob) {
    const firmaBytes = await firmaBlob.arrayBuffer();
    const firmaImg = await doc.embedPng(firmaBytes);
    const f = RIMBORSO_TEMPLATE.attestazione.firma;
    pagina2.drawImage(firmaImg, {
      x: f.x,
      y: RIMBORSO_TEMPLATE.pageHeight - f.top - f.height,
      width: f.width,
      height: f.height
    });
  }

  const pdfBytes = await doc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFileExportRimborso(meseAnno);
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   EXPORT PDF ATTIVITÀ (overlay sul modulo aziendale originale)
   ========================================================= */

const ATTIVITA_TEMPLATE = {
  basePdfPath: 'templates/report_attivita_base.pdf',
  pageHeight: 595.2,
  righePerPagina: 18,
  numPagine: 3,
  colonne: {
    TC: [21.5, 108.8],
    DATA: [108.8, 242.0],
    CLIENTE: [242.0, 350.75],
    CANTIERE: [350.75, 474.1],
    PERCENTUALE: [474.1, 571.5],
    NOTE: [571.5, 817.0]
  },
  righeTop: [173.3, 192.6, 213.5, 234.4, 255.3, 276.2, 297.1, 318.0, 338.8, 359.7, 380.6, 401.5, 422.4, 443.3, 464.1, 485.0, 505.9, 526.8],
  campoPagina: { numX: 752, totX: 782, top: 125.2 }
};

function nomeFileExportAttivita(meseAnno) {
  const { mese } = scomponiMeseAnno(meseAnno);
  const nomeMese = MESI_IT[mese - 1];
  const dipendente = localStorage.getItem('dipendenteAttivo');
  const cognomeNome = dipendente ? invertiNomeCognome(dipendente) : 'Dipendente non impostato';
  return `${dataOdiernaCompatta()} - Report attivita ${nomeMese} - ${cognomeNome}.pdf`;
}

async function generaPdfAttivita(meseAnno) {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  const giorni = await getGiorniAttivitaDelMese(meseAnno, dipendente);
  if (giorni.length === 0) {
    alert(`Nessuna giornata da esportare per ${etichettaMese(meseAnno)}.`);
    return;
  }
  if (giorni.some(g => g.multiClienteNonRisolto)) {
    alert('Ci sono giornate con più clienti e percentuale non ancora definita (⚠ % da fare). Sistemale prima di esportare.');
    return;
  }

  const righeFlat = [];
  for (const g of giorni) {
    for (const r of g.righe) righeFlat.push({ data: g.data, ...r });
  }

  const capienzaTotale = ATTIVITA_TEMPLATE.righePerPagina * ATTIVITA_TEMPLATE.numPagine;
  if (righeFlat.length > capienzaTotale) {
    alert(`Questo mese ha ${righeFlat.length} righe, più delle ${capienzaTotale} disponibili sul modulo (${ATTIVITA_TEMPLATE.numPagine} pagine). Elimina o sposta qualche voce prima di esportare: la gestione di pagine aggiuntive non è ancora disponibile.`);
    return;
  }

  const anagrafica = await getAnagraficaAttivita(dipendente);
  const tc = (anagrafica.tc || '').toUpperCase();

  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const baseBytes = await caricaBytes(ATTIVITA_TEMPLATE.basePdfPath);
  const doc = await PDFDocument.load(baseBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const nero = rgb(0, 0, 0);
  const DIM = 8;

  function scriviRiga(page, top, riga) {
    const c = ATTIVITA_TEMPLATE.colonne;
    const y = pdfLibY(top, DIM);

    page.drawText(tc, { x: centraTestoInColonna(font, tc, DIM, c.TC), y, size: DIM, font, color: nero });

    const dataFormattata = parseDataISO(riga.data).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
    page.drawText(dataFormattata, { x: centraTestoInColonna(font, dataFormattata, DIM, c.DATA), y, size: DIM, font, color: nero });

    const testoCliente = riga.cliente === CLIENTE_PERMESSO ? 'PERMESSO' : riga.cliente;
    if (testoCliente) {
      page.drawText(testoCliente, { x: centraTestoInColonna(font, testoCliente, DIM, c.CLIENTE), y, size: DIM, font, color: nero });
    }

    const cantiereTesto = [riga.cantiere, riga.codice].filter(Boolean).join(' ');
    if (cantiereTesto) {
      page.drawText(cantiereTesto, { x: c.CANTIERE[0] + 3, y, size: DIM, font, color: nero });
    }

    if (riga.percentuale !== null && riga.percentuale !== undefined) {
      const testoPct = `${riga.percentuale}%`;
      page.drawText(testoPct, { x: centraTestoInColonna(font, testoPct, DIM, c.PERCENTUALE), y, size: DIM, font, color: nero });
    }

    if (riga.note) {
      const DIM_NOTE = 6;
      const larghezzaNote = c.NOTE[1] - c.NOTE[0] - 6;
      const righeNote = suddividiTestoInRighe(font, riga.note, DIM_NOTE, larghezzaNote).slice(0, 2);
      const passo = DIM_NOTE + 1;
      const offsetCentratura = righeNote.length > 1 ? passo / 2 : 0;
      righeNote.forEach((rn, i) => {
        page.drawText(rn, { x: c.NOTE[0] + 3, y: y + offsetCentratura - i * passo, size: DIM_NOTE, font, color: nero });
      });
    }
  }

  const numPagineNecessarie = Math.max(1, Math.ceil(righeFlat.length / ATTIVITA_TEMPLATE.righePerPagina));

  for (let p = 0; p < numPagineNecessarie; p++) {
    const page = doc.getPage(p);
    const cp = ATTIVITA_TEMPLATE.campoPagina;
    page.drawText(String(p + 1), { x: cp.numX, y: pdfLibY(cp.top, DIM), size: DIM, font, color: nero });
    page.drawText(String(numPagineNecessarie), { x: cp.totX, y: pdfLibY(cp.top, DIM), size: DIM, font, color: nero });

    const righePagina = righeFlat.slice(p * ATTIVITA_TEMPLATE.righePerPagina, (p + 1) * ATTIVITA_TEMPLATE.righePerPagina);
    righePagina.forEach((riga, i) => scriviRiga(page, ATTIVITA_TEMPLATE.righeTop[i], riga));
  }

  for (let p = ATTIVITA_TEMPLATE.numPagine - 1; p >= numPagineNecessarie; p--) {
    doc.removePage(p);
  }

  const pdfBytes = await doc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFileExportAttivita(meseAnno);
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   EXPORT PDF PRESENZE (stesso modello, una riga per giornata)
   ========================================================= */

function trovaGiorniLavorativiMancanti(meseAnno, giorni) {
  const { anno, mese } = scomponiMeseAnno(meseAnno);
  const oggi = new Date();
  const eMeseCorrente = anno === oggi.getFullYear() && mese === (oggi.getMonth() + 1);
  const ultimoGiorno = eMeseCorrente ? oggi.getDate() : new Date(anno, mese, 0).getDate();

  const dateEsistenti = new Set(giorni.map(g => g.data));
  const mancanti = [];
  for (let giorno = 1; giorno <= ultimoGiorno; giorno++) {
    const dataISO = `${anno}-${String(mese).padStart(2, '0')}-${String(giorno).padStart(2, '0')}`;
    const giornoSettimana = parseDataISO(dataISO).getDay();
    if (giornoSettimana === 0 || giornoSettimana === 6) continue;
    if (!dateEsistenti.has(dataISO)) mancanti.push(dataISO);
  }
  return mancanti;
}

function nomeFileExportPresenze(meseAnno) {
  const { mese } = scomponiMeseAnno(meseAnno);
  const nomeMese = MESI_IT[mese - 1];
  const dipendente = localStorage.getItem('dipendenteAttivo');
  const cognomeNome = dipendente ? invertiNomeCognome(dipendente) : 'Dipendente non impostato';
  return `${dataOdiernaCompatta()} - Report presenze ${nomeMese} - ${cognomeNome}.pdf`;
}

function orePermessoGiorno(giorno) {
  return giorno.righe
    .filter(r => r.cliente === CLIENTE_PERMESSO)
    .reduce((tot, r) => {
      const ini = orarioPermessoAMinuti(r.orarioInizioPermesso);
      const fin = orarioPermessoAMinuti(r.orarioFinePermesso);
      return tot + (ini !== null && fin !== null && fin > ini ? (fin - ini) / 60 : 0);
    }, 0);
}

function haLavoratoIlGiorno(giorno) {
  if (giorno.tipoGiorno === 'smart') return true;
  if (giorno.tipoGiorno !== 'normale') return false;
  return giorno.righe.some(r => r.cliente && r.cliente !== CLIENTE_PERMESSO);
}

function notaPresenzaGiorno(giorno) {
  if (giorno.tipoGiorno === 'smart') return 'Smart working';
  if (giorno.tipoGiorno !== 'normale') return giorno.righe[0].note;

  const orePermesso = orePermessoGiorno(giorno);
  const parti = [];
  if (haLavoratoIlGiorno(giorno)) parti.push('Lavorato');
  if (orePermesso > 0) parti.push(`${orePermesso}h permesso`);
  return parti.join(' + ') || 'Lavorato';
}

async function generaPdfPresenze(meseAnno) {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  const giorni = await getGiorniAttivitaDelMese(meseAnno, dipendente);
  if (giorni.length === 0) return;

  const righePresenza = giorni.map(g => ({ data: g.data, note: notaPresenzaGiorno(g) }));

  const giorniLavorativi = giorni.filter(haLavoratoIlGiorno).length;
  const giorniFerie = giorni.filter(g => g.tipoGiorno === 'ferie').length;
  const orePermessoTotali = giorni.reduce((tot, g) => tot + (g.tipoGiorno === 'normale' ? orePermessoGiorno(g) : 0), 0);

  righePresenza.push({ data: null, note: `TOTALE GIORNI LAVORATIVI: ${giorniLavorativi}` });
  if (giorniFerie > 0) righePresenza.push({ data: null, note: `TOTALE GIORNI FERIE: ${giorniFerie}` });
  if (orePermessoTotali > 0) righePresenza.push({ data: null, note: `TOTALE ORE PERMESSO: ${orePermessoTotali}` });

  const capienzaTotale = ATTIVITA_TEMPLATE.righePerPagina * ATTIVITA_TEMPLATE.numPagine;
  if (righePresenza.length > capienzaTotale) {
    alert('Il report presenze ha più righe di quelle disponibili sul modulo. Contattami per gestire questo caso.');
    return;
  }

  const anagrafica = await getAnagraficaAttivita(dipendente);
  const tc = (anagrafica.tc || '').toUpperCase();

  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const baseBytes = await caricaBytes(ATTIVITA_TEMPLATE.basePdfPath);
  const doc = await PDFDocument.load(baseBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const nero = rgb(0, 0, 0);
  const DIM = 8;

  function scriviRigaPresenza(page, top, riga) {
    const c = ATTIVITA_TEMPLATE.colonne;
    const y = pdfLibY(top, DIM);

    if (riga.data) {
      page.drawText(tc, { x: centraTestoInColonna(font, tc, DIM, c.TC), y, size: DIM, font, color: nero });
      const dataFormattata = parseDataISO(riga.data).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
      page.drawText(dataFormattata, { x: centraTestoInColonna(font, dataFormattata, DIM, c.DATA), y, size: DIM, font, color: nero });
    }

    if (riga.note) {
      const DIM_NOTE = 6;
      const larghezzaNote = c.NOTE[1] - c.NOTE[0] - 6;
      const righeNote = suddividiTestoInRighe(font, riga.note, DIM_NOTE, larghezzaNote).slice(0, 2);
      const passo = DIM_NOTE + 1;
      const offsetCentratura = righeNote.length > 1 ? passo / 2 : 0;
      righeNote.forEach((rn, i) => {
        page.drawText(rn, { x: c.NOTE[0] + 3, y: y + offsetCentratura - i * passo, size: DIM_NOTE, font, color: nero });
      });
    }
  }

  const numPagineNecessarie = Math.max(1, Math.ceil(righePresenza.length / ATTIVITA_TEMPLATE.righePerPagina));
  for (let p = 0; p < numPagineNecessarie; p++) {
    const page = doc.getPage(p);
    const cp = ATTIVITA_TEMPLATE.campoPagina;
    page.drawText(String(p + 1), { x: cp.numX, y: pdfLibY(cp.top, DIM), size: DIM, font, color: nero });
    page.drawText(String(numPagineNecessarie), { x: cp.totX, y: pdfLibY(cp.top, DIM), size: DIM, font, color: nero });

    const righePagina = righePresenza.slice(p * ATTIVITA_TEMPLATE.righePerPagina, (p + 1) * ATTIVITA_TEMPLATE.righePerPagina);
    righePagina.forEach((riga, i) => scriviRigaPresenza(page, ATTIVITA_TEMPLATE.righeTop[i], riga));
  }
  for (let p = ATTIVITA_TEMPLATE.numPagine - 1; p >= numPagineNecessarie; p--) {
    doc.removePage(p);
  }

  const pdfBytes = await doc.save();
  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeFileExportPresenze(meseAnno);
  a.click();
  URL.revokeObjectURL(url);
}

/* =========================================================
   FORM NUOVA SPESA
   ========================================================= */

async function aggiornaListaEsercenti() {
  const tutte = await getTutteLeSpese();
  const nomi = [...new Set(tutte.map(s => s.esercente).filter(Boolean))].sort();
  el.listaEsercenti.innerHTML = '';
  for (const nome of nomi) {
    const option = document.createElement('option');
    option.value = nome;
    el.listaEsercenti.appendChild(option);
  }
}

async function onEsercenteChange() {
  const nome = el.inputSpesaEsercente.value.trim();
  if (!nome) return;
  const ultima = await getUltimaSpesaPerEsercente(nome);
  if (ultima) {
    el.inputSpesaLuogo.value = ultima.luogo || '';
    el.inputSpesaDescrizione.value = ultima.descrizione || '';
  }
}

async function apriFormSpesa() {
  el.formSpesa.reset();
  el.inputSpesaData.value = dataISOCorrente();
  await aggiornaListaEsercenti();
  el.viewRimborso.classList.add('hidden');
  el.viewSpesaForm.classList.remove('hidden');
}

function chiudiFormSpesa() {
  el.viewSpesaForm.classList.add('hidden');
  el.viewRimborso.classList.remove('hidden');
}

async function salvaFormSpesa(e) {
  e.preventDefault();

  const giustificativoEl = el.formSpesa.querySelector('input[name="giustificativo"]:checked');
  const pagamentoEl = el.formSpesa.querySelector('input[name="pagamento"]:checked');

  const spesa = {
    meseAnno: stato.meseAttivoRimborso,
    data: el.inputSpesaData.value,
    esercente: el.inputSpesaEsercente.value.trim(),
    luogo: el.inputSpesaLuogo.value.trim(),
    descrizione: el.inputSpesaDescrizione.value.trim(),
    giustificativo: giustificativoEl.value,
    pagamento: pagamentoEl.value,
    importo: Math.round(parseFloat(el.inputSpesaImporto.value) * 100) / 100,
    note: el.inputSpesaNote.value.trim(),
    creatoIl: new Date().toISOString()
  };

  await salvaSpesa(spesa);
  chiudiFormSpesa();
  await aggiornaRimborso();
}

el.btnTornaHubRimborso.addEventListener('click', tornaAllHubDaRimborso);
el.btnPrevMonthRimborso.addEventListener('click', () => cambiaMeseRimborso(-1));
el.btnNextMonthRimborso.addEventListener('click', () => cambiaMeseRimborso(1));
el.btnReopenMonthRimborso.addEventListener('click', riapriMeseRimborso);
el.btnCloseMonthRimborso.addEventListener('click', chiudiMeseRimborso);
el.btnExportRimborso.addEventListener('click', () => generaPdfRimborso(stato.meseAttivoRimborso));
el.btnCaricaFirma.addEventListener('click', () => el.inputFirmaUpload.click());
el.inputFirmaUpload.addEventListener('change', async () => {
  const file = el.inputFirmaUpload.files[0];
  if (file) await gestisciCaricamentoFirma(file);
  el.inputFirmaUpload.value = '';
});
el.btnEliminaFirma.addEventListener('click', async () => {
  const dipendente = localStorage.getItem('dipendenteAttivo');
  if (!dipendente) return;
  const conferma = await chiediConferma(`Eliminare la firma salvata per ${dipendente}?`);
  if (!conferma) return;
  await eliminaFirma(dipendente);
  await aggiornaStatoFirma();
});
el.btnAddSpesa.addEventListener('click', apriFormSpesa);
el.btnSpesaFormAnnulla.addEventListener('click', chiudiFormSpesa);
el.inputSpesaEsercente.addEventListener('change', onEsercenteChange);
el.formSpesa.addEventListener('submit', salvaFormSpesa);

/* =========================================================
   BACKUP COMPLETO (esporta/ripristina tutti i dati)
   ========================================================= */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/:(.*?);/)[1];
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function getTutteLeFirme() {
  const { store } = await txStore(STORE_FIRME, 'readonly');
  return reqAsPromise(store.getAll());
}

async function getTuttiGliStatiMesi() {
  const { store } = await txStore(STORE_STATO_MESI, 'readonly');
  return reqAsPromise(store.getAll());
}

async function getTuttiGliStatiMesiRimborso() {
  const { store } = await txStore(STORE_STATO_MESI_RIMBORSO, 'readonly');
  return reqAsPromise(store.getAll());
}

async function getTutteLeRicevute() {
  const { store } = await txStore(STORE_RICEVUTE, 'readonly');
  return reqAsPromise(store.getAll());
}

async function getTutteLeAnagraficheAttivita() {
  const { store } = await txStore(STORE_ANAGRAFICA_ATTIVITA, 'readonly');
  return reqAsPromise(store.getAll());
}

async function getTuttiIGiorniAttivitaCompleto() {
  const { store } = await txStore(STORE_ATTIVITA_GIORNI, 'readonly');
  return reqAsPromise(store.getAll());
}

async function getTuttiGliStatiMesiAttivita() {
  const { store } = await txStore(STORE_STATO_MESI_ATTIVITA, 'readonly');
  return reqAsPromise(store.getAll());
}

async function esportaBackupCompleto() {
  const [ricevute, statoMesi, spese, statoMesiRimborso, firme, anagraficheAttivita, giorniAttivita, statoMesiAttivita] = await Promise.all([
    getTutteLeRicevute(),
    getTuttiGliStatiMesi(),
    getTutteLeSpese(),
    getTuttiGliStatiMesiRimborso(),
    getTutteLeFirme(),
    getTutteLeAnagraficheAttivita(),
    getTuttiIGiorniAttivitaCompleto(),
    getTuttiGliStatiMesiAttivita()
  ]);

  const ricevuteSerializzate = await Promise.all(
    ricevute.map(async (r) => ({ ...r, immagine: await blobToBase64(r.immagine) }))
  );
  const firmeSerializzate = await Promise.all(
    firme.map(async (f) => ({ ...f, immagine: await blobToBase64(f.immagine) }))
  );

  const backup = {
    versione: 1,
    esportatoIl: new Date().toISOString(),
    dipendenteAttivo: localStorage.getItem('dipendenteAttivo') || null,
    ricevute: ricevuteSerializzate,
    statoMesi,
    spese,
    statoMesiRimborso,
    firme: firmeSerializzate,
    anagraficheAttivita,
    giorniAttivita,
    statoMesiAttivita
  };

  const json = JSON.stringify(backup);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `backup_gestionale_lb_${dataOdiernaCompatta()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

async function scriviRecordConId(storeName, record) {
  const { store } = await txStore(storeName, 'readwrite');
  return reqAsPromise(store.put(record));
}

async function importaBackupCompleto(file) {
  const testo = await file.text();
  await ripristinaDaTesto(testo);
}

async function ripristinaDaTesto(testo) {
  let backup;
  try {
    backup = JSON.parse(testo);
  } catch (err) {
    alert('File di backup non valido o corrotto.');
    return;
  }

  if (!backup || backup.versione !== 1) {
    alert('File di backup non riconosciuto.');
    return;
  }

  const nRicevute = backup.ricevute?.length || 0;
  const nSpese = backup.spese?.length || 0;
  const nFirme = backup.firme?.length || 0;
  const nGiorniAttivita = backup.giorniAttivita?.length || 0;
  const dataEsportazione = backup.esportatoIl
    ? new Date(backup.esportatoIl).toLocaleString('it-IT')
    : 'data sconosciuta';

  const conferma = await chiediConferma(
    `Ripristinare questo backup (esportato il ${dataEsportazione})? Contiene ${nRicevute} scontrini, ${nSpese} spese, ${nGiorniAttivita} giornate attività e ${nFirme} firme. I dati con lo stesso ID verranno sovrascritti, il resto resta invariato.`
  );
  if (!conferma) return;

  for (const r of backup.ricevute || []) {
    await scriviRecordConId(STORE_RICEVUTE, { ...r, immagine: base64ToBlob(r.immagine) });
  }
  for (const s of backup.statoMesi || []) {
    await scriviRecordConId(STORE_STATO_MESI, s);
  }
  for (const s of backup.spese || []) {
    await scriviRecordConId(STORE_SPESE, s);
  }
  for (const s of backup.statoMesiRimborso || []) {
    await scriviRecordConId(STORE_STATO_MESI_RIMBORSO, s);
  }
  for (const f of backup.firme || []) {
    await scriviRecordConId(STORE_FIRME, { ...f, immagine: base64ToBlob(f.immagine) });
  }
  for (const a of backup.anagraficheAttivita || []) {
    await scriviRecordConId(STORE_ANAGRAFICA_ATTIVITA, a);
  }
  for (const g of backup.giorniAttivita || []) {
    await scriviRecordConId(STORE_ATTIVITA_GIORNI, g);
  }
  for (const s of backup.statoMesiAttivita || []) {
    await scriviRecordConId(STORE_STATO_MESI_ATTIVITA, s);
  }
  if (backup.dipendenteAttivo) {
    localStorage.setItem('dipendenteAttivo', backup.dipendenteAttivo);
    inizializzaDipendente();
  }

  alert('Ripristino completato.');
  stato.meseAttivo = await determinaMeseAttivoIniziale();
  await aggiornaDashboard();
  stato.meseAttivoRimborso = await determinaMeseAttivoRimborsoIniziale();
  stato.meseAttivoAttivita = await determinaMeseAttivoAttivitaIniziale(localStorage.getItem('dipendenteAttivo'));
}

el.btnEsportaBackup.addEventListener('click', esportaBackupCompleto);
el.btnImportaBackup.addEventListener('click', () => el.inputImportaBackup.click());
el.inputImportaBackup.addEventListener('change', async () => {
  const file = el.inputImportaBackup.files[0];
  if (file) await importaBackupCompleto(file);
  el.inputImportaBackup.value = '';
});

/* =========================================================
   AVVIO APP
   ========================================================= */

async function avvia() {
  inizializzaDipendente();
  stato.meseAttivo = await determinaMeseAttivoIniziale();
  await aggiornaDashboard();
  stato.meseAttivoRimborso = await determinaMeseAttivoRimborsoIniziale();
  stato.meseAttivoAttivita = await determinaMeseAttivoAttivitaIniziale(localStorage.getItem('dipendenteAttivo'));

  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }
}

avvia();

setTimeout(() => {
  el.splashScreen.classList.add('splash-nascosto');
  setTimeout(() => el.splashScreen.classList.add('hidden'), 400);
}, 2500);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.warn('Registrazione service worker fallita:', err);
    });
  });
}
