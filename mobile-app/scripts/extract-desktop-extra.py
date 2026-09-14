"""Port the desktop FrogPaper recipes + negative presets into the mobile app.

Reads the desktop JSON data files (they are plain data, no code) and writes
trimmed copies into mobile-app/src/data/ for the Build screen (recipes) and the
Generate screen's Avoid field (quick negative presets).

Run:  python mobile-app/scripts/extract-desktop-extra.py
"""
import io
import json
import os

DESKTOP = r"E:\FROGPAPER\FROGPAPER 1.5.0"
APP_DATA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "src", "data")


def load(name):
    with io.open(os.path.join(DESKTOP, name), encoding="utf-8", errors="replace") as fh:
        return json.load(fh)


def main():
    os.makedirs(APP_DATA, exist_ok=True)

    # ---- recipes: keep only what the mobile UI needs -----------------------
    raw_recipes = load("recipes.json").get("recipes", [])
    recipes = []
    for r in raw_recipes:
        variables = {k: v for k, v in (r.get("variables") or {}).items() if isinstance(v, list) and v}
        if not r.get("template_text") or not variables:
            continue
        recipes.append({
            "name": r["name"],
            "description": r.get("description", ""),
            "template": r["template_text"],
            "variables": variables,
        })
    with io.open(os.path.join(APP_DATA, "recipes.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(recipes, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"recipes.json: {len(recipes)} recipe(s)")
    for r in recipes:
        print(f"  - {r['name']}: {len(r['variables'])} variable slots ({', '.join(r['variables'])})")

    # ---- negative presets: presets + the per-style defaults ----------------
    raw_neg = load("negative_presets.json")
    presets = raw_neg.get("presets", {})
    style_defaults = raw_neg.get("style_defaults", {})
    out = {
        "presets": [
            {
                "id": key,
                "label": (value.get("name") or key.replace("_", " ")) if isinstance(value, dict) else key.replace("_", " "),
                "description": value.get("description", "") if isinstance(value, dict) else "",
                "terms": (value.get("negatives", "") if isinstance(value, dict) else value) or "",
            }
            for key, value in presets.items()
        ],
        "styleDefaults": {
            key: (value if isinstance(value, str) else ", ".join(value))
            for key, value in style_defaults.items()
        },
    }
    with io.open(os.path.join(APP_DATA, "negativePresets.json"), "w", encoding="utf-8", newline="\n") as fh:
        json.dump(out, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"negativePresets.json: {len(out['presets'])} preset(s), {len(out['styleDefaults'])} style default(s)")
    for p in out["presets"]:
        print(f"  - {p['label']}: {len(p['terms'])} chars")


if __name__ == "__main__":
    main()
