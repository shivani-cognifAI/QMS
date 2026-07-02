const { EmailClient } = require('@azure/communication-email');

const FROM = process.env.EMAIL_FROM || 'noreply@cognifai.in';

function getClient() {
  const conn = process.env.AZURE_COMM_EMAIL_CONNECTION_STRING;
  if (!conn) throw new Error('AZURE_COMM_EMAIL_CONNECTION_STRING not set');
  return new EmailClient(conn);
}

async function sendOtpEmail({ to, name, otp }) {
  const client = getClient();
  const message = {
    senderAddress: FROM,
    recipients: { to: [{ address: to, displayName: name }] },
    content: {
      subject: 'Your QMS DocControl Account — One-Time Password',
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#F5F4EF;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border:1px solid #E0DDD4;border-radius:12px;overflow:hidden;">
    <div style="background:#1A56DB;padding:24px 28px;">
      <div style="color:#fff;font-size:18px;font-weight:600;letter-spacing:-0.3px;">QMS DocControl</div>
      <div style="color:#93B4F5;font-size:12px;margin-top:2px;">Document Management System</div>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 16px;font-size:15px;color:#1C1B18;">Hi <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;font-size:14px;color:#6B6960;line-height:1.6;">
        An account has been created for you on <strong>QMS DocControl</strong>. Use the one-time password below to sign in. You will be asked to set a new password immediately after.
      </p>
      <div style="background:#EBF2FF;border:1px solid #93B4F5;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:600;color:#1A56DB;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">One-Time Password</div>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#1C1B18;font-family:'Courier New',monospace;">${otp}</div>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#6B6960;">
        <strong>Sign in at:</strong> Your QMS application URL
      </p>
      <p style="margin:0 0 20px;font-size:13px;color:#6B6960;">
        <strong>Your email (username):</strong> ${to}
      </p>
      <div style="background:#FFF3CD;border:1px solid #f0c060;border-radius:6px;padding:12px 14px;font-size:12px;color:#9A5700;">
        This password can only be used once. Please change it immediately after logging in.
      </div>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #E0DDD4;font-size:11px;color:#9B9890;">
      This is an automated message from QMS DocControl. Do not reply to this email.
    </div>
  </div>
</body>
</html>`,
      plainText: `Hi ${name},\n\nYour QMS DocControl account has been created.\n\nEmail: ${to}\nOne-Time Password: ${otp}\n\nSign in and change your password immediately.\n\nThis is an automated message.`,
    },
  };

  const poller = await client.beginSend(message);
  return poller.pollUntilDone();
}

async function sendPasswordResetEmail({ to, name, otp }) {
  const client = getClient();
  const message = {
    senderAddress: FROM,
    recipients: { to: [{ address: to, displayName: name }] },
    content: {
      subject: 'QMS DocControl — Password Reset',
      html: `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#F5F4EF;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border:1px solid #E0DDD4;border-radius:12px;overflow:hidden;">
    <div style="background:#1A56DB;padding:24px 28px;">
      <div style="color:#fff;font-size:18px;font-weight:600;">QMS DocControl</div>
      <div style="color:#93B4F5;font-size:12px;margin-top:2px;">Document Management System</div>
    </div>
    <div style="padding:28px;">
      <p style="margin:0 0 16px;font-size:15px;color:#1C1B18;">Hi <strong>${name}</strong>,</p>
      <p style="margin:0 0 20px;font-size:14px;color:#6B6960;line-height:1.6;">
        Your password has been reset by an administrator. Use the one-time password below to sign in and set a new password.
      </p>
      <div style="background:#EBF2FF;border:1px solid #93B4F5;border-radius:8px;padding:20px;text-align:center;margin-bottom:24px;">
        <div style="font-size:11px;font-weight:600;color:#1A56DB;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px;">One-Time Password</div>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;color:#1C1B18;font-family:'Courier New',monospace;">${otp}</div>
      </div>
      <div style="background:#FFF3CD;border:1px solid #f0c060;border-radius:6px;padding:12px 14px;font-size:12px;color:#9A5700;">
        This password can only be used once. Please change it immediately after logging in.
      </div>
    </div>
    <div style="padding:16px 28px;border-top:1px solid #E0DDD4;font-size:11px;color:#9B9890;">
      This is an automated message from QMS DocControl. Do not reply to this email.
    </div>
  </div>
</body>
</html>`,
      plainText: `Hi ${name},\n\nYour QMS DocControl password has been reset.\n\nEmail: ${to}\nOne-Time Password: ${otp}\n\nSign in and change your password immediately.`,
    },
  };

  const poller = await client.beginSend(message);
  return poller.pollUntilDone();
}

module.exports = { sendOtpEmail, sendPasswordResetEmail };
