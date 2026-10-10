# Muono

A Solana token with a site that states confirmed facts only.

[![Live site](https://img.shields.io/badge/live-muono.org-0a5af9)](https://muono.org)

## Overview

Muono lives on Solana. The site at muono.org is one static page: a reference desk where each public item gets a register record, and an unconfirmed record stays dimmed, dated and unclickable.

- **Token chain:** Solana
- **CA:** absent. Placeholder text only. Nothing is announced yet, so no address appears anywhere in this repository.

## Features

- Contract address slot pinned at the page top, displayed whole and copyable by click once it exists
- Records rendered by state: stated, absent or unconfirmed
- Account icons within the top bar at every screen width, inert until announced
- Light glass interface with a sidebar tree, outline panel, step cards, tiles and cards
- Respects reduced motion, 44 px tap targets, zero outside requests

## Links

- Site: https://muono.org
- X: not announced
- GitHub: not announced
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Commands

```bash
npm run build    # writes dist/
npm run gates    # builds, then proves both register branches
```

`dist/` serves as the deploy folder. Edit `src/register.json` to confirm a record, then rebuild.

## License

MIT. Terms in [LICENSE](LICENSE).
