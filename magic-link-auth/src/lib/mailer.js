import nodemailer from "nodemailer";

let transporter = null;

/**
 * Returns a Nodemailer transporter.
 * In production, configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
 * Without those, falls back to Ethereal (a real catch-all test SMTP service)
 * and logs the preview URL so you can see the email in your browser.
 */
async function getTransporter() {
  if (transporter) return transporter;

  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  } else {
    // Ethereal generates a real throw-away SMTP account on the fly.
    // Emails don't deliver anywhere, but you can view them at the preview URL.
    const testAccount = await nodemailer.createTestAccount();
    transporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    console.log(`[mailer] using Ethereal test account: ${testAccount.user}`);
  }

  return transporter;
}

/**
 * Sends a magic link email to the given address.
 *
 * @param {string} to - Recipient email address
 * @param {string} magicUrl - The full magic link URL including the token
 */
export async function sendMagicLink(to, magicUrl) {
  const transport = await getTransporter();

  const info = await transport.sendMail({
    from: process.env.EMAIL_FROM || '"Magic Link Auth" <no-reply@example.com>',
    to,
    subject: "Your sign-in link",
    text: `Click this link to sign in. It expires in 15 minutes and can only be used once.\n\n${magicUrl}\n\nIf you didn't request this, you can ignore it.`,
    html: `
      <p>Click the button below to sign in. The link expires in <strong>15 minutes</strong> and can only be used once.</p>
      <p style="margin:24px 0">
        <a href="${magicUrl}" style="background:#111;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-family:sans-serif;font-size:15px">
          Sign in
        </a>
      </p>
      <p style="color:#666;font-size:13px">If the button doesn't work, paste this URL into your browser:<br>${magicUrl}</p>
      <p style="color:#999;font-size:12px">If you didn't request this email, you can safely ignore it.</p>
    `
  });

  // In test mode, log the Ethereal preview URL so you can view the email.
  if (!process.env.SMTP_HOST) {
    console.log(`[mailer] preview: ${nodemailer.getTestMessageUrl(info)}`);
  }
}
