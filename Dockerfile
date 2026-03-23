FROM node:20-slim

# Install build dependencies for native modules (swisseph)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json ./

RUN npm ci

# Copy the rest of the app
COPY . .

EXPOSE 3000

CMD ["node", "src/index.js"]
