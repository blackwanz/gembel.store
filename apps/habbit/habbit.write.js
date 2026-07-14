// ============================================================
// HABBIT — write functionality (classic-script build).
// Load AFTER habbit.config.js and habbit.utils.js.
// Same defense-in-depth validation as the ES-module version —
// see the real habbit.write.js for the full security notes.
// ============================================================
(function () {
  'use strict';
  window.Habbit = window.Habbit || {};
  const { supabase } = window.Habbit.config;
  const { toTimeOfDay, toDateOnly, newId } = window.Habbit.utils;

  async function startActivity({ userId, activity }) {
    if (!userId) throw new Error('Sesi tidak ditemukan, coba login ulang.');
    const clean = String(activity == null ? '' : activity).trim().slice(0, 200);
    if (clean.length < 3) throw new Error('Aktivitas minimal 3 karakter.');

    const now = new Date();
    const payload = {
      user_id: userId, activity_id: newId(), activity: clean,
      time_start: toTimeOfDay(now), start_date: toDateOnly(now),
    };
    const { data, error } = await supabase.from('habbit_h').insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async function recordExpense({ userId, activity, financeTag, nominal }) {
    if (!userId) throw new Error('Sesi tidak ditemukan, coba login ulang.');
    const clean = String(activity == null ? '' : activity).trim().slice(0, 200);
    if (clean.length < 3) throw new Error('Aktivitas minimal 3 karakter.');
    const amount = Number(nominal);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('Nominal harus angka dan lebih dari 0.');
    const cleanTag = financeTag ? String(financeTag).trim().slice(0, 60) : null;

    const now = new Date();
    const today = toDateOnly(now);
    const nowTime = toTimeOfDay(now);
    const payload = {
      user_id: userId, activity_id: newId(), activity: clean,
      time_start: nowTime, time_end: nowTime, total_hours: 0, total_second: 0,
      finance_flag: true, finance_tag: cleanTag, nominal: amount,
      effective_date: today, start_date: today, end_date: today,
    };
    const { data, error } = await supabase.from('habbit_d').insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async function stopActivity({ habbitHId, qty, unit }) {
    if (!habbitHId) throw new Error('ID aktivitas tidak valid.');

    let cleanQty = null;
    if (qty !== null && qty !== undefined && qty !== '') {
      cleanQty = Number(qty);
      if (!Number.isFinite(cleanQty) || cleanQty <= 0) {
        throw new Error('Jumlah harus angka lebih dari 0 (atau kosongkan).');
      }
    }
    const cleanUnit = unit ? String(unit).trim().slice(0, 40) : null;

    const now = new Date();
    const { data, error } = await supabase.rpc('stop_habbit', {
      p_habbit_h_id: habbitHId, p_time_end: toTimeOfDay(now), p_end_date: toDateOnly(now),
      p_qty: cleanQty, p_qty_unit: cleanUnit,
    });
    if (error) throw error;
    return data;
  }

  window.Habbit.write = { startActivity, recordExpense, stopActivity };
})();
