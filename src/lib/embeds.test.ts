import { describe, expect, it } from 'vitest';

// memberships tem duas ligações a teams (team_id e requested_team_id): sem indicar a
// chave estrangeira, o PostgREST recusa a consulta (PGRST201) e a aplicação não abre.
const sources = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.{ts,tsx}'], { query: '?raw', import: 'default', eager: true });

describe('consultas com relações ambíguas', () => {
  it('embeds de teams a partir de memberships indicam a chave estrangeira', () => {
    const bad = Object.entries(sources)
      .filter(([, src]) => /from\('memberships'\)[\s\S]{0,200}?\bteams\(/.test(src))
      .map(([f]) => f);
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });
});
