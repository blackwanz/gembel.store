// ============================================================
// SYSTEM BOOT // WELCOME TO GEMBEL AI PIK
// v3 — ditulis ulang buat skema tabel baru:
//   progbar_c  : 1 baris per SESSION aktif (current_state jsonb = seluruh
//                state live: startTime/targetTime/activeColor/segments).
//                Ditulis ulang (UPDATE current_state) tiap ganti warna,
//                bukan bikin baris per-segmen kayak versi lama.
//   progbar_h  : 1 baris per (user, effective_date) — prog_history jsonb
//                nyimpen ARRAY sesi yang SELESAI di hari itu (di-bucket
//                berdasarkan tanggal MULAI sesi). Ini yang dibaca balik
//                buat render panel laporan (LAPORAN SESI).
//   progbar_h2 : log historis per-segmen, WRITE-ONLY (nggak pernah dibaca
//                balik sama app ini) — 1 baris per potongan warna tiap
//                sesi selesai, buat kebutuhan analytics/export di luar app.
//                Asumsi satuan: duration & total_second_pool dalam DETIK,
//                total_hours dalam JAM (silakan sesuaikan kalau beda).
//
// CATATAN PENTING: penulisan ke progbar_h di sini pakai pola baca-lalu-
// tulis (SELECT existing row, gabung array, UPDATE/INSERT) — bukan
// .upsert()/onConflict — karena kita nggak bisa mastiin ada unique
// constraint di (user_id, effective_date) di sisi DB. Kalau constraint itu
// ADA, pola ini tetap benar; kalau BELUM ada, sebaiknya ditambahin biar
// "cuma 1 jsonb per effective_date" beneran terjamin di level DB juga
// (proteksi dari race antar-device/tab).
// ============================================================
console.log("%cSYSTEM BOOT // WELCOME TO GEMBEL AI PIK", "color: #00ffcc; font-size: 16px; font-weight: bold; background: #111; padding: 5px;");

// ===== PER-USER STORAGE (guest) =====
let UID = 'anon';
let IS_GUEST = true;
const K_HISTORY  = () => `cyber_${UID}_history`;
const K_STATE    = () => `cyber_${UID}_state`;
const K_MIGRATED = () => `cyber_${UID}_migrated_v3`;
const TARGET_DURATION_MS = 12 * 60 * 60 * 1000; // Standar Sesi 12 Jam
const SEGMENT_COLORS = ['green', 'blue', 'orange'];

// ===== FORMAT & HELPER WAKTU =====
const pad = (n) => String(n).padStart(2, '0');

function formatTime(d) {
    if (!d) return '--:--:--';
    const date = new Date(d);
    let h = date.getHours();
    let m = date.getMinutes();
    let s = date.getSeconds();
    let ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; h = h ? h : 12;
    return `${pad(h)}:${pad(m)}:${pad(s)} ${ampm}`;
}

function formatDuration(ms) {
    let totalSeconds = Math.floor(ms / 1000);
    let h = Math.floor(totalSeconds / 3600);
    let m = Math.floor((totalSeconds % 3600) / 60);
    let s = totalSeconds % 60;
    return `${pad(h)}h ${pad(m)}m ${pad(s)}s`;
}

function calculateTargetTime(startTime) {
    return new Date(startTime.getTime() + TARGET_DURATION_MS);
}

