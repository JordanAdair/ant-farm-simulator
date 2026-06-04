import { CONFIG, isCellInsidePlanStep } from './types';
import type { AntRole, AntState, Position, ExcavationStep, AntBrain } from './types';
import { WorldGrid } from './Grid';
import { PheromoneGrid } from './Pheromones';

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

export class Ant {
  public id: string;
  public x: number;
  public y: number;
  public angle: number;
  public role: AntRole;
  public state: AntState;
  
  public cargo: 'None' | 'Food' | 'Dirt' = 'None';
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

  // Steering targets resolved by state machines
  public desiredAngle: number;
  public desiredPheromone: 'food' | 'home' | 'none' = 'none';

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
    this.maxAge = 600 + Math.random() * 300; // 10 to 15 minutes of life at 1x speed
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
    speedMultiplier: number
  ) {
    const speed = CONFIG.ANT_SPEED * speedMultiplier;
    this.legCycle += 0.25 * speedMultiplier;

    // Energy slowly depletes
    this.energy -= 0.01 * speedMultiplier;
    if (this.energy < 20 && this.state !== 'Resting') {
      this.state = 'Resting'; // go home and eat
    }

    if (this.collisionCooldown > 0) {
      this.collisionCooldown -= speedMultiplier;
    }
    if (this.collisionTimer > 0) {
      this.collisionTimer -= speedMultiplier;
    }

    // Reset steering targets at start of frame
    this.desiredAngle = this.angle;
    this.desiredPheromone = 'none';

    // Role state machines
    if (this.state === 'Resting') {
      this.updateResting(grid, stockpile, foodStorages);
    } else {
      switch (this.role) {
        case 'Forager':
          this.updateForager(grid, pheromones, stockpile, foodStorages);
          break;
        case 'Digger':
          this.updateDigger(grid, pheromones, activeExcavationStep, activeExcavationTarget);
          break;
        case 'Nurse':
          this.updateNurse(grid, stockpile, broodList, queenPos, nurseries, foodStorages);
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
    this.moveAndAvoidObstacles(grid, speed);
  }

  // --- RESTING / REFUELLING ---
  private updateResting(
    grid: WorldGrid,
    stockpile: { food: number },
    foodStorages: Position[]
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
      }
      this.energy = CONFIG.ANT_MAX_ENERGY;
      this.state = this.role === 'Forager' ? 'SearchingForFood' : (this.role === 'Nurse' ? 'Wandering' : 'DiggingTunnel');
      this.angle += Math.PI; // turn around
      this.collisionCooldown = 0;
      return;
    }

    // Go back to the nest
    if (row < CONFIG.SKY_HEIGHT) {
      // On surface: head to entrance
      this.desiredAngle = this.steerTowardsTargetNest(grid, entranceX, entranceY);
      this.desiredPheromone = 'none';
    } else {
      // Underground: head to closest food storage
      this.desiredAngle = this.steerTowardsTargetNest(grid, closestStorage.x, closestStorage.y);
      this.desiredPheromone = 'home';
    }
  }

  // --- FORAGER BEHAVIOR ---
  private updateForager(
    grid: WorldGrid,
    pheromones: PheromoneGrid,
    stockpile: { food: number },
    foodStorages: Position[]
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
            cell.foodAmount = Math.max(0, cell.foodAmount - CONFIG.FOOD_PIECE_SIZE);
            if (cell.foodAmount <= 0) {
              grid.setCellType(tc, tr, 'Sky');
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
      let closeToStorage = false;
      let minDist = Infinity;
      for (const storage of foodStorages) {
        const dist = Math.sqrt((this.x - storage.x) ** 2 + (this.y - storage.y) ** 2);
        if (dist < minDist) {
          minDist = dist;
        }
      }
      if (minDist < 30) {
        closeToStorage = true;
      }

      if (closeToStorage) {
        stockpile.food += CONFIG.FOOD_PIECE_SIZE;
        this.cargo = 'None';
        this.state = 'SearchingForFood';
        this.angle += Math.PI;
        this.collisionCooldown = 0; // reset cooldown to navigate out
        this.deliveries++;
        return;
      }

      const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
      const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;

      if (row < CONFIG.SKY_HEIGHT) {
        // On surface: head to entrance
        this.desiredAngle = this.steerTowardsTargetNest(grid, entranceX, entranceY);
        this.desiredPheromone = 'none';
      } else {
        // Underground: steer towards the closest food storage chamber and follow home pheromone
        let closestStorage = foodStorages[0];
        let minDist = Infinity;
        for (const storage of foodStorages) {
          const dist = Math.sqrt((this.x - storage.x) ** 2 + (this.y - storage.y) ** 2);
          if (dist < minDist) {
            minDist = dist;
            closestStorage = storage;
          }
        }
        this.desiredAngle = this.steerTowardsTargetNest(grid, closestStorage.x, closestStorage.y);
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

      if (row < CONFIG.SKY_HEIGHT) {
        // On surface: head back to the nest entrance
        const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
        const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
        this.desiredAngle = this.steerTowardsTargetNest(grid, entranceX, entranceY);
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
          this.desiredAngle = this.steerTowardsTargetNest(grid, targetX, targetY);
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
      const entranceY = (CONFIG.SKY_HEIGHT - 1) * CONFIG.CELL_SIZE;

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
        this.desiredAngle = this.steerTowardsTargetNest(grid, entranceX, entranceY);
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
    queenPos: Position,
    nurseries: Position[],
    foodStorages: Position[]
  ) {
    const row = Math.floor(this.y / CONFIG.CELL_SIZE);

    // If on surface, prioritize navigating back into the nest entrance
    if (row < CONFIG.SKY_HEIGHT) {
      this.state = 'Wandering';
      const entranceX = grid.nestEntranceCol * CONFIG.CELL_SIZE;
      const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
      this.desiredAngle = this.steerTowardsTargetNest(grid, entranceX, entranceY);
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
        // Select nursery target based on ant ID/number to distribute them across all excavated nurseries
        const nurseryIndex = Math.abs(this.num) % nurseries.length;
        const targetNursery = nurseries[nurseryIndex];
        
        // Add a small individual offset so they don't pile exactly on one pixel
        const targetX = targetNursery.x + (this.num % 2 === 0 ? 10 : -10) + (this.num % 3) * 5;
        const targetY = targetNursery.y + 4;

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

        this.desiredAngle = this.steerTowardsTargetNest(grid, targetX, targetY);
        this.desiredPheromone = 'none';
      } else {
        this.isHoldingBrood = false;
        this.targetBroodId = null;
      }
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
        if (stockpile.food >= 1) {
          stockpile.food -= 1;
          this.cargo = 'Food';
          this.collisionCooldown = 0;
          return;
        }
      }

      this.desiredAngle = this.steerTowardsTargetNest(grid, closestStorage.x, closestStorage.y);
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
        this.collisionCooldown = 0;
        this.deliveries++;
        return;
      }

      this.desiredAngle = this.steerTowardsTargetNest(grid, hungryLarva.x, hungryLarva.y);
      this.desiredPheromone = 'none';
      return;
    }

    // State check: pick up misplaced eggs / pupae and take them to nursery (ALWAYS run this check)
    const strayBrood = broodList.find(b => {
      if (b.beingCarried) return false;
      if (b.type !== 'Egg' && b.type !== 'Pupa') return false;
      
      // Check if it is close to ANY excavated nursery
      let inNursery = false;
      for (const nursery of nurseries) {
        const dist = Math.sqrt((b.x - nursery.x) ** 2 + (b.y - nursery.y) ** 2);
        if (dist < 40) {
          inNursery = true;
          break;
        }
      }
      return !inNursery;
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

      this.desiredAngle = this.steerTowardsTargetNest(grid, strayBrood.x, strayBrood.y);
      this.desiredPheromone = 'none';
      return;
    }

    // Default: wander around the Queen or Brood area
    this.state = 'Wandering';
    
    const distToQueen = Math.sqrt((this.x - queenPos.x) ** 2 + (this.y - queenPos.y) ** 2);
    if (distToQueen > 80) {
      this.desiredAngle = this.steerTowardsTargetNest(grid, queenPos.x, queenPos.y);
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

    // Steer by up to 0.15 radians
    this.angle += output * 0.15 * speedMultiplier;
    this.normalizeAngle();
  }

  // --- COLLISION RESPONSE ---
  private moveAndAvoidObstacles(grid: WorldGrid, speed: number) {
    // 1. Gravity on the surface (Only for cells that are Sky or Food)
    const currentCol = Math.floor(this.x / CONFIG.CELL_SIZE);
    const currentRow = Math.floor(this.y / CONFIG.CELL_SIZE);
    
    if (grid.isValid(currentCol, currentRow)) {
      const currentCell = grid.getCell(currentCol, currentRow);
      if (currentCell && (currentCell.type === 'Sky' || currentCell.type === 'Food')) {
        // Check for solid support in a 5x2 region (horizontal range of 2 cells, vertical range from currentRow to currentRow + 1)
        // This gives ants enough wall-clinging range to navigate steep mounds and narrow valley gaps without losing support due to wandering
        let hasSupport = false;
        for (let dc = -2; dc <= 2; dc++) {
          for (let dr = 0; dr <= 1; dr++) {
            if (grid.isValid(currentCol + dc, currentRow + dr)) {
              if (!grid.isWalkable(currentCol + dc, currentRow + dr)) {
                hasSupport = true;
                break;
              }
            }
          }
          if (hasSupport) break;
        }

        // Only apply gravity if the ant has no physical support nearby (i.e. not climbing a wall, slope, or standing on a block)
        if (!hasSupport) {
          // Fall down due to gravity (velocity scales with game speed)
          this.y += 1.5 * (speed / CONFIG.ANT_SPEED);
        }
      }
    }

    // 2. Escape hatch: If we are trapped inside a solid tile, find the nearest walkable tile in a 5-cell radius and snap to it.
    const snapCol = Math.floor(this.x / CONFIG.CELL_SIZE);
    const snapRow = Math.floor(this.y / CONFIG.CELL_SIZE);
    if (!grid.isWalkable(snapCol, snapRow)) {
      let found = false;
      for (let r = 1; r <= 5 && !found; r++) {
        const searchOffsets = [
          [0, -r], [0, r], [-r, 0], [r, 0],
          [-r, -r], [-r, r], [r, -r], [r, r],
          [-r, -Math.floor(r/2)], [-r, Math.floor(r/2)],
          [r, -Math.floor(r/2)], [r, Math.floor(r/2)],
          [-Math.floor(r/2), -r], [Math.floor(r/2), -r],
          [-Math.floor(r/2), r], [Math.floor(r/2), r]
        ];
        for (const [dc, dr] of searchOffsets) {
          const tc = snapCol + dc;
          const tr = snapRow + dr;
          if (grid.isWalkable(tc, tr)) {
            // Snap to center of walkable cell to clear solid boundary
            this.x = tc * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
            this.y = tr * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
            found = true;
            break;
          }
        }
      }
      if (!found) {
        // Fallback: teleport to nest entrance
        this.x = grid.nestEntranceCol * CONFIG.CELL_SIZE;
        this.y = (CONFIG.SKY_HEIGHT - 1) * CONFIG.CELL_SIZE;
      }
    }

    // Wander slightly to look alive (only when not in collision cooldown)
    if (this.collisionCooldown <= 0) {
      this.angle += (Math.random() - 0.5) * CONFIG.ANT_WANDER_STRENGTH;
    }

    let nextX = this.x + Math.cos(this.angle) * speed;
    let nextY = this.y + Math.sin(this.angle) * speed;

    const cushion = 1.5;
    const lookAheadX = nextX + Math.cos(this.angle) * cushion;
    const lookAheadY = nextY + Math.sin(this.angle) * cushion;
    const nextCol = Math.floor(lookAheadX / CONFIG.CELL_SIZE);
    const nextRow = Math.floor(lookAheadY / CONFIG.CELL_SIZE);

    if (grid.isWalkable(nextCol, nextRow)) {
      this.x = nextX;
      this.y = nextY;
    } else {
      // Collision detected! Try sliding horizontally or vertically.
      const canSlideHorizontal = grid.isWalkable(nextCol, snapRow);
      const canSlideVertical = grid.isWalkable(snapCol, nextRow);

      if (canSlideHorizontal && !canSlideVertical) {
        // Slide horizontally
        const slideDir = Math.cos(this.angle) >= 0 ? 1 : -1;
        this.x += slideDir * speed;
        // Deflect angle towards horizontal
        const targetAngle = slideDir === 1 ? 0 : Math.PI;
        this.steerTowardsAngle(targetAngle, 0.2);
        this.collisionCooldown = 6; // set cooldown to let the slide complete without steer override
        this.collisions++;
        this.collisionTimer = 20;
      } else if (canSlideVertical && !canSlideHorizontal) {
        // Slide vertically
        let slideDir = Math.sin(this.angle) > 0 ? 1 : -1;
        if (Math.abs(Math.sin(this.angle)) < 0.1) {
          // If moving almost horizontally, choose vertical direction towards target or sky
          if (snapRow < CONFIG.SKY_HEIGHT + 5) {
            slideDir = -1; // Climb up surface mounds
          } else {
            // Underground: climb up or down
            slideDir = Math.random() < 0.5 ? 1 : -1;
          }
        }
        this.y += slideDir * speed;
        // Deflect angle towards vertical
        const targetAngle = slideDir === 1 ? Math.PI / 2 : -Math.PI / 2;
        this.steerTowardsAngle(targetAngle, 0.2);
        this.collisionCooldown = 6; // set cooldown to let the slide complete without steer override
        this.collisions++;
        this.collisionTimer = 20;
      } else {
        // Both directions blocked (corner or head-on collision)
        // Find a walkable direction by scanning alternative angles
        let foundWalkable = false;
        const angleScans = [0.4, -0.4, 0.8, -0.8, 1.2, -1.2, Math.PI];

        for (const da of angleScans) {
          const scanAngle = this.angle + da;
          const checkX = this.x + Math.cos(scanAngle) * CONFIG.CELL_SIZE;
          const checkY = this.y + Math.sin(scanAngle) * CONFIG.CELL_SIZE;
          const checkCol = Math.floor(checkX / CONFIG.CELL_SIZE);
          const checkRow = Math.floor(checkY / CONFIG.CELL_SIZE);

          if (grid.isWalkable(checkCol, checkRow)) {
            this.angle = scanAngle;
            // Move forward by speed
            this.x += Math.cos(scanAngle) * speed;
            this.y += Math.sin(scanAngle) * speed;
            this.collisionCooldown = 12; // 12 updates cooldown
            foundWalkable = true;
            this.collisions++;
            this.collisionTimer = 20;
            break;
          }
        }

        if (!foundWalkable) {
          // Complete turnaround
          this.angle += Math.PI;
          this.collisionCooldown = 15;
          this.collisions++;
          this.collisionTimer = 20;
        }
      }
    }

    // Hard boundary clamping and bounce
    const maxX = grid.cols * CONFIG.CELL_SIZE - 4;
    const maxY = grid.rows * CONFIG.CELL_SIZE - 4;

    if (this.x <= 4) {
      this.x = 4;
      this.angle = Math.PI - this.angle; // Bounce horizontally
      this.collisions++;
      this.collisionTimer = 20;
    } else if (this.x >= maxX) {
      this.x = maxX;
      this.angle = Math.PI - this.angle; // Bounce horizontally
      this.collisions++;
      this.collisionTimer = 20;
    }

    if (this.y <= 4) {
      this.y = 4;
      this.angle = -this.angle; // Bounce vertically
      this.collisions++;
      this.collisionTimer = 20;
    } else if (this.y >= maxY) {
      this.y = maxY;
      this.angle = -this.angle; // Bounce vertically
      this.collisions++;
      this.collisionTimer = 20;
    }

    this.normalizeAngle();
  }

  private steerTowardsAngle(target: number, rate: number) {
    let diff = target - this.angle;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.angle += diff * rate;
    this.normalizeAngle();
  }

  private normalizeAngle() {
    this.angle = Math.atan2(Math.sin(this.angle), Math.cos(this.angle));
  }

  private steerTowardsTargetNest(grid: WorldGrid, targetX: number, targetY: number): number {
    const CELL_SIZE = CONFIG.CELL_SIZE;
    const curCol = Math.floor(this.x / CELL_SIZE);
    const curRow = Math.floor(this.y / CELL_SIZE);
    const targetCol = Math.floor(targetX / CELL_SIZE);
    const targetRow = Math.floor(targetY / CELL_SIZE);
    const skyRow = CONFIG.SKY_HEIGHT;

    const shaftColStart = grid.nestEntranceCol - 2;
    const shaftColEnd = grid.nestEntranceCol + 1;
    const shaftMidX = (grid.nestEntranceCol * CELL_SIZE) + (CELL_SIZE / 2);

    // If both the ant and the target are above the surface, steer directly
    if (curRow < skyRow && targetRow < skyRow) {
      const dx = targetX - this.x;
      const dy = targetY - this.y;
      return Math.atan2(dy, dx);
    }

    // If the ant is on the surface (above the nest) and the target is underground:
    // It must first go to the nest entrance (shaft top)
    if (curRow < skyRow && targetRow >= skyRow) {
      const entranceX = grid.nestEntranceCol * CELL_SIZE;
      const entranceY = skyRow * CELL_SIZE;
      const dx = entranceX - this.x;
      if (Math.abs(dx) < CELL_SIZE * 3.0) {
        return Math.PI / 2; // Go straight down into the shaft
      } else {
        const dy = entranceY - this.y;
        return Math.atan2(dy, dx);
      }
    }

    // If the ant is underground and the target is on the surface:
    // It must first climb up the shaft to the surface
    if (curRow >= skyRow && targetRow < skyRow) {
      // If we are in the shaft, go straight up
      if (curCol >= shaftColStart && curCol <= shaftColEnd) {
        return -Math.PI / 2; // Go straight up
      } else {
        // We are in a side chamber, walk horizontally towards the shaft
        const dx = shaftMidX - this.x;
        return Math.atan2(0, dx); // steer purely horizontally (dy = 0) to avoid getting stuck on chamber ceilings/floors
      }
    }

    // Both ant and target are underground (row >= skyRow)
    const inShaft = curCol >= shaftColStart && curCol <= shaftColEnd;

    if (inShaft) {
      // If we are in the shaft:
      // If we need to go to a different height, move vertically
      if (Math.abs(curRow - targetRow) > 2) {
        const dy = targetY - this.y;
        return Math.atan2(dy, 0); // Move vertically (dx = 0) within the shaft
      } else {
        // We are at the correct height, steer towards target
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        return Math.atan2(dy, dx);
      }
    } else {
      // We are in a side chamber (left or right)
      // Check if target is on the same side AND at roughly the same height
      const sameSide = (curCol < shaftColStart && targetCol < shaftColStart) ||
                       (curCol > shaftColEnd && targetCol > shaftColEnd);
      
      if (sameSide && Math.abs(curRow - targetRow) <= 4) {
        // Direct steering
        const dx = targetX - this.x;
        const dy = targetY - this.y;
        return Math.atan2(dy, dx);
      } else {
        // Target is on the other side, or at a different height.
        // We must walk horizontally to the shaft first.
        const dx = shaftMidX - this.x;
        // Keep dy small or zero to walk straight horizontally into the shaft
        return Math.atan2(0, dx);
      }
    }
  }
}
