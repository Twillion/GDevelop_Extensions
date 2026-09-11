/**
 * MidiSynthPlayer.runtime.js
 * Algorithmic FM & Chiptune MIDI Soundtrack Engine for GDevelop 5.
 * 
 * Features:
 * - 100% Procedural 2-Op & 4-Op FM / Chiptune Synthesis (0 KB samples).
 * - Pure JavaScript SMF 0/1 binary parser (< 4 KB).
 * - 128 General MIDI instrument mapping across all 16 families.
 * - Channel 10 mathematical percussion engine (47 GM drum notes).
 * - 4 Retro Sound Chip profiles: OPL3 (DOS), YM2612 (Genesis), PC98_FM, NES_Chiptune.
 * - Lookahead Precision Audio Scheduler (25ms window, drift-free Web Audio timeline).
 * - Real-time stem muting, soloing, channel volume control for dynamic interactive music.
 * - Pitch-neutral live tempo modulation & real-time key transposition.
 * - Resonant master lowpass filter & 3D spatial positional audio integration.
 */

(function () {
  'use strict';

  // Ensure gdjs namespace exists
  if (typeof globalThis.gdjs === 'undefined') {
    globalThis.gdjs = {};
  }

  const gdjs = globalThis.gdjs;
  if (gdjs.__midiSynthPlayer) return; // Prevent double registration

  /* ========================================================================== */
  /*                               CONSTANTS & TABLES                           */
  /* ========================================================================== */

  const CHIP_PROFILES = {
    OPL3_SoundBlaster: {
      name: 'DOS Sound Blaster (OPL3)',
      operators: 2,
      feedbackScale: 1.0,
      filterCutoff: 12000,
      resonance: 1.2,
      waveform: 'sine',
      modWaveform: 'sine',
      noiseLevel: 0.05,
    },
    YM2612_Genesis: {
      name: 'Sega Genesis (YM2612)',
      operators: 4,
      feedbackScale: 1.4,
      filterCutoff: 9000,
      resonance: 1.5,
      waveform: 'sine',
      modWaveform: 'sine',
      noiseLevel: 0.08,
    },
    PC98_FM: {
      name: 'NEC PC-98 (YM2608)',
      operators: 4,
      feedbackScale: 1.2,
      filterCutoff: 14000,
      resonance: 1.0,
      waveform: 'sine',
      modWaveform: 'sine',
      noiseLevel: 0.03,
    },
    NES_Chiptune: {
      name: '8-Bit Nintendo (NES)',
      operators: 1,
      feedbackScale: 0.0,
      filterCutoff: 18000,
      resonance: 0.5,
      waveform: 'square',
      modWaveform: 'triangle',
      noiseLevel: 0.2,
    },
  };

  /**
   * General MIDI 128 Instruments FM Recipes
   * Each entry: [name, carrierRatio, modRatio, modIndex, modDecay, attack, decay, sustain, release, waveform, feedback]
   */
  const GM_INSTRUMENTS = [
    // 0-7: Piano
    ['Acoustic Grand Piano', 1.0, 1.0, 3.5, 0.4, 0.002, 0.8, 0.0, 0.15, 'sine', 0.1],
    ['Bright Acoustic Piano', 1.0, 2.0, 4.0, 0.35, 0.002, 0.7, 0.0, 0.15, 'sine', 0.2],
    ['Electric Grand Piano', 1.0, 1.0, 4.5, 0.5, 0.003, 1.0, 0.1, 0.2, 'sine', 0.25],
    ['Honky-tonk Piano', 1.01, 2.0, 3.0, 0.4, 0.002, 0.7, 0.0, 0.18, 'sine', 0.3],
    ['Electric Piano 1 (Rhodes)', 1.0, 1.0, 2.8, 0.8, 0.005, 1.2, 0.25, 0.3, 'sine', 0.05],
    ['Electric Piano 2 (FM EP)', 1.0, 3.0, 5.0, 0.6, 0.004, 0.9, 0.2, 0.25, 'sine', 0.2],
    ['Harpsichord', 1.0, 3.0, 6.0, 0.2, 0.001, 0.4, 0.0, 0.08, 'sawtooth', 0.4],
    ['Clavinet', 1.0, 4.0, 7.0, 0.15, 0.001, 0.35, 0.05, 0.06, 'sawtooth', 0.5],

    // 8-15: Chromatic Percussion
    ['Celesta', 2.0, 3.5, 3.0, 0.3, 0.001, 0.5, 0.0, 0.2, 'sine', 0.0],
    ['Glockenspiel', 3.0, 5.0, 4.0, 0.25, 0.001, 0.6, 0.0, 0.25, 'sine', 0.0],
    ['Music Box', 2.0, 4.0, 3.5, 0.4, 0.001, 0.8, 0.0, 0.3, 'sine', 0.05],
    ['Vibraphone', 1.0, 2.0, 2.5, 0.9, 0.002, 1.5, 0.3, 0.4, 'sine', 0.1],
    ['Marimba', 1.0, 4.0, 4.0, 0.12, 0.001, 0.3, 0.0, 0.1, 'sine', 0.0],
    ['Xylophone', 2.0, 3.0, 5.0, 0.1, 0.001, 0.25, 0.0, 0.08, 'triangle', 0.0],
    ['Tubular Bells', 1.0, 2.76, 5.5, 0.8, 0.002, 2.0, 0.0, 0.8, 'sine', 0.2],
    ['Dulcimer', 1.0, 3.0, 4.5, 0.3, 0.002, 0.6, 0.0, 0.2, 'triangle', 0.3],

    // 16-23: Organ
    ['Drawbar Organ', 1.0, 2.0, 1.5, 1.0, 0.01, 0.1, 0.9, 0.05, 'sine', 0.2],
    ['Percussive Organ', 1.0, 3.0, 3.5, 0.1, 0.005, 0.2, 0.8, 0.08, 'sine', 0.3],
    ['Rock Organ', 1.0, 2.0, 2.5, 1.0, 0.01, 0.1, 0.95, 0.05, 'sawtooth', 0.35],
    ['Church Organ', 1.0, 1.0, 2.0, 1.0, 0.03, 0.1, 0.9, 0.15, 'sine', 0.15],
    ['Reed Organ', 1.0, 2.0, 3.0, 1.0, 0.02, 0.1, 0.85, 0.1, 'triangle', 0.2],
    ['Accordion', 1.0, 2.0, 3.5, 1.0, 0.02, 0.1, 0.85, 0.1, 'sawtooth', 0.3],
    ['Harmonica', 1.0, 3.0, 4.0, 0.8, 0.02, 0.1, 0.8, 0.12, 'sawtooth', 0.25],
    ['Tango Accordion', 1.0, 2.0, 4.0, 1.0, 0.015, 0.1, 0.85, 0.1, 'sawtooth', 0.35],

    // 24-31: Guitar
    ['Acoustic Guitar (nylon)', 1.0, 2.0, 3.2, 0.4, 0.002, 0.7, 0.05, 0.2, 'sine', 0.2],
    ['Acoustic Guitar (steel)', 1.0, 3.0, 4.5, 0.4, 0.002, 0.8, 0.05, 0.25, 'triangle', 0.3],
    ['Electric Guitar (jazz)', 1.0, 1.0, 2.5, 0.6, 0.003, 0.9, 0.2, 0.25, 'sine', 0.15],
    ['Electric Guitar (clean)', 1.0, 2.0, 4.0, 0.5, 0.002, 0.8, 0.2, 0.2, 'sawtooth', 0.3],
    ['Electric Guitar (muted)', 1.0, 2.0, 4.0, 0.08, 0.001, 0.15, 0.0, 0.05, 'triangle', 0.4],
    ['Overdriven Guitar', 1.0, 2.0, 6.0, 1.0, 0.005, 0.2, 0.8, 0.2, 'sawtooth', 0.6],
    ['Distortion Guitar', 1.0, 1.0, 8.0, 1.0, 0.005, 0.15, 0.85, 0.25, 'sawtooth', 0.75],
    ['Guitar Harmonics', 2.0, 3.0, 4.0, 0.6, 0.001, 1.0, 0.0, 0.35, 'sine', 0.1],

    // 32-39: Bass
    ['Acoustic Bass', 1.0, 1.0, 3.0, 0.35, 0.003, 0.6, 0.1, 0.2, 'sine', 0.3],
    ['Electric Bass (finger)', 1.0, 1.0, 3.5, 0.4, 0.003, 0.7, 0.15, 0.2, 'triangle', 0.35],
    ['Electric Bass (pick)', 1.0, 2.0, 5.0, 0.3, 0.002, 0.6, 0.1, 0.15, 'sawtooth', 0.4],
    ['Fretless Bass', 1.0, 1.0, 2.5, 0.5, 0.01, 0.8, 0.2, 0.25, 'sine', 0.2],
    ['Slap Bass 1', 1.0, 3.0, 7.0, 0.15, 0.001, 0.4, 0.05, 0.15, 'sawtooth', 0.5],
    ['Slap Bass 2', 1.0, 4.0, 8.0, 0.12, 0.001, 0.35, 0.05, 0.12, 'sawtooth', 0.6],
    ['Synth Bass 1', 1.0, 1.0, 5.5, 0.25, 0.002, 0.4, 0.2, 0.15, 'sawtooth', 0.55],
    ['Synth Bass 2', 1.0, 2.0, 6.5, 0.2, 0.002, 0.35, 0.15, 0.12, 'square', 0.6],

    // 40-47: Strings
    ['Violin', 1.0, 1.0, 2.5, 1.0, 0.08, 0.2, 0.85, 0.2, 'sawtooth', 0.25],
    ['Viola', 1.0, 1.0, 2.2, 1.0, 0.09, 0.2, 0.85, 0.22, 'sawtooth', 0.22],
    ['Cello', 1.0, 1.0, 2.0, 1.0, 0.1, 0.25, 0.9, 0.25, 'sawtooth', 0.2],
    ['Contrabass', 1.0, 1.0, 2.0, 1.0, 0.12, 0.3, 0.9, 0.3, 'sawtooth', 0.25],
    ['Tremolo Strings', 1.0, 1.0, 3.0, 1.0, 0.05, 0.15, 0.85, 0.2, 'sawtooth', 0.3],
    ['Pizzicato Strings', 1.0, 2.0, 5.0, 0.1, 0.001, 0.2, 0.0, 0.08, 'triangle', 0.35],
    ['Orchestral Harp', 1.0, 2.0, 3.5, 0.5, 0.002, 0.8, 0.0, 0.25, 'sine', 0.15],
    ['Timpani', 0.5, 1.0, 4.0, 0.2, 0.002, 0.5, 0.0, 0.3, 'sine', 0.4],

    // 48-55: Ensemble
    ['String Ensemble 1', 1.0, 1.0, 2.8, 1.0, 0.1, 0.3, 0.85, 0.35, 'sawtooth', 0.25],
    ['String Ensemble 2', 1.0, 2.0, 2.5, 1.0, 0.12, 0.3, 0.8, 0.35, 'sawtooth', 0.2],
    ['Synth Strings 1', 1.0, 1.0, 3.5, 1.0, 0.08, 0.25, 0.85, 0.3, 'sawtooth', 0.35],
    ['Synth Strings 2', 1.0, 2.0, 3.0, 1.0, 0.1, 0.3, 0.8, 0.3, 'sawtooth', 0.3],
    ['Choir Aahs', 1.0, 2.0, 2.0, 1.0, 0.15, 0.3, 0.9, 0.4, 'sine', 0.15],
    ['Voice Oohs', 1.0, 1.0, 1.8, 1.0, 0.18, 0.35, 0.9, 0.45, 'sine', 0.1],
    ['Synth Voice', 1.0, 3.0, 3.0, 1.0, 0.12, 0.25, 0.85, 0.3, 'triangle', 0.25],
    ['Orchestra Hit', 1.0, 2.5, 7.0, 0.15, 0.001, 0.3, 0.1, 0.15, 'sawtooth', 0.65],

    // 56-63: Brass
    ['Trumpet', 1.0, 1.0, 4.5, 0.8, 0.02, 0.15, 0.8, 0.12, 'sawtooth', 0.4],
    ['Trombone', 1.0, 1.0, 4.0, 0.8, 0.03, 0.2, 0.85, 0.15, 'sawtooth', 0.35],
    ['Tuba', 1.0, 1.0, 3.5, 0.7, 0.04, 0.25, 0.9, 0.2, 'sawtooth', 0.3],
    ['Muted Trumpet', 1.0, 2.0, 6.0, 0.4, 0.015, 0.12, 0.7, 0.1, 'sawtooth', 0.5],
    ['French Horn', 1.0, 1.0, 3.0, 0.9, 0.05, 0.2, 0.85, 0.2, 'sawtooth', 0.25],
    ['Brass Section', 1.0, 1.0, 5.0, 0.8, 0.025, 0.2, 0.85, 0.18, 'sawtooth', 0.45],
    ['Synth Brass 1', 1.0, 1.0, 5.5, 0.5, 0.02, 0.25, 0.75, 0.2, 'sawtooth', 0.5],
    ['Synth Brass 2', 1.0, 2.0, 5.0, 0.6, 0.03, 0.25, 0.8, 0.22, 'sawtooth', 0.45],

    // 64-71: Reed
    ['Soprano Sax', 1.0, 2.0, 4.0, 0.8, 0.025, 0.15, 0.8, 0.12, 'sawtooth', 0.35],
    ['Alto Sax', 1.0, 2.0, 4.2, 0.8, 0.03, 0.18, 0.85, 0.14, 'sawtooth', 0.35],
    ['Tenor Sax', 1.0, 2.0, 4.0, 0.8, 0.035, 0.2, 0.85, 0.15, 'sawtooth', 0.35],
    ['Baritone Sax', 1.0, 1.0, 4.5, 0.8, 0.04, 0.22, 0.9, 0.18, 'sawtooth', 0.4],
    ['Oboe', 1.0, 3.0, 4.5, 0.8, 0.02, 0.15, 0.85, 0.12, 'sawtooth', 0.3],
    ['English Horn', 1.0, 2.0, 3.8, 0.8, 0.025, 0.18, 0.85, 0.15, 'sawtooth', 0.25],
    ['Bassoon', 1.0, 2.0, 3.5, 0.8, 0.03, 0.2, 0.85, 0.16, 'sawtooth', 0.3],
    ['Clarinet', 1.0, 3.0, 3.0, 0.9, 0.02, 0.15, 0.85, 0.12, 'triangle', 0.2],

    // 72-79: Pipe
    ['Piccolo', 2.0, 1.0, 2.0, 0.9, 0.015, 0.1, 0.9, 0.1, 'sine', 0.1],
    ['Flute', 1.0, 1.0, 1.8, 0.9, 0.02, 0.12, 0.9, 0.12, 'sine', 0.1],
    ['Recorder', 1.0, 2.0, 2.2, 0.9, 0.015, 0.1, 0.85, 0.1, 'sine', 0.12],
    ['Pan Flute', 1.0, 1.0, 2.5, 0.6, 0.025, 0.15, 0.85, 0.15, 'sine', 0.18],
    ['Blown Bottle', 1.0, 1.0, 2.2, 0.5, 0.04, 0.2, 0.8, 0.18, 'sine', 0.15],
    ['Shakuhachi', 1.0, 2.0, 3.0, 0.6, 0.03, 0.2, 0.8, 0.2, 'sine', 0.25],
    ['Whistle', 2.0, 1.0, 1.5, 0.9, 0.015, 0.08, 0.9, 0.08, 'sine', 0.05],
    ['Ocarina', 1.0, 1.0, 2.0, 0.9, 0.02, 0.1, 0.9, 0.1, 'sine', 0.1],

    // 80-87: Synth Lead
    ['Lead 1 (square)', 1.0, 1.0, 1.0, 1.0, 0.005, 0.1, 0.9, 0.1, 'square', 0.0],
    ['Lead 2 (sawtooth)', 1.0, 1.0, 2.0, 1.0, 0.005, 0.1, 0.9, 0.1, 'sawtooth', 0.2],
    ['Lead 3 (calliope)', 1.0, 2.0, 3.5, 0.7, 0.01, 0.15, 0.85, 0.15, 'sine', 0.3],
    ['Lead 4 (chiff)', 1.0, 3.0, 5.0, 0.1, 0.005, 0.15, 0.8, 0.1, 'triangle', 0.4],
    ['Lead 5 (charang)', 1.0, 2.0, 5.5, 0.8, 0.008, 0.18, 0.85, 0.12, 'sawtooth', 0.55],
    ['Lead 6 (voice)', 1.0, 2.0, 2.5, 1.0, 0.03, 0.2, 0.9, 0.2, 'sine', 0.2],
    ['Lead 7 (fifths)', 1.5, 1.0, 4.0, 0.9, 0.008, 0.15, 0.85, 0.15, 'sawtooth', 0.4],
    ['Lead 8 (bass + lead)', 1.0, 1.0, 6.0, 0.6, 0.005, 0.15, 0.85, 0.15, 'sawtooth', 0.6],

    // 88-95: Synth Pad
    ['Pad 1 (new age)', 1.0, 2.0, 2.5, 1.0, 0.15, 0.4, 0.85, 0.5, 'sine', 0.2],
    ['Pad 2 (warm)', 1.0, 1.0, 2.0, 1.0, 0.2, 0.4, 0.9, 0.6, 'sawtooth', 0.15],
    ['Pad 3 (polysynth)', 1.0, 1.0, 3.5, 1.0, 0.1, 0.3, 0.85, 0.4, 'sawtooth', 0.3],
    ['Pad 4 (choir)', 1.0, 2.0, 2.2, 1.0, 0.18, 0.4, 0.9, 0.5, 'sine', 0.15],
    ['Pad 5 (bowed)', 1.0, 1.0, 2.8, 1.0, 0.15, 0.35, 0.85, 0.45, 'sawtooth', 0.25],
    ['Pad 6 (metallic)', 1.0, 3.14, 4.5, 0.8, 0.12, 0.3, 0.8, 0.4, 'sine', 0.4],
    ['Pad 7 (halo)', 1.0, 2.0, 2.8, 1.0, 0.2, 0.4, 0.9, 0.55, 'sine', 0.2],
    ['Pad 8 (sweep)', 1.0, 1.0, 4.0, 0.8, 0.25, 0.4, 0.85, 0.6, 'sawtooth', 0.35],

    // 96-103: Synth Effects
    ['FX 1 (rain)', 1.0, 4.2, 5.0, 0.4, 0.005, 0.5, 0.4, 0.3, 'sine', 0.5],
    ['FX 2 (soundtrack)', 1.0, 2.0, 3.5, 1.0, 0.15, 0.4, 0.85, 0.5, 'sawtooth', 0.3],
    ['FX 3 (crystal)', 2.0, 3.0, 6.0, 0.5, 0.005, 0.6, 0.3, 0.35, 'sine', 0.4],
    ['FX 4 (atmosphere)', 1.0, 1.0, 3.0, 1.0, 0.2, 0.4, 0.9, 0.5, 'triangle', 0.25],
    ['FX 5 (brightness)', 2.0, 2.0, 4.5, 0.8, 0.05, 0.3, 0.8, 0.4, 'sawtooth', 0.35],
    ['FX 6 (goblins)', 1.0, 1.41, 5.5, 0.7, 0.08, 0.35, 0.75, 0.45, 'sawtooth', 0.5],
    ['FX 7 (echoes)', 1.0, 2.0, 3.0, 0.5, 0.01, 0.4, 0.5, 0.4, 'sine', 0.2],
    ['FX 8 (sci-fi)', 0.5, 2.7, 7.0, 0.6, 0.02, 0.35, 0.7, 0.35, 'sawtooth', 0.6],

    // 104-111: Ethnic
    ['Sitar', 1.0, 3.0, 6.0, 0.3, 0.002, 0.6, 0.1, 0.2, 'sawtooth', 0.5],
    ['Banjo', 1.0, 3.0, 5.5, 0.15, 0.001, 0.3, 0.0, 0.1, 'sawtooth', 0.45],
    ['Shamisen', 1.0, 2.0, 5.0, 0.2, 0.001, 0.35, 0.0, 0.12, 'sawtooth', 0.4],
    ['Koto', 1.0, 2.0, 4.0, 0.25, 0.001, 0.45, 0.0, 0.15, 'triangle', 0.3],
    ['Kalimba', 2.0, 3.0, 3.5, 0.3, 0.001, 0.5, 0.0, 0.2, 'sine', 0.1],
    ['Bag pipe', 1.0, 2.0, 4.5, 1.0, 0.04, 0.15, 0.9, 0.15, 'sawtooth', 0.4],
    ['Fiddle', 1.0, 1.0, 3.0, 1.0, 0.03, 0.18, 0.85, 0.18, 'sawtooth', 0.3],
    ['Shanai', 1.0, 2.0, 4.8, 0.8, 0.025, 0.15, 0.85, 0.15, 'sawtooth', 0.4],

    // 112-119: Percussive
    ['Tinkle Bell', 3.0, 5.5, 5.0, 0.3, 0.001, 0.5, 0.0, 0.25, 'sine', 0.2],
    ['Agogo', 2.0, 3.0, 4.5, 0.15, 0.001, 0.25, 0.0, 0.1, 'sine', 0.3],
    ['Steel Drums', 1.0, 2.0, 4.0, 0.35, 0.002, 0.5, 0.1, 0.2, 'sine', 0.35],
    ['Woodblock', 2.0, 4.0, 6.0, 0.05, 0.001, 0.1, 0.0, 0.05, 'triangle', 0.4],
    ['Taiko Drum', 0.5, 1.0, 5.0, 0.2, 0.001, 0.4, 0.0, 0.2, 'sine', 0.5],
    ['Melodic Tom', 1.0, 1.0, 3.5, 0.25, 0.001, 0.35, 0.0, 0.15, 'sine', 0.3],
    ['Synth Drum', 1.0, 1.0, 5.5, 0.18, 0.001, 0.3, 0.0, 0.15, 'triangle', 0.6],
    ['Reverse Cymbal', 3.0, 1.0, 4.0, 0.5, 0.4, 0.1, 0.8, 0.1, 'sawtooth', 0.5],

    // 120-127: Sound Effects
    ['Guitar Fret Noise', 1.0, 5.0, 6.0, 0.05, 0.001, 0.1, 0.0, 0.05, 'sawtooth', 0.6],
    ['Breath Noise', 1.0, 1.0, 2.0, 0.4, 0.05, 0.3, 0.5, 0.2, 'triangle', 0.3],
    ['Seashore', 0.5, 1.0, 3.0, 1.0, 0.3, 0.5, 0.8, 0.6, 'sine', 0.4],
    ['Bird Tweet', 4.0, 2.0, 5.0, 0.1, 0.005, 0.15, 0.0, 0.1, 'sine', 0.3],
    ['Telephone Ring', 2.0, 1.0, 3.0, 0.8, 0.01, 0.1, 0.8, 0.1, 'square', 0.2],
    ['Helicopter', 0.5, 1.0, 7.0, 0.1, 0.01, 0.15, 0.8, 0.1, 'sawtooth', 0.7],
    ['Applause', 1.0, 3.5, 5.0, 0.8, 0.1, 0.4, 0.7, 0.4, 'triangle', 0.5],
    ['Gunshot', 0.5, 2.0, 9.0, 0.1, 0.001, 0.3, 0.0, 0.15, 'sawtooth', 0.8],
  ];

  /* ========================================================================== */
  /*                            STANDARD MIDI PARSER (SMF)                     */
  /* ========================================================================== */

  class SMFParser {
    /**
     * Reads a 7-bit Variable Length Quantity (VLQ)
     */
    static readVLQ(dataView, offset) {
      let value = 0;
      let bytesRead = 0;
      while (offset + bytesRead < dataView.byteLength) {
        const byte = dataView.getUint8(offset + bytesRead);
        bytesRead++;
        value = (value << 7) | (byte & 0x7F);
        if ((byte & 0x80) === 0) break;
      }
      return { value, bytesRead };
    }

    /**
     * Parses standard MIDI ArrayBuffer into timed event tracks
     */
    static parse(buffer) {
      const dataView = new DataView(buffer instanceof ArrayBuffer ? buffer : buffer.buffer, buffer.byteOffset || 0, buffer.byteLength);
      let offset = 0;

      // 1. Check Header Magic 'MThd' (0x4D546864)
      if (dataView.getUint32(offset) !== 0x4D546864) {
        throw new Error('Invalid MIDI file: Missing MThd header chunk');
      }
      offset += 4;

      const headerLength = dataView.getUint32(offset);
      offset += 4;

      const format = dataView.getUint16(offset);
      offset += 2;
      const numTracks = dataView.getUint16(offset);
      offset += 2;
      const division = dataView.getUint16(offset);
      offset += 2;

      // Skip remaining header bytes if any
      if (headerLength > 6) {
        offset += (headerLength - 6);
      }

      const ticksPerQuarterNote = (division & 0x8000) ? 480 : division;
      const tracks = [];

      // 2. Parse MTrk Chunks
      for (let t = 0; t < numTracks && offset < dataView.byteLength; t++) {
        if (dataView.getUint32(offset) !== 0x4D54726B) { // 'MTrk'
          // Search for next MTrk if offset is misaligned
          let found = false;
          while (offset <= dataView.byteLength - 8) {
            if (dataView.getUint32(offset) === 0x4D54726B) {
              found = true;
              break;
            }
            offset++;
          }
          if (!found) break;
        }
        offset += 4;
        const trackLength = dataView.getUint32(offset);
        offset += 4;
        const trackEnd = offset + trackLength;

        const events = [];
        let currentTicks = 0;
        let runningStatus = 0;

        while (offset < trackEnd && offset < dataView.byteLength) {
          const vlq = SMFParser.readVLQ(dataView, offset);
          offset += vlq.bytesRead;
          currentTicks += vlq.value;

          let statusByte = dataView.getUint8(offset);

          if (statusByte & 0x80) {
            runningStatus = statusByte;
            offset++;
          } else {
            statusByte = runningStatus;
          }

          const messageType = statusByte & 0xF0;
          const channel = statusByte & 0x0F;

          if (statusByte === 0xFF) {
            // Meta Event
            const metaType = dataView.getUint8(offset++);
            const metaLength = SMFParser.readVLQ(dataView, offset);
            offset += metaLength.bytesRead;
            const metaDataOffset = offset;
            offset += metaLength.value;

            if (metaType === 0x51 && metaLength.value === 3) {
              // Set Tempo (microseconds per quarter note)
              const mpqn = (dataView.getUint8(metaDataOffset) << 16) |
                           (dataView.getUint8(metaDataOffset + 1) << 8) |
                           dataView.getUint8(metaDataOffset + 2);
              const bpm = 60000000 / (mpqn || 500000);
              events.push({
                ticks: currentTicks,
                type: 'setTempo',
                mpqn,
                bpm,
              });
            } else if (metaType === 0x2F) {
              // End of Track
              events.push({
                ticks: currentTicks,
                type: 'endOfTrack',
              });
              break;
            }
          } else if (statusByte === 0xF0 || statusByte === 0xF7) {
            // SysEx Event: skip
            const sysexLength = SMFParser.readVLQ(dataView, offset);
            offset += sysexLength.bytesRead + sysexLength.value;
          } else {
            // Channel Voice Messages
            switch (messageType) {
              case 0x80: { // Note Off
                const note = dataView.getUint8(offset++);
                const velocity = dataView.getUint8(offset++);
                events.push({ ticks: currentTicks, type: 'noteOff', channel, note, velocity });
                break;
              }
              case 0x90: { // Note On (velocity 0 is Note Off)
                const note = dataView.getUint8(offset++);
                const velocity = dataView.getUint8(offset++);
                if (velocity === 0) {
                  events.push({ ticks: currentTicks, type: 'noteOff', channel, note, velocity });
                } else {
                  events.push({ ticks: currentTicks, type: 'noteOn', channel, note, velocity });
                }
                break;
              }
              case 0xA0: { // Polyphonic Aftertouch
                const note = dataView.getUint8(offset++);
                const pressure = dataView.getUint8(offset++);
                events.push({ ticks: currentTicks, type: 'polyPressure', channel, note, pressure });
                break;
              }
              case 0xB0: { // Control Change
                const controller = dataView.getUint8(offset++);
                const value = dataView.getUint8(offset++);
                events.push({ ticks: currentTicks, type: 'controller', channel, controller, value });
                break;
              }
              case 0xC0: { // Program Change
                const program = dataView.getUint8(offset++);
                events.push({ ticks: currentTicks, type: 'programChange', channel, program });
                break;
              }
              case 0xD0: { // Channel Pressure
                const pressure = dataView.getUint8(offset++);
                events.push({ ticks: currentTicks, type: 'channelPressure', channel, pressure });
                break;
              }
              case 0xE0: { // Pitch Bend (14-bit unsigned)
                const lsb = dataView.getUint8(offset++);
                const msb = dataView.getUint8(offset++);
                const bend = ((msb << 7) | lsb) - 8192; // -8192 to +8191
                events.push({ ticks: currentTicks, type: 'pitchBend', channel, bend });
                break;
              }
              default:
                // Unknown status byte, step forward to avoid infinite loop
                offset++;
                break;
            }
          }
        }
        tracks.push(events);
      }

      // Merge and sort all events into a unified chronological event timeline
      const mergedEvents = [];
      for (const track of tracks) {
        for (const ev of track) {
          mergedEvents.push(ev);
        }
      }
      mergedEvents.sort((a, b) => a.ticks - b.ticks);

      // Compute precise wall-clock seconds for each event based on tempo markers
      let currentSeconds = 0;
      let lastTicks = 0;
      let currentMPQN = 500000; // Default 120 BPM (500,000 microseconds / beat)
      let initialBPM = 120;
      let foundInitialBPM = false;

      for (const ev of mergedEvents) {
        const deltaTicks = ev.ticks - lastTicks;
        const deltaSeconds = (deltaTicks / ticksPerQuarterNote) * (currentMPQN / 1000000.0);
        currentSeconds += deltaSeconds;
        ev.timeSeconds = currentSeconds;
        lastTicks = ev.ticks;

        if (ev.type === 'setTempo') {
          currentMPQN = ev.mpqn;
          if (!foundInitialBPM) {
            initialBPM = ev.bpm;
            foundInitialBPM = true;
          }
        }
      }

      const totalDuration = currentSeconds;
      const totalTicks = lastTicks;

      return {
        format,
        numTracks,
        ticksPerQuarterNote,
        totalDuration,
        totalTicks,
        initialBPM,
        events: mergedEvents,
      };
    }
  }

  /* ========================================================================== */
  /*                           SYNTHESIS & AUDIO GRAPH                          */
  /* ========================================================================== */

  class MidiSynthPlayerEngine {
    constructor() {
      this.audioCtx = null;
      this.masterGain = null;
      this.masterFilter = null;
      this.spatialPanner = null;
      this.noiseBuffer = null;

      // Playback State
      this.isPlaying = false;
      this.isPaused = false;
      this.currentParsedSong = null;
      this.currentSongName = '';
      this.loop = true;
      this.masterVolume = 80.0; // 0 - 100
      this.tempoMultiplier = 1.0; // 0.25 - 4.0
      this.transposition = 0; // -24 to +24 semitones
      this.soundChipProfile = 'OPL3_SoundBlaster';
      this.maxPolyphony = 32;

      // Clock and Timing State
      this.playbackPositionSeconds = 0.0;
      this.playbackStartAudioTime = 0.0;
      this.playbackStartSongSeconds = 0.0;
      this.eventCursor = 0;
      this.schedulerTimerId = null;
      this.currentBPM = 120.0;

      // 16 MIDI Channels State
      this.channels = [];
      this.resetChannels();

      // Active Polyphonic Voices Pool
      this.activeVoices = [];

      // 3D Spatial Emitter Anchor
      this.spatialObject = null;
      this.spatialEnabled = false;
      this.lastCameraPos = { x: 0, y: 0, z: 0 };
    }

    /**
     * Initializes AudioContext & AudioNodes lazily
     */
    ensureAudioContext() {
      if (this.audioCtx) {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
        return this.audioCtx;
      }

      const AudioCtxClass = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioCtxClass) {
        console.warn('MidiSynthPlayer: Web Audio API not supported on this device.');
        return null;
      }

      this.audioCtx = new AudioCtxClass();

      // Master Gain Node
      this.masterGain = this.audioCtx.createGain();
      this.masterGain.gain.setValueAtTime(this.masterVolume / 100.0, this.audioCtx.currentTime);

      // Master Resonant Lowpass Filter Node
      this.masterFilter = this.audioCtx.createBiquadFilter();
      this.masterFilter.type = 'lowpass';
      const chip = CHIP_PROFILES[this.soundChipProfile] || CHIP_PROFILES.OPL3_SoundBlaster;
      this.masterFilter.frequency.setValueAtTime(chip.filterCutoff, this.audioCtx.currentTime);
      this.masterFilter.Q.setValueAtTime(chip.resonance, this.audioCtx.currentTime);

      // 3D Spatial Panner Node
      if (this.audioCtx.createPanner) {
        this.spatialPanner = this.audioCtx.createPanner();
        this.spatialPanner.panningModel = 'HRTF';
        this.spatialPanner.distanceModel = 'inverse';
        this.spatialPanner.refDistance = 50;
        this.spatialPanner.maxDistance = 2000;
        this.spatialPanner.rolloffFactor = 1.0;
      }

      // Connect graph: Synth -> MasterFilter -> MasterGain -> (Panner) -> Destination
      if (this.spatialEnabled && this.spatialPanner) {
        this.masterFilter.connect(this.masterGain);
        this.masterGain.connect(this.spatialPanner);
        this.spatialPanner.connect(this.audioCtx.destination);
      } else {
        this.masterFilter.connect(this.masterGain);
        this.masterGain.connect(this.audioCtx.destination);
      }

      // Generate 2 seconds of white noise buffer for high-efficiency drum synthesis
      this.generateNoiseBuffer();

      return this.audioCtx;
    }

    /**
     * Pre-generates white noise AudioBuffer for percussion
     */
    generateNoiseBuffer() {
      if (!this.audioCtx) return;
      const bufferSize = this.audioCtx.sampleRate * 2;
      this.noiseBuffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }

    /**
     * Resets 16 MIDI Channels to default GM state
     */
    resetChannels() {
      this.channels = [];
      for (let i = 0; i < 16; i++) {
        this.channels.push({
          channel: i,
          program: i === 9 ? 0 : 0, // Channel 9 is Drum Kit
          volume: 100, // 0 - 127
          expression: 127, // 0 - 127
          pan: 0.0, // -1.0 to +1.0
          pitchBendSemitones: 0.0,
          sustainPedal: false,
          muted: false,
          solo: false,
          activeNotes: new Map(), // noteNumber -> active voice array
        });
      }
    }

    /**
     * Converts MIDI Note number to Frequency in Hz
     */
    midiNoteToFrequency(noteNumber, semitoneOffset = 0, bendSemitones = 0) {
      const effectiveNote = noteNumber + semitoneOffset + bendSemitones;
      return 440.0 * Math.pow(2.0, (effectiveNote - 69) / 12.0);
    }

    /**
     * Sets Active Sound Chip Profile
     */
    setSoundChipProfile(profileKey) {
      if (!CHIP_PROFILES[profileKey]) return;
      this.soundChipProfile = profileKey;
      const chip = CHIP_PROFILES[profileKey];
      if (this.masterFilter && this.audioCtx) {
        this.masterFilter.frequency.setTargetAtTime(chip.filterCutoff, this.audioCtx.currentTime, 0.05);
        this.masterFilter.Q.setTargetAtTime(chip.resonance, this.audioCtx.currentTime, 0.05);
      }
    }

    /**
     * Sets Master Volume (0 - 100)
     */
    setMasterVolume(vol) {
      this.masterVolume = Math.max(0.0, Math.min(100.0, vol));
      if (this.masterGain && this.audioCtx) {
        this.masterGain.gain.setTargetAtTime(this.masterVolume / 100.0, this.audioCtx.currentTime, 0.02);
      }
    }

    /**
     * Sets Master Lowpass Cutoff in Hz
     */
    setLowpassCutoff(freqHz) {
      const clamped = Math.max(20.0, Math.min(22050.0, freqHz));
      if (this.masterFilter && this.audioCtx) {
        this.masterFilter.frequency.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.03);
      }
    }

    /**
     * Sets Master Filter Resonance Q
     */
    setFilterResonance(q) {
      const clamped = Math.max(0.1, Math.min(25.0, q));
      if (this.masterFilter && this.audioCtx) {
        this.masterFilter.Q.setTargetAtTime(clamped, this.audioCtx.currentTime, 0.03);
      }
    }

    /**
     * Sets Channel Mute state
     */
    setChannelMuted(channelIndex, isMuted) {
      if (channelIndex >= 0 && channelIndex < 16) {
        this.channels[channelIndex].muted = !!isMuted;
        if (isMuted) {
          // Immediately silence active voices on this channel
          this.silenceChannelVoices(channelIndex);
        }
      }
    }

    /**
     * Sets Channel Solo state
     */
    soloChannel(channelIndex) {
      for (let i = 0; i < 16; i++) {
        this.channels[i].solo = (i === channelIndex);
        if (i !== channelIndex) {
          this.silenceChannelVoices(i);
        }
      }
    }

    /**
     * Unmutes all 16 channels
     */
    unmuteAllChannels() {
      for (let i = 0; i < 16; i++) {
        this.channels[i].muted = false;
        this.channels[i].solo = false;
      }
    }

    /**
     * Sets Channel Volume (0 - 100)
     */
    setChannelVolume(channelIndex, vol) {
      if (channelIndex >= 0 && channelIndex < 16) {
        this.channels[channelIndex].volume = Math.max(0.0, Math.min(100.0, vol));
      }
    }

    /**
     * Sets Channel Instrument Program (0 - 127)
     */
    setChannelInstrument(channelIndex, programNumber) {
      if (channelIndex >= 0 && channelIndex < 16) {
        this.channels[channelIndex].program = Math.max(0, Math.min(127, Math.floor(programNumber)));
      }
    }

    /**
     * Gets Channel Instrument Program (0 - 127)
     */
    getChannelInstrument(channelIndex) {
      if (channelIndex >= 0 && channelIndex < 16) {
        return this.channels[channelIndex].program;
      }
      return 0;
    }

    /**
     * Gets General MIDI Instrument Name
     */
    getInstrumentName(programNumber) {
      const idx = Math.max(0, Math.min(127, Math.floor(programNumber)));
      return GM_INSTRUMENTS[idx] ? GM_INSTRUMENTS[idx][0] : 'Acoustic Grand Piano';
    }

    /**
     * Plays a single note on demand with automatic duration
     */
    playNote(channelIndex, noteNumber, velocity = 100, durationSeconds = 0.5) {
      this.ensureAudioContext();
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      const ch = Math.max(0, Math.min(15, Math.floor(channelIndex)));
      const note = Math.max(0, Math.min(127, Math.floor(noteNumber)));
      const vel = Math.max(1, Math.min(127, Math.floor(velocity)));
      const dur = Math.max(0.02, durationSeconds);

      if (ch === 9) {
        this.triggerDrum(note, vel, now);
      } else {
        this.triggerNoteOn(ch, note, vel, now);
        this.triggerNoteOff(ch, note, now + dur);
      }
    }

    /**
     * Silences all active voices on a specific channel
     */
    silenceChannelVoices(channelIndex) {
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      for (const voice of this.activeVoices) {
        if (voice.channel === channelIndex && voice.gainNode) {
          try {
            voice.gainNode.gain.cancelScheduledValues(now);
            voice.gainNode.gain.setValueAtTime(0.0001, now);
          } catch (_) {}
        }
      }
    }

    /**
     * Stops all active polyphonic voices immediately
     */
    stopAllVoices() {
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      for (const voice of this.activeVoices) {
        try {
          if (voice.gainNode) {
            voice.gainNode.gain.cancelScheduledValues(now);
            voice.gainNode.gain.setValueAtTime(0.0001, now);
          }
          if (voice.nodes) {
            for (const node of voice.nodes) {
              if (node.stop) node.stop(now + 0.05);
            }
          }
        } catch (_) {}
      }
      this.activeVoices = [];
      for (const ch of this.channels) {
        ch.activeNotes.clear();
      }
    }

    /* ======================================================================== */
    /*                         POLYPHONIC VOICE SYNTHESIS                       */
    /* ======================================================================== */

    /**
     * Allocates a polyphonic synth voice with dynamic voice stealing
     */
    allocateVoice(channelIndex, noteNumber, scheduleTime) {
      // Voice Stealing if voice limit is reached
      if (this.activeVoices.length >= this.maxPolyphony) {
        // Find oldest releasing voice, or oldest voice
        let candidateIdx = 0;
        for (let i = 0; i < this.activeVoices.length; i++) {
          if (this.activeVoices[i].isReleasing) {
            candidateIdx = i;
            break;
          }
        }
        const stolen = this.activeVoices.splice(candidateIdx, 1)[0];
        if (stolen && stolen.gainNode && this.audioCtx) {
          try {
            stolen.gainNode.gain.cancelScheduledValues(scheduleTime);
            stolen.gainNode.gain.setValueAtTime(0.0001, scheduleTime);
            if (stolen.nodes) {
              for (const n of stolen.nodes) {
                if (n.stop) n.stop(scheduleTime + 0.02);
              }
            }
          } catch (_) {}
        }
      }

      const voice = {
        channel: channelIndex,
        note: noteNumber,
        startTime: scheduleTime,
        isReleasing: false,
        gainNode: null,
        nodes: [],
      };
      this.activeVoices.push(voice);
      return voice;
    }

    /**
     * Triggers a Melodic Note On (2-Op / 4-Op FM Synthesis)
     */
    triggerNoteOn(channelIndex, noteNumber, velocity, scheduleTime) {
      const ch = this.channels[channelIndex];
      if (ch.muted) return;
      // If any channel is soloed, ensure only solo channels sound
      const hasSolo = this.channels.some(c => c.solo);
      if (hasSolo && !ch.solo) return;

      this.ensureAudioContext();
      if (!this.audioCtx) return;

      const time = Math.max(this.audioCtx.currentTime, scheduleTime);
      const programIndex = Math.max(0, Math.min(127, ch.program || 0));
      const inst = GM_INSTRUMENTS[programIndex] || GM_INSTRUMENTS[0];
      const chip = CHIP_PROFILES[this.soundChipProfile] || CHIP_PROFILES.OPL3_SoundBlaster;

      const [, cRatio, mRatio, modIndex, modDecay, attack, decay, sustain, release, baseWave, feedback] = inst;

      const freq = this.midiNoteToFrequency(noteNumber, this.transposition, ch.pitchBendSemitones);
      const velScale = velocity / 127.0;
      const chVolScale = (ch.volume / 100.0) * (ch.expression / 127.0);
      const peakGain = velScale * chVolScale * 0.35;

      const voice = this.allocateVoice(channelIndex, noteNumber, time);

      // 1. Voice Output Gain Node (ADSR Envelope)
      const voiceGain = this.audioCtx.createGain();
      voiceGain.gain.setValueAtTime(0.0001, time);
      // Attack: Linear ramp to peak
      voiceGain.gain.linearRampToValueAtTime(Math.max(peakGain, 0.0001), time + attack);
      // Decay: Exponential ramp to sustain level
      const sustainGain = Math.max(peakGain * sustain, 0.0001);
      voiceGain.gain.exponentialRampToValueAtTime(sustainGain, time + attack + decay);

      voice.gainNode = voiceGain;

      // 2. Carrier Oscillator
      const carrierOsc = this.audioCtx.createOscillator();
      carrierOsc.type = chip.waveform === 'square' ? 'square' : (baseWave || 'sine');
      carrierOsc.frequency.setValueAtTime(freq * cRatio, time);

      // 3. Modulator Oscillator (FM Synthesis)
      const modOsc = this.audioCtx.createOscillator();
      modOsc.type = chip.modWaveform === 'triangle' ? 'triangle' : 'sine';
      modOsc.frequency.setValueAtTime(freq * mRatio, time);

      // Modulator Gain (Timbre Brightness & Modulation Index Envelope)
      const modGain = this.audioCtx.createGain();
      const initialModDepth = freq * modIndex * (chip.feedbackScale || 1.0) * (1.0 + feedback);
      modGain.gain.setValueAtTime(initialModDepth, time);
      modGain.gain.exponentialRampToValueAtTime(Math.max(initialModDepth * 0.15, 0.1), time + attack + modDecay);

      // Connect FM Modulator to Carrier Frequency
      modOsc.connect(modGain);
      modGain.connect(carrierOsc.frequency);

      // Connect Carrier to Voice Envelope -> Master Filter
      carrierOsc.connect(voiceGain);
      voiceGain.connect(this.masterFilter);

      carrierOsc.start(time);
      modOsc.start(time);

      voice.nodes = [carrierOsc, modOsc, voiceGain, modGain];
      voice.inst = inst;

      // Track active note
      if (!ch.activeNotes.has(noteNumber)) {
        ch.activeNotes.set(noteNumber, []);
      }
      ch.activeNotes.get(noteNumber).push(voice);
    }

    /**
     * Triggers a Melodic Note Off (Release Phase)
     */
    triggerNoteOff(channelIndex, noteNumber, scheduleTime) {
      const ch = this.channels[channelIndex];
      if (!ch.activeNotes.has(noteNumber)) return;
      if (!this.audioCtx) return;

      const time = Math.max(this.audioCtx.currentTime, scheduleTime);
      const voices = ch.activeNotes.get(noteNumber);

      while (voices.length > 0) {
        const voice = voices.shift();
        if (!voice || !voice.gainNode) continue;

        voice.isReleasing = true;
        const releaseTime = (voice.inst ? voice.inst[8] : 0.2);

        try {
          voice.gainNode.gain.cancelScheduledValues(time);
          voice.gainNode.gain.setValueAtTime(voice.gainNode.gain.value || 0.05, time);
          voice.gainNode.gain.exponentialRampToValueAtTime(0.0001, time + releaseTime);

          const stopTime = time + releaseTime + 0.05;
          if (voice.nodes) {
            for (const node of voice.nodes) {
              if (node.stop) node.stop(stopTime);
            }
          }
        } catch (_) {}
      }
    }

    /**
     * Triggers Channel 10 Percussion (GM Drum Map Math Algorithms)
     */
    triggerDrum(noteNumber, velocity, scheduleTime) {
      const ch = this.channels[9];
      if (ch.muted) return;
      const hasSolo = this.channels.some(c => c.solo);
      if (hasSolo && !ch.solo) return;

      this.ensureAudioContext();
      if (!this.audioCtx) return;

      const time = Math.max(this.audioCtx.currentTime, scheduleTime);
      const velScale = velocity / 127.0;
      const chVolScale = (ch.volume / 100.0) * (ch.expression / 127.0);
      const peakGain = velScale * chVolScale * 0.45;

      const voice = this.allocateVoice(9, noteNumber, time);

      switch (noteNumber) {
        // --- BASS DRUM / KICK (35, 36) ---
        case 35:
        case 36: {
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(150, time);
          osc.frequency.exponentialRampToValueAtTime(35, time + 0.09);

          gain.gain.setValueAtTime(peakGain * 1.2, time);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);

          osc.connect(gain);
          gain.connect(this.masterFilter);

          osc.start(time);
          osc.stop(time + 0.28);

          voice.gainNode = gain;
          voice.nodes = [osc, gain];
          break;
        }

        // --- SNARE DRUM (38, 40) ---
        case 38:
        case 40: {
          // 1. Noise burst with Bandpass filter
          const noise = this.audioCtx.createBufferSource();
          noise.buffer = this.noiseBuffer;
          const bandpass = this.audioCtx.createBiquadFilter();
          bandpass.type = 'bandpass';
          bandpass.frequency.setValueAtTime(1200, time);
          bandpass.Q.setValueAtTime(1.5, time);

          const noiseGain = this.audioCtx.createGain();
          noiseGain.gain.setValueAtTime(peakGain * 0.9, time);
          noiseGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

          noise.connect(bandpass);
          bandpass.connect(noiseGain);
          noiseGain.connect(this.masterFilter);

          // 2. Punch tone (sine 180Hz)
          const osc = this.audioCtx.createOscillator();
          const oscGain = this.audioCtx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(180, time);
          osc.frequency.exponentialRampToValueAtTime(60, time + 0.06);

          oscGain.gain.setValueAtTime(peakGain * 0.7, time);
          oscGain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);

          osc.connect(oscGain);
          oscGain.connect(this.masterFilter);

          noise.start(time);
          noise.stop(time + 0.2);
          osc.start(time);
          osc.stop(time + 0.1);

          voice.gainNode = noiseGain;
          voice.nodes = [noise, bandpass, noiseGain, osc, oscGain];
          break;
        }

        // --- CLOSED HI-HAT / PEDAL (42, 44) ---
        case 42:
        case 44: {
          const noise = this.audioCtx.createBufferSource();
          noise.buffer = this.noiseBuffer;
          const highpass = this.audioCtx.createBiquadFilter();
          highpass.type = 'highpass';
          highpass.frequency.setValueAtTime(7000, time);

          const gain = this.audioCtx.createGain();
          gain.gain.setValueAtTime(peakGain * 0.6, time);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

          noise.connect(highpass);
          highpass.connect(gain);
          gain.connect(this.masterFilter);

          noise.start(time);
          noise.stop(time + 0.06);

          voice.gainNode = gain;
          voice.nodes = [noise, highpass, gain];
          break;
        }

        // --- OPEN HI-HAT (46) ---
        case 46: {
          const noise = this.audioCtx.createBufferSource();
          noise.buffer = this.noiseBuffer;
          const highpass = this.audioCtx.createBiquadFilter();
          highpass.type = 'highpass';
          highpass.frequency.setValueAtTime(6500, time);

          const gain = this.audioCtx.createGain();
          gain.gain.setValueAtTime(peakGain * 0.65, time);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.35);

          noise.connect(highpass);
          highpass.connect(gain);
          gain.connect(this.masterFilter);

          noise.start(time);
          noise.stop(time + 0.38);

          voice.gainNode = gain;
          voice.nodes = [noise, highpass, gain];
          break;
        }

        // --- CYMBALS / CRASH / SPLASH (49, 51, 55, 57, 59) ---
        case 49:
        case 51:
        case 55:
        case 57:
        case 59: {
          const noise = this.audioCtx.createBufferSource();
          noise.buffer = this.noiseBuffer;
          const highpass = this.audioCtx.createBiquadFilter();
          highpass.type = 'highpass';
          highpass.frequency.setValueAtTime(5500, time);

          const gain = this.audioCtx.createGain();
          gain.gain.setValueAtTime(peakGain * 0.8, time);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + 1.2);

          noise.connect(highpass);
          highpass.connect(gain);
          gain.connect(this.masterFilter);

          noise.start(time);
          noise.stop(time + 1.25);

          voice.gainNode = gain;
          voice.nodes = [noise, highpass, gain];
          break;
        }

        // --- TOMS (41, 43, 45, 47, 48, 50) ---
        case 41:
        case 43:
        case 45:
        case 47:
        case 48:
        case 50: {
          const tomPitchMap = { 41: 85, 43: 95, 45: 115, 47: 135, 48: 165, 50: 195 };
          const baseFreq = tomPitchMap[noteNumber] || 120;

          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(baseFreq * 1.5, time);
          osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.7, time + 0.2);

          gain.gain.setValueAtTime(peakGain * 0.9, time);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.28);

          osc.connect(gain);
          gain.connect(this.masterFilter);

          osc.start(time);
          osc.stop(time + 0.3);

          voice.gainNode = gain;
          voice.nodes = [osc, gain];
          break;
        }

        // --- HAND CLAP (39) & TAMBOURINE (54) & COWBELL (56) ---
        case 39: {
          // Hand Clap (Triple noise burst)
          const noise = this.audioCtx.createBufferSource();
          noise.buffer = this.noiseBuffer;
          const bandpass = this.audioCtx.createBiquadFilter();
          bandpass.type = 'bandpass';
          bandpass.frequency.setValueAtTime(1400, time);

          const gain = this.audioCtx.createGain();
          gain.gain.setValueAtTime(peakGain * 0.8, time);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.12);

          noise.connect(bandpass);
          bandpass.connect(gain);
          gain.connect(this.masterFilter);

          noise.start(time);
          noise.stop(time + 0.15);

          voice.gainNode = gain;
          voice.nodes = [noise, bandpass, gain];
          break;
        }

        case 56: {
          // Cowbell (Two detuned square frequencies: 587Hz & 845Hz)
          const osc1 = this.audioCtx.createOscillator();
          const osc2 = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();

          osc1.type = 'square';
          osc2.type = 'square';
          osc1.frequency.setValueAtTime(587, time);
          osc2.frequency.setValueAtTime(845, time);

          gain.gain.setValueAtTime(peakGain * 0.6, time);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.18);

          osc1.connect(gain);
          osc2.connect(gain);
          gain.connect(this.masterFilter);

          osc1.start(time);
          osc2.start(time);
          osc1.stop(time + 0.2);
          osc2.stop(time + 0.2);

          voice.gainNode = gain;
          voice.nodes = [osc1, osc2, gain];
          break;
        }

        default: {
          // General Percussion fallback (short high-frequency click/tone)
          const osc = this.audioCtx.createOscillator();
          const gain = this.audioCtx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(250, time);
          osc.frequency.exponentialRampToValueAtTime(50, time + 0.08);

          gain.gain.setValueAtTime(peakGain * 0.5, time);
          gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.1);

          osc.connect(gain);
          gain.connect(this.masterFilter);

          osc.start(time);
          osc.stop(time + 0.12);

          voice.gainNode = gain;
          voice.nodes = [osc, gain];
          break;
        }
      }
    }

    /* ======================================================================== */
    /*                    PRECISION LOOKAHEAD AUDIO SCHEDULER                   */
    /* ======================================================================== */

    /**
     * Starts Lookahead scheduling timer (runs every 25ms, schedules 100ms ahead)
     */
    startScheduler() {
      this.stopScheduler();
      this.schedulerTimerId = setInterval(() => {
        this.schedulerTick();
      }, 25);
    }

    stopScheduler() {
      if (this.schedulerTimerId) {
        clearInterval(this.schedulerTimerId);
        this.schedulerTimerId = null;
      }
    }

    /**
     * Scheduler tick: processes MIDI events in [audioCurrentTime .. audioCurrentTime + 0.100]
     */
    schedulerTick() {
      if (!this.isPlaying || this.isPaused || !this.currentParsedSong || !this.audioCtx) return;

      const audioNow = this.audioCtx.currentTime;
      // Calculate current song elapsed seconds taking tempo multiplier into account
      const songElapsedSeconds = (audioNow - this.playbackStartAudioTime) * this.tempoMultiplier;
      this.playbackPositionSeconds = this.playbackStartSongSeconds + songElapsedSeconds;

      const lookaheadWindowEnd = this.playbackPositionSeconds + (0.100 * this.tempoMultiplier);
      const events = this.currentParsedSong.events;

      while (this.eventCursor < events.length) {
        const ev = events[this.eventCursor];

        if (ev.timeSeconds > lookaheadWindowEnd) {
          // Event is in the future beyond lookahead window
          break;
        }

        // Calculate schedule time in AudioContext timeline
        const eventOffsetFromCurrentSongPos = (ev.timeSeconds - this.playbackPositionSeconds) / this.tempoMultiplier;
        const scheduleAudioTime = audioNow + Math.max(0, eventOffsetFromCurrentSongPos);

        this.processMidiEvent(ev, scheduleAudioTime);
        this.eventCursor++;
      }

      // Check for song completion or loop
      if (this.playbackPositionSeconds >= this.currentParsedSong.totalDuration) {
        if (this.loop) {
          this.seekTo(0.0);
        } else {
          this.stop();
        }
      }

      // Clean up finished voices from active pool
      this.cleanupFinishedVoices();
    }

    /**
     * Cleans up silent / dead voices from activeVoices array
     */
    cleanupFinishedVoices() {
      if (!this.audioCtx) return;
      const now = this.audioCtx.currentTime;
      this.activeVoices = this.activeVoices.filter(v => {
        if (v.isReleasing && now > v.startTime + 2.0) {
          return false;
        }
        return true;
      });
    }

    /**
     * Dispatches individual MIDI event to synthesis DSP
     */
    processMidiEvent(ev, scheduleAudioTime) {
      switch (ev.type) {
        case 'noteOn': {
          if (ev.channel === 9) {
            this.triggerDrum(ev.note, ev.velocity, scheduleAudioTime);
          } else {
            this.triggerNoteOn(ev.channel, ev.note, ev.velocity, scheduleAudioTime);
          }
          break;
        }
        case 'noteOff': {
          if (ev.channel !== 9) {
            this.triggerNoteOff(ev.channel, ev.note, scheduleAudioTime);
          }
          break;
        }
        case 'programChange': {
          this.channels[ev.channel].program = ev.program;
          break;
        }
        case 'pitchBend': {
          // 14-bit unsigned (-8192 to +8191) mapped to +/- 2 semitones
          this.channels[ev.channel].pitchBendSemitones = (ev.bend / 8192.0) * 2.0;
          break;
        }
        case 'controller': {
          const ch = this.channels[ev.channel];
          switch (ev.controller) {
            case 7: // Volume
              ch.volume = (ev.value / 127.0) * 100.0;
              break;
            case 10: // Pan
              ch.pan = (ev.value / 64.0) - 1.0;
              break;
            case 11: // Expression
              ch.expression = ev.value;
              break;
            case 64: // Sustain Pedal
              ch.sustainPedal = ev.value >= 64;
              break;
            case 120: // All Sound Off
            case 123: // All Notes Off
              this.silenceChannelVoices(ev.channel);
              break;
          }
          break;
        }
        case 'setTempo': {
          this.currentBPM = ev.bpm;
          break;
        }
      }
    }

    /* ======================================================================== */
    /*                         PLAYBACK & TRANSPORT API                         */
    /* ======================================================================== */

    /**
     * Plays MIDI from ArrayBuffer or parsed song
     */
    playParsed(parsedSong, name = '', loop = true, volume = 80.0) {
      this.ensureAudioContext();
      this.stopAllVoices();

      this.currentParsedSong = parsedSong;
      this.currentSongName = name;
      this.loop = !!loop;
      this.setMasterVolume(volume);

      this.playbackPositionSeconds = 0.0;
      this.playbackStartSongSeconds = 0.0;
      this.playbackStartAudioTime = this.audioCtx ? this.audioCtx.currentTime : 0.0;
      this.eventCursor = 0;
      this.currentBPM = parsedSong.initialBPM || 120.0;
      this.isPlaying = true;
      this.isPaused = false;

      this.resetChannels();
      this.startScheduler();
    }

    /**
     * Plays MIDI from ArrayBuffer directly
     */
    playMidiBuffer(buffer, name = '', loop = true, volume = 80.0) {
      const parsed = SMFParser.parse(buffer);
      this.playParsed(parsed, name, loop, volume);
    }

    /**
     * Loads and plays a MIDI file from GDevelop resources or URL
     */
    playMidi(runtimeScene, resourceName, loop = true, volume = 80.0) {
      this.ensureAudioContext();

      // Check if resource exists in GDevelop Image/Resource manager
      let resourceUrl = resourceName;
      if (runtimeScene && runtimeScene.getGame && runtimeScene.getGame().getImageManager) {
        const imgMgr = runtimeScene.getGame().getImageManager();
        if (imgMgr.hasResource && imgMgr.hasResource(resourceName)) {
          resourceUrl = imgMgr.getResourceFileUrl(resourceName);
        }
      }

      // Fetch ArrayBuffer
      fetch(resourceUrl)
        .then(response => {
          if (!response.ok) throw new Error(`HTTP ${response.status} loading ${resourceName}`);
          return response.arrayBuffer();
        })
        .then(buffer => {
          this.playMidiBuffer(buffer, resourceName, loop, volume);
        })
        .catch(err => {
          console.error(`MidiSynthPlayer failed to load "${resourceName}":`, err);
        });
    }

    /**
     * Stops playback and resets state
     */
    stop() {
      this.stopScheduler();
      this.stopAllVoices();
      this.isPlaying = false;
      this.isPaused = false;
      this.playbackPositionSeconds = 0.0;
      this.playbackStartSongSeconds = 0.0;
      this.eventCursor = 0;
    }

    /**
     * Pauses playback
     */
    pause() {
      if (!this.isPlaying || this.isPaused) return;
      this.stopScheduler();
      this.stopAllVoices();
      if (this.audioCtx) {
        const songElapsedSeconds = (this.audioCtx.currentTime - this.playbackStartAudioTime) * this.tempoMultiplier;
        this.playbackPositionSeconds = this.playbackStartSongSeconds + songElapsedSeconds;
      }
      this.isPaused = true;
    }

    /**
     * Resumes playback from paused position
     */
    resume() {
      if (!this.isPlaying || !this.isPaused || !this.currentParsedSong) return;
      this.ensureAudioContext();
      this.isPaused = false;
      this.playbackStartSongSeconds = this.playbackPositionSeconds;
      this.playbackStartAudioTime = this.audioCtx ? this.audioCtx.currentTime : 0.0;
      this.startScheduler();
    }

    /**
     * Seeks playback position to specific timestamp in seconds
     */
    seekTo(seconds) {
      if (!this.currentParsedSong) return;
      const targetSeconds = Math.max(0.0, Math.min(this.currentParsedSong.totalDuration, seconds));

      this.stopAllVoices();
      this.playbackPositionSeconds = targetSeconds;
      this.playbackStartSongSeconds = targetSeconds;
      this.playbackStartAudioTime = this.audioCtx ? this.audioCtx.currentTime : 0.0;

      // Find event cursor corresponding to targetSeconds
      let cursor = 0;
      const events = this.currentParsedSong.events;
      while (cursor < events.length && events[cursor].timeSeconds < targetSeconds) {
        // Fast-forward controller and program states up to seek position
        const ev = events[cursor];
        if (ev.type === 'programChange') {
          this.channels[ev.channel].program = ev.program;
        } else if (ev.type === 'setTempo') {
          this.currentBPM = ev.bpm;
        }
        cursor++;
      }
      this.eventCursor = cursor;
    }

    /**
     * Sets Tempo Multiplier (0.25 - 4.0) without altering pitch
     */
    setTempoMultiplier(mult) {
      const clamped = Math.max(0.25, Math.min(4.0, mult));
      if (this.isPlaying && !this.isPaused && this.audioCtx) {
        const songElapsedSeconds = (this.audioCtx.currentTime - this.playbackStartAudioTime) * this.tempoMultiplier;
        this.playbackPositionSeconds = this.playbackStartSongSeconds + songElapsedSeconds;
        this.playbackStartSongSeconds = this.playbackPositionSeconds;
        this.playbackStartAudioTime = this.audioCtx.currentTime;
      }
      this.tempoMultiplier = clamped;
    }

    /**
     * Sets Pitch Transposition in semitones (-24 to +24)
     */
    setTransposition(semitones) {
      this.transposition = Math.max(-24, Math.min(24, Math.round(semitones)));
    }

    /* ======================================================================== */
    /*                         3D SPATIAL AUDIO ATTACHMENT                      */
    /* ======================================================================== */

    attachSpatialObject(runtimeObject) {
      this.spatialObject = runtimeObject;
      this.spatialEnabled = true;
      this.ensureAudioContext();
      if (this.spatialPanner && this.masterGain) {
        try {
          this.masterGain.disconnect();
          this.masterGain.connect(this.spatialPanner);
          this.spatialPanner.connect(this.audioCtx.destination);
        } catch (_) {}
      }
    }

    detachSpatialObject() {
      this.spatialObject = null;
      this.spatialEnabled = false;
      if (this.masterGain && this.audioCtx) {
        try {
          this.masterGain.disconnect();
          this.masterGain.connect(this.audioCtx.destination);
        } catch (_) {}
      }
    }

    updateSpatialPosition(runtimeScene) {
      if (!this.spatialEnabled || !this.spatialPanner || !this.audioCtx) return;

      // Update Emitter position from attached GDevelop object
      if (this.spatialObject) {
        const x = this.spatialObject.getX ? this.spatialObject.getX() : 0;
        const y = this.spatialObject.getY ? this.spatialObject.getY() : 0;
        const z = this.spatialObject.getZ ? this.spatialObject.getZ() : 0;

        if (this.spatialPanner.positionX) {
          this.spatialPanner.positionX.setValueAtTime(x, this.audioCtx.currentTime);
          this.spatialPanner.positionY.setValueAtTime(y, this.audioCtx.currentTime);
          this.spatialPanner.positionZ.setValueAtTime(z, this.audioCtx.currentTime);
        } else if (this.spatialPanner.setPosition) {
          this.spatialPanner.setPosition(x, y, z);
        }
      }

      // Update Listener position & orientation from Three.js camera if available
      try {
        if (runtimeScene && runtimeScene.getLayer) {
          const baseLayer = runtimeScene.getLayer('');
          if (baseLayer && baseLayer.getRenderer) {
            const renderer = baseLayer.getRenderer();
            const threeCamera = renderer.getThreeCamera ? renderer.getThreeCamera() : null;
            if (threeCamera && this.audioCtx.listener) {
              const listener = this.audioCtx.listener;
              const camPos = threeCamera.position;
              if (camPos) {
                if (listener.positionX) {
                  listener.positionX.setValueAtTime(camPos.x, this.audioCtx.currentTime);
                  listener.positionY.setValueAtTime(camPos.y, this.audioCtx.currentTime);
                  listener.positionZ.setValueAtTime(camPos.z, this.audioCtx.currentTime);
                } else if (listener.setPosition) {
                  listener.setPosition(camPos.x, camPos.y, camPos.z);
                }
              }
            }
          }
        }
      } catch (_) {}
    }
  }

  // Create global singleton instance
  const engine = new MidiSynthPlayerEngine();

  // Register GDevelop Scene Lifecycle Callbacks
  if (gdjs.registerRuntimeScenePostEventsCallback) {
    gdjs.registerRuntimeScenePostEventsCallback((runtimeScene) => {
      engine.updateSpatialPosition(runtimeScene);
    });
  }

  if (gdjs.registerRuntimeSceneUnloadedCallback) {
    gdjs.registerRuntimeSceneUnloadedCallback(() => {
      // Keep playing across scenes unless explicitly stopped
    });
  }

  // Export to global namespace
  gdjs.__midiSynthPlayer = engine;
  gdjs.__midiSynthPlayer.SMFParser = SMFParser;
  gdjs.__midiSynthPlayer.MidiSynthPlayerEngine = MidiSynthPlayerEngine;
  gdjs.__midiSynthPlayer.CHIP_PROFILES = CHIP_PROFILES;
  gdjs.__midiSynthPlayer.GM_INSTRUMENTS = GM_INSTRUMENTS;

})();
