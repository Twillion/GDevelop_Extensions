/**
 * build-extension.mjs
 * Builds WorldPartition3D.json from the runtime engine + declarations.
 *
 * Run: node "Multi extension work space folder/WorldPartition3D/build-extension.mjs"
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

const runtime = fs.readFileSync(path.join(here, 'WorldPartition3D.runtime.js'), 'utf8');
const iconSvg = fs.readFileSync(path.join(here, 'icon.svg'), 'utf8');
const iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');

const NS = 'gdjs.__worldPartition3D';

const OB = [
  { name: 'Object', type: 'object', description: 'Object' },
  { name: 'Behavior', type: 'behavior', description: 'Behavior' },
];

const num = (name, description, value = '') => ({
  name, type: 'expression', description, ...(value ? { defaultValue: value } : {}),
});
const str = (name, description, value = '') => ({
  name, type: 'string', description, ...(value ? { defaultValue: value } : {}),
});
const bool = (name, description) => ({ name, type: 'yesorno', description });

const PREAMBLE = `const __wpObjects = eventsFunctionContext.getObjects("Object");
const object = __wpObjects.length ? __wpObjects[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const WP = ${NS};
const state = WP.getState(behavior);
`;

const ev = (inlineCode, { withRuntime = false } = {}) => [{
  type: 'BuiltinCommonInstructions::JsCode',
  inlineCode: (withRuntime ? runtime + '\n' : '') + inlineCode,
  parameterObjects: 'Object',
}];

const fn = (name, fullName, sentence, description, functionType, parameters, code, opts = {}) => ({
  name,
  fullName,
  sentence,
  description,
  functionType,
  ...(opts.group ? { group: opts.group } : {}),
  private: false,
  parameters: [...OB, ...parameters],
  events: ev(PREAMBLE + code, opts),
});

const lifecycle = [
  {
    name: 'onCreated',
    fullName: 'On Created',
    sentence: '',
    description: 'Initializes the WorldPartition3D grid streaming and clipmap terrain engine.',
    functionType: 'Action',
    parameters: [...OB],
    events: ev(`if (typeof ${NS} === 'undefined') return;
${NS}.getState(behavior);
`, { withRuntime: true }),
  },
  {
    name: 'doStepPostEvents',
    fullName: 'Post-events step',
    sentence: '',
    description: 'Updates active streaming sectors and toroidal clipmap terrain position.',
    functionType: 'Action',
    parameters: [...OB],
    events: ev(`if (typeof ${NS} === 'undefined') return;
const state = ${NS}.getState(behavior);
if (state) state.step(runtimeScene);
`),
  },
  {
    name: 'onDestroy',
    fullName: 'On Destroyed',
    sentence: '',
    description: 'Cleans up WorldPartition3D resources.',
    functionType: 'Action',
    parameters: [...OB],
    events: ev(`// Clean up state
`),
  },
];

const actions = [
  fn(
    'SetStreamingRadii',
    'Set streaming radii',
    'Set streaming radii on _PARAM0_ (NearRadius: _PARAM1_, FarRadius: _PARAM2_)',
    'Updates the near and far streaming radii in meters.',
    'Action',
    [
      num('NearRadius', 'Near dynamic streaming radius in meters (e.g. 256.0)', '256.0'),
      num('FarRadius', 'Far horizon streaming radius in meters (e.g. 1500.0)', '1500.0'),
    ],
    `const near = Number(eventsFunctionContext.getArgument("NearRadius"));
const far = Number(eventsFunctionContext.getArgument("FarRadius"));
if (near > 0) state.nearStreamingRadius = near;
if (far > 0) state.farStreamingRadius = far;
`,
    { group: 'Grid Streaming' }
  ),
  fn(
    'PreloadSector',
    'Preload sector at coordinates',
    'Preload sector at coordinates on _PARAM0_ (SectorX: _PARAM1_, SectorY: _PARAM2_)',
    'Asynchronously loads a target chunk before cutscenes or teleports.',
    'Action',
    [
      num('SectorX', 'Sector grid X coordinate', '0'),
      num('SectorY', 'Sector grid Y coordinate', '0'),
    ],
    `const sx = Number(eventsFunctionContext.getArgument("SectorX"));
const sy = Number(eventsFunctionContext.getArgument("SectorY"));
state.preloadSector(sx, sy);
`,
    { group: 'Grid Streaming' }
  ),
  fn(
    'EvictSector',
    'Evict sector at coordinates',
    'Evict sector at coordinates on _PARAM0_ (SectorX: _PARAM1_, SectorY: _PARAM2_)',
    'Manually purges a sector from active memory.',
    'Action',
    [
      num('SectorX', 'Sector grid X coordinate', '0'),
      num('SectorY', 'Sector grid Y coordinate', '0'),
    ],
    `const sx = Number(eventsFunctionContext.getArgument("SectorX"));
const sy = Number(eventsFunctionContext.getArgument("SectorY"));
state.evictSector(sx, sy);
`,
    { group: 'Grid Streaming' }
  ),
  fn(
    'SaveObjectStateString',
    'Save object state string',
    'Save object state string on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_, Value: _PARAM3_)',
    'Records a persistent string property for an object across sector unloads.',
    'Action',
    [
      str('ObjectID', 'Unique identifier of the entity (e.g. chest_04)'),
      str('Key', 'Property state key (e.g. state)'),
      str('Value', 'Property string value (e.g. opened)'),
    ],
    `const objId = eventsFunctionContext.getArgument("ObjectID");
const key = eventsFunctionContext.getArgument("Key");
const val = eventsFunctionContext.getArgument("Value");
state.persistence.set(objId, key, String(val));
if (state.autoSaveToStorage) state.persistence.saveToStorage();
`,
    { group: 'Delta Persistence' }
  ),
  fn(
    'SaveObjectStateNumber',
    'Save object state number',
    'Save object state number on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_, Value: _PARAM3_)',
    'Records a persistent numeric property for an object across sector unloads.',
    'Action',
    [
      str('ObjectID', 'Unique identifier of the entity'),
      str('Key', 'Property state key (e.g. hp)'),
      num('Value', 'Property numeric value (e.g. 0.0)'),
    ],
    `const objId = eventsFunctionContext.getArgument("ObjectID");
const key = eventsFunctionContext.getArgument("Key");
const val = Number(eventsFunctionContext.getArgument("Value"));
state.persistence.set(objId, key, val);
if (state.autoSaveToStorage) state.persistence.saveToStorage();
`,
    { group: 'Delta Persistence' }
  ),
  fn(
    'SaveObjectStateBoolean',
    'Save object state boolean',
    'Save object state boolean on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_, Value: _PARAM3_)',
    'Records a persistent boolean flag for an object across sector unloads.',
    'Action',
    [
      str('ObjectID', 'Unique identifier of the entity'),
      str('Key', 'Property state key (e.g. isDead)'),
      bool('Value', 'Boolean flag'),
    ],
    `const objId = eventsFunctionContext.getArgument("ObjectID");
const key = eventsFunctionContext.getArgument("Key");
const val = Boolean(eventsFunctionContext.getArgument("Value"));
state.persistence.set(objId, key, val);
if (state.autoSaveToStorage) state.persistence.saveToStorage();
`,
    { group: 'Delta Persistence' }
  ),
  fn(
    'SaveWorldDeltaState',
    'Save world delta state to disk',
    'Save world delta state to disk on _PARAM0_ (SaveSlot: _PARAM1_)',
    'Serializes entire world state history to localStorage / IndexedDB.',
    'Action',
    [str('SaveSlot', 'File save slot name (e.g. SaveSlot_01)', 'SaveSlot_01')],
    `const slot = eventsFunctionContext.getArgument("SaveSlot") || state.storageSaveSlot;
state.persistence.saveToStorage(slot);
`,
    { group: 'Delta Persistence' }
  ),
  fn(
    'LoadWorldDeltaState',
    'Load world delta state from disk',
    'Load world delta state from disk on _PARAM0_ (SaveSlot: _PARAM1_)',
    'Restores world state progress from disk on game load.',
    'Action',
    [str('SaveSlot', 'File save slot name (e.g. SaveSlot_01)', 'SaveSlot_01')],
    `const slot = eventsFunctionContext.getArgument("SaveSlot") || state.storageSaveSlot;
state.persistence.loadFromStorage(slot);
`,
    { group: 'Delta Persistence' }
  ),
  fn(
    'ClearWorldDeltaHistory',
    'Clear world delta state history',
    'Clear world delta state history on _PARAM0_',
    'Resets all world memory modifications for a New Game.',
    'Action',
    [],
    `state.persistence.clear();
if (state.autoSaveToStorage) state.persistence.saveToStorage();
`,
    { group: 'Delta Persistence' }
  ),
];

const conditions = [
  fn(
    'IsSectorLoaded',
    'Is sector loaded at coordinates',
    'Is sector loaded at coordinates (_PARAM1_, _PARAM2_) on _PARAM0_',
    'Returns true if the specified grid sector is currently active in memory.',
    'Condition',
    [
      num('SectorX', 'Sector grid X', '0'),
      num('SectorY', 'Sector grid Y', '0'),
    ],
    `const sx = Number(eventsFunctionContext.getArgument("SectorX"));
const sy = Number(eventsFunctionContext.getArgument("SectorY"));
eventsFunctionContext.returnValue = state ? state.isSectorLoaded(sx, sy) : false;
`,
    { group: 'Grid Streaming' }
  ),
  fn(
    'IsObjectStateSaved',
    'Is object state key saved',
    'Is object state key saved on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_)',
    'Returns true if the entity has a saved state override in world memory.',
    'Condition',
    [
      str('ObjectID', 'Unique identifier of the entity'),
      str('Key', 'Property state key'),
    ],
    `const objId = eventsFunctionContext.getArgument("ObjectID");
const key = eventsFunctionContext.getArgument("Key");
eventsFunctionContext.returnValue = state ? state.persistence.has(objId, key) : false;
`,
    { group: 'Delta Persistence' }
  ),
  fn(
    'IsObjectStateBooleanTrue',
    'Is object state boolean true',
    'Is object state boolean true on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_)',
    'Returns true if the saved boolean flag is set to true.',
    'Condition',
    [
      str('ObjectID', 'Unique identifier of the entity'),
      str('Key', 'Property state key (e.g. isDead, isOpened)'),
    ],
    `const objId = eventsFunctionContext.getArgument("ObjectID");
const key = eventsFunctionContext.getArgument("Key");
const val = state ? state.persistence.get(objId, key) : false;
eventsFunctionContext.returnValue = Boolean(val);
`,
    { group: 'Delta Persistence' }
  ),
];

const expressions = [
  fn(
    'CurrentSectorX',
    'Current sector X',
    'Get current player sector grid X on _PARAM0_',
    'Returns the player\'s current sector grid X coordinate.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.currentSectorX : 0;
`,
    { group: 'Grid Info' }
  ),
  fn(
    'CurrentSectorY',
    'Current sector Y',
    'Get current player sector grid Y on _PARAM0_',
    'Returns the player\'s current sector grid Y coordinate.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.currentSectorY : 0;
`,
    { group: 'Grid Info' }
  ),
  fn(
    'ActiveSectorCount',
    'Active sector count',
    'Get number of active loaded sectors on _PARAM0_',
    'Returns the number of active streaming sectors currently held in memory.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.activeSectors.size : 0;
`,
    { group: 'Grid Info' }
  ),
  fn(
    'ActiveHLODProxyCount',
    'Active HLOD proxy count',
    'Get number of active HLOD proxy meshes on _PARAM0_',
    'Returns the number of active distant HLOD single-mesh proxies.',
    'Expression',
    [],
    `eventsFunctionContext.returnValue = state ? state.activeHLODProxyCount : 0;
`,
    { group: 'Grid Info' }
  ),
  fn(
    'GetObjectStateString',
    'Get object state string',
    'Get saved string property on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_)',
    'Returns the saved string property for the specified entity from world memory.',
    'Expression',
    [
      str('ObjectID', 'Unique identifier of the entity'),
      str('Key', 'Property state key'),
    ],
    `const objId = eventsFunctionContext.getArgument("ObjectID");
const key = eventsFunctionContext.getArgument("Key");
const val = state ? state.persistence.get(objId, key) : '';
eventsFunctionContext.returnValue = val !== undefined ? String(val) : '';
`,
    { group: 'Delta Persistence' }
  ),
  fn(
    'GetObjectStateNumber',
    'Get object state number',
    'Get saved numeric property on _PARAM0_ (ObjectID: _PARAM1_, Key: _PARAM2_)',
    'Returns the saved numeric property for the specified entity from world memory.',
    'Expression',
    [
      str('ObjectID', 'Unique identifier of the entity'),
      str('Key', 'Property state key'),
    ],
    `const objId = eventsFunctionContext.getArgument("ObjectID");
const key = eventsFunctionContext.getArgument("Key");
const val = state ? state.persistence.get(objId, key) : 0;
eventsFunctionContext.returnValue = Number(val) || 0;
`,
    { group: 'Delta Persistence' }
  ),
];

const extension = {
  $schema: 'https://raw.githubusercontent.com/4ian/GDevelop/master/newIDE/app/src/fixtures/extension-schema.json',
  name: 'WorldPartition3D',
  version: '2.0.0',
  author: 'Twillion',
  shortDescription: 'Cartesian sector grid streaming, concentric geometry clipmap terrain, delta-state persistence, and HLOD proxies.',
  description: 'A unified open-world architecture combining 50k constant-triangle concentric Geometry Clipmap terrain, background Cartesian sector grid streaming with LRU cache eviction, delta-state world persistence (saved looted chests/dead enemies), and distant sector HLOD proxy swapping.',
  category: '3D',
  tags: '3d,open-world,streaming,clipmaps,terrain,persistence,hlod,partition,vram,optimization',
  iconUrl: iconUrl,
  previewIconUrl: iconUrl,
  helpPath: '',
  eventsBasedBehaviors: [
    {
      name: 'WorldPartition3D',
      fullName: 'World Partition 3D (Streaming, Clipmaps & Delta State)',
      description: 'Coordinates world sector grid streaming, clipmap terrain rings, and persistent world state.',
      objectType: '',
      propertyDescriptors: [
        {
          name: 'SectorSize',
          label: 'Sector Size (Meters)',
          description: 'Width and height of each Cartesian world grid sector in meters.',
          type: 'Number',
          value: '128.0',
          group: '1. Grid & Streaming',
        },
        {
          name: 'NearStreamingRadius',
          label: 'Near Streaming Radius (Meters)',
          description: 'Distance in meters where full dynamic objects, physics, and AI are active.',
          type: 'Number',
          value: '256.0',
          group: '1. Grid & Streaming',
        },
        {
          name: 'FarStreamingRadius',
          label: 'Far Horizon Radius (Meters)',
          description: 'Outer horizon distance in meters where distant sectors are tracked.',
          type: 'Number',
          value: '1500.0',
          group: '1. Grid & Streaming',
        },
        {
          name: 'MaxVRAMBudgetMB',
          label: 'Max VRAM Budget (MB)',
          description: 'Memory threshold for LRU cache eviction of inactive sectors.',
          type: 'Number',
          value: '150.0',
          group: '1. Grid & Streaming',
        },
        {
          name: 'EnableHLOD',
          label: 'Enable Distant HLOD Proxies',
          description: 'Merges distant static props into single low-poly proxy meshes per sector.',
          type: 'Boolean',
          value: 'true',
          group: '2. Hierarchical Level of Detail (HLOD)',
        },
        {
          name: 'HLODDistanceThreshold',
          label: 'HLOD Swap Distance (Meters)',
          description: 'Distance in meters where individual meshes swap to the merged HLOD proxy.',
          type: 'Number',
          value: '450.0',
          group: '2. Hierarchical Level of Detail (HLOD)',
        },
        {
          name: 'EnableClipmapTerrain',
          label: 'Enable Clipmap Terrain',
          description: 'Enables 4–6 nested concentric geometry rings with GPU height displacement.',
          type: 'Boolean',
          value: 'true',
          group: '3. Clipmap Terrain',
        },
        {
          name: 'ClipmapRingLevels',
          label: 'Clipmap Ring Levels',
          description: 'Number of concentric ring levels (4, 5, or 6).',
          type: 'Choice',
          extraInfo: ['4', '5', '6'],
          value: '5',
          group: '3. Clipmap Terrain',
        },
        {
          name: 'BaseGridResolution',
          label: 'Base Grid Resolution',
          description: 'Resolution per ring (64x64 or 128x128 quads).',
          type: 'Choice',
          extraInfo: ['64', '128'],
          value: '64',
          group: '3. Clipmap Terrain',
        },
        {
          name: 'HeightmapTexture',
          label: 'Heightmap Texture Resource',
          description: '16-bit elevation heightmap texture for world terrain.',
          type: 'Resource',
          extraInfo: ['image'],
          value: '',
          group: '3. Clipmap Terrain',
        },
        {
          name: 'HeightmapScaleZ',
          label: 'Heightmap Scale Z (Meters)',
          description: 'Maximum vertical mountain height in meters (0 - 2000).',
          type: 'Number',
          value: '350.0',
          group: '3. Clipmap Terrain',
        },
        {
          name: 'EnableDeltaPersistence',
          label: 'Enable Delta-State Persistence',
          description: 'Remembers dynamic state changes (looted chests, dead enemies, broken doors).',
          type: 'Boolean',
          value: 'true',
          group: '4. Delta-State Persistence',
        },
        {
          name: 'AutoSaveToStorage',
          label: 'Auto Save to Storage',
          description: 'Automatically serializes delta state to IndexedDB / localStorage.',
          type: 'Boolean',
          value: 'true',
          group: '4. Delta-State Persistence',
        },
        {
          name: 'StorageSaveSlot',
          label: 'Storage Save Slot',
          description: 'File save slot name.',
          type: 'String',
          value: 'SaveSlot_01',
          group: '4. Delta-State Persistence',
        },
      ],
      eventsFunctions: [
        ...lifecycle,
        ...actions,
        ...conditions,
        ...expressions,
      ],
    },
  ],
  eventsFunctions: [],
  globalVariables: [],
  sceneVariables: [],
};

const outputPath = path.join(here, 'WorldPartition3D.json');
fs.writeFileSync(outputPath, JSON.stringify(extension, null, 2), 'utf8');
console.log(`Successfully generated ${outputPath} (${(fs.statSync(outputPath).size / 1024).toFixed(1)} KB)`);
