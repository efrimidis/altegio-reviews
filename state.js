// Tiny JSON-file store for publication state. This is deliberately local and
// suitable only for a single service instance. Writes are atomic so a process
// interruption cannot leave a half-written JSON document behind.

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
  const temporaryFile = `${FILE}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporaryFile, JSON.stringify(state));
    fs.renameSync(temporaryFile, FILE);
    return true;
  } catch (err) {
    console.error('Failed to write state.json:', err.message);
    try {
      if (fs.existsSync(temporaryFile)) fs.unlinkSync(temporaryFile);
    } catch {
      // Best-effort cleanup; the original state file is still intact.
    }
    return false;
  }
}

function update(updater) {
  return write(updater(read()));
}

module.exports = { read, write, update };
