import { CONFIG } from './types';
import type { WorldGrid } from './Grid';

export interface WeatherForecast {
  type: 'Sunny' | 'Rainy';
  durationHours: number;
  delayHours: number;
}

export class Environment {
  public dayCount: number = 1;
  public hour: number = 8;
  public minute: number = 0;
  public minuteFraction: number = 0;

  public weather: 'Sunny' | 'Rainy' = 'Sunny';
  public weatherTimer: number = 0;
  public weatherTargetDuration: number = 9000;
  public weatherQueue: { type: 'Sunny' | 'Rainy'; durationFrames: number }[] = [];
  public rainParticles: { x: number; y: number; vx: number; vy: number; len: number }[] = [];
  public splashParticles: { x: number; y: number; vx: number; vy: number; life: number }[] = [];
  public starPositions: { x: number; y: number; size: number }[] = [];

  constructor() {
    const worldWidth = CONFIG.COLS * CONFIG.CELL_SIZE;
    const skyHeightPx = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
    for (let i = 0; i < 90; i++) {
      this.starPositions.push({
        x: Math.random() * worldWidth,
        y: Math.random() * (skyHeightPx - 6),
        size: 0.5 + Math.random() * 1.2,
      });
    }
    this.refillWeatherQueue();
  }

  public refillWeatherQueue() {
    while (this.weatherQueue.length < 5) {
      const type = Math.random() < 0.35 ? 'Rainy' : 'Sunny';
      const hours = type === 'Sunny' ? (4 + Math.random() * 4) : (2 + Math.random() * 2);
      this.weatherQueue.push({
        type,
        durationFrames: Math.round(hours * 900),
      });
    }
  }

  public advanceWeather(addLog: (msg: string, cat: 'system') => void) {
    this.refillWeatherQueue();
    const next = this.weatherQueue.shift()!;
    this.weather = next.type;
    this.weatherTargetDuration = next.durationFrames;
    this.weatherTimer = 0;
    this.rainParticles = [];
    this.splashParticles = [];
    if (this.weather === 'Sunny') {
      addLog('The rain stops and the weather clears up to SUNNY.', 'system');
    } else {
      addLog('Storm clouds darken the sky. It begins to RAIN.', 'system');
    }
  }

  public setWeather(newWeather: 'Sunny' | 'Rainy', addLog: (msg: string, cat: 'system') => void) {
    if (this.weather === newWeather) return;
    this.weather = newWeather;
    this.weatherTimer = 0;
    this.rainParticles = [];
    this.splashParticles = [];
    if (newWeather === 'Sunny') {
      this.weatherTargetDuration = Math.round((4 + Math.random() * 4) * 900);
      addLog('The weather clears up and is now SUNNY.', 'system');
    } else {
      this.weatherTargetDuration = Math.round((2 + Math.random() * 2) * 900);
      addLog('Rain clouds roll in. It is now RAINY.', 'system');
    }
  }

  public getHumidity(): number {
    if (this.weather === 'Rainy') {
      const pct = Math.min(1.0, this.weatherTimer / this.weatherTargetDuration);
      return Math.round(85 + pct * 13);
    } else {
      const pct = this.weatherTimer / this.weatherTargetDuration;
      if (pct > 0.8) {
        const stormPct = (pct - 0.8) / 0.2;
        return Math.round(50 + stormPct * 35);
      }
      const dailyCycle = Math.sin((this.hour + this.minute / 60) / 24 * Math.PI * 2);
      return Math.round(45 + dailyCycle * 10);
    }
  }

  public getPressure(): number {
    if (this.weather === 'Rainy') {
      const pct = Math.min(1.0, this.weatherTimer / this.weatherTargetDuration);
      return Math.round(1002 - pct * 8);
    } else {
      const pct = this.weatherTimer / this.weatherTargetDuration;
      if (pct > 0.8) {
        const stormPct = (pct - 0.8) / 0.2;
        return Math.round(1012 - stormPct * 10);
      }
      const dailyCycle = Math.cos((this.hour + this.minute / 60) / 24 * Math.PI * 2);
      return Math.round(1014 + dailyCycle * 3);
    }
  }

