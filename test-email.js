const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: 'smtp-relay.brevo.com',
  port: 587,
  secure: false,
  auth: {
    // Read from environment, never hardcoded -- set BREVO_SMTP_USER/BREVO_SMTP_KEY
    // locally (e.g. via a .env file, already gitignored) before running this.
    user: process.env.BREVO_SMTP_USER,
    pass: process.env.BREVO_SMTP_KEY,
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
