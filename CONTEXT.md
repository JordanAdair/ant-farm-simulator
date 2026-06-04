# Ant Farm Simulator

A virtual ant farm simulation that runs continuously, allowing the user to observe colony growth, tunnel excavation, and survival over time, including offline progression.

## Language

**Colony**:
The collective community of ants sharing a single nest, resources, and lifecycle.

**Queen**:
The founding and reproductive center of the colony, responsible for laying eggs.
_Avoid_: Mother, ruler

**Worker**:
An active adult female ant dedicated to maintaining the colony. Undergoes dynamic role balancing based on colony needs.
_Avoid_: Helper, unit

**Role**:
The specialized duty assigned to a worker:
- **Forager**: Locates and retrieves surface food to the nest stockpiles.
- **Digger**: Excavates dirt and rock to expand the nest tunnels and chambers.
- **Nurse**: Feeds larvae, carries eggs and pupae to nurseries, and tends the brood.
- **Soldier**: Defends the nest entrance and tunnels against active threats.
_Avoid_: Class, spec, career

**Brood**:
The developing young of the colony, divided into three stages:
- **Egg**: The initial reproductive stage laid by the Queen.
- **Larva**: The feeding stage requiring food delivered by Nurses.
- **Pupa**: The cocooned metamophosis stage leading to adult hatching.
_Avoid_: Baby, egg list

**Nest**:
The physical structure dug into the soil, consisting of a vertical entrance shaft, horizontal link passages, and specialized chambers (larders and nurseries).
_Avoid_: Maze, hive, home

**Larder**:
An excavated chamber underground dedicated to storing the food stockpile.
_Avoid_: Food storage, pantry

**Nursery**:
An excavated chamber underground dedicated to keeping the brood safe and warm.
_Avoid_: Breeding room, egg chamber

**Threat**:
An external hazard or predator (such as spiders, beetles, or flooding) that damages nest structures or attacks workers.
_Avoid_: Enemy, monster

**Offline Progression**:
The background simulation that runs when the tab/application is closed, calculating gathered resources, hatched brood, and tunnel excavation based on the elapsed duration.
_Avoid_: Background calculations, idle progression
