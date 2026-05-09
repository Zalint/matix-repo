'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { WorkflowModal } from '@/components/workflows/WorkflowModal';
import {
  api,
  type ConfigurableSetting,
  type CreateWorkflowTemplateInput,
  type ModuleDefinition,
  type Tenant,
  type UpdateWorkflowTemplateInput,
  type WorkflowTemplate,
} from '@/lib/api';

type FormState = {
  code: string;
  name: string;
  description: string;
  required_modules: string[];
  restricted_to_tenants: string[];
  configurable_settings_json: string;
  n8n_definition_json: string;
};

const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  description: '',
  required_modules: ['platform.workflows'],
  restricted_to_tenants: [],
  configurable_settings_json: JSON.stringify(
    [
      { key: 'cron', label: 'Heure d\'execution', type: 'time', default: '23:55', required: true },
      { key: 'recipients', label: 'Destinataires email', type: 'emails', required: true },
    ],
    null,
    2,
  ),
  n8n_definition_json: '',
};

/**
 * /admin/workflows — gestion des templates de workflows globaux (cote Matix).
 *
 * Phase 0 : routes /admin/workflow-templates ouvertes en dev. A proteger
 * Phase 1+ par un guard super-admin Matix (cf. workflow-templates.controller.ts).
 */
export default function AdminWorkflowsPage() {
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [catalog, setCatalog] = useState<ModuleDefinition[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Modale create/update
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'update'>('create');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const reload = () => {
    setError(null);
    api.adminWorkflowTemplates
      .list()
      .then(setTemplates)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  };

  useEffect(() => {
    reload();
    api.licensing.catalog().then(setCatalog).catch(() => undefined);
    api.admin.tenants.list().then(setTenants).catch(() => undefined);
  }, []);

  const tenantById = useMemo(() => new Map(tenants.map((t) => [t.id, t])), [tenants]);

  function openCreate() {
    setEditorMode('create');
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setEditorOpen(true);
  }

  function openUpdate(tpl: WorkflowTemplate) {
    setEditorMode('update');
    setEditingId(tpl.id);
    setForm({
      code: tpl.code,
      name: tpl.name,
      description: tpl.description ?? '',
      required_modules: [...tpl.required_modules],
      restricted_to_tenants: [...tpl.restricted_to_tenants],
      configurable_settings_json: JSON.stringify(tpl.configurable_settings ?? [], null, 2),
      n8n_definition_json: tpl.n8n_definition
        ? JSON.stringify(tpl.n8n_definition, null, 2)
        : '',
    });
    setError(null);
    setEditorOpen(true);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);

    let parsedSettings: ConfigurableSetting[];
    try {
      parsedSettings = JSON.parse(form.configurable_settings_json || '[]');
      if (!Array.isArray(parsedSettings)) {
        throw new Error('configurable_settings doit etre un tableau JSON');
      }
    } catch (err) {
      setError(`JSON invalide pour configurable_settings : ${err instanceof Error ? err.message : String(err)}`);
      setBusy(false);
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsedDefinition: any = undefined;
    if (form.n8n_definition_json.trim()) {
      try {
        parsedDefinition = JSON.parse(form.n8n_definition_json);
      } catch (err) {
        setError(`JSON invalide pour n8n_definition : ${err instanceof Error ? err.message : String(err)}`);
        setBusy(false);
        return;
      }
    }

    try {
      if (editorMode === 'create') {
        const body: CreateWorkflowTemplateInput = {
          code: form.code.trim(),
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          required_modules: form.required_modules,
          restricted_to_tenants: form.restricted_to_tenants,
          configurable_settings: parsedSettings,
          n8n_definition: parsedDefinition,
        };
        const created = await api.adminWorkflowTemplates.create(body);
        setSuccess(`Template "${created.code}" cree.`);
      } else if (editingId) {
        const body: UpdateWorkflowTemplateInput = {
          name: form.name.trim(),
          description: form.description.trim() || undefined,
          required_modules: form.required_modules,
          restricted_to_tenants: form.restricted_to_tenants,
          configurable_settings: parsedSettings,
          n8n_definition: parsedDefinition,
        };
        const updated = await api.adminWorkflowTemplates.update(editingId, body);
        setSuccess(`Template "${updated.code}" mis a jour.`);
      }
      setEditorOpen(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleToggleActive(tpl: WorkflowTemplate) {
    setError(null);
    try {
      await api.adminWorkflowTemplates.setActive(tpl.id, !tpl.is_active);
      setSuccess(`Template "${tpl.code}" ${!tpl.is_active ? 'reactive' : 'desactive'}.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleDelete(tpl: WorkflowTemplate) {
    if (!window.confirm(`Supprimer le template "${tpl.code}" ? Cette action est irreversible et supprimera toutes les instances tenant associees.`)) {
      return;
    }
    setError(null);
    try {
      await api.adminWorkflowTemplates.remove(tpl.id);
      setSuccess(`Template "${tpl.code}" supprime.`);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function toggleModule(code: string) {
    setForm((f) =>
      f.required_modules.includes(code)
        ? { ...f, required_modules: f.required_modules.filter((c) => c !== code) }
        : { ...f, required_modules: [...f.required_modules, code] },
    );
  }

  function toggleTenant(id: string) {
    setForm((f) =>
      f.restricted_to_tenants.includes(id)
        ? { ...f, restricted_to_tenants: f.restricted_to_tenants.filter((t) => t !== id) }
        : { ...f, restricted_to_tenants: [...f.restricted_to_tenants, id] },
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Administration — Workflows</h2>
          <p className="text-sm text-gray-500">
            Gere les templates de workflows globaux. Phase 0 : routes /admin/workflow-templates
            ouvertes en dev — a proteger par un guard super-admin Matix avant prod.
          </p>
        </div>
        <Button onClick={openCreate}>Creer un template</Button>
      </div>

      {error && <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {success && <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">{success}</div>}

      <div className="overflow-x-auto rounded-md border border-gray-200 bg-white">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <Th>Code</Th>
              <Th>Nom</Th>
              <Th>Statut</Th>
              <Th>Modules requis</Th>
              <Th>Tenants restreints</Th>
              <Th>MAJ</Th>
              <Th className="w-48 text-right">Actions</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {templates.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  Aucun template
                </td>
              </tr>
            )}
            {templates.map((tpl) => (
              <tr key={tpl.id} className={tpl.is_active ? '' : 'bg-gray-50/60'}>
                <Td className="font-mono text-xs">{tpl.code}</Td>
                <Td>
                  <div className="font-medium">{tpl.name}</div>
                  {tpl.description && (
                    <div className="text-xs text-gray-500">{tpl.description}</div>
                  )}
                </Td>
                <Td>
                  <ActiveBadge active={tpl.is_active} />
                </Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {tpl.required_modules.map((m) => (
                      <span
                        key={m}
                        className="inline-flex rounded bg-blue-50 px-2 py-0.5 font-mono text-[10px] text-blue-700"
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </Td>
                <Td>
                  {tpl.restricted_to_tenants.length === 0 ? (
                    <span className="text-xs text-gray-400">Tous</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {tpl.restricted_to_tenants.map((id) => (
                        <span
                          key={id}
                          className="inline-flex rounded bg-purple-50 px-2 py-0.5 text-[10px] text-purple-700"
                          title={id}
                        >
                          {tenantById.get(id)?.slug ?? id.slice(0, 8)}
                        </span>
                      ))}
                    </div>
                  )}
                </Td>
                <Td className="text-xs text-gray-500">
                  {new Date(tpl.updated_at).toLocaleDateString('fr-FR')}
                </Td>
                <Td className="space-x-1 text-right">
                  <Button size="sm" variant="ghost" onClick={() => openUpdate(tpl)}>
                    Modifier
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleToggleActive(tpl)}>
                    {tpl.is_active ? 'Desactiver' : 'Reactiver'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => handleDelete(tpl)}>
                    Supprimer
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <WorkflowModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editorMode === 'create' ? 'Nouveau template' : 'Modifier le template'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-gray-700">Code</label>
              <Input
                name="code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="ex: mata.daily_cash_report"
                pattern="^[a-z0-9_.\-]+$"
                disabled={editorMode === 'update'}
                required
              />
              <p className="mt-1 text-xs text-gray-500">
                Minuscules, chiffres, points, tirets, underscores. Immuable apres creation.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Nom</label>
              <Input
                name="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">Modules requis</label>
            <p className="mb-2 text-xs text-gray-500">
              Le tenant doit avoir tous ces modules actives pour pouvoir activer ce workflow.
            </p>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2">
              {catalog.length === 0 && (
                <span className="text-xs text-gray-400">Catalogue indisponible</span>
              )}
              {catalog.map((m) => {
                const checked = form.required_modules.includes(m.code);
                return (
                  <button
                    key={m.code}
                    type="button"
                    onClick={() => toggleModule(m.code)}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[11px] ${
                      checked
                        ? 'bg-brand-600 text-white'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    {checked && '✓ '}
                    {m.code}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Restreindre aux tenants (vide = tous)
            </label>
            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto rounded border border-gray-200 bg-gray-50 p-2">
              {tenants.length === 0 && (
                <span className="text-xs text-gray-400">Aucun tenant connu</span>
              )}
              {tenants.map((t) => {
                const checked = form.restricted_to_tenants.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleTenant(t.id)}
                    className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                      checked
                        ? 'bg-purple-600 text-white'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    {checked && '✓ '}
                    {t.slug}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              Configurable settings (JSON)
            </label>
            <textarea
              value={form.configurable_settings_json}
              onChange={(e) =>
                setForm({ ...form, configurable_settings_json: e.target.value })
              }
              rows={8}
              spellCheck={false}
              className="w-full rounded-md border border-gray-300 bg-gray-50 p-2 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-500">
              Tableau d&apos;objets {'{key, label, type, default?, required?, help?}'}. Types
              supportes : time, text, number, emails, boolean.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              n8n_definition (JSON, optionnel)
            </label>
            <textarea
              value={form.n8n_definition_json}
              onChange={(e) => setForm({ ...form, n8n_definition_json: e.target.value })}
              rows={6}
              spellCheck={false}
              placeholder="Coller le JSON exporte depuis n8n (laisser vide en Phase 2 stub)"
              className="w-full rounded-md border border-gray-300 bg-gray-50 p-2 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => setEditorOpen(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={busy}>
              {busy
                ? 'Enregistrement…'
                : editorMode === 'create'
                  ? 'Creer'
                  : 'Mettre a jour'}
            </Button>
          </div>
        </form>
      </WorkflowModal>
    </div>
  );
}

function ActiveBadge({ active }: { active: boolean }) {
  return active ? (
    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      Actif
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      Inactif
    </span>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-4 py-2 text-left font-medium text-gray-600 ${className}`}>{children}</th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-2 align-top ${className}`}>{children}</td>;
}
