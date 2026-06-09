// Tiny JSON-file store for the id of the currently published post, so the next
// run can delete it. The file lives on Render's ephemeral disk: it survives
// process restarts within a deploy and is only lost on redeploy (rare).

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'state.json');

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return {};
  }
}

function write(state) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch (err) {
    console.error('Failed to write state.json:', err.message);
  }
}

module.exports = { read, write };
