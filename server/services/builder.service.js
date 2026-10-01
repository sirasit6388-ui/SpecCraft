import { listProducts } from './products.service.js';
import { calculateMonitorBudgetPlan } from './build-profiles.js';

const requiredCategories = [
  'cpu',
  'video-card',
  'motherboard',
  'memory',
  'internal-hard-drive',
  'power-supply',
  'case',
  'cpu-cooler'
];

// Some CPUs include a stock cooler, so a separate CPU cooler remains optional.
const requiredBuildCategories = requiredCategories.filter((category) => category !== 'cpu-cooler');

export function calculateBudgetPlan(mode = 'work', budget = 0) {
  const normalizedBudget = normalizeBudget(budget);
  const priorityBudget = Math.round(normalizedBudget * 0.5);
  const priorityParts = mode === 'gaming'
    ? {
        cpu: Math.round(priorityBudget * 0.6),
        gpu: Math.round(priorityBudget * 0.4)
      }
    : {
        cpu: Math.round(priorityBudget * 0.5),
        gpu: Math.round(priorityBudget * 0.5)
      };

  return {
    mode: mode === 'gaming' ? 'gaming' : 'work',
    budget: normalizedBudget,
    priorityParts
  };
}

// options: { mode, budget, cpuBrand, includeMonitor, listProducts }
//   includeMonitor: true = จัดสเปคพร้อมจอ ใช้สัดส่วนที่ย่อหมวดเดิมลงเพื่อเปิดที่ว่าง 8% ให้จอ (ดู build-profiles.js)
//   ถ้าจัดพร้อมจอไม่ได้ (ไม่มีจอที่เสนอได้ หรืองบไม่พอ) จะจัดใหม่แบบไม่รวมจอด้วยสัดส่วนเดิมแทน ไม่ล้มทั้งชุด
export async function createBuildRecommendation(options = {}) {
  const wantsMonitor = Boolean(options.includeMonitor);

  if (!wantsMonitor) {
    return buildRecommendationOnce(options, false);
  }

  let fallbackReason;

  try {
    return await buildRecommendationOnce(options, true);
  } catch (error) {
    fallbackReason = error.code === 'NO_MONITOR'
      ? 'ไม่มีจอที่เสนอได้ (ต้องมีของและราคาจริงจากร้าน)'
      : 'งบนี้ยังไม่พอจัดสเปคพร้อมจอ';
  }

  const fallback = await buildRecommendationOnce(options, false);
  fallback.monitorRequested = true;
  fallback.notices = [...(fallback.notices || []), { code: 'monitor-unavailable', message: `${fallbackReason} จึงจัดสเปคแบบไม่รวมจอให้แทน` }];

  return fallback;
}

async function buildRecommendationOnce(options, includeMonitor) {
  const plan = calculateBudgetPlan(options.mode, options.budget);

  if (includeMonitor) {
    plan.monitorTargets = calculateMonitorBudgetPlan(plan.mode, plan.budget).targets;
  }

  const cpuBrand = normalizeCpuBrand(options.cpuBrand);
  const getProducts = options.listProducts || listProducts;
  const candidatesByCategory = {};
  let items = [];

  for (const category of requiredCategories) {
    const filters = {
      category,
      limit: '1000'
    };

    if (category === 'cpu' && cpuBrand) {
      filters.brand = cpuBrand;
    }

    const products = await getProducts(filters);
    candidatesByCategory[category] = normalizeProducts(products);
  }

  if (includeMonitor) {
    const monitors = normalizeProducts(await getProducts({ category: 'monitor', limit: '1000' })).filter(isEligibleMonitor);

    if (!monitors.length) {
      const error = new Error('No eligible monitor available');
      error.code = 'NO_MONITOR';
      throw error;
    }

    candidatesByCategory.monitor = monitors;
  }

  const platform = selectPlatform(candidatesByCategory.cpu || [], candidatesByCategory.motherboard || [], plan);

  if (platform.cpu) {
    items.push(platform.cpu);
  }

  if (platform.motherboard) {
    items.push(platform.motherboard);
  }

  for (const category of requiredCategories) {
    if (category === 'cpu' || category === 'motherboard') {
      continue;
    }

    const selectedCpu = items.find((item) => item.category === 'cpu');
    const target = getCategoryTarget(category, plan);
    const selectedMotherboard = items.find((item) => item.category === 'motherboard');
    const selectedVideoCard = items.find((item) => item.category === 'video-card');
    const selectedCase = items.find((item) => item.category === 'case');
    const selectedCpuCooler = items.find((item) => item.category === 'cpu-cooler');
    const candidates = getCompatibleCandidates(category, candidatesByCategory[category], {
      motherboard: selectedMotherboard,
      cpu: selectedCpu,
      videoCard: selectedVideoCard,
      case: selectedCase,
      cpuCooler: selectedCpuCooler
    });
    const selected = selectBestProduct(candidates, target);

    if (selected) {
      items.push(selected);
    }
  }

  if (includeMonitor) {
    const monitorSelected = selectBestProduct(candidatesByCategory.monitor, getCategoryTarget('monitor', plan));

    if (monitorSelected) {
      items.push(monitorSelected);
    }
  }

  items = downgradeBuildToBudget(items, candidatesByCategory, plan);
  items = upgradeBuildToBudget(items, candidatesByCategory, plan);
  items = spendRemainingBudget(items, candidatesByCategory, plan, calculateTotal(items));
  const total = calculateTotal(items);
  const missingCategories = requiredBuildCategories.filter((category) => !items.some((item) => item.category === category));

  if (missingCategories.length) {
    throw new Error(`Cannot create a complete build. Missing: ${missingCategories.join(', ')}`);
  }

  if (total > plan.budget) {
    throw new Error('Cannot create a complete build within the selected budget');
  }

  const socket = inferCpuSocket(items.find((item) => item.category === 'cpu'));
  const motherboard = items.find((item) => item.category === 'motherboard');
  const selectedCase = items.find((item) => item.category === 'case');
  const selectedGpu = items.find((item) => item.category === 'video-card');
  const memoryType = inferMemoryType(motherboard);
  const motherboardFormFactor = inferMotherboardFormFactor(motherboard);
  const caseSupport = inferCaseSupport(selectedCase);
  const gpuLength = inferGpuLength(selectedGpu);
  const caseGpuClearance = inferCaseGpuClearance(selectedCase);
  const selectedCpuCooler = items.find((item) => item.category === 'cpu-cooler');
  const cpuCoolerHeight = inferCpuCoolerHeight(selectedCpuCooler);
  const caseCpuCoolerClearance = inferCaseCpuCoolerClearance(selectedCase);
  const requiredPsuWattage = calculateRequiredPsuWattage(items);
  const compatibility = createCompatibilityReport(items);

  if (compatibility.failures) {
    throw new Error('Cannot create a compatible build from the available products');
  }

  return {
    mode: plan.mode,
    budget: plan.budget,
    cpuBrand: cpuBrand || 'auto',
    socket,
    memoryType,
    motherboardFormFactor,
    caseSupport,
    gpuLength,
    caseGpuClearance,
    cpuCoolerHeight,
    caseCpuCoolerClearance,
    requiredPsuWattage,
    compatibility,
    total,
    remaining: plan.budget - total,
    monitorRequested: includeMonitor,
    monitorIncluded: items.some((item) => item.category === 'monitor'),
    notices: [],
    items
  };
}

