import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeFitScore,
  computeValueScores,
  createBuildRecommendation,
  filterCompatibleProducts,
  inferStorageCapacity,
  normalizeMinMax,
  selectByKnnWsm,
  shortlistByKnn
} from '../services/builder.service.js';

// ---- computeFitScore -------------------------------------------------

test('computeFitScore scores an exact target match as 1', () => {
  assert.equal(computeFitScore(5000, 5000), 1);
});

test('computeFitScore falls off linearly with distance from target', () => {
  assert.equal(computeFitScore(6500, 5000), 0.7);
  assert.equal(computeFitScore(3500, 5000), 0.7);
});

test('computeFitScore clamps at 0 instead of going negative', () => {
  assert.equal(computeFitScore(10000, 5000), 0);
  assert.equal(computeFitScore(50000, 5000), 0);
});

test('computeFitScore treats a missing/zero target as a perfect match', () => {
  assert.equal(computeFitScore(1234, 0), 1);
});

// ---- normalizeMinMax ---------------------------------------------------

test('normalizeMinMax scales values into [0, 1]', () => {
  const normalize = normalizeMinMax([1, 2, 3]);

  assert.equal(normalize(1), 0);
  assert.equal(normalize(2), 0.5);
  assert.equal(normalize(3), 1);
});

test('normalizeMinMax returns a constant 1 when every value is the same', () => {
  const normalize = normalizeMinMax([5, 5, 5]);

  assert.equal(normalize(5), 1);
});

// ---- inferStorageCapacity ------------------------------------------------

test('inferStorageCapacity reads terabytes from the product name', () => {
  assert.equal(inferStorageCapacity({ name: 'WD Blue 1TB SSD' }), 1000);
  assert.equal(inferStorageCapacity({ name: 'Seagate 2.5 2TB HDD' }), 2000);
});

test('inferStorageCapacity reads gigabytes from the product name', () => {
  assert.equal(inferStorageCapacity({ name: 'Kingston NV2 500GB NVMe' }), 500);
});

test('inferStorageCapacity returns 0 when no capacity is found', () => {
  assert.equal(inferStorageCapacity({ name: 'Some Drive' }), 0);
});

// ---- computeValueScores --------------------------------------------------

test('computeValueScores returns all zeros when the category has no value spec', () => {
  const products = [{ price: 1000 }, { price: 2000 }];
  const scores = computeValueScores(products, null);

  assert.equal(scores.get(products[0]), 0);
  assert.equal(scores.get(products[1]), 0);
});

test('computeValueScores min-max normalizes spec-per-baht across the candidate set', () => {
  const cheapBigger = { price: 1000, memoryGb: 16 }; // 0.016 GB/baht
  const pricierSmaller = { price: 1000, memoryGb: 8 }; // 0.008 GB/baht
  const scores = computeValueScores([cheapBigger, pricierSmaller], (p) => p.memoryGb);

  assert.equal(scores.get(cheapBigger), 1);
  assert.equal(scores.get(pricierSmaller), 0);
});

// ---- shortlistByKnn / selectByKnnWsm ------------------------------------
//
// These two hand-verified scenarios are also written up (with the full
// worked arithmetic) in docs/wsm-knn-plan.md section 5, so a maintainer can
// re-derive the expected numbers without re-running the code.

test('shortlistByKnn keeps the K candidates closest to target price for a price-only category (cpu)', () => {
  const products = [
    { category: 'cpu', price: 8000 },
    { category: 'cpu', price: 9000 },
    { category: 'cpu', price: 10000 },
    { category: 'cpu', price: 12000 },
    { category: 'cpu', price: 20000 },
    { category: 'cpu', price: 30000 }
  ];

  // K_NEIGHBORS is 5, so exactly one candidate (the farthest from target) is
  // dropped: 30000 is 21000 away from the 9000 target, further than every
  // other candidate.
  const neighbors = shortlistByKnn(products, 9000, { category: 'cpu' }).map((entry) => entry.product.price);

  assert.equal(neighbors.length, 5);
  assert.ok(!neighbors.includes(30000));
});

test('shortlistByKnn returns every candidate when there are fewer than K', () => {
  const products = [
    { category: 'cpu', price: 8000 },
    { category: 'cpu', price: 9000 },
    { category: 'cpu', price: 10000 }
  ];

  const neighbors = shortlistByKnn(products, 9000, { category: 'cpu' });

  assert.equal(neighbors.length, 3);
});

