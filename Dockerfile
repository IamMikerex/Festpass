# FestPass web image: the built React app + the Express API (one process, one port).
# Build: docker build -t festpass-web .

# 1) Build the React client
FROM node:20-alpine AS client
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
# Set to "false" to use only the generated poster art (no images from Unsplash)
ARG VITE_REMOTE_PHOTOS=true
ENV VITE_REMOTE_PHOTOS=$VITE_REMOTE_PHOTOS
RUN npm run build

# 2) Install the API's production dependencies
FROM node:20-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# 3) Runtime
FROM node:20-alpine
ENV NODE_ENV=production PORT=4000
WORKDIR /app
COPY --from=server-deps /app/server/node_modules server/node_modules
COPY server/ server/
COPY database/ database/
COPY --from=client /app/client/dist client/dist
USER node
WORKDIR /app/server
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/health >/dev/null || exit 1
CMD ["node", "src/index.js"]
