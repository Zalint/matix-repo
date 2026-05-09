'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DynamicSettingField } from '@/components/workflows/DynamicSettingField';
import { WorkflowModal } from '@/components/workflows/WorkflowModal';
import {
  api,
  type ConfigurableSetting,
  type TenantWorkflowInstance,
  type WorkflowRun,
  type WorkflowTemplate,
} from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ui/toast';

const CONTACT_EMAIL = 'commercial@matix.io';

/**
 * /settings/workflows — gestion des workflows tenant.
 *
 * Le tenant voit les templates qui lui sont disponibles (filtres modules
 * + restrictions cote API), peut activer / parametrer / declencher / desactiver
 * ses instances, et consulter l'historique des runs.
 *
 * n8n est totalement cache : aucune mention dans l'UI.
 */
export default function TenantWorkflowsPage() {
  const auth = useAuth();
  const toast = useToast();
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [instances, setInstances] = useState<TenantWorkflowInstance[]>([]);
  const [busy, setBusy] = useState(false);

  // Modale activation : selection du template + premiers settings
  const [activateOpen, setActivateOpen] = useState(false);
  const [activatingTemplate, setActivatingTemplate] = useState<WorkflowTemplate | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [activateValues, setActivateValues] = useState<Record<string, any>>({});

  // Modale configuration d'une instance existante
  const [configOpen, setConfigOpen] = useState(false);
  const [configInstance, setConfigInstance] = useState<TenantWorkflowInstance | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [configValues, setConfigValues] = useState<Record<string, any>>({});

  // Modale historique
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyInstance, setHistoryInstance] = useState<TenantWorkflowInstance | null>(null);
  const [history, setHistory] = useState<WorkflowRun[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const reload = () => {
    if (!auth.ready) return;
    Promise.all([
      api.tenantWorkflows.listTemplates(auth),
      api.tenantWorkflows.listInstances(auth),
    ])
      .then(([t, i]) => {
        setTemplates(t);
        setInstances(i);
      })
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : String(e), { title: 'Chargement' }),
      );
  };

  useEffect(reload, [auth]);

  const templateById = useMemo(
    () => new Map(templates.map((t) => [t.id, t])),
    [templates],
  );

  const activatedTemplateIds = useMemo(
    () => new Set(instances.map((i) => i.template_id)),
    [instances],
  );

  const availableForActivation = useMemo(
    () => templates.filter((t) => !activatedTemplateIds.has(t.id)),
    [templates, activatedTemplateIds],
  );

  // ---------- Activation ----------
  function openActivate(tpl: WorkflowTemplate) {
    setActivatingTemplate(tpl);
    // Initialise les valeurs avec les defaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defaults: Record<string, any> = {};
    for (const s of tpl.configurable_settings) {
      if (s.default !== undefined) defaults[s.key] = s.default;
    }
    setActivateValues(defaults);
    setActivateOpen(true);
  }

  async function handleActivate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.ready || !activatingTemplate) return;
    setBusy(true);
    try {
      await api.tenantWorkflows.activate(auth, {
        template_code: activatingTemplate.code,
        custom_settings: activateValues,
      });
      toast.success(`Workflow "${activatingTemplate.name}" active.`);
      setActivateOpen(false);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Activation' });
    } finally {
      setBusy(false);
    }
  }

  // ---------- Configuration ----------
  function openConfigure(instance: TenantWorkflowInstance) {
    setConfigInstance(instance);
    setConfigValues({ ...(instance.custom_settings ?? {}) });
    setConfigOpen(true);
  }

  async function handleSaveConfig(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth.ready || !configInstance) return;
    setBusy(true);
    try {
      await api.tenantWorkflows.updateSettings(auth, configInstance.id, configValues);
      toast.success(`Parametres "${configInstance.template_name}" mis a jour.`);
      setConfigOpen(false);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), { title: 'Configuration' });
    } finally {
      setBusy(false);
    }
  }

  // ---------- Trigger ----------
  async function handleTrigger(instance: TenantWorkflowInstance) {
    if (!auth.ready) return;
    setBusy(true);
    try {
      await api.tenantWorkflows.trigger(auth, instance.id);
      toast.success(`Execution lancee pour "${instance.template_name}".`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        title: 'Lancement manuel',
      });
    } finally {
      setBusy(false);
    }
  }

  // ---------- Disable ----------
  async function handleDisable(instance: TenantWorkflowInstance) {
    if (!auth.ready) return;
    const ok = await toast.confirm({
      title: `Desactiver "${instance.template_name}" ?`,
      message:
        "Le workflow ne s'executera plus automatiquement, mais l'historique est conserve.",
      confirmLabel: 'Desactiver',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.tenantWorkflows.disable(auth, instance.id);
      toast.success(`"${instance.template_name}" desactive.`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        title: 'Desactivation',
      });
    }
  }

  // ---------- Enable (reactivation) ----------
  async function handleEnable(instance: TenantWorkflowInstance) {
    if (!auth.ready) return;
    setBusy(true);
    try {
      await api.tenantWorkflows.enable(auth, instance.id);
      toast.success(`"${instance.template_name}" reactive.`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err), {
        title: 'Reactivation',
      });
    } finally {
      setBusy(false);
    }
  }

  // ---------- History ----------
  function openHistory(instance: TenantWorkflowInstance) {
    setHistoryInstance(instance);
    setHistory([]);
    setHistoryLoading(true);
    setHistoryOpen(true);
    if (!auth.ready) return;
    api.tenantWorkflows
      .listRuns(auth, instance.id)
      .then(setHistory)
      .catch((e) =>
        toast.error(e instanceof Error ? e.message : String(e), { title: 'Historique' }),
      )
      .finally(() => setHistoryLoading(false));
  }

  if (!auth.ready) return <div className="text-sm text-gray-500">Chargement…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Workflows</h2>
        <p className="text-sm text-gray-500">
          Activez et configurez les workflows automatiques disponibles pour votre organisation
          (rapports quotidiens, notifications, etc.).
        </p>
      </div>

      {/* ----- Mes workflows actifs ----- */}
      <section>
        <h3 className="mb-3 text-lg font-semibold">Mes workflows</h3>
        {instances.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
            Aucun workflow active pour le moment. Choisissez-en un dans la section ci-dessous.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {instances.map((inst) => {
              const tpl = templateById.get(inst.template_id);
              return (
                <InstanceCard
                  key={inst.id}
                  instance={inst}
                  template={tpl}
                  busy={busy}
                  onConfigure={() => openConfigure(inst)}
                  onTrigger={() => handleTrigger(inst)}
                  onDisable={() => handleDisable(inst)}
                  onEnable={() => handleEnable(inst)}
                  onHistory={() => openHistory(inst)}
                />
              );
            })}
          </div>
        )}
      </section>

      {/* ----- Workflows disponibles ----- */}
      <section>
        <h3 className="mb-3 text-lg font-semibold">Workflows disponibles</h3>
        {availableForActivation.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 bg-white p-4 text-sm text-gray-500">
            Tous les workflows disponibles pour votre organisation sont deja actives.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {availableForActivation.map((tpl) => (
              <TemplateCard key={tpl.id} template={tpl} onActivate={() => openActivate(tpl)} />
            ))}
          </div>
        )}
      </section>

      {/* ----- Encart contact commercial ----- */}
      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm">
        <div className="font-medium text-blue-900">Besoin d&apos;un workflow custom ?</div>
        <p className="mt-1 text-blue-800">
          L&apos;equipe Matix peut concevoir un workflow specifique a votre activite (rapports
          personnalises, integrations metier, alertes seuils…).{' '}
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=Demande%20workflow%20custom`}
            className="font-medium underline"
          >
            Contactez votre commercial Matix
          </a>
          .
        </p>
      </section>

      {/* ----- Modale activation ----- */}
      <WorkflowModal
        open={activateOpen}
        onClose={() => setActivateOpen(false)}
        title={activatingTemplate ? `Activer : ${activatingTemplate.name}` : 'Activer'}
        size="md"
      >
        {activatingTemplate && (
          <form onSubmit={handleActivate} className="space-y-4">
            {activatingTemplate.description && (
              <p className="text-sm text-gray-600">{activatingTemplate.description}</p>
            )}
            <SettingsGrid
              settings={activatingTemplate.configurable_settings}
              values={activateValues}
              onChange={setActivateValues}
              disabled={busy}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setActivateOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Activation…' : 'Activer'}
              </Button>
            </div>
          </form>
        )}
      </WorkflowModal>

      {/* ----- Modale configuration ----- */}
      <WorkflowModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        title={configInstance ? `Configurer : ${configInstance.template_name}` : 'Configurer'}
        size="md"
      >
        {configInstance && (
          <form onSubmit={handleSaveConfig} className="space-y-4">
            <SettingsGrid
              settings={
                templateById.get(configInstance.template_id)?.configurable_settings ?? []
              }
              values={configValues}
              onChange={setConfigValues}
              disabled={busy}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => setConfigOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        )}
      </WorkflowModal>

      {/* ----- Modale historique ----- */}
      <WorkflowModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title={historyInstance ? `Historique : ${historyInstance.template_name}` : 'Historique'}
        size="lg"
      >
        {historyLoading ? (
          <p className="py-6 text-center text-sm text-gray-500">Chargement…</p>
        ) : history.length === 0 ? (
          <p className="py-6 text-center text-sm text-gray-500">Aucune execution enregistree.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th>Lance le</Th>
                  <Th>Type</Th>
                  <Th>Statut</Th>
                  <Th>Duree</Th>
                  <Th>Erreur</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {history.map((run) => (
                  <tr key={run.id}>
                    <Td>{formatDateTime(run.started_at)}</Td>
                    <Td>
                      <span className="text-xs text-gray-600">{labelTrigger(run.triggered_by)}</span>
                    </Td>
                    <Td>
                      <RunStatusBadge status={run.status} />
                    </Td>
                    <Td className="text-xs text-gray-600">
                      {run.duration_ms != null ? `${run.duration_ms} ms` : '—'}
                    </Td>
                    <Td className="text-xs text-red-600">
                      {run.error_message ? (
                        <span title={run.error_message}>
                          {run.error_message.length > 60
                            ? run.error_message.slice(0, 60) + '…'
                            : run.error_message}
                        </span>
                      ) : (
                        '—'
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </WorkflowModal>
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function TemplateCard({
  template,
  onActivate,
}: {
  template: WorkflowTemplate;
  onActivate: () => void;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{template.name}</div>
          <div className="font-mono text-[11px] text-gray-400">{template.code}</div>
        </div>
        <Button size="sm" onClick={onActivate}>
          Activer
        </Button>
      </div>
      {template.description && (
        <p className="mt-2 text-xs text-gray-600">{template.description}</p>
      )}
      {template.configurable_settings.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {template.configurable_settings.map((s) => (
            <span
              key={s.key}
              className="inline-flex rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-700"
            >
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function InstanceCard({
  instance,
  template,
  busy,
  onConfigure,
  onTrigger,
  onDisable,
  onEnable,
  onHistory,
}: {
  instance: TenantWorkflowInstance;
  template: WorkflowTemplate | undefined;
  busy: boolean;
  onConfigure: () => void;
  onTrigger: () => void;
  onDisable: () => void;
  onEnable: () => void;
  onHistory: () => void;
}) {
  const settings = template?.configurable_settings ?? [];
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{instance.template_name}</span>
            <EnabledBadge enabled={instance.enabled} />
          </div>
          <div className="font-mono text-[11px] text-gray-400">{instance.template_code}</div>
        </div>
      </div>
      {template?.description && (
        <p className="mt-1 text-xs text-gray-600">{template.description}</p>
      )}

      {settings.length > 0 && (
        <dl className="mt-3 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          {settings.map((s) => {
            const v = instance.custom_settings?.[s.key];
            return (
              <div key={s.key} className="flex flex-col">
                <dt className="text-[11px] uppercase tracking-wide text-gray-500">{s.label}</dt>
                <dd className="font-mono text-gray-800">{formatSettingValue(v, s.type)}</dd>
              </div>
            );
          })}
        </dl>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-3 text-xs">
        <span className="text-gray-500">Derniere execution :</span>
        {instance.last_run_at ? (
          <>
            <RunStatusBadge status={instance.last_run_status ?? 'running'} />
            <span className="text-gray-600">{formatDateTime(instance.last_run_at)}</span>
          </>
        ) : (
          <span className="text-gray-400">jamais</span>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={onConfigure} disabled={busy}>
          Configurer
        </Button>
        <Button size="sm" onClick={onTrigger} disabled={busy || !instance.enabled}>
          Lancer maintenant
        </Button>
        <Button size="sm" variant="ghost" onClick={onHistory}>
          Historique
        </Button>
        {instance.enabled ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onDisable}
            disabled={busy}
            className="ml-auto text-red-600 hover:bg-red-50"
          >
            Desactiver
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onEnable}
            disabled={busy}
            className="ml-auto"
          >
            Reactiver
          </Button>
        )}
      </div>
    </div>
  );
}

function SettingsGrid({
  settings,
  values,
  onChange,
  disabled,
}: {
  settings: ConfigurableSetting[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  values: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (next: Record<string, any>) => void;
  disabled?: boolean;
}) {
  if (settings.length === 0) {
    return (
      <p className="rounded-md bg-gray-50 p-3 text-xs text-gray-500">
        Ce workflow n&apos;a pas de parametres configurables.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3">
      {settings.map((s) => (
        <DynamicSettingField
          key={s.key}
          setting={s}
          value={values[s.key]}
          onChange={(v) => onChange({ ...values, [s.key]: v })}
          disabled={disabled}
        />
      ))}
    </div>
  );
}

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
      Actif
    </span>
  ) : (
    <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      Desactive
    </span>
  );
}

function RunStatusBadge({
  status,
}: {
  status: 'success' | 'error' | 'running' | 'timeout';
}) {
  const colors: Record<string, string> = {
    success: 'bg-green-100 text-green-800',
    error: 'bg-red-100 text-red-700',
    running: 'bg-blue-100 text-blue-700',
    timeout: 'bg-orange-100 text-orange-700',
  };
  const labels: Record<string, string> = {
    success: 'Succes',
    error: 'Erreur',
    running: 'En cours',
    timeout: 'Timeout',
  };
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        colors[status] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function labelTrigger(t: 'cron' | 'manual' | 'webhook'): string {
  switch (t) {
    case 'cron':
      return 'Planifie';
    case 'manual':
      return 'Manuel';
    case 'webhook':
      return 'Webhook';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatSettingValue(value: any, type: string): string {
  if (value === undefined || value === null || value === '') return '—';
  if (type === 'emails' && Array.isArray(value)) {
    return value.join(', ') || '—';
  }
  if (type === 'boolean') return value ? 'Oui' : 'Non';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
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
