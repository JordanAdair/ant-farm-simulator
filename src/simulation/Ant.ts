import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from './types';
import type { AntRole, AntState, Position, ExcavationStep, AntBrain, FoodType } from './types';
import { isCellInsidePlanStep } from './NestPlanner';
import { WorldGrid } from './Grid';
import { PheromoneGrid } from './Pheromones';
import { findPath } from './Pathfinder';
import { moveAndAvoidObstacles, normalizeAngle } from './Locomotion';
import type { LocomotionEntity } from './Locomotion';
import { BroodManager, isNurseryFlooded } from './BroodManager';

export function createDefaultBrain(): AntBrain {
  return {
    weights: [
      Math.random() * 0.2 - 0.1, // left pheromone
      Math.random() * 0.2 - 0.1, // center pheromone
      Math.random() * 0.2 - 0.1, // right pheromone
      0.8 + (Math.random() * 0.2 - 0.1), // target angle error (positive bias)
      Math.random() * 0.2 - 0.1, // stuck indicator
    ],
    bias: Math.random() * 0.1 - 0.05,
  };
}

export class Ant implements LocomotionEntity {
  public id: string;
  public x: number;
  public y: number;
  public angle: number;
  public role: AntRole;
  public state: AntState;
  
  public cargo: 'None' | 'Food' | 'Dirt' = 'None';
  public cargoFoodType?: FoodType;
  public energy: number = CONFIG.ANT_MAX_ENERGY;
  public homeChamberX: number;
  public homeChamberY: number;

  // Visual leg animation state
  public legCycle: number = 0;

  // Nursing targets
  public targetBroodId: string | null = null;
  public isHoldingBrood: boolean = false;

  public collisionCooldown: number = 0;
  public collisionTimer: number = 0;
  public diggingChamberTimer: number = 0;
  public diggingAngle: number = Math.PI / 2;
  public targetDropOffset?: number;

  public num: number;

  // Neural network and learning parameters
  public brain: AntBrain;
  public generation: number;
  public collisions: number = 0;
  public deliveries: number = 0;

  // Age and lifecycle
  public age: number = 0;
  public maxAge: number;
  public submergedTime: number = 0;
  public health: number = 100;

  // Steering targets resolved by state machines
  public desiredAngle: number;
  public desiredPheromone: 'food' | 'home' | 'none' = 'none';

  // Pathfinding
  public currentPath: Position[] | null = null;
  public pathTarget: Position | null = null;

  constructor(
    id: string,
    startX: number,
    startY: number,
    role: AntRole,
    num: number,
    brain?: AntBrain,
    generation: number = 1
  ) {
    this.id = id;
    this.x = startX;
    this.y = startY;
    this.angle = Math.random() * Math.PI * 2;
    this.role = role;
    this.state = 'Wandering';
    this.num = num;
    
    this.homeChamberX = startX;
    this.homeChamberY = startY;

    this.brain = brain || createDefaultBrain();
    this.generation = generation;
    this.desiredAngle = this.angle;

    this.age = 0;
    this.maxAge = 1200 + Math.random() * 600; // 20 to 30 minutes of life at 1x speed
  }

  public getFitness(): number {
    let weight = 10;
    if (this.role === 'Digger') weight = 5;
    else if (this.role === 'Nurse') weight = 8;
    return Math.max(0.1, this.deliveries * weight - this.collisions * 0.02);
  }

