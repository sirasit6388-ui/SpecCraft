import assert from 'node:assert/strict';
import { test } from 'node:test';

import { calculateBudgetPlan, calculateRequiredPsuWattage, createBuildRecommendation, createCompatibilityReport, inferCaseCpuCoolerClearance, inferCaseGpuClearance, inferCaseSupport, inferCpuCoolerHeight, inferCpuSocket, inferGpuLength, inferMemoryType, inferPowerDraw, isModernCpu } from '../services/builder.service.js';
import { createBuilderRoutes } from '../routes/builder.routes.js';

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
  case: [{ id: 9, category: 'case', name: 'Case', price: 1500, currency: 'THB' }]
};

test('calculateBudgetPlan uses equal CPU and GPU weight for work mode', () => {
  assert.deepEqual(calculateBudgetPlan('work', 30000).priorityParts, {
    cpu: 7500,
    gpu: 7500
  });
});

test('calculateBudgetPlan gives gaming mode more CPU budget than GPU budget', () => {
  const plan = calculateBudgetPlan('gaming', 30000);

  assert.equal(plan.priorityParts.cpu, 9000);
  assert.equal(plan.priorityParts.gpu, 6000);
});

test('inferCpuSocket recognizes common AMD and Intel desktop sockets', () => {
  assert.equal(inferCpuSocket({ name: 'AMD Ryzen 7 7800X3D' }), 'AM5');
  assert.equal(inferCpuSocket({ name: 'AMD Ryzen 5 5600' }), 'AM4');
  assert.equal(inferCpuSocket({ name: 'AMD FX-8370' }), 'AM3+');
  assert.equal(inferCpuSocket({ name: 'Intel Core i5-12400F' }), 'LGA1700');
  assert.equal(inferCpuSocket({ name: 'Intel Core i7-10700K' }), 'LGA1200');
  assert.equal(inferCpuSocket({ name: 'Intel Core i7-6950X' }), 'LGA2011-3');
});

test('isModernCpu rejects old CPU families when modern options exist', () => {
  assert.equal(isModernCpu({ name: 'AMD Ryzen 7 5700X3D' }), true);
  assert.equal(isModernCpu({ name: 'AMD FX-8370' }), false);
  assert.equal(isModernCpu({ name: 'AMD Opteron 6320' }), false);
  assert.equal(isModernCpu({ name: 'Intel Core i9-11900F' }), true);
  assert.equal(isModernCpu({ name: 'Intel Core i7-6950X' }), false);
});

test('inferMemoryType recognizes RAM and motherboard memory generation', () => {
  assert.equal(inferMemoryType({ category: 'memory', memoryType: 'DDR5' }), 'DDR5');
  assert.equal(inferMemoryType({ category: 'memory', name: 'Corsair Vengeance DDR4 3200' }), 'DDR4');
  assert.equal(inferMemoryType({ category: 'motherboard', socket: 'AM5', name: 'B650 Board' }), 'DDR5');
  assert.equal(inferMemoryType({ category: 'motherboard', socket: 'AM4', name: 'B550 Board' }), 'DDR4');
  assert.equal(inferMemoryType({ category: 'motherboard', socket: 'LGA1700', name: 'B760 DDR5 Board' }), 'DDR5');
});

test('inferPowerDraw estimates CPU and GPU power draw', () => {
  assert.equal(inferPowerDraw({ category: 'cpu', tdp: 105, name: 'AMD Ryzen 7 5700X3D' }), 105);
  assert.equal(inferPowerDraw({ category: 'video-card', name: 'MSI GeForce RTX 3060 Ventus 2X 12G' }), 170);
  assert.equal(inferPowerDraw({ category: 'video-card', name: 'Sapphire Radeon RX 580' }), 185);
});

test('calculateRequiredPsuWattage adds headroom for CPU and GPU draw', () => {
  assert.equal(calculateRequiredPsuWattage([
    { category: 'cpu', tdp: 105, name: 'AMD Ryzen 7 5700X3D' },
    { category: 'video-card', name: 'MSI GeForce RTX 3060 Ventus 2X 12G' }
  ]), 500);
});

test('inferCaseSupport recognizes common case form factor support', () => {
  assert.deepEqual(inferCaseSupport({ caseType: 'ATX Mid Tower', name: 'Corsair 4000D Airflow' }), ['ATX', 'Micro ATX', 'Mini ITX']);
  assert.deepEqual(inferCaseSupport({ caseType: 'MicroATX Mini Tower', name: 'Thermaltake Versa H18' }), ['Micro ATX', 'Mini ITX']);
  assert.deepEqual(inferCaseSupport({ caseType: 'Mini ITX Desktop', name: 'Tiny Case' }), ['Mini ITX']);
});

