import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonitorFilterOptions, monitorFilterClauses, normalizeMonitorFilters, REFRESH_RATE_STEPS } from '../services/monitor-filters.js';
import { buildWhereClause } from '../services/products.service.js';

test('normalizeMonitorFilters keeps only allowed values (from URLSearchParams or a plain object)', () => {
  const params = new URLSearchParams({ minRefreshRate: '144', screenSize: 'm', resolution: 'qhd', panelType: 'QD-OLED' });
  assert.deepEqual(normalizeMonitorFilters(params), { minRefreshRate: 144, screenSize: 'm', resolution: 'qhd', panelType: 'QD-OLED' });
  assert.deepEqual(normalizeMonitorFilters({ minRefreshRate: '999', screenSize: 'zz', resolution: '8k', panelType: "x' OR 1=1 --" }), {});
  assert.deepEqual(normalizeMonitorFilters({ minRefreshRate: '', panelType: '' }), {});
  assert.deepEqual(normalizeMonitorFilters(null), {});
  assert.deepEqual(normalizeMonitorFilters({ minRefreshRate: '165' }), { minRefreshRate: 165 });
  for (const step of REFRESH_RATE_STEPS) assert.equal(normalizeMonitorFilters({ minRefreshRate: String(step) }).minRefreshRate, step);
});

test('monitorFilterClauses builds numeric/range SQL from validated values only', () => {
  const clauses = monitorFilterClauses({ minRefreshRate: '144', screenSize: 'm', resolution: 'uhd', panelType: 'IPS' });
  assert.equal(clauses.length, 4);
  assert.match(clauses[0], /\$\.refresh_rate.* >= 144$/);
  assert.match(clauses[1], /\$\.screen_size.* > 27 AND .* <= 32/);
  assert.match(clauses[2], /\$\.resolution\[1\].* > 1600 AND .* <= 2400/);
  assert.match(clauses[3], /\$\.panel_type.* = 'IPS'$/);
  // กลุ่มสุดท้ายไม่มีขอบบน
  assert.doesNotMatch(monitorFilterClauses({ screenSize: 'l' })[0], /<=/);
  assert.deepEqual(monitorFilterClauses({}), []);
  assert.deepEqual(monitorFilterClauses({ panelType: "'; DROP TABLE products; --" }), []);
});

test('buildWhereClause applies the spec filters only for the monitor category', () => {
  const monitor = buildWhereClause({ category: 'monitor', minRefreshRate: 144, panelType: 'IPS' });
  assert.match(monitor, />= 144/);
  assert.match(monitor, /= 'IPS'/);
  assert.doesNotMatch(buildWhereClause({ category: 'cpu', minRefreshRate: 144, panelType: 'IPS' }), /refresh_rate|panel_type/);
});

test('buildMonitorFilterOptions counts per option, hides empty ones and orders panel types by count', () => {
  const rows = [
    [60, 21.5, 1080, 'IPS'], [75, 23.8, 1080, 'VA'], [144, 27, 1440, 'IPS'], [165, 27, 1440, 'IPS'],
    [240, 31.5, 2160, 'OLED'], [100, 34, 1440, 'VA'], [null, null, null, null], [144, 24.5, 1080, 'TN']
  ];
  const options = buildMonitorFilterOptions(rows);

  assert.deepEqual(options.refreshRates.map((o) => [o.value, o.count]), [['60', 7], ['75', 6], ['100', 5], ['120', 4], ['144', 4], ['165', 2], ['180', 1], ['240', 1]]);
  assert.equal(options.refreshRates[0].label, '60 Hz ขึ้นไป');
  assert.deepEqual(options.screenSizes.map((o) => [o.value, o.count]), [['xs', 2], ['s', 3], ['m', 1], ['l', 1]]);
  assert.deepEqual(options.resolutions.map((o) => [o.value, o.count]), [['fhd', 3], ['qhd', 3], ['uhd', 1]]);   // 5k ไม่มีสินค้า จึงไม่แสดง
  assert.deepEqual(options.panelTypes.map((o) => [o.value, o.count]), [['IPS', 3], ['VA', 2], ['OLED', 1], ['TN', 1]]);
  assert.deepEqual(buildMonitorFilterOptions(null), { refreshRates: [], screenSizes: [], resolutions: [], panelTypes: [] });
});
