# Edge Data Lab

Repository with a GitHub Copilot agent that generates boundary (edge case) data from a technology initiative.

- The main agent is `.github/agents/edge-case-data-generator.agent.md`.
- Input initiatives go in `examples/initiatives/`; optional samples go in `examples/samples/`.
- Generated cases go in `outputs/` as CSV, one file per initiative.
- Every boundary case must include an expected behavior.
- Never use real personal data; use obviously fake values.
- All files, comments, and documentation are written in English.