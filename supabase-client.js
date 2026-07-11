/**
 * SUPABASE CLIENT v1.4
 * С поддержкой ФИО, аватаров и блокировки изменений
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

  const AVATAR_BUCKET = 'avatars';
  const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
  const SUPPORT_EMAIL = 'support@familydoctor.ai';
  const SUPPORT_TELEGRAM = '@familydoctor_support';

  let supabase = null;
  let initPromise = null;

  function loadSDK() {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve(window.supabase);
      const existing = document.querySelector('script[data-supabase-sdk]');
      if (existing) {
        existing.addEventListener('load', () => resolve(window.supabase));
        existing.addEventListener('error', reject);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.dataset.supabaseSdk = 'true';
      script.onload = () => resolve(window.supabase);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  async function init() {
    if (supabase) return supabase;
    if (initPromise) return initPromise;
    
    initPromise = (async () => {
      try {
        if (SUPABASE_URL.includes('YOUR-PROJECT')) {
          console.warn('[DB] ⚠️ Supabase не настроен');
          return null;
        }
        const sdk = await loadSDK();
        supabase = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            storageKey: 'family-doctor-auth'
          }
        });
        console.log('[DB] ✅ Supabase инициализирован');
        return supabase;
      } catch (err) {
        console.error('[DB] ❌ Ошибка инициализации:', err);
        initPromise = null;
        throw err;
      }
    })();
    
    return initPromise;
  }

  async function ensureInit() {
    const sb = await init();
    if (!sb) throw new Error('Supabase не настроен');
    return sb;
  }

  // ═══════════════════════════════════════
  //  РЕГИСТРАЦИЯ С ФИО
  // ═══════════════════════════════════════
  async function register({ 
    email, password, 
    firstName, lastName, patronymic, 
    sex, age, birthDate, avatarFile 
  }) {
    const sb = await ensureInit();
    
    if (!firstName || !lastName) {
      throw new Error('Фамилия и имя обязательны');
    }
    
    const fullName = [lastName, firstName, patronymic].filter(Boolean).join(' ');
    
    const { data: authData, error: authError } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { 
          name: fullName,
          first_name: firstName,
          last_name: lastName,
          patronymic: patronymic || '',
          sex, 
          age,
          birth_date: birthDate
        }
      }
    });
    if (authError) throw new Error(authError.message);
    
    if (avatarFile && authData.user) {
      try {
        const avatarUrl = await uploadAvatar(avatarFile, authData.user.id);
        await sb.from('profiles')
          .update({ avatar_url: avatarUrl })
          .eq('id', authData.user.id);
      } catch (e) {
        console.warn('[DB] Avatar upload failed:', e.message);
      }
    }
    
    return authData;
  }

  // ═══════════════════════════════════════
  //  ВХОД / ВЫХОД
  // ═══════════════════════════════════════
  async function login({ email, password }) {
    const sb = await ensureInit();
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data;
  }

  async function logout() {
    const sb = await ensureInit();
    const { error } = await sb.auth.signOut();
    if (error) throw new Error(error.message);
  }

  // ═══════════════════════════════════════
  //  ТЕКУЩИЙ ПОЛЬЗОВАТЕЛЬ
  // ═══════════════════════════════════════
  async function getCurrentUser() {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    
    const { data: profile } = await sb
      .from('profiles').select('*').eq('id', user.id).maybeSingle();
    
    if (!profile) {
      return { 
        ...user, 
        profile: { 
          name: user.user_metadata?.name || user.email?.split('@')[0],
          first_name: user.user_metadata?.first_name || '',
          last_name: user.user_metadata?.last_name || '',
          fio_locked: false
        } 
      };
    }
    
    return { ...user, profile };
  }

  // ═══════════════════════════════════════
  //  ОБНОВЛЕНИЕ ПРОФИЛЯ (без ФИО если locked)
  // ═══════════════════════════════════════
  async function updateProfile(updates) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Не авторизован');
    
    // Получаем текущий профиль
    const { data: current } = await sb
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    
    // Если ФИО заблокировано — убираем из updates
    if (current?.fio_locked) {
      delete updates.first_name;
      delete updates.last_name;
      delete updates.patronymic;
      delete updates.full_name;
    }
    
    // Если передаются новые ФИО — формируем full_name
    if (updates.first_name || updates.last_name) {
      const fn = updates.first_name || current?.first_name || '';
      const ln = updates.last_name || current?.last_name || '';
      const pt = updates.patronymic ?? current?.patronymic ?? '';
      updates.full_name = [ln, fn, pt].filter(Boolean).join(' ');
      updates.name = updates.full_name;
    }
    
    // Если обновляется дата рождения — пересчитываем возраст
    if (updates.birth_date) {
      const birthDate = new Date(updates.birth_date);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      updates.age = age;
    }
    
    const { error } = await sb
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    
    if (error) throw new Error(error.message);
    return true;
  }

  // ═══════════════════════════════════════
  //  ЗАПРОС НА СМЕНУ ФИО (через поддержку)
  // ═══════════════════════════════════════
  function getFioChangeRequestData() {
    return {
      supportEmail: SUPPORT_EMAIL,
      supportTelegram: SUPPORT_TELEGRAM,
      messageTemplate: `Здравствуйте!\n\nПрошу изменить ФИО в моём аккаунте.\n\nEmail: {email}\nТекущее ФИО: {currentFio}\nНовое ФИО: {newFio}\nПричина: {reason}\n\nСпасибо!`
    };
  }

  // ═══════════════════════════════════════
  //  ЗАГРУЗКА АВАТАРА
  // ═══════════════════════════════════════
  async function uploadAvatar(file, userIdOverride = null) {
    const sb = await ensureInit();
    
    if (!file.type.startsWith('image/')) {
      throw new Error('Файл должен быть изображением');
    }
    if (file.size > MAX_AVATAR_SIZE) {
      throw new Error('Размер файла не должен превышать 2 МБ');
    }
    
    const { data: { user } } = await sb.auth.getUser();
    const userId = userIdOverride || user?.id;
    if (!userId) throw new Error('Не авторизован');
    
    // Сжимаем изображение
    const compressedBlob = await compressImage(file, 400, 0.85);
    
    // Генерируем имя файла
    const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
    const fileName = `${userId}/avatar_${Date.now()}.${ext}`;
    
    // Удаляем старый аватар если есть
    try {
      const { data: existing } = await sb.storage
        .from(AVATAR_BUCKET)
        .list(`${userId}`);
      if (existing && existing.length > 0) {
        await sb.storage.from(AVATAR_BUCKET)
          .remove(existing.map(f => `${userId}/${f.name}`));
      }
    } catch (e) {
      console.warn('[DB] Old avatar cleanup failed:', e.message);
    }
    
    // Загружаем новый
    const { data, error } = await sb.storage
      .from(AVATAR_BUCKET)
      .upload(fileName, compressedBlob, {
        contentType: 'image/jpeg',
        upsert: true
      });
    
    if (error) throw new Error(error.message);
    
    // Получаем публичный URL
    const { data: urlData } = sb.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(fileName);
    
    const avatarUrl = urlData.publicUrl;
    
    // Обновляем профиль (только если это не регистрация)
    if (!userIdOverride) {
      await sb.from('profiles')
        .update({ avatar_url: avatarUrl })
        .eq('id', userId);
    }
    
    return avatarUrl;
  }

  // Сжатие изображения через canvas
  function compressImage(file, maxSize = 400, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;
          
          if (width > height) {
            if (width > maxSize) {
              height = (height * maxSize) / width;
              width = maxSize;
            }
          } else {
            if (height > maxSize) {
              width = (width * maxSize) / height;
              height = maxSize;
            }
          }
          
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          
          canvas.toBlob(
            (blob) => blob ? resolve(blob) : reject(new Error('Compression failed')),
            'image/jpeg',
            quality
          );
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function deleteAvatar() {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Не авторизован');
    
    try {
      const { data: existing } = await sb.storage
        .from(AVATAR_BUCKET)
        .list(`${user.id}`);
      if (existing && existing.length > 0) {
        await sb.storage.from(AVATAR_BUCKET)
          .remove(existing.map(f => `${user.id}/${f.name}`));
      }
    } catch (e) {}
    
    await sb.from('profiles')
      .update({ avatar_url: null })
      .eq('id', user.id);
    
    return true;
  }

  // ═══════════════════════════════════════
  //  ОСТАЛЬНОЕ БЕЗ ИЗМЕНЕНИЙ (family_members, diary, etc)
  // ═══════════════════════════════════════
  async function getFamilyMembers() {
    const sb = await ensureInit();
    const { data, error } = await sb.from('family_members').select('*').order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function addFamilyMember({ name, relation, sex, age, birthDate }) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('family_members').insert({
      user_id: user.id, name, relation, sex, age,
      birth_date: birthDate, is_active: false
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function setActiveMember(id) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    await sb.from('family_members').update({ is_active: false }).eq('user_id', user.id);
    await sb.from('family_members').update({ is_active: true }).eq('id', id);
  }

  async function getActiveMember() {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from('family_members').select('*')
      .eq('user_id', user.id).eq('is_active', true).maybeSingle();
    return data;
  }

  async function saveDiaryEntry({ metricType, value, familyMemberId }) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('diary_entries').insert({
      user_id: user.id, family_member_id: familyMemberId || null,
      metric_type: metricType, value
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function getUserStats() {
    try {
      const sb = await ensureInit();
      const [fm, an, de, he] = await Promise.all([
        sb.from('family_members').select('*', { count: 'exact', head: true }),
        sb.from('analyses').select('*', { count: 'exact', head: true }),
        sb.from('diary_entries').select('*', { count: 'exact', head: true }),
        sb.from('health_events').select('*', { count: 'exact', head: true })
      ]);
      return {
        familyMembers: fm.count || 0,
        analyses: an.count || 0,
        diaryEntries: de.count || 0,
        healthEvents: he.count || 0
      };
    } catch (e) {
      return { familyMembers: 0, analyses: 0, diaryEntries: 0, healthEvents: 0 };
    }
  }

  async function exportUserData() {
    const sb = await ensureInit();
    const user = await getCurrentUser();
    return JSON.stringify({
      version: '2.0', exportDate: new Date().toISOString(),
      user: { 
        email: user?.email, 
        name: user?.profile?.full_name || user?.profile?.name,
        first_name: user?.profile?.first_name,
        last_name: user?.profile?.last_name
      }
    }, null, 2);
  }

// ═══════════════════════════════════════
//  АВТОМАТИЧЕСКОЕ ОБНОВЛЕНИЕ ВОЗРАСТА
// ═══════════════════════════════════════
async function updateAgeIfBirthday() {
  const sb = await ensureInit();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  
  const { data: profile } = await sb
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  
  if (!profile || !profile.birth_date) return;
  
  const birthDate = new Date(profile.birth_date);
  const today = new Date();
  
  let newAge = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    newAge--;
  }
  
  // Если возраст изменился - обновляем
  if (newAge !== profile.age) {
    await sb.from('profiles')
      .update({ age: newAge, updated_at: new Date().toISOString() })
      .eq('id', user.id);
    
    console.log(`[DB] Возраст обновлён: ${profile.age} → ${newAge}`);
    
    // Показываем поздравление если сегодня ДР
    if (today.getMonth() === birthDate.getMonth() && 
        today.getDate() === birthDate.getDate()) {
      setTimeout(() => {
        if (window.showToast) {
          window.showToast(`🎂 С днём рождения! Вам ${newAge} ${getAgeWord(newAge)}`, '🎉');
        }
      }, 1000);
    }
  }
}

function getAgeWord(age) {
  const lastDigit = age % 10;
  const lastTwoDigits = age % 100;
  
  if (lastTwoDigits >= 11 && lastTwoDigits <= 19) return 'лет';
  if (lastDigit === 1) return 'год';
  if (lastDigit >= 2 && lastDigit <= 4) return 'года';
  return 'лет';
}

  
  // ═══════════════════════════════════════
  //  ЭКСПОРТ API
  // ═══════════════════════════════════════
  window.SupabaseDB = {
    init,
    register, login, logout, getCurrentUser,
    updateProfile, uploadAvatar, deleteAvatar,
    getFioChangeRequestData,
    getFamilyMembers, addFamilyMember, setActiveMember, getActiveMember,
    saveDiaryEntry, getUserStats, exportUserData, updateAgeIfBirthday,
    SUPPORT_EMAIL, SUPPORT_TELEGRAM,
    version: '1.5.0'
  };
})();