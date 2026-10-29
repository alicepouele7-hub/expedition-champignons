/* Compatibilité : roundRect n'existe pas sur les anciens navigateurs mobiles
   (sans ça, le jeu plante dès le premier dessin du personnage) */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    r = Math.min(Array.isArray(r) ? r[0] : (r || 0), w / 2, h / 2);
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
  };
}

/* ============================================================================
   PARTIE 1 : SIMULATION DE RANDONNÉE & CUEILLETTE EN MONTAGNE (SANS EMOJIS)
   ============================================================================ */

const fCanvas = document.getElementById('forest-canvas');
const fCtx = fCanvas.getContext('2d');

const WORLD_W = 2400;
const WORLD_H = 2400;
const TARGET_BASKET = 6;

// Base de données botanique réaliste (Comestibles vs Sosies Toxiques)
const SPECIES_DB = [
  {
    id: 'cepe',
    name: 'Cèpe de Bordeaux',
    edible: true,
    minAlt: 350, maxAlt: 780,
    habitat: 'Sous les chênes et hêtres, à mi-pente',
    capDesc: 'Brun noisette lisse, charnu et bombé',
    underDesc: 'Tubes serrés blanc crème à jaune-vert (mousse)',
    stemDesc: 'Pied ventru beige clair avec un fin réseau blanc. Odeur agréable de sous-bois.',
    colors: { cap: '#6e4726', stem: '#e6ccb2', under: '#d9ed92', spots: null }
  },
  {
    id: 'satan',
    name: 'Bolet Satan',
    edible: false,
    minAlt: 300, maxAlt: 750,
    habitat: 'Clairières calcaires et lisières de mi-pente',
    capDesc: 'Blanc grisâtre à mastic, très massif',
    underDesc: 'Pores jaune-orangé virant au rouge sang',
    stemDesc: 'Pied très trapu jaune en haut et rouge carmin au milieu. Odeur forte désagréable.',
    colors: { cap: '#d6ccc2', stem: '#c1121f', under: '#e63946', spots: null }
  },
  {
    id: 'girolle',
    name: 'Girolle (Chanterelle)',
    edible: true,
    minAlt: 200, maxAlt: 550,
    habitat: 'Mousse humide des vallées et basses collines',
    capDesc: 'Jaune d\'œuf doré, sinueux en entonnoir',
    underDesc: 'Plis épais et espacés descendant sur le pied',
    stemDesc: 'Pied plein jaune clair rétréci à la base. Douce odeur fruitée d\'abricot.',
    colors: { cap: '#ffb703', stem: '#fcbf49', under: '#fb8500', funnel: true }
  },
  {
    id: 'fausse_girolle',
    name: 'Chanterelle Orangée (Fausse Girolle)',
    edible: false,
    minAlt: 200, maxAlt: 600,
    habitat: 'Souches de conifères et humus acide',
    capDesc: 'Orange vif à rouille sombre, bord très enroulé',
    underDesc: 'Vraies lamelles fines et très serrées (non des plis)',
    stemDesc: 'Pied grêle, élastique et souvent creux. Aucune odeur fruitée.',
    colors: { cap: '#d62828', stem: '#f77f00', under: '#e36414', funnel: true }
  },
  {
    id: 'morille',
    name: 'Morille Conique',
    edible: true,
    minAlt: 620, maxAlt: 980,
    habitat: 'Pentes rocailleuses et sapinières de haute montagne',
    capDesc: 'Brun sombre pointu, creusé d\'alvéoles régulières en nid d\'abeille',
    underDesc: 'Chapeau directement soudé au pied, intérieur entièrement creux',
    stemDesc: 'Pied cylindrique blanc crème, surface légèrement farineuse.',
    colors: { cap: '#432818', stem: '#ede0d4', honeycomb: true }
  },
  {
    id: 'gyromitre',
    name: 'Gyromitre (Fausse Morille)',
    edible: false,
    minAlt: 600, maxAlt: 980,
    habitat: 'Sols sablonneux de montagne sous les pins',
    capDesc: 'Brun-roux difforme ressemblant à une cervelle plissée',
    underDesc: 'Lobes tortueux irréguliers (pas d\'alvéoles en nid d\'abeille)',
    stemDesc: 'Pied court blanchâtre creusé de cavités multiples. Toxique mortel.',
    colors: { cap: '#7f2b1e', stem: '#e5d5c5', brain: true }
  }
];

let hiker = {
  x: 1200,
  y: 2150, // Départ en bas de la vallée (basse altitude)
  radius: 16,
  angle: -Math.PI / 2,
  stamina: 100,
  hydration: 100,
  canteen: 3,
  stepPhase: 0
};

let joy = { active: false, dx: 0, dy: 0 };
let forestActive = false;
let gameMinutes = 8 * 60; // 08h00 du matin
let weatherFog = 0.08;

let trees = [];
let rocks = [];
let hidingSpots = []; // Amas de feuilles, mousse ou fougères
let restStumps = [];  // Souches pour s'asseoir et récupérer
let basket = [];
let nearbyAction = null;
let inspectedSpot = null;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Calcul topographique : Le Nord (y proche de 0) est en haute montagne (950m)
// Le Sud (y proche de 2400) est en vallée traversée par un ruisseau (200m)
function getAltitudeAt(x, y) {
  const baseSlope = (1 - (y / WORLD_H)) * 680; // 0m au sud -> 680m au nord
  const ridge1 = Math.sin(x / 280) * Math.cos(y / 320) * 75;
  const peak = Math.exp(-((x - 1200) ** 2 + (y - 450) ** 2) / 280000) * 180;
  return Math.round(200 + baseSlope + ridge1 + peak);
}

// Hauteur du ruisseau qui serpente dans la vallée (autour de y = 1850)
function getStreamY(x) {
  return 1850 + Math.sin(x / 220) * 70;
}

function tryLandscapeLock() {
  try {
    const isPhone = window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 900;
    if (!isPhone) return;
    const el = document.documentElement;
    const p = (!document.fullscreenElement && el.requestFullscreen) ? el.requestFullscreen() : Promise.resolve();
    Promise.resolve(p).then(() => {
      if (screen.orientation && screen.orientation.lock) return screen.orientation.lock('landscape');
    }).catch(() => {});
  } catch (e) {}
}

let lastFrame = 0;

