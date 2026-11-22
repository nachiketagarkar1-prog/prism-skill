# Excel export for the GVR skills

Every report and presentation ships with an Excel workbook of its **tables, charts and KPIs**, rebuilt for every version.
These two scripts are drop-in additions to the skills; nothing else in the skills changes.

| Skill | Script | Reads | Why that input |
|---|---|---|---|
| `gvr-report-builder` | `scripts/export_xlsx.py spec.json out.xlsx` | report spec JSON | The spec is the single source of truth: the PDF and the studio render from it |
| `gvr-deck-builder` | `scripts/export_xlsx.py deck.pptx out.xlsx [--spec deck.json]` | rendered PPTX | Studio edit plans are applied to the PPTX (`apply_edits.py`), so the spec can lag; chart data is read from the native chart parts, as `fact_check.py` does |

Both need only `openpyxl` (and `python-pptx` for presentations), with no network.

## Workbook layout

- **Contents**: market, version, edition/date, base year, forecast, unit, client, and one linked row per item.
- **Key figures**: every KPI tile (presentations also include headline cards whose line is a short figure), with the value as shown, the parsed number and the unit (`USD 3,329.3 Mn` → `3329.3`, `USD Mn`).
- **One sheet per figure or table**:
  - Reports: `Fig N` / `Table N`, numbered exactly like the PDF.
  - Presentations: `S<slide> Chart <k>` / `S<slide> Table <k>`.
  - Each sheet has the caption, data with real numbers, and the source line.
  - Column, bar, line, stacked and donut/pie charts also get a native Excel chart in the GVR palette.
- **Skipped:** hidden chapters, sections, blocks and slides. Calculated values keep their "(calculated)" label.

## Where it runs

Add a step after the silent fact-check and before the studio build. Only traced figures reach the workbook.

```bash
# Report (after build_report.py + fact_check.py)
python3 scripts/export_xlsx.py spec_vN.json out/<Name>_vN_data.xlsx

# Presentation (after build_deck.py / apply_edits.py + fact_check.py)
python3 scripts/export_xlsx.py out/<Deck>_vN.pptx out/<Deck>_vN_data.xlsx --spec deck.json
```

Add the line to each skill's `SKILL.md` workflow (Create step 6, and after every apply in the update loop). In the job folder the file sits next to the other version files as `<name>_vN_data.xlsx`. `GET /{reports,decks}/{id}/versions` returns it as a third file (`kind: "xlsx"`). No new endpoint is needed.

A chat request for "the Excel" returns the latest version's workbook without a new version.

## Checks run on the bundled samples

- **Reports (6 samples):** figure and table counts match each PDF's List of Figures and List of Tables. All 73 plotted values in the Global Opportunity Assessment match the spec.
- **Presentations (5 samples):** chart and table counts match the PPTX. All 216 chart values match the native chart data.
- **Workbooks:** open in LibreOffice, and the native charts render.

`scripts/build_sample_exports.sh` (repo root) regenerates the sample workbooks and their JSON previews.
