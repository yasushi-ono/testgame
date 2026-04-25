const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const overlay = document.querySelector("#overlay");
const overlayKicker = document.querySelector("#overlay-kicker");
const overlayTitle = document.querySelector("#overlay-title");
const overlayCopy = document.querySelector("#overlay-copy");
const startButton = document.querySelector("#start-button");
const restartButton = document.querySelector("#restart-button");
const hpFill = document.querySelector("#hp-fill");
const energyFill = document.querySelector("#energy-fill");
const hpValue = document.querySelector("#hp-value");
const energyValue = document.querySelector("#energy-value");
const distanceValue = document.querySelector("#distance-value");
const comboValue = document.querySelector("#combo-value");
const message = document.querySelector("#message");
const touchButtons = [...document.querySelectorAll("[data-touch]")];

const WIDTH = canvas.width;
const HEIGHT = canvas.height;
const FLOOR_Y = 590;
const GOAL_DISTANCE = 4200;
const ASSETS = {
  background: "./assets/cyber-city-bg.png",
  playerIdle: "./assets/operative-idle.png",
  playerCrouch: "./assets/operative-crouch.png",
  playerRun1: "./assets/operative-run-1.png",
  playerRun2: "./assets/operative-run-2.png",
  playerRun3: "./assets/operative-run-3.png",
  playerRun4: "./assets/operative-run-4.png",
  playerJump: "./assets/operative-jump.png",
  playerShoot: "./assets/operative-shoot.png",
  drone: "./assets/drone.png"
};

const keys = new Set();
const touchState = { left: false, right: false, jump: false, shoot: false, burst: false };

const game = {
  screen: "loading",
  assets: {},
  worldSpeed: 340,
  time: 0,
  distance: 0,
  combo: 1,
  comboTimer: 0,
  messageTimer: 0,
  shake: 0,
  spawnTimers: { drone: 1.4, pickup: 8 },
  player: null,
  bullets: [],
  enemyBullets: [],
  drones: [],
  pickups: [],
  particles: [],
  lastTime: performance.now()
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", reject);
    image.src = src;
  });
}

function removeCheckerboardBackground(image) {
  const buffer = document.createElement("canvas");
  buffer.width = image.width;
  buffer.height = image.height;
  const bufferCtx = buffer.getContext("2d", { willReadFrequently: true });
  bufferCtx.drawImage(image, 0, 0);

  const imageData = bufferCtx.getImageData(0, 0, buffer.width, buffer.height);
  const { data } = imageData;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const brightness = (r + g + b) / 3;
    const maxChannelGap = Math.max(Math.abs(r - g), Math.abs(g - b), Math.abs(r - b));

    if (brightness >= 210 && maxChannelGap <= 18) {
      data[index + 3] = 0;
    } else if (brightness >= 175 && maxChannelGap <= 14) {
      data[index + 3] = Math.max(0, Math.round((210 - brightness) * 5));
    }
  }

  bufferCtx.putImageData(imageData, 0, 0);
  return buffer;
}

function setMessage(text) {
  message.textContent = text;
}

function createPlayerRenderMetrics(source = game.assets.playerIdle, poseKey = "idle") {
  const targetHeight = poseKey === "crouch" ? 184 : 232;
  const aspect = source.width / source.height;
  const width = Math.round(targetHeight * aspect);

  return {
    width,
    height: targetHeight,
    hitboxOffsetX: Math.round(width * 0.34),
    hitboxOffsetY: Math.round(targetHeight * 0.21),
    hitboxWidth: Math.round(width * 0.3),
    hitboxHeight: Math.round(targetHeight * 0.68)
  };
}

function getRunFrameIndex(player) {
  return Math.floor(player.bob / 0.44) % 4;
}

function getPlayerPoseKey(player) {
  if (player.crouching && player.onGround) {
    return "crouch";
  }
  if (player.isFiring) {
    return "shoot";
  }
  if (!player.onGround) {
    return "jump";
  }
  if (Math.abs(player.vx) > 20) {
    return "run";
  }
  return "idle";
}

