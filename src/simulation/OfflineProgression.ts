import { CONFIG, STARTING_CHAMBER_CENTER_ROW } from './types';
import type { CellType, AntRole, FoodType } from './types';
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
  foodDecayed?: number;
  broodLosses?: number;
  dirtCleared?: number;
  threatLogs?: string[];
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
        else if (cell.type === 'Water') ch = 'W';
        else if (cell.type === 'Food') {
          if (cell.isMoldy) {
            ch = 'M'; // Moldy Apple
            if (cell.foodType === 'Foliage') ch = 'N';
            else if (cell.foodType === 'Carcass') ch = 'O';
          } else {
            ch = 'F'; // Default Apple
            if (cell.foodType === 'Foliage') ch = 'G';
            else if (cell.foodType === 'Carcass') ch = 'C';
          }
        }
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
        let foodType: FoodType | undefined = undefined;
        let isMoldy: boolean | undefined = undefined;

        if (ch === 'S') type = 'Sky';
        else if (ch === 'R') type = 'Rock';
        else if (ch === 'A') type = 'NestAir';
        else if (ch === 'W') type = 'Water';
        else if (ch === 'F' || ch === 'G' || ch === 'C' || ch === 'M' || ch === 'N' || ch === 'O') {
          type = 'Food';
          foodAmount = CONFIG.FOOD_PIECE_SIZE;
          isMoldy = ch === 'M' || ch === 'N' || ch === 'O';
          if (ch === 'F' || ch === 'M') foodType = 'Apple';
          else if (ch === 'G' || ch === 'N') foodType = 'Foliage';
          else if (ch === 'C' || ch === 'O') foodType = 'Carcass';
        }

        grid.cells[c][r] = {
          type,
          foodAmount,
          noiseVal: Math.random(),
          foodType,
          isMoldy,
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
        maxPopulation: engine.colony.maxPopulation,
        maxGenerationReached: engine.colony.maxGenerationReached,
        queen: {
          x: engine.colony.queen.x,
          y: engine.colony.queen.y,
          energy: engine.colony.queen.energy,
          eggTimer: engine.colony.queen.eggTimer,
          restTimer: engine.colony.queen.restTimer,
          age: engine.colony.queen.age,
          maxAge: engine.colony.queen.maxAge,
          health: engine.colony.queen.health,
          submergedTime: engine.colony.queen.submergedTime,
          isDead: engine.colony.queen.isDead,
          deathReason: engine.colony.queen.deathReason,
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
          health: ant.health,
          submergedTime: ant.submergedTime,
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
      engine.colony.maxPopulation = state.maxPopulation ?? 8;
      engine.colony.maxGenerationReached = state.maxGenerationReached ?? 1;
      engine.colony.queen = state.queen
        ? {
            ...state.queen,
            targetX: state.queen.targetX ?? state.queen.x,
            direction: state.queen.direction ?? 1,
            restTimer: state.queen.restTimer ?? 0,
            age: state.queen.age ?? 0,
            maxAge: state.queen.maxAge ?? CONFIG.QUEEN_MAX_AGE,
            health: state.queen.health ?? 100,
            submergedTime: state.queen.submergedTime ?? 0,
            isDead: state.queen.isDead ?? false,
            deathReason: state.queen.deathReason,
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
        } else if (textLower.includes('died') || textLower.includes('death') || textLower.includes('accident') || textLower.includes('dehydration') || textLower.includes('exhaustion') || textLower.includes('cave-in') || textLower.includes('drowned')) {
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
      const startY = STARTING_CHAMBER_CENTER_ROW * CONFIG.CELL_SIZE;

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
        ant.health = a.health ?? 100;
        ant.submergedTime = a.submergedTime ?? 0;
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
    const inGameHours = totalSimMinutes / 60;
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

    // Progress Weather Queue Offline and track rainy/sunny seconds
    let rainySeconds = 0;
    let sunnySeconds = 0;

    let offlineFramesRemaining = duration * 60;
    let currentRemaining = Math.max(0, env.weatherTargetDuration - env.weatherTimer);

    if (offlineFramesRemaining >= currentRemaining) {
      const currentCycleSecs = currentRemaining / 60;
      if (env.weather === 'Rainy') {
        rainySeconds += currentCycleSecs;
      } else {
        sunnySeconds += currentCycleSecs;
      }
      offlineFramesRemaining -= currentRemaining;

      env.refillWeatherQueue();
      let next = env.weatherQueue.shift()!;
      env.weather = next.type;
      env.weatherTargetDuration = next.durationFrames;
      env.weatherTimer = 0;

      while (offlineFramesRemaining >= env.weatherTargetDuration) {
        const cycleSecs = env.weatherTargetDuration / 60;
        if (env.weather === 'Rainy') {
          rainySeconds += cycleSecs;
        } else {
          sunnySeconds += cycleSecs;
        }
        offlineFramesRemaining -= env.weatherTargetDuration;
        env.refillWeatherQueue();
        next = env.weatherQueue.shift()!;
        env.weather = next.type;
        env.weatherTargetDuration = next.durationFrames;
        env.weatherTimer = 0;
      }

      const finalSecs = offlineFramesRemaining / 60;
      if (env.weather === 'Rainy') {
        rainySeconds += finalSecs;
      } else {
        sunnySeconds += finalSecs;
      }
      env.weatherTimer = offlineFramesRemaining;
    } else {
      const finalSecs = offlineFramesRemaining / 60;
      if (env.weather === 'Rainy') {
        rainySeconds += finalSecs;
      } else {
        sunnySeconds += finalSecs;
      }
      env.weatherTimer += offlineFramesRemaining;
    }

    const colony = engine.colony;
    const grid = engine.grid;

    // Count roles
    let foragers = 0;
    let diggers = 0;
    let nurses = 0;
    let soldiers = 0;
    colony.ants.forEach(a => {
      if (a.role === 'Forager') foragers++;
      else if (a.role === 'Digger') diggers++;
      else if (a.role === 'Nurse') nurses++;
      else if ((a.role as string) === 'Soldier') soldiers++;
    });

    const threatLogs: string[] = [];

    // 1. Spawn Rain Water Offline (rebalanced trickle at nest entrance, no surface pooling)
    let waterAccumulated = 0;
    if (rainySeconds > 0) {
      const spawnCount = Math.min(2000, Math.floor(rainySeconds * 1.2));
      for (let i = 0; i < spawnCount; i++) {
        const col = grid.nestEntranceCol - 2 + Math.floor(Math.random() * 4);
        const row = CONFIG.SKY_HEIGHT;
        if (grid.isValid(col, row)) {
          const cell = grid.getCell(col, row);
          if (cell && (cell.type === 'NestAir' || cell.type === 'Sky')) {
            cell.type = 'Water';
            waterAccumulated++;
          }
        }
      }
    }

    // 2. Sunny Water Evaporation Offline
    let waterEvaporated = 0;
    if (sunnySeconds > 0) {
      const evapAttempts = Math.min(15000, Math.floor(sunnySeconds * 21));
      const rate = CONFIG.WATER_EVAPORATION_RATE || 2;
      for (let i = 0; i < evapAttempts; i++) {
        for (let j = 0; j < rate; j++) {
          const col = Math.floor(Math.random() * grid.cols);
          for (let r = 0; r < grid.rows; r++) {
            const cell = grid.getCell(col, r);
            if (cell && cell.type === 'Water') {
              grid.setCellType(col, r, r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir');
              waterEvaporated++;
              break;
            }
          }
        }
      }
    }

    // 3. Localized CA water updates offline
    const caSteps = Math.min(1000, Math.floor(duration * 2));
    if (caSteps > 0) {
      for (let step = 0; step < caSteps; step++) {
        for (let r = 250; r >= 80; r--) {
          const waterCols: number[] = [];
          for (let c = 150; c <= 250; c++) {
            if (grid.cells[c][r].type === 'Water') {
              waterCols.push(c);
            }
          }
          if (waterCols.length === 0) continue;

          for (let i = waterCols.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = waterCols[i];
            waterCols[i] = waterCols[j];
            waterCols[j] = temp;
          }

          for (const c of waterCols) {
            if (grid.cells[c][r].type !== 'Water') continue;

            // If a water cell is on the surface (at or above CONFIG.SKY_HEIGHT) and not in the shaft columns, evaporate it
            if (r <= CONFIG.SKY_HEIGHT && (c < grid.nestEntranceCol - 2 || c > grid.nestEntranceCol + 1)) {
              grid.cells[c][r].type = 'Sky';
              continue;
            }

            const belowR = r + 1;
            if (belowR <= 250) {
              const belowCell = grid.cells[c][belowR];
              if (belowCell.type === 'NestAir' || belowCell.type === 'Sky') {
                belowCell.type = 'Water';
                grid.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
                continue;
              }
            }

            const diagOffsets = Math.random() < 0.5 ? [-1, 1] : [1, -1];
            let movedDiag = false;
            for (const dc of diagOffsets) {
              const tc = c + dc;
              const tr = r + 1;
              if (tc >= 150 && tc <= 250 && tr <= 250) {
                const diagCell = grid.cells[tc][tr];
                if (diagCell.type === 'NestAir' || diagCell.type === 'Sky') {
                  diagCell.type = 'Water';
                  grid.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
                  movedDiag = true;
                  break;
                }
              }
            }
            if (movedDiag) continue;

            const latOffsets = Math.random() < 0.5 ? [-1, 1] : [1, -1];
            let movedLat = false;
            for (const dc of latOffsets) {
              const tc = c + dc;
              if (tc >= 150 && tc <= 250) {
                const latCell = grid.cells[tc][r];
                if (latCell.type === 'NestAir' || latCell.type === 'Sky') {
                  latCell.type = 'Water';
                  grid.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
                  movedLat = true;
                  break;
                }
              }
            }
            if (movedLat) continue;
          }
        }
      }
    }

    // 3.5. Granular food gravity updates offline
    const foodSteps = Math.min(500, Math.floor(duration * 1));
    if (foodSteps > 0) {
      for (let step = 0; step < foodSteps; step++) {
        for (let r = grid.rows - 2; r >= 0; r--) {
          const foodCols: number[] = [];
          for (let c = 0; c < grid.cols; c++) {
            if (grid.cells[c][r].type === 'Food') {
              foodCols.push(c);
            }
          }
          if (foodCols.length === 0) continue;

          for (let i = foodCols.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const temp = foodCols[i];
            foodCols[i] = foodCols[j];
            foodCols[j] = temp;
          }

          for (const c of foodCols) {
            if (grid.cells[c][r].type !== 'Food') continue;

            const belowR = r + 1;
            if (belowR < grid.rows) {
              const belowCell = grid.cells[c][belowR];
              if (belowCell.type === 'NestAir' || belowCell.type === 'Sky') {
                belowCell.type = 'Food';
                belowCell.foodAmount = grid.cells[c][r].foodAmount;
                belowCell.foodType = grid.cells[c][r].foodType;
                belowCell.isMoldy = grid.cells[c][r].isMoldy;

                grid.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
                grid.cells[c][r].foodAmount = 0;
                grid.cells[c][r].foodType = undefined;
                grid.cells[c][r].isMoldy = undefined;
                continue;
              }
            }

            const diagOffsets = Math.random() < 0.5 ? [-1, 1] : [1, -1];
            let movedDiag = false;
            for (const dc of diagOffsets) {
              const tc = c + dc;
              const tr = r + 1;
              if (grid.isValid(tc, tr)) {
                const diagCell = grid.cells[tc][tr];
                if (diagCell.type === 'NestAir' || diagCell.type === 'Sky') {
                  diagCell.type = 'Food';
                  diagCell.foodAmount = grid.cells[c][r].foodAmount;
                  diagCell.foodType = grid.cells[c][r].foodType;
                  diagCell.isMoldy = grid.cells[c][r].isMoldy;

                  grid.cells[c][r].type = r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir';
                  grid.cells[c][r].foodAmount = 0;
                  grid.cells[c][r].foodType = undefined;
                  grid.cells[c][r].isMoldy = undefined;
                  movedDiag = true;
                  break;
                }
              }
            }
            if (movedDiag) continue;
          }
        }
      }
    }

    // 4. Rain cave-ins & Diggers clearing cave-ins
    let caveInsCount = 0;
    let dirtCleared = 0;
    if (rainySeconds > 0) {
      const maxCaveIns = Math.min(50, Math.floor(rainySeconds * 0.05));
      for (let i = 0; i < maxCaveIns; i++) {
        const col = 150 + Math.floor(Math.random() * 101);
        const row = 80 + Math.floor(Math.random() * 171);
        const cell = grid.getCell(col, row);
        if (cell && cell.type === 'NestAir') {
          grid.setCellType(col, row, 'Dirt');
          caveInsCount++;
        }
      }
      if (caveInsCount > 0) {
        threatLogs.push(`Threat: Heavy rain storm caused ${caveInsCount} tunnel cave-ins!`);
        colony.addLog(`Heavy rain storm caused ${caveInsCount} tunnel cave-ins!`, 'system');

        if (diggers > 0) {
          const clearCapacity = Math.floor(diggers * 0.002 * duration);
          const targetClear = Math.min(caveInsCount, clearCapacity);
          let clearedSoFar = 0;
          for (let attempt = 0; attempt < 500 && clearedSoFar < targetClear; attempt++) {
            const col = 150 + Math.floor(Math.random() * 101);
            const row = 80 + Math.floor(Math.random() * 171);
            const cell = grid.getCell(col, row);
            if (cell && cell.type === 'Dirt') {
              const isAdjToAir =
                grid.getCell(col + 1, row)?.type === 'NestAir' ||
                grid.getCell(col - 1, row)?.type === 'NestAir' ||
                grid.getCell(col, row + 1)?.type === 'NestAir' ||
                grid.getCell(col, row - 1)?.type === 'NestAir';
              if (isAdjToAir) {
                grid.setCellType(col, row, 'NestAir');
                clearedSoFar++;
              }
            }
          }
          dirtCleared = clearedSoFar;
          if (dirtCleared > 0) {
            threatLogs.push(`Defense: Diggers cleared ${dirtCleared} caved-in dirt cells to restore tunnel flow.`);
            colony.addLog(`Diggers cleared ${dirtCleared} caved-in dirt cells.`, 'system');
          }
        }
      }
    }

    // 5. Mold Decay in Larders
    let foodDecayed = 0;
    const larders = typeof colony.getLarderBoxes === 'function' ? colony.getLarderBoxes(grid) : [];
    let moldLogs = false;
    for (const box of larders) {
      const flooded = typeof colony.isLarderFlooded === 'function' ? colony.isLarderFlooded(grid, box) : false;
      for (let c = box.minCol; c <= box.maxCol; c++) {
        for (let r = box.minRow; r <= box.maxRow; r++) {
          const cell = grid.getCell(c, r);
          if (cell && cell.type === 'Food') {
            if (flooded && !cell.isMoldy) {
              cell.isMoldy = true;
              moldLogs = true;
            }
            if (cell.isMoldy) {
              const decayAmount = 0.3 * duration;
              const actualDecay = Math.min(cell.foodAmount, decayAmount);
              cell.foodAmount -= actualDecay;
              foodDecayed += actualDecay;
              if (cell.foodAmount <= 0) {
                grid.setCellType(c, r, 'NestAir');
                cell.foodAmount = 0;
                cell.foodType = undefined;
                cell.isMoldy = false;
              }
            }
          }
        }
      }
    }
    foodDecayed = Math.floor(foodDecayed);
    if (moldLogs) {
      colony.addLog('Flooded larder detected! Food stockpiles are decaying from mold.', 'system');
      threatLogs.push('Warning: Water leaked into the larder chamber, causing mold decay!');
    } else if (foodDecayed > 0) {
      threatLogs.push(`Warning: Moldy food in larder decayed: lost ${foodDecayed} food units.`);
    }

    // 6. Digging progression (clearing dirt cells underground)
    const digRatePerSecond = 0.00008;
    const rawCellsToDig = Math.floor(diggers * digRatePerSecond * duration);
    let cellsDug = 0;

    if (rawCellsToDig > 0) {
      const candidates: { c: number; r: number }[] = [];
      for (let c = 5; c < grid.cols - 5; c++) {
        for (let r = CONFIG.SKY_HEIGHT + 5; r < grid.rows - 3; r++) {
          if (grid.isDiggable(c, r)) {
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

      candidates.sort(() => Math.random() - 0.5);

      const targetDig = Math.min(rawCellsToDig, candidates.length, 300);
      for (let i = 0; i < targetDig; i++) {
        const cell = candidates[i];
        if (grid.digCell(cell.c, cell.r)) {
          cellsDug++;
          engine.totalDirtDugGlobal++;
          grid.depositDirt(cell.c);
        }
      }
    }

    // 7. Foraging / Food gathering progress
    let foodAvailableOnGrid = 0;
    for (let c = 0; c < grid.cols; c++) {
      for (let r = 0; r < grid.rows; r++) {
        if (grid.cells[c][r].type === 'Food') {
          foodAvailableOnGrid += grid.cells[c][r].foodAmount;
        }
      }
    }

    const gatherRatePerForagerSecond = 0.005;
    const maxGatherable = foragers * gatherRatePerForagerSecond * duration;
    const foodGathered = Math.floor(Math.min(maxGatherable, foodAvailableOnGrid));

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

    colony.foodStockpile += foodGathered;

    // 8. Colony food consumption
    const foodConsumedRaw = colony.ants.length * CONFIG.FOOD_CONSUMPTION_RATE * 0.1 * duration;
    const foodConsumed = Math.floor(Math.min(foodConsumedRaw, colony.foodStockpile));
    colony.foodStockpile = Math.max(0, colony.foodStockpile - foodConsumed);

    // 9. Mite Invasions
    let broodLosses = 0;
    if (inGameHours > 0) {
      const intervals = Math.max(1, Math.floor(inGameHours / 12));
      for (let i = 0; i < intervals; i++) {
        if (colony.broodList.length > 0 && Math.random() < 0.10) {
          if (soldiers > 0) {
            threatLogs.push("Defense: Mites invaded the nurseries, but Soldier ants successfully defended the brood!");
          } else {
            const lossCount = Math.min(colony.broodList.length, 1 + Math.floor(Math.random() * 3));
            if (lossCount > 0) {
              broodLosses += lossCount;
              for (let k = 0; k < lossCount; k++) {
                colony.broodList.pop();
              }
            }
          }
        }
      }
      if (broodLosses > 0) {
        threatLogs.push(`Threat: Mites invaded the nurseries and devoured ${broodLosses} brood items!`);
        colony.addLog(`Mites invaded the nurseries and devoured ${broodLosses} brood items!`, 'deaths');
      }
    }

    // 10. Queen aging, energy, health & drowning updates
    if (!colony.queen.isDead) {
      colony.queen.age += duration / 120;

      const qCol = Math.floor(colony.queen.x / CONFIG.CELL_SIZE);
      const qRow = Math.floor(colony.queen.y / CONFIG.CELL_SIZE);
      const qCell = grid.getCell(qCol, qRow);
      const qSubmerged = qCell && qCell.type === 'Water';

      if (qSubmerged) {
        colony.queen.submergedTime += duration;
        if (colony.queen.submergedTime > 5.0) {
          const damage = 2 * 60 * (duration - Math.max(0, 5.0 - (colony.queen.submergedTime - duration)));
          colony.queen.health = Math.max(0, colony.queen.health - damage);
        }
      } else {
        colony.queen.submergedTime = 0;
        colony.queen.health = Math.min(100, colony.queen.health + 30 * duration);
      }

      const queenEnergyLoss = (100 / 360) * duration;
      colony.queen.energy = Math.max(0, colony.queen.energy - queenEnergyLoss);

      if (colony.queen.energy < 75 && nurses > 0 && colony.foodStockpile >= 5) {
        const deficit = 100 - colony.queen.energy;
        const feedsNeeded = Math.ceil(deficit / 25);
        const feedsPossible = Math.min(feedsNeeded, Math.floor(colony.foodStockpile / 5));
        if (feedsPossible > 0) {
          colony.queen.energy = Math.min(100, colony.queen.energy + feedsPossible * 25);
          colony.foodStockpile = Math.max(0, colony.foodStockpile - feedsPossible * 5);
        }
      }

      if (colony.queen.age >= colony.queen.maxAge) {
        colony.queen.isDead = true;
        colony.queen.deathReason = 'old age';
        colony.addLog('The Queen has died of old age! Colony Collapse is imminent.', 'deaths');
        threatLogs.push('Colony Collapse: The Queen has died of old age.');
      } else if (colony.queen.energy <= 0) {
        colony.queen.isDead = true;
        colony.queen.deathReason = 'starvation';
        colony.addLog('The Queen has died of starvation! Colony Collapse is imminent.', 'deaths');
        threatLogs.push('Colony Collapse: The Queen has died of starvation.');
      } else if (colony.queen.health <= 0) {
        colony.queen.isDead = true;
        colony.queen.deathReason = 'drowning';
        colony.addLog('The Queen has drowned! Colony Collapse is imminent.', 'deaths');
        threatLogs.push('Colony Collapse: The Queen has drowned.');
      }
    }

    // 11. Worker ants updates: aging and drowning offline
    let antsDiedOldAge = 0;
    let antsDrowned = 0;
    for (let i = colony.ants.length - 1; i >= 0; i--) {
      const ant = colony.ants[i];
      ant.age += duration / 120;

      const col = Math.floor(ant.x / CONFIG.CELL_SIZE);
      const row = Math.floor(ant.y / CONFIG.CELL_SIZE);
      const cell = grid.getCell(col, row);
      const isSubmerged = cell && cell.type === 'Water';

      let died = false;
      if (ant.age >= ant.maxAge) {
        died = true;
        antsDiedOldAge++;
      } else if (isSubmerged) {
        ant.submergedTime += duration;
        if (ant.submergedTime > 5.0) {
          const damage = 2 * 60 * (duration - Math.max(0, 5.0 - (ant.submergedTime - duration)));
          ant.health -= damage;
        }
        if (ant.health <= 0) {
          died = true;
          antsDrowned++;
        }
      } else {
        ant.submergedTime = 0;
        ant.health = Math.min(100, ant.health + 30 * duration);
      }

      if (died) {
        colony.ants.splice(i, 1);
      }
    }
    if (antsDiedOldAge > 0) {
      threatLogs.push(`Threat: ${antsDiedOldAge} worker ants died of old age.`);
      colony.addLog(`${antsDiedOldAge} workers died of old age.`, 'deaths');
    }
    if (antsDrowned > 0) {
      threatLogs.push(`Threat: ${antsDrowned} worker ants drowned in flooded tunnels.`);
      colony.addLog(`${antsDrowned} workers drowned.`, 'deaths');
    }

    // 12. Queen laying eggs / Brood progression offline
    let eggsLaid = 0;
    let antsBorn = 0;
    const stepSizeSeconds = Math.min(duration, 300);
    const stepsCount = Math.floor(duration / stepSizeSeconds);

    if (!colony.queen.isDead) {
      let localEggTimer = colony.queen.eggTimer;
      for (let s = 0; s < stepsCount; s++) {
        let remainingSeconds = stepSizeSeconds;
        while (remainingSeconds > 0) {
          if (localEggTimer <= 0) {
            if (colony.foodStockpile >= 10) {
              colony.foodStockpile -= 10;
              eggsLaid++;
              
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
              localEggTimer = CONFIG.QUEEN_EGG_INTERVAL + Math.random() * 20;
            } else {
              localEggTimer = 0;
              break; // out of food, stop trying to lay eggs in this step
            }
          }
          const dtToNextEgg = Math.max(1, localEggTimer);
          const elapsed = Math.min(remainingSeconds, dtToNextEgg);
          localEggTimer -= elapsed;
          remainingSeconds -= elapsed;
        }
        colony.queen.eggTimer = localEggTimer;

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
            if (b.needsFood && nurses > 0 && colony.foodStockpile >= 1) {
              colony.foodStockpile -= 1;
              b.needsFood = false;
              b.progress += 25;
            }

            b.progress += (100 / CONFIG.LARVA_GROWTH_TIME) * stepSizeSeconds * (b.needsFood ? 0.2 : 1.0);
            if (b.progress >= 100) {
              b.type = 'Pupa';
              b.progress = 0;
            }
          } else if (b.type === 'Pupa') {
            b.progress += (100 / CONFIG.PUPA_HATCH_TIME) * stepSizeSeconds;
            if (b.progress >= 100) {
              antsBorn++;
              const id = `ant-${Math.random().toString(36).substr(2, 9)}`;
              
              const totalAntsCount = (foragers + diggers + nurses + soldiers) || 1;
              const fDiff = 0.40 - (foragers / totalAntsCount);
              const dDiff = 0.35 - (diggers / totalAntsCount);
              const nDiff = 0.25 - (nurses / totalAntsCount);

              let role: AntRole = 'Forager';
              if (fDiff >= dDiff && fDiff >= nDiff) {
                role = 'Forager';
                foragers++;
              } else if (dDiff >= nDiff) {
                role = 'Digger';
                diggers++;
              } else {
                role = 'Nurse';
                nurses++;
              }

              const num = colony.nextAntNum++;
              const ant = new Ant(id, colony.queen.x, colony.queen.y, role, num, createDefaultBrain(), 1);
              colony.ants.push(ant);
              colony.broodList.splice(i, 1);
            }
          }
        }
      }
    }

    if (antsBorn > 0 || foodGathered > 0 || cellsDug > 0) {
      colony.addLog(`Colony offline progression: gathered +${foodGathered} food, dug +${cellsDug} dirt cells, and welcomed +${antsBorn} new ants!`, 'system');
    }

    return {
      elapsedSeconds: totalSeconds,
      foodGathered,
      foodConsumed,
      antsBorn,
      dirtDug: cellsDug,
      foodDecayed,
      broodLosses,
      dirtCleared,
      threatLogs,
    };
  }

  public static clearSave() {
    localStorage.removeItem('ant_farm_save_v3');
    localStorage.removeItem('ant_farm_save_v2');
    localStorage.removeItem('ant_farm_save_v1');
  }
}
