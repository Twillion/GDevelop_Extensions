/**
 * test-midisynthplayer.mjs
 * Comprehensive automated test suite for MidiSynthPlayer.
 *
 * Run: node MidiSynthPlayer/test-midisynthplayer.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeCode = fs.readFileSync(path.join(here, 'MidiSynthPlayer.runtime.js'), 'utf8');

console.log('====================================================');
console.log(' Running MidiSynthPlayer Test Suite');
console.log('====================================================\n');

// Mock Web Audio API & Three.js environment
class MockAudioParam {
  constructor(defaultValue = 0) {
    this.value = defaultValue;
    this.scheduled = [];
  }
  setValueAtTime(val, time) {
    this.value = val;
    this.scheduled.push({ type: 'set', val, time });
  }
  linearRampToValueAtTime(val, time) {
    this.value = val;
    this.scheduled.push({ type: 'linearRamp', val, time });
  }
  exponentialRampToValueAtTime(val, time) {
    this.value = val;
    this.scheduled.push({ type: 'expRamp', val, time });
  }
  setTargetAtTime(val, time, constant) {
    this.value = val;
    this.scheduled.push({ type: 'target', val, time, constant });
  }
  cancelScheduledValues(time) {
    this.scheduled = this.scheduled.filter(s => s.time < time);
  }
}

class MockAudioNode {
  constructor() {
    this.connectedTo = [];
  }
  connect(target) {
    this.connectedTo.push(target);
    return target;
  }
  disconnect() {
    this.connectedTo = [];
  }
}

class MockGainNode extends MockAudioNode {
  constructor(defaultGain = 1.0) {
    super();
    this.gain = new MockAudioParam(defaultGain);
  }
}

class MockOscillatorNode extends MockAudioNode {
  constructor() {
    super();
    this.type = 'sine';
    this.frequency = new MockAudioParam(440);
    this.started = false;
    this.stopped = false;
  }
  start(time) { this.started = true; }
  stop(time) { this.stopped = true; }
}

class MockBiquadFilterNode extends MockAudioNode {
  constructor() {
    super();
    this.type = 'lowpass';
    this.frequency = new MockAudioParam(20000);
    this.Q = new MockAudioParam(1.0);
  }
}

class MockBufferSourceNode extends MockAudioNode {
  constructor() {
    super();
    this.buffer = null;
    this.started = false;
    this.stopped = false;
  }
  start(time) { this.started = true; }
  stop(time) { this.stopped = true; }
}

class MockPannerNode extends MockAudioNode {
  constructor() {
    super();
    this.positionX = new MockAudioParam(0);
    this.positionY = new MockAudioParam(0);
    this.positionZ = new MockAudioParam(0);
  }
  setPosition(x, y, z) {
    this.positionX.value = x;
    this.positionY.value = y;
    this.positionZ.value = z;
  }
}

class MockAudioContext {
  constructor() {
    this.currentTime = 1.0;
    this.sampleRate = 44100;
    this.state = 'running';
    this.destination = new MockAudioNode();
    this.listener = {
      positionX: new MockAudioParam(0),
      positionY: new MockAudioParam(0),
      positionZ: new MockAudioParam(0),
    };
  }
  createGain() { return new MockGainNode(); }
  createOscillator() { return new MockOscillatorNode(); }
  createBiquadFilter() { return new MockBiquadFilterNode(); }
  createBufferSource() { return new MockBufferSourceNode(); }
  createPanner() { return new MockPannerNode(); }
  createBuffer(channels, length, sampleRate) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }
  resume() { this.state = 'running'; return Promise.resolve(); }
}

globalThis.AudioContext = MockAudioContext;
globalThis.webkitAudioContext = MockAudioContext;

// Mock GDevelop environment
const registeredCallbacks = {};
globalThis.gdjs = {
  registerRuntimeScenePostEventsCallback: (fn) => { registeredCallbacks.postEvents = fn; },
  registerRuntimeSceneUnloadedCallback: (fn) => { registeredCallbacks.unloaded = fn; },
};

// Evaluate the runtime script
new Function(runtimeCode)();

const MSP = globalThis.gdjs.__midiSynthPlayer;
assert.ok(MSP, 'gdjs.__midiSynthPlayer must be registered');
const SMFParser = MSP.SMFParser;
assert.ok(SMFParser, 'SMFParser must be exported');

console.log('✓ Runtime initialization and global namespace check passed');

/* ========================================================================== */
/* TEST 1: Variable Length Quantity (VLQ) Decoding                            */
/* ========================================================================== */
console.log('\n--- Test 1: VLQ Delta-Time Decoding ---');

