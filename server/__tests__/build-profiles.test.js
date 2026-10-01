import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMonitorBudgetPlan, MONITOR_SHARE } from '../services/build-profiles.js';

test('monitor gets exactly 8% of the budget in both modes', () => {
  assert.equal(MONITOR_SHARE, 0.08);
  assert.equal(calculateMonitorBudgetPlan('gaming', 100000).targets.monitor, 8000);
  assert.equal(calculateMonitorBudgetPlan('work', 100000).targets.monitor, 8000);
});

test('the other categories keep the same ratio to each other as the original shares, just scaled down', () => {
  const gaming = calculateMonitorBudgetPlan('gaming', 100000).targets;
  // เดิม CPU:การ์ดจอ = 60:40 = 1.5 เท่า
  assert.ok(Math.abs(gaming.cpu / gaming['video-card'] - 1.5) < 0.01);
  // เดิมหมวดมาตรฐาน (เมนบอร์ด/แรม/ที่เก็บ/PSU/เคส) เท่ากันหมด
  assert.equal(gaming.motherboard, gaming.memory);
  assert.equal(gaming.memory, gaming['internal-hard-drive']);
  assert.equal(gaming['internal-hard-drive'], gaming['power-supply']);
  assert.equal(gaming['power-supply'], gaming.case);

  const work = calculateMonitorBudgetPlan('work', 100000).targets;
  assert.equal(work.cpu, work['video-card']); // เดิม 50:50
});

test('total of all targets (including the monitor) stays within the original 93% ceiling', () => {
  for (const budget of [19000, 30000, 50000, 80000, 150000, 400000]) {
    for (const mode of ['gaming', 'work']) {
      const { targets } = calculateMonitorBudgetPlan(mode, budget);
      const total = Object.values(targets).reduce((a, b) => a + b, 0);
      assert.ok(total <= budget * 0.93 + 10, `${mode} ${budget}: ${total}`);
    }
  }
});

test('an invalid/zero budget never produces negative targets', () => {
  const { targets } = calculateMonitorBudgetPlan('gaming', 0);
  assert.ok(Object.values(targets).every((value) => value === 0));
  assert.ok(Object.values(calculateMonitorBudgetPlan('work', 'abc').targets).every((value) => value === 0));
});

// ---- integration: createBuildRecommendation with includeMonitor ----
import { createBuildRecommendation } from '../services/builder.service.js';

const sampleProducts = {
  cpu: [
    { id: 1, category: 'cpu', name: 'CPU Entry', price: 3200, currency: 'THB' },
    { id: 2, category: 'cpu', name: 'CPU Balanced', price: 5900, currency: 'THB' }
  ],
  'video-card': [
    { id: 3, category: 'video-card', name: 'GPU Entry', price: 4500, currency: 'THB' },
    { id: 4, category: 'video-card', name: 'GPU Balanced', price: 7600, currency: 'THB' }
  ],
  motherboard: [{ id: 5, category: 'motherboard', name: 'Mainboard', price: 2900, currency: 'THB' }],
  memory: [{ id: 6, category: 'memory', name: 'RAM 16GB', price: 1600, currency: 'THB' }],
  'internal-hard-drive': [{ id: 7, category: 'internal-hard-drive', name: 'SSD 1TB', price: 2200, currency: 'THB' }],
  'power-supply': [{ id: 8, category: 'power-supply', name: 'PSU 650W', price: 1900, currency: 'THB' }],
  case: [{ id: 9, category: 'case', name: 'Case', price: 1500, currency: 'THB' }],
  monitor: [
    { id: 10, category: 'monitor', name: 'Monitor Entry', price: 2500, currency: 'THB', inStock: true, priceIsEstimate: false },
    { id: 11, category: 'monitor', name: 'Monitor Mid', price: 4500, currency: 'THB', inStock: true, priceIsEstimate: false }
  ]
};

test('includeMonitor: false behaves exactly like before (no monitor category, same total as the original)', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 30000,
    listProducts: async ({ category }) => sampleProducts[category] || []
  });

  assert.equal(build.items.length, 7);
  assert.equal(build.items.some((item) => item.category === 'monitor'), false);
  assert.equal(build.total, 23600); // ค่าเดิมที่เทสต์ builder.test.js ยืนยันไว้แล้ว
  assert.equal(build.monitorRequested, false);
  assert.equal(build.monitorIncluded, false);
  assert.deepEqual(build.notices, []);
});

