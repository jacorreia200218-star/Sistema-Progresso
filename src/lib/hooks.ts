import { useQuery } from '@tanstack/react-query';
import { fetchMemberProgress, fetchSectionMembers, fetchTeams } from './api';

export function useProgress(membershipId: string | undefined) {
  return useQuery({
    queryKey: ['progress', membershipId],
    queryFn: () => fetchMemberProgress(membershipId!),
    enabled: !!membershipId,
  });
}

export function useMembers(sectionId: string | undefined) {
  return useQuery({ queryKey: ['members', sectionId], queryFn: () => fetchSectionMembers(sectionId!), enabled: !!sectionId });
}

export function useTeams(sectionId: string | undefined) {
  return useQuery({ queryKey: ['teams', sectionId], queryFn: () => fetchTeams(sectionId!), enabled: !!sectionId });
}
