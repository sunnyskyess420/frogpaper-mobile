"""Tests for the frog/toad subject enhancer and prompt composition.

The enhancer used to append ONE fixed phrase for "frog" and one for "toad",
so every frog wallpaper was the same green tree frog. It now draws a breed
from a pool - random per request, deterministic per seed.

A live check then showed the breed was ignored: a breed clause buried before
the long quality suffix loses to the user's own wording, so three generations
of the same prompt all came back green. The composed prompt therefore now
LEADS with the breed's descriptive phrase and substitutes the breed's short
name into the user's own sentence.

Repo-portable, no network, no access key needed:
    python backend/tests/test_subject_enhancer.py
"""
import random
import sys
import tempfile
from pathlib import Path
from urllib.parse import unquote

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from services import image_generation as ig  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"  {'PASS' if cond else 'FAIL'}  {name} {extra}")


FROG_PHRASES = {breed["phrase"] for breed in ig._FROG_POOL}
TOAD_PHRASES = {breed["phrase"] for breed in ig._TOAD_POOL}
ALL_BREED_PHRASES = FROG_PHRASES | TOAD_PHRASES
GENERIC_ANIMAL = (
    ", adorable healthy animal with expressive eyes and correct "
    "anatomy, professional wildlife photography"
)

print("[1] breed pools")
check("frog pool has >= 12 varieties", len(ig._FROG_POOL) >= 12,
      f"({len(ig._FROG_POOL)})")
check("toad pool has >= 4 varieties", len(ig._TOAD_POOL) >= 4,
      f"({len(ig._TOAD_POOL)})")
frog_names = [b["name"] for b in ig._FROG_POOL]
toad_names = [b["name"] for b in ig._TOAD_POOL]
check("frog names unique", len(frog_names) == len(set(frog_names)))
check("toad names unique", len(toad_names) == len(set(toad_names)))
check("no frog/toad name overlap", not (set(frog_names) & set(toad_names)))
check("all phrases unique", len(ALL_BREED_PHRASES) == len(ig._FROG_POOL) + len(ig._TOAD_POOL))
check("every phrase keeps macro + anatomy cues",
      all("professional wildlife macro photography" in p and "correct anatomy" in p
          for p in ALL_BREED_PHRASES))

print("[2] (a) no seed -> many distinct phrases")
N = 200
picks = [ig._subject_enhancer("frog", seed=None) for _ in range(N)]
unique = len(set(picks))
print(f"   {unique} distinct frog phrases out of {N} no-seed calls")
check("no-seed draws are varied", unique > 1)
check("no-seed touches at least 12 of the pool", unique >= 12)
check("no-seed never falls back to an empty enhancer", all(p.startswith(", ") for p in picks))

print("[3] (b) same seed -> same phrase, independent of global RNG")
seeds = list(range(1, 41))
per_seed = {s: ig._subject_enhancer("frog", seed=s) for s in seeds}
stable = ig._subject_enhancer("frog", seed=42)
check("seed repeated 50x is stable",
      all(ig._subject_enhancer("frog", seed=42) == stable for _ in range(50)))
check("seed map is one phrase per seed", len(set(per_seed.values())) > 1)
check("different seeds mostly differ (>= 8 distinct over 40 seeds)",
      len(set(per_seed.values())) >= 8, f"({len(set(per_seed.values()))})")
check("seeded picks come from the frog pool",
      all(p in {", " + ph for ph in FROG_PHRASES} for p in per_seed.values()))
state_before = random.getstate()
ig._subject_enhancer("frog", seed=None)
ig._subject_enhancer("frog", seed=777)
check("global RNG state untouched", random.getstate() == state_before)

print("[4] (c) a named species is never overridden")
NAMED = [
    "a red-eyed tree frog perched on a leaf",
    "poison dart frog wallpaper",
    "an american bullfrog in a pond",
    "a glass frog on a fern",
    "a strawberry poison dart frog, macro shot",
    "a cane toad on damp ground",
    "a spring peeper calling at dusk",
]
generic_expected = ", " + ig._GENERIC_FROG_CUES
for prompt in NAMED:
    got = ig._subject_enhancer(prompt, seed=3)
    check(f"named species kept generic: {prompt[:34]!r}",
          got == generic_expected and got not in ALL_BREED_PHRASES)
seeded_named = {ig._subject_enhancer("a red-eyed tree frog", seed=s) for s in seeds}
check("named species is generic for every seed", seeded_named == {generic_expected})
plain = {ig._subject_enhancer("frog", seed=s) for s in seeds}
check("unnamed frog still gets real breeds", plain != {generic_expected} and ", " + ig._GENERIC_FROG_CUES not in plain)

print("[5] (d) word boundaries + plurals")
check("'cathedral' is not a cat", ig._subject_enhancer("gothic cathedral at sunset") == "")
check("'category' is not a cat", ig._subject_enhancer("a category of wallpapers") == "")
check("'caterpillar' is not a cat", ig._subject_enhancer("a green caterpillar") == "")
plural = ig._subject_enhancer("frogs everywhere", seed=11)
check("plural 'frogs' matched", plural in {", " + ph for ph in FROG_PHRASES}, repr(plural[:40]))
toad_plural = ig._subject_enhancer("toads in the garden", seed=11)
check("plural 'toads' matched", toad_plural in {", " + ph for ph in TOAD_PHRASES},
      repr(toad_plural[:40]))
check("'cathedral frogs' still matches the frog", ig._subject_enhancer("cathedral frogs", seed=11)
      in {", " + ph for ph in FROG_PHRASES})