test('selectByKnnWsm picks the nearest-to-target product for a price-only category', () => {
  const products = [
    { category: 'cpu', price: 8000 },
    { category: 'cpu', price: 9000 },
    { category: 'cpu', price: 10000 },
    { category: 'cpu', price: 12000 }
  ];

  // Target 9200: distances are 1200 / 200 / 800 / 2800 - 9000 is the
  // unambiguous winner.
  const selected = selectByKnnWsm(products, 9200, { category: 'cpu' });

  assert.equal(selected.price, 9000);
});

test('shortlistByKnn (the raw K-NN step, no affordability guard) balances price-fit against value (GB/baht) for memory, and drops the worst outlier', () => {
  const target = 3000;
  const productA = { category: 'memory', price: 2900, memoryGb: 16 };
  const productB = { category: 'memory', price: 3100, memoryGb: 32 };
  const productC = { category: 'memory', price: 3000, memoryGb: 16 };
  const productD = { category: 'memory', price: 5000, memoryGb: 64 };
  const productE = { category: 'memory', price: 1000, memoryGb: 8 };
  // Expensive AND the worst value ratio in the set - K-NN should exclude it
  // from the shortlist regardless.
  const productF = { category: 'memory', price: 10000, memoryGb: 8 };

  const products = [productA, productB, productC, productD, productE, productF];
  const neighbors = shortlistByKnn(products, target, { category: 'memory' }).map((entry) => entry.product);

  assert.equal(neighbors.length, 5);
  assert.ok(!neighbors.includes(productF), 'the K-NN shortlist should drop the farthest outlier (F)');
});

// ---- selectByKnnWsm's "affordable first" guard --------------------------
//
// Regression coverage for a real bug: fitScore/distance are symmetric around
// the target (overshooting and undershooting are penalized equally), which
// is the right way to rank *affordable* options against each other but was,
// before this guard existed, also applied as the very first filter. At a low
// budget a category's target share can sit below every real product's
// price, and the symmetric scoring could then pick an over-target product in
// several categories at once - pushing the whole build's total past the
// user's budget even though a cheaper complete build was possible. This is
// what "budgets under ~40,000 can't build" turned out to be: see
// docs/wsm-knn-plan.md for the design this guard was added on top of.

test('selectByKnnWsm prefers an at-or-under-target product over a pricier one with a much better value ratio', () => {
  const target = 1000;
  const affordable = { category: 'memory', price: 900, memoryGb: 8 }; // modest value, but fits the target
  const pricierBetterValue = { category: 'memory', price: 2500, memoryGb: 64 }; // 3x the value ratio, but over target

  const selected = selectByKnnWsm([affordable, pricierBetterValue], target, { category: 'memory' });

  assert.equal(selected, affordable);
});

test('selectByKnnWsm still balances price-fit against value among the affordable candidates', () => {
  const target = 3000;
  const productA = { category: 'memory', price: 2900, memoryGb: 16 }; // affordable, decent value
  const productC = { category: 'memory', price: 3000, memoryGb: 16 }; // affordable, exact price match, weaker value
  const productE = { category: 'memory', price: 1000, memoryGb: 8 }; // affordable, worst price-fit, best value ratio
  // Not affordable at all (price > target) - must be excluded from
  // consideration entirely, however good its value ratio is.
  const productB = { category: 'memory', price: 3100, memoryGb: 32 };

  // A narrowly outscores C: both have a near-perfect price-fit, but A's
  // value ratio (16/2900) edges out C's (16/3000) - see the worked
  // calculation in docs/wsm-knn-plan.md.
  const selected = selectByKnnWsm([productA, productB, productC, productE], target, { category: 'memory' });

  assert.equal(selected, productA);
});

test('selectByKnnWsm falls back to the full candidate pool when nothing is at or under target', () => {
  const target = 500;
  const cheaperOfTheTwo = { category: 'memory', price: 900, memoryGb: 8 };
  const betterValue = { category: 'memory', price: 1200, memoryGb: 32 };

  // Neither product is at or under the 500 target, so the guard falls back
  // to scoring the full pool - ordinary WSM behavior applies and the far
  // better value ratio (32/1200 vs 8/900) wins out over pure price-fit.
  const selected = selectByKnnWsm([cheaperOfTheTwo, betterValue], target, { category: 'memory' });

  assert.equal(selected, betterValue);
});

// ---- end-to-end sanity check through createBuildRecommendation ---------