  public update(
    grid: WorldGrid,
    pheromones: PheromoneGrid,
    stockpile: { food: number },
    broodList: any[],
    queenPos: Position,
    activeExcavationStep: ExcavationStep | null,
    activeExcavationTarget: Position | null,
    nurseries: Position[],
    foodStorages: Position[],
    broodManager: BroodManager,
    speedMultiplier: number,
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ) {
    const col = Math.floor(this.x / CONFIG.CELL_SIZE);
    const row = Math.floor(this.y / CONFIG.CELL_SIZE);
    const cell = grid.getCell(col, row);
    const isSubmerged = cell && cell.type === 'Water';

    let speed = CONFIG.ANT_SPEED * speedMultiplier;
    if (isSubmerged) {
      speed *= 0.4;
    }

    this.legCycle += 0.25 * speedMultiplier;

    // Energy slowly depletes. The world is deep, so they need enough energy to make the long walk home!
    this.energy -= 0.002 * speedMultiplier;

    // Submerged drowning logic
    if (isSubmerged) {
      this.submergedTime += (1 / 60) * speedMultiplier;
      if (this.submergedTime > 5.0) {
        this.health -= 2 * speedMultiplier;
      }
      if (spawnDebris && Math.random() < 0.05 * speedMultiplier) {
        spawnDebris(this.x, this.y, 'rgba(156, 180, 215, 0.65)', 1);
      }
    } else {
      this.submergedTime = 0;
      this.health = Math.min(100, this.health + 0.5 * speedMultiplier);
    }
    if (this.energy < 25 && this.state !== 'Resting') {
      this.state = 'Resting'; // go home and eat
    }

    if (this.collisionCooldown > 0) {
      this.collisionCooldown -= speedMultiplier;
    }
    if (this.collisionTimer > 0) {
      this.collisionTimer -= speedMultiplier;
      if (this.collisionTimer > 10) {
        this.currentPath = null; // force recalculate path if stuck
      }
    }

    // Reset steering targets at start of frame
    this.desiredAngle = this.angle;
    this.desiredPheromone = 'none';

    // Role state machines
    if (this.state === 'Resting') {
      this.updateResting(grid, stockpile, foodStorages, spawnDebris);
    } else {
      switch (this.role) {
        case 'Forager':
          this.updateForager(grid, pheromones, stockpile, foodStorages, spawnDebris);
          break;
        case 'Digger':
          this.updateDigger(grid, pheromones, activeExcavationStep, activeExcavationTarget);
          break;
        case 'Nurse':
          this.updateNurse(grid, stockpile, broodList, queenPos, nurseries, foodStorages, broodManager, speedMultiplier, spawnDebris);
          break;
      }
    }

    // Clamp desiredAngle on the surface (outside the shaft zone) to horizontal boundaries (max slope of 35 degrees)
    const currentCol = Math.floor(this.x / CONFIG.CELL_SIZE);
    const currentRow = Math.floor(this.y / CONFIG.CELL_SIZE);
    if (currentRow < CONFIG.SKY_HEIGHT && Math.abs(currentCol - grid.nestEntranceCol) > 4) {
      const cosVal = Math.cos(this.desiredAngle);
      const sinVal = Math.sin(this.desiredAngle);
      let ang = Math.atan2(sinVal, cosVal); // normalized to [-PI, PI]

      const maxSlope = 35 * (Math.PI / 180); // 35 degrees in rad (~0.61)
      if (cosVal >= 0) {
        ang = Math.max(-maxSlope, Math.min(maxSlope, ang));
      } else {
        if (ang >= 0) {
          ang = Math.max(Math.PI - maxSlope, ang);
        } else {
          ang = Math.min(-Math.PI + maxSlope, ang);
        }
      }
      this.desiredAngle = ang;
    }

    // Run neural network steering (only when not in collision cooldown)
    if (this.collisionCooldown <= 0) {
      this.steerWithNeuralNetwork(grid, pheromones, speedMultiplier);
    }

    // Apply movement based on current angle
    moveAndAvoidObstacles(this, grid, speed);
  }

