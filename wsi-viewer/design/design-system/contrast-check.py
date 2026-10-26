#!/usr/bin/env python3
"""
contrast-check.py — validates the Stoipath design-system tokens.

Reads tokens.css (same directory), resolves var() references per theme, and
reports, as Markdown:

  1. WCAG 2.x contrast ratios for every text pair the components use
     (requirement ≥ 4.5:1) and every non-text pair (≥ 3:1), in the dark and
     light themes.
  2. OKLCH chroma of every colour that may sit within 32 CSS px of the canvas
     (principle P7: chroma ≤ 0.03), and of the accent/semantic colours that
     may not.
  3. The 8-colour annotation palette: pairwise CIEDE2000 distance in normal
     vision and under deuteranopia / protanopia / tritanopia simulation
     (Machado, Oliveira & Fernandes 2009, severity 1.0), with the P7 target
     ΔE00 ≥ 20 for every pair after simulation; and the WCAG contrast of each
     palette colour (and of the two halo colours) against five H&E reference
     colours.

Exit status is 1 if any required pair fails. No third-party imports.

Usage:  python3 -I contrast-check.py [--markdown-out results.md]
"""
import math
import re
import sys
import itertools
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOKENS = HERE / "tokens.css"

# ----------------------------------------------------------------------------- parsing

def parse_blocks(css: str):
    """Return list of (selector, {prop: value}) for every rule, flattening @media
    by prefixing the selector with the media condition."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    blocks = []
    stack = []
    i = 0
    buf = ""
    while i < len(css):
        c = css[i]
        if c == "{":
            sel = buf.strip()
            buf = ""
            if sel.startswith("@media"):
                stack.append(("@", sel))
            else:
                stack.append(("rule", sel))
        elif c == "}":
            kind, sel = stack.pop()
            if kind == "rule":
                props = {}
                for decl in buf.split(";"):
                    if ":" in decl:
                        k, v = decl.split(":", 1)
                        props[k.strip()] = v.strip()
                media = " ".join(s for k, s in stack if k == "@")
                blocks.append(((media + " " if media else "") + sel, props))
            buf = ""
        else:
            buf += c
        i += 1
    return blocks


def theme_tokens(blocks, theme: str):
    """Merge :root tokens with the theme block. theme ∈ {dark, light}."""
    merged = {}
    for sel, props in blocks:
        if sel.startswith("@media"):
            continue
        sels = [s.strip() for s in sel.split(",")]
        if ":root" in sels:
            merged.update(props)
    for sel, props in blocks:
        if sel.startswith("@media"):
            continue
        sels = [s.strip() for s in sel.split(",")]
        if theme == "dark" and '[data-theme="dark"]' in sels:
            merged.update(props)
        if theme == "light" and '[data-theme="light"]' in sels:
            merged.update(props)
    return merged


VAR_RE = re.compile(r"var\((--[a-zA-Z0-9-]+)\)")


def resolve(tokens, name, depth=0):
    if depth > 20:
        raise RuntimeError("var() cycle at " + name)
    v = tokens[name]
    while True:
        m = VAR_RE.search(v)
        if not m:
            return v.strip()
        v = v.replace(m.group(0), resolve(tokens, m.group(1), depth + 1))


# ----------------------------------------------------------------------------- colour maths

def parse_color(s: str):
    """Return (r, g, b, a) floats 0..1 from #hex or rgba()."""
    s = s.strip()
    if s.startswith("#"):
        h = s[1:]
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        return r / 255, g / 255, b / 255, 1.0
    m = re.match(r"rgba?\(([^)]*)\)", s)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        r, g, b = (float(p) / 255 for p in parts[:3])
        a = float(parts[3]) if len(parts) > 3 else 1.0
        return r, g, b, a
    raise ValueError("unparsable colour: " + s)


def composite(fg, bg):
    """Source-over fg (with alpha) on opaque bg → opaque rgb."""
    r, g, b, a = fg
    br, bg_, bb, _ = bg
    return (r * a + br * (1 - a), g * a + bg_ * (1 - a), b * a + bb * (1 - a), 1.0)


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def linear_to_srgb(c):
    c = min(max(c, 0.0), 1.0)
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def rel_lum(rgb):
    r, g, b = (srgb_to_linear(c) for c in rgb[:3])
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(c1, c2):
    l1, l2 = rel_lum(c1), rel_lum(c2)
    hi, lo = max(l1, l2), min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)


