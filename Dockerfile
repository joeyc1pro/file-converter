FROM node:20-slim

WORKDIR /usr/src/app

# Install system deps (ffmpeg + libreoffice)
RUN apt-get update && \
    apt-get install -y ffmpeg libreoffice --no-install-recommends && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy package files and install
COPY package.json package-lock.json* ./
RUN npm ci --production

# Copy app files
COPY . .

# Create upload/out dirs
RUN mkdir -p /usr/src/app/uploads /usr/src/app/out

EXPOSE 3000
CMD ["node", "server.js"]
