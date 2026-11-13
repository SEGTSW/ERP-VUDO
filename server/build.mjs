// Збірка сервера в один файл на запуск: @vudo/shared вбудовується, решта залежностей — з node_modules.
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const external = Object.keys(pkg.dependencies).filter((d) => d !== '@vudo/shared');

await build({
  entryPoints: {
    index: 'src/index.ts',
    migrate: 'src/scripts/migrate.ts',
    'create-admin': 'src/scripts/createAdmin.ts',
    'import-finance': 'src/scripts/importFinance.ts',
  },
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  logLevel: 'info',
});
