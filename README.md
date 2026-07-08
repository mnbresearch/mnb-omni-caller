# MNB Research — Voice AI Dashboard

A white-labeled dashboard for your client, powered by the OmniDim API behind the scenes. The client only ever sees the **MNB Research** brand — the API key stays on the server and every OmniDim/OmniDimension mention in API responses is rewritten to MNB Research before display.

## What the client can do

- **Overview** — call volume per day, outcomes, sentiment, channel charts, recent calls
- **Place a Call** — pick an agent, enter a number (+countrycode), optional call context fields, dispatch
- **Agent Studio** — edit the agent's name, welcome message, and all training sections (conversation instructions); saves apply to the very next call
- **Call Logs** — paginated history with filters, click any call for full transcript, summary, sentiment, and recording playback
- **Knowledge Base** — upload PDFs, attach/detach them to the agent with "when to use" instructions
- **Campaigns** — bulk-call campaign list

## Run it

```bash
cd mnb-research-dashboard
npm install
npm start
# → http://localhost:3000
```

Requires Node 18+.

## Configuration (.env)

| Variable | Purpose |
|---|---|
| `OMNIDIM_API_KEY` | Your OmniDim API key (server-side only) |
| `OMNIDIM_API_BASE` | Leave as `https://backend.omnidim.io/api/v1` |
| `DASHBOARD_PASSWORD` | **Set this before giving the client the URL** — enables a login screen |
| `PORT` | Default 3000 |
| `BRAND_NAME` | Shown in the UI (default: MNB Research) |

## Give it to the client

1. **Rotate the API key** in the OmniDim dashboard and put the new one in `.env` (the old key was shared in chat).
2. Set `DASHBOARD_PASSWORD` so only the client can access it.
3. Deploy anywhere Node runs — Railway, Render, Fly.io, or a small VPS:
   - Railway/Render: point at this folder, set env vars from `.env`, start command `npm start`.
4. Optionally put it on a branded domain, e.g. `voice.mnbresearch.com`.

## Notes

- The trained voice model, flows, and knowledge stay on OmniDim — this dashboard drives the same agent, so no retraining is needed.
- Knowledge base uploads accept PDF only (OmniDim platform limit).
- If you later want multi-client workspaces with per-client billing on your own domain without hosting anything, OmniDim's **OmniRelay** agency plan is the managed alternative (docs.omnidim.io/docs/omnirelay).
