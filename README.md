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

1. **Create a project** — on the Projects page, click **+ New project**. Give it a title, and optionally a description, target audience, and style guide. Project-level guidance is inherited by every artifact generated within the project.
2. **Add a source** — open the project, click **+ Add source**, then either paste text or upload a file (see **Supported source formats** below — max 25 MB)
3. **Open the source** — click on its card in the project's source grid
4. **Set learner context** — in the right sidebar, fill in the learner's role, experience level, use case, and (optionally) the source's learning objectives
5. **Generate an artifact** — click **✨ Generate** with "Flip Card Deck" selected. Optionally add a per-generation prompt or lock a target learning objective before clicking.
6. **Interact with the cards** — click any card to flip it, use **← →** arrow keys to navigate, **Space** to flip

### How Byte steers output

Byte treats your source as primary reference material and faithfully distills it into artifacts. You steer the output through three distinct layers, each with a different job:

- **Style Guide** (project-level) — *how* to write. Voice, tone, writing conventions, words or patterns to avoid.
- **Custom Instructions** (project-level) — *what to focus on*. Content emphasis, pedagogical angle, framing that every artifact in the project should reflect.
- **Per-Generation Prompt** (per-artifact, ephemeral) — one-off steering for a single artifact. Not saved.

You can also provide learning objectives at the source level (a free-form list the source is designed to support) or lock a single target objective for one artifact via the per-generation override. When objectives are provided, Byte treats them as authoritative and does not substitute its own.

## Supported Source Formats

Byte extracts text and embedded images from uploaded files into a canonical shape (`source.md` + `media/manifest.json`) that generation can read. All parsing happens locally.

| Format | Text | Embedded images | Notes |
|---|---|---|---|
| `.md`   | pass-through | — | File content lands verbatim in `source.md`. |
| `.txt`  | wrapped under title | — | Plain text is treated as body content under your entered title. |
| `.docx` | Markdown-flavoured | yes | Tables and headings preserved. Linked (not embedded) images are skipped. Tracked changes are resolved to the accepted text. |
| `.pdf`  | per-page with `[page N]` markers | yes (raster only) | Line breaks inferred from text positioning. Vector graphics and form XObjects are skipped. Password-protected PDFs are rejected at upload. Scanned PDFs get a clear marker — OCR is not supported. |
| `.pptx` | per-slide with title, body, and speaker notes | yes | Hidden slides are included and flagged. Slide layouts and masters are not extracted (template text only). SmartArt and charts are skipped. |

### Visual awareness (Level 1)

When a source has embedded images, each one is catalogued in `media/manifest.json` with rich metadata: sequential filename, source format, position context (`"after paragraph N"`, `"page N"`, `"slide N"`), up to ~200 chars of nearby text, pixel dimensions, and extraction timestamp.

Today, generation uses these manifests **as text context only** — Claude sees image filenames and their nearbyText and references them by name in artifact output. Claude does not yet see the image pixels themselves. That upgrade (Level 3 — vision via Claude's multimodal capability) is a later phase.

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
                │   ├── manifest.json              ← extracted images manifest
                │   └── image-001.png, ...         ← extracted embedded images
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
