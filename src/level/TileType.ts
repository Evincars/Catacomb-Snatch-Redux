export const enum TileType {
  Floor = 0,
  Hole = 1,
  Rail = 2,
  Sand = 3,
  UnbreakableRail = 4,
  UnpassableSand = 5,
  Wall = 6,
  DropTrap = 7,
  PlayerRail = 8,
  /** Machine/tent pieces of a player's base: solid, but drawn over plain sand. */
  PlayerBase = 9,
}

export const TILE_WIDTH = 32;
export const TILE_HEIGHT = 32;

export type TileData = {
  type: TileType;
  solid: boolean;
  passable: boolean;
  buildable: boolean;
  castsShadow: boolean;
  imageVariant: number;
  /** Cracked walls, which a bomb blast clears away. */
  destroyable?: boolean;
  shadowedNorth: boolean;
  shadowedEast: boolean;
  shadowedWest: boolean;
  shadowedNorthEast: boolean;
  shadowedNorthWest: boolean;
};

export function createTile(type: TileType, imageVariant = 0): TileData {
  const base: TileData = {
    type,
    solid: false,
    passable: true,
    buildable: false,
    castsShadow: false,
    imageVariant,
    shadowedNorth: false,
    shadowedEast: false,
    shadowedWest: false,
    shadowedNorthEast: false,
    shadowedNorthWest: false,
  };

  switch (type) {
    case TileType.Floor:
      return { ...base, buildable: true };
    case TileType.Hole:
      return { ...base };
    case TileType.Wall:
      return { ...base, solid: true, passable: false, castsShadow: true };
    case TileType.Sand:
      return { ...base, buildable: true };
    case TileType.UnpassableSand:
    case TileType.PlayerBase:
      return { ...base, solid: true, passable: false };
    case TileType.Rail:
    case TileType.PlayerRail:
    case TileType.UnbreakableRail:
      return { ...base };
    case TileType.DropTrap:
      return { ...base };
    default:
      return base;
  }
}