function startExpedition() {
  tryLandscapeLock();
  lastFrame = 0;
  showScreen('screen-forest');
  resizeForestCanvas();
  window.addEventListener('resize', resizeForestCanvas);
  window.addEventListener('orientationchange', () => setTimeout(resizeForestCanvas, 250));

  hiker.x = 1200;
  hiker.y = 2150;
  hiker.stamina = 100;
  hiker.hydration = 100;
  hiker.canteen = 3;
  basket = [];
  gameMinutes = 8 * 60;

  generateMountainWorld();
  initJoystick();
  updateHUD();

  forestActive = true;
  requestAnimationFrame(forestLoop);
}

function resizeForestCanvas() {
  fCanvas.width = window.innerWidth;
  fCanvas.height = window.innerHeight;
}

function generateMountainWorld() {
  trees = [];
  rocks = [];
  hidingSpots = [];
  restStumps = [];

  // 1. Générer 140 arbres (Chênes en bas/milieu, Sapins en haute montagne)
  for (let i = 0; i < 140; i++) {
    const tx = 80 + Math.random() * (WORLD_W - 160);
    const ty = 80 + Math.random() * (WORLD_H - 160);
    if (Math.abs(ty - getStreamY(tx)) < 55) continue; // Éviter le lit du ruisseau

    const alt = getAltitudeAt(tx, ty);
    trees.push({
      x: tx,
      y: ty,
      radius: 28 + Math.random() * 16,
      conifer: alt > 580 || (alt > 450 && Math.random() > 0.5)
    });
  }

  // 2. Générer 45 rochers d'altitude
  for (let i = 0; i < 45; i++) {
    const rx = 80 + Math.random() * (WORLD_W - 160);
    const ry = 80 + Math.random() * (WORLD_H - 160);
    if (Math.abs(ry - getStreamY(rx)) < 50) continue;
    rocks.push({
      x: rx,
      y: ry,
      rx: 18 + Math.random() * 18,
      ry: 14 + Math.random() * 14
    });
  }

  // 3. Générer 12 souches de repos
  for (let i = 0; i < 12; i++) {
    const sx = 200 + Math.random() * (WORLD_W - 400);
    const sy = 200 + Math.random() * (WORLD_H - 400);
    restStumps.push({ x: sx, y: sy, radius: 16 });
  }

  // 4. Générer 55 cachettes naturelles au pied des arbres (Feuilles mortes, Mousse, Fougères)
  trees.forEach((t, idx) => {
    if (idx % 2 === 0 || Math.random() < 0.35) {
      const angle = Math.random() * Math.PI * 2;
      const dist = t.radius + 12 + Math.random() * 18;
      const sx = Math.max(60, Math.min(WORLD_W - 60, t.x + Math.cos(angle) * dist));
      const sy = Math.max(60, Math.min(WORLD_H - 60, t.y + Math.sin(angle) * dist));
      const alt = getAltitudeAt(sx, sy);

      // Choisir une espèce compatible avec cette altitude (ou rien dans 25% des cas)
      let content = null;
      if (Math.random() < 0.78) {
        const validSpecies = SPECIES_DB.filter(s => alt >= s.minAlt && alt <= s.maxAlt);
        if (validSpecies.length > 0) {
          content = validSpecies[Math.floor(Math.random() * validSpecies.length)];
        }
      }

      const coverTypes = ['feuilles', 'mousse', 'fougeres'];
      hidingSpots.push({
        x: sx,
        y: sy,
        radius: 18,
        cover: coverTypes[Math.floor(Math.random() * coverTypes.length)],
        searched: false,
        species: content,
        altitude: alt
      });
    }
  });
}

function initJoystick() {
  const zone = document.getElementById('joystick-zone');
  const stick = document.getElementById('joystick-stick');
  const maxR = 34;

  function moveStick(clientX, clientY) {
    const rect = zone.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > maxR) {
      dx = (dx / d) * maxR;
      dy = (dy / d) * maxR;
    }
    stick.style.transform = `translate(${dx}px, ${dy}px)`;
    joy.dx = dx / maxR;
    joy.dy = dy / maxR;
  }

  function resetStick() {
    joy.active = false;
    joy.dx = 0;
    joy.dy = 0;
    stick.style.transform = `translate(0px, 0px)`;
  }

  // On suit UN doigt précis : appuyer sur un bouton avec l'autre main ne coupe plus le joystick
  let joyPointerId = null;
  zone.onpointerdown = (e) => {
    e.preventDefault();
    joyPointerId = e.pointerId;
    joy.active = true;
    try { zone.setPointerCapture(e.pointerId); } catch (err) {}
    moveStick(e.clientX, e.clientY);
  };
  zone.onpointermove = (e) => {
    if (joy.active && e.pointerId === joyPointerId) moveStick(e.clientX, e.clientY);
  };
  const endJoy = (e) => {
    if (e.pointerId === joyPointerId) { joyPointerId = null; resetStick(); }
  };
  zone.onpointerup = endJoy;
  zone.onpointercancel = endJoy;
  zone.onlostpointercapture = endJoy;
}

function forestLoop(now) {
  if (!forestActive) return;
  const dt = lastFrame ? Math.min(3, (now - lastFrame) / 16.667) : 1;
  lastFrame = now;

  // Avancée de l'heure (1 seconde réelle = ~1.5 minute en jeu)
  gameMinutes += 0.025 * dt;
  weatherFog = 0.05 + Math.max(0, (getAltitudeAt(hiker.x, hiker.y) - 500) / 1400);

  const prevAlt = getAltitudeAt(hiker.x, hiker.y);

  // Calcul de la vitesse selon l'endurance, l'hydratation et la pente
  const isMoving = Math.hypot(joy.dx, joy.dy) > 0.08;
  let slopeLabel = "Plat";

  if (isMoving && hiker.stamina > 1) {
    let baseSpeed = 2.9;
    if (hiker.stamina < 25) baseSpeed *= 0.55;
    if (hiker.hydration < 20) baseSpeed *= 0.7;

    // Tester l'altitude cible pour calculer l'effort de montée
    const testX = hiker.x + joy.dx * baseSpeed;
    const testY = hiker.y + joy.dy * baseSpeed;
    const nextAlt = getAltitudeAt(testX, testY);
    const altDiff = nextAlt - prevAlt;

    let slopeFactor = 1.0;
    let staminaDrain = 0.045;

    if (altDiff > 0.35) {
      slopeLabel = "Montée raide";
      slopeFactor = 0.58; // Monter ralentit fortement
      staminaDrain = 0.14; // Et épuise 3x plus vite
    } else if (altDiff > 0.1) {
      slopeLabel = "Faux-plat montant";
      slopeFactor = 0.78;
      staminaDrain = 0.085;
    } else if (altDiff < -0.2) {
      slopeLabel = "Descente";
      slopeFactor = 1.15;
      staminaDrain = 0.03;
    }

    const finalX = hiker.x + joy.dx * baseSpeed * slopeFactor * dt;
    const finalY = hiker.y + joy.dy * baseSpeed * slopeFactor * dt;

    // Collision avec les rochers et troncs d'arbres
    let blocked = false;
    for (const r of rocks) {
      if (Math.hypot(finalX - r.x, finalY - r.y) < hiker.radius + r.rx * 0.8) {
        blocked = true; break;
      }
    }
    for (const t of trees) {
      if (Math.hypot(finalX - t.x, finalY - t.y) < hiker.radius + 10) {
        blocked = true; break;
      }
    }

    if (!blocked) {
      hiker.x = Math.max(40, Math.min(WORLD_W - 40, finalX));
      hiker.y = Math.max(40, Math.min(WORLD_H - 40, finalY));
    }

    hiker.angle = Math.atan2(joy.dy, joy.dx);
    hiker.stepPhase += 0.18 * dt;
    hiker.stamina = Math.max(0, hiker.stamina - staminaDrain * dt);
    hiker.hydration = Math.max(0, hiker.hydration - 0.038 * dt);
  } else {
    // Récupération lente à l'arrêt
    const recovRate = hiker.hydration > 30 ? 0.12 : 0.04;
    hiker.stamina = Math.min(100, hiker.stamina + recovRate * dt);
  }

  // Détection des éléments interactifs proches (Cachette, Ruisseau, Souche)
  checkNearbyInteractions();

  // Mise à jour de l'interface
  updateHUD(slopeLabel);

  // Rendu graphique sur le Canvas
  renderForestScene();

  requestAnimationFrame(forestLoop);
}