test('infers GPU length and case GPU clearance', () => {
  assert.equal(inferGpuLength({ gpuLength: 320, name: 'Radeon RX 9070 XT' }), 320);
  assert.equal(inferGpuLength({ name: 'MSI GeForce RTX 3060 Ventus 2X 12G' }), 235);
  assert.equal(inferCaseGpuClearance({ maxGpuLength: 330, name: 'Known Case' }), 330);
  assert.equal(inferCaseGpuClearance({ caseType: 'MicroATX Mini Tower', externalVolume: 33.6 }), 280);
  assert.equal(inferCaseGpuClearance({ caseType: 'ATX Mid Tower', externalVolume: 48.6 }), 360);
});

test('infers CPU cooler height and case cooler clearance', () => {
  assert.equal(inferCpuCoolerHeight({ coolerHeight: 165, name: 'Known Cooler' }), 165);
  assert.equal(inferCpuCoolerHeight({ name: 'Noctua NH-D15 chromax.black' }), 165);
  assert.equal(inferCpuCoolerHeight({ name: 'ARCTIC Freezer i35 CO' }), 158);
  assert.equal(inferCpuCoolerHeight({ name: 'Cooler Master Hyper 212 Black Edition' }), 159);
  assert.equal(inferCpuCoolerHeight({ name: 'NZXT Kraken 360', radiatorSize: 360 }), 0);
  assert.equal(inferCaseCpuCoolerClearance({ maxCpuCoolerHeight: 170 }), 170);
  assert.equal(inferCaseCpuCoolerClearance({ caseType: 'MicroATX Mini Tower', externalVolume: 33.6 }), 155);
  assert.equal(inferCaseCpuCoolerClearance({ caseType: 'ATX Mid Tower', externalVolume: 48.6 }), 170);
});

test('createCompatibilityReport explains compatible parts and incomplete data', () => {
  const compatible = createCompatibilityReport([
    { category: 'cpu', name: 'AMD Ryzen 7 7800X3D' },
    { category: 'motherboard', name: 'B650 DDR5 ATX', socket: 'AM5' },
    { category: 'memory', name: 'DDR5 32GB' },
    { category: 'video-card', name: 'RTX 4070', gpuLength: 300 },
    { category: 'power-supply', name: 'Power Supply 650W' },
    { category: 'case', caseType: 'ATX Mid Tower', maxGpuLength: 340, maxCpuCoolerHeight: 170 },
    { category: 'cpu-cooler', coolerHeight: 155, name: 'Tower Cooler' }
  ]);

  assert.equal(compatible.status, 'pass');
  assert.equal(compatible.failures, 0);
  assert.equal(compatible.passes, 6);

  const incomplete = createCompatibilityReport([{ category: 'cpu', name: 'CPU' }]);
  assert.equal(incomplete.status, 'warning');
  assert.equal(incomplete.warnings, 6);
});

test('createBuildRecommendation selects one part per required category and totals price', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 30000,
    listProducts: async ({ category }) => sampleProducts[category] || []
  });

  assert.equal(build.mode, 'gaming');
  assert.equal(build.budget, 30000);
  assert.equal(build.items.length, 7);
  assert.equal(build.items.find((item) => item.category === 'cpu').name, 'CPU Balanced');
  assert.equal(build.items.find((item) => item.category === 'video-card').name, 'GPU Balanced');
  assert.equal(build.total, 23600);
  assert.equal(build.remaining, 6400);
});

test('createBuildRecommendation rejects incomplete, over-budget, and incompatible builds', async () => {
  await assert.rejects(
    () => createBuildRecommendation({
      mode: 'gaming',
      budget: 30000,
      listProducts: async ({ category }) => category === 'cpu' ? sampleProducts.cpu : []
    }),
    /Missing: video-card, motherboard, memory, internal-hard-drive, power-supply, case/
  );

  await assert.rejects(
    () => createBuildRecommendation({
      mode: 'work',
      budget: 1000,
      listProducts: async ({ category }) => sampleProducts[category] || []
    }),
    /within the selected budget/
  );
});

