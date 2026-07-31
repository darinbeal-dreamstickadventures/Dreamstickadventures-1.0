/**
 * SendGrid email delivery for DreamStick Adventures.
 * Sends self-contained HTML — no dynamic template dependency.
 */

const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send';
const FROM_EMAIL   = 'adventures@dreamstickadventures.com';
const FROM_NAME    = 'DreamStick Adventures';

const THEME_EMOJI: Record<string, string> = {
  space:    '🚀',
  ocean:    '🌊',
  jungle:   '🌿',
  dragons:  '🐉',
  princess: '👑',
  dinosaurs:'🦕',
};

export interface VideoEmailOptions {
  toEmail:   string;
  childName: string;
  theme:     string;
  watchUrl:  string;
}

function buildHtml(opts: VideoEmailOptions): string {
  const emoji = THEME_EMOJI[opts.theme.toLowerCase()] ?? '✨';
  const themeCap = opts.theme.charAt(0).toUpperCase() + opts.theme.slice(1);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Your DreamStick video is ready!</title>
</head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#12122a;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.5);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a4e 0%,#2d1b69 100%);padding:36px 40px 28px;text-align:center;">
            <div style="font-size:48px;margin-bottom:8px;">🌙</div>
            <div style="color:#a78bfa;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">DreamStick Adventures</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <h1 style="margin:0 0 8px;color:#ffffff;font-size:26px;font-weight:800;line-height:1.2;">
              ${opts.childName}'s video is ready! ${emoji}
            </h1>
            <p style="margin:0 0 24px;color:#94a3b8;font-size:15px;line-height:1.6;">
              We just finished rendering a personalized <strong style="color:#c4b5fd;">${themeCap}</strong> bedtime story adventure starring <strong style="color:#c4b5fd;">${opts.childName}</strong>. Hit play and enjoy the magic tonight!
            </p>

            <!-- CTA button -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:10px;">
                  <a href="${opts.watchUrl}" target="_blank"
                     style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
                    ▶&nbsp; Watch ${opts.childName}'s Story
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
              Or copy this link into your browser:<br>
              <a href="${opts.watchUrl}" style="color:#a78bfa;word-break:break-all;">${opts.watchUrl}</a>
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0a0a1a;padding:20px 40px;text-align:center;border-top:1px solid #1e1e3f;">
            <p style="margin:0;color:#475569;font-size:12px;line-height:1.6;">
              You're receiving this because you requested a free personalized story video.<br>
              &copy; ${new Date().getFullYear()} DreamStick Adventures &mdash; adventures@dreamstickadventures.com
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export interface ConfirmationEmailOptions {
  toEmail:   string;
  childName: string;
  theme:     string;
}

const SAMPLE_VIDEO_URL = 'https://app.dreamstickadventures.com/api/videos/liam-1783564468855-narrated.mp4';

function buildConfirmationHtml(opts: ConfirmationEmailOptions): string {
  const emoji    = THEME_EMOJI[opts.theme.toLowerCase()] ?? '✨';
  const themeCap = opts.theme.charAt(0).toUpperCase() + opts.theme.slice(1);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>We're creating ${opts.childName}'s adventure!</title>
</head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#12122a;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.5);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a4e 0%,#2d1b69 100%);padding:36px 40px 28px;text-align:center;">
            <div style="font-size:48px;margin-bottom:8px;">✨</div>
            <div style="color:#a78bfa;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">DreamStick Adventures</div>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:36px 40px;">
            <h1 style="margin:0 0 8px;color:#ffffff;font-size:26px;font-weight:800;line-height:1.2;">
              We're creating ${opts.childName}'s adventure! ${emoji}
            </h1>
            <p style="margin:0 0 20px;color:#94a3b8;font-size:15px;line-height:1.6;">
              Our animators are hard at work crafting a one-of-a-kind <strong style="color:#c4b5fd;">${themeCap}</strong> bedtime story starring <strong style="color:#c4b5fd;">${opts.childName}</strong>. Every frame is rendered personally for them — this usually takes about <strong style="color:#f7e96b;">15 minutes</strong>.
            </p>
            <p style="margin:0 0 28px;color:#94a3b8;font-size:15px;line-height:1.6;">
              We'll email you the moment it's ready. While you wait, enjoy a sample adventure!
            </p>

            <!-- Sample CTA -->
            <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
              <tr>
                <td style="background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:10px;">
                  <a href="${SAMPLE_VIDEO_URL}" target="_blank"
                     style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
                    Watch a sample adventure 🎬
                  </a>
                </td>
              </tr>
            </table>

            <p style="margin:0;color:#64748b;font-size:13px;line-height:1.5;">
              Keep an eye on your inbox — <strong style="color:#a78bfa;">${opts.childName}</strong>'s personalized video will arrive in about 15 minutes.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0a0a1a;padding:20px 40px;text-align:center;border-top:1px solid #1e1e3f;">
            <p style="margin:0;color:#475569;font-size:12px;line-height:1.6;">
              You're receiving this because you requested a free personalized story video.<br>
              &copy; ${new Date().getFullYear()} DreamStick Adventures &mdash; adventures@dreamstickadventures.com
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Send an instant confirmation email the moment the form is submitted —
 * before rendering starts. Lets the parent know the video is on its way
 * and includes a sample adventure link to watch while they wait.
 * Non-fatal — logs and returns false on failure rather than throwing.
 */
export async function sendConfirmationEmail(opts: ConfirmationEmailOptions): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error('[email] SENDGRID_API_KEY is not set — skipping confirmation email');
    return false;
  }
  const body = {
    personalizations: [{ to: [{ email: opts.toEmail }] }],
    from:     { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: { email: FROM_EMAIL, name: FROM_NAME },
    subject:  `✨ We're creating ${opts.childName}'s adventure!`,
    content:  [{ type: 'text/html', value: buildConfirmationHtml(opts) }],
  };
  try {
    const res = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok || res.status === 202) {
      console.log(`[email] Sent confirmation email to ${opts.toEmail} (status ${res.status})`);
      return true;
    }
    const text = await res.text().catch(() => '');
    console.error(`[email] SendGrid confirmation ${res.status}: ${text.slice(0, 400)}`);
    return false;
  } catch (e: any) {
    console.error('[email] confirmation fetch error:', e.message);
    return false;
  }
}

/**
 * Send the "your video is ready" email via SendGrid.
 * Non-fatal — logs and returns false on failure rather than throwing.
 */
export async function sendVideoReadyEmail(opts: VideoEmailOptions): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;

  if (!apiKey) {
    console.error('[email] SENDGRID_API_KEY is not set — skipping email');
    return false;
  }

  const body = {
    personalizations: [{ to: [{ email: opts.toEmail }] }],
    from:     { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: { email: FROM_EMAIL, name: FROM_NAME },
    subject:  `${opts.childName}'s personalized bedtime story is ready! 🌙`,
    content:  [{ type: 'text/html', value: buildHtml(opts) }],
  };

  try {
    const res = await fetch(SENDGRID_API, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.ok || res.status === 202) {
      console.log(`[email] Sent video-ready email to ${opts.toEmail} (status ${res.status})`);
      return true;
    }

    const text = await res.text().catch(() => '');
    console.error(`[email] SendGrid ${res.status}: ${text.slice(0, 400)}`);
    return false;
  } catch (e: any) {
    console.error('[email] fetch error:', e.message);
    return false;
  }
}
