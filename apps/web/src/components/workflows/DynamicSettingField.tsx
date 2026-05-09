'use client';

import { Input } from '@/components/ui/input';
import type { ConfigurableSetting } from '@/lib/api';

type Props = {
  setting: ConfigurableSetting;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (value: any) => void;
  disabled?: boolean;
};

/**
 * Champ de formulaire dynamique pour les `configurable_settings` d'un template
 * de workflow. Le `type` du setting (time, text, number, emails, boolean) dicte
 * le composant rendu.
 *
 * Les `emails` sont gerees comme un textarea avec un email par ligne.
 */
export function DynamicSettingField({ setting, value, onChange, disabled }: Props) {
  const id = `setting-${setting.key}`;

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {setting.label}
        {setting.required && <span className="ml-1 text-red-500">*</span>}
      </label>
      {renderField(setting, value, onChange, id, disabled)}
      {setting.help && <p className="text-xs text-gray-500">{setting.help}</p>}
    </div>
  );
}

function renderField(
  setting: ConfigurableSetting,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onChange: (value: any) => void,
  id: string,
  disabled?: boolean,
) {
  switch (setting.type) {
    case 'time':
      return (
        <Input
          id={id}
          type="time"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          required={setting.required}
          disabled={disabled}
        />
      );

    case 'number':
      return (
        <Input
          id={id}
          type="number"
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => {
            const v = e.target.value;
            onChange(v === '' ? undefined : Number(v));
          }}
          required={setting.required}
          disabled={disabled}
        />
      );

    case 'boolean':
      return (
        <div className="flex items-center gap-2 pt-1">
          <input
            id={id}
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            disabled={disabled}
            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
          />
          <span className="text-sm text-gray-600">Activer</span>
        </div>
      );

    case 'emails': {
      const arr: string[] = Array.isArray(value)
        ? value
        : typeof value === 'string' && value.length > 0
          ? value.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean)
          : [];
      return (
        <textarea
          id={id}
          value={arr.join('\n')}
          onChange={(e) => {
            const next = e.target.value
              .split(/\n+/)
              .map((s) => s.trim())
              .filter(Boolean);
            onChange(next);
          }}
          placeholder="un email par ligne"
          rows={3}
          required={setting.required}
          disabled={disabled}
          className="w-full rounded-md border border-gray-300 bg-white p-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-gray-100"
        />
      );
    }

    case 'text':
    default:
      return (
        <Input
          id={id}
          type="text"
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
          required={setting.required}
          disabled={disabled}
        />
      );
  }
}
