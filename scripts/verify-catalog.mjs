#!/usr/bin/env node
// Verifica o catálogo extraído (catalog/pioneiros-v1.json) contra o PDF fonte,
// usando as coordenadas das palavras (pdftotext -bbox, do pacote poppler-utils).
// As tabelas do manual têm várias colunas: por isso cada objetivo é procurado
// pela posição do seu código (coluna) dentro do bloco do trilho correto, e não
// por simples procura de texto.
//
// Uso: node scripts/verify-catalog.mjs [caminho-do-pdf]
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(path.join(root, 'catalog/pioneiros-v1.json'), 'utf8'));
const pdfPath = process.argv[2] ?? path.join(root, catalog.source.file);

const sha = createHash('sha256').update(readFileSync(pdfPath)).digest('hex');
const problems = [];
const checks = [];
if (sha !== catalog.source.sha256) {
  problems.push(`O PDF não corresponde ao ficheiro usado na importação (sha256 ${sha}).`);
}

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function pageWords(page) {
  const html = execFileSync('pdftotext', ['-bbox', '-f', String(page), '-l', String(page), pdfPath, '-'], {
    encoding: 'utf8',
  });
  const re = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g;
  const words = [];
  let m;
  while ((m = re.exec(html))) {
    words.push({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: decode(m[5]) });
  }
  return words;
}

// Junta palavras em texto, por linhas, tratando hifenização de fim de linha.
function joinWords(words) {
  const sorted = [...words].sort((a, b) => (Math.abs(a.y0 - b.y0) < 3 ? a.x0 - b.x0 : a.y0 - b.y0));
  let out = '';
  let prev = null;
  for (const w of sorted) {
    if (!prev) out = w.t;
    else {
      const newLine = Math.abs(w.y0 - prev.y0) >= 3;
      if (newLine && prev.t.endsWith('-') && w.t.startsWith('-')) out += w.t.slice(1);
      else if (newLine && prev.t.endsWith('-') && /^[a-zà-ú]/.test(w.t) && !/^-/.test(w.t)) {
        out = out.slice(0, -1) + w.t;
      } else out += ' ' + w.t;
    }
    prev = w;
  }
  return out;
}

const norm = (s) =>
  s
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:)])/g, '$1')
    .replace(/\(\s+/g, '(')
    .replace(/\s*\/\s*/g, '/')
    .trim();
// Comparação mais tolerante (só letras e dígitos), usada para listas em colunas.
const loose = (s) => s.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '').toLowerCase();

const byPage = new Map();
for (const area of catalog.areas) {
  for (const trail of area.trails) {
    if (!byPage.has(trail.source_page)) byPage.set(trail.source_page, []);
    byPage.get(trail.source_page).push({ area, trail });
  }
}