test('createBuildRecommendation supports paginated product service results', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 30000,
    listProducts: async ({ category }) => ({
      products: sampleProducts[category] || [],
      total: (sampleProducts[category] || []).length,
      limit: 1000,
      offset: 0
    })
  });

  assert.equal(build.items.length, 7);
  assert.equal(build.total, 23600);
});

test('createBuildRecommendation upgrades parts to get closer to a 40000 baht budget', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', name: 'CPU Entry', price: 5000, currency: 'THB' },
        { id: 2, category: 'cpu', name: 'CPU Mid', price: 11000, currency: 'THB' },
        { id: 3, category: 'cpu', name: 'CPU High', price: 15000, currency: 'THB' }
      ],
      'video-card': [
        { id: 4, category: 'video-card', name: 'GPU Entry', price: 6000, currency: 'THB' },
        { id: 5, category: 'video-card', name: 'GPU Mid', price: 9000, currency: 'THB' },
        { id: 6, category: 'video-card', name: 'GPU High', price: 14000, currency: 'THB' }
      ],
      motherboard: [{ id: 7, category: 'motherboard', name: 'Mainboard', price: 3500, currency: 'THB' }],
      memory: [{ id: 8, category: 'memory', name: 'RAM', price: 2500, currency: 'THB' }],
      'internal-hard-drive': [{ id: 9, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [{ id: 10, category: 'power-supply', name: 'PSU', price: 2500, currency: 'THB' }],
      case: [{ id: 11, category: 'case', name: 'Case', price: 2000, currency: 'THB' }]
    })[category] || []
  });

  assert.equal(build.total, 38000);
  assert.equal(build.remaining, 2000);
  assert.equal(build.items.find((item) => item.category === 'cpu').name, 'CPU Mid');
  assert.equal(build.items.find((item) => item.category === 'video-card').name, 'GPU High');
});

test('createBuildRecommendation filters CPU candidates by preferred brand', async () => {
  const requests = [];
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'AMD',
    listProducts: async (filters) => {
      requests.push(filters);

      return ({
        cpu: [
          { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7', price: 12000, currency: 'THB' }
        ],
        'video-card': [{ id: 2, category: 'video-card', name: 'GPU', price: 10000, currency: 'THB' }],
        motherboard: [{ id: 3, category: 'motherboard', name: 'Mainboard', price: 4000, currency: 'THB' }],
        memory: [{ id: 4, category: 'memory', name: 'RAM', price: 3000, currency: 'THB' }],
        'internal-hard-drive': [{ id: 5, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
        'power-supply': [{ id: 6, category: 'power-supply', name: 'PSU', price: 2500, currency: 'THB' }],
        case: [{ id: 7, category: 'case', name: 'Case', price: 2000, currency: 'THB' }]
      })[filters.category] || [];
    }
  });

  assert.equal(requests.find((request) => request.category === 'cpu').brand, 'AMD');
  assert.equal(build.cpuBrand, 'AMD');
  assert.equal(build.items.find((item) => item.category === 'cpu').brand, 'AMD');
});

test('createBuildRecommendation pairs motherboard socket with selected CPU socket', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'AMD',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 7800X3D', price: 12000, currency: 'THB' }
      ],
      'video-card': [{ id: 2, category: 'video-card', name: 'GPU', price: 9000, currency: 'THB' }],
      motherboard: [
        { id: 3, category: 'motherboard', name: 'AM4 Board', socket: 'AM4', price: 3000, currency: 'THB' },
        { id: 4, category: 'motherboard', name: 'AM5 Board', socket: 'AM5', price: 4500, currency: 'THB' }
      ],
      memory: [{ id: 5, category: 'memory', name: 'RAM', price: 3000, currency: 'THB' }],
      'internal-hard-drive': [{ id: 6, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [{ id: 7, category: 'power-supply', name: 'PSU', price: 2500, currency: 'THB' }],
      case: [{ id: 8, category: 'case', name: 'Case', price: 2000, currency: 'THB' }]
    })[category] || []
  });

  assert.equal(build.socket, 'AM5');
  assert.equal(build.items.find((item) => item.category === 'motherboard').name, 'AM5 Board');
});

