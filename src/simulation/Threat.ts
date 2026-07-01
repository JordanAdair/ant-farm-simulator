import { CONFIG } from './types';
import type { Brood } from './types';
import { WorldGrid } from './Grid';
import { PheromoneGrid } from './Pheromones';
import { Ant } from './Ant';
import { BroodManager } from './BroodManager';
import { steerTowardsAngle, moveAndAvoidObstacles } from './Locomotion';
import type { LocomotionEntity } from './Locomotion';
import { findPath } from './Pathfinder';

export type ThreatType = 'Spider' | 'Beetle' | 'Mite';

export class Threat implements LocomotionEntity {
  public id: string;
  public type: ThreatType;
  public x: number;
  public y: number;
  public angle: number = 0;
  public health: number;
  public maxHealth: number;
  public speed: number;
  public damage: number;
  public legCycle: number = 0;
  public target: any | null = null;
  public state: 'Wandering' | 'Hunting' | 'Eating' = 'Wandering';
  public isDead: boolean = false;
  
  // LocomotionEntity fields
  public collisionCooldown: number = 0;
  public collisionTimer: number = 0;
  public collisions: number = 0;

  constructor(id: string, type: ThreatType, x: number, y: number) {
    this.id = id;
    this.type = type;
    this.x = x;
    this.y = y;
    this.angle = Math.random() * Math.PI * 2;
    
    if (type === 'Spider') {
      this.health = 100;
      this.maxHealth = 100;
      this.speed = 0.95;
      this.damage = 1.2;
    } else if (type === 'Beetle') {
      this.health = 160;
      this.maxHealth = 160;
      this.speed = 1.35;
      this.damage = 1.5;
    } else { // Mite
      this.health = 35;
      this.maxHealth = 35;
      this.speed = 0.55;
      this.damage = 0.8;
    }
  }

