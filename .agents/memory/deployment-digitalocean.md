---
name: DigitalOcean deployment
description: How DreamStick is deployed — DigitalOcean only, never Railway or Replit publish.
---

# DigitalOcean Deployment

**Why:** Project migrated off Railway and Replit deployments. Live server is a DigitalOcean Droplet.

## Rule
Never suggest "Deploy to Railway", "click Publish", or any Replit deploy action.
Always end deployment guidance with: **"Pull and restart on DigitalOcean"**

## Server details
- IP: 24.199.104.222
- App dir: `/app`
- Process manager: pm2, process name `dreamstick`
- Live URL: https://app.dreamstickadventures.com

## Deploy command (run via SSH)
```bash
cd /app && git pull origin main && \
pnpm --filter @workspace/api-server run build && \
cd /app/artifacts/api-server && \
export $(cat .env | xargs) && \
pm2 restart dreamstick --update-env
```

## Code flow
Replit (edit) → GitHub (push) → DigitalOcean (pull + rebuild + pm2 restart)

**How to apply:** Any time you finish a code change and would normally say "deploy" or "publish", say "Pull and restart on DigitalOcean" and include the command above if helpful.
