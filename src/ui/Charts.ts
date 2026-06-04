import type { TelemetryPoint } from '../simulation/types';

export class ColonyCharts {
  // Renders a multi-line chart with filled area gradients on a canvas
  public static renderLineChart(
    canvas: HTMLCanvasElement,
    history: TelemetryPoint[],
    metricKeys: { key: keyof TelemetryPoint; label: string; color: string }[],
    title: string
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Padding inside chart area
    const padding = { top: 35, right: 20, bottom: 25, left: 35 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Draw Title
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '600 12px sans-serif';
    ctx.fillText(title, padding.left, 20);

    // Draw Legend
    let legendX = w - padding.right;
    ctx.font = '500 10px sans-serif';
    metricKeys.forEach(m => {
      ctx.fillStyle = m.color;
      const textWidth = ctx.measureText(m.label).width;
      legendX -= (textWidth + 15);
      
      // Draw small circle
      ctx.beginPath();
      ctx.arc(legendX, 16, 3.5, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw label text
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.fillText(m.label, legendX + 7, 19);
    });

    if (history.length < 2) {
      // Draw empty placeholder text if not enough data points
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = '500 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Gathering telemetry data...', w / 2, h / 2);
      ctx.restore();
      return;
    }

    // Determine min/max values for Y scaling
    let maxVal = 0.1;
    history.forEach(pt => {
      metricKeys.forEach(m => {
        const val = pt[m.key] as number;
        if (val > maxVal) maxVal = val;
      });
    });
    // Add 15% head room on Y-axis
    maxVal *= 1.15;

    // Helper functions to convert data coordinates to canvas pixel space
    const getX = (index: number) => padding.left + (index / (history.length - 1)) * chartW;
    const getY = (value: number) => padding.top + chartH - (value / maxVal) * chartH;

    // 1. Draw Grid Lines & Y Axis Labels
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '400 9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const gridLines = 4;
    for (let i = 0; i <= gridLines; i++) {
      const ratio = i / gridLines;
      const y = padding.top + ratio * chartH;
      const val = Math.floor(maxVal * (1 - ratio));

      // Horizontal grid line
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      // Y Label
      ctx.fillText(val.toString(), padding.left - 6, y);
    }

    // 2. Draw X Axis Labels (Intervals of time)
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xLabelsCount = 4;
    const step = Math.floor((history.length - 1) / (xLabelsCount - 1)) || 1;
    for (let i = 0; i < history.length; i += step) {
      if (i > history.length - 1) break;
      const x = getX(i);
      const seconds = history[i].time;
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      const timeStr = `${m}:${s < 10 ? '0' : ''}${s}`;
      
      ctx.fillText(timeStr, x, padding.top + chartH + 6);
    }

    // 3. Render Metric Lines & filled area gradients
    metricKeys.forEach(m => {
      // A. Draw Area Gradient
      ctx.beginPath();
      ctx.moveTo(getX(0), getY(0));
      for (let i = 0; i < history.length; i++) {
        ctx.lineTo(getX(i), getY(history[i][m.key] as number));
      }
      ctx.lineTo(getX(history.length - 1), getY(0));
      ctx.closePath();

      const areaGrad = ctx.createLinearGradient(0, padding.top, 0, padding.top + chartH);
      // Soft color fill fading to transparent at bottom
      const hexColor = m.color;
      const hslMatch = hexColor.match(/hsl\(([^,]+),\s*([^,]+),\s*([^)]+)\)/);
      let fillStyle = 'rgba(255, 255, 255, 0.05)';
      if (hslMatch) {
        fillStyle = `hsla(${hslMatch[1]}, ${hslMatch[2]}, ${hslMatch[3]}, 0.08)`;
      }
      
      areaGrad.addColorStop(0, fillStyle);
      areaGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = areaGrad;
      ctx.fill();

      // B. Draw Line path
      ctx.beginPath();
      for (let i = 0; i < history.length; i++) {
        const x = getX(i);
        const y = getY(history[i][m.key] as number);
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.strokeStyle = m.color;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    });

    ctx.restore();
  }

  // Renders a bar chart showing distribution of ant generations
  public static renderBarChart(
    canvas: HTMLCanvasElement,
    genMap: Map<number, number>,
    title: string
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Margin and Padding inside chart
    const padding = { top: 35, right: 20, bottom: 25, left: 35 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Draw Title
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '600 12px sans-serif';
    ctx.fillText(title, padding.left, 20);

    const gens = Array.from(genMap.keys()).sort((a, b) => a - b);
    if (gens.length === 0) {
      // Draw empty placeholder text
      ctx.fillStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.font = '500 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Gathering population records...', w / 2, h / 2);
      ctx.restore();
      return;
    }

    // Determine max value for Y scaling
    let maxVal = 0;
    genMap.forEach(count => {
      if (count > maxVal) maxVal = count;
    });
    maxVal = Math.max(1, Math.ceil(maxVal * 1.15)); // add headroom

    // Draw Y Axis Labels
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '400 9px monospace';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    const yLines = 4;
    for (let i = 0; i <= yLines; i++) {
      const ratio = i / yLines;
      const y = padding.top + ratio * chartH;
      const val = Math.floor(maxVal * (1 - ratio));

      // Horizontal grid line
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();

      // Y Label
      ctx.fillText(val.toString(), padding.left - 6, y);
    }

    // Draw Bars
    const barSpacingRatio = 0.35; // portion of space between bars
    const totalBars = gens.length;
    const outerBarWidth = chartW / totalBars;
    const barWidth = outerBarWidth * (1 - barSpacingRatio);

    ctx.textAlign = 'center';
    
    gens.forEach((gen, index) => {
      const count = genMap.get(gen) || 0;
      const xLeft = padding.left + index * outerBarWidth + (outerBarWidth * barSpacingRatio) / 2;
      const barH = (count / maxVal) * chartH;
      const yTop = padding.top + chartH - barH;

      // Draw glassmorphic shaded bar
      const barGrad = ctx.createLinearGradient(0, yTop, 0, padding.top + chartH);
      barGrad.addColorStop(0, 'rgba(66, 133, 244, 0.7)'); // blue top
      barGrad.addColorStop(1, 'rgba(66, 133, 244, 0.15)'); // faded bottom
      ctx.fillStyle = barGrad;
      ctx.strokeStyle = 'rgba(66, 133, 244, 0.45)';
      ctx.lineWidth = 1;

      // Draw rounded rectangle bar
      ctx.beginPath();
      if (typeof (ctx as any).roundRect === 'function') {
        (ctx as any).roundRect(xLeft, yTop, barWidth, barH, [4, 4, 0, 0]);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.rect(xLeft, yTop, barWidth, barH);
        ctx.fill();
        ctx.stroke();
      }

      // Draw value text above bar
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.font = 'bold 9px monospace';
      ctx.fillText(count.toString(), xLeft + barWidth / 2, yTop - 6);

      // Draw X Label below bar
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.font = '500 9px sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(`Gen ${gen}`, xLeft + barWidth / 2, padding.top + chartH + 6);
    });

    ctx.restore();
  }
}
