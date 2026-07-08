// ============ calendar.js — NEW RELATIONAL SCHEMA (v1.0) ============
// Menggunakan tabel calendar_goals & calendar_goal_entries (Supabase)

let viewMode = 'month';
let focusDate = new Date();

const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayNamesShort = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const dayNamesFull = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

let CURRENT_USER = null;
let IS_GUEST = false;

// In-memory cache
let goals = [];           // dari calendar_goals
let entriesByDate = {};   // dateId -> array of entries

function setSyncIndicator(state) {
    const el = document.getElementById('cal-sync-indicator');
    const txt = document.getElementById('cal-sync-text');
    if (!el) return;
    
    el.classList.remove('saving', 'error');
    if (state === 'saving') { 
        el.classList.add('saving'); 
        txt.textContent = 'Menyimpan…'; 
    } else if (state === 'error') { 
        el.classList.add('error'); 
        txt.textContent = 'Gagal simpan'; 
    } else { 
        txt.textContent = 'Tersimpan'; 
    }
}

// ============== SUPABASE CRUD ==============

async function loadGoalsFromDB() {
    if (IS_GUEST) return;
    const { data, error } = await supabase
        .from('calendar_goals')
        .select('*')
        .eq('user_id', CURRENT_USER.id)
        .is('archived_at', null)
        .order('sort_order', { ascending: true });

    if (error) console.error('loadGoals error:', error);
    else goals = data || [];
}

async function loadEntriesForCurrentView() {
    if (IS_GUEST) return;
    
    const y = focusDate.getFullYear();
    const m = focusDate.getMonth();
    // Memuat bulan saat ini beserta data bulan berikutnya untuk buffer tampilan kalender
    const startDate = `${y}-${pad(m + 1)}-01`;
    const endDate = `${y}-${pad(m + 2)}-01`;

    const { data, error } = await supabase
        .from('calendar_goal_entries')
        .select('goal_id, entry_date, value')
        .eq('user_id', CURRENT_USER.id)
        .gte('entry_date', startDate)
        .lt('entry_date', endDate);

    if (error) {
        console.error('loadEntries error:', error);
        return;
    }

    entriesByDate = {};
    (data || []).forEach(row => {
        const key = `date-${row.entry_date}`;
        if (!entriesByDate[key]) entriesByDate[key] = [];
        entriesByDate[key].push({ id: row.goal_id, value: row.value });
    });
}

async function saveGoal(goalData) {
    if (IS_GUEST) return;
    setSyncIndicator('saving');
    const payload = { ...goalData, user_id: CURRENT_USER.id };
    const { error } = await supabase.from('calendar_goals').upsert(payload, { onConflict: 'id' });
    
    if (error) {
        console.error(error);
        setSyncIndicator('error');
    } else {
        setSyncIndicator('ok');
    }
}

async function deleteGoalDB(goalId, deleteHistory) {
    if (IS_GUEST) return;
    setSyncIndicator('saving');
    if (deleteHistory) {
        await supabase.from('calendar_goal_entries').delete().eq('goal_id', goalId);
        await supabase.from('calendar_goals').delete().eq('id', goalId);
    } else {
        await supabase.from('calendar_goals').update({ archived_at: new Date().toISOString() }).eq('id', goalId);
    }
    setSyncIndicator('ok');
}

// ============== DATE HELPERS ==============

function pad(n) { return n < 10 ? '0' + n : n; }
function dateIdFor(y, m, d) { return `date-${y}-${pad(m + 1)}-${pad(d)}`; }
function getEntryDate(dateId) { return dateId.replace('date-', ''); }

// ============== INIT ==============

