# DreamStick Adventures — Pre-Launch System Audit
*Generated July 9, 2026*

---

## DATABASE

| Check | Result | Notes |
|---|---|---|
| Connect to database | ✅ PASS | Replit PostgreSQL — 3 records found |
| Insert new character | ⚠️ WARN | `child_age` NOT NULL — free-video form doesn't collect age; endpoint defaults it to null causing a schema violation. Works today only because the NOT NULL constraint isn't enforced at runtime, but this is fragile. |
| Query existing characters | ✅ PASS | Records returned correctly |
| All required columns present | ✅ PASS | All columns present including subscription_status, GCS fields |

---

## CHARACTER BUILDER (`/`)

| Check | Result | Notes |
|---|---|---|
| Page loads | ✅ PASS | HTTP 200 |
| Form fields save to DB | ✅ PASS | Full character insert confirmed |
| Character preview | ✅ PASS | Live preview via canvas |
| Success screen | ✅ PASS | Confirmed in prior session |

---

## FREE SAMPLE PAGE (`/free`)

| Check | Result | Notes |
|---|---|---|
| Page loads | ✅ PASS | HTTP 200 |
| Form submits | ✅ PASS | Returns job_id |
| Duplicate email blocked | ✅ PASS | Returns `already_claimed: true` |
| Pipeline triggered | ✅ PASS | Story → narration → render → email all fire |

---

## STRIPE PAYMENTS (`/pricing`)

| Check | Result | Notes |
|---|---|---|
| Pricing page loads | ✅ PASS | HTTP 200 — Dreamer $7/mo, Nightly $12/mo visible |
| Stripe price IDs in page | ❌ FAIL | No `price_*` IDs found in pricing.html — checkout button likely not wired to real Stripe price IDs |
| Checkout session creates | ❌ FAIL | Returns `"Unknown plan: undefined"` — plan→priceId mapping broken |
| Post-payment redirect | ❓ UNTESTED | Blocked by checkout session failure |

---

## CLAUDE STORY GENERATOR

| Check | Result | Notes |
|---|---|---|
| API connects | ✅ PASS | |
| 6-scene story generated | ✅ PASS | Confirmed every test run |
| Child's name in story | ✅ PASS | Name woven into narration |
| Last scene mood = sleepy | ✅ PASS | Verified in live API response |
| All 6 scenes with duration | ✅ PASS | |

---

## VIDEO RENDERER

| Check | Result | Notes |
|---|---|---|
| All 8 themes load | ✅ PASS | dinosaur, jungle, magic, pirate, princess, space, superhero, underwater |
| Boy character clips | ✅ PASS | 7 poses: run, curious, heroic, triumph, peaceful, yawning, asleep |
| Girl character clips | ✅ PASS | Same 7 poses present |
| FFmpeg colorkey (black bg) | ✅ PASS | colorkey filter, similarity=0.3 blend=0.1 |
| Character composited on bg | ✅ PASS | Screen blend mode, lanczos scale |
| Child's name displayed | ✅ PASS | drawText at top of frame |
| Story text displayed | ✅ PASS | Bottom text panel with narration |
| DreamStick watermark | ✅ PASS | "✦ DreamStick Adventures" drawn on frame |
| Sidekick emoji | ✅ PASS | OpenMoji font registered |
| Fade transitions | ✅ PASS | 30-frame (1s) fade to black between scenes |
| Background music at 25% | ❌ FAIL | No music mixing found in renderer — videos render with narration only, no background music track |
| Build scaling | ✅ PASS | Confirmed working across test renders |
| MP4 renders without error | ✅ PASS | Multiple successful renders (Kevin, Liam, Jane, Lucy) |

---

## ELEVENLABS NARRATION

| Check | Result | Notes |
|---|---|---|
| API key + Voice ID set | ✅ PASS | Both secrets configured |
| Narration for all 6 scenes | ✅ PASS | All scenes generated in parallel |
| Audio combined into one track | ✅ PASS | Single merged MP3 |
| Background music at 25% | ❌ FAIL | No bgm mixing — same issue as renderer above |
| Narration clearly audible | ✅ PASS | Confirmed via real playback |

