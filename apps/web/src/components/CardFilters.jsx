import React from 'react';
import { SOURCE_TYPES } from '@ragingester/shared';

const sourceOptions = Object.values(SOURCE_TYPES);

export function CardFilters({ filters, onChange, viewMode, onViewModeChange }) {
  return (
    <div className="panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h2 style={{ margin: 0 }}>Filter Jobs</h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button className="secondary" type="button" onClick={() => onViewModeChange('grid')} style={{ padding: '4px 12px', opacity: viewMode === 'grid' ? 1 : 0.5 }}>Grid</button>
          <button className="secondary" type="button" onClick={() => onViewModeChange('list')} style={{ padding: '4px 12px', opacity: viewMode === 'list' ? 1 : 0.5 }}>List</button>
        </div>
      </div>
      <div className="grid-2">
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label>Job type</label>
          <select value={filters.jobType} onChange={(e) => onChange({ ...filters, jobType: e.target.value })}>
            <option value="all">All</option>
            {sourceOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <label>Job name</label>
          <input
            value={filters.jobName}
            onChange={(e) => onChange({ ...filters, jobName: e.target.value })}
            placeholder="Search by job name"
          />
        </div>
      </div>
    </div>
  );
}