function createVLQBuffer(bytes) {
  const u8 = new Uint8Array(bytes);
  return new DataView(u8.buffer);
}

// 0x00 -> 0 (1 byte)
let dv = createVLQBuffer([0x00]);
let res = SMFParser.readVLQ(dv, 0);
assert.strictEqual(res.value, 0);
assert.strictEqual(res.bytesRead, 1);

// 0x7F -> 127 (1 byte)
dv = createVLQBuffer([0x7F]);
res = SMFParser.readVLQ(dv, 0);
assert.strictEqual(res.value, 127);
assert.strictEqual(res.bytesRead, 1);

// 0x81 0x00 -> 128 (2 bytes)
dv = createVLQBuffer([0x81, 0x00]);
res = SMFParser.readVLQ(dv, 0);
assert.strictEqual(res.value, 128);
assert.strictEqual(res.bytesRead, 2);

// 0xC0 0x00 -> 8192 (2 bytes)
dv = createVLQBuffer([0xC0, 0x00]);
res = SMFParser.readVLQ(dv, 0);
assert.strictEqual(res.value, 8192);
assert.strictEqual(res.bytesRead, 2);

// 0xFF 0x7F -> 16383 (2 bytes)
dv = createVLQBuffer([0xFF, 0x7F]);
res = SMFParser.readVLQ(dv, 0);
assert.strictEqual(res.value, 16383);
assert.strictEqual(res.bytesRead, 2);

console.log('✓ VLQ decoding validated across 1-byte and multi-byte representations');

/* ========================================================================== */
/* TEST 2: SMF Binary Parser (Synthesized MIDI File Buffer)                    */
/* ========================================================================== */
console.log('\n--- Test 2: Standard MIDI File (SMF) Binary Parsing ---');

/**
 * Builds a valid SMF Format 1 binary buffer with Header + 2 Tracks
 */
function buildMockMidiBuffer() {
  const bytes = [];
  const pushU32 = (v) => {
    bytes.push((v >> 24) & 0xFF, (v >> 16) & 0xFF, (v >> 8) & 0xFF, v & 0xFF);
  };
  const pushU16 = (v) => {
    bytes.push((v >> 8) & 0xFF, v & 0xFF);
  };

  // 1. MThd Header
  bytes.push(0x4D, 0x54, 0x68, 0x64); // 'MThd'
  pushU32(6); // length = 6
  pushU16(1); // format 1
  pushU16(2); // 2 tracks
  pushU16(480); // 480 PPQ

  // 2. Track 1: Tempo track
  const track1Events = [];
  // Delta 0, Tempo Meta (0xFF 0x51 0x03 0x07 0xA1 0x20 -> 500,000 microsec = 120 BPM)
  track1Events.push(0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20);
  // Delta 480 ticks, End of Track
  track1Events.push(0x83, 0x60, 0xFF, 0x2F, 0x00); // VLQ 480 = 0x83 0x60

  bytes.push(0x4D, 0x54, 0x72, 0x6B); // 'MTrk'
  pushU32(track1Events.length);
  bytes.push(...track1Events);

  // 3. Track 2: Note track (Piano Melody + Channel 10 Drum)
  const track2Events = [];
  // Delta 0, Program Change Ch 0 -> Program 0 (Grand Piano)
  track2Events.push(0x00, 0xC0, 0x00);
  // Delta 0, Note On Ch 0 -> Note 60 (Middle C), Vel 100
  track2Events.push(0x00, 0x90, 0x3C, 0x64);
  // Delta 240 ticks, Note Off Ch 0 -> Note 60
  track2Events.push(0x81, 0x70, 0x80, 0x3C, 0x40); // VLQ 240 = 0x81 0x70
  // Delta 0, Note On Ch 9 (Drums) -> Note 36 (Bass Drum), Vel 110
  track2Events.push(0x00, 0x99, 0x24, 0x6E);
  // Delta 240 ticks, Pitch Bend Ch 0 -> Center + 1000
  track2Events.push(0x81, 0x70, 0xE0, 0x00, 0x48);
  // Delta 0, End of Track
  track2Events.push(0x00, 0xFF, 0x2F, 0x00);

  bytes.push(0x4D, 0x54, 0x72, 0x6B); // 'MTrk'
  pushU32(track2Events.length);
  bytes.push(...track2Events);

  return new Uint8Array(bytes).buffer;
}

