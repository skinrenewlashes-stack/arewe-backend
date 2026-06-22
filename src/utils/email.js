const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

const SUPPORTED_LOCALES = ['en', 'fr', 'es'];

const resolveLocale = (locale) => (
  SUPPORTED_LOCALES.includes(locale) ? locale : 'en'
);

const verificationCopy = {
  en: {
    subject: 'Verify your email',
    tagline: 'Verify what matters.',
    heading: 'Welcome to AreWe?',
    body: 'Thanks for creating your account. Please verify your email address to finish setting things up.',
    button: 'Verify my email',
    expires: 'This link expires in 24 hours.',
    fallback: 'If the button does not work, copy and paste this link into your browser:',
    text: (url) => `Welcome to AreWe?\n\nThanks for creating your account. Verify your email to finish setting things up.\n\nVerify my email: ${url}\n\nThis link expires in 24 hours.`,
  },
  fr: {
    subject: 'Vérifiez votre adresse e-mail',
    tagline: 'Vérifiez ce qui compte.',
    heading: 'Bienvenue sur AreWe?',
    body: 'Merci d’avoir créé votre compte. Veuillez vérifier votre adresse e-mail pour terminer la configuration.',
    button: 'Vérifier mon e-mail',
    expires: 'Ce lien expire dans 24 heures.',
    fallback: 'Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :',
    text: (url) => `Bienvenue sur AreWe?\n\nMerci d’avoir créé votre compte. Vérifiez votre adresse e-mail pour terminer la configuration.\n\nVérifier mon e-mail : ${url}\n\nCe lien expire dans 24 heures.`,
  },
  es: {
    subject: 'Verifica tu correo electrónico',
    tagline: 'Verifica lo que importa.',
    heading: 'Bienvenido a AreWe?',
    body: 'Gracias por crear tu cuenta. Verifica tu correo electrónico para terminar la configuración.',
    button: 'Verificar mi correo',
    expires: 'Este enlace caduca en 24 horas.',
    fallback: 'Si el botón no funciona, copia y pega este enlace en tu navegador:',
    text: (url) => `Bienvenido a AreWe?\n\nGracias por crear tu cuenta. Verifica tu correo electrónico para terminar la configuración.\n\nVerificar mi correo: ${url}\n\nEste enlace caduca en 24 horas.`,
  },
};

const passwordResetCopy = {
  en: {
    subject: 'Reset your AreWe? password',
    intro: 'Click the link below to reset your AreWe? password.',
    expires: 'This link expires in 30 minutes.',
    button: 'Reset Password',
    fallback: 'If the button does not work, copy and paste this link into your browser:',
    ignore: 'If you did not request this, you can ignore this email.',
    text: (url) => `Reset your AreWe? password\n\nClick the link below to reset your password. This link expires in 30 minutes.\n\nReset password: ${url}\n\nIf you did not request this, you can ignore this email.`,
  },
  fr: {
    subject: 'Réinitialisez votre mot de passe AreWe?',
    intro: 'Cliquez sur le lien ci-dessous pour réinitialiser votre mot de passe AreWe?.',
    expires: 'Ce lien expire dans 30 minutes.',
    button: 'Réinitialiser le mot de passe',
    fallback: 'Si le bouton ne fonctionne pas, copiez et collez ce lien dans votre navigateur :',
    ignore: 'Si vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.',
    text: (url) => `Réinitialisez votre mot de passe AreWe?\n\nCliquez sur le lien ci-dessous pour réinitialiser votre mot de passe. Ce lien expire dans 30 minutes.\n\nRéinitialiser le mot de passe : ${url}\n\nSi vous n’êtes pas à l’origine de cette demande, vous pouvez ignorer cet e-mail.`,
  },
  es: {
    subject: 'Restablece tu contraseña de AreWe?',
    intro: 'Haz clic en el enlace de abajo para restablecer tu contraseña de AreWe?.',
    expires: 'Este enlace caduca en 30 minutos.',
    button: 'Restablecer contraseña',
    fallback: 'Si el botón no funciona, copia y pega este enlace en tu navegador:',
    ignore: 'Si no solicitaste esto, puedes ignorar este correo.',
    text: (url) => `Restablece tu contraseña de AreWe?\n\nHaz clic en el enlace de abajo para restablecer tu contraseña. Este enlace caduca en 30 minutos.\n\nRestablecer contraseña: ${url}\n\nSi no solicitaste esto, puedes ignorar este correo.`,
  },
};

