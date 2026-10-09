import { Container, Sprite, Graphics } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { frameTexture } from '../render/Sheets';
import { gameState } from '../game/GameState';
import { Facing } from '../world';
import type { CharacterType } from '../entities/PlayerFactory';

const GW = 320;
const GH = 240;

type CharInfo = {
  id: CharacterType;
  label: string;
  sheet: string;
  desc: string;
};

// Names are split over two lines so neighbouring columns do not collide.
const CHARACTERS: CharInfo[] = [
  { id: 'lord_lard',        label: 'Lord\nLard',        sheet: 'lord_lard_sheet',        desc: 'HP ****\nSPD ***' },
  { id: 'countess_cruller', label: 'Countess\nCruller', sheet: 'countess_cruller_sheet', desc: 'HP ***\nSPD *****' },
  { id: 'herr_von_speck',   label: 'Herr von\nSpeck',   sheet: 'herr_von_speck_sheet',   desc: 'HP *****\nSPD **' },
  { id: 'duchess_donut',    label: 'Duchess\nDonut',    sheet: 'duchess_donut_sheet',    desc: 'HP ***\nSPD ****' },
];

/** One 32x32 sheet cell, drawn at double size so it reads at this resolution. */
const FRAME_SIZE = 32;
const PORTRAIT_SCALE = 2;
const PORTRAIT_SIZE = FRAME_SIZE * PORTRAIT_SCALE;

export class CharacterSelectScene implements Scene {
  container: Container;
  private selected: number;
  private selBoxes: Graphics[] = [];

  constructor(manager: SceneManager) {
    this.container = new Container();
    this.selected = Math.max(0, CHARACTERS.findIndex(c => c.id === gameState.selectedCharacter));

    const bg = new Sprite(getTexture('background'));
    bg.width = GW;
    bg.height = GH;
    this.container.addChild(bg);

    const title = makeTitle('Select Character');
    title.x = GW / 2;
    title.y = 14;
    this.container.addChild(title);

    const colW = (GW - 20) / CHARACTERS.length;
    CHARACTERS.forEach((char, i) => {
      const cx = 10 + i * colW;
      const cy = 40;

      // Idle frame facing south.
      const portrait = new Sprite(frameTexture(char.sheet, 0, Facing.South));
      portrait.scale.set(PORTRAIT_SCALE);
      portrait.x = cx + (colW - PORTRAIT_SIZE) / 2;
      portrait.y = cy;
      portrait.eventMode = 'static';
      portrait.cursor = 'pointer';
      portrait.on('pointertap', () => {
        this.selected = i;
        gameState.selectedCharacter = char.id;
        this.updateSelBoxes();
      });
      this.container.addChild(portrait);

      // Selection highlight
      const box = new Graphics();
      box.x = cx + (colW - PORTRAIT_SIZE) / 2 - 2;
      box.y = cy - 2;
      this.container.addChild(box);
      this.selBoxes.push(box);

      // Name label
      const name = makeText(char.label, 0xffdd88, 8, 'center');
      name.x = cx + colW / 2;
      name.y = cy + PORTRAIT_SIZE + 4;
      this.container.addChild(name);

      // Stats
      const stats = makeText(char.desc, 0xaaaaaa, 7, 'center');
      stats.x = cx + colW / 2;
      stats.y = cy + PORTRAIT_SIZE + 26;
      this.container.addChild(stats);
    });

    this.updateSelBoxes();

    const startBtn = new PixelButton('Play!', 100, 22);
    startBtn.x = GW - 108;
    startBtn.y = GH - 40;
    startBtn.onPress = () => {
      gameState.selectedCharacter = CHARACTERS[this.selected].id;
      manager.goto('in_game');
    };
    this.container.addChild(startBtn);

    const backBtn = new PixelButton('< Back', 80, 22);
    backBtn.x = GW - 108 - 88;
    backBtn.y = GH - 40;
    backBtn.onPress = () => manager.goto('difficulty_select');
    this.container.addChild(backBtn);
  }

  private updateSelBoxes(): void {
    this.selBoxes.forEach((box, i) => {
      box.clear();
      if (i === this.selected) {
        box.rect(0, 0, PORTRAIT_SIZE + 4, PORTRAIT_SIZE + 4).stroke({ color: 0xffcc44, width: 1 });
      }
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
