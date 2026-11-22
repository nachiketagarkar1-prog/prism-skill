#!/usr/bin/env python3
"""Export the data behind a GVR presentation (charts, tables, KPIs) to an Excel workbook.

    python3 scripts/export_xlsx.py out/<Deck>_vN.pptx out/<Deck>_vN_data.xlsx [--spec deck.json]

Reads the rendered PPTX rather than the spec, because studio edit plans are applied to the PPTX
(apply_edits.py) and the spec can lag behind them. Native chart data is read from the chart parts,
the same way fact_check.py does. Hidden slides are skipped. --spec only supplies the title,
subtitle and date for the Contents sheet.

Workbook:
  Contents          deck metadata + one linked row per exported item
  Key figures       every KPI / headline card: value as shown, parsed number and unit
  S<n> Chart <k>    one sheet per chart: label, data, slide source line, native Excel chart
  S<n> Table <k>    one sheet per table

Prints JSON stats: {"sheets", "charts", "tables", "kpis"}.
Requires python-pptx and openpyxl.
"""
import argparse
import json
import re

from openpyxl import Workbook
from openpyxl.chart import BarChart, DoughnutChart, LineChart, PieChart, Reference, AreaChart
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from pptx import Presentation

PURPLE, CYAN, GREY = "351049", "5CCBF5", "6B7280"
HEAD_FILL = PatternFill("solid", fgColor=PURPLE)
HEAD_FONT = Font(bold=True, color="FFFFFF")
TITLE_FONT = Font(bold=True, size=13, color=PURPLE)
REF_FONT = Font(bold=True, color="2B9FD0")
SRC_FONT = Font(italic=True, color=GREY, size=9)
LINK_FONT = Font(color="1D4ED8", underline="single")


PALETTE = ["351049", "5CCBF5", "3E7BBF", "A651D8", "BDEAFB", "D0A8E9", "2B6D7F", "6B7280"]


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
EMU = 914400
NS = {"c": "http://schemas.openxmlformats.org/drawingml/2006/chart"}

KPI_SHAPES = {"KPI", "Headline Card"}
# Cards are also used for plain text; a card counts as a key figure only when one of its lines is a
# short figure such as "USD 3,329.3 Mn → USD 5,893.1 Mn" or "Gel / column, 8.28%".
CARD_SHAPES = {"Card"}
FIGURE_LINE = re.compile(r"^(USD|US\$|EUR|€|\$|[-+]?\d)|\d(\.\d+)?\s*%$")

# ---------------------------------------------------------------- text helpers

NUM_RX = re.compile(r"^\s*(USD|US\$|\$|EUR|€)?\s*([-+]?\d[\d,]*(?:\.\d+)?)\s*(%|Mn|Bn|Million|Billion|Thousand|K|pp)?\s*$", re.I)


