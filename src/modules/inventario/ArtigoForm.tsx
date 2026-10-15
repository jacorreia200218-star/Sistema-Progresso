// Criar ou editar um artigo (quem gere o material). Fotografia opcional, guardada
// como anexo privado do módulo.
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { ErrorBox, Field, Loading, Notice, PageTitle } from '../../components/ui';
import { uploadModuleFile } from '../files';
import { useItem, useOverview, useSectionId, type ItemDetail, type Overview } from './api';

export function ArtigoForm() {
  const { id } = useParams();
  const ov = useOverview();
  const item = useItem(id);
  if (ov.isLoading || (id && item.isLoading)) return <Loading />;
  if (ov.error || item.error) return <ErrorBox error={ov.error ?? item.error} />;
  if (!ov.data?.can_manage) {
    return (
      <>
        <PageTitle title={id ? 'Editar artigo' : 'Novo artigo'} back="/inventario" />
        <Notice kind="info">Só os dirigentes e os responsáveis pelo material podem registar ou alterar artigos.</Notice>
      </>
    );
  }
  return <FormBody key={id ?? 'novo'} ov={ov.data} it={item.data} />;
}

function FormBody({ ov, it }: { ov: Overview; it?: ItemDetail }) {
  const section = useSectionId();
  const navigate = useNavigate();
  const action = useAction();
  const [name, setName] = useState(it?.name ?? '');
  const [category, setCategory] = useState(it?.category_id ?? '');
  const [newCat, setNewCat] = useState('');
  const [description, setDescription] = useState(it?.description ?? '');
  const [unit, setUnit] = useState(it?.unit ?? 'un.');
  const [location, setLocation] = useState(it?.location ?? '');
  const [tracking, setTracking] = useState<'quantidade' | 'pecas'>(it?.tracking ?? 'quantidade');
  const [quantity, setQuantity] = useState('1');
  const [pieces, setPieces] = useState('');
  const [min, setMin] = useState(it?.min_quantity != null ? String(it.min_quantity) : '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!name.trim()) err.name = 'Indica o nome do artigo.';
    if (!unit.trim()) err.unit = 'Indica a unidade (por exemplo: un., par, kg).';
    const q = Number(quantity);
    if (!it && tracking === 'quantidade' && (quantity.trim() === '' || !Number.isInteger(q) || q < 0)) err.quantity = 'Indica uma quantidade inteira, 0 ou mais.';
    const m = min.trim() === '' ? null : Number(min);
    if (m != null && (!Number.isInteger(m) || m < 0)) err.min = 'A quantidade mínima tem de ser um número inteiro, 0 ou mais.';
    const pieceList = pieces.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
      const [code, serial] = l.split(';').map((x) => x.trim());
      return { code, serial: serial || null };
    });
    if (!it && tracking === 'pecas' && new Set(pieceList.map((p) => p.code.toLowerCase())).size !== pieceList.length) err.pieces = 'Há códigos de peça repetidos.';
    if (photo && !['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) err.photo = 'A fotografia tem de ser JPG, PNG ou WebP.';
    if (photo && photo.size > 10 * 1024 * 1024) err.photo = 'A fotografia é demasiado grande (máximo 10 MB).';
    setErrors(err);
    if (Object.keys(err).length) return;
    const r = await action.run(async () => {
      let cat: string | null = category || null;
      if (newCat.trim()) cat = await call<string>('inv_category_save', { p_section: section, p_id: null, p_name: newCat.trim() });
      const saved = await call<string>('inv_item_save', {
        p_section: section, p_id: it?.id ?? null, p_category: cat, p_name: name, p_description: description || null, p_unit: unit,
        p_location: location || null, p_tracking: it ? null : tracking, p_quantity: it ? null : (tracking === 'quantidade' ? q : 0),
        p_min_quantity: m, p_pieces: it || tracking !== 'pecas' ? null : pieceList,
      });
      if (photo) await uploadModuleFile(section, 'inventario', 'item', saved, photo);
      return saved;
    }, it ? 'Artigo guardado.' : 'Artigo registado.');
    if (r.ok && r.value) navigate(`/inventario/artigo/${r.value}`, { replace: !!it });
  };

  return (
    <div className="inv-page">
      <PageTitle title={it ? 'Editar artigo' : 'Novo artigo'} back={it ? `/inventario/artigo/${it.id}` : '/inventario'} />
      <form className="card inv-form-main" onSubmit={submit} noValidate>
        <ErrorBox error={action.error} />
        {action.success && <Notice kind="success">{action.success}</Notice>}
        <Field label="Nome" htmlFor="inv-name">
          <input id="inv-name" type="text" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.name} />
        </Field>
        {errors.name && <p className="field-error" role="alert">{errors.name}</p>}
        <div className="grid-2">
          <Field label="Categoria" htmlFor="inv-cat">
            <select id="inv-cat" value={category} onChange={(e) => setCategory(e.target.value)} disabled={!!newCat.trim()}>
              <option value="">Sem categoria</option>
              {ov.categories.filter((c) => !c.archived || c.id === category).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Ou nova categoria" htmlFor="inv-newcat">
            <input id="inv-newcat" type="text" maxLength={80} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Por exemplo: Cozinha" />
          </Field>
        </div>
        <Field label="Descrição (opcional)" htmlFor="inv-desc">
          <textarea id="inv-desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Unidade" htmlFor="inv-unit">
            <input id="inv-unit" type="text" maxLength={20} value={unit} onChange={(e) => setUnit(e.target.value)} aria-invalid={!!errors.unit} />
          </Field>
          <Field label="Localização (opcional)" htmlFor="inv-loc">
            <input id="inv-loc" type="text" maxLength={120} list="inv-locations" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Por exemplo: Arrecadação" />
            <datalist id="inv-locations">{ov.locations.map((l) => <option key={l} value={l} />)}</datalist>
          </Field>
        </div>
        {errors.unit && <p className="field-error" role="alert">{errors.unit}</p>}
        {!it && (
          <fieldset className="radio-row">
            <legend className="label">Controlo</legend>
            <label className="radio"><input type="radio" name="inv-track" checked={tracking === 'quantidade'} onChange={() => setTracking('quantidade')} /> Por quantidade</label>
            <label className="radio"><input type="radio" name="inv-track" checked={tracking === 'pecas'} onChange={() => setTracking('pecas')} /> Peças identificadas (código ou n.º de série)</label>
          </fieldset>
        )}
        {!it && tracking === 'quantidade' && (
          <Field label="Quantidade inicial" htmlFor="inv-qty">
            <input id="inv-qty" type="number" inputMode="numeric" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!errors.quantity} />
          </Field>
        )}
        {errors.quantity && <p className="field-error" role="alert">{errors.quantity}</p>}
        {!it && tracking === 'pecas' && (
          <Field label="Peças (uma por linha: código; n.º de série opcional)" htmlFor="inv-pieces" hint="Por exemplo: «T-01; SN4471». Podes acrescentar mais peças depois.">
            <textarea id="inv-pieces" value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder={'T-01\nT-02; SN4471'} />
          </Field>
        )}
        {errors.pieces && <p className="field-error" role="alert">{errors.pieces}</p>}
        <Field label="Quantidade mínima (opcional)" htmlFor="inv-min" hint="Abaixo deste valor disponível, o artigo aparece nos alertas.">
          <input id="inv-min" type="number" inputMode="numeric" min={0} value={min} onChange={(e) => setMin(e.target.value)} aria-invalid={!!errors.min} />
        </Field>
        {errors.min && <p className="field-error" role="alert">{errors.min}</p>}
        <Field label={it?.has_photo ? 'Substituir fotografia (opcional)' : 'Fotografia (opcional)'} htmlFor="inv-photo">
          <input id="inv-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </Field>
        {errors.photo && <p className="field-error" role="alert">{errors.photo}</p>}
        <div className="btn-row">
          <button type="submit" className="btn" disabled={action.busy}>{it ? 'Guardar alterações' : 'Registar artigo'}</button>
          <button type="button" className="btn secondary" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
