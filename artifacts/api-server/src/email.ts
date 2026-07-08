/**
 * SendGrid email delivery for DreamStick Adventures.
 * Uses the SendGrid Web API directly (no SDK) with a dynamic template.
 */

const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send';
const FROM_EMAIL   = 'adventures@dreamstickadventures.com';
const FROM_NAME    = 'DreamStick Adventures';

export interface VideoEmailOptions {
  toEmail:   string;
  childName: string;
  theme:     string;
  watchUrl:  string;
}

/**
 * Send the "your video is ready" email via SendGrid dynamic template.
 * Non-fatal — logs and returns false on failure rather than throwing.
 */
export async function sendVideoReadyEmail(opts: VideoEmailOptions): Promise<boolean> {
  const apiKey    = process.env.SENDGRID_API_KEY;
  const templateId = process.env.SENDGRID_TEMPLATE_ID;

  if (!apiKey) {
    console.error('[email] SENDGRID_API_KEY is not set — skipping email');
    return false;
  }
  if (!templateId) {
    console.error('[email] SENDGRID_TEMPLATE_ID is not set — skipping email');
    return false;
  }

  const body = {
    personalizations: [
      {
        to: [{ email: opts.toEmail }],
        dynamic_template_data: {
          child_name: opts.childName,
          theme:      opts.theme,
          watch_url:  opts.watchUrl,
        },
      },
    ],
    from: { email: FROM_EMAIL, name: FROM_NAME },
    reply_to: { email: FROM_EMAIL, name: FROM_NAME },
    template_id: templateId,
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