def parse_number(v):
    """'USD 3,329.3 Mn' -> (3329.3, 'USD Mn'); '7.45%' -> (7.45, '%'). None if not a single number."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v), ""
    m = NUM_RX.match(str(v or ""))
    if not m:
        return None
    cur, num, unit = m.group(1) or "", m.group(2), m.group(3) or ""
    unit = {"million": "Mn", "billion": "Bn"}.get(unit.lower(), unit)
    return float(num.replace(",", "")), " ".join(x for x in (cur.upper().replace("US$", "USD"), unit) if x)


def cell_value(v):
    p = parse_number(v)
    if p is None:
        return str(v), None
    num, unit = p
    if unit == "%":
        return num, '0.00"%"'
    return num, "#,##0.00" if abs(num) >= 1000 or num != int(num) else "#,##0"


def text(sh):
    return sh.text_frame.text.strip() if getattr(sh, "has_text_frame", False) and sh.has_text_frame else ""


# ---------------------------------------------------------------- slide reading

def label_for(shape, shapes):
    """The block label (purple text over a cyan rule) sits directly above a chart or table."""
    best = None
    for s in shapes:
        if s.name != "Label" or not text(s):
            continue
        if abs(s.left - shape.left) <= 0.15 * EMU and 0 <= shape.top - s.top <= 0.75 * EMU:
            if best is None or s.top > best.top:
                best = s
    return text(best) if best else ""


def is_figure_line(t):
    """A short figure, not a sentence that happens to start with a number."""
    return len(t) <= 45 and ";" not in t and not t.rstrip().endswith(".") and bool(FIGURE_LINE.search(t))


def kpi_cards(slide):
    """Pair each KPI / headline rectangle with the text boxes inside it: first line value, rest label."""
    shapes = list(slide.shapes)
    out = []
    for card in shapes:
        if card.name not in KPI_SHAPES | CARD_SHAPES:
            continue
        inner = []
        for s in shapes:
            t = text(s)
            if s is card or not t or s.name in KPI_SHAPES | CARD_SHAPES:
                continue
            cx, cy = s.left + s.width / 2, s.top + s.height / 2
            if card.left <= cx <= card.left + card.width and card.top <= cy <= card.top + card.height:
                inner.append((s.top, s.left, t))
        if card.has_text_frame and text(card):
            inner.append((card.top, card.left, text(card)))
        inner.sort()
        parts = [t for _, _, t in inner]
        if not parts:
            continue
        if card.name in KPI_SHAPES:
            out.append((parts[0], " · ".join(parts[1:])))
            continue
        fig = next((i for i, t in enumerate(parts) if is_figure_line(t)), None)
        if fig is not None:
            out.append((parts[fig], " · ".join(parts[:fig]) or " · ".join(parts[fig + 1:])))
    return out


def _cache(el):
    pts = list(el.iter(f"{{{NS['c']}}}pt")) if el is not None else []
    vals = {}
    for p in pts:
        v = p.find("c:v", NS)
        vals[int(p.get("idx"))] = v.text if v is not None else None
    return [vals.get(i) for i in range(max(vals) + 1)] if vals else []


def chart_data(chart):
    """Return {'kind', 'categories', 'series':[(name, values)], 'xy':[(name, xs, ys, sizes)]}."""
    ctype = str(chart.chart_type)
    data = {"type": ctype, "categories": [], "series": [], "xy": []}
    for ser in chart._chartSpace.iter(f"{{{NS['c']}}}ser"):
        name_el = ser.find("c:tx", NS)
        # Series name: the cached value (c:v), not the cell reference (c:f) next to it.
        v_el = next(name_el.iter(f"{{{NS['c']}}}v"), None) if name_el is not None else None
        name = (v_el.text or "").strip() if v_el is not None else f"Series {len(data['series']) + len(data['xy']) + 1}"
        if ser.find("c:xVal", NS) is not None:  # scatter / bubble
            xs = [_num(v) for v in _cache(ser.find("c:xVal", NS))]
            ys = [_num(v) for v in _cache(ser.find("c:yVal", NS))]
            sz = [_num(v) for v in _cache(ser.find("c:bubbleSize", NS))]
            data["xy"].append((name, xs, ys, sz))
            continue
        cats = _cache(ser.find("c:cat", NS))
        if cats and not data["categories"]:
            data["categories"] = cats
        data["series"].append((name, [_num(v) for v in _cache(ser.find("c:val", NS))]))
    return data


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return v


# ---------------------------------------------------------------- workbook

class Book:
    def __init__(self):
        self.wb = Workbook()
        self.contents = self.wb.active
        self.contents.title = "Contents"
        self.names = {"Contents"}
        self.items = []

    def sheet(self, name):
        base = re.sub(r"[\[\]:*?/\\]", "-", name)[:31] or "Sheet"
        n, i = base, 2
        while n in self.names:
            suffix = f" ({i})"
            n = base[: 31 - len(suffix)] + suffix
            i += 1
        self.names.add(n)
        return self.wb.create_sheet(n)


def header_row(ws, row, values):
    for i, v in enumerate(values):
        c = ws.cell(row=row, column=1 + i, value=v)
        c.fill, c.font = HEAD_FILL, HEAD_FONT
        c.alignment = Alignment(wrap_text=True, vertical="center")


def title_block(ws, ref, title, note):
    ws.cell(row=1, column=1, value=ref).font = REF_FONT
    ws.cell(row=2, column=1, value=title).font = TITLE_FONT
    if note:
        ws.cell(row=3, column=1, value=note).font = SRC_FONT
    return 5


def autosize(ws, min_w=10, max_w=60):
    widths = {}
    for row in ws.iter_rows(min_row=4):
        for c in row:
            if c.value is not None:
                widths[c.column] = max(widths.get(c.column, 0), len(str(c.value)))
    for col, w in widths.items():
        ws.column_dimensions[get_column_letter(col)].width = max(min_w, min(max_w, w + 2))


def write_chart(ws, d, start):
    if d["xy"]:
        bubble = any(sz for _, _, _, sz in d["xy"])
        header_row(ws, start, ["Series", "X", "Y"] + (["Size"] if bubble else []))
        r = start
        for name, xs, ys, sz in d["xy"]:
            for i, x in enumerate(xs):
                r += 1
                ws.cell(row=r, column=1, value=name)
                ws.cell(row=r, column=2, value=x)
                ws.cell(row=r, column=3, value=ys[i] if i < len(ys) else None)
                if bubble:
                    ws.cell(row=r, column=4, value=sz[i] if i < len(sz) else None)
        return r, None

    cats, series = d["categories"], d["series"]
    header_row(ws, start, ["Category"] + [n for n, _ in series])
    for i, cat in enumerate(cats):
        ws.cell(row=start + 1 + i, column=1, value=cat)
        for j, (_, vals) in enumerate(series):
            c = ws.cell(row=start + 1 + i, column=2 + j, value=vals[i] if i < len(vals) else None)
            c.number_format = "#,##0.00"
    last = start + len(cats)
    if not cats or not series:
        return last, None

    t = d["type"]
    if "DOUGHNUT" in t:
        ch = DoughnutChart()
    elif "PIE" in t:
        ch = PieChart()
    elif "LINE" in t:
        ch = LineChart()
    elif "AREA" in t:
        ch = AreaChart()
    else:
        ch = BarChart()
        ch.type = "bar" if t.startswith("BAR") else "col"
        if "STACKED_100" in t:
            ch.grouping, ch.overlap = "percentStacked", 100
        elif "STACKED" in t:
            ch.grouping, ch.overlap = "stacked", 100
    one = "PIE" in t or "DOUGHNUT" in t
    ch.add_data(Reference(ws, min_col=2, max_col=2 if one else 1 + len(series), min_row=start, max_row=last), titles_from_data=True)
    ch.set_categories(Reference(ws, min_col=1, min_row=start + 1, max_row=last))
    ch.height, ch.width = 7.5, 15
    style_chart(ch, len(series), len(cats))
    return last, ch


def export(pptx_path, out, spec=None):
    prs = Presentation(pptx_path)
    book = Book()
    kpis = []
    stats = {"charts": 0, "tables": 0, "kpis": 0}

    for n, slide in enumerate(prs.slides, start=1):
        if slide._element.get("show") == "0":
            continue
        shapes = list(slide.shapes)
        title = next((text(s) for s in shapes if s.name == "Title"), "") or next((text(s) for s in shapes if s.is_placeholder and text(s)), "")
        source = next((text(s) for s in shapes if s.name == "Source"), "")
        where = f"Slide {n}"

        for value, label in kpi_cards(slide):
            kpis.append((where, title, value, label))

        k_chart = k_table = 0
        for sh in shapes:
            if getattr(sh, "has_chart", False) and sh.has_chart:
                k_chart += 1
                d = chart_data(sh.chart)
                lbl = label_for(sh, shapes) or (sh.chart.chart_title.text_frame.text if sh.chart.has_title else "") or "Chart"
                ws = book.sheet(f"S{n} Chart {k_chart}")
                row = title_block(ws, f"{where} · Chart {k_chart}", lbl, title)
                last, ch = write_chart(ws, d, row)
                if source:
                    ws.cell(row=last + 2, column=1, value=source).font = SRC_FONT
                autosize(ws)
                if ch is not None:
                    ch.title = lbl[:80]
                    ws.add_chart(ch, f"{get_column_letter(ws.max_column + 2)}5")
                book.items.append(("Chart", f"{where} · Chart {k_chart}", lbl, ws.title, title))
                stats["charts"] += 1
            elif getattr(sh, "has_table", False) and sh.has_table:
                k_table += 1
                rows = [[c.text.strip() for c in r.cells] for r in sh.table.rows]
                if not rows:
                    continue
                lbl = label_for(sh, shapes) or "Table"
                ws = book.sheet(f"S{n} Table {k_table}")
                row = title_block(ws, f"{where} · Table {k_table}", lbl, title)
                header_row(ws, row, rows[0])
                for i, r in enumerate(rows[1:], start=1):
                    for j, v in enumerate(r):
                        val, fmt = cell_value(v)
                        c = ws.cell(row=row + i, column=1 + j, value=val)
                        if fmt:
                            c.number_format = fmt
                if source:
                    ws.cell(row=row + len(rows) + 1, column=1, value=source).font = SRC_FONT
                autosize(ws)
                ws.freeze_panes = ws.cell(row=row + 1, column=2)
                book.items.append(("Table", f"{where} · Table {k_table}", lbl, ws.title, title))
                stats["tables"] += 1

    if kpis:
        ws = book.sheet("Key figures")
        row = title_block(ws, "KPIs", "Key figures", "Headline numbers from KPI tiles and headline cards")
        header_row(ws, row, ["Slide", "Slide title", "Label", "Value (as shown)", "Value", "Unit"])
        for i, (where, stitle, value, label) in enumerate(kpis, start=1):
            p = parse_number(value)
            for j, v in enumerate((where, stitle, label, value)):
                ws.cell(row=row + i, column=1 + j, value=v)
            if p:
                ws.cell(row=row + i, column=5, value=p[0]).number_format = "#,##0.00"
                ws.cell(row=row + i, column=6, value=p[1])
        autosize(ws)
        book.items.insert(0, ("KPIs", "Key figures", f"{len(kpis)} headline figures", ws.title, ""))
        book.wb.move_sheet(ws, offset=-(len(book.wb.sheetnames) - 2))
        stats["kpis"] = len(kpis)

    write_contents(book, prs, pptx_path, spec)
    book.wb.save(out)
    stats["sheets"] = len(book.wb.sheetnames)
    return stats


def write_contents(book, prs, pptx_path, spec):
    meta = (spec or {}).get("meta", {})
    cover = [text(s) for s in prs.slides[0].shapes if text(s)] if len(prs.slides) else []
    title = meta.get("title") or prs.core_properties.title or (cover[0] if cover else "")
    version = re.search(r"_(v\d+)\.pptx$", pptx_path)
    ws = book.contents
    ws.cell(row=1, column=1, value="Grand View Research").font = REF_FONT
    ws.cell(row=2, column=1, value=title).font = Font(bold=True, size=16, color=PURPLE)
    ws.cell(row=3, column=1, value=meta.get("subtitle", "")).font = Font(italic=True, color=GREY)
    r = 5
    for k, v in (("Version", version.group(1) if version else ""), ("Date", meta.get("date", "")), ("Slides", len(prs.slides))):
        if v not in (None, ""):
            ws.cell(row=r, column=1, value=k).font = Font(bold=True)
            ws.cell(row=r, column=2, value=v)
            r += 1
    r += 1
    header_row(ws, r, ["Type", "Reference", "Title", "Slide title", "Sheet"])
    for i, (kind, ref, lbl, sheet, stitle) in enumerate(book.items, start=1):
        for j, v in enumerate((kind, ref, lbl, stitle)):
            ws.cell(row=r + i, column=1 + j, value=v)
        c = ws.cell(row=r + i, column=5, value=sheet)
        c.hyperlink, c.font = f"#'{sheet}'!A1", LINK_FONT
    ws.cell(row=r + len(book.items) + 2, column=1, value="Values are the native chart and table data in the delivered presentation.").font = SRC_FONT
    for col, w in zip("ABCDE", (10, 22, 50, 60, 16)):
        ws.column_dimensions[col].width = w


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("pptx")
    ap.add_argument("out")
    ap.add_argument("--spec", help="deck spec JSON (title, subtitle and date for the Contents sheet)")
    a = ap.parse_args()
    spec = json.load(open(a.spec, encoding="utf-8")) if a.spec else None
    print(json.dumps(export(a.pptx, a.out, spec)))


if __name__ == "__main__":
    main()
