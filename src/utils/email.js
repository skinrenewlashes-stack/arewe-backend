const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const sendVerificationEmail = async (email, token) => {
  const verifyUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Verify your AreWe? account',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0a0a0a;color:#f0f0f0;padding:40px;border-radius:12px;">
        <h1 style="color:#f0b429;font-size:28px;margin-bottom:8px;">AreWe?</h1>
        <p style="color:#aaa;font-size:13px;margin-bottom:32px;font-style:italic;">Verify what matters.</p>
        <h2 style="font-size:18px;margin-bottom:16px;">Verify your email</h2>
        <p style="color:#ccc;line-height:1.6;">Thanks for signing up. Click the button below to verify your email address and activate your account.</p>
        <a href="${verifyUrl}" style="display:inline-block;margin-top:24px;padding:14px 28px;background:#f0b429;color:#000;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Verify my email</a>
        <p style="margin-top:24px;color:#666;font-size:12px;">This link expires in 24 hours. If you didn't create an account, you can safely ignore this email.</p>
      </div>
    `,
  });
};

const sendPasswordResetEmail = async (email, token) => {
  const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Reset your AreWe? password',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0a0a0a;color:#f0f0f0;padding:40px;border-radius:12px;">
        <h1 style="color:#f0b429;font-size:28px;margin-bottom:8px;">AreWe?</h1>
        <p style="color:#aaa;font-size:13px;margin-bottom:32px;font-style:italic;">Verify what matters.</p>
        <h2 style="font-size:18px;margin-bottom:16px;">Reset your password</h2>
        <p style="color:#ccc;line-height:1.6;">We received a request to reset your password. Click the button below to create a new one.</p>
        <a href="${resetUrl}" style="display:inline-block;margin-top:24px;padding:14px 28px;background:#f0b429;color:#000;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">Reset my password</a>
        <p style="margin-top:24px;color:#666;font-size:12px;">This link expires in ${process.env.PASSWORD_RESET_EXPIRES_MINUTES} minutes. If you didn't request a reset, you can safely ignore this email.</p>
      </div>
    `,
  });
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