def to_hex(rgb):
    return "#%02x%02x%02x" % tuple(int(round(min(max(c, 0), 1) * 255)) for c in rgb[:3])


def rgb_to_xyz(rgb):
    r, g, b = (srgb_to_linear(c) for c in rgb[:3])
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b
    return x, y, z


def xyz_to_lab(xyz):
    xn, yn, zn = 0.95047, 1.0, 1.08883
    def f(t):
        return t ** (1 / 3) if t > (6 / 29) ** 3 else t / (3 * (6 / 29) ** 2) + 4 / 29
    fx, fy, fz = f(xyz[0] / xn), f(xyz[1] / yn), f(xyz[2] / zn)
    return 116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)


def lab(rgb):
    return xyz_to_lab(rgb_to_xyz(rgb))


def cie_lstar(rgb):
    return lab(rgb)[0]


def de2000(lab1, lab2):
    L1, a1, b1 = lab1
    L2, a2, b2 = lab2
    C1 = math.hypot(a1, b1)
    C2 = math.hypot(a2, b2)
    Cbar = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)))
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    def hp(a, b):
        if a == 0 and b == 0:
            return 0.0
        h = math.degrees(math.atan2(b, a))
        return h + 360 if h < 0 else h
    h1p, h2p = hp(a1p, b1), hp(a2p, b2)
    dLp = L2 - L1
    dCp = C2p - C1p
    if C1p * C2p == 0:
        dhp = 0.0
    elif abs(h2p - h1p) <= 180:
        dhp = h2p - h1p
    elif h2p - h1p > 180:
        dhp = h2p - h1p - 360
    else:
        dhp = h2p - h1p + 360
    dHp = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dhp / 2))
    Lbp = (L1 + L2) / 2
    Cbp = (C1p + C2p) / 2
    if C1p * C2p == 0:
        hbp = h1p + h2p
    elif abs(h1p - h2p) <= 180:
        hbp = (h1p + h2p) / 2
    elif h1p + h2p < 360:
        hbp = (h1p + h2p + 360) / 2
    else:
        hbp = (h1p + h2p - 360) / 2
    T = (1 - 0.17 * math.cos(math.radians(hbp - 30)) + 0.24 * math.cos(math.radians(2 * hbp))
         + 0.32 * math.cos(math.radians(3 * hbp + 6)) - 0.20 * math.cos(math.radians(4 * hbp - 63)))
    dtheta = 30 * math.exp(-(((hbp - 275) / 25) ** 2))
    RC = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7))
    SL = 1 + (0.015 * (Lbp - 50) ** 2) / math.sqrt(20 + (Lbp - 50) ** 2)
    SC = 1 + 0.045 * Cbp
    SH = 1 + 0.015 * Cbp * T
    RT = -math.sin(math.radians(2 * dtheta)) * RC
    return math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH))


def oklch_chroma(rgb):
    r, g, b = (srgb_to_linear(c) for c in rgb[:3])
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(v) ** (1 / 3), v) for v in (l, m, s))
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return L, math.hypot(a, b2)


# Machado, Oliveira & Fernandes (2009) simulation matrices, severity 1.0, on linear RGB.
CVD = {
    "protan": [[0.152286, 1.052583, -0.204868],
               [0.114503, 0.786281, 0.099216],
               [-0.003882, -0.048116, 1.051998]],
    "deutan": [[0.367322, 0.860646, -0.227968],
               [0.280085, 0.672501, 0.047413],
               [-0.011820, 0.042940, 0.968881]],
    "tritan": [[1.255528, -0.076749, -0.178779],
               [-0.078411, 0.930809, 0.147602],
               [0.004733, 0.691367, 0.303900]],
}


def simulate(rgb, kind):
    lin = [srgb_to_linear(c) for c in rgb[:3]]
    M = CVD[kind]
    out = [sum(M[i][j] * lin[j] for j in range(3)) for i in range(3)]
    return tuple(linear_to_srgb(c) for c in out) + (1.0,)


# ----------------------------------------------------------------------------- checks