// Tanggal lokal YYYY-MM-DD (bukan UTC) — dipakai buat kolom `date`
// (effective_date, start_date, end_date). Pola sama kayak calendar.html
// biar konsisten & bebas masalah pergeseran timezone.
function localDateStr(d) {
    const dt = new Date(d);
    return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

// uuid v4 — session_id di-generate DI BROWSER pas sesi mulai.
function uuidv4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = [...bytes].map(b => b.toString(16).padStart(2, '0'));
        return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ===== STATE MANAGEMENT =====
// Sesi aktif = 1 baris progbar_c milik session_id ini. Beda dari versi
// lama: SEMUA segmen sesi yang lagi jalan ikut nempel di dalam
// current_state jsonb (bukan baris terpisah per segmen), jadi tiap ganti
// warna cuma satu UPDATE ke progbar_c.
let state = {
    active: false,
    sessionId: null,
    rowId: null, // id (pk) baris progbar_c, cadangan kalau session_id gagal ke-set
    startTime: null,
    targetTime: null,
    activeColor: null,
    segments: []
};

let HISTORY = []; // sesi selesai (ternormalisasi) buat panel laporan

function resetState() {
    state = { active: false, sessionId: null, rowId: null, startTime: null, targetTime: null, activeColor: null, segments: [] };
}

function targetPoolMs() {
    return (state.targetTime && state.startTime)
        ? (state.targetTime.getTime() - state.startTime.getTime())
        : TARGET_DURATION_MS;
}

// Adaptasi segmen timestamp -> {color, duration} untuk rendering.
function liveSegments(now = new Date()) {
    return state.segments.map(s => ({
        color: s.color,
        duration: Math.max(0, (s.endedAt ? s.endedAt.getTime() : now.getTime()) - s.startedAt.getTime())
    }));
}

// Bentuk current_state jsonb yang ditulis ke progbar_c.
function buildCurrentStateJSON() {
    return {
        startTime: state.startTime.toISOString(),
        targetTime: state.targetTime.toISOString(),
        activeColor: state.activeColor,
        segments: state.segments.map(s => ({
            color: s.color,
            startedAt: s.startedAt.toISOString(),
            endedAt: s.endedAt ? s.endedAt.toISOString() : null
        }))
    };
}

function applyCurrentStateJSON(json) {
    state.startTime = new Date(json.startTime);
    state.targetTime = new Date(json.targetTime || (state.startTime.getTime() + TARGET_DURATION_MS));
    state.segments = (json.segments || []).map(s => ({
        color: s.color,
        startedAt: new Date(s.startedAt),
        endedAt: s.endedAt ? new Date(s.endedAt) : null
    }));
    state.activeColor = json.activeColor || (state.segments.length ? state.segments[state.segments.length - 1].color : null);
}

// ===== GUEST PERSISTENCE (localStorage, kayak dulu) =====
function saveGuestState() {
    if (!IS_GUEST) return;
    if (state.active) {
        localStorage.setItem(K_STATE(), JSON.stringify({
            active: true,
            startTime: state.startTime.toISOString(),
            targetTime: state.targetTime.toISOString(),
            activeColor: state.activeColor,
            segments: state.segments.map(s => ({
                color: s.color,
                startedAt: s.startedAt.toISOString(),
                endedAt: s.endedAt ? s.endedAt.toISOString() : null
            }))
        }));
    } else {
        localStorage.removeItem(K_STATE());
    }
}

function loadGuestHistory() {
    try { return JSON.parse(localStorage.getItem(K_HISTORY()) || '[]') || []; }
    catch (e) { return []; }
}

function saveGuestHistory(history) {
    localStorage.setItem(K_HISTORY(), JSON.stringify(history));
}

// History guest / file export tetap pakai bentuk lama
// ({color, duration, timestamp}) biar file JSON lama tetap kebaca.
function normalizeStoredSession(s) {
    return {
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        segments: (s.segments || []).map(seg => ({
            color: seg.color,
            duration: (seg.duration !== undefined && seg.duration !== null)
                ? Number(seg.duration) || 0
                : Math.max(0, new Date(seg.endedAt || s.endTime) - new Date(seg.startedAt || seg.timestamp))
        }))
    };
}

// Pulihkan sesi aktif guest dari localStorage (ngerti format lama & baru).
function restoreGuestState() {
    const saved = localStorage.getItem(K_STATE());
    if (!saved) return false;
    try {
        const p = JSON.parse(saved);
        if (!p || !p.active) return false;
        state.active = true;
        state.sessionId = null;
        state.startTime = new Date(p.startTime);
        state.targetTime = new Date(p.targetTime || (state.startTime.getTime() + TARGET_DURATION_MS));
        const rawSegs = p.segments || [];
        if (rawSegs.length && rawSegs[0].startedAt) {
            // format baru: timestamp murni
            state.segments = rawSegs.map(s => ({
                color: s.color,
                startedAt: new Date(s.startedAt),
                endedAt: s.endedAt ? new Date(s.endedAt) : null
            }));
        } else {
            // format lama: {color, duration, timestamp} -> rekonstruksi timestamp
            state.segments = rawSegs.map((s, i, arr) => {
                const st = new Date(s.timestamp || p.startTime);
                const isLast = i === arr.length - 1;
                return {
                    color: s.color, startedAt: st,
                    endedAt: isLast ? null : new Date(st.getTime() + (Number(s.duration) || 0))
                };
            });
        }
        state.activeColor = p.activeColor ||
            (state.segments.length ? state.segments[state.segments.length - 1].color : null);
        return true;
    } catch (e) { return false; }
}

// ===== CLOUD: RESUME SESI TERBUKA =====
// progbar_c sekarang di-key per session_id (bukan per user_id), jadi buat
// nemu "sesi aktif milik user ini" kita filter by user_id dan ambil yang
// paling baru — normalnya cuma ada satu (app cuma pernah mulai satu sesi
// dalam satu waktu), tapi kalau ada race dari 2 device kita ambil yang
// terbaru biar nggak nyangkut di baris basi.
async function resumeOpenSession() {
    const { data, error } = await supabase
        .from('progbar_c')
        .select('*')
        .eq('user_id', UID)
        .order('created_at', { ascending: false })
        .limit(1);
    if (error) { console.error('resume check failed:', error); return false; }
    if (!data || !data.length) return false;

    const row = data[0];
    state.active = true;
    state.sessionId = row.session_id;
    state.rowId = row.id;
    applyCurrentStateJSON(row.current_state || {});
    return true;
}

// ===== MULTI-CLICK KONTROL (Hijau, Biru, Oranye, Stop) =====
let clickCount = 0;
let clickTimer = null;
const actionBtn = document.getElementById('action-button');

actionBtn.addEventListener('click', () => {
    clickCount++;
    clearTimeout(clickTimer);

    if (clickCount >= 5) {
        handleAction(5);
        clickCount = 0;
    } else {
        clickTimer = setTimeout(() => {
            handleAction(clickCount);
            clickCount = 0;
        }, 400); // Tunggu delay 400ms untuk identifikasi combo click
    }
});

function handleAction(clicks) {
    if (clicks === 1) switchColor('green');
    else if (clicks === 2) switchColor('blue');
    else if (clicks === 3) switchColor('orange');
    else if (clicks >= 5) stopSession();
}

function setActiveUI(resumed) {
    const now = new Date();
    document.querySelector('.status-indicator').classList.add('active');
    document.getElementById('target-display').innerText =
        `[${formatTime(state.targetTime)} - ${state.targetTime.getDate() === now.getDate() ? 'HARI INI' : 'BESOK'}]`;
    document.getElementById('progress-status-overlay').innerText =
        `PROCESSING SESSION: ${(state.activeColor || '...').toUpperCase()} // ${resumed ? 'SYSTEM RESUMED' : 'SYSTEM ENGAGED'}`;
}

async function switchColor(color) {
    const now = new Date();

    if (!state.active) {
        // Mulai sesi baru -> INSERT satu baris progbar_c; session_id
        // di-generate di browser (bukan default DB) jadi UI nggak perlu
        // nunggu round-trip buat tau identitas sesinya.
        state.active = true;
        state.sessionId = uuidv4();
        state.rowId = null;
        state.startTime = now;
        state.targetTime = calculateTargetTime(now);
        state.segments = [];

        if (!IS_GUEST) {
            const ins = await supabase
                .from('progbar_c')
                .insert({
                    user_id: UID,
                    session_id: state.sessionId,
                    current_state: buildCurrentStateJSON(),
                    effective_date: localDateStr(now),
                })
                .select('id')
                .single();
            if (ins.error) {
                console.error('cloud session create failed:', ins.error);
            } else if (ins.data) {
                state.rowId = ins.data.id;
            }
        }
    }

    // Tutup segmen warna sebelumnya — IN-MEMORY aja, karena semua segmen
    // sesi yang lagi live hidup DI DALAM current_state jsonb, bukan baris
    // terpisah per segmen (beda dari progbar_h2 yang baru ditulis pas stop).
    const prev = state.segments[state.segments.length - 1];
    if (prev && !prev.endedAt) prev.endedAt = now;

    state.segments.push({ color: color, startedAt: now, endedAt: null });
    state.activeColor = color;

    if (!IS_GUEST) {
        supabase.from('progbar_c')
            .update({ current_state: buildCurrentStateJSON(), updated_at: now.toISOString() })
            .eq('session_id', state.sessionId)
            .then(({ error }) => { if (error) console.error('progbar_c update failed:', error); });
    }

    saveGuestState();
    setActiveUI(false);
    document.getElementById('progress-status-overlay').innerText =
        `PROCESSING SESSION: ${color.toUpperCase()} // SYSTEM ENGAGED`;
    renderLiveProgress();
}

// Tulis (atau gabung ke) baris progbar_h milik satu effective_date —
// dipakai baik pas stopSession() maupun pas import. Baca dulu barisnya
// (kalau ada), append sesi baru ke array prog_history, baru INSERT/UPDATE
// eksplisit (bukan upsert) biar nggak gantung ke unique constraint yang
// belum tentu ada di DB.
async function appendToDailyHistory(effDate, sessionSummary) {
    const existing = await supabase.from('progbar_h')
        .select('id, prog_history')
        .eq('user_id', UID)
        .eq('effective_date', effDate)
        .maybeSingle();
    if (existing.error) { console.error('progbar_h read failed:', existing.error); return existing.error; }

    const prevHistory = (existing.data && Array.isArray(existing.data.prog_history)) ? existing.data.prog_history : [];
    const nextHistory = prevHistory.concat([sessionSummary]);

    let writeRes;
    if (existing.data && existing.data.id) {
        writeRes = await supabase.from('progbar_h')
            .update({ session_id: sessionSummary.sessionId, prog_history: nextHistory, updated_at: new Date().toISOString() })
            .eq('id', existing.data.id);
    } else {
        writeRes = await supabase.from('progbar_h').insert({
            user_id: UID, session_id: sessionSummary.sessionId, effective_date: effDate,
            prog_history: nextHistory,
        });
    }
    if (writeRes.error) console.error('progbar_h write failed:', writeRes.error);
    return writeRes.error;
}

async function stopSession() {
    if (!state.active) return;
    const now = new Date();

    const last = state.segments[state.segments.length - 1];
    if (last && !last.endedAt) last.endedAt = now;

    const finishedSummary = {
        sessionId: state.sessionId,
        startTime: state.startTime.toISOString(),
        endTime: now.toISOString(),
        segments: state.segments.map(s => ({
            color: s.color,
            duration: Math.max(0, (s.endedAt || now).getTime() - s.startedAt.getTime())
        }))
    };

    if (IS_GUEST) {
        const history = loadGuestHistory();
        history.push({
            id: `session-${Date.now()}`,
            startTime: finishedSummary.startTime,
            endTime: finishedSummary.endTime,
            segments: finishedSummary.segments.map(s => ({ ...s, timestamp: state.startTime.toISOString() }))
        });
        saveGuestHistory(history);
    } else {
        try {
            // 1) Sesi ini nggak lagi "current" -> hapus baris progbar_c-nya.
            const del = await supabase.from('progbar_c').delete().eq('session_id', state.sessionId);
            if (del.error) console.error('progbar_c cleanup failed:', del.error);

            // 2) Rollup harian: 1 baris progbar_h per effective_date (di-
            // bucket ke tanggal MULAI sesi). Kalau hari itu udah ada baris
            // (sesi lain yang selesai duluan), GABUNG ke array-nya.
            const effDate = localDateStr(state.startTime);
            const histErr = await appendToDailyHistory(effDate, finishedSummary);
            if (histErr) alert('Gagal menyimpan sesi ke cloud: ' + (histErr.message || histErr));

            // 3) Log historis per-segmen ke progbar_h2 — WRITE-ONLY, app ini
            // nggak pernah baca baliknya.
            const targetSeconds = Math.round(targetPoolMs() / 1000);
            const segRows = state.segments
                .filter(s => (s.endedAt || now).getTime() > s.startedAt.getTime())
                .map(s => {
                    const durSec = Math.round(((s.endedAt || now).getTime() - s.startedAt.getTime()) / 1000);
                    return {
                        user_id: UID,
                        session_id: state.sessionId,
                        start_date: localDateStr(s.startedAt),
                        end_date: localDateStr(s.endedAt || now),
                        color: s.color,
                        duration: durSec,
                        total_hours: Math.round((durSec / 3600) * 10000) / 10000,
                        total_second_pool: targetSeconds,
                    };
                });
            if (segRows.length) {
                const h2 = await supabase.from('progbar_h2').insert(segRows);
                if (h2.error) console.error('progbar_h2 insert failed:', h2.error);
            }
        } catch (e) {
            console.error('stopSession cloud write failed:', e);
            alert('Gagal menyimpan sesi ke cloud: ' + (e.message || e));
        }
    }

    resetState();
    saveGuestState();

    document.querySelector('.status-indicator').classList.remove('active');
    document.getElementById('target-display').innerText = '[BELUM AKTIF]';
    document.getElementById('progress-status-overlay').innerText = 'SYSTEM IDLE // AWAITING COMMAND';
    document.getElementById('progress-bar-base').innerHTML = '';

    renderReports();
}

// ===== DATA: HISTORY =====
// Balikin bentuk yang sama kayak versi lama ({id,startTime,endTime,segments})
// supaya renderReports/exportHistoryJSON/buildProgressSegmentsHTML nggak
// perlu berubah — bedanya sumbernya sekarang progbar_h (array sesi per
// hari), bukan tabel focus_sessions ternormalisasi.
async function fetchHistory() {
    if (IS_GUEST) {
        return loadGuestHistory()
            .map(normalizeStoredSession)
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    }
    const { data, error } = await supabase
        .from('progbar_h')
        .select('effective_date, prog_history')
        .eq('user_id', UID)
        .order('effective_date', { ascending: false })
        .limit(60);
    if (error) { console.error('history load failed:', error); return []; }

    const flat = [];
    (data || []).forEach(row => {
        (row.prog_history || []).forEach(sess => {
            flat.push({
                id: sess.sessionId,
                _effectiveDate: row.effective_date, // dipakai internal buat deleteReport
                startTime: sess.startTime,
                endTime: sess.endTime,
                segments: (sess.segments || []).map(seg => ({ color: seg.color, duration: Number(seg.duration) || 0 }))
            });
        });
    });
    flat.sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    return flat;
}

// ===== UI RENDERING =====
function renderLiveProgress(now = new Date()) {
    if (!state.active) return;
    const base = document.getElementById('progress-bar-base');
    base.innerHTML = buildProgressSegmentsHTML(liveSegments(now), targetPoolMs());
}

async function renderReports() {
    const list = document.getElementById('report-list');
    HISTORY = await fetchHistory();

    if (HISTORY.length === 0) {
        list.innerHTML = '<div style="color:var(--text-faint); font-size:12px; padding:10px;">Belum ada data sesi tersimpan.</div>';
        return;
    }

    let html = '';
    HISTORY.forEach(session => {
        const start = new Date(session.startTime);
        let totalDuration = 0;
        session.segments.forEach(s => totalDuration += s.duration);

        html += `
        <div class="report-card" style="border:1px solid #333; padding:10px; margin-bottom:10px; border-radius:5px; background:#1a1a1a;">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                <span style="font-weight:bold; color:#00ffcc;">SESSION ${formatTime(start)}</span>
                <span style="color:#888; font-size:11px;">Total: ${formatDuration(totalDuration)}</span>
            </div>
            <div class="progress-bar-base" style="height:10px; border-radius:3px; overflow:hidden; display:flex; background:#000;">
                ${buildProgressSegmentsHTML(session.segments, TARGET_DURATION_MS)}
            </div>
            <button onclick="deleteReport('${session.id}')" style="margin-top:8px; background:none; border:none; color:#ef4444; font-size:11px; cursor:pointer; text-decoration:underline;">Hapus Sesi</button>
        </div>`;
    });
    list.innerHTML = html;
}

function buildProgressSegmentsHTML(segments, totalPool) {
    let html = '';
    segments.forEach(seg => {
        if (seg.duration <= 0) return;
        const pct = totalPool > 0 ? (seg.duration / totalPool) * 100 : 0;
        let colorHex = '#22c55e'; // Green default
        if (seg.color === 'blue') colorHex = '#3b82f6';
        if (seg.color === 'orange') colorHex = '#f97316';
        html += `<div class="progress-segment" style="width: ${pct}%; background-color: ${colorHex}; height:100%;"></div>`;
    });
    return html;
}

window.deleteReport = async function (id) {
    if (IS_GUEST) {
        saveGuestHistory(loadGuestHistory().filter(item => item.id !== id));
        renderReports();
        return;
    }
    // Sesi hidup NESTED di dalam array prog_history milik satu baris
    // progbar_h (per hari) — jadi "hapus sesi ini" = keluarin dari array
    // itu, lalu tulis ulang (atau hapus barisnya kalau array jadi kosong).
    const target = HISTORY.find(s => s.id === id);
    if (!target || !target._effectiveDate) { renderReports(); return; }
    try {
        const existing = await supabase.from('progbar_h')
            .select('id, prog_history')
            .eq('user_id', UID)
            .eq('effective_date', target._effectiveDate)
            .maybeSingle();
        if (existing.error) throw existing.error;
        const remaining = ((existing.data && existing.data.prog_history) || []).filter(s => s.sessionId !== id);
        if (!existing.data || !existing.data.id) {
            // baris udah kehapus/gak ketemu -- gak ada apa-apa buat dihapus
        } else if (remaining.length === 0) {
            const del = await supabase.from('progbar_h').delete().eq('id', existing.data.id);
            if (del.error) throw del.error;
        } else {
            const up = await supabase.from('progbar_h')
                .update({ prog_history: remaining, updated_at: new Date().toISOString() })
                .eq('id', existing.data.id);
            if (up.error) throw up.error;
        }
        // Catatan: baris progbar_h2 punya sesi ini TETAP DIBIARKAN -- itu log
        // historis write-only, dianggap arsip permanen yang independen dari
        // panel laporan yang kelihatan di UI.
    } catch (e) {
        alert('Gagal hapus sesi: ' + (e.message || e));
        return;
    }
    renderReports();
}

// ===== EXPORT / IMPORT JSON (format file lama tetap dipakai) =====
window.exportHistoryJSON = async function () {
    const hist = await fetchHistory();
    const out = hist.map(s => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        segments: s.segments.map(seg => ({ color: seg.color, duration: seg.duration }))
    }));
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NeonFlow_History_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Terjemahkan satu sesi format file lama -> entri progbar_h (dikelompokkan
// per effective_date, digabung ke baris yang udah ada) + baris progbar_h2
// per segmen. Timestamp segmen direkonstruksi berurutan dari startTime +
// durasi, sama kayak versi lama.
async function insertImportedSessions(importedArr) {
    const byDate = {}; // effective_date -> [] ringkasan sesi
    let okCount = 0;

    for (const s of importedArr) {
        if (!s || !s.startTime) continue;
        const startMs = new Date(s.startTime).getTime();
        if (!Number.isFinite(startMs)) continue;

        let cursor = startMs;
        const segs = [];
        (s.segments || []).forEach(seg => {
            const st = seg.timestamp ? new Date(seg.timestamp).getTime() : cursor;
            const dur = Math.max(0, Number(seg.duration) || 0);
            if (!Number.isFinite(st)) return;
            segs.push({
                color: SEGMENT_COLORS.indexOf(seg.color) !== -1 ? seg.color : 'green',
                startedAt: new Date(st),
                endedAt: new Date(st + dur),
            });
            cursor = st + dur;
        });

        let endMs = s.endTime ? new Date(s.endTime).getTime() : cursor;
        if (!Number.isFinite(endMs)) endMs = cursor;
        endMs = Math.max(endMs, startMs);

        const sessionId = s.id || uuidv4();
        const summary = {
            sessionId: sessionId,
            startTime: new Date(startMs).toISOString(),
            endTime: new Date(endMs).toISOString(),
            segments: segs.map(seg => ({ color: seg.color, duration: Math.max(0, seg.endedAt.getTime() - seg.startedAt.getTime()) }))
        };
        const dKey = localDateStr(new Date(startMs));
        if (!byDate[dKey]) byDate[dKey] = [];
        byDate[dKey].push(summary);

        // progbar_h2: satu baris per segmen (log historis write-only)
        const targetSeconds = Math.round(TARGET_DURATION_MS / 1000);
        const h2Rows = segs.map(seg => {
            const durSec = Math.round((seg.endedAt.getTime() - seg.startedAt.getTime()) / 1000);
            return {
                user_id: UID, session_id: sessionId,
                start_date: localDateStr(seg.startedAt), end_date: localDateStr(seg.endedAt),
                color: seg.color, duration: durSec,
                total_hours: Math.round((durSec / 3600) * 10000) / 10000,
                total_second_pool: targetSeconds,
            };
        });
        if (h2Rows.length) {
            const ins = await supabase.from('progbar_h2').insert(h2Rows);
            if (ins.error) console.error('import progbar_h2 failed:', ins.error);
        }
        okCount++;
    }

    // Gabung ke baris progbar_h yang sudah ada per tanggal (bukan overwrite).
    for (const dKey in byDate) {
        const sessionsForDay = byDate[dKey];
        const existing = await supabase.from('progbar_h')
            .select('id, prog_history').eq('user_id', UID).eq('effective_date', dKey).maybeSingle();
        const prevHistory = (existing.data && Array.isArray(existing.data.prog_history)) ? existing.data.prog_history : [];
        const merged = prevHistory.concat(sessionsForDay);
        const lastSessionId = sessionsForDay[sessionsForDay.length - 1].sessionId;

        let res;
        if (existing.data && existing.data.id) {
            res = await supabase.from('progbar_h')
                .update({ session_id: lastSessionId, prog_history: merged, updated_at: new Date().toISOString() })
                .eq('id', existing.data.id);
        } else {
            res = await supabase.from('progbar_h').insert({
                user_id: UID, effective_date: dKey, session_id: lastSessionId, prog_history: merged,
            });
        }
        if (res.error) console.error('import progbar_h write failed:', res.error);
    }

    return okCount;
}

window.importHistoryJSON = function (file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported)) throw new Error('not-array');

            if (IS_GUEST) {
                saveGuestHistory(imported);
                renderReports();
                alert("Data history berhasil di-import!");
                return;
            }
            // Sama kayak perilaku lama: import MENGGANTI history yang ada
            // (semua rollup harian progbar_h dihapus). Sesi yang masih
            // jalan (progbar_c) nggak disentuh.
            const del = await supabase.from('progbar_h').delete().eq('user_id', UID);
            if (del.error) { alert('Gagal mengganti history lama: ' + del.error.message); return; }

            await insertImportedSessions(imported);
            renderReports();
            alert("Data history berhasil di-import!");
        } catch (err) { alert("File JSON tidak valid / rusak."); }
    };
    reader.readAsText(file);
}