  public getSkyLight(): number {
    const time = this.hour + this.minute / 60;
    if (time >= 4 && time < 8) {
      const pct = (time - 4) / 4;
      return 0.08 + pct * 0.92;
    } else if (time >= 8 && time < 17) {
      return 1.0;
    } else if (time >= 17 && time < 21) {
      const pct = (time - 17) / 4;
      return 1.0 - pct * 0.92;
    } else {
      return 0.08;
    }
  }

  public getRainDimFactor(): number {
    if (this.weather === 'Sunny') {
      return 1.0;
    }
    const rainUpdates = this.weatherTimer;
    const transitionPeriod = 900;
    if (rainUpdates < transitionPeriod) {
      const pct = rainUpdates / transitionPeriod;
      return 1.0 - pct * 0.55;
    }
    return 0.45;
  }

  public getWeatherForecast(): WeatherForecast[] {
    this.refillWeatherQueue();
    const forecast: WeatherForecast[] = [];
    
    const currentRemainingFrames = Math.max(0, this.weatherTargetDuration - this.weatherTimer);
    forecast.push({
      type: this.weather,
      durationHours: Number((currentRemainingFrames / 900).toFixed(1)),
      delayHours: 0
    });

    let cumulativeDelay = currentRemainingFrames;
    for (let i = 0; i < 3; i++) {
      const item = this.weatherQueue[i];
      forecast.push({
        type: item.type,
        durationHours: Number((item.durationFrames / 900).toFixed(1)),
        delayHours: Number((cumulativeDelay / 900).toFixed(1))
      });
      cumulativeDelay += item.durationFrames;
    }

    return forecast;
  }

  public update(
    mult: number,
    grid: WorldGrid,
    camera: { x: number; y: number; zoom: number },
    canvasWidth: number,
    canvasHeight: number,
    dpr: number,
    addLog: (msg: string, cat: 'system') => void = () => {}
  ) {
    if (mult === 0) return;

    // Clock updates
    this.minuteFraction += mult;
    if (this.minuteFraction >= 15) {
      const minutesPassed = Math.floor(this.minuteFraction / 15);
      this.minuteFraction = this.minuteFraction % 15;
      this.minute += minutesPassed;
      if (this.minute >= 60) {
        const hoursPassed = Math.floor(this.minute / 60);
        this.minute = this.minute % 60;
        this.hour += hoursPassed;
        if (this.hour >= 24) {
          const daysPassed = Math.floor(this.hour / 24);
          this.hour = this.hour % 24;
          this.dayCount += daysPassed;
          addLog(`Day ${this.dayCount} has begun.`, 'system');
        }
      }
    }

    // Weather updates
    this.weatherTimer += mult;
    if (this.weather === 'Rainy') {
      // Rain erosion physics
      if (grid && Math.random() < 0.08 * mult) {
        grid.erodeMounds();
      }
      // Rain entrance water spawning (rebalanced trickle, no surface pooling)
      if (grid && Math.random() < 0.02 * mult) {
        const col = grid.nestEntranceCol - 2 + Math.floor(Math.random() * 4);
        const cell = grid.getCell(col, CONFIG.SKY_HEIGHT);
        if (cell && (cell.type === 'NestAir' || cell.type === 'Sky')) {
          cell.type = 'Water';
        }
      }
    } else if (this.weather === 'Sunny') {
      // Sunny water evaporation from top down
      if (grid && Math.random() < 0.35 * mult) {
        const rate = CONFIG.WATER_EVAPORATION_RATE || 2;
        for (let i = 0; i < rate; i++) {
          const col = Math.floor(Math.random() * grid.cols);
          for (let r = 0; r < grid.rows; r++) {
            const cell = grid.getCell(col, r);
            if (cell && cell.type === 'Water') {
              grid.setCellType(col, r, r < CONFIG.SKY_HEIGHT ? 'Sky' : 'NestAir');
              break;
            }
          }
        }
      }
    }

    if (this.weatherTimer >= this.weatherTargetDuration) {
      this.advanceWeather(addLog);
    }

    // Update particles if grid is provided
    if (grid) {
      const worldWidth = CONFIG.COLS * CONFIG.CELL_SIZE;
      if (this.weather === 'Rainy') {
        if (this.rainParticles.length === 0) {
          for (let i = 0; i < 200; i++) {
            this.rainParticles.push({
              x: Math.random() * worldWidth,
              y: Math.random() * (CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE),
              vy: 6 + Math.random() * 4,
              vx: -1.2 - Math.random() * 1.5,
              len: 8 + Math.random() * 8,
            });
          }
        }

        const halfViewW = (canvasWidth / dpr / camera.zoom) / 2;
        const halfViewH = (canvasHeight / dpr / camera.zoom) / 2;
        const minX = camera.x - halfViewW;
        const maxX = camera.x + halfViewW;
        const minY = camera.y - halfViewH;
        const maxY = camera.y + halfViewH;

        this.rainParticles.forEach(p => {
          p.x += p.vx * mult;
          p.y += p.vy * mult;

          const col = Math.floor(p.x / CONFIG.CELL_SIZE);
          let surfaceY = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
          if (col >= 0 && col < CONFIG.COLS) {
            for (let r = 0; r < CONFIG.ROWS; r++) {
              if (grid.cells[col][r].type === 'Dirt' || grid.cells[col][r].type === 'Rock') {
                surfaceY = r * CONFIG.CELL_SIZE;
                break;
              }
            }
          }

          if (p.y >= surfaceY || p.x < 0) {
            if (p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY && this.splashParticles.length < 300) {
              for (let s = 0; s < 2; s++) {
                this.splashParticles.push({
                  x: p.x,
                  y: surfaceY,
                  vx: (Math.random() - 0.5) * 2,
                  vy: -Math.random() * 1.5 - 1.0,
                  life: 1.0
                });
              }
            }
            p.x = Math.random() * (worldWidth + 100);
            p.y = 0;
            p.vy = 6 + Math.random() * 4;
            p.vx = -1.2 - Math.random() * 1.5;
            p.len = 8 + Math.random() * 8;
          }
        });
      }

      // Update splash particles
      for (let i = this.splashParticles.length - 1; i >= 0; i--) {
        const sp = this.splashParticles[i];
        sp.x += sp.vx * mult;
        sp.y += sp.vy * mult;
        sp.vy += 0.15 * mult;
        sp.life -= 0.1 * mult;
        if (sp.life <= 0) {
          this.splashParticles.splice(i, 1);
        }
      }
    }
  }

