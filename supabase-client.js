/**
 * SUPABASE CLIENT v1.1
 * Онлайн SQL-база данных (PostgreSQL)
 */
(function() {
  'use strict';

  // ═══════ КОНФИГУРАЦИЯ ═══════
  // ⚠️ ЗАМЕНИТЕ на свои значения из Supabase Dashboard → Settings → API
  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';   // ← ваш URL
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';            // ← ваш anon key

  let supabase = null;
  let initPromise = null;  // ← защита от множественной инициализации

  // ═══════ ЗАГРУЗКА SDK (один раз) ═══════
  function loadSDK() {
    return new Promise((resolve, reject) => {
      if (window.supabase) return resolve(window.supabase);
      
      // Проверяем, не грузится ли уже
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

  // ═══════ ИНИЦИАЛИЗАЦИЯ (ленивая, один раз) ═══════
  async function init() {
    // Если уже инициализирован — возвращаем существующий
    if (supabase) return supabase;
    
    // Если идёт процесс инициализации — ждём его
    if (initPromise) return initPromise;
    
    initPromise = (async () => {
      try {
        // Проверка конфигурации
        if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY')) {
          console.warn('[DB] ⚠️ Supabase не настроен! Замените YOUR-PROJECT и YOUR-ANON-KEY в supabase-client.js');
          return null;
        }
        
        const sdk = await loadSDK();
        supabase = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
          auth: {
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
            storageKey: 'family-doctor-auth'  // ← уникальный ключ, чтобы не конфликтовать
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
    if (!sb) throw new Error('Supabase не настроен. Проверьте console warnings.');
    return sb;
  }

  // ═══════════════════════════════════════
  //  АУТЕНТИФИКАЦИЯ
  // ═══════════════════════════════════════
  async function register({ email, password, name, username, sex, age }) {
    const sb = await ensureInit();
    const { data, error } = await sb.auth.signUp({
      email,
      password,
      options: {
        data: { name, username, sex, age }
      }
    });
    if (error) throw new Error(error.message);
    return data;
  }

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

  async function getCurrentUser() {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    
    const { data: profile, error } = await sb
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();
    
    if (error) {
      console.warn('[DB] Profile fetch error:', error.message);
      return { ...user, profile: null };
    }
    
    return { ...user, profile };
  }

  async function onAuthChange(callback) {
    const sb = await ensureInit();
    return sb.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
  }

  // ═══════════════════════════════════════
  //  СЕМЕЙНЫЕ ПРОФИЛИ
  // ═══════════════════════════════════════
  async function getFamilyMembers() {
    const sb = await ensureInit();
    const { data, error } = await sb
      .from('family_members')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function addFamilyMember({ name, relation, sex, age, birthDate }) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Не авторизован');
    
    const { data, error } = await sb
      .from('family_members')
      .insert({
        user_id: user.id,
        name, relation, sex, age,
        birth_date: birthDate,
        is_active: false
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function updateFamilyMember(id, updates) {
    const sb = await ensureInit();
    const { error } = await sb
      .from('family_members')
      .update(updates)
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function deleteFamilyMember(id) {
    const sb = await ensureInit();
    const { data: member, error: fetchErr } = await sb
      .from('family_members')
      .select('*')
      .eq('id', id)
      .single();
    
    if (fetchErr) throw new Error(fetchErr.message);
    if (member?.relation === 'self') throw new Error('Нельзя удалить основной профиль');
    
    const { error } = await sb.from('family_members').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function setActiveMember(id) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) throw new Error('Не авторизован');
    
    // Снимаем isActive со всех
    await sb.from('family_members')
      .update({ is_active: false })
      .eq('user_id', user.id);
    
    // Активируем выбранный
    const { error } = await sb.from('family_members')
      .update({ is_active: true })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function getActiveMember() {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    
    const { data, error } = await sb
      .from('family_members')
      .select('*')
      .eq('user_id', user.id)
      .eq('is_active', true)
      .maybeSingle();
    
    if (error) {
      console.warn('[DB] Active member error:', error.message);
      return null;
    }
    return data;
  }

  // ═══════════════════════════════════════
  //  АНАЛИЗЫ
  // ═══════════════════════════════════════
  async function saveAnalysis({ fileName, results, familyMemberId }) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb
      .from('analyses')
      .insert({
        user_id: user.id,
        family_member_id: familyMemberId || null,
        file_name: fileName,
        results,
        analysis_date: new Date().toISOString().split('T')[0]
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function getAnalyses(familyMemberId = null) {
    const sb = await ensureInit();
    let query = sb.from('analyses').select('*').order('analysis_date', { ascending: false });
    if (familyMemberId) query = query.eq('family_member_id', familyMemberId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ═══════════════════════════════════════
  //  ДНЕВНИК
  // ═══════════════════════════════════════
  async function saveDiaryEntry({ metricType, value, familyMemberId }) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb
      .from('diary_entries')
      .insert({
        user_id: user.id,
        family_member_id: familyMemberId || null,
        metric_type: metricType,
        value
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function getDiaryEntries(metricType, familyMemberId = null, daysBack = 30) {
    const sb = await ensureInit();
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    let query = sb.from('diary_entries')
      .select('*')
      .eq('metric_type', metricType)
      .gte('entry_date', cutoff)
      .order('entry_date', { ascending: true });
    if (familyMemberId) query = query.eq('family_member_id', familyMemberId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ═══════════════════════════════════════
  //  КАЛЕНДАРЬ
  // ═══════════════════════════════════════
  async function saveHealthEvent({ eventType, title, scheduledDate, familyMemberId, description }) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb
      .from('health_events')
      .insert({
        user_id: user.id,
        family_member_id: familyMemberId || null,
        event_type: eventType,
        title,
        description,
        scheduled_date: scheduledDate
      })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function getHealthEvents(familyMemberId = null) {
    const sb = await ensureInit();
    let query = sb.from('health_events').select('*').order('scheduled_date', { ascending: true });
    if (familyMemberId) query = query.eq('family_member_id', familyMemberId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  async function markEventCompleted(id) {
    const sb = await ensureInit();
    const { error } = await sb
      .from('health_events')
      .update({ completed: true, completed_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  // ═══════════════════════════════════════
  //  СТАТИСТИКА
  // ═══════════════════════════════════════
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
      console.warn('[DB] Stats error:', e.message);
      return { familyMembers: 0, analyses: 0, diaryEntries: 0, healthEvents: 0 };
    }
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ
  // ═══════════════════════════════════════
  async function exportUserData() {
    const sb = await ensureInit();
    const user = await getCurrentUser();
    const [familyMembers, analyses, diaryEntriesRes, healthEvents] = await Promise.all([
      getFamilyMembers(),
      getAnalyses(),
      sb.from('diary_entries').select('*'),
      getHealthEvents()
    ]);
    
    return JSON.stringify({
      version: '2.0',
      exportDate: new Date().toISOString(),
      user: { email: user?.email, name: user?.profile?.name },
      familyMembers,
      analyses: analyses || [],
      diaryEntries: diaryEntriesRes.data || [],
      healthEvents
    }, null, 2);
  }

  // ═══════════════════════════════════════
  //  ЭКСПОРТ API
  // ═══════════════════════════════════════
  window.SupabaseDB = {
    init,
    register, login, logout, getCurrentUser, onAuthChange,
    getFamilyMembers, addFamilyMember, updateFamilyMember, deleteFamilyMember,
    setActiveMember, getActiveMember,
    saveAnalysis, getAnalyses,
    saveDiaryEntry, getDiaryEntries,
    saveHealthEvent, getHealthEvents, markEventCompleted,
    getUserStats, exportUserData,
    version: '1.1.0'
  };

  // НЕ вызываем init() автоматически — он будет вызван лениво при первом запросе
})();