export function createCompatibilityReport(items = []) {
  const selected = new Map(items.map((item) => [item.category, item]));
  const cpu = selected.get('cpu');
  const motherboard = selected.get('motherboard');
  const memory = selected.get('memory');
  const powerSupply = selected.get('power-supply');
  const selectedCase = selected.get('case');
  const cpuSocket = inferCpuSocket(cpu);
  const motherboardSocket = resolveMotherboardSocket(motherboard);
  const memoryType = inferMemoryType(memory);
  const motherboardMemoryType = inferMemoryType(motherboard);
  const requiredPsuWattage = calculateRequiredPsuWattage(items);
  const psuWattage = inferPsuWattage(powerSupply);
  const motherboardFormFactor = inferMotherboardFormFactor(motherboard);
  const caseSupport = inferCaseSupport(selectedCase);
  // ตัดการ์ด "Case clearance for the graphics card" และ "...CPU cooler" ออก
  // จากรายการที่แสดงบนหน้าเว็บตามที่ขอ (เหลือ 4 รายการ) - ฟังก์ชัน inferGpuLength/
  // inferCaseGpuClearance/inferCpuCoolerHeight/inferCaseCpuCoolerClearance ที่เคย
  // ใช้คำนวณ 2 การ์ดนี้ยังใช้งานอยู่ที่อื่นในไฟล์นี้ (ตอนกรองสินค้าที่เข้ากันได้ระหว่าง
  // จัดสเปคอัตโนมัติ) เลยไม่ได้ลบฟังก์ชันเหล่านั้น แค่ไม่เรียกใช้ในรายงานนี้แล้ว
  const checks = [
    createMatchCheck('cpu-motherboard', 'CPU and mainboard socket', cpuSocket, motherboardSocket),
    createMatchCheck('memory-mainboard', 'Memory and mainboard type', memoryType, motherboardMemoryType),
    createCapacityCheck('psu-capacity', 'Power supply capacity', psuWattage, requiredPsuWattage, 'W'),
    createCaseFormFactorCheck(motherboardFormFactor, caseSupport)
  ];
  const failures = checks.filter((check) => check.status === 'fail').length;
  const warnings = checks.filter((check) => check.status === 'warning').length;

  return {
    status: failures ? 'fail' : warnings ? 'warning' : 'pass',
    checks,
    failures,
    warnings,
    passes: checks.length - failures - warnings
  };
}

function createMatchCheck(id, label, actual, expected) {
  if (!actual || !expected) {
    return { id, label, status: 'warning', detail: 'Specification data is incomplete' };
  }

  return {
    id,
    label,
    status: actual === expected ? 'pass' : 'fail',
    detail: `${actual} / ${expected}`
  };
}

function createCapacityCheck(id, label, available, required, unit) {
  if (!available || !required) {
    return { id, label, status: 'warning', detail: 'Specification data is incomplete' };
  }

  return {
    id,
    label,
    status: available >= required ? 'pass' : 'fail',
    detail: `${available}${unit} / required ${required}${unit}`
  };
}

function createCaseFormFactorCheck(motherboardFormFactor, caseSupport) {
  if (!motherboardFormFactor || !caseSupport.length) {
    return { id: 'case-mainboard', label: 'Case and mainboard form factor', status: 'warning', detail: 'Specification data is incomplete' };
  }

  return {
    id: 'case-mainboard',
    label: 'Case and mainboard form factor',
    status: caseSupport.includes(motherboardFormFactor) ? 'pass' : 'fail',
    detail: `${motherboardFormFactor} / ${caseSupport.join(', ')}`
  };
}

// Budget allocation, as a share of the TOTAL budget:
//   cpu + video-card (the "priority" 50% from calculateBudgetPlan, split
//   60/40 or 50/50 by mode)                              = 50%
//   motherboard, memory, internal-hard-drive,
//   power-supply, case (STANDARD_CATEGORY_SHARE each)     = 8% x 5 = 40%
//   cpu-cooler (COOLER_SHARE)                              = 3%
//                                                    total = 93%
// Pre-existing bug fixed here: this used to be 10% x 5 + 4% = 54% for the
// non-priority categories, which together with the 50% priority share summed
// to 104% of the total budget - a category-target ceiling that literally
// cannot all be hit at once without exceeding the user's budget. At a low
// budget this showed up as "cannot create a complete build within the
// selected budget" even though a much cheaper compatible build existed,
// because both the initial per-category picks and the findBestUpgrade loop
// (see docs/wsm-knn-plan.md section 6.2) actively climb each category's
// price toward its own target. The 7% left over here is deliberate slack for
// findBestUpgrade to spend and for real-world price granularity, not just a
// rounding margin.
const STANDARD_CATEGORY_SHARE = 0.08;
const COOLER_SHARE = 0.03;

function getCategoryTarget(category, plan) {
  // โหมดรวมจอ: ใช้เป้าหมายที่ย่อสัดส่วนแล้วเปิดที่ว่าง 8% ให้จอ (ดู build-profiles.js) แทนสัดส่วนเดิมของทุกหมวด
  if (plan.monitorTargets) {
    return plan.monitorTargets[category] || 0;
  }

  if (category === 'cpu') {
    return plan.priorityParts.cpu;
  }

  if (category === 'video-card') {
    return plan.priorityParts.gpu;
  }

  if (category === 'cpu-cooler') {
    return Math.round(plan.budget * COOLER_SHARE);
  }

  return Math.round(plan.budget * STANDARD_CATEGORY_SHARE);
}

// ============ WSM (Weighted Sum Model) + K-NN candidate selection ============
// See docs/wsm-knn-plan.md for the full design write-up and formulas. Summary:
// K-NN narrows a category's compatible candidates down to the K products whose
// normalized (price, value-ratio) vector is closest to the category's target,
// then WSM scores just those K candidates on a weighted sum of "how close is
// the price to the target" (every category) and "spec-per-baht value" (only
// for categories where the database has a usable numeric spec: memory,
// storage, power supply) and returns the highest-scoring one.

const K_NEIGHBORS = 5;

const VALUE_SPEC_BY_CATEGORY = {
  memory: (product) => inferMemoryCapacity(product),
  'internal-hard-drive': (product) => inferStorageCapacity(product),
  'power-supply': (product) => inferPsuWattage(product)
};

const WSM_WEIGHTS_BY_CATEGORY = {
  memory: { price: 0.65, value: 0.35 },
  'internal-hard-drive': { price: 0.65, value: 0.35 },
  'power-supply': { price: 0.65, value: 0.35 }
};

const DEFAULT_WSM_WEIGHTS = { price: 1, value: 0 };

function getWsmWeights(category) {
  return WSM_WEIGHTS_BY_CATEGORY[category] || DEFAULT_WSM_WEIGHTS;
}

