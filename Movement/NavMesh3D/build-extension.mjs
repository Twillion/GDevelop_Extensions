/**
 * build-extension.mjs
 * Compiles NavMesh3D.json from the runtime engine + behavior & function declarations.
 *
 * Behaviors:
 * 1. NavMeshZone3D - Scene NavMesh surface & manager (auto-baking, live 3D editor wireframe).
 * 2. NavMeshAgent3D - Intelligent pathfinding agent with kinematic steering & elevation clamping.
 * 3. NavMeshObstacle3D - Dynamic obstacle volume with polygon blocking & auto-replanning.
 * 4. NavMeshWalkable3D - Tag for 3D objects/boxes to be baked into walkable terrain.
 *
 * Run: node NavMesh3D/build-extension.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = fs.readFileSync(path.join(here, 'NavMesh3D.runtime.js'), 'utf8');

let iconUrl = '';
const iconPath = path.join(here, 'icon.svg');
if (fs.existsSync(iconPath)) {
  const iconSvg = fs.readFileSync(iconPath, 'utf8');
  iconUrl = 'data:image/svg+xml;base64,' + Buffer.from(iconSvg, 'utf8').toString('base64');
}

const NS = 'gdjs.__navMesh3D';

/* ------------------------------------------------------------- Parameters & Helpers */

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

const BEHAVIOR_PREAMBLE = `const __objs = eventsFunctionContext.getObjects("Object");
const object = __objs.length ? __objs[0] : null;
if (!object) return;
const behavior = object.getBehavior(eventsFunctionContext.getBehaviorName("Behavior"));
if (!behavior) return;
if (!${NS}) return;
const NM = ${NS};
`;

const FREE_PREAMBLE = `if (!${NS}) return;
const NM = ${NS};
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
  parameters: parameters,
  events: evFree(FREE_PREAMBLE + code, opts),
  ...(opts.expressionType ? { expressionType: opts.expressionType } : {}),
});

/* =========================================================================
 * 1. NavMeshZone3D Behavior
 * ========================================================================= */

const G_ZONE_BAKE = 'Baking & Geometry';
const G_ZONE_VISUAL = 'Wireframe & Visualizer';
const G_ZONE_LINKS = 'Off-Mesh Links';
const G_ZONE_QUERY = 'Terrain Queries';

const zoneLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const upAxis = behavior._getUpAxis ? behavior._getUpAxis() : "Z";
const zone = NM.getOrCreateZone(runtimeScene, zoneName, upAxis);

const state = NM.getSceneState(runtimeScene);
state.debugEnabled = behavior._getShowDebugWireframeInGame ? behavior._getShowDebugWireframeInGame() : true;
state.editorVisualizerEnabled = behavior._getShowLiveWireframeInEditor ? behavior._getShowLiveWireframeInEditor() : true;

const autoBake = behavior._getAutoBakeOnStart ? behavior._getAutoBakeOnStart() : true;
if (autoBake) {
  NM.bakeZoneFromScene(runtimeScene, zoneName, {
    maxSlopeAngle: behavior._getMaxSlopeAngle ? behavior._getMaxSlopeAngle() : 50,
    mergeTolerance: behavior._getMergeTolerance ? behavior._getMergeTolerance() : 0.1,
    upAxis: upAxis
  });
}
`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
// Zone active tick
`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const state = NM.getSceneState(runtimeScene);
state.zones.delete(zoneName);
`),
  },
];

