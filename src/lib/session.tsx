// Contexto da secção ativa: perfil, inscrição, papéis, configuração e catálogo.
// Os papéis aqui servem apenas para mostrar ou esconder ecrãs: todas as
// permissões são verificadas de novo no servidor.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthProvider';
import { fetchCatalog, fetchMe, fetchMyTeamRole, fetchSettings, type MyMembership, type TeamRole } from './api';
import type { Catalog, Profile, SectionSettings } from './types';

const KEY = 'pioneiros.secao';

export interface SectionContextValue {
  userId: string;
  profile: Profile | null;
  memberships: MyMembership[];
  membership: MyMembership | null; // inscrição ativa selecionada
  pending: MyMembership[];
  settings: SectionSettings | null;
  catalog: Catalog | null;
  isMember: boolean; // pioneiro ou guia (tem percurso próprio)
  isGuia: boolean;
  /** Subguia (cargo em Equipas e cargos): decide na reunião de Equipa como o guia. */
  isSubguia: boolean;
  /** Equipa cujos pedidos decido na reunião de Equipa (guia ou subguia). */
  decidesTeam: string | null;
  /** Quem decide em cada equipa (guias e subguias), quando o servidor o indica. */
  teamDeciders: TeamRole['deciders'];
  isDirigente: boolean;
  isAdmin: boolean;
  selectSection: (sectionId: string) => void;
  loading: boolean;
  error: unknown;
  refetch: () => void;
}

const Ctx = createContext<SectionContextValue | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function SectionProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  const [selected, setSelected] = useState<string | null>(readStored);

  const me = useQuery({ queryKey: ['me', userId], queryFn: () => fetchMe(userId), enabled: !!userId });
  const memberships = me.data?.memberships ?? [];
  const active = memberships.filter((m) => m.status === 'ativo');
  const membership = active.find((m) => m.section_id === selected) ?? active[0] ?? null;

  useEffect(() => {
    if (membership && membership.section_id !== selected) setSelected(membership.section_id);
  }, [membership, selected]);

  const settings = useQuery({
    queryKey: ['settings', membership?.section_id],
    queryFn: () => fetchSettings(membership!.section_id),
    enabled: !!membership,
  });
  const versionId = membership?.sections?.catalog_version_id ?? null;
  const teamRole = useQuery({
    queryKey: ['team-role', membership?.section_id, userId],
    queryFn: () => fetchMyTeamRole(membership!.section_id),
    enabled: !!membership,
  });
  const catalog = useQuery({
    queryKey: ['catalog', versionId],
    queryFn: () => fetchCatalog(versionId!),
    enabled: !!versionId,
    staleTime: Infinity,
  });

  const value = useMemo<SectionContextValue>(() => {
    const fn = membership?.function ?? null;
    return {
      userId,
      profile: me.data?.profile ?? null,
      memberships,
      membership,
      pending: memberships.filter((m) => m.status === 'pendente'),
      settings: settings.data ?? null,
      catalog: catalog.data ?? null,
      isMember: fn === 'pioneiro' || fn === 'guia',
      isGuia: fn === 'guia',
      isSubguia: teamRole.data?.role === 'subguia',
      decidesTeam: teamRole.data?.decider_team ?? (fn === 'guia' ? membership?.team_id ?? null : null),
      teamDeciders: teamRole.data?.deciders ?? [],
      isDirigente: fn === 'dirigente',
      isAdmin: !!membership?.is_admin,
      selectSection: (id) => {
        try {
          localStorage.setItem(KEY, id);
        } catch {
          /* armazenamento indisponível: a escolha vale só nesta sessão */
        }
        setSelected(id);
      },
      loading: me.isLoading || (!!membership && (settings.isLoading || catalog.isLoading)),
      error: me.error ?? settings.error ?? catalog.error,
      refetch: () => {
        me.refetch();
        settings.refetch();
      },
    };
  }, [userId, me.data, me.isLoading, me.error, memberships, membership, settings.data, settings.isLoading, settings.error, catalog.data, catalog.isLoading, catalog.error, teamRole.data]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSection(): SectionContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSection fora de SectionProvider');
  return v;
}

/** Versão para ecrãs que exigem secção ativa e catálogo carregado. */
export function useActiveSection() {
  const s = useSection();
  if (!s.membership || !s.catalog) throw new Error('Secção ativa indisponível');
  return { ...s, membership: s.membership, catalog: s.catalog };
}
