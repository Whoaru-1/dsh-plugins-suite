#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SPSS-style statistics engine for the DSH SPSS plugin.

CLI contract (fixed, do not change):
    python3 analyze.py --payload <request.json> --out-json <result.json>

Request JSON:
    { "inputPath": "<abs path>",              # .sav | .csv | .tsv | .xlsx | .xls
      "inputFormat": "sav"|"csv"|"xlsx",      # optional hint
      "sheet": "...",                         # xlsx only, optional
      "csvOptions": {"delimiter": ",", "encoding": "utf-8", "header": true},
      "variables": ["colA","colB"],           # optional subset
      "analyses": [ {"type": "...", "variables": [...], "groupBy": "...", "options": {...}} ],
      "outDir": "<abs dir>",                  # REQUIRED for export
      "exports": ["csv","xlsx","docx","png","json","sav"],
      "outBaseName": "result" }

Result JSON:
    { "ok": true,
      "dataset": {"rows": N, "columns": M, "variables": [{"name","label","type","measure"}],
                  "sourcePath": "..."},
      "analyses": [ {"type","title","tables":[{"title","columns","rows"}], "note"} ],
      "outputs": [ {"kind","path","label"} ],
      "log": ["..."] }
    On error: {"ok": false, "error": "...", "traceback": "..."} and exit code 1.

