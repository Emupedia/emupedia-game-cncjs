/**
 * cnsjs - JavaScript C&C Remake
 * @author Anders Evenrud <andersevenrud@gmail.com>
 * @license MIT
 */
import { Animation, Sprite } from '../../engine';
import { Player } from '../player';
import { GameMap } from '../map';
import { getSubCellOffset, cellFromPoint, getDirection, getNewDirection, CELL_SIZE } from '../physics';
import { MIXGrid, MIXMapEntityData, MIXObject, humanDirections } from '../mix';
import { HealthBarEntity } from './health';
import { StorageBarEntity } from './storage';
import { spriteFromName } from '../sprites';
import { Weapon } from '../weapons';
import { GameEntity } from '../entity';
import { Vector } from 'vector2d';

const SPEED_DIVIDER = 20;
const TURNSPEED_DIVIDER = 8;

export type GameMapEntityTargetAction = 'attack' | 'harvest' | 'enter' | 'capture' | 'bomb' | 'harvest-return';

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

/**
 * Map Entity
 */
export abstract class GameMapEntity extends GameEntity {
  public player?: Player;
  public readonly properties?: MIXObject;
  protected dimension: Vector = new Vector(24, 24);
  protected readonly data: MIXMapEntityData;
  protected exit?: MIXGrid;
  protected occupy?: MIXGrid;
  protected overlap?: MIXGrid;
  protected sprite?: Sprite;
  protected frame: Vector = new Vector(0, 0);
  protected frameOffset: Vector = new Vector(0, 0);
  protected animations: Map<string, GameMapEntityAnimation> = new Map();
  protected healthBar: HealthBarEntity = new HealthBarEntity(this);
  protected storageBar?: StorageBarEntity;
  protected reportLoss?: boolean;
  protected reportSelect?: string;
  protected reportMove?: string;
  protected reportAttack?: string;
  protected reportConstruct?: string;
  protected reportDestroy?: string;
  protected targetSubCell: number = -1;
  protected targetDirection: number = -1;
  protected targetPosition?: Vector;
  protected targetEntity?: GameMapEntity;
  protected targetAction?: GameMapEntityTargetAction;
  protected currentPath: Vector[] = [];
  protected currentAction?: GameMapEntityTargetAction;
  protected primaryWeapon?: Weapon;
  protected secondaryWeapon?: Weapon;

  public constructor(data: MIXMapEntityData, map: GameMap) {
    super(map);
    this.data = data;
    this.direction = this.data.direction || 0;
    this.health = parseInt(String(data.health!), 10) || 1; // FIXME
    this.player = typeof data.player === 'number'
      ? map.getPlayerById(data.player)
      : undefined;

    this.setCell(data.cell, true);
  }

  public destroy(): void {
    this.toggleWalkableTiles(true);
    super.destroy();
  }

  public toString(): string {
    const s = this.getDamageState();
    return `${this.getPlayerId()}:${this.data.name} ${this.health}/${this.hitPoints}H@${s} ${this.getTruncatedPosition().toString()}@${this.cell.toString()}x${this.direction.toFixed(1)} (s: ${this.subCell} t:${this.turretDirection.toFixed(1)}) | ${this.animation || '<null>'}@${this.frame.toString()} ${this.zIndex}z`;
  }

  public toJson(): any {
    return {
      ...this.data,
      ...super.toJson(),
      health: this.health,
      direction: this.direction
    };
  }

  public async init(): Promise<void> {
    if (this.properties) {
      this.hitPoints = this.properties.HitPoints;
      if (this.data.health) {
        this.health = Math.min(this.hitPoints, this.health);
      } else {
        this.health = this.hitPoints;
      }

      if (this.properties.PrimaryWeapon) {
        this.primaryWeapon = new Weapon(this.properties.PrimaryWeapon, this.map, this);
        try {
          await this.primaryWeapon.init();
        } catch (e) {
          console.warn('PrimaryWeapon exception', e);
        }
      }

      if (this.properties.SecondaryWeapon) {
        this.secondaryWeapon = new Weapon(this.properties.SecondaryWeapon, this.map, this);
        try {
          await this.secondaryWeapon.init();
        } catch (e) {
          console.warn('SecondaryWeapon exception', e);
        }
      }
    }

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
      if (this.properties.ExitList) {
        this.exit = this.engine.mix.grids.get(this.properties.ExitList);
      }
    }

    if (this.canHarvest()) {
      humanDirections.reduce((accumulator: number, d: string) => {
        const name = `Harvest-${d}`;
        this.animations.set(name, new GameMapEntityAnimation(name, new Vector(0, accumulator), 4, 0.1));
        return accumulator + 4;
      }, this.directions);
    }

    if (this.getStorageSlots() > 0) {
      this.storageBar = new StorageBarEntity(this, this.engine);
      await this.storageBar.init();
    }

