import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from './types';
import type { Brood, AntRole, ExcavationStep, Position, AntBrain, LogEntry, LarderBox } from './types';
import { Ant, createDefaultBrain } from './Ant';
import { WorldGrid } from './Grid';
import { generateProceduralNestPlan, isCellInsidePlanStep } from './NestPlanner';
import { BroodManager } from './BroodManager';
import { findPath } from './Pathfinder';

export class ColonyManager {
  private _grid?: WorldGrid;
  private _fallbackFoodStockpile: number = 200;

  public get grid(): WorldGrid | undefined {
    return this._grid;
  }

  public set grid(g: WorldGrid | undefined) {
    const wasUndefined = !this._grid;
    this._grid = g;
    if (wasUndefined && g) {
      const physicalFood = this.foodStockpile;
      if (physicalFood === 0 && this._fallbackFoodStockpile > 0) {
        this.foodStockpile = this._fallbackFoodStockpile;
      } else {
        this._fallbackFoodStockpile = physicalFood;
      }
    }
  }

  public get foodStockpile(): number {
    if (!this._grid || typeof this._grid.getCell !== 'function') {
      return this._fallbackFoodStockpile;
    }
    const larders = this.getLarderBoxes(this._grid);
    let total = 0;
    for (const box of larders) {
      for (let c = box.minCol; c <= box.maxCol; c++) {
        for (let r = box.minRow; r <= box.maxRow; r++) {
          const cell = this._grid.getCell(c, r);
          if (cell && cell.type === 'Food') {
            total += cell.foodAmount;
          }
        }
      }
    }
    return total;
  }

  public set foodStockpile(value: number) {
    this._fallbackFoodStockpile = value;
    if (!this._grid || typeof this._grid.getCell !== 'function') return;

    const current = this.foodStockpile;
    const diff = value - current;

    if (diff === 0) return;

    const larders = this.getLarderBoxes(this._grid);

    if (diff > 0) {
      let remainingToAdd = diff;
      for (const box of larders) {
        if (remainingToAdd <= 0) break;
        for (let c = box.minCol; c <= box.maxCol; c++) {
          if (remainingToAdd <= 0) break;
          for (let r = box.minRow; r <= box.maxRow; r++) {
            if (remainingToAdd <= 0) break;
            const cell = this._grid.getCell(c, r);
            if (cell && cell.type === 'NestAir') {
              cell.type = 'Food';
              cell.foodType = 'Apple';
              const amt = Math.min(remainingToAdd, CONFIG.FOOD_PIECE_SIZE);
              cell.foodAmount = amt;
              remainingToAdd -= amt;
            } else if (cell && cell.type === 'Food' && cell.foodAmount < CONFIG.FOOD_PIECE_SIZE) {
              const cap = CONFIG.FOOD_PIECE_SIZE - cell.foodAmount;
              const add = Math.min(remainingToAdd, cap);
              cell.foodAmount += add;
              remainingToAdd -= add;
            }
          }
        }
      }
    } else {
      let remainingToRemove = -diff;
      for (let b = larders.length - 1; b >= 0; b--) {
        if (remainingToRemove <= 0) break;
        const box = larders[b];
        for (let c = box.maxCol; c >= box.minCol; c--) {
          if (remainingToRemove <= 0) break;
          for (let r = box.maxRow; r >= box.minRow; r--) {
            if (remainingToRemove <= 0) break;
            const cell = this._grid.getCell(c, r);
            if (cell && cell.type === 'Food') {
              const amt = cell.foodAmount;
              if (amt <= remainingToRemove) {
                cell.type = 'NestAir';
                cell.foodAmount = 0;
                cell.foodType = undefined;
                remainingToRemove -= amt;
              } else {
                cell.foodAmount -= remainingToRemove;
                remainingToRemove = 0;
              }
            }
          }
        }
      }
    }
  }

  public ants: Ant[] = [];
  private _broodList: Brood[] = [];
  public get broodList(): Brood[] {
    return this._broodList;
  }
  public set broodList(val: Brood[]) {
    this._broodList = val;
    if (this.broodManager) {
      this.broodManager.broodList = val;
    }
  }
  public queen: {
    x: number;
    y: number;
    energy: number;
    eggTimer: number;
    direction: number;
    targetX: number;
    restTimer?: number;
    currentNursery?: Position;
    path?: Position[];
    isDead?: boolean;
  };
  public logs: LogEntry[] = [];
  public nextAntNum: number = 1; // counter for numbering ants
  public excavationPlan: ExcavationStep[] = [];
  public lastActiveStepName: string | null = null;
  public broodManager: BroodManager;

