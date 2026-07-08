// ============================================================
// progbar.js — NEW RELATIONAL SCHEMA (focus_sessions + segments)
// ============================================================

let CURRENT_USER = null;
let IS_GUEST = false;

// State
let currentSession = null;   // the active focus_sessions row (ended_at IS NULL)
let segments = [];           // current session's focus_session_segments

const TARGET_DURATION_MS = 12 * 60 * 60 * 1000; // 12 hours

// ============== SUPABASE HELPERS ==============
async function loadActiveSession() {
    if (IS_GUEST) return;
    const { data } = await supabase
        .from('focus_sessions')
        .select('*')
        .eq('user_id', CURRENT_USER.id)
        .is('ended_at', null)
        .maybeSingle();

    currentSession = data;
    if (currentSession) {
        await loadSegments(currentSession.id);
    }
}

async function loadSegments(sessionId) {
    if (!sessionId) return;
    const { data } = await supabase
        .from('focus_session_segments')
        .select('*')
        .eq('session_id', sessionId)
        .order('started_at');
    segments = data || [];
}

async function createNewSession() {
    if (IS_GUEST) return;
    const now = new Date().toISOString();
    const { data, error } = await supabase
        .from('focus_sessions')
        .insert({
            user_id: CURRENT_USER.id,
            started_at: now,
            target_duration_ms: TARGET_DURATION_MS
        })
        .select()
        .single();

    if (!error) currentSession = data;
}

async function addSegment(color) {
    if (!currentSession || IS_GUEST) return;
    const nowStr = new Date().toISOString();
    const nowTime = new Date(nowStr).getTime();

    // Close previous segment if exists & calculate duration
    if (segments.length > 0) {
        const last = segments[segments.length - 1];
        if (!last.ended_at) {
            const startDuration = new Date(last.started_at).getTime();
            const calcDuration = nowTime - startDuration;
            
            await supabase
                .from('focus_session_segments')
                .update({ ended_at: nowStr, duration_ms: calcDuration })
                .eq('id', last.id);
                
            last.ended_at = nowStr;
            last.duration_ms = calcDuration;
        }
    }

    // Insert new segment
    const { data, error } = await supabase
        .from('focus_session_segments')
        .insert({
            session_id: currentSession.id,
            user_id: CURRENT_USER.id,
            color: color,
            started_at: nowStr
        })
        .select()
        .single();

    if (!error && data) segments.push(data);
}

async function stopSession() {
    if (!currentSession || IS_GUEST) return;
    const nowStr = new Date().toISOString();
    const nowTime = new Date(nowStr).getTime();

    // Close last segment & calculate duration
    if (segments.length > 0) {
        const last = segments[segments.length - 1];
        if (!last.ended_at) {
            const startDuration = new Date(last.started_at).getTime();
            const calcDuration = nowTime - startDuration;
            
            await supabase
                .from('focus_session_segments')
                .update({ ended_at: nowStr, duration_ms: calcDuration })
                .eq('id', last.id);
                
            last.ended_at = nowStr;
            last.duration_ms = calcDuration;
        }
    }

    // Close main session
    await supabase
        .from('focus_sessions')
        .update({ ended_at: nowStr })
        .eq('id', currentSession.id);

    currentSession = null;
    segments = [];
    document.querySelector('.status-indicator').classList.remove('active');
    
    updateUI();
}

// ============== UI ACTIONS ==============
let clickCount = 0;
let clickTimer = null;

document.getElementById('action-button').addEventListener('click', () => {
    clickCount++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
        handleMultiClick(clickCount);
        clickCount = 0;
    }, 400);
});

function handleMultiClick(count) {
    if (count === 1) startOrSwitchColor('green');
    else if (count === 2) startOrSwitchColor('blue');
    else if (count === 3 || count === 4) startOrSwitchColor('orange'); // Menutup celah klik 4x
    else if (count >= 5) stopSession();
}

async function startOrSwitchColor(color) {
    if (!currentSession) {
        await createNewSession();
        document.querySelector('.status-indicator').classList.add('active');
    }
    await addSegment(color);
    updateUI();
}

// ============== RENDERING ==============
function updateUI() {
    renderLiveProgress();
    renderReports();
}

function renderLiveProgress() {
    const base = document.getElementById('progress-bar-base');
    if (base) base.innerHTML = buildSegmentsHTML(segments);
}

function buildSegmentsHTML(segs) {
    let html = '';
    const nowTime = Date.now();
    
    segs.forEach(seg => {
        const startTime = new Date(seg.started_at).getTime();
        
        // Kalkulasi durasi dinamis untuk segmen yang masih aktif (belum ada ended_at)
        let duration = seg.duration_ms || 0;
        if (!seg.ended_at) {
            duration = nowTime - startTime;
        }
        
        const pct = Math.min((duration / TARGET_DURATION_MS) * 100, 100); // Cegah lebar lebih dari 100%
        
        let color = '#22c55e'; // default green
        if (seg.color === 'blue') color = '#3b82f6';
        if (seg.color === 'orange') color = '#f97316';
        
        html += `<div class="progress-segment" style="width:${pct}%; background:${color};"></div>`;
    });
    
    return html;
}

function renderReports() {
    const list = document.getElementById('report-list');
    if (!list) return;
    // Logika render history yang belum diimplementasikan dibiarkan
    list.innerHTML = '<div style="color:#888;padding:10px;">Loading history...</div>';
}

// ============== INIT ==============
async function initProgbar() {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        CURRENT_USER = session.user;
        IS_GUEST = false;
        await loadActiveSession();
        if (currentSession) {
            document.querySelector('.status-indicator').classList.add('active');
        }
    } else {
        IS_GUEST = true;
        document.getElementById('guest-banner').style.display = 'block';
    }

    renderReports();
    setInterval(updateClock, 1000); 
    updateClock();
    updateUI();
}

function updateClock() {
    // Menambahkan updateUI (khususnya renderLiveProgress) ke dalam loop 
    // agar progress bar bertambah besar tiap detik secara visual
    if (currentSession) {
        renderLiveProgress();
    }
    
    // ... sisa logika jam existing milikmu ...
}

// Boot
document.addEventListener('DOMContentLoaded', initProgbar);