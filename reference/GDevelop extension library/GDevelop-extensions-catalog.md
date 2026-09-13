# GDevelop Extensions — Annotated Catalog

_Single-file reference auto-generated from the `JsExtension.js` declaration of every extension in `GDevelop-reference/Extensions/`. 30 extensions. Generated 2026-06-15._

Each entry documents what the extension is, the behaviors/objects/effects it provides (with descriptions), and a compact index of its actions, conditions and expressions (by their human-readable labels). Internal names are in `code font` — those are the identifiers you reference from events/JS. Runtime implementations live in the matching `Extensions/<folder>/*.ts` files.

## Most relevant to a found-footage / 3D-FPS project

- **3D** (`3D`) — 3D objects (Model3D, Cube3D), the `Base3DBehavior`, fog, lights, skybox, camera control via Scene3DTools.
- **Effects** (`Effects`) — All 35 post-process filters incl. `crt`, `old-film`, `noise`, `rgb-split`, `glitch` — the building blocks of a found-footage look.
- **Lights** (`Lighting`) — 2D dynamic lights / light obstacles.
- **3D physics engine** (`Physics3DBehavior`) — 3D rigid-body physics, character controller, vehicle — for walkable 3D scenes.

## Quick reference

| Extension | `folder` | Beh | Obj | Eff | Act | Cond | Expr | E+C(+A) |
|---|---|--:|--:|--:|--:|--:|--:|--:|
| 2D Physics Engine | `Physics2Behavior` | 1 | 0 | 0 | 75 | 35 | 80 | 0 |
| 3D | `3D` | 1 | 2 | 10 | 16 | 7 | 18 | 19 |
| 3D physics engine | `Physics3DBehavior` | 3 | 0 | 0 | 28 | 18 | 9 | 39 |
| AdMob | `AdMob` | 0 | 0 | 0 | 16 | 24 | 0 | 0 |
| Advanced window management | `AdvancedWindow` | 0 | 0 | 0 | 19 | 14 | 3 | 0 |
| BBCode Text Object | `BBText` | 0 | 1 | 0 | 2 | 2 | 0 | 0 |
| Bitmap Text | `BitmapText` | 0 | 1 | 0 | 4 | 1 | 1 | 7 |
| Debugger Tools | `DebuggerTools` | 0 | 0 | 0 | 3 | 0 | 0 | 0 |
| Device sensors | `DeviceSensors` | 0 | 0 | 0 | 4 | 10 | 7 | 0 |
| Device vibration | `DeviceVibration` | 0 | 0 | 0 | 3 | 0 | 0 | 0 |
| Dialogue Tree | `DialogueTree` | 0 | 0 | 0 | 17 | 12 | 17 | 0 |
| Effects | `Effects` | 0 | 0 | 35 | 0 | 0 | 0 | 0 |
| Facebook Instant Games | `FacebookInstantGames` | 0 | 0 | 0 | 8 | 3 | 2 | 0 |
| File system | `FileSystem` | 0 | 0 | 0 | 12 | 1 | 12 | 0 |
| Firebase | `Firebase` | 0 | 0 | 0 | 65 | 2 | 13 | 0 |
| Leaderboards | `Leaderboards` | 0 | 0 | 0 | 5 | 7 | 2 | 0 |
| Lights | `Lighting` | 1 | 1 | 0 | 2 | 0 | 0 | 0 |
| Multiplayer | `Multiplayer` | 1 | 0 | 0 | 17 | 15 | 10 | 5 |
| My Dummy Extension | `ExampleJsExtension` | 2 | 1 | 1 | 1 | 1 | 2 | 0 |
| P2P | `P2P` | 0 | 0 | 0 | 15 | 5 | 6 | 0 |
| Player Authentication | `PlayerAuthentication` | 0 | 0 | 0 | 4 | 3 | 2 | 0 |
| Save State (experimental) | `SaveState` | 1 | 0 | 0 | 7 | 4 | 0 | 2 |
| Screenshot | `Screenshot` | 0 | 0 | 0 | 1 | 0 | 0 | 0 |
| Spatial sound | `SpatialSound` | 0 | 0 | 0 | 2 | 0 | 0 | 0 |
| Spine (experimental) | `Spine` | 0 | 1 | 0 | 1 | 0 | 0 | 10 |
| Steamworks (Steam) (experimental) | `Steamworks` | 0 | 0 | 0 | 20 | 13 | 28 | 0 |
| Text Input | `TextInput` | 0 | 1 | 0 | 5 | 2 | 1 | 12 |
| Tile map | `TileMap` | 0 | 3 | 0 | 16 | 11 | 9 | 7 |
| Tweening | `TweenBehavior` | 1 | 0 | 0 | 36 | 6 | 2 | 1 |
| Video | `Video` | 0 | 1 | 0 | 8 | 10 | 5 | 0 |

---

## 2D Physics Engine &nbsp;`Physics2Behavior`

**Internal name:** `Physics2`

