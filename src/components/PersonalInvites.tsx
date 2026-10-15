// Links pessoais: um link por pessoa, criados de uma vez a partir de uma lista
// de nomes. Cada link serve uma só vez e o pedido de entrada continua a precisar
// da confirmação da administração. O nome fica só como descrição do convite.
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { call } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { inviteLink } from '../lib/invite';
import type { Team } from '../lib/types';
import { ErrorBox, Field, Notice } from './ui';

const MAX_NAMES = 50;
const DAYS = 30;

const parseNames = (text: string) => [...new Set(text.split('\n').map((n) => n.trim().replace(/\s+/g, ' ')).filter(Boolean))];

export function PersonalInvites({ sectionId, teams }: { sectionId: string; teams: Team[] }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [team, setTeam] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; link: string }[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const names = parseNames(text);
  const tooMany = names.length > MAX_NAMES;

  async function create() {
    setError(null);
    setCreated([]);
    const done: { name: string; link: string }[] = [];
    const expires = new Date(Date.now() + DAYS * 86400_000).toISOString();
    try {
      for (const [i, name] of names.entries()) {
        setBusy(i + 1);
        const code = await call<string>('create_invite', { p_section: sectionId, p_label: name, p_expires_at: expires, p_max_uses: 1, p_team: team || null });
        done.push({ name, link: inviteLink(code) });
      }
      setText('');
    } catch (e) {
      // Os que já foram criados ficam válidos; só falta criar os restantes.
      setError(`${errorMessage(e)}${done.length ? ` Foram criados ${done.length} de ${names.length}; os restantes ficaram na caixa.` : ''}`);
      setText(names.slice(done.length).join('\n'));
    } finally {
      setBusy(null);
      setCreated(done);
      qc.invalidateQueries({ queryKey: ['invites', sectionId] });
    }
  }

  const copy = (value: string, key: string) =>
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(key);
      window.setTimeout(() => setCopied(null), 1800);
    });

  return (
    <section className="card personal-invites" aria-labelledby="h-links">
      <h2 id="h-links">Links pessoais</h2>
      <p className="faint prose">
        Escreve um nome por linha e cria um link para cada pessoa. Cada link só pode ser usado uma vez e é válido durante {DAYS} dias.
        A pessoa cria a sua conta pelo link e tu confirmas a entrada em Membros.
      </p>
      <Field label="Nomes (um por linha)" htmlFor="pi-names" hint={names.length ? `${names.length} ${names.length === 1 ? 'pessoa' : 'pessoas'}${tooMany ? ` · máximo ${MAX_NAMES} de cada vez` : ''}` : undefined}>
        <textarea id="pi-names" aria-describedby="pi-names-hint" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={'Ana Silva\nBruno Costa\nCarla Sousa'} />
      </Field>
      {teams.length > 0 && (
        <Field label="Equipa (opcional)" htmlFor="pi-team">
          <select id="pi-team" value={team} onChange={(e) => setTeam(e.target.value)}>
            <option value="">A pessoa indica a equipa</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
      )}
      <ErrorBox error={error} />
      <button type="button" className="btn" disabled={!names.length || tooMany || busy !== null} onClick={create}>
        {busy !== null ? `A criar ${busy} de ${names.length}…` : names.length > 1 ? `Criar ${names.length} links` : 'Criar link'}
      </button>

      {created.length > 0 && (
        <div className="created-links">
          <Notice kind="success">{created.length === 1 ? 'Link criado.' : `${created.length} links criados.`} Envia a cada pessoa o seu link.</Notice>
          <ul className="list">
            {created.map((c) => (
              <li key={c.link} className="created-link">
                <span className="grow">
                  <strong>{c.name}</strong>
                  <br />
                  <span className="faint link-text">{c.link}</span>
                </span>
                <button type="button" className="btn secondary" onClick={() => copy(c.link, c.link)} aria-label={`Copiar link de ${c.name}`}>
                  {copied === c.link ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />} {copied === c.link ? 'Copiado' : 'Copiar'}
                </button>
              </li>
            ))}
          </ul>
          {created.length > 1 && (
            <button type="button" className="btn secondary" onClick={() => copy(created.map((c) => `${c.name}: ${c.link}`).join('\n'), 'todos')}>
              <Copy size={16} aria-hidden="true" /> {copied === 'todos' ? 'Lista copiada' : 'Copiar todos (nome e link)'}
            </button>
          )}
          <span role="status" className="sr-only">{copied ? 'Copiado' : ''}</span>
        </div>
      )}
    </section>
  );
}
