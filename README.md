# 🚀 Jira CLI (`jira-cli`)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-0-success.svg)](package.json)

A technology-agnostic, zero-dependency CLI & SDK to interact directly with Jira REST (`/rest/api/2`) and Agile (`/rest/agile/1.0`) APIs. Fully compatible with both **Jira Data Center / Server** and **Jira Cloud**.

- **Zero External Dependencies**: Built with native Node.js ESM using built-in `fetch` (requires Node.js 18+).
- **Single Local Configuration File**: All settings and personal keys live in a single file (`jira.config.json`), ignored by `.gitignore` to prevent credential leaks.
- **Built-in Guardrails**: Secret scanner, automatic Windows-1252 transliteration for Data Center compatibility, and `--dry-run` preview mode.

---

## 🔑 1. How to Obtain Your Personal Key

How to generate your token depends on whether your organization uses **Jira Data Center / Server** or **Jira Cloud**:

### Option A: Jira Data Center / Jira Server (Personal Access Token - PAT)
1. Log in to your Jira instance in the browser.
2. In the top right corner, click your **Avatar / Profile Picture** and select **Profile**.
3. In your profile menu, click **Personal Access Tokens**.
4. Click the **Create token** button.
5. Provide a name (e.g. `jira-cli`) and choose an expiration duration.
6. Click **Create** and **copy your generated token immediately** (Jira only displays it once!).