const zoneActions = [
  fn('BakeNavMesh', 'Bake navigation mesh',
    'Bake NavMesh zone _PARAM0_ from walkable level objects (Max slope: _PARAM2_°)',
    'Scans all 3D objects and boxes tagged as walkable, filters slopes, and builds the navigation mesh graph.',
    'Action',
    [num('MaxSlopeAngle', 'Max walkable slope angle in degrees', '50')],
    `const slope = eventsFunctionContext.getArgument("MaxSlopeAngle") || 50;
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const upAxis = behavior._getUpAxis ? behavior._getUpAxis() : "Z";
NM.bakeZoneFromScene(runtimeScene, zoneName, { maxSlopeAngle: slope, upAxis: upAxis });
`, { group: G_ZONE_BAKE }),

  fn('ClearNavMesh', 'Clear navigation mesh',
    'Clear all navigation mesh geometry on _PARAM0_',
    'Empties the navigation mesh zone.',
    'Action',
    [],
    `const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
zone.clear();
`, { group: G_ZONE_BAKE }),

  fn('LoadFromJSON', 'Load navmesh from JSON data',
    'Load NavMesh _PARAM0_ geometry from JSON string _PARAM2_',
    'Loads pre-baked navigation mesh data instantaneously without needing to scan scene objects.',
    'Action',
    [str('JSONData', 'JSON string containing baked navmesh')],
    `const json = eventsFunctionContext.getArgument("JSONData");
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
zone.importJSON(json);
`, { group: G_ZONE_BAKE }),

  fn('SaveToVariable', 'Save navmesh to scene variable',
    'Save NavMesh _PARAM0_ pre-baked JSON data to scene variable _PARAM2_',
    'Exports the current navigation mesh as JSON for instant zero-bake loading in future scenes.',
    'Action',
    [{ name: 'TargetVariable', type: 'scenevar', description: 'Scene variable to store the JSON string' }],
    `const varName = eventsFunctionContext.getArgument("TargetVariable");
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
const jsonStr = zone.exportJSON();
if (runtimeScene.getVariables && runtimeScene.getVariables().has(varName)) {
  runtimeScene.getVariables().get(varName).setString(jsonStr);
}
`, { group: G_ZONE_BAKE }),

  fn('SetDebugWireframe', 'Set debug wireframe lines visible',
    'Set in-game wireframe visualization on _PARAM0_ to _PARAM2_',
    'Enables or disables in-game wireframe lines showing walkable surfaces and dynamic obstacles.',
    'Action',
    [bool('Enabled', 'Show wireframe lines in game')],
    `const enabled = eventsFunctionContext.getArgument("Enabled");
const state = NM.getSceneState(runtimeScene);
state.debugEnabled = enabled;
`, { group: G_ZONE_VISUAL }),

  fn('AddOffMeshLink', 'Add off-mesh jump/climb link',
    'Add off-mesh link on _PARAM0_ from (_PARAM2_, _PARAM3_, _PARAM4_) to (_PARAM5_, _PARAM6_, _PARAM7_) [Type: _PARAM8_]',
    'Connects two disjoint positions (e.g. gap jump, ledge drop, ladder, teleporter).',
    'Action',
    [
      num('StartX', 'Start X coordinate', '0'),
      num('StartY', 'Start Y coordinate', '0'),
      num('StartZ', 'Start Z coordinate', '0'),
      num('EndX', 'End X coordinate', '100'),
      num('EndY', 'End Y coordinate', '100'),
      num('EndZ', 'End Z coordinate', '0'),
      choice('LinkType', 'Traversal type', ['Jump', 'Walk', 'Teleport', 'Climb']),
      bool('Bidirectional', 'Can traverse in both directions')
    ],
    `const sx = eventsFunctionContext.getArgument("StartX");
const sy = eventsFunctionContext.getArgument("StartY");
const sz = eventsFunctionContext.getArgument("StartZ");
const ex = eventsFunctionContext.getArgument("EndX");
const ey = eventsFunctionContext.getArgument("EndY");
const ez = eventsFunctionContext.getArgument("EndZ");
const type = eventsFunctionContext.getArgument("LinkType") || "Jump";
const bidi = eventsFunctionContext.getArgument("Bidirectional");

const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
zone.addOffMeshLink({ x: sx, y: sy, z: sz }, { x: ex, y: ey, z: ez }, type, bidi);
`, { group: G_ZONE_LINKS }),
];

const zoneConditions = [
  fn('IsNavMeshReady', 'Is navmesh ready',
    '_PARAM0_ navigation mesh is ready',
    'Returns true if the navigation mesh has been successfully built and contains walkable polygons.',
    'Condition',
    [],
    `const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
eventsFunctionContext.returnValue = !!(zone && zone.isReady);
`, { group: G_ZONE_BAKE }),

  fn('IsPointWalkable', 'Is position on walkable navmesh',
    'Position (_PARAM2_, _PARAM3_, _PARAM4_) is on walkable NavMesh _PARAM0_',
    'Returns true if the specified 3D coordinate lies on a walkable navigation polygon.',
    'Condition',
    [num('X', 'X coordinate', '0'), num('Y', 'Y coordinate', '0'), num('Z', 'Z coordinate', '0')],
    `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
const z = eventsFunctionContext.getArgument("Z");
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
const poly = zone ? zone.findPolygonContaining(x, y, z) : null;
eventsFunctionContext.returnValue = !!(poly && !poly.blocked);
`, { group: G_ZONE_QUERY }),
];

const zoneExpressions = [
  fn('PolygonCount', 'Polygon count',
    '', 'Returns the number of navigation polygons in the zone.', 'Expression',
    [],
    `const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
eventsFunctionContext.returnValue = zone ? zone.polygons.length : 0;
`, { group: G_ZONE_BAKE, expressionType: 'number' }),

  fn('VertexCount', 'Vertex count',
    '', 'Returns the number of unique vertices in the zone.', 'Expression',
    [],
    `const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
eventsFunctionContext.returnValue = zone ? zone.vertices.length : 0;
`, { group: G_ZONE_BAKE, expressionType: 'number' }),

  fn('SurfaceElevation', 'Surface elevation at (X, Y)',
    '', 'Returns the exact ground elevation on the navmesh surface at the specified horizontal coordinate.', 'Expression',
    [num('X', 'X coordinate', '0'), num('Y', 'Y coordinate', '0')],
    `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
eventsFunctionContext.returnValue = zone ? zone.getSurfaceElevation(x, y, 0) : 0;
`, { group: G_ZONE_QUERY, expressionType: 'number' }),

  fn('ExportedJSON', 'Exported JSON data',
    '', 'Returns the full JSON string of the current pre-baked navmesh.', 'Expression',
    [],
    `const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
eventsFunctionContext.returnValue = zone ? zone.exportJSON() : "";
`, { group: G_ZONE_BAKE, expressionType: 'string' }),
];

