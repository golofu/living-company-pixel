# Avatar models

`avatarModel.ts` caches one GLTFLoader promise per URL. Every avatar owns its
skeleton, mixer and MeshStandardMaterials; source geometry and accessory geometry
are shared. `Avatar.modelReady` resolves to `true` for a model or `false` for the
original visible fallback. A failed male load never selects a female model.

## Inspected material roles

Each cell is `outfit mesh node / material`. GLTFLoader generates separate Cube
meshes beneath these nodes; coloring uses the outfit ancestor, not Cube names.

| File | Skin | Hair | Eyebrows | Top | Inner | Bottom | Shoes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| f-suit | Suit_Head, Suit_Body, Suit_Feet / Skin | Suit_Head / Hair_Blond | Suit_Head / Hair_Brown | Suit_Body / Black | Suit_Body / White | Suit_Legs / Black | Suit_Feet / Black |
| f-casual | Casual_Head, Casual_Body, Casual_Feet / Skin | Casual_Head / Hair_Blond | Casual_Head / Hair_Brown | Casual_Body / White | No separate layer | Casual_Legs / Orange | Casual_Feet / Grey |
| f-formal | Formad_Head, Formal_Body, Formal_Legs, Formal_Feet / Skin | Formad_Head / Red | Formad_Head / Brown (also eyes) | Formal_Body / LimeGreen | Formal_Body / Gold (belt) | Formal_Legs / LimeGreen | Formal_Feet / Red |
| m-suit | Suit_Head, Suit_Body / Skin | Suit_Head / Hair | Suit_Head / Eyebrows | Suit_Body / Suit | Suit_Body / White, Tie | Suit_Legs / Suit | Suit_Feet / Black |
| m-casual | Casual2_Head / Skin, Skin_Darker; Casual2_Body / Skin | Casual2_Head / Hair | Casual2_Head / Eyebrows | Casual2_Body / LightBrown | No separate layer | Casual2_Legs / LightBlue | Casual2_Feet / Red_Dark, White |

Female suit/casual `Brown` and male `Eye` retain their source eye colors.
Formal's eyes and eyebrows share one primitive, so both receive hairColor.
The male suit's Pistol prop is hidden. Formal's `Formad_Head` spelling is intentional.
The installed male suit has one-sided Body, Legs and Feet primitives. The loader
mirrors those primitives once, swaps L/R skin joint indices and reverses triangle
winding. All people share the repaired geometry; the source glTF is unchanged.

## Posing and preview

The source models face +Z. Scale and grounding are measured at the first
`Idle_Neutral` frame, since the glTF default transforms contain an action pose.
GLTFLoader strips dots from bone names. Limbs extend along bone-local +Y;
seated rotations align that direction with the desired direction in avatar space.
Feet are independent controls under Root, so sitting also repositions each foot.
Hands are named Wrist.L/R in these exports.

The office chair cushion is at y=0.42–0.50. Seated Hips is placed at y=0.55;
thigh slope is calculated from limb lengths to keep feet grounded. This makes
the thighs slope slightly downward rather than forcing a horizontal thigh and
leaving the shorter character's feet floating. Typing wrists are near the
existing desk keyboard height. Hair and glasses are attached to Head; glasses
use the skin head bounds and the measured eye level at 64% of head height.

Run `npm.cmd run dev`, then open:

- `/preview.html?names=ดาวเรือง,ใบเตย,ภูผา&pose=stand`
- `/preview.html?names=ดาวเรือง&pose=sit&view=side`
- `/preview.html?names=ดาวเรือง&pose=type&view=side`
- `/preview.html?pose=walk` for all named looks.
- `/preview.html?names=CEO&pose=stand` for the player.

`pose` supports stand, walk, sit and type. `time=1` stops after one second of
simulation for repeatable captures. `document.title` becomes `ready` after model
loads settle and the first frame renders, including fallback cases. The html
element exposes `data-models` and `data-avatars` for headless checks.

Standing, walking, sitting and typing were captured with headless Chrome;
side views check chair contact and foot grounding. Color, hair and accessories
follow looks.json; photographic likeness has not been independently assessed.

## Validation on Windows (2026-11-12, after 5 review rounds)

`npm.cmd run typecheck` and `npm.cmd run build` pass; the build holds `index.html`, the
lazy `GLTFLoader` chunk and all five files under `dist/client/models/` (no preview page).
`npm.cmd test`: 418 tests, 406 pass, 12 fail. All avatar/look tests pass. The 12 failures are
existing server suites that need Unix shells, symlinks or Git behaviour (processRunner, gitIsolation,
localFileTree); no server file is changed by this work.

Browser (headless Chrome, test copy of the gas office): 30 name tags; firing an agent removes its tag
and figure (30→29), rehiring brings it back (→30); no page errors (only the app's existing favicon 404).

## Bounds
Each file's body sphere is measured once (Idle frame 0) plus a reach margin of half the body height,
shared by every part and clone; parts have no bounding box. A test checks every vertex of all five
models stays inside it while standing, walking, running, sitting, typing and in every gesture.

## Known limits
- Sitting uses one hip height (chair, 0.55) for chairs, sofas and beds, like the original figures.
- Visitors keep the original simple figure.
- Pre-existing upstream: when an agent changes kind, `upsertAgent` sets the agent before `removeAgent`
  deletes it, so the new figure re-enters at the door. Not changed here.

## Preview page
`preview.html` is left out of the normal build. Build it with `PREVIEW=1 npm run build`
(PowerShell: `$env:PREVIEW='1'; npm run build`), then open `/preview.html?names=ชื่อ1,ชื่อ2&pose=stand|walk|sit|type`.

## Lifecycle
`Avatar.dispose()` frees the model (materials, skeletons), the simple figure's own materials and
geometry, and the name tag; world.ts calls it when an agent is removed, changes kind, or a visitor leaves.
A model that finishes loading after dispose is discarded. A failed model load is not cached:
the next avatar retries, and the browser console shows one `[avatar]` warning per failure.
