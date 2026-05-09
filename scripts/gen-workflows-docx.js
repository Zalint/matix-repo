/* eslint-disable */
/**
 * Genere docs/matix-workflows.docx
 *
 * Document Word professionnel sur la fonctionnalite "Workflows" de Matix :
 *  - Concepts, glossaire (template / instance / run / cron)
 *  - Architecture : Matix orchestre, n8n execute (Strategie C)
 *  - Modele de donnees (workflow_templates, tenant_workflow_instances, workflow_runs)
 *  - Cycle de vie (admin cree, tenant active, configure, declenche, desactive)
 *  - UI cote admin et UI cote tenant
 *  - 3 templates seedes (mata.daily_cash_report, daily_mlc_report, daily_business_agent)
 *  - Securite (RLS, restricted_to_tenants, MATIX_SERVICE_TOKEN, audit)
 *  - Operations (cron, retries, monitoring, gestion des cles n8n)
 *  - Roadmap & Q&A
 *
 * Lancement: node scripts/gen-workflows-docx.js
 */

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, PageOrientation,
  HeadingLevel, BorderStyle, WidthType, ShadingType,
  PageNumber, PageBreak, TableOfContents,
} = require('docx');

// ============================================================================
// HELPERS
// ============================================================================

function p(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, ...opts })],
    spacing: { after: 120 },
  });
}

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    children: [new TextRun({ text })],
    spacing: { before: 360, after: 200 },
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    children: [new TextRun({ text })],
    spacing: { before: 280, after: 160 },
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    children: [new TextRun({ text })],
    spacing: { before: 200, after: 140 },
  });
}

function code(lines) {
  return lines.map(line => new Paragraph({
    children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })],
    spacing: { after: 0 },
    shading: { fill: 'F5F5F5', type: ShadingType.CLEAR, color: 'auto' },
  }));
}

function pageBreak() {
  return new Paragraph({ children: [new PageBreak()] });
}

const BORDER = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

function makeTable(headers, rows, columnWidths) {
  const totalWidth = columnWidths.reduce((a, b) => a + b, 0);
  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h, i) => new TableCell({
      borders: BORDERS,
      width: { size: columnWidths[i], type: WidthType.DXA },
      shading: { fill: 'D5E8F0', type: ShadingType.CLEAR, color: 'auto' },
      margins: { top: 80, bottom: 80, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 18 })] })],
    })),
  });
  const dataRows = rows.map(row => new TableRow({
    children: row.map((cell, i) => new TableCell({
      borders: BORDERS,
      width: { size: columnWidths[i], type: WidthType.DXA },
      margins: { top: 60, bottom: 60, left: 120, right: 120 },
      children: [new Paragraph({ children: [new TextRun({ text: String(cell), size: 18 })] })],
    })),
  }));
  return new Table({
    width: { size: totalWidth, type: WidthType.DXA },
    columnWidths,
    rows: [headerRow, ...dataRows],
  });
}

// ============================================================================
// SECTIONS
// ============================================================================

