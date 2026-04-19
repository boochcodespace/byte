# byte
A locally-running web app that acts as a secondary learning content creator. The user uploads source content (SME notes, existing course materials, transcripts, technical docs) and the tool generates a menu of bite-sized tapas-style learning artifacts from that source.

---

## What is Byte?

Byte is a desktop-local web application for instructional designers. You bring source material — SME notes, existing course content, technical docs, transcripts — and Byte's AI engine transforms it into bite-sized, tapas-style learning artifacts: flip card decks, scenarios, cheat sheets, mini games, knowledge checks, job aids, and more.

Each artifact is a standalone learning moment designed to take under 10 minutes and fit naturally into a learner's flow of work. Byte is powered by the Claude API and runs entirely on your machine. Your content and API key never leave your computer except for the API call to Anthropic.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Styling | Plain CSS with CSS variables |
| AI | Anthropic Claude API (`@anthropic-ai/sdk`) |
| Storage | Local filesystem (`~/Byte/`) |
| Package manager | npm |

## Prerequisites

- **Node.js v18 or higher** — [download at nodejs.org](https://nodejs.org)
- An **Anthropic API key** (see below)

## Installation

1. Clone the repository and enter the folder:
   ```bash
   git clone <repo-url>
   cd byte
   ```

2. Install all dependencies in one step:
   ```bash
   npm run install:all
   ```
   This runs `npm install` in the root, `frontend/`, and `backend/` folders.

## Running the App

From the repo root:

```bash
npm run dev
```

This starts both servers simultaneously using `concurrently`:
- **Frontend** (React + Vite): [http://localhost:5173](http://localhost:5173)
- **Backend** (Express API): [http://localhost:3001](http://localhost:3001)

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Getting an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign in or create a free account
3. Navigate to **API Keys** → **Create Key**
4. Copy the key (it starts with `sk-ant-...`)

> **Cost note:** API usage is billed per token. Generating one flip card deck typically costs a few cents.

## Adding Your API Key to Byte

1. Start the app (`npm run dev`)
2. Open [http://localhost:5173](http://localhost:5173)
3. Click **Settings** in the top navigation
4. Paste your API key and click **Save key**

Your key is stored in `~/Byte/settings.json` on your local machine. It is **never** committed to this repository or sent anywhere except Anthropic's API when you generate an artifact.

## Using Byte End-to-End

1. **Create a project** — on the Projects page, click **+ New project**. Give it a title, and optionally a description, target audience, and style guide. Style guide and target audience are inherited by every artifact you generate within the project.
2. **Add a source** — open the project, click **+ Add source**, then either paste text or upload a file (PDF, PPTX, DOCX, MD, TXT — max 25 MB)
3. **Open the source** — click on its card in the project's source grid
4. **Set learner context** — in the right sidebar, fill in the learner's role, experience level, and use case. Combined with the project's style guide and audience, this is what tailors each artifact.
5. **Generate an artifact** — click **✨ Generate** with "Flip Card Deck" selected
6. **Interact with the cards** — click any card to flip it, use **← →** arrow keys to navigate, **Space** to flip

## Where Your Data Lives

All user content is stored in `~/Byte/` on your machine (your home folder, outside this repository):

```
~/Byte/
├── settings.json                                  ← your Anthropic API key
└── projects/
    └── <project-slug>/
        ├── project.json                           ← project metadata + style guide + target audience
        └── sources/
            └── <source-slug>/
                ├── source.md                      ← extracted/pasted text
                ├── source-original.<ext>          ← original uploaded file (upload flow only)
                ├── context.json                   ← learner context (role, experience, use case)
                ├── media/
                │   └── manifest.json              ← extracted images manifest
                └── artifacts/
                    └── flip-cards-<timestamp>/
                        └── artifact.json          ← generated artifact data
```

If you used an earlier version of Byte (with a flat `~/Byte/sources/` folder), Byte will migrate your existing sources into a `Default Project` automatically the first time the new server starts. The original folder is preserved as `~/Byte/sources.backup-<timestamp>/`.

Nothing in `~/Byte/` is ever committed to this repository.

## Smoke Test

To verify your API key is working without opening the browser:

```bash
node smoke-test.js
```

Expected output:
```
✓  API key found in ~/Byte/settings.json
✓  Claude API responded: BYTE_OK

Smoke test passed. Byte is ready to generate artifacts.
```

## Development Notes

- Frontend dev server runs on port **5173** — Vite proxies `/api/*` requests to the backend automatically
- Backend API runs on port **3001**
- Both servers hot-reload on file save (Vite for frontend, nodemon for backend)

## License

See [LICENSE](./LICENSE).
