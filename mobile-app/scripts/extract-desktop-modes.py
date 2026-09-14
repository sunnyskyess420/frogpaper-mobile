"""Port the desktop FrogPaper prompt MODE definitions into the mobile app.

The desktop's prompt_builder.py defines _MODE_CONFIG: per-mode style wording,
quality cues and a mode-specific negative prompt, built from shared token
groups. This script evaluates just those literals (no GUI imports) and writes
them out as JSON so the mobile Build screen can use the owner's real rules
instead of an invented approximation.

Run:  python mobile-app/scripts/extract-desktop-modes.py
"""
import io
import json
import os
import re

DESKTOP = r"E:\FROGPAPER\FROGPAPER 1.5.0\prompt_builder.py"
APP_DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "data")

WANTED_BLOCKS = ["_HAND_NEGATIVES", "_FACE_NEGATIVES", "_COMMON", "_MODE_CONFIG"]
MODE_ORDER = [
    "stylized", "realistic", "cinematic", "anime", "dark-fantasy",
    "painterly", "pixel-art", "minimalist", "product-photo", "surreal",
]


def extract_block(source, name):
    """Pull `name = <literal>` (list/tuple/dict) out of the module source."""
    match = re.search(rf"(?m)^{re.escape(name)}\s*=\s*", source)
    if not match:
        raise SystemExit(f"could not find {name} in {DESKTOP}")
    start = match.end()
    opener = source[start]
    if opener not in "[({":
        raise SystemExit(f"{name} is not a literal container")
    depth = 0
    i = start
    in_str = None
    while i < len(source):
        ch = source[i]
        if in_str:
            if ch == in_str and source[i - 1] != "\\":
                in_str = None
        elif ch in "\"'":
            in_str = ch
        elif ch in "[({":
            depth += 1
        elif ch in "])}":
            depth -= 1
            if depth == 0:
                break
        i += 1
    return source[start:i + 1]


def main():
    with io.open(DESKTOP, encoding="utf-8", errors="replace") as fh:
        source = fh.read()

    namespace = {}
    for name in WANTED_BLOCKS:
        literal = extract_block(source, name)
        exec(f"{name} = {literal}", namespace)  # noqa: S102 - trusted local file, literals only

    config = namespace["_MODE_CONFIG"]
    out = {}
    for mode in MODE_ORDER:
        entry = config.get(mode)
        if not entry:
            raise SystemExit(f"mode '{mode}' missing from _MODE_CONFIG")
        out[mode] = {
            "styleBase": entry["style_base"].strip(),
            "qualityLead": entry["quality_lead"].strip(),
            "qualityClose": entry["quality_close"].strip(),
            "negative": re.sub(r"\s+", " ", entry["negative"]).strip().rstrip(","),
        }

    os.makedirs(APP_DATA, exist_ok=True)
    target = os.path.join(APP_DATA, "promptModes.json")
    with io.open(target, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"wrote {target}")
    for mode, data in out.items():
        print(f"  {mode:14} style='{data['styleBase'][:48]}...' negative={len(data['negative'].split(','))} terms")


if __name__ == "__main__":
    main()
