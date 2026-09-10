// =========================================
// ПОДКЛЮЧЕНИЕ К SUPABASE
// =========================================
const SUPABASE_URL = 'https://jadijuvwuoypocqoiric.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_5hEjVf08m9fPHjAwqSOUfQ_iS0RPM2v';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// =========================================
// ГЛОБАЛЬНЫЕ ПЕРЕМЕННЫЕ
// =========================================
let allProfiles = [];
let currentUser = null;
let allPurchases = [];
let allProducts = [];
let realtimeChannel = null;

const modal = document.getElementById('profileModal');
const profileGrid = document.getElementById('profileGrid');
const closeModalBtn = document.getElementById('closeModalBtn');
const cardsContainer = document.getElementById('cardsContainer');
const tokenInput = document.getElementById('tokenInput');
const restoreBtn = document.getElementById('restoreBtn');
const tokenNotification = document.getElementById('tokenNotification');
const userTokenDisplay = document.getElementById('userTokenDisplay');
const copyTokenBtn = document.getElementById('copyTokenBtn');
const closeTokenBtn = document.getElementById('closeTokenBtn');

// =========================================
// 1. ЗАГРУЗКА ИЗ БД
// =========================================

async function loadProfiles() {
    const { data } = await supabase.from('profiles').select('*');
    return data || [];
}

async function loadProducts() {
    const { data } = await supabase.from('products').select('*');
    return data || [];
}

async function loadPurchases() {
    const { data } = await supabase
        .from('purchases')
        .select(`
            id,
            user_id,
            product_id,
            users (
                id,
                profile_id,
                profiles (username, avatar_url)
            )
        `);
    return data || [];
}

// =========================================
// 2. ВОССТАНОВЛЕНИЕ ПОЛЬЗОВАТЕЛЯ
// =========================================

async function restoreCurrentUser() {
    const userId = localStorage.getItem('userId');

    if (!userId) {
        // Попробуем восстановить по сохранённому токену (на всякий случай)
        const savedToken = localStorage.getItem('userToken');
        if (savedToken) {
            await restoreByToken(savedToken);
        }
        return;
    }

    const { data, error } = await supabase
        .from('users')
        .select(`
            id,
            profile_id,
            user_token,
            profiles (username, avatar_url)
        `)
        .eq('id', userId)
        .single();

    if (error || !data) {
        localStorage.removeItem('userId');
        return;
    }

    currentUser = data;
    localStorage.setItem('userToken', data.user_token); // сохраняем токен на всякий случай
    updateProfileIcon(data.profiles.avatar_url);
}

async function restoreByToken(token) {
    const { data, error } = await supabase
        .from('users')
        .select(`
            id,
            profile_id,
            user_token,
            profiles (username, avatar_url)
        `)
        .eq('user_token', token)
        .single();

    if (error || !data) return false;

    currentUser = data;
    localStorage.setItem('userId', data.id);
    localStorage.setItem('userToken', data.user_token);
    updateProfileIcon(data.profiles.avatar_url);
    return true;
}

// =========================================
// 3. ОБНОВЛЕНИЕ ИКОНКИ
// =========================================

function updateProfileIcon(avatarUrl) {
    const profileImg = document.querySelector('.profile-img');
    if (profileImg) profileImg.src = avatarUrl;
}

// =========================================
// 4. МОДАЛЬНОЕ ОКНО
// =========================================

function openModal() {
    if (currentUser) {
        alert('Профиль уже выбран. Для смены обратитесь к админу');
        return;
    }
    createModalContent();
    modal.style.display = 'flex';
}
function closeModal() {
    modal.style.display = 'none';
}

async function createModalContent() {
    allProfiles = await loadProfiles();
    allPurchases = await loadPurchases();

    // Занятые профили — те, что уже выбрал кто-то в users
    const allUsers = await loadUsers();
    const busyProfileIds = new Set(
        allUsers.map(u => u.profile_id).filter(Boolean)
    );

    // Скрываем занятые, кроме своего
    const availableProfiles = allProfiles.filter(profile => {
        if (currentUser && currentUser.profile_id === profile.id) return true;
        return !busyProfileIds.has(profile.id);
    });

    profileGrid.innerHTML = '';

    if (currentUser) {
        // Пользователь уже выбрал — показываем только сообщение
        profileGrid.innerHTML = `<p>Вы уже выбрали профиль.</p>`;
        return;
    }

    if (availableProfiles.length === 0) {
        profileGrid.innerHTML = '<p>Все профили заняты 😔</p>';
        return;
    }

    availableProfiles.forEach(profile => {
        const item = document.createElement('div');
        item.className = 'profile-item';
        item.innerHTML = `
            <img src="${profile.avatar_url}" alt="${profile.username}">
            <p>${profile.username}</p>
        `;
        item.addEventListener('click', () => selectProfile(profile));
        profileGrid.appendChild(item);
    });
}
async function loadUsers() {
    const { data } = await supabase.from('users').select('*');
    return data || [];
}


