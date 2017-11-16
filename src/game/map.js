/*!
 * cncjs
 * @author Anders Evenrud <andersevenrud@gmail.com>
 * @license MIT
 */
import PF from 'pathfinding';
import Fog from './fog';
import MapObject from './mapobject';
import TileObject from './objects/tile';
import UnitObject from './objects/unit';
import OverlayObject from './objects/overlay';
import TerrainObject from './objects/terrain';
import StructureObject from './objects/structure';
import EffectObject from './objects/effect';
import ProjectileObject from './objects/projectile';
import Sprite from '../engine/sprite';
import {copy} from '../engine/util';
import {TILE_SIZE} from './globals';
import {pointFromTile, tileFromPoint, tileFromIndex} from './physics';
import {collideAABB, collidePoint} from '../engine/physics';

const ObjectMap = {
  structure: StructureObject,
  unit: UnitObject,
  infantry: UnitObject,
  aircraft: UnitObject,
  terrain: TerrainObject,
  overlay: OverlayObject,
  smudge: OverlayObject
};

/**
 * Game Map Implementation Class
 */
export default class Map {

  /**
   * @param {Engine} engine Game Engine reference
   * @param {String} theatre Theatre mix file
   * @param {Object} level Level data
   */
  constructor(engine, theatre, level) {
    this.engine = engine;

    this.canvas = document.createElement('canvas');
    this.context = this.canvas.getContext('2d');
    this.fog = new Fog(engine, this);

    this.theatre = theatre;
    this.id = '';
    this.tilesX = 0;
    this.tilesY = 0;
    this.width = 0;
    this.height = 0;
    this.visibleObjects = 0;
    this.baseGrid = [];
    this.grid = [];
    this.previousGrid = [];
    this.objects = [];
    this.selectedObjects = [];
    this.cellTriggers = [];
    this.loaded = false;

    console.log('Map::constructor()');
  }

  /**
   * Loads the Map
   * @param {Object} data Game Level Data from JSON
   */
  async load(data) {
    console.group('Map::load()');
    console.info(data);

    this.id = data.id;
    this.tilesX = data.width;
    this.tilesY = data.height;
    this.width = (this.tilesX * TILE_SIZE);
    this.height = (this.tilesY * TILE_SIZE);
    this.grid = Array(...Array(this.tilesY)).map(() => Array(this.tilesX));
    this.previousGrid = Array(...Array(this.tilesY)).map(() => Array(this.tilesX));
    this.cellTriggers = Object.keys(data.cellTriggers).map((p) => {
      const {tileX, tileY} = tileFromIndex(p, data.width);
      return {
        tileX,
        tileY,
        name: data.cellTriggers[p]
      };
    });

    this.canvas.width = this.width;
    this.canvas.height = this.height;

    await this.fog.load();

    // Terrain tiles
    for ( let x = 0; x < this.tilesX; x++ ) {
      for ( let y = 0; y < this.tilesY; y++ ) {
        let i = data.tiles[y][x];
        try {
          await Sprite.preload(this.engine, i[0], this.theatre);
        } catch ( e ) {}

        let obj = new TileObject(this.engine, x, y, i);
        obj.render(this.context);

        if ( !i[3] ) {
          this.addToGrid({
            tileX: x,
            tileY: y,
            id: i[0]
          });
        }
      }
    }

    // Terrain objects
    for ( let i = 0; i < data.terrain.length; i++ ) {
      await this.addObject(data.terrain[i], 'terrain');
    }

    // Overlays
    for ( let i = 0; i < data.smudge.length; i++ ) {
      await this.addObject(data.smudge[i], 'smudge');
    }

    for ( let i = 0; i < data.overlays.length; i++ ) {
      await this.addObject(data.overlays[i], 'overlay');
    }

    // Objects
    for ( let i = 0; i < data.entities.length; i++ ) {
      await this.addObject(data.entities[i]);
    }

    this.loaded = true;
    this.baseGrid = copy(this.grid);
    this._sortObjects();

    console.groupEnd();
  }