function getValueSpecFn(category) {
  return VALUE_SPEC_BY_CATEGORY[category] || null;
}

// Maps each product to a fn(product) -> [0, 1] scaled version of its raw
// values via min-max normalization. Falls back to a constant 1 when every
// candidate has the same value (or there is only one candidate), so a single
// remaining option is never penalized just for having nothing to compare to.
export function normalizeMinMax(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);

  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return () => 1;
  }

  return (value) => (value - min) / (max - min);
}

// fitScore(price, target) = max(0, 1 - |price - target| / target)
// 1.0 when price lands exactly on target, falling off linearly to 0 the
// further away it is (clamped so it never goes negative).
export function computeFitScore(price, target) {
  if (!target) {
    return 1;
  }

  return Math.max(0, 1 - Math.abs(Number(price) - target) / target);
}

// Spec-per-baht value ratio, min-max normalized across the candidate set.
// Returns a Map(product -> [0, 1] score); categories with no specFn (nothing
// meaningful to divide by price) get 0 for every product, so their WSM
// weight.value is always 0 too (see WSM_WEIGHTS_BY_CATEGORY) and this term
// drops out of the sum entirely.
export function computeValueScores(products, specFn) {
  if (!specFn || !products.length) {
    return new Map(products.map((product) => [product, 0]));
  }

  const rawValues = products.map((product) => {
    const spec = Number(specFn(product) || 0);
    const price = Number(product.price || 0);

    return price > 0 ? spec / price : 0;
  });
  const normalize = normalizeMinMax(rawValues);

  return new Map(products.map((product, index) => [product, normalize(rawValues[index])]));
}

// Score(p) = weights.price * fitScore(price, target) + weights.value * valueScore
export function scoreCandidate(product, target, valueScore, weights) {
  const fitScore = computeFitScore(product.price, target);

  return weights.price * fitScore + weights.value * valueScore;
}

// K-NN step: returns the K candidates (as { product, valueScore } pairs)
// whose normalized [price, value] vector is closest (weighted Euclidean
// distance) to the target query point [targetPriceNorm, 1] - "1" standing in
// for an idealized best-possible value ratio no real product quite reaches.
export function shortlistByKnn(products, target, options = {}) {
  if (!products.length) {
    return [];
  }

  const category = options.category || products[0]?.category;
  const weights = options.weights || getWsmWeights(category);
  const specFn = options.specFn !== undefined ? options.specFn : getValueSpecFn(category);
  const valueScores = computeValueScores(products, specFn);
  const priceValues = products.map((product) => Number(product.price || 0));
  const normalizePrice = normalizeMinMax(priceValues);
  const targetNorm = normalizePrice(Number(target || 0));

  const withDistance = products.map((product) => {
    const priceNorm = normalizePrice(Number(product.price || 0));
    const valueScore = valueScores.get(product) || 0;
    const priceTerm = weights.price * (priceNorm - targetNorm) ** 2;
    const valueTerm = weights.value * (valueScore - 1) ** 2;

    return { product, valueScore, distance: Math.sqrt(priceTerm + valueTerm) };
  });

  const k = Math.min(K_NEIGHBORS, withDistance.length);

  return withDistance
    .sort((first, second) => first.distance - second.distance)
    .slice(0, k);
}

// WSM step: scores the K-NN shortlist and returns the highest-scoring product.
export function selectByKnnWsm(products, target, options = {}) {
  if (!products.length) {
    return null;
  }

  const category = options.category || products[0]?.category;
  const weights = options.weights || getWsmWeights(category);
  // fitScore/distance treat "over target" and "under target" as equally bad
  // (symmetric), which is right for choosing among affordable options but
  // wrong as the very first filter: at a low budget, a category's target
  // share can sit below every real product's price, and without this guard
  // K-NN/WSM could pick an over-target product in several categories at
  // once, pushing the build's total past the user's budget even though a
  // cheaper (if imperfect) complete build was possible. Prefer candidates at
  // or under target when any exist - the same "affordable first" guarantee
  // the old heuristic had - and only let K-NN/WSM range over the full
  // (pricier) pool when nothing affordable is available.
  const affordable = target ? products.filter((product) => Number(product.price) <= target) : products;
  const pool = affordable.length ? affordable : products;
  const neighbors = shortlistByKnn(pool, target, { ...options, category, weights });
  const scored = neighbors
    .map(({ product, valueScore }) => ({ product, score: scoreCandidate(product, target, valueScore, weights) }))
    .sort((first, second) => second.score - first.score);

  return scored[0]?.product || pool[0] || products[0];
}

function selectBestProduct(products, target) {
  return selectByKnnWsm(products, target);
}

function selectPlatform(cpuCandidates, motherboardCandidates, plan) {
  const cpuTarget = getCategoryTarget('cpu', plan);
  const motherboardTarget = getCategoryTarget('motherboard', plan);
  const affordableMotherboardLimit = Math.max(motherboardTarget * 2, Math.round(plan.budget * 0.18));
  const filteredCpuCandidates = preferModernCpuCandidates(cpuCandidates);
  // Same "affordable first" guard as selectByKnnWsm (see its comment): at a
  // low budget the CPU target can sit below every real CPU's price, and
  // without this the pairing search below could still gravitate to an
  // over-target CPU, one of the ways a low budget could fail to produce a
  // build at all even though a cheaper complete build was possible.
  const affordableCpuCandidates = cpuTarget
    ? filteredCpuCandidates.filter((cpu) => Number(cpu.price) <= cpuTarget)
    : filteredCpuCandidates;
  const cpuPool = affordableCpuCandidates.length ? affordableCpuCandidates : filteredCpuCandidates;
  // K-NN narrows the CPU list to the candidates closest to the CPU price
  // target before the cpu x motherboard pairing search below, instead of
  // scoring every modern CPU against every compatible motherboard.
  const shortlistedCpus = shortlistByKnn(cpuPool, cpuTarget, { category: 'cpu' })
    .map((entry) => entry.product);
  const pairs = [];

  for (const cpu of shortlistedCpus) {
    const cpuSocket = inferCpuSocket(cpu);
    const compatibleMotherboards = filterMotherboardsBySocket(motherboardCandidates, cpuSocket)
      .filter((motherboard) => !cpuSocket || Number(motherboard.price) <= affordableMotherboardLimit);
    const motherboard = selectByKnnWsm(compatibleMotherboards, motherboardTarget, { category: 'motherboard' });

    if (!motherboard) {
      continue;
    }

    // WSM combined score - higher is better (replaces the old lower-is-better
    // absolute price-deviation sum).
    const score = scoreCandidate(cpu, cpuTarget, 0, getWsmWeights('cpu'))
      + scoreCandidate(motherboard, motherboardTarget, 0, getWsmWeights('motherboard'));

    pairs.push({ cpu, motherboard, socket: cpuSocket, score });
  }

  const selected = pairs.sort((first, second) => second.score - first.score)[0];

  if (selected) {
    return selected;
  }

  const cpu = selectBestProduct(filteredCpuCandidates, cpuTarget);

  return {
    cpu,
    motherboard: selectBestProduct(filterMotherboardsBySocket(motherboardCandidates, inferCpuSocket(cpu)), motherboardTarget)
  };
}