document.addEventListener('DOMContentLoaded', async () => {
    // Penanganan Mode Demo
    if (new URLSearchParams(location.search).get('demo') === '1') {
        sessionStorage.setItem('gembel_guest_mode', '1');
    }

    const authCtx = await requireAuthOrGuest('../../index.html');
    if (!authCtx) return;

    CURRENT_USER = authCtx.user;
    IS_GUEST = authCtx.isGuest;

    if (IS_GUEST) {
        document.getElementById('guest-banner').style.display = 'block';
        document.getElementById('cal-sync-indicator').style.display = 'none';
        document.getElementById('cal-logout-btn').textContent = 'Keluar Demo';
    } else {
        document.getElementById('cal-user-name').textContent = authCtx.profile?.full_name || authCtx.user.email;
    }

    // Load Data
    await loadGoalsFromDB();
    await loadEntriesForCurrentView();

    initTheme();
    renderCalendar();
    loadGoalsUI();

    // Event Listeners
    document.getElementById('add-goal-btn').addEventListener('click', addGoal);
    document.getElementById('goal-input').addEventListener('keypress', e => e.key === 'Enter' && addGoal());
    document.getElementById('show-hidden-checkbox').addEventListener('change', loadGoalsUI);
    document.getElementById('prev-btn').addEventListener('click', () => changeStep(-1));
    document.getElementById('next-btn').addEventListener('click', () => changeStep(1));
    document.getElementById('theme-toggle-btn').addEventListener('click', toggleTheme);

    document.querySelectorAll('.view-tab').forEach(btn => {
        btn.addEventListener('click', () => setViewMode(btn.dataset.view));
    });

    initReorderZone();
    initModals();
});

// ============== THEME ==============

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    const next = current === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('calendar_theme', next);
}

