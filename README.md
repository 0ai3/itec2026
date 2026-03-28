This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

1) Copy environment variables:

```bash
cp .env
```

2) Fill Firebase keys in `.env.`

3) Run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Authentication features

Implemented flows:

- Email/password register and login
- Google sign-in/register
- Email verification as second step before editor access
- Password reset by email
- Profile page with username update and profile picture upload

Firebase console setup required:

1. Enable **Authentication > Email/Password** provider.
2. Enable **Authentication > Google** provider.
3. Add your local auth domain (usually `localhost`) to authorized domains.
4. Ensure **Storage** is enabled for profile picture upload.

## Collaborative editor (Yjs + WebSocket)

Run both Next.js and the Yjs WebSocket backend together:

```bash
npm run dev:collab
```

Then open [http://localhost:3000](http://localhost:3000) in multiple tabs or browsers to edit the same Monaco document in real time.

By default, the editor connects to `ws://localhost:1234` and uses room `monaco-room`.

### Run over LAN (other computer in same network)

1. Find your host machine IP (example on macOS):

```bash
ipconfig getifaddr en0
```

2. Set WebSocket URL to your host IP:

```bash
NEXT_PUBLIC_YJS_WS_URL=ws://<YOUR_HOST_IP>:1234
```

3. Run app + collab server bound to network:

```bash
npm run dev:collab:lan
```

Or use automatic local IP detection on macOS:

```bash
npm run dev:collab:lan:autoip
```

The script now validates detected IP and prints it before startup. If detection fails, it stops with a clear error so you can set `NEXT_PUBLIC_YJS_WS_URL` manually.
It detects the IP from the active default-route interface first, then falls back to `en0`/`en1`.
Implementation note: this command runs `scripts/dev-collab-lan-autoip.sh`.

4. Open from another computer:

```bash
http://<YOUR_HOST_IP>:3000
```

## AI code completions (Groq)

The Monaco editor includes inline AI completions powered by Groq via a server route (`/api/ai-complete`).

Setup:

1. Add these values to `.env.local`:

```bash
GROQ_API_KEY=your_groq_api_key
GROQ_MODEL=llama-3.3-70b-versatile
```

2. Restart the dev server.

Notes:

- The API key stays server-side only.
- Completions are generated from editor context around the cursor.
- Inline suggestions appear as ghost text in Monaco and can be accepted with `Tab`.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
