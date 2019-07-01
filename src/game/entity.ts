/**
 * cnsjs - JavaScript C&C Remake
 * @author Anders Evenrud <andersevenrud@gmail.com>
 * @license MIT
 */
import { Animation, Entity, Box, Sprite, randomBetweenInteger } from '../engine';
import { GameEngine } from './game';
import { GameMap } from './map';
import { pointFromCell, cellFromPoint, CELL_SIZE } from './physics';
import { MIXMapEntityData, MIXObject } from './mix';
import { spriteFromName } from './sprites';
import { MIXGrid, soundMap, healthBarColors } from './mix';
import { Vector } from 'vector2d';

const HEALT_BAR_HEIGHT = 6;

export type GameMapEntityTargetAction = 'attack' | 'patrol';

export interface GameMapEntityTarget {
  entity: GameMapEntity;
  action: GameMapEntityTargetAction;
}

/**
 * Map Entity Animation
 */
export class GameMapEntityAnimation extends Animation {
  public multiplier: number = 1;

  public constructor(name: string, offset: Vector, count: number, speed: number, multiplier: number = 1) {
    super(name, offset, count, speed);
    this.multiplier = multiplier;
  }
}

export abstract class GameMapBaseEntity extends Entity {
  public readonly map: GameMap;
  protected offset: Vector = new Vector(0, 0);
  protected cell: Vector = new Vector(0, 0);
  protected rendered: boolean = false;
  protected engine: GameEngine;
  protected selected: boolean = false;
  protected dying: boolean = false;
  protected direction: number = 0;
  protected directions: number = 32;
  protected animation: string = '';
  protected health: number = 100;
  protected hitPoints: number = 100;

  public constructor(engine: GameEngine, map: GameMap) {
    super();

    this.engine = engine;
    this.map = map;
  }

  public destroy(): void {
    if (!this.destroyed) {
      super.destroy();
      this.map.removeEntity(this);
    }
  }

  public toString(): string {
    return 'TODO'; // TODO
  }

  public async init(): Promise<void> {
  }

  public onUpdate(deltaTime: number): void {
  }

  public onRender(deltaTime: number): void {
  }

  public async playSfx(name: string): Promise<void> {
    const count = soundMap[name];
    const suffix = count > 1 ? `-${randomBetweenInteger(1, count)}` : '';
    const source = `SOUNDS.MIX/${name.toLowerCase()}${suffix}.wav`;
    console.debug('GameMapBaseEntity::playSfx()', { source, name, count });

    return this.engine.playArchiveSfx(source, 'sfx', this.position);
  }

  public die(): boolean {
    return false;
  }

  public attack(target: GameMapBaseEntity, report: boolean = false): void {
  }

  public deploy(): void {
  }

  public moveTo(position: Vector, report: boolean = false): boolean {
    return false;
  }

  public takeDamage(value: number): void {
  }

  public setCell(cell: Vector, updatePosition: boolean = false): void {
    this.cell = cell;

    if (updatePosition) {
      this.setPosition(pointFromCell(cell));
    }
  }

  public setPosition(position: Vector, updateCell: boolean = false): void {
    super.setPosition(position);

    if (updateCell) {
      this.setCell(cellFromPoint(position));
    }
  }

  public setSelected(selected: boolean, report: boolean = false): void {
    this.selected = selected;
  }

  public setHealth(health: number): void {
    this.health = health;
  }

  public getMovementSpeed(): number {
    return 1;
  }

  public getRotationSpeed(): number {
    return 1;
  }

  public getSight(): number {
    return 1;
  }

  public getCell(): Vector {
    return this.cell.clone() as Vector;
  }

  public getCellBox(): Box {
    return {
      x1: this.cell.x,
      x2: this.cell.x + Math.ceil(this.dimension.x / CELL_SIZE), // FIXME
      y1: this.cell.y,
      y2: this.cell.y + Math.ceil(this.dimension.y / CELL_SIZE) // FIXME
    };
  }

  public getTruncatedPosition(offset?: Vector): Vector {
    const v = this.position.clone();
    if (offset) {
      v.subtract(offset);
    }

    return new Vector(Math.trunc(v.x), Math.trunc(v.y));
  }

  public getHealth(): number {
    return this.health;
  }

  public canRotate(): boolean {
    return false;
  }

  public canReveal(): boolean {
    return true;
  }

  public canAttack(): boolean {
    return false;
  }

  public isAttackable(source: GameMapBaseEntity): boolean {
    return !this.isSelectable();
  }

  public isMoving(): boolean {
    return false;
  }

  public isMovable(): boolean {
    return false;
  }

  public isSelectable(): boolean {
    return false;
  }

  public isSelected(): boolean {
    return this.selected;
  }

  public isPlayer(): boolean {
    return false;
  }

  public isDeployable(): boolean {
    return false;
  }

  public isDestroyed(): boolean {
    return this.destroyed;
  }
}

