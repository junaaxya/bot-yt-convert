FROM node:20-slim

# 1. Instal dependensi sistem & pastikan yt-dlp versi terbaru dari pip
# yt-dlp dari apt-get seringkali sudah usang dan menyebabkan error YouTube
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    python-is-python3 \
    curl \
    git \
    && python3 -m pip install --break-system-packages -U yt-dlp \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Demucs untuk AI vocal separation
# Catatan: Ini akan menambah ~1-2GB ukuran image
RUN python3 -m pip install --break-system-packages demucs

WORKDIR /app

# 3. Salin package.json
COPY package.json ./

# 4. Instal dependensi produksi + instal paksa link-preview-js yang hilang
RUN npm install --production && npm install link-preview-js

# Salin kode sumber bot
COPY . .

# Pastikan folder auth tersedia
RUN mkdir -p auth

# 5. Set Environment Variable agar library tahu di mana FFmpeg berada
ENV FFMPEG_PATH=/usr/bin/ffmpeg

CMD ["node", "src/index.js"]
