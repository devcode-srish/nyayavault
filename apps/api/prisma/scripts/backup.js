const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const backupsDir = path.resolve(__dirname, '../backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const backupPath = path.join(backupsDir, 'nyayavault_pre_milestone_3_1.backup');
const pgDumpPath = 'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe';
const pgRestorePath = 'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_restore.exe';

console.log('Creating database backup to:', backupPath);
execSync(`"${pgDumpPath}" -h localhost -p 5432 -U postgres -d nyayavault -F c -b -f "${backupPath}"`, {
  env: { ...process.env, PGPASSWORD: 'Aryan@janvi' },
  stdio: 'inherit'
});

const stats = fs.statSync(backupPath);
console.log('Backup file size:', stats.size, 'bytes');

console.log('Verifying backup TOC entries...');
const listing = execSync(`"${pgRestorePath}" -l "${backupPath}"`, {
  env: { ...process.env, PGPASSWORD: 'Aryan@janvi' }
}).toString();

const lines = listing.split('\n').filter(l => l.trim() && !l.startsWith(';'));
console.log(`Archive successfully verified! Total TOC items: ${lines.length}`);