Only stdlib + numpy/pandas/scipy/matplotlib/openpyxl/python-docx/pyreadstat are used.
Never throws on a single analysis: failures are logged and processing continues.
All numbers are JSON-safe (NaN/Inf -> null).
"""

from __future__ import annotations

import argparse
import csv
import itertools
import json
import math
import os
import re
import sys
import tempfile
import traceback
import warnings

warnings.filterwarnings("ignore")

# --------------------------------------------------------------------------- #
# Optional dependency probing (degrade gracefully)
# --------------------------------------------------------------------------- #
try:
    import numpy as np
    import pandas as pd
    from scipy import stats as sstats
    HAVE_CORE = True
except Exception:  # pragma: no cover - core is a hard requirement
    np = None
    pd = None
    sstats = None
    HAVE_CORE = False

try:
    import pyreadstat  # type: ignore
    HAVE_PYREADSTAT = True
except Exception:
    pyreadstat = None  # type: ignore
    HAVE_PYREADSTAT = False

try:
    import matplotlib  # type: ignore
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt  # type: ignore
    from matplotlib import font_manager as _font_manager  # type: ignore
    HAVE_MPL = True
except Exception:
    matplotlib = None  # type: ignore
    plt = None  # type: ignore
    _font_manager = None  # type: ignore
    HAVE_MPL = False

try:
    import openpyxl  # type: ignore  # noqa: F401
    HAVE_OPENPYXL = True
except Exception:
    openpyxl = None  # type: ignore
    HAVE_OPENPYXL = False

try:
    import docx  # type: ignore  # noqa: F401
    from docx.shared import Pt as _DocxPt  # type: ignore
    HAVE_DOCX = True
except Exception:
    docx = None  # type: ignore
    _DocxPt = None  # type: ignore
    HAVE_DOCX = False

__version__ = "1.0.0"

# --------------------------------------------------------------------------- #
# Constants
# --------------------------------------------------------------------------- #
DEFAULT_OUT_BASE = "result"
EXPORT_KINDS = ("csv", "xlsx", "docx", "png", "json", "sav")

# Analysis types that can legitimately produce a chart.
CHART_TYPES = {"freq", "crosstab", "descriptives", "corr", "regression", "anova"}

# SPSS -> measure inference keywords (case-insensitive substring match).
_MEASURE_HINTS = {
    "nominal": ("nominal", "名义", "定类"),
    "ordinal": ("ordinal", "有序", "顺序", "等级"),
    "scale": ("scale", "scale", "标度", "定距", "度量"),
}

FONT_CANDIDATES = [
    "PingFang SC", "Heiti SC", "Hiragino Sans GB", "Songti SC", "STHeiti",
    "Arial Unicode MS", "Microsoft YaHei", "SimHei", "SimSun",
    "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC",
    "WenQuanYi Zen Hei", "DejaVu Sans",
]


# --------------------------------------------------------------------------- #
# Small JSON / number helpers
# --------------------------------------------------------------------------- #
def _clean_float(x, sig=6):
    """Round to `sig` significant digits; return None for NaN/Inf/non-numeric."""
    try:
        if x is None:
            return None
        v = float(x)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    if v == 0:
        return 0.0
    # Significant-digit rounding without scientific-notation weirdness.
    r = float(f"{v:.{sig}g}")
    if r == int(r) and abs(r) < 1e15:
        return r
    return r


def _norm_float(v, sig=6):
    """Normalize a float for tables: kill signed zero, round to `sig` sig figs."""
    v = float(v)
    if not math.isfinite(v):
        return None
    if v == 0:
        return 0.0  # collapses -0.0 as well
    r = float(f"{v:.{sig}g}")
    return 0.0 if r == 0 else r


def _p_round(p, sig=6):
    """p-values: keep tiny values meaningful instead of collapsing to 0."""
    if p is None:
        return None
    try:
        v = float(p)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(v):
        return None
    v = min(max(v, 0.0), 1.0)
    return _clean_float(v, sig=sig)


def to_json_safe(obj):
    """Recursively convert anything to strict JSON-safe python values."""
    if obj is None or isinstance(obj, (bool, str)):
        return obj
    if isinstance(obj, (np.bool_,)):
        return bool(obj)
    if isinstance(obj, (int,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        v = float(obj)
        if not math.isfinite(v):
            return None
        return _norm_float(v)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, dict):
        return {str(k): to_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set)):
        return [to_json_safe(v) for v in obj]
    if isinstance(obj, np.ndarray):
        return [to_json_safe(v) for v in obj.tolist()]
    if pd is not None and isinstance(obj, pd.Series):
        return [to_json_safe(v) for v in obj.tolist()]
    if pd is not None and isinstance(obj, pd.DataFrame):
        return [to_json_safe(v) for v in obj.to_numpy().tolist()]
    # datetime / Timestamp / Timedelta / anything else
    try:
        if pd is not None and isinstance(obj, (pd.Timestamp,)):
            return obj.isoformat() if not pd.isna(obj) else None
    except Exception:
        pass
    if hasattr(obj, "item"):
        try:
            return to_json_safe(obj.item())
        except Exception:
            pass
    if hasattr(obj, "isoformat"):
        try:
            return obj.isoformat()
        except Exception:
            pass
    return str(obj)


def _is_number_label(v):
    try:
        f = float(v)
        return math.isfinite(f)
    except (TypeError, ValueError):
        return False


def _fmt_value(v):
    """Human/table friendly display for a raw cell value."""
    if v is None:
        return ""
    if isinstance(v, (np.floating, float)):
        fv = float(v)
        if math.isnan(fv) or math.isinf(fv):
            return ""
        if fv == int(fv) and abs(fv) < 1e15:
            return str(int(fv))
        return f"{fv:g}"
    if isinstance(v, (np.integer, int)):
        return str(int(v))
    if isinstance(v, (np.bool_, bool)):
        return "True" if v else "False"
    return str(v)


def _sort_key(v):
    """Stable, SPSS-like ordering: numbers numerically, strings naturally."""
    if isinstance(v, (np.integer, int, np.floating, float)) and not isinstance(v, bool):
        fv = float(v)
        if math.isfinite(fv):
            return (0, fv, "")
    s = str(v)
    return (1, 0.0, s)


def _natural_key(s):
    return [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", str(s))]


# --------------------------------------------------------------------------- #
# Data loading
# --------------------------------------------------------------------------- #
class Dataset:
    """Loaded data plus SPSS-ish metadata."""

    def __init__(self, df, variables, source_path, log):
        self.df = df
        self.variables = variables  # list[dict(name,label,type,measure)]
        self.source_path = source_path
        self.log = log
        self._by_name = {v["name"]: v for v in variables}

    # -- metadata helpers ---------------------------------------------------
    def meta(self, name):
        return self._by_name.get(name, {"name": name, "label": None, "type": "numeric", "measure": "scale"})

    def label(self, name):
        return self.meta(name).get("label") or name

    def measure(self, name):
        return (self.meta(name).get("measure") or "scale").lower()

    def col(self, name):
        """Return the Series for `name` (raises KeyError if absent)."""
        if name not in self.df.columns:
            raise KeyError(f"variable not found: {name}")
        return self.df[name]

    def numeric(self, name):
        """Numeric coercion of a variable; non-numeric values become NaN."""
        s = self.col(name)
        return pd.to_numeric(s, errors="coerce")

    def has(self, name):
        return name in self.df.columns

    @property
    def n_rows(self):
        return int(len(self.df))


def _infer_measure(name, series, value_labels):
    """Infer SPSS-style measure: nominal | ordinal | scale."""
    if value_labels and name in value_labels:
        # Labelled categorical -> nominal unless numeric with many levels.
        pass
    try:
        nonnull = series.dropna()
        if len(nonnull) == 0:
            return "nominal" if series.dtype == object else "scale"
        if series.dtype == bool or str(series.dtype) == "category":
            return "nominal"
        if series.dtype == object or pd.api.types.is_string_dtype(series):
            uniq = nonnull.nunique()
            return "nominal" if uniq <= max(2, len(nonnull) // 2) else "nominal"
        num = pd.to_numeric(nonnull, errors="coerce").dropna()
        if len(num) == 0:
            return "nominal"
        uniq = num.nunique()
        is_int = bool(np.allclose(num.to_numpy(dtype=float), np.round(num.to_numpy(dtype=float))))
        if is_int and uniq <= 10:
            return "ordinal"
        return "scale"
    except Exception:
        return "scale"


def _read_biff2(path):
    """Read an Excel 2.0/2.1 (BIFF2) workbook into a DataFrame.

    BIFF2 is the 1987-era binary format: a bare record stream with no OLE2
    container, which every modern reader rejects ("File is not a zip file",
    "Excel file format cannot be determined"). Statistical packages and older
    exporters still produce such files, often named .xls, so the engine decodes
    the stream itself instead of failing on the extension.

    Only the record types needed to rebuild a single sheet's cell grid are
    handled: BOF/EOF, INTEGER, NUMBER, RK, LABEL, BLANK. Unknown records are
    skipped by their declared length, which is what makes the walk safe.

    Args:
        path: absolute path to the file.
    Returns:
        a pandas DataFrame, or None when the stream is not BIFF2.
    """
    import struct as _struct

    with open(path, "rb") as handle:
        data = handle.read()
    if len(data) < 8:
        return None
    first_type, first_len = _struct.unpack("<HH", data[0:4])
    # BOF: 0x0009 (BIFF2), 0x0209 (BIFF3), 0x0409 (BIFF4). Only BIFF2 cells are
    # decoded here; later variants carry a different cell record layout.
    if first_type != 0x0009:
        return None

    cells = {}
    max_row = -1
    max_col = -1
    pos = 0
    while pos + 4 <= len(data):
        rtype, rlen = _struct.unpack("<HH", data[pos:pos + 4])
        if rlen > 0x2000 or pos + 4 + rlen > len(data):
            break
        body = data[pos + 4:pos + 4 + rlen]
        value = None
        row = col = None
        try:
            if rtype in (0x0002, 0x0202) and len(body) >= 8:      # INTEGER
                row, col = _struct.unpack("<HH", body[0:4])
                value = _struct.unpack("<H", body[6:8])[0]
            elif rtype in (0x0003, 0x0203) and len(body) >= 14:   # NUMBER
                row, col = _struct.unpack("<HH", body[0:4])
                value = _struct.unpack("<d", body[6:14])[0]
            elif rtype in (0x002D, 0x027E) and len(body) >= 10:   # RK (BIFF3+)
                row, col = _struct.unpack("<HH", body[0:4])
                rk = _struct.unpack("<I", body[6:10])[0]
                if rk & 0x02:
                    value = rk >> 2
                else:
                    value = _struct.unpack("<d", _struct.pack("<Q", (rk & 0xFFFFFFFC) << 32))[0]
                if rk & 0x01:
                    value = value / 100.0
            elif rtype in (0x0004, 0x0204) and len(body) >= 9:    # LABEL
                row, col = _struct.unpack("<HH", body[0:4])
                if rtype == 0x0004:
                    count = body[7]
                    raw = body[8:8 + count]
                else:
                    count = _struct.unpack("<H", body[6:8])[0]
                    raw = body[8:8 + count]
                # BIFF2 strings are byte-per-character; UTF-8 covers the ASCII
                # column names these files carry, latin-1 never raises.
                try:
                    value = raw.decode("utf-8")
                except UnicodeDecodeError:
                    value = raw.decode("latin-1")
            elif rtype == 0x0001 and len(body) >= 4:              # BLANK
                row, col = _struct.unpack("<HH", body[0:4])
                value = None
        except _struct.error:
            value = None
        if row is not None and value is not None:
            cells[(row, col)] = value
            max_row = max(max_row, row)
            max_col = max(max_col, col)
        pos += 4 + rlen

    if max_row < 0 or max_col < 0:
        return None

    import pandas as _pd
    grid = [[cells.get((r, c)) for c in range(max_col + 1)] for r in range(max_row + 1)]
    header = grid[0]
    columns = []
    for index, name in enumerate(header):
        label = str(name).strip() if name is not None else ""
        columns.append(label if label else f"col{index + 1}")
    return _pd.DataFrame(grid[1:], columns=columns)


def load_dataset(req, log):
    """Read the input file into a Dataset. Raises on hard failure."""
    path = req.get("inputPath")
    if not path:
        raise ValueError("request.inputPath is required")
    path = os.path.abspath(os.path.expanduser(str(path)))
    if not os.path.isfile(path):
        raise FileNotFoundError(f"input file not found: {path}")

    hint = str(req.get("inputFormat") or "").strip().lower().lstrip(".")
    ext = os.path.splitext(path)[1].lower().lstrip(".")
    fmt = hint or ext
    if fmt in ("text", "txt", "tsv", "tab"):
        fmt = "tsv" if (fmt in ("tsv", "tab") or ext == "tsv") else "csv"
    if fmt == "csv" and ext == "tsv":
        fmt = "tsv"
    if fmt in ("xls", "xlsx", "excel"):
        fmt = "xlsx"
    if fmt in ("sav", "spss"):
        fmt = "sav"

    labels = {}          # column_names_to_labels
    value_labels = {}    # variable_value_labels
    measure_hints = {}   # name -> original measure string
    df = None

    if fmt == "sav":
        if HAVE_PYREADSTAT:
            try:
                df, meta = pyreadstat.read_sav(path)
                labels = dict(getattr(meta, "column_names_to_labels", {}) or {})
                value_labels = dict(getattr(meta, "variable_value_labels", {}) or {})
                log.append(f"Read SPSS .sav via pyreadstat: {df.shape[0]} rows x {df.shape[1]} columns")
            except Exception as exc:
                log.append(f"pyreadstat.read_sav failed ({exc}); trying pandas.read_spss")
                df = None
        else:
            log.append("pyreadstat unavailable; using pandas.read_spss fallback")
        if df is None:
            try:
                df = pd.read_spss(path)
                log.append(f"Read SPSS .sav via pandas.read_spss: {df.shape[0]} rows x {df.shape[1]} columns")
            except Exception as exc:
                raise RuntimeError(
                    f"cannot read .sav file (pyreadstat={HAVE_PYREADSTAT}): {exc}") from exc

    elif fmt == "xlsx":
        opts = dict(req.get("csvOptions") or {})
        sheet = req.get("sheet")
        try:
            if sheet not in (None, "", "0"):
                df = pd.read_excel(path, sheet_name=sheet)
            elif isinstance(sheet, int) or (sheet == "0"):
                df = pd.read_excel(path, sheet_name=int(sheet))
            else:
                df = pd.read_excel(path, sheet_name=0)
        except ImportError:
            # No openpyxl -> try reading as csv as a last resort.
            df = pd.read_csv(path, sep=opts.get("delimiter") or ",", encoding=opts.get("encoding") or "utf-8")
        except Exception as exc:
            # A file named .xls/.xlsx may be a pre-OLE2 Excel 2.x (BIFF2) stream
            # or a renamed export; pandas rejects those outright. Decode the
            # binary records ourselves before giving up.
            log.append(f"pandas.read_excel failed ({type(exc).__name__}: {exc}); trying the BIFF2 reader")
            df = _read_biff2(path)
            if df is None:
                raise RuntimeError(f"cannot read Excel file: {exc}") from exc
            log.append(f"Read legacy Excel 2.x (BIFF2) stream: {df.shape[0]} rows x {df.shape[1]} columns")
        if not log or not log[-1].startswith("Read legacy Excel 2.x"):
            log.append(f"Read Excel via pandas.read_excel: {df.shape[0]} rows x {df.shape[1]} columns")

    else:  # csv / tsv
        opts = dict(req.get("csvOptions") or {})
        delim = opts.get("delimiter")
        if isinstance(delim, str) and delim in ("\\t", "tab", "TAB"):
            delim = "\t"
        if not delim:
            delim = "\t" if fmt == "tsv" else ","
        if delim == "," and fmt == "tsv":
            delim = "\t"
        enc = opts.get("encoding") or "utf-8-sig"
        header = opts.get("header", True)
        header = 0 if header not in (False, "false", "False", 0) else None
        read_err = None
        for enc_try in [enc, "utf-8-sig", "utf-8", "gb18030", "big5", "latin-1"]:
            try:
                df = pd.read_csv(path, sep=delim, encoding=enc_try, header=header,
                                 keep_default_na=True, na_values=["", "NA", "N/A", "NaN", "nan", "."])
                if enc_try != enc:
                    log.append(f"CSV decoded with fallback encoding '{enc_try}'")
                break
            except LookupError:
                read_err = f"unknown encoding {enc_try}"
                continue
            except UnicodeDecodeError as exc:
                read_err = str(exc)
                continue
            except Exception as exc:
                read_err = str(exc)
                continue
        if df is None:
            raise RuntimeError(f"cannot read CSV file: {read_err}")
        if header is None:
            df.columns = [f"V{i + 1}" for i in range(df.shape[1])]
        log.append(f"Read delimited text ({'tab' if delim == chr(9) else repr(delim)}): "
                   f"{df.shape[0]} rows x {df.shape[1]} columns")

    # Clean column names -> unique, non-empty strings.
    seen = {}
    new_cols = []
    for i, c in enumerate(df.columns):
        name = str(c).strip() if c is not None else ""
        if not name or name.lower().startswith("unnamed:"):
            name = f"V{i + 1}"
        base = name
        k = 1
        while name in seen:
            k += 1
            name = f"{base}_{k}"
        seen[name] = True
        new_cols.append(name)
    df.columns = new_cols

    # Drop fully-empty rows / columns that pandas sometimes produces.
    if len(df) and df.shape[1]:
        try:
            empty_cols = [c for c in df.columns if df[c].isna().all()]
        except Exception:
            empty_cols = []
        if empty_cols:
            log.append(f"Dropped {len(empty_cols)} fully-empty column(s): {empty_cols[:8]}")

    # Build variable metadata.
    varmeta = []
    for c in df.columns:
        s = df[c]
        if pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s):
            vtype = "numeric"
        elif pd.api.types.is_datetime64_any_dtype(s):
            vtype = "datetime"
        else:
            vtype = "string"
        lbl = labels.get(c)
        if not lbl:
            lbl = None
        m = measure_hints.get(c) or _infer_measure(c, s, value_labels)
        varmeta.append({"name": str(c), "label": lbl, "type": vtype, "measure": m})
        if c in value_labels and value_labels[c]:
            varmeta[-1]["valueLabels"] = to_json_safe(value_labels[c])
        if c in labels and labels[c]:
            varmeta[-1]["valueLabels"] = None

    # Keep only non-empty columns' metadata in line with df.
    varmeta = [v for v in varmeta if v["name"] in df.columns]

    # Optional variable subset.
    wanted = req.get("variables")
    if isinstance(wanted, list) and wanted:
        want = [str(w) for w in wanted if str(w) in df.columns]
        missing = [str(w) for w in wanted if str(w) not in df.columns]
        if missing:
            log.append(f"Ignored {len(missing)} unknown requested variable(s): {missing[:10]}")
        if want:
            df = df[want].copy()
            by = {v["name"]: v for v in varmeta}
            varmeta = [by[w] for w in want]
            log.append(f"Variable subset applied: {len(want)} column(s)")
        else:
            log.append("Variable subset had no valid names; using all columns")

    return Dataset(df, varmeta, path, log)


# --------------------------------------------------------------------------- #
# Table helpers
# --------------------------------------------------------------------------- #
def _table(title, columns, rows, **extra):
    t = {"title": title, "columns": list(columns),
         "rows": [[to_json_safe(v) for v in r] for r in rows]}
    t.update({k: to_json_safe(v) for k, v in extra.items()})
    return t


def _result(atype, title, tables, note=None, meta=None):
    out = {"type": atype, "title": title, "tables": tables}
    if note is not None:
        out["note"] = note
    if meta is not None:
        out["meta"] = to_json_safe(meta)
    return out


def _require(ds, variables, n=None, atype="analysis"):
    if not variables:
        raise ValueError(f"{atype}: no variables specified")
    miss = [v for v in variables if not ds.has(v)]
    if miss:
        raise ValueError(f"{atype}: variable(s) not found: {miss}")
    if n is not None and len(variables) < n:
        raise ValueError(f"{atype}: needs at least {n} variable(s), got {len(variables)}")


def _value_labels(ds, name):
    return (ds.meta(name) or {}).get("valueLabels") or {}


def _display_value(ds, name, v):
    """Render a raw category value, honouring value labels when present."""
    rv = to_json_safe(v)
    vl = _value_labels(ds, name)
    if vl:
        for k, lab in vl.items():
            try:
                if _is_number_label(k) and _is_number_label(rv) and float(k) == float(rv):
                    return f"{_fmt_value(rv)} = {lab}"
                if str(k) == str(rv):
                    return f"{_fmt_value(rv)} = {lab}"
            except Exception:
                continue
    return _fmt_value(v)


# --------------------------------------------------------------------------- #
# Analysis: FREQUENCIES
# --------------------------------------------------------------------------- #
def analyze_freq(ds, spec):
    variables = list(spec.get("variables") or [])
    _require(ds, variables, atype="freq")
    opts = spec.get("options") or {}
    max_categories = int(opts.get("maxCategories") or 200)

    tables = []
    notes = []
    for name in variables:
        s = ds.col(name)
        total = int(len(s))
        valid_s = s.dropna()
        n_valid = int(len(valid_s))
        n_missing = total - n_valid
        vc = valid_s.value_counts(dropna=True)
        # Order like SPSS (ascending values) — natural for numbers & strings.
        items = list(vc.items())
        items.sort(key=lambda kv: _sort_key(kv[0]))
        truncated = False
        if len(items) > max_categories:
            truncated = True
        rows = []
        cum = 0
        shown = items[:max_categories]
        for idx, (val, freq) in enumerate(shown):
            freq = int(freq)
            cum += freq
            pct = (freq / total * 100.0) if total else None
            vpct = (freq / n_valid * 100.0) if n_valid else None
            # Force the final cumulative percent to exactly 100 when nothing is truncated.
            last = (idx == len(shown) - 1) and not truncated
            cpct = (100.0 if last else (cum / n_valid * 100.0)) if n_valid else None
            rows.append([
                _display_value(ds, name, val),
                to_json_safe(val),
                freq,
                _norm_float(pct) if pct is not None else None,
                _norm_float(vpct) if vpct is not None else None,
                _norm_float(cpct) if cpct is not None else None,
            ])
        rows.append(["Total", None, total, 100.0 if total else None, None, None])
        rows.append(["Missing", None, n_missing,
                     _norm_float(n_missing / total * 100.0) if total else None, None, None])
        tables.append(_table(
            f"{name}",
            ["Category", "Value", "Freq", "Percent", "ValidPercent", "CumulativePercent"],
            rows,
            variable=name, label=ds.label(name),
        ))
        if truncated:
            notes.append(f"{name}: frequency table truncated to first {max_categories} categories")
        if n_valid == 0:
            notes.append(f"{name}: no valid (non-missing) cases")

    title = "Frequencies" if len(variables) > 1 else f"Frequencies: {ds.label(variables[0])}"
    return _result("freq", title, tables, note="; ".join(notes) or None,
                   meta={"variables": variables})


# --------------------------------------------------------------------------- #
# Analysis: DESCRIPTIVES
# --------------------------------------------------------------------------- #
def analyze_descriptives(ds, spec):
    variables = list(spec.get("variables") or [])
    _require(ds, variables, atype="descriptives")

    cols = ["Variable", "Label", "N", "Missing", "Mean", "StdErrorMean", "Median",
            "StdDev", "Variance", "Min", "Max", "Range", "Skewness", "Kurtosis"]
    rows = []
    for name in variables:
        x = ds.numeric(name).to_numpy(dtype=float)
        total = int(x.size)
        valid = x[np.isfinite(x)]
        n = int(valid.size)
        miss = total - n
        if n == 0:
            rows.append([name, ds.label(name), 0, miss] + [None] * 10)
            continue
        mean = float(valid.mean())
        sd = float(valid.std(ddof=1)) if n > 1 else None
        se = float(sd / math.sqrt(n)) if (sd is not None and n > 0) else None
        var = float(valid.var(ddof=1)) if n > 1 else None
        med = float(np.median(valid))
        mn = float(valid.min())
        mx = float(valid.max())
        skew = kurt = None
        if n > 2 and sd and sd > 0:
            try:
                skew = float(sstats.skew(valid, bias=False))
            except Exception:
                skew = None
            try:
                kurt = float(sstats.kurtosis(valid, fisher=True, bias=False))
            except Exception:
                kurt = None
        rows.append([
            name, ds.label(name), n, miss,
            _clean_float(mean), _clean_float(se), _clean_float(med),
            _clean_float(sd), _clean_float(var), _clean_float(mn), _clean_float(mx),
            _clean_float(mx - mn), _clean_float(skew), _clean_float(kurt),
        ])

    note = ("N = number of valid (non-missing) cases. Skewness/Kurtosis use "
            "bias-corrected (SPSS) formulas; Kurtosis is excess kurtosis.")
    title = "Descriptive Statistics" if len(variables) > 1 else f"Descriptives: {ds.label(variables[0])}"
    return _result("descriptives", title,
                   [_table("Descriptive Statistics", cols, rows)],
                   note=note, meta={"variables": variables})


# --------------------------------------------------------------------------- #
# Analysis: CROSSTABS
# --------------------------------------------------------------------------- #
def _chi_square_block(ct, ds_row, ds_col, table_title):
    """Build the Chi-Square Tests table for a 2-D numpy count matrix."""
    row_idx = list(range(ct.shape[0]))
    col_idx = list(range(ct.shape[1]))
    try:
        chi2, p, dof, expected = sstats.chi2_contingency(ct, correction=False)
    except Exception:
        n = int(ct.sum())
        dof = (ct.shape[0] - 1) * (ct.shape[1] - 1)
        if dof <= 0:
            return None, None, None
        chi2, p = float("nan"), float("nan")
        with np.errstate(divide="ignore", invalid="ignore"):
            expected = np.outer(ct.sum(axis=1), ct.sum(axis=0)) / max(n, 1)
    pearson_chi2, pearson_p, pearson_df = float(chi2), float(p), int(dof)

    # Continuity-corrected (Yates) chi-square: only defined for 2x2.
    yates_chi2 = yates_p = None
    if ct.shape == (2, 2):
        try:
            ychi2, yp, _, _ = sstats.chi2_contingency(ct, correction=True)
            yates_chi2, yates_p = float(ychi2), float(yp)
        except Exception:
            pass

    # Likelihood ratio (G^2).
    lr_chi2 = lr_p = None
    try:
        with np.errstate(divide="ignore", invalid="ignore"):
            mask = (expected > 0) & (ct > 0)
            g2 = 2.0 * float((ct[mask] * np.log(ct[mask] / expected[mask])).sum())
        lr_chi2 = g2
        lr_p = float(sstats.chi2.sf(g2, dof))
    except Exception:
        pass

    # Phi and Cramer's V.
    n = int(ct.sum())
    min_dim = min(ct.shape[0], ct.shape[1]) - 1
    phi = cramers_v = None
    if n > 0:
        phi = math.sqrt(max(pearson_chi2, 0.0) / n) if math.isfinite(pearson_chi2) else None
        if min_dim > 0 and math.isfinite(pearson_chi2):
            cramers_v = math.sqrt(max(pearson_chi2, 0.0) / (n * min_dim))

    # Expected-count diagnostics.
    n_cells = int(np.size(expected))
    n_lt5 = int(np.sum(expected < 5))
    n_lt1 = int(np.sum(expected < 1))
    min_expected = float(np.min(expected)) if n_cells else None
    pct_lt5 = (n_lt5 / n_cells * 100.0) if n_cells else None

    tests = [
        ["Pearson Chi-Square", _clean_float(pearson_chi2), pearson_df, _p_round(pearson_p),
         "%.1f%% cells (%.1f) have expected count < 5" % (pct_lt5 or 0.0, n_lt5)],
        ["Continuity Correction (Yates)", _clean_float(yates_chi2),
         pearson_df if ct.shape == (2, 2) else None, _p_round(yates_p),
         "only for 2x2 tables" if ct.shape != (2, 2) else
         "%.1f%% cells (%.1f) have expected count < 5" % (pct_lt5 or 0.0, n_lt5)],
        ["Likelihood Ratio", _clean_float(lr_chi2), pearson_df, _p_round(lr_p),
         "%.1f%% cells (%.1f) have expected count < 5" % (pct_lt5 or 0.0, n_lt5)],
    ]
    symmetry = []
    for label, tr in (("Phi", phi), ("Cramer's V", cramers_v)):
        if tr is None:
            symmetry.append([label, None, None, None])
        else:
            if ct.shape == (2, 2) and label == "Phi":
                sp = pearson_p
            else:
                sp = float(sstats.chi2.sf((tr ** 2) * n * (min_dim if label == "Cramer's V" else 1), pearson_df))
            symmetry.append([label, _clean_float(tr), _p_round(sp), None])

    note = (f"Expected count < 5 in {n_lt5} of {n_cells} cells ({pct_lt5 or 0.0:.1f}%); "
            f"minimum expected count = {_fmt_value(_clean_float(min_expected))}"
            + ("; cells with expected count < 1: %d (consider exact tests)" % n_lt1 if n_lt1 else ""))

    tables = [
        _table("Chi-Square Tests", ["Statistic", "Value", "df", "AsymptoticSig(2-sided)", "Note"], tests,
               mergedFormat="Value,df,AsymptoticSig(2-sided)"),
        _table("Symmetric Measures", ["Measure", "Value", "AsymptoticSig(2-sided)", "Note"], symmetry),
    ]
    meta = {
        "n": n,
        "pearsonChi2": _clean_float(pearson_chi2), "pearsonDf": pearson_df,
        "pearsonP": _p_round(pearson_p),
        "yatesChi2": _clean_float(yates_chi2), "yatesP": _p_round(yates_p),
        "likelihoodRatioChi2": _clean_float(lr_chi2), "likelihoodRatioP": _p_round(lr_p),
        "phi": _clean_float(phi), "cramersV": _clean_float(cramers_v),
        "minExpected": _clean_float(min_expected),
        "cellsExpectedLt5": n_lt5, "cellsExpectedLt1": n_lt1, "pctCellsExpectedLt5": _clean_float(pct_lt5, 4),
        "warning": ("expected counts < 5 in more than 20% of cells; chi-square may be unreliable"
                    if pct_lt5 is not None and pct_lt5 > 20 else None),
    }
    return tables, note, meta


def analyze_crosstab(ds, spec):
    variables = list(spec.get("variables") or [])
    group_by = spec.get("groupBy")
    if group_by and ds.has(group_by):
        if len(variables) >= 1:
            row_var, col_var = (variables[0], group_by) if variables[0] != group_by else (variables[1], group_by) if len(variables) > 1 else (None, None)
        else:
            row_var, col_var = None, None
        if row_var is None:
            raise ValueError("crosstab: need at least one variable in addition to groupBy")
    else:
        _require(ds, variables, n=2, atype="crosstab")
        row_var, col_var = variables[0], variables[1]

    for v in (row_var, col_var):
        if not ds.has(v):
            raise ValueError(f"crosstab: variable not found: {v}")

    sub = ds.df[[row_var, col_var]].dropna()
    if len(sub) == 0:
        raise ValueError("crosstab: no valid cases after removing missing values")

    def _row_label(v):
        return _display_value(ds, row_var, v)

    def _col_label(v):
        return _display_value(ds, col_var, v)

    # Ordered categories (SPSS-style ascending).
    def _cats(series, disp):
        vals = list(pd.unique(series))
        vals.sort(key=_sort_key)
        return vals

    rvals = _cats(sub[row_var], _row_label)
    cvals = _cats(sub[col_var], _col_label)

    ct_df = pd.crosstab(sub[row_var], sub[col_var])
    ct = ct_df.to_numpy(dtype=float)
    n = int(ct.sum())
    row_tot = ct.sum(axis=1)
    col_tot = ct.sum(axis=0)
    with np.errstate(divide="ignore", invalid="ignore"):
        expected = np.outer(row_tot, col_tot) / max(n, 1)

    tables = []
    note_parts = []

    # Cells table (count / expected / row% / col% / std. residual).
    cells_cols = ["RowVar", "RowCategory", "ColVar", "ColCategory", "Count", "ExpectedCount",
                  "RowPercent", "ColPercent", "Residual", "StdResidual"]
    cell_rows = []
    for i, rv in enumerate(rvals):
        for j, cv in enumerate(cvals):
            obs = ct[i, j] if i < ct.shape[0] and j < ct.shape[1] else 0.0
            exp = expected[i, j]
            rp = (obs / row_tot[i] * 100.0) if row_tot[i] else None
            cp = (obs / col_tot[j] * 100.0) if col_tot[j] else None
            resid = obs - exp
            std = (resid / math.sqrt(exp)) if exp > 0 else None
            cell_rows.append([
                row_var, _row_label(rv), col_var, _col_label(cv),
                int(obs), _clean_float(exp, 4), _clean_float(rp, 4), _clean_float(cp, 4),
                _clean_float(resid, 4), _clean_float(std, 4),
            ])
    tables.append(_table(f"{row_var} * {col_var} Crosstabulation (cells)", cells_cols, cell_rows))

    # Wide crosstab matrix (counts with totals), SPSS style.
    wide_cols = ["Row"] + [_col_label(c) for c in cvals] + ["Total", "RowPercentTotal"]
    wide_rows = []
    for i, rv in enumerate(rvals):
        vals = [int(ct[i, j]) if j < ct.shape[1] else 0 for j in range(len(cvals))]
        wide_rows.append([_row_label(rv)] + vals + [int(row_tot[i]), 100.0])
    wide_rows.append(["Total"] + [int(col_tot[j]) for j in range(len(cvals))] + [n, None])
    wide_rows.append(["ColumnPercent"] + [_clean_float(col_tot[j] / n * 100.0 if n else None, 4)
                                          for j in range(len(cvals))] + [None, None])
    tables.append(_table(f"{row_var} * {col_var} Crosstabulation (counts)", wide_cols, wide_rows))

    chi_tables, chi_note, chi_meta = _chi_square_block(ct, row_var, col_var, f"{row_var}*{col_var}")
    if chi_tables:
        tables.extend(chi_tables)
    if chi_note:
        note_parts.append(chi_note)

    dof = (ct.shape[0] - 1) * (ct.shape[1] - 1)
    if dof <= 0:
        note_parts.append("cross-tabulation has a single row or column; chi-square is undefined")
    note = "; ".join(note_parts)

    meta = {
        "rowVar": row_var, "colVar": col_var, "n": n,
        "rowCategories": [_row_label(v) for v in rvals],
        "colCategories": [_col_label(v) for v in cvals],
        "counts": ct.tolist(), "expected": expected.tolist(),
        "rowTotals": row_tot.tolist(), "colTotals": col_tot.tolist(),
    }
    if chi_meta:
        meta.update({k: v for k, v in chi_meta.items()})

    title = f"Crosstabs: {ds.label(row_var)} * {ds.label(col_var)}"
    return _result("crosstab", title, tables, note=note, meta=meta)


# --------------------------------------------------------------------------- #
# Analysis: T-TESTS
# --------------------------------------------------------------------------- #
def analyze_ttest_one(ds, spec):
    variables = list(spec.get("variables") or [])
    _require(ds, variables, atype="ttest_one")
    opts = spec.get("options") or {}
    test_value = opts.get("testValue", opts.get("test_value", 0.0))
    try:
        test_value = float(test_value)
    except (TypeError, ValueError):
        test_value = 0.0
    conf = float(opts.get("confidence", 0.95) or 0.95)
    conf = min(max(conf, 0.0001), 0.9999)

    stats_rows = []
    test_rows = []
    for name in variables:
        x = ds.numeric(name)
        valid = x.dropna().to_numpy(dtype=float)
        n = int(valid.size)
        if n == 0:
            stats_rows.append([name, 0, None, None, None])
            test_rows.append([name, None, None, None, None, None, None, None])
            continue
        mean = float(valid.mean())
        sd = float(valid.std(ddof=1)) if n > 1 else None
        se = float(sd / math.sqrt(n)) if (sd is not None and n > 0) else None
        stats_rows.append([name, n, _clean_float(mean), _clean_float(sd), _clean_float(se)])
        if n < 2 or se is None or se == 0:
            test_rows.append([name, None, n - 1, None, None, _clean_float(mean - test_value), None, None])
            continue
        t = (mean - test_value) / se
        dfree = n - 1
        p = float(2.0 * sstats.t.sf(abs(t), dfree))
        md = mean - test_value
        tcrit = float(sstats.t.ppf(1.0 - (1.0 - conf) / 2.0, dfree))
        lo, hi = md - tcrit * se, md + tcrit * se
        test_rows.append([name, _clean_float(t), dfree, _p_round(p), _clean_float(md),
                          _clean_float(lo), _clean_float(hi), None])

    tables = [
        _table("One-Sample Statistics", ["Variable", "N", "Mean", "StdDev", "StdErrorMean"], stats_rows),
        _table("One-Sample Test", ["Variable", "t", "df", "Sig(2-tailed)", "MeanDifference",
                                   "ConfidenceIntervalLower", "ConfidenceIntervalUpper",
                                   "TestValue"], test_rows),
    ]
    note = f"Test value = {_fmt_value(test_value)}; {conf * 100:.1f}% confidence interval for the mean difference."
    return _result("ttest_one", "One-Sample T Test", tables, note=note,
                   meta={"testValue": test_value, "confidence": conf, "variables": variables})


def _split_groups(g):
    """Split a group Series into sorted valid groups.

    Returns [(display_label, group_value, group_series)], preserving the original
    index so callers can align the group with a dependent variable.  Membership
    uses a boolean mask (never pandas index alignment).
    """
    valid = g.dropna()
    if len(valid) == 0:
        return []
    cats = list(pd.unique(valid))
    cats.sort(key=_sort_key)
    out = []
    for c in cats:
        mask = (valid == c).to_numpy()
        out.append((_fmt_value(c), c, valid[mask]))
    return out


def analyze_ttest_independent(ds, spec):
    variables = list(spec.get("variables") or [])
    group_by = spec.get("groupBy")
    _require(ds, variables, atype="ttest_independent")
    if not group_by:
        if len(variables) >= 2:
            group_by = variables[-1]
            variables = variables[:-1]
        else:
            raise ValueError("ttest_independent: require variables and a groupBy (or 2+ variables)")
    if not ds.has(group_by):
        raise ValueError(f"ttest_independent: group variable not found: {group_by}")

    opts = spec.get("options") or {}
    conf = float(opts.get("confidence", 0.95) or 0.95)
    conf = min(max(conf, 0.0001), 0.9999)
    groups_all = _split_groups(ds.col(group_by))
    if len(groups_all) < 2:
        raise ValueError(f"ttest_independent: group variable '{group_by}' needs at least 2 groups")

    stat_rows, test_rows, lev_rows = [], [], []
    notes = []
    if len(groups_all) > 2:
        notes.append(f"group variable has {len(groups_all)} groups; using the first two "
                     f"({groups_all[0][0]}, {groups_all[1][0]}). Use anova for 3+ groups.")

    chosen = groups_all[:2]
    g1_label, g1_val, g1_s = chosen[0]
    g2_label, g2_val, g2_s = chosen[1]

    for name in variables:
        x = ds.numeric(name)
        sub = pd.DataFrame({"x": x, "g": ds.col(group_by)}).dropna()
        a = sub.loc[sub["g"] == g1_val, "x"].to_numpy(dtype=float)
        b = sub.loc[sub["g"] == g2_val, "x"].to_numpy(dtype=float)
        for gl, arr in ((g1_label, a), (g2_label, b)):
            n = int(arr.size)
            sd = float(arr.std(ddof=1)) if n > 1 else None
            stat_rows.append([name, gl, n, _clean_float(arr.mean()) if n else None,
                              _clean_float(sd),
                              _clean_float(sd / math.sqrt(n)) if (sd is not None and n) else None])
        if a.size < 2 or b.size < 2:
            test_rows.append([name, None, None, None, None, None, None, None, None, None, None, None])
            continue

        # Levene's test (SPSS uses the mean-centred version).
        try:
            lf, lp = sstats.levene(a, b, center="mean")
            lev_rows.append([name, _clean_float(lf), 1, int(a.size + b.size - 2), _p_round(lp)])
        except Exception:
            lev_rows.append([name, None, 1, None, None])

        m1, m2 = float(a.mean()), float(b.mean())
        v1, v2 = float(a.var(ddof=1)), float(b.var(ddof=1))
        n1, n2 = int(a.size), int(b.size)
        sp2 = ((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2)
        se_pooled = math.sqrt(sp2 * (1.0 / n1 + 1.0 / n2)) if sp2 >= 0 else 0.0
        df_pooled = n1 + n2 - 2
        md = m1 - m2
        if se_pooled > 0:
            t_p = md / se_pooled
            p_p = float(2.0 * sstats.t.sf(abs(t_p), df_pooled))
            tc = float(sstats.t.ppf(1.0 - (1.0 - conf) / 2.0, df_pooled))
            lo_p, hi_p = md - tc * se_pooled, md + tc * se_pooled
        else:
            t_p = p_p = lo_p = hi_p = None
        se_diff_pooled = se_pooled

        # Welch.
        denom = v1 / n1 + v2 / n2
        if denom > 0:
            t_w = md / math.sqrt(denom)
            df_w = (denom ** 2) / (((v1 / n1) ** 2) / (n1 - 1) + ((v2 / n2) ** 2) / (n2 - 1))
            p_w = float(2.0 * sstats.t.sf(abs(t_w), df_w))
            tcw = float(sstats.t.ppf(1.0 - (1.0 - conf) / 2.0, df_w))
            sew = math.sqrt(denom)
            lo_w, hi_w = md - tcw * sew, md + tcw * sew
        else:
            t_w = p_w = df_w = lo_w = hi_w = sew = None

        # SPSS's "Independent Samples Test" merges equal-variances and Welch rows.
        test_rows.append([
            name,
            _clean_float(md), _clean_float(se_diff_pooled),
            _clean_float(t_p), df_pooled, _p_round(p_p), _clean_float(lo_p), _clean_float(hi_p),
            _clean_float(t_w), _clean_float(df_w) if df_w is not None else None, _p_round(p_w),
        ])

    tables = [
        _table("Group Statistics",
               ["Variable", "Group", "N", "Mean", "StdDev", "StdErrorMean"], stat_rows),
        _table("Independent Samples Test",
               ["Variable", "MeanDifference", "StdErrorDifference",
                "t_equalVariancesAssumed", "df", "Sig(2-tailed)", "CI95Lower", "CI95Upper",
                "t_equalVariancesNotAssumed", "dfWelch", "Sig(2-tailed)Welch"],
               test_rows),
    ]
    if lev_rows:
        tables.append(_table("Levene's Test for Equality of Variances",
                             ["Variable", "F", "df1", "df2", "Sig"], lev_rows))
    note = (f"Grouping variable: {group_by}; groups compared: {g1_label} vs {g2_label}; "
            f"{conf * 100:.1f}% CI for the mean difference. "
            "Use the Welch row when Levene's Sig <= .05.")
    return _result("ttest_independent", f"Independent-Samples T Test: {group_by}", tables,
                   note=note, meta={"groupBy": group_by, "groups": [g1_label, g2_label],
                                    "confidence": conf, "variables": variables})


def analyze_paired_ttest(ds, spec):
    variables = list(spec.get("variables") or [])
    opts = spec.get("options") or {}
    pairs = opts.get("pairs")
    pair_list = []
    if isinstance(pairs, list) and pairs:
        for pr in pairs:
            if isinstance(pr, (list, tuple)) and len(pr) >= 2:
                pair_list.append((str(pr[0]), str(pr[1])))
    if not pair_list:
        _require(ds, variables, n=2, atype="paired_ttest")
        pair_list = [(variables[i], variables[i + 1]) for i in range(0, len(variables) - 1, 2)]
    if not pair_list:
        raise ValueError("paired_ttest: no valid pairs found")
    for a, b in pair_list:
        if not ds.has(a) or not ds.has(b):
            raise ValueError(f"paired_ttest: variable not found: {[v for v in (a, b) if not ds.has(v)]}")

    conf = float(opts.get("confidence", 0.95) or 0.95)
    conf = min(max(conf, 0.0001), 0.9999)

    stat_rows, corr_rows, test_rows = [], [], []
    for a, b in pair_list:
        sub = pd.DataFrame({"a": ds.numeric(a), "b": ds.numeric(b)}).dropna()
        n = int(len(sub))
        pa, pb = sub["a"].to_numpy(dtype=float), sub["b"].to_numpy(dtype=float)
        stat_rows.append([f"{a} - {b}", n,
                          _clean_float(pa.mean()) if n else None, _clean_float(pb.mean()) if n else None,
                          _clean_float(pa.std(ddof=1)) if n > 1 else None,
                          _clean_float(pb.std(ddof=1)) if n > 1 else None,
                          _clean_float(pa.std(ddof=1) / math.sqrt(n)) if n > 1 else None,
                          _clean_float(pb.std(ddof=1) / math.sqrt(n)) if n > 1 else None])
        if n > 2:
            try:
                r, rp = sstats.pearsonr(pa, pb)
                corr_rows.append([f"{a} & {b}", n, _clean_float(r), _p_round(rp)])
            except Exception:
                corr_rows.append([f"{a} & {b}", n, None, None])
        else:
            corr_rows.append([f"{a} & {b}", n, None, None])

        d = pa - pb
        if n < 2:
            test_rows.append([f"{a} - {b}", None, None, None, None, None, None])
            continue
        md = float(d.mean())
        sd = float(d.std(ddof=1))
        se = sd / math.sqrt(n) if sd > 0 else 0.0
        dfree = n - 1
        if se > 0:
            t = md / se
            p = float(2.0 * sstats.t.sf(abs(t), dfree))
            tc = float(sstats.t.ppf(1.0 - (1.0 - conf) / 2.0, dfree))
            lo, hi = md - tc * se, md + tc * se
        else:
            t = p = None
            lo = hi = md
        test_rows.append([f"{a} - {b}", _clean_float(md), _clean_float(sd), _clean_float(se),
                          _clean_float(t), dfree, _p_round(p)])
    tables = [
        _table("Paired Samples Statistics",
               ["Pair", "N", "Mean1", "Mean2", "StdDev1", "StdDev2", "StdErrorMean1", "StdErrorMean2"],
               stat_rows),
        _table("Paired Samples Correlations", ["Pair", "N", "Correlation", "Sig"], corr_rows),
        _table("Paired Samples Test",
               ["Pair", "MeanDifference", "StdDev", "StdErrorMean", "t", "df", "Sig(2-tailed)"],
               test_rows),
    ]
    return _result("paired_ttest", "Paired-Samples T Test", tables,
                   note=f"{conf * 100:.1f}% CI for the paired mean difference is reported in 'meta'; "
                        "difference is defined as variable1 - variable2.",
                   meta={"confidence": conf, "pairs": [list(p) for p in pair_list]})


# --------------------------------------------------------------------------- #
# Analysis: ONE-WAY ANOVA
# --------------------------------------------------------------------------- #
def analyze_anova(ds, spec):
    variables = list(spec.get("variables") or [])
    group_by = spec.get("groupBy")
    opts = spec.get("options") or {}
    _require(ds, variables, atype="anova")
    if not group_by:
        if len(variables) >= 2:
            group_by = variables[-1]
            variables = variables[:-1]
        else:
            raise ValueError("anova: require a dependent variable and a groupBy factor")
    if not ds.has(group_by):
        raise ValueError(f"anova: factor not found: {group_by}")

    do_posthoc = bool(opts.get("postHoc", opts.get("posthoc", opts.get("tukey", False))))
    do_desc = opts.get("descriptives", True) is not False

    desc_rows, lev_rows, anova_rows, posthoc_rows = [], [], [], []
    effect_tables = []
    notes = []

    for name in variables:
        sub = pd.DataFrame({"y": ds.numeric(name), "g": ds.col(group_by)}).dropna()
        groups = _split_groups(sub["g"])
        groups_all = [(lbl, val, sub.loc[sub["g"] == val, "y"].to_numpy(dtype=float))
                      for lbl, val, _ in groups]
        if len(groups_all) < 2:
            raise ValueError(f"anova: factor '{group_by}' needs at least 2 groups with data")
        for lbl, val, arr in groups_all:
            n = int(arr.size)
            sd = float(arr.std(ddof=1)) if n > 1 else None
            desc_rows.append([name, lbl, n, _clean_float(arr.mean()) if n else None,
                              _clean_float(sd),
                              _clean_float(sd / math.sqrt(n)) if (sd and n) else None,
                              _clean_float(arr.min()) if n else None,
                              _clean_float(arr.max()) if n else None])

        arrays = [arr for _, _, arr in groups_all if arr.size > 0]
        try:
            lf, lp = sstats.levene(*arrays, center="mean")
            lev_rows.append([name, _clean_float(lf), len(arrays) - 1,
                             int(sum(len(a) for a in arrays) - len(arrays)), _p_round(lp)])
        except Exception:
            lev_rows.append([name, None, len(arrays) - 1, None, None])

        grand = np.concatenate(arrays)
        n_total = int(grand.size)
        grand_mean = float(grand.mean())
        k = len(arrays)
        ss_between = 0.0
        ss_within = 0.0
        for arr in arrays:
            n_i = arr.size
            m_i = float(arr.mean())
            ss_between += n_i * (m_i - grand_mean) ** 2
            ss_within += float(((arr - m_i) ** 2).sum())
        ss_total = ss_between + ss_within
        df_b = k - 1
        df_w = n_total - k
        df_t = n_total - 1
        ms_b = ss_between / df_b if df_b > 0 else None
        ms_w = ss_within / df_w if df_w > 0 else None
        if ms_w and ms_w > 0:
            F = ms_b / ms_w
            p = float(sstats.f.sf(F, df_b, df_w))
        else:
            F = p = None
        eta2 = (ss_between / ss_total) if ss_total > 0 else None
        omega2 = ((ss_between - df_b * ms_w) / (ss_total + ms_w)) if (ms_w is not None and ss_total + ms_w > 0) else None
        fcrit = float(sstats.f.ppf(0.95, df_b, df_w)) if df_w > 0 else None

        anova_rows.append([name, "Between Groups", _clean_float(ss_between), df_b,
                           _clean_float(ms_b), _clean_float(F), _p_round(p)])
        anova_rows.append([name, "Within Groups", _clean_float(ss_within), df_w, _clean_float(ms_w), None, None])
        anova_rows.append([name, "Total", _clean_float(ss_total), df_t, None, None, None])

        # Effect sizes table
        effect_tables.append(_table(
            "ANOVA Effect Sizes",
            ["Variable", "EtaSquared", "OmegaSquared", "FCritical05"],
            [[name, _clean_float(eta2), _clean_float(omega2), _clean_float(fcrit)]]))

        # Post-hoc: Tukey HSD (multiple comparisons) when requested.
        if do_posthoc and k >= 3:
            sig = []
            for lbl, val, arr in groups_all:
                if arr.size > 1:
                    sig.append((lbl, arr))
            try:
                if hasattr(sstats, "tukey_hsd") and len(sig) >= 2:
                    res = sstats.tukey_hsd(*[a for _, a in sig])
                    # res.pvalue is a matrix of pairwise p-values.
                    pmat = np.asarray(res.pvalue, dtype=float)
                    for i in range(len(sig)):
                        for j in range(i + 1, len(sig)):
                            mi, mj = float(sig[i][1].mean()), float(sig[j][1].mean())
                            pu = pmat[i, j] if pmat.ndim == 2 else float("nan")
                            posthoc_rows.append([name, sig[i][0], sig[j][0],
                                                 _clean_float(mi - mj), _p_round(pu)])
                elif k == 2:
                    t, pu = sstats.ttest_ind(sig[0][1], sig[1][1], equal_var=True)
                    posthoc_rows.append([name, sig[0][0], sig[1][0],
                                         _clean_float(float(sig[0][1].mean()) - float(sig[1][1].mean())),
                                         _p_round(pu)])
            except Exception as exc:
                notes.append(f"post-hoc Tukey failed: {exc}")

    # Assemble SPSS output order: Descriptives -> ANOVA -> Effect Sizes -> Levene -> Post hoc.
    tables = []
    if do_desc:
        tables.append(_table("Descriptives",
                             ["Variable", "Group", "N", "Mean", "StdDev", "StdErrorMean", "Min", "Max"],
                             desc_rows))
    tables.append(_table("ANOVA", ["Variable", "Source", "SumOfSquares", "df", "MeanSquare", "F", "Sig"],
                         anova_rows))
    tables.extend(effect_tables)
    if lev_rows:
        tables.append(_table("Test of Homogeneity of Variances (Levene)",
                             ["Variable", "LeveneStatistic", "df1", "df2", "Sig"], lev_rows))
    if posthoc_rows:
        tables.append(_table("Post Hoc Tests: Tukey HSD (Multiple Comparisons)",
                             ["Variable", "Group", "ComparedTo", "MeanDifference (I-J)", "Sig"], posthoc_rows))
    elif do_posthoc:
        notes.append("Tukey post-hoc requested but not available (needs >= 3 groups with ≥2 cases each)")

    note = ("Homogeneity of variance assumed; check Levene's test. Type III sum of squares "
            "for the one-way model; eta squared = SS_between / SS_total.")
    if notes:
        note += " " + " ".join(notes)
    return _result("anova", f"One-Way ANOVA: {', '.join(variables)} by {group_by}", tables,
                   note=note, meta={"groupBy": group_by, "variables": variables})


# --------------------------------------------------------------------------- #
# Analysis: CORRELATIONS
# --------------------------------------------------------------------------- #
def analyze_corr(ds, spec):
    variables = list(spec.get("variables") or [])
    _require(ds, variables, atype="corr")
    opts = spec.get("options") or {}
    method = str(opts.get("method") or "both").lower()
    want_pearson = method in ("both", "pearson", "all", "")
    want_spearman = method in ("both", "spearman", "all", "rho", "")

    if len(variables) == 2 and not opts.get("matrix"):
        pairs = [tuple(variables)]
        matrix_mode = False
    else:
        pairs = list(itertools.combinations(variables, 2))
        matrix_mode = True
    if not pairs:
        raise ValueError("corr: need at least 2 variables")

    def _rows(method_name):
        fn = sstats.pearsonr if method_name == "pearson" else sstats.spearmanr
        out = []
        for a, b in pairs:
            sub = pd.DataFrame({"a": ds.numeric(a), "b": ds.numeric(b)}).dropna()
            n = int(len(sub))
            if n < 3:
                out.append([f"{a} - {b}", None, None, None, n])
                continue
            xa = sub["a"].to_numpy(dtype=float)
            xb = sub["b"].to_numpy(dtype=float)
            try:
                r, p = fn(xa, xb)
                r, p = float(r), float(p)
                sig = "**" if p < 0.01 else ("*" if p < 0.05 else "")
                out.append([f"{a} - {b}", _clean_float(r), _p_round(p), sig, n])
            except Exception:
                out.append([f"{a} - {b}", None, None, None, n])
        return out

    tables = []
    if want_pearson:
        tables.append(_table("Pearson Correlations", ["Pair", "Correlation", "Sig(2-tailed)", "Significance", "N"],
                             _rows("pearson")))
    if want_spearman:
        tables.append(_table("Spearman's Rho Correlations", ["Pair", "Correlation", "Sig(2-tailed)", "Significance", "N"],
                             _rows("spearman")))

    # Matrix tables (SPSS-style square matrices with Sig and N below).
    if matrix_mode or len(variables) > 2:
        def _mat(method_name):
            fn = sstats.pearsonr if method_name == "pearson" else sstats.spearmanr
            m = len(variables)
            rmat = [[None] * m for _ in range(m)]
            pmat = [[None] * m for _ in range(m)]
            nmat = [[None] * m for _ in range(m)]
            for i in range(m):
                for j in range(i, m):
                    a, b = variables[i], variables[j]
                    sub = pd.DataFrame({"a": ds.numeric(a), "b": ds.numeric(b)}).dropna()
                    n = int(len(sub))
                    nmat[i][j] = n
                    if i == j:
                        rmat[i][j] = 1.0 if n > 0 else None
                        pmat[i][j] = 0.0 if n > 0 else None
                        continue
                    if n < 3:
                        continue
                    try:
                        r, p = fn(sub["a"].to_numpy(dtype=float), sub["b"].to_numpy(dtype=float))
                        rmat[i][j] = rmat[j][i] = _clean_float(r)
                        pmat[i][j] = pmat[j][i] = _p_round(p)
                        nmat[j][i] = n
                    except Exception:
                        pass
            return rmat, pmat, nmat

        if want_pearson:
            r, p, n = _mat("pearson")
            cols = ["Variable"] + variables
            rows = [[variables[i]] + [r[i][j] for j in range(len(variables))] for i in range(len(variables))]
            tables.append(_table("Pearson Correlation Matrix", cols, rows))
            rows = [[variables[i]] + [p[i][j] for j in range(len(variables))] for i in range(len(variables))]
            tables.append(_table("Pearson Sig (2-tailed) Matrix", cols, rows))
            rows = [[variables[i]] + [n[i][j] for j in range(len(variables))] for i in range(len(variables))]
            tables.append(_table("Pearson N Matrix", cols, rows))

    note = "** Correlation is significant at the 0.01 level (2-tailed). * significant at the 0.05 level."
    return _result("corr", "Correlations", tables, note=note,
                   meta={"variables": variables, "mode": "matrix" if matrix_mode else "pair"})


# --------------------------------------------------------------------------- #
# Analysis: LINEAR REGRESSION
# --------------------------------------------------------------------------- #
def analyze_regression(ds, spec):
    variables = list(spec.get("variables") or [])
    opts = spec.get("options") or {}
    dependent = opts.get("dependent") or opts.get("dependentVariable") or opts.get("y")
    _require(ds, variables, atype="regression")
    predictors = [v for v in variables if v != dependent]
    if not dependent or not ds.has(str(dependent)):
        # Fall back to the last variable as the dependent variable.
        dependent = variables[-1]
        predictors = variables[:-1]
        note_default = f"options.dependent not provided; used last variable '{dependent}' as dependent"
    else:
        note_default = None
    if not predictors:
        raise ValueError("regression: no predictors after choosing the dependent variable")
    if not ds.has(str(dependent)):
        raise ValueError(f"regression: dependent variable not found: {dependent}")
    for v in predictors:
        if not ds.has(v):
            raise ValueError(f"regression: predictor not found: {v}")
    missing_check = [v for v in predictors if v != dependent]

    Y = ds.numeric(str(dependent))
    X = pd.DataFrame({v: ds.numeric(v) for v in predictors})

    # Dummy-code categorical predictors (SPSS AUTORECODE-like behaviour).
    notes = []
    Xc = []
    for v in predictors:
        m = ds.measure(v)
        s = X[v]
        if m in ("nominal", "ordinal") and _value_labels(ds, v):
            uniq = sorted([u for u in pd.unique(s.dropna())], key=_sort_key)
            ref = uniq[0]
            for u in uniq[1:]:
                name = f"{v}[{_display_value(ds, v, u)}]"
                Xc.append(pd.Series(np.where(s == u, 1.0, 0.0), index=s.index, name=name))
            notes.append(f"{v} dummy-coded (reference: {_display_value(ds, v, ref)})")
        else:
            Xc.append(s.rename(v))
    Xd = pd.concat(Xc, axis=1) if Xc else pd.DataFrame(index=Y.index)

    data = pd.concat([Y.rename(str(dependent)), Xd], axis=1).dropna()
    n = int(len(data))
    if n < 2:
        raise ValueError("regression: not enough complete cases")
    y = data[str(dependent)].to_numpy(dtype=float)
    Xmat = data.drop(columns=[str(dependent)]).to_numpy(dtype=float)
    p_n = Xmat.shape[1]
    if p_n == 0:
        raise ValueError("regression: no usable predictors after dummy coding")
    if n <= p_n + 1:
        notes.append(f"n ({n}) too small relative to predictors ({p_n}); results unreliable")

    Xb = np.column_stack([np.ones(n), Xmat])
    k = Xb.shape[1]
    cols_names = ["(Constant)"] + list(data.drop(columns=[str(dependent)]).columns)

    try:
        XtX = Xb.T @ Xb
        XtX_inv = np.linalg.pinv(XtX)
        beta_hat = XtX_inv @ (Xb.T @ y)
    except Exception as exc:
        raise RuntimeError(f"regression: failed to fit OLS model: {exc}") from exc

    fitted = Xb @ beta_hat
    resid = y - fitted
    ss_res = float((resid ** 2).sum())
    ybar = float(y.mean())
    ss_tot = float(((y - ybar) ** 2).sum())
    ss_reg = ss_tot - ss_res
    df_reg = k - 1
    df_res = n - k
    df_tot = n - 1
    ms_res = ss_res / df_res if df_res > 0 else None
    r2 = ss_reg / ss_tot if ss_tot > 0 else None
    if ss_tot == 0:
        raise ValueError("regression: dependent variable has zero variance")
    r = math.sqrt(max(r2, 0.0))
    r = r if np.corrcoef(y, fitted)[0, 1] >= 0 else -r
    adj_r2 = 1.0 - (1.0 - r2) * (df_tot / df_res) if (df_res > 0 and r2 is not None) else None
    se_est = math.sqrt(ms_res) if ms_res is not None and ms_res >= 0 else None

    if ms_res and ms_res > 0 and df_reg > 0:
        F = (ss_reg / df_reg) / ms_res
        pF = float(sstats.f.sf(F, df_reg, df_res))
    else:
        F = pF = None

    cov = XtX_inv * ms_res if ms_res is not None else None
    se_beta = [math.sqrt(max(cov[i, i], 0.0)) if cov is not None else None for i in range(k)]

    # Standardised coefficients (Beta) and VIF.
    vifs = []
    for i in range(1, k):
        try:
            others = np.delete(Xmat, i - 1, axis=1)
            if others.shape[1] == 0:
                vifs.append(1.0)
                continue
            Ob = np.column_stack([np.ones(n), others])
            bb = np.linalg.pinv(Ob.T @ Ob) @ (Ob.T @ Xmat[:, i - 1])
            res_i = Xmat[:, i - 1] - Ob @ bb
            sse = float((res_i ** 2).sum())
            sst = float(((Xmat[:, i - 1] - Xmat[:, i - 1].mean()) ** 2).sum())
            r_i2 = 1.0 - sse / sst if sst > 0 else 0.0
            vifs.append(1.0 / (1.0 - r_i2) if r_i2 < 1.0 else None)
        except Exception:
            vifs.append(None)

    y_sd = float(y.std(ddof=1)) if n > 1 else 0.0
    coef_rows = []
    vif_rows = []
    for i, cname in enumerate(cols_names):
        b = float(beta_hat[i])
        se = se_beta[i]
        t = (b / se) if (se and se > 0) else None
        p = float(2.0 * sstats.t.sf(abs(t), df_res)) if t is not None else None
        if i == 0:
            beta_std = None
            vif = None
        else:
            sd_x = float(Xmat[:, i - 1].std(ddof=0))
            beta_std = b * sd_x / y_sd if y_sd > 0 else None
            vif = vifs[i - 1] if i - 1 < len(vifs) else None
        coef_rows.append([cname, _clean_float(b), _clean_float(se), _clean_float(beta_std),
                          _clean_float(t), _p_round(p), _clean_float(vif)])
        vif_rows.append([cname, _clean_float(vif)])

    tables = [
        _table("Variables Entered",
               ["Model", "VariablesEntered", "VariablesRemoved", "Method"],
               [["1", ", ".join(predictors), ".", "Enter"]]),
        _table("Model Summary",
               ["Model", "R", "RSquare", "AdjustedRSquare", "StdErrorOfEstimate", "N"],
               [["1", _clean_float(r), _clean_float(r2), _clean_float(adj_r2), _clean_float(se_est), n]]),
        _table("ANOVA",
               ["Model", "Source", "SumOfSquares", "df", "MeanSquare", "F", "Sig"],
               [["1", "Regression", _clean_float(ss_reg), df_reg,
                 _clean_float(ss_reg / df_reg) if df_reg > 0 else None, _clean_float(F), _p_round(pF)],
                ["1", "Residual", _clean_float(ss_res), df_res, _clean_float(ms_res), None, None],
                ["1", "Total", _clean_float(ss_tot), df_tot, None, None, None]]),
        _table("Coefficients",
               ["Model", "Variable", "UnstandardizedB", "StdError", "StandardizedBeta", "t", "Sig"],
               [["1"] + row[:6] for row in coef_rows]),
        _table("Collinearity Statistics (VIF)", ["Model", "Variable", "VIF"],
               [["1", r[0], r[1]] for r in vif_rows]),
    ]

    note = ("OLS regression (Enter method). DV: %s. Check collinearity with VIF > 10." % dependent)
    if note_default:
        note = note_default + "; " + note
    if notes:
        note += " " + " ".join(notes)
    meta = {"dependent": dependent, "predictors": predictors, "n": n,
            "r": _clean_float(r), "rSquare": _clean_float(r2), "adjRSquare": _clean_float(adj_r2),
            "F": _clean_float(F), "pF": _p_round(pF), "dfRegression": df_reg, "dfResidual": df_res,
            "coefficients": [
                {"name": cols_names[i], "b": _clean_float(float(beta_hat[i])),
                 "stdError": _clean_float(se_beta[i]),
                 "beta": row[3], "t": row[4], "p": row[5], "vif": row[6]}
                for i, row in enumerate(coef_rows)]}
    return _result("regression", f"Linear Regression: {ds.label(str(dependent))}", tables,
                   note=note, meta=meta)


# --------------------------------------------------------------------------- #
# Analysis: RELIABILITY (Cronbach's alpha)
# --------------------------------------------------------------------------- #
def analyze_reliability(ds, spec):
    variables = list(spec.get("variables") or [])
    _require(ds, variables, atype="reliability")
    opts = spec.get("options") or {}
    model = str(opts.get("model") or "alpha").lower()

    data = pd.DataFrame({v: ds.numeric(v) for v in variables}).dropna()
    n = int(len(data))
    k = len(variables)
    if n < 2:
        raise ValueError("reliability: need at least 2 complete cases")
    if k < 2:
        raise ValueError("reliability: need at least 2 items")

    items = np.asarray(data.to_numpy(dtype=float), dtype=float)
    if items.ndim == 1:
        items = items.reshape(-1, 1)
    item_var = items.var(axis=0, ddof=1)
    total = items.sum(axis=1)
    total_var = float(total.var(ddof=1))
    sum_item_var = float(item_var.sum())

    alpha = None
    if total_var > 0 and k > 1:
        alpha = (k / (k - 1.0)) * (1.0 - sum_item_var / total_var)

    # Item-total statistics (corrected = excluding the item).
    item_total_rows = []
    for i, v in enumerate(variables):
        rest = total - items[:, i]  # per-case sum of the remaining items (1-D)
        try:
            r = float(sstats.pearsonr(items[:, i], rest)[0])
        except Exception:
            r = None
        if alpha is not None and k > 1:
            rest_items = np.atleast_2d(np.delete(items, i, axis=1))
            rv = rest_items.var(axis=0, ddof=1)
            tv = float(np.asarray(rest, dtype=float).var(ddof=1))
            if k > 2:
                a_del = ((k - 1) / (k - 2.0)) * (1.0 - rv.sum() / tv) if tv > 0 else None
            else:
                a_del = alpha
        else:
            a_del = alpha if k == 2 else None
        item_total_rows.append([v, _clean_float(item_var[i]), _clean_float(r),
                                _clean_float(a_del)])

    # Scale statistics.
    scale_rows = [[k, n, _clean_float(total.mean()), _clean_float(math.sqrt(total_var)),
                   _clean_float(total_var)]]

    item_stats_rows = []
    for i, v in enumerate(variables):
        item_stats_rows.append([v, _clean_float(items[:, i].mean()),
                                _clean_float(items[:, i].std(ddof=1)), n])

    # Split-half (odd/even) as a bonus reliability check.
    split_note = None
    if k >= 2:
        try:
            odd = items[:, 0::2].sum(axis=1)
            even = items[:, 1::2].sum(axis=1)
            if odd.var(ddof=1) > 0 and even.var(ddof=1) > 0:
                r_half = float(sstats.pearsonr(odd, even)[0])
                sb = 2 * r_half / (1 + r_half) if r_half > -1 else None
                split_note = f"Split-half (odd/even) reliability = {_fmt_value(_clean_float(sb))}"
        except Exception:
            pass

    def _interp(a):
        if a is None:
            return "not available"
        if a >= 0.9:
            return "excellent"
        if a >= 0.8:
            return "good"
        if a >= 0.7:
            return "acceptable"
        if a >= 0.6:
            return "questionable"
        return "poor"

    tables = [
        _table("Reliability Statistics",
               ["CronbachAlpha", "CronbachAlphaBasedOnStandardizedItems", "NOfItems", "N", "Interpretation"],
               [[_clean_float(alpha), _clean_float(alpha), k, n, _interp(alpha)]]),
        _table("Item Statistics", ["Item", "Mean", "StdDev", "N"], item_stats_rows),
        _table("Item-Total Statistics",
               ["Item", "ScaleMeanIfItemDeleted", "ScaleVarianceIfItemDeleted",
                "CorrectedItemTotalCorrelation", "CronbachAlphaIfItemDeleted"],
               [[row[0],
                 _clean_float(float((total - items[:, i]).mean())),
                 _clean_float(float((total - items[:, i]).var(ddof=1))),
                 row[2], row[3]] for i, row in enumerate(item_total_rows)]),
        _table("Scale Statistics", ["MeanItems", "N", "Mean", "StdDev", "Variance"], scale_rows),
    ]
    note = f"Cronbach's alpha model = {model}. Reliability interpretation: {_interp(alpha)}."
    if split_note:
        note += " " + split_note
    if sum_item_var == 0:
        note += " Warning: all item variances are zero."
    return _result("reliability", "Reliability (Cronbach's Alpha)", tables, note=note,
                   meta={"alpha": _clean_float(alpha), "n": n, "items": variables,
                         "itemVariances": [_clean_float(v) for v in item_var],
                         "totalMean": _clean_float(total.mean()),
                         "totalVariance": _clean_float(total_var)})


# --------------------------------------------------------------------------- #
# Analysis: NONPARAMETRIC TESTS
# --------------------------------------------------------------------------- #
def analyze_nonparametric(ds, spec):
    variables = list(spec.get("variables") or [])
    group_by = spec.get("groupBy")
    opts = spec.get("options") or {}
    test = str(opts.get("test") or "").lower().strip()

    def _resolve_default():
        if len(variables) == 1 and not group_by:
            return "chisquare"
        if len(variables) >= 2 and group_by:
            return "mannwhitney"
        if len(variables) >= 2 and not group_by:
            return "wilcoxon"
        return "chisquare"

    if not test:
        test = _resolve_default()
    if test in ("chi", "chi2", "goodness", "goodness_of_fit", "chisquare"):
        test = "chisquare"
    elif test in ("mann", "mannwhitney", "mann_whitney", "mann-whitney", "u"):
        test = "mannwhitney"
    elif test in ("wilcoxon", "signed_rank"):
        test = "wilcoxon"
    elif test in ("kruskal", "kruskal_wallis", "kruskal-wallis"):
        test = "kruskal"

    tables = []
    if test == "chisquare":
        _require(ds, variables, atype="nonparametric")
        v = variables[0]
        s = ds.col(v).dropna()
        vc = s.value_counts()
        items = list(vc.items())
        items.sort(key=lambda kv: _sort_key(kv[0]))
        if not items:
            raise ValueError(f"nonparametric: no valid cases in {v}")
        observed = np.array([f for _, f in items], dtype=float)
        expected_opt = opts.get("expected")
        if isinstance(expected_opt, list) and len(expected_opt) == len(observed):
            expected = np.array([float(x) for x in expected_opt], dtype=float)
        else:
            expected = np.full(len(observed), observed.sum() / len(observed))
        if np.any(expected <= 0):
            raise ValueError("nonparametric: expected frequencies must be positive")
        chi2, p = sstats.chisquare(observed, expected)
        dfree = len(observed) - 1
        rows = []
        for i, (val, freq) in enumerate(items):
            rows.append([_display_value(ds, v, val), int(freq), _clean_float(expected[i]),
                         _clean_float(float(freq) - float(expected[i]),
                                      4), int(dfree)])
        tables.append(_table("Frequencies (Observed & Expected)",
                             ["Category", "Observed N", "Expected N", "Residual", "df"], rows))
        tables.append(_table("Test Statistics", ["ChiSquare", "df", "AsymptoticSig"],
                             [[_clean_float(chi2), dfree, _p_round(p)]]))
        note = (f"Chi-square goodness-of-fit for {v}. Small expected counts (n/N < 5) may "
                f"invalidate the asymptotic p-value." if expected.max() > 0 and expected.min() < 5
                else f"Chi-square goodness-of-fit test for {v}.")
        return _result("nonparametric", f"Nonparametric: Chi-Square Goodness of Fit ({v})", tables,
                       note=note, meta={"test": "chisquare", "variable": v,
                                        "chiSquare": _clean_float(chi2), "df": dfree, "p": _p_round(p)})

    if test == "mannwhitney":
        if not group_by or not variables:
            raise ValueError("nonparametric: Mann-Whitney requires variables and groupBy")
        if not ds.has(group_by):
            raise ValueError(f"nonparametric: group variable not found: {group_by}")
        v = variables[0]
        sub = pd.DataFrame({"y": ds.numeric(v), "g": ds.col(group_by)}).dropna()
        groups = _split_groups(sub["g"])
        if len(groups) < 2:
            raise ValueError("nonparametric: need at least 2 groups")
        g1, g2 = groups[0], groups[1]
        a = sub.loc[sub["g"] == g1[1], "y"].to_numpy(dtype=float)
        b = sub.loc[sub["g"] == g2[1], "y"].to_numpy(dtype=float)
        try:
            U, p = sstats.mannwhitneyu(a, b, alternative="two-sided")
        except Exception:
            U, p = float("nan"), float("nan")
        n1, n2 = len(a), len(b)
        rank_rows = [[v, g1[0], n1, _clean_float(a.mean()) if n1 else None,
                      _clean_float(np.median(a)) if n1 else None],
                     [v, g2[0], n2, _clean_float(b.mean()) if n2 else None,
                      _clean_float(np.median(b)) if n2 else None]]
        tables.append(_table("Mann-Whitney Ranks/Frequencies (grouped)",
                             ["Variable", "Group", "N", "Mean", "Median"], rank_rows))
        tables.append(_table("Test Statistics",
                             ["Variable", "MannWhitneyU", "WilcoxonW", "AsymptoticSig"],
                             [[v, _clean_float(U), _clean_float(U + n1 * (n1 + 1) / 2.0),
                               _p_round(p)]]))
        return _result("nonparametric", f"Nonparametric: Mann-Whitney U Test ({v} by {group_by})",
                       tables, note=f"Two-tailed test comparing {g1[0]} vs {g2[0]}.",
                       meta={"test": "mannwhitney", "variable": v, "groupBy": group_by,
                             "groups": [g1[0], g2[0]], "U": _clean_float(U), "p": _p_round(p)})

    if test == "wilcoxon":
        _require(ds, variables, n=2, atype="nonparametric")
        a, b = variables[0], variables[1]
        sub = pd.DataFrame({"a": ds.numeric(a), "b": ds.numeric(b)}).dropna()
        if len(sub) < 1:
            raise ValueError("nonparametric: no paired complete cases")
        try:
            w, p = sstats.wilcoxon(sub["a"].to_numpy(dtype=float), sub["b"].to_numpy(dtype=float))
        except Exception:
            w, p = float("nan"), float("nan")
        tables.append(_table("Descriptives",
                             ["Variable", "N", "Mean", "Median"],
                             [[a, len(sub), _clean_float(sub["a"].mean()), _clean_float(sub["a"].median())],
                              [b, len(sub), _clean_float(sub["b"].mean()), _clean_float(sub["b"].median())]]))
        tables.append(_table("Test Statistics", ["Pair", "WilcoxonW", "AsymptoticSig"],
                             [[f"{a} - {b}", _clean_float(w), _p_round(p)]]))
        return _result("nonparametric", f"Nonparametric: Wilcoxon Signed-Rank Test ({a} - {b})",
                       tables, note="Two-tailed Wilcoxon signed-rank test on paired differences.",
                       meta={"test": "wilcoxon", "pair": [a, b], "W": _clean_float(w), "p": _p_round(p)})

    if test == "kruskal":
        if not group_by or not variables:
            raise ValueError("nonparametric: Kruskal-Wallis requires variables and groupBy")
        v = variables[0]
        sub = pd.DataFrame({"y": ds.numeric(v), "g": ds.col(group_by)}).dropna()
        groups = _split_groups(sub["g"])
        arrays = [sub.loc[sub["g"] == g[1], "y"].to_numpy(dtype=float) for g in groups if len(sub.loc[sub["g"] == g[1], "y"]) > 0]
        if len(arrays) < 2:
            raise ValueError("nonparametric: need at least 2 non-empty groups")
        H, p = sstats.kruskal(*arrays)
        dfree = max(len(arrays) - 1, 1)
        tables.append(_table("Ranks (grouped)",
                             ["Variable", "Group", "N", "Mean", "Median"],
                             [[v, g[0], int(len(sub.loc[sub["g"] == g[1], "y"])),
                               _clean_float(sub.loc[sub["g"] == g[1], "y"].mean()),
                               _clean_float(sub.loc[sub["g"] == g[1], "y"].median())] for g in groups]))
        tables.append(_table("Test Statistics", ["Variable", "KruskalWallisH", "df", "AsymptoticSig"],
                             [[v, _clean_float(H), dfree, _p_round(p)]]))
        return _result("nonparametric", f"Nonparametric: Kruskal-Wallis Test ({v} by {group_by})",
                       tables, note="Kruskal-Wallis one-way analysis of variance by ranks.",
                       meta={"test": "kruskal", "variable": v, "groupBy": group_by,
                             "H": _clean_float(H), "df": dfree, "p": _p_round(p)})

    raise ValueError(f"nonparametric: unknown test '{test}' (use chisquare | mannwhitney | wilcoxon | kruskal)")


# --------------------------------------------------------------------------- #
# Analysis registry
# --------------------------------------------------------------------------- #
ANALYSIS_FUNCS = {
    "freq": analyze_freq,
    "frequencies": analyze_freq,
    "descriptives": analyze_descriptives,
    "desc": analyze_descriptives,
    "crosstab": analyze_crosstab,
    "crosstabs": analyze_crosstab,
    "ttest_one": analyze_ttest_one,
    "one_sample_ttest": analyze_ttest_one,
    "ttest_independent": analyze_ttest_independent,
    "independent_ttest": analyze_ttest_independent,
    "paired_ttest": analyze_paired_ttest,
    "paired_samples_ttest": analyze_paired_ttest,
    "anova": analyze_anova,
    "corr": analyze_corr,
    "correlation": analyze_corr,
    "regression": analyze_regression,
    "linear_regression": analyze_regression,
    "reliability": analyze_reliability,
    "nonparametric": analyze_nonparametric,
}

CANONICAL_TYPES = {
    "frequencies": "freq", "desc": "descriptives", "crosstabs": "crosstab",
    "one_sample_ttest": "ttest_one", "independent_ttest": "ttest_independent",
    "paired_samples_ttest": "paired_ttest", "correlation": "corr",
    "linear_regression": "regression",
}


def run_analysis(ds, spec, log, index):
    atype_raw = str(spec.get("type") or "").strip().lower()
    if not atype_raw:
        raise ValueError("analysis spec missing 'type'")
    fn = ANALYSIS_FUNCS.get(atype_raw)
    if fn is None:
        raise ValueError(f"unknown analysis type '{atype_raw}'. Supported: "
                         f"{sorted(set(CANONICAL_TYPES.get(k, k) for k in ANALYSIS_FUNCS))}")
    atype = CANONICAL_TYPES.get(atype_raw, atype_raw)
    title = spec.get("title") or None
    res = fn(ds, spec)
    res["type"] = atype
    if title:
        res["title"] = title
    res.setdefault("index", index)
    res["spec"] = {"variables": spec.get("variables"), "groupBy": spec.get("groupBy")}
    return res


# --------------------------------------------------------------------------- #
# Charts
# --------------------------------------------------------------------------- #
def _setup_matplotlib_fonts(log_state):
    """Pick a CJK-capable font if available; never raise."""
    if not HAVE_MPL:
        return None
    if log_state.get("fonts_ready"):
        return log_state.get("font")
    chosen = None
    try:
        installed = {f.name for f in _font_manager.fontManager.ttflist}
        for cand in FONT_CANDIDATES:
            if cand in installed:
                chosen = cand
                break
        plt.rcParams["font.sans-serif"] = ([chosen] if chosen else []) + FONT_CANDIDATES + ["DejaVu Sans"]
        plt.rcParams["font.family"] = "sans-serif"
        plt.rcParams["axes.unicode_minus"] = False
    except Exception:
        chosen = None
        try:
            plt.rcParams["axes.unicode_minus"] = False
        except Exception:
            pass
    log_state["fonts_ready"] = True
    log_state["font"] = chosen
    return chosen


def render_chart(res, ds, out_path, log_state):
    """Render one chart for a supported analysis. Returns True on success."""
    if not HAVE_MPL:
        return False
    atype = res.get("type")
    try:
        _setup_matplotlib_fonts(log_state)
        fig = None
        if atype == "freq":
            tables = res.get("tables") or []
            if not tables:
                return False
            t = tables[0]
            cats, vals = [], []
            for row in t.get("rows") or []:
                label = row[0]
                if label in ("Total", "Missing"):
                    continue
                freq = row[2]
                if isinstance(freq, (int, float)):
                    cats.append(str(label))
                    vals.append(float(freq))
            if not cats:
                return False
            if len(cats) > 40:
                cats, vals = cats[:40], vals[:40]
            fig, ax = plt.subplots(figsize=(max(5, min(12, 0.4 * len(cats) + 3)), 4.2), dpi=140)
            ax.bar(range(len(cats)), vals, color="#3b6fb6")
            ax.set_xticks(range(len(cats)))
            rot = 45 if max((len(c) for c in cats), default=0) > 6 or len(cats) > 8 else 0
            ax.set_xticklabels(cats, rotation=rot, ha="right" if rot else "center", fontsize=9)
            ax.set_ylabel("Frequency")
            ax.set_title(res.get("title") or "Frequencies")
            ax.grid(axis="y", alpha=0.3)
            for i, v in enumerate(vals):
                ax.text(i, v, f"{v:g}", ha="center", va="bottom", fontsize=8)
        elif atype == "descriptives":
            t = (res.get("tables") or [{}])[0]
            names, means, sds = [], [], []
            for row in t.get("rows") or []:
                if isinstance(row[4], (int, float)):
                    names.append(str(row[0]))
                    means.append(float(row[4]))
                    sds.append(float(row[7]) if isinstance(row[7], (int, float)) else 0.0)
            if not names:
                return False
            fig, ax = plt.subplots(figsize=(max(5, min(12, 0.9 * len(names) + 3)), 4.2), dpi=140)
            ax.bar(range(len(names)), means, yerr=sds, capsize=4, color="#4c9a75")
            ax.set_xticks(range(len(names)))
            ax.set_xticklabels(names, rotation=30 if len(names) > 4 else 0, ha="right" if len(names) > 4 else "center", fontsize=9)
            ax.set_ylabel("Mean ± SD")
            ax.set_title(res.get("title") or "Descriptives")
            ax.grid(axis="y", alpha=0.3)
        elif atype == "crosstab":
            meta = res.get("meta") or {}
            counts = meta.get("counts")
            rcat = meta.get("rowCategories") or []
            ccat = meta.get("colCategories") or []
            if not counts or not rcat or not ccat:
                return False
            arr = np.asarray(counts, dtype=float)
            fig, ax = plt.subplots(figsize=(max(5, 1.2 * len(ccat) + 3), max(3.5, 0.7 * len(rcat) + 2.5)), dpi=140)
            ncols = len(ccat)
            width = 0.8 / max(ncols, 1)
            xs = np.arange(len(rcat))
            for j in range(ncols):
                ax.bar(xs + j * width, arr[:, j] if arr.ndim == 2 else [], width, label=str(ccat[j]))
            ax.set_xticks(xs + width * (ncols - 1) / 2)
            ax.set_xticklabels([str(c) for c in rcat], fontsize=9)
            ax.set_ylabel("Count")
            ax.set_title(res.get("title") or "Crosstabulation")
            ax.legend(fontsize=8, title=meta.get("colVar"))
            ax.grid(axis="y", alpha=0.3)
        elif atype == "corr":
            meta = res.get("meta") or {}
            variables = meta.get("variables") or []
            if len(variables) < 2:
                return False
            a, b = variables[0], variables[1]
            sub = pd.DataFrame({"a": ds.numeric(a), "b": ds.numeric(b)}).dropna()
            if len(sub) == 0:
                return False
            fig, ax = plt.subplots(figsize=(5.4, 4.4), dpi=140)
            ax.scatter(sub["a"], sub["b"], s=22, alpha=0.75, color="#b5543b", edgecolors="none")
            try:
                if len(sub) >= 2:
                    z = np.polyfit(sub["a"].to_numpy(dtype=float), sub["b"].to_numpy(dtype=float), 1)
                    xs = np.linspace(sub["a"].min(), sub["a"].max(), 50)
                    ax.plot(xs, z[0] * xs + z[1], color="#333333", lw=1.2, ls="--")
                    r = float(sstats.pearsonr(sub["a"], sub["b"])[0])
                    ax.text(0.03, 0.97, f"r = {r:.3f}", transform=ax.transAxes, va="top", fontsize=9)
            except Exception:
                pass
            ax.set_xlabel(a)
            ax.set_ylabel(b)
            ax.set_title(res.get("title") or "Correlation")
            ax.grid(alpha=0.3)
        elif atype == "regression":
            meta = res.get("meta") or {}
            dep = meta.get("dependent")
            preds = meta.get("predictors") or []
            if not dep or not preds or not ds.has(dep):
                return False
            pred = preds[0]
            if not ds.has(pred):
                return False
            sub = pd.DataFrame({"y": ds.numeric(dep), "x": ds.numeric(pred)}).dropna()
            if len(sub) == 0:
                return False
            fig, ax = plt.subplots(figsize=(5.4, 4.4), dpi=140)
            ax.scatter(sub["x"], sub["y"], s=22, alpha=0.75, color="#3b6fb6", edgecolors="none")
            try:
                coefs = meta.get("coefficients") or []
                b0 = next((c["b"] for c in coefs if c.get("name") == "(Constant)"), None)
                b1 = next((c["b"] for c in coefs if c.get("name") == pred), None)
                if b0 is not None and b1 is not None:
                    xs = np.linspace(sub["x"].min(), sub["x"].max(), 60)
                    ax.plot(xs, b0 + b1 * xs, color="#b5543b", lw=1.5)
            except Exception:
                pass
            ax.set_xlabel(pred)
            ax.set_ylabel(dep)
            ax.set_title(res.get("title") or "Regression")
            ax.grid(alpha=0.3)
        elif atype == "anova":
            meta = res.get("meta") or {}
            gb = meta.get("groupBy")
            variables = meta.get("variables") or []
            if not gb or not variables or not ds.has(gb):
                return False
            sub = pd.DataFrame({"y": ds.numeric(variables[0]), "g": ds.col(gb)}).dropna()
            groups = _split_groups(sub["g"])
            arrays = [sub.loc[sub["g"] == g[1], "y"].to_numpy(dtype=float) for g in groups]
            if not arrays:
                return False
            fig, ax = plt.subplots(figsize=(max(5, 1.1 * len(groups) + 3), 4.4), dpi=140)
            ax.boxplot(arrays, tick_labels=[g[0] for g in groups], showmeans=True)
            ax.set_ylabel(variables[0])
            ax.set_xlabel(gb)
            ax.set_title(res.get("title") or "ANOVA")
            ax.grid(axis="y", alpha=0.3)
        else:
            return False
        if fig is None:
            return False
        fig.tight_layout()
        fig.savefig(out_path, format="png")
        plt.close(fig)
        return True
    except Exception as exc:
        try:
            if plt is not None:
                plt.close("all")
        except Exception:
            pass
        raise RuntimeError(f"chart render failed: {exc}") from exc


# --------------------------------------------------------------------------- #
# Exports
# --------------------------------------------------------------------------- #
_SHEET_BAD = re.compile(r"[\\/*?:\[\]]")
_HYPER_RE = re.compile(r"^[=+\-@]")
_ILLEGAL_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _sheet_name(s, used):
    s = _SHEET_BAD.sub("_", str(s)).strip() or "Sheet"
    s = s[:28]
    if _HYPER_RE.match(s):
        s = "_" + s
    base = s
    k = 1
    while s in used:
        k += 1
        s = f"{base[:26]}_{k}"
    used.add(s)
    return s


def _fmt_for_text(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "True" if v else "False"
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return ""
        return f"{v:g}" if abs(v) < 1e15 else f"{v:.6g}"
    if isinstance(v, int):
        return str(v)
    s = str(v)
    return _ILLEGAL_XML.sub("", s)


def export_csv(result_obj, ds, out_path, log):
    """One CSV of the main tables (or the dataset when there are no analyses)."""
    analyses = result_obj.get("analyses") or []
    with open(out_path, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        if not analyses:
            ds.df.to_csv(fh, index=False, encoding="utf-8-sig")
            log.append("CSV export: no analyses requested; exported dataset subset")
            return
        for a in analyses:
            w.writerow([f"== {a.get('type')}: {a.get('title')} =="])
            if a.get("note"):
                w.writerow(["Note", _fmt_for_text(a.get("note"))])
            for t in a.get("tables") or []:
                w.writerow([_fmt_for_text(t.get("title"))])
                w.writerow([_fmt_for_text(c) for c in t.get("columns") or []])
                for row in t.get("rows") or []:
                    w.writerow([_fmt_for_text(v) for v in row])
                w.writerow([])
            w.writerow([])
    log.append(f"CSV export: {len(analyses)} analysis block(s) -> {os.path.basename(out_path)}")


def export_xlsx(result_obj, ds, out_path, log):
    """One workbook; a sheet per analysis table, plus a Dataset sheet."""
    if not HAVE_OPENPYXL:
        # pandas can only write xlsx through openpyxl/xlsxwriter here.
        raise RuntimeError("openpyxl is not installed; cannot write .xlsx")
    analyses = result_obj.get("analyses") or []
    with pd.ExcelWriter(out_path, engine="openpyxl") as xw:
        used = set()
        # Overview / dataset sheet.
        var_rows = [[v.get("name"), v.get("label") or "", v.get("type"), v.get("measure")]
                    for v in ds.variables]
        overview = pd.DataFrame(var_rows, columns=["Variable", "Label", "Type", "Measure"])
        summary = pd.DataFrame([["Rows", ds.n_rows], ["Columns", len(ds.variables)],
                                ["Source", ds.source_path]],
                               columns=["Property", "Value"])
        overview.to_excel(xw, sheet_name=_sheet_name("Dataset", used), index=False)
        summary.to_excel(xw, sheet_name=_sheet_name("Summary", used), index=False)
        n_sheets = 0
        for ai, a in enumerate(analyses):
            for ti, t in enumerate(a.get("tables") or []):
                label = f"{a.get('type')}-{ti + 1}-{t.get('title') or 'table'}"
                df = pd.DataFrame([[_fmt_for_text(v) for v in r] for r in (t.get("rows") or [])],
                                  columns=[str(c) for c in (t.get("columns") or [])])
                df.to_excel(xw, sheet_name=_sheet_name(label, used), index=False)
                n_sheets += 1
        ds.df.to_excel(xw, sheet_name=_sheet_name("Data", used), index=False)
    log.append(f"XLSX export: {n_sheets} analysis sheet(s) + Dataset/Summary/Data -> {os.path.basename(out_path)}")


def export_docx(result_obj, ds, out_path, log):
    """A Word report with native Word tables."""
    if not HAVE_DOCX:
        raise RuntimeError("python-docx is not installed; cannot write .docx")
    from docx.enum.text import WD_ALIGN_PARAGRAPH  # type: ignore

    doc = docx.Document()
    try:
        style = doc.styles["Normal"]
        style.font.name = "Calibri"
        style.font.size = _DocxPt(10)
        # CJK font hint on the East Asian run properties.
        rpr = style.element.get_or_add_rPr()
        rfonts = rpr.get_or_add_rFonts()
        rfonts.set("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia", "PingFang SC")
    except Exception:
        pass

    title = "SPSS 统计分析报告 / Statistical Analysis Report"
    h = doc.add_heading(title, level=0)
    try:
        h.alignment = WD_ALIGN_PARAGRAPH.LEFT
    except Exception:
        pass

    p = doc.add_paragraph()
    p.add_run("Source: ").bold = True
    p.add_run(ds.source_path)
    p = doc.add_paragraph()
    p.add_run("Dataset: ").bold = True
    p.add_run(f"{ds.n_rows} cases × {len(ds.variables)} variables")
    if result_obj.get("generatedAt"):
        p = doc.add_paragraph()
        p.add_run("Generated: ").bold = True
        p.add_run(str(result_obj.get("generatedAt")))

    # Dataset summary table.
    doc.add_heading("Dataset Summary / 数据概览", level=1)
    t = doc.add_table(rows=1, cols=4)
    try:
        t.style = "Table Grid"
    except Exception:
        pass
    hdr = t.rows[0].cells
    for i, c in enumerate(["Variable", "Label", "Type", "Measure"]):
        hdr[i].text = c
    for v in ds.variables:
        cells = t.add_row().cells
        cells[0].text = _fmt_for_text(v.get("name"))
        cells[1].text = _fmt_for_text(v.get("label") or "")
        cells[2].text = _fmt_for_text(v.get("type"))
        cells[3].text = _fmt_for_text(v.get("measure"))

    analyses = result_obj.get("analyses") or []
    if not analyses:
        doc.add_paragraph("No analyses were requested.")
    for ai, a in enumerate(analyses):
        doc.add_heading(f"{a.get('type')}: {a.get('title') or ''}", level=1)
        if a.get("note"):
            doc.add_paragraph(_fmt_for_text(a.get("note")))
        for tspec in a.get("tables") or []:
            if tspec.get("title"):
                doc.add_heading(_fmt_for_text(tspec.get("title")), level=2)
            cols = list(tspec.get("columns") or [])
            rows = tspec.get("rows") or []
            if not cols:
                continue
            width = min(len(cols), 20)
            table = doc.add_table(rows=1, cols=width)
            try:
                table.style = "Table Grid"
            except Exception:
                pass
            for i, c in enumerate(cols[:width]):
                cell = table.rows[0].cells[i]
                cell.text = ""
                run = cell.paragraphs[0].add_run(_fmt_for_text(c))
                run.bold = True
            for row in rows[:5000]:
                cells = table.add_row().cells
                for i in range(width):
                    val = row[i] if i < len(row) else None
                    cells[i].text = _fmt_for_text(val)
            doc.add_paragraph("")
    doc.save(out_path)
    log.append(f"DOCX export: {len(analyses)} analysis section(s) -> {os.path.basename(out_path)}")


def export_json(result_obj, out_path, log):
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(to_json_safe(result_obj), fh, ensure_ascii=False, indent=2, allow_nan=False)
    log.append(f"JSON export -> {os.path.basename(out_path)}")


def export_sav(ds, out_path, log):
    """Write the loaded dataset as a real SPSS .sav file."""
    if not HAVE_PYREADSTAT:
        raise RuntimeError("pyreadstat is not installed; cannot write .sav")
    df = ds.df
    # SPSS variable names: no spaces / special chars, <= 64 chars, not reserved.
    used = set()

    def _sav_name(n):
        s = re.sub(r"[^0-9A-Za-z_\u4e00-\u9fff]", "_", str(n))
        if not s or s[0].isdigit():
            s = "V_" + s
        s = s[:64]
        base = s
        k = 1
        while s.upper() in used:
            k += 1
            s = f"{base[:60]}_{k}"
        used.add(s.upper())
        return s

    out_df = df.copy()
    rename = {}
    labels = {}
    for c in out_df.columns:
        nm = _sav_name(c)
        if nm != c:
            rename[c] = nm
        lbl = ds.meta(str(c)).get("label")
        if lbl:
            labels[nm] = lbl
    if rename:
        out_df = out_df.rename(columns=rename)
        log.append(f"SAV export: renamed {len(rename)} column(s) to SPSS-safe names")
    # SPSS-friendly dtypes: object -> string, bool -> numeric.
    for c in out_df.columns:
        try:
            if pd.api.types.is_bool_dtype(out_df[c]):
                out_df[c] = out_df[c].astype("float64")
            elif pd.api.types.is_object_dtype(out_df[c]):
                out_df[c] = out_df[c].astype(str).replace({"nan": None, "None": None, "<NA>": None})
        except Exception:
            pass
    kwargs = {"file_label": "DSH SPSS dataset"}
    if labels:
        kwargs["column_labels"] = [labels.get(c, c) for c in out_df.columns]
    # Preserve value labels where they are unambiguously numeric.
    try:
        val_labels = {}
        for c in ds.df.columns:
            vl = ds.meta(str(c)).get("valueLabels")
            if vl:
                nm = rename.get(c, _sav_name(c))
                if nm in out_df.columns and pd.api.types.is_numeric_dtype(out_df[nm]):
                    val_labels[nm] = {float(k): v for k, v in vl.items() if _is_number_label(k)}
        if val_labels:
            kwargs["variable_value_labels"] = val_labels
    except Exception:
        pass
    pyreadstat.write_sav(out_df, out_path, **kwargs)
    log.append(f"SAV export: {out_df.shape[0]} rows x {out_df.shape[1]} columns -> {os.path.basename(out_path)}")


# --------------------------------------------------------------------------- #
# Driver
# --------------------------------------------------------------------------- #
def _now_iso():
    try:
        import datetime
        return datetime.datetime.now().astimezone().isoformat(timespec="seconds")
    except Exception:
        return ""


def run_job(req, out_json_path):
    """Execute one request. Returns (result_dict, exit_code)."""
    log = []
    result = {"ok": False}
    try:
        if not HAVE_CORE:
            raise RuntimeError("numpy/pandas/scipy are required but could not be imported")

        # Dependency report (graceful degradation notes).
        caps = {"pyreadstat": HAVE_PYREADSTAT, "matplotlib": HAVE_MPL,
                "openpyxl": HAVE_OPENPYXL, "python-docx": HAVE_DOCX}
        log.append("Environment: python %s" % sys.version.split()[0])
        log.append("Dependency probe: " + ", ".join(f"{k}={'yes' if v else 'NO'}" for k, v in caps.items()))
        for k, v in caps.items():
            if not v:
                log.append(f"NOTE: {k} is unavailable; features that need it will be skipped with a note.")

        exports = req.get("exports") or []
        if not isinstance(exports, list):
            exports = [exports] if exports else []
        exports = [str(e).lower().strip() for e in exports if e]
        for e in list(exports):
            if e not in EXPORT_KINDS:
                log.append(f"Ignored unknown export kind: {e}")
                exports.remove(e)
        exports = [e for e in EXPORT_KINDS if e in exports]

        out_dir = req.get("outDir")
        if exports and not out_dir:
            log.append("NOTE: no outDir provided although exports were requested; defaulting to a temp dir")
            out_dir = tempfile.mkdtemp(prefix="dsh-spss-")
        out_dir = os.path.abspath(os.path.expanduser(str(out_dir))) if out_dir else None
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        base = str(req.get("outBaseName") or DEFAULT_OUT_BASE)
        base = _SHEET_BAD.sub("_", base).strip() or DEFAULT_OUT_BASE

        # ---- load data --------------------------------------------------
        ds = load_dataset(req, log)
        log.append(f"Dataset ready: {ds.n_rows} rows x {len(ds.variables)} columns from {ds.source_path}")

        # ---- analyses (each isolated) ------------------------------------
        analyses_out = []
        specs = req.get("analyses") or []
        if not isinstance(specs, list):
            raise ValueError("request.analyses must be a list")
        for i, spec in enumerate(specs):
            if not isinstance(spec, dict):
                log.append(f"Analysis #{i + 1} skipped: spec is not an object")
                continue
            atype = spec.get("type") or f"#{i + 1}"
            try:
                res = run_analysis(ds, spec, log, i + 1)
                analyses_out.append(res)
                log.append(f"Analysis #{i + 1} '{res.get('type')}' OK ({len(res.get('tables') or [])} table(s))")
            except Exception as exc:
                log.append(f"Analysis #{i + 1} '{atype}' FAILED: {exc}")
                analyses_out.append({
                    "type": str(atype), "title": spec.get("title") or f"{atype} (failed)",
                    "tables": [], "note": f"ERROR: {exc}", "error": str(exc), "index": i + 1,
                })
                continue

        # ---- charts ------------------------------------------------------
        png_paths = {}
        if "png" in exports and HAVE_MPL:
            font_state = {}
            used_names = set()
            for ai, res in enumerate(analyses_out):
                if res.get("error") or res.get("type") not in CHART_TYPES:
                    continue
                seq = ai + 1
                fname = f"{base}-{res.get('type')}-{seq}.png"
                fpath = os.path.join(out_dir, fname)
                try:
                    if render_chart(res, ds, fpath, font_state):
                        png_paths[ai] = fpath
                        log.append(f"Chart saved: {fname}")
                        res["chart"] = fname
                except Exception as exc:
                    log.append(f"Chart for analysis #{seq} ({res.get('type')}) failed: {exc}")
            if font_state.get("font") is None:
                log.append("NOTE: no CJK font found; chart labels may render as boxes")
            elif font_state.get("font"):
                log.append(f"Chart font: {font_state.get('font')}")
        elif "png" in exports and not HAVE_MPL:
            log.append("NOTE: matplotlib unavailable; PNG charts skipped")

        # ---- assemble result --------------------------------------------
        variables_meta = []
        for v in ds.variables:
            variables_meta.append({
                "name": v.get("name"), "label": v.get("label"),
                "type": v.get("type"), "measure": v.get("measure"),
            })
        result = {
            "ok": True,
            "engineVersion": __version__,
            "generatedAt": _now_iso(),
            "dataset": {
                "rows": ds.n_rows,
                "columns": len(ds.variables),
                "variables": variables_meta,
                "sourcePath": ds.source_path,
            },
            "analyses": analyses_out,
            "outputs": [],
            "log": log,
        }

        # ---- exports (independent, best effort) --------------------------
        outputs = []
        if exports:
            def _add(kind, path, label):
                outputs.append({"kind": kind, "path": os.path.abspath(path), "label": label})

            csv_path = os.path.join(out_dir, f"{base}.csv")
            xlsx_path = os.path.join(out_dir, f"{base}.xlsx")
            docx_path = os.path.join(out_dir, f"{base}.docx")
            json_path = os.path.join(out_dir, f"{base}.json")
            sav_path = os.path.join(out_dir, f"{base}.sav")

            if "json" in exports:
                # Write after everything so charts/exports info is included.
                pass
            if "csv" in exports:
                try:
                    export_csv(result, ds, csv_path, log)
                    _add("csv", csv_path, "Analysis tables (CSV)")
                except Exception as exc:
                    log.append(f"CSV export FAILED: {exc}")
            if "xlsx" in exports:
                try:
                    export_xlsx(result, ds, xlsx_path, log)
                    _add("xlsx", xlsx_path, "Workbook (one sheet per table)")
                except Exception as exc:
                    log.append(f"XLSX export FAILED: {exc}")
            if "docx" in exports:
                try:
                    export_docx(result, ds, docx_path, log)
                    _add("docx", docx_path, "Word report")
                except Exception as exc:
                    log.append(f"DOCX export FAILED: {exc}")
            if "sav" in exports:
                try:
                    export_sav(ds, sav_path, log)
                    _add("sav", sav_path, "SPSS data (.sav)")
                except Exception as exc:
                    log.append(f"SAV export FAILED: {exc}")
            for ai, p in png_paths.items():
                _add("png", p, f"Chart for {analyses_out[ai].get('type')}")

            outputs.sort(key=lambda o: EXPORT_KINDS.index(o["kind"]) if o["kind"] in EXPORT_KINDS else 99)
            result["outputs"] = outputs

            if "json" in exports:
                try:
                    export_json(result, json_path, log)
                    _add("json", json_path, "Full result JSON")
                    result["outputs"] = outputs
                except Exception as exc:
                    log.append(f"JSON export FAILED: {exc}")

        result = to_json_safe(result)
        return result, 0
    except Exception as exc:
        tb = traceback.format_exc()
        log.append(f"FATAL: {exc}")
        return {"ok": False, "error": str(exc), "traceback": tb, "log": to_json_safe(log)}, 1


def main(argv=None):
    ap = argparse.ArgumentParser(description="SPSS-style statistics engine for DSH.")
    ap.add_argument("--payload", required=True, help="path to the request JSON file")
    ap.add_argument("--out-json", required=True, help="path to write the result JSON")
    args = ap.parse_args(argv)

    req = None
    try:
        with open(args.payload, "r", encoding="utf-8") as fh:
            req = json.load(fh)
        if not isinstance(req, dict):
            raise ValueError("payload must be a JSON object")
    except Exception as exc:
        payload_err = {"ok": False, "error": f"cannot read payload: {exc}",
                       "traceback": traceback.format_exc(), "log": []}
        _write_json(args.out_json, payload_err)
        print(json.dumps(payload_err, ensure_ascii=False))
        return 1

    result, code = run_job(req, args.out_json)
    _write_json(args.out_json, result)

    # Emit a compact machine-readable echo on stdout for the host.
    try:
        summary = {"ok": result.get("ok"), "outJson": os.path.abspath(args.out_json),
                   "analyses": len(result.get("analyses") or []),
                   "outputs": [o.get("path") for o in (result.get("outputs") or [])],
                   "error": result.get("error")}
        print(json.dumps(summary, ensure_ascii=False))
    except Exception:
        pass
    return code


def _write_json(path, obj):
    try:
        d = os.path.dirname(os.path.abspath(path))
        if d:
            os.makedirs(d, exist_ok=True)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(to_json_safe(obj), fh, ensure_ascii=False, indent=2, allow_nan=False)
    except Exception:
        # Last-resort: still try to write something valid.
        try:
            with open(path, "w", encoding="utf-8") as fh:
                json.dump({"ok": False, "error": "failed to serialize result"}, fh)
        except Exception:
            pass


if __name__ == "__main__":
    sys.exit(main())