// ตรวจพบจากของจริง: ที่งบต่ำ (เช่น 18,000) การ์ดจอที่ถูกที่สุดในคลังทั้งหมดอาจมีราคา
// สูงกว่า "เป้าหมาย" ของหมวดนั้น (getCategoryTarget) มาก เช่น GALAX RTX 3050 6GB EX
// ~8,297 บาท ทั้งที่เป้าหมายของโหมด gaming ที่งบ 18,000 คือแค่ ~3,600 บาท ส่วนเกินนี้
// (~4,700 บาท) หลีกเลี่ยงไม่ได้เพราะไม่มีการ์ดจอราคาถูกกว่านี้ในคลังเลย แต่ระบบเดิมไม่ได้
// หักส่วนเกินนี้ออกจากงบของหมวดอื่น (มันเบอร์ด/แรม/สตอเรจ/PSU/เคส/คูลเลอร์) - แต่ละหมวด
// ยังคงพยายามเลือกของที่ใกล้ "เป้าหมายเดิม" ของตัวเอง (ซึ่งอาจไม่ใช่ตัวที่ถูกที่สุดในหมวดนั้น)
// พอบวกกับส่วนเกินของการ์ดจอที่หลีกเลี่ยงไม่ได้ ผลรวมทั้งบิลด์ก็ทะลุงบ ทั้งที่จริงๆ มีบิลด์ที่
// ถูกกว่าและยังอยู่ในงบประกอบได้จริง (เคยเจอเป็นการ์ดจอตัวเดียวกันที่ ~16,900 บาท ตอนงบ
// สูงกว่านี้) - อาการเดียวกับบั๊กเดิมที่แก้ไว้ใน STANDARD_CATEGORY_SHARE ด้านบน เพียงแต่
// คราวนี้ส่วนเกินมันมากกว่า 7% ของงบที่กันไว้เป็น slack เฉยๆ
//
// ฟังก์ชันนี้แก้โดยรันหลังการเลือกครั้งแรก (ก่อน upgradeBuildToBudget) ถ้าผลรวมยังเกินงบ
// อยู่ ให้ไล่ลดราคาไปทีละหมวดตามลำดับความสำคัญ (หมวดรองอย่างคูลเลอร์/เคสก่อน แล้วค่อยถึง
// มันเบอร์ด/แรม สุดท้ายค่อยถึง CPU และการ์ดจอซึ่งเป็นหัวใจของโหมดที่เลือก) โดยสลับไปใช้ตัวที่
// ถูกที่สุดที่ยังเข้ากันได้ในหมวดนั้น แล้ววนใหม่จนกว่าจะอยู่ในงบ หรือไม่เหลือของที่ถูกกว่าให้สลับแล้ว
// (กรณีหลังคือบิลด์นี้ประกอบไม่ได้จริงๆ ในงบที่เลือก - เช็ก total > plan.budget ท้ายฟังก์ชัน
// createBuildRecommendation จะโยน error ตามเดิม)
const DOWNGRADE_ORDER = [
  'monitor', 'cpu-cooler', 'case', 'power-supply', 'internal-hard-drive',
  'memory', 'motherboard', 'cpu', 'video-card'
];

function downgradeBuildToBudget(items, candidatesByCategory, plan) {
  let currentItems = [...items];
  let total = calculateTotal(currentItems);

  while (total > plan.budget) {
    const currentByCategory = new Map(currentItems.map((item) => [item.category, item]));
    let cheapestSwap = null;

    for (const category of DOWNGRADE_ORDER) {
      const currentItem = currentByCategory.get(category);

      if (!currentItem) {
        continue;
      }

      const categoryCandidates = candidatesByCategory[category] || [];
      const productCandidates = getUpgradeCandidates(category, categoryCandidates, currentByCategory);

      for (const product of productCandidates) {
        if (Number(product.price) >= Number(currentItem.price)) {
          continue;
        }

        if (!isCompatibleUpgrade(category, product, currentByCategory)) {
          continue;
        }

        if (!cheapestSwap || Number(product.price) < Number(cheapestSwap.product.price)) {
          cheapestSwap = { category, product };
        }
      }

      // เจอของถูกกว่าที่เข้ากันได้ในหมวดนี้แล้ว หยุดไล่หมวดถัดไปในรอบนี้ (ตาม
      // ลำดับความสำคัญ) แล้วนำไปใช้ทันที จากนั้นเริ่มไล่ตรวจใหม่ตั้งแต่ต้น -
      // อาจมีหมวดที่มีความสำคัญต่ำกว่าที่ยังลดราคาต่อได้อีกในรอบถัดไป
      if (cheapestSwap) {
        break;
      }
    }

    if (!cheapestSwap) {
      break;
    }

    const delta = Number(cheapestSwap.product.price) - Number(currentByCategory.get(cheapestSwap.category).price);
    currentItems = currentItems.map((item) => (
      item.category === cheapestSwap.category ? cheapestSwap.product : item
    ));
    total += delta;
  }

  return currentItems;
}

function upgradeBuildToBudget(items, candidatesByCategory, plan) {
  let currentItems = [...items];
  let currentTotal = calculateTotal(currentItems);
  let upgraded = true;

  while (upgraded) {
    upgraded = false;
    const bestUpgrade = findBestUpgrade(currentItems, candidatesByCategory, plan, currentTotal);

    if (bestUpgrade) {
      currentItems = currentItems.map((item) => (
        item.category === bestUpgrade.category ? bestUpgrade.product : item
      ));
      currentTotal += bestUpgrade.delta;
      upgraded = true;
    }
  }

  return currentItems;
}

// After upgradeBuildToBudget settles, every remaining candidate upgrade
// scores *lower* under WSM (fitScore is symmetric around each category's
// target - see the comment on selectByKnnWsm), so that loop stops well
// before the budget is used up: real inventory rarely lands exactly on the
// 93%-of-budget worth of per-category targets, and the gap compounds across
// 8 categories. Left alone this routinely parked 10%+ of the budget unspent
// even though pricier, still-affordable options existed - not what "จัด
// สเปคอัตโนมัติ" (auto-build) users expect from a stated budget.
//
// This pass has a different, simpler objective: keep swapping in the
// single priciest still-affordable upgrade available in any category (any
// candidate, not just ones that improve the target-fit score) until the
// unspent remainder is within MAX_BUDGET_SLACK baht of the budget, or no
// affordable upgrade is left. The hard ceiling never moves - every
// candidate here is still filtered by isCompatibleUpgrade and rejected the
// moment nextTotal would exceed the budget, exactly like findBestUpgrade.
const MAX_BUDGET_SLACK = 3000;

