const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const output = join(__dirname, 'dist');
mkdirSync(output, { recursive: true });
const html = readFileSync(join(__dirname, 'index.html'), 'utf8');
writeFileSync(join(output, 'index.html'),
  html.replace('<meta name="color-scheme" content="light">', '<meta name="color-scheme" content="light">\n  <meta name="edumind-mode" content="browser">'));
for (const name of ['academic-measure.webp', 'academic-support.webp', 'academic-followup.webp', 'editorial.css', 'n8n-flow.html', 'detection.js', 'diagnosis.js', 'intervention.js', 'subjects.js']) {
  copyFileSync(join(__dirname, name), join(output, name));
}
mkdirSync(join(output, 'n8n'), { recursive: true });
copyFileSync(join(__dirname, 'n8n', 'detection.workflow.json'), join(output, 'n8n', 'detection.workflow.json'));
writeFileSync(join(output, '.nojekyll'), '');
