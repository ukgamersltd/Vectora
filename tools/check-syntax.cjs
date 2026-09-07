'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const source = path.resolve(__dirname, '../src');
for (const file of fs.readdirSync(source).filter(name => name.endsWith('.js'))) {
    const result = spawnSync(process.execPath, ['--check', path.join(source, file)], { encoding: 'utf8' });
    if (result.status !== 0) {
        process.stderr.write(result.stderr || result.error?.message || `Syntax check failed: ${file}\n`);
        process.exit(1);
    }
    console.log(`Syntax OK: ${file}`);
}
