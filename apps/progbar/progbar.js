// ============================================================
// SYSTEM BOOT // WELCOME TO GEMBEL AI PIK
// v2 — cloud storage relasional: focus_sessions (1 baris per sesi)
//      + focus_session_segments (1 baris per warna). Nggak ada blob
//      JSON lagi, nggak ada tulis-ke-cloud tiap detik: durasi dihitung
//      dari timestamp mulai/selesai, jadi otomatis kebal throttling
//      tab background DAN sesi aktif bisa di-resume dari device lain.
// ============================================================
console.log("%cSYSTEM BOOT // WELCOME TO GEMBEL AI PIK", "color: #00ffcc; font-size: 16px; font-weight: bold; background: #111; padding: 5px;");

// ===== PER-USER STORAGE (guest) =====
let UID = 'anon';
let IS_GUEST = true;
const K_HISTORY  = () => `cyber_${UID}_history`;
const K_STATE    = () => `cyber_${UID}_state`;
const K_MIGRATED = () => `cyber_${UID}_migrated_v2`;
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

// ===== STATE MANAGEMENT =====
// Sesi aktif = baris focus_sessions dengan ended_at NULL (maks. satu per
// user, dijaga unique index di DB). Segmen nyimpen TIMESTAMP, bukan counter:
//   segments: [{ dbId, color, startedAt: Date, endedAt: Date|null }]
// Durasi segmen berjalan = now - startedAt -> nggak perlu sync interval.
let state = {
    active: false,
    sessionId: null,
    startTime: null,
    targetTime: null,
    activeColor: null,
    segments: []
};

let HISTORY = []; // sesi selesai (ternormalisasi) buat panel laporan

