import { CONFIG } from './types';
import type { Position, Brood } from './types';
import { WorldGrid } from './Grid';
import { PheromoneGrid } from './Pheromones';
import { ColonyManager } from './Colony';
import { Ant } from './Ant';
import { TelemetryTracker } from './Telemetry';
import { Environment } from './Environment';
import { FoliageSystem } from './Foliage';
import type { Tree, GrassBlade } from './Foliage';

export class SimulationEngine {
  public canvas: HTMLCanvasElement;
  public ctx: CanvasRenderingContext2D;
  public grid: WorldGrid;
  public pheromones: PheromoneGrid;
  public colony: ColonyManager;
  
  public speedMultiplier: number = 1; // 1x, 2x, 5x, 0 (paused)
  public showPheromones: boolean = true;
  public showDebug: boolean = true;
  public showAntNames: boolean = true;
  
  public totalDirtDugGlobal: number = 0;
  public telemetryTracker: TelemetryTracker;
  private telemetryTimer: number = 0;

  public environment: Environment;

  // Pass-through clock properties
  public get dayCount(): number { return this.environment.dayCount; }
  public set dayCount(val: number) { this.environment.dayCount = val; }
  public get hour(): number { return this.environment.hour; }
  public set hour(val: number) { this.environment.hour = val; }
  public get minute(): number { return this.environment.minute; }
  public set minute(val: number) { this.environment.minute = val; }
  public get minuteFraction(): number { return this.environment.minuteFraction; }
  public set minuteFraction(val: number) { this.environment.minuteFraction = val; }

  // Pass-through weather properties
  public get weather(): 'Sunny' | 'Rainy' { return this.environment.weather; }
  public set weather(val: 'Sunny' | 'Rainy') { this.environment.weather = val; }
  public get weatherTimer(): number { return this.environment.weatherTimer; }
  public set weatherTimer(val: number) { this.environment.weatherTimer = val; }
  public get weatherTargetDuration(): number { return this.environment.weatherTargetDuration; }
  public set weatherTargetDuration(val: number) { this.environment.weatherTargetDuration = val; }
  public get weatherQueue(): { type: 'Sunny' | 'Rainy'; durationFrames: number }[] { return this.environment.weatherQueue; }
  public set weatherQueue(val: { type: 'Sunny' | 'Rainy'; durationFrames: number }[]) { this.environment.weatherQueue = val; }

  // Foliage properties
  public foliageSystem: FoliageSystem;
  public get trees(): Tree[] { return this.foliageSystem.trees; }
  public get grassBlades(): GrassBlade[] { return this.foliageSystem.grassBlades; }
  
  // Camera state
  public camera = {
    x: 0,
    y: 0,
    zoom: 1.0,
  };
  public dpr: number = 1;
  
  // Storage callback
  public onStateSaveNeeded: () => void = () => {};

  public refillWeatherQueue() {
    this.environment.refillWeatherQueue();
  }

  public advanceWeather() {
    this.environment.advanceWeather((msg, cat) => this.colony.addLog(msg, cat));
  }

  public setWeather(newWeather: 'Sunny' | 'Rainy') {
    this.environment.setWeather(newWeather, (msg, cat) => this.colony.addLog(msg, cat));
  }

  public getHumidity(): number {
    return this.environment.getHumidity();
  }

  public getPressure(): number {
    return this.environment.getPressure();
  }

  public getSkyLight(): number {
    return this.environment.getSkyLight();
  }

  public getRainDimFactor(): number {
    return this.environment.getRainDimFactor();
  }

  public getWeatherForecast(): { type: 'Sunny' | 'Rainy'; durationHours: number; delayHours: number }[] {
    return this.environment.getWeatherForecast();
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D;
    
    this.grid = new WorldGrid();
    this.pheromones = new PheromoneGrid();
    this.colony = new ColonyManager(this.grid.nestEntranceCol);
    this.telemetryTracker = new TelemetryTracker();
    this.environment = new Environment();
    this.foliageSystem = new FoliageSystem();

    // Initial camera coordinates centering on the Queen
    this.camera.x = this.colony.queen.x;
    this.camera.y = this.colony.queen.y;
    this.camera.zoom = 1.0;

    this.initializeFoliage();
    this.resizeCanvas();
  }

  public getMinZoom(): number {
    const displayWidth = this.canvas.width / this.dpr;
    const displayHeight = this.canvas.height / this.dpr;
    const worldWidth = CONFIG.COLS * CONFIG.CELL_SIZE;
    const worldHeight = CONFIG.ROWS * CONFIG.CELL_SIZE;
    return Math.max(displayWidth / worldWidth, displayHeight / worldHeight);
  }

  public resizeCanvas() {
    const container = this.canvas.parentElement || document.body;
    const rect = container.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * this.dpr;
    this.canvas.height = rect.height * this.dpr;

    // Clamp zoom to prevent showing black borders when window is resized larger
    const minZoom = this.getMinZoom();
    if (this.camera.zoom < minZoom) {
      this.camera.zoom = minZoom;
    }
  }

