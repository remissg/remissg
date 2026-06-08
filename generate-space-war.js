const https = require("https");
const fs = require("fs");

const USERNAME = "remissg";
const COLS = 53;
const ROWS = 7;
const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const PAD_X = 20;
const PAD_Y = 50;
const WIDTH = PAD_X * 2 + COLS * STEP;
const HEIGHT = PAD_Y + ROWS * STEP + 40;

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
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
              }
            }
          }
        }
      }
    }
  `;
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
  return Math.floor(((seed * 1664525 + 1013904223) & 0x7fffffff) % max);
}

function buildSVG(grid, total) {
  const totalCols = grid.length;
  const animDur = totalCols * 0.15;

  // Stars
  let stars = "";
  for (let i = 0; i < 80; i++) {
    const sx = rand(i * 7 + 1, WIDTH);
    const sy = rand(i * 13 + 3, HEIGHT);
    const sr = i % 4 === 0 ? 1.2 : 0.5;
    const op = 0.3 + (i % 5) * 0.1;
    stars += `<circle cx="${sx}" cy="${sy}" r="${sr}" fill="white" opacity="${op}"/>`;
  }

  // Grid cells
  let cells = "";
  for (let ci = 0; ci < grid.length; ci++) {
    const col = grid[ci];
    for (let ri = 0; ri < col.length; ri++) {
      const x = PAD_X + ci * STEP;
      const y = PAD_Y + ri * STEP;
      const color = levelColor(col[ri]);
      const glow = col[ri] > 5 ? ` filter="url(#glow)"` : "";
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}"${glow}/>`;
    }
  }

  // Lasers + explosions
  let lasers = "";
  let explosions = "";
  for (let ci = 0; ci < grid.length; ci++) {
    const col = grid[ci];
    const maxVal = Math.max(...col);
    if (maxVal < 3) continue;
    const targetRow = col.indexOf(maxVal);
    const lx = PAD_X + ci * STEP + CELL / 2;
    const ly1 = PAD_Y - 18;
    const ly2 = PAD_Y + targetRow * STEP;
    const delay = ((ci / (totalCols - 1)) * animDur).toFixed(2);
    const dur = 0.22;

    lasers += `
    <line x1="${lx}" y1="${ly1}" x2="${lx}" y2="${ly2}" stroke="#FF0055" stroke-width="2.5" opacity="0" stroke-linecap="round">
      <animate attributeName="opacity" values="0;1;1;0" dur="${dur}s" begin="${delay}s" repeatCount="indefinite" keyTimes="0;0.05;0.7;1"/>
    </line>
    <line x1="${lx}" y1="${ly1}" x2="${lx}" y2="${ly2}" stroke="#FF88AA" stroke-width="1" opacity="0">
      <animate attributeName="opacity" values="0;0.7;0.7;0" dur="${dur}s" begin="${delay}s" repeatCount="indefinite" keyTimes="0;0.05;0.7;1"/>
    </line>`;

    if (maxVal > 5) {
      explosions += `
      <g transform="translate(${lx},${PAD_Y + targetRow * STEP + CELL / 2})" opacity="0">
        <circle r="0" fill="#FF4500"><animate attributeName="r" values="0;9;0" dur="${dur}s" begin="${delay}s" repeatCount="indefinite"/></circle>
        <circle r="0" fill="#FFD700" opacity="0.8"><animate attributeName="r" values="0;5;0" dur="${dur}s" begin="${(parseFloat(delay)+0.03).toFixed(2)}s" repeatCount="indefinite"/></circle>
        <animate attributeName="opacity" values="0;1;1;0" dur="${dur}s" begin="${delay}s" repeatCount="indefinite" keyTimes="0;0.05;0.7;1"/>
      </g>`;
    }
  }

  // Ship path straight across top
  const shipY = PAD_Y - 22;
  const x0 = PAD_X + CELL / 2;
  const x1 = PAD_X + (totalCols - 1) * STEP + CELL / 2;

  const ship = `
  <g>
    <polygon points="0,-11 7,7 0,3 -7,7" fill="#FF6600" stroke="#FFB347" stroke-width="1"/>
    <ellipse cx="0" cy="-5" rx="2.5" ry="3" fill="#00FFFF" opacity="0.9"/>
    <polygon points="-7,7 -13,11 -9,2" fill="#cc4400"/>
    <polygon points="7,7 13,11 9,2" fill="#cc4400"/>
    <ellipse cx="0" cy="8" rx="3" ry="2" fill="#FF4500" opacity="0.85">
      <animate attributeName="ry" values="2;5;2" dur="0.25s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.85;1;0.85" dur="0.25s" repeatCount="indefinite"/>
    </ellipse>
    <animateMotion dur="${animDur}s" repeatCount="indefinite" calcMode="linear"
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
  console.log("Weeks:", grid.length, "| Total commits:", total);
  const svg = buildSVG(grid, total);
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/space-war.svg", svg);
  console.log("✅ Generated dist/space-war.svg");
}

main().catch(err => { console.error(err); process.exit(1); });