The 2D physics engine simulates realistic object physics, with gravity, forces, collisions, joints, etc. It's perfect for 2D games that need to have realistic behaving objects and a gameplay centered around it.

**Behaviors**
- `Physics2Behavior` — *2D Physics Engine*: Simulate realistic 2D physics for the object including gravity, forces, collisions, and joints.

**Actions (75):** World gravity; World time scale; Set as dynamic; Set as static; Set as kinematic; Treat as bullet; Fixed rotation; Sleeping allowed; Shape scale; Density; Friction; Restitution; Linear damping; Angular damping; Gravity scale; Enable layer; Enable mask; Linear velocity X; Linear velocity Y; Linear velocity towards an angle; Angular velocity; Apply force; Apply force (angle); Apply force toward position; Apply impulse; Apply impulse (angle); Apply impulse toward position; Apply torque (rotational force); Apply angular impulse (rotational impulse); Remove joint; Add distance joint; Distance joint length; Distance joint frequency; Distance joint damping ratio; Add revolute joint; Add revolute joint between two bodies; Enable revolute joint limits; Revolute joint limits; Enable revolute joint motor; Revolute joint motor speed; Revolute joint max motor torque; Add prismatic joint; Enable prismatic joint limits; Prismatic joint limits; Enable prismatic joint motor; Prismatic joint motor speed; Prismatic joint max motor force; Add pulley joint; Add gear joint; Gear joint ratio; Add mouse joint; Mouse joint target; Mouse joint max force; Mouse joint frequency; Mouse joint damping ratio; Add wheel joint; Enable wheel joint motor; Wheel joint motor speed; Wheel joint max motor torque; Wheel joint frequency; Wheel joint damping ratio; Add weld joint; Weld joint frequency; Weld joint damping ratio; Add rope joint; Rope joint max length; Add friction joint; Friction joint max force; Friction joint max torque; Add motor joint; Motor joint offset; Motor joint angular offset; Motor joint max force; Motor joint max torque; Motor joint correction factor

**Conditions (35):** World gravity on X axis; World gravity on Y axis; World time scale; Is dynamic; Is static; Is kinematic; Is treated as a bullet; Has fixed rotation; Is sleeping allowed; Is sleeping; Density; Friction; Restitution; Linear damping; Angular damping; Gravity scale; Layer enabled; Mask enabled; Linear velocity X; Linear velocity Y; Linear velocity; Linear velocity angle; Angular velocity; Joint first object; Joint second object; Joint reaction force; Joint reaction torque; Revolute joint limits enabled; Revolute joint motor enabled; Prismatic joint limits enabled; Prismatic joint motor enabled; Wheel joint motor enabled; Collision; Collision started; Collision stopped

**Expressions (80):** World scale; World gravity on X axis; World gravity on Y axis; World time scale; Density of the object; Friction of the object; Restitution of the object; Linear damping of the object; Angular damping of the object; Gravity scale of the object; Linear velocity on X axis; Linear velocity on Y axis; Linear velocity; Linear velocity angle; Angular velocity; Mass; Inertia; Mass center X; Mass center Y; Joint first anchor X; Joint first anchor Y; Joint second anchor X; Joint second anchor Y; Joint reaction force; Joint reaction torque; Distance joint length; Distance joint frequency; Distance joint damping ratio; Revolute joint reference angle; Revolute joint current angle; Revolute joint angular speed; Revolute joint minimum angle; Revolute joint maximum angle; Revolute joint motor speed; Revolute joint max motor torque; Revolute joint motor torque; Prismatic joint axis angle; Prismatic joint reference angle; Prismatic joint current translation; Prismatic joint current speed; Prismatic joint minimum translation; Prismatic joint maximum translation; Prismatic joint motor speed; Prismatic joint max motor force; Prismatic joint motor force; Pulley joint first ground anchor X; Pulley joint first ground anchor Y; Pulley joint second ground anchor X; Pulley joint second ground anchor Y; Pulley joint first length; Pulley joint second length; Pulley joint ratio; Gear joint first joint; Gear joint second joint; Gear joint ratio; Mouse joint target X; Mouse joint target Y; Mouse joint max force; Mouse joint frequency; Mouse joint damping ratio; Wheel joint axis angle; Wheel joint current translation; Wheel joint current speed; Wheel joint motor speed; Wheel joint max motor torque; Wheel joint motor torque; Wheel joint frequency; Wheel joint damping ratio; Weld joint reference angle; Weld joint frequency; Weld joint damping ratio; Rope joint max length; Friction joint max force; Friction joint max torque; Motor joint offset X; Motor joint offset Y; Motor joint angular offset; Motor joint max force; Motor joint max torque; Motor joint correction factor

---

## 3D &nbsp;`3D`

**Internal name:** `Scene3D`  ·  **Author:** Florian Rival

Support for 3D in GDevelop: this provides 3D objects and the common features for all 3D objects.

**Behaviors**
- `Base3DBehavior` — *3D capability*: Common features for all 3D objects: position in 3D space (including the Z axis, in addition to X and Y), size (including depth, in addition to width and height), rotation (on X and Y axis, in addition to the Z axis), scale (including Z axis, in addition to X and Y), flipping (on Z axis, in addition to horizontal (Y)/vertical (X) flipping).