  constructor(entranceCol: number) {
    const startX = entranceCol * CONFIG.CELL_SIZE;
    const startY = STARTING_CHAMBER_CENTER_ROW * CONFIG.CELL_SIZE; // queen chamber height

    this.queen = {
      x: startX,
      y: startY,
      energy: 100,
      eggTimer: CONFIG.QUEEN_EGG_INTERVAL,
      direction: 1, // 1 for right, -1 for left
      targetX: startX,
      restTimer: 0,
      currentNursery: { x: startX - 40, y: startY + 4 },
      path: [],
    };

    // Generate procedural nest plan
    this.excavationPlan = generateProceduralNestPlan(entranceCol);

    this.broodManager = new BroodManager();
    this.broodManager.broodList = this.broodList; // keep reference synced

    // Spawn initial workers
    this.spawnInitialColony(startX, startY);
    this.addLog('Colony founded. The Queen has settled in.', 'system');
  }

  private spawnInitialColony(startX: number, startY: number) {
    // 3 foragers, 4 diggers, 1 nurse (starts small to allow growth progression)
    const initialRoles: AntRole[] = [
      'Forager', 'Forager', 'Forager',
      'Digger', 'Digger', 'Digger', 'Digger',
      'Nurse'
    ];
    initialRoles.forEach((role) => {
      // Give them a random position within the central chamber
      const dx = (Math.random() - 0.5) * 40;
      const dy = (Math.random() - 0.5) * 10;
      const num = this.nextAntNum++;
      const ant = new Ant(`ant-${num}`, startX + dx, startY + dy, role, num, createDefaultBrain(), 1);
      // Randomize initial age so they die at staggered times (start already partially aged: 0 to 180 seconds)
      ant.age = Math.random() * 180;
      this.ants.push(ant);
    });
  }

  public addLog(message: string, category: 'system' | 'births' | 'deaths' = 'system') {
    const timestamp = Date.now();
    const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    this.logs.unshift({
      text: `[${timeStr}] ${message}`,
      category,
      timestamp
    });
    // Keep last 40 logs
    if (this.logs.length > 40) {
      this.logs.pop();
    }
  }

