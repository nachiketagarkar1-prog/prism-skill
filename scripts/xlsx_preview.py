#!/usr/bin/env python3
"""Write a JSON preview next to each Excel export, for the in-app Excel tab.

    python3 scripts/xlsx_preview.py public/samples/**/*_data.xlsx

For each <name>.xlsx writes <name>.json: {"bytes", "sheets": [{"name", "charts", "rows": [[...]]}]}
(values as displayed: numbers formatted, at most 80 rows x 12 columns per sheet).
"""
import json
import os
import sys

from openpyxl import load_workbook


def shown(v, fmt):
    if isinstance(v, float) or isinstance(v, int):
        if fmt and "%" in fmt:
            return f"{v:,.2f}%"
        if fmt and fmt.startswith("0.") and set(fmt[2:]) == {"0"}:
            return f"{v:,.{len(fmt) - 2}f}"
        return f"{v:,.2f}" if isinstance(v, float) and v != int(v) or (fmt and "0.00" in fmt) else f"{v:,.0f}"
    return "" if v is None else str(v)


def preview(path):
    wb = load_workbook(path)
    sheets = []
    for ws in wb.worksheets:
        rows = []
        for r in ws.iter_rows(max_row=min(ws.max_row, 80), max_col=min(ws.max_column, 12)):
            rows.append([shown(c.value, c.number_format) for c in r])
        while rows and not any(rows[-1]):
            rows.pop()
        sheets.append({"name": ws.title, "charts": len(ws._charts), "rows": rows})
    return {"bytes": os.path.getsize(path), "sheets": sheets}


if __name__ == "__main__":
    for p in sys.argv[1:]:
        out = p[: -len(".xlsx")] + ".json"
        with open(out, "w", encoding="utf-8") as f:
            json.dump(preview(p), f, ensure_ascii=False)
        print(out)