function initTheme() {
    const saved = localStorage.getItem('calendar_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
}

// ============== GOALS UI & LOGIC ==============

function loadGoalsUI() {
    const pool = document.getElementById('goals-pool');
    pool.innerHTML = '';

    const showHidden = document.getElementById('show-hidden-checkbox').checked;
    const visible = goals.filter(g => showHidden || !g.is_hidden);

    if (visible.length === 0) {
        pool.innerHTML = '<div style="text-align:center;color:#999;margin:20px 0;">Tidak ada goal aktif</div>';
        return;
    }

    visible.forEach(goal => {
        const card = document.createElement('div');
        card.className = `goal-card ${goal.is_hidden ? 'hidden-status-style' : ''}`;
        card.draggable = true;
        card.dataset.id = goal.id;

        const eye = goal.is_hidden ? '🙈' : '👁️';
        const badge = goal.track_value ? `<div class="track-badge">🔢 ${goal.unit || ''}</div>` : '';

        card.innerHTML = `
            <div class="goal-text-wrap">
                <span class="goal-text">${goal.title}</span>
                ${badge}
            </div>
            <div class="action-container">
                <button class="view-toggle-btn" onclick="toggleVisibility('${goal.id}', event)">${eye}</button>
                <button class="delete-btn" onclick="deleteGoalPool('${goal.id}', event)">×</button>
            </div>
        `;

        card.addEventListener('dragstart', e => {
            e.dataTransfer.setData('text/plain', goal.id);
            card.classList.add('dragging');
        });
        card.addEventListener('dragend', () => card.classList.remove('dragging'));

        pool.appendChild(card);
    });
}

window.toggleVisibility = async (id, e) => {
    if (e) e.stopPropagation();
    const goal = goals.find(g => g.id === id);
    if (!goal) return;
    
    goal.is_hidden = !goal.is_hidden;
    await saveGoal(goal);
    loadGoalsUI();
    renderCalendar();
};

window.deleteGoalPool = async (goalId, e) => {
    if (e) e.stopPropagation();
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;

    const result = await showDeleteModal(goal.title);
    if (!result?.confirmed) return;

    await deleteGoalDB(goalId, result.deleteHistory);
    goals = goals.filter(g => g.id !== goalId);
    loadGoalsUI();
    renderCalendar();
};

function addGoal() {
    const input = document.getElementById('goal-input');
    const text = input.value.trim();
    if (!text) return;

    const trackValue = document.getElementById('goal-track-value').checked;
    const unitInput = document.getElementById('goal-unit-input');
    const unit = unitInput ? unitInput.value.trim() : '';

    const newGoal = {
        id: 'g_' + Date.now() + Math.random().toString(36).slice(2),
        title: text,
        is_hidden: false,
        track_value: trackValue,
        unit: unit || '',
        sort_order: goals.length
    };

    goals.push(newGoal);
    saveGoal(newGoal);

    input.value = '';
    document.getElementById('goal-track-value').checked = false;
    if (unitInput) unitInput.style.display = 'none';

    loadGoalsUI();
    renderCalendar();
}

// ============== DRAG & DROP REORDER ==============

function initReorderZone() {
    const pool = document.getElementById('goals-pool');
    pool.addEventListener('dragover', e => {
        e.preventDefault();
        const dragging = document.querySelector('.goal-card.dragging');
        if (!dragging) return;
        const after = getDragAfterElement(pool, e.clientY);
        if (after) pool.insertBefore(dragging, after);
        else pool.appendChild(dragging);
    });

    pool.addEventListener('drop', async () => {
        const cards = Array.from(pool.querySelectorAll('.goal-card'));
        cards.forEach((card, idx) => {
            const goal = goals.find(g => g.id === card.dataset.id);
            if (goal) goal.sort_order = idx;
        });
        
        // Simpan semua state urutan ke DB
        setSyncIndicator('saving');
        for (const g of goals) {
            if (!IS_GUEST) await supabase.from('calendar_goals').upsert({ ...g, user_id: CURRENT_USER.id });
        }
        setSyncIndicator('ok');
    });
}

function getDragAfterElement(container, y) {
    const draggable = [...container.querySelectorAll('.goal-card:not(.dragging)')];
    return draggable.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) return { offset, element: child };
        return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ============== DROP HANDLER (ENTRY) ==============

async function handleDrop(dateId, goalId) {
    const goal = goals.find(g => g.id === goalId);
    if (!goal) return;

    const entryDate = getEntryDate(dateId);
    let value = null;

    if (goal.track_value) {
        const lastVal = await getLastValueForGoal(goalId);
        value = await showValueModal(goal.title, lastVal, goal.unit);
        if (value === null) return; // User membatalkan modal
    }

    const { error } = await supabase.from('calendar_goal_entries').upsert({
        goal_id: goalId,
        user_id: CURRENT_USER?.id,
        entry_date: entryDate,
        value: value
    });

    if (!error) {
        await loadEntriesForCurrentView(); // Refresh cache data
        renderCalendar();
    } else {
        console.error('Error saving drop entry:', error);
    }
}

async function getLastValueForGoal(goalId) {
    const { data } = await supabase
        .from('calendar_goal_entries')
        .select('value')
        .eq('goal_id', goalId)
        .not('value', 'is', null)
        .order('entry_date', { ascending: false })
        .limit(1);
    return data?.[0]?.value ?? null;
}

// ============== CALENDAR RENDERING ==============

function setViewMode(mode) {
    viewMode = mode;
    document.querySelectorAll('.view-tab').forEach(b => b.classList.toggle('active', b.dataset.view === mode));
    renderCalendar();
}

function changeStep(dir) {
    if (viewMode === 'month') focusDate.setMonth(focusDate.getMonth() + dir);
    else if (viewMode === 'week') focusDate.setDate(focusDate.getDate() + 7 * dir);
    
    renderCalendar();
    loadEntriesForCurrentView(); // Ambil data DB yang relevan dengan bulan baru
}

function renderCalendar() {
    // TODO: Masukkan logika render existing (renderMonthView, renderWeekView) di sini.
    // Ganti pemanggilan progress[dateId] dari versi lama menjadi entriesByDate[dateId].
    updateHeaderTitle();
}

function updateHeaderTitle() {
    // TODO: Update DOM judul bulan sesuai dengan focusDate
}

function renderDroppedGoalsInto(container, dateId) {
    container.innerHTML = '';
    const entries = entriesByDate[dateId] || [];
    
    entries.forEach(entry => {
        const goal = goals.find(g => g.id === entry.id);
        if (!goal) return;

        const chip = document.createElement('div');
        chip.className = `dropped-goal ${goal.track_value ? 'has-value' : ''}`;
        
        // TODO: Build elemen chip beserta value, remove, dan edit sesuai UI
        // chip.innerHTML = ...
        
        container.appendChild(chip);
    });
}

// ============== MODALS ==============

let valueModalResolve = null;
function showValueModal(title, defaultVal, unit) {
    // TODO: Panggil elemen modal DOM value
    return new Promise(r => valueModalResolve = r);
}

let deleteModalResolve = null;
function showDeleteModal(title) {
    // TODO: Panggil elemen modal DOM konfirmasi hapus
    return new Promise(r => deleteModalResolve = r);
}

function initModals() {
    // TODO: Pasang listener klik untuk tombol Cancel / Save di dalam modal
}