  public update(speedMultiplier: number, grid?: WorldGrid) {
    const activeGrid = grid || new WorldGrid();
    this.grid = activeGrid;
    const dt = 1 * speedMultiplier;

    // 1. Queen egg laying and energy
    // Deplete Queen energy over time (rate: 100 energy lost in 24 simulated hours, which is 21600 frames at 1x speed)
    if (!this.queen.isDead) {
      const queenEnergyLoss = (100 / 21600) * dt;
      this.queen.energy = Math.max(0, this.queen.energy - queenEnergyLoss);

      if (this.queen.energy <= 0) {
        this.queen.isDead = true;
        this.addLog('The Queen has died of starvation! Colony Collapse is imminent.', 'deaths');
      }
    }

    if (!this.queen.isDead) {
      // The egg timer always ticks down, regardless of food stockpile!
      this.queen.eggTimer -= (1 / 60) * dt;
      if (this.queen.eggTimer <= 0) {
        if (this.foodStockpile >= 10) {
          const chambers = this.getExcavatedChambers(activeGrid);
          const currentNursery = this.queen.currentNursery || chambers.nurseries[0];

          if (currentNursery && this.broodManager.isNurseryFull(currentNursery)) {
            // Find another nursery that is NOT full
            const nextNursery = this.broodManager.getAvailableNursery(chambers.nurseries);
            if (nextNursery && (nextNursery.x !== currentNursery.x || nextNursery.y !== currentNursery.y)) {
              // Initiate pathfinding to relocation
              const startCol = Math.floor(this.queen.x / CONFIG.CELL_SIZE);
              const startRow = Math.floor(this.queen.y / CONFIG.CELL_SIZE);
              const targetCol = Math.floor(nextNursery.x / CONFIG.CELL_SIZE);
              const targetRow = Math.floor(nextNursery.y / CONFIG.CELL_SIZE);
              const newPath = findPath(activeGrid, startCol, startRow, targetCol, targetRow);
              if (newPath) {
                this.queen.path = newPath;
                this.queen.currentNursery = nextNursery;
                this.addLog('Nursery is full. The Queen is relocating to a new chamber.', 'system');
                this.queen.eggTimer = 0;
              }
            }
          }

          // Only lay egg if not currently relocating
          if (!this.queen.path || this.queen.path.length === 0) {
            this.foodStockpile -= 10;
            this.broodManager.layEgg(activeGrid, this.queen, chambers.nurseries, (msg, cat) => this.addLog(msg, cat));
            this.queen.eggTimer = CONFIG.QUEEN_EGG_INTERVAL + Math.random() * 20; // reset
          }
        } else {
          // Keep the egg timer at 0 so she lays immediately when food becomes available
          this.queen.eggTimer = 0;
        }
      }
    }

    if (this.foodStockpile > 0) {
      // Passive consumption scales with the number of worker ants in the colony (aligned with OfflineProgression)
      const passiveConsumption = this.ants.length * CONFIG.FOOD_CONSUMPTION_RATE * 0.1 * (dt / 60);
      this.foodStockpile = Math.max(0, this.foodStockpile - passiveConsumption);
    }

    // Queen motion
    if (!this.queen.isDead) {
      if (this.queen.path && this.queen.path.length > 0) {
        const target = this.queen.path[0];
        const dx = target.x - this.queen.x;
        const dy = target.y - this.queen.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const queenSpeed = 0.5 * speedMultiplier; // Queen moves regally and steadily
        if (dist <= queenSpeed) {
          this.queen.x = target.x;
          this.queen.y = target.y;
          this.queen.path.shift();
        } else {
          this.queen.x += (dx / dist) * queenSpeed;
          this.queen.y += (dy / dist) * queenSpeed;
        }
      } else {
        // Queen pacing motion inside the current nursery chamber
        if (this.queen.restTimer === undefined) {
          this.queen.restTimer = 0;
        }

        if (this.queen.currentNursery) {
          this.queen.y = this.queen.currentNursery.y;
        }

        const pacingCenter = this.queen.currentNursery ? this.queen.currentNursery.x : (CONFIG.COLS / 2) * CONFIG.CELL_SIZE;
        const minX = pacingCenter - 16;
        const maxX = pacingCenter + 16;

        if (this.queen.restTimer > 0) {
          this.queen.restTimer -= dt;
        } else {
          const speed = 0.12 * speedMultiplier; // Queen moves regally and slowly

          if (this.queen.targetX === undefined) {
            this.queen.targetX = this.queen.x;
          }
          if (this.queen.direction === undefined) {
            this.queen.direction = 1;
          }

          // Move towards target
          this.queen.x += this.queen.direction * speed;

          // Check if crossed or close to target
          const crossedTarget = this.queen.direction === 1
            ? this.queen.x >= this.queen.targetX
            : this.queen.x <= this.queen.targetX;

          if (crossedTarget || Math.abs(this.queen.x - this.queen.targetX) < 2) {
            // Reached target, rest for 5-10 seconds (300 to 600 frames)
            this.queen.restTimer = 300 + Math.random() * 300;
            this.queen.targetX = minX + Math.random() * (maxX - minX);
            this.queen.direction = this.queen.targetX > this.queen.x ? 1 : -1;
          }

          // Hard boundary clamping to prevent runaway under high speed multipliers
          if (this.queen.x < minX) {
            this.queen.x = minX;
            this.queen.targetX = minX + Math.random() * (maxX - minX);
            this.queen.direction = 1;
            this.queen.restTimer = 300 + Math.random() * 300;
          } else if (this.queen.x > maxX) {
            this.queen.x = maxX;
            this.queen.targetX = minX + Math.random() * (maxX - minX);
            this.queen.direction = -1;
            this.queen.restTimer = 300 + Math.random() * 300;
          }
        }
      }
    }

    // 2. Brood lifecycle updates
    this.broodManager.update(dt, (x, y) => this.hatchAnt(x, y), (msg, cat) => this.addLog(msg, cat));

    // 3. Dynamic role balancing for ants
    this.balanceAntRoles();
  }