/**
 * Map Entity
 */
export abstract class GameMapEntity extends GameMapBaseEntity {
  public dimension: Vector = new Vector(24, 24);
  public readonly data: MIXMapEntityData;
  protected properties?: MIXObject;
  protected occupy?: MIXGrid;
  protected overlap?: MIXGrid;
  protected sprite?: Sprite;
  protected frame: Vector = new Vector(0, 0);
  protected frameOffset: Vector = new Vector(0, 0);
  protected animations: Map<string, GameMapEntityAnimation> = new Map();
  protected reportSelect?: string;
  protected reportMove?: string;
  protected reportAttack?: string;
  protected reportConstruct?: string;
  protected reportDestroy?: string;

  public constructor(data: MIXMapEntityData, engine: GameEngine, map: GameMap) {
    super(engine, map);
    this.data = data;
    this.direction = this.data.direction || 0;
    this.health = parseInt(String(data.health!), 10) || 1; // FIXME

    this.setCell(data.cell, true);
  }

  public destroy(): void {
    this.toggleWalkableTiles(true);
    super.destroy();
  }

  public toString(): string {
    const s = this.getDamageState();
    return `${this.data.player}:${this.data.name} ${this.health}/${this.hitPoints}H@${s} ${this.getTruncatedPosition().toString()}@${this.cell.toString()}x${this.direction.toFixed(1)} | ${this.animation || '<null>'}@${this.frame.toString()}`;
  }

  public async init(): Promise<void> {
    try {
      this.sprite = spriteFromName(this.getSpriteName());
      await this.engine.loadArchiveSprite(this.sprite);
    } catch (e) {
      console.error('GameMapEntity::init()', 'Failed to load sprite', this.getSpriteName(), e);
    }

    if (this.properties) {
      if (this.properties.OccupyList) {
        this.occupy = this.engine.mix.grids.get(this.properties.OccupyList);
      }
      if (this.properties.OverlapList) {
        this.overlap = this.engine.mix.grids.get(this.properties.OverlapList);
      }
    }

    if (typeof this.data.player === 'number') {
      const xoff = this.getSpritePlayerIndex();
      this.frameOffset.setX(xoff);
    }

    this.toggleWalkableTiles(false);
  }

  public onUpdate(deltaTime: number): void {
    const animation = this.animations.get(this.animation);

    this.updateWall();

    if (animation) {
      animation.onUpdate();
      this.frame = animation.getFrameIndex(this.frameOffset);
    } else {
      this.frame = this.frameOffset;
    }
  }

  protected updateWall(): void {
    if (this.sprite) {
      if (['SBAG', 'CYCL', 'BRIK', 'BARB', 'WOOD'].indexOf(this.data.name) !== -1) {
        const lastFrameIndex = this.frameOffset.y;

        const y = (true ? 0 : 16) + // FIXME
           this.getSimilarEntity(new Vector(0, -1), 1) + // top
           this.getSimilarEntity(new Vector(0, 1), 4) + // bottom
           this.getSimilarEntity(new Vector(-1, 0), 8) + // left
           this.getSimilarEntity(new Vector(1, 0), 2); // right

        if (y != lastFrameIndex) {
          this.frameOffset.setY(y);
          this.sprite.resetLastFrame();
        }
      }
    }
  }

  protected renderDebug(deltaTime: number, context: CanvasRenderingContext2D): void {
    context.strokeStyle = '#00ff00';
    context.fillStyle = 'rgba(0, 255, 0, 0.1)';
    context.fillRect(this.position.x, this.position.y, this.dimension.x, this.dimension.y);

    const x = Math.trunc(this.position.x);
    const y = Math.trunc(this.position.y);
    const length = Math.max(this.dimension.x, this.dimension.y);
    const angle = (270 - (360 * this.direction / this.directions)) % 360;
    const x1 = x + (this.dimension.x / 2);
    const y1 = y + (this.dimension.y / 2);
    const x2 = x1 + Math.cos(Math.PI * angle / 180) * length;
    const y2 = y1 + Math.sin(Math.PI * angle / 180) * length;

    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  }

  protected renderHealthBar(deltaTime: number, context: CanvasRenderingContext2D): void {
    const c = healthBarColors[this.getDamageState()];
    const x = Math.trunc(this.position.x);
    const y = Math.trunc(this.position.y);

    context.fillStyle = '#000000';
    context.fillRect(
      x,
      y - HEALT_BAR_HEIGHT - 2,
      this.dimension.x,
      HEALT_BAR_HEIGHT
    );

    context.fillStyle = c;

    context.fillRect(
      x + 1,
      y - HEALT_BAR_HEIGHT - 1,
      Math.round(this.dimension.x * (this.health / this.hitPoints)) - 2,
      HEALT_BAR_HEIGHT - 2
    );
  }

