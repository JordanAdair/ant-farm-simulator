import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from '../types';
import type { AntContext, RoleBehavior, Position, ExcavationStep, Brood } from '../types';
import { isNurseryFlooded } from '../BroodManager';
import type { WorldGrid } from '../Grid';
import type { PheromoneGrid } from '../Pheromones';
import type { BroodManager } from '../BroodManager';
import type { Threat } from '../Threat';

export class NurseBehavior implements RoleBehavior {
  update(
    ctx: AntContext,
    grid: WorldGrid,
    _pheromones: PheromoneGrid,
    stockpile: { food: number },
    broodList: readonly Brood[],
    queenPos: Position & { energy?: number },
    _activeExcavationStep: ExcavationStep | null,
    _activeExcavationTarget: Position | null,
    nurseries: Position[],
    foodStorages: Position[],
    broodManager: BroodManager,
    speedMultiplier: number,
    _threats: Threat[],
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ): void {
    const row = Math.floor(ctx.y / CONFIG.CELL_SIZE);

    // If on surface, prioritize navigating back into the nest entrance
    if (row < CONFIG.SKY_HEIGHT) {
      ctx.state = 'Wandering';
      const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
      const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
      ctx.desiredAngle = ctx.getAngleToTarget(grid, entranceX, entranceY);
      ctx.desiredPheromone = 'none';

      // If carrying a brood on the surface, update its position along with the nurse
      if (ctx.isHoldingBrood && ctx.targetBroodId) {
        const brood = broodList.find(b => b.id === ctx.targetBroodId);
        if (brood) {
          brood.x = ctx.x;
          brood.y = ctx.y;
        }
      }
      return;
    }

    // State check: if holding brood, carry it to safe chamber (ALWAYS run this check)
    if (ctx.isHoldingBrood && ctx.targetBroodId) {
      ctx.state = 'Nursing';
      const brood = broodList.find(b => b.id === ctx.targetBroodId);

      if (brood) {
        // Select nursery target based on occupancy and dryness
        const targetNursery = broodManager.getAvailableDryNursery(grid, nurseries) || nurseries.find(n => !isNurseryFlooded(grid, n)) || nurseries[Math.abs(ctx.num) % nurseries.length];

        const spacedPos = targetNursery ? broodManager.findSpacedPositionInNursery(grid, targetNursery) : null;
        // Add a small individual offset so they don't pile exactly on one pixel if no spaced position found
        const targetX = spacedPos ? spacedPos.x : (targetNursery ? targetNursery.x + (ctx.num % 2 === 0 ? 10 : -10) + (ctx.num % 3) * 5 : ctx.x);
        const targetY = spacedPos ? spacedPos.y : (targetNursery ? targetNursery.y + 4 : ctx.y);

        // Update brood pos to match nurse
        brood.x = ctx.x;
        brood.y = ctx.y;

        const dx = targetX - ctx.x;
        const dy = targetY - ctx.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 10) {
          // Drop it
          brood.beingCarried = false;
          ctx.isHoldingBrood = false;
          ctx.targetBroodId = null;
          ctx.collisionCooldown = 0;
          ctx.addDelivery();
          return;
        }

        ctx.desiredAngle = ctx.getAngleToTarget(grid, targetX, targetY);
        ctx.desiredPheromone = 'none';
      } else {
        ctx.isHoldingBrood = false;
        ctx.targetBroodId = null;
      }
      return;
    }

    // State check: Queen hunger has top priority
    const isQueenHungry = queenPos.energy !== undefined && queenPos.energy < 75;

