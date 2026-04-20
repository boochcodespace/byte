# byte

**A locally-running learning content studio for instructional designers.**

Bring your source material — SME notes, existing courses, technical docs, transcripts — and Byte's AI engine transforms it into bite-sized, tapas-style learning artifacts: flip card decks, scenarios, cheat sheets, mini games, knowledge checks, job aids, and more.

Each artifact is a standalone learning moment designed to take under 10 minutes and fit naturally into a learner's flow of work. Byte is powered by the Claude API and runs entirely on your machine. Your content and API key never leave your computer except for the API call to Anthropic.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Node.js + Express |
| Styling | Plain CSS with CSS variables |
| AI | Anthropic Claude API (`@anthropic-ai/sdk`) |
| Storage | Local filesystem (`~/Byte/`) |
| Package manager | npm |

---

## Prerequisites

- **Node.js v18 or higher** — [download at nodejs.org](https://nodejs.org)
- An **Anthropic API key** (see [Getting an API Key](#getting-an-anthropic-api-key) below)

---

## Installation

Clone the repository and enter the project folder:

```bash
git clone <repo-url>
cd byte
```

Install all dependencies in one step:

```bash
npm run install:all
```

This runs `npm install` in the root, `frontend/`, and `backend/` folders.

---

## Running the App

From the repo root:

```bash
npm run dev
```

This starts both servers simultaneously using `concurrently`:

- **Frontend** (React + Vite): [http://localhost:5173](http://localhost:5173)
- **Backend** (Express API): [http://localhost:3001](http://localhost:3001)

Open [http://localhost:5173](http://localhost:5173) in your browser to get started.

---

## Getting an Anthropic API Key

1. Go to [console.anthropic.com](https://console.anthropic.com)
2. Sign in or create an account
3. Navigate to **API Keys** → **Create Key**
4. Copy the key — it starts with `sk-ant-...`

> **Cost note:** API usage is billed per token. Generating one flip card deck typically costs a few cents.

---

## Adding Your API Key to Byte

1. Start the app with `npm run dev`
2. Open [http://localhost:5173](http://localhost:5173)
3. Click **Settings** in the top navigation
4. Paste your API key and click **Save key**

Your key is stored in `~/Byte/settings.json` on your local machine. It is never committed to this repository or sent anywhere other than Anthropic's API during generation.

---

## Using Byte

### The basic flow

1. **Create a project** — on the Projects page, click **+ New project**. Give it a title, and optionally a description, target audience, and style guide. Project-level settings are inherited by every artifact generated within it.
2. **Add a source** — open the project, click **+ Add source**, then either paste text or upload a file. See [Supported Source Formats](#supported-source-formats) below. Max 25 MB.
3. **Open the source** — click on its card in the project's source grid.
4. **Set learner context** — in the right sidebar, fill in the learner's role, experience level, and use case. Optionally add the source's learning objectives.
5. **Generate an artifact** — click **✨ Generate** with "Flip Card Deck" selected. You can add a per-generation prompt or lock a target learning objective before generating.
6. **Interact with the output** — click any card to flip it, use **← →** arrow keys to navigate, and **Space** to flip.

### How Byte steers output

Byte treats your source as the primary reference and faithfully distills it into artifacts. You steer the output through three layers:

| Layer | Scope | Job |
|---|---|---|
| **Style Guide** | Project-level | *How* to write — voice, tone, writing conventions, words or patterns to avoid |
| **Custom Instructions** | Project-level | *What* to focus on — content emphasis, pedagogical angle, framing applied to every artifact in the project |
| **Per-Generation Prompt** | Per-artifact (ephemeral) | One-off steering for a single artifact — not saved |

You can also provide learning objectives at the source level, or lock a single target objective per artifact via the per-generation override. When objectives are provided, Byte treats them as authoritative.

---

## Supported Source Formats

Byte extracts text and embedded images from uploaded files into a canonical shape (`source.md` + `media/manifest.json`). All parsing happens locally on your machine.

| Format | Text extraction | Embedded images | Notes |
|---|---|---|---|
| `.md` | Pass-through | — | File content lands verbatim in `source.md` |
| `.txt` | Wrapped under title | — | Plain text is treated as body content |
| `.docx` | Markdown-flavoured | Yes | Tables and headings preserved. Linked (not embedded) images are skipped. Tracked changes are resolved to accepted text. |
| `.pdf` | Per-page with `[page N]` markers | Yes (raster only) | Line breaks inferred from text positioning. Vector graphics and form XObjects are skipped. Password-protected PDFs are rejected at upload. Scanned PDFs are flagged — OCR is not supported. |
| `.pptx` | Per-slide with title, body, and speaker notes | Yes | Hidden slides are included and flagged. SmartArt and charts are skipped. |

### A note on image extraction

When a source has embedded images, each one is catalogued in `media/manifest.json` with rich metadata: sequential filename, source format, position context, nearby text, pixel dimensions, and extraction timestamp. Today's generation pipeline is text-only; visual-awareness integration is planned for a future phase.

---

## Where Your Data Lives

All user content is stored in `~/Byte/` on your machine — outside this repository:

```
~/Byte/
├── settings.json                                  ← your Anthropic API key
└── projects/
    └── <project-slug>/
        ├── project.json                           ← project metadata, style guide, target audience
        └── sources/
            └── <source-slug>/
                ├── source.md                      ← extracted or pasted text
                ├── source-original.<ext>          ← original uploaded file (upload flow only)
                ├── context.json                   ← learner context (role, experience, use case)
                ├── media/
                │   ├── manifest.json              ← extracted images manifest
                │   └── image-001.png, ...         ← extracted embedded images
                └── artifacts/
                    └── flip-cards-<timestamp>/
                        └── artifact.json          ← generated artifact data
```

> **Migrating from an earlier version?** If you have a flat `~/Byte/sources/` folder from a pre-Projects release, Byte will automatically migrate your existing sources into a `Default Project` the first time the new server starts. Your original folder is preserved as `~/Byte/sources.backup-<timestamp>/`.

Nothing in `~/Byte/` is ever committed to this repository.

---

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

---

## Development Notes

- The frontend dev server runs on port **5173** — Vite proxies `/api/*` requests to the backend automatically
- The backend API runs on port **3001**
- Both servers hot-reload on file save (Vite for frontend, nodemon for backend)

---

## License

See [LICENSE](./LICENSE).
