const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const sendVerificationEmail = async (email, token) => {
  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Verify your email',
    html: `
      <p>Click the link below to verify your email:</p>
      <a href="${process.env.API_URL}/auth/verify-email/${token}">
        Verify Email
      </a>
    `,
  });
};

const sendPasswordResetEmail = async (email, token) => {
  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Reset your AreWe? password',
    html: `
      <p>Click the link below to reset your password:</p>
      <a href="${process.env.FRONTEND_URL}/reset-password?token=${token}">
        Reset Password
      </a>
    `,
  });
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
