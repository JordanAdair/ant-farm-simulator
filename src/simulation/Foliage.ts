import { CONFIG } from './types';
import { WorldGrid } from './Grid';

export interface Fruit {
  id: string;
  relX: number;
  relY: number;
  growth: number; // 0 to 100
  isFalling: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface Tree {
  col: number;
  fruits: Fruit[];
}

export interface GrassBlade {
  col: number;
  height: number;
  swayOffset: number;
  width: number;
}

export class FoliageSystem {
  public trees: Tree[] = [];
  public grassBlades: GrassBlade[] = [];
  private frameCount: number = 0;

  public getRandomCanopyPos(): { relX: number; relY: number } {
    for (let attempt = 0; attempt < 100; attempt++) {
      const relX = -120 + Math.random() * 240;
      const relY = -370 + Math.random() * 200;
      
      // Enforce being off the trunk's vertical axis (which is relX = 0)
      if (Math.abs(relX) < 15) continue;

      // Canopy layers relative to trunk center (0, -270)
      const circles = [
        { cx: -60, cy: -250, r: 80 },
        { cx: 60, cy: -250, r: 80 },
        { cx: -30, cy: -300, r: 95 },
        { cx: 30, cy: -300, r: 95 },
        { cx: 0, cy: -330, r: 90 },
        { cx: 0, cy: -270, r: 100 }
      ];
      for (const c of circles) {
        const dx = relX - c.cx;
        const dy = relY - c.cy;
        // Sample slightly inside the boundary (85%)
        if (dx * dx + dy * dy <= (c.r * 0.85) ** 2) {
          return { relX, relY };
        }
      }
    }
    // Fallback if loop runs out (should not happen)
    return { relX: Math.random() < 0.5 ? -40 : 40, relY: -270 };
  }

  public initialize(grid: WorldGrid) {
    const treeCols = [
      grid.nestEntranceCol - 135, // Far-mid left
      grid.nestEntranceCol + 45,  // Mid-right
      grid.nestEntranceCol + 140  // Far right
    ];

    this.trees = treeCols.map(col => {
      const pos = this.getRandomCanopyPos();
      return {
        col,
        fruits: [
          // Single sparse apple per tree hanging from the randomized canopy position
          { id: `${col}-0`, relX: pos.relX, relY: pos.relY, growth: Math.random() * 45, isFalling: false, x: 0, y: 0, vx: 0, vy: 0 }
        ]
      };
    });

    // Clear any pre-existing food cells around the trunk bases to fix old save-state artifacts
    treeCols.forEach(col => {
      for (let c = col - 5; c <= col + 5; c++) {
        for (let r = 0; r < CONFIG.ROWS; r++) {
          grid.clearSurfaceFoodCell(c, r);
        }
      }
    });

    this.grassBlades = [];
    const numClusters = 8;
    for (let c = 0; c < numClusters; c++) {
      // Pick a random center column on the far ends (left for c < 4, right for c >= 4)
      const centerCol = c < 4 
        ? Math.floor(15 + Math.random() * 65) // columns 15 to 80
        : Math.floor(320 + Math.random() * 65); // columns 320 to 385

      // Spawn 8 to 12 blades per cluster
      const numBlades = 8 + Math.floor(Math.random() * 5);
      for (let b = 0; b < numBlades; b++) {
        const offset = Math.floor((Math.random() - 0.5) * 16); // spread within 8 columns left/right
        const col = Math.max(0, Math.min(CONFIG.COLS - 1, centerCol + offset));
        const height = 10 + Math.random() * 14; // tall grass
        const width = 1.0 + Math.random() * 1.2;
        const swayOffset = Math.random() * Math.PI * 2;
        this.grassBlades.push({ col, height, width, swayOffset });
      }
    }
  }

