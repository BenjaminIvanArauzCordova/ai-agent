# Edge Data Lab

A GitHub Copilot agent that takes a technology initiative and generates boundary
data with expected behavior for each case.

## How to use
1. Open this folder in VS Code with GitHub Copilot enabled.
2. Open Copilot Chat and select the `edge-case-data-generator` agent.
3. Paste an initiative (or run `/edge-cases`).
4. Save the CSV result in `outputs/`.

## Structure
- `.github/`: agent, prompt, instructions, and skill
- `examples/`: input initiatives and optional samples
- `outputs/`: generated boundary data
- `docs/`: test results