### Option B: Jira Cloud (`https://*.atlassian.net` — API Token)
1. Go to: [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click the **Create API token** button.
3. Enter a label (e.g. `jira-cli`) and click **Create**.
4. **Copy the generated token**.

---

## ⚙️ 2. Where to Put the Key in the Configuration File

The tool uses a **single configuration file**:
📂 `jira.config.json` (located in the project root).

### Quick setup via CLI command:
```bash
# For Jira Data Center / Server (PAT):
./jira.mjs init --url "https://jira.yourcompany.com" --key "YOUR_PERSONAL_ACCESS_TOKEN"

# For Jira Cloud (API Token + Email):
./jira.mjs init --url "https://yourcompany.atlassian.net" --email "your.email@company.com" --key "YOUR_API_TOKEN"
```

### Or manually by creating `jira.config.json`:
```bash
cp jira.config.example.json jira.config.json
```

Edit `jira.config.json`:
```json
{
  "baseUrl": "https://jira.yourcompany.com",
  "personalKey": "PASTE_YOUR_PERSONAL_KEY_HERE",
  "authType": "bearer",
  "email": "",
  "apiVersion": "2",
  "defaultProject": "PROJ",
  "defaultBoardId": null,
  "sanitizeWindows1252": true,
  "dryRun": false
}
```

* **`baseUrl`**: Base URL of your Jira instance (e.g. `https://jira.yourcompany.com` or `https://yourcompany.atlassian.net`).
* **`personalKey`**: The Personal Access Token (PAT) or API Token generated in Step 1.
* **`authType`**: `"bearer"` for Jira Data Center / Server (PAT), or `"basic"` for Jira Cloud.
* **`email`**: Your email address (required only for Jira Cloud with `"authType": "basic"`).
* **`defaultProject`**: *(Optional)* Default project key (e.g. `PROJ`) to avoid typing `--project` on every command.
* **`dryRun`**: When `true`, logs the HTTP method and JSON payload without sending writes to Jira.

### Test your connection:
```bash
./jira.mjs whoami
```

---

## 📖 3. Command Reference

> **Tip:** You can run commands directly with `./jira.mjs <command>` or run `npm link` to expose `jira` and `jira-cli` globally across your system terminal.

### 1. Boards & Sprints
```bash
# List available boards
./jira.mjs boards

# Filter boards by project or name
./jira.mjs boards --project PROJ --all
./jira.mjs boards --search "Backend"

# List sprints for a board
./jira.mjs sprints <boardId>
./jira.mjs sprints <boardId> --state active

# List issues/stories on a board or sprint
./jira.mjs board-issues <boardId>
./jira.mjs sprint-issues <sprintId>
```

### 2. Read & Search User Stories / Issues
```bash
# Get complete details of an issue (description, criteria, subtasks, links, and comments)
./jira.mjs get PROJ-123

# List open issues assigned to you
./jira.mjs my-issues

# List User Stories for a project or epic
./jira.mjs stories --project PROJ
./jira.mjs stories --epic PROJ-10

# Search using any custom JQL expression
./jira.mjs search 'project = "PROJ" AND statusCategory != Done ORDER BY priority DESC'
```

### 3. Create User Stories, Tasks, Bugs & Epics
```bash
# Create a standard User Story
./jira.mjs create \
  --project PROJ \
  --type "Story" \
  --summary "OAuth2 Authentication with refresh tokens" \
  --description "Acceptance Criteria:\n- Validate JWT tokens\n- Expose /refresh endpoint"

# Create and link directly to an Epic and Sprint
./jira.mjs create \
  --project PROJ \
  --type "Story" \
  --summary "Pagination for user list API" \
  --priority "High" \
  --labels "api,performance" \
  --epic PROJ-10 \
  --sprint 45

# Create an Epic (auto-discovers the mandatory "Epic Name" custom field)
./jira.mjs create-epic \
  --project PROJ \
  --summary "Authentication Module Refactoring" \
  --epic-name "Auth v2" \
  --description "Initiative to modernize the authentication layer."
```

### 4. Edit Cards, Assign & Workflow Transitions
```bash
# Update summary, description, priority, or labels
./jira.mjs update PROJ-123 \
  --summary "Updated story title" \
  --priority "High" \
  --add-label "backend"

# Assign issue to yourself (--me), another user, or unassign
./jira.mjs assign PROJ-123 --me
./jira.mjs assign PROJ-123 john.doe
./jira.mjs assign PROJ-123 --unassign

# Move issue into an Epic or Sprint
./jira.mjs move-to-epic PROJ-10 PROJ-123
./jira.mjs move-to-sprint 45 PROJ-123

# View valid workflow transitions available from current status
./jira.mjs transitions PROJ-123

# Move issue to a new status
./jira.mjs transition PROJ-123 "In Progress"
./jira.mjs transition PROJ-123 "Done" --comment "Implementation completed and tested."
```

### 5. Comments, Worklogs & Links
```bash
# List all comments on an issue
./jira.mjs comments PROJ-123

# Add a comment
./jira.mjs comment PROJ-123 "Load testing completed successfully (p99 < 80ms)."

# Edit an existing comment
./jira.mjs edit-comment PROJ-123 <commentId> "Updated comment text."

# Log work spent
./jira.mjs worklog PROJ-123 "3h 30m" "Refactoring and unit tests"

# Link two cards together
./jira.mjs link PROJ-123 PROJ-120 --type "Relates"

# View or attach remote links (Confluence pages, documentation, PRs)
./jira.mjs remote-links PROJ-123
./jira.mjs link-url PROJ-123 "https://wiki.yourcompany.com/doc/123" "API Architecture Document"
```

---

## 💡 4. Productivity Features

### 📊 Board & Sprint Health Dashboard (`board-summary`)
Provides a terminal dashboard of the active sprint or board: progress bar, story breakdown by status category (`To Do`, `In Progress`, `Done`), workload per team member, and flagged critical cards:
```bash
./jira.mjs board-summary <boardId>
```

### 🎙️ Daily Standup Report (`standup`)
Generates your daily standup notes in seconds:
- Completed recently (past $N$ days)
- In Progress right now
- Next up in queue (To Do)
```bash
./jira.mjs standup --days 2
```

### 📄 Export Story to Technical Markdown Spec (`export-story`)
Exports all information from a User Story (description, acceptance criteria, subtasks, remote docs, and comments) into a Markdown document with a Definition of Done checklist:
```bash
./jira.mjs export-story PROJ-123 --output spec.md
```

### 🛡️ Built-in Safety Guardrails
* **`--dry-run` Mode**: Append `--dry-run` to any create, update, or transition command to preview the HTTP method, endpoint, and JSON payload before touching Jira.
* **Windows-1252 Safe Transliteration**: Automatically transliterates Unicode characters (`→` to `->`, `✓` to `(/)`, `✗` to `(x)`) to avoid corrupting characters into `¿` on Jira Data Center instances.
* **Secret Scanner**: Prevents accidentally submitting private keys, JWTs, or API tokens inside Jira summaries, descriptions, or comments.
* **`--json` Flag**: Every command supports `--json` for scripting, CI/CD automation, and AI agent integration.

---

## 💻 5. Programmatic SDK Usage (Node.js)

You can also import `JiraClient` in any Node.js application:

```javascript
import { loadConfig, JiraClient } from './jira.mjs';

const config = loadConfig();
const jira = new JiraClient(config);

// Get current authenticated user
const me = await jira.getCurrentUser();
console.log(`Authenticated as: ${me.displayName}`);

// Search issues
const { issues } = await jira.searchIssues('assignee = currentUser() AND statusCategory != Done');
for (const issue of issues) {
  console.log(`- [${issue.key}] ${issue.fields.summary}`);
}
```

---

## 📄 License

Distributed under the [MIT License](LICENSE).
