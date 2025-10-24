const GRID_SIZE = 100;
const INITIAL_AGENTS = 220;
const TICK_INTERVAL_DEFAULT = 100;
const MAX_CELL_FOOD = 30;
const MAX_CELL_RES = 8;
const ACTIONS = ["move", "eat", "attack", "trade", "follow", "reproduce"];

const canvas = document.getElementById("worldCanvas");
const ctx = canvas.getContext("2d");

const tickStat = document.getElementById("tickStat");
const populationStat = document.getElementById("populationStat");
const aggressionStat = document.getElementById("aggressionStat");
const ambitionStat = document.getElementById("ambitionStat");
const factionStat = document.getElementById("factionStat");
const conflictStat = document.getElementById("conflictStat");
const tradeStat = document.getElementById("tradeStat");
const betrayalStat = document.getElementById("betrayalStat");
const wealthStat = document.getElementById("wealthStat");
const currencyStat = document.getElementById("currencyStat");
const languageStat = document.getElementById("languageStat");
const agentPanel = document.getElementById("selectedAgent");
const agentDetails = document.getElementById("agentDetails");

const pauseBtn = document.getElementById("pauseBtn");
const resumeBtn = document.getElementById("resumeBtn");
const saveBtn = document.getElementById("saveBtn");
const loadBtn = document.getElementById("loadBtn");
const speedSlider = document.getElementById("speedSlider");

let world = [];
let agents = [];
let agentIdCounter = 1;
let tickCount = 0;
let timerHandle = null;
let tradesLog = [];
let betrayalsLog = [];
let conflicts = new Map();
let selectedAgentId = null;
let followAgentId = null;

const camera = {
  x: GRID_SIZE / 2,
  y: GRID_SIZE / 2,
  zoom: 8,
  dragging: false,
  dragStart: null
};

const conceptList = ["food", "metal", "wood", "water", "danger", "trust", "token"];

function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

function randInt(min, max) {
  return Math.floor(randRange(min, max));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createCell() {
  return {
    food: Math.random() < 0.2 ? randInt(5, MAX_CELL_FOOD) : 0,
    metal: Math.random() < 0.1 ? randInt(1, MAX_CELL_RES) : 0,
    wood: Math.random() < 0.2 ? randInt(1, MAX_CELL_RES + 3) : 0,
    water: Math.random() < 0.2 ? randInt(1, MAX_CELL_RES + 3) : 0,
    rare: Math.random() < 0.03 ? 1 : 0,
    corpse: 0
  };
}

function initWorld() {
  world = new Array(GRID_SIZE).fill(null).map(() => new Array(GRID_SIZE).fill(null).map(() => createCell()));
}

function randomTraits() {
  return {
    aggression: randRange(0.05, 1),
    greed: randRange(0.1, 1),
    fear: randRange(0, 0.9),
    loyalty: randRange(0, 1),
    ambition: randRange(0.1, 1),
    tradeBias: randRange(0, 1),
    betrayBias: randRange(0, 1),
    charisma: randRange(0.1, 1)
  };
}

function createAgent(x, y, parentTraits) {
  const brain = parentTraits
    ? Object.fromEntries(Object.entries(parentTraits).map(([k, v]) => [k, clamp(v + randRange(-0.08, 0.08), 0, 1)]))
    : randomTraits();

  const agent = {
    id: agentIdCounter++,
    x: clamp(x, 0, GRID_SIZE - 1),
    y: clamp(y, 0, GRID_SIZE - 1),
    hp: randRange(70, 110),
    energy: randRange(40, 70),
    age: randInt(10, 35),
    inventory: {
      food: randInt(0, 8),
      metal: randInt(0, 4),
      wood: randInt(0, 6),
      water: randInt(0, 6),
      rare: randInt(0, 2),
      token: 0
    },
    memory: {
      trust: new Map(),
      lastInteracted: new Map(),
      grudges: new Map(),
      history: [],
      language: new Map()
    },
    brain,
    social: {
      leaderId: null,
      followers: new Set(),
      factionId: null,
      influence: randRange(0, 1),
      languageDialect: `${Math.random().toString(36).slice(2, 5)}`,
      currencyName: null,
      recentActions: []
    }
  };

  // seed language tokens
  conceptList.forEach(concept => {
    const token = `${agent.social.languageDialect}-${concept.slice(0, 2)}`;
    agent.memory.language.set(concept, { token, confidence: randRange(0.4, 0.9) });
  });

  agents.push(agent);
  return agent;
}

function initAgents() {
  agents = [];
  agentIdCounter = 1;
  for (let i = 0; i < INITIAL_AGENTS; i++) {
    createAgent(randInt(0, GRID_SIZE), randInt(0, GRID_SIZE));
  }
}

function getCell(x, y) {
  if (x < 0 || y < 0 || x >= GRID_SIZE || y >= GRID_SIZE) return null;
  return world[x][y];
}

function neighborhood(x, y, radius = 3) {
  const cells = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (dx === 0 && dy === 0) continue;
      const cell = getCell(x + dx, y + dy);
      if (cell) {
        cells.push({ cell, x: x + dx, y: y + dy });
      }
    }
  }
  return cells;
}