const navMeshZoneBehavior = {
  name: 'NavMeshZone3D',
  fullName: 'NavMesh 3D Zone (Navigation Surface & Manager)',
  description: 'Manages the 3D navigation mesh for the scene. Automatically bakes walkable polygons from level objects and renders live wireframe lines in the GDevelop 3D scene editor.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('ZoneName', 'String', 'Zone Name', 'Identifier for this navigation zone (allows multi-floor or separate navmesh zones).', 'Default'),
    prop('UpAxis', 'Choice', 'Up Axis', 'Vertical coordinate axis: Z for GDevelop 2D/3D default, Y for standard 3D.', 'Z', { extraInformation: ['Z', 'Y'] }),
    prop('MaxSlopeAngle', 'Number', 'Max Slope Angle', 'Maximum walkable surface angle in degrees. Surfaces steeper than this are treated as impassable walls.', '50'),
    prop('MergeTolerance', 'Number', 'Merge Tolerance', 'Vertex welding distance tolerance for connecting adjacent meshes.', '0.1'),
    prop('AutoBakeOnStart', 'Boolean', 'Auto Bake on Start', 'Automatically bake the navmesh from scene objects on scene startup.', 'true'),
    prop('ShowLiveWireframeInEditor', 'Boolean', 'Show Live Wireframe in 3D Editor', 'Draws clean wireframe lines showing navigable terrain live in GDevelop 3D scene editor.', 'true'),
    prop('ShowDebugWireframeInGame', 'Boolean', 'Show Debug Wireframe in Game', 'Shows wireframe navigation mesh lines during game preview.', 'false'),
  ],
  eventsFunctions: [
    ...zoneLifecycle,
    ...zoneActions,
    ...zoneConditions,
    ...zoneExpressions,
  ],
};

/* =========================================================================
 * 2. NavMeshAgent3D Behavior
 * ========================================================================= */

const G_AGENT_MOVE = 'Movement & Destination';
const G_AGENT_KINEMATICS = 'Kinematics & Speeds';
const G_AGENT_QUERY = 'Status & Coordinates';

const agentLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const agent = new NM.NavMeshAgentController(object, behavior, zoneName);

agent.speed = behavior._getSpeed ? behavior._getSpeed() : 250;
agent.acceleration = behavior._getAcceleration ? behavior._getAcceleration() : 600;
agent.deceleration = behavior._getDeceleration ? behavior._getDeceleration() : 800;
agent.turnSpeed = behavior._getTurnSpeed ? behavior._getTurnSpeed() : 360;
agent.stoppingDistance = behavior._getStoppingDistance ? behavior._getStoppingDistance() : 5;
agent.waypointTolerance = behavior._getWaypointTolerance ? behavior._getWaypointTolerance() : 10;
agent.agentRadius = behavior._getAgentRadius ? behavior._getAgentRadius() : 15;
agent.rotateTowardsPath = behavior._getRotateTowardsPath ? behavior._getRotateTowardsPath() : true;
agent.clampToNavMesh = behavior._getClampToNavMesh ? behavior._getClampToNavMesh() : true;
agent.avoidance = behavior._getAvoidance ? behavior._getAvoidance() : true;
agent.upAxis = behavior._getUpAxis ? behavior._getUpAxis() : "Z";

behavior.__navAgent = agent;
const state = NM.getSceneState(runtimeScene);
state.agents.add(agent);
`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
// Agent stepped by scene post-events loop
`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
if (behavior.__navAgent) {
  const state = NM.getSceneState(runtimeScene);
  state.agents.delete(behavior.__navAgent);
}
`),
  },
];

const agentActions = [
  fn('MoveTo', 'Move to position',
    'Move _PARAM0_ to (_PARAM2_, _PARAM3_, _PARAM4_)',
    'Calculates the optimal smoothed navmesh path to destination and begins moving.',
    'Action',
    [
      num('X', 'Target X position', '0'),
      num('Y', 'Target Y position', '0'),
      num('Z', 'Target Z position', '0')
    ],
    `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
const z = eventsFunctionContext.getArgument("Z");
const agent = behavior.__navAgent;
if (!agent) return;
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
agent.moveTo(x, y, z, zone);
`, { group: G_AGENT_MOVE }),

  fn('MoveToObject', 'Move to object',
    'Move _PARAM0_ towards object _PARAM2_',
    'Directs the agent to pathfind to the position of another object.',
    'Action',
    [{ name: 'TargetObject', type: 'object', description: 'Target destination object' }],
    `const targetObjs = eventsFunctionContext.getObjects("TargetObject");
const target = targetObjs.length ? targetObjs[0] : null;
if (!target) return;
const agent = behavior.__navAgent;
if (!agent) return;
const tx = target.getX ? target.getX() : 0;
const ty = target.getY ? target.getY() : 0;
const tz = target.getZ ? target.getZ() : 0;
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
agent.moveTo(tx, ty, tz, zone);
`, { group: G_AGENT_MOVE }),

  fn('Stop', 'Stop moving',
    'Stop _PARAM0_ movement immediately',
    'Stops the agent and clears its current path.',
    'Action',
    [],
    `if (behavior.__navAgent) behavior.__navAgent.stop();
`, { group: G_AGENT_MOVE }),

  fn('Teleport', 'Teleport to position',
    'Teleport _PARAM0_ to (_PARAM2_, _PARAM3_, _PARAM4_)',
    'Teleports the agent to the given coordinates, snapping to the navmesh surface.',
    'Action',
    [
      num('X', 'X position', '0'),
      num('Y', 'Y position', '0'),
      num('Z', 'Z position', '0')
    ],
    `const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
const z = eventsFunctionContext.getArgument("Z");
const agent = behavior.__navAgent;
if (!agent) return;
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
agent.teleport(x, y, z, zone);
`, { group: G_AGENT_MOVE }),

  fn('SetSpeed', 'Set maximum speed',
    'Set max speed of _PARAM0_ to _PARAM2_',
    'Changes the maximum movement speed of the agent.',
    'Action',
    [num('Speed', 'Maximum speed in units/s', '250')],
    `const spd = eventsFunctionContext.getArgument("Speed");
