/**
 * build-extension.mjs
 * Compiles MidiSynthPlayer.json from the runtime engine + behavior and function declarations.
 *
 * Run: node MidiSynthPlayer/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'MidiSynthPlayer.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const NS = 'gdjs.__midiSynthPlayer';

/* ------------------------------------------------------------- Parameters & Helpers */

const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior' },
];

const num = (name, description, value = '') => ({
  name, type: 'expression', description, ...(value !== '' ? { defaultValue: String(value) } : {}),
});
const str = (name, description, value = '') => ({
  name, type: 'string', description, ...(value !== '' ? { defaultValue: String(value) } : {}),
});
const bool = (name, description, value = '') => ({
  name, type: 'yesorno', description, ...(value !== '' ? { defaultValue: String(value) } : {}),
});
const choice = (name, description, options) => ({
  name, type: 'stringWithSelector', description,
  supplementaryInformation: JSON.stringify(options),
});

const prop = (name, type, label, description, value, extra = {}) => ({
  name, type, value, label, description, ...extra,
});

/* ------------------------------------------------------------- Preambles & Code Generators */

const ev = (inlineCode, { withRuntime = false } = {}) => [{
  type: 'BuiltinCommonInstructions::JsCode',
  inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
  parameterObjects: 'Object',
}];

const evFree = (inlineCode, { withRuntime = false } = {}) => [{
  type: 'BuiltinCommonInstructions::JsCode',
  inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
}];

const BEHAVIOR_PREAMBLE = `const __mspObjects = eventsFunctionContext.getObjects("Object");
const object = __mspObjects.length ? __mspObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const MSP = ${NS};
`;

