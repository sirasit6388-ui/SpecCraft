import { addCartItem, calculateCartTotal, createSavedBuild, expandCartItemsForApi, getCartItemByCategory, hydrateCartItems, MAX_CART_ITEM_QUANTITY, mergeDuplicateCartItems, removeCartItem, setCartItemQuantity } from './scripts/build-cart.js';
import { createSavedBuildPrintDocument, createSavedBuildSummary } from './scripts/build-summary.js';
import { createEmptyState, createLoadingState } from './scripts/ui-state.js';

const state = {
  category: '',
  search: '',
  filters: {
    brand: '',
    series: '',
    socket: '',
    minRefreshRate: '',
    screenSize: '',
    resolution: '',
    panelType: ''
  },
  cartItems: hydrateCartItems(localStorage.getItem('pc-build-cart')),
  categoryCounts: new Map(),
  productsByKey: new Map(),
  page: 1,
  pageSize: 24,
  totalProducts: 0,
  adminProductsById: new Map(),
  adminSearch: '',
  adminCategory: '',
  adminPage: 1,
  adminPageSize: 50,
  adminTotalProducts: 0,
  adminUsersSearch: '',
  adminUsersPage: 1,
  adminUsersPageSize: 10,
  adminUsersTotal: 0,
  adminAuditSearch: '',
  adminAuditPage: 1,
  adminAuditPageSize: 15,
  adminAuditTotal: 0,
  adminPendingImageUrl: '',
  savedBuildsById: new Map(),
  savedBuildPage: 1,
  savedBuildPageSize: 10,
  savedBuildTotal: 0,
  galleryPage: 1,
  galleryPageSize: 12,
  galleryTotal: 0,
  selectedSavedBuildId: '',
  currentBuild: null,
  // ติ๊ก "ลงคลังสาธารณะ" ไว้ก่อนกด "บันทึกสเปค" ครั้งแรก (ตอนที่ยังไม่มี build
  // ในฐานข้อมูลเลย เช็คบ็อกซ์เลยยังเรียก API ทันทีไม่ได้) - เก็บไว้ที่นี่ก่อน แล้ว
  // persistCartAsBuild() จะลงคลังให้อัตโนมัติทันทีที่บันทึกเสร็จ (ดูที่นั่น)
  pendingListed: false,
  view: 'products',
  authMode: 'login',
  user: null
};

const workspaceEl = document.querySelector('[data-workspace]');
const builderToggleButton = document.querySelector('[data-builder-toggle]');
const builderCloseButton = document.querySelector('[data-builder-close]');
const heroAutoBuildButton = document.querySelector('[data-hero-auto-build]');
const heroBrowseButton = document.querySelector('[data-hero-browse]');
const heroProductCountEl = document.querySelector('[data-hero-product-count]');
const viewLinks = document.querySelectorAll('[data-view-link]');
const profileViewLink = document.querySelector('[data-profile-link]');
const adminDashboardViewLink = document.querySelector('[data-admin-dashboard-link]');
const adminViewLink = document.querySelector('[data-admin-link]');
const adminUsersViewLink = document.querySelector('[data-admin-users-link]');
const adminAuditViewLink = document.querySelector('[data-admin-audit-link]');
const viewPanels = document.querySelectorAll('[data-view-panel]');
const manualCategoriesEl = document.querySelector('[data-manual-categories]');
const manualTotalEl = document.querySelector('[data-manual-total]');
const manualTotalValueEl = document.querySelector('[data-manual-total-value]');
const manualShareEl = document.querySelector('[data-manual-share]');
const saveBuildListedEl = document.querySelector('[data-save-build-listed]');
const productsEl = document.querySelector('[data-products]');
const paginationEl = document.querySelector('[data-pagination]');
const dbStatusEl = document.querySelector('[data-db-status]');
const productCountEl = document.querySelector('[data-product-count]');
const currentCategoryEl = document.querySelector('[data-current-category]');
const currentCategoryCountEl = document.querySelector('[data-current-category-count]');
const searchForm = document.querySelector('[data-search-form]');
const filterForm = document.querySelector('[data-filter-form]');
const brandFilterEl = document.querySelector('[data-filter-brand]');
const seriesFilterEl = document.querySelector('[data-filter-series]');
const socketFilterEl = document.querySelector('[data-filter-socket]');
const monitorFilterEls = [
  document.querySelector('[data-filter-refresh-rate]'),
  document.querySelector('[data-filter-screen-size]'),
  document.querySelector('[data-filter-resolution]'),
  document.querySelector('[data-filter-panel-type]')
].filter(Boolean);
const MONITOR_FILTER_KEYS = ['minRefreshRate', 'screenSize', 'resolution', 'panelType'];

function createEmptyFilters() {
  return { brand: '', series: '', socket: '', minRefreshRate: '', screenSize: '', resolution: '', panelType: '' };
}
const buildForm = document.querySelector('[data-build-form]');
const buildResultEl = document.querySelector('[data-build-result]');
const savedBuildResultEl = document.querySelector('[data-saved-build-result]');
const cartItemsEl = document.querySelector('[data-cart-items]');
const cartTotalEl = document.querySelector('[data-cart-total]');
const cartStatusEl = document.querySelector('[data-cart-status]');
const cartClearButton = document.querySelector('[data-cart-clear]');
const cartSaveButton = document.querySelector('[data-cart-save]');
const saveBuildButtons = document.querySelectorAll('[data-save-build]');
// สองปุ่ม: ปุ่มข้อความในกล่อง save-build-panel เดิม + ปุ่มไอคอนเล็กมุมขวาบนของ
// "จัดสเปคเอง" (ทางลัดเข้าถึงง่ายโดยไม่ต้องเลื่อนลงไปด้านล่าง) ทั้งคู่ทำหน้าที่
// เดียวกันเป๊ะ ๆ จึงใช้ data-reset-build ร่วมกันแบบเดียวกับ saveBuildButtons ด้านบน
const resetBuildButtons = document.querySelectorAll('[data-reset-build]');
const saveBuildStatusEl = document.querySelector('[data-save-build-status]');
const historyPanelEl = document.querySelector('[data-history-panel]');
const savedBuildListEl = document.querySelector('[data-saved-build-list]');
const savedBuildDetailEl = document.querySelector('[data-saved-build-detail]');
const savedBuildPaginationEl = document.querySelector('[data-saved-build-pagination]');
const publicBuildEl = document.querySelector('[data-public-build]');
const galleryPanelEl = document.querySelector('[data-gallery-panel]');
const galleryListEl = document.querySelector('[data-gallery-list]');
const galleryPaginationEl = document.querySelector('[data-gallery-pagination]');
const adminPanelEl = document.querySelector('[data-admin-panel]');
const adminProductsEl = document.querySelector('[data-admin-products]');
const adminPaginationEl = document.querySelector('[data-admin-pagination]');
const adminStatusEl = document.querySelector('[data-admin-status]');
const adminSearchForm = document.querySelector('[data-admin-search-form]');
const adminCategoryFilterEl = document.querySelector('[data-admin-category-filter]');
const adminNewButton = document.querySelector('[data-admin-new]');
const adminEditorEl = document.querySelector('[data-admin-editor]');
const adminEditorTitleEl = document.querySelector('[data-admin-editor-title]');
const adminForm = document.querySelector('[data-admin-form]');
const adminImageFileEl = document.querySelector('[data-admin-image-file]');
const adminImageStatusEl = document.querySelector('[data-admin-image-status]');
const adminImagePreviewEl = document.querySelector('[data-admin-image-preview]');
const adminCategorySelectEl = document.querySelector('[data-admin-category-select]');
const adminCategoryOtherWrapEl = document.querySelector('[data-admin-category-other-wrap]');
const adminCategoryOtherInputEl = document.querySelector('[data-admin-category-other]');
const adminSpecFieldsEl = document.querySelector('[data-admin-spec-fields]');
const adminSpecsJsonWrapEl = document.querySelector('[data-admin-specs-json-wrap]');
const adminDashboardPanelEl = document.querySelector('[data-admin-dashboard-panel]');
const adminDashboardEl = document.querySelector('[data-admin-dashboard]');
const adminUsersPanelEl = document.querySelector('[data-admin-users-panel]');
const adminUsersEl = document.querySelector('[data-admin-users]');
const adminUsersStatusEl = document.querySelector('[data-admin-users-status]');
const adminUsersSearchForm = document.querySelector('[data-admin-users-search-form]');
const adminUsersPaginationEl = document.querySelector('[data-admin-users-pagination]');
const adminAuditPanelEl = document.querySelector('[data-admin-audit-panel]');
const adminAuditEl = document.querySelector('[data-admin-audit]');
const adminAuditStatusEl = document.querySelector('[data-admin-audit-status]');
const adminAuditSearchForm = document.querySelector('[data-admin-audit-search-form]');
const adminAuditPaginationEl = document.querySelector('[data-admin-audit-pagination]');
const profilePanelEl = document.querySelector('[data-profile-panel]');
const profileUsernameEl = document.querySelector('[data-profile-username]');
const changePasswordForm = document.querySelector('[data-change-password-form]');
const changePasswordStatusEl = document.querySelector('[data-change-password-status]');
const authOpenButton = document.querySelector('[data-auth-open]');
const authModalEl = document.querySelector('[data-auth-modal]');
const authCloseButton = document.querySelector('[data-auth-close]');
const authModeButtons = document.querySelectorAll('[data-auth-mode]');
const authForm = document.querySelector('[data-auth-form]');
const authSubmitButton = document.querySelector('[data-auth-submit]');
const authRegisterOnlyEls = document.querySelectorAll('[data-auth-register-only]');
const authModalStatusEl = document.querySelector('[data-auth-modal-status]');
const confirmModalEl = document.querySelector('[data-confirm-modal]');
const confirmMessageEl = document.querySelector('[data-confirm-message]');
const confirmOkButton = document.querySelector('[data-confirm-ok]');
const confirmCancelButton = document.querySelector('[data-confirm-cancel]');
let resolveConfirmDialog = null;
const productDetailModalEl = document.querySelector('[data-product-detail-modal]');
const productDetailCloseButton = document.querySelector('[data-product-detail-close]');
const productDetailMediaEl = document.querySelector('[data-product-detail-media]');
const productDetailTagsEl = document.querySelector('[data-product-detail-tags]');
const productDetailNameEl = document.querySelector('[data-product-detail-name]');
const productDetailPriceEl = document.querySelector('[data-product-detail-price]');
const productDetailSpecsEl = document.querySelector('[data-product-detail-specs]');
const productDetailNoteEl = document.querySelector('[data-product-detail-note]');

const categoryLabels = {
  cpu: 'CPU',
  motherboard: 'Mainboard',
  'video-card': 'Graphic Card',
  memory: 'Memory',
  storage: 'Storage',
  'internal-hard-drive': 'Storage',
  'power-supply': 'Power Supply',
  case: 'Case',
  'cpu-cooler': 'CPU Cooler',
  monitor: 'Monitor'
};

const manualCategoryOrder = [
  'cpu',
  'motherboard',
  'video-card',
  'memory',
  'internal-hard-drive',
  'power-supply',
  'case',
  'cpu-cooler',
  'monitor'
];

// หมวดที่เป็นตัวเลือกเสริม: แสดงในรายการ "จัดสเปคเอง" เฉพาะเมื่อมีสินค้าในฐานข้อมูลจริง
// (หรือมีชิ้นที่เลือกไว้ในสเปคอยู่แล้ว) กันไม่ให้ผู้ใช้กดเข้าไปเจอหมวดว่างเปล่า
const optionalManualCategories = new Set(['monitor']);

// เรียงรายการของสเปคที่บันทึกไว้ตามลำดับหมวดหมู่ที่อ่านง่าย (เหมือนใน "จัดสเปคเอง")
// แทนที่จะใช้ลำดับดิบจากฐานข้อมูล (build_items.id) ซึ่งเรียงตามลำดับที่เพิ่ม/แก้ใน
// ตะกร้าล่าสุด - ไม่งั้นถ้าเปลี่ยน CPU ทีหลัง (ลบของเก่า+เพิ่มของใหม่) CPU จะไปโผล่
// ท้ายตารางแทนที่จะอยู่บนสุดตามที่ควรจะเป็น ใช้กับทั้งหน้าประวัติและหน้าลิงก์แชร์
function sortItemsByCategoryOrder(items) {
  return [...items].sort((a, b) => {
    const indexA = manualCategoryOrder.indexOf(a.category);
    const indexB = manualCategoryOrder.indexOf(b.category);

    return (indexA === -1 ? manualCategoryOrder.length : indexA) - (indexB === -1 ? manualCategoryOrder.length : indexB);
  });
}

// Per-category "รายละเอียด JSON" replacement for the admin product editor.
// Each entry is {key, label, type, ...}. `key` is the specs JSON key this
// field reads/writes - fields marked compat below are read directly by
// products.service.js / the auto-build compatibility engine, so their key
// names must stay exactly as-is. memory's "speed"/"modules" specs keys are
// each a 2-item array rather than a scalar, so they get two virtual fields
// (handled specially in collectAdminSpecFields/populateAdminSpecFields
// rather than through the generic key loop).
const adminSpecFieldSchemas = {
  cpu: [
    { key: 'socket', label: 'ซ็อกเก็ต', type: 'text', placeholder: 'เช่น AM5, LGA1700' },
    { key: 'tdp', label: 'TDP (วัตต์)', type: 'number' },
    { key: 'core_count', label: 'จำนวนคอร์', type: 'number' },
    { key: 'core_clock', label: 'ความเร็วสัญญาณนาฬิกา (GHz)', type: 'number', step: '0.01' },
    { key: 'boost_clock', label: 'บูสต์คล็อก (GHz)', type: 'number', step: '0.01' },
    { key: 'integrated_graphics', label: 'การ์ดจอในตัว', type: 'text', placeholder: 'เว้นว่างถ้าไม่มี' }
  ],
  motherboard: [
    { key: 'socket', label: 'ซ็อกเก็ต', type: 'text', placeholder: 'เช่น AM5, LGA1700' },
    { key: 'form_factor', label: 'ฟอร์มแฟกเตอร์', type: 'select', options: ['ATX', 'Micro ATX', 'Mini ITX', 'EATX'] },
    { key: 'chipset', label: 'ชิปเซ็ต', type: 'text' }
  ],
  'video-card': [
    { key: 'chipset', label: 'ชิปเซ็ต', type: 'text', placeholder: 'เช่น GeForce RTX 4070' },
    { key: 'memory', label: 'หน่วยความจำ (GB)', type: 'number' },
    { key: 'length', label: 'ความยาวการ์ด (มม.)', type: 'number' },
    { key: 'core_clock', label: 'คล็อก (MHz)', type: 'number' },
    { key: 'boost_clock', label: 'บูสต์คล็อก (MHz)', type: 'number' },
    { key: 'color', label: 'สี', type: 'text' }
  ],
  memory: [
    { key: 'speed_gen', label: 'รุ่น', type: 'select', options: ['DDR4', 'DDR5'], virtual: true },
    { key: 'speed_mhz', label: 'ความเร็ว (MT/s)', type: 'number', virtual: true },
    { key: 'modules_count', label: 'จำนวนแถว', type: 'number', virtual: true },
    { key: 'modules_size', label: 'ขนาดต่อแถว (GB)', type: 'number', virtual: true },
    { key: 'color', label: 'สี', type: 'text' }
  ],
  'internal-hard-drive': [
    { key: 'capacity', label: 'ความจุ (GB)', type: 'number' },
    { key: 'type', label: 'ประเภท', type: 'select', options: ['SSD', 'HDD'] },
    { key: 'interface', label: 'อินเทอร์เฟซ', type: 'text', placeholder: 'เช่น NVMe, SATA' }
  ],
  'power-supply': [
    { key: 'wattage', label: 'กำลังไฟ (วัตต์)', type: 'number' },
    { key: 'form_factor', label: 'ฟอร์มแฟกเตอร์', type: 'select', options: ['ATX', 'SFX', 'SFX-L'] },
    { key: 'efficiency_rating', label: 'มาตรฐานประหยัดไฟ', type: 'text', placeholder: 'เช่น 80+ Gold' }
  ],
  case: [
    { key: 'type', label: 'รองรับฟอร์มแฟกเตอร์เมนบอร์ดสูงสุด', type: 'select', options: ['ATX', 'Micro ATX', 'Mini ITX'] },
    { key: 'max_video_card_length', label: 'ความยาวการ์ดจอสูงสุดที่ใส่ได้ (มม.)', type: 'number' },
    { key: 'max_cpu_cooler_height', label: 'ความสูงฮีตซิงค์สูงสุดที่ใส่ได้ (มม.)', type: 'number' },
    { key: 'external_volume', label: 'ปริมาตรเคส (ลิตร)', type: 'number', step: '0.1' },
    { key: 'color', label: 'สี', type: 'text' }
  ],
  'cpu-cooler': [
    { key: 'height', label: 'ความสูง (มม.) — สำหรับฮีตซิงค์ลม', type: 'number' },
    { key: 'size', label: 'ขนาดหม้อน้ำ (มม.) — สำหรับ AIO/น้ำ', type: 'number' },
    { key: 'color', label: 'สี', type: 'text' }
  ],
  monitor: [
    { key: 'screen_size', label: 'ขนาดจอ (นิ้ว)', type: 'number', step: '0.1' },
    { key: 'resolution', label: 'ความละเอียด', type: 'text', placeholder: 'เช่น 2560 x 1440' },
    { key: 'refresh_rate', label: 'รีเฟรชเรต (Hz)', type: 'number' },
    { key: 'panel_type', label: 'ชนิดพาเนล', type: 'select', options: ['IPS', 'VA', 'TN', 'OLED'] }
  ]
};

// Specs keys the admin schema above doesn't show a field for (present on some
// existing product) are never touched - populateAdminSpecFields() stashes
// them here on load and collectAdminSpecFields() merges them back in on
// save, so editing a product through the structured fields can never
// silently drop data the JSON editor used to preserve.
let adminSpecsExtra = {};

viewLinks.forEach((link) => {
  link.addEventListener('click', handleViewLink);
});
builderToggleButton?.addEventListener('click', () => {
  const isOpen = workspaceEl.classList.toggle('builder-open');
  builderToggleButton.setAttribute('aria-expanded', String(isOpen));
});
builderCloseButton?.addEventListener('click', () => {
  workspaceEl.classList.remove('builder-open');
  builderToggleButton?.setAttribute('aria-expanded', 'false');
});
heroAutoBuildButton?.addEventListener('click', () => {
  // Same drawer the header's "ตัวจัดสเปค" button opens - on mobile this is
  // an off-screen panel that slides in; on desktop .sidebar is already
  // visible (position: sticky), so the class is a no-op there and this
  // just focuses the budget field to guide the eye to it.
  workspaceEl?.classList.add('builder-open');
  builderToggleButton?.setAttribute('aria-expanded', 'true');
  const budgetInput = document.querySelector('[data-build-form] [name="budget"]');
  requestAnimationFrame(() => budgetInput?.focus());
});
heroBrowseButton?.addEventListener('click', () => {
  productsEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
});
manualCategoriesEl.addEventListener('click', handleManualCategoryAction);
productsEl.addEventListener('click', handleProductAction);
paginationEl?.addEventListener('click', handlePaginationAction);
cartItemsEl?.addEventListener('click', handleCartAction);
cartClearButton?.addEventListener('click', clearCart);
cartSaveButton?.addEventListener('click', saveCart);
saveBuildButtons.forEach((button) => {
  button.addEventListener('click', saveBuildToDatabase);
});
resetBuildButtons.forEach((button) => {
  button.addEventListener('click', resetCurrentBuild);
});
manualShareEl?.addEventListener('click', handleManualShareAction);
// เช็คบ็อกซ์ "ลงคลังสาธารณะ" ย้ายไปวางติดกับปุ่ม "บันทึกสเปค" ในกล่อง
// save-build-panel เอง (คนละกล่องกับ manualShareEl ด้านบน) เลยต้องดักคลิกแยก
// อีกจุด แต่ใช้ handler เดียวกันได้เลยเพราะเช็คจาก data-attribute ของปุ่ม/ช่องที่คลิก
saveBuildListedEl?.addEventListener('click', handleManualShareAction);
historyPanelEl?.addEventListener('click', handleSavedBuildAction);
historyPanelEl?.addEventListener('keydown', handleSavedBuildKeydown);
galleryPanelEl?.addEventListener('click', handleGalleryAction);
galleryPanelEl?.addEventListener('keydown', handleGalleryKeydown);
adminPanelEl?.addEventListener('click', handleAdminAction);
adminSearchForm?.addEventListener('submit', submitAdminSearch);
adminCategoryFilterEl?.addEventListener('change', handleAdminCategoryFilterChange);
adminNewButton?.addEventListener('click', () => openAdminEditor());
adminForm?.addEventListener('submit', submitAdminForm);
adminCategorySelectEl?.addEventListener('change', handleAdminCategoryChange);
adminImageFileEl?.addEventListener('change', uploadAdminProductImage);
adminUsersPanelEl?.addEventListener('click', handleAdminUserAction);
adminUsersSearchForm?.addEventListener('submit', submitAdminUsersSearch);
adminAuditPanelEl?.addEventListener('click', handleAdminAuditAction);
adminAuditSearchForm?.addEventListener('submit', submitAdminAuditSearch);
changePasswordForm?.addEventListener('submit', submitChangePasswordForm);
authOpenButton?.addEventListener('click', handleAuthButtonClick);
authCloseButton?.addEventListener('click', closeAuthModal);
authModalEl?.addEventListener('click', closeAuthModalFromBackdrop);
authModeButtons.forEach((button) => {
  button.addEventListener('click', () => setAuthMode(button.dataset.authMode || 'login'));
});
authForm?.addEventListener('submit', submitLoginForm);
confirmOkButton?.addEventListener('click', () => settleConfirmDialog(true));
confirmCancelButton?.addEventListener('click', () => settleConfirmDialog(false));
confirmModalEl?.addEventListener('click', (event) => {
  if (event.target === confirmModalEl) {
    settleConfirmDialog(false);
  }
});
productDetailCloseButton?.addEventListener('click', closeProductDetailModal);
productDetailModalEl?.addEventListener('click', (event) => {
  if (event.target === productDetailModalEl) {
    closeProductDetailModal();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && confirmModalEl && !confirmModalEl.hidden) {
    settleConfirmDialog(false);
  }
  if (event.key === 'Escape' && productDetailModalEl && !productDetailModalEl.hidden) {
    closeProductDetailModal();
  }
});
searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.search = new FormData(searchForm).get('search').trim();
  resetProductPage();
  loadProducts();
});
filterForm.addEventListener('change', (event) => {
  const formData = new FormData(filterForm);
  const brandChanged = event.target && event.target.name === 'brand';
  const nextFilters = {
    brand: formData.get('brand') || '',
    series: brandChanged ? '' : (formData.get('series') || ''),
    socket: brandChanged ? '' : (formData.get('socket') || ''),
    minRefreshRate: formData.get('minRefreshRate') || '',
    screenSize: formData.get('screenSize') || '',
    resolution: formData.get('resolution') || '',
    panelType: formData.get('panelType') || ''
  };

  if (brandChanged) {
    seriesFilterEl.value = '';
    socketFilterEl.value = '';
  }

  state.filters = nextFilters;
  resetProductPage();
  loadProductFilters();
  loadProducts();
});
filterForm.addEventListener('reset', () => {
  state.filters = createEmptyFilters();
  resetProductPage();
  loadProductFilters();
  setTimeout(loadProducts);
});
buildForm.addEventListener('submit', submitBuildForm);

