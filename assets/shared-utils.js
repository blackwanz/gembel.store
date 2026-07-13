// ============================================================
// SHARED UTILITIES — helper functions used across the app
// ============================================================

/**
 * Generate a unique ID (UUID v4 format)
 */
export function newId() {
  return crypto.randomUUID();
}

/**
 * Convert a Date to time-of-day string (HH:MM:SS)
 */
export function toTimeOfDay(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Convert a Date to date-only string (YYYY-MM-DD)
 */
export function toDateOnly(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Escape HTML to prevent XSS attacks
 */
export function escapeHtml(text) {
  if (!text) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return String(text).replace(/[&<>"']/g, (ch) => map[ch]);
}

/**
 * Get initials from a name (e.g., "John Doe" -> "JD")
 */
export function initials(name) {
  if (!name) return '·';
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word[0]?.toUpperCase() || '')
    .slice(0, 2)
    .join('');
}

/**
 * Format a clock time from ISO string or Date
 * e.g., "2024-01-15T14:30:45Z" -> "14:30"
 */
export function fmtClock(isoOrDate) {
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Format duration in seconds to human-readable format
 * e.g., 3661 -> "1h 1m 1s"
 */
export function fmtDurationSecs(seconds) {
  if (!seconds || seconds < 0) return '0s';
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Format Rupiah currency
 * e.g., 100000 -> "Rp 100.000"
 */
export function fmtRupiah(nominal) {
  if (!nominal || nominal <= 0) return 'Rp 0';
  return 'Rp ' + nominal.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Format relative time (e.g., "2 hours ago", "just now")
 */
export function fmtRelativeTime(isoOrDate) {
  const date = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'baru saja';
  if (diffMins < 60) return `${diffMins}m yang lalu`;
  if (diffHours < 24) return `${diffHours}h yang lalu`;
  if (diffDays < 7) return `${diffDays}d yang lalu`;

  // Fallback: show date in local format
  return date.toLocaleDateString('id-ID', {
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Show a toast notification at the bottom of the screen
 * @param {string} message - The message to show
 * @param {string} type - 'success' (default) or 'err' (error)
 */
export function showToast(message, type = 'success') {
  const toast = document.getElementById('toast');
  if (!toast) return;

  toast.textContent = message;
  toast.classList.remove('err');
  if (type === 'err') toast.classList.add('err');
  toast.classList.add('show');

  // Auto-hide after 3 seconds
  setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

/**
 * Mark a form field as invalid (show error message)
 * @param {string} fieldId - The ID of the field wrapper (e.g., "f-activity")
 * @param {boolean} invalid - Whether the field is invalid
 */
export function setFieldInvalid(fieldId, invalid) {
  const field = document.getElementById(fieldId);
  if (!field) return;

  const input = field.querySelector('input, textarea');
  const errText = field.querySelector('.err-text');

  field.classList.toggle('invalid', invalid);
  if (input) {
    if (invalid) {
      input.setAttribute('aria-invalid', 'true');
    } else {
      input.removeAttribute('aria-invalid');
    }
  }
  if (errText) {
    errText.classList.toggle('show', invalid);
  }
}

/**
 * Wrapper to disable a button while an async operation is in progress
 * @param {HTMLElement} button - The button element
 * @param {string} busyText - Text to show while busy (e.g., "Loading…")
 * @param {Function} fn - Async function to execute
 */
export async function withBusy(button, busyText, fn) {
  if (!button) return;

  const originalText = button.textContent;
  const originalDisabled = button.disabled;

  button.disabled = true;
  button.textContent = busyText;

  try {
    await fn();
  } finally {
    button.disabled = originalDisabled;
    button.textContent = originalText;
  }
}

/**
 * Simple state store / event emitter
 * @param {object} initialState - Initial state
 * @returns {object} Store with getState, setState, subscribe methods
 */
export function createStore(initialState) {
  let state = { ...initialState };
  const listeners = [];

  return {
    getState() {
      return { ...state };
    },

    setState(updates) {
      state = { ...state, ...updates };
      listeners.forEach((fn) => fn(state));
    },

    subscribe(listener) {
      listeners.push(listener);
      return () => {
        listeners.splice(listeners.indexOf(listener), 1);
      };
    },
  };
}