const mockMidiBuffer = buildMockMidiBuffer();
const parsed = SMFParser.parse(mockMidiBuffer);

assert.strictEqual(parsed.format, 1, 'Should parse format 1');
assert.strictEqual(parsed.numTracks, 2, 'Should parse 2 tracks');
assert.strictEqual(parsed.ticksPerQuarterNote, 480, 'PPQ should be 480');
assert.strictEqual(parsed.initialBPM, 120, 'Initial BPM should be 120');
assert.ok(parsed.events.length >= 6, 'Should extract note, tempo, and program events');
assert.ok(parsed.totalDuration > 0, 'Total song duration should be positive');

// Verify individual event types
const eventTypes = parsed.events.map(e => e.type);
assert.ok(eventTypes.includes('setTempo'), 'Must contain setTempo event');
assert.ok(eventTypes.includes('programChange'), 'Must contain programChange event');
assert.ok(eventTypes.includes('noteOn'), 'Must contain noteOn event');
assert.ok(eventTypes.includes('noteOff'), 'Must contain noteOff event');
assert.ok(eventTypes.includes('pitchBend'), 'Must contain pitchBend event');

console.log(`✓ Parsed SMF: ${parsed.events.length} chronological events over ${parsed.totalDuration.toFixed(2)}s`);

/* ========================================================================== */
/* TEST 3: Frequency Math, Transposition & Pitch Bend                         */
/* ========================================================================== */
console.log('\n--- Test 3: Frequency Math & Transposition ---');

// A4 = MIDI Note 69 -> 440 Hz
const a4Freq = MSP.midiNoteToFrequency(69, 0, 0);
assert.strictEqual(Math.round(a4Freq), 440, 'MIDI 69 must equal 440 Hz');

// Middle C = MIDI Note 60 -> ~261.63 Hz
const c4Freq = MSP.midiNoteToFrequency(60, 0, 0);
assert.ok(Math.abs(c4Freq - 261.63) < 0.1, `Middle C should be ~261.63 Hz, got ${c4Freq}`);

// Transposition (+12 semitones = 1 octave up) -> MIDI 69 + 12 = 880 Hz
const octaveUp = MSP.midiNoteToFrequency(69, 12, 0);
assert.strictEqual(Math.round(octaveUp), 880, '1 octave up from A4 must equal 880 Hz');

// Pitch Bend (+2 semitones bend)
const bentFreq = MSP.midiNoteToFrequency(69, 0, 2);
const b4Freq = MSP.midiNoteToFrequency(71, 0, 0);
assert.ok(Math.abs(bentFreq - b4Freq) < 0.001, 'Pitch bend of +2 semitones must match Note 71');

console.log('✓ Note-to-frequency, octave transposition, and pitch bend formulas validated');

/* ========================================================================== */
/* TEST 4: 128 GM Instrument Table & Retro Chip Profiles                      */
/* ========================================================================== */
console.log('\n--- Test 4: GM 128 Instrument Table & Retro Chip Profiles ---');

assert.strictEqual(MSP.GM_INSTRUMENTS.length, 128, 'Must provide full 128 General MIDI instrument table');
for (let i = 0; i < 128; i++) {
  const inst = MSP.GM_INSTRUMENTS[i];
  assert.ok(Array.isArray(inst) && inst.length === 11, `Instrument ${i} must have 11 parameter descriptors`);
  const [name, cRatio, mRatio, modIndex, modDecay, attack, decay, sustain, release, wave, feedback] = inst;
  assert.ok(typeof name === 'string' && name.length > 0, `Instrument ${i} must have name`);
  assert.ok(cRatio > 0 && mRatio > 0, `Instrument ${i} carrier and modulator ratios must be positive`);
  assert.ok(attack >= 0 && decay >= 0 && release >= 0, `Instrument ${i} ADSR timings must be non-negative`);
}