test('createBuildRecommendation avoids CPU platforms whose compatible motherboard breaks the budget', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'Intel',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'Intel', name: 'Intel Core i7-6950X', price: 12000, currency: 'THB' },
        { id: 2, category: 'cpu', brand: 'Intel', name: 'Intel Core i5-12400F', price: 9000, currency: 'THB' }
      ],
      'video-card': [{ id: 3, category: 'video-card', name: 'GPU', price: 12000, currency: 'THB' }],
      motherboard: [
        { id: 4, category: 'motherboard', name: 'X99 Board', socket: 'LGA2011-3', price: 22000, currency: 'THB' },
        { id: 5, category: 'motherboard', name: 'B660 Board', socket: 'LGA1700', price: 4500, currency: 'THB' }
      ],
      memory: [{ id: 6, category: 'memory', name: 'RAM', price: 3000, currency: 'THB' }],
      'internal-hard-drive': [{ id: 7, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [{ id: 8, category: 'power-supply', name: 'PSU', price: 2500, currency: 'THB' }],
      case: [{ id: 9, category: 'case', name: 'Case', price: 2000, currency: 'THB' }]
    })[category] || []
  });

  assert.equal(build.socket, 'LGA1700');
  assert.equal(build.total <= build.budget, true);
  assert.equal(build.items.find((item) => item.category === 'cpu').name, 'Intel Core i5-12400F');
  assert.equal(build.items.find((item) => item.category === 'motherboard').name, 'B660 Board');
});

test('createBuildRecommendation prefers modern CPUs over older CPUs that only fit the price better', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'AMD',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD FX-8370', price: 11500, currency: 'THB' },
        { id: 2, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 5700X3D', price: 11400, currency: 'THB' }
      ],
      'video-card': [{ id: 3, category: 'video-card', name: 'GPU', price: 12000, currency: 'THB' }],
      motherboard: [
        { id: 4, category: 'motherboard', name: 'AM3 Board', socket: 'AM3+', price: 3000, currency: 'THB' },
        { id: 5, category: 'motherboard', name: 'AM4 Board', socket: 'AM4', price: 3500, currency: 'THB' }
      ],
      memory: [{ id: 6, category: 'memory', name: 'RAM', price: 3000, currency: 'THB' }],
      'internal-hard-drive': [{ id: 7, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [{ id: 8, category: 'power-supply', name: 'PSU', price: 2500, currency: 'THB' }],
      case: [{ id: 9, category: 'case', name: 'Case', price: 2000, currency: 'THB' }]
    })[category] || []
  });

  assert.equal(build.socket, 'AM4');
  assert.equal(build.items.find((item) => item.category === 'cpu').name, 'AMD Ryzen 7 5700X3D');
});

test('createBuildRecommendation pairs memory type with selected motherboard', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'AMD',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 7800X3D', price: 12000, currency: 'THB' }
      ],
      'video-card': [{ id: 2, category: 'video-card', name: 'GPU', price: 9000, currency: 'THB' }],
      motherboard: [
        { id: 3, category: 'motherboard', name: 'AM5 Board', socket: 'AM5', price: 4500, currency: 'THB' }
      ],
      memory: [
        { id: 4, category: 'memory', name: 'DDR4 RAM', memoryType: 'DDR4', memoryGb: 32, price: 2500, currency: 'THB' },
        { id: 5, category: 'memory', name: 'DDR5 RAM', memoryType: 'DDR5', memoryGb: 32, price: 3200, currency: 'THB' }
      ],
      'internal-hard-drive': [{ id: 6, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [{ id: 7, category: 'power-supply', name: 'PSU', price: 2500, currency: 'THB' }],
      case: [{ id: 8, category: 'case', name: 'Case', price: 2000, currency: 'THB' }]
    })[category] || []
  });

  assert.equal(build.memoryType, 'DDR5');
  assert.equal(build.items.find((item) => item.category === 'memory').name, 'DDR5 RAM');
});

test('createBuildRecommendation prefers at least 16 GB memory when available', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'AMD',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 5700X3D', price: 11000, currency: 'THB' }
      ],
      'video-card': [{ id: 2, category: 'video-card', name: 'GPU', price: 12000, currency: 'THB' }],
      motherboard: [
        { id: 3, category: 'motherboard', name: 'AM4 Board', socket: 'AM4', price: 3500, currency: 'THB' }
      ],
      memory: [
        { id: 4, category: 'memory', name: 'DDR4 8GB', memoryType: 'DDR4', memoryGb: 8, price: 3500, currency: 'THB' },
        { id: 5, category: 'memory', name: 'DDR4 16GB', memoryType: 'DDR4', memoryGb: 16, price: 1800, currency: 'THB' }
      ],
      'internal-hard-drive': [{ id: 6, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [{ id: 7, category: 'power-supply', name: 'PSU', price: 2500, currency: 'THB' }],
      case: [{ id: 8, category: 'case', name: 'Case', price: 2000, currency: 'THB' }]
    })[category] || []
  });

  assert.equal(build.items.find((item) => item.category === 'memory').name, 'DDR4 16GB');
});

