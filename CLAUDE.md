# Ant Farm Simulator — Assistant Rules & Workflows

## Commands
*   **Dev Server:** `npm run dev`
*   **Build Project:** `npm run build`
*   **TypeScript Checks:** `npx tsc --noEmit`
*   **Run Tests:** `npx vitest run` (once installed) / `npx vitest` for watch mode

## Workflow Rules

### 1. Feature Branch & Pull Request Flow
Do **NOT** commit or push directly to the `main` branch. For every issue/task:
1.  **Branching:** Create a local feature branch: `git checkout -b feature/issue-<number>-<slug>`.
2.  **Coding & Testing:** Apply changes on the feature branch.
3.  **Local Push:** Push the feature branch to GitHub: `git push -u origin feature/issue-<number>-<slug>`.
4.  **Create PR:** Create a Pull Request (PR) on GitHub from your feature branch to `main` using the `github-mcp-server` MCP tool.
5.  **Manual Checklist:** The PR description **MUST** include a **Manual Testing Checklist** (markdown checkboxes) explaining exactly how the user should verify the changes locally before merging the PR.
6.  **Human Review:** Wait for the user to test and merge the PR.

### 2. Code Style
*   **Language:** Strict TypeScript with ESM module imports.
*   **Architecture:** Focus on **Depth** and **Locality**. Create clean, deep interfaces at seams, keeping internal class structures private.
*   **Documentation:** Update the `CONTEXT.md` glossary when introducing new terms, and add a sequential ADR in `docs/adr/` for major architectural trade-offs.

## Repository Context
*   **GitHub Repository:** `JordanAdair/ant-farm-simulator`
*   **URL:** `https://github.com/JordanAdair/ant-farm-simulator`
*   **Owner:** `JordanAdair`
*   **Name:** `ant-farm-simulator`

## Agent skills

### Issue tracker
GitHub repository issues are tracked at `JordanAdair/ant-farm-simulator`. See [issue-tracker.md](file:///home/jordan/.gemini/antigravity/scratch/ant-farm-simulator/docs/agents/issue-tracker.md).

### Triage labels
Standard triage label names are used. See [triage-labels.md](file:///home/jordan/.gemini/antigravity/scratch/ant-farm-simulator/docs/agents/triage-labels.md).

### Domain docs
Single-context repository layout. See [domain.md](file:///home/jordan/.gemini/antigravity/scratch/ant-farm-simulator/docs/agents/domain.md).


