import { CONFIG, isCellInsidePlanStep } from './types';
import type { Brood, AntRole, ExcavationStep, Position, AntBrain, LogEntry } from './types';
import { Ant, createDefaultBrain } from './Ant';
import { WorldGrid } from './Grid';

export class ColonyManager {
  public foodStockpile: number = 50; // starts with a little food
  public ants: Ant[] = [];
  public broodList: Brood[] = [];
  public queen: { x: number; y: number; energy: number; eggTimer: number; direction: number; targetX: number; restTimer?: number };
  public logs: LogEntry[] = [];
  public nextAntNum: number = 1; // counter for numbering ants
  public excavationPlan: ExcavationStep[] = [];
  public lastActiveStepName: string | null = null;

  constructor(entranceCol: number) {
    const startX = entranceCol * CONFIG.CELL_SIZE;
    const startY = (CONFIG.SKY_HEIGHT + 34) * CONFIG.CELL_SIZE; // queen chamber height

    this.queen = {
      x: startX,
      y: startY,
      energy: 100,
      eggTimer: CONFIG.QUEEN_EGG_INTERVAL,
      direction: 1, // 1 for right, -1 for left
      targetX: startX,
      restTimer: 0,
    };

    // Generate procedural nest plan
    this.excavationPlan = this.generateProceduralNestPlan(entranceCol);

    // Spawn initial workers
    this.spawnInitialColony(startX, startY);
    this.addLog('Colony founded. The Queen has settled in.', 'system');
  }

