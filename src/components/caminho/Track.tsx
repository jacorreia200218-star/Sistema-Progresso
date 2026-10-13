// Percurso simplificado: os marcos do manual numa linha reta (sem curvas nem
// relevo decorativo). A posição de cada pessoa resulta do progresso validado;
// não há arrastar nem ordenação por progresso.
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { MILESTONES, type MilestoneKey } from '../../lib/caminho';
import type { PathMember } from '../../lib/api';
import { Avatar } from '../ui';

export type StepStatus = 'feito' | 'atual' | 'por_vir' | 'info' | 'neutro';

export interface TrackStep {
  status: StepStatus;
  caption?: string;
  content?: ReactNode;
}

export function Track({ steps, label }: { steps: Record<MilestoneKey, TrackStep>; label: string }) {
  return (
    <ol className="track" aria-label={label}>
      {MILESTONES.map((m, i) => {
        const s = steps[m.key];
        return (
          <li key={m.key} className={`track-step st-${s.status}`} aria-current={s.status === 'atual' ? 'step' : undefined}>
            <span className="track-dot" aria-hidden="true">{s.status === 'feito' ? <Check size={14} /> : i + 1}</span>
            <div className="track-main">
              <div className="track-head">
                <strong>{m.name}</strong>
                {s.caption && <span className="track-caption">{s.caption}</span>}
              </div>
              {s.content}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const firstName = (n: string) => n.split(/\s+/)[0] ?? n;

/** Avatares de um marco (todos iguais), com «+N» para a lista completa. */
export function PeopleRow({ people, max, hidden, onPick, onMore, teamName }: {
  people: PathMember[];
  max: number;
  hidden: number;
  onPick: (id: string) => void;
  onMore: () => void;
  teamName: (id: string | null) => string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  if (!people.length && !hidden) return null;
  return (
    <ul className="people-row">
      {shown.map((p) => (
        <li key={p.membership_id}>
          <button type="button" className="avatar-btn" onClick={() => onPick(p.membership_id)}
            aria-label={`${p.full_name}${p.is_me ? ' (tu)' : ''}, ${teamName(p.team_id)}`}>
            <Avatar name={p.full_name} photoPath={p.photo_path} />
            <span className="avatar-name" aria-hidden="true">{p.is_me ? 'Tu' : firstName(p.full_name)}</span>
          </button>
        </li>
      ))}
      {rest > 0 && (
        <li>
          <button type="button" className="avatar-btn" onClick={onMore} aria-label={`Ver todos (${people.length})`}>
            <span className="avatar more" aria-hidden="true">+{rest}</span>
            <span className="avatar-name" aria-hidden="true">Ver todos</span>
          </button>
        </li>
      )}
      {hidden > 0 && (
        <li className="people-hidden">
          {people.length ? `+${hidden} ${hidden === 1 ? 'outro' : 'outros'}` : `${hidden} ${hidden === 1 ? 'pioneiro' : 'pioneiros'}`}
          <span className="sr-only"> (o nome só aparece a quem acompanha o percurso)</span>
        </li>
      )}
    </ul>
  );
}
