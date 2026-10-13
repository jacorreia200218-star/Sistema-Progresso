// Quem está a ser consultado no «Meu progresso»: o próprio pioneiro/guia ou,
// em modo de consulta, um pioneiro autorizado (dirigente: toda a secção; guia:
// a sua equipa). A autorização vem do servidor (section_path) e as leituras
// continuam protegidas por RLS. Nunca se cria percurso para o dirigente.
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useActiveSection } from '../../lib/session';
import { useProgress } from '../../lib/hooks';
import { fetchExperiences, fetchSectionPath, type PathMember } from '../../lib/api';

export function useSubject() {
  const s = useActiveSection();
  const [params] = useSearchParams();
  const requested = params.get('pioneiro');
  const path = useQuery({ queryKey: ['section-path', s.membership.section_id], queryFn: () => fetchSectionPath(s.membership.section_id) });
  const authorized = (path.data?.members ?? []).filter((m) => !m.is_me || s.isMember);
  const consulted = requested && requested !== s.membership.id ? authorized.find((m) => m.membership_id === requested) : undefined;
  const subjectId = consulted ? consulted.membership_id : s.isMember ? s.membership.id : null;
  const isSelf = !!subjectId && subjectId === s.membership.id;
  const progress = useProgress(subjectId ?? undefined);
  // O diário de vivências é privado: só se carrega para o próprio.
  const experiences = useQuery({
    queryKey: ['experiences', s.membership.id],
    queryFn: () => fetchExperiences(s.membership.id),
    enabled: isSelf,
  });
  const me = (path.data?.members ?? []).find((m) => m.is_me);
  const subject: PathMember | undefined = consulted ?? me;
  return {
    ...s,
    subjectId,
    isSelf,
    consulted,
    subject,
    authorized: authorized.filter((m) => !m.is_me),
    pathLoading: path.isLoading,
    progress,
    experiences: isSelf ? experiences.data ?? [] : [],
    /** Sufixo de URL para manter o modo de consulta ao navegar. */
    q: consulted ? `pioneiro=${consulted.membership_id}` : '',
  };
}

export type Subject = ReturnType<typeof useSubject>;