// =========================================
// 5. ВЫБОР ПРОФИЛЯ
// =========================================

async function selectProfile(profile) {
    // Если уже есть currentUser — обновляем профиль
    if (currentUser) {
        const { error } = await supabase
            .from('users')
            .update({ profile_id: profile.id })
            .eq('id', currentUser.id);

        if (error) { 
            console.error('Ошибка обновления профиля:', error);
            alert('Не удалось обновить профиль. Попробуйте ещё раз.');
            return;
        }
        currentUser.profile_id = profile.id;
        currentUser.profiles = profile;
    } else {
        // Проверяем, нет ли уже записи в localStorage
        const existingId = localStorage.getItem('userId');
        
        if (existingId) {
            // Попробуем найти запись по ID
            const { data: existing } = await supabase
                .from('users')
                .select(`id, profile_id, user_token, profiles (username, avatar_url)`)
                .eq('id', existingId)
                .single();
            
            if (existing) {
                // Нашли — обновляем
                const { error } = await supabase
                    .from('users')
                    .update({ profile_id: profile.id })
                    .eq('id', existing.id);

                if (error) { console.error(error); return; }
                currentUser = { ...existing, profile_id: profile.id, profiles: profile };
                updateProfileIcon(profile.avatar_url);
                closeModal();
                await renderProducts();
                return;
            }
        }

        // Создаём нового ТОЛЬКО если предыдущих попыток не было
        const { data, error } = await supabase
            .from('users')
            .insert([{ profile_id: profile.id }])
            .select(`id, profile_id, user_token, profiles (username, avatar_url)`)
            .single();

        if (error) { 
            console.error('Ошибка создания пользователя:', error); 
            alert('Не удалось создать пользователя. Попробуйте ещё раз.');
            return; 
        }
        currentUser = data;
        localStorage.setItem('userId', data.id);
        localStorage.setItem('userToken', data.user_token);
        showTokenNotification(data.user_token);
    }

    updateProfileIcon(profile.avatar_url);
    closeModal();
    await renderProducts();
}

// =========================================
// 6. УВЕДОМЛЕНИЕ С ТОКЕНОМ
// =========================================

function showTokenNotification(token) {
    userTokenDisplay.value = token;
    tokenNotification.style.display = 'block';
}

copyTokenBtn.addEventListener('click', () => {
    userTokenDisplay.select();
    document.execCommand('copy');
    copyTokenBtn.textContent = 'Скопировано!';
    setTimeout(() => { copyTokenBtn.textContent = 'Скопировать'; }, 2000);
});

closeTokenBtn.addEventListener('click', () => {
    tokenNotification.style.display = 'none';
});

// =========================================
// 7. ВОССТАНОВЛЕНИЕ ПО ТОКЕНУ (вручную)
// =========================================

restoreBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
        alert('Введите токен!');
        return;
    }

    const success = await restoreByToken(token);
    if (success) {
        alert('Профиль восстановлен!');
        closeModal();
        await renderProducts();
    } else {
        alert('Токен не найден. Проверьте правильность.');
    }
});

// =========================================
// 8. ОТРИСОВКА КАРТОЧЕК
// =========================================