test('includeMonitor: true adds a monitor item and stays within budget', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 30000,
    includeMonitor: true,
    listProducts: async ({ category }) => sampleProducts[category] || []
  });

  assert.equal(build.items.length, 8);
  const monitor = build.items.find((item) => item.category === 'monitor');
  assert.ok(monitor, 'ต้องมีจอในสเปคที่ได้');
  assert.ok(build.total <= build.budget);
  assert.equal(build.monitorRequested, true);
  assert.equal(build.monitorIncluded, true);
});

test('includeMonitor: true falls back to a no-monitor build (not a thrown error) when no eligible monitor exists', async () => {
  const noMonitors = { ...sampleProducts, monitor: [{ id: 12, category: 'monitor', name: 'Out of stock', price: 2000, inStock: false }] };

  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 30000,
    includeMonitor: true,
    listProducts: async ({ category }) => noMonitors[category] || []
  });

  assert.equal(build.items.some((item) => item.category === 'monitor'), false);
  assert.equal(build.monitorRequested, true);
  assert.equal(build.monitorIncluded, false);
  assert.equal(build.notices.length, 1);
  assert.equal(build.notices[0].code, 'monitor-unavailable');
  assert.equal(build.total, 23600); // ตกกลับไปใช้ผลแบบไม่รวมจอเดิมเป๊ะ
});

test('includeMonitor: true falls back when the budget is too tight to fit a monitor plus the required parts', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 19000, // ต่ำสุดที่ required categories ยังจัดได้โดยไม่มีจอ (ดูเทสต์เดิมใน builder.test.js)
    includeMonitor: true,
    listProducts: async ({ category }) => sampleProducts[category] || []
  });

  assert.equal(build.monitorRequested, true);
  // อาจจัดจอได้หรือไม่ได้ขึ้นกับราคาที่เหลือ แต่ไม่ว่าทางไหน ต้องไม่โยน error และผลรวมต้องไม่เกินงบ
  assert.ok(build.total <= build.budget);
});

test('eligibility: priceIsEstimate or inStock=false monitors are skipped, unknown stock is fine', async () => {
  const mixed = {
    ...sampleProducts,
    monitor: [
      { id: 13, category: 'monitor', name: 'Estimate priced', price: 2000, priceIsEstimate: true },
      { id: 14, category: 'monitor', name: 'Unknown stock', price: 3500, inStock: null, priceIsEstimate: false }
    ]
  };

  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 30000,
    includeMonitor: true,
    listProducts: async ({ category }) => mixed[category] || []
  });

  const monitor = build.items.find((item) => item.category === 'monitor');
  assert.equal(monitor?.name, 'Unknown stock');
});

// ---- route: includeMonitor forwarding ----
import { createBuilderRoutes } from '../routes/builder.routes.js';

function createJsonRequest(url, payload) {
  return {
    method: 'POST',
    url,
    async json() { return payload; },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(payload)); }
  };
}

function createMockResponse() {
  return {
    statusCode: 0,
    body: '',
    setHeader() {},
    writeHead(statusCode) { this.statusCode = statusCode; },
    end(body) { this.body = body; }
  };
}

test('POST /api/build/recommend forwards includeMonitor as a strict boolean, defaulting to false', async () => {
  let seen;
  const route = createBuilderRoutes({ recommendBuild: async (options) => { seen = options; return { items: [] }; } });

  await route(createJsonRequest('/api/build/recommend', { mode: 'gaming', budget: 50000, includeMonitor: true }), createMockResponse());
  assert.equal(seen.includeMonitor, true);

  await route(createJsonRequest('/api/build/recommend', { mode: 'gaming', budget: 50000 }), createMockResponse());
  assert.equal(seen.includeMonitor, false);

  await route(createJsonRequest('/api/build/recommend', { mode: 'gaming', budget: 50000, includeMonitor: 'true' }), createMockResponse());
  assert.equal(seen.includeMonitor, false); // ไม่ใช่ boolean จริง ถือเป็น false (กัน truthy string หลุดเข้ามา)
});
