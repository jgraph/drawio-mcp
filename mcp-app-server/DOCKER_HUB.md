# draw.io MCP server

The official [draw.io](https://www.draw.io) MCP server. It gives LLMs four tools: `create_diagram` renders draw.io XML or Mermaid as an interactive diagram inline in chat on MCP Apps hosts (Claude.ai, ChatGPT, VS Code, Cursor and others), with an "Open in draw.io" button, `search_shapes` finds shapes across the draw.io libraries (AWS, Azure, GCP, Cisco, Kubernetes, P&ID, electrical, BPMN and more), `get_drawio_reference` returns the diagram syntax reference the model reads before its first diagram, and `create_semantic_diagram` is the fast mode for flowcharts and swimlane diagrams, which the model uses only when the user asks for a quick or cheap diagram (`DRAWIO_SEMANTIC_TYPES=off` leaves it out, see below).

This image runs the same server that is hosted at `https://mcp.draw.io/mcp`. Use it when you want to self-host, for example to keep diagram data inside your own network.

## Usage

```bash
docker run --rm -p 127.0.0.1:3001:3001 jgraph/drawio-mcp
```

The MCP endpoint is then `http://localhost:3001/mcp` (Streamable HTTP). Add it as a remote MCP server in your host. Keep the `127.0.0.1:` in `-p`: a plain `-p 3001:3001` publishes the port on every interface of the host, and Docker's port rules bypass ufw and firewalld, so the firewall doesn't stop it.

On a machine you share with other users, agents or scripts, require a token as well (loopback keeps the server off the network, not off the machine):

```bash
export DRAWIO_MCP_TOKEN="$(openssl rand -hex 32)"
AUTH_TOKEN="$DRAWIO_MCP_TOKEN" docker run --rm --pull always -e AUTH_TOKEN -p 127.0.0.1:3001:3001 jgraph/drawio-mcp
```

`--pull always` fetches the current image: an image from before authentication, still cached from an earlier run, would ignore `AUTH_TOKEN` and answer without a token. Check that the token is required: the `Authentication:` line of the startup output says `on`, and a request without the token gets `401`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3001/mcp   # 401
```

Clients then send `Authorization: Bearer <token>`. Give them the token from the environment, not as a command-line argument, which other users of the machine can read: in Claude Code, `"headers": { "Authorization": "Bearer ${DRAWIO_MCP_TOKEN}" }` in the server's entry in the project's `.mcp.json`, which it fills in when it connects ([other clients](https://github.com/jgraph/drawio-mcp/tree/main/mcp-app-server#security)). As a Compose secret:

```yaml
services:
  drawio-mcp:
    image: jgraph/drawio-mcp
    pull_policy: always   # an image from before authentication would ignore the token
    ports:
      - "127.0.0.1:3001:3001"
    environment:
      AUTH_TOKEN_FILE: /run/secrets/drawio_mcp_token
    secrets:
      - drawio_mcp_token

secrets:
  drawio_mcp_token:
    file: ./drawio-mcp-token   # the token alone, readable by the container's user node (uid 1000)
```

At startup the container prints its bind address, whether authentication is on and the hosts and origins it answers, and warns when no token is set.

| Environment variable | Effect |
|---|---|
| `PORT` | Listening port inside the container (default `3001`); map it with `-p` |
| `AUTH_TOKEN` | Bearer token that `/mcp` requires (`Authorization: Bearer <token>`); others get `401`. Compared in constant time, never logged; `/health` stays open. Unset: no authentication |
| `AUTH_TOKEN_FILE` | Path of a file holding the token, e.g. a secret at `/run/secrets/drawio_mcp_token` (keeps it out of `docker inspect`). Use one of the two |
| `ALLOWED_HOSTS` | Comma-separated hostnames the server answers to (checked against the `Host` header), e.g. `drawio-mcp.internal,localhost`. Unset: any. A value that names no hostname stops the container at startup |
| `ALLOWED_ORIGINS` | Comma-separated browser origins the server answers (checked against the `Origin` header, against DNS rebinding), e.g. `https://chat.example.com`; `*` for any. Unset: `http(s)://localhost`, `127.0.0.1` and `[::1]` on any port. Requests without an `Origin` (MCP clients outside a browser) always pass. Pages from an allowed origin get CORS headers, and their preflight is answered before the token check |
| `DRAWIO_BASE_URL` | The draw.io editor that "Open in draw.io" opens, e.g. a self-hosted `https://drawio.example.com/` (default `https://app.diagrams.net/`) |
| `DRAWIO_ICON_SERVICE_URL` | Set to `off` to keep `search_shapes` from querying the draw.io icon service |
| `DRAWIO_SEMANTIC_TYPES` | Set to `off` to leave out `create_semantic_diagram`, which is listed by default and used when the user asks for a quick diagram: the model describes a flowchart or swimlane diagram (steps, lanes, transitions, a row and a column per step) and the server lays it out. Flowcharts without lanes are drawn with up to 24 steps; the model draws larger ones with `create_diagram` ([details](https://github.com/jgraph/drawio-mcp/tree/main/mcp-app-server#tool-create_semantic_diagram-on-request)) |

Hosts that need a public URL (such as Claude.ai or ChatGPT) can reach a local container through a tunnel, for example `npx cloudflared tunnel --url http://localhost:3001`, and use the tunnel URL with `/mcp` appended. Anyone who has that URL can use the server.

## Deployment boundary

- **Network exposure.** `-p 127.0.0.1:3001:3001` makes the server reachable from this machine only. `-p 3001:3001` publishes it on every interface of the Docker host, so everyone on your network can reach it, and Docker inserts its own packet filter rules ahead of ufw and firewalld, so the host firewall doesn't block it.
- **Authentication.** Off unless you set `AUTH_TOKEN` or `AUTH_TOKEN_FILE`. Loopback is no auth boundary on a shared machine: every user and process on it can call the port, so set a token there. A process running as your own user can still read the token from your MCP client's configuration; the token keeps out other users, the network and callers that don't have it. If teammates should reach the server, also put it behind a reverse proxy that terminates TLS and authenticates them, and set `ALLOWED_HOSTS` to the hostname they use.
- **DNS rebinding.** Requests that carry an `Origin` header are answered only from the origins in `ALLOWED_ORIGINS` (by default loopback), as the MCP Streamable HTTP transport requires, so a web page that points its name at `127.0.0.1` can't call the server from your browser. `ALLOWED_HOSTS` stops it as well.
- **Storage.** Nothing is stored. The server is stateless, needs no volume, and does not write diagram content to its logs (only request metadata: method, status, timing). Diagrams live in the chat and in the draw.io files you save.
- **Outbound access from the container.** None is needed for diagrams. Diagram content is never sent anywhere. The shape library is built into the image. The only outbound requests are:
  - `icons.diagrams.net` for `search_shapes`, when the built-in library has no strong match; carries only the search terms. `DRAWIO_ICON_SERVICE_URL=off` disables it.
  - `viewer.diagrams.net`, a version check for the edge-routing code at startup and once a day. It carries no data and times out after 5 seconds, so it is harmless to block.
- **Outbound access from the user's browser.** The inline diagram viewer in the chat loads:
  - the draw.io viewer code from `viewer.diagrams.net`
  - shape images from `app.diagrams.net`, and icons from `icons.diagrams.net`, for diagrams that use them
  - web fonts from `fonts.googleapis.com` and `fonts.gstatic.com`, for diagrams that use them

  These requests fetch code, images and fonts only, never diagram content. "Open in draw.io" opens the diagram in the draw.io editor at `app.diagrams.net`, or at your own draw.io with `DRAWIO_BASE_URL`; the diagram travels in the part of the link after `#`, which the browser keeps to itself and never sends to the server.

## Tags

- `latest` — the current release
- `1.0.3`, … — one tag per server version

Images are built for `linux/amd64` and `linux/arm64`.

## Links

- [Source and documentation](https://github.com/jgraph/drawio-mcp/tree/main/mcp-app-server) (Apache-2.0)
- [Dockerfile](https://github.com/jgraph/drawio-mcp/blob/main/mcp-app-server/Dockerfile)
- [Data residency and offline use](https://github.com/jgraph/drawio-mcp#data-residency--offline-use)
- [Issues](https://github.com/jgraph/drawio-mcp/issues)
