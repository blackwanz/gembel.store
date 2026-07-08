// ============================================================
// DEVIL DIARY — same rules as before, dressed for the opera.
//  - Standard souls: vent freely in the devil note.
//  - Admins: must pay the "angel tax" (10 positive notes)
//    before the abyss unlocks.
// ============================================================

const clingSound = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
const ANGEL_TARGET = 10;

let currentUser = null;
let isAdmin = false;

const titleEl       = document.getElementById('title');
const subtitleEl    = document.getElementById('subtitle');
const angelSection  = document.getElementById('angel-section');
const devilSection  = document.getElementById('devil-section');
const angelLeftEl   = document.getElementById('angel-left');
const angelBarEl    = document.getElementById('angel-bar');
const angelProgEl   = document.getElementById('angel-progress');
const angelInput    = document.getElementById('angel-input');
const devilInput    = document.getElementById('devil-input');
const moodOrb       = document.getElementById('mood-orb');
const moodIcon      = document.getElementById('mood-icon');

function showToast(msg, type) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 2600);
}

function setMood(mood) { // 'angel' | 'devil'
  moodOrb.classList.remove('angel', 'devil');
  moodOrb.classList.add(mood);
  moodIcon.textContent = mood === 'angel' ? '😇' : '👿';
  angelSection.classList.toggle('hidden', mood !== 'angel');
  devilSection.classList.toggle('hidden', mood !== 'devil');
}

async function initApp() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { window.location.href = '../../index.html'; return; }
  currentUser = user;

  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single();
  isAdmin = profile?.role === 'admin';

  await evaluateRestrictions();
}

async function evaluateRestrictions() {
  if (!isAdmin) {
    titleEl.innerText = 'Devil Diary';
    subtitleEl.innerText = 'Venting space for standard souls.';
    setMood('devil');
    return;
  }

  const { count, error } = await supabase.from('devil_diary')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', currentUser.id)
    .eq('type', 'angel');

  if (error) console.error('Error fetching notes:', error);

  const angelCount = count || 0;

  if (angelCount >= ANGEL_TARGET) {
    titleEl.innerText = 'Devil Diary — Unlocked';
    subtitleEl.innerText = 'The tax has been paid. You may vent.';
    setMood('devil');
  } else {
    titleEl.innerText = "Angel's Restriction";
    subtitleEl.innerText = 'Balanced mind required before entering the dark zone.';
    angelLeftEl.innerText = ANGEL_TARGET - angelCount;
    angelProgEl.textContent = `${angelCount} / ${ANGEL_TARGET}`;
    angelBarEl.style.width = `${(angelCount / ANGEL_TARGET) * 100}%`;
    setMood('angel');
  }
}

async function handleNoteSubmission(type, btn) {
  const inputField = type === 'angel' ? angelInput : devilInput;
  const noteContent = inputField.value.trim();

  if (!noteContent) {
    showToast('Note cannot be empty.', 'err');
    inputField.focus();
    return;
  }

  btn.disabled = true;
  const { error } = await supabase.from('devil_diary').insert({
    user_id: currentUser.id,
    type: type,
    note: noteContent,
  });
  btn.disabled = false;

  if (error) {
    showToast('Failed to save: ' + error.message, 'err');
    return;
  }

  clingSound.play().catch(() => {});
  inputField.value = '';
  showToast(type === 'angel' ? 'Angel note received ☁️' : 'Released to darkness 🔥', 'ok');
  await evaluateRestrictions();
}

document.getElementById('btn-submit-angel')
  .addEventListener('click', (e) => handleNoteSubmission('angel', e.currentTarget));
document.getElementById('btn-submit-devil')
  .addEventListener('click', (e) => handleNoteSubmission('devil', e.currentTarget));

document.addEventListener('DOMContentLoaded', initApp);