  private getParentBrain(): { brain: AntBrain; generation: number } | null {
    if (this.ants.length === 0) return null;

    const tournamentSize = Math.min(3, this.ants.length);
    let bestAnt: Ant | null = null;
    let bestFitness = -Infinity;

    for (let i = 0; i < tournamentSize; i++) {
      const idx = Math.floor(Math.random() * this.ants.length);
      const ant = this.ants[idx];
      const fitness = ant.getFitness();
      if (fitness > bestFitness) {
        bestFitness = fitness;
        bestAnt = ant;
      }
    }

    if (bestAnt) {
      return {
        brain: bestAnt.brain,
        generation: bestAnt.generation,
      };
    }
    return null;
  }

  private hatchAnt(x: number, y: number) {
    const num = this.nextAntNum++;
    const id = `ant-${num}`;
    // Assign a temporary role (will be balanced immediately)
    const role = this.getUnderRepresentedRole();
    const parent = this.getParentBrain();

    let childBrain: AntBrain;
    let childGen = 1;

    if (parent) {
      childGen = parent.generation + 1;
      const mutatedWeights = parent.brain.weights.map((w, idx) => {
        const mutation = Math.random() * 0.2 - 0.1;
        const newW = w + mutation;
        if (idx === 3) {
          return Math.max(0.4, Math.min(2.0, newW));
        }
        return Math.max(-2, Math.min(2, newW));
      });
      const mutatedBias = Math.max(-2, Math.min(2, parent.brain.bias + (Math.random() * 0.1 - 0.05)));
      childBrain = {
        weights: mutatedWeights,
        bias: mutatedBias,
      };
    } else {
      childBrain = createDefaultBrain();
    }
    const newAnt = new Ant(id, x, y, role, num, childBrain, childGen);
    this.ants.push(newAnt);
    this.addLog(`Worker ${num} (Gen ${childGen}) hatched and joined the colony as a ${role}.`, 'births');
  }

  private balanceAntRoles() {
    if (this.ants.length === 0) return;

    // Target ratios: Diggers: 50%, Foragers: 35%, Nurses: 15%
    const foragerTarget = 0.35;
    const diggerTarget = 0.50;
    const nurseTarget = 0.15;

    let foragers = 0;
    let diggers = 0;
    let nurses = 0;

    this.ants.forEach(ant => {
      if (ant.role === 'Forager') foragers++;
      else if (ant.role === 'Digger') diggers++;
      else if (ant.role === 'Nurse') nurses++;
    });

    const total = this.ants.length;
    const fDiff = foragers / total - foragerTarget;
    const dDiff = diggers / total - diggerTarget;
    const nDiff = nurses / total - nurseTarget;

    // Periodically re-assign roles if they deviate by more than 2% from target
    if (Math.random() < 0.01) {
      if (fDiff > 0.02 && (dDiff < 0 || nDiff < 0)) {
        const excessAnt = this.ants.find(a => a.role === 'Forager' && a.cargo === 'None');
        if (excessAnt) {
          excessAnt.role = dDiff < nDiff ? 'Digger' : 'Nurse';
        }
      } else if (dDiff > 0.02 && (fDiff < 0 || nDiff < 0)) {
        const excessAnt = this.ants.find(a => a.role === 'Digger' && a.cargo === 'None');
        if (excessAnt) {
          excessAnt.role = fDiff < nDiff ? 'Forager' : 'Nurse';
        }
      } else if (nDiff > 0.02 && (fDiff < 0 || dDiff < 0)) {
        const excessAnt = this.ants.find(a => a.role === 'Nurse' && a.cargo === 'None' && !a.isHoldingBrood);
        if (excessAnt) {
          excessAnt.role = fDiff < dDiff ? 'Forager' : 'Digger';
        }
      }
    }
  }

  private getUnderRepresentedRole(): AntRole {
    let foragers = 0;
    let diggers = 0;
    let nurses = 0;

    this.ants.forEach(ant => {
      if (ant.role === 'Forager') foragers++;
      else if (ant.role === 'Digger') diggers++;
      else if (ant.role === 'Nurse') nurses++;
    });

    const total = this.ants.length || 1;
    const fDiff = 0.40 - (foragers / total);
    const dDiff = 0.35 - (diggers / total);
    const nDiff = 0.25 - (nurses / total);

    // Return the role furthest below its target
    if (fDiff >= dDiff && fDiff >= nDiff) return 'Forager';
    if (dDiff >= nDiff) return 'Digger';
    return 'Nurse';
  }



