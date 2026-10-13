// Acesso a dados. Leituras diretas (filtradas por RLS no servidor) e escritas
// exclusivamente por funções RPC, que validam permissões no servidor.
import { supabase } from './supabase';
import { errorMessage } from './errors';
import type {
  Adhesion, Attachment, Catalog, CatalogArea, CatalogStage, Experience, Invite, MemberProgress, Membership, MeritAward,
  MeritStatus, NotificationRow, Profile, RequestVersion, Section, SectionSettings, StageChoice, StagePath, StageRequest,
  Team, TrailDecision, TrailRequest,
} from './types';

function check<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw new Error(errorMessage(res.error));
  return res.data as T;
}

export async function call<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await supabase.rpc(fn, args);
  return check<T>(res as { data: T | null; error: unknown });
}

export interface MyMembership extends Membership {
  sections: Section | null;
  teams: Team | null;
}

export async function fetchMe(userId: string): Promise<{ profile: Profile | null; memberships: MyMembership[] }> {
  const [p, m] = await Promise.all([
    supabase.from('profiles').select('id, full_name, totem, photo_path').eq('id', userId).maybeSingle(),
    supabase
      .from('memberships')
      .select('*, sections(id, name, kind, group_id, catalog_version_id, groups(name)), teams!memberships_team_id_fkey(id, section_id, name, archived_at)')
      .eq('profile_id', userId)
      .order('requested_at'),
  ]);
  return { profile: check(p), memberships: check(m) as unknown as MyMembership[] };
}

export async function fetchSettings(sectionId: string): Promise<SectionSettings | null> {
  return check(await supabase.from('section_settings').select('*').eq('section_id', sectionId).maybeSingle());
}

export async function fetchCatalog(versionId: string): Promise<Catalog> {
  const [v, a, s] = await Promise.all([
    supabase.from('catalog_versions').select('id, label').eq('id', versionId).single(),
    supabase
      .from('catalog_areas')
      .select('*, catalog_trails(*, catalog_objectives(*))')
      .eq('version_id', versionId)
      .order('position'),
    supabase.from('catalog_stages').select('*').eq('version_id', versionId).order('ordinal'),
  ]);
  const version = check(v) as { id: string; label: string };
  const areas = (check(a) as CatalogArea[]).map((area) => ({
    ...area,
    catalog_trails: [...area.catalog_trails]
      .sort((x, y) => x.position - y.position)
      .map((t) => ({ ...t, catalog_objectives: [...t.catalog_objectives].sort((x, y) => x.position - y.position) })),
  }));
  const trailById = new Map();
  const trailByKey = new Map();
  const areaById = new Map();
  for (const area of areas) {
    areaById.set(area.id, area);
    for (const t of area.catalog_trails) {
      trailById.set(t.id, t);
      trailByKey.set(t.key, t);
    }
  }
  return { versionId: version.id, label: version.label, areas, stages: check(s) as CatalogStage[], trailById, trailByKey, areaById };
}

export async function fetchMemberProgress(membershipId: string): Promise<MemberProgress> {
  const [ad, paths, choices, requests, stageReqs, merit] = await Promise.all([
    supabase.from('adhesions').select('*').eq('membership_id', membershipId).maybeSingle(),
    supabase.from('stage_paths').select('*').eq('membership_id', membershipId).order('stage_ordinal'),
    supabase.from('stage_choices').select('*').eq('membership_id', membershipId).order('proposed_at'),
    supabase.from('trail_requests').select('*').eq('membership_id', membershipId).order('updated_at', { ascending: false }),
    supabase.from('stage_requests').select('*').eq('membership_id', membershipId).order('requested_at'),
    supabase.from('merit_awards').select('*').eq('membership_id', membershipId).maybeSingle(),
  ]);
  const reqs = check(requests) as TrailRequest[];
  let decisions: TrailDecision[] = [];
  if (reqs.length) {
    decisions = check(
      await supabase.from('trail_decisions').select('*').in('request_id', reqs.map((r) => r.id))
        .neq('kind', 'em_revisao').order('recorded_at', { ascending: false }),
    ) as TrailDecision[];
  }
  return {
    decisions,
    adhesion: check(ad) as Adhesion | null,
    paths: check(paths) as StagePath[],
    choices: check(choices) as StageChoice[],
    requests: reqs,
    stageRequests: check(stageReqs) as StageRequest[],
    merit: check(merit) as MeritAward | null,
  };
}

export interface MemberRow extends Membership {
  profiles: Profile | null;
}

export async function fetchSectionMembers(sectionId: string): Promise<MemberRow[]> {
  const res = await supabase
    .from('memberships')
    .select('*, profiles(id, full_name, totem, photo_path)')
    .eq('section_id', sectionId)
    .order('requested_at');
  return (check(res) as MemberRow[]).sort((a, b) => (a.profiles?.full_name ?? '').localeCompare(b.profiles?.full_name ?? '', 'pt'));
}

export async function fetchTeams(sectionId: string): Promise<Team[]> {
  return check(await supabase.from('teams').select('*').eq('section_id', sectionId).order('name')) as Team[];
}

export interface RequestDetail {
  request: TrailRequest;
  versions: RequestVersion[];
  decisions: TrailDecision[];
  attachments: Attachment[];
  member: MemberRow | null;
  recorders: Record<string, string>;
}

