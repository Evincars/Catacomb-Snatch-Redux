<p align="center">
  <img src="redux-logo.png" alt="Catacomb Snatch Redux" width="800"/>
</p>

<br/>

**Catacomb Snatch Redux** is a TypeScript rewrite of the classic open-source game **Catacomb Snatch**, originally created by Mojang for the Humble Bundle charity event. The game is a 2D top-down shooter/RTS where you defend your catacombs against waves of enemies using towers, weapons, and resource collection.

▶ **Play it:** https://evincars.github.io/Catacomb-Snatch-Redux/

### Tech Stack

| Technology | Role |
|---|---|
| [TypeScript](https://www.typescriptlang.org/) | Type-safe language replacing the original Java |
| [PixiJS](https://pixijs.com/) | 2D WebGL rendering engine |
| [Miniplex](https://github.com/hmans/miniplex) | Entity Component System (ECS) for game logic |
| [Vite](https://vitejs.dev/) | Build tooling and dev server |

The architecture follows a strict ECS pattern: all game objects are entities with components (data), and systems operate on them each tick. Rendering is handled by PixiJS with spritesheets loaded from Tiled-compatible `.tmx` level files.

### Getting started localy

**Prerequisites:** Node.js 22+

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Run gameplay regression tests
npm test

# Build for production
npm run build
```

The dev server runs at `http://localhost:5173`. The production build outputs to `dist/`.

### Gameplay fidelity

- Base equipment prices are 75 coins for a turret, 300 for a harvester, and 500 for a bomb.
  Turret and harvester upgrades cost 500 and 1,000 coins. Prices retain the selected difficulty multiplier.
- Bombs make a quick, 25-pixel directional toss rather than snapping to a tile centre.
  Walls and structures shorten the toss, keeping the bomb beside the obstacle.
- Carriage purchases wait until the spawn track is clear. Carriages stay on connected track through
  bends and reversals; meeting allied carriages exchange a full and empty pot before turning around,
  relaying treasure home along a crowded single track.
- Treasure chests cannot be shot apart or carried. Focus a closed chest and press the use key
  to release mixed treasure. Coins and gems scatter in a short airborne arc before collection begins.
  The open chest disappears after 100 ticks with the bat's effect and sound.
- Collecting treasure creates pickup sparkles and a faint, one-tick flash, with a gap between flashes
  even during continuous collection. Firing makes approaching coins coast to a stop rather than
  freeze abruptly; releasing fire resumes collection. Grounded coins within 16 pixels are picked
  up immediately, even while firing; airborne drops finish scattering before they can be collected.
- Harvesters start with a 60-pixel range. Each upgrade adds one 32-pixel tile: 92 pixels at level two
  and 124 pixels at level three.
  Focus brackets sit around the body rather than the tall antenna.
- Cracked-floor traps deepen on each separate visit and collapse on the third, animating into holes.
  Falling players rotate and descend behind the foreground floor without shrinking, accompanied by
  an exclamation mark. Trap progression and airborne loot are included in saves and co-op snapshots.
  TMX remains the map source; matching bitmap pixels with colour `#0000cc` restore cracked floors
  in the centred map interior (an eight-tile border for the shipped 48×48 bitmaps and 64×64 maps).
- DevMap uses the original bitmap's 48×48 layout, including chests, placed turrets, and spike traps,
  with the standard bases around it. Traps use four animation frames, 10-tick active steps and a
  100-tick rest; the original staggered variants start 30 or 60 ticks later. They hurt grounded
  entities, not flying bats, and prevent building on their tiles.

Terrain uses `@pixi/tilemap` batches instead of a full-map render texture. Animated actors, pickups,
effects, harvesters, spikes and cracked floors use PixiJS `AnimatedSprite`. Their frames are driven
by the game loop with automatic ticker updates disabled, preserving pause, save and co-op timing.
The renderer uses a 512×384 logical viewport at 2× resolution, with an unscaled stage so tilemaps,
actors, pointer coordinates and collision tiles all share the same world coordinates.

## Multiplayer and saves

- Choose **Host multiplayer** from the main menu and select **Guest: Companion** or
  **Guest: Enemy**, then copy the invite link and send it to one other player.
  Once connected, the host chooses the map, difficulty and character, then starts the game.
- The guest can open the link directly or paste it into **Join multiplayer**.
  Companions fight the existing AI on Team One and start at the same spawn.
  Enemies use opposing teams and their own spawn points. Both modes use the host's
  character; the guest has a cyan tint so the two players remain distinguishable.
- The host runs the authoritative simulation. The guest sends controls, not positions or money;
  compressed world snapshots synchronize players, enemies, buildings, loot, terrain and progression.
  Positional sound effects and game notices are forwarded to the guest as well.
  Each player has their own controls, camera, inventory and purse. Combined carried coins count
  toward victory. A player killed in co-op respawns at the base with full health and brief protection;
  the teammate's game continues. Single-player death behavior is unchanged.
- In enemy mode, guns and turrets can damage opposing players, turrets, harvesters and
  carriages. Bombs also damage enemy equipment and destroy enemy-built rails; gunfire
  cannot destroy rails. Opposing equipment cannot be picked up, drained or upgraded.
  Carriages are purchased and unload on their own team's base track.
- Enemy-mode deaths show a centred **10-second respawn countdown**. The dead player
  cannot move, fire, interact or collect coins until respawning at their own base.
  Players inside their own base area are protected from opponent damage, but can fire
  outward. Leaving that area immediately removes this protection.
- Enemy victory depends on **delivered treasure**, not coins carried or spent.
  Each full carriage delivery adds **2%**, matching the original versus game, and still
  drops its 100-coin emerald reward. The bottom HUD shows both teams' delivered percentages.
  The first team to reach 100% wins. Companions retain combined-carried-coin victory.
- The host's pause menu pauses the world; the guest's pause menu only stops their own controls.
  A lost connection pauses the host's run, where it can still be saved. Return to the main menu
  and reload that save to reconnect with a new invite.
- Use **Save game** from the single-player or host pause menu to create a named save or replace
  an existing one. **Saved games** in the main menu supports loading and deleting saves.
  Replacement and deletion ask for confirmation. Saves include the complete world and both
  players' progression, multiplayer mode, delivered treasure and pending respawn countdowns,
  but not the old network connection. Loading a multiplayer save creates a fresh
  host lobby and invite, with the saved mode locked. The guest reconnects into their saved state.
- Saves use this browser's local storage for this site/origin. Clearing site data removes them,
  and a different browser or device will not have them. Storage and connection errors are shown
  explicitly rather than treated as successful saves or joins.

PeerJS uses WebRTC data channels and its public PeerServer for signaling. An internet connection
is needed to establish the session; no application game server is required. Deploy on HTTPS
(localhost also works). Some restrictive networks/NAT combinations may require a separately
configured TURN relay; this version does not bundle or operate one. Keep the host tab open.
Invite links grant access to the session, so share them only with the intended player.

## Computer opponent

- On the difficulty screen, toggle **Opponent: AI** and cycle **AI: Easy / Normal / Hard / Insane**.
  This works in single-player and with a companion guest (not with an enemy guest). The AI takes the
  second base and races the player (or both companions, who share one score line) to 100% delivered
  treasure, using the enemy-mode rules above. It picks a random character different from the host's.
- The bottom HUD shows each side's name and delivered percentage in the original style.
- The AI is an ordinary player entity driven by synthetic controls, so it follows every game rule.
  It fights mobs and opposing players, collects coins, builds turrets and puts harvesters near them,
  empties harvesters, buys better guns, plans and lays track to the treasure, blows open cracked
  walls in the way with bombs, buys carriages and upgrades its equipment.
- Its choices are read from the shop stalls, weapon stats and building definitions (cost, role,
  range, damage), so new guns, turrets or harvesters are used without changes to the AI.
- Difficulty changes reaction time, aim error, fire rate, engagement range, how many turrets and
  carriages it runs, upgrade level, how early it starts laying track, sprinting and when it retreats.
  Hard and Insane AIs also pay 10% / 20% less in their own shop.
- The AI plans its track along the shortest route and blasts cracked walls instead of detouring.
  Every difficulty opens reachable cracked barriers before its rail-building delay and reserves
  the bomb's price before spending on other equipment. Even Easy retreats when badly hurt;
  all difficulties flee lit bombs and only deliberately ignite them from outside the blast.
  It never builds on or right beside rails (players can't build on rails either).
- Each base's turret/harvester/bomb stalls sit on the side of the flag away from its rails. A rival
  base's prices are hidden and its stalls can't be used.

## Original Game

Catacomb Snatch was originally created by Mojang for the 2012 Humble Bundle charity event and later released open-source.

- Original repository: https://github.com/Mojang/CatacombSnatch
- Modified version reference: https://catacombsnatch.net

This project is an independent fan rewrite using modern web technologies, preserving the core gameplay while replacing the entire Java codebase with TypeScript and a component-based architecture.

## License

This project is licensed under the **GNU General Public License v3.0** (GPLv3) - see the [LICENSE](LICENSE) file for details.

### Attribution
Based on the original open-source release of [Catacomb Snatch](https://github.com/Mojang/CatacombSnatch) by Mojang Studios, originally released under the MIT License.

## Deployment

The game is automatically built and deployed to **GitHub Pages** on every new version tag.

1. Update the `version` field in `package.json` (e.g. `"version": "0.1.1"`)
2. Commit the change
3. Push a matching tag:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```