if (behavior.__navAgent) behavior.__navAgent.speed = Math.max(0, spd);
`, { group: G_AGENT_KINEMATICS }),

  fn('SetAcceleration', 'Set acceleration',
    'Set acceleration of _PARAM0_ to _PARAM2_',
    'Changes the acceleration rate.',
    'Action',
    [num('Acceleration', 'Acceleration in units/s²', '600')],
    `const acc = eventsFunctionContext.getArgument("Acceleration");
if (behavior.__navAgent) behavior.__navAgent.acceleration = Math.max(1, acc);
`, { group: G_AGENT_KINEMATICS }),

  fn('SetDeceleration', 'Set deceleration',
    'Set deceleration of _PARAM0_ to _PARAM2_',
    'Changes the braking deceleration rate.',
    'Action',
    [num('Deceleration', 'Deceleration in units/s²', '800')],
    `const dec = eventsFunctionContext.getArgument("Deceleration");
if (behavior.__navAgent) behavior.__navAgent.deceleration = Math.max(1, dec);
`, { group: G_AGENT_KINEMATICS }),

  fn('SetTurnSpeed', 'Set rotation turn speed',
    'Set rotation speed of _PARAM0_ to _PARAM2_ deg/s',
    'Changes the angular rotation speed towards heading.',
    'Action',
    [num('TurnSpeed', 'Turn speed in degrees/second', '360')],
    `const ts = eventsFunctionContext.getArgument("TurnSpeed");
if (behavior.__navAgent) behavior.__navAgent.turnSpeed = Math.max(0, ts);
`, { group: G_AGENT_KINEMATICS }),

  fn('SetStoppingDistance', 'Set arrival stopping distance',
    'Set stopping arrival distance of _PARAM0_ to _PARAM2_',
    'Distance from the final destination at which the agent considers itself arrived.',
    'Action',
    [num('StoppingDistance', 'Stopping tolerance distance', '5')],
    `const sd = eventsFunctionContext.getArgument("StoppingDistance");
if (behavior.__navAgent) behavior.__navAgent.stoppingDistance = Math.max(0.1, sd);
`, { group: G_AGENT_KINEMATICS }),
];

const agentConditions = [
  fn('HasReachedDestination', 'Destination reached',
    '_PARAM0_ has reached its destination',
    'Returns true if the agent has arrived at its target destination.',
    'Condition',
    [],
    `const agent = behavior.__navAgent;
eventsFunctionContext.returnValue = !!(agent && agent.hasReachedDestination);
`, { group: G_AGENT_MOVE }),

  fn('IsMoving', 'Is moving',
    '_PARAM0_ is actively moving along path',
    'Returns true while the agent is traveling along its path.',
    'Condition',
    [],
    `const agent = behavior.__navAgent;
eventsFunctionContext.returnValue = !!(agent && agent.isMoving);
`, { group: G_AGENT_MOVE }),

  fn('IsPathValid', 'Is path valid',
    'Current path of _PARAM0_ is valid and reachable',
    'Returns true if the pathfinding search succeeded in reaching the destination.',
    'Condition',
    [],
    `const agent = behavior.__navAgent;
eventsFunctionContext.returnValue = !!(agent && agent.isPathValid);
`, { group: G_AGENT_MOVE }),

  fn('RemainingDistance', 'Remaining distance',
    'Remaining path distance of _PARAM0_ _PARAM2_ _PARAM3_',
    'Compares the total remaining distance along the path to the destination.',
    'Condition',
    [
      { name: 'RelationalOperator', type: 'relationalOperator', description: 'Comparison operator' },
      num('Distance', 'Distance value', '50')
    ],
    `const agent = behavior.__navAgent;
if (!agent || !agent.isMoving) {
  eventsFunctionContext.returnValue = false;
  return;
}
var curX = object.getX ? object.getX() : 0;
var curY = object.getY ? object.getY() : 0;
var curZ = object.getZ ? object.getZ() : 0;
var curPos = { x: curX, y: curY, z: curZ };

