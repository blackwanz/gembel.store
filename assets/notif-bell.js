// assets/notif-bell.js
//
// Site-wide notification bell + maintenance banner, backed purely by public.notifications
// (db/migrations/0017_notifications.sql, 0031 kind/link_url/payload, 0037 read_at) -- no email.
//
// Load it after supabaseClient.js on any logged-in page. With no session it does nothing, so it's
// safe on pages guests can also open. Placement:
//   - if the page has an element with [data-notif-bell-mount], the bell renders inline there
//     (dashboard.html / admin.html headers);
//   - otherwise it floats bottom-left (bottom-right is already taken by FABs/toasts on most pages).
// tournament.html has its own bell (with the "Terima Undangan" action), so it doesn't load this.
//
// Maintenance: the newest unread kind='maintenance' notification also shows as a banner across the
// top of the page (sticky, pushing content down) until the user hits "Oke, ngerti" (which marks it read everywhere).
(function () {
  if (window.__gembelNotifBell) return;
  window.__gembelNotifBell = true;
  if (typeof supabase === 'undefined' || !supabase.auth) return;

  const KIND_LABELS = {
    announcement: '📢 Pengumuman',
    maintenance: '🛠 Maintenance',
    archery_gift: '🎁 Kiriman Data',
    tournament_schedule: '📅 Jadwal Pertandingan',
    team_invite: '🤝 Undangan Tim',
  };

  let user = null;
  let items = [];
  let open = false;
  let channel = null;
  let root, btn, badge, panel, banner;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function relTime(iso) {
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'barusan';
    if (diff < 3600) return Math.floor(diff / 60) + ' menit lalu';
    if (diff < 86400) return Math.floor(diff / 3600) + ' jam lalu';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' hari lalu';
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function injectStyle() {
    const css = `
.nb-root { --nb-bg:#fff; --nb-fg:#2d3348; --nb-dim:#6b7284; --nb-faint:#9aa1b3; --nb-border:#e2e6ee; --nb-hover:#f3f6fb; --nb-unread:#eef3ff; --nb-accent:#4f7cff; --nb-shadow:0 12px 30px rgba(45,65,130,.18); font-family:'Inter','Segoe UI',system-ui,sans-serif; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) .nb-root { --nb-bg:#1c2130; --nb-fg:#e6e9f2; --nb-dim:#a9b0c3; --nb-faint:#6f7890; --nb-border:#2e3547; --nb-hover:#252b3c; --nb-unread:#232c47; --nb-accent:#6b8fff; --nb-shadow:0 12px 30px rgba(0,0,0,.45); } }
[data-theme="dark"] .nb-root, [data-theme="dark"].nb-root { --nb-bg:#1c2130; --nb-fg:#e6e9f2; --nb-dim:#a9b0c3; --nb-faint:#6f7890; --nb-border:#2e3547; --nb-hover:#252b3c; --nb-unread:#232c47; --nb-accent:#6b8fff; --nb-shadow:0 12px 30px rgba(0,0,0,.45); }
.nb-root.nb-floating { position:fixed; left:16px; bottom:16px; z-index:9000; }
.nb-root.nb-inline { position:relative; display:inline-flex; }
.nb-btn { position:relative; width:38px; height:38px; border-radius:50%; border:1px solid var(--nb-border); background:var(--nb-bg); color:var(--nb-fg); cursor:pointer; font-size:17px; display:inline-flex; align-items:center; justify-content:center; padding:0; line-height:1; }
.nb-floating .nb-btn { width:46px; height:46px; font-size:20px; box-shadow:var(--nb-shadow); }
.nb-btn:hover { border-color:var(--nb-accent); }
.nb-badge { position:absolute; top:-4px; right:-4px; min-width:18px; height:18px; padding:0 5px; border-radius:999px; background:#e5484d; color:#fff; font-size:10.5px; font-weight:800; display:flex; align-items:center; justify-content:center; box-sizing:border-box; }
.nb-badge[hidden] { display:none; }
.nb-panel { position:absolute; width:min(380px, calc(100vw - 32px)); max-height:min(70vh, 520px); background:var(--nb-bg); color:var(--nb-fg); border:1px solid var(--nb-border); border-radius:16px; box-shadow:var(--nb-shadow); display:none; flex-direction:column; overflow:hidden; text-align:left; }
.nb-panel.nb-open { display:flex; }
.nb-inline .nb-panel { top:calc(100% + 8px); right:0; z-index:9000; }
.nb-floating .nb-panel { bottom:calc(100% + 10px); left:0; }
@media (max-width: 600px) { .nb-inline .nb-panel { position:fixed; top:64px; right:16px; left:16px; width:auto; } }
.nb-head { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:12px 14px; border-bottom:1px solid var(--nb-border); }
.nb-head h3 { margin:0; font-size:15px; font-weight:800; color:var(--nb-fg); }
.nb-link { background:none; border:none; color:var(--nb-accent); font-size:12.5px; font-weight:600; cursor:pointer; padding:4px; font-family:inherit; }
.nb-link:disabled { color:var(--nb-faint); cursor:default; }
.nb-body { overflow-y:auto; padding:6px; display:flex; flex-direction:column; gap:2px; }
.nb-empty { padding:28px 16px; text-align:center; color:var(--nb-faint); font-size:13px; }
.nb-item { display:flex; gap:8px; align-items:flex-start; padding:10px; border-radius:10px; cursor:pointer; }
.nb-item:hover { background:var(--nb-hover); }
.nb-item.nb-unread { background:var(--nb-unread); }
.nb-dot { width:8px; height:8px; border-radius:50%; background:var(--nb-accent); flex:none; margin-top:6px; }
.nb-item:not(.nb-unread) .nb-dot { visibility:hidden; }
.nb-main { flex:1; min-width:0; }
.nb-kind { font-size:10px; font-weight:800; letter-spacing:.04em; text-transform:uppercase; color:var(--nb-faint); margin-bottom:2px; }
.nb-kind.nb-maint { color:#d9822b; }
.nb-title { font-weight:700; font-size:13.5px; color:var(--nb-fg); }
.nb-msg { font-size:12.5px; color:var(--nb-dim); margin-top:2px; white-space:pre-wrap; overflow-wrap:anywhere; }
.nb-time { font-size:11px; color:var(--nb-faint); margin-top:4px; }
.nb-del { border:none; background:transparent; color:var(--nb-faint); cursor:pointer; padding:2px 6px; border-radius:999px; font-size:14px; line-height:1; flex:none; }
.nb-del:hover { color:var(--nb-fg); background:var(--nb-border); }
.nb-banner { position:sticky; top:0; z-index:9500; width:100%; display:flex; align-items:flex-start; gap:12px; padding:10px 16px; background:#fff4e0; color:#6b4300; border-bottom:1px solid #f2d19a; box-shadow:0 4px 14px rgba(0,0,0,.12); font-family:'Inter','Segoe UI',system-ui,sans-serif; font-size:13.5px; line-height:1.45; box-sizing:border-box; }
.nb-banner-text { flex:1; min-width:0; overflow-wrap:anywhere; }
.nb-banner-text b { margin-right:6px; }
.nb-banner button { flex:none; border:1px solid #d9a352; background:#fff; color:#6b4300; border-radius:8px; padding:5px 12px; font-weight:700; font-size:12.5px; cursor:pointer; font-family:inherit; }
.nb-banner button:hover { background:#ffe8c2; }
`;
    const style = document.createElement('style');
    style.id = 'nb-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function build() {
    root = document.createElement('div');
    root.className = 'nb-root';
    root.innerHTML = `
      <button type="button" class="nb-btn" title="Notifikasi" aria-label="Notifikasi">🔔<span class="nb-badge" hidden></span></button>
      <div class="nb-panel" role="dialog" aria-label="Notifikasi">
        <div class="nb-head">
          <h3>Notifikasi</h3>
          <button type="button" class="nb-link" data-nb="read-all">Tandai semua dibaca</button>
        </div>
        <div class="nb-body"></div>
      </div>`;
    btn = root.querySelector('.nb-btn');
    badge = root.querySelector('.nb-badge');
    panel = root.querySelector('.nb-panel');

    const mount = document.querySelector('[data-notif-bell-mount]');
    if (mount) { root.classList.add('nb-inline'); mount.appendChild(root); }
    else { root.classList.add('nb-floating'); document.body.appendChild(root); }

    btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
    panel.addEventListener('click', onPanelClick);
    document.addEventListener('click', (e) => { if (open && !root.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });
  }

  function setOpen(v) {
    open = v;
    panel.classList.toggle('nb-open', open);
  }

  function render() {
    const unread = items.filter((n) => !n.read_at).length;
    badge.hidden = unread === 0;
    badge.textContent = unread > 9 ? '9+' : String(unread);
    btn.title = unread ? `Notifikasi (${unread} belum dibaca)` : 'Notifikasi';
    panel.querySelector('[data-nb="read-all"]').disabled = unread === 0;

    const body = panel.querySelector('.nb-body');
    body.innerHTML = items.length ? items.map((n) => `
      <div class="nb-item${n.read_at ? '' : ' nb-unread'}" data-nb="open" data-id="${esc(n.id)}">
        <span class="nb-dot"></span>
        <div class="nb-main">
          <div class="nb-kind${n.kind === 'maintenance' ? ' nb-maint' : ''}">${esc(KIND_LABELS[n.kind] || KIND_LABELS.announcement)}</div>
          <div class="nb-title">${esc(n.title)}</div>
          <div class="nb-msg">${esc(n.message)}</div>
          <div class="nb-time">${relTime(n.created_at)}${n.link_url ? ' · klik buat buka' : ''}</div>
        </div>
        <button type="button" class="nb-del" data-nb="delete" data-id="${esc(n.id)}" title="Hapus notifikasi" aria-label="Hapus notifikasi">✕</button>
      </div>`).join('') : '<div class="nb-empty">Belum ada notifikasi.</div>';

    renderBanner();
  }

  function renderBanner() {
    const maint = items.find((n) => n.kind === 'maintenance' && !n.read_at);
    if (!maint) {
      if (banner) { banner.remove(); banner = null; }
      return;
    }
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'nb-banner nb-root';
      banner.setAttribute('role', 'alert');
      // in-flow (sticky, first child of body) so it pushes the page's own header down instead of
      // covering it -- a fixed overlay would hide the header's bell/logout on short headers
      document.body.prepend(banner);
      banner.addEventListener('click', (e) => {
        const b = e.target.closest('[data-nb="ack"]');
        if (b) markRead([b.dataset.id]);
      });
    }
    banner.innerHTML = `
      <div class="nb-banner-text">🛠 <b>${esc(maint.title)}</b>${esc(maint.message)}</div>
      <button type="button" data-nb="ack" data-id="${esc(maint.id)}">Oke, ngerti</button>`;
  }

  async function onPanelClick(e) {
    e.stopPropagation();
    const el = e.target.closest('[data-nb]');
    if (!el) return;
    const action = el.dataset.nb;
    if (action === 'read-all') {
      await markRead(items.filter((n) => !n.read_at).map((n) => n.id));
    } else if (action === 'delete') {
      await removeItem(el.dataset.id);
    } else if (action === 'open') {
      const n = items.find((x) => x.id === el.dataset.id);
      if (!n) return;
      if (!n.read_at) await markRead([n.id]);
      if (n.link_url) window.location.href = n.link_url;
    }
  }

  async function load() {
    const { data, error } = await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) { console.error('[notif-bell]', error); return; }
    items = data || [];
    render();
  }

  async function markRead(ids) {
    if (!ids.length) return;
    const now = new Date().toISOString();
    // optimistic -- the realtime UPDATE echo will just confirm it
    items = items.map((n) => (ids.includes(n.id) ? { ...n, read_at: n.read_at || now } : n));
    render();
    const { error } = await supabase.from('notifications').update({ read_at: now }).in('id', ids);
    if (error) { console.error('[notif-bell]', error); await load(); }
  }

  async function removeItem(id) {
    items = items.filter((n) => n.id !== id);
    render();
    const { error } = await supabase.from('notifications').delete().eq('id', id);
    if (error) { console.error('[notif-bell]', error); await load(); }
  }

  function subscribe() {
    if (channel) supabase.removeChannel(channel);
    channel = supabase
      .channel('notif-bell-' + user.id)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => load())
      .subscribe();
  }

  function teardown() {
    if (channel) { supabase.removeChannel(channel); channel = null; }
    if (root) { root.remove(); root = null; }
    if (banner) { banner.remove(); banner = null; }
    user = null;
    items = [];
    open = false;
  }

  async function start(sessionUser) {
    if (!sessionUser || (user && user.id === sessionUser.id)) return;
    teardown();
    user = sessionUser;
    if (!document.getElementById('nb-style')) injectStyle();
    build();
    await load();
    subscribe();
  }

  async function init() {
    const { data } = await supabase.auth.getSession();
    await start(data.session && data.session.user);
    supabase.auth.onAuthStateChange((event, session) => {
      if (session && session.user) start(session.user);
      else if (event === 'SIGNED_OUT') teardown();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