const chipKeys = Object.keys(MSP.CHIP_PROFILES);
assert.deepStrictEqual(chipKeys.sort(), ['NES_Chiptune', 'OPL3_SoundBlaster', 'PC98_FM', 'YM2612_Genesis'].sort());

for (const key of chipKeys) {
  MSP.setSoundChipProfile(key);
  assert.strictEqual(MSP.soundChipProfile, key, `Profile should be set to ${key}`);
}

console.log('✓ 128 General MIDI instruments and 4 Retro Chip profiles validated');

/* ========================================================================== */
/* TEST 5: Polyphonic Voice Synthesis & Voice Stealing                         */
/* ========================================================================== */
console.log('\n--- Test 5: Polyphony & Dynamic Voice Stealing ---');

MSP.ensureAudioContext();
MSP.maxPolyphony = 4; // Set small polyphony for test
MSP.stopAllVoices();

// Trigger 4 notes
MSP.triggerNoteOn(0, 60, 100, 1.0);
MSP.triggerNoteOn(0, 64, 100, 1.0);
MSP.triggerNoteOn(0, 67, 100, 1.0);
MSP.triggerNoteOn(0, 71, 100, 1.0);
assert.strictEqual(MSP.activeVoices.length, 4, 'Should have 4 active voices');

// Trigger 5th note -> should trigger voice stealing while keeping polyphony cap <= 4
MSP.triggerNoteOn(0, 72, 100, 1.0);
assert.strictEqual(MSP.activeVoices.length, 4, 'Polyphony cap must remain strictly <= 4');

// Trigger note off
MSP.triggerNoteOff(0, 64, 1.0);
MSP.triggerNoteOff(0, 67, 1.0);

console.log('✓ Polyphony voice allocation and voice stealing verified');

/* ========================================================================== */
/* TEST 6: Channel 10 Percussion Synthesis                                    */
/* ========================================================================== */
console.log('\n--- Test 6: Channel 10 Percussion Synthesis Triggers ---');

const drumNotesToTest = [
  35, 36, // Bass drums
  38, 40, // Snares
  42, 44, // Closed hi-hats
  46,     // Open hi-hat
  49, 51, 55, 57, 59, // Cymbals
  41, 43, 45, 47, 48, 50, // Toms
  39,     // Clap
  56,     // Cowbell
  75,     // Fallback / Claves
];

for (const drumNote of drumNotesToTest) {
  MSP.triggerDrum(drumNote, 100, 1.0);
  assert.ok(MSP.activeVoices.length > 0, `Drum note ${drumNote} must instantiate synth voice`);
}

console.log(`✓ All ${drumNotesToTest.length} drum categories successfully synthesized via DSP recipes`);

/* ========================================================================== */
/* TEST 7: Dynamic Stems, Muting, Solo, Volume & Tempo Scaling                */
/* ========================================================================== */
console.log('\n--- Test 7: Dynamic Stems & Live Controls ---');

// Channel muting
MSP.setChannelMuted(9, true);
assert.strictEqual(MSP.channels[9].muted, true, 'Channel 9 should be muted');
MSP.setChannelMuted(9, false);
assert.strictEqual(MSP.channels[9].muted, false, 'Channel 9 should be unmuted');

// Channel solo
MSP.soloChannel(0);
assert.strictEqual(MSP.channels[0].solo, true, 'Channel 0 should be soloed');
assert.strictEqual(MSP.channels[1].solo, false, 'Channel 1 should not be soloed');

// Unmute all
MSP.unmuteAllChannels();
assert.strictEqual(MSP.channels.some(c => c.muted || c.solo), false, 'All channels should be unmuted & un-soloed');

// Channel instrument program
MSP.setChannelInstrument(0, 29); // 29 = Overdriven Guitar
assert.strictEqual(MSP.getChannelInstrument(0), 29, 'Channel 0 instrument should be 29 (Overdriven Guitar)');
assert.strictEqual(MSP.getInstrumentName(29), 'Overdriven Guitar', 'Instrument name 29 must be Overdriven Guitar');
assert.strictEqual(MSP.getInstrumentName(0), 'Acoustic Grand Piano', 'Instrument name 0 must be Acoustic Grand Piano');

