// Отправка email-уведомлений через SMTP (nodemailer)
// Требует: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM, EMAIL_TO в .env
const nodemailer = require('nodemailer');
require('dotenv').config();

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false, // true для порта 465
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

// Отправить письмо.
// Параметры: { subject, html, text?, to? }
// Если to не указан — берётся EMAIL_TO из .env
async function sendEmail({ subject, html, text, to }) {
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    console.log('[Email] Пропускаем: нет SMTP_HOST/SMTP_USER в .env');
    return;
  }
  const transporter = createTransport();
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || process.env.SMTP_USER,
    to: to || process.env.EMAIL_TO,
    subject,
    html,
    text: text || '',
  });
  console.log(`[Email] Отправлено: "${subject}"`);
}

module.exports = { sendEmail };