function pageDeGarde() {
  return [
    new Paragraph({ spacing: { before: 2400 }, children: [new TextRun('')] }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: 'Matix', size: 96, bold: true, color: '1F4E79' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 360 },
      children: [new TextRun({ text: 'Workflows & Automations', size: 44, bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 240 },
      children: [new TextRun({
        text: 'Architecture, modele de donnees, cycle de vie, securite et operations',
        size: 26, italics: true, color: '595959',
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200 },
      children: [new TextRun({
        text: 'Strategie C — Matix orchestre, n8n execute (cache derriere l\'UI Matix)',
        size: 22, color: '808080',
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 2400 },
      children: [new TextRun({ text: 'Mai 2026  ·  Mata Group', size: 22, color: '595959' })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: 'Suite SaaS B2B modulaire multi-tenant — Phase 2',
        size: 18, color: '808080', italics: true,
      })],
    }),
  ];
}

function tocSection() {
  return [
    h1('Table des matieres'),
    new TableOfContents('Sommaire', { hyperlink: true, headingStyleRange: '1-3' }),
  ];
}

// ----------------------------------------------------------------------------
// 1. Introduction
// ----------------------------------------------------------------------------

function intro() {
  return [
    h1('1. Introduction'),

    h2('1.1 Pourquoi un module Workflows ?'),
    p('Une suite SaaS qui veut s\'integrer dans le quotidien d\'une PME ne peut pas se contenter d\'etre un CRUD. Elle doit aussi automatiser les taches repetitives : envoyer un rapport quotidien par email, declencher une alerte sur un seuil de stock, synchroniser des donnees vers un outil tiers, repondre a un webhook entrant.'),
    p('Avant Matix, le groupe Mata avait deja partiellement automatise ces taches via 3 workflows n8n heberges sur une instance externe : MATA BANQ REPORT, MLC N8N GMAIL V2, et MATA AGENT WEBHOOK. Le module platform.workflows de Matix absorbe cette fonction et la rend self-service pour tous les tenants.'),

    h2('1.2 Objectif du document'),
    p('Ce document decrit :'),
    p('  •  Les concepts cles (template, instance, run, settings configurables)'),
    p('  •  L\'architecture (qui orchestre quoi, comment les tenants sont isoles)'),
    p('  •  Le modele de donnees (3 tables, RLS, audit)'),
    p('  •  Le cycle de vie d\'un workflow (admin -> tenant -> execution -> historique)'),
    p('  •  Les UIs disponibles (cote super-admin Matix, cote tenant)'),
    p('  •  La securite (isolation, restrictions, authentification service)'),
    p('  •  Les operations (cron, monitoring, cles API n8n)'),

    h2('1.3 Glossaire'),
    makeTable(
      ['Terme', 'Definition'],
      [
        ['Template',
          'Definition globale d\'un workflow (code, nom, parametres configurables, modules requis, eventuellement le JSON n8n a cloner). Cree par l\'admin Matix, vue en lecture par les tenants.'],
        ['Instance',
          'Activation d\'un template par un tenant donne, avec ses propres custom_settings (cron, destinataires...). Une instance correspond a 1 workflow n8n clone et parametre.'],
        ['Run',
          'Execution d\'une instance (manuelle, cron, ou webhook). Persiste un statut (success / error / running / timeout), une duree, un message d\'erreur eventuel.'],
        ['n8n',
          'Moteur de workflow externe (open-source, Apache 2.0). Execute le code reel du workflow. Cache derriere l\'UI Matix : aucun tenant n\'y accede directement.'],
        ['Configurable setting',
          'Parametre que le tenant peut ajuster sans modifier le code (ex : cron, recipients, format). Defini par le template avec un type, un default, un required.'],
        ['restricted_to_tenants',
          'Champ du template (UUID[]) limitant la visibilite a une liste explicite de tenants. Vide = visible par tous les tenants ayant les modules requis.'],
      ],
      [2200, 7660],
    ),
  ];
}

// ----------------------------------------------------------------------------
// 2. Architecture (Strategie C)
// ----------------------------------------------------------------------------

function architecture() {
  return [
    h1('2. Architecture — Strategie C'),

    h2('2.1 Pourquoi cette strategie ?'),
    p('Trois strategies etaient envisageables pour proposer des workflows a des tenants Matix :'),
    p('  A.  n8n full self-service : chaque tenant a son propre n8n. Couteux a heberger, complexe a securiser, expose un outil technique a un public non-tech.'),
    p('  B.  Pas d\'engine externe : tout coder en Nest. Reinvente la roue (pas de UI visuel, pas de connecteurs prets a l\'emploi).'),
    p('  C.  Matix orchestre, n8n execute (retenu) : un seul n8n partage, totalement cache. Matix expose un catalogue de templates, le tenant active et configure depuis l\'UI Matix.'),
    p('La strategie C combine la richesse de n8n (200+ noeuds, declencheurs varies, retries natifs) et la securite multi-tenant de Matix (RLS + filtrage applicatif).'),

    h2('2.2 Schema d\'ensemble'),
    ...code([
      '+------------------+        REST/JSON         +-----------------------+',
      '|  UI Web (Next)   |  <-------------------->  |  API NestJS (Matix)   |',
      '|  /admin/         |                          |  - WorkflowTemplates  |',
      '|  /settings/      |                          |  - TenantWorkflows    |',
      '|     workflows    |                          |  - WorkflowScheduler  |',
      '+------------------+                          |  - N8nClientService   |',
      '                                              +-----------+-----------+',
      '                                                          |',
      '                            X-N8N-API-KEY                 |  POST /api/v1/workflows',
      '                            (server-to-server)            |  POST /webhook/<path>',
      '                                                          v',
      '                                              +-----------------------+',
      '                                              |  n8n (Community)      |',
      '                                              |  Cache derriere       |',
      '                                              |  l\'UI Matix           |',
      '                                              +-----------+-----------+',
      '                                                          |',
      '                          X-Service-Token +               |  POST /n8n/callback',
      '                          X-Service-Tenant-Id             |  (optionnel : retour audit)',
      '                                                          v',
      '                                              +-----------------------+',
      '                                              |  API Matix (callback) |',
      '                                              |  -> insert workflow_  |',
      '                                              |     runs en \'system\'  |',
      '                                              +-----------------------+',
    ]),

    h2('2.3 Responsabilites'),
    makeTable(
      ['Composant', 'Role', 'Ne fait PAS'],
      [
        ['UI Web (Next.js)',
          'Liste templates / instances, formulaires de configuration, lancement manuel, historique. n8n totalement masque.',
          'Aucun appel direct a n8n. Aucun token n8n stocke cote browser.'],
        ['API Matix (NestJS)',
          'Source de verite : licences, templates, instances, runs. Filtre la visibilite des templates par tenant. Clone le JSON n8n a l\'activation. Trigger les runs manuels et cron.',
          'N\'execute pas la logique metier d\'un workflow (no-op si n8n absent : on log, on continue).'],
        ['n8n (engine)',
          'Execute le JSON du workflow : connexions HTTP, transformations, envoi d\'email, etc. Recoit les declenchements via webhook ou cron interne (en general on cron-trigger depuis Matix).',
          'Ne porte aucune logique metier specifique a un tenant. Le tenant_id est passe en payload a chaque trigger.'],
        ['workflow_scheduler (NestJS)',
          'Service interne qui scrute les instances actives toutes les minutes et trigger celles dont le cron correspond a HH:MM courant en TZ Africa/Dakar. Active via WORKFLOWS_CRON_ENABLED=1.',
          'Ne lance rien si WORKFLOWS_CRON_ENABLED=0 (defaut dev).'],
      ],
      [2200, 4000, 3660],
    ),

    h2('2.4 Modele multi-tenant'),
    p('La cle de la strategie C est de garder n8n mono-instance tout en isolant les tenants au niveau de Matix :'),
    p('  •  Chaque template peut etre clone N fois dans n8n (1 clone par tenant qui l\'active).'),
    p('  •  Le clone est nomme avec un prefixe stable : "[<tenant_slug>] <template name>".'),
    p('  •  Le tenant_id est injecte dans le payload de tout trigger — n8n le passe ensuite aux APIs Matix appelees, qui s\'auto-protegent par RLS.'),
    p('  •  Si n8n est down ou absent, Matix degrade gracieusement : l\'UI tenant continue de fonctionner, les triggers manuels logguent une erreur claire, les runs sont marques error.'),
  ];
}

// ----------------------------------------------------------------------------
// 3. Modele de donnees
// ----------------------------------------------------------------------------

function dataModel() {
  return [
    h1('3. Modele de donnees'),
    p('Le module workflows ajoute 3 tables au schema Postgres. Toutes les tables liees a un tenant ont la Row Level Security (RLS) activee, comme partout dans Matix.'),

    h2('3.1 workflow_templates (global, sans RLS)'),
    p('Definition globale partagee par tous les tenants. Pas de tenant_id : les templates sont visibles par tous les tenants ayant les modules requis (et eventuellement filtres via restricted_to_tenants).'),
    ...code([
      'CREATE TABLE workflow_templates (',
      '  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
      '  code                    TEXT NOT NULL UNIQUE,           -- ex: "mata.daily_cash_report"',
      '  name                    TEXT NOT NULL,',
      '  description             TEXT,',
      '  required_modules        TEXT[] NOT NULL DEFAULT \'{}\',  -- ex: [platform.workflows]',
      '  restricted_to_tenants   UUID[] NOT NULL DEFAULT \'{}\',   -- vide = tous',
      '  configurable_settings   JSONB NOT NULL DEFAULT \'[]\',    -- [{key,label,type,default?,required?}]',
      '  n8n_definition          JSONB,                          -- JSON exporte depuis n8n (peut etre NULL)',
      '  is_active               BOOLEAN NOT NULL DEFAULT TRUE,',
      '  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()',
      ');',
    ]),
    p('Champs cles :'),
    p('  •  required_modules : la modale d\'activation cote tenant filtre les templates dont tous les codes sont licencies pour le tenant.'),
    p('  •  restricted_to_tenants : optionnel ; permet a Matix de livrer un workflow exclusif a un client (ex : mata-mbao uniquement).'),
    p('  •  configurable_settings : meta-data utilisee par le frontend pour generer dynamiquement le formulaire d\'activation.'),
    p('  •  n8n_definition : JSON brut a cloner dans n8n a l\'activation. Peut etre NULL en Phase 2 (templates sans n8n encore configure) — l\'instance s\'active quand meme, le clone se fait plus tard.'),

    h2('3.2 tenant_workflow_instances (RLS)'),
    p('Activation effective d\'un template par un tenant donne, avec ses settings personnalises et une reference vers le workflow n8n clone.'),
    ...code([
      'CREATE TABLE tenant_workflow_instances (',
      '  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
      '  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,',
      '  template_id         UUID NOT NULL REFERENCES workflow_templates(id) ON DELETE RESTRICT,',
      '  enabled             BOOLEAN NOT NULL DEFAULT TRUE,',
      '  custom_settings     JSONB NOT NULL DEFAULT \'{}\',         -- valeurs choisies par le tenant',
      '  n8n_workflow_id     TEXT,                                -- ID du clone dans n8n (NULL si non clone)',
      '  configured_by       UUID,                                -- user qui a active',
      '  last_run_at         TIMESTAMPTZ,',
      '  last_run_status     TEXT,',
      '  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  UNIQUE (tenant_id, template_id)                          -- 1 seule instance par template par tenant',
      ');',
      '',
      '-- Row Level Security : un user d\'un tenant ne voit que ses instances',
      'ALTER TABLE tenant_workflow_instances ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY rls_iso ON tenant_workflow_instances',
      '  USING (tenant_id = current_setting(\'app.tenant_id\')::uuid);',
    ]),

    h2('3.3 workflow_runs (RLS, audit append-only)'),
    p('Historique de toutes les executions, qu\'elles aient reussi, echoue, ou time-out. Append-only : Matix n\'efface jamais un run.'),
    ...code([
      'CREATE TABLE workflow_runs (',
      '  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
      '  tenant_id           UUID NOT NULL,',
      '  instance_id         UUID NOT NULL REFERENCES tenant_workflow_instances(id) ON DELETE CASCADE,',
      '  triggered_by        TEXT NOT NULL CHECK (triggered_by IN (\'cron\',\'manual\',\'webhook\')),',
      '  status              TEXT NOT NULL CHECK (status IN (\'running\',\'success\',\'error\',\'timeout\')),',
      '  started_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),',
      '  finished_at         TIMESTAMPTZ,',
      '  duration_ms         INTEGER,',
      '  error_message       TEXT,',
      '  n8n_execution_id    TEXT,                       -- pointeur vers /api/v1/executions/<id>',
      '  metadata            JSONB NOT NULL DEFAULT \'{}\'',
      ');',
      'ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;',
      'CREATE POLICY rls_iso ON workflow_runs',
      '  USING (tenant_id = current_setting(\'app.tenant_id\')::uuid);',
    ]),

    h2('3.4 Diagramme relationnel'),
    ...code([
      '   workflow_templates (1)              tenants (1)',
      '         |                                  |',
      '         |                                  |',
      '         | (N)                              | (N)',
      '         v                                  v',
      '   tenant_workflow_instances  -------  unique(tenant_id, template_id)',
      '         |',
      '         | (N)',
      '         v',
      '   workflow_runs    (append-only, audit)',
    ]),
  ];
}

// ----------------------------------------------------------------------------
// 4. Cycle de vie
// ----------------------------------------------------------------------------

function lifecycle() {
  return [
    h1('4. Cycle de vie d\'un workflow'),

    h2('4.1 Etape 1 — L\'admin Matix cree le template'),
    p('Depuis /admin/workflows, le super-admin Matix saisit un formulaire avec :'),
    p('  •  code (immuable apres creation, ex: "mata.daily_cash_report")'),
    p('  •  nom et description'),
    p('  •  modules requis (multi-select sur le catalogue)'),
    p('  •  tenants restreints (vide = visible par tous, sinon multi-select sur la liste des tenants)'),
    p('  •  configurable_settings (JSON, declare les champs que le tenant pourra parametrer)'),
    p('  •  n8n_definition (JSON exporte depuis n8n, optionnel)'),
    p('Endpoint API : POST /admin/workflow-templates.'),
    h3('Exemple de configurable_settings'),
    ...code([
      '[',
      '  {',
      '    "key": "cron",',
      '    "label": "Heure d\'execution",',
      '    "type": "time",',
      '    "default": "23:55",',
      '    "required": true,',
      '    "help": "Format HH:MM, fuseau Africa/Dakar"',
      '  },',
      '  {',
      '    "key": "recipients",',
      '    "label": "Destinataires email",',
      '    "type": "emails",',
      '    "required": true',
      '  },',
      '  {',
      '    "key": "include_yesterday",',
      '    "label": "Inclure la veille",',
      '    "type": "boolean",',
      '    "default": false',
      '  }',
      ']',
    ]),
    p('Types supportes par le frontend dynamique : time, text, number, emails (liste), boolean.'),

    h2('4.2 Etape 2 — Le tenant active'),
    p('Depuis /settings/workflows, le tenant voit deux sections :'),
    p('  1.  Mes workflows : liste des instances deja activees (cards avec settings, statut, derniere execution).'),
    p('  2.  Workflows disponibles : liste des templates qu\'il a le droit d\'activer (apres filtrage modules + restrictions).'),
    p('Quand le tenant clique sur "Activer", une modale propose les configurable_settings (defaults pre-remplis). Au submit :'),
    ...code([
      'POST /workflows/activate',
      '{',
      '  "template_code": "mata.daily_cash_report",',
      '  "custom_settings": {',
      '    "cron": "23:55",',
      '    "recipients": ["compta@mata-mbao.sn", "ceo@mata-mbao.sn"]',
      '  }',
      '}',
    ]),
    p('Cote serveur (TenantWorkflowsService.activate), 4 etapes en transaction :'),
    p('  1.  Verifier que le tenant a tous les required_modules + qu\'il n\'est pas exclu par restricted_to_tenants.'),
    p('  2.  Inserer une ligne dans tenant_workflow_instances (UNIQUE bloque si deja active).'),
    p('  3.  Cloner le n8n_definition dans n8n via N8nClientService.cloneWorkflow() — recupere n8n_workflow_id.'),
    p('  4.  Activer le workflow dans n8n (POST /api/v1/workflows/<id>/activate).'),
    p('Si l\'etape 3 echoue (n8n down, cle invalide, JSON malforme), Matix log un warning mais l\'instance reste creee. Le clone se fera au prochain enable() ou trigger manuel.'),

    h2('4.3 Etape 3 — Configuration ulterieure'),
    p('Le tenant peut a tout moment editer les custom_settings d\'une instance via :'),
    ...code([
      'PATCH /workflows/instances/:id/settings',
      '{ "custom_settings": { "cron": "06:00", "recipients": ["..."] } }',
    ]),
    p('Le service met a jour la ligne en base et propage les nouveaux settings au workflow n8n clone via updateWorkflowSettings(). Pas de re-clone.'),

    h2('4.4 Etape 4 — Declenchement'),
    p('3 modes de declenchement :'),
    makeTable(
      ['Mode', 'Source', 'Effet'],
      [
        ['manual',
          'Bouton "Lancer maintenant" dans l\'UI tenant.',
          'POST /workflows/instances/:id/trigger -> insert workflow_run (running) -> n8n.triggerWebhook(...) -> on attend la reponse, on update le run.'],
        ['cron',
          'WorkflowSchedulerService scrute toutes les minutes (NestJS @Cron(EVERY_MINUTE)).',
          'Pour chaque instance enabled dont custom_settings.cron == HH:MM courant en TZ Africa/Dakar : meme path que manual mais triggered_by = "cron".'],
        ['webhook',
          'Future Phase 3 : un endpoint public /webhook/in/:slug peut recevoir un appel externe (ex : Stripe) et trigger un workflow.',
          'Reserve, non implemente en Phase 2.'],
      ],
      [1500, 4000, 4360],
    ),

    h2('4.5 Etape 5 — Desactivation et reactivation'),
    p('Le tenant peut desactiver une instance sans la supprimer (l\'historique est conserve) :'),
    ...code([
      'POST /workflows/instances/:id/disable',
      '-> UPDATE enabled = FALSE',
      '-> n8n.activateWorkflow(<id>, false)',
    ]),
    p('Puis la reactiver :'),
    ...code([
      'POST /workflows/instances/:id/enable',
      '-> Si n8n_workflow_id est NULL : re-clone le n8n_definition du template',
      '-> n8n.activateWorkflow(<id>, true)',
      '-> UPDATE enabled = TRUE',
    ]),
    p('Le bouton "Reactiver" dans l\'UI declenche cet endpoint. Cas pratique : si un workflow a ete desactive avant que n8n ne soit configure (n8n_workflow_id reste NULL), un click sur "Reactiver" finit le clone proprement.'),

    h2('4.6 Etape 6 — Suppression d\'un template (cote admin)'),
    p('Le super-admin peut soft-supprimer un template (is_active = FALSE) ou le hard-supprimer (DELETE). Le hard-delete supprime en cascade toutes les instances tenant et leurs runs (CONSTRAINT ON DELETE CASCADE). Une confirmation modale (toast.confirm) est demandee avant la suppression.'),
  ];
}

// ----------------------------------------------------------------------------
// 5. UI
// ----------------------------------------------------------------------------

function uis() {
  return [
    h1('5. Interfaces utilisateur'),

    h2('5.1 UI super-admin (/admin/workflows)'),
    p('Cette page est destinee aux equipes Matix (eligible au futur guard super-admin Matix, pour l\'instant ouverte en dev). Fonctions :'),
    p('  •  Lister tous les templates (actifs et inactifs) avec leur statut, modules requis, tenants restreints, date de derniere modification.'),
    p('  •  Creer un nouveau template (formulaire structure : code, nom, description, modules pickables, tenants pickables, JSON editor pour settings et n8n_definition).'),
    p('  •  Modifier un template existant (le code est immuable).'),
    p('  •  Activer / desactiver un template (soft).'),
    p('  •  Supprimer un template (hard, avec confirmation modale).'),

    h2('5.2 UI tenant (/settings/workflows)'),
    p('Page accessible aux roles owner / admin / superviseur d\'un tenant ayant le module platform.workflows actif. Fonctions :'),
    p('  •  Section "Mes workflows" : 1 carte par instance, montrant le statut (actif / desactive), les settings courants, la derniere execution (succes / erreur), 4 actions (Configurer, Lancer maintenant, Historique, Desactiver/Reactiver).'),
    p('  •  Section "Workflows disponibles" : 1 carte par template non encore active, avec un bouton "Activer" qui ouvre la modale de configuration.'),
    p('  •  Modale Historique : tableau des derniers runs (date, type cron/manual/webhook, statut, duree, erreur).'),
    p('  •  Encart "Besoin d\'un workflow custom ?" : bouton mailto vers commercial@matix.io pour signaler un besoin.'),
    p('Note : aucun mot "n8n" n\'apparait dans l\'UI tenant. Le terme generique reste "workflow" ou "automation".'),

    h2('5.3 Composant DynamicSettingField'),
    p('Le frontend genere automatiquement un input adapte au type declare par le template, sans code specifique par template :'),
    makeTable(
      ['type', 'Rendu UI', 'Validation'],
      [
        ['time',    '<input type="time"> (HH:MM)',                              'pattern HH:MM, fuseau Africa/Dakar'],
        ['text',    '<input type="text"> + help text',                          'required selon flag'],
        ['number',  '<input type="number" min/max> + units optionnelles',      'min/max declares par le setting'],
        ['emails',  'Multi-input avec chips, separateur "," ou Enter',          'regex email standard'],
        ['boolean', 'Toggle switch',                                            '-'],
      ],
      [1200, 5000, 3660],
    ),
  ];
}

// ----------------------------------------------------------------------------
// 6. Templates seedes
// ----------------------------------------------------------------------------

function seededTemplates() {
  return [
    h1('6. Templates seedes (Phase 2)'),
    p('Trois templates sont livres en seed Matix. Ils correspondent aux 3 workflows n8n Mata pre-existants, repris dans le modele managed.'),

    h2('6.1 mata.daily_cash_report'),
    makeTable(
      ['Champ', 'Valeur'],
      [
        ['code', 'mata.daily_cash_report'],
        ['nom', 'Rapport cash/banque quotidien'],
        ['description', 'Envoie chaque soir un email recapitulant le solde des comptes bancaires + cash + virements partenaires de la journee.'],
        ['required_modules', 'platform.workflows, finance.banking.accounts, finance.banking.transfers, finance.partners.deliveries'],
        ['restricted_to_tenants', 'vide (tous tenants ayant les modules)'],
        ['configurable_settings', 'cron (time, default 23:55), recipients (emails, required)'],
        ['n8n_definition', 'JSON copie depuis l\'instance Mata existante (workflow MATA BANQ REPORT)'],
        ['legacy', 'Remplace le workflow n8n MATA BANQ REPORT (schedule 23h55, source : /external/api/status de Depenses Management)'],
      ],
      [2200, 7660],
    ),

    h2('6.2 mata.daily_mlc_report'),
    makeTable(
      ['Champ', 'Valeur'],
      [
        ['code', 'mata.daily_mlc_report'],
        ['nom', 'Rapport livraisons (MLC) quotidien'],
        ['description', 'Recap journalier des livraisons : nombre de courses, KM totaux, depenses livreurs, top livreurs.'],
        ['required_modules', 'platform.workflows, operations.delivery.orders, operations.hr.timesheets, operations.delivery.scoring'],
        ['restricted_to_tenants', 'vide'],
        ['configurable_settings', 'cron (default 04:30), recipients (emails)'],
        ['n8n_definition', 'A configurer en Phase 2 step 4 (placeholder NULL, l\'instance s\'active mais ne fait rien tant que le JSON n\'est pas fourni)'],
        ['legacy', 'Remplace le workflow n8n MLC N8N GMAIL V2 (schedule 4h30, sources : 2 endpoints MLC livreurStats + orders)'],
      ],
      [2200, 7660],
    ),

    h2('6.3 mata.daily_business_agent'),
    makeTable(
      ['Champ', 'Valeur'],
      [
        ['code', 'mata.daily_business_agent'],
        ['nom', 'Agent IA business quotidien'],
        ['description', 'Agregateur multi-sources qui interroge ~15 endpoints Matix + n8n, passe le payload a un LLM, et envoie un brief en langage naturel.'],
        ['required_modules', 'platform.workflows, analytics.ai.agent, analytics.reports.daily_digest'],
        ['restricted_to_tenants', '[<uuid mata-mbao>] — exclusif Mata Mbao en Phase 2 (premier client beta)'],
        ['configurable_settings', 'cron (default 06:00), recipients (emails), llm_model (text, default "gpt-4o-mini")'],
        ['n8n_definition', 'A configurer Phase 2 step 4 (NULL pour l\'instant)'],
        ['legacy', 'Remplace le workflow n8n MATA AGENT WEBHOOK (declencheur webhook GET /webhook/mata-rapport-today, 16 APIs sources)'],
      ],
      [2200, 7660],
    ),
  ];
}

// ----------------------------------------------------------------------------
// 7. Securite
// ----------------------------------------------------------------------------

function security() {
  return [
    h1('7. Securite'),

    h2('7.1 Isolation multi-tenant'),
    p('Les tables tenant_workflow_instances et workflow_runs sont protegees par RLS Postgres :'),
    ...code([
      'CREATE POLICY rls_iso ON tenant_workflow_instances',
      '  USING (tenant_id = current_setting(\'app.tenant_id\')::uuid);',
    ]),
    p('Le service NestJS utilise getTenantPgClient(cls) qui pose SET LOCAL app.tenant_id = <uuid> au debut de chaque transaction. Impossible pour un tenant de voir les instances ou runs d\'un autre.'),
    p('La table workflow_templates n\'a pas de tenant_id : elle est globale. Le filtrage par tenant se fait au niveau applicatif dans listAvailableTemplates() — verification simultanee de required_modules vs licenses du tenant + restricted_to_tenants vs son UUID.'),

    h2('7.2 RequiresModule sur toutes les routes'),
    p('Toutes les routes /workflows et /admin/workflow-templates sont decorees @RequiresModule(\'platform.workflows\', \'read\' | \'write\'). Un tenant qui n\'a pas le module recoit 402 Payment Required avec un message clair.'),
    ...code([
      '@Controller(\'workflows\')',
      'export class TenantWorkflowsController {',
      '  @Get(\'templates\')',
      '  @RequiresModule(\'platform.workflows\', \'read\')',
      '  listTemplates() { ... }',
      '',
      '  @Post(\'activate\')',
      '  @RequiresModule(\'platform.workflows\', \'write\')',
      '  activate(@Body() dto: ActivateWorkflowDto) { ... }',
      '}',
    ]),

    h2('7.3 Authentification service (n8n -> Matix)'),
    p('Quand n8n appelle Matix en retour (callback de status, ou pour aller chercher des donnees), il utilise un mode d\'authentification dedie : Service Auth.'),
    makeTable(
      ['Header', 'Role'],
      [
        ['X-Service-Token', 'Token statique partage (env MATIX_SERVICE_TOKEN, 32 bytes random base64). Genere automatiquement par le script setup_n8n_key.ps1.'],
        ['X-Service-Tenant-Id', 'UUID du tenant pour lequel l\'appel est fait. Le middleware ServiceAuthGuard pose le tenant_id dans le CLS, ouvrant le RLS pour ce tenant.'],
      ],
      [3000, 6860],
    ),
    p('L\'utilisateur dans CLS est un pseudo-role "system", distinct des roles tenant classiques (owner, admin, etc.). Permet de logger qui a declenche quoi (audit). Aucun token JWT Keycloak n\'est utilise pour ces appels.'),

    h2('7.4 Authentification Matix -> n8n'),
    p('Matix appelle n8n avec un X-N8N-API-KEY (env N8N_API_KEY) genere depuis l\'UI n8n par un proprietaire d\'instance. Cette cle a un acces full a n8n — elle ne doit jamais etre exposee cote browser. Le N8nClientService est le seul code qui la lit.'),

    h2('7.5 restricted_to_tenants'),
    p('Champ UUID[] sur workflow_templates. Permet a Matix de :'),
    p('  •  Livrer un workflow exclusif a 1 client (ex : Mata Mbao a un agent IA personnalise).'),
    p('  •  Beta-tester un workflow sur 1-2 clients avant de l\'ouvrir a tous.'),
    p('  •  Retirer un workflow d\'un client specifique sans le supprimer pour les autres.'),
    p('La logique de filtrage est :'),
    ...code([
      '-- Visible si :',
      'restricted_to_tenants = \'{}\'        -- liste vide = ouvert a tous',
      '  OR',
      'tenant_id = ANY(restricted_to_tenants) -- explicitement liste',
    ]),

    h2('7.6 Audit append-only'),
    p('La table workflow_runs n\'autorise que des INSERT et UPDATE de finished_at/status (pas de DELETE applicatif). Permet de reconstituer l\'historique complet pour litige, debug, ou facturation a l\'usage.'),
  ];
}

// ----------------------------------------------------------------------------
// 8. Operations
// ----------------------------------------------------------------------------

function operations() {
  return [
    h1('8. Operations'),

    h2('8.1 Demarrage des services en local'),
    p('Le script start_matix.ps1 demarre tout l\'environnement local :'),
    ...code([
      '.\\scripts\\start_matix.ps1',
      '# Demarre : Postgres 17, Keycloak 25 (port 8081), API NestJS, Web Next.js',
      '# Avec -WithExtras : ajoute n8n (port 5678) au profil docker-compose',
      '',
      '.\\scripts\\start_matix.ps1 -WithExtras',
    ]),
    p('Le script lit apps/api/.env et propage N8N_URL, N8N_API_KEY, MATIX_SERVICE_TOKEN, WORKFLOWS_CRON_ENABLED dans la fenetre de l\'API NestJS au boot.'),
    p('Stop : .\\scripts\\stop_matix.ps1 (avec --profile extras pour aussi stopper n8n).'),

    h2('8.2 Configuration de la cle API n8n'),
    p('Premiere fois : .\\scripts\\setup_n8n_key.ps1 — assistant interactif qui :'),
    p('  •  Verifie que n8n est UP (http://localhost:5678/healthz)'),
    p('  •  Ouvre l\'UI n8n a la page Settings > n8n API'),
    p('  •  Demande de coller le token genere'),
    p('  •  Ecrit N8N_URL, N8N_API_KEY, MATIX_SERVICE_TOKEN, WORKFLOWS_CRON_ENABLED dans apps/api/.env (UTF-8 sans BOM)'),
    p('  •  Teste la cle avec un appel GET /api/v1/workflows'),

    h2('8.3 Cron interne (workflow_scheduler)'),
    p('Le service WorkflowSchedulerService est decore @Cron(EVERY_MINUTE) en mode @Injectable() Nest. Comportement :'),
    p('  •  Si WORKFLOWS_CRON_ENABLED != "1" : no-op (defaut dev pour eviter les triggers accidentels).'),
    p('  •  Sinon : SELECT toutes les instances enabled, calcule HH:MM courant en Africa/Dakar, declenche celles dont custom_settings.cron correspond.'),
    p('  •  Chaque trigger insere un workflow_run en \'system\' (pseudo-user role), tape n8n via N8nClientService.triggerWebhook(), puis update le run avec le statut.'),
    p('Production : passer WORKFLOWS_CRON_ENABLED=1 dans la config secret du conteneur API.'),

    h2('8.4 Variables d\'environnement (apps/api/.env)'),
    makeTable(
      ['Variable', 'Defaut', 'Role'],
      [
        ['N8N_URL', 'http://localhost:5678', 'URL de base de l\'API n8n.'],
        ['N8N_API_KEY', '(vide)', 'Cle generee depuis l\'UI n8n. Si vide, le N8nClientService log un warning au boot et tous les appels sont no-op.'],
        ['MATIX_SERVICE_TOKEN', '(vide)', 'Token statique 32 bytes random base64. Utilise par n8n pour rappeler Matix avec X-Service-Token.'],
        ['WORKFLOWS_CRON_ENABLED', '0', 'Si "1", active le cron interne. Defaut 0 en dev pour eviter les declenchements accidentels.'],
        ['TZ_DEFAULT', 'Africa/Dakar', 'Fuseau horaire utilise par le scheduler pour matcher les cron HH:MM.'],
      ],
      [3200, 2000, 4660],
    ),

    h2('8.5 Monitoring'),
    p('Cote API : chaque trigger log un message structure (level info pour les succes, warn pour les degraded, error pour les vrais echecs). Les runs en error / timeout sont visibles dans /settings/workflows > Historique.'),
    p('Cote n8n : l\'UI standard n8n permet a un admin Matix de voir les executions detaillees (POST /api/v1/executions/<id> aussi disponible cote API). Les tenants n\'ont pas acces a l\'UI n8n.'),

    h2('8.6 Gestion d\'erreur'),
    makeTable(
      ['Cas', 'Comportement Matix'],
      [
        ['n8n down au boot',
          'Le N8nClientService.onModuleInit log un warning, l\'API NestJS continue a tourner. Toute methode du client retourne null sans throw.'],
        ['Cle N8N_API_KEY invalide',
          'Idem : warning au boot, no-op sur tous les appels. L\'UI tenant continue de fonctionner mais les triggers retournent une erreur claire ("n8n indisponible").'],
        ['JSON n8n_definition malforme',
          'cloneWorkflow() throw, l\'instance est creee quand meme avec n8n_workflow_id NULL. Le tenant peut reessayer via Reactiver.'],
        ['Instance disable -> trigger',
          'Bouton "Lancer maintenant" desactive cote UI. Cote API : 409 Conflict.'],
        ['Tenant supprime',
          'ON DELETE CASCADE -> instances et runs supprimes. Le clone n8n n\'est PAS supprime automatiquement (TODO Phase 3).'],
      ],
      [2500, 7360],
    ),
  ];
}

// ----------------------------------------------------------------------------
// 9. Roadmap & Q&A
// ----------------------------------------------------------------------------

function roadmapQA() {
  return [
    h1('9. Roadmap & Q&A'),

    h2('9.1 Roadmap'),
    makeTable(
      ['Phase', 'Item', 'Statut'],
      [
        ['Phase 2 step 1', 'Tables + RLS + 3 templates seedes', 'Livre'],
        ['Phase 2 step 2', 'Admin UI + tenant UI + restricted_to_tenants', 'Livre'],
        ['Phase 2 step 3', 'N8nClientService reel (HTTP api/v1)', 'Livre'],
        ['Phase 2 step 3 bis', 'Toast moderne, suppression alert/confirm natifs', 'Livre'],
        ['Phase 2 step 4', 'Configurer n8n_definition pour mata.daily_mlc_report et mata.daily_business_agent', 'A faire'],
        ['Phase 3', 'Webhooks entrants /webhook/in/:slug', 'Backlog'],
        ['Phase 3', 'Quotas (max instances par tenant, max runs/jour)', 'Backlog'],
        ['Phase 3', 'Suppression auto du clone n8n quand un tenant est supprime', 'Backlog'],
        ['Phase 3', 'Editeur visuel n8n integre (iframe sandboxed pour super-admin)', 'A discuter'],
        ['Phase 4', 'Workflows IA : LLM-as-a-step dans n8n via OpenAI Connector officiel', 'Backlog'],
      ],
      [1500, 6500, 1860],
    ),

    h2('9.2 Q&A frequentes'),
    h3('Q1 — Pourquoi n8n et pas Temporal / Airflow / un cron home-made ?'),
    p('R : n8n offre 200+ noeuds prets (Slack, Gmail, Bictorys, Wave, OpenAI...), une UI visuelle, et un modele d\'execution simple (single-tenant par instance). Temporal est plus puissant mais demande un investissement engineering hors scope Phase 2. Le cron home-made nous priverait des connecteurs.'),
    h3('Q2 — Comment scaler n8n quand on aura 100+ tenants ?'),
    p('R : trois options non-bloquantes : (a) sharding par tenant_id sur plusieurs instances n8n, route depuis le N8nClientService ; (b) workers n8n dedies (mode queue) ; (c) migration vers n8n Enterprise self-hosted si besoin. La strategie C garantit que ces changements sont invisibles pour les tenants.'),
    h3('Q3 — Un tenant peut-il creer son propre workflow ?'),
    p('R : Phase 2 = non. Le tenant choisit dans le catalogue managed. Phase 3+ : on pourra ouvrir un editeur n8n integre aux roles owner/admin avec un guard et un quota. Mais ce n\'est pas la priorite (le besoin reel actuel est "j\'aimerais que ce rapport parte a 6h au lieu de 7h", pas "je veux concevoir un workflow").'),
    h3('Q4 — Que se passe-t-il si je passe d\'un plan Pro a un plan Starter ?'),
    p('R : platform.workflows n\'est plus dans Starter -> les routes /workflows retournent 402. Les instances ne sont PAS supprimees (on ne perd pas la config), mais le cron ne tourne plus. Repasser en Pro reactive tout sans intervention manuelle.'),
    h3('Q5 — Le tenant peut-il voir le JSON n8n d\'un workflow ?'),
    p('R : Non. n8n_definition est strippe de toute reponse cote tenant (Phase 2 controller filtre le champ). Seul le super-admin Matix le voit.'),
    h3('Q6 — Combien d\'instances un tenant peut-il avoir ?'),
    p('R : Phase 2 = illimite (1 par template, et il y a 3 templates seedes). Phase 3 introduira un quota via licensing (ex : Pro = 10 max, Enterprise = illimite).'),
    h3('Q7 — Que se passe-t-il si n8n et Matix se desynchronisent (ex : workflow supprime cote n8n) ?'),
    p('R : Au prochain trigger, n8n.triggerWebhook() retourne 404 -> le run est marque error avec un message clair. Le tenant peut Desactiver puis Reactiver l\'instance pour declencher un re-clone.'),
    h3('Q8 — Comment debugger un run en erreur ?'),
    p('R : 1) Voir error_message dans /settings/workflows > Historique. 2) Si on a n8n_execution_id, l\'admin Matix peut consulter /api/v1/executions/<id> dans n8n pour voir le payload exact. 3) Reproduire en lancant manuellement (Lancer maintenant) avec les memes settings.'),
  ];
}

// ============================================================================
// ASSEMBLAGE
// ============================================================================

const allChildren = [
  ...pageDeGarde(),
  pageBreak(),
  ...tocSection(),
  pageBreak(),
  ...intro(),
  pageBreak(),
  ...architecture(),
  pageBreak(),
  ...dataModel(),
  pageBreak(),
  ...lifecycle(),
  pageBreak(),
  ...uis(),
  pageBreak(),
  ...seededTemplates(),
  pageBreak(),
  ...security(),
  pageBreak(),
  ...operations(),
  pageBreak(),
  ...roadmapQA(),
];

const doc = new Document({
  creator: 'Mata Group',
  title: 'Matix — Workflows & Automations',
  description: 'Architecture, modele de donnees, cycle de vie, securite et operations',
  styles: {
    default: { document: { run: { font: 'Arial', size: 22 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 36, bold: true, font: 'Arial', color: '1F4E79' },
        paragraph: { spacing: { before: 360, after: 240 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 28, bold: true, font: 'Arial', color: '2E75B6' },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 24, bold: true, font: 'Arial', color: '404040' },
        paragraph: { spacing: { before: 200, after: 140 }, outlineLevel: 2 } },
    ],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838, orientation: PageOrientation.LANDSCAPE },
        margin: { top: 720, right: 720, bottom: 720, left: 720 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: 'Matix — Workflows & Automations', size: 16, color: '808080' })],
        })],
      }),
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: 'Page ', size: 16, color: '808080' }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '808080' }),
            new TextRun({ text: ' / ', size: 16, color: '808080' }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '808080' }),
          ],
        })],
      }),
    },
    children: allChildren,
  }],
});

const outputPath = path.resolve(process.env.OUTPUT_DOCX || 'docs/matix-workflows.docx');
Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(outputPath, buf);
  const sizeKb = (buf.length / 1024).toFixed(1);
  console.log(`OK Generated ${outputPath} (${sizeKb} KB)`);
}).catch(err => {
  console.error('FAIL Failed to generate docx:', err);
  process.exit(1);
});