function agentsInRange(agent, radius = 5) {
  const rad2 = radius * radius;
  return agents.filter(other => other.id !== agent.id && distanceSq(agent, other) <= rad2);
}

function distanceSq(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function chooseAction(agent) {
  const nearby = agentsInRange(agent, 6);
  const cell = getCell(agent.x, agent.y);
  const hunger = clamp(1 - agent.energy / 100, 0, 1);
  const danger = Math.max(...nearby.map(other => agent.memory.grudges.get(other.id) || 0), 0);
  const trustScores = nearby.map(other => agent.memory.trust.get(other.id) || 0);
  const averageTrust = trustScores.length ? trustScores.reduce((a, b) => a + b, 0) / trustScores.length : 0;
  const richestNeighbor = nearby.reduce((top, curr) => (wealth(curr) > (top ? wealth(top) : -Infinity) ? curr : top), null);
  const leader = agent.social.leaderId ? agents.find(a => a.id === agent.social.leaderId) : null;
  const highResources = agent.energy > 60 && wealth(agent) > 18;

  const actionScores = {
    move: 0.2 + hunger * 0.3 + agent.brain.ambition * 0.2 + (cell.food < 4 ? 0.2 : 0),
    eat: hunger * (agent.inventory.food > 0 ? 1 : cell.food > 0 ? 0.7 : 0),
    attack:
      agent.brain.aggression * 0.6 +
      (danger > 0.5 ? 0.2 : 0) +
      (richestNeighbor && wealth(richestNeighbor) > wealth(agent) * 1.3 ? agent.brain.greed * 0.5 : 0),
    trade:
      agent.brain.tradeBias * 0.5 +
      (averageTrust > 0.2 ? 0.3 : 0) +
      (agent.energy < 50 ? 0.2 : 0),
    follow:
      (!leader && nearby.some(o => o.brain.ambition > 0.7) ? agent.brain.fear * 0.4 + agent.brain.loyalty * 0.5 : 0) +
      (leader ? agent.brain.loyalty * 0.3 : 0),
    reproduce: agent.energy > 55 && agent.age > 20 ? 0.6 : 0
  };

  if (leader && leader.hp < 40 && agent.brain.betrayBias > 0.7 && Math.random() < agent.brain.greed) {
    actionScores.attack += 0.5; // opportunistic betrayal
  }

  if (danger > 0.6 && agent.brain.fear > 0.6) {
    actionScores.move += 0.4;
  }

  const action = ACTIONS.reduce((top, current) => (actionScores[current] > actionScores[top] ? current : top), ACTIONS[0]);
  return { action, nearby, cell };
}

function performAction(agent, context) {
  const { action, nearby, cell } = context;
  switch (action) {
    case "move":
      moveAgent(agent, cell);
      break;
    case "eat":
      eat(agent, cell);
      break;
    case "attack":
      attack(agent, nearby);
      break;
    case "trade":
      trade(agent, nearby);
      break;
    case "follow":
      follow(agent, nearby);
      break;
    case "reproduce":
      reproduce(agent);
      break;
    default:
      moveAgent(agent, cell);
  }
}

function moveAgent(agent, cell) {
  const options = neighborhood(agent.x, agent.y, 3);
  options.sort((a, b) => scoreCell(agent, b) - scoreCell(agent, a));
  const choice = options[0];
  if (!choice) return;
  agent.x = clamp(choice.x, 0, GRID_SIZE - 1);
  agent.y = clamp(choice.y, 0, GRID_SIZE - 1);

  harvestResources(agent);
}

function scoreCell(agent, option) {
  const { cell, x, y } = option;
  let score = 0.1;
  score += (cell.food / MAX_CELL_FOOD) * (0.4 + agent.brain.greed * 0.2);
  score += ((cell.metal + cell.wood + cell.water) / (MAX_CELL_RES * 3)) * 0.3;
  score += cell.rare > 0 ? 0.5 : 0;

  if (agent.social.leaderId === agent.id) {
    score += agent.brain.ambition * 0.2;
  }

  const crowding = agents.filter(other => other.id !== agent.id && other.x === x && other.y === y).length;
  score -= crowding * 0.1;
  return score;
}

function harvestResources(agent) {
  const cell = getCell(agent.x, agent.y);
  if (!cell) return;
  const hunger = agent.energy < 80;

  if (cell.food > 0 && hunger) {
    const take = Math.min(10, cell.food);
    cell.food -= take;
    agent.inventory.food += take;
  }
  ["metal", "wood", "water", "rare"].forEach(key => {
    if (cell[key] > 0 && Math.random() < 0.6 + agent.brain.greed * 0.2) {
      const take = Math.min(2, cell[key]);
      cell[key] -= take;
      agent.inventory[key] += take;
    }
  });

  if (cell.corpse > 0 && agent.brain.greed > 0.6) {
    const take = Math.min(4, cell.corpse);
    agent.inventory.food += take;
    cell.corpse -= take;
  }
}

function eat(agent, cell) {
  if (agent.inventory.food > 0) {
    const consumed = Math.min(agent.inventory.food, 10);
    agent.inventory.food -= consumed;
    agent.energy += consumed;
    agent.social.recentActions.push({ type: "eat", tick: tickCount });
  } else if (cell.food > 0) {
    const consumed = Math.min(cell.food, 10);
    cell.food -= consumed;
    agent.energy += consumed;
  }
  agent.energy = Math.min(agent.energy, 120);
}

function attack(agent, nearby) {
  if (!nearby.length) return;
  const targets = nearby.filter(other => (agent.memory.trust.get(other.id) || 0) < 0.2 || Math.random() < agent.brain.betrayBias * 0.1);
  const target = targets.length ? targets[randInt(0, targets.length)] : nearby[randInt(0, nearby.length)];
  if (!target) return;

  const damage = 10 + agent.brain.aggression * 25;
  target.hp -= damage;
  agent.social.recentActions.push({ type: "attack", target: target.id, tick: tickCount });

  const sameFaction = agent.social.leaderId && agent.social.leaderId === target.social.leaderId;
  const targetingLeader = target.id === agent.social.leaderId;
  if ((sameFaction || targetingLeader) && (agent.memory.trust.get(target.id) || 0) > -0.2) {
    betrayalsLog.push(tickCount);
  }

  updateTrust(agent, target, -0.25);
  updateGrudge(target, agent, 0.4);

  if (target.hp <= 0) {
    handleDeath(target, agent);
    stealResources(agent, target);
  } else if (Math.random() < target.brain.fear) {
    flee(target, agent);
  }
}

function stealResources(agent, victim) {
  Object.keys(victim.inventory).forEach(key => {
    agent.inventory[key] += victim.inventory[key] * (0.5 + agent.brain.greed * 0.5);
    victim.inventory[key] = 0;
  });
}

function flee(agent, threat) {
  const options = neighborhood(agent.x, agent.y, 4).sort((a, b) => distanceFromThreat(b, threat) - distanceFromThreat(a, threat));
  const choice = options[0];
  if (!choice) return;
  agent.x = clamp(choice.x, 0, GRID_SIZE - 1);
  agent.y = clamp(choice.y, 0, GRID_SIZE - 1);
}

function distanceFromThreat(option, threat) {
  const dx = option.x - threat.x;
  const dy = option.y - threat.y;
  return dx * dx + dy * dy;
}

function trade(agent, nearby) {
  const partners = nearby.filter(other => (agent.memory.trust.get(other.id) || 0) > 0);
  if (!partners.length) return;
  const partner = partners[randInt(0, partners.length)];
  const agentNeed = resourceNeed(agent);
  const partnerNeed = resourceNeed(partner);

  if (!agentNeed && !partnerNeed) {
    // if no clear need, consider symbolic trade token creation
    maybeCreateCurrency(agent, partner);
    return;
  }

  if (agentNeed && partner.inventory[agentNeed] > 0) {
    executeTrade(agent, partner, agentNeed);
  } else if (partnerNeed && agent.inventory[partnerNeed] > 0) {
    executeTrade(partner, agent, partnerNeed);
  } else {
    maybeCreateCurrency(agent, partner);
  }
}

function executeTrade(receiver, giver, resource) {
  const amount = Math.min(3, giver.inventory[resource]);
  if (amount <= 0) return;
  giver.inventory[resource] -= amount;
  receiver.inventory[resource] += amount;
  updateTrust(receiver, giver, 0.1);
  updateTrust(giver, receiver, 0.05);
  tradesLog.push(tickCount);
  giver.social.recentActions.push({ type: "trade", partner: receiver.id, tick: tickCount });
  receiver.social.recentActions.push({ type: "trade", partner: giver.id, tick: tickCount });
  spreadLanguage(receiver, giver, "trade");
  spreadLanguage(giver, receiver, "trade");
}

function maybeCreateCurrency(agent, partner) {
  if (!agent.social.currencyName && agent.brain.ambition > 0.7 && agent.brain.tradeBias > 0.5) {
    const newToken = `${agent.memory.language.get("token").token}-${agent.id}`;
    agent.social.currencyName = newToken;
    agent.inventory.token += 5;
  }
  if (!agent.social.currencyName) return;

  const partnerTrust = partner.memory.trust.get(agent.id) || 0;
  const acceptanceBias = clamp(partner.brain.tradeBias + partner.brain.loyalty * partnerTrust - partner.brain.greed * 0.1, -1, 1);
  if (partner.brain.tradeBias > 0.3 && Math.random() < 0.4 + acceptanceBias) {
    partner.social.currencyName = partner.social.currencyName || agent.social.currencyName;
    const tokenAmount = Math.max(1, Math.round(agent.brain.ambition * 3));
    if (agent.inventory.token < tokenAmount) agent.inventory.token = tokenAmount;
    agent.inventory.token = Math.max(agent.inventory.token - tokenAmount, 0);
    partner.inventory.token += tokenAmount;
    updateTrust(agent, partner, 0.05);
    tradesLog.push(tickCount);
    spreadLanguage(agent, partner, "token");
  }
}

function spreadLanguage(source, target, concept) {
  const sourceEntry = source.memory.language.get(concept);
  const targetEntry = target.memory.language.get(concept);
  if (!sourceEntry) return;
  if (!targetEntry || targetEntry.token !== sourceEntry.token) {
    const adoption = (source.memory.trust.get(target.id) || 0.1) + source.brain.ambition * 0.1;
    if (Math.random() < 0.4 + adoption) {
      target.memory.language.set(concept, { token: sourceEntry.token, confidence: 0.5 });
    }
  } else {
    targetEntry.confidence = Math.min(1, targetEntry.confidence + 0.05);
  }
}

function follow(agent, nearby) {
  const leaders = nearby.filter(o => o.brain.ambition > 0.6 || o.social.followers.size > 3);
  if (!leaders.length) return;
  leaders.sort((a, b) => leaderScore(agent, b) - leaderScore(agent, a));
  const leader = leaders[0];
  if (!leader) return;

  if (agent.social.leaderId && agent.social.leaderId !== leader.id) {
    const previous = agents.find(a => a.id === agent.social.leaderId);
    if (previous) previous.social.followers.delete(agent.id);
  }

  leader.social.followers.add(agent.id);
  agent.social.leaderId = leader.id;
  agent.social.factionId = leader.social.factionId || leader.id;
  updateTrust(agent, leader, 0.05 + agent.brain.loyalty * 0.1);
  spreadLanguage(leader, agent, "trust");
}

function leaderScore(agent, candidate) {
  const base = candidate.brain.ambition * 0.6 + candidate.social.followers.size * 0.1;
  const trust = agent.memory.trust.get(candidate.id) || 0;
  const charisma = candidate.brain.charisma || 0.5;
  return base + trust + charisma * 0.3 + (candidate.inventory.food > agent.inventory.food ? 0.1 : 0);
}

function reproduce(agent) {
  if (agent.energy <= 55 || agent.age <= 20) return;
  agent.energy -= 25;
  agent.inventory.food = Math.max(agent.inventory.food - 5, 0);
  const child = createAgent(agent.x + randInt(-1, 2), agent.y + randInt(-1, 2), agent.brain);
  child.energy = 40;
  child.age = 0;
  child.social.factionId = agent.social.factionId || agent.id;
  child.social.leaderId = agent.social.leaderId || agent.id;
  if (agent.social.leaderId === agent.id) {
    agent.social.followers.add(child.id);
  }
  if (child.social.leaderId && child.social.leaderId !== child.id) {
    const leader = agents.find(a => a.id === child.social.leaderId);
    if (leader) {
      leader.social.followers.add(child.id);
      updateTrust(child, leader, 0.1);
    }
  }
}

function updateTrust(agent, other, delta) {
  const current = agent.memory.trust.get(other.id) || 0;
  agent.memory.trust.set(other.id, clamp(current + delta, -1, 1));
  agent.memory.lastInteracted.set(other.id, tickCount);
}

function updateGrudge(agent, other, delta) {
  const current = agent.memory.grudges.get(other.id) || 0;
  agent.memory.grudges.set(other.id, clamp(current + delta, 0, 1));
  agent.memory.lastInteracted.set(other.id, tickCount);
}

function resourceNeed(agent) {
  const needs = Object.entries(agent.inventory)
    .filter(([key, value]) => key !== "token")
    .sort((a, b) => a[1] - b[1]);
  const [resource, amount] = needs[0];
  return amount < 3 ? resource : null;
}

function wealth(agent) {
  const inv = agent.inventory;
  return inv.food * 0.5 + inv.metal * 1.5 + inv.wood * 0.8 + inv.water * 0.7 + inv.rare * 5 + inv.token * 0.3;
}

function handleDeath(agent, killer) {
  const cell = getCell(agent.x, agent.y);
  if (cell) {
    cell.food += Math.floor(agent.inventory.food * 0.5);
    cell.corpse += 6;
    cell.metal += Math.floor(agent.inventory.metal * 0.4);
    cell.wood += Math.floor(agent.inventory.wood * 0.4);
  }

  agents = agents.filter(a => a.id !== agent.id);
  if (agent.social.leaderId === agent.id) {
    agent.social.followers.forEach(fid => {
      const follower = agents.find(a => a.id === fid);
      if (follower) {
        follower.social.leaderId = null;
        follower.social.factionId = null;
      }
    });
  }
  if (agent.social.leaderId && agent.social.leaderId !== agent.id) {
    const leader = agents.find(a => a.id === agent.social.leaderId);
    if (leader) {
      leader.social.followers.delete(agent.id);
    }
  }

  if (killer) {
    updateGrudge(killer, agent, -0.3);
  }

  if (selectedAgentId === agent.id) {
    selectedAgentId = null;
    followAgentId = null;
    agentPanel.classList.add("hidden");
  }
}

function tick() {
  tickCount++;
  tradesLog = tradesLog.filter(t => tickCount - t <= 100);
  betrayalsLog = betrayalsLog.filter(t => tickCount - t <= 100);

  conflicts.clear();

  for (const agent of [...agents]) {
    agent.age += 0.1;
    agent.energy -= 1;
    if (agent.energy <= 0 || agent.hp <= 0 || agent.age > 120) {
      handleDeath(agent);
      continue;
    }

    const context = chooseAction(agent);
    performAction(agent, context);

    if (agent.energy > 120) agent.energy = 120;
    if (agent.social.leaderId === agent.id && Math.random() < agent.brain.ambition * 0.05) {
      agent.social.followers.forEach(fid => {
        const follower = agents.find(a => a.id === fid);
        if (follower) updateTrust(follower, agent, 0.02);
      });
    }

    propagateConflicts(agent);
    agent.social.recentActions = agent.social.recentActions.filter(entry => tickCount - entry.tick < 200);
  }

  regrowWorld();
  updateStats();
  render();
}

function propagateConflicts(agent) {
  if (!agent.social.leaderId) return;
  const leader = agents.find(a => a.id === agent.social.leaderId);
  if (!leader) return;
  const foes = agentsInRange(agent, 4).filter(other => {
    const trust = agent.memory.trust.get(other.id) || 0;
    return trust < -0.3 && other.social.leaderId && other.social.leaderId !== agent.social.leaderId;
  });
  if (foes.length) {
    const key = [agent.social.leaderId, ...new Set(foes.map(f => f.social.leaderId))].sort().join("-");
    conflicts.set(key, (conflicts.get(key) || 0) + 1);
  }
}

function regrowWorld() {
  for (let i = 0; i < 50; i++) {
    const x = randInt(0, GRID_SIZE);
    const y = randInt(0, GRID_SIZE);
    const cell = getCell(x, y);
    if (!cell) continue;
    if (Math.random() < 0.4) cell.food = Math.min(MAX_CELL_FOOD, cell.food + randInt(1, 3));
    if (Math.random() < 0.2) cell.wood = Math.min(MAX_CELL_RES + 3, cell.wood + 1);
    if (Math.random() < 0.15) cell.water = Math.min(MAX_CELL_RES + 3, cell.water + 1);
    if (Math.random() < 0.05) cell.metal = Math.min(MAX_CELL_RES, cell.metal + 1);
  }
}

function updateStats() {
  const pop = agents.length;
  const avgAgg = pop ? agents.reduce((sum, a) => sum + a.brain.aggression, 0) / pop : 0;
  const avgAmb = pop ? agents.reduce((sum, a) => sum + a.brain.ambition, 0) / pop : 0;
  const factions = new Set(agents.filter(a => a.social.leaderId).map(a => a.social.leaderId));
  const totalWealth = agents.reduce((sum, a) => sum + wealth(a), 0);
  const currencyUsers = agents.filter(a => a.social.currencyName).length;
  const languageTokens = new Map();
  agents.forEach(a => {
    const entry = a.memory.language.get("trade");
    if (entry) {
      languageTokens.set(entry.token, (languageTokens.get(entry.token) || 0) + 1);
    }
  });
  const mostCommonLanguage = Math.max(0, ...languageTokens.values());

  tickStat.textContent = tickCount;
  populationStat.textContent = pop;
  aggressionStat.textContent = avgAgg.toFixed(2);
  ambitionStat.textContent = avgAmb.toFixed(2);
  factionStat.textContent = factions.size;
  conflictStat.textContent = conflicts.size;
  tradeStat.textContent = tradesLog.length;
  betrayalStat.textContent = betrayalsLog.length;
  wealthStat.textContent = pop ? (totalWealth / pop).toFixed(2) : 0;
  currencyStat.textContent = pop ? ((currencyUsers / pop) * 100).toFixed(0) + "%" : "0%";
  languageStat.textContent = pop ? ((mostCommonLanguage / pop) * 100).toFixed(0) + "%" : "0%";

  if (selectedAgentId) {
    const agent = agents.find(a => a.id === selectedAgentId);
    if (agent) {
      agentPanel.classList.remove("hidden");
      agentDetails.innerHTML = buildAgentDetails(agent);
    } else {
      agentPanel.classList.add("hidden");
    }
  }
}

function buildAgentDetails(agent) {
  const traits = Object.entries(agent.brain)
    .map(([name, value]) => {
      return `<div><span class="title">${name}</span><div class="trait-bar"><span style="width:${(value * 100).toFixed(0)}%"></span></div></div>`;
    })
    .join("");

  const trustList = Array.from(agent.memory.trust.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, score]) => `<li>#${id}: ${(score * 100).toFixed(0)}%</li>`)
    .join("");

  const grudgeList = Array.from(agent.memory.grudges.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, score]) => `<li>#${id}: ${(score * 100).toFixed(0)}%</li>`)
    .join("");

  const language = Array.from(agent.memory.language.entries())
    .map(([concept, { token }]) => `<li>${concept}: ${token}</li>`)
    .join("");

  return `
    <div>Agent <span class="title">#${agent.id}</span></div>
    <div>Energy: ${agent.energy.toFixed(0)} • HP: ${agent.hp.toFixed(0)} • Age: ${agent.age.toFixed(1)}</div>
    <div>Inventory: food ${agent.inventory.food}, water ${agent.inventory.water}, wood ${agent.inventory.wood}, metal ${agent.inventory.metal}, rare ${agent.inventory.rare}, token ${agent.inventory.token}</div>
    <div>Leader: ${agent.social.leaderId || "None"} • Followers: ${agent.social.followers.size}</div>
    <div>Faction: ${agent.social.factionId || "Unaligned"} • Currency: ${agent.social.currencyName || "None"}</div>
    <div class="title">Traits</div>
    <div class="traits">${traits}</div>
    <div class="title">Trusted</div>
    <ul>${trustList || "<li>None</li>"}</ul>
    <div class="title">Grudges</div>
    <ul>${grudgeList || "<li>None</li>"}</ul>
    <div class="title">Language</div>
    <ul>${language}</ul>
  `;
}

