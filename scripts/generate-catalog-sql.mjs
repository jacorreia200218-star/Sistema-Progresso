#!/usr/bin/env node
// Gera a migração SQL do catálogo a partir de catalog/pioneiros-v1.json.
// Uso: node scripts/generate-catalog-sql.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(path.join(root, 'catalog/pioneiros-v1.json'), 'utf8'));
const out = path.join(root, 'supabase/migrations/20261013000600_catalog_pioneiros_v1.sql');

const q = (v) => (v === null || v === undefined ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const arr = (a) => `array[${a.map(q).join(', ')}]::text[]`;

const pendingFor = (id) =>
  catalog.pending_items
    .filter((p) => p.affects.includes(id))
    .map((p) => `${p.id}: ${p.issue}`)
    .join(' ') || null;

const lines = [];
lines.push('-- GERADO AUTOMATICAMENTE por scripts/generate-catalog-sql.mjs a partir de catalog/pioneiros-v1.json.');
lines.push('-- Não editar à mão. Ver catalog/RELATORIO_IMPORTACAO.md.');
lines.push('do $catalog$');
lines.push('declare v_version uuid; v_area uuid; v_trail uuid;');
lines.push('begin');
lines.push(
  `  insert into public.catalog_versions (key, section_kind, label, source, status) values (${q(catalog.version_key)}, ${q(
    catalog.section_kind,
  )}, ${q(catalog.label)}, ${q(JSON.stringify(catalog.source))}::jsonb, 'ativo') returning id into v_version;`,
);
for (const s of catalog.stages) {
  lines.push(
    `  insert into public.catalog_stages (version_id, key, name, kind, ordinal, source_page, summary) values (v_version, ${q(s.key)}, ${q(
      s.name,
    )}, ${q(s.kind)}, ${s.ordinal}, ${s.source_page}, ${q(s.summary)});`,
  );
}
for (const a of catalog.areas) {
  lines.push(
    `  insert into public.catalog_areas (version_id, code, name, full_name, dimension, position, source_page) values (v_version, ${q(
      a.code,
    )}, ${q(a.name)}, ${q(a.full_name)}, ${q(a.dimension)}, ${a.position}, ${a.source_page}) returning id into v_area;`,
  );
  for (const t of a.trails) {
    lines.push(
      `  insert into public.catalog_trails (version_id, area_id, key, name, position, source_page, framing, keywords, opportunities, pending_note) values (v_version, v_area, ${q(
        t.key,
      )}, ${q(t.name)}, ${t.position}, ${t.source_page}, ${q(t.framing)}, ${arr(t.keywords)}, ${arr(t.opportunities)}, ${q(
        pendingFor(t.key),
      )}) returning id into v_trail;`,
    );
    t.objectives.forEach((o, i) => {
      lines.push(
        `  insert into public.catalog_objectives (trail_id, code, text, position, pending_note) values (v_trail, ${q(o.code)}, ${q(
          o.text,
        )}, ${i + 1}, ${q(pendingFor(o.code))});`,
      );
    });
  }
}
lines.push('end');
lines.push('$catalog$;');
writeFileSync(out, lines.join('\n') + '\n');
console.log(`Escrito ${path.relative(root, out)}`);