var dist = 0;
if (agent.waypoints && agent.waypoints[agent.currentWaypointIndex]) {
  dist = NM.v3Dist(curPos, agent.waypoints[agent.currentWaypointIndex]);
  for (var k = agent.currentWaypointIndex; k < agent.waypoints.length - 1; k++) {
    dist += NM.v3Dist(agent.waypoints[k], agent.waypoints[k + 1]);
  }
}
const op = eventsFunctionContext.getArgument("RelationalOperator");
const targetDist = eventsFunctionContext.getArgument("Distance");
if (op === "<") eventsFunctionContext.returnValue = dist < targetDist;
else if (op === "<=") eventsFunctionContext.returnValue = dist <= targetDist;
else if (op === ">") eventsFunctionContext.returnValue = dist > targetDist;
else if (op === ">=") eventsFunctionContext.returnValue = dist >= targetDist;
else eventsFunctionContext.returnValue = Math.abs(dist - targetDist) < 0.1;
`, { group: G_AGENT_QUERY }),
];

const agentExpressions = [
  fn('Speed', 'Current speed',
    '', 'Returns the instantaneous movement speed of the agent in units/s.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
eventsFunctionContext.returnValue = agent ? agent.currentSpeed : 0;
`, { group: G_AGENT_QUERY, expressionType: 'number' }),

  fn('RemainingDistance', 'Remaining distance',
    '', 'Returns the total remaining path distance to the destination.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
if (!agent || !agent.isMoving) {
  eventsFunctionContext.returnValue = 0;
  return;
}
var curX = object.getX ? object.getX() : 0;
var curY = object.getY ? object.getY() : 0;
var curZ = object.getZ ? object.getZ() : 0;
var dist = 0;
if (agent.waypoints && agent.waypoints[agent.currentWaypointIndex]) {
  dist = NM.v3Dist({ x: curX, y: curY, z: curZ }, agent.waypoints[agent.currentWaypointIndex]);
  for (var k = agent.currentWaypointIndex; k < agent.waypoints.length - 1; k++) {
    dist += NM.v3Dist(agent.waypoints[k], agent.waypoints[k + 1]);
  }
}
eventsFunctionContext.returnValue = dist;
`, { group: G_AGENT_QUERY, expressionType: 'number' }),

  fn('TargetX', 'Target destination X',
    '', 'Returns the X coordinate of the current destination.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
eventsFunctionContext.returnValue = (agent && agent.target) ? agent.target.x : 0;
`, { group: G_AGENT_QUERY, expressionType: 'number' }),

  fn('TargetY', 'Target destination Y',
    '', 'Returns the Y coordinate of the current destination.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
eventsFunctionContext.returnValue = (agent && agent.target) ? agent.target.y : 0;
`, { group: G_AGENT_QUERY, expressionType: 'number' }),

  fn('TargetZ', 'Target destination Z',
    '', 'Returns the Z coordinate of the current destination.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
eventsFunctionContext.returnValue = (agent && agent.target) ? agent.target.z : 0;
`, { group: G_AGENT_QUERY, expressionType: 'number' }),

  fn('NextWaypointX', 'Next waypoint X',
    '', 'Returns the X coordinate of the next immediate path waypoint.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
if (agent && agent.waypoints && agent.waypoints[agent.currentWaypointIndex]) {
  eventsFunctionContext.returnValue = agent.waypoints[agent.currentWaypointIndex].x;
} else {
  eventsFunctionContext.returnValue = 0;
}
`, { group: G_AGENT_QUERY, expressionType: 'number' }),

  fn('NextWaypointY', 'Next waypoint Y',
    '', 'Returns the Y coordinate of the next immediate path waypoint.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
if (agent && agent.waypoints && agent.waypoints[agent.currentWaypointIndex]) {
  eventsFunctionContext.returnValue = agent.waypoints[agent.currentWaypointIndex].y;
} else {
  eventsFunctionContext.returnValue = 0;
}
`, { group: G_AGENT_QUERY, expressionType: 'number' }),

  fn('NextWaypointZ', 'Next waypoint Z',
    '', 'Returns the Z coordinate of the next immediate path waypoint.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
if (agent && agent.waypoints && agent.waypoints[agent.currentWaypointIndex]) {
  eventsFunctionContext.returnValue = agent.waypoints[agent.currentWaypointIndex].z;
} else {
  eventsFunctionContext.returnValue = 0;
}
`, { group: G_AGENT_QUERY, expressionType: 'number' }),

  fn('WaypointCount', 'Waypoint count',
    '', 'Returns the number of waypoints along the current active path.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
eventsFunctionContext.returnValue = agent && agent.waypoints ? agent.waypoints.length : 0;
`, { group: G_AGENT_QUERY, expressionType: 'number' }),

  fn('CurrentWaypointIndex', 'Current waypoint index',
    '', 'Returns the index of the waypoint the agent is currently heading towards.', 'Expression',
    [],
    `const agent = behavior.__navAgent;
eventsFunctionContext.returnValue = agent ? agent.currentWaypointIndex : 0;
`, { group: G_AGENT_QUERY, expressionType: 'number' }),
];

const navMeshAgentBehavior = {
  name: 'NavMeshAgent3D',
  fullName: 'NavMesh 3D Agent (Intelligent Pathfinding Character)',
  description: 'Gives 3D characters the ability to navigate smooth paths across navmesh surfaces with acceleration, deceleration, arrival braking, angular turn speed, and surface elevation clamping.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('ZoneName', 'String', 'Zone Name', 'Navigation zone to pathfind within.', 'Default'),
    prop('Speed', 'Number', 'Max Speed', 'Maximum travel speed in world units per second.', '250'),
    prop('Acceleration', 'Number', 'Acceleration', 'Rate of acceleration in units/s².', '600'),
    prop('Deceleration', 'Number', 'Deceleration', 'Braking deceleration rate in units/s² for smooth arrival.', '800'),
    prop('TurnSpeed', 'Number', 'Turn Speed', 'Angular rotation speed towards path heading in degrees per second.', '360'),
    prop('StoppingDistance', 'Number', 'Stopping Distance', 'Distance from destination at which the agent reaches arrival.', '5'),
    prop('WaypointTolerance', 'Number', 'Waypoint Tolerance', 'Distance to waypoint before advancing to the next.', '10'),
    prop('AgentRadius', 'Number', 'Agent Radius', 'Radius margin used to inset portals away from obstacle corners and walls.', '15'),
    prop('RotateTowardsPath', 'Boolean', 'Rotate Towards Path', 'Automatically rotate the object towards its travel heading.', 'true'),
    prop('ClampToNavMesh', 'Boolean', 'Clamp to NavMesh Surface', 'Automatically clamp object elevation onto the navmesh terrain slope/ramp.', 'true'),
    prop('Avoidance', 'Boolean', 'Neighbor Avoidance', 'Apply soft lateral separation force to steer around other nearby agents.', 'true'),
    prop('UpAxis', 'Choice', 'Up Axis', 'Vertical coordinate axis (Z for GDevelop default, Y for standard 3D).', 'Z', { extraInformation: ['Z', 'Y'] }),
  ],
  eventsFunctions: [
    ...agentLifecycle,
    ...agentActions,
    ...agentConditions,
    ...agentExpressions,
  ],
};

