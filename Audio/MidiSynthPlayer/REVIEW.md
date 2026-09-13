# MidiSynthPlayer 1.0.0 — maintainer review

Verified against the GDevelop install on disk
(`~/AppData/Local/Programs/GDevelop/resources/GDJS/Runtime-sources`, editor strings out of
`resources/app.asar`). All **37** inline JS blocks were extracted and `node --check`ed — **all parse
clean**, **no NUL bytes**, no stray control characters. `test-midisynthplayer.mjs` passes 10/10.

Nothing below was found by the test suite. **D1**, **D3** and **D4** were reproduced by re-running the
runtime against a spec-accurate `AudioParam` mock; see **D17** for why the shipped mock cannot see them.

`MidiSynthPlayer/MidiSynthPlayer.json` and `Twillion-s-Extensions/extensions/MidiSynthPlayer.json`
are byte-identical.

---

## Confirmed defects

### D1 — CRITICAL. Every note-off jumps the voice gain to 1.0. Clicks on every note, ~3.6x over peak.

`triggerNoteOff` (`MidiSynthPlayer.runtime.js:909`) rebuilds the release from a *live* read of the
envelope:

```js
voice.gainNode.gain.cancelScheduledValues(time);
voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value || 0.05, time);
voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, time + releaseTime);
```

`AudioParam.value` returns the value **now**, not the value at `time`. The scheduler runs 100 ms
ahead, so at the moment a note-off is scheduled the note has usually not started yet and the param
still sits at `createGain()`'s default of **1.0** — the `setValueAtTime(0.0001, ...)` from note-on was
queued for the future and has not taken effect. `cancelScheduledValues(time)` then deletes the attack
and decay ramps (both end at or after `time`), so nothing else constrains it.

Reproduced — note-on scheduled +60 ms, note-off +300 ms, Acoustic Grand Piano, velocity 100:

```
peakGain target                    = 0.2756
gain.value read at schedule time   = 1
envelope after noteOff:
   set  val=0.0001  t=+0.060
   lin  val=0.2756  t=+0.062     <- attack
   set  val=1       t=+0.300     <- release starts here
   exp  val=0.0001  t=+0.450
```

The release begins **3.6x above the intended peak** and, for the piano's `sustain = 0.0`, **10,000x
above the level the note actually held**. Every note-off is a full-scale discontinuity: audible click
plus hard clipping once two or three voices land together. This is the single worst defect and it
affects every melodic note of every track.

Fix: use `cancelAndHoldAtTime(time)` where available (Chromium and Electron both have it, so desktop
preview and web export are covered), falling back to computing the envelope value at `time`
analytically from `(peakGain, attack, decay, sustain, voice.startTime)` rather than reading `.value`.
Store `peakGain` and `sustainGain` on the voice at note-on so the fallback has something to work from.

### D2 — CRITICAL. 33 of the 34 actions/conditions/expressions are silent no-ops until `PlayMidi` runs.

The whole 58 KB engine is inlined into **`PlayMidi`**'s JsCode (and into the behavior's `onCreated`).
Every other function opens with:

```js
if (!gdjs.__midiSynthPlayer) return;
```

So before the first `PlayMidi` — or on any project that never adds the `MidiSpatialEmitter`
behavior — `PlayNote`, `SetMasterVolume`, `SetSoundChipProfile`, `SetChannelMuted`, `IsPlaying`,
every expression, all of it does nothing and reports nothing. Two concrete consequences:

1. `PlayNote` is advertised in `API_REFERENCE.md` §2 as the way to trigger "procedural sound effects,
   jingles, or live gameplay" notes. A project that only wants procedural SFX and never plays a `.mid`
   gets **silence, with no error**.
2. The natural event-sheet order — *At the beginning of the scene: set volume / set chip profile,
   then play* — drops the first two actions on the floor. And `PlayMidi` overwrites the volume anyway
   (`playParsed` calls `setMasterVolume(volume)`), so the mistake is invisible.

Fix: move the bootstrap into a preamble every entry point shares, guarded by
`if (!gdjs.__midiSynthPlayer) { ... }` — the shape `AdvancedMaterials` uses in this repo. The guard
short-circuits after the first call, so the cost is one branch per action.

