let CURRENT_USER = null;
let CURRENT_PROFILE = null;
let ALL_TICKETS = [];
let ALL_PAYMENTS = [];
let ALL_DEVELOPERS = [];

function switchAdminTab(name) {
  document.querySelectorAll('.dash-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.getElementById('tab-tickets').style.display = name === 'tickets' ? 'block' : 'none';
  document.getElementById('tab-payments').style.display = name === 'payments' ? 'block' : 'none';
  document.getElementById('tab-developers').style.display = name === 'developers' ? 'block' : 'none';
}

function statusLabel(s) {
  return { antre: 'ANTRE', diproses: 'DIPROSES', selesai: 'SELESAI' }[s] || String(s || '').toUpperCase();
}

// same cleanup helpers as dashboard.js — kept local so admin.html
// doesn't need to load dashboard.js just to reuse three functions.
function cleanText(raw, maxLen) {
  if (raw === null || raw === undefined) return null;
  let v = String(raw).trim();
  if (!v) return null;
  if (maxLen && v.length > maxLen) v = v.slice(0, maxLen);
  return v;
}
function cleanCompactText(raw, maxLen) {
  const v = cleanText(raw, maxLen);
  return v ? v.replace(/\s+/g, ' ') : null;
}

// ------------------------------------------------------------
// TIKET APP (app_request) — queue + status/note updates
// ------------------------------------------------------------

function renderTicketCard(req) {
  const num = '#' + req.id.slice(0, 6).toUpperCase();
  const title = req.title && req.title.trim() ? req.title : 'App tanpa judul';
  const requester = req.user_profiles?.full_name || req.user_profiles?.email || req.user_id.slice(0, 8);

  return `
    <div class="ticket st-${req.status}" data-id="${req.id}">
      <div class="ticket-head">
        <span class="ticket-num mono" title="ID: ${req.id}">${num}</span>
        <span class="badge st-${req.status}">${statusLabel(req.status)}</span>
      </div>
      <h3>${escapeHtml(title)}</h3>
      <p class="prompt" style="color:var(--text-faint);font-size:12px;">Dari: ${escapeHtml(requester)}</p>
      <p class="prompt">${escapeHtml(req.prompt)}</p>
      <div class="ticket-time" style="margin-bottom:8px;">${fmtRelativeTime(req.created_at)}</div>

      <div class="field">
        <label>Status</label>
        <select id="status-${req.id}">
          <option value="antre" ${req.status === 'antre' ? 'selected' : ''}>Antre</option>
          <option value="diproses" ${req.status === 'diproses' ? 'selected' : ''}>Diproses</option>
          <option value="selesai" ${req.status === 'selesai' ? 'selected' : ''}>Selesai</option>
        </select>
      </div>
      <div class="field">
        <label>App URL (kalau selesai)</label>
        <input type="text" id="appurl-${req.id}" placeholder="https://..." value="${escapeHtml(req.app_url || '')}">
      </div>
      <div class="field">
        <label>APK URL (opsional)</label>
        <input type="text" id="apkurl-${req.id}" placeholder="https://..." value="${escapeHtml(req.apk_url || '')}">
      </div>
      <div class="field">
        <label>Catatan buat member</label>
        <textarea id="note-${req.id}" placeholder="Catatan yang bakal keliatan di dashboard member..." style="min-height:60px;">${escapeHtml(req.admin_note || '')}</textarea>
      </div>
      <div id="ticket-msg-${req.id}" class="form-msg"></div>
      <button class="btn btn-primary btn-block" id="save-ticket-${req.id}" onclick="saveTicket('${req.id}')">Simpan perubahan</button>
    </div>`;
}

function renderTicketList() {
  const filter = document.getElementById('ticket-filter').value;
  const list = filter === 'all' ? ALL_TICKETS : ALL_TICKETS.filter(t => t.status === filter);
  const grid = document.getElementById('ticket-list');
  document.querySelectorAll('#ticket-list .ticket').forEach(el => el.remove());
  if (list.length === 0) {
    grid.insertAdjacentHTML('beforeend', `<p style="color:var(--text-faint);">Nggak ada tiket di kategori ini.</p>`);
    return;
  }
  list.forEach(req => grid.insertAdjacentHTML('beforeend', renderTicketCard(req)));
}

function updateTicketStats() {
  document.getElementById('astat-total').textContent = ALL_TICKETS.length;
  document.getElementById('astat-antre').textContent = ALL_TICKETS.filter(t => t.status === 'antre').length;
  document.getElementById('astat-diproses').textContent = ALL_TICKETS.filter(t => t.status === 'diproses').length;
  document.getElementById('astat-selesai').textContent = ALL_TICKETS.filter(t => t.status === 'selesai').length;
  const countEl = document.getElementById('count-tickets');
  const openCount = ALL_TICKETS.filter(t => t.status !== 'selesai').length;
  countEl.textContent = openCount > 0 ? `(${openCount})` : '';
}

async function loadTickets() {
  // user_profiles(...) is a Supabase embedded-resource select — pulls the
  // requester's name/email alongside each ticket in one round trip instead
  // of N+1 queries.
  const { data, error } = await supabase
    .from('app_request')
    .select('*, user_profiles(full_name, email)')
    .order('created_at', { ascending: false });

  const loadingEl = document.getElementById('tickets-loading');
  if (loadingEl) loadingEl.remove();

  if (error) {
    console.error(error);
    document.getElementById('ticket-list').insertAdjacentHTML('beforeend', `<p style="color:var(--text-faint);">Gagal muat tiket: ${escapeHtml(error.message)}</p>`);
    return;
  }
  ALL_TICKETS = data || [];
  updateTicketStats();
  renderTicketList();
}

async function saveTicket(id) {
  const btn = document.getElementById(`save-ticket-${id}`);
  const msgEl = document.getElementById(`ticket-msg-${id}`);
  msgEl.className = 'form-msg';

  const status = document.getElementById(`status-${id}`).value;
  const appUrl = cleanText(document.getElementById(`appurl-${id}`).value, 500);
  const apkUrl = cleanText(document.getElementById(`apkurl-${id}`).value, 500);
  const note = cleanText(document.getElementById(`note-${id}`).value, 1000);

  const payload = { status, app_url: appUrl, apk_url: apkUrl, admin_note: note };

  // Kalau baru berubah jadi 'selesai' dan belum ada expires_at, set jendela
  // akses 3 jam buat member free-tier (elite nggak kena expiry — lihat
  // dashboard.js: isElite() men-skip expiry check).
  const existing = ALL_TICKETS.find(t => t.id === id);
  if (status === 'selesai' && existing && existing.status !== 'selesai' && !existing.expires_at) {
    payload.expires_at = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();
  }

  btn.disabled = true; btn.textContent = 'Menyimpan…';
  const { error } = await supabase.from('app_request').update(payload).eq('id', id);
  btn.disabled = false; btn.textContent = 'Simpan perubahan';

  if (error) {
    msgEl.textContent = 'Gagal simpan: ' + error.message;
    msgEl.className = 'form-msg show error';
    return;
  }
  msgEl.textContent = 'Tersimpan ✓';
  msgEl.className = 'form-msg show success';
  await loadTickets();
}

// ------------------------------------------------------------
// PEMBAYARAN (payment_request) — confirm/reject queue
// ------------------------------------------------------------

function paymentStatusLabel(s) {
  return { pending: 'PENDING', confirmed: 'CONFIRMED', rejected: 'REJECTED' }[s] || String(s || '').toUpperCase();
}

function renderPaymentCard(p) {
  const requester = p.user_profiles?.full_name || p.user_profiles?.email || p.user_id.slice(0, 8);
  const fmt = n => 'Rp' + Number(n || 0).toLocaleString('id-ID');
  const pending = p.status === 'pending';

  return `
    <div class="ticket" data-id="${p.id}">
      <div class="ticket-head">
        <span class="ticket-num mono">#${p.id.slice(0, 6).toUpperCase()}</span>
        <span class="badge">${paymentStatusLabel(p.status)}</span>
      </div>
      <h3>${escapeHtml(requester)}</h3>
      <p class="prompt">Jumlah: <b class="mono">${fmt(p.amount)}</b> — target plan: <b>${escapeHtml(p.flag_premium || 'elite')}</b></p>
      ${p.note ? `<p class="prompt">Catatan user: ${escapeHtml(p.note)}</p>` : ''}
      <div class="ticket-time">${fmtRelativeTime(p.created_at)}</div>
      ${pending ? `
        <div id="payment-msg-${p.id}" class="form-msg" style="margin-top:8px;"></div>
        <div class="ticket-actions" style="margin-top:10px;justify-content:flex-start;gap:8px;">
          <button class="btn btn-primary btn-sm" id="confirm-${p.id}" onclick="confirmPayment('${p.id}')">✓ Konfirmasi</button>
          <button class="btn btn-ghost btn-sm" id="reject-${p.id}" onclick="rejectPayment('${p.id}')">✕ Tolak</button>
        </div>
      ` : `<p class="prompt" style="color:var(--text-faint);">Diproses ${p.date_confirm ? new Date(p.date_confirm).toLocaleDateString('id-ID', {day:'numeric',month:'short',year:'numeric'}) : ''}</p>`}
    </div>`;
}

async function loadPayments() {
  const { data, error } = await supabase
    .from('payment_request')
    .select('*, user_profiles(full_name, email)')
    .order('created_at', { ascending: false });

  const loadingEl = document.getElementById('payments-loading');
  if (loadingEl) loadingEl.remove();

  if (error) {
    console.error(error);
    document.getElementById('payment-list').insertAdjacentHTML('beforeend', `<p style="color:var(--text-faint);">Gagal muat pembayaran: ${escapeHtml(error.message)}</p>`);
    return;
  }
  ALL_PAYMENTS = data || [];
  document.querySelectorAll('#payment-list .ticket').forEach(el => el.remove());
  const countEl = document.getElementById('count-payments');
  const pendingCount = ALL_PAYMENTS.filter(p => p.status === 'pending').length;
  countEl.textContent = pendingCount > 0 ? `(${pendingCount})` : '';

  if (ALL_PAYMENTS.length === 0) {
    document.getElementById('payment-list').insertAdjacentHTML('beforeend', `<p style="color:var(--text-faint);">Belum ada pengajuan pembayaran.</p>`);
    return;
  }
  ALL_PAYMENTS.forEach(p => document.getElementById('payment-list').insertAdjacentHTML('beforeend', renderPaymentCard(p)));
}

/**
 * Konfirmasi payment_request: tandai confirmed + isi date_confirm,
 * LALU update plan user_profiles ke flag_premium yang diajukan.
 * Dua langkah terpisah, bukan satu query gabungan — kalau langkah
 * kedua gagal, admin masih lihat baris ini di status 'confirmed'
 * dan bisa cek manual, alih-alih writenya diam-diam nyangkut setengah.
 */
async function confirmPayment(id) {
  const btn = document.getElementById(`confirm-${id}`);
  const rejectBtn = document.getElementById(`reject-${id}`);
  const msgEl = document.getElementById(`payment-msg-${id}`);
  const payment = ALL_PAYMENTS.find(p => p.id === id);
  if (!payment) return;

  btn.disabled = true; rejectBtn.disabled = true; btn.textContent = 'Mengonfirmasi…';

  const today = new Date().toISOString().slice(0, 10);
  const { error: payErr } = await supabase
    .from('payment_request')
    .update({ status: 'confirmed', date_confirm: today })
    .eq('id', id);

  if (payErr) {
    btn.disabled = false; rejectBtn.disabled = false; btn.textContent = '✓ Konfirmasi';
    msgEl.textContent = 'Gagal konfirmasi: ' + payErr.message;
    msgEl.className = 'form-msg show error';
    return;
  }

  const targetPlan = payment.flag_premium || 'elite';
  const { error: planErr } = await supabase
    .from('user_profiles')
    .update({ plan: targetPlan })
    .eq('user_id', payment.user_id);

  btn.textContent = '✓ Konfirmasi';
  btn.disabled = false; rejectBtn.disabled = false;

  if (planErr) {
    msgEl.textContent = `Payment confirmed, tapi gagal update plan user: ${planErr.message}. Cek manual.`;
    msgEl.className = 'form-msg show error';
    await loadPayments();
    return;
  }

  msgEl.textContent = `Terkonfirmasi — plan user diupdate ke "${targetPlan}" ✓`;
  msgEl.className = 'form-msg show success';
  await loadPayments();
}

async function rejectPayment(id) {
  const btn = document.getElementById(`reject-${id}`);
  const confirmBtn = document.getElementById(`confirm-${id}`);
  btn.disabled = true; confirmBtn.disabled = true; btn.textContent = 'Menolak…';

  const today = new Date().toISOString().slice(0, 10);
  const { error } = await supabase
    .from('payment_request')
    .update({ status: 'rejected', date_confirm: today })
    .eq('id', id);

  if (error) {
    btn.disabled = false; confirmBtn.disabled = false; btn.textContent = '✕ Tolak';
    alert('Gagal menolak: ' + error.message);
    return;
  }
  await loadPayments();
}

// ------------------------------------------------------------
// DEVELOPER ROSTER (developers table)
// ------------------------------------------------------------

function devStatusLabel(s) {
  return { available: 'Available', busy: 'Busy', offline: 'Offline' }[s] || s;
}

function renderDeveloperCard(dev) {
  return `
    <div class="tool-card" data-id="${dev.id}">
      <div class="tool-icon">${dev.status === 'available' ? '🟢' : dev.status === 'busy' ? '🟡' : '⚪'}</div>
      <div>
        <h3>${escapeHtml(dev.name)}</h3>
        <p>${escapeHtml(dev.contact || 'Kontak belum diisi')}</p>
        ${dev.skill_tags ? `<p style="font-size:12px;color:var(--text-faint);">${escapeHtml(dev.skill_tags)}</p>` : ''}
      </div>
      <div class="field">
        <label>Status</label>
        <select id="devstatus-${dev.id}" onchange="updateDeveloperStatus('${dev.id}', this.value)">
          <option value="available" ${dev.status === 'available' ? 'selected' : ''}>Available</option>
          <option value="busy" ${dev.status === 'busy' ? 'selected' : ''}>Busy</option>
          <option value="offline" ${dev.status === 'offline' ? 'selected' : ''}>Offline</option>
        </select>
      </div>
      <button class="btn btn-ghost btn-block" onclick="removeDeveloper('${dev.id}')">Hapus</button>
    </div>`;
}

async function loadDevelopers() {
  const { data, error } = await supabase.from('developers').select('*').order('created_at', { ascending: false });
  const loadingEl = document.getElementById('developers-loading');
  if (loadingEl) loadingEl.remove();
  document.querySelectorAll('#developer-list .tool-card').forEach(el => el.remove());

  if (error) {
    console.error(error);
    document.getElementById('developer-list').insertAdjacentHTML('beforeend', `<p style="color:var(--text-faint);">Gagal muat developer: ${escapeHtml(error.message)}</p>`);
    return;
  }
  ALL_DEVELOPERS = data || [];
  if (ALL_DEVELOPERS.length === 0) {
    document.getElementById('developer-list').insertAdjacentHTML('beforeend', `<p style="color:var(--text-faint);">Belum ada developer terdaftar.</p>`);
    return;
  }
  ALL_DEVELOPERS.forEach(dev => document.getElementById('developer-list').insertAdjacentHTML('beforeend', renderDeveloperCard(dev)));
}

async function addDeveloper() {
  const msgEl = document.getElementById('dev-msg');
  msgEl.className = 'form-msg';

  const name = cleanCompactText(document.getElementById('dev-name').value, 80);
  const contact = cleanText(document.getElementById('dev-contact').value, 120);
  const skills = cleanText(document.getElementById('dev-skills').value, 200);
  const status = document.getElementById('dev-status').value;

  if (!name) {
    msgEl.textContent = 'Nama developer wajib diisi.';
    msgEl.className = 'form-msg show error';
    return;
  }

  const btn = document.getElementById('dev-add-btn');
  btn.disabled = true; btn.textContent = 'Menambahkan…';
  const { error } = await supabase.from('developers').insert({ name, contact, skill_tags: skills, status });
  btn.disabled = false; btn.textContent = '+ Tambah developer';

  if (error) {
    msgEl.textContent = 'Gagal tambah: ' + error.message;
    msgEl.className = 'form-msg show error';
    return;
  }

  document.getElementById('dev-name').value = '';
  document.getElementById('dev-contact').value = '';
  document.getElementById('dev-skills').value = '';
  document.getElementById('dev-status').value = 'available';
  msgEl.textContent = 'Developer ditambahkan ✓';
  msgEl.className = 'form-msg show success';
  await loadDevelopers();
}

async function updateDeveloperStatus(id, status) {
  const { error } = await supabase.from('developers').update({ status }).eq('id', id);
  if (error) alert('Gagal update status: ' + error.message);
}

async function removeDeveloper(id) {
  const { error } = await supabase.from('developers').delete().eq('id', id);
  if (error) { alert('Gagal hapus: ' + error.message); return; }
  await loadDevelopers();
}

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
(async () => {
  const ctx = await requireAdmin('index.html');
  if (!ctx) return;
  CURRENT_USER = ctx.user;
  CURRENT_PROFILE = ctx.profile;

  const name = CURRENT_PROFILE?.full_name || CURRENT_USER.email;
  document.getElementById('chip-avatar').textContent = initials(name);
  document.getElementById('chip-name').textContent = name;

  await Promise.all([loadTickets(), loadPayments(), loadDevelopers()]);

  // live-update queues as new requests come in / other admins act on them
  supabase
    .channel('admin-app-request')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'app_request' }, () => loadTickets())
    .subscribe();

  supabase
    .channel('admin-payment-request')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_request' }, () => loadPayments())
    .subscribe();

  supabase
    .channel('admin-developers')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'developers' }, () => loadDevelopers())
    .subscribe();
})();