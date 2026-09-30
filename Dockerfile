# ---- base: shared layer with package files ----
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

# ---- test: install all deps and run unit tests (used by Jenkins: --target test) ----
FROM base AS test
RUN npm ci
COPY . .
RUN npm test

# ---- prod: small runtime image with only production deps ----
FROM base AS prod
RUN npm ci --omit=dev
COPY src ./src
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# Don't run as root
USER node
CMD ["node", "src/server.js"]
