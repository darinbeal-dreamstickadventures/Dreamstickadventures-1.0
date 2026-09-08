/**
 * SendGrid email delivery for DreamStick Adventures.
 * Sends self-contained HTML — no dynamic template dependency.
 */

const SENDGRID_API  = 'https://api.sendgrid.com/v3/mail/send';
const FROM_EMAIL    = 'adventures@dreamstickadventures.com';
const FROM_NAME     = 'DreamStick Adventures';
const CHECKOUT_URL  = 'https://app.dreamstickadventures.com/api/checkout/dreamer';

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

const SAMPLE_VIDEO_URL = 'https://pub-c6814ff127874397be8590901348d4ff.r2.dev/alex-1786136600916-narrated.mp4';

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

// ── Drip email sequence (free-sample recipients only) ─────────────────────────

export interface DripEmailOptions {
  toEmail:   string;
  childName: string;
  theme:     string;
}

/** Shared branded shell used by all drip emails. */
function buildDripShell(subject: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${subject}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#12122a;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(0,0,0,0.5);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a4e 0%,#2d1b69 100%);padding:28px 40px 20px;text-align:center;">
            <div style="font-size:40px;margin-bottom:6px;">✨</div>
            <div style="color:#a78bfa;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">DreamStick Adventures</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            ${bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="background:#0a0a1a;padding:20px 40px;text-align:center;border-top:1px solid #1e1e3f;">
            <p style="margin:0;color:#475569;font-size:12px;line-height:1.6;">
              You received this because you requested a free DreamStick adventure.<br>
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

function ctaButton(text: string, url: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:24px 0;">
    <tr>
      <td style="background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:10px;">
        <a href="${url}" target="_blank"
           style="display:inline-block;padding:16px 36px;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.5px;">
          ${text}
        </a>
      </td>
    </tr>
  </table>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 18px;color:#94a3b8;font-size:15px;line-height:1.7;">${text}</p>`;
}

function buildDrip1Html(opts: DripEmailOptions): string {
  return buildDripShell(
    `Did ${opts.childName} love their adventure? 🌟`,
    `<h1 style="margin:0 0 20px;color:#ffffff;font-size:24px;font-weight:800;line-height:1.2;">
      Did <span style="color:#f7e96b;">${opts.childName}</span> love their adventure? 🌟
    </h1>
    ${p(`A couple of days ago <strong style="color:#c4b5fd;">${opts.childName}</strong> went on a magical adventure.`)}
    ${p(`We hope they loved every moment of it — the golden glow, the magical world, and their trusty sidekick by their side.`)}
    ${p(`Imagine getting that same magic delivered to your inbox every single week.`)}
    ${p(`A new story. A new adventure.<br><strong style="color:#c4b5fd;">${opts.childName}</strong> as the hero every time.`)}
    ${p(`For less than a cup of coffee a week, you can keep the bedtime magic going.`)}
    ${ctaButton(`Keep the Adventure Going – $7/mo`, `${CHECKOUT_URL}?email=${encodeURIComponent(opts.toEmail)}`)}
    <p style="margin:0;color:#94a3b8;font-size:15px;line-height:1.7;">
      P.S. Keep an eye on your mailbox! 📦 Your mystery surprise is on its way to ${opts.childName} — it should arrive within the next 2-3 weeks. We think they're going to LOVE it! ⭐
    </p>`,
  );
}

function buildDrip2Html(opts: DripEmailOptions): string {
  return buildDripShell(
    `${opts.childName}'s next adventure is waiting 🗺️`,
    `<h1 style="margin:0 0 20px;color:#ffffff;font-size:24px;font-weight:800;line-height:1.2;">
      <span style="color:#f7e96b;">${opts.childName}</span>'s next adventure is waiting 🗺️
    </h1>
    ${p(`<strong style="color:#c4b5fd;">${opts.childName}</strong> has already proven they're a true hero.`)}
    ${p(`But every hero needs more adventures.`)}
    <p style="margin:0 0 6px;color:#94a3b8;font-size:15px;line-height:1.7;">This week they could explore:</p>
    <p style="margin:0 0 20px;color:#c4b5fd;font-size:15px;line-height:2.0;">
      🚀 The mysteries of outer space<br>
      🌊 The depths of the underwater kingdom<br>
      🦕 A prehistoric dinosaur world<br>
      👸 An enchanted princess realm<br>
      🦸 A superhero city<br>
      🌴 A magical jungle<br>
      🏴‍☠️ A pirate's treasure hunt<br>
      ✨ A magical wonderland
    </p>
    ${p(`A brand new personalized story every week starring <strong style="color:#c4b5fd;">${opts.childName}</strong>.`)}
    ${p(`Their name. Their adventure. Their golden hero moment.`)}
    ${ctaButton(`Start Weekly Adventures – $7/mo`, `${CHECKOUT_URL}?email=${encodeURIComponent(opts.toEmail)}`)}`,
  );
}

function buildDrip3Html(_opts: DripEmailOptions): string {
  return buildDripShell(
    `What parents are saying about DreamStick 💛`,
    `<h1 style="margin:0 0 20px;color:#ffffff;font-size:24px;font-weight:800;line-height:1.2;">
      What parents are saying about DreamStick 💛
    </h1>
    ${p(`We wanted to share what other parents are experiencing with DreamStick Adventures:`)}
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px;">
      <tr><td style="background:#1a1040;border-left:3px solid #f7e96b;border-radius:8px;padding:16px 20px;">
        <p style="margin:0 0 8px;color:#e2d9f3;font-size:15px;font-style:italic;line-height:1.6;">"My daughter asks for her DreamStick video every single night now. Bedtime has gone from a battle to the highlight of her day!"</p>
        <p style="margin:0;color:#a78bfa;font-size:13px;font-weight:700;">— Parent of Emma, age 6</p>
      </td></tr>
    </table>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 18px;">
      <tr><td style="background:#1a1040;border-left:3px solid #f7e96b;border-radius:8px;padding:16px 20px;">
        <p style="margin:0 0 8px;color:#e2d9f3;font-size:15px;font-style:italic;line-height:1.6;">"I never thought a bedtime video could make ME emotional. Seeing my son's name and watching him be the hero of his own story was truly magical."</p>
        <p style="margin:0;color:#a78bfa;font-size:13px;font-weight:700;">— Parent of Jake, age 8</p>
      </td></tr>
    </table>
    <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 24px;">
      <tr><td style="background:#1a1040;border-left:3px solid #f7e96b;border-radius:8px;padding:16px 20px;">
        <p style="margin:0 0 8px;color:#e2d9f3;font-size:15px;font-style:italic;line-height:1.6;">"Best $7 I spend every month. My twins both have their own characters and they love comparing their adventures!"</p>
        <p style="margin:0;color:#a78bfa;font-size:13px;font-weight:700;">— Parent of twins, age 5</p>
      </td></tr>
    </table>
    ${ctaButton(`Join DreamStick Adventures – $7/mo`, `${CHECKOUT_URL}?email=${encodeURIComponent(opts.toEmail)}`)}`,
  );
}

function buildDrip4Html(opts: DripEmailOptions): string {
  return buildDripShell(
    `One last thing about ${opts.childName}... 💛`,
    `<h1 style="margin:0 0 20px;color:#ffffff;font-size:24px;font-weight:800;line-height:1.2;">
      One last thing about <span style="color:#f7e96b;">${opts.childName}</span>... 💛
    </h1>
    ${p(`We just wanted to say something from the heart.`)}
    ${p(`Every child deserves to feel like the hero of their own story.`)}
    ${p(`Not just once.<br>Every single week.`)}
    ${p(`<strong style="color:#c4b5fd;">${opts.childName}</strong> had their first adventure. They proved they were brave, curious, and magical.`)}
    ${p(`That story doesn't have to end.`)}
    ${p(`For just $7 a month — less than a single trip to the movies — <strong style="color:#c4b5fd;">${opts.childName}</strong> gets a brand new personalized adventure delivered straight to your inbox every week.`)}
    ${p(`No screens to manage. No apps to download.<br>Just pure bedtime magic.`)}
    ${ctaButton(`Keep ${opts.childName}'s Story Going – $7/mo`, `${CHECKOUT_URL}?email=${encodeURIComponent(opts.toEmail)}`)}
    <p style="margin:0;color:#64748b;font-size:13px;line-height:1.6;">
      P.S. Plans start at just $7/mo and you can cancel anytime. No risk. Just magic.
    </p>`,
  );
}

const DRIP_CONFIGS = [
  { num: 1, dayThreshold: 2,  subject: (n: string) => `Did ${n} love their adventure? 🌟`,        builder: buildDrip1Html },
  { num: 2, dayThreshold: 5,  subject: (n: string) => `${n}'s next adventure is waiting 🗺️`,      builder: buildDrip2Html },
  { num: 3, dayThreshold: 10, subject: (_n: string) => `What parents are saying about DreamStick 💛`, builder: buildDrip3Html },
  { num: 4, dayThreshold: 14, subject: (n: string) => `One last thing about ${n}... 💛`,          builder: buildDrip4Html },
] as const;

/**
 * Send one drip email (1–4) to a free-sample recipient.
 * Non-fatal — logs and returns false on failure rather than throwing.
 */
export async function sendDripEmail(opts: DripEmailOptions, emailNumber: 1 | 2 | 3 | 4): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error('[email] SENDGRID_API_KEY not set — skipping drip email');
    return false;
  }
  const cfg   = DRIP_CONFIGS[emailNumber - 1];
  const html  = cfg.builder(opts);
  const body  = {
    personalizations: [{ to: [{ email: opts.toEmail }] }],
    from:     { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: { email: FROM_EMAIL, name: FROM_NAME },
    subject:  cfg.subject(opts.childName),
    content:  [{ type: 'text/html', value: html }],
  };
  try {
    const res = await fetch(SENDGRID_API, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (res.ok || res.status === 202) {
      console.log(`[email] Sent drip-${emailNumber} to ${opts.toEmail} (status ${res.status})`);
      return true;
    }
    const text = await res.text().catch(() => '');
    console.error(`[email] SendGrid drip-${emailNumber} ${res.status}: ${text.slice(0, 400)}`);
    return false;
  } catch (e: any) {
    console.error(`[email] drip-${emailNumber} fetch error:`, e.message);
    return false;
  }
}

// ── Welcome email ─────────────────────────────────────────────────────────────

export interface WelcomeEmailOptions {
  toEmail:   string;
  childName?: string;   // may be unknown at checkout time
  plan?:      string;
}

function buildWelcomeHtml(opts: WelcomeEmailOptions): string {
  const childLine = opts.childName
    ? `<strong style="color:#c4b5fd;">${opts.childName}</strong>`
    : 'your child';
  const FREE_URL  = 'https://app.dreamstickadventures.com/free';
  const UPGRADE_URL = 'https://app.dreamstickadventures.com/pricing';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Welcome to DreamStick Adventures!</title>
</head>
<body style="margin:0;padding:0;background:#07071a;font-family:'Segoe UI',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#07071a;padding:36px 16px 48px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;background:linear-gradient(160deg,#12122e 0%,#1a1042 100%);border-radius:20px;overflow:hidden;box-shadow:0 4px 48px rgba(0,0,0,0.6);border:1px solid rgba(167,139,250,0.2);">

  <!-- Shimmer bar -->
  <tr><td style="height:5px;background:linear-gradient(90deg,#7c3aed,#a855f7,#ec4899,#a855f7,#7c3aed);"></td></tr>

  <!-- Header -->
  <tr>
    <td style="background:linear-gradient(135deg,#1a1a4e 0%,#2d1b69 100%);padding:44px 40px 36px;text-align:center;">
      <div style="font-size:64px;margin-bottom:10px;">🌟</div>
      <div style="color:#a78bfa;font-size:11px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:14px;">DreamStick Adventures</div>
      <h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:900;line-height:1.2;">
        Welcome to the Adventure!
      </h1>
    </td>
  </tr>

  <!-- Body -->
  <tr>
    <td style="padding:40px 44px;">

      <p style="margin:0 0 20px;color:#94a3b8;font-size:16px;line-height:1.7;">
        You're officially part of the DreamStick family 🎉 Every week, ${childLine} will star in a brand-new personalized bedtime story — crafted just for them, delivered right to your inbox.
      </p>

      <!-- What to expect -->
      <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 28px;">
        <tr>
          <td style="background:rgba(255,255,255,0.04);border:1px solid rgba(167,139,250,0.15);border-radius:14px;padding:24px 28px;">
            <div style="color:#a78bfa;font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;margin-bottom:18px;">What to expect</div>

            <table cellpadding="0" cellspacing="0" width="100%">
              <tr>
                <td style="padding-bottom:16px;">
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="width:32px;height:32px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:50%;text-align:center;vertical-align:middle;font-size:13px;font-weight:800;color:#fff;">1</td>
                    <td style="padding-left:14px;">
                      <div style="color:#e2e8f0;font-size:15px;font-weight:700;margin-bottom:2px;">Set up your child's character</div>
                      <div style="color:#64748b;font-size:13px;line-height:1.5;">Tell us their name, age, and pick their magical sidekick — takes 2 minutes.</div>
                    </td>
                  </tr></table>
                </td>
              </tr>
              <tr>
                <td style="padding-bottom:16px;">
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="width:32px;height:32px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:50%;text-align:center;vertical-align:middle;font-size:13px;font-weight:800;color:#fff;">2</td>
                    <td style="padding-left:14px;">
                      <div style="color:#e2e8f0;font-size:15px;font-weight:700;margin-bottom:2px;">We craft their story</div>
                      <div style="color:#64748b;font-size:13px;line-height:1.5;">Our storytelling engine renders a unique adventure and emails you a private video link.</div>
                    </td>
                  </tr></table>
                </td>
              </tr>
              <tr>
                <td>
                  <table cellpadding="0" cellspacing="0"><tr>
                    <td style="width:32px;height:32px;background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:50%;text-align:center;vertical-align:middle;font-size:13px;font-weight:800;color:#fff;">3</td>
                    <td style="padding-left:14px;">
                      <div style="color:#e2e8f0;font-size:15px;font-weight:700;margin-bottom:2px;">New story every week</div>
                      <div style="color:#64748b;font-size:13px;line-height:1.5;">Fresh episodes every week — no repeats, always personalized to ${childLine}.</div>
                    </td>
                  </tr></table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>

      <!-- Primary CTA -->
      <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
        <tr>
          <td style="background:linear-gradient(135deg,#7c3aed,#a855f7);border-radius:12px;box-shadow:0 4px 20px rgba(124,58,237,0.45);">
            <a href="${FREE_URL}" target="_blank"
               style="display:inline-block;padding:18px 48px;color:#ffffff;font-size:17px;font-weight:800;text-decoration:none;letter-spacing:0.3px;">
              ✨&nbsp; Create ${opts.childName ? opts.childName + "'s" : "Your Child's"} Character
            </a>
          </td>
        </tr>
      </table>

      <!-- Upgrade info -->
      <table cellpadding="0" cellspacing="0" width="100%" style="margin:0 0 28px;">
        <tr>
          <td style="background:rgba(124,58,237,0.1);border:1px solid rgba(167,139,250,0.2);border-radius:12px;padding:20px 24px;">
            <div style="color:#c4b5fd;font-size:14px;font-weight:700;margin-bottom:6px;">Want even more magic? 🚀</div>
            <div style="color:#64748b;font-size:13px;line-height:1.6;margin-bottom:12px;">
              Upgrade to the <strong style="color:#94a3b8;">Family Plan</strong> to add multiple children and themes, or the <strong style="color:#94a3b8;">Nightly Plan</strong> for a fresh story every single night.
            </div>
            <a href="${UPGRADE_URL}" target="_blank"
               style="color:#a78bfa;font-size:13px;font-weight:700;text-decoration:none;">
              View all plans →
            </a>
          </td>
        </tr>
      </table>

      <!-- Support note -->
      <p style="margin:0;color:#475569;font-size:13px;line-height:1.7;text-align:center;">
        Questions? Just reply to this email — we're real people and we'd love to hear from you.<br>
        <a href="mailto:adventures@dreamstickadventures.com" style="color:#a78bfa;text-decoration:none;">adventures@dreamstickadventures.com</a>
      </p>

    </td>
  </tr>

  <!-- Footer -->
  <tr>
    <td style="background:#0a0a1a;padding:20px 40px;text-align:center;border-top:1px solid rgba(167,139,250,0.1);">
      <p style="margin:0;color:#334155;font-size:12px;line-height:1.6;">
        &copy; ${new Date().getFullYear()} DreamStick Adventures &mdash; adventures@dreamstickadventures.com<br>
        You're receiving this because you just subscribed. Welcome aboard!
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
 * Send the subscription welcome email via SendGrid.
 * Non-fatal — logs and returns false on failure rather than throwing.
 */
export async function sendWelcomeEmail(opts: WelcomeEmailOptions): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error('[email] SENDGRID_API_KEY not set — skipping welcome email');
    return false;
  }
  const body = {
    personalizations: [{ to: [{ email: opts.toEmail }] }],
    from:     { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: { email: FROM_EMAIL, name: FROM_NAME },
    subject:  'Welcome to DreamStick Adventures! 🌟',
    content:  [{ type: 'text/html', value: buildWelcomeHtml(opts) }],
  };
  try {
    const res = await fetch(SENDGRID_API, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    if (res.ok || res.status === 202) {
      console.log(`[email] Sent welcome email to ${opts.toEmail} (status ${res.status})`);
      return true;
    }
    const text = await res.text().catch(() => '');
    console.error(`[email] SendGrid welcome ${res.status}: ${text.slice(0, 400)}`);
    return false;
  } catch (e: any) {
    console.error('[email] welcome fetch error:', e.message);
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

// ── Shipping address owner notification ──────────────────────────────────────

const SHIPPING_NOTIFICATION_EMAIL = 'darinbeal@gmail.com';

export interface ShippingAddressNotificationOptions {
  toEmail: string;
  squishy_claimed: boolean;
  shipping_name: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string | null;
}

function escapeEmailHtml(value: string | null): string {
  if (!value) return '';
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildShippingAddressNotificationHtml(opts: ShippingAddressNotificationOptions): string {
  const locality = [
    opts.city,
    [opts.state, opts.postal_code].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ');
  const addressLines = [
    opts.address_line1,
    opts.address_line2,
    locality || null,
    opts.country,
  ].filter((line): line is string => Boolean(line));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>New DreamStick shipping address</title>
</head>
<body style="margin:0;padding:0;background:#0a0a1a;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a1a;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#12122a;border-radius:16px;overflow:hidden;">
        <tr>
          <td style="background:linear-gradient(135deg,#1a1a4e 0%,#2d1b69 100%);padding:28px 40px;text-align:center;">
            <div style="font-size:40px;margin-bottom:8px;">📦</div>
            <div style="color:#a78bfa;font-size:13px;font-weight:700;letter-spacing:3px;text-transform:uppercase;">DreamStick Adventures</div>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;color:#e2d9f3;">
            <h1 style="margin:0 0 22px;color:#ffffff;font-size:24px;">New shipping address submitted</h1>
            <p style="margin:0 0 22px;padding:12px 14px;border-radius:8px;background:${opts.squishy_claimed ? '#14532d' : '#3f3f46'};color:#ffffff;font-size:15px;font-weight:700;">${opts.squishy_claimed ? 'Squishy claim: CLAIMED' : 'Squishy claim: NO CLAIM'}</p>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Name</p>
            <p style="margin:0 0 22px;font-size:16px;">${escapeEmailHtml(opts.shipping_name) || 'Not provided'}</p>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Address</p>
            <p style="margin:0 0 22px;font-size:16px;line-height:1.7;">${addressLines.map(escapeEmailHtml).join('<br>') || 'Not provided'}</p>
            <p style="margin:0 0 8px;color:#94a3b8;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Email address</p>
            <p style="margin:0;font-size:16px;">${escapeEmailHtml(opts.toEmail)}</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Notify the owner whenever optional shipping details are stored.
 * Non-fatal — logs and returns false on failure rather than throwing.
 */
export async function sendShippingAddressNotification(
  opts: ShippingAddressNotificationOptions,
): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    console.error('[email] SENDGRID_API_KEY not set — skipping shipping address notification');
    return false;
  }

  const body = {
    personalizations: [{ to: [{ email: SHIPPING_NOTIFICATION_EMAIL }] }],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: { email: opts.toEmail },
    subject: '📦 New DreamStick shipping address submitted',
    content: [{ type: 'text/html', value: buildShippingAddressNotificationHtml(opts) }],
  };

  try {
    const response = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (response.ok || response.status === 202) {
      console.log(`[email] Sent shipping address notification (status ${response.status})`);
      return true;
    }

    const text = await response.text().catch(() => '');
    console.error(`[email] SendGrid shipping notification ${response.status}: ${text.slice(0, 400)}`);
    return false;
  } catch (e: any) {
    console.error('[email] shipping notification fetch error:', e.message);
    return false;
  }
}