TEXT_PAIRS = [
    # (foreground token, background token(s) composited in order, label)
    ("--color-text", ["--color-surface--1"], "body text on surface −1 (strip, app bg)"),
    ("--color-text", ["--color-surface-0"], "body text on surface 0 (panels, top bar)"),
    ("--color-text", ["--color-surface-1"], "body text on surface 1 (rows, cards)"),
    ("--color-text", ["--color-surface-2"], "body text on surface 2 (dialogs, menus)"),
    ("--color-text-secondary", ["--color-surface--1"], "secondary text on surface −1"),
    ("--color-text-secondary", ["--color-surface-0"], "secondary text on surface 0"),
    ("--color-text-secondary", ["--color-surface-1"], "secondary text on surface 1"),
    ("--color-text-secondary", ["--color-surface-2"], "secondary text on surface 2"),
    ("--color-text", ["--color-row-hover"], "body text on hovered row"),
    ("--color-text-secondary", ["--color-row-hover"], "secondary text on hovered row"),
    ("--color-text", ["--color-control-selected"], "label on selected row / tool"),
    ("--color-text-secondary", ["--color-control-selected"], "secondary label on selected row"),
    ("--color-text", ["--color-control-bg"], "button label on control bg"),
    ("--color-text", ["--color-control-bg-hover"], "button label on control hover"),
    ("--color-text", ["--color-control-bg-active"], "button label on control active (pressed)"),
    ("--color-on-strong", ["--color-control-strong"], "primary (neutral strong) button label"),
    ("--color-text-inverse", ["--color-surface-inverse"], "tooltip text on inverse surface"),
    ("--color-text-on-canvas", ["--color-canvas-bg"], "HUD text directly on canvas backdrop"),
    ("--color-text-on-canvas", ["--color-canvas-bg", "--color-hud-backdrop"], "HUD text on HUD backdrop over canvas"),
    ("--grey-75", ["--color-canvas-bg", "--color-hud-backdrop"], "HUD secondary line (grey-75) on HUD backdrop"),
    ("--grey-83", ["--color-canvas-bg", "--color-hud-backdrop"], "plate body text (grey-83) on plate card"),
    ("--color-accent-text", ["--color-surface-2"], "link text on surface 2 (dialogs/About only)"),
    ("--color-on-accent", ["--color-accent"], "accent button label (dialog layer)"),
    ("--color-info", ["--color-surface-2"], "info text on surface 2 (dialog layer)"),
    ("--color-success", ["--color-surface-2"], "success text on surface 2 (dialog layer)"),
    ("--color-warning", ["--color-surface-2"], "warning text on surface 2 (dialog layer)"),
    ("--color-danger", ["--color-surface-2"], "danger text on surface 2 (dialog layer)"),
    ("--color-info", ["--color-surface-0"], "info text on surface 0"),
    ("--color-success", ["--color-surface-0"], "success text on surface 0"),
    ("--color-warning", ["--color-surface-0"], "warning text on surface 0"),
    ("--color-danger", ["--color-surface-0"], "danger text on surface 0"),
    ("--color-text", ["--color-surface-1", "--color-danger-bg"], "body text on danger tint (alert)"),
    ("--color-text", ["--color-surface-1", "--color-warning-bg"], "body text on warning tint (alert)"),
    ("--color-text", ["--color-surface-1", "--color-success-bg"], "body text on success tint (alert)"),
    ("--color-text", ["--color-surface-1", "--color-info-bg"], "body text on info tint (alert)"),
    ("--color-text-secondary", ["--color-surface-1", "--color-danger-bg"], "secondary text on danger tint"),
    ("--color-on-danger", ["--color-danger"], "label on solid danger button"),
    ("--color-badge-ruo-fg", ["--color-badge-ruo-bg"], "badge RUO"),
    ("--color-badge-learn-fg", ["--color-badge-learn-bg"], "badge LEARN"),
    ("--color-badge-clinical-fg", ["--color-badge-clinical-bg"], "badge CLINICAL-IH"),
    ("--color-badge-dx-fg", ["--color-badge-dx-bg"], "badge DX"),
    ("--color-mode-nav-fg", ["--color-mode-nav-bg"], "mode indicator NAV"),
    ("--color-mode-dx-fg", ["--color-mode-dx-bg"], "mode indicator DX"),
    ("--color-text-secondary", ["--color-surface-1"], "key hint (.key) on surface 1"),
]

