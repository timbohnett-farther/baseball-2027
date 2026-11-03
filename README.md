# baseball-2027
Baseball by Micah. Draft real MLB players, win games, earn gear.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design and [docs/VISUAL_DESIGN.md](docs/VISUAL_DESIGN.md) for the look.

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

## Refresh MLB data and ratings

Runs automatically once a day on the server. To run it by hand (also rewrites `data/players.json`):

```bash
npm run refresh
```

## Tests

```bash
npm test
```
