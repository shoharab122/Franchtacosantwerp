import { writeFileSync } from 'node:fs';

const envContent = `APP_KEY=64f4138797287956d958003c9b497c7b67bbe20dffec6e06f4c109e01294ed8c
OWNER_PASSWORD_HASH=85c3e41a67cb6af0d34e3c99ee7db684.30346f79cde1ff42473418b02c04e62d07462b5
DB_PATH=/var/data/minhaj-shift.sqlite`;

writeFileSync('.env', envContent);
console.log('✅ .env file created for Render');

import('./start.mjs');
