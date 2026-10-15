// Anexos dos módulos: reservar o caminho no servidor (que valida a permissão),
// carregar para o bucket privado «modulos» e abrir com URL temporário.
import { supabase } from '../lib/supabase';
import { call } from '../lib/api';
import type { ModuleKey } from './common';

export type ModuleFile = { path: string; file_name: string; mime: string; created_at: string };

export async function uploadModuleFile(section: string, module: ModuleKey, entity: string, entityId: string, file: File) {
  if (file.size > 10 * 1024 * 1024) throw new Error('O ficheiro é demasiado grande (máximo 10 MB).');
  const path = await call<string>('module_file_prepare', {
    p_section: section, p_module: module, p_entity: entity, p_entity_id: entityId, p_file_name: file.name, p_mime: file.type,
  });
  const up = await supabase.storage.from('modulos').upload(path, file, { contentType: file.type });
  if (up.error) throw up.error;
  return path;
}

export const listModuleFiles = (section: string, module: ModuleKey, entity: string, entityId: string) =>
  call<ModuleFile[]>('module_files_of', { p_section: section, p_module: module, p_entity: entity, p_entity_id: entityId });

export async function openModuleFile(path: string) {
  const { data, error } = await supabase.storage.from('modulos').createSignedUrl(path, 60);
  if (error || !data) throw error ?? new Error('Não foi possível abrir o ficheiro.');
  window.open(data.signedUrl, '_blank', 'noopener');
}

export const removeModuleFile = (path: string) => call('module_file_remove', { p_path: path });
