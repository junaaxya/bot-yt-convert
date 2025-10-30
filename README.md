## README.md

```md
# Baileys WhatsApp Bot – MP4↔MP3 & YouTube DL

A small, production-ready Node.js bot using **@whiskeysockets/baileys**, **ffmpeg-static**, and **ytdl-core**. Works locally and on small Node hosts like Pylex Nodes.

## Features
- Convert **MP4 → MP3** and **MP3 → MP4** (static black background video)
- **YouTube → MP3** and **YouTube → MP4** downloader
- Terminal QR login (no web UI needed)
- Queue with configurable concurrency to prevent OOM
- File size and duration limits

## Commands
```
.help / .menu               Show help
.ytmp3 <url>                Download YouTube as MP3
.ytmp4 <url>                Download YouTube as MP4
.to_mp3 (reply to a video)  Convert MP4→MP3
.to_mp4 (reply to an audio) Convert MP3→MP4
```

## Install & Run (Local)
```bash
# 1) Clone and install
npm ci --omit=dev

# 2) Configure
cp .env.example .env
# edit values if needed

# 3) Run
npm start
# Scan QR from terminal