async function renderProducts() {
    allProducts = await loadProducts();
    allPurchases = await loadPurchases();

    cardsContainer.innerHTML = '';

    allProducts.forEach(product => {
        // Все покупки этого товара
        const productPurchases = allPurchases.filter(p => p.product_id === product.id);
        
        // Есть ли среди них покупка текущего пользователя?
        const myPurchase = currentUser 
            ? productPurchases.find(p => p.user_id === currentUser.id) 
            : null;

        let buttonHTML = '';

        if (myPurchase) {
            // У текущего пользователя есть покупка этого товара — кнопка "Отменить"
            buttonHTML = `<button class="buy-btn cancel" onclick="cancelPurchase(${myPurchase.id})">Отменить покупку</button>`;
        } else if (productPurchases.length > 0) {
            // Товар куплен кем-то другим — кнопка активна, но с уведомлением
            const buyers = productPurchases
                .map(p => p.users?.profiles)
                .filter(Boolean);
            
            // Формируем HTML тултипа: аватарки + имена всех покупателей
            const buyerInfo = buyers.map(b => `
                <div class="tooltip-buyer">
                    <img src="${b.avatar_url}" alt="${b.username}">
                    <span>${b.username}</span>
                </div>
            `).join('');

            buttonHTML = `
                <button class="buy-btn busy" onclick="showBusyNotification(${product.id})">
                    Куплено (${buyers.length})
                    <span class="tooltip">
                        ${buyerInfo}
                    </span>
                </button>
            `;
        } else {
            // Товар свободен — кнопка "Купить"
            buttonHTML = `<button class="buy-btn" onclick="buyProduct(${product.id})">Купить</button>`;
        }

        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <img src="${product.image_url}" alt="${product.title}" class="card-img">
            <h3 class="card-title">${product.title}</h3>
            <div class="card-buttons">
                ${product.wildberries_link ? `<a href="${product.wildberries_link}" target="_blank" class="btn btn-wb">Wildberries</a>` : ''}
                ${product.ozon_link ? `<a href="${product.ozon_link}" target="_blank" class="btn btn-ozon">Ozon</a>` : ''}
            </div>
            ${buttonHTML}
        `;
        cardsContainer.appendChild(card);
    });
}
function showBusyNotification(productId) {
    const productPurchases = allPurchases.filter(p => p.product_id === productId);
    const buyers = productPurchases
        .map(p => p.users?.profiles)
        .filter(Boolean);

    if (buyers.length === 0) {
        alert('Этот товар уже куплен.');
        return;
    }

    if (buyers.length === 1) {
        alert(`Этот товар уже купил(а): ${buyers[0].username}`);
    } else {
        const names = buyers.map(b => b.username).join(', ');
        alert(`Этот товар уже купили: ${names}`);
    }
}

window.showBusyNotification = showBusyNotification;
// =========================================
// 9. КУПИТЬ / ОТМЕНИТЬ
// =========================================

async function buyProduct(productId) {
    if (!currentUser) {
        alert('Сначала выберите профиль!');
        openModal();
        return;
    }

    // Проверяем, не купил ли уже текущий пользователь
    const myPurchase = allPurchases.find(
        p => p.product_id === productId && p.user_id === currentUser.id
    );
    if (myPurchase) {
        alert('Вы уже купили этот товар!');
        return;
    }

    // Проверяем, куплен ли кем-то другим, и уведомляем
    const otherPurchases = allPurchases.filter(
        p => p.product_id === productId && p.user_id !== currentUser.id
    );

    if (otherPurchases.length > 0) {
        const names = otherPurchases
            .map(p => p.users?.profiles?.username)
            .filter(Boolean)
            .join(', ');
        const confirmBuy = confirm(
            `Этот товар уже купили: ${names}. Всё равно купить?`
        );
        if (!confirmBuy) return;
    }

    // Вставляем запись
    const { error } = await supabase
        .from('purchases')
        .insert([{
            user_id: currentUser.id,
            product_id: productId,
            status: 'bought'
        }]);

    if (error) {
        console.error(error);
        alert('Ошибка при покупке. Попробуйте ещё раз.');
        return;
    }

    await renderProducts();
}

async function cancelPurchase(purchaseId) {
    const { error } = await supabase
        .from('purchases')
        .delete()
        .eq('id', purchaseId);

    if (error) { console.error(error); return; }
    await renderProducts();
}

// =========================================
// 10. REALTIME
// =========================================

function subscribeToRealtime() {
    realtimeChannel = supabase
        .channel('public-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'purchases' }, () => {
            renderProducts();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users' }, () => {
            if (modal.style.display === 'flex') createModalContent();
            renderProducts();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
            if (modal.style.display === 'flex') createModalContent();
        })
        .subscribe();
}

// =========================================
// 11. ИНИЦИАЛИЗАЦИЯ
// =========================================

document.addEventListener('DOMContentLoaded', async () => {
    await restoreCurrentUser();
    await renderProducts();
    subscribeToRealtime();

    // Если пользователь ещё не выбрал профиль — открываем модалку автоматически
    if (!currentUser) {
        openModal();
    }
});

closeModalBtn.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});

// Делаем функции глобальными (нужно для onclick в HTML-карточках)
window.openModal = openModal;
window.buyProduct = buyProduct;
window.cancelPurchase = cancelPurchase;

// =========================================
// 12. ПАРАЛЛАКС ЭФФЕКТ
// =========================================

function initParallax() {
    const layer1 = document.querySelector('.layer-1');
    const layer2 = document.querySelector('.layer-2');
    const layer3 = document.querySelector('.layer-3');
    const text = document.querySelector('.parallax-text');

  //  if (window.innerWidth < 768) return;

    if (!layer1 || !layer2 || !layer3) return;

    let ticking = false;

    function updateParallax() {
        const scrollY = window.scrollY;

        // Двигаем только пока не прошли первый экран
        if (scrollY < window.innerHeight) {
            if (layer1) layer1.style.transform = `translateY(${scrollY * 0.2}px)`;
            if (layer2) layer2.style.transform = `translateY(${scrollY * 0.4}px)`;
            if (text)   text.style.transform   = `translateY(${scrollY * 0.3}px)`;
            if (layer3) layer3.style.transform = `translateY(${scrollY * 0.6}px)`;

            if (text) text.style.opacity = 1 - (scrollY / (window.innerHeight * 0.7));
        }
        ticking = false;
    }

    window.addEventListener('scroll', () => {
        if (!ticking) {
            window.requestAnimationFrame(updateParallax);
            ticking = true;
        }
    });
}

// Запускаем после загрузки страницы
document.addEventListener('DOMContentLoaded', initParallax);