// ============================================================
// MEDITATE SPACE — per-user audio library + playlist player
//  - Storage: Supabase bucket `meditate_audio`, folder = user id
//  - Plays tracks one by one (auto-advance), prev/next/seek
//  - Modes: loop all ▸ loop one ▸ no loop
//  - Screen wake-lock so long sessions don't sleep the screen
//  Works with a PRIVATE bucket (signed URLs) and falls back to
//  public URLs if the bucket is public.
// ============================================================

const BUCKET = 'meditate_audio';

let currentUser = null;
let screenWakeLock = null;
let tracks = [];        // [{ name, path, size, created_at }]
let currentIndex = -1;
let mode = 'all';       // 'all' | 'one' | 'off'

const audio      = document.getElementById('audio-engine');
const fileInput  = document.getElementById('audio-file-input');
const btnUpload  = document.getElementById('btn-upload-audio');
const statusLog  = document.getElementById('upload-status');
const trackList  = document.getElementById('track-list');
const npState    = document.getElementById('np-state');
const npTitle    = document.getElementById('np-title');
const npSub      = document.getElementById('np-sub');
const seek       = document.getElementById('seek');
const timeCur    = document.getElementById('time-cur');
const timeDur    = document.getElementById('time-dur');
const btnPlay    = document.getElementById('btn-play');
const btnPrev    = document.getElementById('btn-prev');
const btnNext    = document.getElementById('btn-next');
const btnMode    = document.getElementById('btn-mode');
const dropzone   = document.getElementById('dropzone');
const dzPicked   = document.getElementById('dz-picked');

/* ---------------- helpers ---------------- */
function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 2600);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function prettyName(fileName) {
  // stored as "<timestamp>_<original name>" — strip the prefix + extension
  return fileName.replace(/^\d+_/, '').replace(/\.[a-z0-9]+$/i, '');
}

function fmtTime(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? mb.toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';
}

/* ---------------- wake lock ---------------- */
async function preventScreenLock() {
  if ('wakeLock' in navigator) {
    try {
      screenWakeLock = await navigator.wakeLock.request('screen');
    } catch (e) {
      document.getElementById('wake-note').textContent = '🌙 Wake-lock nggak didukung browser ini.';
    }
  }
}

/* ---------------- library ---------------- */
async function loadLibrary() {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(currentUser.id, { limit: 200, sortBy: { column: 'created_at', order: 'asc' } });

  if (error) {
    trackList.innerHTML = `<div class="empty">Gagal load library: ${escapeHtml(error.message)}</div>`;
    return;
  }

  tracks = (data || [])
    .filter(f => f.name && !f.name.startsWith('.'))
    .map(f => ({
      name: f.name,
      path: `${currentUser.id}/${f.name}`,
      size: f.metadata?.size,
      created_at: f.created_at,
    }));

  document.getElementById('lib-count').textContent = tracks.length ? `· ${tracks.length} track` : '';
  renderLibrary();
}

function renderLibrary() {
  if (tracks.length === 0) {
    trackList.innerHTML = `<div class="empty">Library masih kosong — upload audio pertama lo di bawah. 🎧</div>`;
    return;
  }
  trackList.innerHTML = tracks.map((t, i) => `
    <div class="track ${i === currentIndex ? 'active' : ''} ${i === currentIndex && !audio.paused ? 'playing' : ''}"
         data-index="${i}">
      <span class="eq"><span></span><span></span><span></span></span>
      <span class="track-no">${String(i + 1).padStart(2, '0')}</span>
      <span class="track-name" title="${escapeHtml(t.name)}">${escapeHtml(prettyName(t.name))}</span>
      <span class="track-meta">${fmtSize(t.size)}</span>
      <button class="track-del" data-del="${i}" title="Hapus track">✕</button>
    </div>`).join('');
}

trackList.addEventListener('click', async (e) => {
  const delBtn = e.target.closest('[data-del]');
  if (delBtn) {
    e.stopPropagation();
    await deleteTrack(Number(delBtn.dataset.del));
    return;
  }
  const row = e.target.closest('.track');
  if (row) playIndex(Number(row.dataset.index));
});

async function deleteTrack(i) {
  const t = tracks[i];
  if (!t) return;
  const { error } = await supabase.storage.from(BUCKET).remove([t.path]);
  if (error) { showToast('Gagal hapus: ' + error.message, 'err'); return; }
  showToast('Track dihapus.', 'ok');
  if (i === currentIndex) {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    currentIndex = -1;
    setNowPlaying(null);
  } else if (i < currentIndex) {
    currentIndex--;
  }
  await loadLibrary();
}