function createCatalog() {
  return {
    cpu: [
      { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 5 7600', price: 7000 },
      { id: 2, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 7 7800X3D', price: 12000 }
    ],
    motherboard: [
      { id: 3, category: 'motherboard', brand: 'ASUS', name: 'ASUS Prime B650', price: 4000, socket: 'AM5', formFactor: 'ATX' }
    ],
    'video-card': [
      { id: 4, category: 'video-card', brand: 'NVIDIA', name: 'NVIDIA RTX 4060', price: 9000 }
    ],
    memory: [
      { id: 5, category: 'memory', brand: 'Kingston', name: 'Kingston Fury 32GB DDR5', price: 2500, memoryType: 'DDR5', memoryGb: 32 }
    ],
    'internal-hard-drive': [
      { id: 6, category: 'internal-hard-drive', brand: 'Kingston', name: 'Kingston NV2 1TB SSD', price: 2000 }
    ],
    'power-supply': [
      { id: 7, category: 'power-supply', brand: 'Corsair', name: 'Corsair 550W 80+ Bronze', price: 1800, wattage: 550 }
    ],
    case: [
      { id: 8, category: 'case', brand: 'NZXT', name: 'NZXT H510', price: 2200, caseType: 'ATX Mid Tower', maxGpuLength: 400, maxCpuCoolerHeight: 200 }
    ],
    'cpu-cooler': [
      { id: 9, category: 'cpu-cooler', brand: 'Cooler Master', name: 'Generic Tower Cooler', price: 1200, coolerHeight: 155 }
    ]
  };
}

function createMockListProducts(catalog) {
  return async (filters) => {
    const products = catalog[filters.category] || [];

    if (filters.category === 'cpu' && filters.brand) {
      return products.filter((product) => product.brand === filters.brand);
    }

    return products;
  };
}

test('createBuildRecommendation still returns a complete, compatible, in-budget build with the K-NN + WSM pipeline', async () => {
  const catalog = createCatalog();
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 40000,
    cpuBrand: 'AMD',
    listProducts: createMockListProducts(catalog)
  });

  const categories = build.items.map((item) => item.category).sort();

  assert.deepEqual(categories, [
    'case', 'cpu', 'cpu-cooler', 'internal-hard-drive', 'memory',
    'motherboard', 'power-supply', 'video-card'
  ]);
  assert.ok(build.total <= build.budget, `total ${build.total} should not exceed budget ${build.budget}`);
  assert.notEqual(build.compatibility.status, 'fail');

  // The pricier CPU (12000) sits closer to the gaming-mode CPU price target
  // than the cheaper one (7000), so the WSM-scored platform pairing should
  // prefer it over the old "smallest absolute price gap wins" heuristic's
  // pick, which would have picked the same product here too - this mainly
  // guards that selectPlatform's rewritten scoring direction (higher is
  // better) didn't get inverted by accident.
  const selectedCpu = build.items.find((item) => item.category === 'cpu');
  assert.equal(selectedCpu.price, 12000);
});

test('createBuildRecommendation succeeds on a low budget instead of throwing "cannot build within budget"', async () => {
  // Regression test for the reported bug: budgets under ~40,000 could throw
  // even though a complete, cheaper build was assemblable from the catalog.
  // 30,000 sits just above this catalog's cheapest possible total (29,700
  // using the cheaper CPU), so this only succeeds if low-target categories
  // correctly prefer their affordable option instead of drifting over target.
  const catalog = createCatalog();
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 30000,
    cpuBrand: 'AMD',
    listProducts: createMockListProducts(catalog)
  });

  assert.ok(build.total <= build.budget, `total ${build.total} should not exceed budget ${build.budget}`);
  assert.notEqual(build.compatibility.status, 'fail');

  const selectedCpu = build.items.find((item) => item.category === 'cpu');
  assert.equal(selectedCpu.price, 7000, 'the cheaper CPU should be picked once the pricier one no longer fits the budget');
});

