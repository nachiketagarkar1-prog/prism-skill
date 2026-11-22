#!/usr/bin/env python3
"""Export the data behind a GVR report (tables, charts, KPIs) to an Excel workbook.

    python3 scripts/export_xlsx.py spec.json out/<Name>_vN_data.xlsx

Reads the report spec, the single source of truth that the PDF and the studio render from,
so the workbook always matches the delivered version. Numbering mirrors renderer.js
(Fig. N / Table N across the whole report; hidden chapters, sections and blocks are skipped).

Workbook:
  Contents       report metadata + one linked row per exported item
  Key figures    every KPI tile, with the value parsed into a number and a unit
  Fig N / Tab N  one sheet per figure or table: caption, data, source;
                 column/bar/line/stacked/pie/donut figures also get a native Excel chart

Prints JSON stats: {"sheets", "figures", "tables", "kpis"}.
Requires openpyxl.
"""
import json
import re
import sys

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, PieChart, DoughnutChart, Reference
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

PURPLE, CYAN, GREY = "351049", "56CBF8", "6B7280"
HEAD_FILL = PatternFill("solid", fgColor=PURPLE)
HEAD_FONT = Font(bold=True, color="FFFFFF")
TITLE_FONT = Font(bold=True, size=13, color=PURPLE)
REF_FONT = Font(bold=True, color=CYAN)
SRC_FONT = Font(italic=True, color=GREY, size=9)
LINK_FONT = Font(color="1D4ED8", underline="single")


PALETTE = ["351049", "56CBF8", "3E7BBF", "A651D8", "BDEAFB", "D0A8E9", "2B6D7F", "6B7280"]


def style_chart(ch, n_series, n_points):
    """GVR palette; pies colour each slice; horizontal bars read top-down like the slide."""
    from openpyxl.chart.marker import DataPoint
    if isinstance(ch, (PieChart, DoughnutChart)):
        s = ch.series[0]
        for i in range(n_points):
            pt = DataPoint(idx=i)
            pt.graphicalProperties.solidFill = PALETTE[i % len(PALETTE)]
            s.dPt.append(pt)
        return
    for i, s in enumerate(ch.series[:n_series]):
        c = PALETTE[i % len(PALETTE)]
        if isinstance(ch, LineChart):
            s.graphicalProperties.line.solidFill = c
            s.graphicalProperties.line.width = 28575
            s.smooth = False
        else:
            s.graphicalProperties.solidFill = c
            s.graphicalProperties.line.solidFill = c
    if isinstance(ch, BarChart) and ch.type == "bar":
        ch.x_axis.scaling.orientation = "maxMin"
        ch.y_axis.crosses = "max"  # keep the value axis at the bottom after reversing
    for ax in (getattr(ch, "x_axis", None), getattr(ch, "y_axis", None)):
        if ax is not None:
            ax.delete = False

# ---------------------------------------------------------------- text helpers

def plain(s):
    """Strip report inline markup: **bold**, _italic_, [[4.2]] -> §4.2."""
    s = "" if s is None else str(s)
    s = re.sub(r"\*\*(.+?)\*\*", r"\1", s)
    s = re.sub(r"(^|[\s(])_(.+?)_(?=[\s).,;:]|$)", r"\1\2", s)
    return re.sub(r"\[\[([\d.]+)\]\]", r"§\1", s)


NUM_RX = re.compile(r"^\s*(USD|US\$|\$|EUR|€)?\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*(%|Mn|Bn|Million|Billion|Thousand|K|pp)?\s*$", re.I)


