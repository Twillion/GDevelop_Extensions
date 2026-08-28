# MidiSynthPlayer — API Reference & Specification

Complete specification of Manager properties, Actions, Conditions, Expressions (ACEs), Sound Chip Presets, and General MIDI mapping for **MidiSynthPlayer**.

---

## 1. `MidiSynthPlayer` Manager Properties

| Property | Type | Default | Description |
| :--- | :--- | :---: | :--- |
| **`MasterVolume`** | Number | `80.0` | Default music output volume ($0.0 - 100.0$). |
| **`SoundChipProfile`**| Choice | `"OPL3_SoundBlaster"` | Sound synthesis flavor: `"OPL3_SoundBlaster"`, `"YM2612_Genesis"`, `"PC98_FM"`, `"NES_Chiptune"`. |
| **`MaxPolyphony`** | Number | `32` | Maximum simultaneous active synthesizer voices ($16 - 64$). |
| **`LowpassCutoff`** | Number | `20000.0` | Master lowpass filter cutoff in Hz ($200.0 - 20000.0$). |
| **`FilterResonance`**| Number | `1.0` | Filter resonance ($Q \in [0.1, 10.0]$). |
| **`EnableSpatial3D`**| Boolean | `false` | Enables 3D positional audio node for spatial music in 3D scenes. |

---

## 2. Actions

### Playback & Transport Controls
* **`Play MIDI file _PARAM0_ (Loop: _PARAM1_, Volume: _PARAM2_)`**: Start playback of a `.mid` file resource with optional looping.
* **`Stop MIDI playback`**: Immediately stops music and releases all active polyphonic voices.
* **`Pause MIDI playback`**: Pauses music at current playback timestamp.
* **`Resume MIDI playback`**: Resumes playback from paused timestamp.
* **`Seek MIDI playback to _PARAM0_ seconds`**: Jumps to a specific timestamp in the song.
* **`Set MIDI master volume to _PARAM0_`**: Adjusts global output volume ($0.0 - 100.0$).

### Dynamic Interactive Stems & Channels
* **`Set MIDI channel _PARAM0_ muted to _PARAM1_`**: Mutes or unmutes a specific MIDI channel ($0 - 15$, Channel `9` is standard Drums).
* **`Set MIDI channel _PARAM0_ volume to _PARAM1_`**: Sets individual channel volume ($0.0 - 100.0$).
* **`Set MIDI channel _PARAM0_ instrument to _PARAM1_`**: Overrides the General MIDI instrument program ($0 - 127$) for a specific channel.
* **`Play note _PARAM1_ on channel _PARAM0_ (Velocity: _PARAM2_, Duration: _PARAM3_ s)`**: Triggers a single synthesized note or drum on demand for procedural sound effects, jingles, or live gameplay.
* **`Solo MIDI channel _PARAM0_`**: Mutes all channels except the selected channel.
* **`Unmute all MIDI channels`**: Restores all 16 channels to full playback.

### Live Pitch, Tempo & Filter Effects
* **`Set MIDI tempo multiplier to _PARAM0_`**: Dynamically speeds up or slows down playback without altering pitch ($0.5 - 2.0$).
* **`Transpose MIDI playback by _PARAM0_ semitones`**: Shifts entire musical key in real-time (e.g. `+2` for whole step up, `-12` for octave down).
* **`Set master lowpass filter cutoff to _PARAM0_ Hz`**: Muffles or opens music brightness (e.g. `800.0` for underwater effect).
* **`Set sound chip profile to _PARAM0_`**: Dynamically switch synthesizer chip sound (`"OPL3_SoundBlaster"`, `"YM2612_Genesis"`, `"PC98_FM"`, `"NES_Chiptune"`).
* **`Attach 3D spatial emitter to 3D object _PARAM0_`**: Anchors the music in 3D space with distance attenuation.

---

## 3. Conditions

* **`Is MIDI music playing`**: True if a MIDI track is currently actively playing.
* **`Is MIDI music paused`**: True if music playback is currently paused.
* **`Is MIDI channel _PARAM0_ muted`**: True if the specified channel is currently muted.
* **`Current playback position is > _PARAM0_ seconds`**: True if song playback has progressed past the given time.
* **`Current tempo is > _PARAM0_ BPM`**: True if current track tempo exceeds the specified BPM.

---

## 4. Expressions

### Playback & Time
* **`MidiSynthPlayer::CurrentTime()`**: Current playback position in seconds (e.g. `45.2`).
* **`MidiSynthPlayer::TotalDuration()`**: Total song length in seconds (e.g. `184.0`).
* **`MidiSynthPlayer::BPM()`**: Current tempo in Beats Per Minute (e.g. `140.0`).
* **`MidiSynthPlayer::TempoMultiplier()`**: Current speed multiplier (e.g. `1.25`).
* **`MidiSynthPlayer::Transposition()`**: Current pitch offset in semitones (e.g. `+2`).