  // --- RESTING / REFUELLING ---
  private updateResting(
    grid: WorldGrid,
    stockpile: { food: number },
    foodStorages: Position[],
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ) {
    const row = Math.floor(this.y / CONFIG.CELL_SIZE);
    const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
    const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;

    // Find the closest food storage chamber
    let closestStorage = foodStorages[0];
    let minDist = Infinity;
    for (const storage of foodStorages) {
      const dist = Math.sqrt((this.x - storage.x) ** 2 + (this.y - storage.y) ** 2);
      if (dist < minDist) {
        minDist = dist;
        closestStorage = storage;
      }
    }

    // If close enough to a food storage, eat and refuel
    if (minDist < 30) {
      if (stockpile.food >= 0.5) {
        stockpile.food -= 0.5;

        // Spawn eating animation/debris at the nearest food cell inside this larder
        if (spawnDebris) {
          const cellCol = Math.floor(this.x / CONFIG.CELL_SIZE);
          const cellRow = Math.floor(this.y / CONFIG.CELL_SIZE);
          let closestFoodCell: Position | null = null;
          let minFoodDist = Infinity;
          for (let dc = -8; dc <= 8; dc++) {
            for (let dr = -8; dr <= 8; dr++) {
              const tc = cellCol + dc;
              const tr = cellRow + dr;
              const cell = grid.getCell(tc, tr);
              if (cell && cell.type === 'Food') {
                const fx = tc * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
                const fy = tr * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
                const dSq = (this.x - fx) ** 2 + (this.y - fy) ** 2;
                if (dSq < minFoodDist) {
                  minFoodDist = dSq;
                  closestFoodCell = { x: fx, y: fy };
                }
              }
            }
          }
          if (closestFoodCell) {
            const cCol = Math.floor(closestFoodCell.x / CONFIG.CELL_SIZE);
            const cRow = Math.floor(closestFoodCell.y / CONFIG.CELL_SIZE);
            const cell = grid.getCell(cCol, cRow);
            let color = 'hsl(0, 80%, 48%)';
            if (cell?.foodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
            else if (cell?.foodType === 'Carcass') color = 'hsl(280, 60%, 40%)';
            
            spawnDebris(closestFoodCell.x, closestFoodCell.y, color, 3);
          }
        }

        this.energy = CONFIG.ANT_MAX_ENERGY;
        this.state = this.role === 'Forager' ? 'SearchingForFood' : (this.role === 'Nurse' ? 'Wandering' : 'DiggingTunnel');
        this.angle += Math.PI; // turn around
        this.collisionCooldown = 0;
        return;
      }
    }

    // Go back to the nest
    if (row < CONFIG.SKY_HEIGHT) {
      // On surface: head to entrance
      this.desiredAngle = this.getAngleTowardsTarget(grid, entranceX, entranceY);
      this.desiredPheromone = 'none';
    } else {
      // Underground: head to closest food storage
      this.desiredAngle = this.getAngleTowardsTarget(grid, closestStorage.x, closestStorage.y);
      this.desiredPheromone = 'home';
    }
  }

  // --- FORAGER BEHAVIOR ---
  private updateForager(
    grid: WorldGrid,
    pheromones: PheromoneGrid,
    stockpile: { food: number },
    foodStorages: Position[],
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ) {
    const col = Math.floor(this.x / CONFIG.CELL_SIZE);
    const row = Math.floor(this.y / CONFIG.CELL_SIZE);

    if (this.cargo === 'None') {
      this.state = 'SearchingForFood';
      
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
            this.cargoFoodType = cell.foodType || 'Apple';
            cell.foodAmount = Math.max(0, cell.foodAmount - CONFIG.FOOD_PIECE_SIZE);
            if (cell.foodAmount <= 0) {
              grid.setCellType(tc, tr, 'Sky');
              grid.cells[tc][tr].foodType = undefined;
            }
            if (spawnDebris) {
              let color = 'hsl(0, 80%, 48%)';
              if (this.cargoFoodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
              else if (this.cargoFoodType === 'Carcass') color = 'hsl(280, 60%, 40%)';
              spawnDebris(tc * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, tr * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2, color, 4);
            }
            this.cargo = 'Food';
            this.state = 'ReturningToNest';
            this.angle += Math.PI; // turn around
            this.collisionCooldown = 0; // reset cooldown to navigate back
            return;
          }
        }
      }

      // Restrict direct food-sensing to foragers already on the surface to prevent underground ants pathing through ceilings
      const closestFood = row < CONFIG.SKY_HEIGHT + 2 ? grid.getClosestFood(this.x, this.y) : null;
      if (closestFood) {
        // Steer directly to food if close enough
        const dx = closestFood.x - this.x;
        const dy = closestFood.y - this.y;
        this.desiredAngle = Math.atan2(dy, dx);
        this.desiredPheromone = 'none';
      } else {
        // Follow food pheromone trail
        this.desiredPheromone = 'food';
        // Add random wander bias to desiredAngle when searching to prevent straight-line drift to edges
        let wanderAngle = this.angle + (Math.random() - 0.5) * CONFIG.ANT_WANDER_STRENGTH;

        // Pull back towards nest center column if too far horizontally to prevent edge-drifting
        const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
        const distToEntrance = Math.abs(this.x - entranceX);
        const maxSearchDist = 120 * CONFIG.CELL_SIZE; // 480px, about 30% of screen width from center
        
        if (distToEntrance > maxSearchDist) {
          const dirToNest = entranceX > this.x ? 0 : Math.PI;
          let diff = dirToNest - wanderAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          wanderAngle += diff * 0.15; // 15% blend rate towards nest direction
        } else if (distToEntrance < 15 * CONFIG.CELL_SIZE) {
          // Push away from nest entrance when searching for food to prevent falling back in and oscillating!
          const dirAwayFromNest = this.x > entranceX ? 0 : Math.PI;
          let diff = dirAwayFromNest - wanderAngle;
          diff = Math.atan2(Math.sin(diff), Math.cos(diff));
          wanderAngle += diff * 0.25; // 25% blend rate away from nest
        }

        this.desiredAngle = wanderAngle;
      }

      // If underground and searching for food, steer towards the exit shaft (up and horizontal center)
      if (row >= CONFIG.SKY_HEIGHT + 2) {
        const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
        const distToShaft = Math.abs(this.x - entranceX);
        if (distToShaft > CONFIG.CELL_SIZE * 2) {
          // Walk horizontally to central shaft first
          const shaftDir = entranceX > this.x ? 1 : -1;
          this.desiredAngle = shaftDir === 1 ? 0 : Math.PI;
        } else {
          // Steer straight up in central shaft
          this.desiredAngle = -Math.PI / 2;
        }
        this.desiredPheromone = 'none';
      }

    } else if (this.cargo === 'Food') {
      this.state = 'ReturningToNest';

      // Lay food pheromone trail on the way back
      pheromones.addFoodPheromone(col, row, CONFIG.PHEROMONE_LAY_STRENGTH);

      // State check: if close to any excavated food storage chamber, deposit food (ALWAYS run this check)

      let closestStorage = foodStorages[0];
      let minDistVal = Infinity;
      for (const storage of foodStorages) {
        const dist = Math.sqrt((this.x - storage.x) ** 2 + (this.y - storage.y) ** 2);
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
              grid.cells[c][r].foodType = this.cargoFoodType || 'Apple';
              grid.cells[c][r].foodAmount = CONFIG.FOOD_PIECE_SIZE;
              
              if (spawnDebris) {
                let color = 'hsl(0, 80%, 48%)';
                if (this.cargoFoodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
                else if (this.cargoFoodType === 'Carcass') color = 'hsl(280, 60%, 40%)';
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
          this.cargo = 'None';
          this.cargoFoodType = undefined;
          this.state = 'SearchingForFood';
          this.angle += Math.PI;
          this.collisionCooldown = 0; // reset cooldown to navigate out
          this.deliveries++;
          return;
        }
      }

      const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
      const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;

      if (row < CONFIG.SKY_HEIGHT) {
        // On surface: head to entrance
        this.desiredAngle = this.getAngleTowardsTarget(grid, entranceX, entranceY);
        this.desiredPheromone = 'none';
      } else {
        // Underground: steer towards the closest non-full food storage chamber
        const availableStorage = this.getAvailableStorage(grid, foodStorages);
        if (availableStorage) {
          this.desiredAngle = this.getAngleTowardsTarget(grid, availableStorage.x, availableStorage.y);
        } else {
          this.desiredAngle = this.getAngleTowardsTarget(grid, closestStorage.x, closestStorage.y);
        }
        this.desiredPheromone = 'home';
      }
    }
  }