// ---- downgradeBuildToBudget (a category's unavoidable floor price overshoots its own target) ----
//
// Regression test for a real report: at budget 18,000 the automatic gaming
// build failed with "Cannot create a complete build within the selected
// budget" even though a complete, cheaper build (~16,900 baht, using the
// exact same catalog) had been successfully assembled and saved before.
// Cause: the catalog's cheapest video card (a GALAX RTX 3050 6GB EX at
// ~8,297 baht) sits far above its own gaming-mode target at that budget
// (~3,600 baht) - an overage that is unavoidable (nothing cheaper exists in
// that category) but was never subtracted from any other category's target.
// Every other category kept independently chasing its own (unreduced)
// target instead of preferring its cheapest option, so the whole build's
// total drifted past budget even though picking the cheapest compatible
// option in a lower-priority category (here, the CPU) would have kept it
// under budget.
test('createBuildRecommendation downgrades a category away from its own price target when another category\'s unavoidable floor price already overshoots its target and pushes the total past budget', async () => {
  const catalog = {
    cpu: [
      { id: 1, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 3 3200G', price: 2000 },
      // Sits much closer to the ~5,400 baht gaming-mode CPU target than the
      // cheaper CPU above, so WSM's price-fit score alone would prefer this
      // one - even though picking it is what pushes the total over budget.
      // (Same AM4 socket as the cheaper CPU and the only motherboard below,
      // so this stays a same-platform swap, not a socket mismatch.)
      { id: 2, category: 'cpu', brand: 'AMD', name: 'AMD Ryzen 5 5600', price: 5300 }
    ],
    motherboard: [
      { id: 3, category: 'motherboard', brand: 'ASUS', name: 'ASUS Prime A520M', price: 1200, socket: 'AM4', formFactor: 'Micro ATX' }
    ],
    'video-card': [
      // The catalog's cheapest possible GPU, already far above its own
      // ~3,600 baht target - an unavoidable floor overage, same shape as
      // the real GALAX RTX 3050 6GB EX @ ~8,297 baht.
      { id: 4, category: 'video-card', brand: 'NVIDIA', name: 'GALAX RTX 3050 6GB EX', price: 8300 }
    ],
    memory: [
      { id: 5, category: 'memory', brand: 'Kingston', name: 'Kingston 16GB DDR4', price: 1000, memoryType: 'DDR4', memoryGb: 16 }
    ],
    'internal-hard-drive': [
      { id: 6, category: 'internal-hard-drive', brand: 'Lexar', name: 'Lexar 240GB SSD', price: 600 }
    ],
    'power-supply': [
      { id: 7, category: 'power-supply', brand: 'Thermaltake', name: 'Thermaltake 550W', price: 1300, wattage: 550 }
    ],
    case: [
      { id: 8, category: 'case', brand: 'GameMax', name: 'GameMax Nova N5', price: 900, caseType: 'Micro ATX', maxGpuLength: 300, maxCpuCoolerHeight: 160 }
    ],
    'cpu-cooler': [
      { id: 9, category: 'cpu-cooler', brand: 'GameMax', name: 'GameMax Sigma 550', price: 800, coolerHeight: 120 }
    ]
  };

  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 18000,
    cpuBrand: 'AMD',
    listProducts: createMockListProducts(catalog)
  });

  assert.ok(build.total <= build.budget, `total ${build.total} should not exceed budget ${build.budget}`);
  assert.notEqual(build.compatibility.status, 'fail');

  const selectedCpu = build.items.find((item) => item.category === 'cpu');
  assert.equal(selectedCpu.price, 2000, 'should downgrade to the cheaper CPU once the pricier one (closer to its own target) pushes the total over budget because of the GPU\'s unavoidable floor overage');
});

// ---- spendRemainingBudget (auto-build should use up most of the budget) ----
//
// Regression coverage for a real complaint: upgradeBuildToBudget only swaps
// in a pricier candidate when it scores *better* under WSM (closer to that
// category's own price target), so once every category is at-or-near its
// target the loop stops - even when the categories' targets only add up to
// ~93% of the budget and the total sits far below the actual budget. Users
// expect a stated budget like 50,000 to come back close to fully spent (not
// exceeding it), not with 10,000+ left on the table. spendRemainingBudget is
// a second pass with a different goal: keep swapping in the single priciest
// still-affordable, still-compatible upgrade anywhere until the unspent
// remainder is within a few thousand baht of the budget, or nothing more
// fits.

function createSpendableCatalog() {
  const catalog = createCatalog();

  catalog.motherboard.push(
    { id: 30, category: 'motherboard', brand: 'ASUS', name: 'ASUS ROG Strix B650E', price: 6000, socket: 'AM5', formFactor: 'ATX' }
  );
  catalog['video-card'].push(
    { id: 31, category: 'video-card', brand: 'NVIDIA', name: 'NVIDIA RTX 4070', price: 14000 }
  );

  return catalog;
}

