// ============ STATE ============
        let viewMode = 'month';
        let focusDate = new Date(); // anchor date for whichever view is active

        const monthNames = [
            "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"
        ];
        const dayNamesShort = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
        const dayNamesFull = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

        // ============ CLOUD ACCOUNT / PER-USER STORAGE KEYS ============
        // Logged-in users: data hidup di TABEL BARU calender_e / calender_h
        // (lihat DATA LAYER di bawah). localStorage cuma dipakai buat cache
        // theme + snapshot backup harian + textBackupDb (dipakai guest &
        // kompatibilitas file backup format lama). Guest/demo: full
        // localStorage seperti dulu.
        let CURRENT_USER = null;
        let IS_GUEST = false;
        let LS_PREFIX = '';
        let LS_GOALS = '', LS_PROGRESS = '', LS_THEME = '', LS_TEXTBACKUP = '';
        let BACKUP_PREFIX = '';

        function initUserScopedKeys(userId) {
            LS_PREFIX = 'beno1_' + userId + '_';
            LS_GOALS = LS_PREFIX + 'goals';
            LS_PROGRESS = LS_PREFIX + 'progress';
            LS_THEME = LS_PREFIX + 'theme';
            LS_TEXTBACKUP = LS_PREFIX + 'text_backup';
            BACKUP_PREFIX = LS_PREFIX + 'backup_';
        }

        function setSyncIndicator(state) {
            const el = document.getElementById('cal-sync-indicator');
            const txt = document.getElementById('cal-sync-text');
            if (!el) return;
            el.classList.remove('saving', 'error');
            if (state === 'saving') { el.classList.add('saving'); txt.textContent = 'Menyimpan…'; }
            else if (state === 'error') { el.classList.add('error'); txt.textContent = 'Gagal simpan (offline?)'; }
            else { txt.textContent = 'Tersimpan'; }
        }

        // ============ IN-MEMORY DATABASE ============
        // Struktur memory-nya SAMA PERSIS kayak versi lama, jadi seluruh
        // kode render/drag-drop di bawah nggak berubah:
        //   goals        : [{id, text, hidden, trackValue, unit}]  (urut)
        //   progress     : { 'date-Y-M-D': [{id: goalId, value, ...snapshot}] }
        //   textBackupDb : { goalId: judul }  — dipakai buat guest & file
        //                  backup format lama; untuk user cloud biasanya
        //                  kosong karena calender_h sudah self-contained.
        let goals = [];
        let progress = {};
        let textBackupDb = {};

        // ============ DATE-KEY <-> SQL DATE ============
        // UI pakai key 'date-2026-7-8' (bulan/tanggal tanpa nol di depan),
        // kolom effective_date pakai '2026-07-08'. Dua helper ini jembatannya —
        // dua-duanya kerja dari komponen tanggal lokal, jadi bebas masalah
        // timezone.
        function dateIdToIso(dateId) {
            const p = String(dateId).split('-'); // ['date', y, m, d]
            if (p.length !== 4 || p[0] !== 'date') return null;
            const y = parseInt(p[1], 10), m = parseInt(p[2], 10), d = parseInt(p[3], 10);
            if (!y || !m || !d) return null;
            return `${y}-${pad(m)}-${pad(d)}`;
        }
        function isoToDateId(iso) {
            const s = String(iso).slice(0, 10).split('-').map(Number);
            return `date-${s[0]}-${s[1]}-${s[2]}`;
        }

        // uuid v4 generator — goals_id dibuat DI BROWSER (bukan default DB),
        // jadi goal baru langsung punya identitas final tanpa nunggu
        // round-trip ke server, dan restore/import bisa reuse id yang sama
        // persis (nggak perlu remapping id kayak versi lama).
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

        /* ============================================================
           DATA LAYER — tabel calender_e / calender_h
           calender_e : 1 baris per GOAL (entity yang ditampilkan di panel
                        "My Goals"). track_value NUMERIC dipakai sebagai
                        FLAG "Lacak angka": NULL = nggak dilacak, non-NULL
                        (dipakai sentinel 1) = dilacak.
           calender_h : 1 baris per GOAL per TANGGAL yang di-drag ke
                        kalender (banyak baris per hari, satu per goal).
                        goals_desc/unit/hidden di sini SNAPSHOT nilai goal
                        pas di-drop — baris ini berdiri sendiri, nggak perlu
                        join balik ke calender_e buat render histori. Di
                        tabel ini track_value NUMERIC = angka yang benar-
                        benar diinput di modal buat tanggal itu (bukan flag).
           ============================================================ */

        let PENDING_OPS = 0;

        // Bungkus semua write cloud: update indikator sync, jangan pernah
        // nge-throw (UI tetap optimistic, sama kayak perilaku lama).
        // ignoreCodes: error PostgREST yang dianggap sukses (mis. duplikat
        // karena race antar device).
        function trackOp(query, ignoreCodes) {
            if (IS_GUEST) return Promise.resolve({ data: null, error: null });
            PENDING_OPS++;
            setSyncIndicator('saving');
            return Promise.resolve(query).then((res) => {
                PENDING_OPS = Math.max(0, PENDING_OPS - 1);
                res = res || { data: null, error: null };
                if (res.error && ignoreCodes && ignoreCodes.indexOf(res.error.code) !== -1) {
                    res = { data: res.data, error: null };
                }
                if (res.error) {
                    console.error('cloud write failed:', res.error);
                    setSyncIndicator('error');
                } else if (PENDING_OPS === 0) {
                    setSyncIndicator('ok');
                }
                return res;
            });
        }

        const db = {
            rowToGoal(r) {
                return {
                    id: r.goals_id,
                    text: r.goals_desc,
                    hidden: !!r.hidden,
                    trackValue: r.track_value !== null && r.track_value !== undefined,
                    unit: r.unit || ''
                };
            },

            goalToRow(g) {
                return {
                    user_id: CURRENT_USER.id,
                    goals_id: g.id,
                    goals_desc: g.text,
                    unit: g.unit || '',
                    track_value: g.trackValue ? 1 : null,
                    hidden: !!g.hidden,
                };
            },

            // calender_h bisa lebih dari 1000 baris (limit default
            // PostgREST), jadi ditarik per halaman sampai habis.
            async fetchAllEntries() {
                const all = [];
                const page = 1000;
                for (let from = 0; ; from += page) {
                    const { data, error } = await supabase
                        .from('calender_h')
                        .select('goals_id, effective_date, goals_desc, unit, track_value, hidden')
                        .eq('user_id', CURRENT_USER.id)
                        .order('effective_date', { ascending: true })
                        .range(from, from + page - 1);
                    if (error) throw error;
                    all.push(...(data || []));
                    if (!data || data.length < page) break;
                }
                return all;
            },

            async loadAll() {
                const [gRes, entries] = await Promise.all([
                    supabase.from('calender_e').select('*')
                        .eq('user_id', CURRENT_USER.id)
                        .order('created_at', { ascending: true }),
                    db.fetchAllEntries(),
                ]);
                if (gRes.error) throw gRes.error;

                const active = (gRes.data || []).map(db.rowToGoal);

                const prog = {};
                entries.forEach(r => {
                    const dId = isoToDateId(r.effective_date);
                    if (!prog[dId]) prog[dId] = [];
                    prog[dId].push({
                        id: r.goals_id,
                        value: (r.track_value === null || r.track_value === undefined) ? null : Number(r.track_value),
                        // Snapshot dari calender_h sendiri — dipakai render tanpa
                        // perlu join balik ke calender_e (lihat renderDroppedGoalsInto).
                        text: r.goals_desc,
                        unit: r.unit || '',
                        trackValue: !!(r.unit && String(r.unit).length),
                        hidden: !!r.hidden,
                    });
                });

                return { goals: active, progress: prog };
            },

            // Restore/import/migrasi: ganti seluruh isi cloud user ini.
            // goals_id itu uuid yang DIBUAT DI BROWSER dari awal, jadi TIDAK
            // PERLU remapping id kayak versi lama — goal & entri histori
            // lama nempel balik ke id yang sama persis.
            async replaceAll(goalsArr, progressObj, textBackup) {
                const uid = CURRENT_USER.id;
                const delE = await supabase.from('calender_e').delete().eq('user_id', uid);
                if (delE.error) throw delE.error;
                const delH = await supabase.from('calender_h').delete().eq('user_id', uid);
                if (delH.error) throw delH.error;

                const goalRows = goalsArr.map(g => db.goalToRow(g));
                for (let i = 0; i < goalRows.length; i += 500) {
                    const ins = await supabase.from('calender_e').insert(goalRows.slice(i, i + 500));
                    if (ins.error) throw ins.error;
                }

                // Dipakai buat nyusun snapshot goals_desc/unit/hidden pas
                // nulis ulang baris calender_h di bawah.
                const goalById = {};
                goalsArr.forEach(g => { goalById[g.id] = g; });

                const entryRows = [];
                for (const dId in progressObj) {
                    const iso = dateIdToIso(dId);
                    if (!iso) continue;
                    (progressObj[dId] || []).forEach(e => {
                        const gid = typeof e === 'string' ? e : e.id;
                        const g = goalById[gid];
                        const title = (g && g.text) || (e && e.text) || (textBackup && textBackup[gid]) || '(goal dihapus)';
                        const unit = (g && g.unit) || (e && e.unit) || '';
                        const hidden = (g && g.hidden) || (e && e.hidden) || false;
                        let v = (typeof e === 'string') ? null : e.value;
                        v = (v === null || v === undefined || v === '') ? null : Number(v);
                        entryRows.push({
                            user_id: uid, goals_id: gid, effective_date: iso,
                            goals_desc: title, unit: unit,
                            track_value: Number.isFinite(v) ? v : null,
                            hidden: !!hidden,
                        });
                    });
                }
                for (let i = 0; i < entryRows.length; i += 500) {
                    const ins = await supabase.from('calender_h').insert(entryRows.slice(i, i + 500));
                    if (ins.error) throw ins.error;
                }
            },
        };

        // Akun baru dapet 4 goal starter yang sama kayak dulu.
        async function seedDefaultGoals() {
            const defaults = [
                { title: 'Badminton Drilling 2 Jam', track: false, unit: '' },
                { title: 'Trading Journal QwerTrade', track: false, unit: '' },
                { title: 'Fix Bug React / Node.js', track: false, unit: '' },
                { title: 'Push Up', track: true, unit: 'reps' },
            ];
            const rows = defaults.map(d => ({
                user_id: CURRENT_USER.id,
                goals_id: uuidv4(),
                goals_desc: d.title,
                unit: d.unit,
                track_value: d.track ? 1 : null,
                hidden: false,
            }));
            const { error } = await supabase.from('calender_e').insert(rows);
            if (error) console.error('seed default goals failed:', error);
        }

        // MIGRASI SEKALI JALAN: user lama masih punya cache data era blob
        // JSON di localStorage browser ini (beno1_<uid>_goals / _progress).
        // Kalau cloud (calender_e/calender_h) masih kosong tapi cache lokal
        // ada isinya, angkut ke tabel baru dulu supaya nggak ada yang hilang.
        async function migrateLegacyLocalStorage() {
            let legacyGoals = null, legacyProgress = null, legacyBackup = null;
            try {
                legacyGoals = JSON.parse(localStorage.getItem(LS_GOALS) || 'null');
                legacyProgress = JSON.parse(localStorage.getItem(LS_PROGRESS) || 'null');
                legacyBackup = JSON.parse(localStorage.getItem(LS_TEXTBACKUP) || 'null');
            } catch (e) { return false; }
            const hasData = (legacyGoals && legacyGoals.length) ||
                            (legacyProgress && Object.keys(legacyProgress).length);
            if (!hasData) return false;

            goals = legacyGoals || [];
            progress = legacyProgress || {};
            textBackupDb = legacyBackup || {};
            migrateOldDatabaseFormat();
            migrateProgressEntries();
            migrateGoals();
            await db.replaceAll(goals, progress, textBackupDb);
            console.log('Data lama dari browser ini berhasil dimigrasi ke cloud.');
            return true;
        }

        // ============ GUEST PERSISTENCE (localStorage, kayak dulu) ============
        function persistGuest() {
            if (!IS_GUEST) return;
            localStorage.setItem(LS_GOALS, JSON.stringify(goals));
            localStorage.setItem(LS_PROGRESS, JSON.stringify(progress));
            localStorage.setItem(LS_TEXTBACKUP, JSON.stringify(textBackupDb));
        }

        function loadLocalDatabase() {
            goals = JSON.parse(localStorage.getItem(LS_GOALS));
            if (!goals || goals.length === 0) {
                goals = [
                    { id: 'g1', text: 'Badminton Drilling 2 Jam', hidden: false, trackValue: false, unit: '' },
                    { id: 'g2', text: 'Trading Journal QwerTrade', hidden: false, trackValue: false, unit: '' },
                    { id: 'g3', text: 'Fix Bug React / Node.js', hidden: false, trackValue: false, unit: '' },
                    { id: 'g4', text: 'Push Up', hidden: false, trackValue: true, unit: 'reps' }
                ];
            }
            progress = JSON.parse(localStorage.getItem(LS_PROGRESS)) || {};
            textBackupDb = JSON.parse(localStorage.getItem(LS_TEXTBACKUP)) || {
                'g1': 'Badminton Drilling 2 Jam',
                'g2': 'Trading Journal QwerTrade',
                'g3': 'Fix Bug React / Node.js',
                'g4': 'Push Up'
            };
        }

        let valueModalResolve = null;

        // ============ THEME (light / dark, mode malam ala ChatGPT) ============
        // CATATAN: skema baru nggak punya tabel user_settings, jadi theme
        // SEKARANG CUMA DISIMPAN LOKAL (localStorage) per browser — nggak
        // lagi disinkronkan lintas device kayak versi lama.
        function applyTheme(theme, persist) {
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem(LS_THEME, theme);
        }
        function initTheme() {
            applyTheme(localStorage.getItem(LS_THEME) || 'light', false);
        }

        // ============ MIGRATIONS (normalisasi format data lama) ============
        // Dipakai untuk data guest, file backup lama, dan migrasi cache
        // lokal era blob. Murni mutasi in-memory — persist-nya di pemanggil.
        function migrateGoals() {
            goals.forEach(g => {
                if (g.trackValue === undefined) g.trackValue = false;
                if (g.unit === undefined) g.unit = '';
            });
        }

        // Format jadul banget: key 'jun-X' berisi array goalId string
        function migrateOldDatabaseFormat() {
            for (let d = 1; d <= 30; d++) {
                const oldKey = `jun-${d}`;
                if (progress[oldKey] && progress[oldKey].length > 0) {
                    const newKey = `date-2026-6-${d}`;
                    if (!progress[newKey]) progress[newKey] = [];
                    progress[oldKey].forEach(goalId => {
                        if (!progress[newKey].some(e => (e.id || e) === goalId)) {
                            progress[newKey].push({ id: goalId, value: null });
                        }
                    });
                    delete progress[oldKey];
                }
            }
        }

        // Entri progress dulunya string goalId polos; normalkan ke {id, value}
        function migrateProgressEntries() {
            for (const dId in progress) {
                progress[dId] = (progress[dId] || []).map(e => {
                    if (typeof e === 'string') return { id: e, value: null };
                    return e;
                });
            }
        }

        // ============ DATE HELPERS ============
        function pad(n) { return n < 10 ? '0' + n : '' + n; }
        function dateIdFor(y, m0, d) { return `date-${y}-${m0 + 1}-${d}`; }
        function parseDateId(id) {
            const parts = id.split('-');
            return new Date(parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3]));
        }
        function isSameDay(a, b) {
            return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
        }
        function getWeekRange(date) {
            const start = new Date(date);
            start.setDate(date.getDate() - date.getDay());
            start.setHours(0, 0, 0, 0);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            return { start, end };
        }
        function todayStr() {
            const d = new Date();
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }

        // ============ INIT ============
        document.addEventListener('DOMContentLoaded', async () => {
            // AUTH GUARD — bounce to login unless there's a real session OR
            // an active guest/demo session (started via ?demo=1, see below).
            if (new URLSearchParams(location.search).get('demo') === '1') {
                sessionStorage.setItem('gembel_guest_mode', '1');
            }
            const authCtx = await requireAuthOrGuest('index.html');
            if (!authCtx) return; // requireAuthOrGuest already redirected
            CURRENT_USER = authCtx.user;
            IS_GUEST = authCtx.isGuest;

            if (IS_GUEST) {
                document.getElementById('guest-banner').style.display = 'block';
                document.getElementById('cal-user-name').textContent = 'Demo (belum daftar)';
                document.getElementById('cal-logout-btn').textContent = 'Keluar Demo';
                document.getElementById('cal-logout-btn').setAttribute('onclick', "exitGuestDemo(); window.location.href='index.html';");
                document.getElementById('cal-back-link').href = 'index.html';
                document.getElementById('cal-sync-indicator').style.display = 'none';
            } else {
                const displayName = authCtx.profile?.full_name || authCtx.user.email;
                const nameEl = document.getElementById('cal-user-name');
                if (nameEl) nameEl.textContent = displayName;
            }

            initUserScopedKeys(CURRENT_USER.id);

            if (IS_GUEST) {
                // Guest: full localStorage, persis perilaku lama.
                loadLocalDatabase();
                migrateOldDatabaseFormat();
                migrateProgressEntries();
                migrateGoals();
                persistGuest();
                initTheme();
            } else {
                // User beneran: sumber kebenaran = calender_e / calender_h.
                setSyncIndicator('saving');
                try {
                    let cloud = await db.loadAll();
                    const isEmpty = cloud.goals.length === 0 && Object.keys(cloud.progress).length === 0;
                    if (isEmpty) {
                        const migrated = await migrateLegacyLocalStorage()
                            .catch(e => { console.error('migrasi data lokal gagal:', e); return false; });
                        if (!migrated) await seedDefaultGoals();
                        cloud = await db.loadAll();
                    }
                    goals = cloud.goals;
                    progress = cloud.progress;
                    textBackupDb = {}; // calender_h udah self-contained, nggak butuh arsip judul terpisah
                    initTheme();
                    setSyncIndicator('ok');
                } catch (e) {
                    console.error('gagal load data cloud:', e);
                    setSyncIndicator('error');
                    goals = []; progress = {}; textBackupDb = {};
                    initTheme();
                }
            }

            document.getElementById('theme-toggle-btn').addEventListener('click', () => {
                const current = document.documentElement.getAttribute('data-theme') || 'light';
                applyTheme(current === 'dark' ? 'light' : 'dark');
            });

            autoDailyBackup();
            refreshBackupStatusUI();

            renderCalendar();
            loadGoals();

            document.getElementById('add-goal-btn').addEventListener('click', addGoal);
            document.getElementById('goal-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') addGoal();
            });
            document.getElementById('goal-track-value').addEventListener('change', (e) => {
                document.getElementById('goal-unit-input').style.display = e.target.checked ? 'block' : 'none';
                syncOptionsRowVisibility();
            });

            const goalInputEl = document.getElementById('goal-input');
            goalInputEl.addEventListener('focus', syncOptionsRowVisibility);
            goalInputEl.addEventListener('input', syncOptionsRowVisibility);
            goalInputEl.addEventListener('blur', () => setTimeout(syncOptionsRowVisibility, 150));

            document.getElementById('show-hidden-checkbox').addEventListener('change', loadGoals);

            document.getElementById('dm-cancel').addEventListener('click', () => closeDeleteModal(null));
            document.getElementById('dm-confirm').addEventListener('click', () => {
                closeDeleteModal({ confirmed: true, deleteHistory: document.getElementById('dm-delete-history').checked });
            });
            document.getElementById('delete-modal-overlay').addEventListener('click', (e) => {
                if (e.target.id === 'delete-modal-overlay') closeDeleteModal(null);
            });

            document.getElementById('prev-btn').addEventListener('click', () => changeStep(-1));
            document.getElementById('next-btn').addEventListener('click', () => changeStep(1));

            document.querySelectorAll('.view-tab').forEach(btn => {
                btn.addEventListener('click', () => setViewMode(btn.dataset.view));
            });

            document.getElementById('export-backup-btn').addEventListener('click', exportBackupFile);
            document.getElementById('import-backup-input').addEventListener('change', (e) => {
                if (e.target.files[0]) importBackupFile(e.target.files[0]);
                e.target.value = '';
            });
            document.getElementById('restore-select').addEventListener('change', (e) => {
                if (e.target.value) {
                    restoreFromSnapshot(e.target.value);
                    e.target.value = '';
                }
            });

            document.getElementById('vm-cancel').addEventListener('click', () => closeValueModal(null));
            document.getElementById('vm-save').addEventListener('click', () => {
                const raw = document.getElementById('vm-input').value;
                closeValueModal(raw === '' ? 0 : parseFloat(raw));
            });
            document.getElementById('vm-input').addEventListener('keypress', (e) => {
                if (e.key === 'Enter') document.getElementById('vm-save').click();
            });
            document.getElementById('value-modal-overlay').addEventListener('click', (e) => {
                if (e.target.id === 'value-modal-overlay') closeValueModal(null);
            });

            initReorderZone();
        });

        // ============ OPTIONS ROW VISIBILITY ============
        // Baris "Lacak angka" cuma nongol kalau lagi ngetik goal baru,
        // atau kalau opsinya sudah dicentang (biar statusnya tetap kelihatan).
        function syncOptionsRowVisibility() {
            const input = document.getElementById('goal-input');
            const row = document.getElementById('goal-options-row');
            const isTrackChecked = document.getElementById('goal-track-value').checked;
            const shouldShow = document.activeElement === input || input.value.trim() !== '' || isTrackChecked;
            row.classList.toggle('active', shouldShow);
        }

        // ============ VIEW SWITCHING ============
        function setViewMode(mode) {
            viewMode = mode;
            document.querySelectorAll('.view-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.view === mode));
            renderCalendar();
        }

        function changeStep(direction) {
            if (viewMode === 'month') focusDate.setMonth(focusDate.getMonth() + direction);
            else if (viewMode === 'week') focusDate.setDate(focusDate.getDate() + 7 * direction);
            else if (viewMode === 'day') focusDate.setDate(focusDate.getDate() + direction);
            else if (viewMode === 'year') focusDate.setFullYear(focusDate.getFullYear() + direction);
            renderCalendar();
        }

        function isoDate(d) {
            return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        }

        function updateHeaderTitle() {
            const title = document.getElementById('month-year-title');
            title.onclick = null;

            if (viewMode === 'year') {
                renderYearJumpInput(title);
                return;
            }

            let text = '';
            if (viewMode === 'month') {
                text = `${monthNames[focusDate.getMonth()]} ${focusDate.getFullYear()}`;
            } else if (viewMode === 'day') {
                text = `${dayNamesFull[focusDate.getDay()]}, ${monthNames[focusDate.getMonth()]} ${focusDate.getDate()}, ${focusDate.getFullYear()}`;
            } else if (viewMode === 'week') {
                const { start, end } = getWeekRange(focusDate);
                if (start.getMonth() === end.getMonth()) {
                    text = `${monthNames[start.getMonth()].substring(0, 3)} ${start.getDate()}–${end.getDate()}, ${start.getFullYear()}`;
                } else {
                    text = `${monthNames[start.getMonth()].substring(0, 3)} ${start.getDate()} – ${monthNames[end.getMonth()].substring(0, 3)} ${end.getDate()}, ${end.getFullYear()}`;
                }
            }

            title.innerText = text;
            title.classList.add('editable-title');
            title.title = 'Klik untuk lompat ke tanggal tertentu';
            title.onclick = () => renderDateJumpInput(title);
        }

        // Klik judul di mode Day/Week/Month -> jadi native date picker,
        // sama seperti judul tahun yang sudah bisa diketik langsung.
        function renderDateJumpInput(title) {
            title.innerHTML = `<input type="date" id="date-jump-input" class="date-jump-input" value="${isoDate(focusDate)}">`;
            const input = document.getElementById('date-jump-input');
            input.addEventListener('click', (e) => e.stopPropagation());
            const commitAndRevert = () => {
                if (input.value) {
                    const [y, m, d] = input.value.split('-').map(Number);
                    focusDate = new Date(y, m - 1, d);
                }
                renderCalendar(); // selalu balik ke format tampilan teks, dipilih atau tidak
            };
            input.addEventListener('change', commitAndRevert);
            input.addEventListener('blur', commitAndRevert);
            setTimeout(() => {
                input.focus();
                if (input.showPicker) { try { input.showPicker(); } catch (e) {} }
            }, 20);
        }

        function renderYearJumpInput(title) {
            title.innerHTML = `<input type="number" id="year-jump-input" class="year-jump-input" value="${focusDate.getFullYear()}" inputmode="numeric">`;
            const yearInput = document.getElementById('year-jump-input');
            const commitAndRevert = () => {
                const val = parseInt(yearInput.value, 10);
                if (!isNaN(val) && val > 0) focusDate.setFullYear(val);
                renderCalendar(); // selalu balik ke format tampilan teks
            };
            yearInput.addEventListener('click', (e) => e.stopPropagation());
            yearInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') yearInput.blur(); });
            yearInput.addEventListener('blur', commitAndRevert);
        }

        function renderCalendar() {
            updateHeaderTitle();
            const area = document.getElementById('calendar-area');
            area.innerHTML = '';
            if (viewMode === 'month') renderMonthView(area);
            else if (viewMode === 'week') renderWeekView(area);
            else if (viewMode === 'day') renderDayView(area);
            else if (viewMode === 'year') renderYearView(area);
        }

        // ============ MONTH VIEW ============
        function buildMonthSlots(year, month0) {
            const firstDayIndex = new Date(year, month0, 1).getDay();
            const totalDays = new Date(year, month0 + 1, 0).getDate();
            const prevTotalDays = new Date(year, month0, 0).getDate();
            const slots = [];

            for (let i = firstDayIndex; i > 0; i--) {
                const dayNum = prevTotalDays - i + 1;
                let prevM = month0 - 1, prevY = year;
                if (prevM < 0) { prevM = 11; prevY--; }
                slots.push({
                    id: dateIdFor(prevY, prevM, dayNum), day: dayNum, isCurrent: false,
                    label: dayNum === 1 ? `${monthNames[prevM].substring(0, 3)} 1` : null
                });
            }

            const today = new Date();
            for (let i = 1; i <= totalDays; i++) {
                const isToday = today.getFullYear() === year && today.getMonth() === month0 && today.getDate() === i;
                slots.push({
                    id: dateIdFor(year, month0, i), day: i, isCurrent: true, isToday: isToday,
                    label: i === 1 ? `${monthNames[month0].substring(0, 3)} 1` : null
                });
            }

            const remaining = 42 - slots.length;
            for (let i = 1; i <= remaining; i++) {
                let nextM = month0 + 1, nextY = year;
                if (nextM > 11) { nextM = 0; nextY++; }
                slots.push({
                    id: dateIdFor(nextY, nextM, i), day: i, isCurrent: false,
                    label: i === 1 ? `${monthNames[nextM].substring(0, 3)} 1` : null
                });
            }
            return slots;
        }

        function renderMonthView(container) {
            const grid = document.createElement('div');
            grid.className = 'calendar-grid month-mode';
            dayNamesShort.forEach(n => {
                const el = document.createElement('div');
                el.className = 'day-name';
                el.innerText = n;
                grid.appendChild(el);
            });
            const slots = buildMonthSlots(focusDate.getFullYear(), focusDate.getMonth());
            slots.forEach(item => grid.appendChild(createDayCell(item)));
            container.appendChild(grid);
        }

        // ============ WEEK VIEW ============
        function renderWeekView(container) {
            const grid = document.createElement('div');
            grid.className = 'calendar-grid week-mode';
            dayNamesShort.forEach(n => {
                const el = document.createElement('div');
                el.className = 'day-name';
                el.innerText = n;
                grid.appendChild(el);
            });
            const { start } = getWeekRange(focusDate);
            const today = new Date();
            for (let i = 0; i < 7; i++) {
                const d = new Date(start);
                d.setDate(start.getDate() + i);
                const item = {
                    id: dateIdFor(d.getFullYear(), d.getMonth(), d.getDate()),
                    day: d.getDate(),
                    isCurrent: true,
                    isToday: isSameDay(d, today),
                    label: (d.getDate() === 1 || i === 0) ? `${monthNames[d.getMonth()].substring(0, 3)} ${d.getDate()}` : null
                };
                grid.appendChild(createDayCell(item, 'week-cell'));
            }
            container.appendChild(grid);
        }

        // ============ DAY VIEW ============
        function renderDayView(container) {
            const grid = document.createElement('div');
            grid.className = 'calendar-grid day-mode';
            const d = focusDate;
            const item = {
                id: dateIdFor(d.getFullYear(), d.getMonth(), d.getDate()),
                day: d.getDate(),
                isCurrent: true,
                isToday: isSameDay(d, new Date()),
                label: `${dayNamesFull[d.getDay()]}, ${d.getDate()} ${monthNames[d.getMonth()]}`
            };
            grid.appendChild(createDayCell(item, 'day-cell'));
            container.appendChild(grid);
        }

        // ============ YEAR VIEW ============
        function buildMiniMonthDays(year, month0) {
            const firstDayIndex = new Date(year, month0, 1).getDay();
            const totalDays = new Date(year, month0 + 1, 0).getDate();
            const slots = [];
            for (let i = 0; i < firstDayIndex; i++) slots.push(null);
            for (let d = 1; d <= totalDays; d++) slots.push(d);
            return slots;
        }

        function renderYearView(container) {
            const grid = document.createElement('div');
            grid.className = 'year-grid';
            const year = focusDate.getFullYear();
            const today = new Date();

            for (let m = 0; m < 12; m++) {
                const box = document.createElement('div');
                box.className = 'mini-month';

                const title = document.createElement('div');
                title.className = 'mini-month-title';
                title.innerText = monthNames[m];
                title.addEventListener('click', () => {
                    focusDate = new Date(year, m, 1);
                    setViewMode('month');
                });
                box.appendChild(title);

                const mg = document.createElement('div');
                mg.className = 'mini-grid';
                ['S', 'M', 'T', 'W', 'T', 'F', 'S'].forEach(dn => {
                    const el = document.createElement('div');
                    el.className = 'mini-day-name';
                    el.innerText = dn;
                    mg.appendChild(el);
                });

                buildMiniMonthDays(year, m).forEach(d => {
                    const el = document.createElement('div');
                    if (d === null) {
                        el.className = 'mini-day other';
                        mg.appendChild(el);
                        return;
                    }
                    el.className = 'mini-day';
                    const isToday = today.getFullYear() === year && today.getMonth() === m && today.getDate() === d;
                    if (isToday) el.classList.add('today');
                    el.innerText = d;

                    const dId = dateIdFor(year, m, d);
                    if (progress[dId] && progress[dId].length) {
                        const dot = document.createElement('span');
                        dot.className = 'dot';
                        el.appendChild(dot);
                    }
                    el.addEventListener('click', () => {
                        focusDate = new Date(year, m, d);
                        setViewMode('day');
                    });
                    mg.appendChild(el);
                });

                box.appendChild(mg);
                grid.appendChild(box);
            }
            container.appendChild(grid);
        }

        // ============ SHARED DAY CELL ============
        function createDayCell(item, extraClass) {
            const dayDiv = document.createElement('div');
            dayDiv.className = 'calendar-day' + (extraClass ? ' ' + extraClass : '');
            dayDiv.setAttribute('data-id', item.id);

            if (!item.isCurrent) dayDiv.classList.add('other-month');
            if (item.isToday) dayDiv.classList.add('today');

            const dateNum = document.createElement('span');
            dateNum.className = 'date-num';
            dateNum.innerText = item.label ? item.label : item.day;
            dayDiv.appendChild(dateNum);

            const dropZone = document.createElement('div');
            dropZone.className = 'dropped-goals-container';
            dayDiv.appendChild(dropZone);
            renderDroppedGoalsInto(dropZone, item.id);

            dayDiv.addEventListener('dragover', (e) => {
                if (e.dataTransfer.types.includes('text/plain')) {
                    e.preventDefault();
                    dayDiv.classList.add('drag-over');
                }
            });
            dayDiv.addEventListener('dragleave', () => dayDiv.classList.remove('drag-over'));
            dayDiv.addEventListener('drop', (e) => {
                e.preventDefault();
                dayDiv.classList.remove('drag-over');
                const goalId = e.dataTransfer.getData('text/plain');
                if (goalId) handleDrop(item.id, goalId);
            });

            return dayDiv;
        }

        // ============ GOALS POOL ============
        function loadGoals() {
            const pool = document.getElementById('goals-pool');
            pool.innerHTML = '';

            const showHiddenChecked = document.getElementById('show-hidden-checkbox').checked;
            const visibleGoals = goals.filter(g => showHiddenChecked || !g.hidden);

            if (visibleGoals.length === 0) {
                pool.innerHTML = '<div style="text-align:center; color:#999; margin-top:20px; font-size:13px;">Tidak ada goal aktif.</div>';
                return;
            }

            visibleGoals.forEach(goal => {
                const card = document.createElement('div');
                card.classList.add('goal-card');
                card.setAttribute('draggable', 'true');
                card.setAttribute('id', `card-${goal.id}`);
                card.setAttribute('data-id', goal.id);

                if (goal.hidden) card.classList.add('hidden-status-style');
                const eyeIcon = goal.hidden ? '🙈' : '👁️';
                const badge = goal.trackValue ? `<div class="track-badge">🔢 dilacak${goal.unit ? ' · ' + goal.unit : ''}</div>` : '';

                card.innerHTML = `
                    <div class="goal-text-wrap">
                        <span class="goal-text">${goal.text}</span>
                        ${badge}
                    </div>
                    <div class="action-container">
                        <button class="view-toggle-btn" title="Hide/Show" onclick="toggleGoalVisibility('${goal.id}', event)">${eyeIcon}</button>
                        <button class="delete-btn" title="Hapus" onclick="deleteGoalPool('${goal.id}', event)">×</button>
                    </div>
                `;

                card.addEventListener('dragstart', (e) => {
                    card.classList.add('dragging');
                    e.dataTransfer.setData('text/plain', goal.id);
                });
                card.addEventListener('dragend', () => card.classList.remove('dragging'));

                pool.appendChild(card);
            });
        }

        window.toggleGoalVisibility = function (goalId, event) {
            event.stopPropagation();
            const targetGoal = goals.find(g => g.id === goalId);
            if (targetGoal) {
                targetGoal.hidden = !targetGoal.hidden;
                if (IS_GUEST) persistGuest();
                else trackOp(supabase.from('calender_e')
                    .update({ hidden: targetGoal.hidden, updated_at: new Date().toISOString() })
                    .eq('goals_id', goalId)
                    .eq('user_id', CURRENT_USER.id));
                loadGoals();
                renderCalendar();
            }
        };

        function initReorderZone() {
            const pool = document.getElementById('goals-pool');
            pool.addEventListener('dragover', (e) => {
                e.preventDefault();
                const draggingCard = document.querySelector('.goal-card.dragging');
                if (!draggingCard) return;
                const afterElement = getDragAfterElement(pool, e.clientY);
                if (afterElement == null) pool.appendChild(draggingCard);
                else pool.insertBefore(draggingCard, afterElement);
            });

            pool.addEventListener('drop', () => {
                const currentCards = Array.from(pool.querySelectorAll('.goal-card'));
                const hiddenGoals = goals.filter(g => g.hidden);
                const newOrderedGoals = [];
                currentCards.forEach(card => {
                    const id = card.getAttribute('data-id');
                    const targetGoal = goals.find(g => g.id === id);
                    if (targetGoal) newOrderedGoals.push(targetGoal);
                });
                goals = [...newOrderedGoals, ...hiddenGoals.filter(hg => !newOrderedGoals.includes(hg))];
                if (IS_GUEST) { persistGuest(); return; }
                // CATATAN: calender_e nggak punya kolom sort_order, jadi
                // urutan drag-and-drop ini cuma berlaku buat sesi browser
                // sekarang — refresh halaman bakal balik ke urutan
                // created_at. Kalau butuh urutan custom yang persisten,
                // kolom sort_order (int) perlu ditambahin ke calender_e.
            });
        }

        function getDragAfterElement(container, y) {
            const draggableElements = [...container.querySelectorAll('.goal-card:not(.dragging)')];
            return draggableElements.reduce((closest, child) => {
                const box = child.getBoundingClientRect();
                const offset = y - box.top - box.height / 2;
                if (offset < 0 && offset > closest.offset) return { offset: offset, element: child };
                return closest;
            }, { offset: Number.NEGATIVE_INFINITY }).element;
        }

        async function addGoal() {
            const input = document.getElementById('goal-input');
            const text = input.value.trim();
            if (!text) return;

            const trackValue = document.getElementById('goal-track-value').checked;
            const unit = document.getElementById('goal-unit-input').value.trim();

            if (IS_GUEST) {
                // Guest: id lokal unik, kayak dulu.
                const newId = 'g_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
                goals.push({ id: newId, text: text, hidden: false, trackValue: trackValue, unit: unit });
                textBackupDb[newId] = text;
                persistGuest();
            } else {
                // Cloud: goals_id dibuat DI BROWSER, jadi UI update duluan
                // (optimistic) tanpa nunggu round-trip. Kalau insert gagal,
                // rollback in-memory + kasih tau lewat alert.
                const newId = uuidv4();
                const newGoal = { id: newId, text: text, hidden: false, trackValue: trackValue, unit: unit };
                goals.push(newGoal);
                const btn = document.getElementById('add-goal-btn');
                btn.disabled = true;
                const res = await trackOp(supabase.from('calender_e').insert(db.goalToRow(newGoal)));
                btn.disabled = false;
                if (res.error) {
                    goals = goals.filter(g => g.id !== newId);
                    loadGoals();
                    renderCalendar();
                    alert('Gagal nambah goal: ' + res.error.message);
                    return;
                }
            }

            input.value = '';
            document.getElementById('goal-track-value').checked = false;
            document.getElementById('goal-unit-input').value = '';
            document.getElementById('goal-unit-input').style.display = 'none';
            loadGoals();
            renderCalendar();
        }

        let deleteModalResolve = null;
        function showDeleteModal(goalText) {
            document.getElementById('dm-title').innerText = `Hapus "${goalText}"?`;
            document.getElementById('dm-delete-history').checked = false;
            document.getElementById('delete-modal-overlay').style.display = 'flex';
            return new Promise(resolve => { deleteModalResolve = resolve; });
        }
        function closeDeleteModal(result) {
            document.getElementById('delete-modal-overlay').style.display = 'none';
            if (deleteModalResolve) { deleteModalResolve(result); deleteModalResolve = null; }
        }

        window.deleteGoalPool = async function (goalId, event) {
            if (event) event.stopPropagation();
            const targetGoal = goals.find(g => g.id === goalId);
            if (!targetGoal) return;

            const result = await showDeleteModal(targetGoal.text);
            if (!result || !result.confirmed) return;

            goals = goals.filter(g => g.id !== goalId);

            if (result.deleteHistory) {
                // Hard delete: goal DAN seluruh baris calender_h miliknya.
                for (const dateId in progress) {
                    progress[dateId] = progress[dateId].filter(e => e.id !== goalId);
                }
                delete textBackupDb[goalId];
                if (IS_GUEST) persistGuest();
                else {
                    trackOp(supabase.from('calender_e').delete().eq('goals_id', goalId).eq('user_id', CURRENT_USER.id));
                    trackOp(supabase.from('calender_h').delete().eq('goals_id', goalId).eq('user_id', CURRENT_USER.id));
                }
            } else {
                // Keep history: HANYA hapus baris calender_e — baris
                // calender_h yang udah ada tetap utuh (masing-masing udah
                // nyimpen snapshot goals_desc/unit/hidden sendiri), jadi
                // chip lama tetap kebaca tanpa perlu tabel arsip terpisah.
                textBackupDb[goalId] = targetGoal.text;
                if (IS_GUEST) persistGuest();
                else trackOp(supabase.from('calender_e').delete().eq('goals_id', goalId).eq('user_id', CURRENT_USER.id));
            }
            loadGoals();
            renderCalendar();
        };

        // ============ PROGRESS / DROPPED GOALS ============
        function getLastValueForGoal(goalId, excludeDateId) {
            let candidates = [];
            for (const dId in progress) {
                if (dId === excludeDateId) continue;
                (progress[dId] || []).forEach(e => {
                    if (e.id === goalId && e.value !== null && e.value !== undefined) {
                        candidates.push({ date: parseDateId(dId), value: e.value });
                    }
                });
            }
            if (!candidates.length) return null;
            candidates.sort((a, b) => b.date - a.date);
            return candidates[0].value;
        }

        async function handleDrop(dateId, goalId) {
            const goal = goals.find(g => g.id === goalId);
            if (!progress[dateId]) progress[dateId] = [];
            if (progress[dateId].some(e => e.id === goalId)) return; // already logged today

            let entryValue = null;
            if (goal && goal.trackValue) {
                const lastVal = getLastValueForGoal(goalId, dateId);
                const val = await showValueModal(goal.text, lastVal, goal.unit);
                if (val === null) return; // cancelled
                entryValue = val;
            }

            // Snapshot goals_desc/unit/hidden SAAT drop — baris ini berdiri
            // sendiri, tampilannya nggak berubah lagi walau goal aslinya
            // diedit/dihapus belakangan.
            const entry = {
                id: goalId, value: entryValue,
                text: goal ? goal.text : '(goal dihapus)',
                unit: goal ? goal.unit : '',
                trackValue: !!(goal && goal.trackValue),
                hidden: !!(goal && goal.hidden),
            };
            progress[dateId].push(entry);

            if (IS_GUEST) persistGuest();
            else {
                // Setiap goal yang mendarat di tanggal = SATU BARIS BARU di
                // calender_h (bukan overwrite blob). '23505' = udah kecatet
                // dari device lain (kalau ada unique constraint), aman diabaikan.
                trackOp(supabase.from('calender_h').insert({
                    user_id: CURRENT_USER.id,
                    goals_id: goalId,
                    effective_date: dateIdToIso(dateId),
                    goals_desc: entry.text,
                    unit: entry.unit,
                    track_value: entryValue,
                    hidden: entry.hidden,
                }), ['23505']);
            }
            renderCalendar();
        }

        async function editDroppedValue(dateId, goalId) {
            const entry = (progress[dateId] || []).find(e => e.id === goalId);
            if (!entry) return;
            const goal = goals.find(g => g.id === goalId);
            const isTracked = entry.trackValue !== undefined ? entry.trackValue : !!(goal && goal.trackValue);
            if (!isTracked) return;
            const unit = entry.unit !== undefined ? entry.unit : ((goal && goal.unit) || '');
            const text = entry.text || (goal && goal.text) || '';
            const val = await showValueModal(text, entry.value, unit);
            if (val === null) return;
            entry.value = val;
            if (IS_GUEST) persistGuest();
            else trackOp(supabase.from('calender_h')
                .update({ track_value: val, updated_at: new Date().toISOString() })
                .eq('goals_id', goalId)
                .eq('effective_date', dateIdToIso(dateId))
                .eq('user_id', CURRENT_USER.id));
            renderCalendar();
        }

        window.removeGoalFromDate = function (dateId, goalId, event) {
            if (event) event.stopPropagation();
            if (progress[dateId]) {
                progress[dateId] = progress[dateId].filter(e => e.id !== goalId);
                if (IS_GUEST) persistGuest();
                else trackOp(supabase.from('calender_h')
                    .delete()
                    .eq('goals_id', goalId)
                    .eq('effective_date', dateIdToIso(dateId))
                    .eq('user_id', CURRENT_USER.id));
                renderCalendar();
            }
        };

        function renderDroppedGoalsInto(container, dateId) {
            container.innerHTML = '';
            const entries = progress[dateId] || [];
            entries.forEach(entry => {
                const goal = goals.find(g => g.id === entry.id);
                // Entri cloud udah bawa snapshot sendiri (entry.text/.unit/
                // .trackValue/.hidden dari calender_h); entri lama/guest cuma
                // punya {id,value} -> fallback ke goal aktif lalu ke textBackupDb.
                const text = entry.text || (goal ? goal.text : textBackupDb[entry.id]);
                if (!text) return;
                const isHiddenSnap = entry.hidden !== undefined ? entry.hidden : !!(goal && goal.hidden);
                const isTracked = entry.trackValue !== undefined ? entry.trackValue : !!(goal && goal.trackValue);
                const unit = entry.unit !== undefined ? entry.unit : ((goal && goal.unit) || '');

                const chip = document.createElement('div');
                chip.className = 'dropped-goal';
                if (isHiddenSnap) chip.classList.add('hide-from-calendar');
                if (isTracked) chip.classList.add('has-value');

                const valueLabel = isTracked
                    ? `<span class="chip-value">${entry.value ?? '—'}${unit ? ' ' + unit : ''}</span>`
                    : '';

                const textSpan = document.createElement('span');
                textSpan.className = 'chip-text';
                textSpan.innerHTML = `${text}${valueLabel}`;
                if (isTracked) {
                    textSpan.title = 'Klik untuk ubah angka';
                    textSpan.addEventListener('click', (e) => {
                        e.stopPropagation();
                        editDroppedValue(dateId, entry.id);
                    });
                }

                const removeSpan = document.createElement('span');
                removeSpan.className = 'remove-cross';
                removeSpan.innerText = '×';
                removeSpan.addEventListener('click', (e) => {
                    e.stopPropagation();
                    removeGoalFromDate(dateId, entry.id, e);
                });

                chip.appendChild(textSpan);
                chip.appendChild(removeSpan);
                container.appendChild(chip);
            });
        }

        // ============ VALUE MODAL ============
        function showValueModal(goalText, defaultValue, unit) {
            document.getElementById('vm-title').innerText = goalText;
            const input = document.getElementById('vm-input');
            input.value = (defaultValue !== null && defaultValue !== undefined) ? defaultValue : '';
            document.getElementById('vm-unit').innerText = unit || '';
            document.getElementById('value-modal-overlay').style.display = 'flex';
            setTimeout(() => { input.focus(); input.select(); }, 30);
            return new Promise(resolve => { valueModalResolve = resolve; });
        }

        function closeValueModal(result) {
            document.getElementById('value-modal-overlay').style.display = 'none';
            if (valueModalResolve) { valueModalResolve(result); valueModalResolve = null; }
        }

        // ============ BACKUP SYSTEM ============
        // Snapshot harian tetap disimpan di browser (safety net gratis di
        // atas cloud), dan file backup lama tetap kompatibel buat di-import.
        function autoDailyBackup() {
            const key = BACKUP_PREFIX + todayStr();
            if (!localStorage.getItem(key)) {
                const snapshot = JSON.stringify({ goals, progress, textBackupDb, savedAt: new Date().toISOString() });
                localStorage.setItem(key, snapshot);
                pruneOldBackups();
            }
        }

        function pruneOldBackups(keepDays) {
            keepDays = keepDays || 30;
            const keys = Object.keys(localStorage).filter(k => k.startsWith(BACKUP_PREFIX)).sort();
            while (keys.length > keepDays) localStorage.removeItem(keys.shift());
        }

        function listBackupSnapshots() {
            return Object.keys(localStorage).filter(k => k.startsWith(BACKUP_PREFIX)).sort().reverse();
        }

        function refreshBackupStatusUI() {
            const snapshots = listBackupSnapshots();
            const statusEl = document.getElementById('backup-status-text');
            if (snapshots.length) {
                const lastDate = snapshots[0].replace(BACKUP_PREFIX, '');
                statusEl.innerText = `Backup otomatis terakhir: ${lastDate} · ${snapshots.length} snapshot tersimpan`;
            } else {
                statusEl.innerText = 'Belum ada backup otomatis.';
            }

            const sel = document.getElementById('restore-select');
            sel.innerHTML = '<option value="">Pilih snapshot tersimpan…</option>';
            snapshots.forEach(key => {
                const opt = document.createElement('option');
                opt.value = key;
                opt.innerText = key.replace(BACKUP_PREFIX, '');
                sel.appendChild(opt);
            });
        }

        function exportBackupFile() {
            const data = { goals, progress, textBackupDb, exportedAt: new Date().toISOString(), app: 'beno1-tracker' };
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tracker-backup-${todayStr()}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        }

        // Jalur bersama untuk import file & restore snapshot: normalisasi
        // format lama, lalu (untuk user cloud) tulis ulang seluruh
        // calender_e/calender_h dan muat balik hasilnya.
        async function applyRestoredData(data) {
            goals = data.goals;
            progress = data.progress;
            textBackupDb = data.textBackupDb || {};
            migrateOldDatabaseFormat();
            migrateProgressEntries();
            migrateGoals();

            if (IS_GUEST) { persistGuest(); return true; }

            setSyncIndicator('saving');
            try {
                await db.replaceAll(goals, progress, textBackupDb);
                const cloud = await db.loadAll();
                goals = cloud.goals;
                progress = cloud.progress;
                textBackupDb = {};
                setSyncIndicator('ok');
                return true;
            } catch (e) {
                console.error('restore ke cloud gagal:', e);
                setSyncIndicator('error');
                alert('Gagal menyimpan hasil restore ke cloud: ' + (e.message || e));
                return false;
            }
        }

        function importBackupFile(file) {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (!data.goals || !data.progress) throw new Error('invalid');
                    if (!confirm('Ini akan mengganti data yang ada dengan isi file backup. Lanjutkan?')) return;
                    const ok = await applyRestoredData(data);
                    if (!ok) return;
                    loadGoals();
                    renderCalendar();
                    refreshBackupStatusUI();
                    alert('Backup berhasil dipulihkan.');
                } catch (err) {
                    alert('File backup tidak valid.');
                }
            };
            reader.readAsText(file);
        }

        function restoreFromSnapshot(key) {
            const raw = localStorage.getItem(key);
            if (!raw) return;
            if (!confirm(`Pulihkan data dari snapshot ${key.replace(BACKUP_PREFIX, '')}? Data saat ini akan diganti.`)) return;
            (async () => {
                try {
                    const data = JSON.parse(raw);
                    const ok = await applyRestoredData(data);
                    if (!ok) return;
                    loadGoals();
                    renderCalendar();
                    alert('Data berhasil dipulihkan dari snapshot.');
                } catch (err) {
                    alert('Snapshot rusak atau tidak valid.');
                }
            })();
        }