const renderVerificationHtml = (copy, verifyUrl) => `
  <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#f5f5f5;">
    <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
      <div style="border:1px solid #2a2415;border-radius:12px;background:#0d0d0d;padding:32px;">
        <div style="text-align:center;margin-bottom:16px;">
          <img src="https://i.imgur.com/8qayZqy.png" alt="AreWe?" style="height:70px;width:auto;display:inline-block;" />
        </div>
        <h1 style="margin:0 0 8px;color:#D4AF37;font-size:28px;line-height:1.2;">AreWe?</h1>
        <p style="margin:0 0 28px;color:#b8b8b8;font-size:14px;">${copy.tagline}</p>

        <h2 style="margin:0 0 16px;color:#ffffff;font-size:22px;line-height:1.3;">${copy.heading}</h2>
        <p style="margin:0 0 24px;color:#d8d8d8;font-size:15px;line-height:1.6;">
          ${copy.body}
        </p>

        <a href="${verifyUrl}" style="display:inline-block;background:#D4AF37;color:#080808;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:8px;">
          ${copy.button}
        </a>

        <p style="margin:24px 0 0;color:#9a9a9a;font-size:13px;line-height:1.6;">
          ${copy.expires}
        </p>

        <p style="margin:24px 0 0;color:#9a9a9a;font-size:13px;line-height:1.6;">
          ${copy.fallback}
        </p>
        <p style="margin:8px 0 0;color:#D4AF37;font-size:13px;line-height:1.6;word-break:break-all;">
          <a href="${verifyUrl}" style="color:#D4AF37;text-decoration:underline;">${verifyUrl}</a>
        </p>
      </div>
    </div>
  </div>
`;

const renderPasswordResetHtml = (copy, resetUrl) => `
  <div style="margin:0;padding:0;background:#050505;font-family:Arial,Helvetica,sans-serif;color:#f5f5f5;">
    <div style="max-width:560px;margin:0 auto;padding:40px 24px;">
      <div style="border:1px solid #2a2415;border-radius:12px;background:#0d0d0d;padding:32px;">
        <h1 style="margin:0 0 20px;color:#D4AF37;font-size:28px;line-height:1.2;">AreWe?</h1>
        <p style="margin:0 0 16px;color:#d8d8d8;font-size:15px;line-height:1.6;">${copy.intro}</p>
        <p style="margin:0 0 24px;color:#d8d8d8;font-size:15px;line-height:1.6;">${copy.expires}</p>
        <a href="${resetUrl}" style="display:inline-block;background:#D4AF37;color:#080808;text-decoration:none;font-weight:700;font-size:15px;padding:14px 22px;border-radius:8px;">
          ${copy.button}
        </a>
        <p style="margin:24px 0 0;color:#9a9a9a;font-size:13px;line-height:1.6;">${copy.fallback}</p>
        <p style="margin:8px 0 0;color:#D4AF37;font-size:13px;line-height:1.6;word-break:break-all;">
          <a href="${resetUrl}" style="color:#D4AF37;text-decoration:underline;">${resetUrl}</a>
        </p>
        <p style="margin:24px 0 0;color:#9a9a9a;font-size:13px;line-height:1.6;">${copy.ignore}</p>
      </div>
    </div>
  </div>
`;

const sendVerificationEmail = async (email, token, locale = 'en') => {
  const verifyUrl = `${process.env.API_URL}/auth/verify-email/${token}`;
  const copy = verificationCopy[resolveLocale(locale)];

  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: copy.subject,
    text: copy.text(verifyUrl),
    html: renderVerificationHtml(copy, verifyUrl),
  });
};

const sendPasswordResetEmail = async (email, token, locale = 'en') => {
  const resetUrl = `${process.env.API_URL}/auth/reset-password-redirect?token=${token}`;
  const copy = passwordResetCopy[resolveLocale(locale)];

  await resend.emails.send({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: copy.subject,
    text: copy.text(resetUrl),
    html: renderPasswordResetHtml(copy, resetUrl),
  });
};

module.exports = { sendVerificationEmail, sendPasswordResetEmail };