    if (isQueenHungry && ctx.cargo === 'None' && !ctx.isHoldingBrood) {
      ctx.state = 'Nursing';

      let closestStorage = foodStorages[0];
      let minDist = Infinity;
      for (const storage of foodStorages) {
        const dist = Math.sqrt((ctx.x - storage.x) ** 2 + (ctx.y - storage.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closestStorage = storage;
        }
      }

      if (minDist < 20) {
        const sCol = Math.floor(closestStorage.x / CONFIG.CELL_SIZE);
        const sRow = Math.floor(closestStorage.y / CONFIG.CELL_SIZE);
        const entranceCol = grid.nestEntranceCol;
        const centerRow = STARTING_CHAMBER_CENTER_ROW;
        const isStartingLarder = Math.abs(sCol - (entranceCol + 10)) <= 2 && Math.abs(sRow - (centerRow + 1)) <= 2;

        const minCol = isStartingLarder ? entranceCol + 5 : sCol - 9;
        const maxCol = isStartingLarder ? entranceCol + 15 : sCol + 9;
        const minRow = isStartingLarder ? centerRow - 3 : sRow - 2;
        const maxRow = isStartingLarder ? centerRow + 3 : sRow + 2;

        let foundCell = false;
        for (let c = minCol; c <= maxCol; c++) {
          for (let r = minRow; r <= maxRow; r++) {
            const cell = grid.getCell(c, r);
            if (cell && cell.type === 'Food' && cell.foodAmount > 0) {
              ctx.cargoFoodType = cell.foodType || 'Apple';
              cell.foodAmount -= 1;
              stockpile.food -= 1;
              if (cell.foodAmount <= 0) {
                cell.type = 'NestAir';
                cell.foodType = undefined;
              }

              if (spawnDebris) {
                let color = 'hsl(0, 80%, 48%)';
                if (ctx.cargoFoodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
                else if (ctx.cargoFoodType === 'Carcass') color = 'hsl(280, 60%, 40%)';
                spawnDebris(c * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, r * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, color, 3);
              }

              ctx.cargo = 'Food';
              ctx.collisionCooldown = 0;
              foundCell = true;
              break;
            }
          }
          if (foundCell) break;
        }
        if (foundCell) return;
      }

      ctx.desiredAngle = ctx.getAngleToTarget(grid, closestStorage.x, closestStorage.y);
      ctx.desiredPheromone = 'none';
      return;
    }

    if (ctx.cargo === 'Food' && isQueenHungry) {
      ctx.state = 'Nursing';
      const dx = queenPos.x - ctx.x;
      const dy = queenPos.y - ctx.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 12) {
        if (queenPos.energy !== undefined) {
          queenPos.energy = Math.min(100, queenPos.energy + 25);
        }
        ctx.cargo = 'None';
        ctx.cargoFoodType = undefined;
        ctx.collisionCooldown = 0;
        ctx.addDelivery();

        if (spawnDebris) {
          spawnDebris(queenPos.x, queenPos.y, 'hsl(0, 80%, 48%)', 4);
        }
        return;
      }

      ctx.desiredAngle = ctx.getAngleToTarget(grid, queenPos.x, queenPos.y);
      ctx.desiredPheromone = 'none';
      return;
    }

    // State check: if hungry larva exists and nurse has no cargo, go get food (ALWAYS run this check)
    const hungryLarva = broodList.find(b => b.type === 'Larva' && b.needsFood && !b.beingCarried);

    if (hungryLarva && ctx.cargo === 'None') {
      ctx.state = 'Nursing';

      // Find the closest food storage chamber
      let closestStorage = foodStorages[0];
      let minDist = Infinity;
      for (const storage of foodStorages) {
        const dist = Math.sqrt((ctx.x - storage.x) ** 2 + (ctx.y - storage.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closestStorage = storage;
        }
      }

      // Go to food storage to get food
      if (minDist < 20) {
        const sCol = Math.floor(closestStorage.x / CONFIG.CELL_SIZE);
        const sRow = Math.floor(closestStorage.y / CONFIG.CELL_SIZE);
        const entranceCol = grid.nestEntranceCol;
        const centerRow = STARTING_CHAMBER_CENTER_ROW;
        const isStartingLarder = Math.abs(sCol - (entranceCol + 10)) <= 2 && Math.abs(sRow - (centerRow + 1)) <= 2;

        const minCol = isStartingLarder ? entranceCol + 5 : sCol - 9;
        const maxCol = isStartingLarder ? entranceCol + 15 : sCol + 9;
        const minRow = isStartingLarder ? centerRow - 3 : sRow - 2;
        const maxRow = isStartingLarder ? centerRow + 3 : sRow + 2;

        let foundCell = false;
        for (let c = minCol; c <= maxCol; c++) {
          for (let r = minRow; r <= maxRow; r++) {
            const cell = grid.getCell(c, r);
            if (cell && cell.type === 'Food' && cell.foodAmount > 0) {
              ctx.cargoFoodType = cell.foodType || 'Apple';
              cell.foodAmount -= 1;
              stockpile.food -= 1;
              if (cell.foodAmount <= 0) {
                cell.type = 'NestAir';
                cell.foodType = undefined;
              }

              if (spawnDebris) {
                let color = 'hsl(0, 80%, 48%)';
                if (ctx.cargoFoodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
                else if (ctx.cargoFoodType === 'Carcass') color = 'hsl(280, 60%, 40%)';
                spawnDebris(c * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, r * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, color, 3);
              }

              ctx.cargo = 'Food';
              ctx.collisionCooldown = 0;
              foundCell = true;
              break;
            }
          }
          if (foundCell) break;
        }
        if (foundCell) return;
      }

      ctx.desiredAngle = ctx.getAngleToTarget(grid, closestStorage.x, closestStorage.y);
      ctx.desiredPheromone = 'none';
      return;
    }

    // State check: feed the hungry larva (ALWAYS run this check)
    if (ctx.cargo === 'Food' && hungryLarva) {
      ctx.state = 'Nursing';
      const dx = hungryLarva.x - ctx.x;
      const dy = hungryLarva.y - ctx.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 10) {
        hungryLarva.progress = Math.min(100, hungryLarva.progress + 25);
        hungryLarva.needsFood = false;
        ctx.cargo = 'None';
        ctx.cargoFoodType = undefined;
        ctx.collisionCooldown = 0;
        ctx.addDelivery();

        if (spawnDebris) {
          spawnDebris(hungryLarva.x, hungryLarva.y, 'hsl(0, 80%, 48%)', 4);
        }
        return;
      }

      ctx.desiredAngle = ctx.getAngleToTarget(grid, hungryLarva.x, hungryLarva.y);
      ctx.desiredPheromone = 'none';
      return;
    }

    // Idle Nurse Redistribution Check
    if (ctx.cargo === 'None' && !ctx.isHoldingBrood) {
      let nearNursery: Position | null = null;
      for (const nursery of nurseries) {
        const dist = Math.sqrt((ctx.x - nursery.x) ** 2 + (ctx.y - nursery.y) ** 2);
        if (dist < 40) {
          nearNursery = nursery;
          break;
        }
      }

      if (nearNursery && broodManager.isNurseryCrowded(nearNursery)) {
        const bestAlt = broodManager.getAvailableNursery(nurseries);
        if (bestAlt && (bestAlt.x !== nearNursery.x || bestAlt.y !== nearNursery.y)) {
          const currOccupancy = broodManager.getNurseryOccupancy(nearNursery);
          const altOccupancy = broodManager.getNurseryOccupancy(bestAlt);

          if (currOccupancy - altOccupancy >= 3 && Math.random() < 0.20 * speedMultiplier) {
            const itemsInNursery = broodList.filter(b => {
              if (b.beingCarried) return false;
              const dx = b.x - nearNursery!.x;
              const dy = b.y - nearNursery!.y;
              return Math.sqrt(dx * dx + dy * dy) < 40;
            });

            if (itemsInNursery.length > 0) {
              const targetItem = itemsInNursery[Math.floor(Math.random() * itemsInNursery.length)];
              targetItem.beingCarried = true;
              ctx.isHoldingBrood = true;
              ctx.targetBroodId = targetItem.id;
              ctx.collisionCooldown = 0;
              ctx.state = 'Nursing';
              return;
            }
          }
        }
      }
    }

    // State check: pick up misplaced or flooded brood (ALWAYS run this check)
    const strayBrood = broodList.find(b => {
      if (b.beingCarried) return false;

      // 1. Is it in a water cell?
      const bCol = Math.floor(b.x / CONFIG.CELL_SIZE);
      const bRow = Math.floor(b.y / CONFIG.CELL_SIZE);
      const bCell = grid.getCell(bCol, bRow);
      if (bCell && bCell.type === 'Water') {
        return true;
      }

      // 2. Is it in a flooded nursery?
      for (const nursery of nurseries) {
        const dist = Math.sqrt((b.x - nursery.x) ** 2 + (b.y - nursery.y) ** 2);
        if (dist < 40 && isNurseryFlooded(grid, nursery)) {
          return true;
        }
      }

      // 3. Original stray egg/pupa check (misplaced eggs/pupae)
      if (b.type === 'Egg' || b.type === 'Pupa') {
        let inDryNursery = false;
        for (const nursery of nurseries) {
          const dist = Math.sqrt((b.x - nursery.x) ** 2 + (b.y - nursery.y) ** 2);
          if (dist < 40 && !isNurseryFlooded(grid, nursery)) {
            inDryNursery = true;
            break;
          }
        }
        return !inDryNursery;
      }

      return false;
    });

    if (strayBrood && !ctx.isHoldingBrood && ctx.cargo === 'None') {
      ctx.state = 'Nursing';
      const dx = strayBrood.x - ctx.x;
      const dy = strayBrood.y - ctx.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < 8) {
        strayBrood.beingCarried = true;
        ctx.isHoldingBrood = true;
        ctx.targetBroodId = strayBrood.id;
        ctx.collisionCooldown = 0;
        return;
      }

      ctx.desiredAngle = ctx.getAngleToTarget(grid, strayBrood.x, strayBrood.y);
      ctx.desiredPheromone = 'none';
      return;
    }

    // Default: wander around the Queen or Brood area
    ctx.state = 'Wandering';

    const distToQueen = Math.sqrt((ctx.x - queenPos.x) ** 2 + (ctx.y - queenPos.y) ** 2);
    if (distToQueen > 80) {
      ctx.desiredAngle = ctx.getAngleToTarget(grid, queenPos.x, queenPos.y);
    } else {
      ctx.desiredAngle = ctx.angle + (Math.random() - 0.5) * CONFIG.ANT_WANDER_STRENGTH;
    }
    ctx.desiredPheromone = 'none';
  }
}
