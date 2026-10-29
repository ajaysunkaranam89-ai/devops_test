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
RUN apk upgrade --no-cache
# npm/yarn are only needed to install dependencies; removing them keeps their bundled (CVE-prone)
# packages out of the runtime image. The app starts with plain `node`.
RUN npm ci --omit=dev \
 && rm -rf /usr/local/lib/node_modules /usr/local/bin/npm /usr/local/bin/npx \
           /usr/local/bin/yarn /usr/local/bin/yarnpkg /opt/yarn-* /root/.npm
COPY src ./src
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
# Don't run as root
USER node
CMD ["node", "src/server.js"]