/* =========================================================================
 * 3. NavMeshObstacle3D Behavior
 * ========================================================================= */

const G_OBS_PROP = 'Dynamic Obstacle Controls';

const obstacleLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const obs = new NM.NavMeshObstacleController(object, behavior, zoneName);
obs.shape = behavior._getObstacleShape ? behavior._getObstacleShape() : "Box";
obs.sizeX = behavior._getSizeX ? behavior._getSizeX() : 50;
obs.sizeY = behavior._getSizeY ? behavior._getSizeY() : 50;
obs.sizeZ = behavior._getSizeZ ? behavior._getSizeZ() : 50;
obs.enabled = behavior._getObstacleEnabled ? behavior._getObstacleEnabled() : true;

behavior.__navObstacle = obs;
const state = NM.getSceneState(runtimeScene);
state.obstacles.add(obs);
`, { withRuntime: true }),
  },
  {
    name: 'doStepPreEvents', fullName: 'doStepPreEvents', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
// Obstacle updated per frame by scene post-events loop
`),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
if (behavior.__navObstacle) {
  const state = NM.getSceneState(runtimeScene);
  const zone = state.zones.get(behavior.__navObstacle.zoneName);
  behavior.__navObstacle.onDestroy(zone);
  state.obstacles.delete(behavior.__navObstacle);
}
`),
  },
];

const obstacleActions = [
  fn('EnableObstacle', 'Enable or disable obstacle',
    'Set obstacle status of _PARAM0_ to _PARAM2_',
    'Enables or disables dynamic polygon blocking by this obstacle.',
    'Action',
    [bool('Enabled', 'Enable obstacle blocking')],
    `const en = eventsFunctionContext.getArgument("Enabled");
if (behavior.__navObstacle) {
  behavior.__navObstacle.enabled = en;
}
`, { group: G_OBS_PROP }),

  fn('SetObstacleSize', 'Set obstacle bounds size',
    'Set obstacle size of _PARAM0_ to (_PARAM2_, _PARAM3_, _PARAM4_)',
    'Configures the dynamic bounding volume dimensions of the obstacle.',
    'Action',
    [
      num('SizeX', 'Size X', '50'),
      num('SizeY', 'Size Y', '50'),
      num('SizeZ', 'Size Z', '50')
    ],
    `const sx = eventsFunctionContext.getArgument("SizeX");
const sy = eventsFunctionContext.getArgument("SizeY");
const sz = eventsFunctionContext.getArgument("SizeZ");
if (behavior.__navObstacle) {
  behavior.__navObstacle.sizeX = Math.max(1, sx);
  behavior.__navObstacle.sizeY = Math.max(1, sy);
  behavior.__navObstacle.sizeZ = Math.max(1, sz);
}
`, { group: G_OBS_PROP }),
];

const obstacleConditions = [
  fn('IsObstacleEnabled', 'Is obstacle enabled',
    '_PARAM0_ obstacle is actively blocking',
    'Returns true if the obstacle is currently active and blocking navmesh polygons.',
    'Condition',
    [],
    `const obs = behavior.__navObstacle;
eventsFunctionContext.returnValue = !!(obs && obs.enabled);
`, { group: G_OBS_PROP }),

  fn('IsObstacleBlocking', 'Is actively blocking polygons',
    '_PARAM0_ is currently overlapping and blocking navmesh polygons',
    'Returns true if this obstacle volume intersects at least one navigation polygon.',
    'Condition',
    [],
    `const obs = behavior.__navObstacle;
eventsFunctionContext.returnValue = !!(obs && obs.blockedPolyIds.size > 0);
`, { group: G_OBS_PROP }),
];

const navMeshObstacleBehavior = {
  name: 'NavMeshObstacle3D',
  fullName: 'NavMesh 3D Dynamic Obstacle',
  description: 'Attach to dynamic objects (crates, doors, barricades). Blocks navmesh polygons and triggers nearby agents to dynamically re-plan around them.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('ZoneName', 'String', 'Zone Name', 'Navigation zone affected by this obstacle.', 'Default'),
    prop('ObstacleShape', 'Choice', 'Obstacle Shape', 'Bounding volume shape.', 'Box', { extraInformation: ['Box', 'Sphere'] }),
    prop('SizeX', 'Number', 'Size X', 'Obstacle width (used if object width is not available).', '50'),
    prop('SizeY', 'Number', 'Size Y', 'Obstacle height.', '50'),
    prop('SizeZ', 'Number', 'Size Z', 'Obstacle depth.', '50'),
    prop('ObstacleEnabled', 'Boolean', 'Obstacle Enabled', 'Whether the obstacle actively blocks polygons.', 'true'),
  ],
  eventsFunctions: [
    ...obstacleLifecycle,
    ...obstacleActions,
    ...obstacleConditions,
  ],
};

/* =========================================================================
 * 4. NavMeshWalkable3D Behavior
 * ========================================================================= */

const G_WALK_PROP = 'Walkable Surface Settings';

const walkableLifecycle = [
  {
    name: 'onCreated', fullName: 'onCreated', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
const zoneName = behavior._getZoneName ? behavior._getZoneName() : "Default";
const cost = behavior._getAreaCost ? behavior._getAreaCost() : 1.0;
const areaType = behavior._getAreaType ? behavior._getAreaType() : "Walkable";

const wEntry = { object: object, behavior: behavior, zoneName: zoneName, cost: cost, areaType: areaType };
behavior.__navWalkable = wEntry;
const state = NM.getSceneState(runtimeScene);
state.walkables.add(wEntry);
`, { withRuntime: true }),
  },
  {
    name: 'onDestroy', fullName: 'onDestroy', description: '', functionType: 'Action',
    private: true, parameters: [...OB],
    events: ev(BEHAVIOR_PREAMBLE + `
if (behavior.__navWalkable) {
  const state = NM.getSceneState(runtimeScene);
  state.walkables.delete(behavior.__navWalkable);
}
`),
  },
];

