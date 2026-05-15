const getBaseUrl = () => {
    let path = window.location.pathname;
    if (path.endsWith('/index.html')) path = path.replace('/index.html', '');
    return path.replace(/\/$/, '') || '';
};
const API_BASE = getBaseUrl() + '/api';
const MEDIA_BASE = getBaseUrl();
const gallery = document.getElementById('gallery');
const lightbox = document.getElementById('lightbox');
const filtersContainer = document.getElementById('categoryFilters');

let currentImages = [];
let categories = [];
let currentPage = 1;
let currentFilter = 0; // 0 means 'all'
let isLoading = false;
let hasMore = true;
const limit = 20;

const escapeHTML = (str) => {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[m]));
};

async function initFrontend() {
    try {
        // Fetch Settings
        const setRes = await fetch(`${API_BASE}/settings`);
        const settings = await setRes.json();
        
        const siteTitle = settings.siteTitle || 'ImagesGallery';
        const siteDesc = settings.siteDesc || '一个简约高性能的私人图床系统';
        const siteFooter = settings.siteFooter || `© ${new Date().getFullYear()} ${siteTitle}. All rights reserved.`;

        document.getElementById('pageTitle').innerText = siteTitle;
        document.getElementById('brandName').innerText = siteTitle.toUpperCase() + '.';
        
        const footerEl = document.getElementById('footerInfo');
        if (footerEl) footerEl.innerText = siteFooter;
        
        const beianEl = document.getElementById('beianInfo');
        if (beianEl) {
            if (settings.siteBeian) {
                beianEl.innerText = settings.siteBeian;
                beianEl.style.display = 'inline-block';
            } else {
                beianEl.style.display = 'none';
            }
        }

        const metaDesc = document.querySelector('meta[name="description"]');
        if (metaDesc) metaDesc.content = siteDesc;

        const catRes = await fetch(`${API_BASE}/categories`);
        categories = (await catRes.json()) || [];
        renderFilters();

        await loadMoreImages(true); // Initial load

        // Setup Infinite Scroll & Back to Top Logic
        window.addEventListener('scroll', () => {
            // 1. Handle Infinite Scroll
            if (!isLoading && hasMore) {
                const scrollY = window.scrollY;
                const windowHeight = window.innerHeight;
                const documentHeight = document.documentElement.scrollHeight;
                if (scrollY + windowHeight >= documentHeight * 0.8) {
                    loadMoreImages(false);
                }
            }

            // 2. Handle Back to Top Button
            const backToTop = document.getElementById('backToTop');
            if (backToTop) {
                if (window.scrollY > 400) {
                    backToTop.classList.add('show');
                } else {
                    backToTop.classList.remove('show');
                }
            }
        });

        const bttBtn = document.getElementById('backToTop');
        if (bttBtn) {
            bttBtn.onclick = () => {
                window.scrollTo({ top: 0, behavior: 'smooth' });
            };
        }
    } catch (err) {
        console.error('Failed to initialize frontend:', err);
    }
}

function getColumnCount() {
    if (window.innerWidth <= 640) return 1;
    if (window.innerWidth <= 1024) return 2;
    return 4;
}

let masonryCols = [];
let masonryHeights = [];

function initializeMasonry() {
    gallery.innerHTML = '';
    const colCount = getColumnCount();
    masonryCols = [];
    masonryHeights = [];
    
    for (let i = 0; i < colCount; i++) {
        const col = document.createElement('div');
        col.style.flex = '1';
        col.style.display = 'flex';
        col.style.flexDirection = 'column';
        col.style.gap = '1.5rem';
        col.style.minWidth = '0';
        gallery.appendChild(col);
        masonryCols.push(col);
        masonryHeights.push(0);
    }
}

let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        if (masonryCols.length !== getColumnCount()) {
            initializeMasonry();
            if (currentImages.length > 0) {
                appendGallery(currentImages, false);
            }
        }
    }, 250);
});

async function loadMoreImages(reset = false) {
    if (isLoading) return;
    isLoading = true;
    
    if (reset) {
        currentPage = 1;
        currentImages = [];
        hasMore = true;
        initializeMasonry();
    }
    
    try {
        const url = `${API_BASE}/images?page=${currentPage}&category_id=${currentFilter}`;
        const res = await fetch(url);
        const result = await res.json();
        
        const newImages = result.data || [];
        const currentLimit = result.limit || 20; 
        if (newImages.length < currentLimit) {
            hasMore = false;
        }
        
        if (newImages.length > 0) {
            currentImages = currentImages.concat(newImages);
            appendGallery(newImages, true);
            currentPage++;
        }
    } catch(err) {
        console.error("Failed to load images:", err);
    } finally {
        isLoading = false;
    }
}