function spendRemainingBudget(items, candidatesByCategory, plan, currentTotal) {
  const spendOrder = ['video-card', 'cpu', 'motherboard', 'memory', 'power-supply', 'internal-hard-drive', 'case', 'cpu-cooler', 'monitor'];
  let currentItems = [...items];
  let total = currentTotal;

  while (plan.budget - total > MAX_BUDGET_SLACK) {
    const currentByCategory = new Map(currentItems.map((item) => [item.category, item]));
    let bestUpgrade = null;

    for (const category of spendOrder) {
      const currentItem = currentByCategory.get(category);

      if (!currentItem) {
        continue;
      }

      const categoryCandidates = candidatesByCategory[category] || [];
      const productCandidates = getUpgradeCandidates(category, categoryCandidates, currentByCategory);

      for (const product of productCandidates) {
        if (!isCompatibleUpgrade(category, product, currentByCategory)) {
          continue;
        }

        const delta = Number(product.price) - Number(currentItem.price);
        const nextTotal = total + delta;

        if (delta <= 0 || nextTotal > plan.budget) {
          continue;
        }

        if (!bestUpgrade || delta > bestUpgrade.delta) {
          bestUpgrade = { category, product, delta, nextTotal };
        }
      }
    }

    if (!bestUpgrade) {
      break;
    }

    currentItems = currentItems.map((item) => (
      item.category === bestUpgrade.category ? bestUpgrade.product : item
    ));
    total = bestUpgrade.nextTotal;
  }

  return currentItems;
}

function findBestUpgrade(items, candidatesByCategory, plan, currentTotal) {
  const upgradeOrder = ['cpu', 'video-card', 'motherboard', 'memory', 'internal-hard-drive', 'power-supply', 'case', 'cpu-cooler', 'monitor'];
  const currentByCategory = new Map(items.map((item) => [item.category, item]));
  const budget = plan.budget;
  const upgrades = [];

  for (const category of upgradeOrder) {
    const currentItem = currentByCategory.get(category);

    if (!currentItem) {
      continue;
    }

    // Re-uses the same WSM scoring as the initial selection, so "better" here
    // means "higher weighted score", not just "spends more of the budget" -
    // see docs/wsm-knn-plan.md section 6.2 for the rationale.
    const target = getCategoryTarget(category, plan);
    const weights = getWsmWeights(category);
    const categoryCandidates = candidatesByCategory[category] || [];
    const valueScores = computeValueScores(categoryCandidates, getValueSpecFn(category));
    const currentScore = scoreCandidate(currentItem, target, valueScores.get(currentItem) || 0, weights);
    const productCandidates = getUpgradeCandidates(category, categoryCandidates, currentByCategory);

    for (const product of productCandidates) {
      if (!isCompatibleUpgrade(category, product, currentByCategory)) {
        continue;
      }

      const delta = Number(product.price) - Number(currentItem.price);
      const nextTotal = currentTotal + delta;

      if (delta <= 0 || nextTotal > budget) {
        continue;
      }

      const productScore = scoreCandidate(product, target, valueScores.get(product) || 0, weights);
      const scoreGain = productScore - currentScore;

      if (scoreGain <= 0) {
        continue;
      }

      upgrades.push({
        category,
        product,
        delta,
        nextTotal,
        priority: upgradeOrder.indexOf(category),
        scoreGainPerBaht: scoreGain / delta
      });
    }
  }

  return upgrades.sort((first, second) => {
    const ratioDiff = second.scoreGainPerBaht - first.scoreGainPerBaht;

    if (ratioDiff !== 0) {
      return ratioDiff;
    }

    return first.priority - second.priority;
  })[0] || null;
}

function getUpgradeCandidates(category, products, currentByCategory) {
  if (category === 'cpu') {
    return preferModernCpuCandidates(products);
  }

  if (category === 'power-supply') {
    return filterPowerSuppliesByWattage(products, calculateRequiredPsuWattage([...currentByCategory.values()]));
  }

  if (category === 'memory') {
    return filterMemoryByType(products, inferMemoryType(currentByCategory.get('motherboard')));
  }

  if (category === 'case') {
    return filterCases(products, {
      motherboard: currentByCategory.get('motherboard'),
      videoCard: currentByCategory.get('video-card'),
      cpuCooler: currentByCategory.get('cpu-cooler')
    });
  }

  if (category === 'cpu-cooler') {
    return filterCpuCoolersByCase(products, currentByCategory.get('case'));
  }

  return products;
}

function isCompatibleUpgrade(category, product, currentByCategory) {
  const currentCpu = currentByCategory.get('cpu');
  const currentMotherboard = currentByCategory.get('motherboard');

  if (category === 'cpu') {
    const currentSocket = resolveMotherboardSocket(currentMotherboard);
    const nextSocket = inferCpuSocket(product);
    return !currentSocket || !nextSocket || currentSocket === nextSocket;
  }

  if (category === 'motherboard') {
    const cpuSocket = inferCpuSocket(currentCpu);
    return isMotherboardCompatible(product, cpuSocket);
  }

  if (category === 'memory') {
    const motherboardMemoryType = inferMemoryType(currentMotherboard);
    const currentCapacity = inferMemoryCapacity(currentByCategory.get('memory'));
    const nextCapacity = inferMemoryCapacity(product);

    if (currentCapacity >= 16 && nextCapacity < 16) {
      return false;
    }

    return isMemoryCompatible(product, motherboardMemoryType);
  }

  if (category === 'power-supply') {
    return isPsuCompatible(product, calculateRequiredPsuWattage([...currentByCategory.values()]));
  }

  if (category === 'case') {
    return isCaseCompatible(product, {
      motherboardFormFactor: inferMotherboardFormFactor(currentMotherboard),
      gpuLength: inferGpuLength(currentByCategory.get('video-card')),
      cpuCoolerHeight: inferCpuCoolerHeight(currentByCategory.get('cpu-cooler'))
    });
  }

  if (category === 'video-card') {
    return isGpuCompatibleWithCase(product, currentByCategory.get('case'));
  }

  if (category === 'cpu-cooler') {
    return isCpuCoolerCompatibleWithCase(product, currentByCategory.get('case'));
  }

  return true;
}

function isEligibleMonitor(monitor) {
  return monitor?.inStock !== false && monitor?.priceIsEstimate !== true;
}

function getCompatibleCandidates(category, products, selected) {
  if (category === 'memory') {
    return filterMemoryByType(products, inferMemoryType(selected.motherboard));
  }

  if (category === 'power-supply') {
    return filterPowerSuppliesByWattage(products, calculateRequiredPsuWattage([selected.cpu, selected.videoCard]));
  }

  if (category === 'case') {
    return filterCases(products, selected);
  }

  if (category === 'cpu-cooler') {
    return filterCpuCoolersByCase(products, selected.case);
  }

  return products;
}