const allCodes = [];
for (const [page, trails] of byPage) {
  const words = pageWords(page);
  const headings = words
    .filter((w) => w.t === 'Trilho:')
    .sort((a, b) => a.y0 - b.y0)
    .map((h) => ({
      y0: h.y0,
      name: joinWords(words.filter((w) => Math.abs(w.y0 - h.y0) < 3 && w.x0 > h.x1 && w.x1 < 540)),
    }));
  const pageBottom = Math.max(...words.map((w) => w.y1));

  for (const { area, trail } of trails) {
    const label = `${area.name} › ${trail.name} (p. ${page})`;
    const hi = headings.findIndex((h) => norm(h.name) === norm(trail.name));
    if (hi < 0) {
      problems.push(`${label}: título do trilho não encontrado na página.`);
      continue;
    }
    const top = headings[hi].y0;
    const bottom = hi + 1 < headings.length ? headings[hi + 1].y0 : pageBottom;
    // Exclui o texto vertical das margens («III SECÇÃO», «Dimensão da personalidade»).
    const region = words.filter((w) => w.y0 > top + 3 && w.y0 < bottom - 1 && w.x0 > 50 && w.x1 < 540);

    const codeWords = region.filter((w) => /^[FACEIS]\d+$/.test(w.t)).sort((a, b) => a.x0 - b.x0);
    const codesFound = codeWords.map((w) => w.t);
    const codesExpected = trail.objectives.map((o) => o.code);
    if (codesFound.join(',') !== codesExpected.join(',')) {
      problems.push(`${label}: códigos no PDF [${codesFound}] diferem do catálogo [${codesExpected}].`);
      continue;
    }
    checks.push(`${label}: códigos ${codesFound.join(', ')} pertencem a este trilho.`);

    const opp = region.find((w) => w.t === 'Oportunidades');
    const enq = region.find((w) => w.t === 'Enquadramento');
    const kw = region.find((w) => w.t === 'Palavra-chave');
    const codeY = codeWords[0].y0;

    // A coluna «Palavra-chave» pode terminar acima da linha dos códigos ou
    // prolongar-se ao lado dos objetivos. Testam-se as duas leituras e aceita-se
    // a que faz conferir, ao mesmo tempo, objetivos e palavras-chave.
    const kwX = 415; // limite esquerdo da coluna «Palavra-chave» nestas páginas
    const kwSorted = (s) => [...s].sort().join('');
    const kwCatalog = kwSorted(loose(trail.keywords.join(' ')));
    let accepted = null;
    const attempts = [];
    for (const kwBesideObjectives of [false, true]) {
      const kwBottom = kwBesideObjectives ? opp.y0 - 1 : codeY - 1;
      const kwWords = region.filter((w) => w.y0 > kw.y1 && w.y0 < kwBottom && w.x0 >= kwX);
      const objTexts = codeWords.map((c, i) => {
        const xMax = i + 1 < codeWords.length ? codeWords[i + 1].x0 - 3 : kwBesideObjectives ? kwX : 1e9;
        return joinWords(region.filter((w) => w.y0 > c.y1 && w.y0 < opp.y0 - 1 && w.x0 >= c.x0 - 3 && w.x0 < xMax));
      });
      const kwOk = kwSorted(loose(kwWords.map((w) => w.t).join(' '))) === kwCatalog;
      const objOk = objTexts.map((t, i) => norm(t) === norm(trail.objectives[i].text));
      attempts.push({ kwBesideObjectives, kwWords, objTexts, kwOk, objOk });
      if (kwOk && objOk.every(Boolean)) {
        accepted = attempts.at(-1);
        break;
      }
    }
    if (accepted) {
      for (const o of trail.objectives) {
        checks.push(`${label} ${o.code}: texto confere.`);
        allCodes.push(o.code);
      }
      checks.push(`${label}: palavras-chave conferem (${trail.keywords.length}).`);
    } else {
      const a = attempts[0];
      a.objOk.forEach((ok, i) => {
        if (!ok)
          problems.push(
            `${label} ${trail.objectives[i].code}: texto difere.\n   PDF:      ${norm(a.objTexts[i])}\n   catálogo: ${norm(trail.objectives[i].text)}`,
          );
      });
      if (!a.kwOk) problems.push(`${label}: palavras-chave diferem.\n   PDF: ${joinWords(a.kwWords)}`);
    }

    // Enquadramento: à esquerda da coluna das palavras-chave.
    const framingTxt = joinWords(region.filter((w) => w.y0 > enq.y1 && w.y0 < codeY - 1 && w.x1 < kwX));
    if (loose(framingTxt) !== loose(trail.framing)) {
      problems.push(`${label}: enquadramento difere.\n   PDF:      ${norm(framingTxt)}\n   catálogo: ${norm(trail.framing)}`);
    } else checks.push(`${label}: enquadramento confere.`);

    // Oportunidades: coluna esquerda seguida da coluna direita.
    const oppWords = region.filter((w) => w.y0 > opp.y1);
    const mid = 300;
    const oppText = loose(
      joinWords(oppWords.filter((w) => w.x0 < mid)) + ' ' + joinWords(oppWords.filter((w) => w.x0 >= mid)),
    );
    let cursor = 0;
    for (const o of trail.opportunities) {
      const idx = oppText.indexOf(loose(o), 0);
      if (idx < 0) problems.push(`${label}: oportunidade não encontrada: «${o}»`);
      else cursor = idx;
    }
    if (cursor >= 0) checks.push(`${label}: ${trail.opportunities.length} oportunidades encontradas.`);
  }
}

// Contagens estruturais.
const trailCount = catalog.areas.reduce((n, a) => n + a.trails.length, 0);
if (catalog.areas.length !== 6) problems.push(`Esperadas 6 áreas, encontradas ${catalog.areas.length}.`);
if (trailCount !== 18) problems.push(`Esperados 18 trilhos, encontrados ${trailCount}.`);
for (const a of catalog.areas) if (a.trails.length !== 3) problems.push(`Área ${a.name}: ${a.trails.length} trilhos.`);
const dup = allCodes.filter((c, i) => allCodes.indexOf(c) !== i);
if (dup.length) problems.push(`Códigos duplicados: ${dup}`);

const report = { pdf_sha256: sha, checks: checks.length, problems };
const outFile = path.join(root, 'catalog/verificacao.json');
writeFileSync(outFile, JSON.stringify({ ...report, detail: checks }, null, 2) + '\n');
console.log(`Verificações bem-sucedidas: ${checks.length}`);
if (problems.length) {
  console.error(`Problemas (${problems.length}):\n- ` + problems.join('\n- '));
  process.exit(1);
}
console.log(`Catálogo confere com o PDF: ${catalog.areas.length} áreas, ${trailCount} trilhos, ${allCodes.length} objetivos.`);
