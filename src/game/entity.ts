/**
 * cnsjs - JavaScript C&C Remake
 * @author Anders Evenrud <andersevenrud@gmail.com>
 * @license MIT
 */

import { Entity, Box, randomBetweenInteger } from '../engine';
import { Player } from './player';
import { GameEngine } from './game';
import { GameMap } from './map';
import { cellFromPoint, pointFromCell, CELL_SIZE } from './physics';
import { soundMap, wallNames } from './mix';
import { Vector } from 'vector2d';

export abstract class GameEntity extends Entity {
  public readonly map: GameMap;
  public player?: Player;
  protected offset: Vector = new Vector(0, 0);
  protected cell: Vector = new Vector(0, 0);
  protected rendered: boolean = false;
  protected engine: GameEngine;
  protected selected: boolean = false;
  protected dying: boolean = false;
  protected repairing: boolean = false;
  protected direction: number = 0;
  protected directions: number = 32;
  protected turretDirections: number = 32;
  protected turretDirection: number = -1;
  protected animation: string = '';
  protected health: number = 100;
  protected hitPoints: number = 100;
  protected zIndex: number = 0;
  protected subCell: number = -1;
  protected primary: boolean = false;
  protected storageSlots: number[] = [0, 0]; // Taken / Available

  public constructor(map: GameMap) {
    super();

    this.map = map;
    this.engine = map.engine;
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

  public toJson(): any {
    return {
      cell: this.cell.toObject(),
      health: this.health
    };
  }

  public async init(): Promise<void> {
  }

  public onUpdate(deltaTime: number): void {
  }

  public onRender(deltaTime: number): void {
  }

  protected renderDebug(deltaTime: number, context: CanvasRenderingContext2D): void {
    const x = Math.trunc(this.position.x);
    const y = Math.trunc(this.position.y);
    const length = Math.max(this.dimension.x, this.dimension.y);
    const angle = (270 - (360 * this.direction / this.directions)) % 360;
    const x1 = x + (this.dimension.x / 2);
    const y1 = y + (this.dimension.y / 2);
    const x2 = x1 + Math.cos(Math.PI * angle / 180) * length;
    const y2 = y1 + Math.sin(Math.PI * angle / 180) * length;

    context.strokeStyle = this.isPlayer() ? 'rgba(0, 255, 0, 0.3)' : `rgba(255, 255, 0, 0.3)`;
    context.strokeRect(this.position.x + 0.5, this.position.y + 0.5, this.dimension.x, this.dimension.y);

    context.beginPath();
    context.moveTo(x1 + 0.5, y1 + 0.5);
    context.lineTo(x2 + 0.5, y2 + 0.5);
    context.stroke();

    if (this.turretDirection !== -1) {
      const length = CELL_SIZE / 2;
      const angle = (270 - (360 * this.turretDirection / this.turretDirections)) % 360;
      const x1 = x + (this.dimension.x / 2);
      const y1 = y + (this.dimension.y / 2);
      const x2 = x1 + Math.cos(Math.PI * angle / 180) * length;
      const y2 = y1 + Math.sin(Math.PI * angle / 180) * length;

      context.strokeStyle = 'rgba(255, 0, 0, 0.5)';
      context.beginPath();
      context.moveTo(x1 + 0.5, y1 + 0.5);
      context.lineTo(x2 + 0.5, y2 + 0.5);
      context.stroke();
    }
  }

  public async playSfx(name: string): Promise<void> {
    const count = soundMap[name];
    const suffix = count > 1 ? `-${randomBetweenInteger(1, count)}` : '';
    const source = `SOUNDS.MIX/${name.toLowerCase()}${suffix}.wav`;
    console.debug('GameEntity::playSfx()', { source, name, count });

    return this.engine.playArchiveSfx(source, 'sfx', { position: this.position });
  }

  public die(): boolean {
    if (this.dying) {
      return false;
    }

    this.dying = true;

    return true;
  }

  public harvest(target: GameEntity, report: boolean = false): void {
  }

  public attack(target: GameEntity, report: boolean = false): void {
  }

  public enter(entity: GameEntity, report: boolean = false): boolean {
    const destination = entity.getCell()
      .add(entity.getEnterOffset());

    return this.moveTo(destination, report, true);
  }

  public move(position: Vector, report: boolean = false): boolean {
    return this.moveTo(position, report);
  }

  public sell(): void {
  }

  public repair(): void {
  }

  public deploy(): void {
  }

  public capture(target: GameEntity): void {
  }

  protected moveTo(position: Vector, report: boolean = false, force: boolean = false): boolean {
    return false;
  }

  public takeDamage(value: number): void {
    if (this.health > 0) {
      this.health = Math.max(0, this.health - value);

      console.debug('GameEntity::takeDamage()', value, this.health);
      if (this.health <= 0) {
        this.die();
      }
    }
  }

  public updateWall(): void {
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

  public setPrimary(primary: boolean): void {
    this.primary = primary;
  }

  public setPlayer(player: Player): void {
    this.player = player;
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

  public getArmor(): number {
    return 0;
  }

  public getCell(): Vector {
    return this.cell.clone() as Vector;
  }

  public getDirection(): number {
    return this.direction;
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

  public getHitPoints(): number {
    return this.hitPoints;
  }

  public getPowerProduction(): number {
    return 0;
  }

  public getPowerDrain(): number {
    return 0;
  }

  public getPlayerId(): number {
    return this.player ? this.player.getId() : -1;
  }

  public getRenderBox(): Box {
    return this.getBox();
  }

  public getSelectionBox(): Box {
    return this.getBox();
  }

  public getColor(): string {
    return '#ffffff';
  }

  public getZindex(): number {
    return this.zIndex;
  }

  public getName(): string {
    return '';
  }

  public getSubCell(): number {
    return this.subCell;
  }

  public getStorageSlots(): number {
    return this.storageSlots[1];
  }

  public getStorageValue(): number {
    return this.storageSlots[0];
  }

  public getEnterOffset(): Vector {
    return new Vector(0, 0);
  }

  public getExitOffset(): Vector {
    return new Vector(0, 0);
  }

  public canRotate(): boolean {
    return false;
  }

  public canReveal(): boolean {
    // FIXME: Neutral ?
    return this.isPlayer();
  }

  public canAttack(): boolean {
    return false;
  }

  public canFireTwice(): boolean {
    return false;
  }

  public canHarvest(): boolean {
    return ['HARV'].indexOf(this.getName()) !== -1;
  }

  public canCapture(): boolean {
    return ['E6'].indexOf(this.getName()) !== -1;
  }

  public isFactory(): boolean {
    return ['WEAP', 'AFLD'].indexOf(this.getName()) !== -1;
  }

  public isBarracks(): boolean {
    return ['PYLE', 'HAND'].indexOf(this.getName()) !== -1;
  }

  public isHelipad(): boolean {
    return ['HPAD'].indexOf(this.getName()) !== -1;
  }

  public isRefinery(): boolean {
    return ['PROC'].indexOf(this.getName()) !== -1;
  }

  public isCapturable(): boolean {
    return this.isStructure() && !this.isWall() && !this.isPlayer(); // FIXME
  }

  public isAttackable(source: GameEntity): boolean {
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
    return this.player ? this.player.isSessionPlayer() : false;
  }

  public isCivilian(): boolean {
    return !this.player || this.player.getName() === 'Neutral' || this.player.getName() === 'Special';
  }

  public isDeployable(): boolean {
    return false;
  }

  public isSellable(): boolean {
    return false;
  }

  public isRepairable(): boolean {
    return false;
  }

  public isRepairing(): boolean {
    return this.repairing;
  }

  public isDestroyed(): boolean {
    return this.destroyed || this.dying;
  }

  public isWall(): boolean {
    return wallNames.indexOf(this.getName()) !== -1;
  }

  public isStructure(): boolean {
    return false;
  }

  public isUnit(): boolean {
    return false;
  }

  public isInfantry(): boolean {
    return false;
  }

  public isTiberium(): boolean {
    return false;
  }

  public isPrimary(): boolean {
    return this.primary;
  }
}
