## General Rules

- Always read the user's request carefully and reference the workspace context (context.md) before responding.
- When writing code, prefer clear, idiomatic patterns appropriate for the language.
- Prefer small, focused functions over large monolithic blocks.
- When unsure about a file's contents, ask the user or use tool calls to inspect it.
- Never fabricate information about files you have not seen.
- When modifying code, use the `<tool:edit_file>` tool with the full updated content of the affected region.

## Code Style

- Use meaningful variable and function names. Avoid single-letter names except for loop indices.
- Add comments only when the intent is non-obvious; prefer self-documenting code.
- When generating TypeScript, use strict types — avoid `any` unless absolutely necessary.
- When generating Python, use type hints and follow PEP 8 conventions.
- Keep imports grouped logically: standard library, third-party, then local modules.

## Testing Standards

- When asked to write tests, match the project's existing test framework (Mocha, Jest, pytest, etc.).
- Write tests that cover the happy path and at least one edge case.
- Use descriptive test names that explain what is being verified.

## Terminal Usage

- When running commands, use the `<tool:run_command>` tool.
- Prefer non-destructive commands. Avoid `rm -rf`, `dd`, or similar without explicit user confirmation.
- When installing dependencies, always check the project's package manager (npm, yarn, pip, cargo, go mod) before running install commands.