const fn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name,
  fullName,
  sentence,
  description,
  functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters: [...OB, ...parameters],
  events: ev(BEHAVIOR_PREAMBLE + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

const freeFn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name,
  fullName,
  sentence,
  description,
  functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters,
  events: evFree((opts.withRuntime ? runtime + '\n' : '') + `if (!${NS}) return;\nconst MSP = ${NS};\n` + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

/* ========================================================= Sound Chip Choices */

const CHIP_CHOICES = [
  'OPL3_SoundBlaster',
  'YM2612_Genesis',
  'PC98_FM',
  'NES_Chiptune',
];

/* ========================================================= Behavior Definition */

const behavior = {
  name: 'MidiSpatialEmitter',
  fullName: '3D Spatial MIDI Emitter',
  description: 'Anchors zero-sample procedural MIDI soundtrack synthesis to this object in 3D/2D space with real-time distance attenuation.',
  objectType: '',
  quickCustomizationVisibility: 'visible',
  propertyDescriptors: [
    prop('MasterVolume', 'Number', 'Master Volume (0-100)', 'Initial output volume for synthesized soundtrack.', '80'),
    prop('SoundChipProfile', 'Choice', 'Sound Chip Profile', 'Aesthetic synthesis flavor (OPL3 DOS, Genesis FM, PC98 FM, NES Chiptune).', 'OPL3_SoundBlaster', {
      extraInformation: CHIP_CHOICES,
    }),
    prop('MaxPolyphony', 'Number', 'Max Voice Polyphony', 'Maximum simultaneous active synthesizer voices.', '32'),
    prop('LowpassCutoff', 'Number', 'Master Filter Cutoff (Hz)', 'Master resonant lowpass filter cutoff frequency.', '20000'),
    prop('FilterResonance', 'Number', 'Filter Resonance (Q)', 'Filter resonance peak.', '1.0'),
    prop('AutoPlayMidi', 'String', 'Auto-play MIDI File', 'Optional MIDI file name or URL to play on scene start.', ''),
    prop('Loop', 'Boolean', 'Loop Playback', 'Loop MIDI soundtrack continuously.', 'true'),
  ],
  eventsFunctions: [
    // Lifecycle: onCreated
    {
      name: 'onCreated',
      fullName: 'On Behavior Created',
      sentence: '',
      description: 'Initializes spatial emitter node.',
      functionType: 'Action',
      private: true,
      parameters: [...OB],
      events: ev(
        BEHAVIOR_PREAMBLE +
        `MSP.attachSpatialObject(object);
const chip = behavior._getSoundChipProfile ? behavior._getSoundChipProfile() : 'OPL3_SoundBlaster';
MSP.setSoundChipProfile(chip);
const vol = behavior._getMasterVolume ? behavior._getMasterVolume() : 80.0;
MSP.setMasterVolume(vol);
const autoPlay = behavior._getAutoPlayMidi ? behavior._getAutoPlayMidi() : '';
const loop = behavior._getLoop ? behavior._getLoop() : true;
if (autoPlay && autoPlay.length > 0) {
  MSP.playMidi(runtimeScene, autoPlay, loop, vol);
}`,
        { withRuntime: true }
      ),
    },
    // Lifecycle: onDestroy
    {
      name: 'onDestroy',
      fullName: 'On Behavior Destroyed',
      sentence: '',
      description: 'Detaches spatial emitter node.',
      functionType: 'Action',
      private: true,
      parameters: [...OB],
      events: ev(
        BEHAVIOR_PREAMBLE +
        `MSP.detachSpatialObject();`
      ),
    },
    // Behavior Action: Play
    fn(
      'PlayMidiOnObject',
      'Play MIDI on Object',
      'Play MIDI file _PARAM2_ on _PARAM0_ (Loop: _PARAM3_, Volume: _PARAM4_)',
      'Plays a MIDI file centered spatially on this object.',
      'Action',
      [
        str('MidiFile', 'MIDI File Resource or URL'),
        bool('Loop', 'Loop playback', 'true'),
        num('Volume', 'Volume (0-100)', '80'),
      ],
      `MSP.attachSpatialObject(object);
const file = eventsFunctionContext.getArgument("MidiFile");
const loop = eventsFunctionContext.getArgument("Loop");
const vol = eventsFunctionContext.getArgument("Volume");
MSP.playMidi(runtimeScene, file, loop, vol);`,
      { group: '3D Spatial MIDI' }
    ),
  ],
};

/* ========================================================= Global Extension Functions */

const globalFunctions = [
  // --- Transport & Playback Actions ---
  freeFn(
    'PlayMidi',
    'Play MIDI Soundtrack',
    'Play MIDI file _PARAM0_ (Loop: _PARAM1_, Volume: _PARAM2_)',
    'Starts real-time algorithmic synthesis playback of a standard .mid soundtrack.',
    'Action',
    [
      str('MidiFile', 'MIDI File Resource or URL'),
      bool('Loop', 'Loop playback', 'true'),
      num('Volume', 'Output Volume (0-100)', '80'),
    ],
    `const file = eventsFunctionContext.getArgument("MidiFile");
const loop = eventsFunctionContext.getArgument("Loop");
const vol = eventsFunctionContext.getArgument("Volume");
MSP.playMidi(runtimeScene, file, loop, vol);`,
    { group: 'Playback Control', withRuntime: true }
  ),

  freeFn(
    'StopMidi',
    'Stop MIDI Soundtrack',
    'Stop MIDI playback',
    'Immediately stops MIDI music and releases all active synthesizer voices.',
    'Action',
    [],
    `MSP.stop();`,
    { group: 'Playback Control' }
  ),

  freeFn(
    'PauseMidi',
    'Pause MIDI Soundtrack',
    'Pause MIDI playback',
    'Pauses MIDI music at current position.',
    'Action',
    [],
    `MSP.pause();`,
    { group: 'Playback Control' }
  ),

  freeFn(
    'ResumeMidi',
    'Resume MIDI Soundtrack',
    'Resume MIDI playback',
    'Resumes MIDI music from paused position.',
    'Action',
    [],
    `MSP.resume();`,
    { group: 'Playback Control' }
  ),

  freeFn(
    'SeekMidi',
    'Seek MIDI Playback',
    'Seek MIDI playback to _PARAM0_ seconds',
    'Jumps to a specific timestamp in the MIDI song.',
    'Action',
    [num('Seconds', 'Position in Seconds')],
    `const sec = eventsFunctionContext.getArgument("Seconds");
MSP.seekTo(sec);`,
    { group: 'Playback Control' }
  ),

  freeFn(
    'SetMasterVolume',
    'Set MIDI Master Volume',
    'Set MIDI master volume to _PARAM0_',
    'Sets global synthesizer output volume (0 - 100).',
    'Action',
    [num('Volume', 'Volume (0 - 100)', '80')],
    `const vol = eventsFunctionContext.getArgument("Volume");
MSP.setMasterVolume(vol);`,
    { group: 'Playback Control' }
  ),

  // --- Dynamic Stems & Channels ---
  freeFn(
    'SetChannelMuted',
    'Set MIDI Channel Muted',
    'Set MIDI channel _PARAM0_ muted: _PARAM1_',
    'Mutes or unmutes a specific MIDI channel (0-15, Channel 9 is Drums) for dynamic interactive combat/stealth stems.',
    'Action',
    [
      num('Channel', 'Channel Index (0-15, 9=Drums)', '9'),
      bool('Muted', 'Mute Channel', 'true'),
    ],
    `const ch = eventsFunctionContext.getArgument("Channel");
const muted = eventsFunctionContext.getArgument("Muted");
MSP.setChannelMuted(Math.floor(ch), muted);`,
    { group: 'Dynamic Interactive Stems' }
  ),

  freeFn(
    'SetChannelVolume',
    'Set MIDI Channel Volume',
    'Set MIDI channel _PARAM0_ volume to _PARAM1_',
    'Adjusts individual instrument channel volume (0 - 100).',
    'Action',
    [
      num('Channel', 'Channel Index (0-15)', '0'),
      num('Volume', 'Volume (0 - 100)', '100'),
    ],
    `const ch = eventsFunctionContext.getArgument("Channel");
const vol = eventsFunctionContext.getArgument("Volume");
MSP.setChannelVolume(Math.floor(ch), vol);`,
    { group: 'Dynamic Interactive Stems' }
  ),

  freeFn(
    'SoloChannel',
    'Solo MIDI Channel',
    'Solo MIDI channel _PARAM0_',
    'Mutes all channels except the selected channel.',
    'Action',
    [num('Channel', 'Channel Index (0-15)', '0')],
    `const ch = eventsFunctionContext.getArgument("Channel");
MSP.soloChannel(Math.floor(ch));`,
    { group: 'Dynamic Interactive Stems' }
  ),

  freeFn(
    'UnmuteAllChannels',
    'Unmute All MIDI Channels',
    'Unmute all MIDI channels',
    'Restores all 16 MIDI channels to full playback.',
    'Action',
    [],
    `MSP.unmuteAllChannels();`,
    { group: 'Dynamic Interactive Stems' }
  ),

  freeFn(
    'SetChannelInstrument',
    'Set MIDI Channel Instrument',
    'Set MIDI channel _PARAM0_ instrument to _PARAM1_',
    'Sets the General MIDI instrument program number (0-127) for a specific channel.',
    'Action',
    [
      num('Channel', 'Channel Index (0-15)', '0'),
      num('Program', 'Instrument Program Number (0-127, e.g. 0=Piano, 29=Distortion Guitar, 33=Finger Bass)', '0'),
    ],
    `const ch = eventsFunctionContext.getArgument("Channel");
const prog = eventsFunctionContext.getArgument("Program");
MSP.setChannelInstrument(Math.floor(ch), prog);`,
    { group: 'Dynamic Interactive Stems' }
  ),

  freeFn(
    'PlayNote',
    'Play Note / Sound Effect',
    'Play note _PARAM1_ on channel _PARAM0_ (Velocity: _PARAM2_, Duration: _PARAM3_ s)',
    'Triggers an algorithmic synthesizer note or drum on demand for procedural sound effects, jingles, or live gameplay.',
    'Action',
    [
      num('Channel', 'Channel Index (0-15, 9=Drums)', '0'),
      num('Note', 'MIDI Note Number (0-127, Middle C = 60, Kick = 36)', '60'),
      num('Velocity', 'Velocity (1-127)', '100'),
      num('Duration', 'Duration in Seconds', '0.5'),
    ],
    `const ch = eventsFunctionContext.getArgument("Channel");
const note = eventsFunctionContext.getArgument("Note");
const vel = eventsFunctionContext.getArgument("Velocity");
const dur = eventsFunctionContext.getArgument("Duration");
MSP.playNote(ch, note, vel, dur);`,
    { group: 'Dynamic Interactive Stems' }
  ),

  // --- Live Tempo, Pitch, Filter & Profiles ---
  freeFn(
    'SetTempoMultiplier',
    'Set MIDI Tempo Multiplier',
    'Set MIDI tempo multiplier to _PARAM0_',
    'Dynamically speeds up or slows down playback without altering pitch (0.25 - 4.0).',
    'Action',
    [num('Multiplier', 'Tempo Multiplier (e.g. 1.25 for +25% speed)', '1.0')],
    `const mult = eventsFunctionContext.getArgument("Multiplier");
MSP.setTempoMultiplier(mult);`,
    { group: 'Live Effects & Modulation' }
  ),

  freeFn(
    'Transpose',
    'Transpose MIDI Playback',
    'Transpose MIDI playback by _PARAM0_ semitones',
    'Shifts musical key in real-time (-24 to +24 semitones) on the fly.',
    'Action',
    [num('Semitones', 'Pitch Transposition (+2 for whole step, -12 for octave down)', '0')],
    `const semi = eventsFunctionContext.getArgument("Semitones");
MSP.setTransposition(semi);`,
    { group: 'Live Effects & Modulation' }
  ),

  freeFn(
    'SetLowpassCutoff',
    'Set Lowpass Filter Cutoff',
    'Set master lowpass filter cutoff to _PARAM0_ Hz',
    'Muffles or opens music brightness (e.g. 800 Hz for underwater / low health).',
    'Action',
    [num('CutoffHz', 'Cutoff Frequency in Hz (20 - 20000)', '20000')],
    `const hz = eventsFunctionContext.getArgument("CutoffHz");
MSP.setLowpassCutoff(hz);`,
    { group: 'Live Effects & Modulation' }
  ),

  freeFn(
    'SetFilterResonance',
    'Set Filter Resonance',
    'Set master filter resonance to _PARAM0_',
    'Sets master filter resonance Q peak (0.1 - 25.0).',
    'Action',
    [num('Resonance', 'Resonance Q (0.1 - 25.0)', '1.0')],
    `const q = eventsFunctionContext.getArgument("Resonance");
MSP.setFilterResonance(q);`,
    { group: 'Live Effects & Modulation' }
  ),

  freeFn(
    'SetSoundChipProfile',
    'Set Sound Chip Profile',
    'Set sound chip profile to _PARAM0_',
    'Switches synthesizer retro sound flavor (OPL3 DOS, Sega Genesis FM, PC-98, NES Chiptune).',
    'Action',
    [choice('Profile', 'Sound Chip Profile', CHIP_CHOICES)],
    `const prof = eventsFunctionContext.getArgument("Profile");
MSP.setSoundChipProfile(prof);`,
    { group: 'Live Effects & Modulation' }
  ),

  freeFn(
    'AttachSpatialObject',
    'Attach 3D Spatial Emitter',
    'Attach 3D spatial emitter to object _PARAM0_',
    'Anchors MIDI soundtrack synthesis to a 3D/2D object in space with distance attenuation.',
    'Action',
    [{ name: 'Object', type: 'object', description: '3D/2D Object to attach emitter to' }],
    `const objs = eventsFunctionContext.getObjects("Object");
if (objs.length > 0) {
  MSP.attachSpatialObject(objs[0]);
}`,
    { group: '3D Spatial Audio' }
  ),

  freeFn(
    'DetachSpatial',
    'Detach 3D Spatial Emitter',
    'Detach 3D spatial emitter',
    'Returns MIDI soundtrack to 2D master stereo output.',
    'Action',
    [],
    `MSP.detachSpatialObject();`,
    { group: '3D Spatial Audio' }
  ),

  // --- Conditions ---
  freeFn(
    'IsPlaying',
    'Is MIDI Music Playing',
    'MIDI soundtrack is currently playing',
    'Checks if a MIDI soundtrack is actively playing.',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = (MSP.isPlaying && !MSP.isPaused);`,
    { group: 'Playback Conditions' }
  ),

  freeFn(
    'IsPaused',
    'Is MIDI Music Paused',
    'MIDI soundtrack is currently paused',
    'Checks if MIDI soundtrack playback is paused.',
    'Condition',
    [],
    `eventsFunctionContext.returnValue = (MSP.isPlaying && MSP.isPaused);`,
    { group: 'Playback Conditions' }
  ),

  freeFn(
    'IsChannelMuted',
    'Is Channel Muted',
    'MIDI channel _PARAM0_ is muted',
    'Checks if a specific MIDI channel (0-15) is muted.',
    'Condition',
    [num('Channel', 'Channel Index (0-15)', '9')],
    `const ch = Math.floor(eventsFunctionContext.getArgument("Channel"));
eventsFunctionContext.returnValue = (MSP.channels[ch] ? MSP.channels[ch].muted : false);`,
    { group: 'Playback Conditions' }
  ),

  freeFn(
    'CurrentTimeGreater',
    'Current Playback Position is Greater',
    'MIDI playback position > _PARAM0_ seconds',
    'Checks if MIDI playback has progressed past the specified timestamp.',
    'Condition',
    [num('Seconds', 'Position in Seconds', '0')],
    `const sec = eventsFunctionContext.getArgument("Seconds");
eventsFunctionContext.returnValue = (MSP.playbackPositionSeconds > sec);`,
    { group: 'Playback Conditions' }
  ),

  freeFn(
    'TempoGreater',
    'Current Tempo is Greater',
    'Current MIDI tempo > _PARAM0_ BPM',
    'Checks if current tempo exceeds the specified Beats Per Minute.',
    'Condition',
    [num('BPM', 'Tempo in BPM', '120')],
    `const targetBPM = eventsFunctionContext.getArgument("BPM");
eventsFunctionContext.returnValue = (MSP.currentBPM > targetBPM);`,
    { group: 'Playback Conditions' }
  ),

  // --- Expressions ---
  freeFn(
    'CurrentTime',
    'Current Playback Position',
    'MidiSynthPlayer::CurrentTime()',
    'Returns current MIDI playback position in seconds.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = MSP.playbackPositionSeconds;`,
    { group: 'Playback Expressions', expressionType: 'number' }
  ),

  freeFn(
    'TotalDuration',
    'Total Song Duration',
    'MidiSynthPlayer::TotalDuration()',
    'Returns total song duration in seconds.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = (MSP.currentParsedSong ? MSP.currentParsedSong.totalDuration : 0.0);`,
    { group: 'Playback Expressions', expressionType: 'number' }
  ),

  freeFn(
    'BPM',
    'Current Tempo (BPM)',
    'MidiSynthPlayer::BPM()',
    'Returns current song tempo in Beats Per Minute.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = MSP.currentBPM;`,
    { group: 'Playback Expressions', expressionType: 'number' }
  ),

  freeFn(
    'TempoMultiplier',
    'Tempo Multiplier',
    'MidiSynthPlayer::TempoMultiplier()',
    'Returns current playback speed multiplier.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = MSP.tempoMultiplier;`,
    { group: 'Playback Expressions', expressionType: 'number' }
  ),

  freeFn(
    'Transposition',
    'Pitch Transposition',
    'MidiSynthPlayer::Transposition()',
    'Returns active pitch transposition in semitones.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = MSP.transposition;`,
    { group: 'Playback Expressions', expressionType: 'number' }
  ),

  freeFn(
    'ActiveVoiceCount',
    'Active Synthesizer Voice Count',
    'MidiSynthPlayer::ActiveVoiceCount()',
    'Returns number of simultaneous active polyphonic synth voices sounding.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = MSP.activeVoices.length;`,
    { group: 'Playback Expressions', expressionType: 'number' }
  ),

  freeFn(
    'MasterVolume',
    'Master Volume',
    'MidiSynthPlayer::MasterVolume()',
    'Returns current master output volume (0-100).',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = MSP.masterVolume;`,
    { group: 'Playback Expressions', expressionType: 'number' }
  ),

  freeFn(
    'ChannelVolume',
    'Channel Volume',
    'MidiSynthPlayer::ChannelVolume(_PARAM0_)',
    'Returns volume of a specific MIDI channel (0-15).',
    'Expression',
    [num('Channel', 'Channel Index (0-15)', '0')],
    `const ch = Math.floor(eventsFunctionContext.getArgument("Channel"));
eventsFunctionContext.returnValue = (MSP.channels[ch] ? MSP.channels[ch].volume : 0.0);`,
    { group: 'Playback Expressions', expressionType: 'number' }
  ),

  freeFn(
    'ChannelInstrument',
    'Channel Instrument Program',
    'MidiSynthPlayer::ChannelInstrument(_PARAM0_)',
    'Returns the General MIDI instrument program number (0-127) assigned to a channel.',
    'Expression',
    [num('Channel', 'Channel Index (0-15)', '0')],
    `const ch = Math.floor(eventsFunctionContext.getArgument("Channel"));
eventsFunctionContext.returnValue = MSP.getChannelInstrument(ch);`,
    { group: 'Playback Expressions', expressionType: 'number' }
  ),

  freeFn(
    'InstrumentName',
    'Instrument Name',
    'MidiSynthPlayer::InstrumentName(_PARAM0_)',
    'Returns the standard General MIDI instrument name for a program number (0-127).',
    'Expression',
    [num('Program', 'Program Number (0-127)', '0')],
    `const prog = Math.floor(eventsFunctionContext.getArgument("Program"));
eventsFunctionContext.returnValue = MSP.getInstrumentName(prog);`,
    { group: 'Playback Expressions', expressionType: 'string' }
  ),
];

/* ========================================================= Extension Assembly */

const extension = {
  name: 'MidiSynthPlayer',
  fullName: 'Algorithmic FM & Chiptune MIDI Soundtrack Engine',
  version: '1.0.0',
  description: 'Lightweight zero-sample procedural music synthesizer and .mid playback engine for GDevelop 5. Plays standard MIDI files using 100% mathematical FM and chiptune synthesis in real time with 0 KB audio sample downloads.',
  shortDescription: 'Procedural FM & Chiptune MIDI soundtrack synthesizer engine (0 KB samples).',
  author: 'Twillion',
  category: 'Audio',
  tags: 'midi,synth,soundtrack,fm,chiptune,music,opl3,genesis,pc98,nes,audio,dsp,retro,spatial',
  iconUrl,
  previewIconUrl: iconUrl,
  extensionNamespace: '',
  helpPath: '',
  eventsFunctions: globalFunctions,
  eventsBasedBehaviors: [behavior],
  eventsBasedObjects: [],
};

/* ========================================================= Validation & Linting */

let blocks = 0;
const walkEvents = (fns, label) => {
  for (const f of fns) {
    if (!f.events) continue;
    for (const e of f.events) {
      if (e.type === 'BuiltinCommonInstructions::JsCode') {
        blocks++;
        try {
          new Function('eventsFunctionContext', 'runtimeScene', e.inlineCode);
        } catch (err) {
          console.error(`\nJS Syntax Error in ${label} -> ${f.name}:\n`, err.message);
          process.exit(1);
        }
      }
    }
  }
};

walkEvents(behavior.eventsFunctions, behavior.name);
walkEvents(extension.eventsFunctions, 'global functions');

const json = JSON.stringify(extension, null, 2);

const BAD_KEYS = [
  ['"properties"', 'behaviors serialize "propertyDescriptors", not "properties"'],
  ['"extraInfo"', 'properties use "extraInformation"; parameters use "supplementaryInformation"'],
  ['"type": "resource"', '"resource" is not a registered parameter type; use model3DResource'],
];
for (const [needle, why] of BAD_KEYS) {
  if (json.includes(needle)) {
    console.error(`\nSchema lint failed: found ${needle} — ${why}\n`);
    process.exit(1);
  }
}

const VALID_PARAM_TYPES = new Set([
  'object', 'behavior', 'objectList', 'expression', 'string', 'yesorno',
  'model3DResource', 'imageResource', 'stringWithSelector', 'color', 'layer',
]);

for (const f of behavior.eventsFunctions) {
  for (const p of f.parameters) {
    if (!VALID_PARAM_TYPES.has(p.type)) {
      console.error(`\nUnknown parameter type "${p.type}" on behavior ${f.name}.${p.name}\n`);
      process.exit(1);
    }
  }
}

for (const f of extension.eventsFunctions) {
  for (const p of f.parameters) {
    if (!VALID_PARAM_TYPES.has(p.type)) {
      console.error(`\nUnknown parameter type "${p.type}" on global ${f.name}.${p.name}\n`);
      process.exit(1);
    }
  }
}

const out = path.join(here, 'MidiSynthPlayer.json');
fs.writeFileSync(out, json, 'utf8');

const behaviorCounts = behavior.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

const globalCounts = extension.eventsFunctions.reduce((acc, f) => {
  const k = f.private ? 'lifecycle' : f.functionType;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

console.log(`\n========================================`);
console.log(` Successfully built ${path.basename(out)}`);
console.log(` Output size: ${(json.length / 1024).toFixed(1)} KB`);
console.log(` Validated: ${blocks} JavaScript blocks parsed clean`);
console.log(` Behavior functions: ${JSON.stringify(behaviorCounts)}`);
console.log(` Global functions:   ${JSON.stringify(globalCounts)}`);
console.log(`========================================\n`);
