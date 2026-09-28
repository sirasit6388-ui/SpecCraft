export function createLoadingState(message = 'กำลังโหลด...', lineCount = 3) {
  const lines = Array.from({ length: Math.max(1, Number(lineCount) || 1) }, (_, index) => (
    `<span class="skeleton-line skeleton-line-${index + 1}"></span>`
  )).join('');

  return `
    <div class="loading-state" role="status" aria-live="polite">
      <div class="loading-copy">${escapeHtml(message)}</div>
      <div class="skeleton-stack">${lines}</div>
    </div>
  `;
}

export function createEmptyState(options = {}) {
  const title = options.title || 'ไม่มีข้อมูล';
  const message = options.message || 'ลองรีเฟรชหรือเปลี่ยนเงื่อนไขอีกครั้ง';

  return `
    <div class="empty-state">
      <div class="empty-mark"></div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
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