function resetState() {
    state = { active: false, sessionId: null, startTime: null, targetTime: null, activeColor: null, segments: [] };
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
                dbId: null, color: s.color,
                startedAt: new Date(s.startedAt),
                endedAt: s.endedAt ? new Date(s.endedAt) : null
            }));
        } else {
            // format lama: {color, duration, timestamp} -> rekonstruksi timestamp
            state.segments = rawSegs.map((s, i, arr) => {
                const st = new Date(s.timestamp || p.startTime);
                const isLast = i === arr.length - 1;
                return {
                    dbId: null, color: s.color, startedAt: st,
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
// Dipanggil saat boot & saat insert sesi kena unique violation (device lain
// keburu mulai sesi) -> adopsi sesi itu beserta segmen-segmennya.
async function resumeOpenSession() {
    const { data, error } = await supabase
        .from('focus_sessions')
        .select('*, focus_session_segments(*)')
        .is('ended_at', null)
        .maybeSingle();
    if (error) { console.error('resume check failed:', error); return false; }
    if (!data) return false;

    state.active = true;
    state.sessionId = data.id;
    state.startTime = new Date(data.started_at);
    state.targetTime = new Date(state.startTime.getTime() + (Number(data.target_duration_ms) || TARGET_DURATION_MS));
    state.segments = (data.focus_session_segments || [])
        .slice()
        .sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
        .map(s => ({
            dbId: s.id, color: s.color,
            startedAt: new Date(s.started_at),
            endedAt: s.ended_at ? new Date(s.ended_at) : null
        }));
    state.activeColor = state.segments.length ? state.segments[state.segments.length - 1].color : null;
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
        // Mulai sesi baru -> INSERT satu baris focus_sessions.
        state.active = true;
        state.sessionId = null;
        state.startTime = now;
        state.targetTime = calculateTargetTime(now);
        state.segments = [];

        if (!IS_GUEST) {
            const ins = await supabase
                .from('focus_sessions')
                .insert({ user_id: UID, started_at: now.toISOString(), target_duration_ms: TARGET_DURATION_MS })
                .select()
                .single();
            if (ins.error) {
                const dup = ins.error.code === '23505' || /duplicate|unique/i.test(ins.error.message || '');
                // Sesi terbuka udah ada (mis. dari device lain) -> resume itu.
                if (!dup || !(await resumeOpenSession())) {
                    console.error('cloud session create failed:', ins.error);
                }
            } else if (ins.data) {
                state.sessionId = ins.data.id;
            }
        }
    }

    // Tutup segmen warna sebelumnya (stempel ended_at), JANGAN di-overwrite —
    // segmen baru selalu jadi BARIS BARU di focus_session_segments.
    const prev = state.segments[state.segments.length - 1];
    if (prev && !prev.endedAt) {
        prev.endedAt = now;
        if (!IS_GUEST && prev.dbId != null) {
            supabase.from('focus_session_segments')
                .update({ ended_at: now.toISOString() })
                .eq('id', prev.dbId)
                .then(({ error }) => { if (error) console.error('segment close failed:', error); });
        }
    }

    const seg = { dbId: null, color: color, startedAt: now, endedAt: null };
    state.segments.push(seg);
    state.activeColor = color;

    if (!IS_GUEST && state.sessionId) {
        const ins = await supabase
            .from('focus_session_segments')
            .insert({ session_id: state.sessionId, user_id: UID, color: color, started_at: now.toISOString() })
            .select('id')
            .single();
        if (ins.error) console.error('segment create failed:', ins.error);
        else if (ins.data) seg.dbId = ins.data.id;
    }

    saveGuestState();
    setActiveUI(false);
    document.getElementById('progress-status-overlay').innerText =
        `PROCESSING SESSION: ${color.toUpperCase()} // SYSTEM ENGAGED`;
    renderLiveProgress();
}

async function stopSession() {
    if (!state.active) return;
    const now = new Date();

    const last = state.segments[state.segments.length - 1];
    if (last && !last.endedAt) last.endedAt = now;

    if (IS_GUEST) {
        const history = loadGuestHistory();
        history.push({
            id: `session-${Date.now()}`,
            startTime: state.startTime.toISOString(),
            endTime: now.toISOString(),
            segments: state.segments.map(s => ({
                color: s.color,
                duration: Math.max(0, (s.endedAt || now).getTime() - s.startedAt.getTime()),
                timestamp: s.startedAt.toISOString()
            }))
        });
        saveGuestHistory(history);
    } else if (state.sessionId) {
        // Tutup segmen terakhir + sesi. Durasi nggak perlu dikirim:
        // duration_ms itu kolom GENERATED dari (ended_at - started_at).
        if (last && last.dbId != null) {
            const up = await supabase.from('focus_session_segments')
                .update({ ended_at: now.toISOString() })
                .eq('id', last.dbId);
            if (up.error) console.error('segment close failed:', up.error);
        }
        const done = await supabase.from('focus_sessions')
            .update({ ended_at: now.toISOString() })
            .eq('id', state.sessionId);
        if (done.error) {
            console.error('session close failed:', done.error);
            alert('Gagal menyimpan sesi ke cloud: ' + done.error.message);
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
async function fetchHistory() {
    if (IS_GUEST) {
        return loadGuestHistory()
            .map(normalizeStoredSession)
            .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
    }
    const { data, error } = await supabase
        .from('focus_sessions')
        .select('id, started_at, ended_at, focus_session_segments(color, started_at, ended_at, duration_ms)')
        .not('ended_at', 'is', null)
        .order('started_at', { ascending: false })
        .limit(60);
    if (error) { console.error('history load failed:', error); return []; }
    return (data || []).map(s => ({
        id: s.id,
        startTime: s.started_at,
        endTime: s.ended_at,
        segments: (s.focus_session_segments || [])
            .slice()
            .sort((a, b) => new Date(a.started_at) - new Date(b.started_at))
            .map(seg => ({
                color: seg.color,
                duration: (seg.duration_ms !== null && seg.duration_ms !== undefined)
                    ? Number(seg.duration_ms)
                    : Math.max(0, new Date(seg.ended_at || s.ended_at) - new Date(seg.started_at))
            }))
    }));
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
    } else {
        // Hapus sesi -> segmen-segmennya ikut kehapus (ON DELETE CASCADE).
        const { error } = await supabase.from('focus_sessions').delete().eq('id', id);
        if (error) { alert('Gagal hapus sesi: ' + error.message); return; }
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

// Terjemahkan satu sesi format file lama -> baris sessions + segments.
// Timestamp segmen direkonstruksi berurutan dari startTime + durasi.
async function insertImportedSessions(importedArr) {
    let okCount = 0;
    for (const s of importedArr) {
        if (!s || !s.startTime) continue;
        const startMs = new Date(s.startTime).getTime();
        if (!Number.isFinite(startMs)) continue;

        let cursor = startMs;
        const segRows = [];
        (s.segments || []).forEach(seg => {
            const st = seg.timestamp ? new Date(seg.timestamp).getTime() : cursor;
            const dur = Math.max(0, Number(seg.duration) || 0);
            if (!Number.isFinite(st)) return;
            segRows.push({
                color: SEGMENT_COLORS.indexOf(seg.color) !== -1 ? seg.color : 'green',
                started_at: new Date(st).toISOString(),
                ended_at: new Date(st + dur).toISOString()
            });
            cursor = st + dur;
        });

        let endMs = s.endTime ? new Date(s.endTime).getTime() : cursor;
        if (!Number.isFinite(endMs)) endMs = cursor;
        endMs = Math.max(endMs, startMs); // patuhi CHECK (ended_at >= started_at)

        const ins = await supabase.from('focus_sessions')
            .insert({
                user_id: UID,
                started_at: new Date(startMs).toISOString(),
                ended_at: new Date(endMs).toISOString(),
                target_duration_ms: TARGET_DURATION_MS
            })
            .select('id')
            .single();
        if (ins.error || !ins.data) { console.error('import session failed:', ins.error); continue; }

        if (segRows.length) {
            const segIns = await supabase.from('focus_session_segments')
                .insert(segRows.map(r => ({ ...r, session_id: ins.data.id, user_id: UID })));
            if (segIns.error) console.error('import segments failed:', segIns.error);
        }
        okCount++;
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
            // Sama kayak perilaku lama: import MENGGANTI history yang ada.
            // Sesi yang masih jalan nggak disentuh.
            const del = await supabase.from('focus_sessions')
                .delete()
                .eq('user_id', UID)
                .not('ended_at', 'is', null);
            if (del.error) { alert('Gagal mengganti history lama: ' + del.error.message); return; }

            await insertImportedSessions(imported);
            renderReports();
            alert("Data history berhasil di-import!");
        } catch (err) { alert("File JSON tidak valid / rusak."); }
    };
    reader.readAsText(file);
}

// MIGRASI SEKALI JALAN: user lama masih punya cache history era blob JSON
// di localStorage browser ini. Kalau cloud relasional masih kosong,
// angkut dulu biar nggak ada sesi yang hilang.
async function migrateLegacyProgbarLocalStorage() {
    if (localStorage.getItem(K_MIGRATED())) return;
    const legacy = loadGuestHistory(); // baca cyber_<uid>_history
    if (!Array.isArray(legacy) || legacy.length === 0) {
        localStorage.setItem(K_MIGRATED(), '1');
        return;
    }
    const { count, error } = await supabase
        .from('focus_sessions')
        .select('id', { count: 'exact', head: true });
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
        // Sesi aktif = baris ended_at NULL di cloud -> bisa lanjut dari
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