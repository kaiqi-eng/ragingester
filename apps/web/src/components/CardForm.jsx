import React, { useEffect, useMemo, useState } from 'react';
import { SOURCE_TYPES } from '@ragingester/shared';

const presets = [
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Daily 9am', value: '0 9 * * *' },
  { label: 'Weekdays 8am', value: '0 8 * * 1-5' }
];

const sourceOptions = Object.values(SOURCE_TYPES);

const initialForm = {
  source_type: SOURCE_TYPES.HTTP_API,
  job_name: '',
  source_input: '',
  params: '{}',
  schedule_enabled: false,
  cron_expression: '0 9 * * *',
  timezone: 'America/Chicago',
  active: true,
  run_timeout_ms: '',
  run_max_retries: ''
};

function formFromCard(card) {
  if (!card) return initialForm;
  const params = { ...(card.params || {}) };
  const jobName = params.job_name || '';
  delete params.job_name;

  return {
    source_type: card.source_type || SOURCE_TYPES.HTTP_API,
    job_name: jobName,
    source_input: card.source_input || '',
    params: JSON.stringify(params, null, 2),
    schedule_enabled: Boolean(card.schedule_enabled),
    cron_expression: card.cron_expression || '0 9 * * *',
    timezone: card.timezone || 'America/Chicago',
    active: Boolean(card.active),
    run_timeout_ms: card.run_timeout_ms == null ? '' : String(card.run_timeout_ms),
    run_max_retries: card.run_max_retries == null ? '' : String(card.run_max_retries)
  };
}

function parseOptionalIntegerInput(value) {
  if (value === '') return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export function CardForm({ onSubmit, loading, mode = 'create', initialCard = null, onCancel }) {
  const [form, setForm] = useState(() => formFromCard(initialCard));
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(formFromCard(initialCard));
    setError('');
  }, [initialCard, mode]);

  const parsedParams = useMemo(() => {
    try {
      return JSON.parse(form.params || '{}');
    } catch {
      return null;
    }
  }, [form.params]);

  async function submit(event) {
    event.preventDefault();
    setError('');

    if (!parsedParams) {
      setError('params must be valid JSON');
      return;
    }

    const parsedRunTimeoutMs = parseOptionalIntegerInput(form.run_timeout_ms);
    const parsedRunMaxRetries = parseOptionalIntegerInput(form.run_max_retries);
    if (Number.isNaN(parsedRunTimeoutMs)) {
      setError('Run timeout must be an integer in milliseconds');
      return;
    }
    if (Number.isNaN(parsedRunMaxRetries)) {
      setError('Max retries must be an integer');
      return;
    }

    try {
      await onSubmit({
        source_type: form.source_type,
        source_input: form.source_input,
        params: {
          ...parsedParams,
          ...(form.job_name ? { job_name: form.job_name } : {})
        },
        schedule_enabled: form.schedule_enabled,
        cron_expression: form.schedule_enabled ? form.cron_expression : null,
        timezone: form.timezone,
        active: form.active,
        run_timeout_ms: parsedRunTimeoutMs,
        run_max_retries: parsedRunMaxRetries
      });
      if (mode === 'create') {
        setForm(initialForm);
      }
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  return (
    <div className="panel">
      <h2>{mode === 'edit' ? 'Edit Card' : 'Create Card'}</h2>
      <form onSubmit={submit}>
        <label>Source type</label>
        <select value={form.source_type} onChange={(e) => setForm((f) => ({ ...f, source_type: e.target.value }))}>
          {sourceOptions.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>

        <label>Job name</label>
        <input
          value={form.job_name}
          onChange={(e) => setForm((f) => ({ ...f, job_name: e.target.value }))}
          placeholder="Daily pricing sync"
        />

        <label>Source URL / Identifier</label>
        <input value={form.source_input} onChange={(e) => setForm((f) => ({ ...f, source_input: e.target.value }))} required />

        <label>Params (JSON)</label>
        <textarea rows={4} value={form.params} onChange={(e) => setForm((f) => ({ ...f, params: e.target.value }))} />

        <div className="grid-2">
          <label>
            <input
              type="checkbox"
              checked={form.schedule_enabled}
              onChange={(e) => setForm((f) => ({ ...f, schedule_enabled: e.target.checked }))}
            />
            {' '}Schedule enabled
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            {' '}Active
          </label>
        </div>

        {form.schedule_enabled && (
          <>
            <label>Preset cron</label>
            <select onChange={(e) => setForm((f) => ({ ...f, cron_expression: e.target.value }))} value={form.cron_expression}>
              {presets.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label} ({preset.value})</option>
              ))}
            </select>

            <label>Custom cron expression</label>
            <input value={form.cron_expression} onChange={(e) => setForm((f) => ({ ...f, cron_expression: e.target.value }))} />

            <label>Timezone</label>
            <input value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} />
          </>
        )}

        <label>Run timeout (ms)</label>
        <input
          type="number"
          min="1000"
          max="300000"
          step="1"
          value={form.run_timeout_ms}
          onChange={(e) => setForm((f) => ({ ...f, run_timeout_ms: e.target.value }))}
          placeholder="Use system default"
        />

        <label>Max retries</label>
        <input
          type="number"
          min="0"
          max="5"
          step="1"
          value={form.run_max_retries}
          onChange={(e) => setForm((f) => ({ ...f, run_max_retries: e.target.value }))}
          placeholder="Use system default"
        />

        {error && <div className="meta">Error: {error}</div>}
        <div className="row">
          <button disabled={loading} type="submit">
            {loading ? 'Saving...' : mode === 'edit' ? 'Save Changes' : 'Create Card'}
          </button>
          {mode === 'edit' && (
            <button className="secondary" disabled={loading} type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