  public update(
    dt: number,
    grid: WorldGrid,
    _weather: 'Sunny' | 'Rainy',
    addLog: (msg: string, cat: 'system' | 'births' | 'deaths') => void
  ) {
    // 1. Spawn surface food periodically via fruit drops
    this.frameCount += dt;
    if (this.frameCount >= CONFIG.FOOD_SPAWN_INTERVAL * 60) {
      this.triggerFruitDrop(grid, addLog);
      this.frameCount = 0;
    }

    // 2. Progress fruit growth & update falling physics
    this.trees.forEach(tree => {
      tree.fruits.forEach(fruit => {
        if (fruit.isFalling) {
          fruit.vy += 0.15 * dt; // gravity
          fruit.x += fruit.vx * dt;
          fruit.y += fruit.vy * dt;

          const col = Math.floor(fruit.x / CONFIG.CELL_SIZE);
          const row = Math.floor(fruit.y / CONFIG.CELL_SIZE);

          let collided = false;
          if (grid.isValid(col, row)) {
            const cell = grid.cells[col][row];
            if (cell.type === 'Dirt' || cell.type === 'Rock') {
              collided = true;
            }
          } else if (row >= CONFIG.ROWS) {
            collided = true;
          }

          if (collided) {
            const foodCol = Math.max(0, Math.min(CONFIG.COLS - 1, col));
            const surfaceR = grid.getSurfaceRow(foodCol);
            
            grid.spawnFoodAt(foodCol, surfaceR - 1, 350);
            addLog('A massive fallen apple bursts open on the ground, providing a huge stockpile of food.', 'system');
            
            // Reset fruit
            fruit.isFalling = false;
            fruit.growth = 0;
            fruit.vy = 0;
            fruit.vx = 0;
            
            // Randomize position again for the next growth cycle
            const pos = this.getRandomCanopyPos();
            fruit.relX = pos.relX;
            fruit.relY = pos.relY;
          }
        } else {
          // Grow hanging fruit
          if (fruit.growth < 100) {
            fruit.growth = Math.min(100, fruit.growth + 0.001 * dt);
          }
        }
      });
    });
  }

  public triggerFruitDrop(
    grid: WorldGrid,
    addLog: (msg: string, cat: 'system' | 'births' | 'deaths') => void
  ) {
    const candidates: { tree: Tree; fruit: Fruit }[] = [];
    for (const tree of this.trees) {
      for (const fruit of tree.fruits) {
        if (!fruit.isFalling) {
          candidates.push({ tree, fruit });
        }
      }
    }

    if (candidates.length === 0) return;

    candidates.sort((a, b) => b.fruit.growth - a.fruit.growth);
    const target = candidates[0];

    const treeX = target.tree.col * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
    const treeY = grid.getSurfaceRow(target.tree.col) * CONFIG.CELL_SIZE;

    target.fruit.isFalling = true;
    target.fruit.x = treeX + target.fruit.relX;
    target.fruit.y = treeY + target.fruit.relY;
    target.fruit.vy = 0;
    target.fruit.vx = (Math.random() - 0.5) * 0.4;

    addLog('A ripe fruit detaches from the tree and falls!', 'system');
  }

