import { CONFIG } from './types';
import type { Brood, Position } from './types';
import { Threat } from './Threat';
import type { ThreatType } from './Threat';
import { WorldGrid } from './Grid';
import { PheromoneGrid } from './Pheromones';
import { Ant } from './Ant';

/**
 * The queen object shape as exposed by ColonyManager.
 * Kept minimal — only fields ThreatManager needs to read or mutate.
 */
export interface QueenRef {
  x: number;
  y: number;
  isDead?: boolean;
  health: number;
  deathReason?: string;
  eggTimer: number;   // discriminator used by Threat.attackTarget
  direction: number;  // discriminator used by Threat.attackTarget
}

/**
 * All colony-level data that ThreatManager needs for a single update tick.
 * Engine assembles this object and passes it to `ThreatManager.update()`.
 */
export interface ThreatContext {
  weather: 'Sunny' | 'Rainy';
  grid: WorldGrid;
  pheromones: PheromoneGrid;
  ants: Ant[];
  broodList: Brood[];
  queen: QueenRef;
  speedMultiplier: number;
  /** Callback to emit a log message. */
  addLog: (msg: string, category: 'system' | 'births' | 'deaths') => void;
  /** Callback to spawn visual debris particles. */
  spawnDebris: (x: number, y: number, color: string, count?: number) => void;
  /** Returns excavated nursery and food-storage positions from the current grid. */
  getExcavatedChambers: (grid: WorldGrid) => { nurseries: Position[]; foodStorages: Position[] };
}

/**
 * ThreatManager owns the full lifecycle of all active threats:
 *   1. Spawning — periodic timer + rainy-weather bonus mites
 *   2. Per-tick behaviour — delegates to each Threat instance
 *   3. Removal + decomposition — when health reaches zero
 *
 * Engine constructs one ThreatManager, stores it, and calls
 * `threatManager.update(ctx)` once per simulation tick. No other
 * threat-specific logic lives in Engine.
 */
export class ThreatManager {
  /** The canonical list of living threats.  Shared reference kept in sync
   *  with ColonyManager.threats so the renderer can still read it. */
  private readonly threats: Threat[];

  private spawnTimer: number = 0;

  constructor(threats: Threat[]) {
    // We receive the exact array that ColonyManager owns so mutations
    // (push / splice) are visible to every other system that reads
    // colony.threats (e.g. renderer, soldier AI).
    this.threats = threats;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public update(ctx: ThreatContext): void {
    const { speedMultiplier: mult } = ctx;

    // 1. Periodic spawn (any weather)
    this.spawnTimer += mult;
    if (this.spawnTimer >= CONFIG.THREAT_SPAWN_INTERVAL) {
      this.spawnTimer = 0;
      this.spawnRandom(ctx);
    }

    // 2. Rainy-weather bonus mite spawns
    if (ctx.weather === 'Rainy' && Math.random() < 0.0003 * mult) {
      this.spawnThreat('Mite', ctx);
    }

    // 3. Per-threat tick + health check + removal
    for (let i = this.threats.length - 1; i >= 0; i--) {
      const threat = this.threats[i];

      if (threat.health <= 0) {
        threat.decompose(ctx.grid, ctx.addLog);
        this.threats.splice(i, 1);
        continue;
      }

      threat.update(
        ctx.grid,
        ctx.pheromones,
        ctx.ants,
        ctx.broodList,
        ctx.queen,
        mult,
        ctx.addLog,
        ctx.spawnDebris,
      );
    }
  }

  /** Manually spawn a threat of a specific type (used by dev tools / tests). */
  public spawnThreat(type: ThreatType, ctx: ThreatContext): void {
    const id = `${type}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    if (type === 'Spider') {
      const spawnX = Math.random() < 0.5 ? 20 : (CONFIG.COLS * CONFIG.CELL_SIZE - 20);
      const spawnY = (CONFIG.SKY_HEIGHT - 8) * CONFIG.CELL_SIZE;
      this.threats.push(new Threat(id, type, spawnX, spawnY));
      ctx.addLog('A dangerous spider has appeared on the surface!', 'system');

    } else if (type === 'Beetle') {
      const spawnX = Math.random() * CONFIG.COLS * CONFIG.CELL_SIZE;
      const spawnY = (CONFIG.SKY_HEIGHT - 6) * CONFIG.CELL_SIZE;
      this.threats.push(new Threat(id, type, spawnX, spawnY));
      ctx.addLog('A heavy beetle is patrolling the surface!', 'system');

    } else {
      // Mite — prefer nursery cells, fall back to any NestAir, then queen position
      const { nurseries } = ctx.getExcavatedChambers(ctx.grid);
      let spawnX: number;
      let spawnY: number;

      if (nurseries.length > 0) {
        const nurseryCell = nurseries[Math.floor(Math.random() * nurseries.length)];
        spawnX = nurseryCell.x;
        spawnY = nurseryCell.y;
      } else {
        const nestAirCells: { c: number; r: number }[] = [];
        for (let r = CONFIG.SKY_HEIGHT; r < CONFIG.ROWS; r++) {
          for (let c = 0; c < CONFIG.COLS; c++) {
            const cell = ctx.grid.getCell(c, r);
            if (cell && cell.type === 'NestAir') {
              nestAirCells.push({ c, r });
            }
          }
        }
        if (nestAirCells.length > 0) {
          const picked = nestAirCells[Math.floor(Math.random() * nestAirCells.length)];
          spawnX = picked.c * CONFIG.CELL_SIZE;
          spawnY = picked.r * CONFIG.CELL_SIZE;
        } else {
          spawnX = ctx.queen.x + (Math.random() - 0.5) * 40;
          spawnY = ctx.queen.y + (Math.random() - 0.5) * 40;
        }
      }

      this.threats.push(new Threat(id, type, spawnX, spawnY));
      ctx.addLog('A subterranean nursery mite has invaded the nest!', 'system');
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private spawnRandom(ctx: ThreatContext): void {
    const types: ThreatType[] = ['Spider', 'Beetle', 'Mite'];
    const type = types[Math.floor(Math.random() * types.length)];
    this.spawnThreat(type, ctx);
  }
}