function checkNearbyInteractions() {
  const btnSearch = document.getElementById('btn-search');
  nearbyAction = null;

  // 1. Proche du ruisseau ?
  const streamDist = Math.abs(hiker.y - getStreamY(hiker.x));
  if (streamDist < 42) {
    nearbyAction = { type: 'stream' };
    btnSearch.innerText = "Remplir la gourde";
    btnSearch.classList.remove('disabled');
    return;
  }

  // 2. Proche d'une souche de repos ?
  for (const st of restStumps) {
    if (Math.hypot(hiker.x - st.x, hiker.y - st.y) < 38) {
      nearbyAction = { type: 'stump', target: st };
      btnSearch.innerText = "S'asseoir (Repos)";
      btnSearch.classList.remove('disabled');
      return;
    }
  }

  // 3. Proche d'un amas de feuilles/mousse non fouillé ?
  for (const spot of hidingSpots) {
    if (!spot.searched && Math.hypot(hiker.x - spot.x, hiker.y - spot.y) < 42) {
      nearbyAction = { type: 'spot', target: spot };
      btnSearch.innerText = `Fouiller (${spot.cover})`;
      btnSearch.classList.remove('disabled');
      return;
    }
  }

  btnSearch.innerText = "Fouiller le sol";
  btnSearch.classList.add('disabled');
}

function interactSpot() {
  if (!nearbyAction) return;
  const banner = document.getElementById('forest-banner');

  if (nearbyAction.type === 'stream') {
    hiker.canteen = 3;
    hiker.hydration = Math.min(100, hiker.hydration + 40);
    document.getElementById('canteen-uses').innerText = hiker.canteen;
    banner.innerText = "Gourde remplie à l'eau fraîche du torrent de montagne !";
    return;
  }

  if (nearbyAction.type === 'stump') {
    hiker.stamina = Math.min(100, hiker.stamina + 45);
    gameMinutes += 12;
    banner.innerText = "Tu t'assois 10 minutes sur la souche. Ton souffle revient.";
    return;
  }

  if (nearbyAction.type === 'spot') {
    if (hiker.stamina < 8) {
      banner.innerText = "Tu es trop essoufflée pour fouiller ! Repose-toi ou bois une gorgée.";
      return;
    }
    hiker.stamina = Math.max(0, hiker.stamina - 6);
    const spot = nearbyAction.target;
    spot.searched = true;

    if (!spot.species) {
      banner.innerText = "Tu écartes doucement l'humus... Rien que des brindilles et de la mousse.";
    } else {
      openInspectionModal(spot);
    }
  }
}

function useCanteen() {
  const banner = document.getElementById('forest-banner');
  if (hiker.canteen <= 0) {
    banner.innerText = "Ta gourde est vide ! Redescends vers le ruisseau au sud pour la remplir.";
    return;
  }
  hiker.canteen--;
  hiker.hydration = Math.min(100, hiker.hydration + 45);
  hiker.stamina = Math.min(100, hiker.stamina + 25);
  document.getElementById('canteen-uses').innerText = hiker.canteen;
  banner.innerText = "Une bonne gorgée d'eau fraîche ! Endurance et hydratation restaurées.";
}

function openInspectionModal(spot) {
  inspectedSpot = spot;
  const sp = spot.species;
  document.getElementById('spec-habitat').innerText = `${sp.habitat} (Alt. ${spot.altitude}m)`;
  document.getElementById('spec-cap').innerText = sp.capDesc;
  document.getElementById('spec-under').innerText = sp.underDesc;
  document.getElementById('spec-stem').innerText = sp.stemDesc;

  drawDetailedSpecimen(sp);
  document.getElementById('modal-inspect').classList.remove('hidden');
}

