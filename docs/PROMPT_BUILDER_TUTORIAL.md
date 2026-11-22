# How to build a prompt

The Build screen turns a few taps into one sentence that the image model can
follow. Nothing here is required: leave a row alone and it simply drops out of
the sentence. The preview under the rows always shows exactly what will be sent.

## The rows, top to bottom

**Recipe** — a fill-in-the-blank template. Pick one and the rows below are
replaced by that recipe's own slots. Ignore it if you want to build by hand.

**Mode** — the overall finish (Cinematic, Anime, Pixel Art, Watercolor-ish…).
A mode adds its own wording and its own Avoid list, so it colours the whole
picture. Leave it on **Any** when you want your rows to do all the work, and
avoid Cinematic when you want something bright and warm — it adds "dramatic
lighting, rich shadow", which reads dark.

**Subject** — the one thing in the picture. A *thing*, not a feeling:
snowman, tree frog, gingerbread house, reindeer, a frog in a Santa hat.
One subject is enough; two compete.

**Setting** — where it is. A *place*: "snowy village at night", "cosy cabin with
a fireplace", "lily pond at dawn". Not a format — "movie poster", "4K wallpaper"
and "phone background" describe the output, not the scene, and the model will
draw the words instead of a place.

**Style** — how it is drawn: watercolor storybook, claymation, pixel art 16-bit,
oil painting. Pick one. Two styles pull against each other.

**Lighting** — the time of day or the light source: candlelight, golden hour,
moonlight, window light.

**Colour** — the overall palette: golden mist, ember orange, pastel dream,
teal highlights. (Type your own if the list has no word for it.)

**Mood** — the feeling: cozy, playful, hopeful, mysterious.

**Atmosphere** — what is in the air: snow, fog, embers, rain.

## The buttons

- **Use this prompt** hands the sentence (and the mode's Avoid list) to Generate.
- **🎲 Randomise** fills every row at once — a good way to find words you like.
- **Clear all** can be undone for a few seconds.
- In any sheet, the field at the top lets you type your own value; long lists
  also have a filter, and the last few picks come back as **Recent** chips.

## Four rules that do most of the work

1. **Say what you want to see, not what it is for.** "Christmas" is a feeling,
   not a subject; "a snowman in a snowy village" is a picture.
2. **One subject, one place.** Fill those two before anything else.
3. **Two or three rows beat eight.** Extra rows dilute the subject.
4. **Warm light beats sparkle.** Candlelight + cozy + snow turns a bare tree
   into a Christmas card; "movie poster" + Cinematic turns it into a dark
   forest.

## A worked example

What was asked for: Subject `Christmas`, Setting `Christmas movie poster`,
Mode `Cinematic`. The app glued it into *"A Christmas in a christmas movie
poster, movie-poster depth of field, dramatic lighting ratio, rich shadow…"* —
an adjective in a format, shot dark. The result was a lone tree in green fog.

What to try instead:

| Row | Value |
|-----|-------|
| Mode | Any |
| Subject | snowman (type it in — it is not in the list) |
| Setting | snowy village at night |
| Style | claymation |
| Lighting | candlelight |
| Colour | golden mist |
| Mood | cozy |
| Atmosphere | snow |

That reads as one sentence — *"A snowman in a snowy village at night, claymation
style, candlelight lighting, golden mist tones, cozy mood, snow"* — and it gives
the model a subject, a place, a look and a feeling. Swap the subject for "frog in
a Santa hat" and keep the rest; that is the whole trick.