### D3 — CRITICAL bloat. The runtime is embedded **twice** inside `PlayMidi`. ~58 KB of the 227 KB file is a dead copy.

`build-extension.mjs:93`:

```js
events: evFree((opts.withRuntime ? runtime + '\n' : '') + `if (!${NS}) return;\n...` + code, opts),
```

It prepends `runtime` **and** forwards `opts` — which still carries `withRuntime: true` — to
`evFree`, which prepends `runtime` again (`build-extension.mjs:57-60`). Measured:

| block | length | copies of `class MidiSynthPlayerEngine` |
| :--- | ---: | ---: |
| `PlayMidi` (free fn, goes through line 93) | 119,310 | **2** |
| behavior `onCreated` (uses `ev()` directly, line 147) | 60,338 | 1 |

The second IIFE hits its own `if (gdjs.__midiSynthPlayer) return;` guard, so it is harmless at
runtime — it is purely 58 KB of dead weight shipped in every export, on top of the 58 KB legitimate
copy in `onCreated`. That is ~176 KB of JavaScript for an extension whose entire pitch is a 350 KB
soundtrack budget (`README.md`, Key Highlights). Half the advertised saving is spent on the engine,
and a third of *that* is a copy-paste artifact.

Fix, one line:

```js
events: evFree(`if (!${NS}) return;\nconst MSP = ${NS};\n` + code, opts),
```

