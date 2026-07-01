import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from './types';
import type { Brood, AntRole, ExcavationStep, Position, AntBrain, LogEntry, LarderBox } from './types';
import { Ant, createDefaultBrain } from './Ant';
import { WorldGrid } from './Grid';
import { generateProceduralNestPlan, isCellInsidePlanStep } from './NestPlanner';
import { BroodManager } from './BroodManager';
import { findPath } from './Pathfinder';
import { Threat } from './Threat';
import { FoodStockpile } from './FoodStockpile';

export class ColonyManager {
  private _grid?: WorldGrid;
  public maxPopulation: number = 0;
  public maxGenerationReached: number = 1;

  /** Single source of truth for all colony food. */
  public readonly foodStockpile: FoodStockpile;

  public get grid(): WorldGrid | undefined {
    return this._grid;
  }

  public set grid(g: WorldGrid | undefined) {
    this._grid = g;
  }

  public ants: Ant[] = [];
  /** Delegates to broodManager — BroodManager is the sole owner of brood state. */
  public get broodList(): readonly Brood[] {
    return this.broodManager.broodList;
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
    age: number;
    maxAge: number;
    submergedTime: number;
    health: number;
    deathReason?: string;
  };
  public logs: LogEntry[] = [];
  public nextAntNum: number = 1; // counter for numbering ants
  public excavationPlan: ExcavationStep[] = [];
  public lastActiveStepName: string | null = null;
  public broodManager: BroodManager;
  public threats: Threat[] = [];

  constructor(entranceCol: number) {
    const startX = entranceCol * CONFIG.CELL_SIZE;
    const startY = STARTING_CHAMBER_CENTER_ROW * CONFIG.CELL_SIZE; // queen chamber height

    this.foodStockpile = new FoodStockpile(
      () => this._grid,
      () => this.getLarderBoxes()
    );

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
      age: 0,
      maxAge: CONFIG.QUEEN_MAX_AGE,
      submergedTime: 0,
      health: 100,
      isDead: false,
    };

    this.maxPopulation = 8;

    // Generate procedural nest plan
    this.excavationPlan = generateProceduralNestPlan(entranceCol);

    this.broodManager = new BroodManager();