  protected renderSelectionRectangle(deltaTime: number, context: CanvasRenderingContext2D): void {
    const x = Math.trunc(this.position.x);
    const y = Math.trunc(this.position.y);

    context.lineWidth = 1;
    context.strokeStyle = '#ffffff';
    context.strokeRect(
      x + 1,
      y + 1,
      this.dimension.x - 2,
      this.dimension.y - 2
    );
  }

  protected renderSprite(deltaTime: number, context: CanvasRenderingContext2D, sprite?: Sprite): void {
    const s = sprite || this.sprite;
    if (s) {
      const position = this.getTruncatedPosition(this.offset);
      const canvas = s.render(this.frame, position, context);

      // FIXME: optimize
      if (this.overlap) {
        const h = this.overlap.grid.length;
        const w = h > 0 ? this.overlap.grid[0].length : 0;

        const ocontext = this.map.overlay.getContext();
        ocontext.fillStyle = '#ffffff';

        // FIXME: Maybe instead only re-render top half ?
        // FIXME: The -1 is a temporary workaround because of some confusion
        // with overlapping and rendering order
        for (let y = 0; y < h - 1; y++) {
          for (let x = 0; x < w; x++) {
            let v = this.overlap.grid[y][x];
            if (v === 'x') {
              ocontext.drawImage(
                canvas,
                x * CELL_SIZE,
                y * CELL_SIZE,
                CELL_SIZE,
                CELL_SIZE,
                this.position.x + (x * CELL_SIZE),
                this.position.y + (y * CELL_SIZE),
                CELL_SIZE,
                CELL_SIZE,
              );
            }
          }
        }
      }
    }
  }

  public onRender(deltaTime: number): void {
    if (this.isMoving() && this.sprite) {
      this.sprite.resetLastFrame();
    }

    const context = this.map.overlay.getContext();
    if (this.engine.getDebug()) {
      this.renderDebug(deltaTime, context);
    }

    if (this.isSelected()) {
      this.renderHealthBar(deltaTime, context);
      this.renderSelectionRectangle(deltaTime, context);
    }
  }

  public die(destroy: boolean = true): boolean {
    if (this.dying) {
      return false;
    }

    this.dying = true;

    if (this.reportDestroy) {
      this.playSfx(this.reportDestroy);
    }

    if (destroy) {
      this.destroy();
    }

    return true;
  }

  protected toggleWalkableTiles(t: boolean): void {
    if (!this.occupy) {
      return;
    }

    const h = this.occupy.grid.length;
    const w = h > 0 ? this.occupy.grid[0].length : 0;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = this.occupy.grid[y][x];
        if (v === 'x') {
          this.map.grid.setWalkableAt(this.cell.x + x, this.cell.y + y, t);
        }
      }
    }
  }

  public takeDamage(value: number): void {
    if (this.health > 0) {
      this.health = Math.max(0, this.health - value);

      console.debug('GameMapEntity::takeDamage()', value, this.health);
      if (this.health <= 0) {
        this.die();
      }
    }
  }

  public isDestroyed(): boolean {
    return this.destroyed || this.dying;
  }

  public setSelected(selected: boolean, report: boolean = true): void {
    if (!this.isSelectable()) {
      return;
    }

    this.selected = selected;

    if (this.selected) {
      if (report && this.reportSelect) {
        this.playSfx(this.reportSelect);
      }
    }
  }

  protected getSimilarEntity(offset: Vector, value: number): number {
    const cell = this.cell.clone().add(offset) as Vector;
    const finder = (e: GameMapEntity): boolean => e.data
      ? e.data.name === this.data.name
      : false; // FIXME: Projectiles

    const found = this.map.getEntitiesFromCell(cell, finder);

    return found.length > 0 ? value : 0;
  }

  public getSpritePlayerIndex(): number {
    if (this.data.player! < 2) {
      return Math.max(0, this.data.player!);
    }

    return 0;
  }

  public getSpriteName(): string {
    const prefix = this.data.name.replace(/\d+/, '');
    const matchers = ['T' ,'V', 'TI', 'TC'];

    if (matchers.indexOf(prefix) !== -1) { // FIXME
      // TODO: Add other theatres here
      return `${this.data.theatre.toUpperCase()}.MIX/${this.data.name.toLowerCase()}.png`;
    }

    return `CONQUER.MIX/${this.data.name.toLowerCase()}.png`;
  }

  public getDamageState(): number {
    // TODO: Rules
    const value = Math.max(this.health / this.hitPoints, 0);
    if (value <= 0.25) {
      return 2;
    } else if (value <= 0.50) {
      return 1;
    }
    return 0;
  }

  public canReveal(): boolean {
    // FIXME: Neutral ?
    return this.map.scene.player.getId() === this.data.player;
  }

  public isAttackable(source: GameMapEntity): boolean {
    if (!this.isSelectable()) {
      return false;
    }

    return this.isPlayer() ? false : source.data.player != this.data.player;
  }

  public isPlayer(): boolean {
    return this.map.scene.player.getId() === this.data.player;
  }
}