function drawDetailedSpecimen(sp) {
  const c = document.getElementById('inspect-canvas');
  const cx = c.getContext('2d');
  cx.clearRect(0, 0, c.width, c.height);

  // Fond sous-bois
  cx.fillStyle = '#1f2b1b';
  cx.fillRect(0, 0, c.width, c.height);

  // Sol moussu
  cx.fillStyle = '#3b522f';
  cx.beginPath();
  cx.ellipse(110, 155, 85, 18, 0, 0, Math.PI * 2);
  cx.fill();

  cx.save();
  cx.translate(110, 145);

  if (sp.colors.honeycomb || sp.colors.brain) {
    // Pied de Morille / Gyromitre
    cx.fillStyle = sp.colors.stem;
    cx.beginPath();
    cx.roundRect(-16, -55, 32, 55, 8);
    cx.fill();

    // Chapeau conique ou cérébriforme
    cx.fillStyle = sp.colors.cap;
    cx.beginPath();
    if (sp.colors.honeycomb) {
      cx.moveTo(0, -120);
      cx.quadraticCurveTo(36, -85, 26, -50);
      cx.lineTo(-26, -50);
      cx.quadraticCurveTo(-36, -85, 0, -120);
      cx.fill();
      // Alvéoles régulières
      cx.strokeStyle = '#7f5539';
      cx.lineWidth = 2;
      for (let y = -100; y <= -60; y += 14) {
        for (let x = -14; x <= 14; x += 14) {
          cx.strokeRect(x - 4, y - 4, 8, 9);
        }
      }
    } else {
      // Gyromitre (plis cérébraux irréguliers)
      cx.arc(0, -80, 32, 0, Math.PI * 2);
      cx.fill();
      cx.strokeStyle = '#4a120b';
      cx.lineWidth = 3;
      cx.beginPath();
      cx.arc(-10, -85, 12, 0, Math.PI);
      cx.arc(10, -75, 14, Math.PI, Math.PI * 2);
      cx.stroke();
    }
  } else if (sp.colors.funnel) {
    // Girolle ou Fausse Girolle (En entonnoir)
    cx.fillStyle = sp.colors.stem;
    cx.beginPath();
    cx.moveTo(-12, 0);
    cx.lineTo(-24, -65);
    cx.lineTo(24, -65);
    cx.lineTo(12, 0);
    cx.closePath();
    cx.fill();

    // Plis ou lamelles sous le chapeau
    cx.strokeStyle = sp.colors.under;
    cx.lineWidth = sp.id === 'girolle' ? 2.5 : 1;
    const step = sp.id === 'girolle' ? 6 : 3;
    for (let x = -22; x <= 22; x += step) {
      cx.beginPath();
      cx.moveTo(x, -65);
      cx.lineTo(x * 0.4, -20);
      cx.stroke();
    }

    // Chapeau ondulé
    cx.fillStyle = sp.colors.cap;
    cx.beginPath();
    cx.ellipse(0, -68, 42, 14, 0, 0, Math.PI * 2);
    cx.fill();
  } else {
    // Bolet (Cèpe ou Bolet Satan) : gros pied ventru
    cx.fillStyle = sp.colors.stem;
    cx.beginPath();
    cx.ellipse(0, -32, 24, 34, 0, 0, Math.PI * 2);
    cx.fill();

    // Dessous du chapeau (tubes)
    cx.fillStyle = sp.colors.under;
    cx.beginPath();
    cx.ellipse(0, -64, 46, 12, 0, 0, Math.PI * 2);
    cx.fill();

    // Dôme du chapeau
    cx.fillStyle = sp.colors.cap;
    cx.beginPath();
    cx.arc(0, -64, 46, Math.PI, 0);
    cx.fill();
  }

  cx.restore();
}

function leaveMushroom() {
  document.getElementById('modal-inspect').classList.add('hidden');
  document.getElementById('forest-banner').innerText = "Tu laisses ce spécimen intact dans son biotope.";
}

function harvestMushroom() {
  document.getElementById('modal-inspect').classList.add('hidden');
  const sp = inspectedSpot.species;
  const banner = document.getElementById('forest-banner');

  if (sp.edible) {
    basket.push(sp);
    banner.innerText = `Belle prise ! Tu coupes délicatement le pied du ${sp.name} et le places dans ton panier.`;
    if (basket.length >= TARGET_BASKET) {
      forestActive = false;
      banner.innerText = "Ton panier est bien garni ! Il est temps de redescendre au chalet cuisiner.";
      setTimeout(initKitchen, 1400);
    }
  } else {
    // Pénalité réaliste en cas d'erreur d'identification
    hiker.stamina = Math.max(10, hiker.stamina - 25);
    if (basket.length > 0) basket.pop();
    banner.innerText = `Attention ! C'était un ${sp.name} (toxique) ! Il a contaminé le champignon voisin dans ton panier, tu dois le jeter.`;
  }
}

function toggleGuide() {
  document.getElementById('modal-guide').classList.toggle('hidden');
}

