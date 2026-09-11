# Gribble on the official Playwright image: browsers are preinstalled, so CI can skip `gribble install`.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV CI=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN corepack enable && corepack prepare pnpm@11.24.0 --activate

WORKDIR /gribble
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build && \
    npm install -g ./packages/cli

WORKDIR /repo
ENTRYPOINT ["gribble"]
CMD ["--help"]
