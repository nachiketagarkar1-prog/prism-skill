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
| "Create an opportunity assessment report…" / "…presentation on the dietary supplements market in Europe" | The skill is detected (or chosen with the **Auto / Answer / Report / Presentation** toggle). **Nothing is built yet:** a brief card asks for output type (the listed types or **Other research report/presentation**, described by the client), market, geography and forecast period (required; GVR's 2026–2033 pre-selected), shows the type's standard length (fixed until the client asks in chat to resize or restructure), whether to add a client name to the cover (off by default), the decision it should support, and which sources to use (GVR report, client documents with attachments, specific web pages, whitelisted sources, cited web research). Fields the message already answered are pre-filled. On **Create**, the build card runs the stages and delivers the note, PDF/PPTX, studio and Excel |
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
- **Review with analyst.** Requests the loaded GVR report can't cover on its own go to a GVR analyst instead of being built automatically. That includes client documents, external web pages, another market or geography (e.g. France), a type not built from the report, a custom report, or another forecast period. The brief card shows a **Review with analyst** pill, required with the reasons listed, or optional for any other request. Chat follow-ups beyond the report ("change the scope to France", "make it 30 pages") offer the same review; the current version stays unchanged. The analyst queue is front end only: the backend needs an endpoint such as `POST /{reports,decks}/reviews` (brief, reasons, request) that returns a review id and later delivers the validated version into the thread.
- **What builds automatically here.** Only the bundled outputs, built with the real skills from the GVR Blood Bank Serology report: reports (Executive View, Market Snapshot, Opportunity Assessment) for Global and North America, presentations (Executive View, Market Snapshot, Opportunity Assessment, Market Summary, Competitive Landscape) for Global, forecast 2026–2033. Nothing is ever substituted.
- **Client name.** The sample reports were rebuilt with the report skill (`samples-src/reports`, no client). A client name appears only when the user enters one: report studios render it live through the skill's renderer (it's passed into the embedded spec), and the bundled PDF/Excel files carry no client.
- **Report studio edits are real.** "Send to Prism" on a report sends the edited spec; the next version's studio renders from it (version bumped, revision line added, as `apply_edits.py` does). Its PDF and Excel come from the live re-render.
- **Fact-check visibility.** The client never sees fact-check detail. Deck notes carry only the one-line summary. Counts are shown only where the guides published them.
- **Ask Prism AI inside the studios** works offline, as built. Its model calls must go through `POST /{id}/ask`.