  public getActiveExcavationStep(grid: WorldGrid): ExcavationStep | null {
    for (let i = 0; i < this.excavationPlan.length; i++) {
      const step = this.excavationPlan[i];
      let hasDirt = false;
      for (let c = step.minCol; c <= step.maxCol; c++) {
        for (let r = step.minRow; r <= step.maxRow; r++) {
          if (grid.isValid(c, r) && isCellInsidePlanStep(step, c, r)) {
            const cellType = grid.getCell(c, r)?.type;
            if (cellType === 'Dirt' || cellType === 'Rock') {
              hasDirt = true;
              break;
            }
          }
        }
        if (hasDirt) break;
      }
      if (hasDirt) {
        return step;
      }
    }
    return null;
  }

  public getActiveExcavationTarget(grid: WorldGrid): Position | null {
    const step = this.getActiveExcavationStep(grid);
    if (!step) return null;

    let closestCell: Position | null = null;
    let minDistance = Infinity;

    // Nest entrance in world coordinates
    const entranceX = (CONFIG.COLS / 2) * CONFIG.CELL_SIZE;
    const entranceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;

    for (let c = step.minCol; c <= step.maxCol; c++) {
      for (let r = step.minRow; r <= step.maxRow; r++) {
        if (grid.isValid(c, r) && isCellInsidePlanStep(step, c, r) && grid.getCell(c, r)?.type === 'Dirt') {
          const x = c * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
          const y = r * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
          const dist = Math.sqrt((x - entranceX) ** 2 + (y - entranceY) ** 2);
          if (dist < minDistance) {
            minDistance = dist;
            closestCell = { x, y };
          }
        }
      }
    }

    return closestCell;
  }

  public getStats(grid: WorldGrid): any {
    this.grid = grid;
    let foragers = 0;
    let diggers = 0;
    let nurses = 0;

    this.ants.forEach(ant => {
      if (ant.role === 'Forager') foragers++;
      else if (ant.role === 'Digger') diggers++;
      else if (ant.role === 'Nurse') nurses++;
    });

    let eggs = 0;
    let larvae = 0;
    let pupae = 0;

    this.broodList.forEach(b => {
      if (b.type === 'Egg') eggs++;
      else if (b.type === 'Larva') larvae++;
      else if (b.type === 'Pupa') pupae++;
    });

    const activeStep = this.getActiveExcavationStep(grid);

    return {
      workerCount: this.ants.length,
      foragerCount: foragers,
      diggerCount: diggers,
      nurseCount: nurses,
      eggCount: eggs,
      larvaCount: larvae,
      pupaCount: pupae,
      foodStockpile: Math.floor(this.foodStockpile),
      dirtDugCount: this.ants.reduce((acc, a) => acc + (a.role === 'Digger' && a.state === 'CarryingDirt' ? 1 : 0), 0), // we'll accumulate this globally
      nestVolume: grid.getNestVolume(),
      activeProject: activeStep ? activeStep.name : 'Fully Built Colony',
    };
  }

  public reset(entranceCol: number) {
    this.foodStockpile = 200;
    this.ants = [];
    this.broodList = [];
    this.broodManager = new BroodManager();
    this.broodManager.broodList = this.broodList;
    this.nextAntNum = 1;
    
    const startX = entranceCol * CONFIG.CELL_SIZE;
    const startY = STARTING_CHAMBER_CENTER_ROW * CONFIG.CELL_SIZE;
    
    this.queen = {
      x: startX,
      y: startY,
      energy: 100,
      eggTimer: CONFIG.QUEEN_EGG_INTERVAL,
      direction: 1,
      targetX: startX,
      restTimer: 0,
      currentNursery: { x: startX - 40, y: startY + 4 },
      path: [],
    };
    
    this.excavationPlan = generateProceduralNestPlan(entranceCol);
    this.spawnInitialColony(startX, startY);
    this.logs = [];
    this.addLog('Colony reset. A new Queen has arrived.', 'system');
  }

