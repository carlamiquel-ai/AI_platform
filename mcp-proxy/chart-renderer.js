const sharp = require('sharp');

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 400;
const DEFAULT_SCALE_FACTOR = 2;

let _vega = null;
let _vegaLite = null;

async function loadVegaModules() {
  if (!_vega) _vega = await import('vega');
  if (!_vegaLite) _vegaLite = await import('vega-lite');
  return { vega: _vega, vegaLite: _vegaLite };
}

/**
 * Render a Vega-Lite JSON spec to a PNG buffer.
 * Uses vega SVG renderer (no native canvas needed) + sharp for SVG→PNG.
 */
async function renderChart(specInput, options = {}) {
  const { vega, vegaLite } = await loadVegaModules();

  const spec = typeof specInput === 'string' ? JSON.parse(specInput) : { ...specInput };

  if (!spec.mark && !spec.layer && !spec.hconcat && !spec.vconcat && !spec.concat && !spec.facet && !spec.repeat) {
    throw new Error('Invalid Vega-Lite spec: missing mark, layer, or composition field');
  }

  if (!spec.$schema) {
    spec.$schema = 'https://vega.github.io/schema/vega-lite/v5.json';
  }

  if (!spec.width) spec.width = options.width || DEFAULT_WIDTH;
  if (!spec.height) spec.height = options.height || DEFAULT_HEIGHT;

  if (!spec.config) spec.config = {};
  const bg = options.background || '#ffffff';
  spec.background = bg;

  const compiled = vegaLite.compile(spec);
  const vegaSpec = compiled.spec;

  const view = new vega.View(vega.parse(vegaSpec), { renderer: 'none' });
  await view.finalize();

  const svg = await view.toSVG();

  const scaleFactor = options.scaleFactor || DEFAULT_SCALE_FACTOR;
  const svgBuffer = Buffer.from(svg);

  const metadata = await sharp(svgBuffer).metadata();
  const targetWidth = Math.round((metadata.width || DEFAULT_WIDTH) * scaleFactor);

  const pngBuffer = await sharp(svgBuffer, { density: 150 })
    .resize({ width: targetWidth })
    .png()
    .toBuffer();

  return pngBuffer;
}

/**
 * Render a Vega-Lite spec to a base64-encoded PNG string.
 */
async function renderChartToBase64(specInput, options = {}) {
  const pngBuffer = await renderChart(specInput, options);
  return pngBuffer.toString('base64');
}

/**
 * Validate that a JSON object looks like a Vega-Lite spec.
 */
function isVegaLiteSpec(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const hasSchema = typeof obj.$schema === 'string' && obj.$schema.includes('vega-lite');
  const hasMark = obj.mark || obj.layer || obj.hconcat || obj.vconcat || obj.concat || obj.facet || obj.repeat;
  return !!(hasSchema || hasMark);
}

module.exports = { renderChart, renderChartToBase64, isVegaLiteSpec };
