# baseball-2027
Baseball by Micah. Draft real MLB players, win games, earn gear.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

## Run it locally

Needs Node 24.

```bash
npm install
npm run dev        # server on :3000, game on http://localhost:5173
```

Production build (what Railway runs):

```bash
npm run build && npm start   # http://localhost:3000
```

## Refresh MLB rosters

```bash
python3 scripts/fetch_rosters.py
```