  public getExcavatedChambers(grid: WorldGrid) {
    const nurseries: Position[] = [];
    const foodStorages: Position[] = [];

    // The Queen's chamber is the default nursery and food storage
    const entranceX = (CONFIG.COLS / 2) * CONFIG.CELL_SIZE;
    const startY = STARTING_CHAMBER_CENTER_ROW * CONFIG.CELL_SIZE;
    
    // Add default spots (offsets from chamber center). Move up to avoid clipping into floor.
    nurseries.push({ x: entranceX - 40, y: startY + 4 });
    foodStorages.push({ x: entranceX + 40, y: startY + 4 });

    // Scan the excavation plan steps
    for (const step of this.excavationPlan) {
      if (step.name.includes('Chamber') || step.name.includes('Annex')) {
        // Check if cleared of Dirt AND Rock
        let cleared = true;
        for (let c = step.minCol; c <= step.maxCol; c++) {
          for (let r = step.minRow; r <= step.maxRow; r++) {
            if (grid.isValid(c, r)) {
              const type = grid.getCell(c, r)?.type;
              if (type === 'Dirt' || type === 'Rock') {
                cleared = false;
                break;
              }
            }
          }
          if (!cleared) break;
        }

        if (cleared) {
          const centerX = ((step.minCol + step.maxCol) / 2) * CONFIG.CELL_SIZE;
          const centerY = ((step.minRow + step.maxRow) / 2) * CONFIG.CELL_SIZE;
          if (step.name.includes('Left') || step.name.includes('Nursery')) {
            nurseries.push({ x: centerX, y: centerY });
          } else if (step.name.includes('Right') || step.name.includes('Larder')) {
            foodStorages.push({ x: centerX, y: centerY });
          }
        }
      }
    }

    return { nurseries, foodStorages };
  }

  public getLarderBoxes(grid: WorldGrid): LarderBox[] {
    const boxes: LarderBox[] = [];

    // The Queen's chamber is the default nursery and food storage
    const entranceCol = grid.nestEntranceCol;
    const centerRow = STARTING_CHAMBER_CENTER_ROW;
    const startX = entranceCol * CONFIG.CELL_SIZE;
    const startY = centerRow * CONFIG.CELL_SIZE;

    // Default right larder in Queen's starting chamber
    boxes.push({
      minCol: entranceCol + 5,
      maxCol: entranceCol + 15,
      minRow: centerRow - 3,
      maxRow: centerRow + 3,
      centerX: startX + 40,
      centerY: startY + 4
    });

    // Scan the excavation plan steps
    for (const step of this.excavationPlan) {
      if (step.name.includes('Chamber') || step.name.includes('Annex')) {
        if (step.name.includes('Right') || step.name.includes('Larder')) {
          // Check if cleared of Dirt AND Rock
          let cleared = true;
          for (let c = step.minCol; c <= step.maxCol; c++) {
            for (let r = step.minRow; r <= step.maxRow; r++) {
              if (grid.isValid(c, r)) {
                const type = grid.getCell(c, r)?.type;
                if (type === 'Dirt' || type === 'Rock') {
                  cleared = false;
                  break;
                }
              }
            }
            if (!cleared) break;
          }

          if (cleared) {
            boxes.push({
              minCol: step.minCol,
              maxCol: step.maxCol,
              minRow: step.minRow,
              maxRow: step.maxRow,
              centerX: ((step.minCol + step.maxCol) / 2) * CONFIG.CELL_SIZE,
              centerY: ((step.minRow + step.maxRow) / 2) * CONFIG.CELL_SIZE
            });
          }
        }
      }
    }

    return boxes;
  }

  public isLarderFull(grid: WorldGrid, larder: LarderBox): boolean {
    for (let c = larder.minCol; c <= larder.maxCol; c++) {
      for (let r = larder.minRow; r <= larder.maxRow; r++) {
        if (grid.isValid(c, r) && grid.getCell(c, r)?.type === 'NestAir') {
          return false;
        }
      }
    }
    return true;
  }

  public getAvailableLarder(grid: WorldGrid, currentPos: Position): LarderBox | null {
    const larders = this.getLarderBoxes(grid);
    let closest: LarderBox | null = null;
    let minDist = Infinity;
    for (const larder of larders) {
      if (!this.isLarderFull(grid, larder)) {
        const dist = Math.sqrt((currentPos.x - larder.centerX) ** 2 + (currentPos.y - larder.centerY) ** 2);
        if (dist < minDist) {
          minDist = dist;
          closest = larder;
        }
      }
    }
    return closest;
  }
}