  /**
   * Draws the Map onto target
   *
   * @param {CanvasRenderingContext2D} target Render context
   * @param {Number} delta Render delta time
   */
  render(target, delta) {
    const {vx, vy, vw, vh} = this.engine.getViewport();
    const {offsetX, offsetY} = this.engine.getOffset();

    const rect = {
      x1: offsetX,
      y1: offsetY,
      x2: offsetX + vw,
      y2: offsetY + vh
    };

    target.drawImage(this.canvas, offsetX, offsetY, vw, vh, vx, vy, vw, vh);

    const objects = this.getObjectsFromRect(rect);

    if ( this.engine.options.debug > 1 ) {
      target.strokeStyle = 'rgba(0, 0, 0, .1)';
      target.fillStyle = 'rgba(255, 0, 0, .1)';

      for ( let x = 0; x < this.tilesX; x++ ) {
        target.fillRect(-offsetX + (x * TILE_SIZE), -offsetY, 1, this.height);

        for ( let y = 0; y < this.tilesY; y++ ) {
          target.fillRect(-offsetX, -offsetY + (y * TILE_SIZE), this.width, .1);

          if ( this.queryGrid(x, y, 'value') !== 0 ) {
            const cr = pointFromTile(x, y);
            target.fillRect(-offsetX + cr.x, -offsetY + cr.y, TILE_SIZE, TILE_SIZE);
          }
        }
      }
    }

    for ( let i = 0; i < objects.length; i++ ) {
      objects[i].renderOverlay(target, delta);
    }

    for ( let i = 0; i < objects.length; i++ ) {
      objects[i].render(target, delta);
    }

    for ( let i = 0; i < this.selectedObjects.length; i++ ) {
      let o = this.selectedObjects[i];
      o.renderSelection(target);
      o.renderHealthBar(target);
    }

    this.fog.render(target, delta);

    this.visibleObjects = objects.length;
  }

  /**
   * Updates the Map
   */
  update() {
    this.previousGrid = copy(this.grid);
    this.grid = copy(this.baseGrid);

    this.fog.update();

    for ( let i = 0; i < this.objects.length; i++ ) {
      let o = this.objects[i];
      o.update();

      if ( o.isBlocking() ) {
        this.addToGrid(o);
      }
    }
  }

  /**
   * Unselects all active objects
   */
  unselect() {
    this.selectedObjects
      .forEach((obj) => obj.select(false));

    this.selectedObjects = [];
  }

  /**
   * Selects a list of objects
   * @param {MapObject[]} list Object list
   */
  select(list) {
    this.unselect();

    this.selectedObjects = list.map((obj, idx) => {
      obj.select(true, true);
      return obj;
    });
  }

  /**
   * Adds an object to the map
   * @param {MapObject} obj Object
   */
  _addObject(obj) {
    this.objects.push(obj);
    this._sortObjects();
  }

  /**
   * Sorts objects to rendering order
   */
  _sortObjects() {
    if ( this.loaded ) {
      this.objects.sort((a, b) => a.zIndex - b.zIndex);
    }
  }

  /**
   * Adds a effect (overlay) object to the map
   * @param {Object} args Arguments
   * @param {MapObject} [targetObject] Apply effect on an object
   */
  async addEffect(args, targetObject) {
    await Sprite.preload(this.engine, args.id);

    args = targetObject ? Object.assign({}, args, {
      tileX: targetObject.tileX,
      tileY: targetObject.tileY,
      xOffset: -targetObject.xOffset,
      yOffset: -targetObject.yOffset
    }) : args;

    this._addObject(new EffectObject(this.engine, args));
  }

  /**
   * Adds a projectile (overlay) object to the map
   * @param {MapObject} from From object
   * @param {MapObject} to To object
   * @param {Object} weapon Weapon
   * @return {MapObject}
   */
  async addProjectile(from, to, weapon) {
    if ( !weapon.Projectile ) {
      return false;
    }

    try {
      await Sprite.preload(this.engine, weapon.Projectile.Image);
    } catch ( e ) {}

    return this._addObject(new ProjectileObject(this.engine, from, to, weapon));
  }

  /**
   * Adds an object to the map
   * @param {Object} args Arguments
   * @param {String} [type] Object type
   */
  async addObject(args, type = null) {
    const col = args.type === 'terrain' ? this.theatre : 0;
    type = type || args.type;

    if ( !type ) {
      console.warn('Invalid object type given', type, args);
      return;
    }

    try {
      await Sprite.preload(this.engine, args.id, col);

      if ( args.type === 'structure' ) {
        await Sprite.preload(this.engine, args.id + 'make', 0); // FIXME: Are these colored in conversion ?
      }
    } catch ( e ) {}

    const obj = new ObjectMap[type](this.engine, args);

    this._addObject(obj);
  }

  /**
   * Removes an object from map
   * @param {MapObject} obj Object instance
   */
  removeObject(obj) {
    if ( obj instanceof MapObject ) {
      const foundSelected = this.selectedObjects.indexOf(obj);
      const found = this.objects.indexOf(obj);

      if ( found !== -1 ) {
        this.objects.splice(found, 1);
      }

      if ( foundSelected !== -1 ) {
        this.selectedObjects.splice(foundSelected, 1);
      }
    }
  }