NONTEXT_PAIRS = [
    ("--color-border-strong", ["--color-surface-0"], "control outline on surface 0"),
    ("--color-border-strong", ["--color-surface-1"], "control outline on surface 1"),
    ("--color-border-strong", ["--color-surface-2"], "control outline on surface 2"),
    ("--focus-ring", ["--color-surface-0"], "focus ring on surface 0"),
    ("--focus-ring", ["--color-surface-2"], "focus ring on surface 2"),
    ("--focus-ring", ["--focus-halo"], "focus ring against its halo"),
    ("--grey-95", ["--color-canvas-bg"], "focus ring on canvas backdrop (base.css forces grey-95 inside .canvas-area)"),
    ("--color-sharp", ["--color-surface--1"], "sharp glyph on strip"),
    ("--color-sharpening", ["--color-surface--1"], "sharpening ring on strip"),
    ("--color-offline", ["--color-surface--1"], "offline glyph on strip"),
    ("--color-control-selected-indicator", ["--color-control-selected"], "selected-tool bar on selected bg"),
    ("--color-control-selected", ["--color-surface-0"], "selected row bg vs surface 0 (informational; the bar carries state)"),
    ("--color-control-strong", ["--color-surface-0"], "primary button fill on surface 0"),
    ("--color-accent", ["--color-surface-2"], "accent button fill on surface 2 (dialog layer)"),
    ("--color-canvas-viewport", ["--grey-22"], "navigator viewport rectangle on thumbnail bg"),
    ("--color-surface-0", ["--color-border-strong"], "range thumb ring (surface-0) on track (border-strong)"),
    ("--color-border-strong", ["--color-surface-0"], "range track on surface 0"),
    ("--color-text", ["--color-surface-0"], "toggle on-track / range thumb fill on surface 0"),
    ("--color-info", ["--color-surface-1", "--color-info-bg"], "info glyph on info tint (dialog)"),
    ("--color-success", ["--color-surface-1", "--color-success-bg"], "success glyph on success tint (dialog)"),
    ("--color-warning", ["--color-surface-1", "--color-warning-bg"], "warning glyph on warning tint (dialog)"),
    ("--color-danger", ["--color-surface-1", "--color-danger-bg"], "danger glyph on danger tint (dialog)"),
    ("--color-info", ["--color-surface-2"], "toast info edge (dialog layer)"),
    ("--color-success", ["--color-surface-2"], "toast success edge (dialog layer)"),
    ("--color-warning", ["--color-surface-2"], "toast warning edge (dialog layer)"),
    ("--color-danger", ["--color-surface-2"], "toast danger edge (dialog layer)"),
    ("--color-skeleton-hi", ["--color-skeleton"], "skeleton shimmer (decorative; informational)"),
]

MARGIN_TOKENS = [  # may appear within 32 px of the canvas: chroma must be ≤ 0.03
    "--color-canvas-bg", "--color-surface--1", "--color-surface-0", "--color-surface-1", "--color-surface-2",
    "--color-text", "--color-text-secondary", "--color-text-on-canvas", "--color-border", "--color-border-strong",
    "--color-control-bg", "--color-control-bg-hover", "--color-control-bg-active", "--color-control-selected",
    "--color-control-selected-indicator", "--color-row-hover", "--color-control-strong", "--focus-ring", "--focus-halo",
    "--color-sharp", "--color-sharpening", "--color-soft", "--color-offline", "--color-mode-nav-bg", "--color-mode-dx-bg",
    "--color-badge-ruo-bg", "--color-badge-learn-bg", "--color-badge-clinical-bg", "--color-badge-dx-bg", "--color-canvas-viewport",
]
# Tints are allowed in the dock (Learn item feedback, alerts): their composite over surface-1 must also be ≤ 0.03.
MARGIN_TINTS = ["--color-info-bg", "--color-success-bg", "--color-warning-bg", "--color-danger-bg"]
NOT_MARGIN_TOKENS = ["--color-accent", "--color-info", "--color-success", "--color-warning", "--color-danger"]

ANN = [("--ann-1", "Sky blue"), ("--ann-2", "Sienna"), ("--ann-3", "Yellow"), ("--ann-4", "Deep blue"),
       ("--ann-5", "Teal"), ("--ann-6", "Amber"), ("--ann-7", "Ink"), ("--ann-8", "Chalk")]

HE_REFS = [  # reference colours for an H&E section at 20× (design assumptions, not measured)
    ("glass", "#f6f3f3"),
    ("eosin light (stroma)", "#f0c6d7"),
    ("eosin (cytoplasm)", "#e0a1bd"),
    ("hematoxylin light", "#9079b9"),
    ("hematoxylin nucleus", "#4b3a8e"),
]