  public render(
    ctx: CanvasRenderingContext2D,
    camera: { x: number; y: number; zoom: number },
    viewport: { width: number; height: number },
    grid: WorldGrid,
    weather: 'Sunny' | 'Rainy'
  ) {
    ctx.save();
    
    // Wind factor based on time and weather
    const windTime = Date.now() * 0.0035;
    const baseWind = weather === 'Rainy' ? -0.45 : 0.05;
    const windAmplitude = weather === 'Rainy' ? 0.35 : 0.12;
    const sway = baseWind + Math.sin(windTime) * windAmplitude;

    // Viewport Frustum Culling bounds
    const halfViewW = (viewport.width / camera.zoom) / 2;
    const halfViewH = (viewport.height / camera.zoom) / 2;
    
    const minX = camera.x - halfViewW;
    const maxX = camera.x + halfViewW;
    const minY = camera.y - halfViewH;
    const maxY = camera.y + halfViewH;

    // 1. Draw Grass Blades
    this.grassBlades.forEach(blade => {
      const startX = blade.col * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
      const startY = grid.getSurfaceRow(blade.col) * CONFIG.CELL_SIZE;

      // Frustum culling
      if (startX >= minX - 10 && startX <= maxX + 10 && startY >= minY - 15 && startY <= maxY + 15) {
        const controlX = startX + sway * blade.height * 0.5;
        const controlY = startY - blade.height * 0.5;
        const endX = startX + sway * blade.height;
        const endY = startY - blade.height;

        ctx.strokeStyle = weather === 'Rainy' ? 'hsl(102, 38%, 20%)' : 'hsl(102, 45%, 30%)';
        ctx.lineWidth = blade.width;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(controlX, controlY, endX, endY);
        ctx.stroke();
      }
    });

    // 2. Draw Trees
    this.trees.forEach(tree => {
      const startX = tree.col * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
      const startY = grid.getSurfaceRow(tree.col) * CONFIG.CELL_SIZE;

      // Frustum culling (massive trees need wider boundaries)
      if (startX >= minX - 180 && startX <= maxX + 180 && startY >= minY - 400 && startY <= maxY + 100) {
        // Draw massive trunk (thick and tall)
        ctx.fillStyle = 'hsl(28, 35%, 15%)'; // dark wood brown
        ctx.fillRect(startX - 16, startY - 260, 32, 260);

        // Draw massive branches
        ctx.strokeStyle = 'hsl(28, 35%, 15%)';
        ctx.lineWidth = 8.0;
        ctx.beginPath();
        ctx.moveTo(startX, startY - 140);
        ctx.lineTo(startX - 60, startY - 190);
        ctx.stroke();

        ctx.lineWidth = 6.0;
        ctx.beginPath();
        ctx.moveTo(startX, startY - 180);
        ctx.lineTo(startX + 60, startY - 230);
        ctx.stroke();

        // Draw fluffy layered canopy (reacting slightly to wind sway, centered at y = -270)
        const canopySway = sway * 5;
        const cx = startX + canopySway;
        const cy = startY - 270;

        // Layer 1 (Dark forest green)
        ctx.fillStyle = 'hsl(120, 32%, 14%)';
        ctx.beginPath();
        ctx.arc(cx - 60, cy + 20, 80, 0, Math.PI * 2);
        ctx.arc(cx + 60, cy + 20, 80, 0, Math.PI * 2);
        ctx.fill();

        // Layer 2 (Medium forest green)
        ctx.fillStyle = 'hsl(120, 35%, 18%)';
        ctx.beginPath();
        ctx.arc(cx - 30, cy - 30, 95, 0, Math.PI * 2);
        ctx.arc(cx + 30, cy - 30, 95, 0, Math.PI * 2);
        ctx.fill();

        // Layer 3 (Bright forest green highlight)
        ctx.fillStyle = 'hsl(120, 38%, 22%)';
        ctx.beginPath();
        ctx.arc(cx, cy - 60, 90, 0, Math.PI * 2);
        ctx.arc(cx, cy, 100, 0, Math.PI * 2);
        ctx.fill();

        // Draw hanging fruits (true to size, massive apples)
        tree.fruits.forEach(fruit => {
          if (!fruit.isFalling) {
            const fx = startX + fruit.relX + canopySway;
            const fy = startY + fruit.relY;
            const radius = 16.5 * (fruit.growth / 100);

            if (radius > 1.0) {
              // Draw stem
              ctx.strokeStyle = 'hsl(28, 30%, 12%)';
              ctx.lineWidth = 2.0;
              ctx.beginPath();
              ctx.moveTo(fx, fy - radius);
              ctx.quadraticCurveTo(fx - 4, fy - radius - 8, fx - 8, fy - radius - 10);
              ctx.stroke();

              // Draw green leaf on apple
              ctx.fillStyle = 'hsl(102, 50%, 35%)';
              ctx.beginPath();
              ctx.ellipse(fx - 8, fy - radius - 10, 6.0, 3.0, -Math.PI / 4, 0, Math.PI * 2);
              ctx.fill();

              // Draw red fruit
              ctx.fillStyle = `hsl(0, 80%, ${34 + (fruit.growth / 100) * 12}%)`;
              ctx.beginPath();
              ctx.arc(fx, fy, radius, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        });
      }
    });

    // 3. Draw Falling Fruits
    this.trees.forEach(tree => {
      tree.fruits.forEach(fruit => {
        if (fruit.isFalling) {
          if (fruit.x >= minX - 30 && fruit.x <= maxX + 30 && fruit.y >= minY - 30 && fruit.y <= maxY + 30) {
            const radius = 16.5;
            // Draw stem
            ctx.strokeStyle = 'hsl(28, 30%, 12%)';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(fruit.x, fruit.y - radius);
            ctx.quadraticCurveTo(fruit.x - 4, fruit.y - radius - 8, fruit.x - 8, fruit.y - radius - 10);
            ctx.stroke();

            // Draw leaf
            ctx.fillStyle = 'hsl(102, 50%, 35%)';
            ctx.beginPath();
            ctx.ellipse(fruit.x - 8, fruit.y - radius - 10, 6.0, 3.0, -Math.PI / 4, 0, Math.PI * 2);
            ctx.fill();

            // Draw apple
            ctx.fillStyle = 'hsl(0, 85%, 45%)';
            ctx.beginPath();
            ctx.arc(fruit.x, fruit.y, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      });
    });

    ctx.restore();
  }
}