  /**
   * Peforms an action on given Point
   * @param {String} action Action name
   * @param {*} args Args
   */
  action(action, args) {
    // FIXME
    console.log('Map::action()', action, args);

    let d = tileFromPoint(args.x, args.y);
    const objs = this.selectedObjects.filter((obj) => obj.isFriendly());
    const finder = new PF.AStarFinder({
      heuristic: PF.Heuristic.chebyshev,
      allowDiagonal: true
    });

    const grid = this.grid.map((row) => row.map((col) => {
      if ( action === 'attack' ) {
        const obj = col.object;
        return obj && obj.isPlayerObject() ? 0 : col.value;
      }

      return col.value;
    }));

    if ( action === 'attack' ) {
      grid[d.tileY][d.tileX] = 0;
    }

    objs.forEach((obj) => {
      const s = tileFromPoint(obj.x, obj.y);
      const finderGrid = new PF.Grid(grid);
      const path = finder.findPath(s.tileX, s.tileY, d.tileX, d.tileY, finderGrid)
        .map((p) => pointFromTile(p[0], p[1]));

      obj.setTarget(null);

      if ( obj.setPath(path, true) ) {
        if ( args instanceof MapObject ) {
          obj.setTarget(args);
        }
      }
    });
  }

  /**
   * Gets all objects from a rectangle
   * @param {Object} rect Rectangle
   * @return {MapObject[]}
   */
  getObjectsFromRect(rect) {
    return this.objects.filter((obj) => collideAABB(rect, obj.getRect()));
  }

  /**
   * Gets all objects from a point
   * @param {Number} x X
   * @param {Number} y Y
   * @param {Boolean} [first=false] Return first only
   * @return {MapObject[]}
   */
  getObjectsFromPosition(x, y, first = false) {
    const method = first ? 'find' : 'filter';
    const result = this.objects[method]((obj) => collidePoint({x, y}, obj.getRect()));
    return first ? (result ? [result] : []) : result;
  }

  /**
   * Gets all objects from a tile
   * @param {Number} x Tile x
   * @param {Number} y Tile y
   * @param {Boolean} [first=false] Return first only
   * @return {MapObject[]}
   */
  getObjectsFromTile(x, y, first = false) {
    const method = first ? 'find' : 'filter';
    const result = this.objects[method]((obj) => obj.tileX === x && obj.tileY === y);
    return first ? (result ? [result] : []) : result;
  }

  /**
   * Gets objects by filter
   * @param {Function} filter Filter callback
   * @return {MapObject[]}
   */
  getObjectsFromFilter(filter) {
    return this.objects.filter(filter);
  }

  /**
   * Adds an object to the grid
   * @param {Object} object The object
   * @param {Number} [value=100] The weight of the tile
   */
  addToGrid(object, value = 100) {
    const add = (x, y, e) => {
      if ( this.grid[y] ) {
        this.grid[y][x] = e;
      }
    };

    const {tileX, tileY, sizeX, sizeY} = object;
    const isgo = object instanceof MapObject;
    const pattern = isgo ? object.options.OccupyList : null;
    const entry = {
      id: object.id,
      value,
      object: isgo ? object : null
    };

    if ( pattern ) {
      for ( let y = 0; y < pattern.length; y++ ) {
        for ( let x = 0; x < pattern[y].length; x++ ) {
          if (  pattern[y][x] === 1 ) {
            add(tileX + x, tileY + y, entry);
          }
        }
      }
    } else if ( sizeX && sizeY ) {
      for ( let y = 0; y < sizeY; y++ ) {
        for ( let x = 0; x < sizeX; x++ ) {
          add(tileX + x, tileY + y, entry);
        }
      }
    } else {
      add(tileX, tileY, entry);
    }
  }

  /**
   * Queries a grid entry
   * @param {Number} x X
   * @param {Number} y Y
   * @param {String} k Key
   * @param {*} [v] Value
   * @param {Boolean} [p=false] Previous grid
   * @return {*}
   */
  queryGrid(x, y, k, v, p = false) {
    const f = this.getGrid(x, y, p);
    return k ? (typeof v === 'undefined' ? f[k] : f[k] === v) : f;
  }

  /**
   * Gets a grid entry
   * @param {Number} x X
   * @param {Number} y Y
   * @param {Boolean} [p=false] Previous grid
   * @return {Object}
   */
  getGrid(x, y, p = false) {
    const g = p ? this.previousGrid : this.grid;
    const d = {value: 0, id: null, object: null};
    return (g[y] ? g[y][x] : null) || d;
  }
}
