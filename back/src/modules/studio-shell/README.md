# Module `studio-shell` (back)

`StudioShellModule` exposes the desktop donation destinations to the studio through `DesktopDonationsController`. The public
values come from the Nest process environment supplied by `desktop/desktop.config.json`. The endpoint requires the desktop shell's
`DESKTOP_PARENT_PID` marker and checks the destinations' shape before
returning them. The module has no entities, payment credentials or payment processing. It depends on the shared HTTP and validation decorators.

| Method | Endpoint | Auth | Response |
|---|---|---|---|
| `GET` | `/api/studio/desktop-donations` | Public | `{ methods: { btc, eth, sol, stripeUrl } }` for desktop with valid destinations, 503 for invalid desktop configuration, `{ methods: null }` outside the desktop shell. The response is not cached. |
