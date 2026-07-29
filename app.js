'use strict';

/* =========================================================
   COSTANTI E UTILITY DATA
   ========================================================= */

const DB_NAME = 'ScontriniDB';
const DB_VERSION = 1;
const STORE_RICEVUTE = 'ricevute';
const STORE_STATO_MESI = 'statoMesi';
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
  angoloTrascinato: null
};

/* =========================================================
   RIFERIMENTI DOM
   ========================================================= */

const el = {
  viewHub: document.getElementById('view-hub'),
  selectDipendente: document.getElementById('select-dipendente'),
  cardScontrini: document.getElementById('card-scontrini'),
  cardRimborso: document.getElementById('card-rimborso'),
  cardAttivita: document.getElementById('card-attivita'),
  btnTornaHub: document.getElementById('btn-torna-hub'),

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

el.selectDipendente.addEventListener('change', () => {
  localStorage.setItem('dipendenteAttivo', el.selectDipendente.value);
});

el.cardScontrini.addEventListener('click', apriScontrini);
el.cardRimborso.addEventListener('click', () => alert('Modulo in costruzione'));
el.cardAttivita.addEventListener('click', () => alert('Modulo in costruzione'));
el.btnTornaHub.addEventListener('click', tornaAllHub);

/* =========================================================
   AVVIO APP
   ========================================================= */

async function avvia() {
  inizializzaDipendente();
  stato.meseAttivo = await determinaMeseAttivoIniziale();
  await aggiornaDashboard();
}

avvia();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(err => {
      console.warn('Registrazione service worker fallita:', err);
    });
  });
}