Deduplicating `onCreated` against `PlayMidi` (D2's shared-preamble fix) recovers the rest.

### D4 — HIGH. One-shot voices are never freed. The polyphony budget is gone in ~8 seconds.

`cleanupFinishedVoices` (`:1278`) only drops voices that are **`isReleasing`**:

```js
this.activeVoices = this.activeVoices.filter(v => !(v.isReleasing && now > v.startTime + 2.0));
```

`isReleasing` is set in exactly one place — `triggerNoteOff` (`:921`). Drums never go through
`triggerNoteOff` (`processMidiEvent` skips channel 9 on note-off, `:1303`), so **no drum voice is
ever removed**. Neither is any melodic note whose note-off is missing from the file.

Reproduced — 60 s of nothing but a kick drum twice a second, `cleanupFinishedVoices()` called every
step:

```
after 60s of kick-only playback: activeVoices = 32 / maxPolyphony 32
all isReleasing=false? true
```

Saturation at 32 arrives after 16 kicks — about 8 seconds of a normal track. Two consequences:

1. `MidiSynthPlayer::ActiveVoiceCount()` is permanently pinned at `MaxPolyphony`. It is documented
   (`API_REFERENCE.md` §4) as "number of active polyphonic synth voices currently sounding". It never
   reports anything else after the first few bars.
2. Worse, the stealing heuristic in `allocateVoice` (`:794`) takes the **first `isReleasing` voice**
   it finds and only falls back to index 0. Once the pool is full of dead ghosts, the only voice
   marked `isReleasing` is a note that is *genuinely audible right now*, in its release tail — so
   that is what gets killed, while 20-second-dead drums survive. Reproduced:

```
pool size before new note: 32   tail.isReleasing: true
audible 0.35s release tail still alive?      false
dead 20-second-old drum ghost still alive?   yes — all 32 slots
```

Every legato melody line has its tails chopped by the drum track. Fix: give every voice an `endTime`
at creation (one-shots know theirs exactly — the drum recipes already compute a `stop()` time) and
filter on `now > endTime`. Rank stealing by projected remaining energy, not by scan order.

### D5 — HIGH. The GDevelop resource lookup is dead code. `.mid` files will not ship in an export.

`playMidi` (`:1385`):

```js
if (runtimeScene && runtimeScene.getGame && runtimeScene.getGame().getImageManager) {
  const imgMgr = runtimeScene.getGame().getImageManager();
  if (imgMgr.hasResource && imgMgr.hasResource(resourceName)) {
    resourceUrl = imgMgr.getResourceFileUrl(resourceName);
  }
}
```

`getImageManager()` returns a `gdjs.PixiImageManager`. Its public surface is
`getResourceKinds / getPIXITexture / getOrLoadPIXITexture / getThreeTexture / unloadResource / dispose`
(`Runtime-sources/pixi-renderers/pixi-image-manager.ts`). **There is no `hasResource` and no
`getResourceFileUrl`, on that class or anywhere in GDJS.** The guard is always false, so `resourceUrl`
is always the raw string and the branch has never once executed.

Three consequences:

1. **The resource name → file path mapping is never applied.** A resource named `battle_theme`
   pointing at `assets/music/battle.mid` fetches `battle_theme` and 404s.
2. **GDevelop Cloud resource tokens are never appended.** `ResourceLoader.getFullUrl` exists
   precisely to add `gd_resource_token` for cloud-hosted projects (`ResourceLoader.ts:619`). Cloud
   previews will 403.
3. Most seriously: `MidiFile` is declared as a plain `string` parameter, not a resource parameter.
   GDevelop only copies **declared resources** into an export, and `ResourceKind`
   (`types/project-data.d.ts:630`) has no kind for arbitrary binaries — `audio | image | font |
   video | json | tilemap | tileset | bitmapFont | model3D | atlas | spine`. So there is currently no
   supported path by which a `.mid` reaches an exported game at all. It works in preview only because
   the preview server happens to serve the project directory.

Fix: switch to the pattern `jsonmanager.ts:134-139` uses —

```js
const loader = runtimeScene.getGame().getResourceLoader();
const res = loader.getResource(resourceName);
const url = res ? loader.getFullUrl(res.file) : resourceName;
```

— and change the parameter to `jsonResource` so the file is declared and exported. **Verify the
`jsonResource` picker actually accepts a `.mid` in the editor before shipping this**; if it filters
on extension, the fallbacks are to document a `.json` rename or to base64 the MIDI into a string
parameter.

### D6 — HIGH. A private `AudioContext` bypasses GDevelop's autoplay unlock, global volume and background handling.

`ensureAudioContext` (`:517`) does `new AudioContext()` and manages it alone. GDevelop already owns
one, `Howler.ctx`, and already solves three things around it that this extension re-breaks:

1. **Autoplay policy.** A context created before a user gesture starts `suspended`. The only resume
   attempt is inside `ensureAudioContext`, on a *later* call. A game that plays music on scene start
   gets a frozen `currentTime`, so `schedulerTick` computes `songElapsedSeconds = 0` forever and
   playback simply never begins — silently, with no console warning. This is the classic
   "music doesn't play on itch.io until you click something" failure.
2. **Backgrounding.** `HowlerSoundManager.resumeAllActiveSounds` exists because "mobile OSes (notably
   iOS) suspend the WebAudio context in the background and never resume it on their own"
   (`howler-sound-manager.ts:557`). This context gets no such treatment. Meanwhile the `setInterval`
   scheduler (`:1218`) is throttled to >=1 s in a background tab, so on return a whole second of
   events is dumped at once, all clamped to `audioNow` by `Math.max(0, ...)` (`:1255`) — a loud
   simultaneous cluster instead of a bar of music.
3. **Global volume.** GDevelop's global sound/music volume actions, and any in-game volume slider
   built on them, act on Howler. They have no effect whatsoever on MIDI music.

Fix: `const ctx = (typeof Howler !== 'undefined' && Howler.ctx) || new AudioContext();` and route the
master gain through it. All three problems go away for free.

### D7 — HIGH. Three of the seven behavior properties are declared and never read; a fourth is documented and does not exist.

`onCreated` reads only `SoundChipProfile`, `MasterVolume`, `AutoPlayMidi`, `Loop`.

| property | declared | read | notes |
| :--- | :---: | :---: | :--- |
| `MasterVolume` | yes | yes | |
| `SoundChipProfile` | yes | yes | |
| `MaxPolyphony` | yes | **no** | `maxPolyphony` is hardcoded 32 (`:491`); no setter, no action, no expression |
| `LowpassCutoff` | yes | **no** | filter cutoff comes from the chip profile instead |
| `FilterResonance` | yes | **no** | same |
| `AutoPlayMidi` | yes | yes | **undocumented** in `API_REFERENCE.md` §1 |
| `Loop` | yes | yes | **undocumented** |
| `EnableSpatial3D` | **no** | **no** | **documented** in `API_REFERENCE.md` §1, does not exist |