test('createBuildRecommendation selects PSU wattage that covers CPU and GPU draw', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'AMD',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 5700X3D', tdp: 105, price: 11000, currency: 'THB' }
      ],
      'video-card': [{ id: 2, category: 'video-card', name: 'MSI GeForce RTX 3060 Ventus 2X 12G', price: 12000, currency: 'THB' }],
      motherboard: [
        { id: 3, category: 'motherboard', name: 'AM4 Board', socket: 'AM4', price: 3500, currency: 'THB' }
      ],
      memory: [{ id: 4, category: 'memory', name: 'DDR4 16GB', memoryType: 'DDR4', memoryGb: 16, price: 1800, currency: 'THB' }],
      'internal-hard-drive': [{ id: 5, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [
        { id: 6, category: 'power-supply', name: 'Weak PSU', wattage: 350, price: 3000, currency: 'THB' },
        { id: 7, category: 'power-supply', name: 'Safe PSU', wattage: 550, price: 1800, currency: 'THB' }
      ],
      case: [{ id: 8, category: 'case', name: 'Case', price: 2000, currency: 'THB' }]
    })[category] || []
  });

  assert.equal(build.requiredPsuWattage, 500);
  assert.equal(build.items.find((item) => item.category === 'power-supply').name, 'Safe PSU');
});

test('createBuildRecommendation avoids overkill PSU wattage when a suitable PSU exists', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'AMD',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 5700X3D', tdp: 105, price: 11000, currency: 'THB' }
      ],
      'video-card': [{ id: 2, category: 'video-card', name: 'MSI GeForce RTX 3060 Ventus 2X 12G', price: 12000, currency: 'THB' }],
      motherboard: [
        { id: 3, category: 'motherboard', name: 'AM4 Board', socket: 'AM4', price: 3500, currency: 'THB' }
      ],
      memory: [{ id: 4, category: 'memory', name: 'DDR4 16GB', memoryType: 'DDR4', memoryGb: 16, price: 1800, currency: 'THB' }],
      'internal-hard-drive': [{ id: 5, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [
        { id: 6, category: 'power-supply', name: 'Suitable PSU', wattage: 650, price: 1800, currency: 'THB' },
        { id: 7, category: 'power-supply', name: 'Overkill PSU', wattage: 1200, price: 8000, currency: 'THB' }
      ],
      case: [{ id: 8, category: 'case', name: 'Case', price: 2000, currency: 'THB' }]
    })[category] || []
  });

  assert.equal(build.items.find((item) => item.category === 'power-supply').name, 'Suitable PSU');
});

test('createBuildRecommendation selects case that supports selected motherboard form factor', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'AMD',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 5700X3D', tdp: 105, price: 11000, currency: 'THB' }
      ],
      'video-card': [{ id: 2, category: 'video-card', name: 'MSI GeForce RTX 3060 Ventus 2X 12G', price: 12000, currency: 'THB' }],
      motherboard: [
        { id: 3, category: 'motherboard', name: 'ATX AM4 Board', socket: 'AM4', formFactor: 'ATX', price: 3500, currency: 'THB' }
      ],
      memory: [{ id: 4, category: 'memory', name: 'DDR4 16GB', memoryType: 'DDR4', memoryGb: 16, price: 1800, currency: 'THB' }],
      'internal-hard-drive': [{ id: 5, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [{ id: 6, category: 'power-supply', name: 'PSU 650W', wattage: 650, price: 1800, currency: 'THB' }],
      case: [
        { id: 7, category: 'case', name: 'MicroATX Case', caseType: 'MicroATX Mini Tower', price: 4000, currency: 'THB' },
        { id: 8, category: 'case', name: 'ATX Case', caseType: 'ATX Mid Tower', price: 1500, currency: 'THB' }
      ]
    })[category] || []
  });

  assert.equal(build.motherboardFormFactor, 'ATX');
  assert.deepEqual(build.caseSupport, ['ATX', 'Micro ATX', 'Mini ITX']);
  assert.equal(build.items.find((item) => item.category === 'case').name, 'ATX Case');
});

