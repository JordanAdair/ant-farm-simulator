import { CONFIG } from './types';
import type { CellType, AntRole } from './types';
import { WorldGrid } from './Grid';
import { SimulationEngine } from './Engine';
import { Ant, createDefaultBrain } from './Ant';
import { generateProceduralNestPlan } from './NestPlanner';

export interface OfflineResult {
  elapsedSeconds: number;
  foodGathered: number;
  foodConsumed: number;
  antsBorn: number;
  dirtDug: number;
}

export class OfflineProgression {
  // Compress grid to a simple character string to save space and keep it fast
  private static serializeGrid(grid: WorldGrid): string {
    const chars: string[] = [];
    for (let c = 0; c < grid.cols; c++) {
      const colChars: string[] = [];
      for (let r = 0; r < grid.rows; r++) {
        const cell = grid.cells[c][r];
        let ch = 'D'; // Dirt
        if (cell.type === 'Sky') ch = 'S';
        else if (cell.type === 'Rock') ch = 'R';
        else if (cell.type === 'NestAir') ch = 'A';
        else if (cell.type === 'Food') ch = 'F';
        colChars.push(ch);
      }
      chars.push(colChars.join(''));
    }
    return chars.join(',');
  }

  private static deserializeGrid(grid: WorldGrid, gridStr: string) {
    const cols = gridStr.split(',');
    for (let c = 0; c < grid.cols; c++) {
      if (!cols[c]) continue;
      for (let r = 0; r < grid.rows; r++) {
        const ch = cols[c][r];
        let type: CellType = 'Dirt';
        let foodAmount = 0;

        if (ch === 'S') type = 'Sky';
        else if (ch === 'R') type = 'Rock';
        else if (ch === 'A') type = 'NestAir';
        else if (ch === 'F') {
          type = 'Food';
          foodAmount = CONFIG.FOOD_PER_SOURCE;
        }

        grid.cells[c][r] = {
          type,
          foodAmount,
          noiseVal: Math.random(),
        };
      }
    }
  }

  public static saveState(engine: SimulationEngine) {
    try {
      const state = {
        gridStr: this.serializeGrid(engine.grid),
        foodStockpile: engine.colony.foodStockpile,
        totalDirtDug: engine.totalDirtDugGlobal,
        timestamp: Date.now(),
        excavationPlan: engine.colony.excavationPlan,
        queen: {
          x: engine.colony.queen.x,
          y: engine.colony.queen.y,
          energy: engine.colony.queen.energy,
          eggTimer: engine.colony.queen.eggTimer,
          restTimer: engine.colony.queen.restTimer,
        },
        broodList: engine.colony.broodList,
        ants: engine.colony.ants.map(ant => ({
          id: ant.id,
          x: ant.x,
          y: ant.y,
          angle: ant.angle,
          role: ant.role,
          state: ant.state,
          energy: ant.energy,
          cargo: ant.cargo,
          num: ant.num,
          brain: ant.brain,
          generation: ant.generation,
          collisions: ant.collisions,
          deliveries: ant.deliveries,
          age: ant.age,
          maxAge: ant.maxAge,
        })),
        nextAntNum: engine.colony.nextAntNum,
        logs: engine.colony.logs,
        telemetryHistory: engine.telemetryTracker.getHistory(),
        clock: {
          dayCount: engine.environment.dayCount,
          hour: engine.environment.hour,
          minute: engine.environment.minute,
          minuteFraction: engine.environment.minuteFraction,
        },
        weatherState: {
          weather: engine.environment.weather,
          weatherTimer: engine.environment.weatherTimer,
          weatherTargetDuration: engine.environment.weatherTargetDuration,
          weatherQueue: engine.environment.weatherQueue,
        }
      };

      localStorage.setItem('ant_farm_save_v3', JSON.stringify(state));
    } catch (e) {
      console.error('Failed to save state to localStorage', e);
    }
  }

