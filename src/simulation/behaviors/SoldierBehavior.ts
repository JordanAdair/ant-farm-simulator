import { CONFIG } from '../types';
import type { AntContext, RoleBehavior, Position, ExcavationStep, Brood } from '../types';
import type { WorldGrid } from '../Grid';
import type { PheromoneGrid } from '../Pheromones';
import type { BroodManager } from '../BroodManager';
import type { Threat } from '../Threat';
import type { IFoodStockpile } from '../FoodStockpile';

export class SoldierBehavior implements RoleBehavior {
  update(
    ctx: AntContext,
    grid: WorldGrid,
    pheromones: PheromoneGrid,
    _stockpile: IFoodStockpile,
    _broodList: readonly Brood[],
    queenPos: Position & { energy?: number },
    _activeExcavationStep: ExcavationStep | null,
    _activeExcavationTarget: Position | null,
    nurseries: Position[],
    _foodStorages: Position[],
    _broodManager: BroodManager,
    speedMultiplier: number,
    threats: Threat[],
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ): void {
    // 1. Search for closest threat within 120 pixels
    let closestThreat: Threat | null = null;
    let minDist = Infinity;
    for (const threat of threats) {
      if (!threat.isDead) {
        const dist = Math.sqrt((threat.x - ctx.x) ** 2 + (threat.y - ctx.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closestThreat = threat;
        }
      }
    }

    if (minDist < 120 && closestThreat) {
      ctx.state = 'Attacking';
      ctx.targetThreatId = closestThreat.id;

      const dx = closestThreat.x - ctx.x;
      const dy = closestThreat.y - ctx.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= CONFIG.ATTACK_RANGE + 4) {
        // Attack target
        closestThreat.health = Math.max(0, closestThreat.health - CONFIG.SOLDIER_DAMAGE * speedMultiplier);
        if (spawnDebris && Math.random() < 0.3) {
          spawnDebris(closestThreat.x, closestThreat.y, 'hsl(0, 85%, 45%)', 2);
        }

        // Emit danger pheromones to alert other soldiers
        const col = Math.floor(ctx.x / CONFIG.CELL_SIZE);
        const row = Math.floor(ctx.y / CONFIG.CELL_SIZE);
        pheromones.addDangerPheromone(col, row, CONFIG.PHEROMONE_LAY_STRENGTH * 1.5);
      } else {
        // Move towards threat
        ctx.desiredAngle = ctx.getAngleToTarget(grid, closestThreat.x, closestThreat.y);
        ctx.desiredPheromone = 'none';
      }
      return;
    }

    // 2. If no direct threat is nearby, follow danger pheromone trail
    const col = Math.floor(ctx.x / CONFIG.CELL_SIZE);
    const row = Math.floor(ctx.y / CONFIG.CELL_SIZE);
    const dangerVal = pheromones.getDangerPheromone(col, row);
    if (dangerVal > 0.1) {
      ctx.state = 'Patrolling';
      ctx.desiredPheromone = 'danger';
      ctx.desiredAngle = ctx.angle + (Math.random() - 0.5) * CONFIG.ANT_WANDER_STRENGTH;
      return;
    }

    // 3. Patrol nurseries, nest entrance, or Queen
    ctx.state = 'Patrolling';
    if (!ctx.patrolTarget || Math.sqrt((ctx.x - ctx.patrolTarget.x) ** 2 + (ctx.y - ctx.patrolTarget.y) ** 2) < 25) {
      const targets: Position[] = [
        { x: queenPos.x, y: queenPos.y },
        { x: grid.nestEntranceCol * CONFIG.CELL_SIZE, y: CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE }
      ];
      if (nurseries.length > 0) {
        targets.push(...nurseries);
      }
      ctx.patrolTarget = targets[Math.floor(Math.random() * targets.length)];
      ctx.currentPath = null; // force recalculate path
    }

    ctx.desiredAngle = ctx.getAngleToTarget(grid, ctx.patrolTarget.x, ctx.patrolTarget.y);
    ctx.desiredPheromone = 'none';
  }
}