function updateHUD(slopeLabel = "Plat") {
  document.getElementById('stamina-bar').style.width = `${hiker.stamina}%`;
  document.getElementById('water-bar').style.width = `${hiker.hydration}%`;
  document.getElementById('alt-val').innerText = getAltitudeAt(hiker.x, hiker.y);
  document.getElementById('slope-val').innerText = slopeLabel;
  document.getElementById('basket-val').innerText = basket.length;

  const hrs = Math.floor(gameMinutes / 60);
  const mins = Math.floor(gameMinutes % 60);
  document.getElementById('time-val').innerText = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function renderForestScene() {
  fCtx.clearRect(0, 0, fCanvas.width, fCanvas.height);

  const camX = hiker.x - fCanvas.width / 2;
  const camY = hiker.y - fCanvas.height / 2;

  fCtx.save();
  fCtx.translate(-camX, -camY);

  // 1. Fond topographique par bandes d'altitude + courbes de niveau
  for (let y = 0; y < WORLD_H; y += 80) {
    const ratio = 1 - y / WORLD_H;
    // Plus on monte au nord, plus le sol devient rocailleux/alpin
    const r = Math.round(45 + ratio * 28);
    const g = Math.round(68 + ratio * 15);
    const b = Math.round(38 + ratio * 22);
    fCtx.fillStyle = `rgb(${r},${g},${b})`;
    fCtx.fillRect(0, y, WORLD_W, 82);

    // Ligne topographique de dénivelé
    fCtx.strokeStyle = 'rgba(255,255,255,0.07)';
    fCtx.lineWidth = 1.5;
    fCtx.beginPath();
    for (let x = 0; x <= WORLD_W; x += 60) {
      const waveY = y + Math.sin(x / 280) * 25;
      if (x === 0) fCtx.moveTo(x, waveY);
      else fCtx.lineTo(x, waveY);
    }
    fCtx.stroke();
  }

  // 2. Dessiner le ruisseau de montagne dans la vallée
  fCtx.strokeStyle = '#3a86ff';
  fCtx.lineWidth = 34;
  fCtx.lineCap = 'round';
  fCtx.beginPath();
  for (let x = 0; x <= WORLD_W; x += 40) {
    const sy = getStreamY(x);
    if (x === 0) fCtx.moveTo(x, sy);
    else fCtx.lineTo(x, sy);
  }
  fCtx.stroke();
  // Reflets d'eau
  fCtx.strokeStyle = '#90e0ef';
  fCtx.lineWidth = 10;
  fCtx.stroke();

  // 3. Dessiner les souches de repos
  restStumps.forEach(st => {
    fCtx.fillStyle = '#5c3a21';
    fCtx.beginPath();
    fCtx.arc(st.x, st.y, st.radius, 0, Math.PI * 2);
    fCtx.fill();
    fCtx.fillStyle = '#ddb892';
    fCtx.beginPath();
    fCtx.arc(st.x, st.y, st.radius * 0.7, 0, Math.PI * 2);
    fCtx.fill();
  });

  // 4. Dessiner les cachettes d'humus (Feuilles mortes, Mousse, Fougères)
  hidingSpots.forEach(spot => {
    fCtx.save();
    fCtx.translate(spot.x, spot.y);
    if (spot.searched) {
      // Terre retournée
      fCtx.fillStyle = 'rgba(42, 28, 18, 0.65)';
      fCtx.beginPath();
      fCtx.ellipse(0, 0, 14, 9, 0, 0, Math.PI * 2);
      fCtx.fill();
    } else {
      if (spot.cover === 'feuilles') {
        fCtx.fillStyle = '#9c5221';
        [-6, 0, 6].forEach((ox, i) => {
          fCtx.beginPath();
          fCtx.ellipse(ox, (i % 2) * 4 - 2, 9, 5, i, 0, Math.PI * 2);
          fCtx.fill();
        });
      } else if (spot.cover === 'mousse') {
        fCtx.fillStyle = '#6a994e';
        fCtx.beginPath();
        fCtx.arc(0, 0, 13, 0, Math.PI * 2);
        fCtx.fill();
      } else {
        // Fougères
        fCtx.strokeStyle = '#4f772d';
        fCtx.lineWidth = 3;
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 3) {
          fCtx.beginPath();
          fCtx.moveTo(0, 0);
          fCtx.lineTo(Math.cos(a) * 15, Math.sin(a) * 15);
          fCtx.stroke();
        }
      }
    }
    fCtx.restore();
  });

  // 5. Dessiner les rochers
  rocks.forEach(r => {
    fCtx.fillStyle = '#6c757d';
    fCtx.beginPath();
    fCtx.ellipse(r.x, r.y, r.rx, r.ry, 0.2, 0, Math.PI * 2);
    fCtx.fill();
    fCtx.fillStyle = '#adb5bd';
    fCtx.beginPath();
    fCtx.ellipse(r.x - 4, r.y - 4, r.rx * 0.6, r.ry * 0.5, 0.2, 0, Math.PI * 2);
    fCtx.fill();
  });

  // 6. Dessiner la randonneuse (vue de dessus, avec sac à dos et panier)
  drawHikerTopDown();

  // 7. Dessiner les arbres (Feuillus et Conifères)
  trees.forEach(t => {
    fCtx.save();
    fCtx.translate(t.x, t.y);
    // Ombre portée
    fCtx.fillStyle = 'rgba(0,0,0,0.28)';
    fCtx.beginPath();
    fCtx.arc(8, 10, t.radius, 0, Math.PI * 2);
    fCtx.fill();

    if (t.conifer) {
      // Sapin de montagne en étoile
      fCtx.fillStyle = '#1b4332';
      fCtx.beginPath();
      fCtx.arc(0, 0, t.radius, 0, Math.PI * 2);
      fCtx.fill();
      fCtx.fillStyle = '#2d6a4f';
      fCtx.beginPath();
      fCtx.arc(0, 0, t.radius * 0.65, 0, Math.PI * 2);
      fCtx.fill();
    } else {
      // Chêne / Hêtre d'automne
      fCtx.fillStyle = '#386641';
      fCtx.beginPath();
      fCtx.arc(0, 0, t.radius, 0, Math.PI * 2);
      fCtx.fill();
      fCtx.fillStyle = '#6a994e';
      fCtx.beginPath();
      fCtx.arc(-5, -5, t.radius * 0.6, 0, Math.PI * 2);
      fCtx.fill();
    }
    fCtx.restore();
  });

  fCtx.restore();

  // Brouillard d'altitude & lumière de fin de journée
  const duskAlpha = Math.max(0, (gameMinutes - 16 * 60) / 300);
  if (weatherFog + duskAlpha > 0) {
    fCtx.fillStyle = `rgba(210, 220, 215, ${Math.min(0.45, weatherFog)})`;
    fCtx.fillRect(0, 0, fCanvas.width, fCanvas.height);
  }
}

function drawHikerTopDown() {
  fCtx.save();
  fCtx.translate(hiker.x, hiker.y);
  fCtx.rotate(hiker.angle);

  // Pieds qui marchent
  const footOffset = Math.sin(hiker.stepPhase) * 6;
  fCtx.fillStyle = '#3d2817';
  fCtx.fillRect(footOffset, -10, 8, 5);
  fCtx.fillRect(-footOffset, 5, 8, 5);

  // Sac à dos de randonnée
  fCtx.fillStyle = '#9c6644';
  fCtx.beginPath();
  fCtx.roundRect(-14, -10, 10, 20, 4);
  fCtx.fill();

  // Épaules / Veste coupe-vent
  fCtx.fillStyle = '#bc4749';
  fCtx.beginPath();
  fCtx.ellipse(0, 0, 10, 14, 0, 0, Math.PI * 2);
  fCtx.fill();

  // Panier en osier tenu sur le côté
  fCtx.fillStyle = '#dda15e';
  fCtx.strokeStyle = '#8c5a2b';
  fCtx.lineWidth = 1.5;
  fCtx.beginPath();
  fCtx.ellipse(4, 15, 7, 5, 0, 0, Math.PI * 2);
  fCtx.fill();
  fCtx.stroke();

  // Tête / Chapeau de randonnée
  fCtx.fillStyle = '#4a3222';
  fCtx.beginPath();
  fCtx.arc(2, 0, 8, 0, Math.PI * 2);
  fCtx.fill();

  fCtx.restore();
}

/* ============================================================================
   PARTIE 2 : SIMULATION DE CUISINE RÉALISTE EN 6 ÉTAPES (CANVAS INTERACTIF)
   ============================================================================ */

const kCanvas = document.getElementById('kitchen-canvas');
const kCtx = kCanvas.getContext('2d');

let kStep = 1;
let kProgress = 0;
let kItems = [];
let kPointerDown = false;
let lastPointer = { x: 0, y: 0 };
let kAnimId = null;

// Variables de cuisson (Étapes 3, 4, 5, 6)
let butterMelted = false;
let panHeat = 1; // 1: Doux, 2: Moyen, 3: Vif
let panTemp = 40;
let moistureLevel = 100;
let omeletteCook = 0;
let omeletteBurn = 0;
let eggsInBowl = 0;
let seasonedSalt = false;
let seasonedPepper = false;
let foldStage = 0;

function initKitchen() {
  showScreen('screen-kitchen');
  kStep = 1;
  kLastFrame = 0;
  setupKitchenStep();
  setupKitchenInput();
  if (kAnimId) cancelAnimationFrame(kAnimId);
  kitchenLoop();
}