---

## SENDGRID EMAIL DELIVERY

| Check | Result | Notes |
|---|---|---|
| API connects | ✅ PASS | HTTP 200 on profile endpoint |
| From domain verified | ✅ PASS | dreamstickadventures.com authenticated + SPF fixed |
| Email sends successfully | ✅ PASS | Confirmed — arrives in inbox |
| Video link works | ✅ PASS | GCS persistence added — link survives server restarts |
| Child's name in subject line | ✅ PASS | e.g. "Kevin's personalized bedtime story is ready! 🌙" |

---

## NIGHTLY SCHEDULER

| Check | Result | Notes |
|---|---|---|
| Scheduler at 7pm MT | ❌ FAIL | Not implemented |
| Queries active subscribers | ❌ FAIL | Not implemented |
| Processes each subscriber | ❌ FAIL | Not implemented |
| Logs errors without stopping | ❌ FAIL | Not implemented |
| Marks videos sent in DB | ❌ FAIL | Not implemented |

---

## SECURITY

| Check | Result | Notes |
|---|---|---|
| API keys in Secrets, not code | ✅ PASS | All keys via `process.env` only |
| Free sample: 1 per email | ✅ PASS | DB guard confirmed working |
| Rate limiting on endpoints | ❌ FAIL | No rate limiting — anyone can POST `/api/free-video` in a loop and run up API + compute costs |
| Subscriber emails protected | ✅ PASS | No public endpoint exposes email list |

---

## PERFORMANCE

| Metric | Result |
|---|---|
| Claude story generation | ~10s |
| ElevenLabs narration (6 scenes, parallel) | ~15s |
| Video render (6 scenes + ffmpeg merge) | ~90–120s |
| GCS upload (async, non-blocking) | ~5–10s after done |
| Email delivery after render completes | <2s |
| **Total: form submit → email in inbox** | **~2.5–3 minutes** |
| Memory / timeout issues | None observed |

---

## Launch Readiness Score: 62 / 100

---

## Top 3 Things to Fix Before Launch

**1. 🔴 Rate limiting on `/api/free-video` — CRITICAL (financial risk)**
Anyone can submit unlimited free video requests, burning ElevenLabs, Claude, and compute costs with no protection. A simple IP-based limiter (e.g. 1 request per IP per hour) must be in place before any public traffic hits this endpoint.

**2. 🔴 Nightly scheduler — not built yet (core product feature)**
This is the main value loop for paid subscribers. Without it, paying users receive no recurring videos. The scheduler needs to run at 7pm Mountain Time, query all active subscribers, render a personalized video for each, and email it — with error handling so one failure doesn't stop the batch.

**3. 🟡 Stripe checkout not wired to real price IDs (blocks monetization)**
The pricing page displays Dreamer ($7/mo) and Nightly ($12/mo) plans but contains no Stripe `price_*` IDs. The checkout endpoint returns "Unknown plan: undefined." Real Stripe price IDs need to be created in the Stripe dashboard and wired into the pricing page buttons before anyone can pay.

---

## Additional Issues Found (Lower Priority)

- **`child_age` NOT NULL constraint** — the free-video form doesn't collect age so the DB insert passes null, which violates the schema. Either make `child_age` nullable or default it to 5 in the endpoint.
- **No background music** — videos currently play with narration only. The renderer has no bgm track mixing. Adding ambient music at 25% volume under the narration would significantly improve the product experience.
- **Dynamic SendGrid template unused** — the original template (`d-4551ce...`) was bypassed because it was never published/active. The current HTML email works well but the template ID env var is now unused dead config.
- **Watch URLs use dev domain** — video links in emails point to the `.replit.dev` development domain. After deploying to production, set the `WATCH_DOMAIN` environment variable to `dreamstickadventures.com` so links in emails use the production URL.
