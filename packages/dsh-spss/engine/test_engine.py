#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
End-to-end verification for engine/analyze.py.

Runs every analysis type and every export kind against sample_data.csv,
then validates the resulting JSON for schema conformance and NaN/Inf safety.

Usage:
    python3 test_engine.py            # full run, prints verification report
Exit code 0 on success, 1 on failure.
"""

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(HERE, "analyze.py")
SAMPLE = os.path.join(HERE, "sample_data.csv")
PY = sys.executable

ALL_ANALYSES = [
    {"type": "freq", "variables": ["性别", "学历", "satisfaction"]},
    {"type": "descriptives", "variables": ["age", "score_a", "score_b", "score_c", "income"]},
    {"type": "crosstab", "variables": ["性别", "学历"]},
    {"type": "crosstab", "variables": ["satisfaction"], "groupBy": "性别"},
    {"type": "ttest_one", "variables": ["score_a", "score_b"], "options": {"testValue": 70}},
    {"type": "ttest_independent", "variables": ["score_a", "score_c"], "groupBy": "性别"},
    {"type": "paired_ttest", "variables": ["score_a", "score_b", "score_a", "score_c"]},
    {"type": "anova", "variables": ["score_a"], "groupBy": "学历",
     "options": {"postHoc": True}},
    {"type": "corr", "variables": ["age", "score_a", "score_b", "score_c"]},
    {"type": "regression", "variables": ["age", "score_a", "score_b", "score_c"],
     "options": {"dependent": "score_c"}},
    {"type": "reliability", "variables": ["score_a", "score_b", "score_c"]},
    {"type": "nonparametric", "variables": ["satisfaction"], "options": {"test": "chisquare"}},
    {"type": "nonparametric", "variables": ["score_a"], "groupBy": "性别",
     "options": {"test": "mannwhitney"}},
    {"type": "nonparametric", "variables": ["score_a", "score_b"], "options": {"test": "wilcoxon"}},
    {"type": "nonparametric", "variables": ["score_a"], "groupBy": "学历",
     "options": {"test": "kruskal"}},
]

REQUIRED_TYPES = ["freq", "descriptives", "crosstab", "ttest_one", "ttest_independent",
                  "paired_ttest", "anova", "corr", "regression", "reliability", "nonparametric"]

FAILURES = []
CHECKS = []


def check(name, cond, detail=""):
    CHECKS.append((name, bool(cond), detail))
    if not cond:
        FAILURES.append(f"{name}: {detail}")
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (f"  -- {detail}" if detail and not cond else ""))
    return bool(cond)


def has_bad_number(obj, path="$"):
    """Return first path containing NaN/Inf or a non-JSON type."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return path
        return None
    if isinstance(obj, dict):
        for k, v in obj.items():
            r = has_bad_number(v, f"{path}.{k}")
            if r:
                return r
        return None
    if isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            r = has_bad_number(v, f"{path}[{i}]")
            if r:
                return r
    return None


def run_payload(payload, out_json, expect_ok=True):
    payload_path = out_json + ".payload.json"
    with open(payload_path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False, indent=2)
    proc = subprocess.run([PY, ENGINE, "--payload", payload_path, "--out-json", out_json],
                          capture_output=True, text=True)
    result = None
    if os.path.isfile(out_json):
        with open(out_json, encoding="utf-8") as fh:
            result = json.load(fh)
    return proc, result