print("[6] (e) generic fallback for other animals")
for animal in ("a sleeping cat", "a happy dog", "a majestic owl", "an epic dragon"):
    got = ig._subject_enhancer(animal, seed=3)
    check(f"generic fallback: {animal}", got == GENERIC_ANIMAL)
check("generic fallback is not a frog phrase", GENERIC_ANIMAL not in ALL_BREED_PHRASES)
check("non-animal prompt gets no enhancer", ig._subject_enhancer("misty mountains at dawn") == "")

print("[7] generator threads the seed into the real prompt")
captured = {}
real_get = ig.requests.get


def fake_get(url, params=None, timeout=None, headers=None):
    captured["url"] = url
    captured["params"] = params
    raise ig.requests.RequestException("stop before any network I/O")


ig.requests.get = fake_get
try:
    with tempfile.TemporaryDirectory(prefix="frogpaper_enh_") as tmp:
        sent_by_seed = {}
        for s in (123, 123, 124):
            captured.clear()
            try:
                ig.generate_image("a frog", images_dir=tmp, seed=s, retries=1)
            except ig.GenerationError:
                pass
            sent = unquote(captured["url"].split("/prompt/", 1)[1])
            breed = ig._breed_for(ig._normalize_words("a frog"), s)
            expected = (
                f"{breed['phrase']}, a {breed['name']}"
                f"{ig.POLLINATIONS_QUALITY_SUFFIX}"
            )
            check(f"generate_image seed={s} composes breed-first", sent == expected)
            sent_by_seed[s] = sent
        check("generate_image same seed -> byte-identical prompt",
              sent_by_seed[123] == ig._compose_prompt("a frog", 123))
finally:
    ig.requests.get = real_get

print("[8] breed name substituted into the user's own sentence")
check("first bare word swapped",
      ig._substitute_breed_name("a cute frog sitting on a lilypad", "tomato frog")
      == "a cute tomato frog sitting on a lilypad")
check("only the first occurrence changes",
      ig._substitute_breed_name("a frog next to another frog", "tomato frog")
      == "a tomato frog next to another frog")
check("'frogs' stays plural",
      ig._substitute_breed_name("frogs everywhere", "tomato frog")
      == "tomato frogs everywhere")
check("'toads' stays plural",
      ig._substitute_breed_name("toads in the garden", "cane toad")
      == "cane toads in the garden")
check("capitalised bare word keeps its capital",
      ig._substitute_breed_name("Frogs on a log", "glass frog")
      == "Glass frogs on a log")
check("surrounding text untouched",
      ig._substitute_breed_name("A cute frog, misty pond at dawn!", "spring peeper")
      == "A cute spring peeper, misty pond at dawn!")
check("'bullfrog' is not a bare frog word",
      ig._substitute_breed_name("an american bullfrog", "tomato frog")
      == "an american bullfrog")

print("[9] composed prompt: breed phrase leads, suffix trails")
SAMPLE = "a cute frog sitting on a lilypad, misty pond at dawn"
composed = {}
for s in seeds:
    breed = ig._breed_for(ig._normalize_words(SAMPLE), s)
    subject = ig._substitute_breed_name(SAMPLE, breed["name"])
    expected = f"{breed['phrase']}, {subject}{ig.POLLINATIONS_QUALITY_SUFFIX}"
    composed[s] = ig._compose_prompt(SAMPLE, s)
    check(f"seed={s} follows the composition rule", composed[s] == expected,
          f"({breed['name']})")
check("breed phrase leads every composed frog prompt",
      all(c.startswith(ig._breed_for(ig._normalize_words(SAMPLE), s)["phrase"])
          for s, c in composed.items()))
check("quality suffix still trails every composed prompt",
      all(c.endswith(ig.POLLINATIONS_QUALITY_SUFFIX) for c in composed.values()))
check("user prompt with the breed name appears in full",
      all(f"a cute {ig._breed_for(ig._normalize_words(SAMPLE), s)['name']}"
          f" sitting on a lilypad, misty pond at dawn" in c
          for s, c in composed.items()))
check("no seed/named-species leakage: composed variety over 40 seeds (>= 8)",
      len(set(composed.values())) >= 8, f"({len(set(composed.values()))})")
check("same seed composes byte-identically",
      ig._compose_prompt(SAMPLE, 42) == ig._compose_prompt(SAMPLE, 42))
check("different seeds mostly compose differently",
      len({ig._compose_prompt(SAMPLE, s) for s in seeds}) >= 8)

print("[10] non-breed prompts compose exactly as before")
NAMED_SAMPLE = "a red-eyed tree frog perched on a leaf"
expected_named = (
    f"{NAMED_SAMPLE}, {ig._GENERIC_FROG_CUES}{ig.POLLINATIONS_QUALITY_SUFFIX}"
)
check("named species untouched",
      ig._compose_prompt(NAMED_SAMPLE, 5) == expected_named)
check("named species untouched for every seed",
      {ig._compose_prompt(NAMED_SAMPLE, s) for s in seeds} == {expected_named})
OTHER = "misty mountains at dawn"
check("non-animal prompt unchanged",
      ig._compose_prompt(OTHER, 5) == f"{OTHER}{ig.POLLINATIONS_QUALITY_SUFFIX}")
CAT = "a sleeping cat"
check("generic-animal prompt unchanged",
      ig._compose_prompt(CAT, 5)
      == f"{CAT}{GENERIC_ANIMAL}{ig.POLLINATIONS_QUALITY_SUFFIX}")
check("named-species prompt is not rewritten",
      "red-eyed tree frog" in ig._compose_prompt(NAMED_SAMPLE, 5))

print()
print(f"RESULT: {len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
