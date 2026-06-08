const https = require("https");
const fs = require("fs");

const USERNAME = "remissg";
const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const PAD_X = 20;
const PAD_Y = 55;

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
  if (count === 0) return "#0d1b2a";
  if (count <= 2)  return "#1b3a5c";
  if (count <= 5)  return "#1f6feb";
  if (count <= 10) return "#7c3aed";
  return "#e94560";
}

function rand(seed, max) {
  return Math.abs((seed * 1664525 + 1013904223) & 0x7fffffff) % max;
}

function buildSVG(grid, total) {
  const totalCols = grid.length;
  const WIDTH = PAD_X * 2 + totalCols * STEP;
  const HEIGHT = PAD_Y + 7 * STEP + 30;

  // Total animation loop duration — ship crosses the full grid
  const LOOP = totalCols * 0.14; // seconds for one full pass

  // Stars
  let stars = "";
  for (let i = 0; i < 90; i++) {
    const sx = rand(i * 7 + 1, WIDTH);
    const sy = rand(i * 13 + 3, HEIGHT);
    const sr = i % 4 === 0 ? 1.2 : 0.5;
    const op = (0.3 + (i % 5) * 0.1).toFixed(1);
    stars += `<circle cx="${sx}" cy="${sy}" r="${sr}" fill="white" opacity="${op}"/>`;
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

  // Ship position at column ci: x = PAD_X + ci*STEP + CELL/2
  // Ship arrives at column ci at time: t = (ci / (totalCols-1)) * LOOP seconds
  // We animate laser opacity: 0 -> 1 -> 1 -> 0 in a short window around that time
  // But SVG animate begin is absolute from document load, so we use repeatCount=1 per laser
  // and stagger begins. We repeat the whole thing by wrapping in animateMotion repeatCount=indefinite
  // and using begin="Ns; Ns+LOOP; Ns+2*LOOP..." — instead, just use begin offset + repeatCount indefinite
  // with dur=LOOP so laser fires once per ship pass.

  const LASER_DUR = 0.18; // how long laser is visible

  let lasers = "";
  let explosions = "";

  for (let ci = 0; ci < grid.length; ci++) {
    const col = grid[ci];
    const maxVal = Math.max(...col);
    if (maxVal < 2) continue;

    const targetRow = col.indexOf(maxVal);
    const lx = PAD_X + ci * STEP + CELL / 2;
    const shipY = PAD_Y - 22;
    const ly2 = PAD_Y + targetRow * STEP + CELL / 2;

    // When ship is over this column
    const arriveTime = (ci / (totalCols - 1)) * LOOP;

    // Laser: animate opacity with dur=LOOP, begin=arriveTime, repeatCount=indefinite
    // keyTimes split: before=0, flash on=tiny, sustain, flash off=tiny, rest=0
    const onFrac = (LASER_DUR / LOOP);
    const t0 = 0;
    const t1 = (arriveTime / LOOP).toFixed(4);
    const t2 = ((arriveTime + LASER_DUR * 0.1) / LOOP).toFixed(4);
    const t3 = ((arriveTime + LASER_DUR * 0.85) / LOOP).toFixed(4);
    const t4 = ((arriveTime + LASER_DUR) / LOOP).toFixed(4);
    const t5 = 1;

    // Clamp to [0,1]
    const clamp = v => Math.min(1, Math.max(0, parseFloat(v))).toFixed(4);

    const kt = [t0, clamp(t1), clamp(t2), clamp(t3), clamp(t4), t5].join(";");
    const kv = "0;0;1;1;0;0";

    lasers += `
    <line x1="${lx}" y1="${shipY}" x2="${lx}" y2="${ly2}" stroke="#FF0055" stroke-width="2.5" stroke-linecap="round" opacity="0">
      <animate attributeName="opacity" dur="${LOOP}s" values="${kv}" keyTimes="${kt}" repeatCount="indefinite"/>
    </line>
    <line x1="${lx}" y1="${shipY}" x2="${lx}" y2="${ly2}" stroke="#FF99BB" stroke-width="1" stroke-linecap="round" opacity="0">
      <animate attributeName="opacity" dur="${LOOP}s" values="${kv}" keyTimes="${kt}" repeatCount="indefinite"/>
    </line>`;

    if (maxVal > 5) {
      explosions += `
      <g transform="translate(${lx},${ly2})" opacity="0">
        <circle r="0" fill="#FF4500"><animate attributeName="r" dur="${LOOP}s" values="0;0;10;0;0;0" keyTimes="${kt}" repeatCount="indefinite"/></circle>
        <circle r="0" fill="#FFD700" opacity="0.85"><animate attributeName="r" dur="${LOOP}s" values="0;0;6;0;0;0" keyTimes="${kt}" repeatCount="indefinite"/></circle>
        <animate attributeName="opacity" dur="${LOOP}s" values="0;0;1;1;0;0" keyTimes="${kt}" repeatCount="indefinite"/>
      </g>`;
    }
  }

  // Ship — animateMotion with same LOOP duration
  const x0 = PAD_X + CELL / 2;
  const x1 = PAD_X + (totalCols - 1) * STEP + CELL / 2;
  const shipY = PAD_Y - 22;

  const ship = `
  <g>
    <polygon points="0,-12 8,8 0,4 -8,8" fill="#FF6600" stroke="#FFB347" stroke-width="1.2"/>
    <ellipse cx="0" cy="-5" rx="2.8" ry="3.5" fill="#00FFFF" opacity="0.95"/>
    <polygon points="-8,8 -15,13 -10,2" fill="#cc4400"/>
    <polygon points="8,8 15,13 10,2" fill="#cc4400"/>
    <ellipse cx="0" cy="9" rx="3" ry="2.5" fill="#FF4500" opacity="0.9">
      <animate attributeName="ry" values="2.5;6;2.5" dur="0.2s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.9;1;0.9" dur="0.2s" repeatCount="indefinite"/>
    </ellipse>
    <animateMotion dur="${LOOP}s" repeatCount="indefinite" calcMode="linear"
      path="M ${x0} ${shipY} L ${x1} ${shipY}"/>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <filter id="glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.5" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0d1117" rx="10"/>
  ${stars}
  ${cells}
  ${lasers}
  ${explosions}
  ${ship}
  <text x="${WIDTH/2}" y="${HEIGHT - 8}" text-anchor="middle" font-family="monospace" font-size="10" fill="#FF6600" opacity="0.75">remissg · space war mode · ${total} commits fired 🚀</text>
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