def main():
    print("=" * 78)
    print("DSH SPSS engine -- end-to-end verification")
    print("Engine :", ENGINE)
    print("Sample :", SAMPLE)
    print("Python :", PY)
    print("=" * 78)

    tmp = tempfile.mkdtemp(prefix="dsh-spss-test-")
    try:
        out_json = os.path.join(tmp, "result.json")
        payload = {
            "inputPath": SAMPLE,
            "inputFormat": "csv",
            "csvOptions": {"delimiter": ",", "encoding": "utf-8-sig", "header": True},
            "analyses": ALL_ANALYSES,
            "outDir": tmp,
            "exports": ["csv", "xlsx", "docx", "png", "json", "sav"],
            "outBaseName": "result",
        }

        print("\n-- 1. Full run: all analyses + all 6 export kinds --")
        proc, result = run_payload(payload, out_json)
        print("  exit code:", proc.returncode)
        if proc.stdout.strip():
            print("  stdout:", proc.stdout.strip()[:400])
        if proc.returncode != 0:
            print("  stderr:", proc.stderr.strip()[:2000])
        check("exit code == 0", proc.returncode == 0, f"exit={proc.returncode}")
        if result is None:
            print("  stderr:", proc.stderr[-3000:])
            raise SystemExit(1)
        check("result.ok is true", result.get("ok") is True, str(result.get("error")))
        if not result.get("ok"):
            print("  traceback:", (result.get("traceback") or "")[-3000:])
            raise SystemExit(1)

        # ---- dataset block ------------------------------------------------
        ds = result.get("dataset") or {}
        print("\n-- 2. Dataset block --")
        check("dataset.rows == 72", ds.get("rows") == 72, str(ds.get("rows")))
        check("dataset.columns == 9", ds.get("columns") == 9, str(ds.get("columns")))
        vars_ = ds.get("variables") or []
        check("dataset.variables well-formed",
              len(vars_) == 9 and all({"name", "label", "type", "measure"} <= set(v) for v in vars_),
              f"n={len(vars_)}")
        check("dataset.sourcePath absolute", os.path.isabs(ds.get("sourcePath") or ""), str(ds.get("sourcePath")))
        print("  variables:", [(v["name"], v["type"], v["measure"]) for v in vars_])

        # ---- analyses -----------------------------------------------------
        print("\n-- 3. Analysis results --")
        got = [a.get("type") for a in result.get("analyses") or []]
        for t in REQUIRED_TYPES:
            check(f"analysis '{t}' present", t in got, f"got={got}")
        check("all 15 analysis specs executed", len(result.get("analyses") or []) == len(ALL_ANALYSES),
              f"{len(result.get('analyses'))} vs {len(ALL_ANALYSES)}")
        errs = [a for a in result.get("analyses") or [] if a.get("error")]
        check("no analysis errored", not errs, "; ".join(f"{a['type']}:{a['error']}" for a in errs))

        for a in result.get("analyses") or []:
            tables = a.get("tables") or []
            ok_struct = isinstance(tables, list) and all(
                isinstance(t.get("columns"), list) and isinstance(t.get("rows"), list)
                and all(isinstance(r, list) for r in t.get("rows", []))
                for t in tables)
            check(f"{a.get('type')}#{a.get('index')} has tables with columns+rows", ok_struct and len(tables) > 0,
                  f"{len(tables)} table(s)")
            # Every row length matches its column count.
            bad = [t.get("title") for t in tables if any(len(r) != len(t.get("columns")) for r in t.get("rows", []))]
            check(f"{a.get('type')}#{a.get('index')} row widths consistent", not bad, str(bad))

        # ---- spot-check key statistics -----------------------------------
        print("\n-- 4. Statistical spot-checks (vs direct scipy/pandas) --")
        import numpy as np
        import pandas as pd
        from scipy import stats as sst
        df = pd.read_csv(SAMPLE, encoding="utf-8-sig")
        by = {a.get("type"): a for a in result.get("analyses") or []}

        # descriptives
        d = by["descriptives"]["tables"][0]
        i_sa = next(i for i, r in enumerate(d["rows"]) if r[0] == "score_a")
        row = d["rows"][i_sa]
        ref_mean = float(df["score_a"].mean())
        ref_sd = float(df["score_a"].std(ddof=1))
        check("descriptives mean(score_a) matches pandas",
              abs(row[4] - ref_mean) < 1e-4, f"{row[4]} vs {ref_mean}")
        check("descriptives SD(score_a) matches pandas",
              abs(row[7] - ref_sd) < 1e-4, f"{row[7]} vs {ref_sd}")
        check("descriptives N(score_c) excludes 4 missing",
              next(r[2] for r in d["rows"] if r[0] == "score_c") == 68,
              str(next(r[2] for r in d["rows"] if r[0] == "score_c")))
        check("descriptives skew matches scipy",
              abs(row[12] - float(sst.skew(df["score_a"].dropna(), bias=False))) < 1e-4)
        check("descriptives kurtosis matches scipy",
              abs(row[13] - float(sst.kurtosis(df["score_a"].dropna(), fisher=True, bias=False))) < 1e-4)

        # freq
        f = by["freq"]["tables"][1]  # 学历
        total_row = [r for r in f["rows"] if r[0] == "Total"][0]
        check("freq(学历) total == 72", total_row[2] == 72, str(total_row[2]))
        nov = [r for r in f["rows"] if r[0] == "本科"][0]
        check("freq(学历) 本科 count matches",
              nov[2] == int((df["学历"] == "本科").sum()), f"{nov[2]}")
        check("freq valid percent sums to 100",
              abs(sum(r[4] for r in f["rows"] if isinstance(r[4], (int, float))
                      and r[0] not in ("Total", "Missing")) - 100.0) < 2e-3,
              str(sum(r[4] for r in f["rows"] if isinstance(r[4], (int, float)))) )

        # crosstab (two crosstab specs exist; take the 2-var one)
        ct = [a for a in result["analyses"] if a["type"] == "crosstab"
              and (a.get("meta") or {}).get("colVar") == "学历"][0]
        pearson_p = None
        for t in ct["tables"]:
            if t["title"] == "Chi-Square Tests":
                pearson_p = t["rows"][0][3]
        tab2 = pd.crosstab(df["性别"], df["学历"])
        chi2, p, dof, exp = sst.chi2_contingency(tab2.values, correction=False)
        check("crosstab Pearson p matches scipy", abs(pearson_p - p) < 1e-4, f"{pearson_p} vs {p}")
        check("crosstab has 2x2 continuity correction row (Yates)",
              any(t["title"] == "Chi-Square Tests" and any("Continuity" in str(r[0]) for r in t["rows"])
                  for t in ct["tables"]))

        # ttest_independent
        ti = by["ttest_independent"]
        gt = [t for t in ti["tables"] if t["title"] == "Independent Samples Test"][0]
        t_row = gt["rows"][0]  # score_a by 性别
        gs = next(t for t in ti["tables"] if t["title"] == "Group Statistics")
        g1 = [r for r in gs["rows"] if r[0] == "score_a"][0][1]
        g2 = [r for r in gs["rows"] if r[0] == "score_a"][1][1]
        a = df.loc[df["性别"] == g1, "score_a"].dropna().to_numpy(float)
        b = df.loc[df["性别"] == g2, "score_a"].dropna().to_numpy(float)
        tref = sst.ttest_ind(a, b, equal_var=True)
        check("ttest_independent t matches scipy (pooled, same group order)",
              abs(t_row[3] - float(tref.statistic)) < 1e-4, f"{t_row[3]} vs {tref.statistic}")
        check("ttest_independent p matches scipy",
              abs(t_row[5] - float(tref.pvalue)) < 1e-4, f"{t_row[5]} vs {tref.pvalue}")
        lev_t = [t for t in ti["tables"] if "Levene" in t["title"]][0]
        lf, lp = sst.levene(a, b, center="mean")
        check("Levene F matches scipy", abs(lev_t["rows"][0][1] - lf) < 1e-4)
        welch = sst.ttest_ind(a, b, equal_var=False)
        check("Welch t matches scipy", abs(t_row[8] - float(welch.statistic)) < 1e-4)

        # anova
        an = by["anova"]
        an_t = [t for t in an["tables"] if t["title"] == "ANOVA"][0]
        groups = [g["score_a"].dropna().to_numpy(float) for _, g in df.groupby("学历")]
        fref = sst.f_oneway(*groups)
        check("ANOVA F matches scipy", abs(an_t["rows"][0][5] - float(fref.statistic)) < 1e-4,
              f"{an_t['rows'][0][5]} vs {fref.statistic}")
        check("ANOVA p matches scipy", abs(an_t["rows"][0][6] - float(fref.pvalue)) < 1e-4)
        check("ANOVA has Tukey post-hoc table", any("Tukey" in t["title"] for t in an["tables"]))
        check("ANOVA has Levene table", any("Levene" in t["title"] for t in an["tables"]))

        # corr
        co = by["corr"]
        pm = next(t for t in co["tables"] if t["title"] == "Pearson Correlation Matrix")
        idx = [r[0] for r in pm["rows"]]
        i, j = idx.index("age"), idx.index("score_a")
        rref = float(sst.pearsonr(df["age"], df["score_a"])[0])
        check("corr Pearson r(age,score_a) matches scipy", abs(pm["rows"][i][j + 1] - rref) < 1e-4,
              f"{pm['rows'][i][j + 1]} vs {rref}")
        check("corr has Spearman tables", any("Spearman" in t["title"] for t in co["tables"]))

        # regression
        rg = by["regression"]
        cf = next(t for t in rg["tables"] if t["title"] == "Coefficients")
        sub = df[["age", "score_a", "score_b", "score_c"]].dropna()
        Y = sub["score_c"].to_numpy(float)
        X = np.column_stack([np.ones(len(sub)), sub["age"], sub["score_a"], sub["score_b"]])
        beta = np.linalg.lstsq(X, Y, rcond=None)[0]
        b_age = next(r for r in cf["rows"] if r[1] == "age")[2]
        check("regression B(age) matches numpy lstsq", abs(b_age - beta[1]) < 1e-3,
              f"{b_age} vs {beta[1]}")
        ms = next(t for t in rg["tables"] if t["title"] == "Model Summary")
        pred = X @ beta
        r2ref = 1 - ((Y - pred) ** 2).sum() / ((Y - Y.mean()) ** 2).sum()
        check("regression R2 matches numpy", abs(ms["rows"][0][2] - r2ref) < 1e-4,
              f"{ms['rows'][0][2]} vs {r2ref}")
        check("regression VIF table present",
              any("VIF" in t["title"] for t in rg["tables"]),
              str([t["title"] for t in rg["tables"]]))

        # reliability
        rel = by["reliability"]
        alpha_row = rel["tables"][0]["rows"][0]
        items = df[["score_a", "score_b", "score_c"]].dropna().to_numpy(float)
        k = items.shape[1]
        alpha_ref = (k / (k - 1)) * (1 - items.var(axis=0, ddof=1).sum() / items.sum(axis=1).var(ddof=1))
        check("Cronbach alpha matches manual formula", abs(alpha_row[0] - alpha_ref) < 1e-4,
              f"{alpha_row[0]} vs {alpha_ref}")

        # nonparametric
        np_tabs = [a for a in result["analyses"] if a["type"] == "nonparametric"]
        check("nonparametric produced 4 result blocks", len(np_tabs) == 4, str(len(np_tabs)))
        chi_block = np_tabs[0]
        ts = next(t for t in chi_block["tables"] if t["title"] == "Test Statistics")
        vc = df["satisfaction"].dropna().value_counts().sort_index()
        cref = sst.chisquare(vc.to_numpy(float))
        check("chi-square GOF matches scipy", abs(ts["rows"][0][0] - float(cref.statistic)) < 1e-4)
        mw = np_tabs[1]
        mw_ts = next(t for t in mw["tables"] if t["title"] == "Test Statistics")
        mw_groups = [r[1] for r in next(t for t in mw["tables"] if "Rank" in t["title"])["rows"]]
        ma = df.loc[df["性别"] == mw_groups[0], "score_a"].dropna().to_numpy(float)
        mb = df.loc[df["性别"] == mw_groups[1], "score_a"].dropna().to_numpy(float)
        U_ref = sst.mannwhitneyu(ma, mb, alternative="two-sided")
        check("Mann-Whitney U matches scipy", abs(mw_ts["rows"][0][1] - float(U_ref.statistic)) < 1e-4)

        # ---- JSON safety --------------------------------------------------
        print("\n-- 5. JSON safety --")
        bad = has_bad_number(result)
        check("result JSON contains no NaN/Inf", bad is None, str(bad))
        check("result JSON re-serialises strictly",
              _strict_dumps_ok(result))

        # ---- outputs / files ----------------------------------------------
        print("\n-- 6. Export outputs --")
        outs = result.get("outputs") or []
        kinds = sorted({o.get("kind") for o in outs})
        for k in ("csv", "xlsx", "docx", "png", "json", "sav"):
            items = [o for o in outs if o.get("kind") == k]
            check(f"export kind '{k}' produced", len(items) > 0, f"kinds={kinds}")
            if items:
                check(f"export '{k}' files exist", all(os.path.isfile(o["path"]) for o in items))
                check(f"export '{k}' paths absolute",
                      all(os.path.isabs(o.get("path") or "") for o in items))
        for o in outs:
            p = o.get("path") or ""
            if os.path.isfile(p):
                print(f"  {o['kind']:5s} {os.path.getsize(p):>9,d} B  {os.path.basename(p)}")

        pngs = [o["path"] for o in outs if o.get("kind") == "png"]
        check(">= 5 PNG charts produced", len(pngs) >= 5, str(len(pngs)))
        check("PNG files are real PNGs",
              all(open(p, "rb").read(8) == b"\x89PNG\r\n\x1a\n" for p in pngs))

        # Validate xlsx with openpyxl.
        try:
            import openpyxl
            xp = next(o["path"] for o in outs if o["kind"] == "xlsx")
            wb = openpyxl.load_workbook(xp)
            check("xlsx opens; has analysis sheets", len(wb.sheetnames) >= 12, f"{len(wb.sheetnames)} sheets")
            print("  xlsx sheets:", wb.sheetnames[:6], "...")
        except Exception as exc:
            check("xlsx validates via openpyxl", False, repr(exc))

        # Validate docx with python-docx.
        try:
            import docx as _docx
            dp = next(o["path"] for o in outs if o["kind"] == "docx")
            doc = _docx.Document(dp)
            check("docx opens; has native tables", len(doc.tables) >= 10, f"{len(doc.tables)} tables")
            check("docx has paragraphs/headings", len(doc.paragraphs) >= 10, f"{len(doc.paragraphs)}")
        except Exception as exc:
            check("docx validates via python-docx", False, repr(exc))

        # Validate sav by re-reading it with pyreadstat.
        try:
            import pyreadstat
            sp = next(o["path"] for o in outs if o["kind"] == "sav")
            df_sav, meta = pyreadstat.read_sav(sp)
            check("sav re-reads via pyreadstat with 72 rows",
                  df_sav.shape[0] == 72 and df_sav.shape[1] == 9, str(df_sav.shape))
            check("sav preserves Chinese column names",
                  any("性别" in c for c in df_sav.columns), str(list(df_sav.columns)))
            check("sav preserves column labels",
                  bool(meta.column_names_to_labels), str(meta.column_names_to_labels)[:160])
        except Exception as exc:
            check("sav validates via pyreadstat", False, repr(exc))

        # csv content
        try:
            cp = next(o["path"] for o in outs if o["kind"] == "csv")
            txt = open(cp, encoding="utf-8-sig").read()
            check("csv contains analysis blocks and Chinese headers",
                  "== freq" in txt and "学历" in txt, txt[:80])
        except Exception as exc:
            check("csv content valid", False, repr(exc))

        # json export equals result
        try:
            jp = next(o["path"] for o in outs if o["kind"] == "json")
            with open(jp, encoding="utf-8") as fh:
                jdata = json.load(fh)
            check("exported json parses and matches analyses count",
                  jdata.get("ok") is True and len(jdata.get("analyses") or []) == len(ALL_ANALYSES))
        except Exception as exc:
            check("json export valid", False, repr(exc))

        # ---- error isolation ----------------------------------------------
        print("\n-- 7. Error isolation & CLI edge cases --")
        iso_json = os.path.join(tmp, "iso.json")
        iso_payload = {
            "inputPath": SAMPLE,
            "analyses": [
                {"type": "freq", "variables": ["性别"]},
                {"type": "freq", "variables": ["no_such_column"]},
                {"type": "bogus_analysis", "variables": ["性别"]},
                {"type": "regression", "variables": ["score_a"]},  # no predictors
                {"type": "descriptives", "variables": ["age"]},
            ],
            "outDir": tmp, "exports": ["json"], "outBaseName": "iso",
        }
        proc2, res2 = run_payload(iso_payload, iso_json)
        check("bad analyses do not abort the run", proc2.returncode == 0, f"exit={proc2.returncode}")
        check("good analyses still produced", res2 and not res2["analyses"][0].get("error")
              and not res2["analyses"][4].get("error"))
        check("bad analyses recorded as errors",
              sum(1 for a in (res2 or {}).get("analyses", []) if a.get("error")) == 3,
              str([(a.get("type"), a.get("error")) for a in (res2 or {}).get("analyses", [])]))
        print("  isolation log sample:",
              [ln for ln in (res2 or {}).get("log", []) if "FAILED" in ln][:3])

        # Missing input file -> ok:false, exit 1, valid JSON.
        err_json = os.path.join(tmp, "err.json")
        proc3, res3 = run_payload({"inputPath": "/nonexistent/nope.csv"}, err_json)
        check("missing input exits 1", proc3.returncode == 1, f"exit={proc3.returncode}")
        check("missing input writes ok:false with error+traceback",
              res3 and res3.get("ok") is False and res3.get("error") and res3.get("traceback"))

        # No exports -> no outDir required, no output files.
        noexp_json = os.path.join(tmp, "noexp.json")
        proc4, res4 = run_payload({"inputPath": SAMPLE,
                                   "analyses": [{"type": "descriptives", "variables": ["age"]}]},
                                  noexp_json)
        check("exports omitted -> ok with zero outputs",
              proc4.returncode == 0 and res4.get("ok") and res4.get("outputs") == [])

        # Variable subset.
        sub_json = os.path.join(tmp, "sub.json")
        proc5, res5 = run_payload({"inputPath": SAMPLE, "variables": ["age", "score_a"],
                                   "analyses": [{"type": "corr", "variables": ["age", "score_a"]}]},
                                  sub_json)
        check("variable subset limits dataset.columns to 2",
              res5 and res5["dataset"]["columns"] == 2, str((res5 or {}).get("dataset", {}).get("columns")))

        # TSV via csvOptions delimiter.
        tsv = os.path.join(tmp, "sample.tsv")
        df.to_csv(tsv, sep="\t", index=False)
        tsv_json = os.path.join(tmp, "tsv.json")
        proc6, res6 = run_payload({"inputPath": tsv, "inputFormat": "tsv",
                                   "analyses": [{"type": "descriptives", "variables": ["score_a"]}]},
                                  tsv_json)
        check("TSV input loads", proc6.returncode == 0 and res6 and res6.get("ok"),
              str((res6 or {}).get("error")))

        # Round-trip: use the exported .sav as the next input and preserve labels.
        sav_path = next(o["path"] for o in outs if o["kind"] == "sav")
        rt_json = os.path.join(tmp, "roundtrip.json")
        proc7, res7 = run_payload({"inputPath": sav_path,
                                   "analyses": [{"type": "freq", "variables": ["性别"]},
                                                {"type": "descriptives", "variables": ["score_a", "income"]}],
                                   "outDir": tmp, "exports": ["sav"], "outBaseName": "rt"},
                                  rt_json)
        check(".sav input re-analyses OK", proc7.returncode == 0 and res7 and res7.get("ok"),
              str((res7 or {}).get("error")))
        check(".sav input keeps 72 rows", res7 and res7["dataset"]["rows"] == 72)
        print("  roundtrip log:", [ln for ln in (res7 or {}).get("log", []) if "Read" in ln][:2])

        # Unicode outBaseName.
        uni_json = os.path.join(tmp, "uni.json")
        proc8, res8 = run_payload({"inputPath": SAMPLE, "outDir": tmp, "outBaseName": "分析结果",
                                   "analyses": [{"type": "freq", "variables": ["性别"]}],
                                   "exports": ["png", "docx"]}, uni_json)
        check("unicode outBaseName works", proc8.returncode == 0 and res8 and res8.get("ok"))

        # ---- summary ------------------------------------------------------
        # --- legacy Excel 2.x (BIFF2) ------------------------------------
        # Built here so the check needs no external fixture: a bare BIFF2
        # record stream named .xls, which pandas rejects outright.
        print("\n-- 8. legacy Excel 2.x (BIFF2) input --")
        import struct as _struct
        biff_path = os.path.join(tmp, "legacy-biff2.xls")
        records = []

        def _rec(rtype, body):
            return _struct.pack("<HH", rtype, len(body)) + body

        records.append(_rec(0x0009, _struct.pack("<HH", 0x0002, 0x0010)))  # BOF
        for col, name in enumerate([b"x", b"y"]):
            raw = name
            body = _struct.pack("<HH", 0, col) + b"\x00\x00\x00" + bytes([len(raw)]) + raw
            records.append(_rec(0x0004, body))                             # LABEL (header)
        values = [(100.0, 200.0), (150.0, 250.0), (200.0, 300.0)]
        for row, pair in enumerate(values, start=1):
            for col, value in enumerate(pair):
                body = _struct.pack("<HH", row, col) + b"\x00\x00" + _struct.pack("<d", value)
                records.append(_rec(0x0003, body))                         # NUMBER
        records.append(_rec(0x000A, b""))                                  # EOF
        with open(biff_path, "wb") as handle:
            handle.write(b"".join(records))

        biff_out = os.path.join(tmp, "biff-result.json")
        biff_payload = {
            "inputPath": biff_path,
            "analyses": [{"type": "descriptives", "variables": ["x", "y"]}],
            "exports": [],
            "outDir": tmp,
        }
        _proc, biff_result = run_payload(biff_payload, biff_out)
        biff_result = biff_result or {}
        check("BIFF2 stream is read instead of failing", biff_result.get("ok") is True, str(biff_result.get("error")))
        if biff_result.get("ok"):
            check("BIFF2 row count is 3", biff_result["dataset"]["rows"] == 3, str(biff_result["dataset"]["rows"]))
            check("BIFF2 column names come from the header",
                  [v["name"] for v in biff_result["dataset"]["variables"]][:2] == ["x", "y"],
                  str([v["name"] for v in biff_result["dataset"]["variables"]][:4]))
            stats_row = biff_result["analyses"][0]["tables"][0]["rows"][0]
            check("BIFF2 numeric values decode (mean of x = 150)",
                  abs(float(stats_row[4]) - 150.0) < 1e-6, str(stats_row[4]))

        print("\n" + "=" * 78)
        npass = sum(1 for _, ok, _ in CHECKS if ok)
        ntot = len(CHECKS)
        print(f"SUMMARY: {npass}/{ntot} checks passed")
        print("Analysis types exercised:", ", ".join(sorted({a['type'] for a in result['analyses']})))
        print("Export kinds produced:", ", ".join(kinds))
        if FAILURES:
            print("\nFAILURES:")
            for f in FAILURES:
                print("  -", f)
            print("=" * 78)
            return 1
        print("RESULT: ALL CHECKS PASSED")
        print("=" * 78)
        return 0
    finally:
        if "--keep" not in sys.argv:
            shutil.rmtree(tmp, ignore_errors=True)
        else:
            print("Artifacts kept at:", tmp)


def _strict_dumps_ok(obj):
    try:
        json.dumps(obj, ensure_ascii=False, allow_nan=False)
        return True
    except (ValueError, TypeError):
        return False


if __name__ == "__main__":
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except Exception:
        print("HARNESS EXCEPTION:", file=sys.stderr)
        traceback.print_exc()
        sys.exit(1)
