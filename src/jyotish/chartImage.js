/**
 * North Indian Kundli Chart — PNG image generator
 *
 * Generates a clean North Indian diamond-style chart with:
 * - Fixed house positions (1=top center)
 * - Planet abbreviations with dignity colors
 * - Ascendant marker
 * - Dark theme matching Tara's brand
 */
import { createCanvas } from 'canvas';
import { logger } from '../utils/logger.js';

// Sign abbreviations
const SIGNS = ['Ari', 'Tau', 'Gem', 'Can', 'Leo', 'Vir', 'Lib', 'Sco', 'Sag', 'Cap', 'Aqu', 'Pis'];
const SIGN_NAMES = {
  Aries: 'Ari', Taurus: 'Tau', Gemini: 'Gem', Cancer: 'Can',
  Leo: 'Leo', Virgo: 'Vir', Libra: 'Lib', Scorpio: 'Sco',
  Sagittarius: 'Sag', Capricorn: 'Cap', Aquarius: 'Aqu', Pisces: 'Pis',
};

// Planet abbreviations
const PLANET_ABBR = {
  Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me',
  Jupiter: 'Ju', Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke',
};

// Dignity colors
const DIGNITY_COLORS = {
  exalted: '#4ade80',     // green
  own: '#60a5fa',         // blue
  debilitated: '#f87171', // red
  friend: '#fbbf24',      // gold
  neutral: '#e2e8f0',     // light gray
  enemy: '#fb923c',       // orange
};

// North Indian chart house positions (x, y coordinates as fractions of chart size)
// Houses are arranged in the classic diamond pattern:
//        1
//    12     2
//  11         3
//    10     4
//   9    ×    5
//    8      6
//        7
function getHousePositions(size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38; // radius

  // House centers in North Indian layout (diamond)
  return {
    1:  { x: cx, y: cy - r },           // top center
    2:  { x: cx + r * 0.5, y: cy - r * 0.5 },
    3:  { x: cx + r, y: cy },           // right
    4:  { x: cx + r * 0.5, y: cy + r * 0.5 },
    5:  { x: cx, y: cy + r * 0.7 },     // shifted up from bottom
    6:  { x: cx - r * 0.5, y: cy + r * 0.5 },
    7:  { x: cx, y: cy + r },           // bottom center
    8:  { x: cx - r * 0.5, y: cy + r * 0.5 },
    9:  { x: cx - r, y: cy },           // left
    10: { x: cx - r * 0.5, y: cy - r * 0.5 },
    11: { x: cx - r, y: cy },           // left (shifted)
    12: { x: cx - r * 0.5, y: cy - r * 0.5 },
  };
}

/**
 * Generate a North Indian kundli chart as PNG buffer
 */
export function generateChartImage(chartData, userName = '') {
  const SIZE = 600;
  const canvas = createCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = '#0f0d1e';
  ctx.fillRect(0, 0, SIZE, SIZE);

  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE * 0.36;

  // Draw the North Indian diamond grid
  drawDiamondGrid(ctx, cx, cy, r);

  // Map planets to houses
  const ascSign = chartData.ascendant?.sign || 'Aries';
  const ascIndex = Object.keys(SIGN_NAMES).indexOf(ascSign);
  const planets = chartData.planets || {};
  const houses = {};

  // Initialize houses 1-12
  for (let i = 1; i <= 12; i++) {
    const signIdx = (ascIndex + i - 1) % 12;
    houses[i] = {
      sign: SIGNS[signIdx],
      signFull: Object.keys(SIGN_NAMES)[signIdx],
      planets: [],
      isAsc: i === 1,
    };
  }

  // Place planets in houses
  for (const [name, data] of Object.entries(planets)) {
    if (!data?.sign) continue;
    const planetSignIdx = Object.keys(SIGN_NAMES).indexOf(data.sign);
    if (planetSignIdx === -1) continue;
    const house = ((planetSignIdx - ascIndex + 12) % 12) + 1;
    const abbr = PLANET_ABBR[name] || name.substring(0, 2);
    houses[house].planets.push({
      abbr,
      name,
      dignity: data.dignity || 'neutral',
      retrograde: data.retrograde || false,
    });
  }

  // Draw house contents
  drawHouseContents(ctx, cx, cy, r, houses);

  // Title
  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  const title = userName ? `${userName} — Kundli` : 'Kundli';
  ctx.fillText(title, cx, 28);

  // Birth details subtitle
  if (chartData.birthDate || chartData.birthTime) {
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '11px sans-serif';
    const details = [
      chartData.birthDate,
      chartData.birthTime ? chartData.birthTime.slice(0, 5) : null,
      chartData.birthPlace,
    ].filter(Boolean).join(' | ');
    ctx.fillText(details, cx, 46);
  }

  // Legend at bottom
  drawLegend(ctx, SIZE);

  // Center text
  ctx.fillStyle = 'rgba(255,255,255,0.2)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Tara Jyotish', cx, cy + 4);

  return canvas.toBuffer('image/png');
}