const initialView = getInitialView();

loadPage(initialView);
renderCart();
handleOAuthRedirectResult();

function handleOAuthRedirectResult() {
  const params = new URLSearchParams(window.location.search);
  const authError = params.get('authError');

  if (!authError) {
    return;
  }

  openAuthModal();
  setAuthModalStatus(getOAuthErrorMessage(authError));
  params.delete('authError');
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
  window.history.replaceState({}, '', nextUrl);
}

function getOAuthErrorMessage(reason) {
  if (reason === 'google_not_configured') {
    return 'ระบบยังไม่ได้ตั้งค่า Google Login กรุณาติดต่อผู้ดูแลระบบ';
  }

  if (reason === 'google_access_denied') {
    return 'ยกเลิกการเข้าสู่ระบบด้วย Google';
  }

  if (reason === 'google_state_mismatch') {
    return 'เซสชันการเข้าสู่ระบบหมดอายุ กรุณาลองใหม่อีกครั้ง';
  }

  if (reason === 'google_login_failed') {
    return 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  }

  if (reason === 'facebook_not_configured') {
    return 'ระบบยังไม่ได้ตั้งค่า Facebook Login กรุณาติดต่อผู้ดูแลระบบ';
  }

  if (reason === 'facebook_access_denied') {
    return 'ยกเลิกการเข้าสู่ระบบด้วย Facebook';
  }

  if (reason === 'facebook_state_mismatch') {
    return 'เซสชันการเข้าสู่ระบบหมดอายุ กรุณาลองใหม่อีกครั้ง';
  }

  if (reason === 'facebook_login_failed') {
    return 'เข้าสู่ระบบด้วย Facebook ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
  }

  return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

async function loadPage(requestedView) {
  await loadCurrentUser();
  setView(requestedView);
  await Promise.all([
    loadDatabaseHealth(),
    loadCategories()
  ]);
  await loadProductFilters();
  await loadProducts();
  await loadSavedBuilds();
}

async function loadCurrentUser() {
  try {
    const data = await fetchJson('/api/me');
    state.user = data.user || null;
  } catch {
    state.user = null;
  }

  renderAuthState();
}

function handleViewLink(event) {
  event.preventDefault();
  const nextView = event.currentTarget.dataset.viewLink || 'products';

  if (nextView === 'history') {
    state.selectedSavedBuildId = '';
  }

  setView(nextView);
}

async function handleAuthButtonClick() {
  if (state.user) {
    await logoutUser();
    return;
  }

  openAuthModal();
}

function getInitialView() {
  if (window.location.hash.startsWith('#history')) {
    return 'history';
  }

  if (window.location.hash.startsWith('#public/')) {
    return 'public-build';
  }

  if (window.location.hash.startsWith('#gallery')) {
    return 'gallery';
  }

  const hashView = window.location.hash.slice(1);
  return ['admin-dashboard', 'admin', 'admin-users', 'admin-audit', 'profile'].includes(hashView) ? hashView : 'products';
}

// สเปคที่คนอื่นแชร์ลิงก์มาให้ (#public/<token>) - ไม่ต้องล็อกอินก็เข้าดูได้ ต่างจาก
// 'history' (ประวัติของตัวเอง) ที่ต้องล็อกอิน จึงแยกเป็นคนละ view กัน
const PUBLIC_BUILD_VIEW = 'public-build';

function getPublicShareTokenFromHash() {
  return window.location.hash.match(/^#public\/([\w-]+)$/)?.[1] || '';
}

function setView(nextView) {
  const requestedView = ['history', 'gallery', 'admin-dashboard', 'admin', 'admin-users', 'admin-audit', 'profile', PUBLIC_BUILD_VIEW].includes(nextView) ? nextView : 'products';
  const isAdminView = ['admin-dashboard', 'admin', 'admin-users', 'admin-audit'].includes(requestedView);
  const needsLoginOnly = requestedView === 'profile' && !state.user;
  const view = (isAdminView && state.user?.role !== 'admin') || needsLoginOnly ? 'products' : requestedView;
  const panelView = view;
  state.view = view;

  viewPanels.forEach((panel) => {
    // buildResultEl and savedBuildResultEl only have something to show once a
    // build has actually been generated or saved (submitBuildForm / the save
    // flow toggle their own `hidden`) — force-hide them when navigating away
    // from the products view, but don't force them open just because the
    // view matches, or an empty result card shows up on every visit.
    if (panel === buildResultEl || panel === savedBuildResultEl) {
      if (panelView !== 'products') {
        panel.hidden = true;
      }

      return;
    }

    panel.hidden = panel.dataset.viewPanel !== panelView;
  });

  viewLinks.forEach((link) => {
    link.classList.toggle('active', link.dataset.viewLink === view);
  });

  if (workspaceEl) {
    workspaceEl.classList.toggle('history-mode', view === 'history' || view === 'gallery' || view === PUBLIC_BUILD_VIEW || view === 'profile' || isAdminView);
  }

  if (view === PUBLIC_BUILD_VIEW) {
    const token = getPublicShareTokenFromHash();
    window.location.hash = token ? `public/${token}` : 'public';
    loadPublicBuild(token);
    return;
  }

  if (view === 'history') {
    const requestedBuildId = getHistoryBuildIdFromHash();

    if (requestedBuildId) {
      state.selectedSavedBuildId = requestedBuildId;
    }

    updateSavedBuildHistoryView();
    window.location.hash = state.selectedSavedBuildId ? `history/${state.selectedSavedBuildId}` : 'history';
    loadSavedBuilds();
    return;
  }

  if (view === 'gallery') {
    window.location.hash = 'gallery';
    loadPublicGallery();
    return;
  }

  if (view === 'admin-dashboard') {
    window.location.hash = 'admin-dashboard';
    loadAdminDashboard();
    return;
  }

  if (view === 'admin') {
    window.location.hash = 'admin';
    loadAdminProducts();
    return;
  }

  if (view === 'admin-users') {
    window.location.hash = 'admin-users';
    loadAdminUsers();
    return;
  }

  if (view === 'admin-audit') {
    window.location.hash = 'admin-audit';
    loadAdminAuditLogs();
    return;
  }

  if (view === 'profile') {
    window.location.hash = 'profile';
    renderProfile();
    return;
  }

  window.location.hash = 'products';
}

async function submitLoginForm(event) {
  event.preventDefault();
  const endpoint = state.authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
  const message = state.authMode === 'register' ? 'สมัครสมาชิกและเข้าสู่ระบบแล้ว' : 'เข้าสู่ระบบแล้ว';
  await submitAuth(endpoint, message);
}

function openAuthModal() {
  if (authModalEl) {
    authModalEl.hidden = false;
  }
}

function closeAuthModal() {
  if (authModalEl) {
    authModalEl.hidden = true;
  }
}

function closeAuthModalFromBackdrop(event) {
  if (event.target === authModalEl) {
    closeAuthModal();
  }
}

// แทนที่ window.confirm() ของเบราว์เซอร์ (กล่องระบบ ปรับดีไซน์ไม่ได้เลย) ด้วย
// popup ของเว็บเองที่จัดพรีเมียมได้ตามธีมเดียวกับ auth-dialog - เรียกใช้แบบ
// await confirmDialog('ข้อความ') ตรงจุดที่เคยเรียก window.confirm() ทุกจุด
// (ลบสินค้า/ลบสเปค/เปิด-ปิดบัญชี/ถอดสเปคออกจากคลังสาธารณะ) คืนค่า Promise<boolean>
// เหมือนกัน (true = กด "ยืนยัน", false = กด "ยกเลิก"/กดพื้นหลัง/กด Esc)
function confirmDialog(message) {
  if (!confirmModalEl || !confirmMessageEl) {
    // เผื่อไว้เฉยๆ ถ้า markup ของ popup นี้หายไปสักวัน (แบบเดียวกับที่เจอกับ
    // หน้าโปรไฟล์) อย่างน้อยฟีเจอร์จริงยังทำงานได้ด้วยกล่องระบบเดิม
    return Promise.resolve(window.confirm(message));
  }

  confirmMessageEl.textContent = message;
  confirmModalEl.hidden = false;
  requestAnimationFrame(() => confirmOkButton?.focus());

  return new Promise((resolve) => {
    resolveConfirmDialog = resolve;
  });
}

function settleConfirmDialog(result) {
  if (confirmModalEl) {
    confirmModalEl.hidden = true;
  }

  const resolve = resolveConfirmDialog;
  resolveConfirmDialog = null;
  resolve?.(result);
}

function setAuthMode(mode) {
  state.authMode = mode === 'register' ? 'register' : 'login';

  authModeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.authMode === state.authMode);
  });

  if (authSubmitButton) {
    authSubmitButton.textContent = state.authMode === 'register' ? 'สมัครสมาชิก' : 'เข้าสู่ระบบ';
  }

  // ช่องอีเมลแสดงเฉพาะตอนสมัครสมาชิก
  authRegisterOnlyEls.forEach((element) => {
    element.hidden = state.authMode !== 'register';
  });

  // ให้ตัวจัดการรหัสผ่านของเบราว์เซอร์รู้ว่ากำลังตั้งรหัสใหม่หรือกรอกรหัสเดิม
  const passwordInput = authForm?.elements?.password;
  if (passwordInput) {
    passwordInput.autocomplete = state.authMode === 'register' ? 'new-password' : 'current-password';
  }

  setAuthModalStatus('');
}

