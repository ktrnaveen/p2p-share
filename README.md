# P2P Share (ToffeeShare-style)

A fast, browser-based, 1:1 peer-to-peer file transfer app built with Next.js + WebRTC.

## Core Privacy Model

- File bytes are transferred directly peer-to-peer over WebRTC DataChannel.
- Server is used only for signaling (offer/answer/ICE exchange).
- No file storage backend is used.
- Ably root key stays server-side only via token auth (`/api/ably-token`).

## Features (v1)

- 1 sender -> 1 receiver
- Share-link flow
- STUN + optional TURN fallback
- Upload and download progress bars
- Chunked transfer with DataChannel backpressure handling
- Direct-to-disk receiving on supported browsers (fallback to memory mode)

## Tech Stack

- Next.js (App Router)
- React + TypeScript
- Ably Realtime (signaling only)
- WebRTC DataChannel (file transfer)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Copy environment file:

```bash
cp .env.example .env.local
```

3. Set env vars:

- `ABLY_API_KEY`: Ably root key (server-side only)
- `NEXT_PUBLIC_TURN_URL`: Optional TURN URL (for difficult NAT networks)
- `NEXT_PUBLIC_TURN_USERNAME`: TURN username
- `NEXT_PUBLIC_TURN_CREDENTIAL`: TURN credential

4. Run dev server:

```bash
npm run dev
```

5. Open `http://localhost:3000`.

## How to Use

1. Sender chooses **Sender** mode and clicks **Create Share Link**.
2. Sender copies the generated link and shares it.
3. Receiver opens the link and clicks **Join Room**.
   - For very large files on Chromium browsers, click **Prepare Save Location** first.
4. Sender selects file and clicks **Send File**.
5. Receiver gets progress and downloads when complete.

## Deploy on Vercel

1. Push this repo to GitHub.
2. Import project in Vercel.
3. Add environment variables from `.env.example` in Vercel Project Settings.
4. Deploy.

## Vercel Limitations (Important)

- Vercel Functions are not suitable as a native WebSocket signaling server.
- This app avoids that by using Ably for realtime signaling.
- Actual file transfer is peer-to-peer and does not rely on Vercel bandwidth for file bytes.

## Security Notes

- Do not expose Ably root key in `NEXT_PUBLIC_*` variables.
- Set only `ABLY_API_KEY` in Vercel/environment settings.
- Clients receive short-lived scoped Ably tokens from `/api/ably-token`.
- If a key leaks, rotate/revoke it in Ably dashboard immediately.

## Notes on "Practically Unlimited" File Size

- Sender side uses chunked streaming (does not read entire file at once).
- Receiver can stream directly to disk on supported browsers after preparing save location.
- Unsupported browsers automatically use memory-buffer fallback before final download.
- Very large files are still constrained by browser/device memory and network stability.

For true large-file robustness, next step is writing chunks directly to disk (File System Access API) where supported.

## Suggested Next Steps

- Add transfer resume using chunk map and reconnect protocol
- Add password-protected rooms
- Add receiver-side disk streaming path for huge files
- Add E2E metadata encryption with URL fragment key

## Disclaimer

TURN servers relay encrypted traffic but do not store files. If privacy policies are strict, host your own TURN (coturn) and keep minimal logs.
