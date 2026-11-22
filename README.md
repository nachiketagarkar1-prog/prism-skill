# Prism Layer: skill output front end (working model)

A working front-end model of **Prism Layer** with the two GVR skills behind the chat:

- **GVR Report Builder**: paginated PDF + interactive report studio
- **GVR Presentation Builder** (the `gvr-deck-builder` skill): PowerPoint on the GVR master + presentation studio

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
| "Create an opportunity assessment report…" / "…presentation on the dietary supplements market in Europe" | The skill is detected (or chosen with the **Auto / Answer / Report / Presentation** toggle). **Nothing is built yet:** a brief card asks for output type, market, geography and forecast period (required; GVR's 2026–2033 pre-selected), shows the type's standard length (fixed until the client asks in chat to resize or restructure), whether to add a client name to the cover (off by default), audience, the decision it should support, and which sources to use (GVR report, client documents with attachments, specific web pages, whitelisted sources, cited web research). Fields the message already answered are pre-filled. On **Create**, the build card runs the stages and delivers the note, PDF/PPTX, studio and Excel |
| Follow-up question ("Which region grows fastest?") | Answered from the latest output with § / slide references. **No new version** |
| Follow-up change ("Change the scope to North America only", "Make it 20 slides", "Change the forecast period to 2026–2030") | Re-plan stages → **next version** (v2, v3…) with a revision line |
| "Make it a presentation" in a report thread | Opens the brief card pre-filled from the report (type, market, geography, client, sources) |
| Excel export | Every version ships `<name>_vN_data.xlsx` with all tables, charts and KPIs (see `skills/README.md`). It appears as a third card and as an **Excel** tab with a sheet-by-sheet preview. Asking "can I get the Excel?" attaches it without a new version |
| Output panel | **Studio** (the real studio HTML, embedded), **PDF** / **Slides** preview, **Versions** (append-only revision history with downloads), version switcher |
| **Send to Prism** (in the studio toolbar, in place of *Export edit plan*) | Reads the studio's edit plan (`GVRStudio.plan()` for reports, `plan()` for decks), posts it as an edit plan and delivers the next version |
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

- **Studio origin and Send to Prism button.** Studios load on the app's own origin so the app can replace the studio's *Export edit plan* button with *Send to Prism* and read the plan directly. For production, add the button to the studio templates (`studio_template.html`, `studio/template.html`). The guides require an **isolated origin**, so switch to `postMessage` between the studio and the app.
- **Studio version label.** The sample studios show their own embedded version label (for example "v3 · working copy"). The panel uses the platform version as `base_version`.
- **Sample-based outputs.** Titles, file names and the brief follow what the user asked for, but the file contents are the closest bundled Blood Bank Serology sample (including that sample's "Prepared for Northwind Diagnostics (sample client)" cover). Fact-check counts are shown only when the request matches the sample exactly.
- **Fact-check visibility.** The client never sees fact-check detail. Deck notes carry only the one-line summary. Counts are shown only where the guides published them.
- **Ask Prism AI inside the studios** works offline, as built. Its model calls must go through `POST /{id}/ask`.