### Channels & Voices
* **`MidiSynthPlayer::ActiveVoiceCount()`**: Number of active polyphonic synth voices currently sounding.
* **`MidiSynthPlayer::ChannelVolume(channel)`**: Volume of a specific MIDI channel ($0 - 15$).
* **`MidiSynthPlayer::ChannelInstrument(channel)`**: Current General MIDI instrument program number ($0 - 127$) on the channel.
* **`MidiSynthPlayer::InstrumentName(programNumber)`**: String name of the instrument (e.g. `"Overdriven Guitar"`).
* **`MidiSynthPlayer::MasterVolume()`**: Current master output volume ($0 - 100$).

---

## 5. General MIDI 128 Instrument Family Table

The algorithmic synthesizer maps all 128 General MIDI program numbers into distinct FM mathematical recipes:

| Program Range | Instrument Family | Synthesizer Recipe / Characteristics |
| :---: | :--- | :--- |
| **0 – 7** | **Piano** | Acoustic Grand, Bright Piano, Honky-Tonk, Electric Pianos (Fast dynamic FM modulation index decay). |
| **8 – 15** | **Chromatic Percussion**| Celesta, Glockenspiel, Music Box, Marimba, Xylophone (High ratio sine clusters, sharp bell attack). |
| **16 – 23** | **Organ** | Hammond Drawbar, Percussive, Rock, Church Organ (Multiple harmonic additive sine registers). |
| **24 – 31** | **Guitar** | Nylon Acoustic, Steel String, Jazz, Clean Electric, Overdriven & Distortion (Asymmetric clipping waveshaping). |
| **32 – 39** | **Bass** | Acoustic Upright, Finger Bass, Picked Bass, Slap Bass, Synth Bass 1 & 2 (High feedback FM sub-oscillators). |
| **40 – 47** | **Strings** | Violin, Viola, Cello, Contrabass, Tremolo, Pizzicato, Harp (Slow swelling harmonic warmth & pizzicato plucks). |
| **48 – 55** | **Ensemble** | String Ensemble 1/2, Synth Strings, Choir Aahs, Voice Oohs, Orchestra Hit (Multi-voice detuned unison spread). |
| **56 – 63** | **Brass** | Trumpet, Trombone, Tuba, Muted Trumpet, French Horn, Brass Section, Synth Brass (Dynamic filter opening sweep). |
| **64 – 71** | **Reed** | Soprano, Alto, Tenor, Baritone Sax, Oboe, English Horn, Bassoon, Clarinet (Odd harmonic emphasis + breath noise). |
| **72 – 79** | **Pipe** | Piccolo, Flute, Recorder, Pan Flute, Blown Bottle, Shakuhachi, Whistle, Ocarina (Pure sine wave + slight pitch flutter). |
| **80 – 87** | **Synth Lead** | Square Lead, Sawtooth Lead, Calliope, Chiff, Charang, Voice, Fifth, Bass + Lead (Punchy iconic mono synth leads). |
| **88 – 95** | **Synth Pad** | New Age, Warm, Polysynth, Choir, Bowed, Metallic, Halo, Sweep (Ethereal evolving ambient pads). |
| **96 – 103** | **Synth Effects**| Rain, Soundtrack, Crystal, Atmosphere, Brightness, Goblins, Echoes, Sci-Fi (Special FM modulated FX). |
| **104 – 111**| **Ethnic** | Sitar, Banjo, Shamisen, Koto, Kalimba, Bag pipe, Fiddle, Shanai (Exotic harmonic ratios & plucked envelopes). |
| **112 – 119**| **Percussive** | Tinkle Bell, Agogo, Steel Drums, Woodblock, Taiko Drum, Melodic Tom, Synth Drum, Reverse Cymbal. |
| **120 – 127**| **Sound Effects** | Guitar Fret Noise, Breath, Seashore, Bird Tweet, Telephone Ring, Helicopter, Applause, Gunshot. |

---

## 6. Channel 10 Standard Drum Map Reference

Channel `9` (0-indexed, display Channel 10) triggers mathematical percussion:

| MIDI Note | Drum Instrument | Synthesis Method |
| :---: | :--- | :--- |
| **35 / 36** | Acoustic / Electric Bass Drum | Pitched sine drop $150\text{Hz} \rightarrow 35\text{Hz}$ |
| **38 / 40** | Acoustic / Electric Snare | Bandpass filtered noise ($1200\text{Hz}$) + $180\text{Hz}$ body tone |
| **42 / 44** | Closed Hi-Hat / Pedal Hi-Hat | Highpass filtered white noise burst ($7000\text{Hz}$, $0.04\text{s}$) |
| **46** | Open Hi-Hat | Highpass filtered white noise burst ($6500\text{Hz}$, $0.4\text{s}$) |
| **49 / 57** | Crash / Splash Cymbal | 6-Oscillator detuned square wave cluster with long decay |
| **41 / 45 / 48** | Floor / Mid / High Toms | Resonant pitched sine decay ($80\text{Hz} - 250\text{Hz}$) |
| **51 / 59** | Ride Cymbal / Ride Bell | High harmonic metallic chime + noise wash |