  private findTarget(ants: Ant[], broodList: readonly Brood[], queen: any) {
    const skyHeightY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
    
    // Spiders target the Queen, any brood, or closest Ant
    if (this.type === 'Spider') {
      // If queen is alive and nearby, target queen
      const distToQueen = Math.sqrt((queen.x - this.x) ** 2 + (queen.y - this.y) ** 2);
      if (!queen.isDead && distToQueen < 200) {
        this.target = queen;
        return;
      }
      
      // Target closest ant
      let closestAnt: Ant | null = null;
      let minDist = Infinity;
      for (const ant of ants) {
        const dist = Math.sqrt((ant.x - this.x) ** 2 + (ant.y - this.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closestAnt = ant;
        }
      }
      if (minDist < 120) {
        this.target = closestAnt;
        return;
      }
      
      // Target closest brood
      let closestBrood: Brood | null = null;
      let minBroodDist = Infinity;
      for (const brood of broodList) {
        if (!brood.beingCarried) {
          const dist = Math.sqrt((brood.x - this.x) ** 2 + (brood.y - this.y) ** 2);
          if (dist < minBroodDist) {
            minBroodDist = dist;
            closestBrood = brood;
          }
        }
      }
      if (minBroodDist < 100) {
        this.target = closestBrood;
        return;
      }
      
      this.target = null;
    } 
    // Beetles stay on the surface and only target surface ants
    else if (this.type === 'Beetle') {
      let closestAnt: Ant | null = null;
      let minDist = Infinity;
      for (const ant of ants) {
        if (ant.y < skyHeightY) {
          const dist = Math.sqrt((ant.x - this.x) ** 2 + (ant.y - this.y) ** 2);
          if (dist < minDist) {
            minDist = dist;
            closestAnt = ant;
          }
        }
      }
      if (minDist < 160) {
        this.target = closestAnt;
      } else {
        this.target = null;
      }
    } 
    // Mites target brood or nurses in nurseries
    else {
      let closestBrood: Brood | null = null;
      let minBroodDist = Infinity;
      for (const brood of broodList) {
        if (!brood.beingCarried) {
          const dist = Math.sqrt((brood.x - this.x) ** 2 + (brood.y - this.y) ** 2);
          if (dist < minBroodDist) {
            minBroodDist = dist;
            closestBrood = brood;
          }
        }
      }
      if (minBroodDist < 80) {
        this.target = closestBrood;
        return;
      }

      let closestNurse: Ant | null = null;
      let minNurseDist = Infinity;
      for (const ant of ants) {
        if (ant.role === 'Nurse') {
          const dist = Math.sqrt((ant.x - this.x) ** 2 + (ant.y - this.y) ** 2);
          if (dist < minNurseDist) {
            minNurseDist = dist;
            closestNurse = ant;
          }
        }
      }
      if (minNurseDist < 80) {
        this.target = closestNurse;
      } else {
        this.target = null;
      }
    }
  }

  public update(
    grid: WorldGrid,
    pheromones: PheromoneGrid,
    ants: Ant[],
    broodList: readonly Brood[],
    queen: any,
    speedMultiplier: number,
    addLog: (m: string, c: 'system' | 'births' | 'deaths') => void,
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void,
    broodManager?: BroodManager
  ) {
    if (this.collisionCooldown > 0) {
      this.collisionCooldown -= speedMultiplier;
    }
    if (this.collisionTimer > 0) {
      this.collisionTimer -= speedMultiplier;
    }

    this.legCycle += 0.25 * speedMultiplier;
    const speed = this.speed * speedMultiplier;

    // Find target
    this.findTarget(ants, broodList, queen);

    if (this.target) {
      this.state = 'Hunting';
      const dx = this.target.x - this.x;
      const dy = this.target.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= CONFIG.ATTACK_RANGE + 4) {
        // Combat! Deal damage
        this.attackTarget(this.target, broodManager, speedMultiplier, addLog, spawnDebris);
        
        // Emit danger pheromones
        const col = Math.floor(this.x / CONFIG.CELL_SIZE);
        const row = Math.floor(this.y / CONFIG.CELL_SIZE);
        pheromones.addDangerPheromone(col, row, CONFIG.PHEROMONE_LAY_STRENGTH * 1.5);
        
        // Small recoil/bounce to create visual combat impact
        this.angle = Math.atan2(-dy, -dx) + (Math.random() - 0.5) * 0.5;
      } else {
        // Move towards target
        let steerAngle = Math.atan2(dy, dx);
        
        const col = Math.floor(this.x / CONFIG.CELL_SIZE);
        const row = Math.floor(this.y / CONFIG.CELL_SIZE);
        const tCol = Math.floor(this.target.x / CONFIG.CELL_SIZE);
        const tRow = Math.floor(this.target.y / CONFIG.CELL_SIZE);
        
        if (row >= CONFIG.SKY_HEIGHT && tRow >= CONFIG.SKY_HEIGHT) {
          // Underground: navigate using pathfinding
          const path = findPath(grid, col, row, tCol, tRow);
          if (path && path.length > 0) {
            const nextWP = path[0];
            steerAngle = Math.atan2(nextWP.y - this.y, nextWP.x - this.x);
          }
        }
        
        steerTowardsAngle(this, steerAngle, 0.15 * speedMultiplier);
      }
    } else {
      this.state = 'Wandering';
      const row = Math.floor(this.y / CONFIG.CELL_SIZE);
      
      if (this.type === 'Mite') {
        // Slow crawling downwards/horizontal to find nurseries
        if (Math.random() < 0.02) {
          const steerAngle = Math.PI / 2 + (Math.random() - 0.5) * 1.5; // steer downward
          this.angle = steerAngle;
        }
      } else if (this.type === 'Spider') {
        if (row < CONFIG.SKY_HEIGHT) {
          // Surface Spider: steer towards nest entrance (shaft top)
          const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
          const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
          const dx = entranceX - this.x;
          const dy = entranceY - this.y;
          const steerAngle = Math.atan2(dy, dx);
          steerTowardsAngle(this, steerAngle, 0.08 * speedMultiplier);
        } else {
          // Underground Spider: wander down/shaft
          if (Math.random() < 0.01) {
            this.angle = Math.PI / 2 + (Math.random() - 0.5) * 1.0;
          }
        }
      } else { // Beetle
        // Wander horizontally on surface
        if (row < CONFIG.SKY_HEIGHT) {
          if (Math.random() < 0.02) {
            this.angle = Math.random() < 0.5 ? 0 : Math.PI;
          }
          // Prevent falling into shaft if it's a Beetle
          const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
          if (Math.abs(this.x - entranceX) < 16) {
            this.angle = this.x < entranceX ? Math.PI : 0; // steer away
          }
        } else {
          // If a beetle somehow gets underground, force climb up or snap
          this.y = (CONFIG.SKY_HEIGHT - 5) * CONFIG.CELL_SIZE;
        }
      }
    }
    
    // Move threat avoiding walls
    moveAndAvoidObstacles(this, grid, speed);
  }