function drawDiamondGrid(ctx, cx, cy, r) {
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;

  // Outer diamond
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);       // top
  ctx.lineTo(cx + r, cy);       // right
  ctx.lineTo(cx, cy + r);       // bottom
  ctx.lineTo(cx - r, cy);       // left
  ctx.closePath();
  ctx.stroke();

  // Inner diamond (connecting midpoints)
  const hr = r * 0.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - hr);
  ctx.lineTo(cx + hr, cy);
  ctx.lineTo(cx, cy + hr);
  ctx.lineTo(cx - hr, cy);
  ctx.closePath();
  ctx.stroke();

  // Cross lines connecting outer to inner
  // Top to left (house 12 / house 1 border)
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx - hr, cy);
  ctx.stroke();

  // Top to right (house 1 / house 2 border)
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + hr, cy);
  ctx.stroke();

  // Right to top (house 2 / house 3 border)
  ctx.beginPath();
  ctx.moveTo(cx + r, cy);
  ctx.lineTo(cx, cy - hr);
  ctx.stroke();

  // Right to bottom (house 3 / house 4 border)
  ctx.beginPath();
  ctx.moveTo(cx + r, cy);
  ctx.lineTo(cx, cy + hr);
  ctx.stroke();

  // Bottom to right (house 4/5 border)
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.lineTo(cx + hr, cy);
  ctx.stroke();

  // Bottom to left (house 7/8 border)
  ctx.beginPath();
  ctx.moveTo(cx, cy + r);
  ctx.lineTo(cx - hr, cy);
  ctx.stroke();

  // Left to bottom (house 9/10 border)
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx, cy + hr);
  ctx.stroke();

  // Left to top (house 11/12 border)
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.lineTo(cx, cy - hr);
  ctx.stroke();
}

function drawHouseContents(ctx, cx, cy, r, houses) {
  // North Indian diamond chart — 12 houses in triangular sections
  // The diamond has 4 corner triangles (big) + 8 side triangles (small)
  // Houses 1(top), 4(right), 7(bottom), 10(left) are corner triangles
  // Each section center is placed to avoid overlaps
  const finalPos = {
    1:  { x: cx,              y: cy - r * 0.75 },    // top corner triangle
    2:  { x: cx + r * 0.38,  y: cy - r * 0.38 },    // upper-right side
    3:  { x: cx + r * 0.75,  y: cy - r * 0.12 },    // right-upper side
    4:  { x: cx + r * 0.75,  y: cy + r * 0.12 },    // right-lower side
    5:  { x: cx + r * 0.38,  y: cy + r * 0.38 },    // lower-right side
    6:  { x: cx + r * 0.12,  y: cy + r * 0.75 },    // bottom-right side
    7:  { x: cx - r * 0.12,  y: cy + r * 0.75 },    // bottom-left side
    8:  { x: cx - r * 0.38,  y: cy + r * 0.38 },    // lower-left side
    9:  { x: cx - r * 0.75,  y: cy + r * 0.12 },    // left-lower side
    10: { x: cx - r * 0.75,  y: cy - r * 0.12 },    // left-upper side
    11: { x: cx - r * 0.38,  y: cy - r * 0.38 },    // upper-left side
    12: { x: cx - r * 0.12,  y: cy - r * 0.75 },    // top-left side
  };

  for (let h = 1; h <= 12; h++) {
    const house = houses[h];
    const pos = finalPos[h];
    if (!pos) continue;

    // House number
    ctx.fillStyle = 'rgba(251,191,36,0.35)';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`H${h}`, pos.x, pos.y - 18);

    // Sign name
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px sans-serif';
    ctx.fillText(house.sign, pos.x, pos.y - 8);

    // Ascendant marker
    if (house.isAsc) {
      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText('ASC', pos.x, pos.y - 26);
    }

    // Planets
    if (house.planets.length > 0) {
      const planetsPerRow = 3;
      for (let i = 0; i < house.planets.length; i++) {
        const p = house.planets[i];
        const row = Math.floor(i / planetsPerRow);
        const col = i % planetsPerRow;
        const totalInRow = Math.min(planetsPerRow, house.planets.length - row * planetsPerRow);
        const startX = pos.x - (totalInRow - 1) * 16;

        const px = startX + col * 32;
        const py = pos.y + 4 + row * 16;

        // Planet text
        const color = DIGNITY_COLORS[p.dignity] || DIGNITY_COLORS.neutral;
        ctx.fillStyle = color;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        let label = p.abbr;
        if (p.retrograde) label += '(R)';
        ctx.fillText(label, px, py);
      }
    }
  }
}

function drawLegend(ctx, size) {
  const y = size - 20;
  const items = [
    { label: 'Exalted', color: DIGNITY_COLORS.exalted },
    { label: 'Own', color: DIGNITY_COLORS.own },
    { label: 'Friend', color: DIGNITY_COLORS.friend },
    { label: 'Debilitated', color: DIGNITY_COLORS.debilitated },
    { label: '(R) Retrograde', color: DIGNITY_COLORS.neutral },
  ];

  ctx.font = '9px sans-serif';
  ctx.textAlign = 'left';
  let x = 60;
  for (const item of items) {
    ctx.fillStyle = item.color;
    ctx.fillRect(x, y - 6, 8, 8);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(item.label, x + 12, y + 2);
    x += ctx.measureText(item.label).width + 28;
  }
}