    // Spawn initial workers
    this.spawnInitialColony(startX, startY);
    this.addLog('Colony founded. The Queen has settled in.', 'system');
  }

  private spawnInitialColony(startX: number, startY: number) {
    // 3 foragers, 3 diggers, 1 nurse, 1 soldier
    const initialRoles: AntRole[] = [
      'Forager', 'Forager', 'Forager',
      'Digger', 'Digger', 'Digger',
      'Nurse', 'Soldier'
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
    if (activeGrid && typeof activeGrid.getCell !== 'function') {
      (activeGrid as any).getCell = (_c: number, _r: number) => {
        return { type: 'NestAir', foodAmount: 0, noiseVal: 0 };
      };
    }
    this.grid = activeGrid;
    const dt = 1 * speedMultiplier;

    // 1. Queen egg laying and energy
    // Track max population
    const currentPopulation = this.ants.length;
    if (currentPopulation > this.maxPopulation) {
      this.maxPopulation = currentPopulation;
    }

    if (!this.queen.isDead) {
      // Age Queen
      this.queen.age += (1 / 7200) * dt;

      const qCol = Math.floor(this.queen.x / CONFIG.CELL_SIZE);
      const qRow = Math.floor(this.queen.y / CONFIG.CELL_SIZE);
      const qCell = (activeGrid && typeof activeGrid.getCell === 'function') ? activeGrid.getCell(qCol, qRow) : null;
      const qSubmerged = qCell && qCell.type === 'Water';

      if (qSubmerged) {
        this.queen.submergedTime += (1 / 60) * dt;
        if (this.queen.submergedTime > 5.0) {
          this.queen.health -= 2 * dt;
        }
      } else {
        this.queen.submergedTime = 0;
        this.queen.health = Math.min(100, this.queen.health + 0.5 * dt);
      }

      const queenEnergyLoss = (100 / 21600) * dt;
      this.queen.energy = Math.max(0, this.queen.energy - queenEnergyLoss);

      // Check deaths
      if (this.queen.age >= this.queen.maxAge) {
        this.queen.isDead = true;
        this.queen.deathReason = 'old age';
        this.addLog('The Queen has died of old age! Colony Collapse is imminent.', 'deaths');
      } else if (this.queen.energy <= 0) {
        this.queen.isDead = true;
        this.queen.deathReason = 'starvation';
        this.addLog('The Queen has died of starvation! Colony Collapse is imminent.', 'deaths');
      } else if (this.queen.health <= 0) {
        this.queen.isDead = true;
        this.queen.deathReason = 'drowning';
        this.addLog('The Queen has drowned! Colony Collapse is imminent.', 'deaths');
      }
    }

    if (!this.queen.isDead) {
      // The egg timer always ticks down, regardless of food stockpile!
      this.queen.eggTimer -= (1 / 60) * dt;
      if (this.queen.eggTimer <= 0) {
        if (this.foodStockpile.total >= 10) {
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
            this.foodStockpile.consume(10);
            this.broodManager.layEgg(activeGrid, this.queen, chambers.nurseries, (msg, cat) => this.addLog(msg, cat));
            this.queen.eggTimer = CONFIG.QUEEN_EGG_INTERVAL + Math.random() * 20; // reset
          }
        } else {
          // Keep the egg timer at 0 so she lays immediately when food becomes available
          this.queen.eggTimer = 0;
        }
      }
    }

    if (this.foodStockpile.total > 0) {
      // Passive consumption scales with the number of worker ants in the colony (aligned with OfflineProgression)
      const passiveConsumption = this.ants.length * CONFIG.FOOD_CONSUMPTION_RATE * 0.1 * (dt / 60);
      this.foodStockpile.consume(passiveConsumption);
    }

    // Larder mold decay logic
    const larders = this.getLarderBoxes(activeGrid);
    let moldLogs = false;
    for (const box of larders) {
      const flooded = this.isLarderFlooded(activeGrid, box);
      for (let c = box.minCol; c <= box.maxCol; c++) {
        for (let r = box.minRow; r <= box.maxRow; r++) {
          const cell = activeGrid.getCell(c, r);
          if (cell && cell.type === 'Food') {
            if (flooded && !cell.isMoldy) {
              activeGrid.setMoldy(c, r);
              moldLogs = true;
            }
            if (cell.isMoldy) {
              activeGrid.decayFood(c, r, 0.005 * dt);
            }
          }
        }
      }
    }
    if (moldLogs) {
      this.addLog('Flooded larder detected! Food stockpiles are decaying from mold.', 'system');
    }

    // Queen motion
    if (!this.queen.isDead) {
      const qCol = Math.floor(this.queen.x / CONFIG.CELL_SIZE);
      const qRow = Math.floor(this.queen.y / CONFIG.CELL_SIZE);
      const qCell = activeGrid.getCell(qCol, qRow);
      const qSubmerged = qCell && qCell.type === 'Water';
      const qSpeedMult = qSubmerged ? 0.4 : 1.0;

      if (this.queen.path && this.queen.path.length > 0) {
        const target = this.queen.path[0];
        const dx = target.x - this.queen.x;
        const dy = target.y - this.queen.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const queenSpeed = 0.5 * speedMultiplier * qSpeedMult; // Queen moves regally and steadily
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
          const speed = 0.12 * speedMultiplier * qSpeedMult; // Queen moves regally and slowly

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
    if (childGen > this.maxGenerationReached) {
      this.maxGenerationReached = childGen;
    }
    this.addLog(`Worker ${num} (Gen ${childGen}) hatched and joined the colony as a ${role}.`, 'births');
  }

  private balanceAntRoles() {
    if (this.ants.length === 0) return;

    // Target ratios: Diggers: 40%, Foragers: 30%, Nurses: 15%, Soldiers: 15%
    const foragerTarget = 0.30;
    const diggerTarget = 0.40;
    const nurseTarget = 0.15;
    const soldierTarget = 0.15;

    let foragers = 0;
    let diggers = 0;
    let nurses = 0;
    let soldiers = 0;

    this.ants.forEach(ant => {
      if (ant.role === 'Forager') foragers++;
      else if (ant.role === 'Digger') diggers++;
      else if (ant.role === 'Nurse') nurses++;
      else if (ant.role === 'Soldier') soldiers++;
    });

    const total = this.ants.length;
    const fDiff = foragers / total - foragerTarget;
    const dDiff = diggers / total - diggerTarget;
    const nDiff = nurses / total - nurseTarget;
    const sDiff = soldiers / total - soldierTarget;

    // Periodically re-assign roles if they deviate by more than 2% from target
    if (Math.random() < 0.01) {
      const diffs = [
        { role: 'Forager', diff: fDiff, list: this.ants.filter(a => a.role === 'Forager' && a.cargo === 'None') },
        { role: 'Digger', diff: dDiff, list: this.ants.filter(a => a.role === 'Digger' && a.cargo === 'None') },
        { role: 'Nurse', diff: nDiff, list: this.ants.filter(a => a.role === 'Nurse' && a.cargo === 'None' && !a.isHoldingBrood) },
        { role: 'Soldier', diff: sDiff, list: this.ants.filter(a => a.role === 'Soldier') }
      ];
      
      const excess = diffs.filter(d => d.diff > 0.02 && d.list.length > 0).sort((a, b) => b.diff - a.diff)[0];
      const deficit = diffs.sort((a, b) => a.diff - b.diff)[0];
      
      if (excess && deficit && excess.role !== deficit.role) {
        const ant = excess.list[0];
        if (ant) {
          ant.role = deficit.role as AntRole;
          ant.state = 'Wandering';
          ant.currentPath = null;
        }
      }
    }
  }

  private getUnderRepresentedRole(): AntRole {
    let foragers = 0;
    let diggers = 0;
    let nurses = 0;
    let soldiers = 0;

    this.ants.forEach(ant => {
      if (ant.role === 'Forager') foragers++;
      else if (ant.role === 'Digger') diggers++;
      else if (ant.role === 'Nurse') nurses++;
      else if (ant.role === 'Soldier') soldiers++;
    });

    const total = this.ants.length || 1;
    const fDiff = 0.30 - (foragers / total);
    const dDiff = 0.40 - (diggers / total);
    const nDiff = 0.15 - (nurses / total);
    const sDiff = 0.15 - (soldiers / total);

    const diffs = [
      { role: 'Forager' as AntRole, diff: fDiff },
      { role: 'Digger' as AntRole, diff: dDiff },
      { role: 'Nurse' as AntRole, diff: nDiff },
      { role: 'Soldier' as AntRole, diff: sDiff }
    ];

    return diffs.sort((a, b) => b.diff - a.diff)[0].role;
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
    let soldiers = 0;

    this.ants.forEach(ant => {
      if (ant.role === 'Forager') foragers++;
      else if (ant.role === 'Digger') diggers++;
      else if (ant.role === 'Nurse') nurses++;
      else if (ant.role === 'Soldier') soldiers++;
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
      soldierCount: soldiers,
      eggCount: eggs,
      larvaCount: larvae,
      pupaCount: pupae,
      foodStockpile: Math.floor(this.foodStockpile.total),
      dirtDugCount: this.ants.reduce((acc, a) => acc + (a.role === 'Digger' && a.state === 'CarryingDirt' ? 1 : 0), 0), // we'll accumulate this globally
      nestVolume: grid.getNestVolume(),
      activeProject: activeStep ? activeStep.name : 'Fully Built Colony',
    };
  }

  public reset(entranceCol: number) {
    this.foodStockpile.setTotal(200);
    this.ants = [];
    this.broodManager = new BroodManager();
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
      age: 0,
      maxAge: CONFIG.QUEEN_MAX_AGE,
      submergedTime: 0,
      health: 100,
      isDead: false,
    };

    this.maxPopulation = 8;
    this.maxGenerationReached = 1;
    
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

  public getLarderBoxes(grid?: WorldGrid): LarderBox[] {
    const activeGrid = grid ?? this._grid;
    if (!activeGrid) return [];
    const boxes: LarderBox[] = [];

    // The Queen's chamber is the default nursery and food storage
    const entranceCol = activeGrid.nestEntranceCol;
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
              if (activeGrid.isValid(c, r)) {
                const type = activeGrid.getCell(c, r)?.type;
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

  public isLarderFlooded(grid: WorldGrid, box: LarderBox): boolean {
    for (let c = box.minCol; c <= box.maxCol; c++) {
      for (let r = box.minRow; r <= box.maxRow; r++) {
        const cell = grid.getCell(c, r);
        if (cell && cell.type === 'Water') {
          return true;
        }
      }
    }
    return false;
  }
}
