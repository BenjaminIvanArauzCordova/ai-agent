# Edge Data Lab

A chat application that uses GitHub Copilot to clarify a technology initiative,
propose boundary case types for approval, and generate CSV data with expected
behavior for each case.

## Run locally
Requirements: Node.js 22.12 or later and an authenticated GitHub Copilot CLI.

1. In one terminal, run `npm install --prefix server` and then `npm run dev --prefix server`.
2. In another terminal, run `npm install --prefix web` and then `npm run dev --prefix web`.
3. Open the local URL printed by Vite. Describe an initiative, answer Copilot's
   clarification questions, review the proposal, and approve it to generate cases.
4. The generated CSV is saved in `outputs/` and displayed in the existing results
   viewer. Existing CSV files can still be opened from the page.

The API listens on `127.0.0.1:3001`; Vite proxies `/api` requests to it. The
Copilot SDK uses the current CLI authentication and selected Copilot model.
For explicitly stated numeric ranges, the agent proposes inclusive limits and
expected behavior. After approval, the server uses `fast-check` with a stable
seed to create exact boundary neighbors and reproducible in-range samples.
Fields without a clear numeric range keep their approved synthetic example.

## Repository structure
- `.github/`: existing Copilot agent instructions, prompt, and boundary-family skill
- `server/`: local HTTP API, Copilot SDK integration, and CSV generation
- `web/`: chat interface and boundary-case results viewer
- `outputs/`: generated boundary-data CSV files
- `docs/`: test results