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