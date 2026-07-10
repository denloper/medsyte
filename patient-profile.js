/**
 * Patient Profile Manager v2.0
 * Единое хранилище профиля с защитой от рекурсии и debounce
 */
(function() {
  'use strict';

  const PROFILE_KEY = 'patient_profile_v1';
  const SYNC_EVENT = 'patient_profile_updated';
  
  // ═══════════════════════════════════════
  //  ФЛАГИ ЗАЩИТЫ ОТ РЕКУРСИИ
  // ═══════════════════════════════════════
  let _isApplyingProfile = false;   // Флаг: сейчас применяется профиль к UI
  let _isHandlingSync = false;      // Флаг: сейчас обрабатывается SYNC_EVENT
  let _syncDebounceTimer = null;    // Таймер debounce для Supabase
  const SYNC_DEBOUNCE_MS = 1000;    // Задержка перед отправкой в Supabase

  // ═══════════════════════════════════════
  //  ПОЛУЧЕНИЕ ПРОФИЛЯ
  // ═══════════════════════════════════════
  function getProfile() {
    try {
      const data = localStorage.getItem(PROFILE_KEY);
      if (data) return JSON.parse(data);
    } catch (e) {
      console.error('[Profile] Ошибка чтения:', e);
    }
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
  //  ПРОВЕРКА: изменились ли данные
  // ═══════════════════════════════════════
  function hasChanged(current, updates) {
    for (const key in updates) {
      if (current[key] !== updates[key]) return true;
    }
    return false;
  }

  // ═══════════════════════════════════════
  //  СОХРАНЕНИЕ ПРОФИЛЯ (с защитой)
  // ═══════════════════════════════════════
  function saveProfile(profile, options = {}) {
    const { skipEvent = false, skipSupabase = false } = options;
    
    try {
      profile.updatedAt = Date.now();
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      
      // Диспатчим событие ТОЛЬКО если не в режиме обработки
      if (!skipEvent && !_isHandlingSync) {
        window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: profile }));
      }
      
      // Supabase с debounce
      if (!skipSupabase) {
        scheduleSupabaseSync(profile);
      }
      
      return true;
    } catch (e) {
      console.error('[Profile] ❌ Ошибка сохранения:', e);
      return false;
    }
  }

  // ═══════════════════════════════════════
  //  ОБНОВЛЕНИЕ ПОЛЕЙ (с проверкой изменений)
  // ═══════════════════════════════════════
  function updateProfile(updates) {
    // Защита от рекурсии
    if (_isApplyingProfile) {
      return false;
    }
    
    const current = getProfile();
    
    // НЕ сохраняем если ничего не изменилось
    if (!hasChanged(current, updates)) {
      return false;
    }
    
    const newProfile = { ...current, ...updates };
    return saveProfile(newProfile);
  }

  // ═══════════════════════════════════════
  //  DEBOUNCE ДЛЯ SUPABASE
  // ═══════════════════════════════════════
  function scheduleSupabaseSync(profile) {
    if (_syncDebounceTimer) {
      clearTimeout(_syncDebounceTimer);
    }
    _syncDebounceTimer = setTimeout(() => {
      syncToSupabase(profile);
    }, SYNC_DEBOUNCE_MS);
  }

  // ═══════════════════════════════════════
  //  ПРИМЕНЕНИЕ ПРОФИЛЯ К UI (БЕЗ КЛИКОВ!)
  // ═══════════════════════════════════════
  function applyProfileToPage() {
    // Защита от рекурсии
    if (_isApplyingProfile) return;
    
    _isApplyingProfile = true;
    
    try {
      const profile = getProfile();
      
      // 1. Обновляем select-элементы пола (напрямую, без кликов)
      document.querySelectorAll('select[id*="sex"], select[id*="Sex"], select[name*="sex"]')
        .forEach(select => {
          if (select.value !== profile.sex) {
            select.value = profile.sex;
            // Диспатчим change для других слушателей, но без рекурсии
            select.dispatchEvent(new Event('change', { bubbles: false }));
          }
        });
      
      // 2. Обновляем поля возраста (напрямую)
      document.querySelectorAll('input[id*="age"], input[id*="Age"], input[name*="age"]')
        .forEach(input => {
          if (input.type === 'number' && input.value !== String(profile.age)) {
            input.value = profile.age;
            input.dispatchEvent(new Event('input', { bubbles: false }));
          }
        });
      
      // 3. Обновляем pill-кнопки пола (НАПРЯМУЮ через CSS, БЕЗ btn.click())
      const femaleBtn = document.getElementById('sexFemale');
      const maleBtn = document.getElementById('sexMale');
      
      if (femaleBtn && maleBtn) {
        // Обновляем локальную переменную selectedSex
        if (typeof window.selectSex === 'function') {
          // Вместо клика — временно блокируем selectSex от вызова updateProfile
          const originalUpdate = window.PatientProfile.update;
          window.PatientProfile.update = () => false; // заглушка
          
          try {
            window.selectSex(profile.sex);
          } finally {
            window.PatientProfile.update = originalUpdate; // восстановление
          }
        }
      }
      
    } catch (e) {
      console.error('[Profile] Ошибка применения:', e);
    } finally {
      // Снимаем флаг с задержкой, чтобы избежать race conditions
      setTimeout(() => {
        _isApplyingProfile = false;
      }, 50);
    }
  }

  // ═══════════════════════════════════════
  //  СЛУШАТЕЛИ ИЗМЕНЕНИЙ НА СТРАНИЦЕ
  // ═══════════════════════════════════════
  function setupPageListeners() {
    // Изменения селекторов пола
    document.addEventListener('change', (e) => {
      if (_isApplyingProfile) return; // Защита
      
      if (e.target.matches('select[id*="sex"], select[id*="Sex"], select[name*="sex"]')) {
        updateProfile({ sex: e.target.value });
      }
    });
    
    // Изменения полей возраста
    document.addEventListener('input', (e) => {
      if (_isApplyingProfile) return; // Защита
      
      if (e.target.matches('input[id*="age"], input[id*="Age"], input[name*="age"]')) {
        if (e.target.type === 'number') {
          const age = parseInt(e.target.value) || 35;
          updateProfile({ age });
        }
      }
    });
    
    // Клики по кнопкам пола (только пользовательские)
    document.addEventListener('click', (e) => {
      if (_isApplyingProfile) return; // Защита от программных кликов
      
      const btn = e.target.closest('[onclick*="selectSex"]');
      if (btn) {
        const onclick = btn.getAttribute('onclick');
        const match = onclick.match(/selectSex\(['"](\w+)['"]\)/);
        if (match) {
          // Отложенное обновление, чтобы selectSex успел отработать
          setTimeout(() => {
            if (!_isApplyingProfile) {
              updateProfile({ sex: match[1] });
            }
          }, 50);
        }
      }
    });
  }

  // ═══════════════════════════════════════
  //  КРОСС-ВКЛАДОЧНАЯ СИНХРОНИЗАЦИЯ
  // ═══════════════════════════════════════
  function setupCrossTabSync() {
    window.addEventListener('storage', (e) => {
      if (e.key === PROFILE_KEY && e.newValue) {
        try {
          const profile = JSON.parse(e.newValue);
          _isHandlingSync = true;
          applyProfileToPage();
          setTimeout(() => { _isHandlingSync = false; }, 100);
        } catch (err) {
          console.error('[Profile] Ошибка парсинга:', err);
        }
      }
    });
    
    window.addEventListener(SYNC_EVENT, (e) => {
      if (_isHandlingSync) return;
      _isHandlingSync = true;
      applyProfileToPage();
      setTimeout(() => { _isHandlingSync = false; }, 100);
    });
  }

  // ═══════════════════════════════════════
  //  SUPABASE СИНХРОНИЗАЦИЯ
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
      console.warn('[Profile] ⚠️ Ошибка Supabase:', e.message);
    }
  }

  async function loadFromSupabase() {
    if (!window.SupabaseDB) return;
    
    try {
      const user = await window.SupabaseDB.getCurrentUser();
      if (!user || !user.profile) return;
      
      const current = getProfile();
      const updates = {};
      
      if (user.profile.sex && user.profile.sex !== 'unknown' && user.profile.sex !== current.sex) {
        updates.sex = user.profile.sex;
      }
      if (user.profile.age && user.profile.age > 0 && user.profile.age !== current.age) {
        updates.age = user.profile.age;
      }
      if (user.profile.height && user.profile.height !== current.height) {
        updates.height = user.profile.height;
      }
      if (user.profile.weight && user.profile.weight !== current.weight) {
        updates.weight = user.profile.weight;
      }
      
      if (Object.keys(updates).length > 0) {
        // Сохраняем без события и без Supabase (чтобы не зациклить)
        const newProfile = { ...current, ...updates };
        saveProfile(newProfile, { skipEvent: true, skipSupabase: true });
        applyProfileToPage();
      }
    } catch (e) {
      console.warn('[Profile] ⚠️ Ошибка загрузки Supabase:', e.message);
    }
  }

  // ═══════════════════════════════════════
  //  ИНИЦИАЛИЗАЦИЯ
  // ═══════════════════════════════════════
  function init() {
    console.log('[Profile] 🚀 Инициализация v2.0');
    
    loadFromSupabase().then(() => {
      applyProfileToPage();
    });
    
    setupPageListeners();
    setupCrossTabSync();
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ API
  // ═══════════════════════════════════════
  window.PatientProfile = {
    get: getProfile,
    save: (profile) => saveProfile(profile),
    update: updateProfile,
    apply: applyProfileToPage,
    init,
    version: '2.0.0'
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();