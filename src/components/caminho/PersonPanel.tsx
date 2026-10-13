// Conteúdo do painel de uma pessoa no Caminho da secção: equipa, etapa atual,
// as seis áreas FACEIS e o próximo passo. Os dados chegam já limitados pelas
// permissões do servidor.
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchMemberProgress, type PathMember } from '../../lib/api';
import { memberPosition, milestoneByKey, STATE_LABEL } from '../../lib/caminho';
import { nextAction } from '../../lib/progress';
import { stageChecklist } from '../../lib/meuprogresso';
import type { Catalog } from '../../lib/types';
import { Avatar, ErrorBox, Loading } from '../ui';
import { FaceisSummary } from './Faceis';

export function PersonPanelBody({ member, catalog, teamName }: { member: PathMember; catalog: Catalog; teamName: (id: string | null) => string }) {
  const q = useQuery({ queryKey: ['progress', member.membership_id], queryFn: () => fetchMemberProgress(member.membership_id) });
  const self = member.is_me;
  const base = self ? '/meu-progresso' : `/meu-progresso?pioneiro=${member.membership_id}`;
  const join = base.includes('?') ? '&' : '?';
  return (
    <div className="stack">
      <div className="row">
        <Avatar name={member.full_name} photoPath={member.photo_path} size="lg" />
        <div className="grow">
          <strong style={{ fontSize: '1.05rem' }}>{member.full_name}{self ? ' (tu)' : ''}</strong>
          <br />
          <span className="faint">{teamName(member.team_id)}{member.function === 'guia' ? ' · Guia' : ''}{member.totem ? ` · ${member.totem}` : ''}</span>
        </div>
      </div>
      {q.isLoading ? <Loading rows={2} compact /> : q.error || !q.data ? <ErrorBox error={q.error ?? 'Sem acesso a este percurso.'} /> : (() => {
        const p = q.data;
        const pos = memberPosition(p, catalog);
        const check = stageChecklist(catalog, p);
        const action = nextAction(catalog, p);
        return (
          <>
            <dl className="meta">
              <dt>Etapa atual</dt>
              <dd><strong>{milestoneByKey[pos.milestone].name}</strong> · {STATE_LABEL[pos.state].label}</dd>
            </dl>
            <FaceisSummary catalog={catalog} progress={p} compact />
            <div className="next-line">
              <span className="faint">{self ? 'O teu próximo passo' : 'Próximo passo do pioneiro'}</span>
              <p style={{ margin: 0 }}><strong>{check && check.summary.path.status !== 'concluida' ? check.headline : action.title}</strong></p>
            </div>
          </>
        );
      })()}
      <div className="btn-row">
        <Link to={`${base}${join}vista=caminho`} className="btn">Ver percurso</Link>
        <Link to={`${base}${join}vista=areas`} className="btn secondary">Ver trilhos</Link>
      </div>
    </div>
  );
}