// Manual-mode compatibility filtering. Reuses the exact same rule-based
// filters the automatic builder already applies when picking upgrade
// candidates (getCompatibleCandidates above, plus the CPU<->motherboard
// socket check normally handled inside selectPlatform) - this is a plain
// keep/reject filter, not WSM/K-NN scoring, since compatibility is a hard
// yes/no constraint rather than something to rank.
//
// `selected` uses the same shape as getCompatibleCandidates:
// { cpu, motherboard, videoCard, case, cpuCooler }, each a raw product
// object as returned by /api/products (only the categories the caller has
// actually picked need to be present). `category` is the category currently
// being browsed, i.e. the one `products` is a candidate list for.
export function filterCompatibleProducts(category, products, selected = {}) {
  if (!Array.isArray(products) || !products.length) {
    return products || [];
  }

  if (category === 'cpu') {
    // ตัด CPU รุ่นเก่ามาก (Pentium/Celeron/Xeon/Core 2/FX ฯลฯ) ออกจากตัวเลือกก่อนเสมอ
    // เพราะ inferCpuSocket() เดา socket ของตระกูลพวกนี้ไม่ได้ (คืนค่าว่าง) ถ้าไม่กรองออก
    // ตรงนี้ก่อน ตัวกรอง socket ด้านล่างจะมองว่า "ไม่รู้ socket = เข้ากันได้กับทุกบอร์ด"
    // แล้วปล่อยให้ CPU เก่าจับคู่กับเมนบอร์ดยุคใหม่ที่ใส่กันไม่ได้จริงๆ หลุดออกไปได้
    const modernCandidates = preferModernCpuCandidates(products);
    const motherboardSocket = resolveMotherboardSocket(selected.motherboard);

    if (!motherboardSocket) {
      return modernCandidates;
    }

    const compatible = modernCandidates.filter((product) => normalizeSocket(inferCpuSocket(product)) === motherboardSocket);

    return compatible.length ? compatible : modernCandidates;
  }

  if (category === 'motherboard') {
    return filterMotherboardsBySocket(products, inferCpuSocket(selected.cpu));
  }

  if (category === 'video-card') {
    if (!selected.case) {
      return products;
    }

    const compatible = products.filter((product) => isGpuCompatibleWithCase(product, selected.case));

    return compatible.length ? compatible : products;
  }

  return getCompatibleCandidates(category, products, selected);
}

function filterMotherboardsBySocket(products, cpuSocket) {
  const compatible = products.filter((product) => isMotherboardCompatible(product, cpuSocket));

  return compatible.length ? compatible : products;
}

function isMotherboardCompatible(product, cpuSocket) {
  if (!cpuSocket) {
    return true;
  }

  return resolveMotherboardSocket(product) === cpuSocket;
}

function filterMemoryByType(products, motherboardMemoryType) {
  const compatible = products.filter((product) => isMemoryCompatible(product, motherboardMemoryType));
  const enoughCapacity = compatible.filter((product) => inferMemoryCapacity(product) >= 16);

  if (enoughCapacity.length) {
    return enoughCapacity;
  }

  return compatible.length ? compatible : products;
}

function isMemoryCompatible(product, motherboardMemoryType) {
  if (!motherboardMemoryType) {
    return true;
  }

  return inferMemoryType(product) === motherboardMemoryType;
}

function filterPowerSuppliesByWattage(products, requiredWattage) {
  const compatible = products.filter((product) => isPsuCompatible(product, requiredWattage));
  const rightSized = compatible.filter((product) => inferPsuWattage(product) <= requiredWattage + 300);

  if (rightSized.length) {
    return rightSized;
  }

  return compatible.length ? compatible : products;
}

function isPsuCompatible(product, requiredWattage) {
  if (!requiredWattage) {
    return true;
  }

  return inferPsuWattage(product) >= requiredWattage;
}

function filterCases(products, selected) {
  const compatible = products.filter((product) => isCaseCompatible(product, {
    motherboardFormFactor: inferMotherboardFormFactor(selected.motherboard),
    gpuLength: inferGpuLength(selected.videoCard),
    cpuCoolerHeight: inferCpuCoolerHeight(selected.cpuCooler)
  }));

  return compatible.length ? compatible : products;
}

function isCaseCompatible(product, requirements = {}) {
  if (requirements.motherboardFormFactor) {
    const caseSupport = inferCaseSupport(product);

    if (caseSupport.length && !caseSupport.includes(requirements.motherboardFormFactor)) {
      return false;
    }
  }

  if (requirements.gpuLength) {
    const caseGpuClearance = inferCaseGpuClearance(product);

    if (caseGpuClearance && caseGpuClearance < requirements.gpuLength) {
      return false;
    }
  }

  if (requirements.cpuCoolerHeight) {
    const coolerClearance = inferCaseCpuCoolerClearance(product);

    if (coolerClearance && coolerClearance < requirements.cpuCoolerHeight) {
      return false;
    }
  }

  return true;
}

function isGpuCompatibleWithCase(gpu, selectedCase) {
  const gpuLength = inferGpuLength(gpu);
  const caseGpuClearance = inferCaseGpuClearance(selectedCase);

  return !gpuLength || !caseGpuClearance || gpuLength <= caseGpuClearance;
}

function filterCpuCoolersByCase(products, selectedCase) {
  const compatible = products.filter((product) => isCpuCoolerCompatibleWithCase(product, selectedCase));

  return compatible.length ? compatible : products;
}

function isCpuCoolerCompatibleWithCase(cpuCooler, selectedCase) {
  const cpuCoolerHeight = inferCpuCoolerHeight(cpuCooler);
  const caseCpuCoolerClearance = inferCaseCpuCoolerClearance(selectedCase);

  return !cpuCoolerHeight || !caseCpuCoolerClearance || cpuCoolerHeight <= caseCpuCoolerClearance;
}

function inferPsuWattage(product) {
  const directWattage = Number(product?.wattage || 0);

  if (directWattage > 0) {
    return directWattage;
  }

  const match = String(product?.name || '').match(/(\d{3,4})\s*W/i);

  return match ? Number(match[1]) : 0;
}

export function inferCpuSocket(cpu) {
  const name = String(cpu?.name || '').toUpperCase();

  if (!name) {
    return '';
  }

  if (name.includes('RYZEN')) {
    const model = Number(name.match(/RYZEN\s+\d\s+(\d{4})/)?.[1] || 0);

    if (model >= 7000) {
      return 'AM5';
    }

    if (model >= 1000) {
      return 'AM4';
    }
  }

  if (name.includes('AMD FX-')) {
    return 'AM3+';
  }

  if (name.includes('I7-6950X') || name.includes('I7-5960X') || name.includes('I7-5930K') || name.includes('I7-5820K')) {
    return 'LGA2011-3';
  }

  const intelModel = Number(name.match(/I[3579]-?(\d{4,5})/)?.[1] || 0);

  if (intelModel >= 12000 && intelModel < 15000) {
    return 'LGA1700';
  }

  if (intelModel >= 10000 && intelModel < 12000) {
    return 'LGA1200';
  }

  if (intelModel >= 8000 && intelModel < 10000) {
    return 'LGA1151';
  }

  return '';
}