  public static loadState(engine: SimulationEngine): OfflineResult | null {
    try {
      // Clean up legacy v1 and v2 saves if present
      if (localStorage.getItem('ant_farm_save_v1')) {
        localStorage.removeItem('ant_farm_save_v1');
      }
      if (localStorage.getItem('ant_farm_save_v2')) {
        localStorage.removeItem('ant_farm_save_v2');
      }

      const saveStr = localStorage.getItem('ant_farm_save_v3');
      if (!saveStr) return null;

      const state = JSON.parse(saveStr);
      if (!state || !state.gridStr) return null;

      // Check if grid dimensions in save string match current config
      const cols = state.gridStr.split(',');
      if (cols.length !== engine.grid.cols || (cols[0] && cols[0].length !== engine.grid.rows)) {
        console.warn('Saved grid dimensions mismatch. Resetting world grid to new configuration.');
        return null;
      }

      // 1. Restore Grid
      this.deserializeGrid(engine.grid, state.gridStr);

      // Reinitialize foliage to align grass/trees to loaded surface heights
      engine.initializeFoliage();

      // 2. Restore Colony attributes
      engine.colony.foodStockpile = state.foodStockpile || 50;
      engine.totalDirtDugGlobal = state.totalDirtDug || 0;
      engine.colony.queen = state.queen
        ? {
            ...state.queen,
            targetX: state.queen.targetX ?? state.queen.x,
            direction: state.queen.direction ?? 1,
            restTimer: state.queen.restTimer ?? 0,
          }
        : engine.colony.queen;
      engine.colony.broodList = state.broodList || [];
      engine.colony.logs = (state.logs || []).map((l: any) => {
        let entry: any = {};
        if (typeof l === 'string') {
          entry = { text: l, category: 'system', timestamp: Date.now() };
        } else {
          entry = { ...l };
        }

        // Map legacy categories or missing categories to the new system/births/deaths format
        const textLower = entry.text.toLowerCase();
        if (textLower.includes('hatch') || textLower.includes('egg') || textLower.includes('larva') || textLower.includes('pupa') || textLower.includes('born')) {
          entry.category = 'births';
        } else if (textLower.includes('died') || textLower.includes('death') || textLower.includes('accident') || textLower.includes('dehydration') || textLower.includes('exhaustion') || textLower.includes('cave-in')) {
          entry.category = 'deaths';
        } else {
          entry.category = 'system';
        }
        return entry;
      });
      engine.telemetryTracker.setHistory(state.telemetryHistory || []);

      // Restore clock & weather
      if (state.clock) {
        engine.environment.dayCount = state.clock.dayCount ?? 1;
        engine.environment.hour = state.clock.hour ?? 8;
        engine.environment.minute = state.clock.minute ?? 0;
        engine.environment.minuteFraction = state.clock.minuteFraction ?? 0;
      } else {
        engine.environment.dayCount = 1;
        engine.environment.hour = 8;
        engine.environment.minute = 0;
        engine.environment.minuteFraction = 0;
      }

      if (state.weatherState) {
        engine.environment.weather = state.weatherState.weather ?? 'Sunny';
        engine.environment.weatherTimer = state.weatherState.weatherTimer ?? 0;
        engine.environment.weatherTargetDuration = state.weatherState.weatherTargetDuration ?? 9000;
        engine.environment.weatherQueue = state.weatherState.weatherQueue ?? [];
      } else {
        engine.environment.weather = 'Sunny';
        engine.environment.weatherTimer = 0;
        engine.environment.weatherTargetDuration = 9000;
        engine.environment.weatherQueue = [];
        engine.environment.refillWeatherQueue();
      }

      // Restore excavationPlan (fallback to procedural generation if missing in older saves)
      if (state.excavationPlan && state.excavationPlan.length > 0) {
        engine.colony.excavationPlan = state.excavationPlan;
      } else {
        engine.colony.excavationPlan = generateProceduralNestPlan(engine.grid.nestEntranceCol);
      }

      // 3. Restore Ants
      const startX = engine.grid.nestEntranceCol * CONFIG.CELL_SIZE;
      const startY = (CONFIG.SKY_HEIGHT + 23) * CONFIG.CELL_SIZE;

      if (state.nextAntNum !== undefined) {
        engine.colony.nextAntNum = state.nextAntNum;
      } else if (state.ants && state.ants.length > 0) {
        engine.colony.nextAntNum = Math.max(...state.ants.map((a: any) => a.num || 0)) + 1;
      } else {
        engine.colony.nextAntNum = 1;
      }

      engine.colony.ants = (state.ants || []).map((a: any) => {
        const ant = new Ant(a.id, a.x, a.y, a.role, a.num || 1, a.brain, a.generation || 1);
        ant.angle = a.angle;
        ant.state = a.state;
        ant.energy = a.energy;
        ant.cargo = a.cargo;
        ant.collisions = a.collisions || 0;
        ant.deliveries = a.deliveries || 0;
        ant.age = a.age || 0;
        ant.maxAge = a.maxAge || (600 + Math.random() * 300);
        // Fix home chamber coordinates to the central nest location
        ant.homeChamberX = startX;
        ant.homeChamberY = startY;
        return ant;
      });

      // 4. Calculate offline delta
      const savedTime = state.timestamp;
      const elapsedMs = Date.now() - savedTime;
      const elapsedSeconds = Math.floor(elapsedMs / 1000);

      // Only simulate if offline for more than 15 seconds
      if (elapsedSeconds > 15) {
        return this.runOfflineCalculations(engine, elapsedSeconds);
      }
    } catch (e) {
      console.error('Failed to load state from localStorage', e);
    }
    return null;
  }