  // --- DIGGER BEHAVIOR ---
  private updateDigger(
    grid: WorldGrid,
    _pheromones: PheromoneGrid,
    activeExcavationStep: ExcavationStep | null,
    activeExcavationTarget: Position | null
  ) {
    const col = Math.floor(this.x / CONFIG.CELL_SIZE);
    const row = Math.floor(this.y / CONFIG.CELL_SIZE);

    if (this.cargo === 'None') {
      this.state = 'DiggingTunnel';

      if (this.diggingChamberTimer > 0) {
        this.diggingChamberTimer--;
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

          const isChamberMode = this.diggingChamberTimer > 0;
          // Normal corridor tunnel width is constrained (<= 3 walkable neighbors).
          // Chamber mode allows wider clearing (<= 6 walkable neighbors).
          // If there is an active coordinated excavation plan, we do NOT restrict width,
          // because the plan bounding box itself defines the shape/width of the rooms and shafts!
          const maxAllowedNeighbors = activeExcavationStep ? 8 : (isChamberMode ? 6 : 3);

          if (walkableNeighbors <= maxAllowedNeighbors) {
            grid.digCell(tc, tr);
            this.cargo = 'Dirt';
            this.state = 'CarryingDirt';
            this.angle += Math.PI;
            this.collisionCooldown = 0; // reset cooldown to navigate back

            // 1.5% chance to start excavating a room (chamber) when digging deep underground (only when not in active coordinated plan)
            if (!activeExcavationStep && !isChamberMode && tr > CONFIG.SKY_HEIGHT + 15 && Math.random() < 0.015) {
              this.diggingChamberTimer = 180; // excavate a chamber for 180 frames
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
            this.cargo = 'Dirt';
            this.state = 'CarryingDirt';
            this.angle += Math.PI;
            this.collisionCooldown = 0;
            return;
          }
        }
      }

      if (row < CONFIG.SKY_HEIGHT) {
        // On surface: head back to the nest entrance
        const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
        const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
        this.desiredAngle = this.getAngleTowardsTarget(grid, entranceX, entranceY);
        this.desiredPheromone = 'none';
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
          this.desiredAngle = this.getAngleTowardsTarget(grid, targetX, targetY);
          this.desiredPheromone = 'none';
        } else {
          if (this.diggingAngle === undefined) {
            this.diggingAngle = Math.PI / 2;
          }
          // Small chance to change tunnel direction deep underground to create forks/branches
          if (Math.random() < 0.015 && row > CONFIG.SKY_HEIGHT + 8) {
            const choices = [Math.PI / 2, Math.PI / 2 - 0.5, Math.PI / 2 + 0.5, 0, Math.PI];
            this.diggingAngle = choices[Math.floor(Math.random() * choices.length)];
          }
          this.desiredAngle = this.diggingAngle;
          this.desiredPheromone = 'none';
        }
      }

    } else if (this.cargo === 'Dirt') {
      this.state = 'CarryingDirt';

      const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
      const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;

      // State check: on surface, walk away from entrance and drop dirt (ALWAYS run this check)
      if (row < CONFIG.SKY_HEIGHT) {
        if (this.targetDropOffset === undefined) {
          this.targetDropOffset = 8 + Math.floor(Math.random() * 16); // 8 to 24 cells
        }
        const distToEntrance = Math.abs(this.x - entranceX);
        if (distToEntrance >= this.targetDropOffset * CONFIG.CELL_SIZE) {
          // Drop dirt
          grid.depositDirt(col);
          this.cargo = 'None';
          this.state = 'DiggingTunnel';
          this.angle += Math.PI;
          this.collisionCooldown = 0; // reset cooldown to navigate back
          this.deliveries++;
          this.targetDropOffset = undefined; // reset
          return;
        }
      }

      if (row >= CONFIG.SKY_HEIGHT) {
        // Underground: find path up.
        this.desiredAngle = this.getAngleTowardsTarget(grid, entranceX, entranceY);
        this.desiredPheromone = 'home';
      } else {
        // On surface: move away from entrance (either left or right)
        const dir = this.x < entranceX ? -1 : 1;
        this.desiredAngle = dir === -1 ? Math.PI : 0;
        this.desiredPheromone = 'none';
      }
    }
  }

  // --- NURSE BEHAVIOR ---
  private updateNurse(
    grid: WorldGrid,
    stockpile: { food: number },
    broodList: any[],
    queenPos: Position & { energy?: number },
    nurseries: Position[],
    foodStorages: Position[],
    broodManager: BroodManager,
    speedMultiplier: number,
    spawnDebris?: (x: number, y: number, color: string, count?: number) => void
  ) {
    const row = Math.floor(this.y / CONFIG.CELL_SIZE);

    // If on surface, prioritize navigating back into the nest entrance
    if (row < CONFIG.SKY_HEIGHT) {
      this.state = 'Wandering';
      const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
      const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
      this.desiredAngle = this.getAngleTowardsTarget(grid, entranceX, entranceY);
      this.desiredPheromone = 'none';
      
      // If carrying a brood on the surface, update its position along with the nurse
      if (this.isHoldingBrood && this.targetBroodId) {
        const brood = broodList.find(b => b.id === this.targetBroodId);
        if (brood) {
          brood.x = this.x;
          brood.y = this.y;
        }
      }
      return;
    }

    // State check: if holding brood, carry it to safe chamber (ALWAYS run this check)
    if (this.isHoldingBrood && this.targetBroodId) {
      this.state = 'Nursing';
      const brood = broodList.find(b => b.id === this.targetBroodId);
      
      if (brood) {
        // Select nursery target based on occupancy and dryness
        const targetNursery = broodManager.getAvailableDryNursery(grid, nurseries) || nurseries.find(n => !isNurseryFlooded(grid, n)) || nurseries[Math.abs(this.num) % nurseries.length];
        
        const spacedPos = targetNursery ? broodManager.findSpacedPositionInNursery(grid, targetNursery) : null;
        // Add a small individual offset so they don't pile exactly on one pixel if no spaced position found
        const targetX = spacedPos ? spacedPos.x : (targetNursery ? targetNursery.x + (this.num % 2 === 0 ? 10 : -10) + (this.num % 3) * 5 : this.x);
        const targetY = spacedPos ? spacedPos.y : (targetNursery ? targetNursery.y + 4 : this.y);

        // Update brood pos to match nurse
        brood.x = this.x;
        brood.y = this.y;

        const dx = targetX - this.x;
        const dy = targetY - this.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < 10) {
          // Drop it
          brood.beingCarried = false;
          this.isHoldingBrood = false;
          this.targetBroodId = null;
          this.collisionCooldown = 0;
          this.deliveries++;
          return;
        }

        this.desiredAngle = this.getAngleTowardsTarget(grid, targetX, targetY);
        this.desiredPheromone = 'none';
      } else {
        this.isHoldingBrood = false;
        this.targetBroodId = null;
      }
      return;
    }

    // State check: Queen hunger has top priority
    const isQueenHungry = queenPos.energy !== undefined && queenPos.energy < 75;

    if (isQueenHungry && this.cargo === 'None' && !this.isHoldingBrood) {
      this.state = 'Nursing';
      
      let closestStorage = foodStorages[0];
      let minDist = Infinity;
      for (const storage of foodStorages) {
        const dist = Math.sqrt((this.x - storage.x) ** 2 + (this.y - storage.y) ** 2);
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
              this.cargoFoodType = cell.foodType || 'Apple';
              cell.foodAmount -= 1;
              stockpile.food -= 1;
              if (cell.foodAmount <= 0) {
                cell.type = 'NestAir';
                cell.foodType = undefined;
              }
              
              if (spawnDebris) {
                let color = 'hsl(0, 80%, 48%)';
                if (this.cargoFoodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
                else if (this.cargoFoodType === 'Carcass') color = 'hsl(280, 60%, 40%)';
                spawnDebris(c * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE/2, r * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE/2, color, 3);
              }

              this.cargo = 'Food';
              this.collisionCooldown = 0;
              foundCell = true;
              break;
            }
          }
          if (foundCell) break;
        }
        if (foundCell) return;
      }

      this.desiredAngle = this.getAngleTowardsTarget(grid, closestStorage.x, closestStorage.y);
      this.desiredPheromone = 'none';
      return;
    }

    if (this.cargo === 'Food' && isQueenHungry) {
      this.state = 'Nursing';
      const dx = queenPos.x - this.x;
      const dy = queenPos.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 12) {
        if (queenPos.energy !== undefined) {
          queenPos.energy = Math.min(100, queenPos.energy + 25);
        }
        this.cargo = 'None';
        this.cargoFoodType = undefined;
        this.collisionCooldown = 0;
        this.deliveries++;
        
        if (spawnDebris) {
          spawnDebris(queenPos.x, queenPos.y, 'hsl(0, 80%, 48%)', 4);
        }
        return;
      }

      this.desiredAngle = this.getAngleTowardsTarget(grid, queenPos.x, queenPos.y);
      this.desiredPheromone = 'none';
      return;
    }

    // State check: if hungry larva exists and nurse has no cargo, go get food (ALWAYS run this check)
    const hungryLarva = broodList.find(b => b.type === 'Larva' && b.needsFood && !b.beingCarried);
    
    if (hungryLarva && this.cargo === 'None') {
      this.state = 'Nursing';
      
      // Find the closest food storage chamber
      let closestStorage = foodStorages[0];
      let minDist = Infinity;
      for (const storage of foodStorages) {
        const dist = Math.sqrt((this.x - storage.x) ** 2 + (this.y - storage.y) ** 2);
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
              this.cargoFoodType = cell.foodType || 'Apple';
              cell.foodAmount -= 1;
              stockpile.food -= 1;
              if (cell.foodAmount <= 0) {
                cell.type = 'NestAir';
                cell.foodType = undefined;
              }
              
              if (spawnDebris) {
                let color = 'hsl(0, 80%, 48%)';
                if (this.cargoFoodType === 'Foliage') color = 'hsl(102, 55%, 35%)';
                else if (this.cargoFoodType === 'Carcass') color = 'hsl(280, 60%, 40%)';
                spawnDebris(c * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE/2, r * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE/2, color, 3);
              }

              this.cargo = 'Food';
              this.collisionCooldown = 0;
              foundCell = true;
              break;
            }
          }
          if (foundCell) break;
        }
        if (foundCell) return;
      }

      this.desiredAngle = this.getAngleTowardsTarget(grid, closestStorage.x, closestStorage.y);
      this.desiredPheromone = 'none';
      return;
    }

    // State check: feed the hungry larva (ALWAYS run this check)
    if (this.cargo === 'Food' && hungryLarva) {
      this.state = 'Nursing';
      const dx = hungryLarva.x - this.x;
      const dy = hungryLarva.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 10) {
        hungryLarva.progress = Math.min(100, hungryLarva.progress + 25);
        hungryLarva.needsFood = false;
        this.cargo = 'None';
        this.cargoFoodType = undefined;
        this.collisionCooldown = 0;
        this.deliveries++;
        
        if (spawnDebris) {
          spawnDebris(hungryLarva.x, hungryLarva.y, 'hsl(0, 80%, 48%)', 4);
        }
        return;
      }

      this.desiredAngle = this.getAngleTowardsTarget(grid, hungryLarva.x, hungryLarva.y);
      this.desiredPheromone = 'none';
      return;
    }

    // Idle Nurse Redistribution Check
    if (this.cargo === 'None' && !this.isHoldingBrood) {
      let nearNursery: Position | null = null;
      for (const nursery of nurseries) {
        const dist = Math.sqrt((this.x - nursery.x) ** 2 + (this.y - nursery.y) ** 2);
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
              this.isHoldingBrood = true;
              this.targetBroodId = targetItem.id;
              this.collisionCooldown = 0;
              this.state = 'Nursing';
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

    if (strayBrood && !this.isHoldingBrood && this.cargo === 'None') {
      this.state = 'Nursing';
      const dx = strayBrood.x - this.x;
      const dy = strayBrood.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist < 8) {
        strayBrood.beingCarried = true;
        this.isHoldingBrood = true;
        this.targetBroodId = strayBrood.id;
        this.collisionCooldown = 0;
        return;
      }

      this.desiredAngle = this.getAngleTowardsTarget(grid, strayBrood.x, strayBrood.y);
      this.desiredPheromone = 'none';
      return;
    }

    // Default: wander around the Queen or Brood area
    this.state = 'Wandering';
    
    const distToQueen = Math.sqrt((this.x - queenPos.x) ** 2 + (this.y - queenPos.y) ** 2);
    if (distToQueen > 80) {
      this.desiredAngle = this.getAngleTowardsTarget(grid, queenPos.x, queenPos.y);
    } else {
      this.desiredAngle = this.angle + (Math.random() - 0.5) * CONFIG.ANT_WANDER_STRENGTH;
    }
    this.desiredPheromone = 'none';
  }

  // --- STEERING AI ---
  private steerWithNeuralNetwork(_grid: WorldGrid, pheromones: PheromoneGrid, speedMultiplier: number) {
    const sensorAngle = CONFIG.ANT_SENSOR_ANGLE;
    const sensorDist = CONFIG.ANT_SENSOR_DIST;

    // Calculate sensor positions
    const leftX = this.x + Math.cos(this.angle - sensorAngle) * sensorDist;
    const leftY = this.y + Math.sin(this.angle - sensorAngle) * sensorDist;
    const centerX = this.x + Math.cos(this.angle) * sensorDist;
    const centerY = this.y + Math.sin(this.angle) * sensorDist;
    const rightX = this.x + Math.cos(this.angle + sensorAngle) * sensorDist;
    const rightY = this.y + Math.sin(this.angle + sensorAngle) * sensorDist;

    // Convert to grid cols/rows
    const lCol = Math.floor(leftX / CONFIG.CELL_SIZE);
    const lRow = Math.floor(leftY / CONFIG.CELL_SIZE);
    const cCol = Math.floor(centerX / CONFIG.CELL_SIZE);
    const cRow = Math.floor(centerY / CONFIG.CELL_SIZE);
    const rCol = Math.floor(rightX / CONFIG.CELL_SIZE);
    const rRow = Math.floor(rightY / CONFIG.CELL_SIZE);

    let leftVal = 0;
    let centerVal = 0;
    let rightVal = 0;

    if (this.desiredPheromone === 'food') {
      leftVal = pheromones.getFoodPheromone(lCol, lRow);
      centerVal = pheromones.getFoodPheromone(cCol, cRow);
      rightVal = pheromones.getFoodPheromone(rCol, rRow);
    } else if (this.desiredPheromone === 'home') {
      leftVal = pheromones.getHomePheromone(lCol, lRow);
      centerVal = pheromones.getHomePheromone(cCol, cRow);
      rightVal = pheromones.getHomePheromone(rCol, rRow);
    }

    // Target angle error normalized to [-1, 1]
    let angleDiff = this.desiredAngle - this.angle;
    angleDiff = Math.atan2(Math.sin(angleDiff), Math.cos(angleDiff));
    const targetAngleError = angleDiff / Math.PI;

    // Stuck indicator
    const stuckIndicator = this.collisionTimer > 0 ? 1.0 : -1.0;

    // Run feedforward
    const inputs = [
      leftVal,
      centerVal,
      rightVal,
      targetAngleError,
      stuckIndicator
    ];

    let sum = this.brain.bias;
    for (let i = 0; i < 5; i++) {
      sum += this.brain.weights[i] * inputs[i];
    }

    const output = Math.tanh(sum);

    // If following a strict A* path, bypass the neural network to avoid wide turns and wall crashes
    if (this.currentPath && this.currentPath.length > 0 && this.collisionCooldown <= 0) {
      this.angle = this.desiredAngle; // instant snap
    } else {
      // Steer using neural network by up to 0.15 radians
      this.angle += output * 0.15 * speedMultiplier;
    }
    this.angle = normalizeAngle(this.angle);
  }

  private getAngleTowardsTarget(grid: WorldGrid, targetX: number, targetY: number): number {
    const CELL_SIZE = CONFIG.CELL_SIZE;
    const curCol = Math.floor(this.x / CELL_SIZE);
    const curRow = Math.floor(this.y / CELL_SIZE);
    const targetCol = Math.floor(targetX / CELL_SIZE);
    const targetRow = Math.floor(targetY / CELL_SIZE);

    // If target changed, or no path, recalculate
    if (!this.currentPath || !this.pathTarget || this.pathTarget.x !== targetCol || this.pathTarget.y !== targetRow) {
      this.currentPath = findPath(grid, curCol, curRow, targetCol, targetRow) || [];
      this.pathTarget = { x: targetCol, y: targetRow };
    }

    if (this.currentPath && this.currentPath.length > 0) {
      // Steer towards next waypoint
      const nextWP = this.currentPath[0];
      const dx = nextWP.x - this.x;
      const dy = nextWP.y - this.y;
      
      const curCol = Math.floor(this.x / CELL_SIZE);
      const curRow = Math.floor(this.y / CELL_SIZE);
      const wpCol = Math.floor(nextWP.x / CELL_SIZE);
      const wpRow = Math.floor(nextWP.y / CELL_SIZE);

      // Pop the waypoint if we've entered its cell, or if we're extremely close
      if ((curCol === wpCol && curRow === wpRow) || (dx * dx + dy * dy < CELL_SIZE * CELL_SIZE)) {
        this.currentPath.shift();
        if (this.currentPath.length > 0) {
          const nextNext = this.currentPath[0];
          return Math.atan2(nextNext.y - this.y, nextNext.x - this.x);
        }
      }
      return Math.atan2(dy, dx);
    }

    // Fallback if no path found (should be rare)
    return Math.atan2(targetY - this.y, targetX - this.x);
  }

  private isStorageFull(grid: WorldGrid, storage: Position): boolean {
    const sCol = Math.floor(storage.x / CONFIG.CELL_SIZE);
    const sRow = Math.floor(storage.y / CONFIG.CELL_SIZE);
    const entranceCol = grid.nestEntranceCol;
    const centerRow = STARTING_CHAMBER_CENTER_ROW;

    // Check if it's the starting Queen larder
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
    return true;
  }

  private getAvailableStorage(grid: WorldGrid, foodStorages: Position[]): Position | null {
    let closest: Position | null = null;
    let minDist = Infinity;
    for (const storage of foodStorages) {
      if (!this.isStorageFull(grid, storage)) {
        const dist = Math.sqrt((this.x - storage.x) ** 2 + (this.y - storage.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = storage;
        }
      }
    }
    return closest;
  }
}
