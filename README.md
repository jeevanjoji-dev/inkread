# InkRead — Deployment Guide

## Project structure
```
inkread/
├── public/
│   ├── index.html    ← page structure
│   ├── style.css      ← all styling
│   └── app.js          ← frontend logic
├── api/
│   └── gemini.js       ← secure backend (Gemini key lives ONLY here)
├── vercel.json
└── .env.example
```

Your Gemini API key is now **never sent to the browser**. The frontend calls
`/api/gemini`, which runs on Vercel's server, attaches your secret key, calls
Google, and sends back only the answer. Anyone viewing your page source will
never see the key.

---

## Step 1 — Deploy to Vercel

1. Push this folder to a GitHub repo (or drag-and-drop deploy on vercel.com)
2. On vercel.com → **Add New Project** → import the repo
3. Before deploying, go to **Environment Variables** and add:
   - Key: `GEMINI_API_KEY`
   - Value: your real Gemini key (the one from aistudio.google.com)
4. Deploy

Once deployed, Vercel gives you a URL like `https://inkread.vercel.app`.

---

## Step 2 — Set up Supabase Auth (Email + Google + GitHub)

### A. Get your real Supabase credentials
1. Go to supabase.com → your project → **Project Settings → API**
2. Copy the **Project URL** and **anon/public key**
3. Open `public/app.js`, find these two lines near the top, and replace them:
   ```js
   const SBURL = 'https://YOUR-PROJECT-REF.supabase.co';
   const SBKEY = 'YOUR-ANON-PUBLIC-KEY';
   ```

### B. Enable Email login
1. Supabase dashboard → **Authentication → Providers → Email**
2. Make sure it's toggled ON (it usually is by default)

### C. Enable Google login
1. Go to [Google Cloud Console](https://console.cloud.google.com) → create a project (if you don't have one)
2. **APIs & Services → Credentials → Create Credentials → OAuth Client ID**
   - Application type: **Web application**
   - Authorized redirect URI: copy this from Supabase (see next step) and paste it here
3. In Supabase: **Authentication → Providers → Google** → toggle ON
   - Paste your Google **Client ID** and **Client Secret**
   - Supabase shows you the exact **Redirect URL** to put in Google Cloud Console — copy it there

### D. Enable GitHub login
1. Go to GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Homepage URL: your Vercel URL (e.g. `https://inkread.vercel.app`)
   - Authorization callback URL: copy this from Supabase (same place as Google)
2. In Supabase: **Authentication → Providers → GitHub** → toggle ON
   - Paste your GitHub **Client ID** and **Client Secret**

### E. Set your Site URL
In Supabase → **Authentication → URL Configuration**:
- Site URL: your Vercel URL (e.g. `https://inkread.vercel.app`)
- Redirect URLs: add the same URL here too

---

## Step 3 — Test it

1. Visit your Vercel URL
2. Try Email signup — should work immediately, no extra setup needed
3. Try Google/GitHub buttons — only works once steps C/D above are done
4. Scan a note — this now goes through your secure backend, so the Gemini key stays hidden

---

## Local development (optional)

```bash
npm install -g vercel
cd inkread
vercel dev
```

This runs the project locally including the `/api/gemini` serverless function,
reading your key from `.env.local` (copy `.env.example` to `.env.local` and fill it in).

---

## Notes

- Guest mode still works with zero setup — good for quick testing
- If Google/GitHub aren't configured yet, Email signup still works fine
- The Gemini model used is `gemini-2.5-flash` (fast + supports images)
