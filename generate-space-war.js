const { Octokit } = require("@octokit/rest");
const fs = require("fs");
const path = require("path");

const USERNAME = "remissg";
const COLS = 53;
const ROWS = 7;
const CELL = 12;
const GAP = 3;
const STEP = CELL + GAP;
const PAD_X = 20;
const PAD_Y = 50;
const WIDTH = PAD_X * 2 + COLS * STEP;
const HEIGHT = PAD_Y + ROWS * STEP + 60;

// Fetch contributions via GitHub GraphQL
async function getContributions() {
  const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
      }
    }
  `;
  const result = await octokit.graphql(query, { login: USERNAME });
  const weeks = result.user.contributionsCollection.contributionCalendar.weeks;
  const grid = [];
  for (const week of weeks) {
    const col = [];
    for (const day of week.contributionDays) {
      col.push(day.contributionCount);
    }
    grid.push(col);
  }
  return grid;
}

function levelColor(count) {
  if (count === 0) return "#0d1b2a";
  if (count <= 2)  return "#1b3a5c";
  if (count <= 5)  return "#1f6feb";
  if (count <= 10) return "#7c3aed";
  return "#e94560";
}

function buildSVG(grid) {
  // Flatten to get max for ship path
  const allCounts = grid.flat();
  const maxCount = Math.max(...allCounts);

  // Build cells
  let cells = "";
  let lasers = "";
  let shipFrames = "";
  let explosions = "";

  const totalCols = grid.length;

  // For each column find the highest contribution row — ship fires there
  const fireTargets = grid.map((col, ci) => {
    let maxVal = 0, maxRow = 0;
    col.forEach((v, ri) => { if (v > maxVal) { maxVal = v; maxRow = ri; } });
    return { col: ci, row: maxRow, count: maxVal };
  });

  // Cells
  for (let ci = 0; ci < grid.length; ci++) {
    const col = grid[ci];
    for (let ri = 0; ri < col.length; ri++) {
      const x = PAD_X + ci * STEP;
      const y = PAD_Y + ri * STEP;
      const color = levelColor(col[ri]);
      const glowId = col[ri] > 5 ? ` filter="url(#glow)"` : "";
      cells += `<rect x="${x}" y="${y}" width="${CELL}" height="${CELL}" rx="2" fill="${color}"${glowId}/>`;
    }
  }

  // Ship animation — flies across the top, fires laser at each hot column
  const shipY = PAD_Y - 28;
  const animDur = totalCols * 0.18; // seconds total
  
  // keyTimes and keySplines for ship x position
  const keyTimes = grid.map((_, i) => (i / (totalCols - 1)).toFixed(3)).join(";");
  const xValues = grid.map((_, i) => PAD_X + i * STEP + CELL / 2).join(";");

  shipFrames = `
  <g id="ship">
    <!-- spaceship body -->
    <polygon points="0,-10 6,6 0,2 -6,6" fill="#FF6600" stroke="#FFB347" stroke-width="1"/>
    <!-- cockpit -->
    <ellipse cx="0" cy="-4" rx="2.5" ry="3" fill="#00FFFF" opacity="0.9"/>
    <!-- left wing -->
    <polygon points="-6,6 -12,10 -8,2" fill="#cc4400"/>
    <!-- right wing -->
    <polygon points="6,6 12,10 8,2" fill="#cc4400"/>
    <!-- engine glow -->
    <ellipse cx="0" cy="7" rx="3" ry="2" fill="#FF4500" opacity="0.8">
      <animate attributeName="ry" values="2;4;2" dur="0.3s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values="0.8;1;0.8" dur="0.3s" repeatCount="indefinite"/>
    </ellipse>
    <animateMotion dur="${animDur}s" repeatCount="indefinite" calcMode="linear">
      <mpath href="#shipPath"/>
    </animateMotion>
  </g>`;

  // Ship path — straight line across top
  const pathD = `M ${PAD_X + CELL/2} ${shipY} L ${PAD_X + (totalCols-1)*STEP + CELL/2} ${shipY}`;

  // Laser beams — one per "hot" column (count > 3)
  let laserIndex = 0;
  for (let ci = 0; ci < grid.length; ci++) {
    const col = grid[ci];
    const maxVal = Math.max(...col);
    if (maxVal < 3) continue;

    const targetRow = col.indexOf(maxVal);
    const lx = PAD_X + ci * STEP + CELL / 2;
    const ly1 = shipY + 10;
    const ly2 = PAD_Y + targetRow * STEP;

    // When does ship reach this column?
    const delay = (ci / (totalCols - 1)) * animDur;
    const laserDur = 0.25;

    lasers += `
    <line x1="${lx}" y1="${ly1}" x2="${lx}" y2="${ly2}" 
      stroke="#FF0055" stroke-width="2" opacity="0" stroke-linecap="round">
      <animate attributeName="opacity" values="0;1;1;0" 
        dur="${laserDur}s" begin="${delay.toFixed(2)}s" 
        repeatCount="indefinite" keyTimes="0;0.1;0.7;1"/>
    </line>
    <line x1="${lx}" y1="${ly1}" x2="${lx}" y2="${ly2}" 
      stroke="#FF88AA" stroke-width="1" opacity="0">
      <animate attributeName="opacity" values="0;0.6;0.6;0" 
        dur="${laserDur}s" begin="${delay.toFixed(2)}s" 
        repeatCount="indefinite" keyTimes="0;0.1;0.7;1"/>
    </line>`;

    // Explosion at target
    if (maxVal > 5) {
      explosions += `
      <g transform="translate(${lx}, ${PAD_Y + targetRow * STEP + CELL/2})" opacity="0">
        <circle r="0" fill="#FF4500" opacity="0.9">
          <animate attributeName="r" values="0;8;0" dur="${laserDur}s" begin="${delay.toFixed(2)}s" repeatCount="indefinite"/>
        </circle>
        <circle r="0" fill="#FFD700" opacity="0.7">
          <animate attributeName="r" values="0;5;0" dur="${laserDur}s" begin="${(delay+0.03).toFixed(2)}s" repeatCount="indefinite"/>
        </circle>
        <animate attributeName="opacity" values="0;1;1;0" dur="${laserDur}s" begin="${delay.toFixed(2)}s" repeatCount="indefinite" keyTimes="0;0.1;0.7;1"/>
      </g>`;
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <path id="shipPath" d="${pathD}"/>
  </defs>

  <!-- Space background -->
  <rect width="${WIDTH}" height="${HEIGHT}" fill="#0d1117" rx="8"/>

  <!-- Stars -->
  ${Array.from({length: 80}, (_, i) => {
    const sx = Math.floor((i * 137.5) % WIDTH);
    const sy = Math.floor((i * 97.3) % HEIGHT);
    const sr = i % 3 === 0 ? 1.2 : 0.6;
    return `<circle cx="${sx}" cy="${sy}" r="${sr}" fill="white" opacity="${0.3 + (i%5)*0.1}"/>`;
  }).join("")}

  <!-- Contribution grid cells -->
  ${cells}

  <!-- Laser beams -->
  ${lasers}

  <!-- Explosions -->
  ${explosions}

  <!-- Spaceship -->
  ${shipFrames}

  <!-- Label -->
  <text x="${WIDTH/2}" y="${HEIGHT - 12}" text-anchor="middle" 
    font-family="monospace" font-size="11" fill="#FF6600" opacity="0.8">
    remissg · space war mode · ${allCounts.reduce((a,b)=>a+b,0)} commits fired
  </text>
</svg>`;

  return svg;
}

async function main() {
  console.log("Fetching contributions...");
  const grid = await getContributions();
  console.log(`Got ${grid.length} weeks of data`);
  
  const svg = buildSVG(grid);
  
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/space-war.svg", svg);
  console.log("Generated dist/space-war.svg");
}

main().catch(console.error);
