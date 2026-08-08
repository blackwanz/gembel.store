const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    // Gunakan email login Brevo kamu yang kemarin
    user: 'b0bf36001@smtp-brevo.com', 
    // GANTI dengan string Master SMTP Key panjang yang kamu generate dari Brevo (contoh: xsmtpsib-...)
    pass: 'xsmtpsib-b26f5bea0090b49b2280a6d307eb7d0bc29747d7704e67ca7416b2a17899653d-jZ1p9BQFSeua1gfL' 
  },
  logger: true, // Biar tetep kelihatan log detailnya kalau gagal
  debug: true
});

const mailOptions = {
  // Gunakan email sender yang terdaftar di Brevo. 
  // Jika kamu sudah verifikasi domain gembel.fun di Brevo, kamu bisa pakai admin@gembel.fun
  // Jika belum, pakai email utama Brevo kamu dulu: 'irwan.sirait.kntl@gmail.com'
  from: 'b0bf36001@smtp-brevo.com', 
  to: 'irwanto.saputra.sirait@gmail.com', // Dikirim ke email pribadi kamu
  subject: 'Tes SMTP Brevo @gembel.fun',
  text: 'Tes berhasil! Koneksi SMTP Brevo dari server gembel.fun sudah aman.'
};

transporter.sendMail(mailOptions, (error, info) => {
  if (error) {
    console.error('❌ Gagal:', error.message);
  } else {
    console.log('✅ Sukses:', info.response);
  }
});
