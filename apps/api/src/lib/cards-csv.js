const CSV_HEADERS = [
  'source_type',
  'source_input',
  'schedule_enabled',
  'cron_expression',
  'timezone',
  'active',
  'run_timeout_ms',
  'run_max_retries',
  'params'
];

function escapeCsvCell(value) {
  const text = String(value ?? '');
  if (text.includes('"') || text.includes(',') || text.includes('\n') || text.includes('\r')) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

export function cardsToCsv(cards = []) {
  const lines = [CSV_HEADERS.join(',')];
  for (const card of cards) {
    const row = [
      card.source_type,
      card.source_input,
      String(Boolean(card.schedule_enabled)),
      card.cron_expression || '',
      card.timezone || '',
      String(Boolean(card.active)),
      card.run_timeout_ms ?? '',
      card.run_max_retries ?? '',
      JSON.stringify(card.params || {})
    ].map(escapeCsvCell);
    lines.push(row.join(','));
  }
  return `${lines.join('\n')}\n`;
}

function parseBoolean(value, defaultValue) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return defaultValue;
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

function parseNullableInteger(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed)) {
    throw new Error(`invalid integer value: ${value}`);
  }
  return parsed;
}

export function csvToCardInputs(csvText) {
  const lines = String(csvText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0]).map((value) => value.trim());
  const required = ['source_type', 'source_input'];
  for (const key of required) {
    if (!header.includes(key)) {
      throw new Error(`csv is missing required column: ${key}`);
    }
  }

  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line);
    if (cells.length > header.length && header[header.length - 1] === 'params') {
      const mergedParams = cells.slice(header.length - 1).join(',');
      cells.splice(header.length - 1, cells.length - (header.length - 1), mergedParams);
    }
    const row = Object.fromEntries(header.map((key, i) => [key, cells[i] ?? '']));
    const sourceType = String(row.source_type || '').trim();
    const sourceInput = String(row.source_input || '').trim();
    if (!sourceType || !sourceInput) {
      throw new Error(`row ${index + 2}: source_type and source_input are required`);
    }

    let params = {};
    if (String(row.params || '').trim()) {
      try {
        params = JSON.parse(row.params);
      } catch {
        throw new Error(`row ${index + 2}: params must be valid JSON`);
      }
    }

    return {
      source_type: sourceType,
      source_input: sourceInput,
      schedule_enabled: parseBoolean(row.schedule_enabled, false),
      cron_expression: String(row.cron_expression || '').trim() || null,
      timezone: String(row.timezone || '').trim() || undefined,
      active: parseBoolean(row.active, true),
      run_timeout_ms: parseNullableInteger(row.run_timeout_ms),
      run_max_retries: parseNullableInteger(row.run_max_retries),
      params
    };
  });
}
