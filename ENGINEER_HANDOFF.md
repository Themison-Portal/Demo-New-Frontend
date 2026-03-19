# Engineer Handoff

Use this when the UI in your browser no longer matches the raw repo because the app has accumulated local browser state.

## What this captures

- `localStorage` keys owned by the app, including demo state, organization profile, chat state, and theme
- `sessionStorage` keys owned by the app, including mode bootstrap flags

## What this does not capture

- DevTools edits that were never copied into source files
- browser extensions
- browser flags or per-browser rendering engine differences
- cached network responses outside the app's own storage keys

If the UI difference came from DevTools "local overrides" or ad hoc CSS/HTML edits in the browser, those changes must still be moved into the repo. A storage snapshot only restores app-managed state.

## Handoff flow

1. Open the app in the browser that has the correct state.
2. In the organization menu, click `Export engineer handoff`.
3. Move the downloaded `engineer-handoff.json` file to `client/public/engineer-handoff.json`.
4. Zip the repo and send it to your engineer.
5. When your engineer starts the app, it will auto-apply that snapshot once before the UI renders.

## Notes

- The snapshot applies once per snapshot ID. Re-export to generate a new snapshot if your state changes.
- After the engineer confirms the handoff, you can remove `client/public/engineer-handoff.json` if you do not want to keep shipping that seeded state.