The `propertyDescriptors` key and the `extraInformation` array on the Choice are both correct — this
is not the AnimatedPBR3D D1 bug. The properties simply are not wired up.

`API_REFERENCE.md` §1 also calls these "`MidiSynthPlayer` Manager Properties". There is no manager
object; they are per-instance properties of the `MidiSpatialEmitter` behavior, and with a single
global engine behind them two emitters in a scene fight — last `onCreated` wins.

---

## Medium

### D8 — Sustain pedal and pan are parsed, stored, and thrown away.

`processMidiEvent` writes `ch.sustainPedal` (CC64, `:1330`) and `ch.pan` (CC10, `:1324`). Neither is
read anywhere — grep confirms exactly one write site and zero read sites for each.

- **No pedal** means every piano, organ and pad file that uses CC64 — which is most of them — plays
  fully staccato. `triggerNoteOff` releases immediately regardless of pedal state.
- **No pan** means there is no `StereoPannerNode` anywhere in the voice graph; every voice goes
  `voiceGain -> masterFilter`. The output is **mono**. The whole channel-separation half of a MIDI
  mix is discarded, which is a strange thing for an extension that ships a 3D positional audio
  feature.

### D9 — Pitch bend and transposition only affect notes that have not started yet.

`triggerNoteOn` reads `ch.pitchBendSemitones` and `this.transposition` once, at note-on (`:875`).
Held notes never bend. Pitch bend on a sustained lead — the reason pitch bend exists — does nothing.
The bend range is also hardcoded to +/-2 semitones with no RPN 0 handling.

Live transposition has the same shape, which is more defensible (`README.md` promises it "in
real-time when entering alternate dimensions"; in practice it takes effect from the next note
onward). Worth stating explicitly in the docs rather than leaving users to discover it.

Related: `setSoundChipProfile` (`:615`) unconditionally overwrites the master filter cutoff and Q
from the profile table. Switching to `NES_Chiptune` while an underwater `SetLowpassCutoff(800)` is
active silently reopens the filter to 18 kHz.

### D10 — Looping is neither seamless nor sample-accurate.

`schedulerTick` (`:1263`) checks `playbackPositionSeconds >= totalDuration` once per 25 ms tick and
calls `seekTo(0)`. Three problems compound:

1. The loop point lands up to **25 ms late**, quantized to the tick grid. `seekTo` then resets
   `playbackStartAudioTime = currentTime`, discarding the overshoot instead of carrying it into the
   next cycle — so every loop adds fresh timing jitter rather than staying on the grid.
2. `seekTo` calls `stopAllVoices()`, which issues `node.stop(now + 0.05)` on every voice. Notes the
   scheduler already placed into the 100 ms lookahead have `start(t)` with `t > now + 0.05`; per the
   Web Audio spec a `stop` at or before `start` means the node never sounds. **The last ~50-100 ms of
   every loop iteration is silently dropped.**
3. `totalDuration` is the timestamp of the last event, usually `endOfTrack`. Any note still ringing
   at the final bar line has its release tail cut.

For an extension whose headline use case is looping game music, this is worth fixing properly:
schedule the loop as a continuation of the same timeline (advance `playbackStartSongSeconds` by
`-totalDuration` rather than reseeking) and let scheduled tails ring across the seam.

### D11 — `seekTo` restores program changes and tempo, and nothing else.

`:1465` fast-forwards only `programChange` and `setTempo`. CC7 volume, CC11 expression, CC10 pan and
channel state set before the seek target are lost, so seeking into the middle of a track plays it at
the wrong mix — every channel snaps back to the `resetChannels` default of volume 100 / expression
127. The loop path is unaffected (seeking to 0 has nothing to restore), but the `SeekMidi` action is.

### D12 — 3D spatial audio: emitter and listener are in opposite-handed frames.

`updateSpatialPosition` (`:1527`) feeds `object.getX() / getY() / getZ()` straight into the panner and
`threeCamera.position` straight into the listener. But GDevelop's 3D renderer mirrors Y:

```
layer-pixi-renderer.ts:407   this._threeScene.scale.y = -1;
layer-pixi-renderer.ts:839   this._threeCamera.position.y = -this._layer.getCameraY(); // scene is mirrored on Y
```

So `threeCamera.position.y` is the **negation** of the GDevelop camera Y, while `object.getY()` is
the raw GDevelop Y. Emitter and listener sit on opposite sides of the axis. Distance attenuation is
computed across that mismatch and vertical panning is inverted.

The listener's **orientation is never set at all** — `forwardX/Y/Z` and `upX/Y/Z` keep their defaults
of forward `(0,0,-1)`, up `(0,1,0)`, which will not match a GDevelop 3D camera in any scene. HRTF
panning is therefore rotated by an arbitrary amount regardless of where the camera actually looks.

Separately, `attachSpatialObject` stores a strong reference to a `RuntimeObject` and
`registerRuntimeSceneUnloadedCallback` is deliberately a no-op (`:1581`). After a scene change the
engine holds a destroyed object — and, through it, its instance container — forever, and keeps
calling `getX()` on it every frame. `onDestroy` on any single emitter also calls the *global*
`detachSpatialObject()`, so destroying one emitter tears down routing for every other one.

Also worth checking in-engine: `refDistance: 50` / `maxDistance: 2000` are in GDevelop pixel units,
which is a reasonable guess for 2D and probably far too small for a 3D scene. Neither is exposed.

### D13 — SMF parser: four spec deviations.

1. **Running status is not cleared by system messages.** `:322` assigns `runningStatus = statusByte`
   for *any* byte with the high bit set, including `0xFF` (meta) and `0xF0 / 0xF7` (SysEx). The MIDI
   spec requires those to cancel running status. A file that relies on running status immediately
   after a meta event mis-parses: `statusByte` stays `0xFF`, the next data byte is read as a meta
   type, and the track desynchronizes from there.
2. **`readVLQ` has no 4-byte cap** (`:249`). A corrupt run of high-bit bytes keeps shifting
   `value <<= 7` until it overflows into the sign bit, producing **negative tick counts** — which
   sort ahead of everything and yield negative `timeSeconds` that never fire.
3. **SMPTE time division is silently faked.** `:288`: `(division & 0x8000) ? 480 : division`. An
   SMPTE-timed file (frames + subframes) gets 480 PPQ substituted and plays at an arbitrary wrong
   tempo with no warning. Either implement it or throw.
4. **`offset` is not snapped to `trackEnd` after each track.** It relies on the "search for the next
   `MTrk`" recovery loop (`:296-306`) to resynchronize after an early `endOfTrack` break. Setting
   `offset = trackEnd` is one line and removes the need for the heuristic. Relatedly,
   `dataView.getUint32(offset)` at `:298` is only guarded by `offset < byteLength` and needs four
   bytes — a truncated file throws `RangeError` (caught by the fetch chain, so it logs rather than
   crashes, but `playMidiBuffer` called directly is unguarded).

### D14 — FM modulation depth is unbounded and goes ultrasonic on high notes.

`:881`: `initialModDepth = freq * modIndex * chip.feedbackScale * (1.0 + feedback)`, applied directly
to `carrierOsc.frequency`. For Gunshot (`modIndex 9.0`, `feedback 0.8`) at C8 (4186 Hz) on the Genesis
profile (`feedbackScale 1.4`): **~95 kHz of deviation** on a 44.1 kHz context. The carrier frequency
swings deep into negative and far past Nyquist, aliasing into broadband noise. Several of the bright
presets (Slap Bass 2, Distortion Guitar, FX 8, Orchestra Hit) reach the same territory in their top
octave. Clamp the deviation to something like `Math.min(depth, sampleRate * 0.4)`.

---

## Documentation vs. implementation

### D15 — The synthesis claims do not match the synthesis code.

