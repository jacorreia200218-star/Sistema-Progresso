// Mapa do caminho da secção: os marcos e quem está em cada um (Caminho da secção e Início).
// Mostra sempre todas as pessoas, com fotografia, sem «+N».
import { MILESTONES, type MilestoneKey } from '../../lib/caminho';
import type { PathMember } from '../../lib/api';
import { PeopleRow, shortNames, Track, type TrackStep } from './Track';

export function SectionMap({ visible, shown = visible, counts, filtering = false, teamName, onPick, onMore }: {
  /** Todas as pessoas visíveis (para os nomes curtos e para contar as escondidas). */
  visible: PathMember[];
  /** As que aparecem no mapa (depois da pesquisa ou do filtro de equipa). */
  shown?: PathMember[];
  counts: Partial<Record<MilestoneKey, number>>;
  filtering?: boolean;
  teamName: (id: string | null) => string;
  onPick: (membershipId: string) => void;
  onMore: (k: MilestoneKey) => void;
}) {
  const names = shortNames(visible);
  const steps = {} as Record<MilestoneKey, TrackStep>;
  for (const m of MILESTONES) {
    if (!m.tracked) {
      steps[m.key] = { status: 'info', caption: m.key === 'passagem' ? 'Idade e maturidade' : 'Antes de entrar' };
      continue;
    }
    const people = shown.filter((x) => x.milestone === m.key);
    const known = visible.filter((x) => x.milestone === m.key).length;
    const hidden = filtering ? 0 : Math.max(0, (counts[m.key] ?? 0) - known);
    const n = filtering ? people.length : counts[m.key] ?? 0;
    steps[m.key] = {
      status: n ? 'ocupado' : 'neutro',
      caption: n ? `${n} ${n === 1 ? 'pessoa' : 'pessoas'}` : 'Ninguém',
      content: (
        <PeopleRow people={people} max={Infinity} hidden={hidden} teamName={teamName} names={names}
          onPick={onPick} onMore={() => onMore(m.key)} />
      ),
    };
  }
  return <Track steps={steps} label="Marcos do caminho e quem está em cada um" />;
}