test('createBuildRecommendation spends down most of the budget instead of leaving a large chunk unused', async () => {
  const catalog = createSpendableCatalog();
  const build = await createBuildRecommendation({
    mode: 'gaming',
    budget: 45000,
    cpuBrand: 'AMD',
    listProducts: createMockListProducts(catalog)
  });

  assert.ok(build.total <= build.budget, `total ${build.total} should not exceed budget ${build.budget}`);
  assert.notEqual(build.compatibility.status, 'fail');

  // Without the fix, the initial per-category picks alone (cpu 12000 + the
  // cheapest compatible option everywhere else) total 34,700 and the
  // WSM-score-only upgrade loop can't improve on that here - remaining would
  // sit at 10,300. spendRemainingBudget should keep swapping in the priciest
  // still-affordable upgrade (the pricier motherboard, then the pricier GPU)
  // until nothing more fits within budget, landing on 41,700 and cutting the
  // unspent remainder to 3,300.
  assert.equal(build.total, 41700);
  assert.equal(build.remaining, 45000 - 41700);

  const motherboard = build.items.find((item) => item.category === 'motherboard');
  const videoCard = build.items.find((item) => item.category === 'video-card');

  assert.equal(motherboard.price, 6000, 'should have upgraded to the pricier motherboard to use up more of the budget');
  assert.equal(videoCard.price, 14000, 'should have upgraded to the pricier video card to use up more of the budget');
});

// ---- filterCompatibleProducts (manual-mode compatibility filtering) ----

test('filterCompatibleProducts filters motherboards down to the selected CPU\'s socket', () => {
  const cpu = { category: 'cpu', name: 'AMD Ryzen 7 7800X3D', price: 12000 };
  const am5Board = { category: 'motherboard', name: 'MSI B650', price: 5000, socket: 'AM5' };
  const am4Board = { category: 'motherboard', name: 'MSI B550', price: 3000, socket: 'AM4' };

  const result = filterCompatibleProducts('motherboard', [am5Board, am4Board], { cpu });

  assert.deepEqual(result, [am5Board]);
});

test('filterCompatibleProducts filters CPUs down to the selected motherboard\'s socket', () => {
  const motherboard = { category: 'motherboard', name: 'MSI B650', price: 5000, socket: 'AM5' };
  const am5Cpu = { category: 'cpu', name: 'AMD Ryzen 7 7800X3D', price: 12000 };
  const am4Cpu = { category: 'cpu', name: 'AMD Ryzen 5 5600X', price: 4000 };

  const result = filterCompatibleProducts('cpu', [am5Cpu, am4Cpu], { motherboard });

  assert.deepEqual(result, [am5Cpu]);
});

test('filterCompatibleProducts returns every candidate when nothing is selected yet', () => {
  const boards = [
    { category: 'motherboard', name: 'MSI B650', price: 5000, socket: 'AM5' },
    { category: 'motherboard', name: 'MSI B550', price: 3000, socket: 'AM4' }
  ];

  assert.deepEqual(filterCompatibleProducts('motherboard', boards, {}), boards);
});

test('filterCompatibleProducts falls back to the full list instead of returning an empty result when nothing matches', () => {
  const motherboard = { category: 'motherboard', name: 'MSI B650', price: 5000, socket: 'AM5' };
  const onlyAm4Cpus = [{ category: 'cpu', name: 'AMD Ryzen 5 5600X', price: 4000 }];

  const result = filterCompatibleProducts('cpu', onlyAm4Cpus, { motherboard });

  assert.deepEqual(result, onlyAm4Cpus);
});

test('filterCompatibleProducts filters video cards down to what the selected case has clearance for', () => {
  const selectedCase = { category: 'case', name: 'NZXT H510', price: 2500, maxGpuLength: 300 };
  const shortGpu = { category: 'video-card', name: 'RTX 4060', price: 12000, gpuLength: 245 };
  const longGpu = { category: 'video-card', name: 'RTX 4090', price: 55000, gpuLength: 340 };

  const result = filterCompatibleProducts('video-card', [shortGpu, longGpu], { case: selectedCase });

  assert.deepEqual(result, [shortGpu]);
});

test('filterCompatibleProducts leaves the video-card list untouched when no case is selected yet', () => {
  const gpus = [{ category: 'video-card', name: 'RTX 4090', price: 55000, gpuLength: 340 }];

  assert.deepEqual(filterCompatibleProducts('video-card', gpus, {}), gpus);
});

test('filterCompatibleProducts delegates memory/PSU/case/cpu-cooler to the same rule-based filters the automatic builder uses', () => {
  const motherboard = { category: 'motherboard', name: 'MSI B650', price: 5000, socket: 'AM5', memoryType: 'DDR5' };
  const ddr5Memory = { category: 'memory', name: 'Kingston Fury 32GB', price: 3000, memoryType: 'DDR5', memoryGb: 32 };
  const ddr4Memory = { category: 'memory', name: 'Kingston Fury 32GB', price: 2500, memoryType: 'DDR4', memoryGb: 32 };

  const result = filterCompatibleProducts('memory', [ddr5Memory, ddr4Memory], { motherboard });

  assert.deepEqual(result, [ddr5Memory]);
});