**Objects**
- `Model3DObject` — *3D Model*: An animated 3D model, useful for most elements of a 3D game.
- `Cube3DObject` — *3D Box*: A box with images for each face

**Effects (10)**
- `LinearFog` — Fog (linear)
- `ExponentialFog` — Fog (exponential)
- `AmbientLight` — Ambient light
- `DirectionalLight` — Directional light
- `HemisphereLight` — Hemisphere light
- `Skybox` — Skybox
- `HueAndSaturation` — Hue and saturation
- `Exposure` — Exposure
- `Bloom` — Bloom
- `BrightnessAndContrast` — Brightness and contrast.

**Actions (16):** Flip the object on Z; Turn around X axis; Turn around Y axis; Turn around Z axis; Width; Height; Scale; Flip the object horizontally; Flip the object vertically; Pause the animation; Resume the animation; Set crossfade duration; Face image; Tint color; Look at an object; Look at a position

**Conditions (7):** Flipped on Z; Width; Height; Horizontally flipped; Vertically flipped; Animation paused; Animation finished

**Expressions (18):** Forward vector X component; Forward vector Y component; Forward vector Z component; Up vector X component; Up vector Y component; Up vector Z component; Right vector X component; Right vector Y component; Right vector Z component; Camera forward vector X component; Camera forward vector Y component; Camera forward vector Z component; Camera up vector X component; Camera up vector Y component; Camera up vector Z component; Camera right vector X component; Camera right vector Y component; Camera right vector Z component

**Expression + Condition (+Action) (19):** Z (elevation); Center Z position; Depth (size on Z axis); Scale on Z axis; Rotation on X axis; Rotation on Y axis; Height; Scale on X axis; Scale on Y axis; Animation (by number); Animation (by name); Animation speed scale; Face visibility; Camera Z position; Camera X rotation; Camera Y rotation; Camera near plane; Camera far plane; Camera field of view (fov)

---

## 3D physics engine &nbsp;`Physics3DBehavior`

**Internal name:** `Physics3D`

The 3D physics engine simulates realistic object physics, with gravity, forces, collisions, joints, etc. It's perfect for almost all 3D games.

