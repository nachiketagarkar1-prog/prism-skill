# Prism Layer: skill output front end (working model)

A working front-end model of **Prism Layer** with the two GVR skills behind the chat:

- **GVR Report Builder**: paginated PDF + interactive report studio
- **GVR Deck Builder**: PowerPoint on the GVR master + deck studio

There is no backend yet. A mock API mirrors the platform contract from the developer guides and serves the bundled Blood Bank Serology sample outputs, so the whole flow can be clicked through end to end.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
```

## What works

| Flow | What happens |
|---|---|
| Ask a question (no output yet) | Mocked grounded answer |
| "Build an executive view deck…" / "…report for North America" | The skill is detected (or chosen with the **Auto / Answer / Report / Deck** toggle). A live hint shows what will be built. A build card shows the brief and runs the 7 stages, then delivers a 2–4 line note, the PDF/PPTX card and the studio card |
| Follow-up question ("Which region grows fastest?") | Answered from the latest output with § / slide references. **No new version** |
| Follow-up change ("Change the scope to North America only") | Re-plan stages → **next version** (v2, v3…) with a revision line |
| "Make it a deck" in a report thread | New deck job that inherits the thread's type and geography |
| Output panel | **Studio** (the real studio HTML, embedded), **PDF** / **Slides** preview, **Versions** (append-only revision history with downloads), version switcher |
| **Send to Prism** | Reads the studio's edit plan (`GVRStudio.plan()` for reports, `plan()` for decks), posts it as an edit plan and delivers the next version |
| Version conflict | Sending a plan from an older version is rejected with "reload the latest studio". Plans are never merged silently |

Chats and outputs persist in `localStorage`. Use **Reset demo data** in the sidebar to start over.

## Structure

```
src/
  api/mockApi.ts     PrismApi interface + mock (stage timings, versions, conflicts)
  api/catalog.ts     Bundled sample outputs and request → sample mapping
  lib/intent.ts      Chat routing: answer / build / change / question, type, region
  lib/answers.ts     Canned, sourced answers for questions about an output
  state/store.tsx    Threads, jobs, panel; send(), sendEditPlan()
  components/        Sidebar, ChatHeader, MessageList, BuildCard, Composer, OutputPanel, EmptyState
  types.ts           Chat + API types (mirrors the integration contract)
public/samples/      Sample PDFs, PPTX, studio HTML and thumbnails from the skill zips
```

## Wiring the real backend

Implement `PrismApi` (in `src/api/mockApi.ts`) over HTTP and export it as `api`:

| Method | Endpoint (from the guides) |
|---|---|
| `startJob(skill, req, brief, onStage)` | `POST /reports` · `POST /decks` |
| `postTurn(jobId, req, onStage)` | `POST /{reports,decks}/{id}/turns` |
| `submitEditPlan(jobId, plan, onStage)` | `POST /{reports,decks}/{id}/edit-plans` (reject a stale `base_version` → `VersionConflictError`) |
| `listVersions(jobId)` | `GET /{reports,decks}/{id}/versions` |

`onStage` expects stage progress. Stream it from the backend over SSE or WebSocket, or poll for it.

## Working-model shortcuts to replace for production

- **Studio origin.** Studios load on the app's own origin so "Send to Prism" can read the plan directly. The guides require an **isolated origin**, so switch to `postMessage` between the studio and the app.
- **Studio version label.** The sample studios show their own embedded version label (for example "v3 · working copy"). The panel uses the platform version as `base_version`.
- **Sample-based outputs.** Every new version reuses the closest bundled sample file under a versioned display name. No sample exists for strategy mapping or market overview, so a fallback sample is used and the delivery note says so.
- **Fact-check visibility.** The client never sees fact-check detail. Deck notes carry only the one-line summary. Counts are shown only where the guides published them.
- **Ask Prism AI inside the studios** works offline, as built. Its model calls must go through `POST /{id}/ask`.
