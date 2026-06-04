import './style.css';
import { SimulationEngine } from './simulation/Engine';
import { OfflineProgression } from './simulation/OfflineProgression';
import type { OfflineResult } from './simulation/OfflineProgression';
import { WorldGrid } from './simulation/Grid';
import { ColonyCharts } from './ui/Charts';
import { CONFIG } from './simulation/types';

window.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('sim-canvas') as HTMLCanvasElement;
  if (!canvas) return;

  // Initialize simulation engine
  const engine = new SimulationEngine(canvas);

  let isChartsOpen = false;

  // Resize canvas event handler
  window.addEventListener('resize', () => {
    engine.resizeCanvas();
    if (isChartsOpen) {
      resizeDashboardCanvases();
      renderColonyCharts();
    }
  });

  // Camera Zoom event handler (mouse scroll wheel)
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); // Stop page scrolling
    
    // Zoom factor
    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const oldZoom = engine.camera.zoom;
    const nextZoom = Math.max(engine.getMinZoom(), Math.min(4.0, oldZoom * zoomFactor));
    
    // Calculate cursor position in display coordinates
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate cursor position in world space
    const worldX = engine.camera.x + (mouseX - rect.width / 2) / oldZoom;
    const worldY = engine.camera.y + (mouseY - rect.height / 2) / oldZoom;
    
    // Set new zoom level
    engine.camera.zoom = nextZoom;
    
    // Adjust camera coordinates so the world position under the mouse stays in the same place
    engine.camera.x = worldX - (mouseX - rect.width / 2) / nextZoom;
    engine.camera.y = worldY - (mouseY - rect.height / 2) / nextZoom;
  }, { passive: false });

  // Camera Pan event handler (mouse click and drag)
  let isDragging = false;
  let startMouseX = 0;
  let startMouseY = 0;
  let startCamX = 0;
  let startCamY = 0;
  let clickStartX = 0;
  let clickStartY = 0;

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) { // Left click only
      isDragging = true;
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      clickStartX = e.clientX;
      clickStartY = e.clientY;
      startCamX = engine.camera.x;
      startCamY = engine.camera.y;
      canvas.style.cursor = 'grabbing';
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    
    const dx = e.clientX - startMouseX;
    const dy = e.clientY - startMouseY;
    
    // Move camera relative to zoom factor
    engine.camera.x = startCamX - dx / engine.camera.zoom;
    engine.camera.y = startCamY - dy / engine.camera.zoom;
  });

  const stopDragging = () => {
    if (isDragging) {
      isDragging = false;
      canvas.style.cursor = 'default';
    }
  };

  window.addEventListener('mouseup', stopDragging);
  canvas.addEventListener('mouseleave', stopDragging);

  // Click handler to detect clicking on apples in trees
  canvas.addEventListener('click', (e) => {
    const dx = e.clientX - clickStartX;
    const dy = e.clientY - clickStartY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 5) {
      handleCanvasClick(e);
    }
  });

  // Touch panning support
  let isTouchDragging = false;
  let startTouchX = 0;
  let startTouchY = 0;

  canvas.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isTouchDragging = true;
      startTouchX = e.touches[0].clientX;
      startTouchY = e.touches[0].clientY;
      startCamX = engine.camera.x;
      startCamY = engine.camera.y;
    }
  }, { passive: true });

  canvas.addEventListener('touchmove', (e) => {
    if (!isTouchDragging || e.touches.length !== 1) return;
    
    const dx = e.touches[0].clientX - startTouchX;
    const dy = e.touches[0].clientY - startTouchY;
    
    engine.camera.x = startCamX - dx / engine.camera.zoom;
    engine.camera.y = startCamY - dy / engine.camera.zoom;
  }, { passive: true });

  const stopTouchDragging = () => {
    isTouchDragging = false;
  };
  canvas.addEventListener('touchend', stopTouchDragging);
  canvas.addEventListener('touchcancel', stopTouchDragging);

  // DOM Elements
  const hudSidebar = document.getElementById('hud-sidebar') as HTMLElement;
  const hudToggleTab = document.getElementById('hud-toggle-tab') as HTMLElement;
  const logPanel = document.getElementById('log-panel') as HTMLElement;
  const logResizeHandle = document.getElementById('log-resize-handle') as HTMLElement;
  const logContainer = document.getElementById('log-container') as HTMLElement;
  const logCount = document.getElementById('log-count') as HTMLElement;

  // Stats Elements
  const statTotalWorkers = document.getElementById('stat-total-workers') as HTMLElement;
  const statForagers = document.getElementById('stat-foragers') as HTMLElement;
  const statDiggers = document.getElementById('stat-diggers') as HTMLElement;
  const statNurses = document.getElementById('stat-nurses') as HTMLElement;
  const statFood = document.getElementById('stat-food') as HTMLElement;
  const statEggs = document.getElementById('stat-eggs') as HTMLElement;
  const statLarvae = document.getElementById('stat-larvae') as HTMLElement;
  const statPupae = document.getElementById('stat-pupae') as HTMLElement;
  const statNestVol = document.getElementById('stat-nest-vol') as HTMLElement;
  const statTotalDug = document.getElementById('stat-total-dug') as HTMLElement;
  const statActiveProject = document.getElementById('stat-active-project') as HTMLElement;

  // Controls Elements
  const speedButtons = document.querySelectorAll('.speed-btn');
  const filterButtons = document.querySelectorAll('.filter-btn');
  const clockSunMoon = document.getElementById('clock-sun-moon') as HTMLElement;
  const clockTimeText = document.getElementById('clock-time-text') as HTMLElement;
  const clockDayText = document.getElementById('clock-day-text') as HTMLElement;
  const weatherPressureText = document.getElementById('weather-pressure-text') as HTMLElement;
  const weatherHumidityText = document.getElementById('weather-humidity-text') as HTMLElement;
  const forecastTimelineList = document.getElementById('forecast-timeline-list') as HTMLElement;
  
  const togglePheromones = document.getElementById('toggle-pheromones') as HTMLInputElement;
  const toggleNames = document.getElementById('toggle-names') as HTMLInputElement;
  const toggleDebug = document.getElementById('toggle-debug') as HTMLInputElement;
  const resetSimBtn = document.getElementById('reset-sim-btn') as HTMLButtonElement;

  // Offline Modal Elements
  const offlineModal = document.getElementById('offline-modal') as HTMLElement;
  const offlineTime = document.getElementById('offline-time') as HTMLElement;
  
  // Apple Popup Elements and Selected State
  const applePopup = document.getElementById('apple-popup') as HTMLElement;
  const applePopupClose = document.getElementById('apple-popup-close') as HTMLElement;
  const applePopupStatus = document.getElementById('apple-popup-status') as HTMLElement;
  const applePopupProgressBar = document.getElementById('apple-popup-progress-bar') as HTMLElement;
  const applePopupTime = document.getElementById('apple-popup-time') as HTMLElement;

  let selectedFruit: any = null;
  let selectedTree: any = null;
  const offlineFoodGathered = document.getElementById('offline-food-gathered') as HTMLElement;
  const offlineFoodConsumed = document.getElementById('offline-food-consumed') as HTMLElement;
  const offlineAntsBorn = document.getElementById('offline-ants-born') as HTMLElement;
  const offlineDirtDug = document.getElementById('offline-dirt-dug') as HTMLElement;
  const closeOfflineBtn = document.getElementById('close-offline-btn') as HTMLButtonElement;

  // 1. Setup save state triggers
  engine.onStateSaveNeeded = () => {
    OfflineProgression.saveState(engine);
  };
  
  // Save when leaving tab
  window.addEventListener('pagehide', () => {
    OfflineProgression.saveState(engine);
  });
  window.addEventListener('beforeunload', () => {
    OfflineProgression.saveState(engine);
  });

  // 2. Load existing state and process offline progression
  const offlineResult = OfflineProgression.loadState(engine);
  if (offlineResult) {
    showOfflineModal(offlineResult);
  }

  // Analytics Dashboard UI elements & listeners
  const analyticsToggleBtn = document.getElementById('analytics-toggle-btn') as HTMLButtonElement;
  const analyticsBtnText = document.getElementById('analytics-btn-text') as HTMLElement;
  const closeChartsBtn = document.getElementById('close-charts-btn') as HTMLButtonElement;
  const chartsModal = document.getElementById('charts-modal') as HTMLElement;

  const chartPopCanvas = document.getElementById('chart-population') as HTMLCanvasElement;
  const chartResCanvas = document.getElementById('chart-resources') as HTMLCanvasElement;
  const chartExcCanvas = document.getElementById('chart-excavation') as HTMLCanvasElement;
  const chartBroodCanvas = document.getElementById('chart-brood') as HTMLCanvasElement;
  const chartFitCanvas = document.getElementById('chart-fitness') as HTMLCanvasElement;
  const chartGenCanvas = document.getElementById('chart-generations') as HTMLCanvasElement;

  const toggleCharts = () => {
    if (isChartsOpen) {
      chartsModal.classList.add('hidden');
      analyticsToggleBtn.classList.remove('active');
      analyticsBtnText.textContent = 'Show Analytics';
      isChartsOpen = false;
    } else {
      chartsModal.classList.remove('hidden');
      analyticsToggleBtn.classList.add('active');
      analyticsBtnText.textContent = 'Hide Analytics';
      isChartsOpen = true;
      resizeDashboardCanvases();
      renderColonyCharts();
    }
  };

  analyticsToggleBtn.addEventListener('click', toggleCharts);

  closeChartsBtn.addEventListener('click', () => {
    chartsModal.classList.add('hidden');
    analyticsToggleBtn.classList.remove('active');
    analyticsBtnText.textContent = 'Show Analytics';
    isChartsOpen = false;
  });

  chartsModal.addEventListener('click', (e) => {
    if (e.target === chartsModal) {
      chartsModal.classList.add('hidden');
      analyticsToggleBtn.classList.remove('active');
      analyticsBtnText.textContent = 'Show Analytics';
      isChartsOpen = false;
    }
  });

  function resizeDashboardCanvases() {
    const canvases = [
      chartPopCanvas,
      chartResCanvas,
      chartExcCanvas,
      chartBroodCanvas,
      chartFitCanvas,
      chartGenCanvas
    ];
    const dpr = window.devicePixelRatio || 1;
    canvases.forEach(c => {
      if (!c) return;
      const rect = c.parentElement!.getBoundingClientRect();
      const styleW = rect.width - 32; // account for margin/padding
      const styleH = rect.height - 48; // leave title room
      
      c.style.width = `${styleW}px`;
      c.style.height = `${styleH}px`;
      c.width = styleW * dpr;
      c.height = styleH * dpr;
    });
  }

  function renderColonyCharts() {
    const history = engine.telemetryTracker.getHistory();
    
    // 1. Population
    ColonyCharts.renderLineChart(
      chartPopCanvas,
      history,
      [
        { key: 'totalAnts', label: 'Total Workers', color: 'hsl(0, 0%, 95%)' },
        { key: 'foragers', label: 'Foragers', color: 'hsl(0, 80%, 65%)' },
        { key: 'diggers', label: 'Diggers', color: 'hsl(45, 95%, 60%)' },
        { key: 'nurses', label: 'Nurses', color: 'hsl(210, 85%, 65%)' }
      ],
      'Population Trends'
    );

    // 2. Resources
    ColonyCharts.renderLineChart(
      chartResCanvas,
      history,
      [
        { key: 'food', label: 'Food Stockpile', color: 'hsl(102, 70%, 55%)' }
      ],
      'Resources & Food Stockpile'
    );

    // 3. Excavation
    ColonyCharts.renderLineChart(
      chartExcCanvas,
      history,
      [
        { key: 'volume', label: 'Tunnel Volume (cm³)', color: 'hsl(210, 85%, 65%)' },
        { key: 'dirtDug', label: 'Total Excavated Blocks', color: 'hsl(45, 95%, 60%)' }
      ],
      'Colony Tunnels & Excavation'
    );

    // 4. Brood Development
    ColonyCharts.renderLineChart(
      chartBroodCanvas,
      history,
      [
        { key: 'eggCount', label: 'Eggs', color: 'hsl(0, 0%, 85%)' },
        { key: 'larvaCount', label: 'Larvae', color: 'hsl(80, 80%, 65%)' },
        { key: 'pupaCount', label: 'Pupae', color: 'hsl(30, 50%, 55%)' }
      ],
      'Brood Development'
    );

    // 5. Evolutionary Fitness
    ColonyCharts.renderLineChart(
      chartFitCanvas,
      history,
      [
        { key: 'avgFitness', label: 'Avg Fitness', color: 'hsl(280, 85%, 70%)' },
        { key: 'maxFitness', label: 'Max Fitness', color: 'hsl(320, 95%, 65%)' }
      ],
      'Steering AI Fitness (Evolution)'
    );

    // 6. Generations
    const genMap = new Map<number, number>();
    engine.colony.ants.forEach(a => {
      const g = a.generation || 1;
      genMap.set(g, (genMap.get(g) || 0) + 1);
    });
    ColonyCharts.renderBarChart(chartGenCanvas, genMap, 'Ant Generation Breakdown');
  }

  // 3. UI Interactions
  hudToggleTab.addEventListener('click', () => {
    hudSidebar.classList.toggle('collapsed');
    document.body.classList.toggle('hud-collapsed');
  });

  // Speed controls
  speedButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      speedButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = parseInt(btn.getAttribute('data-speed') || '1');
      engine.speedMultiplier = val;
    });
  });



  // Visual toggles
  togglePheromones.addEventListener('change', (e) => {
    engine.showPheromones = (e.target as HTMLInputElement).checked;
  });

  toggleNames.addEventListener('change', (e) => {
    engine.showAntNames = (e.target as HTMLInputElement).checked;
  });

  toggleDebug.addEventListener('change', (e) => {
    const isChecked = (e.target as HTMLInputElement).checked;
    engine.showDebug = isChecked;
  });

  // Log filter click handlers
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.getAttribute('data-filter') || 'all';
      activeLogFilter = val;
      updateLogUI();
    });
  });

  // Log Panel Drag Resizing
  let isResizing = false;
  let startY = 0;
  let startHeight = 0;

  logResizeHandle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    isResizing = true;
    startY = e.clientY;
    startHeight = logPanel.offsetHeight;
    logResizeHandle.classList.add('resizing');
    document.body.style.cursor = 'ns-resize';
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const dy = startY - e.clientY;
    const newHeight = Math.max(80, Math.min(400, startHeight + dy));
    logPanel.style.height = `${newHeight}px`;
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      logResizeHandle.classList.remove('resizing');
      document.body.style.cursor = 'default';
    }
  });

  logResizeHandle.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      isResizing = true;
      startY = e.touches[0].clientY;
      startHeight = logPanel.offsetHeight;
      logResizeHandle.classList.add('resizing');
    }
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (!isResizing || e.touches.length !== 1) return;
    const dy = startY - e.touches[0].clientY;
    const newHeight = Math.max(80, Math.min(400, startHeight + dy));
    logPanel.style.height = `${newHeight}px`;
  });

  window.addEventListener('touchend', () => {
    if (isResizing) {
      isResizing = false;
      logResizeHandle.classList.remove('resizing');
    }
  });

  // Reset
  resetSimBtn.addEventListener('click', () => {
    const confirmReset = confirm(
      'Are you sure you want to reset your ant colony? All tunnels, stockpile resources, and ants will be permanently deleted.'
    );
    if (confirmReset) {
      selectedFruit = null;
      selectedTree = null;
      applePopup.classList.add('hidden');
      OfflineProgression.clearSave();
      engine.grid = new WorldGrid();
      engine.pheromones.clear();
      engine.colony.reset(engine.grid.nestEntranceCol);
      engine.totalDirtDugGlobal = 0;
      engine.telemetryTracker.setHistory([]); // Clear telemetry history on reset
      
      // Reset clock and weather
      engine.dayCount = 1;
      engine.hour = 8;
      engine.minute = 0;
      engine.minuteFraction = 0;
      engine.weather = 'Sunny';
      engine.weatherTimer = 0;
      engine.weatherQueue = [];
      engine.refillWeatherQueue();
      const current = engine.weatherQueue.shift()!;
      engine.weather = current.type;
      engine.weatherTargetDuration = current.durationFrames;

      OfflineProgression.saveState(engine);
      location.reload();
    }
  });

  // Close Offline Modal
  closeOfflineBtn.addEventListener('click', () => {
    offlineModal.classList.add('hidden');
  });

  // Close popup when close button is clicked
  applePopupClose.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedFruit = null;
    selectedTree = null;
    applePopup.classList.add('hidden');
  });

  // Handle canvas clicks to select/ripen apples
  function handleCanvasClick(e: MouseEvent) {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Project to world coordinates
    const worldX = engine.camera.x + (mouseX - rect.width / 2) / engine.camera.zoom;
    const worldY = engine.camera.y + (mouseY - rect.height / 2) / engine.camera.zoom;

    let clickedFruit: any = null;
    let clickedTree: any = null;

    for (const tree of engine.trees) {
      const startX = tree.col * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
      const surfaceR = engine.grid.getSurfaceRow(tree.col);
      const startY = surfaceR * CONFIG.CELL_SIZE;
      const canopySway = 2.5 * Math.sin(Date.now() * 0.0006 + tree.col);
      
      for (const fruit of tree.fruits) {
        if (fruit.isFalling) continue;
        const fx = startX + fruit.relX + canopySway;
        const fy = startY + fruit.relY;
        const radius = Math.max(12, 16.5 * (fruit.growth / 100)); // Click threshold is at least 12px for ease
        
        const dist = Math.sqrt((worldX - fx) ** 2 + (worldY - fy) ** 2);
        if (dist <= radius) {
          clickedFruit = fruit;
          clickedTree = tree;
          break;
        }
      }
      if (clickedFruit) break;
    }

    if (clickedFruit) {
      selectedFruit = clickedFruit;
      selectedTree = clickedTree;
      updatePopupUI();
      applePopup.classList.remove('hidden');
    } else {
      selectedFruit = null;
      selectedTree = null;
      applePopup.classList.add('hidden');
    }
  }

  // Update popup coordinates and values in real time
  function updatePopupUI() {
    if (!selectedFruit || !selectedTree) return;
    
    const fruit = selectedFruit;
    const tree = selectedTree;
    
    // Status text & Progress
    if (fruit.growth >= 100) {
      applePopupStatus.textContent = 'Ripe & Ready!';
      applePopupStatus.style.color = 'hsl(102, 70%, 55%)';
      applePopupTime.textContent = 'Ready to drop';
      applePopupProgressBar.style.width = '100%';
    } else {
      applePopupStatus.textContent = 'Ripening...';
      applePopupStatus.style.color = 'hsl(38, 90%, 65%)';
      
      // Calculate remaining hours
      const remainingHours = (100 - fruit.growth) * (5 / 9);
      applePopupTime.textContent = `Ready in ${remainingHours.toFixed(1)} hours`;
      applePopupProgressBar.style.width = `${fruit.growth}%`;
    }
    
    // Position popup in viewport coordinates
    const rect = canvas.getBoundingClientRect();
    const displayWidth = rect.width;
    const displayHeight = rect.height;
    
    // Apple world coords
    const startX = tree.col * CONFIG.CELL_SIZE + CONFIG.CELL_SIZE / 2;
    const surfaceR = engine.grid.getSurfaceRow(tree.col);
    const startY = surfaceR * CONFIG.CELL_SIZE;
    const canopySway = 2.5 * Math.sin(Date.now() * 0.0006 + tree.col);
    const fx = startX + fruit.relX + canopySway;
    const fy = startY + fruit.relY;
    
    // Project to screen
    const screenX = displayWidth / 2 + (fx - engine.camera.x) * engine.camera.zoom;
    const screenY = displayHeight / 2 + (fy - engine.camera.y) * engine.camera.zoom;
    
    applePopup.style.left = `${rect.left + window.scrollX + screenX}px`;
    applePopup.style.top = `${rect.top + window.scrollY + screenY}px`;
  }

  // 4. Log Renderer caching
  let lastLogHash = '';
  let activeLogFilter = 'all';
  function updateLogUI() {
    const logs = engine.colony.logs;
    const filteredLogs = logs.filter(log => activeLogFilter === 'all' || log.category === activeLogFilter);
    const currentHash = activeLogFilter + '|' + filteredLogs.map(l => l.text).join('|');
    if (currentHash === lastLogHash) return;
    
    lastLogHash = currentHash;
    logContainer.innerHTML = '';
    logCount.textContent = `${filteredLogs.length} events`;
    filteredLogs.forEach(log => {
      const entry = document.createElement('div');
      entry.className = `log-entry category-${log.category}`;
      entry.textContent = log.text;
      logContainer.appendChild(entry);
    });
  }

  // 5. Offline Modal display formatter
  function showOfflineModal(res: OfflineResult) {
    const totalSecs = res.elapsedSeconds;
    let timeText = '';
    if (totalSecs < 60) {
      timeText = `${totalSecs} seconds`;
    } else if (totalSecs < 3600) {
      timeText = `${Math.floor(totalSecs / 60)} minutes`;
    } else {
      const hrs = Math.floor(totalSecs / 3600);
      const mins = Math.floor((totalSecs % 3600) / 60);
      timeText = `${hrs}h ${mins}m`;
    }

    offlineTime.textContent = timeText;
    offlineFoodGathered.textContent = `+${res.foodGathered}`;
    offlineFoodConsumed.textContent = `-${res.foodConsumed}`;
    offlineAntsBorn.textContent = `+${res.antsBorn}`;
    offlineDirtDug.textContent = `+${res.dirtDug} cells`;

    offlineModal.classList.remove('hidden');
  }

  // 6. Stats dashboard updater
  let updateTicks = 0;
  function updateHUD() {
    updateTicks++;
    if (updateTicks % 8 !== 0) return; // update HUD every 8 frames for performance

    const stats = engine.colony.getStats(engine.grid);
    
    statTotalWorkers.textContent = stats.workerCount.toString();
    statForagers.textContent = stats.foragerCount.toString();
    statDiggers.textContent = stats.diggerCount.toString();
    statNurses.textContent = stats.nurseCount.toString();
    
    statFood.textContent = stats.foodStockpile.toString();
    statEggs.textContent = stats.eggCount.toString();
    statLarvae.textContent = stats.larvaCount.toString();
    statPupae.textContent = stats.pupaCount.toString();
    
    // Nest volume calculation in cm³
    const volumeCm = Math.floor(stats.nestVolume * 0.25);
    statNestVol.textContent = `${volumeCm} cm³`;
    statTotalDug.textContent = engine.totalDirtDugGlobal.toString();
    statActiveProject.textContent = stats.activeProject;

    // Update internal clock and weather forecast UI
    if (clockTimeText) {
      const pad = (n: number) => n.toString().padStart(2, '0');
      clockTimeText.textContent = `${pad(engine.hour)}:${pad(engine.minute)}`;
    }
    if (clockDayText) {
      clockDayText.textContent = `Day ${engine.dayCount}`;
    }
    if (clockSunMoon) {
      if (engine.hour >= 6 && engine.hour < 18) {
        clockSunMoon.textContent = '☀️';
      } else {
        clockSunMoon.textContent = '🌙';
      }
    }
    if (weatherPressureText) {
      weatherPressureText.textContent = `${engine.getPressure()} hPa`;
    }
    if (weatherHumidityText) {
      weatherHumidityText.textContent = `${engine.getHumidity()}%`;
    }
    
    // Update Forecast Timeline
    if (forecastTimelineList) {
      const forecast = engine.getWeatherForecast();
      forecastTimelineList.innerHTML = forecast
        .slice(0, 4)
        .map((f, i) => {
          const weatherIcon = f.type === 'Sunny' ? '☀️' : '🌧️';
          const weatherName = f.type === 'Sunny' ? 'Sunny' : 'Rainy';
          
          if (i === 0) {
            return `
              <div class="forecast-item active-forecast">
                <span class="forecast-label">${weatherIcon} <strong>Current:</strong> ${weatherName}</span>
                <span class="forecast-time">rem. ${f.durationHours}h</span>
              </div>
            `;
          } else {
            return `
              <div class="forecast-item">
                <span class="forecast-label">${weatherIcon} ${weatherName}</span>
                <span class="forecast-time">in ${f.delayHours}h (lasts ${f.durationHours}h)</span>
              </div>
            `;
          }
        })
        .join('');
    }

    updateLogUI();
  }

  // 7. Core Main Loop
  function tick() {
    // Limit frame step dt
    engine.update();
    engine.render();
    updateHUD();

    if (selectedFruit) {
      updatePopupUI();
    }

    if (isChartsOpen && updateTicks % 15 === 0) {
      renderColonyCharts();
    }

    requestAnimationFrame(tick);
  }

  // Kickstart simulation loop
  requestAnimationFrame(tick);
});