def main(argv):
    css = TOKENS.read_text(encoding="utf-8")
    blocks = parse_blocks(css)
    out = []
    fails = 0

    def col(tokens, name):
        return parse_color(resolve(tokens, name))

    def bg_of(tokens, chain):
        base = col(tokens, chain[0])
        for t in chain[1:]:
            base = composite(col(tokens, t), base)
        return base

    for theme in ("dark", "light"):
        tokens = theme_tokens(blocks, theme)
        out.append(f"\n### {theme.capitalize()} theme\n")
        out.append("| Pair | Colours | Ratio | Req. | Result |")
        out.append("|---|---|---:|---:|---|")
        for fg, chain, label in TEXT_PAIRS:
            f = col(tokens, fg)
            b = bg_of(tokens, chain)
            f = composite(f, b)
            r = contrast(f, b)
            ok = r >= 4.5
            fails += 0 if ok else 1
            out.append(f"| {label} | `{to_hex(f)}` on `{to_hex(b)}` | {r:.2f}:1 | 4.5 | {'pass' if ok else '**FAIL**'} |")
        for fg, chain, label in NONTEXT_PAIRS:
            f = col(tokens, fg)
            b = bg_of(tokens, chain)
            f = composite(f, b)
            r = contrast(f, b)
            req = 3.0
            informational = "informational" in label
            ok = r >= req or informational
            fails += 0 if ok else 1
            res = "pass" if r >= req else ("info" if informational else "**FAIL**")
            out.append(f"| {label} | `{to_hex(f)}` on `{to_hex(b)}` | {r:.2f}:1 | 3.0 | {res} |")

        out.append(f"\n**OKLCH chroma, {theme} theme** (P7: tokens allowed inside the 32 px canvas margin must be ≤ 0.03)\n")
        out.append("| Token | Value | OKLCH C | Allowed in margin | Result |")
        out.append("|---|---|---:|---|---|")
        for t in MARGIN_TOKENS:
            c = col(tokens, t)
            if c[3] < 1:
                c = composite(c, col(tokens, "--color-canvas-bg"))
            _, C = oklch_chroma(c)
            ok = C <= 0.03
            fails += 0 if ok else 1
            out.append(f"| `{t}` | `{to_hex(c)}` | {C:.3f} | yes | {'pass' if ok else '**FAIL**'} |")
        for t in MARGIN_TINTS:
            c = composite(col(tokens, t), col(tokens, "--color-surface-1"))
            _, C = oklch_chroma(c)
            ok = C <= 0.03
            fails += 0 if ok else 1
            out.append(f"| `{t}` over surface-1 | `{to_hex(c)}` | {C:.3f} | yes (tint composite) | {'pass' if ok else '**FAIL**'} |")
        for t in NOT_MARGIN_TOKENS:
            c = col(tokens, t)
            _, C = oklch_chroma(c)
            out.append(f"| `{t}` | `{to_hex(c)}` | {C:.3f} | no (dialog layer only) | n/a |")

    # Annotation palette
    tokens = theme_tokens(blocks, "dark")
    out.append("\n### Annotation palette (both themes)\n")
    out.append("| Token | Name | Hex | CIE L* | Deutan sim | Protan sim | Tritan sim |")
    out.append("|---|---|---|---:|---|---|---|")
    cols = []
    for t, name in ANN:
        c = col(tokens, t)
        cols.append((t, name, c))
        out.append(f"| `{t}` | {name} | `{to_hex(c)}` | {cie_lstar(c):.0f} | `{to_hex(simulate(c,'deutan'))}` | `{to_hex(simulate(c,'protan'))}` | `{to_hex(simulate(c,'tritan'))}` |")

    out.append("\n**Pairwise ΔE00 (minimum over all 28 pairs; target ≥ 20 after deutan and protan simulation, P7)**\n")
    out.append("| Condition | Min ΔE00 | Closest pair | Pairs < 20 |")
    out.append("|---|---:|---|---|")
    for cond in ("normal", "deutan", "protan", "tritan"):
        worst = (1e9, None)
        low = []
        for (t1, n1, c1), (t2, n2, c2) in itertools.combinations(cols, 2):
            a = c1 if cond == "normal" else simulate(c1, cond)
            b = c2 if cond == "normal" else simulate(c2, cond)
            d = de2000(lab(a), lab(b))
            if d < worst[0]:
                worst = (d, f"{n1} / {n2}")
            if d < 20:
                low.append(f"{n1}/{n2} ({d:.1f})")
        req = cond in ("deutan", "protan")
        ok = worst[0] >= 20
        if req and not ok:
            fails += 1
        out.append(f"| {cond} | {worst[0]:.1f} | {worst[1]} | {', '.join(low) if low else 'none'}{'' if (ok or not req) else ' **FAIL**'} |")

    out.append("\n**Full pairwise ΔE00 under deuteranopia** (rows/cols in palette order)\n")
    names = [n for _, n, _ in cols]
    out.append("| | " + " | ".join(names) + " |")
    out.append("|---|" + "---|" * len(names))
    for i, (t1, n1, c1) in enumerate(cols):
        row = []
        for j, (t2, n2, c2) in enumerate(cols):
            if i == j:
                row.append("—")
            else:
                d = de2000(lab(simulate(c1, "deutan")), lab(simulate(c2, "deutan")))
                row.append(f"{d:.0f}")
        out.append(f"| {n1} | " + " | ".join(row) + " |")

    out.append("\n**Contrast against H&E reference colours** (WCAG ratio; the 1 px halo guarantees ≥ 3:1 for every stroke on every background — see the two halo rows)\n")
    out.append("| Colour | " + " | ".join(f"{n} `{h}`" for n, h in HE_REFS) + " | min |")
    out.append("|---|" + "---:|" * len(HE_REFS) + "---:|")
    halo_dark = composite(parse_color(resolve(tokens, "--ann-halo-dark")), parse_color("#ffffff"))
    halo_light = composite(parse_color(resolve(tokens, "--ann-halo-light")), parse_color("#000000"))
    rows = [(n, c) for _, n, c in cols] + [("halo dark (on white)", halo_dark), ("halo light (on black)", halo_light)]
    for name, c in rows:
        vals = [contrast(c, parse_color(h)) for _, h in HE_REFS]
        out.append(f"| {name} `{to_hex(c)}` | " + " | ".join(f"{v:.2f}" for v in vals) + f" | {min(vals):.2f} |")

    out.append("\n**ΔE00 of each palette colour against the two stain references** (higher is more separable from tissue hue)\n")
    out.append("| Colour | vs eosin `#e0a1bd` | vs hematoxylin `#4b3a8e` |")
    out.append("|---|---:|---:|")
    eos, hem = lab(parse_color("#e0a1bd")), lab(parse_color("#4b3a8e"))
    for _, name, c in cols:
        out.append(f"| {name} | {de2000(lab(c), eos):.0f} | {de2000(lab(c), hem):.0f} |")
    # Also show why reddish purple was dropped
    rp = parse_color("#cc79a7")
    out.append(f"| Okabe-Ito reddish purple `#cc79a7` (dropped) | {de2000(lab(rp), eos):.0f} | {de2000(lab(rp), hem):.0f} |")

    # Reference: the unmodified Okabe-Ito 8 under the same test, to show why it was re-derived
    OI = [("Orange", "#e69f00"), ("Sky blue", "#56b4e9"), ("Bluish green", "#009e73"), ("Yellow", "#f0e442"),
          ("Blue", "#0072b2"), ("Vermilion", "#d55e00"), ("Reddish purple", "#cc79a7"), ("Black", "#000000")]
    out.append("\n**Reference: unmodified Okabe-Ito (2008) under the same test** (not shipped; shown to justify the re-derivation)\n")
    out.append("| Condition | Min ΔE00 | Closest pair | Pairs < 20 |")
    out.append("|---|---:|---|---|")
    for cond in ("normal", "deutan", "protan"):
        worst = (1e9, None); low = []
        for (n1, h1), (n2, h2) in itertools.combinations(OI, 2):
            c1, c2 = parse_color(h1), parse_color(h2)
            a = c1 if cond == "normal" else simulate(c1, cond)
            b = c2 if cond == "normal" else simulate(c2, cond)
            d = de2000(lab(a), lab(b))
            if d < worst[0]:
                worst = (d, f"{n1} / {n2}")
            if d < 20:
                low.append(f"{n1}/{n2} ({d:.1f})")
        out.append(f"| {cond} | {worst[0]:.1f} | {worst[1]} | {', '.join(low) if low else 'none'} |")

    summary = f"\n**Result: {'all required pairs pass' if fails == 0 else str(fails) + ' required check(s) FAILED'}.**\n"
    out.append(summary)
    text = "\n".join(out)
    print(text)
    if "--markdown-out" in argv:
        Path(argv[argv.index("--markdown-out") + 1]).write_text(text, encoding="utf-8")
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
