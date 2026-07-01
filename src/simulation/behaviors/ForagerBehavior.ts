import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from '../types';
import type { AntContext, RoleBehavior, Position, ExcavationStep, Brood } from '../types';
import type { WorldGrid } from '../Grid';
import type { PheromoneGrid } from '../Pheromones';
import type { BroodManager } from '../BroodManager';
import type { Threat } from '../Threat';

export class ForagerBehavior implements RoleBehavior {
  update(
    ctx: AntContext,
    grid: WorldGrid,
    pheromones: PheromoneGrid,
    stockpile: { food: number },
    _broodList: readonly Brood[],
    _queenPos: Position & { energy?: number },
    _activeExcavationStep: ExcavationStep | null,
    _activeExcavationTarget: Position | null,
    _nurseries: Position[],
    foodStorages: Position[],
    _broodManager: BroodManager,
    _speedMultiplier: number,
    _threats: Threat[],
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ): void {
    const col = Math.floor(ctx.x / CONFIG.CELL_SIZE);
    const row = Math.floor(ctx.y / CONFIG.CELL_SIZE);

    if (ctx.cargo === 'None') {
      ctx.state = 'SearchingForFood';

      // Lay home pheromone to mark path back
      pheromones.addHomePheromone(col, row, CONFIG.PHEROMONE_LAY_STRENGTH * 0.5);

      // State check: check if standing on or adjacent to food (ALWAYS run this check)
      const scanCoords = [
        [col, row],       // Current cell
        [col, row - 1],   // Up
        [col, row + 1],   // Down
        [col - 1, row],   // Left
        [col + 1, row],   // Right
      ];

      for (const [tc, tr] of scanCoords) {
        if (grid.isValid(tc, tr)) {
          const cell = grid.getCell(tc, tr);
          if (cell && cell.type === 'Food' && cell.foodAmount > 0) {
            ctx.cargoFoodType = cell.foodType || 'Apple';
            cell.foodAmount = Math.max(0, cell.foodAmount - CONFIG.FOOD_PIECE_SIZE);
            if (cell.foodAmount <= 0) {
              grid.setCellType(tc, tr, 'Sky');
              grid.cells[tc][tr].foodType = undefined;
            }
            if (spawnDebris) {
              let color = 'hsl(0, 80%, 48%)';
              if (ctx.cargoFoodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
              else if (ctx.cargoFoodType === 'Carcass') color = 'hsl(280, 60%, 40%)';
              spawnDebris(tc * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, tr * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, color, 4);
            }
            ctx.cargo = 'Food';
            ctx.state = 'ReturningToNest';
            ctx.angle += Math.PI; // turn around
            ctx.collisionCooldown = 0; // reset cooldown to navigate back
            return;
          }
        }
      }

      // Restrict direct food-sensing to foragers already on the surface to prevent underground ants pathing through ceilings
      const closestFood = row < CONFIG.SKY_HEIGHT + 2 ? grid.getClosestFood(ctx.x, ctx.y) : null;
      if (closestFood) {
        // Steer directly to food if close enough
        const dx = closestFood.x - ctx.x;
        const dy = closestFood.y - ctx.y;
        ctx.desiredAngle = Math.atan2(dy, dx);
        ctx.desiredPheromone = 'none';
      } else {
        // Follow food pheromone trail
        ctx.desiredPheromone = 'food';
        // Add random wander bias to desiredAngle when searching to prevent straight-line drift to edges
        let wanderAngle = ctx.angle + (Math.random() - 0.5) * CONFIG.ANT_WANDER_STRENGTH;

        // Pull back towards nest center column if too far horizontally to prevent edge-drifting
        const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
        const distToEntrance = Math.abs(ctx.x - entranceX);
        const maxSearchDist = 120 * CONFIG.CELL_SIZE; // 480px, about 30% of screen width from center

        if (distToEntrance > maxSearchDist) {
          const dirToNest = entranceX > ctx.x ? 0 : Math.PI;
          let diff = dirToNest - wanderAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          wanderAngle += diff * 0.15; // 15% blend rate towards nest direction
        } else if (distToEntrance < 15 * CONFIG.CELL_SIZE) {
          // Push away from nest entrance when searching for food to prevent falling back in and oscillating!
          const dirAwayFromNest = ctx.x > entranceX ? 0 : Math.PI;
          let diff = dirAwayFromNest - wanderAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          wanderAngle += diff * 0.25; // 25% blend rate away from nest
        }

        ctx.desiredAngle = wanderAngle;
      }

      // If underground and searching for food, steer towards the exit shaft (up and horizontal center)
      if (row >= CONFIG.SKY_HEIGHT + 2) {
        const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
        const distToShaft = Math.abs(ctx.x - entranceX);
        if (distToShaft > CONFIG.CELL_SIZE * 2) {
          // Walk horizontally to central shaft first
          const shaftDir = entranceX > ctx.x ? 1 : -1;
          ctx.desiredAngle = shaftDir === 1 ? 0 : Math.PI;
        } else {
          // Steer straight up in central shaft
          ctx.desiredAngle = -Math.PI / 2;
        }
        ctx.desiredPheromone = 'none';
      }

    } else if (ctx.cargo === 'Food') {
      ctx.state = 'ReturningToNest';

      // Lay food pheromone trail on the way back
      pheromones.addFoodPheromone(col, row, CONFIG.PHEROMONE_LAY_STRENGTH);

      // State check: if close to any excavated food storage chamber, deposit food (ALWAYS run this check)
      let closestStorage = foodStorages[0];
      let minDistVal = Infinity;
      for (const storage of foodStorages) {
        const dist = Math.sqrt((ctx.x - storage.x) ** 2 + (ctx.y - storage.y) ** 2);
        if (dist < minDistVal) {
          minDistVal = dist;
          closestStorage = storage;
        }
      }

      if (minDistVal < 30) {
        // Physical deposit into closestStorage
        const sCol = Math.floor(closestStorage.x / CONFIG.CELL_SIZE);
        const sRow = Math.floor(closestStorage.y / CONFIG.CELL_SIZE);
        const entranceCol = grid.nestEntranceCol;
        const centerRow = STARTING_CHAMBER_CENTER_ROW;
        const isStartingLarder = Math.abs(sCol - (entranceCol + 10)) <= 2 && Math.abs(sRow - (centerRow + 1)) <= 2;

        const minCol = isStartingLarder ? entranceCol + 5 : sCol - 9;
        const maxCol = isStartingLarder ? entranceCol + 15 : sCol + 9;
        const minRow = isStartingLarder ? centerRow - 3 : sRow - 2;
        const maxRow = isStartingLarder ? centerRow + 3 : sRow + 2;

        let deposited = false;
        for (let c = minCol; c <= maxCol; c++) {
          for (let r = minRow; r <= maxRow; r++) {
            if (grid.isValid(c, r) && grid.getCell(c, r)?.type === 'NestAir') {
              grid.cells[c][r].type = 'Food';
              grid.cells[c][r].foodType = ctx.cargoFoodType || 'Apple';
              grid.cells[c][r].foodAmount = CONFIG.FOOD_PIECE_SIZE;

              if (spawnDebris) {
                let color = 'hsl(0, 80%, 48%)';
                if (ctx.cargoFoodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
                else if (ctx.cargoFoodType === 'Carcass') color = 'hsl(280, 60%, 40%)';
                spawnDebris(c * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, r * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, color, 4);
              }
              deposited = true;
              break;
            }
          }
          if (deposited) break;
        }

        if (deposited) {
          stockpile.food += CONFIG.FOOD_PIECE_SIZE;
          ctx.cargo = 'None';
          ctx.cargoFoodType = undefined;
          ctx.state = 'SearchingForFood';
          ctx.angle += Math.PI;
          ctx.collisionCooldown = 0; // reset cooldown to navigate out
          ctx.addDelivery();
          return;
        }
      }

      const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
      const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;

      if (row < CONFIG.SKY_HEIGHT) {
        // On surface: head to entrance
        ctx.desiredAngle = ctx.getAngleToTarget(grid, entranceX, entranceY);
        ctx.desiredPheromone = 'none';
      } else {
        // Underground: steer towards the closest non-full food storage chamber
        const availableStorage = this.getAvailableStorage(ctx, grid, foodStorages);
        if (availableStorage) {
          ctx.desiredAngle = ctx.getAngleToTarget(grid, availableStorage.x, availableStorage.y);
        } else {
          ctx.desiredAngle = ctx.getAngleToTarget(grid, closestStorage.x, closestStorage.y);
        }
        ctx.desiredPheromone = 'home';
      }
    }
  }

  private isStorageFull(ctx: AntContext, grid: WorldGrid, storage: Position): boolean {
    const sCol = Math.floor(storage.x / CONFIG.CELL_SIZE);
    const sRow = Math.floor(storage.y / CONFIG.CELL_SIZE);
    const entranceCol = grid.nestEntranceCol;
    const centerRow = STARTING_CHAMBER_CENTER_ROW;

    const isStartingLarder = Math.abs(sCol - (entranceCol + 10)) <= 2 && Math.abs(sRow - (centerRow + 1)) <= 2;

    const minCol = isStartingLarder ? entranceCol + 5 : sCol - 9;
    const maxCol = isStartingLarder ? entranceCol + 15 : sCol + 9;
    const minRow = isStartingLarder ? centerRow - 3 : sRow - 2;
    const maxRow = isStartingLarder ? centerRow + 3 : sRow + 2;

    for (let c = minCol; c <= maxCol; c++) {
      for (let r = minRow; r <= maxRow; r++) {
        if (grid.isValid(c, r) && grid.getCell(c, r)?.type === 'NestAir') {
          return false;
        }
      }
    }
    // ctx used indirectly via the closure — suppress lint
    void ctx;
    return true;
  }

  private getAvailableStorage(ctx: AntContext, grid: WorldGrid, foodStorages: Position[]): Position | null {
    let closest: Position | null = null;
    let minDist = Infinity;
    for (const storage of foodStorages) {
      if (!this.isStorageFull(ctx, grid, storage)) {
        const dist = Math.sqrt((ctx.x - storage.x) ** 2 + (ctx.y - storage.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = storage;
        }
      }
    }
    return closest;
  }
}