def parse_number(v):
    """'USD 3,329.3 Mn' -> (3329.3, 'USD Mn'); '7.45%' -> (7.45, '%'); 12 -> (12, ''). None if not a single number."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v), ""
    m = NUM_RX.match(plain(v))
    if not m:
        return None
    cur, num, unit = m.group(1) or "", m.group(2), m.group(3) or ""
    unit = {"million": "Mn", "billion": "Bn"}.get(unit.lower(), unit)
    return float(num.replace(",", "")), " ".join(x for x in (cur.upper().replace("US$", "USD"), unit) if x)


def cell_value(v):
    """Table cells: numbers stay numbers, '9.17%' becomes 9.17 with a % format, everything else is text."""
    p = parse_number(v)
    if p is None:
        return plain(v), None
    num, unit = p
    if unit == "%":
        return num, '0.00"%"'
    return num, "#,##0.00" if abs(num) >= 1000 or num != int(num) else "#,##0"


# ---------------------------------------------------------------- workbook helpers

class Book:
    def __init__(self):
        self.wb = Workbook()
        self.contents = self.wb.active
        self.contents.title = "Contents"
        self.names = {"Contents"}
        self.items = []  # (kind, ref, title, sheet, location)

    def sheet(self, name):
        base = re.sub(r"[\[\]:*?/\\]", "-", name)[:31] or "Sheet"
        n, i = base, 2
        while n in self.names:
            suffix = f" ({i})"
            n = base[: 31 - len(suffix)] + suffix
            i += 1
        self.names.add(n)
        return self.wb.create_sheet(n)

    def save(self, path):
        self.wb.save(path)


def header_row(ws, row, values, col=1):
    for i, v in enumerate(values):
        c = ws.cell(row=row, column=col + i, value=plain(v))
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(wrap_text=True, vertical="center")


def title_block(ws, ref, title, note=None):
    ws.cell(row=1, column=1, value=ref).font = REF_FONT
    ws.cell(row=2, column=1, value=plain(title)).font = TITLE_FONT
    if note:
        ws.cell(row=3, column=1, value=note).font = SRC_FONT
    return 5  # first data row


def source_line(ws, row, source):
    if source:
        ws.cell(row=row + 1, column=1, value="Source: " + plain(source)).font = SRC_FONT


def autosize(ws, min_w=10, max_w=60):
    widths = {}
    for row in ws.iter_rows(min_row=4):
        for c in row:
            if c.value is not None:
                widths[c.column] = max(widths.get(c.column, 0), len(str(c.value)))
    for col, w in widths.items():
        ws.column_dimensions[get_column_letter(col)].width = max(min_w, min(max_w, w + 2))


def write_chart_sheet(ws, chart, start):
    """Write chart data as a table (categories down, series across). Returns (last_row, native chart or None)."""
    t = chart.get("type", "column")
    if t in ("scatter", "bubble"):
        cols = ["Label", chart.get("x_label") or "X", chart.get("y_label") or "Y"] + (["Size"] if t == "bubble" else [])
        header_row(ws, start, cols)
        r = start
        for p in chart.get("points", []):
            r += 1
            ws.cell(row=r, column=1, value=plain(p.get("label")))
            ws.cell(row=r, column=2, value=p.get("x"))
            ws.cell(row=r, column=3, value=p.get("y"))
            if t == "bubble":
                ws.cell(row=r, column=4, value=p.get("size"))
        return r, None

    cats = [plain(c) for c in chart.get("categories", [])]
    series = chart.get("series", [])
    suffix = chart.get("value_suffix", "")
    header_row(ws, start, ["Category"] + [plain(s.get("name", f"Series {i+1}")) + (f" ({suffix})" if suffix and suffix not in str(s.get("name", "")) else "") for i, s in enumerate(series)])
    fmt = f'0.{"0" * int(chart["decimals"])}' if chart.get("decimals") is not None else "#,##0.00"
    for i, cat in enumerate(cats):
        ws.cell(row=start + 1 + i, column=1, value=cat)
        for j, s in enumerate(series):
            vals = s.get("values", [])
            v = vals[i] if i < len(vals) else None
            c = ws.cell(row=start + 1 + i, column=2 + j, value=v)
            c.number_format = fmt
    last = start + len(cats)
    if not cats or not series:
        return last, None

    if t in ("pie", "donut"):
        ch = DoughnutChart() if t == "donut" else PieChart()
    elif t == "line":
        ch = LineChart()
    else:
        ch = BarChart()
        ch.type = "bar" if t == "bar" else "col"
        if t in ("stacked", "stacked100"):
            ch.grouping = "percentStacked" if t == "stacked100" else "stacked"
            ch.overlap = 100
    data = Reference(ws, min_col=2, max_col=1 + (1 if t in ("pie", "donut") else len(series)), min_row=start, max_row=last)
    ch.add_data(data, titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=start + 1, max_row=last))
    ch.height, ch.width = 7.5, 15
    style_chart(ch, len(series), len(cats))
    return last, ch


# ---------------------------------------------------------------- report walk

def walk(spec):
    """Yield (block, section number, section title) for visible blocks, numbering like renderer.js."""
    fig = tab = ch = 0
    for c in spec.get("chapters", []):
        if c.get("hidden"):
            continue
        ch += 1
        s = 0
        for sec in c.get("sections", []):
            if sec.get("hidden"):
                continue
            s += 1
            snum = f"{ch}.{s}"
            groups = [(snum, sec.get("title", ""), sec.get("blocks", []))]
            k = 0
            for ss in sec.get("subsections", []):
                if ss.get("hidden"):
                    continue
                k += 1
                groups.append((f"{snum}.{k}", ss.get("title", ""), ss.get("blocks", [])))
            for num, title, blocks in groups:
                for b in blocks:
                    if b.get("hidden"):
                        continue
                    t = b.get("type")
                    n = None
                    if t == "figure":
                        fig += 1
                        n = fig
                    elif t in ("table", "heatmap", "benchmark") and (t == "table" or b.get("caption")):
                        tab += 1
                        n = tab
                    yield b, n, num, title


def export(spec, out):
    book = Book()
    kpis, stats = [], {"figures": 0, "tables": 0, "kpis": 0}

    for b, n, snum, stitle in walk(spec):
        t = b.get("type")
        if t == "kpis":
            for it in b.get("items", []):
                kpis.append((f"§{snum}", stitle, it))
            continue
        if t == "figure" and b.get("chart"):
            ref = f"Fig. {n}"
            ws = book.sheet(f"Fig {n}")
            row = title_block(ws, ref, b.get("caption"), f"Section {snum} · {plain(stitle)}")
            last, chart = write_chart_sheet(ws, b["chart"], row)
            source_line(ws, last + 1, b.get("source"))
            autosize(ws)
            if chart is not None:
                chart.title = plain(b.get("caption"))[:80]
                ws.add_chart(chart, f"{get_column_letter(ws.max_column + 2)}5")
            book.items.append(("Figure", ref, b.get("caption"), ws.title, f"§{snum}"))
            stats["figures"] += 1
        elif t in ("table", "heatmap", "benchmark") and n:
            ref = f"Table {n}"
            ws = book.sheet(f"Table {n}")
            row = title_block(ws, ref, b.get("caption"), f"Section {snum} · {plain(stitle)}")
            if t == "heatmap":
                cols = [b.get("corner", "")] + list(b.get("columns", []))
                rows = [[lbl] + list(vals) for lbl, vals in zip(b.get("rows", []), b.get("values", []))]
                if b.get("row_totals"):
                    cols.append("Total")
                    rows = [r + [sum(x for x in r[1:] if isinstance(x, (int, float)))] for r in rows]
                if b.get("col_totals"):
                    rows.append(["Total"] + [sum(r[i] for r in rows if isinstance(r[i], (int, float))) for i in range(1, len(cols))])
            else:
                cols, rows = list(b.get("columns", [])), b.get("rows", [])
            header_row(ws, row, cols)
            for i, r in enumerate(rows):
                for j, v in enumerate(r):
                    val, fmt = cell_value(v)
                    c = ws.cell(row=row + 1 + i, column=1 + j, value=val)
                    if fmt:
                        c.number_format = fmt
            source_line(ws, row + len(rows) + 1, b.get("source"))
            autosize(ws)
            ws.freeze_panes = ws.cell(row=row + 1, column=2)
            book.items.append(("Table", ref, b.get("caption"), ws.title, f"§{snum}"))
            stats["tables"] += 1

    if kpis:
        ws = book.sheet("Key figures")
        row = title_block(ws, "KPIs", "Key figures", "Headline numbers from the report's KPI tiles")
        header_row(ws, row, ["Section", "Label", "Value (as shown)", "Value", "Unit"])
        for i, (where, _title, it) in enumerate(kpis, start=1):
            p = parse_number(it.get("value"))
            ws.cell(row=row + i, column=1, value=where)
            ws.cell(row=row + i, column=2, value=plain(it.get("label")))
            ws.cell(row=row + i, column=3, value=plain(it.get("value")))
            if p:
                ws.cell(row=row + i, column=4, value=p[0]).number_format = "#,##0.00"
                ws.cell(row=row + i, column=5, value=p[1])
        autosize(ws)
        book.items.insert(0, ("KPIs", "Key figures", f"{len(kpis)} headline figures", ws.title, ""))
        stats["kpis"] = len(kpis)
        book.wb.move_sheet(ws, offset=-(len(book.wb.sheetnames) - 2))

    write_contents(book, spec)
    book.save(out)
    stats["sheets"] = len(book.wb.sheetnames)
    return stats


def write_contents(book, spec):
    m = spec.get("meta", {})
    ws = book.contents
    ws.cell(row=1, column=1, value="Grand View Research").font = REF_FONT
    ws.cell(row=2, column=1, value=plain(m.get("title", ""))).font = Font(bold=True, size=16, color=PURPLE)
    ws.cell(row=3, column=1, value=plain(m.get("subtitle", ""))).font = Font(italic=True, color=GREY)
    meta = [
        ("Version", m.get("version")),
        ("Edition", m.get("edition")),
        ("Base year", m.get("base_year")),
        ("Forecast", m.get("forecast")),
        ("Unit", m.get("unit")),
        ("Prepared for", spec.get("brief", {}).get("client") or m.get("prepared_for")),
    ]
    r = 5
    for k, v in meta:
        if v not in (None, ""):
            ws.cell(row=r, column=1, value=k).font = Font(bold=True)
            ws.cell(row=r, column=2, value=plain(v))
            r += 1
    r += 1
    header_row(ws, r, ["Type", "Reference", "Title", "Where", "Sheet"])
    for i, (kind, ref, title, sheet, where) in enumerate(book.items, start=1):
        ws.cell(row=r + i, column=1, value=kind)
        ws.cell(row=r + i, column=2, value=ref)
        ws.cell(row=r + i, column=3, value=plain(title))
        ws.cell(row=r + i, column=4, value=where)
        c = ws.cell(row=r + i, column=5, value=sheet)
        c.hyperlink, c.font = f"#'{sheet}'!A1", LINK_FONT
    ws.cell(row=r + len(book.items) + 2, column=1, value="Figures are those printed in the report; calculated values keep their \"(calculated)\" label.").font = SRC_FONT
    for col, w in zip("ABCDE", (14, 14, 70, 10, 16)):
        ws.column_dimensions[col].width = w


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    with open(sys.argv[1], encoding="utf-8") as f:
        spec = json.load(f)
    print(json.dumps(export(spec, sys.argv[2])))


if __name__ == "__main__":
    main()