function getPlayerPoseImage(player) {
  const poseKey = getPlayerPoseKey(player);
  if (poseKey === "run") {
    return [
      game.assets.playerRun1,
      game.assets.playerRun2,
      game.assets.playerRun3,
      game.assets.playerRun4
    ][getRunFrameIndex(player)];
  }

  const poseMap = {
    idle: game.assets.playerIdle,
    crouch: game.assets.playerCrouch,
    jump: game.assets.playerJump,
    shoot: game.assets.playerShoot
  };

  return poseMap[poseKey] ?? game.assets.playerIdle;
}

function updateOverlay(mode) {
  if (mode === "hide") {
    overlay.classList.add("hidden");
    return;
  }

  overlay.classList.remove("hidden");
  restartButton.classList.toggle("hidden", mode === "ready");
  startButton.classList.toggle("hidden", mode !== "ready");
}

function resetPlayer() {
  const metrics = createPlayerRenderMetrics();
  return {
    x: 200,
    y: FLOOR_Y - metrics.height,
    lastX: 200,
    lastY: FLOOR_Y - metrics.height,
    width: metrics.width,
    height: metrics.height,
    hitboxOffsetX: metrics.hitboxOffsetX,
    hitboxOffsetY: metrics.hitboxOffsetY,
    hitboxWidth: metrics.hitboxWidth,
    hitboxHeight: metrics.hitboxHeight,
    vx: 0,
    vy: 0,
    onGround: true,
    hp: 100,
    maxHp: 100,
    energy: 100,
    shotCooldown: 0,
    burstCooldown: 0,
    invuln: 0,
    bob: 0,
    facing: 1,
    crouching: false,
    isFiring: false
  };
}

