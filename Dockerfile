FROM node:22-slim
# ffmpeg compresses every upload into 720p + 360p renditions; 7-Zip unpacks zip/7z/rar/tar/gz archives
RUN apt-get update && (apt-get install -y --no-install-recommends ffmpeg ca-certificates 7zip || apt-get install -y --no-install-recommends ffmpeg ca-certificates p7zip-full p7zip-rar) && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "server.js"]