  private spawnInitialColony(startX: number, startY: number) {
    // 3 initial foragers, 4 diggers, 1 nurse
    const initialRoles: AntRole[] = [
      'Forager', 'Forager', 'Forager', 
      'Digger', 'Digger', 'Digger', 'Digger', 
      'Nurse'
    ];
    initialRoles.forEach((role, i) => {
      const offset = (i - Math.floor(initialRoles.length / 2)) * 12;
      const num = this.nextAntNum++;
      const ant = new Ant(`ant-${num}`, startX + offset, startY, role, num, createDefaultBrain(), 1);
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

  public update(speedMultiplier: number) {
    const dt = 1 * speedMultiplier;

    // 1. Queen egg laying and energy
    // The egg timer always ticks down, regardless of food stockpile!
    this.queen.eggTimer -= (1 / 60) * dt;
    if (this.queen.eggTimer <= 0) {
      if (this.foodStockpile >= 10) {
        this.foodStockpile -= 10;
        this.layEgg();
        this.queen.eggTimer = CONFIG.QUEEN_EGG_INTERVAL + Math.random() * 20; // reset
      } else {
        // Keep the egg timer at 0 so she lays immediately when food becomes available
        this.queen.eggTimer = 0;
      }
    }

    if (this.foodStockpile > 0) {
      // Passive consumption scales with the number of worker ants in the colony (aligned with OfflineProgression)
      const passiveConsumption = this.ants.length * CONFIG.FOOD_CONSUMPTION_RATE * 0.1 * (dt / 60);
      this.foodStockpile = Math.max(0, this.foodStockpile - passiveConsumption);
    }

    // Queen pacing motion inside the central chamber
    if (this.queen.restTimer === undefined) {
      this.queen.restTimer = 0;
    }

    const entranceX = (CONFIG.COLS / 2) * CONFIG.CELL_SIZE;
    const minX = entranceX - 16;
    const maxX = entranceX + 16;

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

    // 2. Brood lifecycle updates
    for (let i = this.broodList.length - 1; i >= 0; i--) {
      const brood = this.broodList[i];
      
      if (brood.type === 'Egg') {
        brood.progress += (100 / CONFIG.EGG_HATCH_TIME / 60) * dt;
        if (brood.progress >= 100) {
          brood.type = 'Larva';
          brood.progress = 0;
          brood.needsFood = true;
          this.addLog('An egg hatched into a hungry larva.', 'births');
        }
      } else if (brood.type === 'Larva') {
        // Larva needs food to grow. If it doesn't get food, it stays hungry and stops growing
        if (!brood.needsFood) {
          brood.progress += (100 / CONFIG.LARVA_GROWTH_TIME / 60) * dt;
          if (brood.progress >= 100) {
            brood.type = 'Pupa';
            brood.progress = 0;
            this.addLog('A larva spun a silk cocoon and entered pupation.', 'births');
          }
          // Set hungry again after some time
          if (Math.random() < 0.002 * dt) {
            brood.needsFood = true;
          }
        }
      } else if (brood.type === 'Pupa') {
        brood.progress += (100 / CONFIG.PUPA_HATCH_TIME / 60) * dt;
        if (brood.progress >= 100) {
          // Hatch into a new ant!
          this.hatchAnt(brood.x, brood.y);
          this.broodList.splice(i, 1); // remove pupa
          continue;
        }
      }
    }

    // 3. Dynamic role balancing for ants
    this.balanceAntRoles();
  }

  private layEgg() {
    // Lay egg next to Queen
    const rx = this.queen.x + (Math.random() - 0.5) * 30;
    const ry = this.queen.y + 10;
    
    const id = `brood-${Math.random().toString(36).substr(2, 9)}`;
    const newEgg: Brood = {
      id,
      type: 'Egg',
      x: rx,
      y: ry,
      progress: 0,
      needsFood: false,
      beingCarried: false,
    };
    
    this.broodList.push(newEgg);
    this.addLog('The Queen laid a new egg.', 'births');
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

    // Target ratios: Foragers: 40%, Diggers: 35%, Nurses: 25%
    const foragerTarget = 0.40;
    const diggerTarget = 0.35;
    const nurseTarget = 0.25;

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

  // Procedurally generate a perfectly straight, tiered excavation structure
  public generateProceduralNestPlan(entranceCol: number): ExcavationStep[] {
    const plan: ExcavationStep[] = [];
    let currentRow = CONFIG.SKY_HEIGHT + 38; // Start below the starting Queen's chamber
    
    // We procedurally generate 8 levels (tiers) of construction
    for (let L = 1; L <= 8; L++) {
      const startRow = currentRow;
      const endRow = Math.min(CONFIG.ROWS - 5, currentRow + 18);
      currentRow = endRow;
      
      // 1. Extend Shaft (perfectly straight shaft cols)
      plan.push({
        name: `Extend Shaft (Tier ${L})`,
        minCol: entranceCol - 2,
        maxCol: entranceCol + 1,
        minRow: startRow,
        maxRow: endRow
      });
      
      // 2. Decide branching (0: Left only, 1: Right only, 2: Both sides)
      const layout = Math.floor(Math.random() * 3);
      const hasLeft = layout === 0 || layout === 2;
      const hasRight = layout === 1 || layout === 2;
      
      // Center the horizontal elements vertically inside the tier height
      const pRow = startRow + 9;
      
      if (hasLeft) {
        // Create left passage (3 cells high)
        const pLen = 15 + Math.floor(Math.random() * 5); // passage length 15 to 19 cells
        const passMinC = Math.max(5, entranceCol - pLen);
        const passMaxC = entranceCol - 3;
        
        plan.push({
          name: `Left Passage (Tier ${L})`,
          minCol: passMinC,
          maxCol: passMaxC,
          minRow: pRow - 1,
          maxRow: pRow + 1
        });
        
        // Create left chamber (Nursery, 6 to 9 cells high, aligned)
        const cWidth = 14 + Math.floor(Math.random() * 6);
        const cHeight = 7 + Math.floor(Math.random() * 2); // 7 or 8 cells high
        const chamMinC = Math.max(5, passMinC - cWidth);
        const chamMaxC = passMinC;
        const chamMinR = pRow - Math.floor(cHeight / 2);
        const chamMaxR = chamMinR + cHeight - 1;
        
        plan.push({
          name: `Left Nursery Chamber (Tier ${L})`,
          minCol: chamMinC,
          maxCol: chamMaxC,
          minRow: chamMinR,
          maxRow: chamMaxR
        });
        
        // Chain a second chamber (Annex)? (40% chance)
        if (Math.random() < 0.40 && chamMinC > 30) {
          const chainPLen = 10 + Math.floor(Math.random() * 5);
          const chainMinC = Math.max(5, chamMinC - chainPLen);
          const chainMaxC = chamMinC - 1;
          
          plan.push({
            name: `Left Nursery Link (Tier ${L})`,
            minCol: chainMinC,
            maxCol: chainMaxC,
            minRow: pRow - 1,
            maxRow: pRow + 1
          });
          
          const chainCW = 12 + Math.floor(Math.random() * 5);
          const chainCH = 6 + Math.floor(Math.random() * 3);
          const chainChamMinC = Math.max(5, chainMinC - chainCW);
          const chainChamMaxC = chainMinC;
          const chainMinR = pRow - Math.floor(chainCH / 2);
          const chainMaxR = chainMinR + chainCH - 1;
          
          plan.push({
            name: `Left Nursery Annex (Tier ${L})`,
            minCol: chainChamMinC,
            maxCol: chainChamMaxC,
            minRow: chainMinR,
            maxRow: chainMaxR
          });
        }
      }
      
      if (hasRight) {
        // Create right passage (3 cells high)
        const pLen = 15 + Math.floor(Math.random() * 5);
        const passMinC = entranceCol + 2;
        const passMaxC = Math.min(CONFIG.COLS - 6, entranceCol + pLen);
        
        plan.push({
          name: `Right Passage (Tier ${L})`,
          minCol: passMinC,
          maxCol: passMaxC,
          minRow: pRow - 1,
          maxRow: pRow + 1
        });
        
        // Create right chamber (Larder, 6 to 9 cells high, aligned)
        const cWidth = 14 + Math.floor(Math.random() * 6);
        const cHeight = 7 + Math.floor(Math.random() * 2);
        const chamMinC = passMaxC;
        const chamMaxC = Math.min(CONFIG.COLS - 6, passMaxC + cWidth);
        const chamMinR = pRow - Math.floor(cHeight / 2);
        const chamMaxR = chamMinR + cHeight - 1;
        
        plan.push({
          name: `Right Larder Chamber (Tier ${L})`,
          minCol: chamMinC,
          maxCol: chamMaxC,
          minRow: chamMinR,
          maxRow: chamMaxR
        });
        
        // Chain a second chamber (Annex)? (40% chance)
        if (Math.random() < 0.40 && chamMaxC < CONFIG.COLS - 30) {
          const chainPLen = 10 + Math.floor(Math.random() * 5);
          const chainMinC = chamMaxC + 1;
          const chainMaxC = Math.min(CONFIG.COLS - 6, chamMaxC + chainPLen);
          
          plan.push({
            name: `Right Larder Link (Tier ${L})`,
            minCol: chainMinC,
            maxCol: chainMaxC,
            minRow: pRow - 1,
            maxRow: pRow + 1
          });
          
          const chainCW = 12 + Math.floor(Math.random() * 5);
          const chainCH = 6 + Math.floor(Math.random() * 3);
          const chainChamMinC = chainMaxC;
          const chainChamMaxC = Math.min(CONFIG.COLS - 6, chainMaxC + chainCW);
          const chainMinR = pRow - Math.floor(chainCH / 2);
          const chainMaxR = chainMinR + chainCH - 1;
          
          plan.push({
            name: `Right Larder Annex (Tier ${L})`,
            minCol: chainChamMinC,
            maxCol: chainChamMaxC,
            minRow: chainMinR,
            maxRow: chainMaxR
          });
        }
      }
    }
    
    return plan;
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
    this.foodStockpile = 50;
    this.ants = [];
    this.broodList = [];
    this.nextAntNum = 1;
    
    const startX = entranceCol * CONFIG.CELL_SIZE;
    const startY = (CONFIG.SKY_HEIGHT + 34) * CONFIG.CELL_SIZE;
    
    this.queen = {
      x: startX,
      y: startY,
      energy: 100,
      eggTimer: CONFIG.QUEEN_EGG_INTERVAL,
      direction: 1,
      targetX: startX,
      restTimer: 0,
    };
    
    this.excavationPlan = this.generateProceduralNestPlan(entranceCol);
    this.spawnInitialColony(startX, startY);
    this.logs = [];
    this.addLog('Colony reset. A new Queen has arrived.', 'system');
  }

  public getExcavatedChambers(grid: WorldGrid) {
    const nurseries: Position[] = [];
    const foodStorages: Position[] = [];

    // The Queen's chamber is the default nursery and food storage
    const entranceX = (CONFIG.COLS / 2) * CONFIG.CELL_SIZE;
    const startY = (CONFIG.SKY_HEIGHT + 34) * CONFIG.CELL_SIZE;
    
    // Add default spots (offsets from chamber center)
    nurseries.push({ x: entranceX - 40, y: startY + 12 });
    foodStorages.push({ x: entranceX + 40, y: startY + 12 });

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
}