  private attackTarget(
    target: any,
    broodManager: BroodManager | undefined,
    speedMultiplier: number,
    addLog: (m: string, c: 'system' | 'births' | 'deaths') => void,
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ) {
    if (spawnDebris && Math.random() < 0.3) {
      spawnDebris(target.x, target.y, 'hsl(16, 95%, 55%)', 3); // sparks
    }

    // Queen target
    if (target.eggTimer !== undefined && target.direction !== undefined) {
      // Target is Queen
      target.health = Math.max(0, target.health - this.damage * speedMultiplier * 0.15);
      if (target.health <= 0) {
        target.isDead = true;
        target.deathReason = 'predator attack';
        addLog('The Queen has been slain by a predator! Colony Collapse is imminent.', 'deaths');
      }
    }
    // Ant target
    else if (target.role !== undefined) {
      target.health = Math.max(0, target.health - this.damage * speedMultiplier * 0.4);
      // Check if ant died (handled in Engine loop, but this deals damage)
    }
    // Brood target
    else if (target.type !== undefined) {
      if (broodManager) {
        const destroyed = broodManager.damageBrood(target.id, 1.5 * speedMultiplier);
        if (destroyed) {
          addLog(`A ${this.type.toLowerCase()} devoured a colony ${target.type.toLowerCase()} in the nursery!`, 'deaths');
          this.target = null; // target is gone
        }
      }
    }
  }

  public decompose(grid: WorldGrid, addLog: (m: string, c: 'system' | 'births' | 'deaths') => void) {
    addLog(`A threatening ${this.type.toLowerCase()} was defeated! The carcass is ready for harvesting.`, 'system');
    
    const col = Math.floor(this.x / CONFIG.CELL_SIZE);
    const row = Math.floor(this.y / CONFIG.CELL_SIZE);
    
    const count = this.type === 'Spider' ? 4 : (this.type === 'Beetle' ? 6 : 1);
    let spawned = 0;
    
    // Search spiral-outward to place Carcass food cells
    for (let radius = 0; radius <= 3 && spawned < count; radius++) {
      for (let dc = -radius; dc <= radius && spawned < count; dc++) {
        for (let dr = -radius; dr <= radius && spawned < count; dr++) {
          if (Math.abs(dc) !== radius && Math.abs(dr) !== radius) continue;
          
          const tc = col + dc;
          const tr = row + dr;
          if (grid.isValid(tc, tr)) {
            const cell = grid.getCell(tc, tr);
            if (cell && (cell.type === 'NestAir' || cell.type === 'Sky')) {
              grid.cells[tc][tr].type = 'Food';
              grid.cells[tc][tr].foodType = 'Carcass';
              grid.cells[tc][tr].foodAmount = CONFIG.FOOD_PER_SOURCE || 50;
              spawned++;
            }
          }
        }
      }
    }
  }
}