// เดา socket ของเมนบอร์ดจากรหัสชิปเซ็ตในชื่อสินค้า ใช้เป็นตัวสำรองเวลาที่
// ข้อมูล specs.socket ในฐานข้อมูลของบอร์ดตัวนั้นไม่มี/ว่าง (เกิดขึ้นบ่อยกับ
// ข้อมูลที่ import มา) เพื่อให้การกรอง CPU ตามบอร์ดที่เลือกไว้ก่อนยังทำงานได้
export function inferMotherboardSocket(motherboard) {
  const name = String(motherboard?.name || '').toUpperCase();

  if (!name) {
    return '';
  }

  if (name.match(/\b(A620|B650|B840|B850|X670|X870)/)) {
    return 'AM5';
  }

  if (name.match(/\b(A320|A420|A520|B350|B450|B550|X370|X470|X570)/)) {
    return 'AM4';
  }

  if (name.includes('FM2')) {
    return 'FM2+';
  }

  if (name.match(/\b(Z790|B760|H770|W790|Z690|B660|H670|H610)/)) {
    return 'LGA1700';
  }

  if (name.match(/\b(Z590|B560|H570|H510|Z490|B460|H470|H410|W480)/)) {
    return 'LGA1200';
  }

  if (name.match(/\b(Z390|Z370|B365|B360|H370|H310)/)) {
    return 'LGA1151';
  }

  return '';
}

// รวม socket ของบอร์ดจากฟิลด์ในฐานข้อมูลก่อน ถ้าไม่มีค่อย fallback ไปเดาจากชื่อ
function resolveMotherboardSocket(motherboard) {
  return normalizeSocket(motherboard?.socket) || normalizeSocket(inferMotherboardSocket(motherboard));
}

export function isModernCpu(cpu) {
  const name = String(cpu?.name || '').toUpperCase();

  if (!name) {
    return false;
  }

  if (name.includes('FX-') || name.includes('OPTERON') || name.includes('PHENOM') || name.includes('ATHLON')) {
    return false;
  }

  if (name.includes('RYZEN')) {
    const model = Number(name.match(/RYZEN\s+\d\s+(\d{4})/)?.[1] || 0);
    return model >= 3000;
  }

  const intelModel = Number(name.match(/I[3579]-?(\d{4,5})/)?.[1] || 0);

  if (intelModel) {
    return intelModel >= 10000;
  }

  return false;
}

export function inferMemoryType(product) {
  const directType = normalizeMemoryType(product?.memoryType);

  if (directType) {
    return directType;
  }

  const name = String(product?.name || '').toUpperCase();
  const socket = resolveMotherboardSocket(product);

  if (name.includes('DDR5')) {
    return 'DDR5';
  }

  if (name.includes('DDR4')) {
    return 'DDR4';
  }

  if (socket === 'AM5') {
    return 'DDR5';
  }

  if (socket === 'AM4' || socket === 'LGA1200' || socket === 'LGA1151') {
    return 'DDR4';
  }

  if (socket === 'LGA1700') {
    return name.includes('DDR5') ? 'DDR5' : 'DDR4';
  }

  return '';
}

export function inferMotherboardFormFactor(product) {
  return normalizeFormFactor(product?.formFactor || product?.name);
}

export function inferCaseSupport(product) {
  const text = `${product?.caseType || ''} ${product?.name || ''}`.toUpperCase()
    .replace(/MICRO-ATX/g, 'MICROATX')
    .replace(/MINI-ITX/g, 'MINI ITX')
    .replace(/E-ATX/g, 'EATX');

  if (!text.trim()) {
    return [];
  }

  if (text.includes('EATX') || text.includes('FULL TOWER')) {
    return ['E-ATX', 'ATX', 'Micro ATX', 'Mini ITX'];
  }

  if (text.includes('MICROATX') || text.includes('MICRO ATX') || text.includes('M-ATX')) {
    return ['Micro ATX', 'Mini ITX'];
  }

  if (text.includes('MINI ITX')) {
    return ['Mini ITX'];
  }

  if (text.includes('ATX')) {
    return ['ATX', 'Micro ATX', 'Mini ITX'];
  }

  return [];
}

export function inferGpuLength(product) {
  const directLength = Number(product?.gpuLength || product?.length || 0);

  if (directLength > 0) {
    return directLength;
  }

  const name = String(product?.name || '').toUpperCase();

  if (name.includes('RTX 5090') || name.includes('RTX 4090')) return 340;
  if (name.includes('RTX 5080') || name.includes('RTX 4080') || name.includes('RX 7900')) return 320;
  if (name.includes('RTX 5070') || name.includes('RTX 4070') || name.includes('RX 9070')) return 300;
  if (name.includes('RTX 4060') || name.includes('RX 7600')) return 245;
  if (name.includes('RTX 3060')) return 235;

  return 0;
}

export function inferCaseGpuClearance(product) {
  const directLength = Number(product?.maxGpuLength || product?.caseMaxGpuLength || 0);

  if (directLength > 0) {
    return directLength;
  }

  const caseType = String(product?.caseType || product?.name || '').toUpperCase();
  const volume = Number(product?.externalVolume || 0);

  if (caseType.includes('MINI ITX')) {
    return 220;
  }

  if (caseType.includes('MICROATX') || caseType.includes('MICRO ATX')) {
    return volume >= 35 ? 300 : 280;
  }

  if (caseType.includes('ATX')) {
    if (volume >= 48) return 360;
    if (volume >= 40) return 330;
    return 300;
  }

  return 0;
}

export function inferCpuCoolerHeight(product) {
  const directHeight = Number(product?.coolerHeight || product?.height || 0);

  if (directHeight > 0) {
    return directHeight;
  }

  const radiatorSize = Number(product?.radiatorSize || product?.size || 0);
  const name = String(product?.name || '').toUpperCase();

  if (radiatorSize > 0 || name.includes('KRAKEN') || name.includes('LIQUID') || name.includes('AIO')) {
    return 0;
  }

  if (name.includes('NH-D15')) return 165;
  if (name.includes('FREEZER I35')) return 158;
  if (name.includes('HYPER 212')) return 159;
  if (name.includes('PEERLESS ASSASSIN')) return 155;
  if (name.includes('PHANTOM SPIRIT')) return 154;
  if (name.includes('ASSASSIN X 120')) return 148;

  return 0;
}

export function inferCaseCpuCoolerClearance(product) {
  const directHeight = Number(product?.maxCpuCoolerHeight || product?.caseMaxCpuCoolerHeight || 0);

  if (directHeight > 0) {
    return directHeight;
  }

  const caseType = String(product?.caseType || product?.name || '').toUpperCase();
  const volume = Number(product?.externalVolume || 0);

  if (caseType.includes('MINI ITX')) {
    return 70;
  }

  if (caseType.includes('MICROATX') || caseType.includes('MICRO ATX')) {
    return volume >= 35 ? 160 : 155;
  }

  if (caseType.includes('ATX')) {
    if (volume >= 48) return 170;
    if (volume >= 40) return 165;
    return 160;
  }

  return 0;
}

export function calculateRequiredPsuWattage(items) {
  const draw = items.reduce((sum, item) => sum + inferPowerDraw(item), 0);

  if (!draw) {
    return 0;
  }

  return Math.ceil((draw + 100) * 1.25 / 50) * 50;
}

export function inferPowerDraw(product) {
  const category = product?.category;

  if (category === 'cpu') {
    return Number(product.tdp || 0) || inferCpuPowerDraw(product);
  }

  if (category === 'video-card') {
    return Number(product.tdp || 0) || inferGpuPowerDraw(product);
  }

  return 0;
}

