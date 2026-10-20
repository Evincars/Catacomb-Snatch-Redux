# Catacomb Snatch Redux — rules for AI coding assistants

These rules apply to every AI assistant (Claude, Copilot, Codex, Cursor, Gemini, …) and to human
contributors. This file is the single source of truth: `CLAUDE.md` imports it and
`.github/copilot-instructions.md` is generated from it with `npm run rules:sync` — edit only this file.

You act as a **senior game engine architect** specialising in TypeScript, Pixi.js v8 and ECS
(Miniplex v2). Whenever you write or refactor game code, follow the rules below. When a rule and
existing code disagree, the rule wins: fix the code you touch.

## Before you finish any change

```bash
npm run check   # tsc --noEmit + style gate (nesting, casts) + gameplay tests
npm run build   # production build
```

All three must pass. `npm run lint:style` (`scripts/check-style.mjs`) enforces rules 1 and 5 mechanically.

## 1. No deep nesting (max 2 levels)

- Control flow (`if`, `for`, `while`, `switch`, `try`) nests **at most two levels** inside a function.
  An `else if` chain counts as one level.
- Use **guard clauses** (`if (!condition) continue;` / `return;`) to keep code flat.
- Extract complex boolean conditions into domain-named helpers or locals
  (`isInputStale()`, `canBeShot(bullet, target)`, `const shut = …`).
- Two-dimensional tile scans use `forEachTile` / `someTile` from `src/level/Grid.ts` instead of two
  nested loops with logic inside.

## 2. High-performance game loop (O(1) over O(N²))

- **No unnecessary allocations in code that runs every tick**: no `.find()`, `.filter()`, `.map()`,
  spread copies (`[...query]`) or fresh object/array literals inside per-frame loops.
- **Never call `world.with(...)` inside a function that runs per tick.** Miniplex resolves it by
  normalising the config and scanning every registered query. Declare queries once at module level
  (`const turrets = world.with('position', 'turret');`) or use the shared ones in `q` (`src/world.ts`).
- Pre-compute lookups (`Map<Key, Entity>`, `playerInSlot(slot)`) before iterating instead of
  scanning inside the loop.
- Reuse scratch objects: `BoxPool` / `boxAround(…, out)` (`src/core/geometry.ts`) for collision boxes,
  module-level scratch results for hot queries, pooled Yuka `Vector3`s for steering.
- Spatial questions ("what is within r of here") go through the rbush index
  (`src/ai/perception/spatial.ts`), not a scan of every entity.

## 3. Use the project's libraries — do not reinvent them

| Task | Use | Where |
|---|---|---|
| Entities, components, queries | **Miniplex v2** | `src/world.ts` |
| Graph search: A*, Dijkstra, BFS, priority queue | **Yuka** `AStar`, `Dijkstra`, `BFS`, `PriorityQueue` over `TileGraph` | `src/level/TileGraph.ts`, `src/level/TileSearch.ts` |
| Steering, path following, separation | **Yuka** `Vehicle`, `FollowPathBehavior`, `SeparationBehavior` | `src/ai/execution/driving.ts` |
| Goal arbitration / Utility AI | **Yuka** `Think`, `GoalEvaluator` | `src/ai/decision/utility.ts` |
| State machines (new AI or UI states) | **Yuka** `StateMachine`, `State` | — |
| Math helpers (clamp, random ranges) | **Yuka** `MathUtils` | — |
| 2-D vectors, rectangles, hit boxes | **Pixi.js** `Point`, `Rectangle` (`intersects`, `pad`) | `src/core/geometry.ts` |
| Static terrain batches | **Pixi.js v8** `ParticleContainer` + `Particle` | `src/render/StaticTileLayer.ts` |
| Sprites, animation, rendering | **Pixi.js v8** `Sprite`, `AnimatedSprite`, `Container` | `src/render/` |
| 2-D spatial queries (R-tree) | **rbush** | `src/ai/perception/spatial.ts` |
| Peer-to-peer networking | **PeerJS** (WebRTC) | `src/network/CoopSession.ts` |

- Never write your own A*, Dijkstra, heap, spatial hash, vector or bounding-box class.
- **Yuka first for graphs and pathfinding.** `ngraph.graph` / `ngraph.path` were removed because Yuka
  covers tile pathfinding; add them back only for a graph algorithm Yuka genuinely lacks, and say why.
- `@pixi/tilemap` was removed: Pixi v8's `ParticleContainer` does the job natively.
- Passability and step costs go into the `StepCost` passed to a search, never into the graph topology,
  so one `TileGraph` per level serves every walker without rebuilding.
- New dependencies need a reason a listed library cannot meet.

## 4. Single responsibility

- One system or method does one job. A method that validates, resets and clones is three helpers.
- Systems stay plain functions over queries; a long system becomes a short loop over named
  per-entity helpers (`updateHealthBar`, `fireTurret`, `roll`).
- Scenes orchestrate; game rules (e.g. `outcome()`), persistence and networking live in their own modules.

## 5. TypeScript

- **`satisfies` instead of `as`.** Check a literal against a type with `satisfies` and keep its precise
  type: `export const WEAPON_STATS = {…} as const satisfies Record<WeaponKind, WeaponStats>;`
