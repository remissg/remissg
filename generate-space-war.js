const https = require("https");
const fs = require("fs");

const USERNAME = "remissg";
const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const PAD_X = 20;
const PAD_Y = 20;

function graphqlRequest(token, query, variables) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query, variables });
    const options = {
      hostname: "api.github.com",
      path: "/graphql",
      method: "POST",
      headers: {
        "Authorization": `bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "space-war-generator"
      }
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(JSON.parse(data)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function getContributions() {
  const token = process.env.GITHUB_TOKEN;
  const query = `query($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks { contributionDays { contributionCount } }
        }
      }
    }
  }`;
  const result = await graphqlRequest(token, query, { login: USERNAME });
  const cal = result.data.user.contributionsCollection.contributionCalendar;
  const grid = cal.weeks.map(w => w.contributionDays.map(d => d.contributionCount));
  return { grid, total: cal.totalContributions };
}

function levelColor(count) {
  if (count === 0) return "#0a0a1a";
  if (count <= 2)  return "#0d2137";
  if (count <= 5)  return "#00b4d8";
  if (count <= 10) return "#7209b7";
  return "#f72585";
}

function rand(seed, max) {
  return Math.abs((seed * 1664525 + 1013904223) & 0x7fffffff) % max;
}

function buildSVG(grid, total) {
  const totalCols = grid.length;

  // Layout:
  // y=PAD_Y                          → top of grid
  // y=PAD_Y + 7*STEP                 → bottom of grid  (= GRID_BOTTOM)
  // y=GRID_BOTTOM + 10               → ship CENTER (animateMotion anchor)
  // ship nose tip = ship_center - 13 → fires laser upward into grid

  const GRID_BOTTOM = PAD_Y + 7 * STEP;   // ~154
  const SHIP_CENTER_Y = GRID_BOTTOM + 18; // ship center below grid
  const SHIP_NOSE_Y   = SHIP_CENTER_Y - 13; // tip of nose, points UP into grid
  const EXHAUST_Y     = SHIP_CENTER_Y + 9;  // exhaust flame, below center
  const HEIGHT = SHIP_CENTER_Y + 28;
  const WIDTH  = PAD_X * 2 + totalCols * STEP;

  const LOOP = totalCols * 0.14;
  const LASER_VISIBLE = 0.18;

  // Stars
  let stars = "";
  for (let i = 0; i < 90; i++) {
    const sx = rand(i * 7 + 1, WIDTH);
    const sy = rand(i * 13 + 3, HEIGHT);
    const sr = i % 4 === 0 ? 1.2 : 0.5;
    stars += `<circle cx="${sx}" cy="${sy}" r="${sr}" fill="white" opacity="${(0.3+(i%5)*0.1).toFixed(1)}"/>`;
  }

  // Grid cells
  let cells = "";
  for (let ci = 0; ci < grid.length; ci++) {
    for (let ri = 0; ri < grid[ci].length; ri++) {
      const x = PAD_X + ci * STEP;
      const y = PAD_Y + ri * STEP;
      const color = levelColor(grid[ci][ri]);
      const glow = grid[ci][ri] > 5 ? ` filter="url(#glow)"` : "";
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}"${glow}/>`;
    }
  }

  // Lasers + explosions — laser goes from SHIP_NOSE_Y upward to target cell
  let lasers = "", explosions = "";
  for (let ci = 0; ci < grid.length; ci++) {
    const col = grid[ci];
    const maxVal = Math.max(...col);
    if (maxVal < 2) continue;

    const targetRow = col.indexOf(maxVal);
    const lx = PAD_X + ci * STEP + CELL / 2;
    const laserStart = SHIP_NOSE_Y;              // bottom of laser = nose tip
    const laserEnd   = PAD_Y + targetRow * STEP + CELL / 2; // top = target cell

    const arriveTime = (ci / (totalCols - 1)) * LOOP;
    const t = [
      "0",
      (arriveTime / LOOP).toFixed(4),
      Math.min(1,(arriveTime + LASER_VISIBLE*0.1)/LOOP).toFixed(4),
      Math.min(1,(arriveTime + LASER_VISIBLE*0.85)/LOOP).toFixed(4),
      Math.min(1,(arriveTime + LASER_VISIBLE)/LOOP).toFixed(4),
      "1"
    ].join(";");

    lasers += `
    <line x1="${lx}" y1="${laserStart}" x2="${lx}" y2="${laserEnd}"
      stroke="#00ffff" stroke-width="2.5" stroke-linecap="round" opacity="0">
      <animate attributeName="opacity" dur="${LOOP}s" values="0;0;1;1;0;0" keyTimes="${t}" repeatCount="indefinite"/>
    </line>
    <line x1="${lx}" y1="${laserStart}" x2="${lx}" y2="${laserEnd}"
      stroke="#ffffff" stroke-width="0.8" stroke-linecap="round" opacity="0">
      <animate attributeName="opacity" dur="${LOOP}s" values="0;0;0.9;0.9;0;0" keyTimes="${t}" repeatCount="indefinite"/>
    </line>`;

    if (maxVal > 5) {
      explosions += `
      <g transform="translate(${lx},${laserEnd})" opacity="0">
        <circle r="0" fill="#f72585"><animate attributeName="r" dur="${LOOP}s" values="0;0;11;0;0;0" keyTimes="${t}" repeatCount="indefinite"/></circle>
        <circle r="0" fill="#fffb00" opacity="0.9"><animate attributeName="r" dur="${LOOP}s" values="0;0;6;0;0;0" keyTimes="${t}" repeatCount="indefinite"/></circle>
        <animate attributeName="opacity" dur="${LOOP}s" values="0;0;1;1;0;0" keyTimes="${t}" repeatCount="indefinite"/>
      </g>`;
    }
  }

  // Ship — center at (0,0) for animateMotion, nose at (0,-13) pointing UP
  // Wings spread at y=+8, exhaust flame at y=+9 pointing DOWN
  const x0 = PAD_X + CELL / 2;
  const x1 = PAD_X + (totalCols - 1) * STEP + CELL / 2;

  const ship = `
  <g>
    <!-- body: nose UP at (0,-13), base at y=+9 -->
    <polygon points="0,-13 9,9 0,5 -9,9" fill="#00ffff" stroke="#ffffff" stroke-width="0.8"/>
    <!-- cockpit window -->
    <ellipse cx="0" cy="-3" rx="2.5" ry="4" fill="#f72585" opacity="0.95"/>
    <!-- left wing -->
    <polygon points="-9,9 -18,15 -11,3" fill="#7209b7"/>
    <!-- right wing -->
    <polygon points="9,9 18,15 11,3" fill="#7209b7"/>
    <!-- exhaust flame at BOTTOM (y positive = downward) -->
    <ellipse cx="0" cy="11" rx="3.5" ry="2.5" fill="#f72585" opacity="0.9">
      <animate attributeName="ry" values="2.5;6;2.5" dur="0.2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.9;1;0.9" dur="0.2s" repeatCount="indefinite"/>
    </ellipse>
    <animateMotion dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"
      path="M ${x0} ${SHIP_CENTER_Y} L ${x1} ${SHIP_CENTER_Y}"/>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#060612" rx="10"/>
  <ellipse cx="${WIDTH*0.75}" cy="${HEIGHT*0.3}" rx="120" ry="60" fill="#7209b7" opacity="0.06"/>
  <ellipse cx="${WIDTH*0.2}" cy="${HEIGHT*0.6}" rx="100" ry="50" fill="#00b4d8" opacity="0.06"/>
  ${stars}
  ${cells}
  ${lasers}
  ${explosions}
  ${ship}
  <text x="${WIDTH/2}" y="${HEIGHT-6}" text-anchor="middle" font-family="monospace" font-size="10" fill="#00ffff" opacity="0.7">remissg · space war mode · ${total} commits fired 🚀</text>
</svg>`;
}

async function main() {
  console.log("Fetching contributions for", USERNAME);
  const { grid, total } = await getContributions();
  console.log("Weeks:", grid.length, "| Total:", total);
  const svg = buildSVG(grid, total);
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/space-war.svg", svg);
  console.log("✅ Generated dist/space-war.svg");
}

main().catch(err => { console.error(err); process.exit(1); });