function inferCpuPowerDraw(product) {
  const name = String(product?.name || '').toUpperCase();

  if (name.includes('X3D')) {
    return 120;
  }

  if (name.includes(' RYZEN 9 ') || name.includes('I9-')) {
    return 170;
  }

  if (name.includes(' RYZEN 7 ') || name.includes('I7-')) {
    return 105;
  }

  return 65;
}

function inferGpuPowerDraw(product) {
  const name = String(product?.name || '').toUpperCase();

  if (name.includes('RTX 5090')) return 575;
  if (name.includes('RTX 5080')) return 360;
  if (name.includes('RTX 5070 TI')) return 300;
  if (name.includes('RTX 5070')) return 250;
  if (name.includes('RTX 4090')) return 450;
  if (name.includes('RTX 4080')) return 320;
  if (name.includes('RTX 4070')) return 220;
  if (name.includes('RTX 4060')) return 120;
  if (name.includes('RTX 3060')) return 170;
  if (name.includes('RX 9070 XT')) return 304;
  if (name.includes('RX 9070')) return 220;
  if (name.includes('RX 7900')) return 355;
  if (name.includes('RX 7800')) return 263;
  if (name.includes('RX 7700')) return 245;
  if (name.includes('RX 7600')) return 165;
  if (name.includes('RX 580')) return 185;
  if (name.includes('ARC A380')) return 75;

  return 180;
}

function inferMemoryCapacity(product) {
  const directCapacity = Number(product?.memoryGb || 0);

  if (directCapacity > 0) {
    return directCapacity;
  }

  const match = String(product?.name || '').match(/(\d+)\s*GB/i);

  return match ? Number(match[1]) : 0;
}

// Storage capacity in GB, inferred from the product name since the database
// has no dedicated capacity column for internal-hard-drive products (unlike
// memoryGb for memory). Used as the "value" criterion (GB per baht) for the
// WSM scoring of that category - see docs/wsm-knn-plan.md section 6.1.
export function inferStorageCapacity(product) {
  const name = String(product?.name || '');
  const terabyteMatch = name.match(/(\d+(?:\.\d+)?)\s*TB/i);

  if (terabyteMatch) {
    return Number(terabyteMatch[1]) * 1000;
  }

  const gigabyteMatch = name.match(/(\d+)\s*GB/i);

  return gigabyteMatch ? Number(gigabyteMatch[1]) : 0;
}

// เกณฑ์ขั้นต่ำที่ระบบยอมเสนอ: ฝั่ง Intel ต้องเป็น Core i3 ขึ้นไป (i3/i5/i7/i9/Core Ultra)
// ฝั่ง AMD ต้องเป็น Ryzen 3 ขึ้นไป (Ryzen 3/5/7/9/Threadripper/Ryzen AI) รุ่นต่ำกว่านี้
// เช่น Pentium, Celeron, Xeon, Core 2/Duo (Intel) หรือ Athlon, Sempron, Phenom,
// Opteron, FX-, A-series/E-series APU (AMD) จะไม่ถูกเสนอเลย ไม่ว่าจะเข้ากับเมนบอร์ด
// ที่เลือกไว้ได้หรือไม่ก็ตาม (ต่างจาก isModernCpu ด้านบนซึ่งเป็นแค่ "ตัวเลือกที่ดีกว่า
// เมื่อมีของให้เลือก" ไม่ใช่เกณฑ์ตัดสิทธิ์แบบนี้)
export function isEligibleCpuTier(cpu) {
  const name = String(cpu?.name || '').toUpperCase();

  if (!name) {
    return false;
  }

  // เช็ค Threadripper/Ryzen AI แยกจากเงื่อนไข RYZEN ด้านล่าง เพราะบางชื่อสินค้า
  // (เช่น "AMD Threadripper 3960X") ไม่มีคำว่า "Ryzen" ปนอยู่เลย
  if (name.includes('THREADRIPPER') || name.includes('RYZEN AI')) {
    return true;
  }

  if (name.includes('RYZEN')) {
    return /RYZEN\s*[3579]\b/.test(name);
  }

  if (name.includes('CORE ULTRA')) {
    return true;
  }

  return /\bI[3579]-?\d{3,5}/.test(name);
}

function preferModernCpuCandidates(products) {
  const eligibleProducts = products.filter(isEligibleCpuTier);
  // เหมือนตัวกรองอื่นๆ ในไฟล์นี้ (socket, memory type, gpu clearance ฯลฯ): ถ้ากรองแล้ว
  // ไม่เหลืออะไรเลย (เช่น ข้อมูลทดสอบ/ข้อมูลจริงที่ตั้งชื่อไม่ตรงรูปแบบที่รู้จักเลยสักตัว)
  // ให้ fallback กลับไปใช้ผลลัพธ์ก่อนกรอง แทนที่จะทำให้ทั้งบิลด์สร้างไม่ได้เพราะหา CPU
  // ไม่เจอเลยสักตัว ในทางปฏิบัติ กรณีนี้แทบไม่เกิดกับข้อมูลจริงเพราะแคตตาล็อกมี
  // Ryzen 3+/Core i3+ อยู่เสมอหลังลบของเก่าออกแล้ว
  const tierPool = eligibleProducts.length ? eligibleProducts : products;
  const modernProducts = tierPool.filter(isModernCpu);

  return modernProducts.length ? modernProducts : tierPool;
}

function normalizeSocket(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeMemoryType(value) {
  const type = String(value || '').trim().toUpperCase().replace(/\s+/g, '');

  if (type === 'DDR5') {
    return 'DDR5';
  }

  if (type === 'DDR4') {
    return 'DDR4';
  }

  return '';
}

function normalizeFormFactor(value) {
  const formFactor = String(value || '').trim().toUpperCase()
    .replace(/MICRO-ATX/g, 'MICROATX')
    .replace(/MINI-ITX/g, 'MINI ITX')
    .replace(/E-ATX/g, 'EATX');

  if (formFactor.includes('EATX')) {
    return 'E-ATX';
  }

  if (formFactor.includes('MICROATX') || formFactor.includes('MICRO ATX') || formFactor.includes('M-ATX')) {
    return 'Micro ATX';
  }

  if (formFactor.includes('MINI ITX')) {
    return 'Mini ITX';
  }

  if (formFactor.includes('ATX')) {
    return 'ATX';
  }

  return '';
}

function normalizeProducts(productResult) {
  const products = Array.isArray(productResult)
    ? productResult
    : Array.isArray(productResult?.products)
      ? productResult.products
      : [];

  return products
    .filter((product) => Number(product.price || 0) > 0)
    .sort((first, second) => Number(first.price) - Number(second.price));
}

function calculateTotal(items) {
  return items.reduce((sum, item) => sum + Number(item.price || 0), 0);
}

function normalizeBudget(value) {
  const budget = Number(value || 0);

  if (!Number.isFinite(budget) || budget < 0) {
    return 0;
  }

  return Math.round(budget);
}

function normalizeCpuBrand(value) {
  const brand = String(value || '').trim().toUpperCase();

  if (brand === 'AMD') {
    return 'AMD';
  }

  if (brand === 'INTEL') {
    return 'Intel';
  }

  return '';
}
