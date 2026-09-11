import fs from 'node:fs';

let s = fs.readFileSync('CHANGELOG.md', 'utf8');
const anchor = '## 2.2.0 — Memory, resolve, hygiene';
if (!s.includes(anchor)) throw new Error('anchor not found');
if (s.includes('## 2.3.0')) throw new Error('2.3.0 entry already present');

const entry = `## 2.3.0 — Bloom actually blooms

**Bloom was producing nothing at all.** Three bugs, the first fatal:

- **The threshold was applied in the wrong colour space.** The composer buffer is linear HDR — GDevelop converts to sRGB in \`OutputPass\` at the very end — but the default threshold of \`0.9\` had been chosen as if it were a display value. In linear light a surface that looks bright grey on screen is only about \`0.6\`, so \`0.9\` needs roughly sRGB 0.96 to pass: the first mip zeroed the entire image and bloom added exactly nothing. \`HorrorGrim\` at \`1.2\` could never have bloomed anything but emissive materials. GDevelop's own 3D bloom effect ships with a threshold of **0** for precisely this reason. The default is now \`0.3\`, presets are retuned to 0.25–0.6, and the property documents that it is linear light.
- **The downsample was passed the destination texel size instead of the source's.** The 13-tap footprint is defined in source texels, and the destination is half the size, so every tap was spread twice as far as intended.
- **The upsample had the same bug, with worse consequences.** The tent filter samples the smaller mip below it, so using the larger destination's texel size collapsed all nine offsets to sub-texel distances — the tent degenerated into plain bilinear and did no blurring whatsoever.

Regression tests now assert that each pyramid stage receives its own source texel size, and that no preset or default threshold sits above what real geometry can reach in linear light.

**Tests:** 78 → 80 runtime assertions.

---

${anchor}`;

s = s.replace(anchor, entry);
fs.writeFileSync('CHANGELOG.md', s, 'utf8');
console.log('changelog: 2.3.0 entry added');