  public renderSky(ctx: CanvasRenderingContext2D, _minX: number, _maxX: number, _minY: number, _maxY: number) {
    const worldWidth = CONFIG.COLS * CONFIG.CELL_SIZE;
    const skyHeightPx = CONFIG.SKY_HEIGHT * CONFIG.CELL_SIZE;
    const skyGradient = ctx.createLinearGradient(0, 0, 0, skyHeightPx);
    
    const light = this.getSkyLight() * this.getRainDimFactor();
    const hue = Math.round(240 - (240 - 205) * light);
    const satTop = Math.round(this.weather === 'Rainy' ? (10 + 5 * light) : (25 + 30 * light));
    const satBot = Math.round(this.weather === 'Rainy' ? (8 + 4 * light) : (20 + 25 * light));
    const lgtTop = Math.max(3, Math.round((this.weather === 'Rainy' ? 22 : 35) * light));
    const lgtBot = Math.max(1.5, Math.round((this.weather === 'Rainy' ? 10 : 15) * light));

    skyGradient.addColorStop(0, `hsl(${hue}, ${satTop}%, ${lgtTop}%)`);
    skyGradient.addColorStop(1, `hsl(${hue}, ${satBot}%, ${lgtBot}%)`);
    
    ctx.fillStyle = skyGradient;
    ctx.fillRect(-1000, 0, worldWidth + 2000, skyHeightPx);

    // Render stars
    if (light < 0.4) {
      ctx.save();
      const starOpacity = (0.4 - light) / 0.4;
      ctx.fillStyle = `rgba(255, 255, 255, ${starOpacity * 0.85})`;
      for (const star of this.starPositions) {
        ctx.fillRect(star.x, star.y, star.size, star.size);
      }
      ctx.restore();
    }
  }

  public renderRain(ctx: CanvasRenderingContext2D) {
    if (this.weather === 'Rainy') {
      ctx.strokeStyle = 'rgba(156, 180, 215, 0.35)';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      this.rainParticles.forEach(p => {
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.vx * 0.7, p.y + p.len);
      });
      ctx.stroke();

      if (this.splashParticles.length > 0) {
        ctx.fillStyle = 'rgba(156, 180, 215, 0.55)';
        this.splashParticles.forEach(sp => {
          ctx.fillRect(sp.x, sp.y, 1.2, 1.2);
        });
      }
    }
  }
}