function setupKitchenStep() {
  kProgress = 0;
  updateKitchenProgress(0);
  document.getElementById('k-step-num').innerText = kStep;
  document.getElementById('k-next-btn').classList.add('hidden');
  const extra = document.getElementById('k-extra-controls');
  extra.innerHTML = '';
  extra.classList.add('hidden');

  if (kStep === 1) {
    document.getElementById('k-step-title').innerText = "Brossage à sec des champignons";
    document.getElementById('k-step-desc').innerText = "Frotte chaque champignon avec ton doigt pour éliminer la terre et les aiguilles de pin sans les gorger d'eau.";
    // Placer 4 champignons sur la planche avec des taches de terre
    kItems = [
      { x: 95, y: 110, dirt: 100, sp: basket[0] || SPECIES_DB[0] },
      { x: 255, y: 110, dirt: 100, sp: basket[1] || SPECIES_DB[2] },
      { x: 95, y: 250, dirt: 100, sp: basket[2] || SPECIES_DB[4] },
      { x: 255, y: 250, dirt: 100, sp: basket[3] || SPECIES_DB[0] }
    ];
  } else if (kStep === 2) {
    document.getElementById('k-step-title').innerText = "Éminçage au couteau d'office";
    document.getElementById('k-step-desc').innerText = "Glisse ton doigt verticalement (comme une lame de couteau) sur chaque champignon nettoyé pour les trancher en lamelles régulières.";
    kItems.forEach(item => { item.slices = 0; });
  } else if (kStep === 3) {
    document.getElementById('k-step-title').innerText = "Faire suer les champignons au beurre";
    document.getElementById('k-step-desc').innerText = "Fais fondre la noix de beurre, puis fais glisser ton doigt en cercles dans la poêle pour remuer les champignons jusqu'à évaporation complète de leur eau.";
    moistureLevel = 100;
  } else if (kStep === 4) {
    document.getElementById('k-step-title').innerText = "Cassage, battage et assaisonnement";
    document.getElementById('k-step-desc').innerText = "Tapote les 4 œufs pour les casser dans la jatte, ajoute le sel et le poivre du moulin, puis fouette énergiquement en faisant des cercles.";
    eggsInBowl = 0;
    seasonedSalt = false;
    seasonedPepper = false;
    extra.classList.remove('hidden');
    extra.innerHTML = `
      <button class="btn-secondary" onclick="addEggToBowl()">Casser un œuf (0/4)</button>
      <button class="btn-secondary" onclick="seasonBowl('salt')">Pincée de Sel</button>
      <button class="btn-secondary" onclick="seasonBowl('pepper')">Tour de Poivre</button>
    `;
  } else if (kStep === 5) {
    document.getElementById('k-step-title').innerText = "Cuisson maîtrisée de l'omelette";
    document.getElementById('k-step-desc').innerText = "Gère l'intensité du feu et incline doucement la poêle (glisse ton doigt) pour répartir l'œuf. Garde la température dans la zone idéale sans brûler !";
    panHeat = 2;
    panTemp = 55;
    omeletteCook = 0;
    omeletteBurn = 0;
    extra.classList.remove('hidden');
    extra.innerHTML = `
      <button class="btn-secondary" onclick="setBurner(1)">Feu Doux</button>
      <button class="btn-primary" onclick="setBurner(2)">Feu Moyen</button>
      <button class="btn-secondary" onclick="setBurner(3)">Feu Vif</button>
    `;
  } else if (kStep === 6) {
    document.getElementById('k-step-title').innerText = "Roulage à la spatule & Dressage";
    document.getElementById('k-step-desc').innerText = "Glisse ton doigt de gauche à droite sur l'omelette baveuse pour la replier délicatement en chausson doré.";
    foldStage = 0;
  }
}

function addEggToBowl() {
  if (eggsInBowl < 4) {
    eggsInBowl++;
    const btn = document.querySelector('#k-extra-controls button');
    if (btn) btn.innerText = `Casser un œuf (${eggsInBowl}/4)`;
  }
}

function seasonBowl(type) {
  if (type === 'salt') seasonedSalt = true;
  if (type === 'pepper') seasonedPepper = true;
}

function setBurner(level) {
  panHeat = level;
  const btns = document.querySelectorAll('#k-extra-controls button');
  btns.forEach((b, idx) => {
    b.className = (idx + 1 === level) ? 'btn-primary' : 'btn-secondary';
  });
}