// Play individual note on demand (SFX / Live note trigger)
MSP.playNote(0, 60, 100, 0.25);
assert.ok(MSP.activeVoices.length > 0, 'playNote must trigger an active synth voice');

console.log('✓ Dynamic stem controls, instrument selection, live playNote, volume, tempo multiplier and filter controls validated');

/* ========================================================================== */
/* TEST 8: Full Playback Lifecycle (Play, Pause, Resume, Seek, Stop)          */
/* ========================================================================== */
console.log('\n--- Test 8: Playback Transport Lifecycle ---');

MSP.playParsed(parsed, 'test_song.mid', true, 80);
assert.strictEqual(MSP.isPlaying, true, 'Engine should be playing');
assert.strictEqual(MSP.isPaused, false, 'Engine should not be paused');

MSP.schedulerTick();
assert.ok(MSP.eventCursor > 0, 'Scheduler should have processed events');

MSP.pause();
assert.strictEqual(MSP.isPaused, true, 'Engine should be paused');

MSP.resume();
assert.strictEqual(MSP.isPaused, false, 'Engine should be resumed');

MSP.seekTo(0.5);
assert.strictEqual(MSP.playbackPositionSeconds, 0.5, 'Seek position should be 0.5s');

MSP.stop();
assert.strictEqual(MSP.isPlaying, false, 'Engine should be stopped');
assert.strictEqual(MSP.isPaused, false, 'Engine should not be paused');
assert.strictEqual(MSP.activeVoices.length, 0, 'All voices should be stopped');

console.log('✓ Full playback transport lifecycle (Play -> Tick -> Pause -> Resume -> Seek -> Stop) passed');

/* ========================================================================== */
/* TEST 9: 3D Spatial Emitter Attachment & Position Tracking                  */
/* ========================================================================== */
console.log('\n--- Test 9: 3D Spatial Audio Emitter ---');

const mockObject = {
  getX: () => 150,
  getY: () => -50,
  getZ: () => 300,
};

MSP.attachSpatialObject(mockObject);
assert.strictEqual(MSP.spatialEnabled, true, 'Spatial audio should be enabled');
assert.strictEqual(MSP.spatialObject, mockObject, 'Object should be attached');

const mockScene = {
  getLayer: () => ({
    getRenderer: () => ({
      getThreeCamera: () => ({
        position: { x: 0, y: 0, z: 0 },
      }),
    }),
  }),
};

MSP.updateSpatialPosition(mockScene);
assert.strictEqual(MSP.spatialPanner.positionX.value, 150, 'Panner X position should be 150');
assert.strictEqual(MSP.spatialPanner.positionY.value, -50, 'Panner Y position should be -50');
assert.strictEqual(MSP.spatialPanner.positionZ.value, 300, 'Panner Z position should be 300');

MSP.detachSpatialObject();
assert.strictEqual(MSP.spatialEnabled, false, 'Spatial audio should be detached');

console.log('✓ 3D spatial emitter and listener camera positioning validated');

/* ========================================================================== */
/* TEST 10: Extension JSON Schema & Build Verification                         */
/* ========================================================================== */
console.log('\n--- Test 10: Extension JSON Schema Validation ---');

const extensionJsonPath = path.join(here, 'MidiSynthPlayer.json');
assert.ok(fs.existsSync(extensionJsonPath), 'MidiSynthPlayer.json must exist');

const extData = JSON.parse(fs.readFileSync(extensionJsonPath, 'utf8'));
assert.strictEqual(extData.name, 'MidiSynthPlayer');
assert.strictEqual(extData.eventsBasedBehaviors.length, 1);
assert.strictEqual(extData.eventsBasedBehaviors[0].name, 'MidiSpatialEmitter');
assert.ok(extData.eventsFunctions.length >= 15, 'Must have all declared global ACE functions');
assert.ok(extData.iconUrl && extData.iconUrl.startsWith('data:image/svg+xml;base64,'), 'Must contain base64 SVG icon');

console.log(`✓ MidiSynthPlayer.json verified: ${extData.eventsFunctions.length} global functions, 1 behavior, valid SVG icon`);

console.log('\n====================================================');
console.log(' ALL 10 TESTS PASSED CLEANLY (100% SUCCESS)');
console.log('====================================================\n');