  public clampCamera(displayWidth: number, displayHeight: number) {
    const worldWidth = CONFIG.COLS * CONFIG.CELL_SIZE;
    const worldHeight = CONFIG.ROWS * CONFIG.CELL_SIZE;
    
    const viewWidth = displayWidth / this.camera.zoom;
    const viewHeight = displayHeight / this.camera.zoom;
    
    if (worldWidth <= viewWidth) {
      this.camera.x = worldWidth / 2;
    } else {
      const minX = viewWidth / 2;
      const maxX = worldWidth - viewWidth / 2;
      this.camera.x = Math.max(minX, Math.min(maxX, this.camera.x));
    }
    
    if (worldHeight <= viewHeight) {
      this.camera.y = worldHeight / 2;
    } else {
      const minY = viewHeight / 2;
      const maxY = worldHeight - viewHeight / 2;
      this.camera.y = Math.max(minY, Math.min(maxY, this.camera.y));
    }
  }

  public update() {
    if (this.speedMultiplier === 0) return; // Paused

    const mult = this.speedMultiplier;

    // 1. Update grids & pheromones
    this.pheromones.update(this.grid, mult);

    // 2. Update foliage (growth, falling physics, periodic drops)
    this.foliageSystem.update(mult, this.grid, this.weather, (msg, cat) => this.colony.addLog(msg, cat));

    // Record telemetry periodically
    this.telemetryTimer += mult;
    if (this.telemetryTimer >= 180) { // every 3 seconds (180 frames)
      this.telemetryTracker.record(this.colony.getStats(this.grid), this.colony.ants, this.totalDirtDugGlobal);
      this.telemetryTimer = 0;
    }

    // 3. Environment & Weather updates
    this.environment.update(
      mult,
      this.grid,
      this.camera,
      this.canvas.width,
      this.canvas.height,
      this.dpr,
      (msg, cat) => this.colony.addLog(msg, cat)
    );

    // 3. Update colony entities (Queen, Eggs, Larvae, Pupae)
    this.colony.update(mult, this.grid);

    // Get current coordinated excavation plan zone
    const activeExcavationStep = this.colony.getActiveExcavationStep(this.grid);
    const activeName = activeExcavationStep ? activeExcavationStep.name : 'Fully Built Colony';
    if (this.colony.lastActiveStepName !== activeName) {
      if (this.colony.lastActiveStepName !== null) {
        this.colony.addLog(`Excavation milestone: Starting ${activeName}.`, 'system');
      }
      this.colony.lastActiveStepName = activeName;
    }
    const activeExcavationTarget = this.colony.getActiveExcavationTarget(this.grid);
    const chambers = this.colony.getExcavatedChambers(this.grid);

    // 4. Update individual ants (and handle lifecycle / aging)
    const queenPos: Position = { x: this.colony.queen.x, y: this.colony.queen.y };
    const stockpileRef = { food: this.colony.foodStockpile };
    
    // Pass references to allow state modification
    for (let i = this.colony.ants.length - 1; i >= 0; i--) {
      const ant = this.colony.ants[i];
      const prevCargo = ant.cargo;
      
      // Update age (in game days where 1 day = 7200 frames)
      ant.age += (1 / 7200) * mult;
      
      // Lifecycle check: old age, starvation, or workplace accidents
      let died = false;
      let deathReason = '';
      if (ant.age >= ant.maxAge) {
        died = true;
        deathReason = 'old age';
      } else if (ant.energy <= 0) {
        died = true;
        deathReason = 'starvation';
      } else {
        // Tiny chance of accident on the job (reduced 10x to 1 in 1,000,000 frames base)
        let accidentChance = 0.0000005 * mult;
        if (this.weather === 'Rainy') {
          accidentChance *= 3; // higher danger during rain
        }
        if (ant.state === 'DiggingTunnel') {
          accidentChance *= 4; // cave-ins!
        }
        if (ant.state === 'SearchingForFood' && ant.y < CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE) {
          accidentChance *= 2; // exposure!
        }
        if (ant.collisions > 40) {
          accidentChance *= 2; // clumsy!
        }
        
        if (Math.random() < accidentChance) {
          died = true;
          const reasons = [
            'a sudden tunnel cave-in',
            'sheer exhaustion on the job',
            'an accidental dehydration',
            'a surface gust of wind'
          ];
          deathReason = reasons[Math.floor(Math.random() * reasons.length)];
        }
      }
      
      if (died) {
        this.colony.addLog(`Worker ${ant.num} (Gen ${ant.generation}) has died of ${deathReason}.`, 'deaths');
        
        // Handle cargo/brood drops on death
        const col = Math.floor(ant.x / CONFIG.CELL_SIZE);
        const row = Math.floor(ant.y / CONFIG.CELL_SIZE);
        
        if (ant.cargo === 'Food') {
          if (this.grid.isValid(col, row)) {
            this.grid.cells[col][row].type = 'Food';
            this.grid.cells[col][row].foodAmount = CONFIG.FOOD_PIECE_SIZE;
          }
        } else if (ant.cargo === 'Dirt') {
          if (row < CONFIG.SKY_HEIGHT) {
            this.grid.depositDirt(col);
          } else {
            if (this.grid.isValid(col, row) && this.grid.cells[col][row].type === 'NestAir') {
              this.grid.cells[col][row].type = 'Dirt';
              this.grid.cells[col][row].noiseVal = Math.random();
            }
          }
        }
        
        if (ant.isHoldingBrood && ant.targetBroodId) {
          const brood = this.colony.broodList.find(b => b.id === ant.targetBroodId);
          if (brood) {
            brood.beingCarried = false;
            // Snap brood to last safe position
            brood.x = ant.x;
            brood.y = ant.y;
          }
        }
        
        this.colony.ants.splice(i, 1);
        continue;
      }

      ant.update(
        this.grid,
        this.pheromones,
        stockpileRef,
        this.colony.broodList,
        queenPos,
        activeExcavationStep,
        activeExcavationTarget,
        chambers.nurseries,
        chambers.foodStorages,
        this.colony.broodManager,
        mult
      );

      // Track global statistics for dug dirt
      if (prevCargo === 'None' && ant.cargo === 'Dirt') {
        this.totalDirtDugGlobal++;
      }
    }

    // Update back the modified food stockpile value
    this.colony.foodStockpile = stockpileRef.food;

    // Periodically save state (every 300 frames)
    if (Math.random() < 0.003) {
      this.onStateSaveNeeded();
    }
  }