**Behaviors**
- `Physics3DBehavior` — *3D physics engine*: Simulate realistic 3D physics for this object including gravity, forces, collisions, etc.
- `PhysicsCharacter3D` — *3D physics character*: Allow an object to jump and run on platforms that have the 3D physics behavior
- `PhysicsCar3D` — *3D physics car*: Simulate a realistic car using the 3D physics engine. This is mostly useful for the car controlled by the player (it's usually too complex for other cars in a game).

**Actions (28):** Treat as bullet; Fixed rotation; Shape scale; Enable layer; Enable mask; Apply force (at a point); Apply force (at center); Apply force toward position; Apply impulse (at a point); Apply impulse (at center); Apply impulse toward position; Apply torque (rotational force); Apply angular impulse (rotational impulse); Simulate move forward key press; Simulate move backward key press; Simulate move right key press; Simulate move left key press; Simulate jump key press; Simulate stick control; Allow jumping again; Forbid jumping again in the air; Abort jump; Should bind object and forward angle; Forward angle; Maximum falling speed; Simulate hand brake key press; Simulate accelerator stick control; Simulate steering stick control

**Conditions (18):** Is dynamic; Is static; Is kinematic; Is treated as a bullet; Has fixed rotation; Layer enabled; Mask enabled; Collision; Collision started; Collision stopped; Can jump; Is moving; Is on floor; Is jumping; Is falling; Should bind object and forward angle; Forward angle; Character is on given platform

**Expressions (9):** World scale; Mass; Inertia around X; Inertia around Y; Inertia around Z; Mass center X; Mass center Y; Mass center Z; Forward angle of the character

**Expression + Condition (+Action) (39):** World gravity on X axis; World gravity on Y axis; World gravity on Z axis; Density; Shape offset X; Shape offset Y; Shape offset Z; Friction; Restitution; Linear damping; Angular damping; Gravity scale; Linear velocity X; Linear velocity Y; Linear velocity Z; Linear velocity; Angular velocity X; Angular velocity Y; Angular velocity Z; Current forward speed; Forward acceleration; Forward deceleration; Forward max speed; Current sideways speed; Sideways acceleration; Sideways deceleration; Sideways max speed; Current falling speed; Current jump speed; Jump speed; Jump sustain time; Gravity; Maximum falling speed; Steer angle; Engine speed; Current gear; Engine max torque; Engine max speed; Engine inertia

---

## AdMob &nbsp;`AdMob`

**Internal name:** `AdMob`  ·  **Author:** Florian Rival

Allow to display AdMob banners, app open, interstitials, rewarded interstitials and rewarded video ads.

**Actions (16):** Enable test mode; Prevent AdMob auto initialization; Initialize AdMob manually; Load app open; Show app open; Configure the banner; Show banner; Hide banner; Load interstitial; Show interstitial; Load rewarded interstitial; Show rewarded interstitial; Mark the reward of the rewarded interstitial as claimed; Load rewarded video; Show rewarded video; Mark the reward of the rewarded video as claimed

**Conditions (24):** AdMob initializing; AdMob initialized; App open loading; App open ready; App open showing; App open errored; Banner showing; Banner configured; Banner loaded; Banner had an error; Interstitial loading; Interstitial ready; Interstitial showing; Interstitial had an error; Rewarded interstitial loading; Rewarded interstitial ready; Rewarded interstitial showing; Rewarded interstitial had an error; Rewarded Interstitial reward received; Rewarded video loading; Rewarded video ready; Rewarded video showing; Rewarded video had an error; Rewarded Video reward received

---

## Advanced window management &nbsp;`AdvancedWindow`

**Internal name:** `AdvancedWindow`  ·  **Author:** Arthur Pacaud (arthuro555)

Provides advanced features related to the game window positioning and interaction with the operating system.

**Actions (19):** Window focus; Window visibility; Maximize the window; Minimize the window; Enable the window; Allow resizing; Allow moving; Allow maximizing; Allow minimizing; Allow full-screening; Allow closing; Make the window always on top; Enable kiosk mode; Enable window shadow; Enable content protection; Allow focusing; Flash the window; Window opacity; Window position

**Conditions (14):** Window focused; Window visible; Window maximized; Window minimized; Window enabled; Window resizable; Window movable; Window maximizable; Window minimizable; Window full-screenable; Window closable; Window always on top; Kiosk mode; Shadow enabled

**Expressions (3):** Window X position; Window Y position; Window opacity

---

## BBCode Text Object &nbsp;`BBText`

**Internal name:** `BBText`  ·  **Author:** Todor Imreorov

A BBText is an object displaying on the screen a rich text formatted using BBCode markup (allowing to set parts of the text as bold, italic, use different colors and shadows).

**Objects**
- `BBText` — *BBText*: Formatted text allowing to mix styles using BBCode markup.

**Actions (2):** Word wrapping; Font family

**Conditions (2):** BBCode text; Word wrapping

---

## Bitmap Text &nbsp;`BitmapText`

**Internal name:** `BitmapText`  ·  **Author:** Aurélien Vivet

Displays a text using a "Bitmap Font" (an image representing characters). This is more performant than a traditional Text object and it allows for complete control on the characters aesthetic.

**Objects**
- `BitmapTextObject` — *Bitmap Text*: Image-based text.

**Actions (4):** Tint; Bitmap files resources; Alignment; Word wrapping

**Conditions (1):** Word wrapping

**Expressions (1):** Text

**Expression + Condition (+Action) (7):** Text; Opacity; Font size; Scale; Font name; Alignment; Wrapping width

---

## Debugger Tools &nbsp;`DebuggerTools`

**Internal name:** `DebuggerTools`  ·  **Author:** Arthur Pacaud (arthuro555), Aurélien Vivet (Bouh)

Allow to interact with the editor debugger from the game (notably: enable 2D debug draw, log a message in the debugger console).

**Actions (3):** Pause game execution; Draw collisions hitboxes and points; Log a message to the console

---

## Device sensors &nbsp;`DeviceSensors`

**Internal name:** `DeviceSensors`  ·  **Author:** Matthias Meike

Allow the game to access the sensors of a mobile device.

**Actions (4):** Activate orientation sensor; Deactivate orientation sensor; Activate motion sensor; Deactivate motion sensor

**Conditions (10):** Sensor active; Compare the value of orientation alpha; Compare the value of orientation beta; Compare the value of orientation gamma; Compare the value of rotation alpha; Compare the value of rotation beta; Compare the value of rotation gamma; Compare the value of acceleration on X-axis; Compare the value of acceleration on Y-axis; Compare the value of acceleration on Z-axis

**Expressions (7):** Is Absolute; Alpha value; Beta value; Gamma value; Acceleration X value; Acceleration Y value; Acceleration Z value

---

## Device vibration &nbsp;`DeviceVibration`

**Internal name:** `DeviceVibration`  ·  **Author:** Matthias Meike

This allows to trigger vibrations on mobile devices.

**Actions (3):** Vibrate; Vibrate by pattern; Stop vibration

---

## Dialogue Tree &nbsp;`DialogueTree`

**Internal name:** `DialogueTree`  ·  **Author:** Todor Imreorov

Handle dialogue trees, made using Yarn Spinner. Useful to make complex dialogues with multiple choices. The Yarn Spinner editor is embedded in GDevelop so you can edit your dialogues without leaving GDevelop.

**Actions (17):** Load dialogue tree from a scene variable; Load dialogue tree from a JSON file; Start dialogue from branch; Stop running dialogue; Go to the next dialogue line; Confirm selected option; Select next option; Select previous option; Select option by number; Scroll clipped text; Complete clipped text scrolling; Set dialogue state string variable; Set dialogue state number variable; Set dialogue state boolean variable; Save dialogue state; Load dialogue state; Clear dialogue state

**Conditions (12):** Command is called; Dialogue line type; Dialogue is running; Dialogue has branch; Has selected option changed; Current dialogue branch title; Current dialogue branch contains a tag; Branch title has been visited; Compare dialogue state string variable; Compare dialogue state number variable; Compare dialogue state boolean variable; Clipped text has completed scrolling

**Expressions (17):** Get the current dialogue line text; Get the number of options in an options line type; Get the text of an option from an options line type; Get a Horizontal list of options from the options line type; Get a Vertical list of options from the options line type; Get the number of the currently selected option; Get dialogue line text clipped; Get the title of the current branch of the running dialogue; Get the tags of the current branch of the running dialogue; Get a tag of the current branch of the running dialogue via its index; Get the parameters of a command call; Get the number of parameters in the currently passed command; Get parameter from a Tag found by the branch contains tag condition; Get a list of all visited branches; Get the full raw text of the current branch; Get the number stored in a dialogue state variable; Get the string stored in a dialogue state variable

---

## Effects &nbsp;`Effects`

**Internal name:** `Effects`  ·  **Author:** Various contributors from PixiJS, PixiJS filters and GDevelop

Lots of different effects to be used in your game.

**Effects (35)**
- `Adjustment` — Adjustment
- `AdvancedBloom` — Advanced bloom
- `Ascii` — ASCII
- `Bevel` — Beveled edges
- `BlackAndWhite` — Black and White
- `BlendingMode` — Blending mode
- `Blur` — Blur (Gaussian, slow - prefer to use Kawase blur)
- `Brightness` — Brightness
- `BulgePinch` — Bulge Pinch
- `ColorMap` — Color Map
- `ColorReplace` — Color Replace
- `CRT` — CRT
- `Displacement` — Displacement
- `Dot` — Dot
- `DropShadow` — Drop shadow
- `Glitch` — Glitch
- `Glow` — Glow
- `Godray` — Godray
- `HslAdjustment` — HSL Adjustment
- `KawaseBlur` — Blur (Kawase, fast)
- `LightNight` — Light Night
- `MotionBlur` — Motion Blur
- `Night` — Dark Night
- `Noise` — Noise
- `OldFilm` — Old Film
- `Outline` — Outline
- `Pixelate` — Pixelate
- `RadialBlur` — Radial Blur
- `Reflection` — Reflection
- `RGBSplit` — RGB split (chromatic aberration)
- `Sepia` — Sepia
- `Shockwave` — Shockwave
- `TiltShift` — Tilt shift
- `Twist` — Twist
- `ZoomBlur` — Zoom blur

---

## Facebook Instant Games &nbsp;`FacebookInstantGames`

**Internal name:** `FacebookInstantGames`  ·  **Author:** Florian Rival

Allow your game to send scores and interact with the Facebook Instant Games platform.

**Actions (8):** Save player data; Load player data; Save player score; Load player entry; Load and prepare an interstitial ad; Show the loaded interstitial ad; Load and prepare a rewarded video; Show the loaded rewarded video

**Conditions (3):** Check if ads are supported; Is the interstitial ad ready; Is the rewarded video ready

**Expressions (2):** Player identifier; Player name

---

## File system &nbsp;`FileSystem`

**Internal name:** `FileSystem`  ·  **Author:** Matthias Meike

Access the filesystem of the operating system - only works on native, desktop games exported to Windows, Linux or macOS.

**Actions (12):** Create a directory; Save a text into a file; Save a text into a file (Async); Save a scene variable into a JSON file; Save a scene variable into a JSON file (Async); Load a text from a file (Async); Load a text from a file; Load a scene variable from a JSON file; Load a scene variable from a JSON file (Async); Delete a file; Delete a file (Async); Read a directory

**Conditions (1):** File or directory exists

**Expressions (12):** Desktop folder; Documents folder; Pictures folder; Game executable file; Game executable folder; Userdata folder (for application settings); User's Home folder; Temp folder; Path delimiter; Get directory name from a path; Get file name from a path; Get the extension from a file path

---

## Firebase &nbsp;`Firebase`

**Internal name:** `Firebase`  ·  **Author:** Arthur Pacaud (arthuro555)

Use Google Firebase services (database, functions, storage...) in your game.

**Actions (65):** Enable analytics; Log an Event; User UID; Set a user's property; Set Remote Config Auto Update Interval; Set the default configuration; Force sync the configuration; Create account with email; Sign into an account with email; Log out of the account; Sign into an account via an external provider; Sign In as an anonymous guest; Send a password reset email; Send a verification email; Display name; Profile picture; User email; User email (Provider); User password; User password (Provider); Delete the user account; Delete the user account (Provider); Enable performance measuring; Create a custom performance tracker; Start a tracer; Stop a tracer; Record performance; Call a HTTP function; Enable Messaging; Start a query; Start a query from another query; Filter by field value; Filter by field text; Order by field value; Limit amount of documents; Skip some documents; Run a query once; Continuously run (watch) a query; Enable persistence; Disable persistence; Re-enable network; Disable network; Write a document to firestore; Add a document to firestore; Write a field in firestore; Update a document in firestore; Update a field of a document; Delete a document in firestore; Delete a field of a document; Get a document from firestore; Get a field of a document; Check for a document's existence; Check for existence of a document's field; List all documents of a collection; Upload a file; Get Download URL; Write a variable to Database; Write a field in Database; Update a document in Database; Delete a database variable; Delete a field of a variable; Get a variable from the database; Get a field of a variable; Check for a variable's existence; Check for existence of a variable's field

**Conditions (2):** Is the user signed in?; Is the user email address verified

**Expressions (13):** Get Remote setting as String; Get Remote setting as Number; User authentication token; User email address; Accounts creation time; User last login time; User display name; User phone number; User UID; User tenant ID; User refresh token; Profile picture URL; Get server timestamp

---

## Leaderboards &nbsp;`Leaderboards`

**Internal name:** `Leaderboards`  ·  **Author:** Florian Rival

Allow your game to send scores to your leaderboards (anonymously or from the logged-in player) or display existing leaderboards to the player.

**Actions (5):** Save player score; Save connected player score; Always attach scores to the connected player; Display leaderboard; Close current leaderboard

**Conditions (7):** Last score save has errored; Last score save has succeeded; Score is saving; Closed by player; Leaderboard display has errored; Leaderboard display has loaded; Leaderboard display is loading

**Expressions (2):** Error of last save attempt; Format player name

---

## Lights &nbsp;`Lighting`

**Internal name:** `Lighting`  ·  **Author:** Harsimran Virk

This provides a 2D light object, and a behavior to mark other 2D objects as being obstacles for the lights. This is a great way to create a special atmosphere to your game, along with effects, make it more realistic or to create gameplays based on lights.

**Behaviors**
- `LightObstacleBehavior` — *Light Obstacle Behavior*: Flag objects as being obstacles to 2D lights. The light emitted by light objects will be stopped by the object. This does not work on 3D objects and 3D games.

**Objects**
- `LightObject` — *Light*: Displays a 2D light on the scene, with a customizable radius and color. Then add the Light Obstacle behavior to the objects that must act as obstacle to the lights.

**Actions (2):** Light radius; Light color

---

## Multiplayer &nbsp;`Multiplayer`

**Internal name:** `Multiplayer`  ·  **Author:** Florian Rival

This allows players to join online lobbies and synchronize gameplay across devices without needing to manage servers or networking.  Use the "Open game lobbies" action to let players join a game, and use conditions like "Lobby game has just started" to begin gameplay. Add the "Multiplayer object" behavior to game objects that should be synchronized, and assign or change their ownership using player numbers. Variables and game state (like scenes, scores, or timers) are automatically synced by the host, with options to change ownership or disable sync when needed. Common multiplayer logic —like handling joins/leaves, collisions, and host migration— is supported out-of-the-box for up to 8 players per game.

**Behaviors**
- `MultiplayerObjectBehavior` — *Multiplayer object*: Allow the object to be synchronized with other players in the lobby.

**Actions (17):** Join a specific lobby by its ID; Join the next available lobby; Open Game Lobbies; Close Game Lobbies; Allow players to close the lobbies window; End Lobby Game; Leave Game Lobby; Send custom message to other players; Send custom message to other players with a variable; Get message variable; Configure lobby game to end when host leaves; Take ownership of variable; Remove ownership of variable; Disable variable synchronization; Take ownership of object; Remove object ownership; Enable (or disable) the synchronization of a behavior

**Conditions (15):** Is searching for a lobby to join; Quick join failed to join a lobby; Lobbies window is open; Lobby game has just started; Lobby game is running; Lobby game has just ended; Custom message has been received from another player; Player is host; Any player has left; Player has left; Any player has joined; Player has joined; Host is migrating; Player is connected; Is object owned by current player

**Expressions (10):** Current lobby ID; Quick join action failure reason; Player number that just left; Player number that just joined; Message data; Message sender; Player username in lobby; Current player username in lobby; Player ping in lobby; Current player ping in lobby

**Expression + Condition (+Action) (5):** Objects synchronization rate; Number of players in lobby; Current player number in lobby; Player variable ownership; Player object ownership

---

## My Dummy Extension &nbsp;`ExampleJsExtension`

**Internal name:** `MyDummyExtension`  ·  **Author:** Florian Rival

An example of a declaration of an extension

**Behaviors**
- `DummyBehavior` — *Dummy behavior for testing*: Do nothing.
- `DummyBehaviorWithSharedData` — *Dummy behavior with shared data for testing*: Do nothing but use shared data.

**Objects**
- `DummyObject` — *Dummy object for testing*: This dummy object does nothing

**Effects (1)**
- `DummyEffect` — Dummy effect example

**Actions (1):** Display a dummy text in Developer console

**Conditions (1):** Dummy condition example

**Expressions (2):** Dummy expression example; Dummy string expression example

---

## P2P &nbsp;`P2P`

**Internal name:** `P2P`  ·  **Author:** Arthur Pacaud (arthuro555)

Allow game instances to communicate remotely using messages sent via WebRTC (P2P).

**Actions (15):** Connect to another client; Connect to a broker server; Use a custom ICE server; Disable IP address sharing; Connect to the default broker server; Override the client ID; Trigger event on all connected clients; Trigger event on a specific client; Trigger event on all connected clients (variable); Trigger event on a specific client (variable); Get event data (variable); Disconnect from a peer; Disconnect from all peers; Disconnect from broker; Disconnect from all

**Conditions (5):** Event triggered by peer; Is P2P ready; An error occurred; Peer disconnected; Peer Connected

**Expressions (6):** Get event data; Get event sender; Get client ID; Get last error; Get last disconnected peer; Get ID of the connected peer

---

## Player Authentication &nbsp;`PlayerAuthentication`

**Internal name:** `PlayerAuthentication`  ·  **Author:** Florian Rival

Allow your game to authenticate players.

**Actions (4):** Display authentication banner; Hide authentication banner; Open authentication window; Log out the player

**Conditions (3):** Authentication window is open; Player is authenticated; Player has logged in

**Expressions (2):** Username; User ID

---

## Save State (experimental) &nbsp;`SaveState`

**Internal name:** `SaveState`  ·  **Author:** Neyl Mahfouf

Allows to save and load the full state of a game, usually on the device storage. A Save State, by default, contains the full state of the game (objects, variables, sounds, music, effects etc.). Using the "Save Configuration" behavior, you can customize which objects should not be saved in a Save State. You can also use the "Change the save configuration of a variable" action to change the save configuration of a variable. Finally, both objects, variables and scene/game data can be given a profile name: in this case, when saving or loading with one or more profile names specified, only the object/variables/data belonging to one of the specified profiles will be saved or loaded.

**Behaviors**
- `SaveConfiguration` — *Save state configuration*: Allow the customize how the object is persisted in a save state.

**Actions (7):** Save game to a variable; Save game to device storage; Load game from variable; Load game from device storage; Change the save configuration of a variable; Change the save configuration of the global game data; Change the save configuration of a scene data

**Conditions (4):** Save just succeeded; Save just failed; Load just succeeded; Load just failed

**Expression + Condition (+Action) (2):** Time since last save; Time since last load

---

## Screenshot &nbsp;`Screenshot`

**Internal name:** `Screenshot`  ·  **Author:** Matthias Meike

Allows to save screenshots of a running game.

**Actions (1):** Take screenshot

---

## Spatial sound &nbsp;`SpatialSound`

**Internal name:** `SpatialSound`  ·  **Author:** Arthur Pacaud (arthuro555)

Allow positioning sounds in a 3D space. The stereo system of the device is used to simulate the position of the sound and to give the impression that the sound is located somewhere around the player.

**Actions (2):** Set position of sound; Listener position

---

## Spine (experimental) &nbsp;`Spine`

**Internal name:** `SpineObject`  ·  **Author:** Vladyslav Pohorielov

Displays a Spine animation.

**Objects**
- `SpineObject` — *Spine (experimental)*: Display and smoothly animate a 2D object with skeletal animations made with Spine. Use files exported from Spine (json, atlas and image).

**Actions (1):** Set skin

**Expression + Condition (+Action) (10):** Animation mixing duration; Point attachment X position; Point attachment Y position; Point attachment scale world X position; Point attachment scale local X position; Point attachment scale world Y position; Point attachment scale local Y position; Point attachment world rotation; Point attachment local rotation; Get skin name

---

## Steamworks (Steam) (experimental) &nbsp;`Steamworks`

**Internal name:** `Steamworks`  ·  **Author:** Arthur Pacaud (arthuro555)

Adds integrations for Steam's Steamworks game development SDK.

**Actions (20):** Claim achievement; Unclaim achievement; Steam rich presence; Create a lobby; Get a list of lobbies; Join a lobby (by ID); Leave current lobby; Open invite dialogue; Set a lobby attribute; Set the lobby joinability; Get the lobby's members; Get a lobby's members; Activate an action set; Write a file; Delete a file; Create a Workshop item; Update a Workshop item; Subscribe to a Workshop item; Unsubscribe to a Workshop item; Download a Workshop item

**Conditions (13):** Has achievement; Is Steamworks Loaded; Is on Steam Deck; Player owns an application; Player installed an application; Player installed DLC; Player has a VAC ban; Player cannot be exposed to violence; Player bought the game; Digital action activated; Is Steam Cloud enabled?; File exists; Check workshop item state

**Expressions (28):** Steam ID; Name; Country code; Steam Level; Steam AppID; Current time (from the Steam servers); Current lobby's ID; Attribute of the lobby; Member count of the lobby; Member limit of the lobby; Owner of the lobby; Attribute of a lobby; Member count of a lobby; Member limit of a lobby; Owner of a lobby; Get installed app path; Game language; Current beta name; Current app build ID; Controller count; Analog X-Action vector; Analog Y-Action vector; Read a file; Workshop item installation location; Workshop item size; Workshop item installation time; Workshop item download progress; Workshop item download total

---

## Text Input &nbsp;`TextInput`

**Internal name:** `TextInput`  ·  **Author:** Florian Rival

A text field the player can type text into.

**Objects**
- `TextInputObject` — *Text input*: A text field the player can type text into.

**Actions (5):** Font name; Text color; Fill color; Border color; Focus

**Conditions (2):** Focused; Input is submitted

**Expressions (1):** Text

**Expression + Condition (+Action) (12):** Text; Placeholder; Font size; Font name; Input type; Fill opacity; Border opacity; Border width; Read-only; Disabled; Spell check enabled; Opacity

---

## Tile map &nbsp;`TileMap`

**Internal name:** `TileMap`  ·  **Author:** Todor Imreorov

The Tilemap object can be used to display tile-based objects. It's a good way to create maps for RPG, strategy games or create objects by assembling tiles, useful for platformer, retro-looking games, etc... External tilemaps are also supported - but it's recommended to use the built-in, simple Tilemap object for most use cases.

**Objects**
- `TileMap` — *External Tilemap (Tiled/LDtk)*: Tilemap imported from external editors like LDtk or Tiled.
- `SimpleTileMap` — *Tile map*: Grid-based map built from reusable tiles.
- `CollisionMask` — *External Tilemap (Tiled/LDtk) collision mask*: Invisible object handling collisions with parts of a tilemap.

**Actions (16):** Tilemap file (Tiled or LDtk); Tileset JSON file; Display mode; Layer index; Animation speed scale; Animation speed (FPS); Scale; Width; Height; Flip tile vertically (at position); Flip tile horizontally (at position); Remove tile (at position); Flip tile vertically (on the grid); Flip tile horizontally (on the grid); Remove tile (on the grid); Tilemap JSON file

**Conditions (11):** Tilemap file (Tiled or LDtk); Tileset JSON file; Display mode; Layer index; Animation speed scale; Animation speed (FPS); Tile flipped horizontally (at position); Tile flipped vertically (at position); Tile flipped horizontally (on the grid); Tile flipped vertically (on the grid); Tilemap JSON file

**Expressions (9):** Layer index; Animation speed scale; Animation speed (FPS); Tileset column count; Tileset row count; Scene X coordinate of tile; Scene Y coordinate of tile; Tile map grid column coordinate; Tile map grid row coordinate

**Expression + Condition (+Action) (7):** Level index; Scale on X axis; Scale on Y axis; Tile (at position); Tile (on the grid); Grid row count; Grid column count

---

## Tweening &nbsp;`TweenBehavior`

**Internal name:** `Tween`  ·  **Author:** Matthias Meike, Florian Rival

Smoothly animate object properties over time — such as position, rotation scale, opacity, and more — as well as variables. Ideal for creating fluid transitions and UI animations. While you can use tweens to move objects, other behaviors (like platform, physics, ellipse movement...) or forces are often better suited for dynamic movement. Tween is best used for animating UI elements, static objects that need to move from one point to another, or other values like variables.

**Behaviors**
- `TweenBehavior` — *Tween*: Smoothly animate position, angle, scale and other properties of objects.

**Actions (36):** Tween a number in a scene variable; Tween a scene value; Tween a layer value; Tween the camera position; Tween the camera zoom; Tween the camera rotation; Tween number effect property; Tween color effect property; Pause a scene tween; Stop a scene tween; Resume a scene tween; Remove a scene tween; Add object variable tween; Tween a number in an object variable; Tween an object value; Tween object position; Tween object X position; Tween object Z position; Tween object width; Tween object height; Tween object depth; Tween object Y position; Tween object angle; Tween object rotation on X axis; Tween object rotation on Y axis; Tween object scale; Tween object X-scale; Tween object Y-scale; Tween text size; Tween object opacity; Tween object color; Tween object HSL color; Pause a tween; Stop a tween; Resume a tween; Remove a tween

**Conditions (6):** Scene tween exists; Scene tween is playing; Scene tween finished playing; Tween exists; Tween is playing; Tween finished playing

**Expressions (2):** Ease; Tween value

**Expression + Condition (+Action) (1):** Tween progress

---

## Video &nbsp;`Video`

**Internal name:** `Video`  ·  **Author:** Aurélien Vivet

Provides an object to display a video on the scene. The recommended file format is MPEG4, with H264 video codec and AAC audio codec, to maximize the support of the video on different platform and browsers.

**Objects**
- `VideoObject` — *Video*: Displays a video.

**Actions (8):** Play a video; Pause a video; Loop a video; Mute a video; Current time; Volume; Set opacity; Set playback speed

**Conditions (10):** Is played; Is paused; Is looped; Volume; Is muted; Duration; Current time; Is ended; Opacity; Playback speed

**Expressions (5):** Get the volume; Get current time; Get the duration; Get current opacity; Get current playback speed

---
