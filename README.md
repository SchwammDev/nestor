# nestor

Personal-agent core: an always-on daemon on the pi-agent-core substrate. Channel frontends (Signal, the pi-card voice box) connect as thin WebSocket clients; tools, memory, and proactivity live here. Named after the butler of Moulinsart.

Roadmap: [docs/roadmap.md](docs/roadmap.md). Planning: [milestones](https://github.com/SchwammDev/nestor/milestones).

## Protocol

JSON text frames over WebSocket. First frame must be `hello`; everything else follows auth.

| Direction | Frame | Semantics |
|---|---|---|
| client → core | `{type:"hello", token, channel}` | Mandatory first frame. Success → `ready`. Failure or 10 s silence → close 4401. |
| client → core | `{type:"prompt", text}` | Run a turn on the channel's agent. Mid-turn → `error busy`, socket stays open, no queue. |
| client → core | `{type:"cancel"}` | Reserved for barge-in; currently `error unknown_type`. |
| core → client | `{type:"ready"}` | Attached to channel. |
| core → client | `{type:"delta", text}` | One text delta, forwarded immediately. |
| core → client | `{type:"done"}` | Turn finished. |
| core → client | `{type:"error", code, message}` | Codes: `auth_failed`, `busy`, `invalid_json`, `unknown_type`, `provider_error`. Only `auth_failed` closes the socket. |
| core → client | `{type:"announcement", text}` | Reserved; never emitted yet. |

Close codes: 4401 unauthorized, 4000 superseded (a newer connection took over the channel — newest wins).

Agents are keyed by channel id: reconnecting re-attaches to the existing agent and its history. History is in-memory; a daemon restart wipes it.

## Config

`/etc/nestor/config.yaml` (override path with `NESTOR_CONFIG`), mode 600:

```yaml
port: 8790                  # default 8790
auth_token: "<long random>" # required; what clients present in hello
system_prompt: "..."        # optional
provider:                   # any OpenAI-compatible gateway; wiring is tuned for Qwen-on-vLLM (Aqueduct)
  base_url: https://aqueduct.example.com  # required
  api_key: "<key>"                        # required
  model: qwen-3.6-35b                     # required
```

## Development

Node 22 via [mise](https://mise.jdx.dev) (`mise.toml` pins it). `npm ci`, then:

```sh
./run-tests.sh        # node --test suite + tsc type gate (+ coverage snapshot)
npm run dev           # run the daemon from source
```

Smoke client (throwaway; the Signal adapter is the first real client):

```sh
NESTOR_TOKEN=<token> node scripts/smoke-client.mjs wss://host/path <channel> "prompt text"
```

## Deploy (Docker, behind nginx)

The daemon binds plain WS; the host's nginx terminates TLS and proxies the upgrade. Compose publishes on 127.0.0.1 only.

The container runs as a dedicated unprivileged host user that owns the config and nothing else, with all capabilities dropped and a read-only root filesystem. Its numeric uid/gid come from `.env` (see `.env.example`) — the image's built-in `node` user is deliberately not relied upon, since a bind mount matches by number and uid 1000 is whatever the host happens to assign it.

```sh
# on the server, as a sudo-capable user — do not join the docker group
sudo useradd --system --no-create-home --shell /usr/sbin/nologin nestor

sudo install -d -m 755 /etc/nestor
sudo install -m 600 -o nestor -g nestor config.yaml /etc/nestor/config.yaml   # see Config above

printf 'NESTOR_UID=%s\nNESTOR_GID=%s\n' "$(id -u nestor)" "$(id -g nestor)" > .env

sudo docker compose up -d --build
wget -qO- http://127.0.0.1:8790/healthz                                       # → ok
```

nginx location (inside an existing TLS-terminated `server` block):

```nginx
location /nestor {
    proxy_pass http://127.0.0.1:8790;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 600s;
}
```

End-to-end check from any machine:

```sh
NESTOR_TOKEN=<token> node scripts/smoke-client.mjs wss://<host>/nestor smoke "Say hi."
```
