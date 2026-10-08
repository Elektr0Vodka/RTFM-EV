# Desktop buddy tools

## `acs_to_clippy.py`

Converts a Microsoft Agent 2.0 character file (`.acs`) into the two files the
`clippyjs` library reads for an agent: `agent.json` (animation data) and
`map.png` (sprite sheet). The app's desktop buddy can then load that character
next to the 10 that `clippyjs` ships, without changes to the library.

Standard library only (Python 3.11+). Format reference:
[MS Agent Character Data Specification](https://uploads.s.zeid.me/ms-agent-format-spec.html)
by Remy Lebeau.

### Usage

```bash
python scripts/buddy/acs_to_clippy.py Robby.acs --info
```

```bash
python scripts/buddy/acs_to_clippy.py Robby.acs --out out/robby --preview
```

| Flag | Result |
| --- | --- |
| `--info` | Print name, frame size, palette, states and every animation with its transition type. |
| `--out DIR` | Write `agent.json` and `map.png` to `DIR`. |
| `--preview` | Also write `preview.html`: a self-contained page with a button per animation. It steps frames by the same rules as the `clippyjs` animator. Open it by double-click. |
| `--sounds` | Also write `sounds/N.wav` (the app never loads buddy sounds). |
| `--columns N` | Sprite sheet columns. Default: close to square. |
| `--no-chain-returns` | Leave return animations as separate animations only (see below). |
| `--no-aliases` | Do not add the `Show`, `Hide` and `Idle...` names `clippyjs` needs (see below). |

Treat `.acs` files from the internet as untrusted input: keep them outside the
repository and run the converter with `python -I`.

### Adding a converted buddy to the app

1. Convert with `--out frontend/src/buddy/custom/<id>`.
2. Add one entry to `CUSTOM_BUDDY_AGENTS` in `frontend/src/buddy/customAgents.ts`
   (the file holds a commented example).
3. Build. The buddy shows up in the picker after the `clippyjs` ones, as its own
   lazy chunk. Vite emits `map.png` as an asset file (inlined only under 4 KiB).

### Buddies converted so far

Converted on 2026-10-08 with default options, from a local collection that is
not part of this repository.

| Id | Name | Source file | Frame | Sheet |
| --- | --- | --- | --- | --- |
| `dot` | The Dot | `DOT.ACS` | 124x93 | 131 KiB |
| `logo` | Office Logo | `LOGO.ACS` | 124x93 | 390 KiB |
| `mothernature` | Mother Nature | `MNATURE.ACS` | 124x93 | 790 KiB |
| `courtney` | Courtney | `courtney.acs` | 80x80 | 303 KiB |
| `earl` | Earl | `earl.acs` | 80x80 | 495 KiB |
| `birdie` | Birdie | `Birdie.acs` | 144x144 | 172 KiB |
| `cami` | Cami | `Cami.acs` | 128x128 | 301 KiB |
| `charlie` | Charlie | `Charlie.acs` | 160x160 | 872 KiB |
| `eman` | E-Man | `E-man.acs` | 128x128 | 2498 KiB |
| `ewoman` | E-Woman | `E-woman.acs` | 128x128 | 2187 KiB |
| `electra` | Electra | `Electra.acs` | 128x128 | 78 KiB |
| `gar` | Gar | `Gar.acs` | 128x128 | 544 KiB |
| `hanz` | Hanz | `Hanz.acs` | 128x128 | 421 KiB |
| `milton` | Milton | `Milton.acs` | 128x128 | 784 KiB |
| `oscar` | Oscar | `Oscar.acs` | 128x128 | 286 KiB |
| `plany` | Plany | `Plany.acs` | 128x128 | 214 KiB |
| `santa` | Santa | `Santa.acs` | 144x144 | 1064 KiB |
| `vrgirl` | VRGirl | `Vrgirl.acs` | 128x128 | 219 KiB |
| `wabbit` | Wabbit | `Wabbit.acs` | 200x238 | 525 KiB |
| `wartnose` | WartNose | `Wartnose.acs` | 128x128 | 1393 KiB |

The largest sprite sheets are Wabbit (4600x4522 pixels) and E-Man and E-Woman
(4096x3968). Clippy's own sheet in `clippyjs` is 3348x3162. Sheets this large
were only observed in a desktop Chromium browser.

### How the format maps

| `.acs` | `clippyjs` agent |
| --- | --- |
| Character width and height | `framesize` |
| Frame duration (1/100 s) | `duration` (ms) |
| Frame images (layered, each with an offset, first one on top) | One flattened cell per frame, `images: [[x, y]]`, `overlayCount: 1` |
| Frame without visible pixels | `images: []` (the buddy is hidden for that frame) |
| Exit frame index (negative means none) | `exitBranch` |
| Branches (frame index, probability %) | `branching.branches` (`frameIndex`, `weight`) |
| Transition type 1 (exit branches) | `useExitBranching: true` |
| Sound index | `sound` (1-based name), `sounds` list |
| Palette and transparent colour index | Indexed PNG with one transparent palette entry |

Identical frames share one sprite sheet cell.

### What the converter adds for `clippyjs`

`clippyjs` finds animations by exact name and knows nothing about Agent's
states or return animations. Real characters rely on both, so the converter
resolves them. Every such change is printed as a note.

- **Return animations.** An animation with transition type 0 names an animation
  that brings the character back to its rest pose. The frames of that return
  animation are appended (frame indexes shifted), so the buddy does not jump
  from, say, looking left to an idle animation. The return animation also
  stays available under its own name.
- **`Show` and `Hide`.** Without `Show` the library never draws the buddy;
  without `Hide` it never finishes dismissing it. When a file has `SHOW` or
  `Showing`, or only a `SHOWING` state, the exact name is added as a copy. When
  nothing fits, `Show` becomes the first frame of the rest pose and `Hide` one
  empty frame.
- **`Idle...`.** When no animation name starts with `Idle`, the animations of
  the `IDLINGLEVEL1` to `IDLINGLEVEL3` states are copied to `Idle1_1`,
  `Idle1_2`, `Idle2_1` and so on.
- **Animations without frames** are left out. The library's animator throws on
  them.
- **One-byte image entries** (an image deleted in the character editor) are
  drawn as nothing.

### Not carried over

- Mouth overlays (lip sync while speaking). `clippyjs` has no lip sync.
- Voice, balloon style, tray icon and region data. They are parsed past, not used.
- Agent 1.5 files (OLE containers) are rejected with a clear message.

### What is verified

Run on 2026-10-08 against a local collection of 49 `.acs` files (40 distinct
Agent 2.0 files of which 3 are duplicates, 9 Agent 1.5 files).

- **Ground truth.** Six of those characters also ship with `clippyjs`, whose
  data was made from the same files. `compare_with_clippyjs.mjs` checks frame
  size, animation names, per-frame timing, branching and the pixels of every
  frame:

  | File | `clippyjs` agent | Animations | Frames | Field mismatches | Frames with pixel differences |
  | --- | --- | --- | --- | --- | --- |
  | `CLIPPIT.ACS` | clippy | 43 | 1233 | 0 | 0 |
  | `F1.ACS` | f1 | 48 | 1560 | 0 | 0 |
  | `OFFCAT.ACS` | links | 50 | 1219 | 0 | 0 |
  | `rover.acs` | rover | 29 | 1106 | 0 | 0 |
  | `GENIUS.ACS` | genius | 47 | 1365 | 0 | 1 |
  | `ROCKY.ACS` | rocky | 46 | 2170 | 0 | 97 |

  The 98 differing frames are exactly the frames where the file gives an image
  an offset (1 in Genius, 97 in Rocky). With offsets ignored both characters
  compare equal, so the `clippyjs` data dropped them. In the one Rocky frame
  looked at by eye, the dog lines up with the frame before it only when the
  offset is applied.
- **Layer order.** Reversing it breaks 200 or more frames on each of F1, Genius
  and Rocky, so "first image on top" is right.
- **Robustness.** All 37 distinct Agent 2.0 files convert without an error. The
  rest pose of each was looked at in one contact sheet.
- **Decompression.** The worked example from the spec, and a round trip against
  an encoder written separately from the spec that covers every offset width
  (6, 9, 12 and 20 bit) and long length codes (`tests/test_acs_to_clippy.py`).
- **Spec corrections found.** The voice block follows flag bit 5 (`0x20`), not
  bit 4. Palette entries are stored blue, green, red. Image rows are bottom-up.
- **In the app.** Converted characters were registered and observed in a
  production build (picker entry, sprite sheet loaded as an asset, frames
  stepping, dismiss by right-click for a character without its own `Hide`).

To repeat the comparison:

```bash
python -I scripts/buddy/acs_to_clippy.py CLIPPIT.ACS --out out/clippit
```

```bash
node scripts/buddy/compare_with_clippyjs.mjs out/clippit clippy
```

### What is not verified

- `useExitBranching` (transition type 1) against ground truth. None of the six
  comparable characters uses it; the `clippyjs` characters that do (Merlin,
  Peedy, Genie, Bonzi) were not in the collection.
- Appending return animations is this converter's own choice. The `clippyjs`
  data for Merlin keeps them separate and never plays them after the main
  animation.
- Agent 1.5 files are not supported.

### Licensing

The converter is original code. The characters are not: Microsoft's Agent and
Office characters, and most community `.acs` files, are someone else's artwork.
`clippyjs` already brings 10 Microsoft characters in as an npm dependency;
committing converted sprite sheets to this repository would make the repository
itself the distributor. Decide per character before adding one.
