#!/usr/bin/env node
// Junta todas as migrações num único ficheiro para colar no SQL Editor do Supabase.
// Uso: node scripts/bundle-migrations.mjs
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase/migrations');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const parts = [
  '-- GERADO por scripts/bundle-migrations.mjs — não editar à mão.',
  '-- Instalação completa num projeto Supabase NOVO: cola tudo no SQL Editor e carrega em «Run».',
  '-- Corre uma única vez. Para atualizações futuras usa as migrações individuais (supabase db push).',
  '',
];
for (const f of files) parts.push(`-- ===== ${f} =====`, readFileSync(path.join(dir, f), 'utf8'), '');
writeFileSync(path.join(root, 'supabase/instalar_tudo.sql'), parts.join('\n'));
console.log(`supabase/instalar_tudo.sql (${files.length} migrações)`);