function resetGame() {
  game.screen = "ready";
  game.time = 0;
  game.distance = 0;
  game.combo = 1;
  game.comboTimer = 0;
  game.shake = 0;
  game.spawnTimers = { drone: 1.4, pickup: 8 };
  game.player = resetPlayer();
  game.bullets = [];
  game.enemyBullets = [];
  game.drones = [];
  game.pickups = [];
  game.particles = [];
  setMessage("回収艇が待機中。屋上帯を突破してください。");
  updateOverlay("ready");
  syncHud();
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function playerHitbox() {
  const player = game.player;
  return {
    x: player.x + player.hitboxOffsetX,
    y: player.y + player.hitboxOffsetY,
    width: player.hitboxWidth,
    height: player.hitboxHeight
  };
}

function createBullet(kind = "normal") {
  const player = game.player;
  const burst = kind === "burst";
  game.bullets.push({
    kind,
    x: player.x + 130,
    y: player.y + 104,
    width: burst ? 44 : 20,
    height: burst ? 14 : 8,
    vx: burst ? 980 : 760,
    damage: burst ? 3 : 1,
    ttl: burst ? 0.7 : 0.45
  });

  game.shake = Math.max(game.shake, burst ? 10 : 4);
  player.shotCooldown = burst ? 0.16 : 0.18;
  if (burst) {
    player.energy = Math.max(0, player.energy - 35);
    player.burstCooldown = 0.8;
    setMessage("Piercing burst online.");
  }
}

function damagePlayer(amount) {
  const player = game.player;
  if (player.invuln > 0 || game.screen !== "playing") {
    return;
  }

  player.hp = Math.max(0, player.hp - amount);
  player.invuln = 0.75;
  game.combo = 1;
  game.comboTimer = 0;
  game.shake = Math.max(game.shake, 14);
  setMessage(`被弾しました。HP -${amount}`);

  if (player.hp <= 0) {
    game.screen = "gameover";
    overlayKicker.textContent = "Mission Failed";
    overlayTitle.textContent = "追撃網に捕まりました";
    overlayCopy.textContent = "もう一度侵入ルートを走り直し、回収艇までたどり着いてください。";
    updateOverlay("result");
  }
}

function destroyDrone(drone) {
  drone.dead = true;
  game.combo = Math.min(9, game.combo + 1);
  game.comboTimer = 2.8;
  setMessage(`Drone down. Combo x${game.combo}`);
  game.shake = Math.max(game.shake, 9);

  if (Math.random() < 0.55) {
    game.pickups.push({
      type: Math.random() < 0.65 ? "energy" : "med",
      x: drone.x + 12,
      y: drone.y + 30,
      width: 28,
      height: 28,
      vx: -game.worldSpeed,
      bob: Math.random() * Math.PI
    });
  }
}

function spawnDrone() {
  game.drones.push({
    x: WIDTH + 60,
    y: 180 + Math.random() * 170,
    width: 200,
    height: 110,
    hp: Math.random() < 0.45 ? 3 : 2,
    bob: Math.random() * Math.PI * 2,
    shootTimer: 1.1 + Math.random() * 0.8
  });
}

function spawnPickup() {
  game.pickups.push({
    type: "energy",
    x: WIDTH + 30,
    y: 340 + Math.random() * 140,
    width: 28,
    height: 28,
    vx: -game.worldSpeed,
    bob: Math.random() * Math.PI
  });
}

function handleInput(dt) {
  const player = game.player;
  const moveLeft = keys.has("ArrowLeft") || keys.has("KeyA") || touchState.left;
  const moveRight = keys.has("ArrowRight") || keys.has("KeyD") || touchState.right;
  const wantJump = keys.has("Space") || keys.has("ArrowUp") || touchState.jump;
  const wantShoot = keys.has("KeyJ") || keys.has("KeyF") || touchState.shoot;
  const wantBurst = keys.has("KeyK") || touchState.burst;
  const wantCrouch = keys.has("ArrowDown") || keys.has("KeyS");
  const minX = 80;
  const maxX = WIDTH - player.width - 140;

  player.crouching = wantCrouch && player.onGround;
  player.isFiring = (wantShoot || wantBurst) && !player.crouching;

  if (player.crouching) {
    player.vx *= 0.68;
  } else if (moveLeft && !moveRight) {
    player.vx = -180;
    player.facing = -1;
  } else if (moveRight && !moveLeft) {
    player.vx = 180;
    player.facing = 1;
  } else {
    player.vx *= 0.82;
  }

  if (wantJump && player.onGround && !player.crouching) {
    player.vy = -760;
    player.onGround = false;
    setMessage("Jump thrusters engaged.");
  }

  if (wantShoot && player.shotCooldown <= 0) {
    createBullet("normal");
  }

  if (wantBurst && player.burstCooldown <= 0 && player.energy >= 35 && !player.crouching) {
    createBullet("burst");
  }

  player.x = Math.max(minX, Math.min(maxX, player.x + player.vx * dt));
  game.worldSpeed = 340 + (moveRight ? 60 : 0) - (moveLeft ? 35 : 0);
}

function updatePlayer(dt) {
  const player = game.player;
  handleInput(dt);
  player.lastX = player.x;
  player.lastY = player.y;
  player.vy += 1800 * dt;
  player.y += player.vy * dt;

  if (player.y >= FLOOR_Y - player.height) {
    player.y = FLOOR_Y - player.height;
    player.vy = 0;
    player.onGround = true;
  }

  player.shotCooldown = Math.max(0, player.shotCooldown - dt);
  player.burstCooldown = Math.max(0, player.burstCooldown - dt);
  player.invuln = Math.max(0, player.invuln - dt);
  player.energy = Math.min(100, player.energy + dt * 8);
  player.bob += dt * (player.onGround ? Math.max(2.2, Math.abs(player.vx) * 0.028) : 1.6);
}

function updateEntities(dt) {
  game.spawnTimers.drone -= dt;
  game.spawnTimers.pickup -= dt;

  if (game.spawnTimers.drone <= 0) {
    spawnDrone();
    game.spawnTimers.drone = 1.05 + Math.random() * 0.75;
  }
  if (game.spawnTimers.pickup <= 0) {
    spawnPickup();
    game.spawnTimers.pickup = 7 + Math.random() * 4;
  }

  for (const bullet of game.bullets) {
    bullet.x += bullet.vx * dt;
    bullet.ttl -= dt;
  }
  game.bullets = game.bullets.filter((bullet) => bullet.ttl > 0 && bullet.x < WIDTH + 140);

  for (const bullet of game.enemyBullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.ttl -= dt;
  }
  game.enemyBullets = game.enemyBullets.filter((bullet) => bullet.ttl > 0 && bullet.x > -80);

  for (const drone of game.drones) {
    drone.x -= (game.worldSpeed + 40) * dt;
    drone.bob += dt * 3;
    drone.y += Math.sin(drone.bob) * 18 * dt;
    drone.shootTimer -= dt;
    if (drone.shootTimer <= 0 && drone.x > 360) {
      const target = playerHitbox();
      const dx = target.x - drone.x;
      const dy = target.y - drone.y;
      const scale = Math.max(1, Math.hypot(dx, dy));
      game.enemyBullets.push({
        x: drone.x + 18,
        y: drone.y + drone.height / 2,
        width: 16,
        height: 6,
        vx: (dx / scale) * 420 - 100,
        vy: (dy / scale) * 420,
        ttl: 3
      });
      drone.shootTimer = 1.25 + Math.random() * 0.9;
    }
  }
  game.drones = game.drones.filter((drone) => !drone.dead && drone.x > -260);
  for (const pickup of game.pickups) {
    pickup.x += pickup.vx * dt;
    pickup.bob += dt * 4;
  }
  game.pickups = game.pickups.filter((pickup) => pickup.x > -80);
}

function resolveCollisions() {
  const hitbox = playerHitbox();

  for (const bullet of game.enemyBullets) {
    if (rectsOverlap(hitbox, bullet)) {
      bullet.ttl = 0;
      damagePlayer(10);
    }
  }

  for (const pickup of game.pickups) {
    if (rectsOverlap(hitbox, pickup)) {
      pickup.x = -200;
      if (pickup.type === "med") {
        game.player.hp = Math.min(game.player.maxHp, game.player.hp + 25);
        setMessage("Med patch secured. HP restored.");
      } else {
        game.player.energy = Math.min(100, game.player.energy + 32);
        setMessage("Energy cell acquired.");
      }
    }
  }

  for (const bullet of game.bullets) {
    for (const drone of game.drones) {
      if (rectsOverlap(bullet, drone)) {
        drone.hp -= bullet.damage;
        if (bullet.kind !== "burst") {
          bullet.ttl = 0;
        }
        if (drone.hp <= 0) {
          destroyDrone(drone);
        }
      }
    }
  }
}

function updateWorld(dt) {
  game.distance = Math.min(GOAL_DISTANCE, game.distance + game.worldSpeed * dt * 0.33);
  game.time += dt;

  if (game.comboTimer > 0) {
    game.comboTimer -= dt;
    if (game.comboTimer <= 0) {
      game.combo = 1;
    }
  }

  if (game.distance >= GOAL_DISTANCE && game.screen === "playing") {
    game.screen = "victory";
    overlayKicker.textContent = "Extraction Complete";
    overlayTitle.textContent = "Moonline secured";
    overlayCopy.textContent = "追撃網を突破しました。もう一度走るとランダム配置が少し変化します。";
    updateOverlay("result");
    setMessage("回収艇へ到達。ミッション成功。");
  }
}

function syncHud() {
  const player = game.player;
  hpFill.style.width = `${(player.hp / player.maxHp) * 100}%`;
  energyFill.style.width = `${player.energy}%`;
  hpValue.textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
  energyValue.textContent = `${Math.floor(player.energy)} / 100`;
  distanceValue.textContent = `${Math.floor(game.distance)} m / ${GOAL_DISTANCE} m`;
  comboValue.textContent = `x${game.combo}`;
}

function drawBackground() {
  const bg = game.assets.background;
  const scroll = (game.distance * 0.45) % WIDTH;
  const ratio = Math.max(WIDTH / bg.width, HEIGHT / bg.height);
  const drawWidth = bg.width * ratio;
  const drawHeight = bg.height * ratio;
  const y = HEIGHT - drawHeight;

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.drawImage(bg, -scroll, y, drawWidth, drawHeight);
  ctx.drawImage(bg, drawWidth - scroll - 2, y, drawWidth, drawHeight);
  ctx.restore();

  const gradient = ctx.createLinearGradient(0, HEIGHT * 0.4, 0, HEIGHT);
  gradient.addColorStop(0, "rgba(6, 11, 31, 0)");
  gradient.addColorStop(1, "rgba(5, 7, 15, 0.82)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawRooftop() {
  const stripe = (game.distance * 0.9) % 160;
  ctx.fillStyle = "#111728";
  ctx.fillRect(0, FLOOR_Y, WIDTH, HEIGHT - FLOOR_Y);

  for (let x = -160 - stripe; x < WIDTH + 160; x += 160) {
    ctx.fillStyle = "#1f2b4e";
    ctx.fillRect(x, FLOOR_Y + 4, 130, 20);
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(x + 12, FLOOR_Y + 34, 40, 60);
    ctx.fillStyle = "rgba(103, 228, 255, 0.26)";
    ctx.fillRect(x + 8, FLOOR_Y + 18, 114, 3);
  }
}

function drawPickups() {
  for (const pickup of game.pickups) {
    const bob = Math.sin(pickup.bob) * 8;
    ctx.save();
    ctx.translate(pickup.x + pickup.width / 2, pickup.y + pickup.height / 2 + bob);
    ctx.rotate(pickup.bob * 0.2);
    ctx.fillStyle = pickup.type === "med" ? "rgba(120, 255, 181, 0.95)" : "rgba(98, 228, 255, 0.92)";
    ctx.fillRect(-12, -12, 24, 24);
    ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
    ctx.fillRect(-3, -9, 6, 18);
    ctx.fillRect(-9, -3, 18, 6);
    ctx.restore();
  }
}

function drawPlayer() {
  const player = game.player;
  const poseKey = getPlayerPoseKey(player);
  const poseImage = getPlayerPoseImage(player);
  const poseMetrics = createPlayerRenderMetrics(poseImage, poseKey);
  const moving = poseKey === "run";
  const runFrame = moving ? getRunFrameIndex(player) : 0;
  const runBobPattern = [-1.4, 0.6, 1.4, -0.6];
  const runStridePattern = [-2.4, 0.8, 2.4, -0.8];
  const runFrameOffsetPattern = [-6, -2, 6, 2];
  const bob = player.onGround ? (moving ? runBobPattern[runFrame] : Math.sin(player.bob) * 1.8) : 0;
  const strideX = moving ? runStridePattern[runFrame] * player.facing : 0;
  const runFrameOffsetX = moving ? runFrameOffsetPattern[runFrame] : 0;
  const crouchDrop = poseKey === "crouch" ? 18 : 0;
  const anchorX = player.x + player.width * 0.42 + strideX;
  const anchorY = player.y + player.height + bob + crouchDrop;
  const anchorOffsetX = poseMetrics.width * 0.34;
  ctx.save();
  ctx.globalAlpha = player.invuln > 0 && Math.floor(player.invuln * 16) % 2 === 0 ? 0.55 : 1;
  ctx.translate(anchorX, anchorY);
  ctx.scale(player.facing, 1);
  ctx.drawImage(
    poseImage,
    -anchorOffsetX + runFrameOffsetX,
    -poseMetrics.height,
    poseMetrics.width,
    poseMetrics.height
  );
  ctx.restore();
}

function drawDrones() {
  for (const drone of game.drones) {
    ctx.drawImage(game.assets.drone, drone.x, drone.y, drone.width, drone.height);
  }
}

function drawProjectiles() {
  for (const bullet of game.bullets) {
    ctx.fillStyle = bullet.kind === "burst" ? "#ffd267" : "#8ce9ff";
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  }

  for (const bullet of game.enemyBullets) {
    ctx.fillStyle = "#ff688d";
    ctx.fillRect(bullet.x, bullet.y, bullet.width, bullet.height);
  }
}

function drawGoalBeacon() {
  const remaining = GOAL_DISTANCE - game.distance;
  if (remaining > 760) {
    return;
  }

  const x = WIDTH - 160 + (760 - remaining) * 0.24;
  ctx.fillStyle = "rgba(90, 228, 255, 0.18)";
  ctx.fillRect(x, 0, 10, FLOOR_Y);
  ctx.fillStyle = "#8bf1ff";
  ctx.beginPath();
  ctx.arc(x + 5, 110, 28, 0, Math.PI * 2);
  ctx.fill();
}

function drawFrame() {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  const shakeX = game.shake > 0 ? (Math.random() - 0.5) * game.shake : 0;
  const shakeY = game.shake > 0 ? (Math.random() - 0.5) * game.shake : 0;
  ctx.save();
  ctx.translate(shakeX, shakeY);
  drawBackground();
  drawGoalBeacon();
  drawRooftop();
  drawPickups();
  drawDrones();
  drawProjectiles();
  drawPlayer();
  ctx.restore();

  if (game.shake > 0) {
    game.shake = Math.max(0, game.shake - 1.2);
  }
}

function tick(now) {
  const dt = Math.min(0.032, (now - game.lastTime) / 1000);
  game.lastTime = now;

  if (game.screen === "playing") {
    updatePlayer(dt);
    updateEntities(dt);
    resolveCollisions();
    updateWorld(dt);
    syncHud();
  }

  drawFrame();
  requestAnimationFrame(tick);
}

function beginPlay() {
  resetGame();
  game.screen = "playing";
  updateOverlay("hide");
  setMessage("Moonline infiltration started.");
}

function bindInputs() {
  window.addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "KeyA", "KeyD", "KeyJ", "KeyF", "KeyK"].includes(event.code)) {
      event.preventDefault();
    }
    keys.add(event.code);
    if (event.code === "Enter" && (game.screen === "ready" || game.screen === "gameover" || game.screen === "victory")) {
      beginPlay();
    }
    if (event.code === "Escape" && game.screen === "playing") {
      game.screen = "paused";
      overlayKicker.textContent = "Paused";
      overlayTitle.textContent = "作戦を一時停止中";
      overlayCopy.textContent = "Esc で再開、またはボタンで最初からやり直せます。";
      updateOverlay("result");
    } else if (event.code === "Escape" && game.screen === "paused") {
      game.screen = "playing";
      updateOverlay("hide");
    }
  });

  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });

  for (const button of touchButtons) {
    const key = button.dataset.touch;
    const setPressed = (value) => {
      touchState[key] = value;
    };

    button.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      setPressed(true);
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener("pointerup", () => setPressed(false));
    button.addEventListener("pointercancel", () => setPressed(false));
    button.addEventListener("pointerleave", () => setPressed(false));
  }

  startButton.addEventListener("click", beginPlay);
  restartButton.addEventListener("click", beginPlay);
}