test('createBuildRecommendation selects case that fits selected GPU length', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 50000,
    cpuBrand: 'AMD',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 5700X3D', tdp: 105, price: 11000, currency: 'THB' }
      ],
      'video-card': [
        { id: 2, category: 'video-card', name: 'Long GPU', gpuLength: 330, price: 16000, currency: 'THB' }
      ],
      motherboard: [
        { id: 3, category: 'motherboard', name: 'ATX AM4 Board', socket: 'AM4', formFactor: 'ATX', price: 3500, currency: 'THB' }
      ],
      memory: [{ id: 4, category: 'memory', name: 'DDR4 16GB', memoryType: 'DDR4', memoryGb: 16, price: 1800, currency: 'THB' }],
      'internal-hard-drive': [{ id: 5, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [{ id: 6, category: 'power-supply', name: 'PSU 650W', wattage: 650, price: 1800, currency: 'THB' }],
      case: [
        { id: 7, category: 'case', name: 'Short Case', caseType: 'ATX Mid Tower', maxGpuLength: 280, price: 4000, currency: 'THB' },
        { id: 8, category: 'case', name: 'Long Case', caseType: 'ATX Mid Tower', maxGpuLength: 360, price: 2000, currency: 'THB' }
      ]
    })[category] || []
  });

  assert.equal(build.gpuLength, 330);
  assert.equal(build.caseGpuClearance, 360);
  assert.equal(build.items.find((item) => item.category === 'case').name, 'Long Case');
});

test('createBuildRecommendation selects CPU cooler that fits selected case clearance', async () => {
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 50000,
    cpuBrand: 'AMD',
    listProducts: async ({ category }) => ({
      cpu: [
        { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 5700X3D', tdp: 105, price: 11000, currency: 'THB' }
      ],
      'video-card': [
        { id: 2, category: 'video-card', name: 'GPU', gpuLength: 240, price: 16000, currency: 'THB' }
      ],
      motherboard: [
        { id: 3, category: 'motherboard', name: 'ATX AM4 Board', socket: 'AM4', formFactor: 'ATX', price: 3500, currency: 'THB' }
      ],
      memory: [{ id: 4, category: 'memory', name: 'DDR4 16GB', memoryType: 'DDR4', memoryGb: 16, price: 1800, currency: 'THB' }],
      'internal-hard-drive': [{ id: 5, category: 'internal-hard-drive', name: 'SSD', price: 2500, currency: 'THB' }],
      'power-supply': [{ id: 6, category: 'power-supply', name: 'PSU 650W', wattage: 650, price: 1800, currency: 'THB' }],
      case: [
        { id: 7, category: 'case', name: 'Compact ATX Case', caseType: 'ATX Mid Tower', maxCpuCoolerHeight: 155, maxGpuLength: 300, price: 2000, currency: 'THB' }
      ],
      'cpu-cooler': [
        { id: 8, category: 'cpu-cooler', name: 'Noctua NH-D15 chromax.black', coolerHeight: 165, price: 2800, currency: 'THB' },
        { id: 9, category: 'cpu-cooler', name: 'Thermalright Assassin X 120 Refined SE', coolerHeight: 148, price: 1200, currency: 'THB' }
      ]
    })[category] || []
  });

  assert.equal(build.caseCpuCoolerClearance, 155);
  assert.equal(build.cpuCoolerHeight, 148);
  assert.equal(build.items.find((item) => item.category === 'cpu-cooler').name, 'Thermalright Assassin X 120 Refined SE');
});

test('POST /api/build/recommend returns generated build', async () => {
  let requestOptions;
  const route = createBuilderRoutes({
    recommendBuild: async (options) => {
      requestOptions = options;

      return {
        mode: 'work',
        budget: 25000,
        cpuBrand: 'AMD',
        total: 21000,
        remaining: 4000,
        items: []
      };
    }
  });
  const response = createMockResponse();
  const handled = await route(createJsonRequest('/api/build/recommend', { mode: 'work', budget: 25000, cpuBrand: 'AMD' }), response);

  assert.equal(handled, true);
  assert.equal(response.statusCode, 200);
  assert.equal(requestOptions.cpuBrand, 'AMD');
  assert.deepEqual(JSON.parse(response.body).build.remaining, 4000);
});

function createJsonRequest(url, payload) {
  return {
    method: 'POST',
    url,
    async json() {
      return payload;
    },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(payload));
    }
  };
}

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(statusCode, headers) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    }
  };
}