function setupKitchenInput() {
  function getCanvasPos(e) {
    const rect = kCanvas.getBoundingClientRect();
    const scaleX = kCanvas.width / rect.width;
    const scaleY = kCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  kCanvas.onpointerdown = (e) => {
    kPointerDown = true;
    try { kCanvas.setPointerCapture(e.pointerId); } catch (err) {}
    lastPointer = getCanvasPos(e);
  };

  kCanvas.onpointermove = (e) => {
    if (!kPointerDown) return;
    const pos = getCanvasPos(e);
    const moveDist = Math.hypot(pos.x - lastPointer.x, pos.y - lastPointer.y);

    if (kStep === 1) {
      // Brossage de la terre sur chaque champignon
      kItems.forEach(item => {
        if (Math.hypot(pos.x - item.x, pos.y - item.y) < 55 && item.dirt > 0) {
          item.dirt = Math.max(0, item.dirt - moveDist * 0.45);
        }
      });
      const totalClean = kItems.reduce((acc, it) => acc + (100 - it.dirt), 0) / 4;
      updateKitchenProgress(totalClean);
    } else if (kStep === 2) {
      // Découpe verticale au couteau
      if (Math.abs(pos.y - lastPointer.y) > 12) {
        kItems.forEach(item => {
          if (Math.hypot(pos.x - item.x, pos.y - item.y) < 50 && item.slices < 4) {
            item.slices += 0.35;
          }
        });
        const totalSliced = kItems.reduce((acc, it) => acc + Math.min(4, it.slices), 0) / 16 * 100;
        updateKitchenProgress(totalSliced);
      }
    } else if (kStep === 3) {
      // Faire sauter les champignons dans la poêle
      if (Math.hypot(pos.x - 180, pos.y - 180) < 120) {
        moistureLevel = Math.max(0, moistureLevel - moveDist * 0.18);
        updateKitchenProgress(100 - moistureLevel);
      }
    } else if (kStep === 4) {
      // Fouetter les œufs
      if (eggsInBowl === 4 && seasonedSalt && seasonedPepper) {
        if (Math.hypot(pos.x - 180, pos.y - 180) < 110) {
          kProgress = Math.min(100, kProgress + moveDist * 0.22);
          updateKitchenProgress(kProgress);
        }
      }
    } else if (kStep === 5) {
      // Répartir l'omelette dans la poêle pour homogénéiser la cuisson
      if (panTemp >= 50 && panTemp <= 82) {
        omeletteCook = Math.min(100, omeletteCook + moveDist * 0.08);
      }
    } else if (kStep === 6) {
      // Plier l'omelette de gauche à droite
      if (pos.x - lastPointer.x > 4) {
        foldStage = Math.min(100, foldStage + (pos.x - lastPointer.x) * 0.75);
        updateKitchenProgress(foldStage);
      }
    }

    lastPointer = pos;
  };

  window.addEventListener('pointerup', () => { kPointerDown = false; });
  window.addEventListener('pointercancel', () => { kPointerDown = false; });
}

function updateKitchenProgress(val) {
  kProgress = Math.min(100, Math.max(0, val));
  document.getElementById('k-progress-bar').style.width = `${kProgress}%`;
  if (kProgress >= 99) {
    document.getElementById('k-next-btn').classList.remove('hidden');
  }
}

function nextKitchenStep() {
  if (kStep < 6) {
    kStep++;
    setupKitchenStep();
  } else {
    cancelAnimationFrame(kAnimId);
    showFinalResult();
  }
}

let kLastFrame = 0;

function kitchenLoop(now) {
  const kdt = (now && kLastFrame) ? Math.min(3, (now - kLastFrame) / 16.667) : 1;
  if (now) kLastFrame = now;
  kCtx.clearRect(0, 0, kCanvas.width, kCanvas.height);

  if (kStep === 1 || kStep === 2) {
    // Planche à découper en bois massif
    kCtx.fillStyle = '#c9a275';
    kCtx.fillRect(20, 20, 320, 320);
    kCtx.strokeStyle = '#8c5a2b';
    kCtx.lineWidth = 4;
    kCtx.strokeRect(20, 20, 320, 320);

    kItems.forEach(item => {
      kCtx.save();
      kCtx.translate(item.x, item.y);

      if (kStep === 2 && item.slices >= 3.5) {
        // Champignon tranché en belles lamelles
        for (let s = -20; s <= 20; s += 14) {
          kCtx.fillStyle = '#e6ccb2';
          kCtx.fillRect(s - 4, -5, 8, 22);
          kCtx.fillStyle = item.sp.colors.cap;
          kCtx.beginPath();
          kCtx.arc(s, -5, 12, Math.PI, 0);
          kCtx.fill();
        }
      } else {
        // Champignon entier sur la planche
        kCtx.fillStyle = item.sp.colors.stem;
        kCtx.beginPath();
        kCtx.roundRect(-14, 0, 28, 36, 8);
        kCtx.fill();

        kCtx.fillStyle = item.sp.colors.cap;
        kCtx.beginPath();
        kCtx.arc(0, 2, 34, Math.PI, 0);
        kCtx.fill();

        // Traces de terre / mousse à brosser (Étape 1)
        if (kStep === 1 && item.dirt > 0) {
          kCtx.fillStyle = `rgba(45, 30, 15, ${item.dirt / 100})`;
          kCtx.beginPath();
          kCtx.arc(-10, -12, 12, 0, Math.PI * 2);
          kCtx.arc(12, -8, 10, 0, Math.PI * 2);
          kCtx.arc(0, 18, 9, 0, Math.PI * 2);
          kCtx.fill();
        }

        // Lignes de coupe (Étape 2)
        if (kStep === 2 && item.slices > 0) {
          kCtx.strokeStyle = '#f4efe6';
          kCtx.lineWidth = 2;
          for (let c = 1; c <= Math.floor(item.slices); c++) {
            const cx = -20 + c * 10;
            kCtx.beginPath();
            kCtx.moveTo(cx, -30);
            kCtx.lineTo(cx, 35);
            kCtx.stroke();
          }
        }
      }
      kCtx.restore();
    });
  } else if (kStep === 3) {
    // Grande poêle en fonte sur le feu
    drawCastIronPan();

    // Beurre fondu moussant
    kCtx.fillStyle = '#ffd166';
    kCtx.beginPath();
    kCtx.arc(180, 180, 95, 0, Math.PI * 2);
    kCtx.fill();

    // Eau de végétation des champignons qui s'évapore progressivement
    if (moistureLevel > 5) {
      kCtx.fillStyle = `rgba(140, 110, 75, ${(moistureLevel / 100) * 0.65})`;
      kCtx.beginPath();
      kCtx.arc(180, 180, 92, 0, Math.PI * 2);
      kCtx.fill();
    }

    // Lamelles de champignons qui dorent dans la poêle
    const roastRatio = (100 - moistureLevel) / 100;
    for (let i = 0; i < 14; i++) {
      const angle = i * 1.3 + roastRatio * 3;
      const dist = 25 + (i % 3) * 24;
      const mx = 180 + Math.cos(angle) * dist;
      const my = 180 + Math.sin(angle) * dist;

      kCtx.save();
      kCtx.translate(mx, my);
      kCtx.rotate(angle);
      kCtx.fillStyle = roastRatio > 0.6 ? '#7f4f24' : '#ddb892';
      kCtx.beginPath();
      kCtx.roundRect(-10, -6, 20, 12, 4);
      kCtx.fill();
      kCtx.restore();
    }
  } else if (kStep === 4) {
    // Saladier en verre / terre cuite pour battre les œufs
    kCtx.fillStyle = '#8c5a2b';
    kCtx.beginPath();
    kCtx.arc(180, 180, 115, 0, Math.PI * 2);
    kCtx.fill();

    kCtx.fillStyle = '#f4efe6';
    kCtx.beginPath();
    kCtx.arc(180, 180, 102, 0, Math.PI * 2);
    kCtx.fill();

    if (kProgress < 15) {
      // Afficher les jaunes d'œufs entiers
      for (let e = 0; e < eggsInBowl; e++) {
        const ex = 145 + (e % 2) * 70;
        const ey = 145 + Math.floor(e / 2) * 70;
        kCtx.fillStyle = 'rgba(255, 248, 220, 0.85)';
        kCtx.beginPath();
        kCtx.arc(ex, ey, 34, 0, Math.PI * 2);
        kCtx.fill();
        kCtx.fillStyle = '#fb8500';
        kCtx.beginPath();
        kCtx.arc(ex, ey, 16, 0, Math.PI * 2);
        kCtx.fill();
      }
    } else {
      // Mélange d'œufs battus mousseux
      kCtx.fillStyle = '#ffb703';
      kCtx.beginPath();
      kCtx.arc(180, 180, 92, 0, Math.PI * 2);
      kCtx.fill();

      // Tourbillon du fouet
      kCtx.strokeStyle = '#fb8500';
      kCtx.lineWidth = 3;
      kCtx.beginPath();
      kCtx.arc(180, 180, 45, 0, (kProgress / 100) * Math.PI * 2);
      kCtx.stroke();
    }

    // Grains de sel et poivre
    if (seasonedSalt) {
      kCtx.fillStyle = '#ffffff';
      for (let s = 0; s < 12; s++) kCtx.fillRect(140 + (s * 17) % 80, 140 + (s * 23) % 80, 3, 3);
    }
    if (seasonedPepper) {
      kCtx.fillStyle = '#2b2d42';
      for (let p = 0; p < 12; p++) kCtx.fillRect(145 + (p * 19) % 75, 135 + (p * 29) % 85, 3, 3);
    }
  } else if (kStep === 5) {
    // Cuisson thermique de l'omelette aux champignons
    const targetTemp = panHeat === 1 ? 42 : (panHeat === 2 ? 68 : 95);
    panTemp += (targetTemp - panTemp) * (1 - Math.pow(1 - 0.015, kdt));

    if (panTemp >= 52 && panTemp <= 82) {
      omeletteCook = Math.min(100, omeletteCook + 0.18 * kdt);
    } else if (panTemp > 82) {
      omeletteCook = Math.min(100, omeletteCook + 0.25 * kdt);
      omeletteBurn = Math.min(100, omeletteBurn + 0.22 * kdt);
    }

    updateKitchenProgress(omeletteCook);

    drawCastIronPan();

    // Disque de l'omelette
    const r = Math.round(255 - omeletteBurn * 1.1);
    const g = Math.round(195 - omeletteBurn * 1.2);
    const b = Math.round(45 - omeletteBurn * 0.4);
    kCtx.fillStyle = `rgb(${r},${g},${b})`;
    kCtx.beginPath();
    kCtx.arc(180, 180, 105, 0, Math.PI * 2);
    kCtx.fill();

    // Champignons intégrés dans l'omelette
    kCtx.fillStyle = '#6e4726';
    for (let i = 0; i < 12; i++) {
      const mx = 125 + (i * 37) % 110;
      const my = 125 + (i * 53) % 110;
      kCtx.beginPath();
      kCtx.roundRect(mx, my, 16, 10, 3);
      kCtx.fill();
    }

    // Jauge thermomètre sur le côté gauche du canvas
    kCtx.fillStyle = '#2b2d42';
    kCtx.fillRect(18, 60, 18, 240);
    // Zone verte idéale (52 à 82%)
    kCtx.fillStyle = '#4f772d';
    kCtx.fillRect(18, 60 + 240 * (1 - 0.82), 18, 240 * 0.30);
    // Curseur de température actuelle
    const ty = 60 + 240 * (1 - panTemp / 100);
    kCtx.fillStyle = '#e63946';
    kCtx.fillRect(14, ty - 4, 26, 8);
  } else if (kStep === 6) {
    // Pliage de l'omelette en chausson
    drawCastIronPan();

    const foldRatio = foldStage / 100;
    kCtx.save();
    kCtx.translate(180, 180);

    // Moitié droite fixe
    kCtx.fillStyle = '#f4a261';
    kCtx.beginPath();
    kCtx.arc(0, 0, 102, -Math.PI / 2, Math.PI / 2);
    kCtx.fill();

    // Moitié gauche qui se replie vers la droite
    kCtx.fillStyle = '#e9c46a';
    kCtx.beginPath();
    kCtx.ellipse(0, 0, 102 * Math.abs(1 - foldRatio * 1.6), 102, 0, Math.PI / 2, Math.PI * 1.5);
    kCtx.fill();

    kCtx.restore();
  }

  kAnimId = requestAnimationFrame(kitchenLoop);
}

function drawCastIronPan() {
  // Manche de la poêle
  kCtx.fillStyle = '#1d1e22';
  kCtx.fillRect(280, 165, 80, 30);
  // Corps de la poêle
  kCtx.fillStyle = '#2b2d42';
  kCtx.beginPath();
  kCtx.arc(180, 180, 125, 0, Math.PI * 2);
  kCtx.fill();
  kCtx.fillStyle = '#1d1e22';
  kCtx.beginPath();
  kCtx.arc(180, 180, 112, 0, Math.PI * 2);
  kCtx.fill();
}

function showFinalResult() {
  showScreen('screen-end');

  // Dessiner l'assiette finale
  const pCanvas = document.getElementById('final-plate-canvas');
  const pCtx = pCanvas.getContext('2d');
  pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);

  // Assiette en céramique
  pCtx.fillStyle = '#ffffff';
  pCtx.beginPath();
  pCtx.ellipse(120, 80, 105, 65, 0, 0, Math.PI * 2);
  pCtx.fill();
  pCtx.strokeStyle = '#d6ccc2';
  pCtx.lineWidth = 3;
  pCtx.stroke();

  // Omelette roulée dorée
  pCtx.fillStyle = omeletteBurn > 35 ? '#b07d4f' : '#f4a261';
  pCtx.beginPath();
  pCtx.ellipse(120, 80, 72, 36, -0.15, 0, Math.PI * 2);
  pCtx.fill();

  // Quelques lamelles de champignons sur le dessus et brins de ciboulette
  pCtx.fillStyle = '#6e4726';
  pCtx.fillRect(95, 70, 14, 8);
  pCtx.fillRect(125, 78, 14, 8);
  pCtx.strokeStyle = '#4f772d';
  pCtx.lineWidth = 2.5;
  pCtx.beginPath();
  pCtx.moveTo(105, 65); pCtx.lineTo(135, 85);
  pCtx.moveTo(115, 85); pCtx.lineTo(140, 68);
  pCtx.stroke();

  // Bilan des espèces cueillies et de la cuisson
  const uniqueNames = [...new Set(basket.map(b => b.name))];
  const cookQuality = omeletteBurn < 15 ? "Baveuse et dorée à souhait" : "Légèrement trop saisie mais savoureuse";

  document.getElementById('final-report').innerHTML = `
    <p><strong>Espèces sauvages récoltées :</strong> ${uniqueNames.join(', ')}</p>
    <p><strong>Maîtrise du feu :</strong> ${cookQuality}</p>
    <p><strong>Temps passé en montagne :</strong> Randonnée terminée à ${document.getElementById('time-val').innerText}</p>
  `;
}
