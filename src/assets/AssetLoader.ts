import { Assets, Texture } from 'pixi.js';

export type AssetManifest = {
  art: Record<string, string>;
  sounds: Record<string, string>;
};

export const ASSETS: AssetManifest = {
  art: {
    // Map tiles
    floortiles:   '/art/map/floortiles.png',
    walltiles:    '/art/map/walltiles.png',
    dark:         '/art/map/dark.png',
    rails:        '/art/map/rails.png',
    spiketrap:    '/art/map/spiketrap.png',
    droptrap:     '/art/map/droptrap.png',
    treasure:     '/art/map/treasure.png',
    mapicons:     '/art/map/mapicons.png',
    spawner:      '/art/map/spawner.png',

    // Player character sheets
    lord_lard_sheet:       '/art/player/lord_lard_sheet.png',
    countess_cruller_sheet: '/art/player/countess_cruller_sheet.png',
    herr_von_speck_sheet:  '/art/player/herr_von_speck_sheet.png',
    duchess_donut_sheet:   '/art/player/duchess_donut_sheet.png',

    // Mobs
    enemy_mummy_anim_48:   '/art/mob/enemy_mummy_anim_48.png',
    enemy_scarab_anim_48:  '/art/mob/enemy_scarab_anim_48.png',
    enemy_snake_anim_48:   '/art/mob/enemy_snake_anim_48.png',
    enemy_bat_32:          '/art/mob/enemy_bat_32.png',
    enemy_pharao_anim_48:  '/art/mob/enemy_pharao_anim_48.png',
    raildroid:             '/art/mob/raildroid.png',

    // Bullets / effects
    bullet:            '/art/effects/bullet.png',
    bullet_buckshot:   '/art/effects/bullet_buckshot.png',
    bullet_flame:      '/art/effects/bullet_flame.png',
    bullet_poison:     '/art/effects/bullet_poison.png',
    bullets:           '/art/effects/bullets.png',
    muzzle:            '/art/effects/muzzle.png',
    plasmaball:        '/art/effects/plasmaball.png',
    bar_blue:          '/art/effects/bar_blue.png',
    bar_green:         '/art/effects/bar_green.png',
    bar_green_underlay: '/art/effects/bar_green_underlay.png',
    bar_outline:       '/art/effects/bar_outline.png',
    sprint_bar:        '/art/effects/sprint_bar.png',
    fx_bombsplosion_big_32:   '/art/effects/fx_bombsplosion_big_32.png',
    fx_bombsplosion_small_32: '/art/effects/fx_bombsplosion_small_32.png',
    fx_enemydie_64:           '/art/effects/fx_enemydie_64.png',
    fx_dust1_24:              '/art/effects/fx_dust1_24.png',
    fx_dust2_12:              '/art/effects/fx_dust2_12.png',
    fx_steam1_24:             '/art/effects/fx_steam1_24.png',
    fx_steam2_12:             '/art/effects/fx_steam2_12.png',

    // Buildings
    turret:    '/art/building/turret.png',
    bomb:      '/art/building/bomb.png',
    harvester: '/art/building/bot_vacuum.png',
    chest_large: '/art/building/chest_large.png',
    chest_small: '/art/building/chest_small.png',

    // Pickups / loot
    pickup_coin_gold_16:    '/art/pickup/pickup_coin_gold_16.png',
    pickup_coin_silver_16:  '/art/pickup/pickup_coin_silver_16.png',
    pickup_coin_bronze_16:  '/art/pickup/pickup_coin_bronze_16.png',
    pickup_gem_diamond_24:  '/art/pickup/pickup_gem_diamond_24.png',
    pickup_gem_ruby_12:     '/art/pickup/pickup_gem_ruby_12.png',
    pickup_gem_emerald_12:  '/art/pickup/pickup_gem_emerald_12.png',

    // Weapons
    weapon_list: '/art/weapons/weapon_list.png',

    // UI / Screen
    titlescreen:    '/art/screen/TITLESCREEN.png',
    background:     '/art/screen/BACKGROUND.png',
    button:         '/art/screen/button.png',
    checkbox:       '/art/screen/checkbox.png',
    game_over:      '/art/screen/game_over.png',
    how_to_play:    '/art/screen/how_to_play.png',
    pause_screen:   '/art/screen/pause_screen.png',
    panel:          '/art/screen/panel/panel.png',
    panel_healthbar: '/art/screen/panel/panel_healthbar.png',
    panel_xpbar:    '/art/screen/panel/panel_xpbar.png',
    p_heart:        '/art/screen/panel/p_heart.png',
    p_coin:         '/art/screen/panel/p_coin.png',
    p_level:        '/art/screen/panel/p_level.png',

    // Shadows
    shadow_north:       '/art/shadows/shadow_north.png',
    shadow_north_east:  '/art/shadows/shadow_north_east.png',
    shadow_north_west:  '/art/shadows/shadow_north_west.png',
    shadow_east:        '/art/shadows/shadow_east.png',
    shadow_west:        '/art/shadows/shadow_west.png',
    shadow_spawner:     '/art/shadows/shadow_spawner.png',
    shadow_bat:         '/art/shadows/shadow_bat.png',
    shadow_coin:        '/art/shadows/shadow_coin.png',

    // Fonts
    font_default:      '/art/fonts/font_default.png',
    font_gold:         '/art/fonts/font_gold.png',
    font_red:          '/art/fonts/font_red.png',
    font_blue:         '/art/fonts/font_blue.png',
    font_gray:         '/art/fonts/font_gray.png',
    font_small_white:  '/art/fonts/font_small_white.png',
    font_small_gold:   '/art/fonts/font_small_gold.png',
    font_small_black:  '/art/fonts/font_small_black.png',

    // Logo
    mojang_logo: '/art/logo/mojang.png',
  },

  sounds: {
    bg1: '/sound/Background 1.ogg',
    bg2: '/sound/Background 2.ogg',
    bg3: '/sound/Background 3.ogg',
    bg4: '/sound/Background 4.ogg',
    theme_title: '/sound/ThemeTitle.ogg',
    theme_end:   '/sound/ThemeEnd.ogg',
    shoot1: '/sound/shoot1.wav',
    shoot2: '/sound/shoot2.wav',
    shoot3: '/sound/shoot3.wav',
    hit1: '/sound/hit1.wav',
    hit2: '/sound/hit2.wav',
    hit3: '/sound/hit3.wav',
    coin1: '/sound/coin1.wav',
    coin2: '/sound/coin2.wav',
    coin3: '/sound/coin3.wav',
    explosion: '/sound/Explosion.wav',
    explosion2: '/sound/Explosion 2.wav',
    death: '/sound/Death.wav',
    enemy_death1: '/sound/Enemy Death 1.wav',
    enemy_death2: '/sound/Enemy Death 2.wav',
    level_up: '/sound/levelUp.wav',
    upgrade: '/sound/Upgrade.wav',
    fall: '/sound/Fall.wav',
    falling_male: '/sound/falling_male.wav',
    falling_female: '/sound/falling_female.wav',
    pharao_dies: '/sound/pharao_dies.wav',
    big_coin: '/sound/Big Coin.wav',
    big_gem: '/sound/Big Gem.wav',
    gem: '/sound/Gem.wav',
    step1: '/sound/Step 1.wav',
    step2: '/sound/Step 2.wav',
    track_place: '/sound/Track Place.wav',
    fail: '/sound/Fail.wav',
  },
};

const textures = new Map<string, Texture>();

export async function loadAllAssets(): Promise<void> {
  const entries = Object.entries(ASSETS.art);
  const bundle = entries.map(([alias, src]) => ({ alias, src }));
  await Assets.load(bundle);

  for (const [key] of entries) {
    textures.set(key, Assets.get<Texture>(key));
  }
}

export function getTexture(key: string): Texture {
  return textures.get(key) ?? Texture.EMPTY;
}
