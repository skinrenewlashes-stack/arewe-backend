const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const sendVerificationEmail = async (email, token) => {
  const verifyUrl = `${process.env.API_URL}/auth/verify-email/${token}`;

  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: 'Verify your email',
    text: `Welcome to AreWe?\n\nThanks for creating your account. Verify your email to finish setting things up.\n\nVerify my email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `
      <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#f5f5f5;">
        <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
          <div style="border:1px solid #2a2415;border-radius:12px;background:#0d0d0d;padding:32px;">
            <div style="text-align:center;margin-bottom:16px;">
              <img src="https://i.imgur.com/8qayZqy.png" alt="AreWe?" style="height:70px;width:auto;display:inline-block;" />
            </div>
            <h1 style="margin:0 0 8px;color:#D4AF37;font-size:28px;line-height:1.2;">AreWe?</h1>
            <p style="margin:0 0 28px;color:#b8b8b8;font-size:14px;">Verify what matters.</p>

            <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;line-height:1.3;">Welcome to AreWe?</h2>
            <p style="margin:0 0 24px;color:#d8d8d8;font-size:15px;line-height:1.6;">
              Thanks for creating your account. Please verify your email address to finish setting things up.
            </p>

            <a href="${verifyUrl}" style="display:inline-block;background:#D4AF37;color:#080808;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:8px;">
              Verify my email
            </a>

            <p style="margin:24px 0 0;color:#9a9a9a;font-size:13px;line-height:1.6;">
              This link expires in 24 hours.
            </p>

            <p style="margin:24px 0 0;color:#9a9a9a;font-size:13px;line-height:1.6;">
              If the button does not work, copy and paste this link into your browser:
            </p>
            <p style="margin:8px 0 0;color:#D4AF37;font-size:13px;line-height:1.6;word-break:break-all;">
              <a href="${verifyUrl}" style="color:#D4AF37;text-decoration:underline;">${verifyUrl}</a>
            </p>
          </div>
        </div>
      </div>
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
      <a href="${process.env.API_URL}/auth/reset-password-redirect?token=${token}">
        Reset Password
      </a>
    `,
  });
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
