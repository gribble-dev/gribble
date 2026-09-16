# Gribble on the official Playwright image: browsers are preinstalled, so CI can skip `gribble install`.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV CI=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

WORKDIR /gribble
COPY . .
# `gribble` declares the AI review runtime as optional peer dependencies, so a plain install gets
# the deterministic gate only. This image is meant to run every mode, so the peers go in
# explicitly, at the exact version the build pinned (core exports it; the pnpm catalog sets it).
RUN pnpm install --frozen-lockfile && pnpm build && \
    npm install -g ./packages/cli && \
    PI_VERSION="$(node -e 'import("/gribble/packages/core/dist/index.js").then((m) => console.log(m.PI_RUNTIME_VERSION))')" && \
    npm install -g "@earendil-works/pi-ai@${PI_VERSION}" "@earendil-works/pi-coding-agent@${PI_VERSION}"

WORKDIR /repo
ENTRYPOINT ["gribble"]
CMD ["--help"]