async function init() {
  bindInputs();
  try {
      const [
        background,
        playerIdle,
        playerCrouch,
        playerRun1,
        playerRun2,
        playerRun3,
        playerRun4,
        playerJump,
        playerShoot,
        drone
      ] = await Promise.all([
        loadImage(ASSETS.background),
        loadImage(ASSETS.playerIdle),
        loadImage(ASSETS.playerCrouch),
        loadImage(ASSETS.playerRun1),
        loadImage(ASSETS.playerRun2),
        loadImage(ASSETS.playerRun3),
        loadImage(ASSETS.playerRun4),
        loadImage(ASSETS.playerJump),
        loadImage(ASSETS.playerShoot),
        loadImage(ASSETS.drone)
      ]);
      game.assets = {
        background,
        playerIdle: removeCheckerboardBackground(playerIdle),
        playerCrouch: removeCheckerboardBackground(playerCrouch),
        playerRun1: removeCheckerboardBackground(playerRun1),
        playerRun2: removeCheckerboardBackground(playerRun2),
        playerRun3: removeCheckerboardBackground(playerRun3),
        playerRun4: removeCheckerboardBackground(playerRun4),
        playerJump: removeCheckerboardBackground(playerJump),
        playerShoot: removeCheckerboardBackground(playerShoot),
        drone: removeCheckerboardBackground(drone)
      };
      resetGame();
  } catch (error) {
    overlayKicker.textContent = "Load Error";
    overlayTitle.textContent = "アセットの読み込みに失敗しました";
    overlayCopy.textContent = "ページを再読み込みしてください。";
    updateOverlay("result");
    console.error(error);
  }

  requestAnimationFrame((now) => {
    game.lastTime = now;
    requestAnimationFrame(tick);
  });
}

init();
