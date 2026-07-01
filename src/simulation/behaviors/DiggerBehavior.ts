import { CONFIG } from '../types';
import type { AntContext, RoleBehavior, Position, ExcavationStep, Brood } from '../types';
import { isCellInsidePlanStep } from '../NestPlanner';
import type { WorldGrid } from '../Grid';
import type { PheromoneGrid } from '../Pheromones';
import type { BroodManager } from '../BroodManager';
import type { Threat } from '../Threat';
import type { IFoodStockpile } from '../FoodStockpile';

export class DiggerBehavior implements RoleBehavior {
  update(
    ctx: AntContext,
    grid: WorldGrid,
    _pheromones: PheromoneGrid,
    _stockpile: IFoodStockpile,
    _broodList: readonly Brood[],
    _queenPos: Position & { energy?: number },
    activeExcavationStep: ExcavationStep | null,
    activeExcavationTarget: Position | null,
    _nurseries: Position[],
    _foodStorages: Position[],
    _broodManager: BroodManager,
    _speedMultiplier: number,
    _threats: Threat[],
    _spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ): void {
    const col = Math.floor(ctx.x / CONFIG.CELL_SIZE);
    const row = Math.floor(ctx.y / CONFIG.CELL_SIZE);

    if (ctx.cargo === 'None') {
      ctx.state = 'DiggingTunnel';

      if (ctx.diggingChamberTimer > 0) {
        ctx.diggingChamberTimer--;
      }

      // State check: look for adjacent dirt to dig (ALWAYS run this check)
      const directions = [
        [0, 1],   // Down
        [1, 0],   // Right
        [-1, 0],  // Left
        [0, -1],  // Up
      ];
      directions.sort(() => Math.random() - 0.5);

      for (const [dc, dr] of directions) {
        const tc = col + dc;
        const tr = row + dr;
        // Don't dig above sky height, and don't dig too close to the surface to preserve nest roof
        if (tr >= CONFIG.SKY_HEIGHT + 5 && grid.isDiggable(tc, tr)) {
          // If we have an active coordinated plan, ONLY dig if the cell is inside the plan boundary!
          if (activeExcavationStep && !isCellInsidePlanStep(activeExcavationStep, tc, tr)) {
            continue; // Skip this block, it is outside the planned construction zone
          }

          // Count walkable neighbors in 3x3 grid around target to enforce neat tunnels & chambers
          let walkableNeighbors = 0;
          for (let nCol = -1; nCol <= 1; nCol++) {
            for (let nRow = -1; nRow <= 1; nRow++) {
              if (nCol === 0 && nRow === 0) continue;
              if (grid.isWalkable(tc + nCol, tr + nRow)) {
                walkableNeighbors++;
              }
            }
          }

          const isChamberMode = ctx.diggingChamberTimer > 0;
          // Normal corridor tunnel width is constrained (<= 3 walkable neighbors).
          // Chamber mode allows wider clearing (<= 6 walkable neighbors).
          // If there is an active coordinated excavation plan, we do NOT restrict width,
          // because the plan bounding box itself defines the shape/width of the rooms and shafts!
          const maxAllowedNeighbors = activeExcavationStep ? 8 : (isChamberMode ? 6 : 3);

          if (walkableNeighbors <= maxAllowedNeighbors) {
            grid.digCell(tc, tr);
            ctx.cargo = 'Dirt';
            ctx.state = 'CarryingDirt';
            ctx.angle += Math.PI;
            ctx.collisionCooldown = 0; // reset cooldown to navigate back

            // 1.5% chance to start excavating a room (chamber) when digging deep underground (only when not in active coordinated plan)
            if (!activeExcavationStep && !isChamberMode && tr > CONFIG.SKY_HEIGHT + 15 && Math.random() < 0.015) {
              ctx.diggingChamberTimer = 180; // excavate a chamber for 180 frames
            }
            return;
          }
        }
      }

      // If we are looking for a job but couldn't find any adjacent dirt inside the active plan,
      // and we have an active coordinated target:
      // Tunnel directly towards the target to establish connectivity!
      if (activeExcavationTarget) {
        const targetCol = Math.floor(activeExcavationTarget.x / CONFIG.CELL_SIZE);
        const targetRow = Math.floor(activeExcavationTarget.y / CONFIG.CELL_SIZE);

        const distToTarget = Math.sqrt((col - targetCol) ** 2 + (row - targetRow) ** 2);

        // Check if there is any walkable cell that gets us closer
        let canWalkCloser = false;
        for (const [dc, dr] of directions) {
          const tc = col + dc;
          const tr = row + dr;
          if (grid.isWalkable(tc, tr)) {
            const newDist = Math.sqrt((tc - targetCol) ** 2 + (tr - targetRow) ** 2);
            if (newDist < distToTarget) {
              canWalkCloser = true;
              break;
            }
          }
        }

        if (!canWalkCloser) {
          let bestColOffset = 0;
          let bestRowOffset = 0;
          let minNewDist = distToTarget;

          for (const [dc, dr] of directions) {
            const tc = col + dc;
            const tr = row + dr;
            if (tr >= CONFIG.SKY_HEIGHT + 5 && grid.isDiggable(tc, tr)) {
              const newDist = Math.sqrt((tc - targetCol) ** 2 + (tr - targetRow) ** 2);
              if (newDist < minNewDist) {
                minNewDist = newDist;
                bestColOffset = dc;
                bestRowOffset = dr;
              }
            }
          }

          if (bestColOffset !== 0 || bestRowOffset !== 0) {
            const tc = col + bestColOffset;
            const tr = row + bestRowOffset;
            grid.digCell(tc, tr);
            ctx.cargo = 'Dirt';
            ctx.state = 'CarryingDirt';
            ctx.angle += Math.PI;
            ctx.collisionCooldown = 0;
            return;
          }
        }
      }

      if (row < CONFIG.SKY_HEIGHT) {
        // On surface: head back to the nest entrance
        const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
        const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
        ctx.desiredAngle = ctx.getAngleToTarget(grid, entranceX, entranceY);
        ctx.desiredPheromone = 'none';
      } else {
        // Underground: steer towards active construction zone, or follow preferred digging direction
        if (activeExcavationStep) {
          // Target the closest active excavation target solid cell, fallback to center of planned box
          let targetX = ((activeExcavationStep.minCol + activeExcavationStep.maxCol) / 2) * CONFIG.CELL_SIZE;
          let targetY = ((activeExcavationStep.minRow + activeExcavationStep.maxRow) / 2) * CONFIG.CELL_SIZE;
          if (activeExcavationTarget) {
            targetX = activeExcavationTarget.x;
            targetY = activeExcavationTarget.y;
          }
          ctx.desiredAngle = ctx.getAngleToTarget(grid, targetX, targetY);
          ctx.desiredPheromone = 'none';
        } else {
          if (ctx.diggingAngle === undefined) {
            ctx.diggingAngle = Math.PI / 2;
          }
          // Small chance to change tunnel direction deep underground to create forks/branches
          if (Math.random() < 0.015 && row > CONFIG.SKY_HEIGHT + 8) {
            const choices = [Math.PI / 2, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5, 0, Math.PI];
            ctx.diggingAngle = choices[Math.floor(Math.random() * choices.length)];
          }
          ctx.desiredAngle = ctx.diggingAngle;
          ctx.desiredPheromone = 'none';
        }
      }

    } else if (ctx.cargo === 'Dirt') {
      ctx.state = 'CarryingDirt';

      const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
      const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;

      // State check: on surface, walk away from entrance and drop dirt (ALWAYS run this check)
      if (row < CONFIG.SKY_HEIGHT) {
        if (ctx.targetDropOffset === undefined) {
          ctx.targetDropOffset = 8 + Math.floor(Math.random() * 16); // 8 to 24 cells
        }
        const distToEntrance = Math.abs(ctx.x - entranceX);
        if (distToEntrance >= ctx.targetDropOffset * CONFIG.CELL_SIZE) {
          // Drop dirt
          grid.depositDirt(col);
          ctx.cargo = 'None';
          ctx.state = 'DiggingTunnel';
          ctx.angle += Math.PI;
          ctx.collisionCooldown = 0; // reset cooldown to navigate back
          ctx.addDelivery();
          ctx.targetDropOffset = undefined; // reset
          return;
        }
      }

      if (row >= CONFIG.SKY_HEIGHT) {
        // Underground: find path up.
        ctx.desiredAngle = ctx.getAngleToTarget(grid, entranceX, entranceY);
        ctx.desiredPheromone = 'home';
      } else {
        // On surface: move away from entrance (either left or right)
        const dir = ctx.x < entranceX ? -1 : 1;
        ctx.desiredAngle = dir === -1 ? Math.PI : 0;
        ctx.desiredPheromone = 'none';
      }
    }
  }
}