const walkableActions = [
  fn('SetAreaCost', 'Set area traversal cost multiplier',
    'Set area traversal cost of _PARAM0_ to _PARAM2_',
    'Multiplies the pathfinding cost (e.g. 1.0 for normal floor, 2.0 for mud, 0.5 for roads).',
    'Action',
    [num('Cost', 'Area cost multiplier', '1.0')],
    `const c = eventsFunctionContext.getArgument("Cost");
if (behavior.__navWalkable) behavior.__navWalkable.cost = Math.max(0.1, c);
`, { group: G_WALK_PROP }),
];

const navMeshWalkableBehavior = {
  name: 'NavMeshWalkable3D',
  fullName: 'NavMesh 3D Walkable Surface',
  description: 'Marks this 3D Object or Box as walkable ground geometry to be included in automatic navmesh baking.',
  objectType: '',
  private: false,
  propertyDescriptors: [
    prop('ZoneName', 'String', 'Zone Name', 'Navigation zone to bake this walkable geometry into.', 'Default'),
    prop('AreaType', 'Choice', 'Area Type', 'Terrain classification.', 'Walkable', { extraInformation: ['Walkable', 'Mud', 'Road', 'Hazard'] }),
    prop('AreaCost', 'Number', 'Area Cost', 'Pathfinding traversal weight multiplier (1.0 = normal, higher = avoided, lower = preferred).', '1.0'),
  ],
  eventsFunctions: [
    ...walkableLifecycle,
    ...walkableActions,
  ],
};

/* =========================================================================
 * 5. Global Free Functions
 * ========================================================================= */

const G_GLOBAL_NAV = 'Global Navigation Mesh';

const globalFunctions = [
  freeFn('NavMeshFindPath', 'Find path between coordinates',
    'Find NavMesh path in zone _PARAM0_ from (_PARAM1_, _PARAM2_, _PARAM3_) to (_PARAM4_, _PARAM5_, _PARAM6_) into array variable _PARAM7_',
    'Finds the optimal path between two 3D coordinates and writes the waypoints into a scene array variable.',
    'Action',
    [
      str('ZoneName', 'Navigation zone name', '"Default"'),
      num('StartX', 'Start X coordinate', '0'),
      num('StartY', 'Start Y coordinate', '0'),
      num('StartZ', 'Start Z coordinate', '0'),
      num('EndX', 'Goal X coordinate', '100'),
      num('EndY', 'Goal Y coordinate', '100'),
      num('EndZ', 'Goal Z coordinate', '0'),
      { name: 'TargetArrayVariable', type: 'scenevar', description: 'Scene array variable to receive waypoints' }
    ],
    `const zoneName = eventsFunctionContext.getArgument("ZoneName") || "Default";
const sx = eventsFunctionContext.getArgument("StartX");
const sy = eventsFunctionContext.getArgument("StartY");
const sz = eventsFunctionContext.getArgument("StartZ");
const ex = eventsFunctionContext.getArgument("EndX");
const ey = eventsFunctionContext.getArgument("EndY");
const ez = eventsFunctionContext.getArgument("EndZ");
const varName = eventsFunctionContext.getArgument("TargetArrayVariable");

const zone = NM.getOrCreateZone(runtimeScene, zoneName);
if (!zone || !zone.isReady) return;

const startPoly = zone.findClosestPolygon(sx, sy, sz, 300);
const goalPoly = zone.findClosestPolygon(ex, ey, ez, 300);
if (!startPoly || !goalPoly) return;

const polyIds = NM.findPolygonPath(zone, startPoly, goalPoly, { x: sx, y: sy, z: sz }, { x: ex, y: ey, z: ez });
if (!polyIds) return;

const waypoints = NM.stringPullFunnel(zone, polyIds, { x: sx, y: sy, z: sz }, { x: ex, y: ey, z: ez }, 0);
if (runtimeScene.getVariables && runtimeScene.getVariables().has(varName)) {
  const v = runtimeScene.getVariables().get(varName);
  v.castTo("array");
  v.clearChildren();
  for (var i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const child = v.pushValue(0);
    child.castTo("structure");
    child.getChild("x").setValue(wp.x);
    child.getChild("y").setValue(wp.y);
    child.getChild("z").setValue(wp.z);
  }
}
`, { group: G_GLOBAL_NAV }),

  freeFn('NavMeshGetElevation', 'Get navmesh elevation at (X, Y)',
    '', 'Returns the surface elevation Z (or Y in Y-up mode) of the navmesh at the specified position.', 'Expression',
    [
      str('ZoneName', 'Navigation zone name', '"Default"'),
      num('X', 'X coordinate', '0'),
      num('Y', 'Y coordinate', '0'),
      num('FallbackElevation', 'Fallback elevation if outside navmesh', '0')
    ],
    `const zoneName = eventsFunctionContext.getArgument("ZoneName") || "Default";
const x = eventsFunctionContext.getArgument("X");
const y = eventsFunctionContext.getArgument("Y");
const fb = eventsFunctionContext.getArgument("FallbackElevation") || 0;
const zone = NM.getOrCreateZone(runtimeScene, zoneName);
eventsFunctionContext.returnValue = zone ? zone.getSurfaceElevation(x, y, fb) : fb;
`, { group: G_GLOBAL_NAV, expressionType: 'number' }),

  freeFn('NavMeshIsReachable', 'Is destination reachable',
    'NavMesh path exists in zone _PARAM0_ from (_PARAM1_, _PARAM2_, _PARAM3_) to (_PARAM4_, _PARAM5_, _PARAM6_)',
    'Checks whether a valid traversable path exists between two 3D coordinates.',
    'Condition',
    [
      str('ZoneName', 'Navigation zone name', '"Default"'),
      num('StartX', 'Start X coordinate', '0'),
      num('StartY', 'Start Y coordinate', '0'),
      num('StartZ', 'Start Z coordinate', '0'),
      num('EndX', 'Goal X coordinate', '100'),
      num('EndY', 'Goal Y coordinate', '100'),
      num('EndZ', 'Goal Z coordinate', '0')
    ],
    `const zoneName = eventsFunctionContext.getArgument("ZoneName") || "Default";
const sx = eventsFunctionContext.getArgument("StartX");
const sy = eventsFunctionContext.getArgument("StartY");
const sz = eventsFunctionContext.getArgument("StartZ");
const ex = eventsFunctionContext.getArgument("EndX");
const ey = eventsFunctionContext.getArgument("EndY");
const ez = eventsFunctionContext.getArgument("EndZ");

const zone = NM.getOrCreateZone(runtimeScene, zoneName);
if (!zone || !zone.isReady) {
  eventsFunctionContext.returnValue = false;
  return;
}
const startPoly = zone.findClosestPolygon(sx, sy, sz, 300);
const goalPoly = zone.findClosestPolygon(ex, ey, ez, 300);
if (!startPoly || !goalPoly) {
  eventsFunctionContext.returnValue = false;
  return;
}
const polyIds = NM.findPolygonPath(zone, startPoly, goalPoly, { x: sx, y: sy, z: sz }, { x: ex, y: ey, z: ez });
eventsFunctionContext.returnValue = !!(polyIds && polyIds.length > 0);
`, { group: G_GLOBAL_NAV }),

  freeFn('NavMeshSetDebugWireframe', 'Set in-game debug wireframe lines visible',
    'Set global in-game navigation wireframe display to _PARAM0_',
    'Toggles in-game wireframe lines across all navigation zones.',
    'Action',
    [bool('Enabled', 'Enable wireframe lines')],
    `const en = eventsFunctionContext.getArgument("Enabled");
const state = NM.getSceneState(runtimeScene);
state.debugEnabled = en;
`, { group: G_GLOBAL_NAV }),
];

