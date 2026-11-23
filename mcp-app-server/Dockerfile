# Builds the Node.js entry (src/index.js) of the MCP App server.
#
# Build from the REPOSITORY ROOT, not from this directory: at startup the
# server reads the shared references and the shape index from the sibling
# ../shared and ../shape-search directories.
#
#   docker build -f mcp-app-server/Dockerfile -t drawio-mcp-app .
#   docker run --rm -p 127.0.0.1:3001:3001 drawio-mcp-app
#
# The endpoint is then http://localhost:3001/mcp (PORT overrides the port).
# Keep the 127.0.0.1: a plain -p 3001:3001 publishes the port on every
# interface of the host, past ufw and firewalld. AUTH_TOKEN or
# AUTH_TOKEN_FILE require a bearer token (README, "Security").
#
# Published to Docker Hub as jgraph/drawio-mcp (linux/amd64 + linux/arm64) by
# .github/workflows/publish-app-server-image.yml.

FROM node:24-alpine

ENV NODE_ENV=production
# Listen on all interfaces inside the container (the server defaults to
# loopback); which host interface is exposed is decided by `docker run -p`.
# The server can't see that mapping, so it warns at startup without a token.
ENV LISTEN=0.0.0.0
WORKDIR /app/mcp-app-server

# Dependencies first so they cache independently of source edits. wrangler is
# a devDependency (Workers deploys only) and is left out.
COPY mcp-app-server/package.json mcp-app-server/package-lock.json ./
RUN npm ci --omit=dev

# What src/index.js reads at startup, laid out as in the repository.
COPY shared /app/shared
COPY shape-search/search-index.json /app/shape-search/search-index.json
COPY mcp-app-server/src ./src
COPY mcp-app-server/favicon.png ./

USER node
EXPOSE 3001
CMD ["node", "src/index.js"]
