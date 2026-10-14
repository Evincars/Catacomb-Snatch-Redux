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

# Build for production
npm run build
```

The dev server runs at `http://localhost:5173`. The production build outputs to `dist/`.

### Gameplay fidelity

- Base equipment prices are 75 coins for a turret, 300 for a harvester, and 500 for a bomb.
  Turret and harvester upgrades cost 500 and 1,000 coins. Prices retain the selected difficulty multiplier.
- Bombs make a quick, 25-pixel directional toss rather than snapping to a tile centre.
  Walls and structures shorten the toss, keeping the bomb beside the obstacle.
- Treasure chests cannot be shot apart or carried. Focus a closed chest and press the use key
  to release mixed treasure. The open chest disappears after 100 ticks with the bat's effect and sound.
- Collecting treasure briefly flashes the player and creates pickup sparkles. Firing pauses coins
  already flying toward the player; releasing fire resumes collection.
- DevMap uses the original bitmap's 48×48 layout, including chests, placed turrets, and spike traps,
  with the standard bases around it. Traps use four animation frames, 10-tick active steps and a
  100-tick rest; the original staggered variants start 30 or 60 ticks later. They hurt grounded
  entities, not flying bats, and prevent building on their tiles.

## Co-op multiplayer and saves

- Choose **Host co-op** from the main menu, copy the invite link, and send it to one teammate.
  Once connected, the host chooses the map, difficulty and character, then starts the game.
- The teammate can open the link directly or paste it into **Join co-op**.
  Both players fight the existing AI on Team One, start at the same spawn, and use the host's
  character. The guest has a cyan tint so the two players remain distinguishable.
- The host runs the authoritative simulation. The guest sends controls, not positions or money;
  compressed world snapshots synchronize players, enemies, buildings, loot, terrain and progression.
  Positional sound effects and game notices are forwarded to the guest as well.
  Each player has their own controls, camera, inventory and purse. Combined carried coins count
  toward victory. A player killed in co-op respawns at the base with full health and brief protection;
  the teammate's game continues. Single-player death behavior is unchanged.
- The host's pause menu pauses the world; the guest's pause menu only stops their own controls.
  A lost connection pauses the host's run, where it can still be saved. Return to the main menu
  and reload that save to reconnect with a new invite.
- Use **Save game** from the single-player or host pause menu to create a named save or replace
  an existing one. **Saved games** in the main menu supports loading and deleting saves.
  Replacement and deletion ask for confirmation. Saves include the complete world and both
  players' progression, but not the old network connection. Loading a co-op save creates a fresh
  host lobby and invite. The guest reconnects into their saved state.
- Saves use this browser's local storage for this site/origin. Clearing site data removes them,
  and a different browser or device will not have them. Storage and connection errors are shown
  explicitly rather than treated as successful saves or joins.

PeerJS uses WebRTC data channels and its public PeerServer for signaling. An internet connection
is needed to establish the session; no application game server is required. Deploy on HTTPS
(localhost also works). Some restrictive networks/NAT combinations may require a separately
configured TURN relay; this version does not bundle or operate one. Keep the host tab open.
Invite links grant access to the session, so share them only with your teammate.

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