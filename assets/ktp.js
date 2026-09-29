// assets/ktp.js
//
// Client-side NIK reading, shared by dashboard.html (Profil > KTP) and pintol.html. It only gives
// instant feedback while typing -- the real check is public.ktp_parse_nik() + the profile_ktp
// trigger (db/migrations/0045_pintol.sql), which rejects anything this lets through.
//
// NIK layout: PP KK CC DDMMYY NNNN -- province, regency, district, birth date (day +40 for women),
// serial number.

(function () {
  if (window.GembelKTP) return;

  const PROVINCES = {
    11: 'Aceh', 12: 'Sumatera Utara', 13: 'Sumatera Barat', 14: 'Riau', 15: 'Jambi',
    16: 'Sumatera Selatan', 17: 'Bengkulu', 18: 'Lampung', 19: 'Kep. Bangka Belitung', 21: 'Kep. Riau',
    31: 'DKI Jakarta', 32: 'Jawa Barat', 33: 'Jawa Tengah', 34: 'DI Yogyakarta', 35: 'Jawa Timur', 36: 'Banten',
    51: 'Bali', 52: 'Nusa Tenggara Barat', 53: 'Nusa Tenggara Timur',
    61: 'Kalimantan Barat', 62: 'Kalimantan Tengah', 63: 'Kalimantan Selatan', 64: 'Kalimantan Timur', 65: 'Kalimantan Utara',
    71: 'Sulawesi Utara', 72: 'Sulawesi Tengah', 73: 'Sulawesi Selatan', 74: 'Sulawesi Tenggara', 75: 'Gorontalo', 76: 'Sulawesi Barat',
    81: 'Maluku', 82: 'Maluku Utara',
    91: 'Papua', 92: 'Papua Barat', 93: 'Papua Selatan', 94: 'Papua Tengah', 95: 'Papua Pegunungan', 96: 'Papua Barat Daya',
  };

  const pad = (n) => String(n).padStart(2, '0');

  // Same rules, same messages as ktp_parse_nik() in SQL.
  function parse(raw) {
    const nik = String(raw || '').replace(/\D/g, '');
    const fail = (reason) => ({ ok: false, nik, reason });
    if (nik.length !== 16) return fail('NIK harus 16 digit angka');
    const prov = +nik.slice(0, 2);
    if (!PROVINCES[prov]) return fail('Kode provinsi di NIK (2 digit pertama) gak valid');
    if (nik.slice(2, 4) === '00' || nik.slice(4, 6) === '00') return fail('Kode kabupaten/kecamatan di NIK gak valid');
    if (nik.slice(12) === '0000') return fail('Nomor urut di NIK (4 digit terakhir) gak boleh 0000');
    let day = +nik.slice(6, 8), gender = 'L';
    const month = +nik.slice(8, 10), yy = +nik.slice(10, 12);
    if (day > 40) { day -= 40; gender = 'P'; }
    const curYY = new Date().getFullYear() % 100;
    const year = yy > curYY ? 1900 + yy : 2000 + yy;
    const d = new Date(year, month - 1, day);
    if (month < 1 || month > 12 || day < 1 || d.getMonth() !== month - 1 || d.getDate() !== day) {
      return fail('Tanggal lahir di NIK (digit 7-12) gak valid');
    }
    const dob = `${year}-${pad(month)}-${pad(day)}`;
    const adult = new Date(); adult.setFullYear(adult.getFullYear() - 17);
    if (d > adult) return Object.assign(fail('Menurut NIK umur lo belum 17 tahun'), { dob, gender });
    return { ok: true, nik, dob, gender, province: PROVINCES[prov], provinceCode: pad(prov) };
  }

  // 3171 •••• •••• 0001 -- enough to recognise your own card, useless to anyone else.
  function mask(nik) {
    const s = String(nik || '');
    return s.length === 16 ? `${s.slice(0, 4)} •••• •••• ${s.slice(12)}` : '—';
  }

  window.GembelKTP = { parse, mask, PROVINCES };
})();
