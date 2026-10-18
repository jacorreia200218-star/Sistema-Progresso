// Criar ou editar um artigo (quem gere o material). Primeiro o essencial (nome, tipo, quantidade,
// localização e conservação); o local exato, a descrição, o mínimo, o controlo por peças, as
// observações e a fotografia (anexo privado do módulo) ficam em «Mais detalhes».
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { call } from '../../lib/api';
import { useAction } from '../../lib/useAction';
import { ErrorBox, Field, Loading, MoreOptions, Notice, PageTitle } from '../../components/ui';
import { uploadModuleFile } from '../files';
import { CONSERVATION_LABEL, useItem, useOverview, useSectionId, type Conservation, type ItemDetail, type Overview } from './api';

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
  // Local exato (registos antigos: o texto da localização aparece como «sala»).
  const [room, setRoom] = useState(it?.room ?? (it && !it.cabinet && !it.shelf && !it.box ? it.location ?? '' : ''));
  const [cabinet, setCabinet] = useState(it?.cabinet ?? '');
  const [shelf, setShelf] = useState(it?.shelf ?? '');
  const [box, setBox] = useState(it?.box ?? '');
  const [condition, setCondition] = useState<Conservation | ''>(it?.condition ?? '');
  const [notes, setNotes] = useState(it?.notes ?? '');
  const [tracking, setTracking] = useState<'quantidade' | 'pecas'>(it?.tracking ?? 'quantidade');
  const [quantity, setQuantity] = useState('1');
  const [pieces, setPieces] = useState('');
  const [min, setMin] = useState(it?.min_quantity != null ? String(it.min_quantity) : '');
  const [photo, setPhoto] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // «Mais detalhes» abre sozinho quando já há algo preenchido ou um erro lá dentro (e não volta a fechar sozinho).
  const [moreOpen, setMoreOpen] = useState(() => !!(it && (it.cabinet || it.shelf || it.box || it.description || it.notes || it.min_quantity != null)));
  const NEW_CAT = '__novo';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const err: Record<string, string> = {};
    if (!name.trim()) err.name = 'Indica o nome do artigo.';
    if (category === NEW_CAT && !newCat.trim()) err.newCat = 'Indica o nome do novo tipo.';
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
    if (err.min || err.pieces || err.photo) setMoreOpen(true);
    if (Object.keys(err).length) return;
    const r = await action.run(async () => {
      let cat: string | null = category === NEW_CAT ? null : category || null;
      if (category === NEW_CAT) cat = await call<string>('inv_category_save', { p_section: section, p_id: null, p_name: newCat.trim() });
      const saved = await call<string>('inv_item_save', {
        p_section: section, p_id: it?.id ?? null, p_category: cat, p_name: name, p_description: description || null, p_unit: unit,
        p_location: null, p_room: room.trim() || null, p_cabinet: cabinet.trim() || null, p_shelf: shelf.trim() || null, p_box: box.trim() || null,
        p_condition: condition || null, p_notes: notes.trim() || null, p_tracking: it ? null : tracking, p_quantity: it ? null : (tracking === 'quantidade' ? q : 0),
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
          <Field label="Tipo" htmlFor="inv-cat">
            <select id="inv-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">Sem tipo</option>
              {ov.categories.filter((c) => !c.archived || c.id === category).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value={NEW_CAT}>Novo tipo…</option>
            </select>
          </Field>
          {category === NEW_CAT && (
            <Field label="Nome do novo tipo" htmlFor="inv-newcat">
              <input id="inv-newcat" type="text" maxLength={80} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="Por exemplo: Cozinha" aria-invalid={!!errors.newCat} autoFocus />
            </Field>
          )}
        </div>
        {errors.newCat && <p className="field-error" role="alert">{errors.newCat}</p>}
        <div className="grid-2">
          {!it && tracking === 'quantidade' && (
            <Field label="Quantidade inicial" htmlFor="inv-qty">
              <input id="inv-qty" type="number" inputMode="numeric" min={0} value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-invalid={!!errors.quantity} />
            </Field>
          )}
          {!it && tracking === 'pecas' && <p className="faint inv-qty-note">Quantidade: as peças indicadas em «Mais detalhes».</p>}
          <Field label="Unidade" htmlFor="inv-unit">
            <input id="inv-unit" type="text" maxLength={20} value={unit} onChange={(e) => setUnit(e.target.value)} aria-invalid={!!errors.unit} />
          </Field>
        </div>
        {errors.quantity && <p className="field-error" role="alert">{errors.quantity}</p>}
        {errors.unit && <p className="field-error" role="alert">{errors.unit}</p>}
        <div className="grid-2">
          <Field label="Localização" htmlFor="inv-room">
            <input id="inv-room" type="text" maxLength={120} list="inv-rooms" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Sala ou espaço (ex.: Arrecadação)" />
            <datalist id="inv-rooms">{ov.rooms.map((l) => <option key={l} value={l} />)}</datalist>
          </Field>
          <Field label="Estado de conservação" htmlFor="inv-cond">
            <select id="inv-cond" value={condition} onChange={(e) => setCondition(e.target.value as Conservation | '')}>
              <option value="">Não indicado</option>
              {(Object.keys(CONSERVATION_LABEL) as Conservation[]).map((c) => <option key={c} value={c}>{CONSERVATION_LABEL[c]}</option>)}
            </select>
          </Field>
        </div>
        <MoreOptions label="Mais detalhes" open={moreOpen}>
          <fieldset className="inv-place">
            <legend className="label">Local exato (opcional)</legend>
            <div className="inv-grid-3">
              <Field label="Armário" htmlFor="inv-cab">
                <input id="inv-cab" type="text" maxLength={80} list="inv-cabs" value={cabinet} onChange={(e) => setCabinet(e.target.value)} placeholder="Ex.: Armário 2" />
                <datalist id="inv-cabs">{[...new Set(ov.cabinets.map((c) => c.cabinet))].map((l) => <option key={l} value={l} />)}</datalist>
              </Field>
              <Field label="Prateleira" htmlFor="inv-shelf">
                <input id="inv-shelf" type="text" maxLength={80} value={shelf} onChange={(e) => setShelf(e.target.value)} />
              </Field>
              <Field label="Caixa" htmlFor="inv-box">
                <input id="inv-box" type="text" maxLength={80} value={box} onChange={(e) => setBox(e.target.value)} />
              </Field>
            </div>
          </fieldset>
          <Field label="Descrição (opcional)" htmlFor="inv-desc">
            <textarea id="inv-desc" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <Field label="Quantidade mínima (opcional)" htmlFor="inv-min" hint="Abaixo deste valor disponível, o artigo conta como «Stock baixo».">
            <input id="inv-min" type="number" inputMode="numeric" min={0} value={min} onChange={(e) => setMin(e.target.value)} aria-invalid={!!errors.min} />
          </Field>
          {errors.min && <p className="field-error" role="alert">{errors.min}</p>}
          {!it && (
            <fieldset className="radio-row">
              <legend className="label">Controlo</legend>
              <label className="radio"><input type="radio" name="inv-track" checked={tracking === 'quantidade'} onChange={() => setTracking('quantidade')} /> Por quantidade</label>
              <label className="radio"><input type="radio" name="inv-track" checked={tracking === 'pecas'} onChange={() => setTracking('pecas')} /> Peças identificadas (código ou n.º de série)</label>
            </fieldset>
          )}
          {!it && tracking === 'pecas' && (
            <Field label="Peças (uma por linha: código; n.º de série opcional)" htmlFor="inv-pieces" hint="Por exemplo: «T-01; SN4471». Podes acrescentar mais peças depois.">
              <textarea id="inv-pieces" value={pieces} onChange={(e) => setPieces(e.target.value)} placeholder={'T-01\nT-02; SN4471'} />
            </Field>
          )}
          {errors.pieces && <p className="field-error" role="alert">{errors.pieces}</p>}
          <Field label="Observações (opcional)" htmlFor="inv-notes">
            <textarea id="inv-notes" maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <Field label={it?.has_photo ? 'Substituir fotografia (opcional)' : 'Fotografia (opcional)'} htmlFor="inv-photo">
            <input id="inv-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          </Field>
          {errors.photo && <p className="field-error" role="alert">{errors.photo}</p>}
        </MoreOptions>
        <div className="btn-row">
          <button type="submit" className="btn" disabled={action.busy}>{it ? 'Guardar alterações' : 'Registar artigo'}</button>
          <button type="button" className="btn secondary" onClick={() => navigate(-1)}>Cancelar</button>
        </div>
      </form>
    </div>
  );
}