/* =========================================================================
 * 6. Extension Package Output
 * ========================================================================= */

const extension = {
  name: 'NavMesh3D',
  fullName: 'NavMesh 3D (Navigation Mesh & Intelligent Pathfinding)',
  version: '1.0.0',
  author: 'Twillion',
  category: 'Movement',
  shortDescription: '3D navigation mesh pathfinding with live wireframe lines in GDevelop 3D scene editor, slope filtering, elevation clamping, dynamic obstacles, and off-mesh links.',
  description: 'A complete 3D Navigation Mesh and Intelligent Pathfinding suite for GDevelop. Features automatic mesh extraction and slope filtering from 3D Boxes and Models, live 3D Scene Editor wireframe line visualization, optimal A* graph search, Simple Fast Funnel Algorithm (SSFA) path smoothing, agent radius wall clearance, kinematic steering with arrival braking, barycentric terrain elevation clamping, dynamic obstacle blocking, off-mesh jump/climb links, and pre-baked JSON import/export.',
  iconUrl,
  tags: ['3D', 'navmesh', 'pathfinding', 'AI', 'movement', 'crowd', 'character', 'wireframe', 'editor', 'slope', 'ramps'],
  eventsFunctions: [
    {
      name: 'onFirstSceneLoaded',
      fullName: 'onFirstSceneLoaded',
      description: 'Initializes the shared NavMesh3D runtime namespace.',
      sentence: '',
      functionType: 'Action',
      private: true,
      events: [{ type: 'BuiltinCommonInstructions::JsCode', inlineCode: runtime }],
      parameters: [],
    },
    ...globalFunctions,
  ],
  eventsBasedBehaviors: [
    navMeshZoneBehavior,
    navMeshAgentBehavior,
    navMeshObstacleBehavior,
    navMeshWalkableBehavior,
  ],
};

/* =========================================================================
 * 7. Control Character Validation & Compilation
 * ========================================================================= */

const isForbiddenCode = (code) =>
  code < 9 || code === 11 || code === 12 || (code >= 14 && code < 32);

const findControlChar = (text) => {
  for (let i = 0; i < text.length; i++) {
    if (isForbiddenCode(text.charCodeAt(i))) return i;
  }
  return -1;
};

const at = findControlChar(runtime);
if (at >= 0) {
  const upto = runtime.slice(0, at);
  const line = upto.split('\n').length;
  const col = at - upto.lastIndexOf('\n');
  const code = runtime.charCodeAt(at).toString(16).padStart(4, '0');
  console.error(`\nControl character U+${code} in NavMesh3D.runtime.js at line ${line}, column ${col}.\n`);
  process.exit(1);
}

const outputPath = path.join(here, 'NavMesh3D.json');
fs.writeFileSync(outputPath, JSON.stringify(extension, null, 2), 'utf8');

console.log(`Successfully compiled ${outputPath} with 4 modular behaviors, global functions, and live 3D editor wireframe!`);
