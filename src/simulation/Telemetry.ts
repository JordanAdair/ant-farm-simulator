import type { TelemetryPoint, ColonyStats } from './types';
import { Ant } from './Ant';

export class TelemetryTracker {
  private history: TelemetryPoint[] = [];

  constructor(initialHistory: TelemetryPoint[] = []) {
    this.history = initialHistory;
  }

  public record(stats: ColonyStats, ants: Ant[], totalDirtDugGlobal: number) {
    let totalFitness = 0;
    let maxFit = 0;
    const antCount = ants.length;

    ants.forEach(a => {
      const f = a.getFitness();
      totalFitness += f;
      if (f > maxFit) maxFit = f;
    });

    const avgFit = antCount > 0 ? totalFitness / antCount : 0;
    const lastPoint = this.history[this.history.length - 1];
    const nextTime = lastPoint ? lastPoint.time + 3 : 0;

    this.history.push({
      time: nextTime,
      totalAnts: stats.workerCount,
      foragers: stats.foragerCount,
      diggers: stats.diggerCount,
      nurses: stats.nurseCount,
      food: stats.foodStockpile,
      volume: Math.floor(stats.nestVolume * 0.25),
      dirtDug: totalDirtDugGlobal,
      eggCount: stats.eggCount,
      larvaCount: stats.larvaCount,
      pupaCount: stats.pupaCount,
      avgFitness: parseFloat(avgFit.toFixed(2)),
      maxFitness: parseFloat(maxFit.toFixed(2)),
    });

    // Keep last 200 data points (10 minutes history)
    if (this.history.length > 200) {
      this.history.shift();
    }
  }

  public getHistory(): TelemetryPoint[] {
    return this.history;
  }

  public setHistory(history: TelemetryPoint[]) {
    this.history = history;
  }
}
