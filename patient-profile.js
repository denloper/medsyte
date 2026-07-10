/**
 * Patient Profile Manager
 * Единое хранилище профиля пациента с синхронизацией
 */
(function() {
  'use strict';

  const PROFILE_KEY = 'patient_profile_v1';
  const SYNC_EVENT = 'patient_profile_updated';

  // ═══════════════════════════════════════
  //  ПОЛУЧЕНИЕ ПРОФИЛЯ
  // ═══════════════════════════════════════
  function getProfile() {
    try {
      const data = localStorage.getItem(PROFILE_KEY);
      if (data) {
        return JSON.parse(data);
      }
    } catch (e) {
      console.error('[Profile] Ошибка чтения:', e);
    }
    
    // Дефолтные значения
    return {
      sex: 'female',
      age: 35,
      name: '',
      height: 175,
      weight: 70,
      updatedAt: Date.now()
    };
  }

  // ═══════════════════════════════════════
  //  СОХРАНЕНИЕ ПРОФИЛЯ
  // ═══════════════════════════════════════
  function saveProfile(profile) {
    try {
      profile.updatedAt = Date.now();
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      
      // Уведомляем другие вкладки об изменении
      window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: profile }));
      
      // Синхронизация с Supabase (если доступен)
      syncToSupabase(profile);
      
      console.log('[Profile] ✅ Сохранён:', profile);
      return true;
    } catch (e) {
      console.error('[Profile] ❌ Ошибка сохранения:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  ОБНОВЛЕНИЕ ОТДЕЛЬНЫХ ПОЛЕЙ
  // ═══════════════════════════════════════
  function updateProfile(updates) {
    const profile = getProfile();
    Object.assign(profile, updates);
    return saveProfile(profile);
  }

  // ═══════════════════════════════════════
  //  ПРИМЕНЕНИЕ ПРОФИЛЯ К СТРАНИЦЕ
  // ═══════════════════════════════════════
  function applyProfileToPage() {
    const profile = getProfile();
    
    // Находим все селекторы пола
    const sexSelectors = document.querySelectorAll('select[id*="sex"], select[id*="Sex"], select[name*="sex"]');
    sexSelectors.forEach(select => {
      if (select.value !== profile.sex) {
        select.value = profile.sex;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    
    // Находим все поля возраста
    const ageInputs = document.querySelectorAll('input[id*="age"], input[id*="Age"], input[name*="age"]');
    ageInputs.forEach(input => {
      if (input.type === 'number' && input.value !== String(profile.age)) {
        input.value = profile.age;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    
    // Находим кнопки пола (pill buttons)
    const sexButtons = document.querySelectorAll('[onclick*="selectSex"]');
    sexButtons.forEach(btn => {
      const onclick = btn.getAttribute('onclick');
      const match = onclick.match(/selectSex\(['"](\w+)['"]\)/);
      if (match && match[1] === profile.sex) {
        btn.click();
      }
    });
    
    console.log('[Profile] ✅ Применён к странице:', profile);
  }

  // ═══════════════════════════════════════
  //  СЛУШАТЕЛЬ ИЗМЕНЕНИЙ НА СТРАНИЦЕ
  // ═══════════════════════════════════════
  function setupPageListeners() {
    // Слушаем изменения селекторов пола
    document.addEventListener('change', (e) => {
      if (e.target.matches('select[id*="sex"], select[id*="Sex"], select[name*="sex"]')) {
        updateProfile({ sex: e.target.value });
      }
    });
    
    // Слушаем изменения полей возраста
    document.addEventListener('input', (e) => {
      if (e.target.matches('input[id*="age"], input[id*="Age"], input[name*="age"]')) {
        if (e.target.type === 'number') {
          const age = parseInt(e.target.value) || 35;
          updateProfile({ age });
        }
      }
    });
    
    // Слушаем клики по кнопкам пола
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[onclick*="selectSex"]');
      if (btn) {
        const onclick = btn.getAttribute('onclick');
        const match = onclick.match(/selectSex\(['"](\w+)['"]\)/);
        if (match) {
          setTimeout(() => {
            updateProfile({ sex: match[1] });
          }, 100);
        }
      }
    });
  }

  // ═══════════════════════════════════════
  //  СИНХРОНИЗАЦИЯ МЕЖДУ ВКЛАДКАМИ
  // ═══════════════════════════════════════
  function setupCrossTabSync() {
    // Слушаем изменения в других вкладках
    window.addEventListener('storage', (e) => {
      if (e.key === PROFILE_KEY && e.newValue) {
        try {
          const profile = JSON.parse(e.newValue);
          console.log('[Profile] 🔄 Синхронизация из другой вкладки:', profile);
          applyProfileToPage();
        } catch (err) {
          console.error('[Profile] Ошибка парсинга:', err);
        }
      }
    });
    
    // Слушаем кастомное событие
    window.addEventListener(SYNC_EVENT, (e) => {
      console.log('[Profile] 🔄 Обновление через событие:', e.detail);
      applyProfileToPage();
    });
  }

  // ═══════════════════════════════════════
  //  СИНХРОНИЗАЦИЯ С SUPABASE
  // ═══════════════════════════════════════
  async function syncToSupabase(profile) {
    if (!window.SupabaseDB) return;
    
    try {
      const user = await window.SupabaseDB.getCurrentUser();
      if (!user) return;
      
      await window.SupabaseDB.updateProfile({
        sex: profile.sex,
        age: profile.age,
        height: profile.height,
        weight: profile.weight
      });
      
      console.log('[Profile] ☁️ Синхронизирован с Supabase');
    } catch (e) {
      console.warn('[Profile] ⚠️ Ошибка синхронизации с Supabase:', e.message);
    }
  }

  async function loadFromSupabase() {
    if (!window.SupabaseDB) return;
    
    try {
      const user = await window.SupabaseDB.getCurrentUser();
      if (!user || !user.profile) return;
      
      const profile = getProfile();
      const updates = {};
      
      if (user.profile.sex && user.profile.sex !== 'unknown') {
        updates.sex = user.profile.sex;
      }
      if (user.profile.age && user.profile.age > 0) {
        updates.age = user.profile.age;
      }
      if (user.profile.height) {
        updates.height = user.profile.height;
      }
      if (user.profile.weight) {
        updates.weight = user.profile.weight;
      }
      
      if (Object.keys(updates).length > 0) {
        updateProfile(updates);
        console.log('[Profile] ☁️ Загружен из Supabase:', updates);
      }
    } catch (e) {
      console.warn('[Profile] ⚠️ Ошибка загрузки из Supabase:', e.message);
    }
  }

  // ═══════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════
  function init() {
    console.log('[Profile] 🚀 Инициализация...');
    
    // Загружаем профиль из Supabase (если есть)
    loadFromSupabase().then(() => {
      // Применяем профиль к текущей странице
      applyProfileToPage();
    });
    
    // Настраиваем слушатели
    setupPageListeners();
    setupCrossTabSync();
    
    console.log('[Profile] ✅ Готов');
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ API
  // ═══════════════════════════════════════
  window.PatientProfile = {
    get: getProfile,
    save: saveProfile,
    update: updateProfile,
    apply: applyProfileToPage,
    init,
    version: '1.0.0'
  };

  // Автоинициализация при загрузке DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();