"""Tests for searchable image filenames (the prompt slug).

Generated files used to be ``pollinations_20260927-124500.png`` - nothing you
could search for. They now carry a short slug of the prompt so the name (and the
gallery search) reflects what the picture is:

    pollinations_20260927-124500_serene-frog-pond-at-dusk.png

Repo-portable, no network, no access key:
    python backend/tests/test_filenames.py
"""
import io
import re
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services import image_generation as ig  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name} {extra}")


# A real PNG is built at runtime so save_uploaded_image's byte-based type check
# is happy. PIL is present in this project's environment; the upload test is
# skipped (not failed) when it is not, rather than shipping a hand-rolled PNG.
try:
    from PIL import Image as _PILImage

    _buf = io.BytesIO()
    _PILImage.new("RGB", (2, 2), (10, 20, 30)).save(_buf, format="PNG")
    PNG_BYTES = _buf.getvalue()
except Exception:  # noqa: BLE001
    PNG_BYTES = None


def test_slugify():
    print("slugify_prompt")
    check("plain sentence -> dashed slug",
          ig.slugify_prompt("A serene frog pond at dusk") == "serene-frog-pond-at-dusk",
          ig.slugify_prompt("A serene frog pond at dusk"))
    check("leading 'the' dropped",
          ig.slugify_prompt("The moon over water") == "moon-over-water",
          ig.slugify_prompt("The moon over water"))
    check("capped to six words",
          ig.slugify_prompt("one two three four five six seven") == "one-two-three-four-five-six")
    check("accents folded to ascii",
          ig.slugify_prompt("caf\u00e9 d\u00e9j\u00e0 vu") == "cafe-deja-vu",
          ig.slugify_prompt("caf\u00e9 d\u00e9j\u00e0 vu"))
    check("punctuation stripped",
          ig.slugify_prompt("frog, pond! at: dawn?") == "frog-pond-at-dawn",
          ig.slugify_prompt("frog, pond! at: dawn?"))
    check("empty / None / symbols -> no slug",
          ig.slugify_prompt("") == "" and ig.slugify_prompt(None) == "" and ig.slugify_prompt("!!!") == "")
    long_slug = ig.slugify_prompt("supercalifragilistic expialidocious antidisestablishmentarianism")
    check("hard length cap, no trailing dash",
          len(long_slug) <= 40 and not long_slug.endswith("-"), long_slug)


def test_save_image():
    print("_save_image naming")
    with tempfile.TemporaryDirectory() as d:
        p = Path(d)
        name = ig._save_image(b"bytes", p, ".png", provider="pollinations",
                              prompt="A serene frog pond at dusk")
        check("provider prefix stays first", name.startswith("pollinations_"), name)
        check("name carries the prompt slug", name.endswith("_serene-frog-pond-at-dusk.png"), name)
        check("name keeps the timestamp",
              bool(re.search(r"^pollinations_\d{8}-\d{6}_serene-frog-pond-at-dusk\.png$", name)), name)
        check("the file is actually written", (p / name).is_file())

        plain = ig._save_image(b"bytes", p, ".png", provider="gemini")
        check("no prompt -> no slug", bool(re.search(r"^gemini_\d{8}-\d{6}\.png$", plain)), plain)

        again = ig._save_image(b"bytes", p, ".png", provider="pollinations",
                               prompt="A serene frog pond at dusk")
        check("a clashing name is disambiguated", again != name, f"{name} vs {again}")


def test_upload_name():
    print("save_uploaded_image naming")
    if PNG_BYTES is None:
        print("  SKIP  PIL unavailable - upload naming not exercised")
        return
    with tempfile.TemporaryDirectory() as d:
        p = Path(d)
        meta = ig.save_uploaded_image(PNG_BYTES, "Sunset Over Lake.png", p)
        check("upload keeps the 'uploaded_' prefix", meta["filename"].startswith("uploaded_"), meta["filename"])
        check("upload carries a slug from the original name",
              meta["filename"].endswith("_sunset-over-lake.png"), meta["filename"])
        check("upload records the original name", meta.get("original_name") == "Sunset Over Lake.png")

        try:
            ig.save_uploaded_image(b"", "empty.png", p)
            check("empty upload is rejected", False)
        except ValueError:
            check("empty upload is rejected", True)


if __name__ == "__main__":
    test_slugify()
    test_save_image()
    test_upload_name()
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
    sys.exit(1 if FAIL else 0)
