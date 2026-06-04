# 0001. Cellular Physics and Logistics

## Context
The initial implementation of the ant farm simulator used abstract state counters for food stockpiles and telemetry, and lacked real-time environmental threats. To create a highly visual, tactile, and reactive "living" ecosystem where users can observe concrete ant behaviors, we need a physical representation of food, brood, water, and combat on the grid.

## Decision
We decided to replace abstract simulation variables with physical, grid-based representations:
1. **Cellular Food Logistics**: Food is stored as individual, color-coded cells (`Apple` as red, `Foliage` as green, `Carcass` as purple) on the grid. Foragers physically mine source cells, carry them as cargo, and place them in excavated larders. When a larder is full, foragers dynamically seek other larders.
2. **Cellular Brood & Nursery Space**: Brood items (eggs, larvae, pupae) are walkable objects that occupy physical space. Nurseries have capacity limits; when a nursery is full, the Queen lays eggs in other nurseries, and nurses distribute brood to less crowded nurseries.
3. **Cellular Water & Flooding**: Rain creates water cells that flow downwards and pool horizontally using cellular automata rules. Submersion causes drowning, and flooding forces nurses to evacuate brood to higher, dry nurseries.
4. **Combat and Threats**: Surface predators (spiders, beetles) and subterranean pests (mites) attack the colony. Specialized Soldier ants patrol the entrance and defend nurseries. Defeated threats decompose into harvestable carcass cells.
5. **Offline Progression Integration**: All cellular logistics, water accumulation, cave-ins, and combat resolutions are mathematically calculated during offline ticks and reported in a summary.

## Consequences
- The complexity of the `SimulationEngine`, `Ant`, and `ColonyManager` increases as they must query local cell states, check chamber capacities, and run combat and water flow ticks.
- Decoupling these systems behind clean seams (`Locomotion`, `Environment`, `FoliageSystem`, `BroodManager`, `TelemetryTracker`, `NestPlanner`) is essential to maintain a deep, testable codebase and prevent engine bloat.
- Memory usage will remain low since all elements utilize the existing 2D cell grid structure.