- Narrow with **type guards** (`isWeaponKind`, `isShopKind`, `isRecord`, `hasKey` in
  `src/core/guards.ts`) rather than casting. Model the domain with literal unions
  (`WeaponKind`, `AIDifficultyName`, `ActionName`) derived from `as const` tuples.
- The only allowed `as` (besides `as const`) is at a **parse boundary** — untrusted input that is fully
  validated right after — with a comment containing "parse boundary" on the line above.
- `strict` is on: no `any`, no non-null assertions on data that may really be missing; use
  `import type` for types.

## 6. Error handling and logging

- Raise **typed errors** from `src/core/errors`: `ValidationError` (bad data: saves, packets, maps),
  `LoadError` (fetch/decode), `NetworkError`, `StateError` (impossible state). Each carries a `code`
  and structured `context`. Use `ensure(condition, message, context)` for validation.
- **Expected failures are values**: return `Result<T>` (`attempt`, `attemptAsync`, `ok`, `err`) from
  operations the caller must handle (loading saves, settings, network actions). Exceptions are for
  bugs and for unwinding out of deep validation.
- **Never swallow an error.** No empty `catch {}` / `.catch(() => {})`. Handle it, or `report(error,
  message, scope)` it, or `reportRejection(promise, …)` a fire-and-forget promise.
- **Never call `console.*`.** Get a scoped logger with `createLog('ai')` and use `debug/info/warn/error`.
  Log sinks extend the abstract `Log` class (`src/core/log/Log.ts`); `ConsoleLog` is installed by
  default. To ship logs elsewhere, write e.g. `class ServerLog extends Log { protected write(entry) {…} }`
  and call `useLog(new ServerLog())` — no other code changes.
- `installGlobalErrorHandlers()` (called in `main.ts`) logs anything that still escapes.
- Show players `error.message`; keep stack traces and context for the log.

## 7. Constants and tuning

- No magic numbers in logic: name them (`const PIT_LOOKAHEAD = 16;`) with a doc comment saying what
  they mean in game terms.
- Tuning tables live together: weapons in `src/entities/WeaponStats.ts` and `BULLET_CONFIGS`;
  difficulties in `src/game/GameState.ts`; computer-player knobs in `src/ai/constants.ts`
  (including `AI_GUN_DAMAGE` — per-difficulty, per-gun damage multipliers — and `AI_DEATH_GOLD`).
- Type such tables with `satisfies Record<Key, Shape>` so a missing or misspelt key is a compile error.

## 8. Design patterns for 2-D games in TypeScript (as used here)

- **Entity Component System** — entities are plain objects of optional components (`Entity` in
  `src/world.ts`); systems are functions over Miniplex queries, run in a fixed order
  (`src/systems/Simulation.ts`). Add a feature by adding a component, a factory change and a system.
- **Factory** — every entity is created by a factory in `src/entities/` (`createPlayer`, `createBullet`).
- **Flyweight / data-driven config** — shared immutable stats (`WEAPON_STATS`, `BULLET_CONFIGS`,
  `SHOP_DEFS`, `MOB_CONFIGS`) referenced by many entities.
- **Object pool** — reuse hot-path objects (`BoxPool`, the darkness sprite pool, scratch controls).
- **Spatial partitioning** — rbush R-tree rebuilt once per tick for AI senses.
- **Fixed-timestep game loop** — simulation advances in whole ticks; presentation runs once per frame;
  animation is driven by ticks, never by Pixi's shared ticker, so pause, saves and co-op stay in sync.
- **Command** — input becomes data (`playerInput`, one-shot `intents`) that systems consume; the same
  path serves the keyboard, the computer players and remote guests.
- **Strategy / Utility AI** — interchangeable `Option`s scored by Yuka `GoalEvaluator`s; the arbiter
  picks the best.
- **State** — scenes (`SceneManager`) and mob behaviour (`ai.type`) are explicit states; reach for Yuka's
  `StateMachine` when a new behaviour needs more than a couple of states.
- **Observer** — narrow callback hooks (`coop.onState`, `noticeEvents.onNotice`) instead of globals.
- **Dirty flag** — `level.tilesDirty` triggers terrain rebuilds only when tiles change.

## 9. Project map

- `src/world.ts` — Miniplex world, `Entity` component types, shared queries `q`.
- `src/systems/` — gameplay and presentation systems; `Simulation.ts` orders them.
- `src/ai/` — computer players: `perception/` → `decision/` (Yuka Think) → `execution/` (Yuka steering).
- `src/level/` — `Level` tile stacks, `TileGraph`/`TileSearch` (Yuka graph search), TMX loading, rendering.
- `src/entities/` — factories and stat tables. `src/render/` — sheets, camera, terrain layers.
- `src/core/` — cross-cutting: `errors/`, `log/`, `geometry.ts`, `guards.ts`, `debugHooks.ts`.
- `src/game/` — game state, settings, saves, world capture/validation. `src/network/` — co-op.
- `tests/gameplay.test.mjs` — Node test runner over the real modules via Vite SSR.

## 10. Working conventions

- Match the surrounding code: comment density, naming, doc comments that explain game intent ("why").
- Keep behaviour identical when refactoring; add or update a test in `tests/gameplay.test.mjs` for any
  behaviour change.
- Do not commit, push or publish unless asked.