// MIGRASI SEKALI JALAN: user lama masih punya cache history era blob JSON
// di localStorage browser ini. Kalau cloud (progbar_h) masih kosong,
// angkut dulu biar nggak ada sesi yang hilang.
async function migrateLegacyProgbarLocalStorage() {
    if (localStorage.getItem(K_MIGRATED())) return;
    const legacy = loadGuestHistory(); // baca cyber_<uid>_history
    if (!Array.isArray(legacy) || legacy.length === 0) {
        localStorage.setItem(K_MIGRATED(), '1');
        return;
    }
    const { count, error } = await supabase
        .from('progbar_h')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', UID);
    if (error) { console.warn('migration check skipped:', error.message); return; } // coba lagi boot berikutnya
    if ((count || 0) === 0) {
        const n = await insertImportedSessions(legacy);
        console.log(`SYSTEM // ${n} sesi lama dimigrasi dari browser ini ke cloud.`);
    }
    localStorage.setItem(K_MIGRATED(), '1');
}

window.exitGuestDemo = function () {
    localStorage.removeItem('cyber_anon_history');
    localStorage.removeItem('cyber_anon_state');
}

// ===== REAL-TIME CLOCK =====
function updateClock() {
    const now = new Date();
    const days = ['MINGGU','SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU'];
    const months = ['JAN','FEB','MAR','APR','MEI','JUN','JUL','AGU','SEP','OKT','NOV','DES'];

    document.getElementById('current-date').innerText = `${days[now.getDay()]}, ${pad(now.getDate())} ${months[now.getMonth()]} ${now.getFullYear()}`;
    document.getElementById('current-time').innerText = formatTime(now);

    if (state.active && state.startTime) {
        renderLiveProgress(now);
        const remaining = targetPoolMs() - (now.getTime() - state.startTime.getTime());
        if (remaining <= 0) {
            document.getElementById('countdown-display').innerText = "00h 00m 00s (LIMIT)";
        } else {
            document.getElementById('countdown-display').innerText = formatDuration(remaining);
        }
    } else {
        document.getElementById('countdown-display').innerText = "00h 00m 00s";
    }
}

// ===== INIT DAN EVENT LISTENERS =====
async function initProgbarApp() {
    // Supabase Auth context checks
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        UID = session.user.id;
        IS_GUEST = false;
    } else {
        IS_GUEST = true;
        document.getElementById('guest-banner').style.display = 'block';
    }

    let resumed = false;
    if (IS_GUEST) {
        resumed = restoreGuestState();
    } else {
        // Sesi aktif = baris progbar_c milik user ini -> bisa lanjut dari
        // device mana pun, nggak lagi ngandelin localStorage.
        resumed = await resumeOpenSession();
        await migrateLegacyProgbarLocalStorage();
    }

    if (resumed && state.active) {
        setActiveUI(true);
        console.log("SYSTEM // Sesi aktif dipulihkan.");
    }

    await renderReports();
    setInterval(updateClock, 1000);
    updateClock();
}

document.addEventListener('DOMContentLoaded', initProgbarApp);