// รูปแบบเดียวกับ isValidEmail ฝั่งเซิร์ฟเวอร์ (server/services/auth.service.js)
function isValidEmailAddress(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ข้อความ error สั้นๆ จากเซิร์ฟเวอร์ (ภาษาอังกฤษ) -> ข้อความไทยสำหรับผู้ใช้ ข้อความอื่นที่ไม่รู้จักใช้ข้อความกลางแทน
// (ไม่โชว์ข้อความดิบจากฐานข้อมูลให้ผู้ใช้เห็น)
function getAuthErrorMessage(error, isRegister) {
  const message = String(error?.message || '');

  if (isRegister) {
    if (message === 'This email is already registered') {
      return 'อีเมลนี้ถูกใช้สมัครสมาชิกแล้ว';
    }

    if (message === 'This username is already taken') {
      return 'ชื่อผู้ใช้นี้ถูกใช้แล้ว กรุณาใช้ชื่ออื่น';
    }

    if (message === 'A valid email address is required') {
      return 'รูปแบบอีเมลไม่ถูกต้อง';
    }
  }

  if (error?.status === 429) {
    return isRegister ? 'สมัครสมาชิกบ่อยเกินไป กรุณาลองใหม่ในอีก 1 ชั่วโมง' : 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ในอีก 15 นาที';
  }

  return isRegister ? 'สมัครสมาชิกไม่สำเร็จ กรุณาตรวจสอบข้อมูล' : 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจสอบข้อมูล';
}

async function submitAuth(url, successMessage) {
  const isRegister = state.authMode === 'register';
  const formData = new FormData(authForm);
  const payload = {
    username: String(formData.get('username') || '').trim(),
    password: String(formData.get('password') || '')
  };

  if (isRegister) {
    payload.email = String(formData.get('email') || '').trim().toLowerCase();
  }

  if (!payload.username || payload.password.length < 6) {
    setAuthModalStatus('กรอก username และ password อย่างน้อย 6 ตัวอักษร');
    return;
  }

  if (isRegister && !isValidEmailAddress(payload.email)) {
    setAuthModalStatus('กรอกอีเมลให้ถูกต้อง (ใช้สำหรับกู้คืนรหัสผ่านเมื่อลืม)');
    return;
  }

  try {
    setAuthModalStatus('กำลังตรวจสอบบัญชี...');
    const data = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    state.user = data.user;
    authForm.reset();
    closeAuthModal();
    renderAuthState();
    setAuthModalStatus('');
    await loadSavedBuilds();
  } catch (error) {
    setAuthModalStatus(getAuthErrorMessage(error, isRegister));
  }
}

async function logoutUser() {
  try {
    await fetchJson('/api/auth/logout', { method: 'POST' });
  } catch {
  }

  state.user = null;
  state.savedBuildsById = new Map();
  state.adminProductsById = new Map();
  renderAuthState();
  renderSavedBuildList([]);

  if (['admin-dashboard', 'admin', 'admin-users', 'admin-audit'].includes(state.view)) {
    setView('products');
  }
}

const authLoginIconSvg = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></svg>';
// ปุ่ม "ออกจากระบบ" ใช้ icon รูปคนแบบเดียวกับปุ่ม "เข้าสู่ระบบ" ตามที่ขอ (เดิมเป็น
// icon ประตู+ลูกศรออกแบบ logout ทั่วไป - เปลี่ยนให้เป็นรูปคนเหมือนกันเพื่อความสม่ำเสมอ)
const authLogoutIconSvg = authLoginIconSvg;

function renderAuthState() {
  if (!authOpenButton) {
    return;
  }

  const isLoggedIn = Boolean(state.user);
  const isAdmin = state.user?.role === 'admin';
  authOpenButton.classList.toggle('is-logged-in', isLoggedIn);
  authOpenButton.querySelector('span:last-child').textContent = isLoggedIn ? 'ออกจากระบบ' : 'เข้าสู่ระบบ';
  authOpenButton.querySelector('.auth-open-icon').innerHTML = isLoggedIn ? authLogoutIconSvg : authLoginIconSvg;
  adminViewLink?.toggleAttribute('hidden', !isAdmin);
  profileViewLink?.toggleAttribute('hidden', !isLoggedIn);
  adminDashboardViewLink?.toggleAttribute('hidden', !isAdmin);
  adminUsersViewLink?.toggleAttribute('hidden', !isAdmin);
  adminAuditViewLink?.toggleAttribute('hidden', !isAdmin);

  if (isLoggedIn) {
    closeAuthModal();
  }
}

function renderProfile() {
  if (!profilePanelEl || !state.user) {
    return;
  }

  profileUsernameEl.textContent = `${state.user.username} (${state.user.role})`;
  setChangePasswordStatus('');
}

async function submitChangePasswordForm(event) {
  event.preventDefault();
  const formData = new FormData(changePasswordForm);
  const currentPassword = String(formData.get('currentPassword') || '');
  const newPassword = String(formData.get('newPassword') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');

  if (newPassword !== confirmPassword) {
    setChangePasswordStatus('ยืนยันรหัสผ่านใหม่ไม่ตรงกัน');
    return;
  }

  try {
    await fetchJson('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    changePasswordForm.reset();
    state.user = null;
    renderAuthState();
    setView('products');
    openAuthModal();
    setAuthMode('login');
    setAuthModalStatus('เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบอีกครั้ง');
  } catch (error) {
    setChangePasswordStatus(error.message || 'เปลี่ยนรหัสผ่านไม่สำเร็จ');
  }
}

function setChangePasswordStatus(message) {
  if (changePasswordStatusEl) {
    changePasswordStatusEl.textContent = message;
  }
}

async function loadAdminProducts() {
  if (!adminProductsEl || state.user?.role !== 'admin') {
    return;
  }

  adminProductsEl.innerHTML = createLoadingState('กำลังโหลดสินค้า...', 6);
  setAdminStatus('');
  renderAdminCategoryOptions();

  try {
    const params = new URLSearchParams({
      limit: String(state.adminPageSize),
      offset: String((state.adminPage - 1) * state.adminPageSize)
    });

    if (state.adminSearch) {
      params.set('search', state.adminSearch);
    }

    if (state.adminCategory) {
      params.set('category', state.adminCategory);
    }

    const data = await fetchJson(`/api/admin/products?${params.toString()}`);
    state.adminTotalProducts = Number(data.total || 0);

    const totalPages = Math.max(1, Math.ceil(state.adminTotalProducts / state.adminPageSize));

    if (state.adminPage > totalPages) {
      state.adminPage = totalPages;
      await loadAdminProducts();
      return;
    }

    renderAdminProducts(data.products || []);
    renderAdminPagination();
    setAdminStatus(`พบ ${formatNumber(data.total || 0)} รายการ`);
  } catch {
    adminPaginationEl?.setAttribute('hidden', '');
    adminProductsEl.innerHTML = createEmptyState({
      title: 'โหลดรายการสินค้าไม่ได้',
      message: 'ตรวจสอบสิทธิ์ผู้ดูแลและการเชื่อมต่อ MySQL'
    });
  }
}

async function loadAdminDashboard() {
  if (!adminDashboardEl || state.user?.role !== 'admin') {
    return;
  }

  adminDashboardEl.innerHTML = createLoadingState('กำลังโหลดแดชบอร์ด...', 5);

  try {
    const data = await fetchJson('/api/admin/dashboard');
    const dashboard = data.dashboard || {};
    const activities = dashboard.recentActivities || [];
    const productCategories = dashboard.productCategories || [];
    const savedBuildModes = dashboard.savedBuildModes || [];
    adminDashboardEl.innerHTML = `
      <div class="admin-stat-grid">
        <article><span>สินค้า</span><strong>${formatNumber(dashboard.products || 0)}</strong></article>
        <article><span>ผู้ใช้ทั้งหมด</span><strong>${formatNumber(dashboard.users || 0)}</strong></article>
        <article><span>บัญชีใช้งาน</span><strong>${formatNumber(dashboard.activeUsers || 0)}</strong></article>
        <article><span>บัญชีถูกปิด</span><strong>${formatNumber(dashboard.suspendedUsers || 0)}</strong></article>
        <article><span>สเปคที่บันทึก</span><strong>${formatNumber(dashboard.savedBuilds || 0)}</strong></article>
      </div>
      <div class="admin-dashboard-insights">
        ${renderDashboardBreakdown('สินค้าแยกตามหมวด', productCategories, (item) => getCategoryLabel(item.category))}
        ${renderDashboardBreakdown('สเปคที่บันทึกตามการใช้งาน', savedBuildModes, (item) => item.mode === 'gaming' ? 'เล่นเกม' : item.mode === 'work' ? 'ทำงาน' : item.mode || 'ไม่ระบุ')}
      </div>
      <section class="admin-recent-activity">
        <h3>กิจกรรมล่าสุด</h3>
        ${activities.length ? `<div class="admin-table-wrap"><table class="admin-table"><thead><tr><th>เวลา</th><th>แอดมิน</th><th>กิจกรรม</th><th>รายการ</th></tr></thead><tbody>${activities.map((log) => `
          <tr><td>${formatDateTime(log.createdAt)}</td><td>${escapeHtml(log.actorUsername || '-')}</td><td>${escapeHtml(formatAuditAction(log.action))}</td><td>${escapeHtml(formatAuditTarget(log))}</td></tr>
        `).join('')}</tbody></table></div>` : createEmptyState({ title: 'ยังไม่มีกิจกรรม', message: 'กิจกรรมการจัดการระบบจะแสดงที่นี่' })}
      </section>
    `;
  } catch {
    adminDashboardEl.innerHTML = createEmptyState({ title: 'โหลดแดชบอร์ดไม่ได้', message: 'ตรวจสอบสิทธิ์ผู้ดูแลและการเชื่อมต่อ MySQL' });
  }
}

function renderDashboardBreakdown(title, items, getLabel) {
  if (!items.length) {
    return `<section class="admin-dashboard-breakdown"><h3>${escapeHtml(title)}</h3><p class="muted">ยังไม่มีข้อมูล</p></section>`;
  }

  const maximum = Math.max(...items.map((item) => Number(item.total || 0)), 1);

  return `
    <section class="admin-dashboard-breakdown">
      <h3>${escapeHtml(title)}</h3>
      <div class="admin-breakdown-list">
        ${items.map((item) => {
          const total = Number(item.total || 0);
          const percent = Math.max(0, Math.min(100, Math.round(total / maximum * 100)));
          return `<article><span>${escapeHtml(getLabel(item))}</span><div><i style="width:${percent}%"></i></div><strong>${formatNumber(total)}</strong></article>`;
        }).join('')}
      </div>
    </section>
  `;
}

async function uploadAdminProductImage() {
  const file = adminImageFileEl?.files?.[0];

  if (!file) {
    return;
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    setAdminImageStatus('รองรับ PNG, JPEG หรือ WebP ขนาดไม่เกิน 2 MB');
    adminImageFileEl.value = '';
    return;
  }

  setAdminImageStatus('กำลังอัปโหลดรูป...');

  try {
    const dataUrl = await readImageFile(file);
    const data = await fetchJson('/api/admin/product-images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType: file.type, data: dataUrl.split(',')[1] || '' })
    });
    const previousPendingImage = state.adminPendingImageUrl;
    state.adminPendingImageUrl = data.imageUrl;
    adminForm.elements.imageUrl.value = data.imageUrl;
    setAdminImagePreview(data.imageUrl);
    if (previousPendingImage && previousPendingImage !== data.imageUrl) {
      void removeAdminProductImage(previousPendingImage);
    }
    setAdminImageStatus('อัปโหลดรูปแล้ว');
  } catch (error) {
    setAdminImageStatus(error.message || 'อัปโหลดรูปไม่สำเร็จ');
  }
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function setAdminImageStatus(message) {
  if (adminImageStatusEl) {
    adminImageStatusEl.textContent = message;
  }
}

function setAdminImagePreview(imageUrl) {
  if (!adminImagePreviewEl) {
    return;
  }

  const safeUrl = getSafeImageUrl(imageUrl);

  if (!safeUrl) {
    adminImagePreviewEl.hidden = true;
    adminImagePreviewEl.innerHTML = '';
    return;
  }

  adminImagePreviewEl.hidden = false;
  adminImagePreviewEl.innerHTML = `<img src="${escapeHtml(safeUrl)}" alt="ตัวอย่างรูปสินค้า" />`;
}

async function removeAdminProductImage(imageUrl) {
  if (!imageUrl?.startsWith('/uploads/')) {
    return;
  }

  try {
    await fetchJson(`/api/admin/product-images?${new URLSearchParams({ imageUrl }).toString()}`, { method: 'DELETE' });
  } catch {
  }
}

function discardPendingAdminImage() {
  const imageUrl = state.adminPendingImageUrl;
  state.adminPendingImageUrl = '';
  if (imageUrl) {
    void removeAdminProductImage(imageUrl);
  }
}

function renderAdminProducts(products) {
  state.adminProductsById = new Map(products.map((product) => [String(product.id), product]));

  if (!products.length) {
    adminProductsEl.innerHTML = createEmptyState({
      title: 'ไม่พบสินค้า',
      message: 'ลองค้นหาด้วยคำอื่น หรือเพิ่มสินค้าใหม่'
    });
    return;
  }

  adminProductsEl.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr><th>สินค้า</th><th>หมวดหมู่</th><th>ราคา</th><th></th></tr></thead>
        <tbody>${products.map((product) => `
          <tr>
            <td><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.brand || '-')}</span></td>
            <td>${escapeHtml(getCategoryLabel(product.category))}</td>
            <td>${formatCurrency(product.priceThb)}</td>
            <td>
              <div class="admin-row-actions">
                <button type="button" data-admin-edit="${escapeHtml(product.id)}">แก้ไข</button>
                <button type="button" data-admin-delete="${escapeHtml(product.id)}">ลบ</button>
              </div>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderAdminPagination() {
  if (!adminPaginationEl) {
    return;
  }

  const totalPages = Math.max(1, Math.ceil(state.adminTotalProducts / state.adminPageSize));

  if (totalPages <= 1) {
    adminPaginationEl.setAttribute('hidden', '');
    adminPaginationEl.innerHTML = '';
    return;
  }

  const page = Math.min(state.adminPage, totalPages);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((candidate) => candidate === 1 || candidate === totalPages || Math.abs(candidate - page) <= 1);
  const buttons = [];

  buttons.push(`<button type="button" data-admin-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>ก่อนหน้า</button>`);
  pageNumbers.forEach((candidate, index) => {
    if (index > 0 && candidate - pageNumbers[index - 1] > 1) {
      buttons.push('<span aria-hidden="true">...</span>');
    }

    buttons.push(`<button type="button" data-admin-page="${candidate}" ${candidate === page ? 'aria-current="page"' : ''}>${candidate}</button>`);
  });
  buttons.push(`<button type="button" data-admin-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>ถัดไป</button>`);

  adminPaginationEl.hidden = false;
  adminPaginationEl.innerHTML = buttons.join('');
}

async function loadAdminUsers() {
  if (!adminUsersEl || state.user?.role !== 'admin') {
    return;
  }

  adminUsersEl.innerHTML = createLoadingState('กำลังโหลดผู้ใช้...', 5);
  setAdminUsersStatus('');

  try {
    const params = new URLSearchParams({
      limit: String(state.adminUsersPageSize),
      offset: String((state.adminUsersPage - 1) * state.adminUsersPageSize)
    });

    if (state.adminUsersSearch) {
      params.set('search', state.adminUsersSearch);
    }

    const data = await fetchJson(`/api/admin/users?${params.toString()}`);
    state.adminUsersTotal = Number(data.total || 0);
    const totalPages = Math.max(1, Math.ceil(state.adminUsersTotal / state.adminUsersPageSize));

    if (state.adminUsersPage > totalPages) {
      state.adminUsersPage = totalPages;
      await loadAdminUsers();
      return;
    }

    renderAdminUsers(data.users || []);
    renderAdminUsersPagination();
    setAdminUsersStatus(`พบ ${formatNumber(state.adminUsersTotal)} บัญชี`);
  } catch {
    adminUsersPaginationEl?.setAttribute('hidden', '');
    adminUsersEl.innerHTML = createEmptyState({
      title: 'โหลดรายชื่อผู้ใช้ไม่ได้',
      message: 'ตรวจสอบสิทธิ์ผู้ดูแลและการเชื่อมต่อ MySQL'
    });
  }
}

function renderAdminUsers(users) {
  if (!users.length) {
    adminUsersEl.innerHTML = createEmptyState({ title: 'ไม่พบผู้ใช้', message: 'ลองค้นหาด้วยชื่อผู้ใช้อื่น' });
    return;
  }

  adminUsersEl.innerHTML = `
    <div class="admin-table-wrap">
      <table class="admin-table admin-users-table">
        <thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${users.map((user) => `
          <tr>
            <td><strong>${escapeHtml(user.username)}</strong><span>สร้างเมื่อ ${formatDateTime(user.createdAt)}</span></td>
            <td><select data-admin-user-role="${escapeHtml(user.id)}"><option value="user" ${user.role === 'user' ? 'selected' : ''}>User</option><option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option></select></td>
            <td><span class="admin-account-status ${user.isActive ? 'is-active' : 'is-disabled'}">${user.isActive ? 'ใช้งานอยู่' : 'ปิดบัญชี'}</span></td>
            <td>
              <div class="admin-row-actions">
                <input type="password" class="admin-user-password-input" data-admin-user-password="${escapeHtml(user.id)}" placeholder="รหัสผ่านใหม่" minlength="6" autocomplete="new-password" />
                <button type="button" data-admin-user-toggle="${escapeHtml(user.id)}" data-admin-user-active="${user.isActive ? '0' : '1'}">${user.isActive ? 'ปิดบัญชี' : 'เปิดบัญชี'}</button>
                <button type="button" data-admin-user-save="${escapeHtml(user.id)}" data-admin-user-active="${user.isActive ? '1' : '0'}">บันทึก</button>
              </div>
            </td>
          </tr>
        `).join('')}</tbody>
      </table>
    </div>
  `;
}

function renderAdminUsersPagination() {
  if (!adminUsersPaginationEl) {
    return;
  }

  const totalPages = Math.max(1, Math.ceil(state.adminUsersTotal / state.adminUsersPageSize));

  if (totalPages <= 1) {
    adminUsersPaginationEl.setAttribute('hidden', '');
    adminUsersPaginationEl.innerHTML = '';
    return;
  }

  const page = Math.min(state.adminUsersPage, totalPages);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((candidate) => candidate === 1 || candidate === totalPages || Math.abs(candidate - page) <= 1);
  const buttons = [`<button type="button" data-admin-users-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>ก่อนหน้า</button>`];

  pageNumbers.forEach((candidate, index) => {
    if (index > 0 && candidate - pageNumbers[index - 1] > 1) {
      buttons.push('<span aria-hidden="true">...</span>');
    }

    buttons.push(`<button type="button" data-admin-users-page="${candidate}" ${candidate === page ? 'aria-current="page"' : ''}>${candidate}</button>`);
  });
  buttons.push(`<button type="button" data-admin-users-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>ถัดไป</button>`);
  adminUsersPaginationEl.hidden = false;
  adminUsersPaginationEl.innerHTML = buttons.join('');
}

async function submitAdminUsersSearch(event) {
  event.preventDefault();
  state.adminUsersSearch = String(new FormData(adminUsersSearchForm).get('search') || '').trim();
  state.adminUsersPage = 1;
  await loadAdminUsers();
}

async function handleAdminUserAction(event) {
  const pageButton = event.target.closest('[data-admin-users-page]');

  if (pageButton) {
    if (pageButton.disabled) {
      return;
    }

    const nextPage = Number(pageButton.dataset.adminUsersPage);

    if (Number.isInteger(nextPage) && nextPage > 0 && nextPage !== state.adminUsersPage) {
      state.adminUsersPage = nextPage;
      await loadAdminUsers();
    }
    return;
  }

  const button = event.target.closest('[data-admin-user-toggle], [data-admin-user-save]');

  if (!button) {
    return;
  }

  const id = button.dataset.adminUserToggle || button.dataset.adminUserSave;
  const roleInput = adminUsersEl.querySelector(`[data-admin-user-role="${CSS.escape(id)}"]`);
  const isActive = button.dataset.adminUserActive === '1';

  if (!id || !roleInput) {
    return;
  }

  if (button.dataset.adminUserToggle && !(await confirmDialog(isActive ? 'เปิดใช้งานบัญชีนี้หรือไม่' : 'ปิดการใช้งานบัญชีนี้หรือไม่'))) {
    return;
  }

  // Only the "บันทึก" (save) button also resets the password - the
  // เปิดบัญชี/ปิดบัญชี toggle only ever touches isActive, so leave any
  // password the admin may have half-typed alone in that case.
  const passwordInput = button.dataset.adminUserSave
    ? adminUsersEl.querySelector(`[data-admin-user-password="${CSS.escape(id)}"]`)
    : null;
  const newPassword = passwordInput?.value || '';

  if (newPassword && newPassword.length < 6) {
    setAdminUsersStatus('รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
    passwordInput?.focus();
    return;
  }

  const payload = { role: roleInput.value, isActive };

  if (newPassword) {
    payload.password = newPassword;
  }

  try {
    await fetchJson(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    await loadAdminUsers();
    setAdminUsersStatus(newPassword ? 'บันทึกสถานะและเปลี่ยนรหัสผ่านแล้ว' : 'บันทึกสถานะผู้ใช้แล้ว');
  } catch (error) {
    setAdminUsersStatus(error.message || 'บันทึกสถานะผู้ใช้ไม่สำเร็จ');
  }
}

async function loadAdminAuditLogs() {
  if (!adminAuditEl || state.user?.role !== 'admin') {
    return;
  }

  adminAuditEl.innerHTML = createLoadingState('กำลังโหลดกิจกรรม...', 5);
  setAdminAuditStatus('');

  try {
    const params = new URLSearchParams({
      limit: String(state.adminAuditPageSize),
      offset: String((state.adminAuditPage - 1) * state.adminAuditPageSize)
    });

    if (state.adminAuditSearch) {
      params.set('search', state.adminAuditSearch);
    }

    const data = await fetchJson(`/api/admin/audit-logs?${params.toString()}`);
    const logs = data.logs || [];
    state.adminAuditTotal = Number(data.total || 0);
    const totalPages = Math.max(1, Math.ceil(state.adminAuditTotal / state.adminAuditPageSize));

    if (state.adminAuditPage > totalPages) {
      state.adminAuditPage = totalPages;
      await loadAdminAuditLogs();
      return;
    }

    renderAdminAuditPagination();
    setAdminAuditStatus(`พบ ${formatNumber(state.adminAuditTotal)} รายการ`);

    if (!logs.length) {
      adminAuditEl.innerHTML = createEmptyState({ title: 'ยังไม่มีกิจกรรม', message: 'กิจกรรมจัดการสินค้าและผู้ใช้จะปรากฏที่นี่' });
      return;
    }

    adminAuditEl.innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>เวลา</th><th>แอดมิน</th><th>กิจกรรม</th><th>รายการ</th></tr></thead>
          <tbody>${logs.map((log) => `
            <tr><td>${formatDateTime(log.createdAt)}</td><td><strong>${escapeHtml(log.actorUsername || '-')}</strong></td><td>${escapeHtml(formatAuditAction(log.action))}</td><td>${escapeHtml(formatAuditTarget(log))}</td></tr>
          `).join('')}</tbody>
        </table>
      </div>
    `;
  } catch {
    adminAuditPaginationEl?.setAttribute('hidden', '');
    adminAuditEl.innerHTML = createEmptyState({ title: 'โหลดกิจกรรมไม่ได้', message: 'ตรวจสอบสิทธิ์ผู้ดูแลและการเชื่อมต่อ MySQL' });
  }
}

async function submitAdminAuditSearch(event) {
  event.preventDefault();
  state.adminAuditSearch = String(new FormData(adminAuditSearchForm).get('search') || '').trim();
  state.adminAuditPage = 1;
  await loadAdminAuditLogs();
}

async function handleAdminAuditAction(event) {
  const pageButton = event.target.closest('[data-admin-audit-page]');

  if (!pageButton || pageButton.disabled) {
    return;
  }

  const nextPage = Number(pageButton.dataset.adminAuditPage);

  if (Number.isInteger(nextPage) && nextPage > 0 && nextPage !== state.adminAuditPage) {
    state.adminAuditPage = nextPage;
    await loadAdminAuditLogs();
  }
}

function renderAdminAuditPagination() {
  if (!adminAuditPaginationEl) {
    return;
  }

  const totalPages = Math.max(1, Math.ceil(state.adminAuditTotal / state.adminAuditPageSize));

  if (totalPages <= 1) {
    adminAuditPaginationEl.setAttribute('hidden', '');
    adminAuditPaginationEl.innerHTML = '';
    return;
  }

  const page = Math.min(state.adminAuditPage, totalPages);
  const pageNumbers = Array.from({ length: totalPages }, (_, index) => index + 1)
    .filter((candidate) => candidate === 1 || candidate === totalPages || Math.abs(candidate - page) <= 1);
  const buttons = [`<button type="button" data-admin-audit-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>ก่อนหน้า</button>`];

  pageNumbers.forEach((candidate, index) => {
    if (index > 0 && candidate - pageNumbers[index - 1] > 1) {
      buttons.push('<span aria-hidden="true">...</span>');
    }

    buttons.push(`<button type="button" data-admin-audit-page="${candidate}" ${candidate === page ? 'aria-current="page"' : ''}>${candidate}</button>`);
  });
  buttons.push(`<button type="button" data-admin-audit-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>ถัดไป</button>`);
  adminAuditPaginationEl.hidden = false;
  adminAuditPaginationEl.innerHTML = buttons.join('');
}

function setAdminAuditStatus(message) {
  if (adminAuditStatusEl) {
    adminAuditStatusEl.textContent = message;
  }
}

function setAdminUsersStatus(message) {
  if (adminUsersStatusEl) {
    adminUsersStatusEl.textContent = message;
  }
}

function formatAuditAction(action) {
  return ({ 'product.create': 'เพิ่มสินค้า', 'product.update': 'แก้ไขสินค้า', 'product.delete': 'ลบสินค้า', 'user.update': 'แก้ไขผู้ใช้' })[action] || action;
}

function formatAuditTarget(log) {
  const details = log.details || {};
  return details.name || details.username || `${log.targetType || 'รายการ'} #${log.targetId || '-'}`;
}

async function submitAdminSearch(event) {
  event.preventDefault();
  state.adminSearch = String(new FormData(adminSearchForm).get('search') || '').trim();
  state.adminPage = 1;
  await loadAdminProducts();
}

async function handleAdminCategoryFilterChange() {
  state.adminCategory = adminCategoryFilterEl.value || '';
  state.adminPage = 1;
  await loadAdminProducts();
}

function renderAdminCategoryOptions() {
  if (!adminCategoryFilterEl) {
    return;
  }

  const knownCategories = manualCategoryOrder.filter((category) => state.categoryCounts.has(category));
  const categories = knownCategories.length ? knownCategories : manualCategoryOrder;
  const options = categories
    .map((category) => `<option value="${category}">${getCategoryLabel(category)}</option>`)
    .join('');

  adminCategoryFilterEl.innerHTML = `<option value="">หมวดหมู่ทั้งหมด</option>${options}`;
  adminCategoryFilterEl.value = state.adminCategory;
}

async function handleAdminAction(event) {
  const pageButton = event.target.closest('[data-admin-page]');

  if (pageButton && !pageButton.disabled) {
    const nextPage = Number(pageButton.dataset.adminPage);

    if (Number.isInteger(nextPage) && nextPage > 0 && nextPage !== state.adminPage) {
      state.adminPage = nextPage;
      await loadAdminProducts();
    }
    return;
  }

  const cancelButton = event.target.closest('[data-admin-cancel]');

  if (cancelButton) {
    closeAdminEditor();
    return;
  }

  const editButton = event.target.closest('[data-admin-edit]');

  if (editButton) {
    await openAdminEditor(editButton.dataset.adminEdit);
    return;
  }

  const deleteButton = event.target.closest('[data-admin-delete]');

  if (deleteButton) {
    const product = state.adminProductsById.get(String(deleteButton.dataset.adminDelete));

    if (!product || !(await confirmDialog(`ลบสินค้า ${product.name} ใช่หรือไม่`))) {
      return;
    }

    try {
      await fetchJson(`/api/admin/products/${product.id}`, { method: 'DELETE' });
      closeAdminEditor();
      await loadAdminProducts();
      setAdminStatus('ลบสินค้าแล้ว');
    } catch {
      setAdminStatus('ลบสินค้าไม่สำเร็จ');
    }
  }
}

async function openAdminEditor(productId = '') {
  if (!adminEditorEl || !adminForm) {
    return;
  }

  // Opening the editor (especially loading a product's data into it) can
  // shift page layout enough for the browser to move window scroll on its
  // own. The editor is now sticky-positioned so it stays in view either
  // way (see theme-soft.css), but this keeps the whole page from visibly
  // jumping to the top out from under the admin's feet.
  const scrollY = window.scrollY;
  const restoreScroll = () => {
    if (window.scrollY !== scrollY) {
      window.scrollTo(0, scrollY);
    }
  };

  discardPendingAdminImage();
  adminForm.reset();
  adminEditorEl.hidden = false;
  setAdminImagePreview('');
  restoreScroll();

  if (!productId) {
    adminEditorTitleEl.textContent = 'เพิ่มสินค้า';
    adminForm.elements.id.value = '';
    setAdminCategorySelect('cpu');
    renderAdminSpecFields('cpu', {});
    requestAnimationFrame(restoreScroll);
    return;
  }

  try {
    const data = await fetchJson(`/api/admin/products/${productId}`);
    const product = data.product;
    adminEditorTitleEl.textContent = `แก้ไขสินค้า #${product.id}`;
    adminForm.elements.id.value = product.id;
    setAdminCategorySelect(product.category || '');
    adminForm.elements.brand.value = product.brand || '';
    adminForm.elements.name.value = product.name || '';
    adminForm.elements.priceThb.value = Number(product.priceThb || 0);
    adminForm.elements.imageUrl.value = product.imageUrl || '';
    setAdminImagePreview(product.imageUrl || '');
    adminForm.elements.productUrl.value = product.productUrl || '';
    renderAdminSpecFields(getSelectedAdminCategory(), product.specs || {});
    requestAnimationFrame(restoreScroll);
  } catch {
    closeAdminEditor();
    setAdminStatus('เปิดข้อมูลสินค้าไม่สำเร็จ');
  }
}

function closeAdminEditor() {
  adminEditorEl?.setAttribute('hidden', '');
  adminForm?.reset();
  setAdminImageStatus('');
  setAdminImagePreview('');
  discardPendingAdminImage();
  adminSpecsExtra = {};
}

// --- Admin product editor: structured spec fields (replaces raw JSON) ---
//
// The category select drives which fields show. Known categories (the 9 in
// adminSpecFieldSchemas) get a matching set of labeled inputs; anything
// else (a category typed before this schema existed, or a genuinely custom
// one via "อื่นๆ") falls back to showing the plain JSON textarea so no
// product's specs ever become unreachable through this form.

function setAdminCategorySelect(category) {
  if (!adminCategorySelectEl) {
    return;
  }

  const isKnown = Object.prototype.hasOwnProperty.call(adminSpecFieldSchemas, category) || manualCategoryOrder.includes(category);

  if (category && !isKnown) {
    adminCategorySelectEl.value = '__other__';
    if (adminCategoryOtherWrapEl) {
      adminCategoryOtherWrapEl.hidden = false;
    }
    if (adminCategoryOtherInputEl) {
      adminCategoryOtherInputEl.value = category;
    }
    return;
  }

  adminCategorySelectEl.value = category || 'cpu';
  if (adminCategoryOtherWrapEl) {
    adminCategoryOtherWrapEl.hidden = true;
  }
  if (adminCategoryOtherInputEl) {
    adminCategoryOtherInputEl.value = '';
  }
}

function getSelectedAdminCategory() {
  if (!adminCategorySelectEl) {
    return '';
  }

  if (adminCategorySelectEl.value === '__other__') {
    return String(adminCategoryOtherInputEl?.value || '').trim().toLowerCase();
  }

  return adminCategorySelectEl.value;
}

function getAdminSpecFieldValue(category, field, specs) {
  if (category === 'memory') {
    const speed = Array.isArray(specs?.speed) ? specs.speed : [];
    const modules = Array.isArray(specs?.modules) ? specs.modules : [];

    if (field.key === 'speed_gen') {
      return speed[0] === 5 ? 'DDR5' : speed[0] === 4 ? 'DDR4' : '';
    }

    if (field.key === 'speed_mhz') {
      return speed[1] ?? '';
    }

    if (field.key === 'modules_count') {
      return modules[0] ?? '';
    }

    if (field.key === 'modules_size') {
      return modules[1] ?? '';
    }
  }

  return specs?.[field.key] ?? '';
}

function renderAdminSpecFields(category, specs = {}) {
  adminSpecsExtra = {};

  if (!adminSpecFieldsEl) {
    return;
  }

  const schema = adminSpecFieldSchemas[category];

  if (!schema) {
    adminSpecFieldsEl.hidden = true;
    adminSpecFieldsEl.innerHTML = '';
    if (adminSpecsJsonWrapEl) {
      adminSpecsJsonWrapEl.hidden = false;
    }
    if (adminForm) {
      adminForm.elements.specs.value = JSON.stringify(specs || {}, null, 2);
    }
    return;
  }

  if (adminSpecsJsonWrapEl) {
    adminSpecsJsonWrapEl.hidden = true;
  }
  adminSpecFieldsEl.hidden = false;

  // Anything already stored under a key this schema doesn't show a field
  // for gets kept aside (not shown, not lost) and re-merged on save.
  const knownKeys = new Set(['speed', 'modules']);
  schema.forEach((field) => {
    if (!field.virtual) {
      knownKeys.add(field.key);
    }
  });
  adminSpecsExtra = Object.fromEntries(Object.entries(specs || {}).filter(([key]) => !knownKeys.has(key)));

  adminSpecFieldsEl.innerHTML = schema.map((field) => {
    const currentValue = getAdminSpecFieldValue(category, field, specs);

    if (field.type === 'select') {
      const options = field.options.map((option) => (
        `<option value="${escapeHtml(option)}" ${String(currentValue || '') === option ? 'selected' : ''}>${escapeHtml(option)}</option>`
      )).join('');
      return `<label><span>${escapeHtml(field.label)}</span><select data-spec-field="${escapeHtml(field.key)}"><option value="">— ไม่ระบุ —</option>${options}</select></label>`;
    }

    const inputType = field.type === 'number' ? 'number' : 'text';
    const stepAttr = field.step ? ` step="${escapeHtml(field.step)}"` : '';
    return `<label><span>${escapeHtml(field.label)}</span><input data-spec-field="${escapeHtml(field.key)}" type="${inputType}"${stepAttr} value="${escapeHtml(String(currentValue ?? ''))}" placeholder="${escapeHtml(field.placeholder || '')}" /></label>`;
  }).join('');
}

function collectAdminSpecFields(category) {
  const schema = adminSpecFieldSchemas[category];

  if (!schema) {
    // Fallback mode: the visible textarea (name="specs") is already the
    // source of truth via normal form submission - nothing to collect.
    return null;
  }

  const getFieldValue = (key) => {
    const el = adminSpecFieldsEl?.querySelector(`[data-spec-field="${CSS.escape(key)}"]`);
    return el ? el.value.trim() : '';
  };

  const specs = { ...adminSpecsExtra };

  if (category === 'memory') {
    const gen = getFieldValue('speed_gen');
    const mhz = getFieldValue('speed_mhz');
    const count = getFieldValue('modules_count');
    const size = getFieldValue('modules_size');

    if (gen || mhz) {
      specs.speed = [gen === 'DDR5' ? 5 : gen === 'DDR4' ? 4 : null, mhz ? Number(mhz) : null];
    }

    if (count || size) {
      specs.modules = [count ? Number(count) : null, size ? Number(size) : null];
    }
  }

  schema.forEach((field) => {
    if (field.virtual) {
      return;
    }

    const raw = getFieldValue(field.key);

    if (!raw) {
      return;
    }

    specs[field.key] = field.type === 'number' ? Number(raw) : raw;
  });

  return specs;
}

function handleAdminCategoryChange() {
  const isOther = adminCategorySelectEl?.value === '__other__';

  if (adminCategoryOtherWrapEl) {
    adminCategoryOtherWrapEl.hidden = !isOther;
  }

  // Switching category on an open form starts that category's spec fields
  // fresh - the old category's values (different keys, different meaning)
  // don't carry over.
  renderAdminSpecFields(getSelectedAdminCategory(), {});
}

async function submitAdminForm(event) {
  event.preventDefault();

  const category = getSelectedAdminCategory();
  const collectedSpecs = collectAdminSpecFields(category);

  if (collectedSpecs) {
    adminForm.elements.specs.value = JSON.stringify(collectedSpecs);
  }

  const payload = Object.fromEntries(new FormData(adminForm).entries());
  payload.category = category;
  const id = String(payload.id || '');
  delete payload.id;

  try {
    await fetchJson(id ? `/api/admin/products/${id}` : '/api/admin/products', {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    state.adminPendingImageUrl = '';
    closeAdminEditor();
    await loadAdminProducts();
    setAdminStatus(id ? 'บันทึกการแก้ไขแล้ว' : 'เพิ่มสินค้าแล้ว');
  } catch {
    setAdminStatus('บันทึกสินค้าไม่สำเร็จ ตรวจสอบข้อมูล JSON และราคา');
  }
}

function setAdminStatus(message) {
  if (adminStatusEl) {
    adminStatusEl.textContent = message;
  }
}

function setAuthModalStatus(message) {
  if (authModalStatusEl) {
    authModalStatusEl.textContent = message;
  }
}

async function loadDatabaseHealth() {
  // Neither dbStatusEl nor productCountEl has an element in the current page
  // (the old status line this was written for is gone) - left as a no-op
  // rather than deleted, in case that status UI comes back later. The
  // hero's product-count figure is driven from loadProducts() instead,
  // since /api/database/health's count is a raw `COUNT(*) FROM products`
  // (every row, including hidden/unpriced ones - tens of thousands) rather
  // than the same "visible, buyable catalog" number shown everywhere else
  // on the page.
  if (!dbStatusEl || !productCountEl) {
    return;
  }

  try {
    const data = await fetchJson('/api/database/health');
    dbStatusEl.textContent = data.status === 'ok' ? 'เชื่อมต่อแล้ว' : 'มีปัญหา';
    productCountEl.textContent = formatNumber(data.productCount || 0);
  } catch {
    dbStatusEl.textContent = 'เชื่อมต่อไม่ได้';
    productCountEl.textContent = '-';
  }
}

async function loadCategories() {
  manualCategoriesEl.innerHTML = createLoadingState('กำลังโหลดรายการจัดสเปค...', 4);

  try {
    const data = await fetchJson('/api/categories');
    state.categoryCounts = new Map(data.categories.map((item) => [item.category, Number(item.count || 0)]));

    renderManualCategories();
  } catch {
    manualCategoriesEl.innerHTML = createEmptyState({
      title: 'โหลดรายการจัดสเปคไม่ได้',
      message: 'ระบบยังไม่สามารถอ่านหมวดสินค้าจากฐานข้อมูล'
    });
  }
}

function handleManualCategoryAction(event) {
  const removeButton = event.target.closest('[data-manual-remove]');

  if (removeButton) {
    const removeCategory = removeButton.dataset.manualRemove;
    state.cartItems = removeCartItem(state.cartItems, removeCategory);
    setCartStatus(`ลบ ${getCategoryLabel(removeCategory)} ออกจากสเปคแล้ว`);
    renderCart();
    renderManualCategories();
    refreshProductCards();
    return;
  }

  // ปุ่ม +/- จำนวน โชว์ทุกหมวดให้หน้าตาเหมือนกัน แต่กดเพิ่มได้จริง
  // เฉพาะแรม (manualQuantityCategories) เท่านั้น - หมวดอื่นปุ่ม + ถูก disabled
  // อยู่แล้วในหน้าเว็บ แต่กันไว้อีกชั้นตรงนี้ไม่ให้เผลอเพิ่มได้
  const quantityIncButton = event.target.closest('[data-manual-quantity-inc]');

  if (quantityIncButton) {
    const category = quantityIncButton.dataset.manualQuantityInc;
    if (!manualQuantityCategories.has(category)) {
      return;
    }
    const currentQuantity = getCartItemByCategory(state.cartItems, category)?.quantity || 1;
    state.cartItems = setCartItemQuantity(state.cartItems, category, currentQuantity + 1);
    renderCart();
    renderManualCategories();
    return;
  }

  const quantityDecButton = event.target.closest('[data-manual-quantity-dec]');

  if (quantityDecButton) {
    const category = quantityDecButton.dataset.manualQuantityDec;
    if (!manualQuantityCategories.has(category)) {
      return;
    }
    const currentQuantity = getCartItemByCategory(state.cartItems, category)?.quantity || 1;
    state.cartItems = setCartItemQuantity(state.cartItems, category, currentQuantity - 1);
    renderCart();
    renderManualCategories();
    return;
  }

  const button = event.target.closest('[data-manual-category]');

  if (!button) {
    return;
  }

  const category = button.dataset.manualCategory;

  state.category = category;
  setView('products');
  state.search = '';
  state.filters = createEmptyFilters();
  resetProductPage();
  searchForm.reset();
  filterForm.reset();
  loadCategories();
  loadProductFilters();
  loadProducts();
}

async function loadProductFilters() {
  const params = new URLSearchParams();

  if (state.category) {
    params.set('category', state.category);
  }

  if (state.filters.brand) {
    params.set('brand', state.filters.brand);
  }

  try {
    const data = await fetchJson(`/api/product-filters?${params.toString()}`);
    renderFilterOptions(data.filters || {});
  } catch {
    renderFilterOptions({});
  }
}

function renderFilterOptions(filters) {
  renderSelectOptions(brandFilterEl, filters.brands || [], 'แบรนด์ทั้งหมด');
  renderSelectOptions(seriesFilterEl, filters.series || [], 'ซีรีส์ทั้งหมด');
  renderSelectOptions(socketFilterEl, filters.sockets || [], 'ซ็อกเก็ตทั้งหมด');

  if (state.category === 'monitor') {
    const monitor = filters.monitor || {};
    renderOptionObjects(document.querySelector('[data-filter-refresh-rate]'), monitor.refreshRates || []);
    renderOptionObjects(document.querySelector('[data-filter-screen-size]'), monitor.screenSizes || []);
    renderOptionObjects(document.querySelector('[data-filter-resolution]'), monitor.resolutions || []);
    renderOptionObjects(document.querySelector('[data-filter-panel-type]'), monitor.panelTypes || []);
  }
}

// ตัวเลือกแบบ { value, label, count }: แสดงเฉพาะป้าย (ไม่แสดงจำนวน) และคงค่าที่เลือกไว้เดิม
// (ตัวเลือกที่ไม่มีสินค้าเลยถูกกรองออกที่ API แล้ว)
function renderOptionObjects(select, options) {
  if (!select) {
    return;
  }

  const selectedValue = String(state.filters[select.name] || '');

  select.innerHTML = [
    '<option value="">ทั้งหมด</option>',
    ...options.map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
  ].join('');
  select.value = options.some((option) => String(option.value) === selectedValue) ? selectedValue : '';
}

function renderSelectOptions(select, values, emptyLabel) {
  const selectedValue = state.filters[select.name] || '';

  select.innerHTML = [
    `<option value="">${emptyLabel}</option>`,
    ...values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`)
  ].join('');
  select.value = selectedValue;
}

// Small "N/max" status badge - N is 0 before a product is picked for that
// category, and up to `max` once one is (every category is a single slot,
// so max stays 1 - except memory, the one category that allows buying the
// same product twice, where max is 2 and N reflects the chosen quantity).
// Purely informational (native title tooltip only, no click behavior). The
// unselected list row keeps the "(i)" icon ahead of the count; the
// selected-card version (icon hidden) sits inline on the tag-pills row
// instead, matching the plain "1/1" reference design.
function renderManualStatusBadge(count, label, { showIcon = true, max = 1 } = {}) {
  const icon = showIcon
    ? `
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.3" />
        <line x1="8" y1="7" x2="8" y2="11.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
        <circle cx="8" cy="4.6" r="0.9" fill="currentColor" />
      </svg>
    `
    : '';

  return `
    <span class="manual-status" title="${escapeHtml(label)}">
      ${icon}
      <em>${count}/${max}</em>
    </span>
  `;
}

const manualQuantityCategories = new Set(['memory']);

const manualTrashIcon = `
  <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false">
    <path d="M4 6h12M8 6V4.5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1V6M6 6l.6 9.4a1 1 0 0 0 1 .9h4.8a1 1 0 0 0 1-.9L14 6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

function getVisibleManualCategories() {
  return manualCategoryOrder.filter(
    (category) =>
      !optionalManualCategories.has(category) ||
      (state.categoryCounts.get(category) || 0) > 0 ||
      Boolean(getCartItemByCategory(state.cartItems, category))
  );
}

function renderManualCategories() {
  manualCategoriesEl.innerHTML = getVisibleManualCategories().map((category) => {
    const selectedItem = getCartItemByCategory(state.cartItems, category);
    const label = getCategoryLabel(category);

    const allowsQuantity = manualQuantityCategories.has(category);
    const maxQuantity = allowsQuantity ? MAX_CART_ITEM_QUANTITY : 1;

    if (!selectedItem) {
      return `
        <button class="manual-category ${category === state.category ? 'active' : ''}" type="button" data-manual-category="${category}">
          <span class="manual-icon">${getCategoryIcon(category)}</span>
          <span class="manual-name">
            <span>${escapeHtml(label)}</span>
          </span>
          ${renderManualStatusBadge(0, label, { max: maxQuantity })}
        </button>
      `;
    }

    const imageUrl = getSafeImageUrl(selectedItem.imageUrl);
    const image = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(selectedItem.name)}" loading="lazy" />`
      : `<span class="image-placeholder" data-category="${escapeHtml(category)}">${getCategoryIcon(category)}</span>`;
    const quantity = Math.max(1, Math.min(maxQuantity, Number(selectedItem.quantity) || 1));
    const meta = renderCartItemMeta(selectedItem) + (quantity > 1 ? ` ×${quantity}` : '');
    // ปุ่ม −/+ โชว์ทุกหมวดเพื่อความสม่ำเสมอของหน้าตา แต่จะกดเพิ่มได้จริง
    // เฉพาะแรมเท่านั้น (maxQuantity = 1 สำหรับหมวดอื่น ปุ่ม + จึงถูก disabled ตลอด)
    const quantityControls = `
      <div class="manual-quantity" role="group" aria-label="จำนวน${escapeHtml(label)}">
        <button type="button" class="manual-quantity-button" data-manual-quantity-dec="${category}" aria-label="ลดจำนวน${escapeHtml(label)}" ${quantity <= 1 ? 'disabled' : ''}>−</button>
        <span class="manual-quantity-value">${quantity}</span>
        <button type="button" class="manual-quantity-button" data-manual-quantity-inc="${category}" aria-label="เพิ่มจำนวน${escapeHtml(label)}" ${quantity >= maxQuantity ? 'disabled' : ''}>+</button>
      </div>
    `;

    return `
      <div class="manual-category manual-category-selected ${category === state.category ? 'active' : ''}">
        <button type="button" class="manual-category-browse" data-manual-category="${category}">
          <span class="cart-item-media">${image}</span>
          <span class="manual-name">
            <span class="cart-item-tags">
              <span class="tag tag-category">${escapeHtml(label)}</span>
              ${selectedItem.brand ? `<span class="tag tag-brand">${escapeHtml(selectedItem.brand)}</span>` : ''}
              ${renderManualStatusBadge(quantity, label, { showIcon: false, max: maxQuantity })}
            </span>
            <span class="cart-item-title-line">
              <strong>${escapeHtml(selectedItem.name)}</strong>
              ${meta ? `<small class="cart-item-meta">${meta}</small>` : ''}
            </span>
          </span>
        </button>
        <div class="manual-category-footer">
          <b>${formatCurrency(selectedItem.price * quantity)}</b>
          ${quantityControls}
          <button type="button" class="cart-item-remove" data-manual-remove="${category}" aria-label="ลบ ${escapeHtml(label)}">${manualTrashIcon}</button>
        </div>
      </div>
    `;
  }).join('');

  renderManualTotal();
}

// ยอดรวมของสเปคที่กำลังจัดเองอยู่ตอนนี้ (state.cartItems) - แสดงต่อจากแถว CPU
// Cooler แถวสุดท้ายในการ์ด "จัดสเปคเอง" (ตามที่ขอ) ก่อนถึงปุ่มบันทึก/รีเซตสเปค
// ซ่อนไว้เมื่อยังไม่มีสินค้าที่เลือกเลยสักชิ้น เพื่อไม่ให้ขึ้น "฿0" เปล่าๆ
function renderManualTotal() {
  if (!manualTotalEl || !manualTotalValueEl) {
    return;
  }

  if (!state.cartItems.length) {
    manualTotalEl.hidden = true;
  } else {
    manualTotalEl.hidden = false;
    manualTotalValueEl.textContent = formatCurrency(calculateCartTotal(state.cartItems));
  }

  renderManualShare();
}

// กล่องแชร์ลิงก์สาธารณะ วางไว้ใต้ "สรุปยอดรวม" ในการ์ด "จัดสเปคเอง" ตามที่ขอ
// แสดงตั้งแต่มีสินค้าในสเปคอย่างน้อย 1 ชิ้น โดยไม่ต้องกด "บันทึกสเปค" มาก่อน -
// ถ้ายังไม่เคยบันทึก จะเห็นปุ่ม "แชร์สเปคนี้แบบลิงก์สาธารณะ" ซึ่งกดแล้วจะบันทึก
// ให้อัตโนมัติแล้วเปิดแชร์ต่อเลย (ดู shareCurrentCart) ถ้าบันทึก/แชร์แล้วจะโชว์
// ลิงก์จริงแทน (renderShareSection เดียวกับที่ใช้ในหน้าประวัติ)
//
// เช็คบ็อกซ์ "ลงคลังสาธารณะ" ไม่ได้อยู่ในกล่องนี้ (manualShareEl) แล้ว - ย้ายไป
// เรนเดอร์ลง saveBuildListedEl แทน ซึ่งอยู่ในกล่อง save-build-panel เดียวกับ
// ปุ่ม "บันทึกสเปค" เอง (ติดกันจริงๆ ไม่มีช่องว่าง/กรอบคั่นระหว่างกล่อง)
function renderManualShare() {
  if (!manualShareEl) {
    return;
  }

  if (!state.cartItems.length) {
    manualShareEl.hidden = true;
    manualShareEl.innerHTML = '';

    if (saveBuildListedEl) {
      saveBuildListedEl.hidden = true;
      saveBuildListedEl.innerHTML = '';
    }

    return;
  }

  manualShareEl.hidden = false;

  if (saveBuildListedEl) {
    saveBuildListedEl.hidden = false;
    saveBuildListedEl.innerHTML = state.currentBuild
      ? renderListedToggle(state.currentBuild)
      : `
        <label class="saved-build-listed-toggle">
          <input type="checkbox" data-pending-listed ${state.pendingListed ? 'checked' : ''} />
          <span>แชร์ให้คนอื่นเห็นในหน้า "สเปคทั้งหมด"</span>
        </label>
      `;
  }

  if (state.currentBuild) {
    manualShareEl.innerHTML = renderShareSection(state.currentBuild);
    // สเปค (build) นี้เคยบันทึก/แชร์ไปแล้ว - ถ้าตะกร้าปัจจุบันเพิ่ง
    // เปลี่ยนไป (เพิ่ม/ลบของ) ให้อัปเดตขึ้น MySQL ของ build เดิมด้วย
    // เพื่อให้ลิงก์เดิมที่แชร์ไปแล้วเห็นสเปคล่าสุดเสมอ ไม่ใช่ภาพนิ่งค้าง
    scheduleCurrentBuildSync();
    return;
  }

  manualShareEl.innerHTML = `
    <div class="saved-build-share">
      <button class="secondary-button" type="button" data-share-current-cart>แชร์สเปคนี้แบบลิงก์สาธารณะ</button>
    </div>
  `;
}

// เช็คบ็อกซ์ "ลงคลังสาธารณะ" ของ build ที่มีอยู่แล้ว (มี id ในฐานข้อมูล) - แยกออกมา
// จาก renderShareSection ให้เป็นก้อนแยกต่างหาก วางไว้เหนือกล่องลิงก์แชร์เสมอ
// (ทั้งในการ์ด "จัดสเปคเอง" และหน้า "ประวัติ") ตามที่ขอ ไม่ให้จมอยู่ในกล่องลิงก์
function renderListedToggle(build) {
  return `
    <label class="saved-build-listed-toggle">
      <input type="checkbox" data-toggle-listed="${escapeHtml(build.id)}" ${build.listed ? 'checked' : ''} />
      <span>แชร์ให้คนอื่นเห็นในหน้า "สเปคทั้งหมด"</span>
    </label>
  `;
}

let currentBuildSyncTimer = null;

function scheduleCurrentBuildSync() {
  if (!state.currentBuild || !state.cartItems.length) {
    return;
  }

  clearTimeout(currentBuildSyncTimer);
  currentBuildSyncTimer = setTimeout(syncCurrentBuildWithCart, 400);
}

// PUT รายการล่าสุดของตะกร้าไปทับ build เดิมที่เคยบันทึก/แชร์ไปแล้ว (id และ
// share_token เดิมไม่เปลี่ยน) ทำงานเงียบๆ เบื้องหลัง ไม่โชว์ setCartStatus แข่งกับ
// ข้อความหลักของการเพิ่ม/ลบสินค้า - ถ้าซิงก์ไม่สำเร็จ (เช่นเน็ตหลุด) ผู้ใช้ยังกด
// "บันทึกสเปค" ซ้ำเพื่อสร้าง build ใหม่เองได้อยู่ดี
async function syncCurrentBuildWithCart() {
  const build = state.currentBuild;

  if (!build || !state.cartItems.length) {
    return;
  }

  const itemsToSync = state.cartItems;

  try {
    const data = await fetchJson(`/api/builds/${build.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: expandCartItemsForApi(itemsToSync), ownerToken: build.ownerToken || '' })
    });

    if (state.currentBuild === build) {
      build.total = data.build.total;
      build.items = itemsToSync;
    }

    const listed = state.savedBuildsById.get(String(build.id));

    if (listed && listed !== build) {
      listed.total = data.build.total;
      listed.items = itemsToSync;
    }

    if (String(state.selectedSavedBuildId) === String(build.id)) {
      renderSavedBuildDetail(build);
    }
  } catch {
    // เงียบไว้ตามคอมเมนต์ด้านบน
  }
}

function handleManualShareAction(event) {
  const shareToggleButton = event.target.closest('[data-toggle-share]');

  if (shareToggleButton) {
    toggleBuildSharing(shareToggleButton.dataset.toggleShare, shareToggleButton.dataset.shareEnable === '1');
    return;
  }

  const copyShareLinkButton = event.target.closest('[data-copy-share-link]');

  if (copyShareLinkButton) {
    copyShareLink(copyShareLinkButton.dataset.copyShareLink);
    return;
  }

  const listedToggleInput = event.target.closest('[data-toggle-listed]');

  if (listedToggleInput) {
    toggleBuildListed(listedToggleInput.dataset.toggleListed, listedToggleInput.checked);
    return;
  }

  // เช็คบ็อกซ์ "ลงคลังสาธารณะ" ที่โชว์อยู่เหนือปุ่ม "บันทึกสเปค" ตอนที่ยังไม่เคย
  // บันทึก build นี้เลย (ยังไม่มี id ให้เรียก API) - แค่จำค่าไว้ก่อน แล้วให้
  // persistCartAsBuild() ลงคลังให้อัตโนมัติทันทีที่กดบันทึกสำเร็จ
  const pendingListedInput = event.target.closest('[data-pending-listed]');

  if (pendingListedInput) {
    state.pendingListed = pendingListedInput.checked;
    return;
  }

  if (event.target.closest('[data-share-current-cart]')) {
    shareCurrentCart();
  }
}

// Builds the manual builder's current cart selections into the shape the
// /api/products?selected=... compatibility filter expects. Only categories
// that cross-affect the one currently being browsed matter here (see
// filterCompatibleProducts in builder.service.js) - memory/storage/PSU/
// monitor picks never narrow another category's list, so they're left out.
function buildCompatibilitySelection() {
  const selected = {};
  const cpu = getCartItemByCategory(state.cartItems, 'cpu');
  const motherboard = getCartItemByCategory(state.cartItems, 'motherboard');
  const videoCard = getCartItemByCategory(state.cartItems, 'video-card');
  const caseItem = getCartItemByCategory(state.cartItems, 'case');
  const cpuCooler = getCartItemByCategory(state.cartItems, 'cpu-cooler');

  if (cpu) {
    selected.cpu = cpu;
  }

  if (motherboard) {
    selected.motherboard = motherboard;
  }

  if (videoCard) {
    selected.videoCard = videoCard;
  }

  if (caseItem) {
    selected.case = caseItem;
  }

  if (cpuCooler) {
    selected.cpuCooler = cpuCooler;
  }

  return selected;
}

// ตัวกรองเฉพาะหมวดจอ: ช่อง "ร้านค้าในไทย" แสดงเฉพาะหมวด Monitor ส่วนช่อง "ซีรีส์/ซ็อกเก็ต"
// (ใช้กับ CPU/เมนบอร์ด/การ์ดจอ) ซ่อนในหมวดจอเพราะไม่มีความหมายกับจอ
function syncCategoryFilterVisibility() {
  const isMonitor = state.category === 'monitor';

  // หมวดจอมีช่องกรองมากกว่าหมวดอื่น (แบรนด์ + 4 สเปค + ปุ่มล้าง) ใช้ตารางแบบยืดหยุ่นแทนตาราง 3 ช่อง + ปุ่มแคบของหมวดอื่น
  filterForm.classList.toggle('filters-monitor', isMonitor);

  document.querySelectorAll('[data-filter-monitor-only]').forEach((element) => {
    element.hidden = !isMonitor;
  });
  document.querySelectorAll('[data-filter-not-monitor]').forEach((element) => {
    element.hidden = isMonitor;
  });
}

async function loadProducts() {
  syncCategoryFilterVisibility();
  productsEl.innerHTML = renderProductSkeletons();
  renderPagination(0);
  currentCategoryEl.textContent = state.category ? getCategoryLabel(state.category) : 'สินค้าทั้งหมด';

  const params = new URLSearchParams({
    limit: String(state.pageSize),
    offset: String((state.page - 1) * state.pageSize)
  });

  if (state.category) {
    params.set('category', state.category);

    const selected = buildCompatibilitySelection();

    if (Object.keys(selected).length) {
      params.set('selected', JSON.stringify(selected));
    }
  }

  if (state.search) {
    params.set('search', state.search);
  }

  for (const [key, value] of Object.entries(state.filters)) {
    // ตัวกรองสเปคจอ (Hz/ขนาด/ความละเอียด/ชนิดแผง) ใช้เฉพาะหมวดจอ และซีรีส์/ซ็อกเก็ตไม่ใช้กับจอ
    if (MONITOR_FILTER_KEYS.includes(key) && state.category !== 'monitor') {
      continue;
    }

    if ((key === 'series' || key === 'socket') && state.category === 'monitor') {
      continue;
    }

    if (value) {
      params.set(key, value);
    }
  }

  try {
    const data = await fetchJson(`/api/products?${params.toString()}`);
    const products = data.products || [];
    const total = Number(data.total ?? getFallbackProductTotal(products.length));
    state.productsByKey.clear();
    state.totalProducts = total;

    // The hero banner's count should read the whole visible catalog, not
    // whatever category/search is currently filtered - only update it from
    // the unfiltered "all products" load (state.category/search both
    // empty), same total already shown as "สินค้าทั้งหมด" right below it.
    if (heroProductCountEl && !state.category && !state.search) {
      heroProductCountEl.textContent = formatNumber(total);
    }

    if (currentCategoryCountEl) {
      currentCategoryCountEl.textContent = `${formatNumber(total)} รายการ`;
    }

    if (!products.length) {
      productsEl.innerHTML = createEmptyState({
        title: 'ไม่พบสินค้า',
        message: 'ลองเปลี่ยนคำค้นหา ล้างตัวกรอง หรือเลือกหมวดสินค้าอื่น'
      });
      renderPagination(total);
      return;
    }

    productsEl.innerHTML = products.map((product) => {
      state.productsByKey.set(getProductKey(product), product);
      return renderProductCard(product);
    }).join('');
    renderPagination(total);
  } catch {
    renderPagination(0);

    if (currentCategoryCountEl) {
      currentCategoryCountEl.textContent = '';
    }

    productsEl.innerHTML = createEmptyState({
      title: 'โหลดสินค้าไม่ได้',
      message: 'ตรวจสอบ MySQL หรือกดรีเฟรชเพื่อโหลดข้อมูลใหม่'
    });
  }
}

function resetProductPage() {
  state.page = 1;
}

function getFallbackProductTotal(currentCount) {
  if (state.category) {
    return state.categoryCounts.get(state.category) || currentCount;
  }

  const categoryTotal = Array.from(state.categoryCounts.values()).reduce((sum, count) => sum + count, 0);
  return categoryTotal || currentCount;
}

function handlePaginationAction(event) {
  const button = event.target.closest('[data-page]');

  if (!button || button.disabled) {
    return;
  }

  const nextPage = Number(button.dataset.page);

  if (!Number.isInteger(nextPage) || nextPage < 1 || nextPage === state.page) {
    return;
  }

  state.page = nextPage;
  loadProducts();
  productsEl.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function renderPagination(total) {
  if (!paginationEl) {
    return;
  }

  const pageCount = Math.ceil(Number(total || 0) / state.pageSize);

  if (pageCount <= 1) {
    paginationEl.hidden = true;
    paginationEl.innerHTML = '';
    return;
  }

  state.page = Math.min(state.page, pageCount);
  const pages = getVisiblePages(state.page, pageCount);
  const prevPage = Math.max(state.page - 1, 1);
  const nextPage = Math.min(state.page + 1, pageCount);

  paginationEl.hidden = false;
  paginationEl.innerHTML = `
    <button type="button" data-page="1" ${state.page === 1 ? 'disabled' : ''} aria-label="หน้าแรก">«</button>
    <button type="button" data-page="${prevPage}" ${state.page === 1 ? 'disabled' : ''} aria-label="หน้าก่อนหน้า">‹</button>
    ${pages.map((page) => `
      <button class="${page === state.page ? 'active' : ''}" type="button" data-page="${page}" ${page === state.page ? 'aria-current="page"' : ''}>
        ${page}
      </button>
    `).join('')}
    <button type="button" data-page="${nextPage}" ${state.page === pageCount ? 'disabled' : ''} aria-label="หน้าถัดไป">›</button>
    <button type="button" data-page="${pageCount}" ${state.page === pageCount ? 'disabled' : ''} aria-label="หน้าสุดท้าย">»</button>
  `;
}

function getVisiblePages(currentPage, pageCount) {
  const firstPage = Math.max(1, Math.min(currentPage - 1, pageCount - 2));
  const lastPage = Math.min(pageCount, firstPage + 2);

  return Array.from({ length: lastPage - firstPage + 1 }, (_, index) => firstPage + index);
}

async function submitBuildForm(event) {
  event.preventDefault();
  const formData = new FormData(buildForm);
  const payload = {
    mode: formData.get('mode'),
    cpuBrand: formData.get('cpuBrand'),
    budget: Number(formData.get('budget'))
  };

  buildResultEl.hidden = false;
  buildResultEl.innerHTML = createLoadingState('กำลังจัดสเปค...', 4);

  try {
    const data = await fetchJson('/api/build/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    renderBuildResult(data.build);
    setCartItems(data.build.items || [], 'เติมสเปคจากระบบอัตโนมัติแล้ว');
  } catch (error) {
    buildResultEl.innerHTML = createEmptyState({
      title: 'จัดสเปคไม่ได้',
      message: error.message || 'ตรวจสอบฐานข้อมูลหรือลองลดตัวกรอง CPU แล้วจัดใหม่'
    });
  }
}

function renderProductSkeletons() {
  return Array.from({ length: 8 }, () => `
    <article class="product-card product-card-loading" aria-hidden="true">
      <div class="product-image loading-box"></div>
      <span class="skeleton-line short"></span>
      <span class="skeleton-line"></span>
      <span class="skeleton-line medium"></span>
      <span class="loading-button"></span>
    </article>
  `).join('');
}

function renderBuildResult(build) {
  buildResultEl.innerHTML = `
    <div class="build-result-header">
      <div>
        <p class="eyebrow">${build.mode === 'gaming' ? 'เล่นเกม' : 'ทำงาน'} / CPU ${build.cpuBrand === 'auto' ? 'อัตโนมัติ' : build.cpuBrand}</p>
        <h3>สเปคที่ระบบแนะนำ</h3>
      </div>
      <div class="build-total">
        <span>รวม</span>
        <strong>${formatCurrency(build.total)}</strong>
      </div>
    </div>
    <div class="build-meta">
      <span>งบ ${formatCurrency(build.budget)}</span>
      ${build.socket ? `<span>Socket ${escapeHtml(build.socket)}</span>` : ''}
      ${build.memoryType ? `<span>RAM ${escapeHtml(build.memoryType)}</span>` : ''}
      ${build.motherboardFormFactor ? `<span>Mainboard ${escapeHtml(build.motherboardFormFactor)}</span>` : ''}
      ${build.caseSupport?.length ? `<span>Case ${escapeHtml(build.caseSupport.join(', '))}</span>` : ''}
      ${build.requiredPsuWattage ? `<span>PSU ขั้นต่ำ ${formatNumber(build.requiredPsuWattage)}W</span>` : ''}
      <span>${build.remaining >= 0 ? `เหลือ ${formatCurrency(build.remaining)}` : `เกินงบ ${formatCurrency(Math.abs(build.remaining))}`}</span>
    </div>
    ${renderCompatibilityReport(build.compatibility)}
    ${renderBuildItemsDiagram(build.items)}
  `;
}

function renderBuildItemsDiagram(items) {
  if (!items?.length) {
    return '';
  }

  const renderPoint = (item) => `
    <article class="build-item" data-category="${escapeHtml(item.category)}">
      <span>${getCategoryLabel(item.category)}</span>
      <div>
        <strong>${escapeHtml(item.name)}${renderItemDetail(item)}</strong>
        <b>${formatCurrency(item.price)}</b>
      </div>
    </article>
  `;

  // กลับไปเป็นเลย์เอาต์เดิม (ตามคำขอ "ทำกลับไปเป็นแบบเดิม"): 2 คอลัมน์
  // ซ้าย/ขวา + วงกลมไอคอนตรงกลาง ไม่มีภาพประกอบเคส ไม่มีเส้นชี้ - ใช้คลาส
  // เดิมที่มีอยู่แล้วใน main.css (.build-diagram/.build-col/.build-icon/
  // .build-item) ซึ่งไม่เคยถูกแก้เลยตลอดที่ผ่านมา จึงตรงกับดีไซน์ดั้งเดิม
  // ทุกประการ แบ่งรายการครึ่งแรกไปซ้าย ครึ่งหลังไปขวา ตามลำดับที่ backend
  // ส่งมา
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);

  return `
    <div class="build-diagram">
      <div class="build-col build-col-left">${left.map(renderPoint).join('')}</div>
      <div class="build-icon" aria-hidden="true">${getCategoryIcon('monitor')}</div>
      <div class="build-col build-col-right">${right.map(renderPoint).join('')}</div>
    </div>
  `;
}

function renderCompatibilityReport(report) {
  if (!report?.checks?.length) {
    return '';
  }

  const overall = report.status === 'pass'
    ? 'ผ่านทุกเงื่อนไขที่ตรวจสอบได้'
    : report.status === 'fail'
      ? `พบ ${formatNumber(report.failures)} จุดที่ไม่เข้ากัน`
      : `มี ${formatNumber(report.warnings)} รายการที่ควรตรวจสอบเพิ่ม`;

  const renderPoint = (check) => `
    <article class="compatibility-check is-${escapeHtml(check.status)}">
      <span>${check.status === 'pass' ? 'ผ่าน' : check.status === 'fail' ? 'ไม่ผ่าน' : 'ตรวจสอบ'}</span>
      <div><strong>${escapeHtml(formatCompatibilityLabel(check.id, check.label))}</strong><small>${escapeHtml(formatCompatibilityDetail(check.detail))}</small></div>
    </article>
  `;

  // เดิมแสดงเป็นกริด 2 คอลัมน์เฉยๆ เปลี่ยนเป็นไดอะแกรม: ไอคอนคอมพิวเตอร์ตรงกลาง
  // แล้วมีจุดรายละเอียด (ผลตรวจแต่ละข้อ) อยู่ซ้าย-ขวา พร้อมเส้นชี้เข้าหาไอคอน
  // ตรงกลาง ตามที่ขอ - แบ่งรายการซ้าย/ขวาแบบสมดุลกันแม้จำนวนข้อจะเปลี่ยนในอนาคต
  const half = Math.ceil(report.checks.length / 2);
  const leftChecks = report.checks.slice(0, half);
  const rightChecks = report.checks.slice(half);

  return `
    <section class="compatibility-report compatibility-${escapeHtml(report.status)}">
      <div class="compatibility-header">
        <div><p class="eyebrow">Compatibility</p><h4>ตรวจสอบความเข้ากันได้</h4></div>
        <strong>${overall}</strong>
      </div>
      <div class="compatibility-diagram">
        <div class="compatibility-col compatibility-col-left">
          ${leftChecks.map(renderPoint).join('')}
        </div>
        <div class="compatibility-icon" aria-hidden="true">${getCompatibilityIcon()}</div>
        <div class="compatibility-col compatibility-col-right">
          ${rightChecks.map(renderPoint).join('')}
        </div>
      </div>
    </section>
  `;
}

// ไอคอน "คอมพิวเตอร์ตั้งโต๊ะ" แบบจอ+เคสคอมพร้อมกัน ให้ดูเป็นคอมพิวเตอร์ชัดเจน
// กว่าไอคอนจอเปล่าๆ อันเดิม (ตามคำขอ "เปลี่ยน icon ใหม่ให้ดูเป็นคอมพิวเตอร์มากที่สุด")
function getCompatibilityIcon() {
  return `<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="1.5" y="4" width="13.5" height="10" rx="1.3"/>
    <path d="M5.5 21h5.5"/>
    <path d="M8.25 17.3V21"/>
    <rect x="17.3" y="6" width="5.2" height="12.5" rx="1"/>
    <path d="M18.9 9.2h2"/>
    <path d="M18.9 12.2h2"/>
    <circle cx="19.9" cy="16.3" r="0.55" fill="currentColor" stroke="none"/>
  </svg>`;
}

function formatCompatibilityLabel(id, fallback) {
  return ({
    'cpu-motherboard': 'CPU และ Mainboard',
    'memory-mainboard': 'RAM และ Mainboard',
    'psu-capacity': 'กำลังไฟ Power Supply',
    'case-mainboard': 'Case และ Mainboard'
  })[id] || fallback;
}

function formatCompatibilityDetail(detail) {
  return detail === 'Specification data is incomplete' ? 'ข้อมูลสเปคยังไม่ครบ ควรตรวจสอบกับผู้ผลิต' : detail;
}

const productAddCheckIcon = `
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false">
    <path d="M4 10.5l3.6 3.6L16 5.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
`;

function renderProductCard(product) {
  const productKey = getProductKey(product);
  const imageUrl = getSafeImageUrl(product.imageUrl);
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" />`
    : `<div class="image-placeholder" data-category="${escapeHtml(product.category)}">${getCategoryIcon(product.category)}<span>${escapeHtml(getCategoryLabel(product.category))}</span></div>`;
  const isMonitor = product.category === 'monitor';
  const specPills = isMonitor ? '' : renderSpecPills(product);
  const monitorSummary = isMonitor
    ? [Number(product.screenSizeInch) > 0 ? `${formatNumber(product.screenSizeInch)}"` : '', ...getMonitorSummaryParts(product)].filter(Boolean).join(' / ')
    : '';

  // การ์ดของสินค้าที่ตรงกับสินค้าที่เลือกไว้แล้วในหมวดนั้น (เทียบด้วย category:id
  // ผ่าน getProductKey) ให้ปุ่มเปลี่ยนเป็นสถานะยืนยัน "เพิ่มเข้าสเปคแล้ว" (มีเครื่องหมายถูก
  // กดซ้ำไม่ได้) แทนปุ่มเพิ่มปกติ
  const selectedItem = getCartItemByCategory(state.cartItems, product.category);
  const isSelected = Boolean(selectedItem) && getProductKey(selectedItem) === productKey;

  const actionMarkup = isSelected
    ? `
      <button type="button" class="product-add-button product-add-button-added" disabled>
        ${productAddCheckIcon}
        เพิ่มเข้าสเปคแล้ว
      </button>
    `
    : `<button type="button" class="product-add-button" data-add-product="${escapeHtml(productKey)}">เพิ่มเข้าสเปค</button>`;

  // ปุ่ม "ดูรายละเอียด" เปิด modal สเปคในตัวเว็บเอง (ไม่พาออกไปหน้าเว็บอื่น) - แสดงทุกการ์ด
  // ไม่ว่าจะถูกเพิ่มเข้าสเปคแล้วหรือยัง เพราะดึงข้อมูลจาก state.productsByKey ที่แคชไว้แล้ว
  // จึงไม่ต้องยิง API เพิ่ม
  const detailButton = `<button type="button" class="product-detail-trigger" data-view-details="${escapeHtml(productKey)}">ดูรายละเอียด</button>`;

  return `
    <article class="product-card ${isSelected ? 'product-card-selected' : ''}" data-product-key="${escapeHtml(productKey)}">
      <div class="product-image">${image}</div>
      <div class="product-tags">
        <span class="tag tag-category">${escapeHtml(getCategoryLabel(product.category))}</span>
        <span class="tag tag-brand">${escapeHtml(product.brand || 'ไม่ระบุแบรนด์')}</span>
      </div>
      <h3>${escapeHtml(product.name)}</h3>
      ${specPills ? `<div class="product-specs">${specPills}</div>` : ''}
      ${monitorSummary ? `<p class="product-spec-line">${escapeHtml(monitorSummary)}</p>` : ''}
      <div class="price">${formatCurrency(product.price)}</div>
      ${actionMarkup}
      ${detailButton}
    </article>
  `;
}

// เรียกทุกครั้งที่ตะกร้าเปลี่ยน (เพิ่ม/ลบ/โหลดสเปคเดิม) เพื่อให้การ์ดสินค้าที่โชว์
// อยู่ในหน้าเบราว์สสะท้อนสถานะ "เพิ่มเข้าสเปคแล้ว" ล่าสุด - ใช้ state.productsByKey
// ที่แคชไว้จากการโหลดหน้านี้แล้ว จึงไม่ต้องยิง API ซ้ำ (แค่ render ใหม่ฝั่ง client)
function refreshProductCards() {
  if (!productsEl || !state.productsByKey.size) {
    return;
  }

  if (!productsEl.querySelector('.product-card')) {
    return;
  }

  productsEl.innerHTML = [...state.productsByKey.values()].map((product) => renderProductCard(product)).join('');
}

function getSafeImageUrl(value) {
  const text = String(value || '').trim();

  if (!text) {
    return '';
  }

  try {
    const url = new URL(text, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function renderCart() {
  if (!cartItemsEl || !cartTotalEl) {
    localStorage.setItem('pc-build-cart', JSON.stringify(state.cartItems));
    return;
  }

  if (!state.cartItems.length) {
    cartItemsEl.innerHTML = createEmptyState({
      title: 'ยังไม่มีสินค้าในสเปค',
      message: 'เลือกหมวดด้านบนแล้วกดเพิ่มสินค้าเข้า cart'
    });
  } else {
    cartItemsEl.innerHTML = state.cartItems.map((item) => {
      const imageUrl = getSafeImageUrl(item.imageUrl);
      const image = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(item.name)}" loading="lazy" />`
        : `<div class="image-placeholder" data-category="${escapeHtml(item.category)}">${getCategoryIcon(item.category)}</div>`;
      const meta = renderCartItemMeta(item);

      return `
        <article class="cart-item">
          <div class="cart-item-media">${image}</div>
          <div class="cart-item-body">
            <div class="cart-item-tags">
              <span class="tag tag-category">${escapeHtml(getCategoryLabel(item.category))}</span>
              ${item.brand ? `<span class="tag tag-brand">${escapeHtml(item.brand)}</span>` : ''}
            </div>
            <strong>${escapeHtml(item.name)}</strong>
            ${meta ? `<p class="cart-item-meta">${meta}</p>` : ''}
            <div class="cart-item-footer">
              <b>${formatCurrency(item.price)}</b>
              <button type="button" class="cart-item-remove" data-remove-category="${escapeHtml(item.category)}" aria-label="ลบ ${escapeHtml(getCategoryLabel(item.category))}">ลบสินค้า</button>
            </div>
          </div>
        </article>
      `;
    }).join('');
  }

  cartTotalEl.textContent = formatCurrency(calculateCartTotal(state.cartItems));
  localStorage.setItem('pc-build-cart', JSON.stringify(state.cartItems));
}

// ความละเอียดจอ: ฐานข้อมูลเก็บเป็น [กว้าง, สูง] -> "1920 x 1080" (รับสตริงที่เป็นข้อความอยู่แล้วด้วย)
function formatMonitorResolution(value) {
  if (Array.isArray(value) && value.length >= 2 && Number(value[0]) > 0 && Number(value[1]) > 0) {
    return `${Number(value[0])} x ${Number(value[1])}`;
  }

  return typeof value === 'string' ? value.trim() : '';
}

// ข้อมูลสรุปของจอที่โชว์ใต้ชื่อสินค้าในการ์ด เช่น: IPS / 1920 x 1080 / 4ms / 60Hz / Aspect Ratio 16:9
// (เรียงเหมือนบรรทัดสรุปของหน้าร้านค้า; ค่าไหนไม่มีข้อมูลจะไม่แสดง ไม่เดา)
function getMonitorSummaryParts(item) {
  const parts = [];
  const resolution = formatMonitorResolution(item.resolution);

  if (item.panelType) {
    parts.push(String(item.panelType));
  }

  if (resolution) {
    parts.push(resolution);
  }

  if (Number(item.responseTimeMs) > 0) {
    parts.push(`${formatNumber(item.responseTimeMs)}ms`);
  }

  if (Number(item.refreshRate) > 0) {
    parts.push(`${formatNumber(item.refreshRate)}Hz`);
  }

  if (item.aspectRatio) {
    parts.push(`Aspect Ratio ${item.aspectRatio}`);
  }

  return parts;
}

function getSpecHighlights(item) {
  const parts = [];

  // จอ: ขนาด / ชนิดแผง / ความละเอียด / รีเฟรชเรต (สั้นพอสำหรับข้อความใต้ชื่อในตะกร้า)
  if (item.category === 'monitor') {
    if (Number(item.screenSizeInch) > 0) {
      parts.push(`${formatNumber(item.screenSizeInch)}"`);
    }

    if (item.panelType) {
      parts.push(String(item.panelType));
    }

    const resolution = formatMonitorResolution(item.resolution);

    if (resolution) {
      parts.push(resolution);
    }

    if (Number(item.refreshRate) > 0) {
      parts.push(`${formatNumber(item.refreshRate)}Hz`);
    }

    return parts;
  }

  if (item.category === 'memory' && item.memoryGb) {
    parts.push(`${formatNumber(item.memoryGb)} GB`);
  }

  if (item.memoryType) {
    parts.push(item.memoryType);
  }

  if (item.category === 'power-supply' && item.wattage) {
    parts.push(`${formatNumber(item.wattage)}W`);
  }

  if (item.category === 'motherboard' && item.formFactor) {
    parts.push(item.formFactor);
  }

  if (item.category === 'case' && item.caseType) {
    parts.push(item.caseType);
  }

  if (item.socket) {
    parts.push(item.socket);
  }

  return parts;
}

function renderCartItemMeta(item) {
  return getSpecHighlights(item).map((part) => escapeHtml(part)).join(' / ');
}

function renderSpecPills(item) {
  return getSpecHighlights(item)
    .map((part) => `<span class="tag tag-spec">${escapeHtml(part)}</span>`)
    .join('');
}

function handleProductAction(event) {
  const detailButton = event.target.closest('[data-view-details]');

  if (detailButton) {
    const product = state.productsByKey.get(detailButton.dataset.viewDetails);

    if (product) {
      openProductDetailModal(product);
    }

    return;
  }

  const button = event.target.closest('[data-add-product]');

  if (!button) {
    return;
  }

  const product = state.productsByKey.get(button.dataset.addProduct);

  if (!product) {
    return;
  }

  state.cartItems = addCartItem(state.cartItems, product);
  setCartStatus(`เพิ่ม ${getCategoryLabel(product.category)} เข้าสเปคแล้ว`);
  renderCart();
  renderManualCategories();
  refreshProductCards();
}

// กล่อง "ดูรายละเอียด" - โชว์สเปคเชิงลึกของสินค้าในตัวเว็บเอง (ไม่พาออกไปหน้าอื่น)
// อ่านจาก state.productsByKey ที่แคชไว้อยู่แล้วตอนโหลดรายการสินค้า จึงไม่ยิง API ซ้ำ
// ตารางสเปคเต็มจาก Banana (specs.banana_specs = [[ชื่อฟิลด์, ค่า], ...]) - ใช้แสดงตรงๆ แทนสเปคย่อยจากฐานข้อมูลเดิม
// ตรวจรูปแบบก่อนใช้: ต้องเป็นคู่ [ข้อความ, ข้อความ] อย่างน้อย 3 แถว ไม่งั้นถอยไปใช้สเปคเดิม
function getBananaSpecRows(product) {
  if (product.category === 'cpu' || !Array.isArray(product.bananaSpecs)) {
    return [];
  }

  // ไม่แสดงแถวการรับประกัน (Warranty) - ข้อมูลเดิมในฐานข้อมูลอาจมีแถวนี้อยู่แล้ว จึงกรองตอนแสดงผลด้วย
  const rows = product.bananaSpecs.filter(
    (row) =>
      Array.isArray(row) &&
      row.length >= 2 &&
      typeof row[0] === 'string' &&
      typeof row[1] === 'string' &&
      row[0] &&
      row[1] &&
      !/warranty|รับประกัน/i.test(row[0])
  );

  return rows.length >= 3 ? rows.map((row) => [row[0], row[1]]) : [];
}

function buildProductDetailSpecs(product) {
  const bananaRows = getBananaSpecRows(product);

  if (bananaRows.length) {
    return bananaRows;
  }

  const items = [];
  const category = product.category;
  const isCpu = category === 'cpu';
  const hasValue = (value) => value !== null && value !== undefined && value !== '' && value !== false;
  const add = (label, value) => {
    // ข้อความ "null" = ค่าว่างที่หลุดมาจากข้อมูลต้นทาง ไม่แสดง
    if (hasValue(value) && String(value).trim().toLowerCase() !== 'null') {
      items.push([label, String(value)]);
    }
  };

  // ---------- ทุกหมวด (CPU มีลำดับแถวของตัวเอง ดูด้านล่าง) ----------
  if (!isCpu) {
    add('Socket', product.socket);
  }

  // ---------- CPU ---------- (ลำดับและชื่อแถวเหมือนตารางสเปคของร้านค้า; แถวไหนไม่มีข้อมูลจะไม่แสดง ไม่เดา)
  if (isCpu) {
    const brand = String(product.brand ?? '').trim();
    add('CPU Brand', brand);
    add('CPU Series', /^(n\/a|na|-|—)$/i.test(String(product.cpuSeries ?? '').trim()) ? null : product.cpuSeries);
    // "Intel Core i5-12400F" -> "Core i5-12400F"
    add('CPU Model', String(product.name ?? '').replace(/^(intel|amd)\s+/i, '').trim());
    // ตัวอย่างในตารางร้านค้า: "AMD AM4" / "Intel LGA-1700" - เติมชื่อแบรนด์หน้า socket ถ้ายังไม่มี
    if (product.socket) {
      const socket = String(product.socket);
      add('CPU Socket Type', brand && !socket.toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ${socket}` : socket);
    }
    add('Core Name', product.microarchitecture);

    // รวมคอร์+เธรดเป็นบรรทัดเดียว เช่น "6 Core / 12 Threads" (ถ้าไม่มี threads ก็โชว์เฉพาะคอร์)
    // Threads มาจาก server/scripts/apply-cpu-detailed-specs.js - ไม่ใช่ทุกรุ่นจะมี (ดูหมายเหตุท้ายกล่อง)
    if (hasValue(product.coreCount)) {
      const cores = `${formatNumber(product.coreCount)} Core`;
      add('# of Cores', hasValue(product.threads) ? `${cores} / ${formatNumber(product.threads)} Threads` : cores);
    } else if (hasValue(product.threads)) {
      add('# of Threads', formatNumber(product.threads));
    }

    // รวมความเร็ว Base/Boost เป็นบรรทัดเดียว เช่น "2.5 GHz up to 4.4 GHz"
    if (product.coreClockGhz || product.boostClockGhz) {
      const base = product.coreClockGhz ? `${formatNumber(product.coreClockGhz)} GHz` : '';
      const boost = product.boostClockGhz ? `${formatNumber(product.boostClockGhz)} GHz` : '';
      add('Operating Frequency', base && boost ? `${base} up to ${boost}` : base || `Boost ${boost}`);
    }

    add('L1 Cache', product.l1Cache && formatCacheSize(product.l1Cache));
    add('L2 Cache', product.l2Cache && formatCacheSize(product.l2Cache));
    add('L3 Cache', product.l3Cache && formatCacheSize(product.l3Cache));
    // cacheText คือฟิลด์รวม (ส่วนใหญ่มาจากฝั่ง Intel ARK ซึ่งไม่แยก L2/L3) - โชว์เฉพาะตอนไม่มี L2/L3 แยก กันซ้ำซ้อน
    if (!product.l2Cache && !product.l3Cache) {
      add('Cache', product.cacheText);
    }

    // แถวเหล่านี้มีเฉพาะ CPU ที่ Banana ขายและอ่านตารางได้ (ดู apply-cpu-banana-extras.js)
    // Banana บางรุ่นเขียนค่าเป็น "N/A" (เช่น Ryzen 3 3200G ช่อง Manufacturing Tech) - ไม่มีข้อมูล จึงไม่แสดงแถวนั้น
    const addKnown = (label, value) => {
      if (!/^(n\/a|na|-|—)$/i.test(String(value ?? '').trim())) {
        add(label, value);
      }
    };
    addKnown('Manufacturing Tech', product.cpuProcess);
    addKnown('64Bit Support', product.cpu64bit);
    addKnown('Virtualization Technology Support', product.cpuVirtualization);

    add('Thermal Design Power', product.tdp && `${formatNumber(product.tdp)} W`);
    // สองแถวนี้ไม่มีในตารางของร้านค้า แต่เป็นข้อมูลที่เรามีและมีประโยชน์ตอนเลือกซื้อ
    add('Integrated Graphics', product.graphics);
    add('Thermal Solution', product.thermalSolution);
  }

  // ---------- เมนบอร์ด ----------
  if (category === 'motherboard') {
    add('ฟอร์มแฟคเตอร์ (Form Factor)', product.formFactor);
    add('จำนวนช่องแรม (Memory Slots)', hasValue(product.memorySlots) && `${formatNumber(product.memorySlots)} ช่อง`);
    add('แรมสูงสุด (Max Memory)', hasValue(product.maxMemoryGb) && `${formatNumber(product.maxMemoryGb)} GB`);
    add('สี (Color)', product.color);
  }

  // ---------- การ์ดจอ ----------
  if (category === 'video-card') {
    add('ชิปกราฟิก (Chipset)', product.chipset);
    add('หน่วยความจำ (VRAM)', hasValue(product.vramGb) && `${formatNumber(product.vramGb)} GB`);
    add('Core Clock', hasValue(product.gpuCoreClockMhz) && `${formatNumber(product.gpuCoreClockMhz)} MHz`);
    add('Boost Clock', hasValue(product.gpuBoostClockMhz) && `${formatNumber(product.gpuBoostClockMhz)} MHz`);
    add('ความยาวการ์ด (Length)', hasValue(product.gpuLength) && `${formatNumber(product.gpuLength)} mm`);
    add('สี (Color)', product.color);
  }

  // ---------- แรม ----------
  if (category === 'memory') {
    add('ชนิดและความเร็ว (Type / Speed)', product.memoryType && product.memorySpeedMhz ? `${product.memoryType}-${product.memorySpeedMhz}` : product.memoryType || (product.memorySpeedMhz && `${product.memorySpeedMhz} MHz`));
    add('ความจุรวม (Capacity)', hasValue(product.memoryGb) && `${formatNumber(product.memoryGb)} GB`);
    if (hasValue(product.memoryModuleCount) && hasValue(product.memoryModuleGb)) {
      add('จำนวนแท่ง (Modules)', `${formatNumber(product.memoryModuleCount)} x ${formatNumber(product.memoryModuleGb)} GB`);
    }
    add('CAS Latency', hasValue(product.casLatency) && `CL${product.casLatency}`);
    add('First Word Latency', hasValue(product.firstWordLatencyNs) && `${formatNumber(product.firstWordLatencyNs)} ns`);
    add('สี (Color)', product.color);
  }

  // ---------- ที่เก็บข้อมูล ----------
  if (category === 'internal-hard-drive') {
    const type = String(product.caseType ?? '');
    add('ชนิด (Type)', /^\d+$/.test(type) ? `HDD ${type} RPM` : type);
    add('ความจุ (Capacity)', hasValue(product.storageCapacityGb) && formatStorageCapacity(product.storageCapacityGb));
    const form = String(product.formFactor ?? '');
    add('ฟอร์มแฟคเตอร์ (Form Factor)', /^\d+(\.\d+)?$/.test(form) ? `${form}"` : form);
    add('อินเทอร์เฟซ (Interface)', product.storageInterface);
    add('แคช (Cache)', hasValue(product.storageCacheMb) && `${formatNumber(product.storageCacheMb)} MB`);
  }

  // ---------- พาวเวอร์ซัพพลาย ----------
  if (category === 'power-supply') {
    add('กำลังไฟ (Wattage)', hasValue(product.wattage) && `${formatNumber(product.wattage)} W`);
    add('มาตรฐานประหยัดไฟ (Efficiency)', formatPsuEfficiency(product.efficiency));
    add('ระบบสายไฟ (Modular)', formatPsuModular(product.modular));
    add('ขนาด (Form Factor)', product.caseType);
    add('สี (Color)', product.color);
  }

  // ---------- เคส ----------
  if (category === 'case') {
    add('ประเภทเคส (Type)', product.caseType);
    add('ฝาข้าง (Side Panel)', product.sidePanel);
    add('ปริมาตร (Volume)', hasValue(product.externalVolume) && `${formatNumber(product.externalVolume)} L`);
    add('ช่องใส่ฮาร์ดดิสก์ 3.5"', hasValue(product.internal35Bays) && `${formatNumber(product.internal35Bays)} ช่อง`);
    add('การ์ดจอยาวสุด (Max GPU Length)', hasValue(product.maxGpuLength) && `${formatNumber(product.maxGpuLength)} mm`);
    add('ฮีตซิงก์สูงสุด (Max CPU Cooler)', hasValue(product.maxCpuCoolerHeight) && `${formatNumber(product.maxCpuCoolerHeight)} mm`);
    add('พาวเวอร์ซัพพลายที่แถมมา', hasValue(product.includedPsuWatt) && `${formatNumber(product.includedPsuWatt)} W`);
    add('สี (Color)', product.color);
  }

  // ---------- จอมอนิเตอร์ ----------
  if (category === 'monitor') {
    add('ขนาดหน้าจอ (Screen Size)', Number(product.screenSizeInch) > 0 && `${formatNumber(product.screenSizeInch)} นิ้ว`);
    add('ชนิดแผงจอ (Panel Type)', product.panelType);
    add('ความละเอียด (Resolution)', formatMonitorResolution(product.resolution));
    add('รีเฟรชเรต (Refresh Rate)', Number(product.refreshRate) > 0 && `${formatNumber(product.refreshRate)} Hz`);
    add('เวลาตอบสนอง (Response Time)', Number(product.responseTimeMs) > 0 && `${formatNumber(product.responseTimeMs)} ms`);
    add('อัตราส่วนภาพ (Aspect Ratio)', product.aspectRatio);
  }

  // ---------- ชุดระบายความร้อน CPU ----------
  if (category === 'cpu-cooler') {
    // มีขนาดหม้อน้ำ = ชุดน้ำแน่นอน; ถ้าไม่มี ไม่ยืนยันว่าเป็นชุดลม (อาจเป็นชุดน้ำที่ข้อมูลต้นทางไม่ระบุขนาด) จึงไม่โชว์ชนิด
    add('ชนิด (Type)', hasValue(product.radiatorSize) && 'ระบายความร้อนด้วยน้ำ (Liquid)');
    add('ขนาดหม้อน้ำ (Radiator)', hasValue(product.radiatorSize) && `${formatNumber(product.radiatorSize)} mm`);
    add('ความสูง (Height)', hasValue(product.coolerHeight) && `${formatNumber(product.coolerHeight)} mm`);
    add('ความเร็วพัดลม (Fan Speed)', formatRange(product.rpm, 'RPM'));
    add('ระดับเสียง (Noise Level)', formatRange(product.noiseLevelDb, 'dB'));
    add('สี (Color)', product.color);
  }

  return items;
}

// ค่าที่เป็นช่วง เช่น [600, 3000] -> "600 - 3,000 RPM" ค่าเดี่ยว -> "1,550 RPM"
function formatRange(value, unit) {
  if (Array.isArray(value)) {
    const nums = value.filter((n) => n !== null && n !== undefined && n !== '');
    if (!nums.length) return null;
    const text = nums.length > 1 && nums[0] !== nums[nums.length - 1]
      ? `${formatNumber(nums[0])} - ${formatNumber(nums[nums.length - 1])}`
      : formatNumber(nums[0]);
    return `${text} ${unit}`;
  }
  return value !== null && value !== undefined && value !== '' ? `${formatNumber(value)} ${unit}` : null;
}

// ความจุจาก GB: 2000 -> "2 TB", 500 -> "500 GB"
function formatStorageCapacity(gb) {
  const value = Number(gb);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value >= 1000 ? `${Number((value / 1000).toFixed(2))} TB` : `${Number(value.toFixed(1))} GB`;
}

// ข้อมูลต้นทางเก็บเป็นคำสั้นๆ (gold/bronze/plus ...) แปลงเป็นชื่อมาตรฐาน 80 PLUS
function formatPsuEfficiency(value) {
  const map = { plus: '80+ (White)', bronze: '80+ Bronze', silver: '80+ Silver', gold: '80+ Gold', platinum: '80+ Platinum', titanium: '80+ Titanium' };
  const key = String(value ?? '').trim().toLowerCase();
  return key ? map[key] || String(value) : null;
}

// modular: "Full" / "Semi" / false (ไม่ถอดสาย) - ค่าว่างแปลว่าไม่มีข้อมูล ไม่ใช่ "ไม่ modular"
function formatPsuModular(value) {
  if (value === false) return 'Non-Modular (สายติดตาย)';
  if (typeof value !== 'string' || !value.trim()) return null;
  if (/^full$/i.test(value)) return 'Full Modular';
  if (/^semi$/i.test(value)) return 'Semi Modular';
  return value;
}

// "3MB" -> "3 MB" ให้อ่านง่ายเหมือนตารางของร้านค้า (ค่าที่ไม่เข้ารูปแบบนี้แสดงตามเดิม)
function formatCacheSize(value) {
  const match = String(value ?? '').trim().match(/^(\d+(?:\.\d+)?)\s*(KB|MB|GB)$/i);
  return match ? `${match[1]} ${match[2].toUpperCase()}` : String(value ?? '');
}

function openProductDetailModal(product) {
  if (!productDetailModalEl) {
    return;
  }

  const imageUrl = getSafeImageUrl(product.imageUrl);
  if (productDetailMediaEl) {
    productDetailMediaEl.innerHTML = imageUrl
      ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.name)}" loading="lazy" />`
      : `<div class="image-placeholder" data-category="${escapeHtml(product.category)}">${getCategoryIcon(product.category)}<span>${escapeHtml(getCategoryLabel(product.category))}</span></div>`;
  }

  if (productDetailTagsEl) {
    productDetailTagsEl.innerHTML = `
      <span class="tag tag-category">${escapeHtml(getCategoryLabel(product.category))}</span>
      <span class="tag tag-brand">${escapeHtml(product.brand || 'ไม่ระบุแบรนด์')}</span>
    `;
  }

  if (productDetailNameEl) {
    productDetailNameEl.textContent = product.name || '';
  }

  if (productDetailPriceEl) {
    productDetailPriceEl.textContent = formatCurrency(product.price);
  }

  const specs = buildProductDetailSpecs(product);
  if (productDetailSpecsEl) {
    productDetailSpecsEl.innerHTML = specs
      .map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
      .join('');
  }

  // ซีพียูบางตัวที่ยังไม่ได้ import สเปคเข้ามา (ดู server/scripts/apply-cpu-specs.js)
  // จะไม่มี specs อื่นนอกจาก Socket เลย - แจ้งให้รู้ตรงๆ แทนที่จะโชว์กล่องว่างเฉยๆ
  // สำหรับซีพียูที่ยังไม่เคยรัน apply-cpu-detailed-specs.js หรือรันแล้วแต่รุ่นนี้ไม่มี
  // ในชุดข้อมูลอ้างอิง (ดูคอมเมนต์หัวสคริปต์) จะไม่มี Threads/Cache/Thermal Solution เลย
  // แจ้งให้รู้ตรงๆ แทนที่จะให้ดูเหมือนลืมใส่
  if (productDetailNoteEl) {
    if (!specs.length) {
      productDetailNoteEl.textContent = 'ยังไม่มีข้อมูลสเปคเชิงลึกสำหรับสินค้านี้ในระบบ';
      productDetailNoteEl.hidden = false;
    } else if (product.category === 'cpu' && !product.threads) {
      productDetailNoteEl.textContent = 'หมายเหตุ: สินค้ารุ่นนี้ยังไม่มีข้อมูล Threads/Cache/ชุดระบายความร้อนในระบบ (ยังไม่พบในแหล่งข้อมูลอ้างอิงที่ใช้)';
      productDetailNoteEl.hidden = false;
    } else {
      productDetailNoteEl.textContent = '';
      productDetailNoteEl.hidden = true;
    }
  }

  productDetailModalEl.hidden = false;
  requestAnimationFrame(() => productDetailCloseButton?.focus());
}

function closeProductDetailModal() {
  if (productDetailModalEl) {
    productDetailModalEl.hidden = true;
  }
}

function handleCartAction(event) {
  const button = event.target.closest('[data-remove-category]');

  if (!button) {
    return;
  }

  state.cartItems = removeCartItem(state.cartItems, button.dataset.removeCategory);
  setCartStatus('ลบสินค้าออกจากสเปคแล้ว');
  renderCart();
  renderManualCategories();
  refreshProductCards();
}

function setCartItems(items, message) {
  // items ที่มาจากสเปคที่แชร์/บันทึกไว้ อาจมีแรม 2 แถวแยกกัน (ดูคอมเมนต์ที่
  // mergeDuplicateCartItems ใน build-cart.js) ต้องรวมกลับเป็นแถวเดียวก่อน ไม่งั้น
  // addCartItem จะทับกันเหลือแค่แถวเดียวแบบ quantity ผิด (นับเป็น 1 แทนที่จะเป็น 2)
  state.cartItems = mergeDuplicateCartItems(items).reduce((cart, item) => addCartItem(cart, item), []);
  setCartStatus(message);
  renderCart();
  renderManualCategories();
  refreshProductCards();
}

function clearCart() {
  state.cartItems = [];
  setCartStatus('ล้างสเปคแล้ว');
  renderCart();
  renderManualCategories();
  refreshProductCards();
}

function resetCurrentBuild() {
  state.category = '';
  state.search = '';
  state.filters = createEmptyFilters();
  state.cartItems = [];
  state.currentBuild = null;
  state.pendingListed = false;
  state.productsByKey.clear();
  searchForm.reset();
  filterForm.reset();
  buildForm.reset();

  if (buildResultEl) {
    buildResultEl.hidden = true;
    buildResultEl.innerHTML = '';
  }

  if (savedBuildResultEl) {
    savedBuildResultEl.hidden = true;
    savedBuildResultEl.innerHTML = '';
  }

  setCartStatus('เริ่มต้นสเปคใหม่แล้ว');
  renderCart();
  renderManualCategories();
  loadCategories();
  loadProductFilters();
  loadProducts();
}

async function saveCart() {
  await saveBuildToDatabase();
}

async function saveBuildToDatabase() {
  if (!state.user) {
    setCartStatus('กรุณาเข้าสู่ระบบก่อนบันทึกสเปค');
    setAuthModalStatus('เข้าสู่ระบบก่อนบันทึกสเปค');
    openAuthModal();
    return;
  }

  if (!state.cartItems.length) {
    setCartStatus('ยังไม่มีสินค้าให้บันทึก');
    return;
  }

  try {
    setSaveButtonLoading(true);
    const build = await persistCartAsBuild();
    const listedSuffix = build.listed ? ' และลงคลังสาธารณะแล้ว' : '';
    setCartStatus(`บันทึกสเปค #${build.id} แล้ว รวม ${formatCurrency(build.total)}${listedSuffix}`);
  } catch {
    setCartStatus('บันทึกลง MySQL ไม่สำเร็จ กรุณาตรวจสอบฐานข้อมูล');
  } finally {
    setSaveButtonLoading(false);
  }
}

// บันทึกสเปคปัจจุบัน (state.cartItems) เป็น build ในฐานข้อมูล แล้วเก็บไว้ที่
// state.currentBuild - ใช้ร่วมกันทั้งปุ่ม "บันทึกสเปค" ปกติ และปุ่มแชร์ลิงก์
// (ปุ่มแชร์เรียกอันนี้เองถ้ายังไม่เคยบันทึก จะได้ไม่ต้องกดบันทึกก่อนถึงจะแชร์ได้)
//
// saveToHistory: false เมื่อเรียกจากปุ่มแชร์ตรงๆ (shareCurrentCart) - ยังต้องสร้าง
// แถว build จริงในฐานข้อมูลเพื่อให้มี id/share_token ไว้แชร์ได้ แต่ผู้ใช้ไม่ได้ตั้งใจ
// จะ "บันทึก" มันเข้าหน้าประวัติ (หน้า "สเปคที่บันทึกไว้") เลยส่งค่านี้ไปให้เซิร์ฟเวอร์
// ซ่อนแถวนี้จากรายการประวัติ (ดู hiddenFromHistory ใน builds.service.js) ปุ่ม
// "บันทึกสเปค" ปกติไม่ส่ง option นี้เลย เลยเป็นค่าเริ่มต้น true ตามเดิมทุกอย่าง
async function persistCartAsBuild(options = {}) {
  const saveToHistory = options.saveToHistory !== false;
  const savedBuild = createSavedBuild(state.cartItems);
  localStorage.setItem('pc-build-saved', JSON.stringify(savedBuild));

  setCartStatus('กำลังบันทึกสเปคลง MySQL...');
  const data = await fetchJson('/api/builds', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `SpecCraft ${new Date().toLocaleString('th-TH')}`,
      mode: new FormData(buildForm).get('mode') || 'manual',
      items: expandCartItemsForApi(state.cartItems),
      saveToHistory
    })
  });

  renderSavedBuildResult(data.build);
  await loadSavedBuilds();
  state.currentBuild = state.savedBuildsById.get(String(data.build.id)) || data.build;

  // ถ้าติ๊ก "ลงคลังสาธารณะ" ไว้ก่อนกดบันทึก (เช็คบ็อกซ์ที่โชว์เหนือปุ่ม "บันทึกสเปค"
  // ตอนที่ยังไม่เคยบันทึก build นี้เลย) ให้ลงคลังให้อัตโนมัติทันทีที่บันทึกเสร็จ -
  // ผู้ใช้กดติ๊กแล้วกดบันทึกทีเดียวจบ ไม่ต้องมาติ๊กซ้ำอีกรอบทีหลัง
  if (state.pendingListed) {
    state.pendingListed = false;
    await toggleBuildListed(state.currentBuild.id, true);
  }

  renderManualShare();
  return state.currentBuild;
}

// กดปุ่มแชร์ตรงๆ จากการ์ด "จัดสเปคเอง" โดยยังไม่เคยกด "บันทึกสเปค" มาก่อน
// เลยต้องบันทึกให้อัตโนมัติก่อน 1 ครั้ง แล้วค่อยเปิดแชร์ต่อเลย ผู้ใช้ไม่ต้องกด 2 รอบ
// ใช้ได้ทั้งคนที่ล็อกอินแล้วและคนที่จัดสเปคแบบไม่ล็อกอิน (ไม่บังคับล็อกอินเหมือน
// ปุ่ม "บันทึกสเปค" ปกติ) เพราะ persistCartAsBuild บันทึกได้แม้ไม่มีบัญชี แล้วฝั่ง
// เซิร์ฟเวอร์จะแจก ownerToken กลับมาแทนให้ใช้พิสูจน์ตัวตนตอนแชร์/ยกเลิกแชร์ทีหลัง
async function shareCurrentCart() {
  if (!state.cartItems.length) {
    setCartStatus('ยังไม่มีสินค้าให้แชร์');
    return;
  }

  try {
    const build = state.currentBuild || (await persistCartAsBuild({ saveToHistory: false }));
    await toggleBuildSharing(build.id, true);
  } catch (error) {
    setCartStatus(error.message || 'แชร์สเปคไม่สำเร็จ');
  }
}

async function loadSavedBuilds() {
  if (!savedBuildListEl) {
    return;
  }

  if (!state.user) {
    savedBuildListEl.innerHTML = createEmptyState({
      title: 'เข้าสู่ระบบเพื่อดูสเปคของคุณ',
      message: 'สมัครสมาชิกหรือล็อกอิน แล้วระบบจะแสดงเฉพาะสเปคที่คุณบันทึกไว้'
    });
    savedBuildPaginationEl?.setAttribute('hidden', '');
    return;
  }

  savedBuildListEl.innerHTML = createLoadingState('กำลังโหลดสเปคที่บันทึกไว้...', 3);

  try {
    const params = new URLSearchParams({
      limit: String(state.savedBuildPageSize),
      offset: String((state.savedBuildPage - 1) * state.savedBuildPageSize)
    });
    const data = await fetchJson(`/api/builds?${params.toString()}`);
    state.savedBuildTotal = Number(data.total || 0);
    const totalPages = Math.max(1, Math.ceil(state.savedBuildTotal / state.savedBuildPageSize));

    if (state.savedBuildPage > totalPages) {
      state.savedBuildPage = totalPages;
      await loadSavedBuilds();
      return;
    }

    renderSavedBuildList(data.builds || []);
    renderSavedBuildPagination();
  } catch {
    savedBuildPaginationEl?.setAttribute('hidden', '');
    savedBuildListEl.innerHTML = createEmptyState({
      title: 'โหลดสเปคที่บันทึกไว้ไม่ได้',
      message: 'ตรวจสอบ MySQL แล้วกดรีเฟรชอีกครั้ง'
    });
  }
}

function renderSavedBuildList(builds) {
  state.savedBuildsById = new Map(builds.map((build) => [String(build.id), build]));

  if (!builds.length) {
    savedBuildListEl.innerHTML = createEmptyState({
      title: 'ยังไม่มีสเปคที่บันทึกไว้',
      message: 'จัดสเปคหรือเลือกสินค้าเอง แล้วกดบันทึกลง MySQL'
    });
    return;
  }

  savedBuildListEl.innerHTML = builds.map((build) => {
    const itemCount = Array.isArray(build.items) ? build.items.length : 0;
    const createdAt = build.createdAt ? formatDateTime(build.createdAt) : '';

    return `
      <article class="saved-build-card" data-saved-build-id="${escapeHtml(build.id)}" role="button" tabindex="0" aria-label="เปิดรายละเอียด ${escapeHtml(build.name || `Build #${build.id}`)}">
        <div>
          <p>${escapeHtml(build.mode || 'manual')}${createdAt ? ` / ${escapeHtml(createdAt)}` : ''}</p>
          <h3>${escapeHtml(build.name || `Build #${build.id}`)}</h3>
          ${state.user?.username ? `<p class="muted saved-build-owner">โดย ${escapeHtml(state.user.username)}</p>` : ''}
          <span>${formatNumber(itemCount)} รายการ</span>
        </div>
        <strong>${formatCurrency(build.total)}</strong>
        <div class="saved-build-actions">
          <button type="button" data-print-saved-build="${escapeHtml(build.id)}">พิมพ์ PDF</button>
          <button type="button" data-delete-saved-build="${escapeHtml(build.id)}">ลบ</button>
        </div>
      </article>
    `;
  }).join('');

  updateSavedBuildHistoryView();
}

function renderSavedBuildPagination() {
  if (!savedBuildPaginationEl) {
    return;
  }

  const pageCount = Math.ceil(state.savedBuildTotal / state.savedBuildPageSize);

  if (pageCount <= 1) {
    savedBuildPaginationEl.hidden = true;
    savedBuildPaginationEl.innerHTML = '';
    return;
  }

  const pages = getVisiblePages(state.savedBuildPage, pageCount);
  savedBuildPaginationEl.hidden = false;
  savedBuildPaginationEl.innerHTML = `
    ${pages.map((page) => `<button class="${page === state.savedBuildPage ? 'active' : ''}" type="button" data-saved-build-page="${page}" ${page === state.savedBuildPage ? 'aria-current="page"' : ''}>${page}</button>`).join('')}
    <button type="button" data-saved-build-page="${Math.min(state.savedBuildPage + 1, pageCount)}" ${state.savedBuildPage === pageCount ? 'disabled' : ''} aria-label="หน้าถัดไป">›</button>
    <button type="button" data-saved-build-page="${pageCount}" ${state.savedBuildPage === pageCount ? 'disabled' : ''} aria-label="หน้าสุดท้าย">»</button>
  `;
}

function handleSavedBuildAction(event) {
  const pageButton = event.target.closest('[data-saved-build-page]');

  if (pageButton && !pageButton.disabled) {
    const page = Number(pageButton.dataset.savedBuildPage);

    if (Number.isInteger(page) && page > 0 && page !== state.savedBuildPage) {
      state.savedBuildPage = page;
      state.selectedSavedBuildId = '';
      loadSavedBuilds();
    }
    return;
  }

  const deleteButton = event.target.closest('[data-delete-saved-build]');

  if (deleteButton) {
    deleteSavedBuild(deleteButton.dataset.deleteSavedBuild);
    return;
  }

  const printButton = event.target.closest('[data-print-saved-build]');

  if (printButton) {
    printSavedBuild(printButton.dataset.printSavedBuild);
    return;
  }

  const shareToggleButton = event.target.closest('[data-toggle-share]');

  if (shareToggleButton) {
    toggleBuildSharing(shareToggleButton.dataset.toggleShare, shareToggleButton.dataset.shareEnable === '1');
    return;
  }

  const copyShareLinkButton = event.target.closest('[data-copy-share-link]');

  if (copyShareLinkButton) {
    copyShareLink(copyShareLinkButton.dataset.copyShareLink);
    return;
  }

  const listedToggleInput = event.target.closest('[data-toggle-listed]');

  if (listedToggleInput) {
    toggleBuildListed(listedToggleInput.dataset.toggleListed, listedToggleInput.checked);
    return;
  }

  if (event.target.closest('[data-history-back]')) {
    showSavedBuildList();
    return;
  }

  const card = event.target.closest('[data-saved-build-id]');

  if (card) {
    showSavedBuildDetail(card.dataset.savedBuildId);
  }
}

function handleSavedBuildKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  if (event.target.closest('[data-print-saved-build], [data-delete-saved-build]')) {
    return;
  }

  const card = event.target.closest('[data-saved-build-id]');

  if (!card) {
    return;
  }

  event.preventDefault();
  showSavedBuildDetail(card.dataset.savedBuildId);
}

async function deleteSavedBuild(buildId) {
  const build = state.savedBuildsById.get(String(buildId));

  if (!build || !(await confirmDialog(`ลบ ${build.name || `Build #${build.id}`} หรือไม่`))) {
    return;
  }

  try {
    await fetchJson(`/api/builds/${build.id}`, { method: 'DELETE' });
    state.selectedSavedBuildId = '';
    setCartStatus('ลบสเปคที่บันทึกไว้แล้ว');
    await loadSavedBuilds();
  } catch (error) {
    setCartStatus(error.message || 'ลบสเปคไม่สำเร็จ');
  }
}

function showSavedBuildDetail(buildId) {
  const build = state.savedBuildsById.get(String(buildId));

  if (!build) {
    return;
  }

  state.selectedSavedBuildId = String(build.id);
  window.location.hash = `history/${state.selectedSavedBuildId}`;
  updateSavedBuildHistoryView();
}

function showSavedBuildList() {
  state.selectedSavedBuildId = '';
  window.location.hash = 'history';
  updateSavedBuildHistoryView();
}

function updateSavedBuildHistoryView() {
  if (!savedBuildListEl || !savedBuildDetailEl) {
    return;
  }

  const build = state.savedBuildsById.get(String(state.selectedSavedBuildId));
  const isDetailVisible = Boolean(build);

  savedBuildListEl.hidden = isDetailVisible;
  savedBuildDetailEl.hidden = !isDetailVisible;
  saveBuildStatusEl?.toggleAttribute('hidden', isDetailVisible);

  if (isDetailVisible) {
    renderSavedBuildDetail(build);
  }
}

function renderSavedBuildDetail(build) {
  const createdAt = build.createdAt ? formatDateTime(build.createdAt) : '';
  const items = sortItemsByCategoryOrder(mergeDuplicateCartItems(Array.isArray(build.items) ? build.items : []));

  savedBuildDetailEl.innerHTML = `
    <div class="saved-build-detail-header">
      <div>
        <button class="history-back-button" type="button" data-history-back>กลับไปประวัติ</button>
        <p class="eyebrow">${escapeHtml(build.mode || 'manual')}${createdAt ? ` / ${escapeHtml(createdAt)}` : ''}</p>
        <h2>${escapeHtml(build.name || `Build #${build.id}`)}</h2>
      </div>
      <div class="saved-build-actions">
        <button class="secondary-button" type="button" data-print-saved-build="${escapeHtml(build.id)}">พิมพ์ PDF</button>
        <button class="secondary-button" type="button" data-delete-saved-build="${escapeHtml(build.id)}">ลบ</button>
      </div>
    </div>
    ${renderListedToggle(build)}
    ${renderShareSection(build)}
    <div class="saved-build-detail-table-wrap">
      <table class="saved-build-detail-table">
        <thead>
          <tr>
            <th>หมวดหมู่</th>
            <th>สินค้า</th>
            <th>ราคา</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const quantity = Math.max(1, Math.min(MAX_CART_ITEM_QUANTITY, Number(item.quantity) || 1));

            return `
            <tr>
              <td data-label="หมวดหมู่">${escapeHtml(getCategoryLabel(item.category))}</td>
              <td data-label="สินค้า">${escapeHtml(item.name || '-')}${quantity > 1 ? ` ×${quantity}` : ''}</td>
              <td data-label="ราคา">${formatCurrency(item.price * quantity)}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <th colspan="2">ราคารวม</th>
            <td>${formatCurrency(build.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function getHistoryBuildIdFromHash() {
  const match = window.location.hash.match(/^#history\/(\d+)$/);
  return match ? match[1] : '';
}

// ---- ระบบแชร์สเปคแบบลิงก์สาธารณะ (เจ้าของสเปคเปิด/ปิดแชร์ + คัดลอกลิงก์) ----

function renderShareSection(build) {
  // เช็คบ็อกซ์ "ลงคลังสาธารณะ" ไม่ได้อยู่ในกล่องนี้แล้ว - ย้ายออกไปเป็น
  // renderListedToggle() ต่างหาก วางไว้เหนือกล่องลิงก์แชร์นี้เสมอ (ดูจุดที่เรียก
  // renderShareSection ทั้งใน renderManualShare และ renderSavedBuildDetail)
  if (build.shareToken) {
    return `
      <div class="saved-build-share saved-build-share-active">
        <span>ลิงก์แชร์สาธารณะ</span>
        <input type="text" readonly value="${escapeHtml(buildPublicShareUrl(build.shareToken))}" onclick="this.select()" />
        <button class="secondary-button" type="button" data-copy-share-link="${escapeHtml(build.shareToken)}">คัดลอกลิงก์</button>
        <button class="text-button" type="button" data-toggle-share="${escapeHtml(build.id)}" data-share-enable="0">ยกเลิกการแชร์</button>
      </div>
    `;
  }

  return `
    <div class="saved-build-share">
      <button class="secondary-button" type="button" data-toggle-share="${escapeHtml(build.id)}" data-share-enable="1">แชร์สเปคนี้แบบลิงก์สาธารณะ</button>
    </div>
  `;
}

function buildPublicShareUrl(token) {
  return `${window.location.origin}${window.location.pathname}#public/${encodeURIComponent(token)}`;
}

async function toggleBuildSharing(buildId, enable) {
  const isCurrentBuild = String(state.currentBuild?.id) === String(buildId);
  const build = state.savedBuildsById.get(String(buildId)) || (isCurrentBuild ? state.currentBuild : null);

  if (!build) {
    return;
  }

  try {
    // ownerToken เป็นค่าว่างเปล่าสำหรับคนที่ล็อกอินแล้ว (เซิร์ฟเวอร์เช็คจาก session
    // แทน) แต่จำเป็นสำหรับคนจัดสเปคแบบไม่ล็อกอิน เพื่อพิสูจน์ว่าเป็นเจ้าของ build นี้จริง
    const requestBody = JSON.stringify({ ownerToken: build.ownerToken || '' });

    if (enable) {
      const data = await fetchJson(`/api/builds/${build.id}/share`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });
      build.shareToken = data.shareToken;
      setCartStatus('เปิดแชร์สเปคนี้แล้ว คัดลอกลิงก์ไปส่งต่อได้เลย');
    } else {
      await fetchJson(`/api/builds/${build.id}/share`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });
      build.shareToken = null;
      // ยกเลิกแชร์แล้วเซิร์ฟเวอร์ถอดออกจากคลังสาธารณะให้อัตโนมัติด้วย (ดู
      // disableBuildSharing ใน builds.service.js) - เคลียร์ค่าฝั่งนี้ให้ตรงกัน
      build.listed = false;
      setCartStatus('ยกเลิกการแชร์สเปคนี้แล้ว ลิงก์เดิมใช้ไม่ได้อีกต่อไป');
    }

    if (isCurrentBuild && state.currentBuild !== build) {
      state.currentBuild.shareToken = build.shareToken;
      state.currentBuild.listed = build.listed;
    }

    if (String(state.selectedSavedBuildId) === String(build.id)) {
      renderSavedBuildDetail(build);
    }

    if (isCurrentBuild) {
      renderManualShare();
    }
  } catch (error) {
    setCartStatus(error.message || 'ทำรายการไม่สำเร็จ');
  }
}

// "ลงคลังสาธารณะ" - แยกอิสระจาก toggleBuildSharing ด้านบน (ดูคอมเมนต์ที่
// renderShareSection และ setBuildListed ใน builds.service.js)
async function toggleBuildListed(buildId, isListed) {
  const isCurrentBuild = String(state.currentBuild?.id) === String(buildId);
  const build = state.savedBuildsById.get(String(buildId)) || (isCurrentBuild ? state.currentBuild : null);

  if (!build) {
    return;
  }

  try {
    const requestBody = JSON.stringify({ ownerToken: build.ownerToken || '' });

    if (isListed) {
      const data = await fetchJson(`/api/builds/${build.id}/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });
      build.listed = true;
      // อาจได้ share_token กลับมาใหม่ด้วย ถ้ายังไม่เคยแชร์ลิงก์มาก่อน (เซิร์ฟเวอร์สร้าง
      // ให้อัตโนมัติ) อัปเดตให้ตรงกันเพื่อให้กล่องลิงก์แชร์โผล่มาด้วยทันที
      build.shareToken = data.shareToken || build.shareToken;
      setCartStatus('เพิ่มสเปคนี้ลงคลังสาธารณะแล้ว');
    } else {
      await fetchJson(`/api/builds/${build.id}/list`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: requestBody
      });
      build.listed = false;
      setCartStatus('นำสเปคนี้ออกจากคลังสาธารณะแล้ว');
    }

    if (isCurrentBuild && state.currentBuild !== build) {
      state.currentBuild.listed = build.listed;
      state.currentBuild.shareToken = build.shareToken;
    }

    if (String(state.selectedSavedBuildId) === String(build.id)) {
      renderSavedBuildDetail(build);
    }

    if (isCurrentBuild) {
      renderManualShare();
    }
  } catch (error) {
    setCartStatus(error.message || 'ทำรายการไม่สำเร็จ');

    // ทำรายการไม่สำเร็จ - เรนเดอร์ใหม่ให้เช็คบ็อกซ์กลับไปตรงกับสถานะจริง (เบราว์เซอร์
    // ติ๊ก/ปลดติ๊กให้เองไปแล้วตอนคลิก ก่อนโค้ดส่วนนี้จะรู้ว่าสำเร็จหรือไม่)
    if (String(state.selectedSavedBuildId) === String(build.id)) {
      renderSavedBuildDetail(build);
    }

    if (isCurrentBuild) {
      renderManualShare();
    }
  }
}

async function copyShareLink(token) {
  const url = buildPublicShareUrl(token);

  try {
    await navigator.clipboard.writeText(url);
    setCartStatus('คัดลอกลิงก์แชร์แล้ว');
  } catch {
    window.prompt('คัดลอกลิงก์นี้ไปแชร์ได้เลย', url);
  }
}

// ---- หน้าดูสเปคที่คนอื่นแชร์ลิงก์มาให้ (ไม่ต้องล็อกอิน) ----

async function loadPublicBuild(token) {
  if (!publicBuildEl) {
    return;
  }

  if (!token) {
    publicBuildEl.innerHTML = createEmptyState({
      title: 'ไม่พบลิงก์ที่แชร์',
      message: 'ลิงก์นี้ไม่ถูกต้อง'
    });
    return;
  }

  publicBuildEl.innerHTML = createLoadingState('กำลังโหลดสเปคที่แชร์...', 4);

  try {
    const data = await fetchJson(`/api/public/builds/${encodeURIComponent(token)}`);
    renderPublicBuild(data.build);
  } catch {
    publicBuildEl.innerHTML = createEmptyState({
      title: 'ไม่พบสเปคที่แชร์',
      message: 'ลิงก์นี้อาจถูกยกเลิกการแชร์ไปแล้ว หรือไม่มีอยู่จริง'
    });
  }
}

function renderPublicBuild(build) {
  const items = sortItemsByCategoryOrder(mergeDuplicateCartItems(Array.isArray(build.items) ? build.items : []));

  publicBuildEl.innerHTML = `
    <div class="saved-build-detail-header">
      <div>
        <button class="history-back-button" type="button" data-public-build-back>กลับไปสเปคทั้งหมด</button>
        <p class="eyebrow">สเปคที่มีคนแชร์ให้คุณ</p>
        <h2>${escapeHtml(build.name || `Build #${build.id}`)}</h2>
      </div>
      <div class="saved-build-actions">
        <button class="secondary-button" type="button" data-copy-public-build-link>คัดลอกลิงก์</button>
        <button class="primary-button" type="button" data-copy-public-build>นำสเปคนี้ไปจัดต่อ</button>
      </div>
    </div>
    <div class="saved-build-detail-table-wrap">
      <table class="saved-build-detail-table">
        <thead>
          <tr>
            <th>หมวดหมู่</th>
            <th>สินค้า</th>
            <th>ราคา</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => {
            const quantity = Math.max(1, Math.min(MAX_CART_ITEM_QUANTITY, Number(item.quantity) || 1));

            return `
            <tr>
              <td data-label="หมวดหมู่">${escapeHtml(getCategoryLabel(item.category))}</td>
              <td data-label="สินค้า">${escapeHtml(item.name || '-')}${quantity > 1 ? ` ×${quantity}` : ''}</td>
              <td data-label="ราคา">${formatCurrency(item.price * quantity)}</td>
            </tr>
          `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr>
            <th colspan="2">ราคารวม</th>
            <td>${formatCurrency(build.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;

  publicBuildEl.querySelector('[data-copy-public-build]')?.addEventListener('click', () => {
    setCartItems(items, 'เติมสเปคจากลิงก์ที่แชร์แล้ว');
    setView('products');
  });

  // คัดลอกลิงก์หน้านี้ตรงๆ (window.location.href ตอนนี้คือลิงก์ #public/<token>
  // ที่ถูกต้องอยู่แล้ว เพราะ setView ตั้ง hash ไว้ก่อนเรียก loadPublicBuild/
  // renderPublicBuild เสมอ) ใช้ pattern เดียวกับ copyShareLink ด้านล่าง
  publicBuildEl.querySelector('[data-copy-public-build-link]')?.addEventListener('click', async () => {
    const url = window.location.href;

    try {
      await navigator.clipboard.writeText(url);
      setCartStatus('คัดลอกลิงก์แล้ว');
    } catch {
      window.prompt('คัดลอกลิงก์นี้ไปแชร์ได้เลย', url);
    }
  });

  // ปุ่มย้อนกลับ - ตอนก่อนหน้านี้กดเข้ามาจากการ์ดในหน้า "สเปคทั้งหมด" (gallery) แล้ว
  // ไม่มีทางกลับเลย (ผู้ใช้แจ้งว่าเข้ามาแล้วออกไม่ได้) พากลับไปหน้า gallery เสมอ ถึงแม้
  // จะมาจากลิงก์แชร์ตรงๆ (ไม่ได้ผ่าน gallery มาก่อน) ก็ยังเป็นปลายทางที่สมเหตุสมผลกว่า
  // ปล่อยให้ค้างอยู่หน้านี้ - ดูปุ่มแบบเดียวกันที่ data-history-back/showSavedBuildList
  publicBuildEl.querySelector('[data-public-build-back]')?.addEventListener('click', () => {
    setView('gallery');
  });
}

// ---- คลังสาธารณะ (public gallery) - รวมสเปคที่ถูกกด "ลงคลัง" ไว้ ใครก็ดูได้
// ไม่ต้องล็อกอิน ต่างจาก "ประวัติ" ที่เห็นเฉพาะสเปคของตัวเอง ----

async function loadPublicGallery() {
  if (!galleryListEl) {
    return;
  }

  galleryListEl.innerHTML = createLoadingState('กำลังโหลดสเปคทั้งหมด...', 4);

  try {
    const params = new URLSearchParams({
      limit: String(state.galleryPageSize),
      offset: String((state.galleryPage - 1) * state.galleryPageSize)
    });
    const data = await fetchJson(`/api/public/builds?${params.toString()}`);
    state.galleryTotal = Number(data.total || 0);
    const totalPages = Math.max(1, Math.ceil(state.galleryTotal / state.galleryPageSize));

    if (state.galleryPage > totalPages) {
      state.galleryPage = totalPages;
      await loadPublicGallery();
      return;
    }

    renderGalleryList(data.builds || []);
    renderGalleryPagination();
  } catch {
    galleryPaginationEl?.setAttribute('hidden', '');
    galleryListEl.innerHTML = createEmptyState({
      title: 'โหลดสเปคทั้งหมดไม่ได้',
      message: 'ตรวจสอบ MySQL แล้วกดรีเฟรชอีกครั้ง'
    });
  }
}

function renderGalleryList(builds) {
  if (!builds.length) {
    galleryListEl.innerHTML = createEmptyState({
      title: 'ยังไม่มีสเปคในหน้าสเปคทั้งหมด',
      message: 'กด "ลงคลังสาธารณะ" ตอนแชร์สเปคของคุณ แล้วมันจะมาโชว์ที่นี่'
    });
    return;
  }

  galleryListEl.innerHTML = builds.map((build) => {
    const itemCount = Number(build.itemCount || 0);
    const categories = Array.isArray(build.categories) ? build.categories : [];
    // แรม 2 ชิ้นเก็บเป็น 2 แถวแยกกันฝั่งฐานข้อมูล (ดูคอมเมนต์ที่
    // expandCartItemsForApi ใน build-cart.js) ตัดหมวดซ้ำออกก่อน ไม่งั้นแท็ก
    // "Memory" จะโผล่ซ้ำกัน 2 อันในการ์ดใบเดียว
    const previewLabels = [...new Set(categories.map((item) => item.category))]
      .slice(0, 4)
      .map((category) => getCategoryLabel(category))
      .filter(Boolean);

    // ปุ่มถอดออกจากคลังสาธารณะ (มุมขวาบนของการ์ด) โชว์เฉพาะแอดมิน - ถอดแค่สเปคนี้
    // ออกจากหน้า "สเปคทั้งหมด" เจ้าของเดิมยังเห็นในหน้าประวัติของตัวเองได้ปกติ
    // (ดูคอมเมนต์ที่ adminUnlistBuild ใน builds.service.js)
    const adminUnlistButton = state.user?.role === 'admin'
      ? `
        <button type="button" class="gallery-card-admin-unlist" data-admin-unlist-build="${escapeHtml(build.id)}" aria-label="ถอดออกจากคลังสาธารณะ (แอดมิน)" title="ถอดออกจากคลังสาธารณะ (แอดมิน)">
          ${manualTrashIcon}
        </button>
      `
      : '';

    return `
      <article class="gallery-card" data-gallery-token="${escapeHtml(build.shareToken)}" role="button" tabindex="0" aria-label="เปิดดูสเปค ${escapeHtml(build.name || `Build #${build.id}`)}">
        ${adminUnlistButton}
        <p>${escapeHtml(build.mode || 'manual')}</p>
        <h3>${escapeHtml(build.name || `Build #${build.id}`)}</h3>
        ${build.username ? `<p class="muted gallery-card-owner">โดย ${escapeHtml(build.username)}</p>` : ''}
        ${previewLabels.length ? `<div class="gallery-card-tags">${previewLabels.map((label) => `<span class="tag tag-category">${escapeHtml(label)}</span>`).join('')}</div>` : ''}
        <span>${formatNumber(itemCount)} รายการ</span>
        <strong>${formatCurrency(build.total)}</strong>
        <button class="secondary-button" type="button" data-open-public-build="${escapeHtml(build.shareToken)}">ดูสเปคนี้</button>
      </article>
    `;
  }).join('');
}

function renderGalleryPagination() {
  if (!galleryPaginationEl) {
    return;
  }

  const pageCount = Math.ceil(state.galleryTotal / state.galleryPageSize);

  if (pageCount <= 1) {
    galleryPaginationEl.hidden = true;
    galleryPaginationEl.innerHTML = '';
    return;
  }

  const pages = getVisiblePages(state.galleryPage, pageCount);
  galleryPaginationEl.hidden = false;
  galleryPaginationEl.innerHTML = `
    ${pages.map((page) => `<button class="${page === state.galleryPage ? 'active' : ''}" type="button" data-gallery-page="${page}" ${page === state.galleryPage ? 'aria-current="page"' : ''}>${page}</button>`).join('')}
    <button type="button" data-gallery-page="${Math.min(state.galleryPage + 1, pageCount)}" ${state.galleryPage === pageCount ? 'disabled' : ''} aria-label="หน้าถัดไป">›</button>
    <button type="button" data-gallery-page="${pageCount}" ${state.galleryPage === pageCount ? 'disabled' : ''} aria-label="หน้าสุดท้าย">»</button>
  `;
}

function openPublicBuildFromGallery(token) {
  if (!token) {
    return;
  }

  window.location.hash = `public/${token}`;
  setView(PUBLIC_BUILD_VIEW);
}

function handleGalleryAction(event) {
  const pageButton = event.target.closest('[data-gallery-page]');

  if (pageButton && !pageButton.disabled) {
    const page = Number(pageButton.dataset.galleryPage);

    if (Number.isInteger(page) && page > 0 && page !== state.galleryPage) {
      state.galleryPage = page;
      loadPublicGallery();
    }
    return;
  }

  const openButton = event.target.closest('[data-open-public-build]');

  if (openButton) {
    openPublicBuildFromGallery(openButton.dataset.openPublicBuild);
    return;
  }

  const unlistButton = event.target.closest('[data-admin-unlist-build]');

  if (unlistButton) {
    adminUnlistGalleryBuild(unlistButton.dataset.adminUnlistBuild);
    return;
  }

  const card = event.target.closest('[data-gallery-token]');

  if (card) {
    openPublicBuildFromGallery(card.dataset.galleryToken);
  }
}

// แอดมินถอดสเปคออกจากหน้า "สเปคทั้งหมด" - ปุ่มมุมขวาบนของการ์ด (โชว์เฉพาะแอดมิน
// ดูคอมเมนต์ที่ renderGalleryList ด้านบน) แค่ถอดออกจากคลังสาธารณะเฉยๆ ไม่ได้ลบ
// สเปคทิ้งจริง เจ้าของเดิมยังเห็นในหน้าประวัติของตัวเองได้ตามปกติ
async function adminUnlistGalleryBuild(buildId) {
  if (!(await confirmDialog('ถอดสเปคนี้ออกจากหน้า "สเปคทั้งหมด" หรือไม่ (เจ้าของยังเห็นในหน้าประวัติของตัวเองได้ตามปกติ)'))) {
    return;
  }

  try {
    await fetchJson(`/api/admin/builds/${buildId}/list`, { method: 'DELETE' });
    setCartStatus('ถอดสเปคออกจากสเปคทั้งหมดแล้ว');
    loadPublicGallery();
  } catch {
    setCartStatus('ถอดสเปคออกไม่สำเร็จ');
  }
}

function handleGalleryKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return;
  }

  if (event.target.closest('[data-open-public-build]') || event.target.closest('[data-admin-unlist-build]')) {
    return;
  }

  const card = event.target.closest('[data-gallery-token]');

  if (!card) {
    return;
  }

  event.preventDefault();
  openPublicBuildFromGallery(card.dataset.galleryToken);
}

function printSavedBuild(buildId) {
  const build = state.savedBuildsById.get(String(buildId));

  if (!build) {
    return;
  }

  const printWindow = window.open('', '_blank', 'width=900,height=720');

  if (!printWindow) {
    setCartStatus('เปิดหน้าพิมพ์ไม่ได้ กรุณาอนุญาต pop-up แล้วลองใหม่');
    return;
  }

  printWindow.document.open();
  printWindow.document.write(createSavedBuildPrintDocument({
    ...build,
    items: mergeDuplicateCartItems(Array.isArray(build.items) ? build.items : [])
  }));
  printWindow.document.close();
}

function renderSavedBuildResult(build) {
  if (!savedBuildResultEl) {
    return;
  }

  // build.items ที่เพิ่งบันทึกอาจมีแรม 2 แถวแยกกัน (แตกแถวไว้ก่อนส่งไปหลังบ้าน - ดู
  // expandCartItemsForApi) รวมกลับเป็นแถวเดียวก่อนสรุปผลให้ผู้ใช้เห็น
  const summary = createSavedBuildSummary({
    ...build,
    items: mergeDuplicateCartItems(Array.isArray(build.items) ? build.items : [])
  });
  savedBuildResultEl.hidden = false;
  savedBuildResultEl.innerHTML = `
    <div class="saved-build-header">
      <div>
        <h3>${escapeHtml(summary.title)}</h3>
      </div>
      <strong>${formatCurrency(summary.total)}</strong>
    </div>
    <div class="saved-build-items">
      ${summary.items.map((item) => `
        <article>
          <span>${getCategoryLabel(item.category)}</span>
          <b>${escapeHtml(item.name)}${item.quantity > 1 ? ` ×${item.quantity}` : ''}</b>
          <strong>${formatCurrency(item.price)}</strong>
        </article>
      `).join('')}
    </div>
  `;
}

function setCartStatus(message) {
  if (cartStatusEl) {
    cartStatusEl.textContent = message;
  }

  if (saveBuildStatusEl) {
    saveBuildStatusEl.textContent = message;
  }
}

function setSaveButtonLoading(isLoading) {
  saveBuildButtons.forEach((button) => {
    button.disabled = isLoading;
    button.classList.toggle('is-loading', isLoading);
  });
}

function renderItemDetail(item) {
  if (item.category === 'memory' && item.memoryGb) {
    return ` (${formatNumber(item.memoryGb)} GB)`;
  }

  if (item.category === 'power-supply' && item.wattage) {
    return ` (${formatNumber(item.wattage)}W)`;
  }

  if (item.category === 'motherboard' && item.formFactor) {
    return ` (${escapeHtml(item.formFactor)})`;
  }

  if (item.category === 'case' && item.caseType) {
    return ` (${escapeHtml(item.caseType)})`;
  }

  return '';
}

async function fetchJson(url, options) {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...(options || {})
  });

  if (!response.ok) {
    let message = '';

    try {
      const body = await response.json();
      message = String(body.message || body.error || '');
    } catch {
    }

    const error = new Error(message || `Request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function getCategoryLabel(category) {
  return categoryLabels[category] || category;
}

const categoryIconPaths = {
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.2"/><rect x="9" y="9" width="6" height="6" rx="0.6" fill="currentColor" stroke="none"/><g stroke-width="1.3"><path d="M8 3v2.6M11 3v2.6M14 3v2.6M17 3v2.6M8 18.4V21M11 18.4V21M14 18.4V21M17 18.4V21M3 8h2.6M3 11h2.6M3 14h2.6M3 17h2.6M18.4 8H21M18.4 11H21M18.4 14H21M18.4 17H21"/></g>',
  motherboard: '<rect x="2.5" y="2.5" width="19" height="19" rx="1.5"/><rect x="5.5" y="5.5" width="6.5" height="6.5" rx="0.8" fill="currentColor" stroke="none"/><g stroke-width="1.3"><path d="M14 5.5h5.5M14 8h5.5M14 10.5h5.5"/><path d="M5.5 14h3v6h-3zM10 14h3v6h-3z"/></g><rect x="14.5" y="15.5" width="6" height="2.6" rx="0.5"/><circle cx="19.3" cy="4" r="0.7" fill="currentColor" stroke="none"/><circle cx="4" cy="19.3" r="0.7" fill="currentColor" stroke="none"/>',
  'video-card': '<rect x="2" y="7.5" width="20" height="9" rx="1.5"/><circle cx="8.3" cy="12" r="3"/><circle cx="8.3" cy="12" r="0.7" fill="currentColor" stroke="none"/><circle cx="15.7" cy="12" r="3"/><circle cx="15.7" cy="12" r="0.7" fill="currentColor" stroke="none"/><path d="M4.5 5.6h15" stroke-width="1.4"/><path d="M3.5 19v2" stroke-width="1.6"/>',
  memory: '<path d="M8 3h4l3.5 3.5V19a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3Z"/><rect x="9" y="6" width="2" height="2.6" rx="0.3" fill="currentColor" stroke="none"/><rect x="12.3" y="6" width="2" height="2.6" rx="0.3" fill="currentColor" stroke="none"/><rect x="9" y="9.8" width="5.3" height="2" rx="0.3" fill="currentColor" stroke="none"/><rect x="9" y="12.8" width="5.3" height="2" rx="0.3" fill="currentColor" stroke="none"/><rect x="8" y="16.6" width="8" height="2.6" rx="0.5" fill="currentColor" stroke="none"/>',
  storage: '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/><path d="M7.6 5.1c1.2-.65 2.7-1 4.4-1" stroke-width="1.3"/>',
  'internal-hard-drive': '<ellipse cx="12" cy="6" rx="7" ry="2.5"/><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6"/><path d="M5 12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5"/><path d="M7.6 5.1c1.2-.65 2.7-1 4.4-1" stroke-width="1.3"/>',
  'power-supply': '<rect x="3.5" y="4" width="17" height="16" rx="2"/><circle cx="9" cy="12" r="3.5"/><g stroke-width="1.3"><path d="M9 8.5v7M5.5 12h7M6.6 9.6l4.8 4.8M6.6 14.4l4.8-4.8"/><path d="M15 8h4M15 11h4M15 14h4"/></g><path d="M12 20v1.6" stroke-width="1.6"/>',
  case: '<rect x="4" y="2.5" width="16" height="19" rx="1.6"/><circle cx="12" cy="6.3" r="0.9" fill="currentColor" stroke="none"/><circle cx="12" cy="14" r="3.5"/><g stroke-width="1.3"><path d="M12 11.3v1.3M12 15.4v1.3M9.9 12.5l1.1.75M13 12.75l1.1-.75M9.9 15.5l1.1-.75M13 14.75l1.1.75"/></g><path d="M8.3 19.4h7.4" stroke-width="1.4"/>',
  'cpu-cooler': '<circle cx="12" cy="12" r="9.4"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/><path d="M12 12 Q10.6 7.6 12 3.6 Q13.4 7.6 12 12 Z" fill="currentColor" stroke="none"/><path d="M12 12 Q10.6 7.6 12 3.6 Q13.4 7.6 12 12 Z" fill="currentColor" stroke="none" transform="rotate(60 12 12)"/><path d="M12 12 Q10.6 7.6 12 3.6 Q13.4 7.6 12 12 Z" fill="currentColor" stroke="none" transform="rotate(120 12 12)"/><path d="M12 12 Q10.6 7.6 12 3.6 Q13.4 7.6 12 12 Z" fill="currentColor" stroke="none" transform="rotate(180 12 12)"/><path d="M12 12 Q10.6 7.6 12 3.6 Q13.4 7.6 12 12 Z" fill="currentColor" stroke="none" transform="rotate(240 12 12)"/><path d="M12 12 Q10.6 7.6 12 3.6 Q13.4 7.6 12 12 Z" fill="currentColor" stroke="none" transform="rotate(300 12 12)"/>',
  monitor: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><circle cx="12" cy="7" r="0.4" fill="currentColor" stroke="none"/><path d="M9 20h6M12 16v4"/>'
};

function getCategoryIcon(category) {
  const path = categoryIconPaths[category] || '<circle cx="12" cy="12" r="9"/>';

  return `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}

function getProductKey(product) {
  return `${product.category}:${product.id}`;
}

function formatCurrency(value) {
  const price = Number(value || 0);

  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0
  }).format(price);
}

function formatNumber(value) {
  return new Intl.NumberFormat('th-TH').format(Number(value || 0));
}

function formatDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[char]);
}