  private static runOfflineCalculations(engine: SimulationEngine, totalSeconds: number): OfflineResult {
    // Limit maximum offline duration to 3 days to avoid excessive logs/growth
    const duration = Math.min(totalSeconds, CONFIG.MAX_OFFLINE_TIME);

    const env = engine.environment;

    // Progress Clock Offline
    const totalSimMinutes = Math.floor(duration * 2);
    const addHours = Math.floor(totalSimMinutes / 60);
    const addMinutes = totalSimMinutes % 60;

    env.minute += addMinutes;
    if (env.minute >= 60) {
      env.minute -= 60;
      env.hour += 1;
    }
    env.hour += addHours;
    if (env.hour >= 24) {
      env.dayCount += Math.floor(env.hour / 24);
      env.hour = env.hour % 24;
    }

    // Progress Weather Queue Offline
    let offlineFramesRemaining = duration * 60;
    const currentRemaining = Math.max(0, env.weatherTargetDuration - env.weatherTimer);
    if (offlineFramesRemaining >= currentRemaining) {
      offlineFramesRemaining -= currentRemaining;
      env.refillWeatherQueue();
      let next = env.weatherQueue.shift()!;
      env.weather = next.type;
      env.weatherTargetDuration = next.durationFrames;
      env.weatherTimer = 0;
      
      while (offlineFramesRemaining >= env.weatherTargetDuration) {
        offlineFramesRemaining -= env.weatherTargetDuration;
        env.refillWeatherQueue();
        next = env.weatherQueue.shift()!;
        env.weather = next.type;
        env.weatherTargetDuration = next.durationFrames;
        env.weatherTimer = 0;
      }
      env.weatherTimer = offlineFramesRemaining;
    } else {
      env.weatherTimer += offlineFramesRemaining;
    }

    const colony = engine.colony;
    const grid = engine.grid;

    // Count roles
    let foragers = 0;
    let diggers = 0;
    let nurses = 0;
    colony.ants.forEach(a => {
      if (a.role === 'Forager') foragers++;
      else if (a.role === 'Digger') diggers++;
      else if (a.role === 'Nurse') nurses++;
    });

    // 1. Digging progression (clearing dirt cells underground)
    // Tunnels dug cells = diggers * diggingRate * duration
    const digRatePerSecond = 0.00008; // average cell dug per digger per second
    const rawCellsToDig = Math.floor(diggers * digRatePerSecond * duration);
    let cellsDug = 0;

    if (rawCellsToDig > 0) {
      // Find eligible dirt cells adjacent to air underground
      const candidates: { c: number; r: number }[] = [];
      for (let c = 5; c < grid.cols - 5; c++) {
        for (let r = CONFIG.SKY_HEIGHT + 5; r < grid.rows - 3; r++) {
          if (grid.isDiggable(c, r)) {
            // Check if adjacent to NestAir
            const isAdjToAir =
              grid.getCell(c + 1, r)?.type === 'NestAir' ||
              grid.getCell(c - 1, r)?.type === 'NestAir' ||
              grid.getCell(c, r + 1)?.type === 'NestAir' ||
              grid.getCell(c, r - 1)?.type === 'NestAir';
            if (isAdjToAir) {
              candidates.push({ c, r });
            }
          }
        }
      }

      // Sort or shuffle candidates
      candidates.sort(() => Math.random() - 0.5);

      const targetDig = Math.min(rawCellsToDig, candidates.length, 300); // safety cap
      for (let i = 0; i < targetDig; i++) {
        const cell = candidates[i];
        if (grid.digCell(cell.c, cell.r)) {
          cellsDug++;
          engine.totalDirtDugGlobal++;
          // Deposit on mound
          grid.depositDirt(cell.c);
        }
      }
    }

    // 2. Foraging / Food gathering progress
    // Look at how much food is available on surface
    let foodAvailableOnGrid = 0;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.cells[c][r].type === 'Food') {
          foodAvailableOnGrid += grid.cells[c][r].foodAmount;
        }
      }
    }

    // Foragers bring food
    const gatherRatePerForagerSecond = 0.005; // average food units brought per forager per second
    const maxGatherable = foragers * gatherRatePerForagerSecond * duration;
    const foodGathered = Math.floor(Math.min(maxGatherable, foodAvailableOnGrid));

    // Consume food from grid cells
    let foodToConsumeFromGrid = foodGathered;
    for (let c = 0; c < grid.cols && foodToConsumeFromGrid > 0; c++) {
      for (let r = 0; r < grid.rows && foodToConsumeFromGrid > 0; r++) {
        if (grid.cells[c][r].type === 'Food') {
          const amt = grid.cells[c][r].foodAmount;
          const take = Math.min(amt, foodToConsumeFromGrid);
          grid.cells[c][r].foodAmount -= take;
          foodToConsumeFromGrid -= take;
          if (grid.cells[c][r].foodAmount <= 0) {
            grid.setCellType(c, r, 'Sky');
          }
        }
      }
    }

    // Add to stockpile
    colony.foodStockpile += foodGathered;

    // 3. Colony food consumption
    const foodConsumedRaw = colony.ants.length * CONFIG.FOOD_CONSUMPTION_RATE * 0.1 * duration;
    const foodConsumed = Math.floor(Math.min(foodConsumedRaw, colony.foodStockpile));
    colony.foodStockpile = Math.max(0, colony.foodStockpile - foodConsumed);

    // 4. Queen laying eggs
    // Lays an egg every CONFIG.QUEEN_EGG_INTERVAL if food is available in stockpile
    let eggsLaid = 0;
    let antsBorn = 0;

    const eggLayInterval = CONFIG.QUEEN_EGG_INTERVAL;

    // Run simple simulation steps for egg and larvae progression
    const stepSizeSeconds = Math.min(duration, 300); // run in 5-minute ticks
    const stepsCount = Math.floor(duration / stepSizeSeconds);

    for (let s = 0; s < stepsCount; s++) {
      // Queen lays egg if food in stockpile
      if (colony.foodStockpile >= 10 && Math.random() < (stepSizeSeconds / eggLayInterval)) {
        colony.foodStockpile -= 10;
        eggsLaid++;
        
        // Spawn egg at queen pos
        const rx = colony.queen.x + (Math.random() - 0.5) * 40;
        const ry = colony.queen.y + 12;
        colony.broodList.push({
          id: `brood-${Math.random().toString(36).substr(2, 9)}`,
          type: 'Egg',
          x: rx,
          y: ry,
          progress: 0,
          needsFood: false,
          beingCarried: false,
        });
      }

      // Progress Brood
      for (let i = colony.broodList.length - 1; i >= 0; i--) {
        const b = colony.broodList[i];

        if (b.type === 'Egg') {
          b.progress += (100 / CONFIG.EGG_HATCH_TIME) * stepSizeSeconds;
          if (b.progress >= 100) {
            b.type = 'Larva';
            b.progress = 0;
            b.needsFood = true;
          }
        } else if (b.type === 'Larva') {
          // If nurses are available and food exists, larvae are fed
          if (b.needsFood && nurses > 0 && colony.foodStockpile >= 1) {
            colony.foodStockpile -= 1;
            b.needsFood = false;
            b.progress += 25; // boost growth when fed
          }

          b.progress += (100 / CONFIG.LARVA_GROWTH_TIME) * stepSizeSeconds * (b.needsFood ? 0.2 : 1.0);
          if (b.progress >= 100) {
            b.type = 'Pupa';
            b.progress = 0;
          }
        } else if (b.type === 'Pupa') {
          b.progress += (100 / CONFIG.PUPA_HATCH_TIME) * stepSizeSeconds;
          if (b.progress >= 100) {
            // Hatch worker
            antsBorn++;
            const id = `ant-${Math.random().toString(36).substr(2, 9)}`;
            
            // Assign role
            let role: AntRole = 'Forager';
            if (foragers > diggers && foragers > nurses) {
              role = 'Digger';
              diggers++;
            } else if (diggers > nurses) {
              role = 'Nurse';
              nurses++;
            } else {
              role = 'Forager';
              foragers++;
            }

            const num = colony.nextAntNum++;
            const ant = new Ant(id, colony.queen.x, colony.queen.y, role, num, createDefaultBrain(), 1);
            colony.ants.push(ant);
            colony.broodList.splice(i, 1);
          }
        }
      }
    }

    // Write a summary log in the colony logs
    if (antsBorn > 0 || foodGathered > 0 || cellsDug > 0) {
      colony.addLog(`Colony offline progression: gathered +${foodGathered} food, dug +${cellsDug} dirt cells, and welcomed +${antsBorn} new ants!`, 'system');
    }

    return {
      elapsedSeconds: totalSeconds,
      foodGathered,
      foodConsumed,
      antsBorn,
      dirtDug: cellsDug,
    };
  }

  public static clearSave() {
    localStorage.removeItem('ant_farm_save_v3');
    localStorage.removeItem('ant_farm_save_v2');
    localStorage.removeItem('ant_farm_save_v1');
  }
}
