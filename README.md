# livecoder

Mobile-first local workspace UI for browsing files, reading/editing code, and chatting with Pi through ACP.

## Run

```bash
bun install
bun run dev
```

Open `http://localhost:5173`. The API runs on `3001` and the Vite proxy forwards `/api` requests.

For a production-style local run:

```bash
bun run build
bun run start
```

Then open `http://localhost:3001`.

## Pi ACP

The API starts one `pi-acp` process per workspace on the first chat message. `pi-acp` is included as a dependency and uses the locally installed `pi` command. Configure Pi and its model provider on the machine running the API first (for example, `npm install -g @earendil-works/pi-coding-agent`).

To use another adapter executable:

```bash
PI_ACP_COMMAND=/path/to/adapter PI_ACP_ARGS='["--flag"]' bun run dev:api
```

No login or application authentication is included by design.
