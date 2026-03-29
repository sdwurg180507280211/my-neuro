/**
 * 插件与角色商店 - 前端逻辑
 */
class MarketUI {
    constructor() {
        this.apiBase = 'http://localhost:3003';
        this.currentTab = 'plugins';
        this.currentCategory = 'all';
        this.currentSort = 'downloads';
        this.searchQuery = '';
        this.items = [];
        this.categories = { plugins: [], characters: [] };

        this.init();
    }

    init() {
        this.bindEvents();
        this.loadCategories();
        this.loadItems();
    }

    bindEvents() {
        // Tab 切换
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchTab(btn.dataset.tab);
            });
        });

        // 搜索
        const searchInput = document.getElementById('searchInput');
        searchInput.addEventListener('input', this.debounce(() => {
            this.searchQuery = searchInput.value;
            this.loadItems();
        }, 300));

        document.querySelector('.search-btn').addEventListener('click', () => {
            this.searchQuery = searchInput.value;
            this.loadItems();
        });

        // 排序
        document.getElementById('sortSelect').addEventListener('change', (e) => {
            this.currentSort = e.target.value;
            this.renderItems();
        });

        // 关闭按钮
        document.getElementById('closeBtn').addEventListener('click', () => {
            if (window.electronAPI) {
                window.electronAPI.closeMarket();
            } else {
                window.close();
            }
        });

        // 弹窗关闭
        document.getElementById('modalClose').addEventListener('click', () => {
            this.closeModal();
        });

        document.getElementById('detailModal').addEventListener('click', (e) => {
            if (e.target.id === 'detailModal') {
                this.closeModal();
            }
        });
    }

    async loadCategories() {
        try {
            const response = await fetch(`${this.apiBase}/market/categories`);
            const result = await response.json();
            if (result.success) {
                this.categories = result.data;
                this.renderCategories();
            }
        } catch (e) {
            console.error('Failed to load categories:', e);
        }
    }

    renderCategories() {
        const container = document.getElementById('categoryFilters');
        const cats = this.categories[this.currentTab] || [];

        container.innerHTML = cats.map(cat => `
            <button class="category-btn ${cat.id === this.currentCategory ? 'active' : ''}"
                    data-category="${cat.id}">
                ${cat.icon} ${cat.name}
            </button>
        `).join('');

        container.querySelectorAll('.category-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                this.currentCategory = btn.dataset.category;
                this.renderCategories();
                this.loadItems();
            });
        });
    }

    async loadItems() {
        try {
            const endpoint = this.currentTab === 'plugins' ? 'plugins' : 'characters';
            const params = new URLSearchParams();
            if (this.searchQuery) params.set('q', this.searchQuery);
            if (this.currentCategory !== 'all') params.set('category', this.currentCategory);

            const response = await fetch(`${this.apiBase}/market/${endpoint}?${params}`);
            const result = await response.json();
            if (result.success) {
                this.items = result.data;
                this.renderFeatured();
                this.renderItems();
            }
        } catch (e) {
            console.error('Failed to load items:', e);
            this.showToast('加载失败，请检查服务是否启动', 'error');
        }
    }

    renderFeatured() {
        const section = document.getElementById('featuredSection');
        const grid = document.getElementById('featuredGrid');
        const featured = this.items.filter(item => item.isFeatured).slice(0, 3);

        if (featured.length === 0) {
            section.style.display = 'none';
            return;
        }

        section.style.display = 'block';
        grid.innerHTML = featured.map(item => `
            <div class="featured-card" data-id="${item.id}">
                <span class="featured-badge">✨ 精选推荐</span>
                <h3>${item.displayName}</h3>
                <p>${item.description}</p>
                <div class="meta">
                    <span>⭐ ${item.rating}</span>
                    <span>📥 ${this.formatNumber(item.downloads)}</span>
                    <span>👤 ${item.author}</span>
                </div>
            </div>
        `).join('');

        grid.querySelectorAll('.featured-card').forEach(card => {
            card.addEventListener('click', () => {
                this.openDetail(card.dataset.id);
            });
        });
    }

    renderItems() {
        const grid = document.getElementById('itemsGrid');
        const emptyState = document.getElementById('emptyState');
        const title = document.getElementById('sectionTitle');

        title.textContent = this.currentTab === 'plugins' ? '全部插件' : '全部角色';

        // 排序
        let sorted = [...this.items];
        switch (this.currentSort) {
            case 'downloads':
                sorted.sort((a, b) => b.downloads - a.downloads);
                break;
            case 'rating':
                sorted.sort((a, b) => b.rating - a.rating);
                break;
            case 'updated':
                sorted.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
                break;
            case 'name':
                sorted.sort((a, b) => a.displayName.localeCompare(b.displayName));
                break;
        }

        if (sorted.length === 0) {
            grid.innerHTML = '';
            emptyState.style.display = 'block';
            return;
        }

        emptyState.style.display = 'none';
        grid.innerHTML = sorted.map(item => this.renderItemCard(item)).join('');

        grid.querySelectorAll('.item-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.install-btn')) {
                    this.openDetail(card.dataset.id);
                }
            });
        });

        grid.querySelectorAll('.install-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                if (btn.classList.contains('installed')) {
                    this.uninstallItem(id);
                } else {
                    this.installItem(id);
                }
            });
        });
    }

    renderItemCard(item) {
        const icon = this.currentTab === 'plugins' ? '🧩' : '🎭';
        return `
            <div class="item-card" data-id="${item.id}">
                <div class="card-header">
                    ${icon}
                </div>
                <div class="card-body">
                    <h3 class="card-title">${item.displayName}</h3>
                    <p class="card-author">👤 ${item.author}</p>
                    <p class="card-description">${item.description}</p>
                    <div class="tags">
                        ${item.tags.slice(0, 3).map(tag => `<span class="tag">${tag}</span>`).join('')}
                    </div>
                    <div class="card-meta">
                        <div class="card-stats">
                            <span>⭐ ${item.rating}</span>
                            <span>📥 ${this.formatNumber(item.downloads)}</span>
                        </div>
                        <button class="install-btn ${item.isInstalled ? 'installed' : ''}" data-id="${item.id}">
                            ${item.isInstalled ? '已安装' : '安装'}
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    async openDetail(id) {
        const item = this.items.find(i => i.id === id);
        if (!item) return;

        // 获取详细信息
        try {
            const endpoint = this.currentTab === 'plugins' ? 'plugins' : 'characters';
            const response = await fetch(`${this.apiBase}/market/${endpoint}/${id}`);
            const result = await response.json();
            if (result.success) {
                this.renderDetailModal(result.data);
            }
        } catch (e) {
            this.renderDetailModal(item);
        }
    }

    renderDetailModal(item) {
        const modal = document.getElementById('detailModal');
        const body = document.getElementById('modalBody');
        const title = document.getElementById('modalTitle');
        const icon = this.currentTab === 'plugins' ? '🧩' : '🎭';

        title.textContent = item.displayName;

        body.innerHTML = `
            <div class="detail-header">
                <div class="detail-icon">${icon}</div>
                <div class="detail-info">
                    <h3>${item.displayName}</h3>
                    <p class="author">👤 ${item.author} · v${item.version}</p>
                    <div class="stats">
                        <span>⭐ ${item.rating} 评分</span>
                        <span>📥 ${this.formatNumber(item.downloads)} 下载</span>
                        ${item.isInstalled ? `<span>✅ 已安装</span>` : ''}
                    </div>
                </div>
            </div>

            <div class="detail-description">
                <h4>📝 简介</h4>
                <p>${item.longDescription || item.description}</p>
            </div>

            ${item.modelInfo ? `
            <div class="detail-description">
                <h4>🎬 模型信息</h4>
                <p>表情: ${item.modelInfo.expressions} 个 · 动作: ${item.modelInfo.motions} 个 · 物理: ${item.modelInfo.physics ? '支持' : '不支持'}</p>
            </div>
            ` : ''}

            <div class="detail-tags">
                <h4>🏷️ 标签</h4>
                <div class="tags-list">
                    ${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
                </div>
            </div>

            ${item.repoUrl ? `
            <div class="detail-description">
                <h4>🔗 链接</h4>
                <p><a href="${item.repoUrl}" target="_blank" style="color: #667eea;">${item.repoUrl}</a></p>
            </div>
            ` : ''}

            <div class="detail-actions">
                ${item.isInstalled ? `
                    <button class="action-btn secondary-btn" id="uninstallBtn" data-id="${item.id}">卸载</button>
                ` : `
                    <button class="action-btn primary-btn" id="installBtn" data-id="${item.id}">安装</button>
                `}
            </div>
        `;

        modal.style.display = 'flex';

        const installBtn = document.getElementById('installBtn');
        const uninstallBtn = document.getElementById('uninstallBtn');

        if (installBtn) {
            installBtn.addEventListener('click', () => {
                this.installItem(item.id);
            });
        }

        if (uninstallBtn) {
            uninstallBtn.addEventListener('click', () => {
                this.uninstallItem(item.id);
            });
        }
    }

    closeModal() {
        document.getElementById('detailModal').style.display = 'none';
    }

    async installItem(id) {
        this.showToast('正在安装...', 'info');
        try {
            const endpoint = this.currentTab === 'plugins' ? 'plugins' : 'characters';
            const response = await fetch(`${this.apiBase}/market/${endpoint}/${id}/install`, {
                method: 'POST'
            });
            const result = await response.json();
            if (result.success) {
                this.showToast(result.message, 'success');
                this.closeModal();
                this.loadItems();
            } else {
                this.showToast(result.message, 'error');
            }
        } catch (e) {
            this.showToast('安装失败: ' + e.message, 'error');
        }
    }

    async uninstallItem(id) {
        this.showToast('正在卸载...', 'info');
        try {
            const endpoint = this.currentTab === 'plugins' ? 'plugins' : 'characters';
            const response = await fetch(`${this.apiBase}/market/${endpoint}/${id}/uninstall`, {
                method: 'POST'
            });
            const result = await response.json();
            if (result.success) {
                this.showToast(result.message, 'success');
                this.closeModal();
                this.loadItems();
            } else {
                this.showToast(result.message, 'error');
            }
        } catch (e) {
            this.showToast('卸载失败: ' + e.message, 'error');
        }
    }

    switchTab(tab) {
        this.currentTab = tab;
        this.currentCategory = 'all';

        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        this.renderCategories();
        this.loadItems();
    }

    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            success: '✓',
            error: '✕',
            info: 'ℹ'
        };

        toast.innerHTML = `<span>${icons[type]}</span> ${message}`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'toast-slide-in 0.3s ease reverse';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    formatNumber(num) {
        if (num >= 10000) {
            return (num / 10000).toFixed(1) + 'w';
        }
        if (num >= 1000) {
            return (num / 1000).toFixed(1) + 'k';
        }
        return num.toString();
    }

    debounce(fn, delay) {
        let timer;
        return function(...args) {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    window.marketUI = new MarketUI();
});