| claim | source | reality |
| :--- | :--- | :--- |
| "2-Op **& 4-Op** FM Oscillators (Carrier + Modulator **with Feedback**)" | `README.md` diagram, `IMPLEMENTATION_PLAN.md` §B | `triggerNoteOn` builds exactly **one carrier + one modulator**, always. `chip.operators` (4 for YM2612/PC98, 1 for NES) is **never read anywhere**. |
| "Self-feedback coefficient beta ... generating rich sawtooth-like harmonics" | `IMPLEMENTATION_PLAN.md:92` | There is **no feedback path**. The `feedback` column is only a scalar multiplier on modulation depth (`:881`). No oscillator output is routed back to its own frequency. |
| "Channel 10 **LFSR** Noise" | `README.md` diagram, `API_REFERENCE.md` §6 | `generateNoiseBuffer` (`:573`) is `Math.random() * 2 - 1`. White noise, not an LFSR. |
| "47 GM drum notes", "47 drum kits" | `README.md` header, runtime header comment | **20** notes have bespoke recipes (35, 36, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 55, 56, 57, 59). Every other drum note — congas, bongos, timbales, agogo, cabasa, maracas, claves, woodblocks, guiro, triangle, and the tambourine the code comment names but never implements (`case 54` does not exist) — falls into **one shared** 250 -> 50 Hz triangle click. |
| "49 / 57 Crash / Splash: 6-Oscillator detuned square wave cluster" | `API_REFERENCE.md` §6 | Highpassed white noise, identical to the ride and every other cymbal. |
| "51 / 59 Ride: High harmonic metallic chime + noise wash" | `API_REFERENCE.md` §6 | Same highpassed noise, same `case` block as the crash. |
| "Pure JavaScript SMF 0/1 binary parser (**< 4 KB**)" | runtime header | The `SMFParser` class is ~230 lines, ~8 KB. |
| "Lookahead Audio Clock (**25 ms window**)" | `README.md` diagram | 25 ms is the *tick interval*; the lookahead window is 100 ms (`:1243`). |
| "Add the `MidiSynthPlayer` **global behavior**" | `README.md` Quick Start §1 | There is no global behavior. There is a `MidiSpatialEmitter` object behavior and a set of free actions. |

The four "sound chip profiles" differ only in `filterCutoff`, `resonance`, `feedbackScale` and — for
NES only — forcing square carriers and triangle modulators. `noiseLevel` is declared on all four and
never read. That is a defensible amount of variation for a lightweight synth; it just is not what the
documentation describes, and the gap is large enough to read as a false claim rather than a
simplification.

### D16 — Stated ranges do not match enforced ranges.

The same class of problem as 3DCRT+ 0.9.0. Current state:

| control | `API_REFERENCE.md` | editor parameter text | code clamp |
| :--- | :--- | :--- | :--- |
| Tempo multiplier | `0.5 - 2.0` | *(none)* | `0.25 - 4.0` (`:1482`) |
| Lowpass cutoff | `200.0 - 20000.0` | `20 - 20000` | `20 - 22050` (`:639`) |
| Filter resonance | `0.1 - 10.0` | `0.1 - 25.0` | `0.1 - 25.0` (`:649`) |
| Max polyphony | `16 - 64` | *(none)* | **not clamped, not used** |
| Transposition | *(none)* | *(none)* | `-24 - +24` (`:1496`) |
| Master volume | `0.0 - 100.0` | `0 - 100` | `0 - 100` — correct |

Pick one number per control and make all three say it.

---

## Low

### D17 — The test suite cannot detect any envelope or scheduling defect.

`test-midisynthplayer.mjs:21` — `MockAudioParam` applies every scheduled write **eagerly**:

```js
setValueAtTime(val, time)              { this.value = val; ... }
linearRampToValueAtTime(val, time)     { this.value = val; ... }
exponentialRampToValueAtTime(val, time){ this.value = val; ... }
```

Real `AudioParam.value` does not move until the scheduled time arrives. Because the mock pretends it
does, **D1 is invisible** — `gain.value` reads back as the peak the test expects rather than the 1.0
the browser returns. `cancelScheduledValues` is also modeled as a pure filter with no effect on
`.value`, which hides the second half of D1.