    this.toggleWalkableTiles(false);
  }

  public onUpdate(deltaTime: number): void {
    const animation = this.animations.get(this.animation);
    const xoff = this.getSpritePlayerIndex();
    this.frameOffset.setX(xoff);

    if (animation) {
      animation.onUpdate();
      this.frame = animation.getFrameIndex(this.frameOffset);
    } else {
      this.frame = this.frameOffset;
    }

    if (!this.dying) {
      this.tick(deltaTime);
    }
  }

  protected tick(deltaTime: number): void {
    if (this.primaryWeapon) {
      this.primaryWeapon.onUpdate(deltaTime);
    }

    if (this.secondaryWeapon) {
      this.secondaryWeapon.onUpdate(deltaTime);
    }

    if (this.targetEntity) {
      if (this.targetEntity.isDestroyed()) {
        this.targetEntity = undefined;
      }
    }

    const rotationSpeed = this.getRotationSpeed() / TURNSPEED_DIVIDER;

    this.currentAction = undefined;

    if (this.targetEntity) {
      const targetCell = this.targetEntity.getCell();
      const direction = getDirection(targetCell, this.cell, this.directions);
      const turretDirection = getDirection(targetCell, this.cell, this.turretDirections);
      const distance = Math.floor(targetCell.distance(this.cell)); // FIXME: Rounding off makes this less accurate
      const sight = this.targetAction === 'harvest' ? 0 : this.getWeaponSight();
      const turretReached = Math.round(this.turretDirection) === turretDirection;
      const rotateTurret = this.properties!.HasTurret && !this.properties!.NoTurretLock;
      if (rotateTurret && !turretReached) {
        this.turretDirection = getNewDirection(this.turretDirection, turretDirection, rotationSpeed * 4, this.turretDirections);
      } else if (distance <= sight) {
        if (!this.canRotate()) {
          this.direction = direction;
        }

        if (!rotateTurret) {
          this.turretDirection = turretDirection;
        }

        this.targetPosition = undefined;
        this.currentPath = [];
        this.currentAction = this.targetAction;
      } else if (this.currentPath.length === 0 && this.targetPosition === undefined) {
        this.moveTo(targetCell, false, true);
      }
    }

    if (this.currentAction === 'attack') {
      this.primaryWeapon!.fire(this.targetEntity!);
    } else if (this.currentAction === 'harvest') {
      this.harvestResource(this.targetEntity!);
    } else if (this.targetDirection !== -1) {
      this.direction = getNewDirection(this.direction, this.targetDirection, rotationSpeed, this.directions);

      if (Math.round(this.direction) === this.targetDirection) {
        this.targetDirection = -1;
      }
    } else if (this.targetPosition) {
      const vel = this.getMovementVelocity();
      if (vel) {
        this.position.subtract(vel);
        this.cell = cellFromPoint(new Vector(
          Math.floor(this.position.x),
          Math.floor(this.position.y)
        ));
      } else {
        this.subCell = this.targetSubCell;
        this.targetSubCell = -1;
        this.targetPosition = undefined;
        this.targetDirection = -1;
      }
    } else {
      if (this.currentPath.length > 0) {
        const destination = this.currentPath.shift() as Vector;
        this.targetPosition = destination.clone().mulS(CELL_SIZE) as Vector;

        if (this.currentPath.length === 0 && this.targetSubCell !== -1) { // FIXME
          const offset = getSubCellOffset(this.targetSubCell, this.getDimension());
          this.targetPosition.add(offset);
        }

        const direction = getDirection(this.targetPosition, this.position, this.directions);
        if (this.canRotate()) {
          this.targetDirection = direction;
        } else {
          this.direction = direction;
          this.targetDirection = -1;
        }
      } else {
        this.targetDirection = -1;
      }
    }
  }

  protected renderSprite(deltaTime: number, context: CanvasRenderingContext2D, sprite?: Sprite, frame?: Vector): void {
    const s = sprite || this.sprite;
    const f = frame || this.frame;

    if (s) {
      const position = this.getTruncatedPosition(this.offset);
      const canvas = s.render(f, position, context);

      // FIXME: optimize
      if (this.overlap) {
        const h = this.overlap.grid.length;
        const w = h > 0 ? this.overlap.grid[0].length : 0;

        const ocontext = this.map.overlay.getContext();

        // FIXME: Maybe instead only re-render complete rows ? (like top half)
        for (let y = 0; y < h; y++) {
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
    const context = this.map.overlay.getContext();
    if (this.engine.getDebug()) {
      this.renderDebug(deltaTime, context);
    }

    if (this.isSelected()) {
      this.healthBar.render(deltaTime, context);
      this.map.selection.render(this, context);

      if (this.storageBar) {
        this.storageBar.render(deltaTime, context);
      }
    }

  }

  public die(destroy: boolean = true): boolean {
    if (super.die()) {
      this.targetDirection = -1;
      this.targetPosition = undefined;
      this.currentPath = [];
      this.targetEntity = undefined;
      this.targetAction = undefined;

      if (this.reportLoss) {
        if (this.isPlayer()) {
          this.engine.playArchiveSfx('SPEECH.MIX/unitlost.wav', 'gui', { block: true });
        }
      }

      if (this.reportDestroy) {
        this.playSfx(this.reportDestroy);
      }

      if (destroy) {
        this.destroy();
      }

      return true;
    }

    return false;
  }

  public harvest(target: GameMapEntity, report: boolean = false): void {
    this.targetEntity = target;
    this.targetAction = 'harvest';

    if (report && this.reportMove) {
      this.playSfx(this.reportMove);
    }
  }

  public attack(target: GameMapEntity, report: boolean = false) {
    this.targetEntity = target;
    this.targetAction = 'attack';

    if (report && this.reportAttack) {
      this.playSfx(this.reportAttack);
    }
  }

  public move(position: Vector, report: boolean = false): boolean {
    this.targetEntity = undefined;
    this.targetAction = undefined;

    return this.moveTo(position, report);
  }

  protected harvestResource(target: GameMapEntity): void {
  }

  protected moveTo(position: Vector, report: boolean = false, force: boolean = false): boolean {
    const src = this.cell;
    const dst = position;
    const path = this.map.createPath(src, dst, force);

    this.targetSubCell = -1;
    this.targetDirection = -1;
    this.targetPosition = undefined;
    this.currentPath = path;

    if (report && this.reportMove) {
      this.playSfx(this.reportMove);
    }

    console.log('GameMapEntity::moveTo()', { path, src, dst }, this);

    return path.length > 0;
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
          try {
            this.map.grid.setWalkableAt(this.cell.x + x, this.cell.y + y, t);
          } catch (e) {
            console.debug('Could not apply walkable', e);
          }
        }
      }
    }
  }

  public isMoving(): boolean {
    return !!this.targetPosition || this.targetDirection !== -1;
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
    const finder = (e: GameMapEntity): boolean => e.getName() === this.data.name;
    const found = this.map.getEntitiesFromCell(cell, finder);

    return found.length > 0 ? value : 0;
  }

  public getSpritePlayerIndex(): number {
    const num = this.getPlayerId();
    if (num < 2) {
      return Math.max(0, num);
    }

    return 0;
  }

  public getSpriteName(): string {
    const prefix = this.data.name.replace(/\d+/, '');
    const matchers = ['T' ,'V', 'TI', 'TC', 'SPLIT'];

    if (matchers.indexOf(prefix) !== -1) { // FIXME
      return `${this.map.getTheatre().toUpperCase()}.MIX/${this.data.name.toLowerCase()}.png`;
    }

    return `CONQUER.MIX/${this.data.name.toLowerCase()}.png`;
  }

  public getDamageState(): number {
    const rules = this.engine.mix.getGeneralRules();
    const value = Math.max(this.health / this.hitPoints, 0);
    if (value <= rules.ConditionRed) {
      return 2;
    } else if (value <= rules.ConditionYellow) {
      return 1;
    }
    return 0;
  }

  public getArmor(): number {
    return this.properties
      ? this.properties.Armor || 0
      : 0;
  }

  public getColor(): string {
    // FIXME
    return this.isPlayer()
      ? '#00ff00'
      : '#ff0000';
  }

  public getName(): string {
    return this.data.name;
  }

  public getMovementSpeed(): number {
    return this.properties
      ? this.properties.Speed || 0
      : 0;
  }

  public getWeaponSight(): number {
    // FIXME
    if (this.primaryWeapon || this.secondaryWeapon) {
      return ((this.primaryWeapon || this.secondaryWeapon) as Weapon).weapon.Range;
    }

    return this.getSight();
  }

  public getSight(): number {
    return this.properties
      ? this.properties.Sight as number
      : 0;
  }

  public getMovementVelocity(): Vector | undefined {
    const speed = this.getMovementSpeed() / SPEED_DIVIDER;
    const direction = getDirection(this.targetPosition!, this.position, this.directions);
    const angleRadians = (direction / this.directions) * 2 * Math.PI;
    const vel = new Vector(speed * Math.sin(angleRadians), speed * Math.cos(angleRadians));
    const distance = this.targetPosition!.distance(this.position);

    return distance > speed ? vel : undefined;
  }

  // FIXME
  public getExitOffset(): Vector {
    if (this.exit) {
      const off = this.exit.offset || new Vector(0, 0);
      for (let y = 0; y < this.exit.grid.length; y++) {
        let row = this.exit.grid[y];
        for (let x = 0; x < row.length; x++) {
          if (row[x] === '.') {
            return (new Vector(x, y)).subtract(off);
          }
        }
      }
    }

    return new Vector(0, 0);
  }

  public canAttack(): boolean {
    return !!this.primaryWeapon || !!this.secondaryWeapon;
  }

  public isAttackable(source: GameMapEntity): boolean {
    if (!this.isSelectable()) {
      return false;
    }

    return this.isPlayer() ? false : source.data.player != this.getPlayerId();
  }
}

