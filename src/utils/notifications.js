const nodemailer = require('nodemailer');
const pool = require('../config/db');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
});

const BASE_STYLE = `
  font-family:sans-serif;max-width:480px;margin:0 auto;
  background:#0a0a0a;color:#f0f0f0;padding:40px;border-radius:12px;
`;

async function getUserNotifPrefs(userId) {
  const res = await pool.query(
    `SELECT email_notifications, push_notifications,
            notification_new_match, notification_connection_request,
            notification_payment_required, notification_request_accepted,
            notification_request_declined, notification_request_expired,
            notification_contact_exchange
     FROM user_profiles WHERE user_id = $1`,
    [userId]
  );
  return res.rows[0] || {};
}

async function getUserEmail(userId) {
  const res = await pool.query('SELECT email FROM users WHERE id = $1', [userId]);
  return res.rows[0]?.email;
}

async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, html });
  } catch (err) {
    console.error('Email send failed:', err.message);
  }
}

async function notifyNewMatch(userId, percentage) {
  const prefs = await getUserNotifPrefs(userId);
  if (!prefs.notification_new_match || !prefs.email_notifications) return;
  const email = await getUserEmail(userId);
  if (!email) return;
  await sendEmail(
    email,
    'Potential similarity detected — AreWe?',
    `<div style="${BASE_STYLE}">
      <h1 style="color:#f0b429;font-size:28px;margin-bottom:8px;">AreWe?</h1>
      <h2 style="font-size:18px;margin-bottom:16px;">Potential similarity detected</h2>
      <p style="color:#ccc;line-height:1.6;">
        A ${percentage}% similarity was detected for one of your submissions.
        Open the app to view your result.
      </p>
    </div>`
  );
}

async function notifyConnectionRequest(recipientId) {
  const prefs = await getUserNotifPrefs(recipientId);
  if (!prefs.notification_connection_request || !prefs.email_notifications) return;
  const email = await getUserEmail(recipientId);
  if (!email) return;
  await sendEmail(
    email,
    'You have a connection request — AreWe?',
    `<div style="${BASE_STYLE}">
      <h1 style="color:#f0b429;font-size:28px;margin-bottom:8px;">AreWe?</h1>
      <h2 style="font-size:18px;margin-bottom:16px;">Connection request received</h2>
      <p style="color:#ccc;line-height:1.6;">
        Someone has sent you a connection request. Open the app to view and respond.
        Payment of $4.99 is required to unlock the details.
      </p>
    </div>`
  );
}

async function notifyPaymentRequired(recipientId) {
  const prefs = await getUserNotifPrefs(recipientId);
  if (!prefs.notification_payment_required || !prefs.email_notifications) return;
  const email = await getUserEmail(recipientId);
  if (!email) return;
  await sendEmail(
    email,
    'Payment required to continue — AreWe?',
    `<div style="${BASE_STYLE}">
      <h1 style="color:#f0b429;font-size:28px;margin-bottom:8px;">AreWe?</h1>
      <h2 style="font-size:18px;margin-bottom:16px;">Payment required</h2>
      <p style="color:#ccc;line-height:1.6;">
        A connection request is waiting for you. Unlock your side for $4.99 to view
        the breakdown and respond.
      </p>
    </div>`
  );
}

async function notifyRequestAccepted(requesterId) {
  const prefs = await getUserNotifPrefs(requesterId);
  if (!prefs.notification_request_accepted || !prefs.email_notifications) return;
  const email = await getUserEmail(requesterId);
  if (!email) return;
  await sendEmail(
    email,
    'Your connection request was accepted — AreWe?',
    `<div style="${BASE_STYLE}">
      <h1 style="color:#f0b429;font-size:28px;margin-bottom:8px;">AreWe?</h1>
      <h2 style="font-size:18px;margin-bottom:16px;">Request accepted</h2>
      <p style="color:#ccc;line-height:1.6;">
        Both users accepted. Open the app to choose what contact information to share.
      </p>
    </div>`
  );
}

async function notifyRequestDeclined(requesterId) {
  const prefs = await getUserNotifPrefs(requesterId);
  if (!prefs.notification_request_declined || !prefs.email_notifications) return;
  const email = await getUserEmail(requesterId);
  if (!email) return;
  await sendEmail(
    email,
    'Connection request declined — AreWe?',
    `<div style="${BASE_STYLE}">
      <h1 style="color:#f0b429;font-size:28px;margin-bottom:8px;">AreWe?</h1>
      <h2 style="font-size:18px;margin-bottom:16px;">Request declined</h2>
      <p style="color:#ccc;line-height:1.6;">
        Your connection request was not accepted. No information was shared.
      </p>
    </div>`
  );
}

async function notifyContactExchange(userId) {
  const prefs = await getUserNotifPrefs(userId);
  if (!prefs.notification_contact_exchange || !prefs.email_notifications) return;
  const email = await getUserEmail(userId);
  if (!email) return;
  await sendEmail(
    email,
    'Contact information exchanged — AreWe?',
    `<div style="${BASE_STYLE}">
      <h1 style="color:#f0b429;font-size:28px;margin-bottom:8px;">AreWe?</h1>
      <h2 style="font-size:18px;margin-bottom:16px;">Connection completed</h2>
      <p style="color:#ccc;line-height:1.6;">
        Contact information has been exchanged. Continue your conversation outside AreWe?
      </p>
    </div>`
  );
}

module.exports = {
  notifyNewMatch,
  notifyConnectionRequest,
  notifyPaymentRequired,
  notifyRequestAccepted,
  notifyRequestDeclined,
  notifyContactExchange,
};