export async function fetchRequest(id: string): Promise<RequestDetail | null> {
  const req = check(await supabase.from('trail_requests').select('*').eq('id', id).maybeSingle()) as TrailRequest | null;
  if (!req) return null;
  const [versions, decisions, attachments, member] = await Promise.all([
    supabase.from('trail_request_versions').select('*').eq('request_id', id).order('version_no'),
    supabase.from('trail_decisions').select('*').eq('request_id', id).order('recorded_at'),
    supabase.from('attachments').select('*').eq('request_id', id).order('created_at'),
    supabase.from('memberships').select('*, profiles(id, full_name, totem, photo_path)').eq('id', req.membership_id).maybeSingle(),
  ]);
  const dec = check(decisions) as TrailDecision[];
  const ids = [...new Set(dec.map((d) => d.recorded_by))];
  const recorders: Record<string, string> = {};
  if (ids.length) {
    const profs = check(await supabase.from('profiles').select('id, full_name').in('id', ids)) as { id: string; full_name: string }[];
    for (const p of profs) recorders[p.id] = p.full_name;
  }
  return {
    request: req,
    versions: check(versions) as RequestVersion[],
    decisions: dec,
    attachments: check(attachments) as Attachment[],
    member: check(member) as MemberRow | null,
    recorders,
  };
}

/** Pedidos visíveis na secção (RLS limita ao que o utilizador pode ver). */
export async function fetchSectionRequests(sectionId: string, statuses?: string[]): Promise<TrailRequest[]> {
  let q = supabase.from('trail_requests').select('*').eq('section_id', sectionId).order('updated_at', { ascending: false });
  if (statuses) q = q.in('status', statuses);
  return check(await q) as TrailRequest[];
}

export async function fetchSectionChoices(memberIds: string[], status?: string): Promise<StageChoice[]> {
  if (!memberIds.length) return [];
  let q = supabase.from('stage_choices').select('*').in('membership_id', memberIds).order('proposed_at');
  if (status) q = q.eq('status', status);
  return check(await q) as StageChoice[];
}

export async function fetchSectionStagePaths(memberIds: string[]): Promise<StagePath[]> {
  if (!memberIds.length) return [];
  return check(await supabase.from('stage_paths').select('*').in('membership_id', memberIds)) as StagePath[];
}

export async function fetchSectionStageRequests(memberIds: string[]): Promise<StageRequest[]> {
  if (!memberIds.length) return [];
  return check(await supabase.from('stage_requests').select('*').in('membership_id', memberIds).order('requested_at', { ascending: false })) as StageRequest[];
}

export async function fetchNotifications(): Promise<NotificationRow[]> {
  return check(await supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(100)) as NotificationRow[];
}

export async function fetchInvites(sectionId: string): Promise<Invite[]> {
  return check(await supabase.from('invites').select('*').eq('section_id', sectionId).order('created_at', { ascending: false })) as Invite[];
}

export async function fetchSettingsHistory(sectionId: string) {
  return check(await supabase.from('settings_history').select('*').eq('section_id', sectionId).order('changed_at', { ascending: false }).limit(20)) as {
    id: number; setting: string; old_value: unknown; new_value: unknown; changed_by: string; changed_at: string;
  }[];
}

export async function fetchMembershipHistory(sectionId: string) {
  return check(await supabase.from('membership_history').select('*').eq('section_id', sectionId).order('changed_at', { ascending: false }).limit(50)) as {
    id: number; membership_id: string; changed_by: string | null; changed_at: string; old_status: string | null; new_status: string | null;
    old_function: string | null; new_function: string | null; old_team_id: string | null; new_team_id: string | null;
    old_is_admin: boolean | null; new_is_admin: boolean | null; reason: string | null;
  }[];
}

export async function fetchExperiences(membershipId: string): Promise<Experience[]> {
  return check(await supabase.from('experiences').select('*').eq('membership_id', membershipId).order('occurred_on', { ascending: false, nullsFirst: false })) as Experience[];
}

export async function fetchMeritStatus(membershipId: string): Promise<MeritStatus> {
  return call<MeritStatus>('merit_eligibility', { p_membership: membershipId });
}

export async function signedUrl(bucket: 'anexos' | 'fotografias', path: string, seconds = 300): Promise<string> {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw new Error(errorMessage(error));
  return data.signedUrl;
}

export interface PathMember {
  membership_id: string;
  full_name: string;
  totem: string | null;
  photo_path: string | null;
  team_id: string | null;
  function: 'pioneiro' | 'guia';
  milestone: string;
  state: string;
  is_me: boolean;
}

export interface SectionPath {
  scope: 'seccao' | 'equipa' | 'proprio';
  total: number;
  counts: Record<string, number>;
  members: PathMember[];
}

/** Caminho da secção: contagens para todos; nomes só dentro das permissões (verificado no servidor). */
export function fetchSectionPath(sectionId: string): Promise<SectionPath> {
  return call<SectionPath>('section_path', { p_section: sectionId });
}

export function fetchPendingCounts(sectionId: string): Promise<Record<string, number>> {
  return call<Record<string, number>>('my_pending_counts', { p_section: sectionId });
}

export interface ActivityItem {
  at: string;
  kind: string;
  membership_id: string;
  member: string;
  subject: string | null;
  ref: string;
}

export function fetchActivity(sectionId: string, limit = 12): Promise<ActivityItem[]> {
  return call<ActivityItem[]>('section_activity', { p_section: sectionId, p_limit: limit });
}