function renderFilters() {
    if (!filtersContainer) return;
    filtersContainer.innerHTML = `<button class="filter-btn active" data-category="0">全部资源</button>` +
        categories.map(cat => `<button class="filter-btn" data-category="${cat.id}">${cat.name}</button>`).join('');

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.onclick = () => {
            if (isLoading) return;
            document.querySelector('.filter-btn.active').classList.remove('active');
            btn.classList.add('active');
            currentFilter = parseInt(btn.dataset.category) || 0;
            loadMoreImages(true);
        };
    });
}

function appendGallery(images, isNew = true) {
    if (masonryCols.length === 0) initializeMasonry();
    
    images.forEach(img => {
        let minHeight = masonryHeights[0];
        let minIndex = 0;
        for (let i = 1; i < masonryHeights.length; i++) {
            if (masonryHeights[i] < minHeight) {
                minHeight = masonryHeights[i];
                minIndex = i;
            }
        }
        
        const ratio = (img.height || 100) / (img.width || 100);
        masonryHeights[minIndex] += ratio; 
        
        const safeJson = JSON.stringify(img).replace(/'/g, "&#39;").replace(/"/g, "&quot;");
        const html = `
        <div class="gallery-item" onclick="showLightbox(${safeJson})">
            <img src="${API_BASE}/thumb?path=${encodeURIComponent(img.path)}" 
                 alt="${escapeHTML(img.title)}" 
                 loading="lazy"
                 style="aspect-ratio: ${img.width} / ${img.height}; object-fit: cover; width: 100%; display: block;">
            <div class="item-overlay">
                <span class="item-category">${img.category ? escapeHTML(img.category.name) : '未分类'}</span>
                <h3 class="item-title">${escapeHTML(img.title) || '无标题'}</h3>
            </div>
        </div>
        `;
        
        masonryCols[minIndex].insertAdjacentHTML('beforeend', html);
    });
}

function showLightbox(img) {
    const lbImg = document.getElementById('lightboxImg');
    const infoTitle = document.getElementById('infoTitle');
    const infoDesc = document.getElementById('infoDesc');
    const metaRes = document.getElementById('metaRes');
    const metaDate = document.getElementById('metaDate');
    const metaCat = document.getElementById('metaCat');
    const metaTags = document.getElementById('metaTags');

    lbImg.src = MEDIA_BASE + img.path;
    infoTitle.innerText = img.title || '无标题';
    infoDesc.innerText = img.description || '暂无描述';
    
    metaRes.innerText = `${img.width} x ${img.height}`;
    metaDate.innerText = new Date(img.created_at || img.CreatedAt).toLocaleDateString();
    metaCat.innerText = img.category ? img.category.name : '未分类';
    
    if (img.tags && img.tags.length > 0) {
        metaTags.innerHTML = img.tags.map(tag => `<span class="mini-tag">${escapeHTML(tag.name)}</span>`).join('');
    } else {
        metaTags.innerText = '--';
    }
    
    const sourceLinkContainer = document.getElementById('sourceLinkContainer');
    const sourceURL = document.getElementById('sourceURL');
    if (img.source_url) {
        sourceLinkContainer.style.display = 'block';
        sourceURL.href = img.source_url;
        sourceURL.innerText = img.source_url;
    } else {
        sourceLinkContainer.style.display = 'none';
    }
    
    lightbox.classList.add('active');
    
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    document.body.style.paddingRight = `${scrollbarWidth}px`;
    const header = document.querySelector('header');
    if (header) header.style.paddingRight = `calc(5% + ${scrollbarWidth}px)`;
}

function closeLightbox() {
    lightbox.classList.remove('active');
    document.body.style.overflow = '';
    document.body.style.paddingRight = '';
    const header = document.querySelector('header');
    if (header) header.style.paddingRight = '';
}

document.getElementById('closeBtn').onclick = closeLightbox;
lightbox.onclick = (e) => {
    if (e.target === lightbox) closeLightbox();
};

initFrontend();