Making `value` a getter that walks `scheduled` for the last event with `time <= ctx.currentTime`
(~15 lines — this is what the reproductions above use) turns tests 5, 7 and 8 into real assertions
and would have caught D1 and D4 on the first run. Test 6's "all 21 drum categories successfully
synthesized" should also assert *which* recipe fired, not just that no exception was thrown —
otherwise the 27 notes collapsing into one fallback click (D15) reads as a pass.

### D18 — `playMidi` has no re-entrancy guard, no cache, and sets `isPlaying` asynchronously.

`:1385` fires a `fetch` and only sets `isPlaying` when it resolves. So:

- `IsPlaying` is false for a frame or more after `PlayMidi`, which turns the standard
  `If NOT playing -> Play` idiom into a fetch storm — one request per frame until the first resolves.
- Two `PlayMidi` calls in flight race; whichever resolves last wins, regardless of call order.
- Replaying the same track re-fetches and re-parses it every time. Parsed songs should be cached by
  resource name.

### D19 — `behavior` parameter is missing its `supplementaryInformation`.

`build-extension.mjs:26-29` declares `{ name: 'Behavior', type: 'behavior', description: 'Behavior' }`
with no `supplementaryInformation`. Every behavior in this repo that ships cleanly sets it:

```
AdvancedMaterials       "AdvancedMaterials::AdvancedMaterials"
BRDFMaterials           "BRDFMaterials::BRDFMaterial"
ExtrudedSprite3D        "ExtrudedSprite3D::Billboard3D"
SoftBody3D              "SoftBody3D::SoftBody3D"
YAxisPhysicsCharacter3D "YAxisPhysicsCharacter3D::YAxisPhysicsCharacter3D"
MidiSynthPlayer         <MISSING>
Advanced3DMaterial      <MISSING>
```

The only other extension missing it is `Advanced3DMaterial`, which is already on the known-broken
list. Should be `"MidiSynthPlayer::MidiSpatialEmitter"`.

### D20 — Minor correctness and hygiene.

- `resetChannels` (`:590`) comments `volume: 100, // 0 - 127` but the field is on a 0-100 scale
  everywhere else (`setChannelVolume` clamps 0-100, CC7 rescales `value / 127 * 100`, the gain math
  divides by 100). Only the comment is wrong, but it invites a future 127-scale bug.
- `resetChannels` (`:591`) `program: i === 9 ? 0 : 0` — a ternary with identical branches.
- `playParsed` calls `resetChannels()`, wiping any channel mute/solo/volume the user set. The
  combat-stem workflow in `README.md` Quick Start §4 therefore has to be re-applied after every
  `PlayMidi`. Reasonable behaviour; undocumented.
- `silenceChannelVoices` (`:749`) zeroes the gain but never marks the voice `isReleasing` and never
  clears `ch.activeNotes`, so CC120 / CC123 (All Sound Off / All Notes Off) leak voices into the pool
  the same way D4 does.
- Every noise-based drum plays `this.noiseBuffer` from **offset 0** every time. Consecutive hi-hats
  are bit-identical waveforms, which is audibly machine-gunned. `noise.start(time, Math.random() * 1.5)`
  fixes it for free.
- `stop()` leaves `currentParsedSong` set, so `TotalDuration()` keeps reporting the stopped track.
  Harmless, possibly intentional; worth deciding.
- `README.md` claims a 15-track OST fits in "< 350 KB" from a stated 15-35 KB per track. At the top of
  that range 15 tracks is 525 KB. Quote the range or the midpoint, not the floor.

---

## Suggested order of work

1. **D1** — the release envelope. Everything else is cosmetic next to every note-off clicking.
2. **D3** — one line in `build-extension.mjs`, removes 58 KB.
3. **D2** — shared bootstrap preamble; unblocks 33 ACEs and lets you drop the duplicate copy entirely.
4. **D5 + D6** — resource loading and `Howler.ctx`. Together these decide whether the extension works
   in an actual export rather than only in preview.
5. **D4** — voice lifetime, then re-rank stealing.
6. **D7, D16, D15** — wire up or delete the dead properties, then make the three docs agree with the code.
7. Everything else.

**D5 and D6 in particular need an in-engine check, not a static one** — build a tiny project with one
`.mid` resource, run it in preview *and* in a web export, and confirm the file actually arrives and
the context unlocks without a click.