/* ---------------- playback ---------------- */
async function urlFor(path) {
  // private bucket first (signed), public bucket as fallback
  const { data: signed, error } = await supabase.storage
    .from(BUCKET).createSignedUrl(path, 60 * 60 * 3);
  if (!error && signed?.signedUrl) return signed.signedUrl;
  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

async function playIndex(i) {
  if (i < 0 || i >= tracks.length) return;
  currentIndex = i;
  const t = tracks[i];
  setNowPlaying(t, 'LOADING');
  renderLibrary();
  try {
    audio.src = await urlFor(t.path);
    await audio.play();
  } catch (e) {
    showToast('Gagal memutar track ini.', 'err');
    setNowPlaying(t, 'ERROR');
  }
}

function setNowPlaying(t, state) {
  if (!t) {
    npState.textContent = 'IDLE';
    npTitle.textContent = 'Nothing playing';
    npSub.textContent = 'Pick a track from your library below.';
    seek.disabled = true; seek.value = 0;
    seek.style.setProperty('--seek-pct', '0%');
    timeCur.textContent = '0:00'; timeDur.textContent = '0:00';
    btnPlay.textContent = '▶';
    document.body.classList.remove('playing');
    return;
  }
  npState.textContent = state || (audio.paused ? 'PAUSED' : 'PLAYING');
  npTitle.textContent = prettyName(t.name);
  npSub.textContent = `Track ${currentIndex + 1} of ${tracks.length}`;
  seek.disabled = false;
}

btnPlay.addEventListener('click', async () => {
  if (currentIndex === -1) { if (tracks.length) playIndex(0); return; }
  if (audio.paused) { try { await audio.play(); } catch (e) {} }
  else audio.pause();
});

btnPrev.addEventListener('click', () => {
  if (!tracks.length) return;
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  playIndex(currentIndex <= 0 ? tracks.length - 1 : currentIndex - 1);
});

btnNext.addEventListener('click', () => {
  if (!tracks.length) return;
  playIndex((currentIndex + 1) % tracks.length);
});

const MODES = { all: '🔁 all', one: '🔂 one', off: '➡ off' };
btnMode.addEventListener('click', () => {
  mode = mode === 'all' ? 'one' : mode === 'one' ? 'off' : 'all';
  btnMode.textContent = MODES[mode];
  btnMode.classList.toggle('on', mode !== 'off');
});

audio.addEventListener('play',  () => { document.body.classList.add('playing'); btnPlay.textContent = '⏸'; npState.textContent = 'PLAYING'; renderLibrary(); });
audio.addEventListener('pause', () => { document.body.classList.remove('playing'); btnPlay.textContent = '▶'; if (currentIndex !== -1) npState.textContent = 'PAUSED'; renderLibrary(); });

audio.addEventListener('ended', () => {
  if (mode === 'one') { audio.currentTime = 0; audio.play(); return; }
  const last = currentIndex === tracks.length - 1;
  if (last && mode === 'off') { setNowPlaying(tracks[currentIndex], 'DONE'); return; }
  playIndex((currentIndex + 1) % tracks.length);
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  seek.value = pct;
  seek.style.setProperty('--seek-pct', pct + '%');
  timeCur.textContent = fmtTime(audio.currentTime);
  timeDur.textContent = fmtTime(audio.duration);
});

seek.addEventListener('input', () => {
  if (!audio.duration) return;
  audio.currentTime = (seek.value / 100) * audio.duration;
});

/* ---------------- upload ---------------- */
fileInput.addEventListener('change', () => {
  const n = fileInput.files.length;
  dzPicked.textContent = n ? `${n} file dipilih: ${[...fileInput.files].map(f => f.name).join(', ').slice(0, 80)}` : '';
});

['dragover', 'dragleave', 'drop'].forEach(ev =>
  dropzone.addEventListener(ev, (e) => {
    e.preventDefault();
    dropzone.classList.toggle('drag', ev === 'dragover');
    if (ev === 'drop' && e.dataTransfer?.files?.length) {
      fileInput.files = e.dataTransfer.files;
      fileInput.dispatchEvent(new Event('change'));
    }
  }));

async function handleAudioUpload() {
  if (!currentUser) { showToast('Akses ditolak — login dulu.', 'err'); return; }
  const files = [...fileInput.files];
  if (!files.length) { showToast('Pilih file audio dulu.', 'err'); return; }

  btnUpload.disabled = true;
  let ok = 0, fail = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    statusLog.innerText = `Uploading ${i + 1}/${files.length}: ${f.name}…`;
    const safeName = f.name.replace(/[^\w.\- ]+/g, '_');
    const path = `${currentUser.id}/${Date.now()}_${safeName}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, f);
    if (error) { fail++; console.error(error); } else ok++;
  }
  btnUpload.disabled = false;
  fileInput.value = ''; dzPicked.textContent = '';
  statusLog.innerText = fail ? `${ok} berhasil, ${fail} gagal.` : `${ok} track masuk library ✓`;
  showToast(fail ? `${ok} ok, ${fail} gagal upload` : 'Upload berhasil!', fail ? 'err' : 'ok');
  await loadLibrary();
}
btnUpload.addEventListener('click', handleAudioUpload);
document.getElementById('btn-refresh').addEventListener('click', loadLibrary);

/* ---------------- init ---------------- */
async function initMeditateApp() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = '../../index.html'; return; }
  currentUser = user;
  await preventScreenLock();
  await loadLibrary();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') preventScreenLock();
});

document.addEventListener('DOMContentLoaded', initMeditateApp);