function render() {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.scale(camera.zoom / 10, camera.zoom / 10);
  ctx.translate(-camera.x * 10, -camera.y * 10);

  // draw cells
  for (let x = 0; x < GRID_SIZE; x++) {
    for (let y = 0; y < GRID_SIZE; y++) {
      const cell = world[x][y];
      const richness = clamp((cell.food + cell.water + cell.wood + cell.metal * 2 + cell.rare * 10) / 80, 0, 1);
      const color = `rgba(${Math.floor(20 + richness * 120)}, ${Math.floor(40 + richness * 140)}, ${Math.floor(60 + richness * 100)}, 0.55)`;
      ctx.fillStyle = color;
      ctx.fillRect(x * 10, y * 10, 10, 10);
    }
  }

  agents.forEach(agent => {
    const aggression = agent.brain.aggression;
    const ambition = agent.brain.ambition;
    const color = `hsl(${clamp(200 - aggression * 140 + ambition * 40, 0, 240)}, 80%, ${clamp(35 + ambition * 30, 20, 70)}%)`;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(agent.x * 10 + 5, agent.y * 10 + 5, Math.max(1.5, 2 + agent.social.followers.size * 0.1), 0, Math.PI * 2);
    ctx.fill();

    if (followAgentId === agent.id) {
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(agent.x * 10 + 5, agent.y * 10 + 5, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  ctx.restore();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * window.devicePixelRatio;
  canvas.height = rect.height * window.devicePixelRatio;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
  render();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

canvas.addEventListener("mousedown", startDrag);
canvas.addEventListener("mousemove", dragCamera);
canvas.addEventListener("mouseup", endDrag);
canvas.addEventListener("mouseleave", endDrag);
canvas.addEventListener("wheel", onZoom, { passive: true });
canvas.addEventListener("click", onCanvasClick);

let touchStartDistance = null;
let touchStartCenter = null;
canvas.addEventListener("touchstart", onTouchStart, { passive: false });
canvas.addEventListener("touchmove", onTouchMove, { passive: false });
canvas.addEventListener("touchend", onTouchEnd);
canvas.addEventListener("touchcancel", onTouchEnd);

function startDrag(event) {
  camera.dragging = true;
  camera.dragStart = { x: event.clientX, y: event.clientY, cx: camera.x, cy: camera.y };
}

function dragCamera(event) {
  if (!camera.dragging) return;
  const dx = (event.clientX - camera.dragStart.x) / (camera.zoom * 1.2);
  const dy = (event.clientY - camera.dragStart.y) / (camera.zoom * 1.2);
  camera.x = clamp(camera.dragStart.cx - dx, 0, GRID_SIZE);
  camera.y = clamp(camera.dragStart.cy - dy, 0, GRID_SIZE);
  render();
}

function endDrag() {
  camera.dragging = false;
}

function onZoom(event) {
  camera.zoom = clamp(camera.zoom + (event.deltaY > 0 ? -1 : 1), 4, 25);
  render();
}

function canvasToWorld(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;
  const worldX = ((x / window.devicePixelRatio) - canvas.width / (2 * window.devicePixelRatio)) / (camera.zoom / 10) + camera.x * 10;
  const worldY = ((y / window.devicePixelRatio) - canvas.height / (2 * window.devicePixelRatio)) / (camera.zoom / 10) + camera.y * 10;
  return { x: worldX / 10, y: worldY / 10 };
}

function onCanvasClick(event) {
  const worldPos = canvasToWorld(event.clientX, event.clientY);
  const target = agents.reduce((closest, agent) => {
    const dist = (agent.x - worldPos.x) ** 2 + (agent.y - worldPos.y) ** 2;
    if (!closest || dist < closest.dist) {
      return { agent, dist };
    }
    return closest;
  }, null);
  if (target && target.dist < 9) {
    selectedAgentId = target.agent.id;
    followAgentId = target.agent.id;
    render();
    updateStats();
  }
}

function onTouchStart(event) {
  if (event.touches.length === 1) {
    camera.dragging = true;
    camera.dragStart = { x: event.touches[0].clientX, y: event.touches[0].clientY, cx: camera.x, cy: camera.y };
  } else if (event.touches.length === 2) {
    event.preventDefault();
    touchStartDistance = getTouchDistance(event.touches);
    touchStartCenter = getTouchCenter(event.touches);
  }
}

function onTouchMove(event) {
  if (event.touches.length === 1 && camera.dragging) {
    const touch = event.touches[0];
    const dx = (touch.clientX - camera.dragStart.x) / (camera.zoom * 1.2);
    const dy = (touch.clientY - camera.dragStart.y) / (camera.zoom * 1.2);
    camera.x = clamp(camera.dragStart.cx - dx, 0, GRID_SIZE);
    camera.y = clamp(camera.dragStart.cy - dy, 0, GRID_SIZE);
    render();
  } else if (event.touches.length === 2) {
    event.preventDefault();
    const distance = getTouchDistance(event.touches);
    if (touchStartDistance) {
      const scaleChange = distance / touchStartDistance;
      camera.zoom = clamp(camera.zoom * scaleChange, 4, 25);
    }
    touchStartDistance = distance;
    touchStartCenter = getTouchCenter(event.touches);
    render();
  }
}

function onTouchEnd(event) {
  camera.dragging = false;
  touchStartDistance = null;
  touchStartCenter = null;
}

function getTouchDistance(touches) {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function getTouchCenter(touches) {
  const x = (touches[0].clientX + touches[1].clientX) / 2;
  const y = (touches[0].clientY + touches[1].clientY) / 2;
  return { x, y };
}

function saveSimulation() {
  const state = {
    tickCount,
    world,
    agents: agents.map(agent => ({
      ...agent,
      memory: {
        trust: Array.from(agent.memory.trust.entries()),
        lastInteracted: Array.from(agent.memory.lastInteracted.entries()),
        grudges: Array.from(agent.memory.grudges.entries()),
        history: agent.memory.history,
        language: Array.from(agent.memory.language.entries())
      },
      social: {
        ...agent.social,
        followers: Array.from(agent.social.followers)
      }
    })),
    agentIdCounter
  };
  localStorage.setItem("emergent-sim", JSON.stringify(state));
}

function loadSimulation() {
  const raw = localStorage.getItem("emergent-sim");
  if (!raw) return;
  try {
    const state = JSON.parse(raw);
    tickCount = state.tickCount;
    world = state.world;
    agentIdCounter = state.agentIdCounter;
    agents = state.agents.map(rawAgent => {
      const agent = { ...rawAgent };
      agent.memory = {
        trust: new Map(rawAgent.memory.trust),
        lastInteracted: new Map(rawAgent.memory.lastInteracted),
        grudges: new Map(rawAgent.memory.grudges),
        history: rawAgent.memory.history,
        language: new Map(rawAgent.memory.language)
      };
      agent.social = {
        ...rawAgent.social,
        followers: new Set(rawAgent.social.followers)
      };
      return agent;
    });
  } catch (error) {
    console.error("Failed to load simulation", error);
  }
}

pauseBtn.addEventListener("click", () => clearInterval(timerHandle));
resumeBtn.addEventListener("click", () => {
  clearInterval(timerHandle);
  timerHandle = setInterval(tick, currentTickInterval);
});
saveBtn.addEventListener("click", saveSimulation);
loadBtn.addEventListener("click", () => {
  loadSimulation();
  render();
  updateStats();
});

let currentTickInterval = TICK_INTERVAL_DEFAULT;
speedSlider.addEventListener("input", event => {
  currentTickInterval = Number(event.target.value);
  clearInterval(timerHandle);
  timerHandle = setInterval(tick, currentTickInterval);
});

function runSimulation() {
  initWorld();
  initAgents();
  tickCount = 0;
  clearInterval(timerHandle);
  timerHandle = setInterval(tick, currentTickInterval);
}

runSimulation();

setInterval(() => {
  if (followAgentId) {
    const agent = agents.find(a => a.id === followAgentId);
    if (agent) {
      camera.x += (agent.x - camera.x) * 0.1;
      camera.y += (agent.y - camera.y) * 0.1;
      render();
    }
  }
}, 100);