  public render() {
    const ctx = this.ctx;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Reset transform
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // 1. Clear screen with base underground void color
    ctx.fillStyle = 'hsl(28, 20%, 8%)'; // Dark earth cavity void
    ctx.fillRect(0, 0, width, height);

    // Calculate display boundaries in CSS pixels
    const displayWidth = width / this.dpr;
    const displayHeight = height / this.dpr;

    // Clamp camera within the grid bounds before drawing
    this.clampCamera(displayWidth, displayHeight);

    ctx.save();
    // Scale by DPR to support high-definition displays
    ctx.scale(this.dpr, this.dpr);

    // Center camera on screen and apply zoom + panning translation
    ctx.translate(displayWidth / 2, displayHeight / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    // Viewport Frustum Culling bounds
    const halfViewW = (displayWidth / this.camera.zoom) / 2;
    const halfViewH = (displayHeight / this.camera.zoom) / 2;
    
    const minX = this.camera.x - halfViewW;
    const maxX = this.camera.x + halfViewW;
    const minY = this.camera.y - halfViewH;
    const maxY = this.camera.y + halfViewH;

    const startCol = Math.max(0, Math.floor(minX / CONFIG.CELL_SIZE));
    const endCol = Math.min(CONFIG.COLS - 1, Math.ceil(maxX / CONFIG.CELL_SIZE));
    const startRow = Math.max(0, Math.floor(minY / CONFIG.CELL_SIZE));
    const endRow = Math.min(CONFIG.ROWS - 1, Math.ceil(maxY / CONFIG.CELL_SIZE));

    // 2. Draw Sky background (large enough to cover panning padding)
    this.environment.renderSky(ctx, minX, maxX, minY, maxY);

    // 3. Draw Grid (Dirt, Rock, Food) with Frustum Culling
    for (let c = startCol; c <= endCol; c++) {
      for (let r = startRow; r <= endRow; r++) {
        const cell = this.grid.cells[c][r];
        if (cell.type === 'NestAir' || cell.type === 'Sky') {
          continue; // Drawn by background
        }

        const x = c * CONFIG.CELL_SIZE;
        const y = r * CONFIG.CELL_SIZE;

        if (cell.type === 'Dirt') {
          // Draw grass only at the original surface height (row 130) if the cell above is Sky (air)
          const cellAbove = this.grid.getCell(c, r - 1);
          const isGrassBlock = r === CONFIG.SKY_HEIGHT && cellAbove && cellAbove.type === 'Sky';
          if (isGrassBlock) {
            // Draw a grass block: half dirt (bottom) and half short grass (top)
            const halfCell = CONFIG.CELL_SIZE / 2;
            
            // Bottom half: dirt
            ctx.fillStyle = `hsl(28, 22%, ${16 + cell.noiseVal * 6}%)`;
            ctx.fillRect(x, y + halfCell, CONFIG.CELL_SIZE, halfCell);
            
            // Top half: short grass (forest green)
            ctx.fillStyle = 'hsl(102, 50%, 34%)';
            ctx.fillRect(x, y, CONFIG.CELL_SIZE, halfCell);
            
            // Draw tiny blades of short grass pointing up
            ctx.strokeStyle = 'hsl(102, 50%, 34%)';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(x + 1, y);
            ctx.lineTo(x + 0.5, y - 1.5);
            ctx.moveTo(x + 3, y);
            ctx.lineTo(x + 3.5, y - 1.2);
            ctx.stroke();
          } else {
            // Render rich textured dirt blocks
            ctx.fillStyle = `hsl(28, 22%, ${16 + cell.noiseVal * 6}%)`;
            ctx.fillRect(x, y, CONFIG.CELL_SIZE, CONFIG.CELL_SIZE);
            
            // Tiny dirt speckles
            if (cell.noiseVal > 0.8) {
              ctx.fillStyle = 'hsl(28, 15%, 28%)';
              ctx.fillRect(x + 2, y + 2, 1.5, 1.5);
            }
          }
        } else if (cell.type === 'Rock') {
          // Render heavy slate rocks
          ctx.fillStyle = `hsl(0, 0%, ${24 + cell.noiseVal * 8}%)`;
          ctx.fillRect(x, y, CONFIG.CELL_SIZE, CONFIG.CELL_SIZE);
          
          // Rock crack detail
          if (cell.noiseVal > 0.7) {
            ctx.strokeStyle = 'hsl(0, 0%, 15%)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y + 2);
            ctx.lineTo(x + CONFIG.CELL_SIZE, y + CONFIG.CELL_SIZE - 2);
            ctx.stroke();
          }
        } else if (cell.type === 'Food') {
          // Skip rendering individual food cells; they are drawn as clustered apples
          continue;
        }
      }
    }

    // Draw fallen apples on the ground
    const fallenApples = this.getFallenApples();
    fallenApples.forEach(apple => {
      // Draw stem
      ctx.strokeStyle = 'hsl(28, 30%, 12%)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(apple.x, apple.y - apple.radius);
      ctx.quadraticCurveTo(apple.x - 3, apple.y - apple.radius - 6, apple.x - 5, apple.y - apple.radius - 7);
      ctx.stroke();

      // Draw leaf
      ctx.fillStyle = 'hsl(102, 50%, 35%)';
      ctx.beginPath();
      ctx.ellipse(apple.x - 5, apple.y - apple.radius - 7, 4.0, 2.0, -Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();

      // Draw red apple body
      ctx.fillStyle = 'hsl(0, 85%, 45%)';
      ctx.beginPath();
      ctx.arc(apple.x, apple.y, apple.radius, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw a tiny shine dot on the apple
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.beginPath();
      ctx.arc(apple.x - apple.radius * 0.3, apple.y - apple.radius * 0.3, apple.radius * 0.2, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw chamber purpose text labels and visible food piles
    const chambersDraw = this.colony.getExcavatedChambers(this.grid);
    
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // Draw Nursery labels (Left chambers)
    chambersDraw.nurseries.forEach((nursery, idx) => {
      ctx.fillStyle = 'hsla(200, 30%, 55%, 0.16)';
      ctx.font = 'bold 8px sans-serif';
      if (idx === 0) {
        ctx.fillText('ROYAL NURSERY', nursery.x, nursery.y - 12);
      } else {
        ctx.fillText(`NURSERY #${idx}`, nursery.x, nursery.y);
      }
    });

    // Draw Food Storage labels & visible growing leaf piles (Right chambers)
    chambersDraw.foodStorages.forEach((storage, idx) => {
      ctx.fillStyle = 'hsla(102, 35%, 55%, 0.16)';
      ctx.font = 'bold 8px sans-serif';
      if (idx === 0) {
        ctx.fillText('ROYAL LARDER', storage.x, storage.y - 12);
      } else {
        ctx.fillText(`LARDER #${idx}`, storage.x, storage.y);
      }

      // Render actual leaf piles proportional to current food stockpile divided across larders
      const share = this.colony.foodStockpile / chambersDraw.foodStorages.length;
      const leafCount = Math.min(25, Math.ceil(share / 3.5)); // scales leaf density with food stock
      
      if (leafCount > 0) {
        ctx.fillStyle = 'hsl(102, 55%, 35%)';
        ctx.strokeStyle = 'hsl(102, 35%, 20%)';
        ctx.lineWidth = 0.5;
        
        for (let i = 0; i < leafCount; i++) {
          // Golden angle phyllotaxis distribution for a neat organic mound shape
          const angle = (i * 2.39996) % (Math.PI * 2);
          const radius = Math.sqrt(i) * 2.0;
          const lx = storage.x + Math.cos(angle) * radius;
          const ly = storage.y + Math.sin(angle) * radius + 4; // slight floor bias
          
          ctx.save();
          ctx.translate(lx, ly);
          ctx.rotate((i * 1.5) % (Math.PI * 2));
          
          // Draw little leaf
          ctx.beginPath();
          ctx.ellipse(0, 0, 2.5, 1.4, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
          
          ctx.restore();
        }
      }
    });
    ctx.restore();

    // Render Foliage (Trees and Grass)
    this.foliageSystem.render(
      ctx,
      this.camera,
      { width: displayWidth, height: displayHeight },
      this.grid,
      this.weather
    );

    // 4. Render Pheromone Trails (glow effect) with Frustum Culling
    if (this.showPheromones) {
      ctx.globalCompositeOperation = 'screen';
      for (let c = startCol; c <= endCol; c++) {
        for (let r = startRow; r <= endRow; r++) {
          const homeVal = this.pheromones.getHomePheromone(c, r);
          const foodVal = this.pheromones.getFoodPheromone(c, r);

          if (homeVal > 0.05 || foodVal > 0.05) {
            const x = c * CONFIG.CELL_SIZE;
            const y = r * CONFIG.CELL_SIZE;

            if (homeVal > 0.05) {
              ctx.fillStyle = `hsla(210, 80%, 55%, ${Math.min(0.22, homeVal * 0.08)})`;
              ctx.fillRect(x, y, CONFIG.CELL_SIZE, CONFIG.CELL_SIZE);
            }
            if (foodVal > 0.05) {
              ctx.fillStyle = `hsla(32, 90%, 55%, ${Math.min(0.28, foodVal * 0.12)})`;
              ctx.fillRect(x, y, CONFIG.CELL_SIZE, CONFIG.CELL_SIZE);
            }
          }
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // 5. Draw Queen
    this.drawQueen(ctx);

    // 6. Draw Brood (Eggs, Larvae, Pupae)
    this.colony.broodList.forEach(brood => {
      this.drawBrood(ctx, brood);
    });

    // 7. Draw Worker Ants
    this.colony.ants.forEach(ant => {
      this.drawAnt(ctx, ant);
    });

    // Draw rain particles and splashes in world viewport coordinates
    this.environment.renderRain(ctx);

    // 8. Draw Ant Labels (independent of Diagnostics Grid)
    if (this.showAntNames) {
      this.drawAntNames(ctx);
    }

    // 9. Debug overlays
    if (this.showDebug) {
      this.drawDebug(ctx);
    }

    ctx.restore();
  }

  private drawAnt(ctx: CanvasRenderingContext2D, ant: Ant) {
    ctx.save();
    ctx.translate(ant.x, ant.y);
    ctx.rotate(ant.angle);

    // Select color based on ant role
    let bodyColor = 'hsl(28, 40%, 12%)'; // Digger: brown amber
    let highlightColor = 'hsl(28, 50%, 25%)';

    if (ant.role === 'Forager') {
      bodyColor = 'hsl(0, 50%, 15%)'; // Forager: dark crimson
      highlightColor = 'hsl(0, 60%, 25%)';
    } else if (ant.role === 'Nurse') {
      bodyColor = 'hsl(200, 35%, 18%)'; // Nurse: dark slate blue
      highlightColor = 'hsl(200, 50%, 32%)';
    }

    // A. Draw Legs (6 legs, wiggle based on legCycle)
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 0.6;
    const legOffset = Math.sin(ant.legCycle) * 1.5;
    
    // Front legs
    ctx.beginPath();
    ctx.moveTo(0, -0.5);
    ctx.lineTo(2, -2.5 - legOffset);
    ctx.moveTo(0, 0.5);
    ctx.lineTo(2, 2.5 + legOffset);
    
    // Middle legs
    ctx.moveTo(-1, -0.5);
    ctx.lineTo(-0.5, -3 + legOffset);
    ctx.moveTo(-1, 0.5);
    ctx.lineTo(-0.5, 3 - legOffset);
    
    // Back legs
    ctx.moveTo(-2, -0.5);
    ctx.lineTo(-3, -3.5 - legOffset);
    ctx.moveTo(-2, 0.5);
    ctx.lineTo(-3, 3.5 + legOffset);
    ctx.stroke();

    // B. Draw Body segments (abdomens, thorax, head)
    const antSize = CONFIG.ANT_SIZE;

    // Abdomen (rear)
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(-2.2, 0, antSize * 0.7, antSize * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    // Thorax (middle)
    ctx.fillStyle = highlightColor;
    ctx.beginPath();
    ctx.ellipse(-0.5, 0, antSize * 0.4, antSize * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head (front)
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(1.2, 0, antSize * 0.45, antSize * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Antennas
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    ctx.moveTo(1.5, -0.5);
    ctx.quadraticCurveTo(3.2, -1.8, 3.5, -0.8);
    ctx.moveTo(1.5, 0.5);
    ctx.quadraticCurveTo(3.2, 1.8, 3.5, 0.8);
    ctx.stroke();

    // C. Draw Cargo
    if (ant.cargo === 'Food') {
      ctx.fillStyle = 'hsl(0, 80%, 48%)'; // red apple chunk
      ctx.beginPath();
      ctx.arc(2.8, 0, 1.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (ant.cargo === 'Dirt') {
      ctx.fillStyle = 'hsl(28, 45%, 28%)'; // dirt clump
      ctx.beginPath();
      ctx.arc(2.8, 0, 1.6, 0, Math.PI * 2);
      ctx.fill();
    } else if (ant.isHoldingBrood && ant.targetBroodId) {
      // Find and render the carried brood clamped in the nurse's mandibles
      const brood = this.colony.broodList.find(b => b.id === ant.targetBroodId);
      if (brood) {
        ctx.save();
        ctx.translate(2.8, 0); // position at mandibles
        ctx.rotate(Math.PI / 4); // angled for holding
        if (brood.type === 'Egg') {
          ctx.fillStyle = 'hsl(0, 0%, 94%)';
          ctx.strokeStyle = 'hsl(0, 0%, 75%)';
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.ellipse(0, 0, 1.5, 0.9, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (brood.type === 'Larva') {
          // Smaller carried representation
          ctx.fillStyle = 'hsl(45, 20%, 92%)';
          ctx.strokeStyle = 'hsl(45, 10%, 75%)';
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.arc(-0.8, 0, 0.9, 0, Math.PI * 2);
          ctx.arc(0, 0, 1.1, 0, Math.PI * 2);
          ctx.arc(0.8, 0, 0.8, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else if (brood.type === 'Pupa') {
          ctx.fillStyle = 'hsl(34, 40%, 75%)';
          ctx.strokeStyle = 'hsl(34, 30%, 55%)';
          ctx.lineWidth = 0.4;
          ctx.beginPath();
          ctx.ellipse(0, 0, 2.2, 1.2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    ctx.restore();
  }

  private drawQueen(ctx: CanvasRenderingContext2D) {
    const q = this.colony.queen;
    ctx.save();
    ctx.translate(q.x, q.y);

    // 1. Draw a subtle warm royal aura behind the Queen (only if showPheromones toggle is active)
    if (this.showPheromones) {
      const auraGlow = ctx.createRadialGradient(-3, 0, 2, -3, 0, 26);
      auraGlow.addColorStop(0, 'hsla(40, 85%, 50%, 0.18)');
      auraGlow.addColorStop(1, 'hsla(40, 85%, 50%, 0)');
      ctx.fillStyle = auraGlow;
      ctx.beginPath();
      ctx.arc(-3, 0, 26, 0, Math.PI * 2);
      ctx.fill();
    }
    
    // Face right/left depending on direction of travel
    const scaleX = 1.2 * (q.direction || 1);
    ctx.scale(scaleX, 1);

    const queenColor = 'hsl(18, 38%, 13%)'; // Rich mahogany/burgundy
    const queenHighlight = 'hsl(38, 70%, 28%)'; // Warm amber-gold
    const legColor = 'hsl(18, 30%, 20%)';

    // Legs (6 thick legs)
    ctx.strokeStyle = legColor;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    // Front
    ctx.moveTo(0, -1); ctx.lineTo(4, -6);
    ctx.moveTo(0, 1);  ctx.lineTo(4, 6);
    // Middle
    ctx.moveTo(-3, -1); ctx.lineTo(-1, -7);
    ctx.moveTo(-3, 1);  ctx.lineTo(-1, 7);
    // Back
    ctx.moveTo(-6, -1); ctx.lineTo(-5, -8);
    ctx.moveTo(-6, 1);  ctx.lineTo(-5, 8);
    ctx.stroke();

    // Segments (Queen is massive!)
    // Huge Abdomen
    ctx.fillStyle = queenColor;
    ctx.beginPath();
    ctx.ellipse(-7, 0, 7.5, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    
    // Golden abdomen rings (adds a highly visible royal pattern)
    ctx.strokeStyle = 'hsl(38, 75%, 48%)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-11, -3.2); ctx.quadraticCurveTo(-12, 0, -11, 3.2);
    ctx.moveTo(-8, -4.3);  ctx.quadraticCurveTo(-9.2, 0, -8, 4.3);
    ctx.moveTo(-5, -4.0);  ctx.quadraticCurveTo(-6.2, 0, -5, 4.0);
    ctx.stroke();
    
    // Thorax
    ctx.fillStyle = queenHighlight;
    ctx.beginPath();
    ctx.ellipse(-1, 0, 4.5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Head
    ctx.fillStyle = queenColor;
    ctx.beginPath();
    ctx.ellipse(3.8, 0, 3.8, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Antennas
    ctx.strokeStyle = legColor;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(4.5, -1); ctx.quadraticCurveTo(8, -4, 9, -2);
    ctx.moveTo(4.5, 1);  ctx.quadraticCurveTo(8, 4, 9, 2);
    ctx.stroke();

    ctx.restore();
  }

  private drawBrood(ctx: CanvasRenderingContext2D, brood: Brood) {
    if (brood.beingCarried) return; // Drawn attached to nurse instead (visually hidden here)

    ctx.save();
    ctx.translate(brood.x, brood.y);

    if (brood.type === 'Egg') {
      // Tiny white oval
      ctx.fillStyle = 'hsl(0, 0%, 94%)';
      ctx.strokeStyle = 'hsl(0, 0%, 75%)';
      ctx.lineWidth = 0.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 1.5, 0.9, Math.PI / 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (brood.type === 'Larva') {
      // White grub segments (scaled by progress to show physical growth)
      const scale = 0.85 + (brood.progress / 100) * 0.7; // grows from 0.85x to 1.55x
      ctx.save();
      ctx.scale(scale, scale);

      ctx.fillStyle = 'hsl(45, 20%, 92%)';
      ctx.strokeStyle = 'hsl(45, 10%, 75%)';
      ctx.lineWidth = 0.5 / scale;
      
      ctx.beginPath();
      ctx.arc(-1.2, 0, 1.2, 0, Math.PI * 2);
      ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
      ctx.arc(1.2, 0, 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      // Hungry indicator (pulsing red dot alert positioned above the larva)
      if (brood.needsFood) {
        const pulse = 1 + Math.sin(Date.now() * 0.005) * 0.15;
        ctx.fillStyle = 'hsl(0, 95%, 60%)';
        ctx.beginPath();
        ctx.arc(0, -4.5 * scale, 0.9 * pulse, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (brood.type === 'Pupa') {
      // Silk tan cocoon
      ctx.fillStyle = 'hsl(34, 40%, 75%)';
      ctx.strokeStyle = 'hsl(34, 30%, 55%)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.ellipse(0, 0, 2.5, 1.4, -Math.PI / 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawDebug(ctx: CanvasRenderingContext2D) {
    // Calculate viewport bounds in world coordinates
    const displayWidth = this.canvas.width / this.dpr;
    const displayHeight = this.canvas.height / this.dpr;
    const halfViewW = (displayWidth / this.camera.zoom) / 2;
    const halfViewH = (displayHeight / this.camera.zoom) / 2;
    
    const minX = this.camera.x - halfViewW;
    const maxX = this.camera.x + halfViewW;
    const minY = this.camera.y - halfViewH;
    const maxY = this.camera.y + halfViewH;

    const startCol = Math.max(0, Math.floor(minX / CONFIG.CELL_SIZE));
    const endCol = Math.min(CONFIG.COLS - 1, Math.ceil(maxX / CONFIG.CELL_SIZE));
    const startRow = Math.max(0, Math.floor(minY / CONFIG.CELL_SIZE));
    const endRow = Math.min(CONFIG.ROWS - 1, Math.ceil(maxY / CONFIG.CELL_SIZE));

    // 1. Draw Grid Overlay Lines
    ctx.save();
    ctx.lineWidth = 0.5;
    
    // Cell grid lines (only visible at close zoom level to avoid noise)
    if (this.camera.zoom > 1.5) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      // Vertical cell lines
      for (let c = startCol; c <= endCol; c++) {
        const x = c * CONFIG.CELL_SIZE;
        ctx.moveTo(x, startRow * CONFIG.CELL_SIZE);
        ctx.lineTo(x, (endRow + 1) * CONFIG.CELL_SIZE);
      }
      // Horizontal cell lines
      for (let r = startRow; r <= endRow; r++) {
        const y = r * CONFIG.CELL_SIZE;
        ctx.moveTo(startCol * CONFIG.CELL_SIZE, y);
        ctx.lineTo((endCol + 1) * CONFIG.CELL_SIZE, y);
      }
      ctx.stroke();
    }

    // 10-cell Major Grid lines (always visible, labeled with column and row numbers)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '6px monospace';
    
    ctx.beginPath();
    // Vertical major lines
    const startColMajor = Math.floor(startCol / 10) * 10;
    for (let c = startColMajor; c <= endCol; c += 10) {
      if (c < 0 || c >= CONFIG.COLS) continue;
      const x = c * CONFIG.CELL_SIZE;
      ctx.moveTo(x, startRow * CONFIG.CELL_SIZE);
      ctx.lineTo(x, (endRow + 1) * CONFIG.CELL_SIZE);
    }
    // Horizontal major lines
    const startRowMajor = Math.floor(startRow / 10) * 10;
    for (let r = startRowMajor; r <= endRow; r += 10) {
      if (r < 0 || r >= CONFIG.ROWS) continue;
      const y = r * CONFIG.CELL_SIZE;
      ctx.moveTo(startCol * CONFIG.CELL_SIZE, y);
      ctx.lineTo((endCol + 1) * CONFIG.CELL_SIZE, y);
    }
    ctx.stroke();

    // Text labels for major grid columns (placed near top of viewport)
    for (let c = startColMajor; c <= endCol; c += 10) {
      if (c < 0 || c >= CONFIG.COLS) continue;
      const x = c * CONFIG.CELL_SIZE;
      const yLabel = minY + 12 / this.camera.zoom;
      ctx.fillText(`C${c}`, x + 2, yLabel);
    }
    // Text labels for major grid rows (placed near left of viewport)
    for (let r = startRowMajor; r <= endRow; r += 10) {
      if (r < 0 || r >= CONFIG.ROWS) continue;
      const y = r * CONFIG.CELL_SIZE;
      const xLabel = minX + 6 / this.camera.zoom;
      ctx.fillText(`R${r}`, xLabel, y - 2);
    }
    ctx.restore();

    // 2. Highlight Nest Entrance Vertical Axis
    const ex = this.grid.nestEntranceCol * CONFIG.CELL_SIZE;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 60, 60, 0.45)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(ex, 0);
    ctx.lineTo(ex, CONFIG.ROWS * CONFIG.CELL_SIZE);
    ctx.stroke();
    
    // Label for Nest Entrance
    ctx.fillStyle = 'rgba(255, 70, 70, 0.8)';
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText('NEST ENTRANCE AXIS', ex + 4, minY + 22 / this.camera.zoom);
    ctx.restore();

    // 3. Highlight Active Excavation Step Bounding Box and Target Cell
    const activeStep = this.colony.getActiveExcavationStep(this.grid);
    const activeTarget = this.colony.getActiveExcavationTarget(this.grid);

    if (activeStep) {
      ctx.save();
      const xPlan = activeStep.minCol * CONFIG.CELL_SIZE;
      const yPlan = activeStep.minRow * CONFIG.CELL_SIZE;
      const wPlan = (activeStep.maxCol - activeStep.minCol + 1) * CONFIG.CELL_SIZE;
      const hPlan = (activeStep.maxRow - activeStep.minRow + 1) * CONFIG.CELL_SIZE;

      // Glow border based on oscillating timer for dynamic feel
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.005);
      ctx.strokeStyle = `rgba(255, 165, 0, ${0.45 + pulse * 0.35})`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(xPlan, yPlan, wPlan, hPlan);

      // Label at top left of box
      ctx.fillStyle = 'rgba(255, 165, 0, 0.9)';
      ctx.font = 'bold 8px sans-serif';
      ctx.fillText(`ACTIVE PROJECT: ${activeStep.name.toUpperCase()}`, xPlan + 4, yPlan - 4);
      
      // Draw target coordinate marker if active target exists
      if (activeTarget) {
        ctx.fillStyle = 'hsl(32, 100%, 55%)';
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.arc(activeTarget.x, activeTarget.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.fillStyle = 'hsl(32, 100%, 65%)';
        ctx.font = 'bold 6px monospace';
        ctx.fillText('TARGET CELL', activeTarget.x + 5, activeTarget.y + 2);
      }
      ctx.restore();
    }

    // (Queen pacing bounds highlight removed)

    // 5. Draw Individual Ant Direction Vectors & Role Indicators
    ctx.save();
    this.colony.ants.forEach(ant => {
      // Frustum culling for ant diagnostics
      if (ant.x < minX || ant.x > maxX || ant.y < minY || ant.y > maxY) return;

      // Draw direction vector line from ant head
      ctx.strokeStyle = 'rgba(0, 255, 0, 0.45)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(ant.x, ant.y);
      ctx.lineTo(ant.x + Math.cos(ant.angle) * 7, ant.y + Math.sin(ant.angle) * 7);
      ctx.stroke();

      // Draw dynamic path indicator line to target for empty diggers
      if (ant.role === 'Digger' && ant.cargo === 'None' && activeTarget) {
        ctx.strokeStyle = 'rgba(255, 165, 0, 0.12)';
        ctx.beginPath();
        ctx.moveTo(ant.x, ant.y);
        ctx.lineTo(activeTarget.x, activeTarget.y);
        ctx.stroke();
      }
    });
    ctx.restore();


  }

  private drawAntNames(ctx: CanvasRenderingContext2D) {
    // Calculate viewport bounds in world coordinates
    const displayWidth = this.canvas.width / this.dpr;
    const displayHeight = this.canvas.height / this.dpr;
    const halfViewW = (displayWidth / this.camera.zoom) / 2;
    const halfViewH = (displayHeight / this.camera.zoom) / 2;
    
    const minX = this.camera.x - halfViewW;
    const maxX = this.camera.x + halfViewW;
    const minY = this.camera.y - halfViewH;
    const maxY = this.camera.y + halfViewH;

    ctx.save();
    this.colony.ants.forEach(ant => {
      // Frustum culling for ant names
      if (ant.x < minX || ant.x > maxX || ant.y < minY || ant.y > maxY) return;

      // Text role and cargo state details near ant
      let cargoText = '';
      if (ant.cargo === 'Food') cargoText = ' [Food]';
      else if (ant.cargo === 'Dirt') cargoText = ' [Dirt]';
      else if (ant.isHoldingBrood) cargoText = ' [Brood]';

      ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
      ctx.font = '6px sans-serif';
      ctx.fillText(`${ant.role} ${ant.num}${cargoText} (G${ant.generation}, F:${ant.getFitness().toFixed(1)})`, ant.x - 15, ant.y - 6);
    });
    ctx.restore();
  }


  public initializeFoliage() {
    this.foliageSystem.initialize(this.grid);
  }

  private getFallenApples(): { x: number; y: number; radius: number }[] {
    const visited = new Set<string>();
    const apples: { x: number; y: number; radius: number }[] = [];

    for (let c = 0; c < CONFIG.COLS; c++) {
      for (let r = 0; r < CONFIG.ROWS; r++) {
        const cell = this.grid.cells[c][r];
        if (cell.type === 'Food' && !visited.has(`${c},${r}`)) {
          let sumC = 0;
          let sumR = 0;
          let count = 0;
          const queue: [number, number][] = [[c, r]];
          visited.add(`${c},${r}`);

          while (queue.length > 0) {
            const [currC, currR] = queue.shift()!;
            sumC += currC;
            sumR += currR;
            count++;

            const neighbors = [
              [currC - 1, currR],
              [currC + 1, currR],
              [currC, currR - 1],
              [currC, currR + 1]
            ];
            for (const [nc, nr] of neighbors) {
              if (this.grid.isValid(nc, nr) && this.grid.cells[nc][nr].type === 'Food') {
                const key = `${nc},${nr}`;
                if (!visited.has(key)) {
                  visited.add(key);
                  queue.push([nc, nr]);
                }
              }
            }
          }

          const avgC = sumC / count;
          const radius = Math.min(12, 3 + Math.sqrt(count) * 2.2);

          // Find the actual ground height at the average column index
          const colIndex = Math.max(0, Math.min(CONFIG.COLS - 1, Math.round(avgC)));
          const groundY = this.grid.getSurfaceRow(colIndex) * CONFIG.CELL_SIZE;

          apples.push({
            x: avgC * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2,
            y: groundY - radius,
            radius
          });
        }
      }
    }
    return apples;
  }

  public triggerFruitDrop() {
    this.foliageSystem.triggerFruitDrop(this.grid, (msg, cat) => this.colony.addLog(msg, cat));
  }
}
