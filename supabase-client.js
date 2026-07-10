/**
 * SUPABASE CLIENT v1.3
 * С автоматической миграцией из localStorage
 */
(function() {
  'use strict';

  // ⚠️ ЗАМЕНИТЕ на свои значения из Supabase Dashboard → Settings → API
  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

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
        if (SUPABASE_URL.includes('YOUR-PROJECT') || SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY')) {
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

  // ═══════ AUTH ═══════
  async function register({ email, password, name, sex, age }) {
    const sb = await ensureInit();
    const { data, error } = await sb.auth.signUp({
      email, password,
      options: { data: { name, sex, age } }
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
    
    const { data: profile } = await sb
      .from('profiles').select('*').eq('id', user.id).maybeSingle();
    
    return { ...user, profile: profile || { name: user.user_metadata?.name || user.email?.split('@')[0] } };
  }

  // ═══════ FAMILY MEMBERS ═══════
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

  async function updateFamilyMember(id, updates) {
    const sb = await ensureInit();
    const { error } = await sb.from('family_members').update(updates).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function deleteFamilyMember(id) {
    const sb = await ensureInit();
    const { data: member } = await sb.from('family_members').select('*').eq('id', id).single();
    if (member?.relation === 'self') throw new Error('Нельзя удалить основной профиль');
    const { error } = await sb.from('family_members').delete().eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function setActiveMember(id) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    await sb.from('family_members').update({ is_active: false }).eq('user_id', user.id);
    const { error } = await sb.from('family_members').update({ is_active: true }).eq('id', id);
    if (error) throw new Error(error.message);
  }

  async function getActiveMember() {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return null;
    const { data } = await sb.from('family_members').select('*')
      .eq('user_id', user.id).eq('is_active', true).maybeSingle();
    return data;
  }

  // ═══════ DIARY ENTRIES ═══════
  async function saveDiaryEntry({ metricType, value, familyMemberId }) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('diary_entries').insert({
      user_id: user.id,
      family_member_id: familyMemberId || null,
      metric_type: metricType,
      value
    }).select().single();
    if (error) throw new Error(error.message);
    return data;
  }

  async function getDiaryEntries(metricType, familyMemberId = null, daysBack = 30) {
    const sb = await ensureInit();
    const cutoff = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
    let query = sb.from('diary_entries').select('*')
      .eq('metric_type', metricType).gte('entry_date', cutoff)
      .order('entry_date', { ascending: true });
    if (familyMemberId) query = query.eq('family_member_id', familyMemberId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ═══════ HEALTH EVENTS ═══════
  async function saveHealthEvent({ eventType, title, scheduledDate, familyMemberId }) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('health_events').insert({
      user_id: user.id, family_member_id: familyMemberId || null,
      event_type: eventType, title, scheduled_date: scheduledDate
    }).select().single();
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
    await sb.from('health_events').update({ completed: true, completed_at: new Date().toISOString() }).eq('id', id);
  }

  // ═══════ ANALYSES ═══════
  async function saveAnalysis({ fileName, results, familyMemberId }) {
    const sb = await ensureInit();
    const { data: { user } } = await sb.auth.getUser();
    const { data, error } = await sb.from('analyses').insert({
      user_id: user.id,
      family_member_id: familyMemberId || null,
      file_name: fileName, results,
      analysis_date: new Date().toISOString().split('T')[0]
    }).select().single();
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

  // ═══════ STATS ═══════
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

  // ═══════ ЭКСПОРТ ═══════
  async function exportUserData() {
    const sb = await ensureInit();
    const user = await getCurrentUser();
    const [familyMembers, analyses, diaryRes, healthEvents] = await Promise.all([
      getFamilyMembers(), getAnalyses(),
      sb.from('diary_entries').select('*'),
      getHealthEvents()
    ]);
    return JSON.stringify({
      version: '2.0', exportDate: new Date().toISOString(),
      user: { email: user?.email, name: user?.profile?.name },
      familyMembers, analyses: analyses || [],
      diaryEntries: diaryRes.data || [],
      healthEvents
    }, null, 2);
  }

  // ═══════════════════════════════════════
  //  МИГРАЦИЯ ИЗ LOCALSTORAGE
  // ═══════════════════════════════════════
  async function migrateFromLocalStorage() {
    try {
      const sb = await ensureInit();
      const user = await getCurrentUser();
      if (!user) return { migrated: false, reason: 'no_user' };
      
      const migrationKey = `migrated_for_user_${user.id}`;
      if (localStorage.getItem(migrationKey)) {
        return { migrated: false, reason: 'already_migrated' };
      }
      
      const stats = {
        familyMembers: 0, analyses: 0,
        diaryEntries: 0, healthEvents: 0,
        nutritionPlans: 0
      };
      
      // 1. Миграция family_profiles_v4
      const profilesData = localStorage.getItem('family_profiles_v4');
      if (profilesData) {
        try {
          const profiles = JSON.parse(profilesData);
          for (const p of profiles) {
            if (p.id === 'self') continue;
            await sb.from('family_members').insert({
              user_id: user.id, relation: 'other',
              name: p.name, sex: 'unknown', age: 0,
              is_active: false
            });
            stats.familyMembers++;
          }
        } catch(e) { console.warn('Migration family_profiles error:', e); }
      }
      
      // 2. Миграция analysis_history_v4
      const historyData = localStorage.getItem('analysis_history_v4');
      if (historyData) {
        try {
          const history = JSON.parse(historyData);
          for (const memberId in history) {
            const entries = history[memberId] || [];
            for (const entry of entries) {
              await sb.from('analyses').insert({
                user_id: user.id,
                family_member_id: null,
                file_name: entry.label || 'Анализ',
                results: JSON.stringify({ count: entry.count || 0 }),
                analysis_date: new Date(entry.date).toISOString().split('T')[0]
              });
              stats.analyses++;
            }
          }
        } catch(e) { console.warn('Migration analyses error:', e); }
      }
      
      // 3. Миграция health_diary_v1
      const diaryData = localStorage.getItem('health_diary_v1');
      if (diaryData) {
        try {
          const diary = JSON.parse(diaryData);
          for (const metricType in diary) {
            const entries = diary[metricType] || [];
            for (const entry of entries) {
              await sb.from('diary_entries').insert({
                user_id: user.id,
                family_member_id: null,
                metric_type: metricType,
                value: entry,
                entry_date: new Date(entry.date || Date.now()).toISOString()
              });
              stats.diaryEntries++;
            }
          }
        } catch(e) { console.warn('Migration diary error:', e); }
      }
      
      // 4. Миграция health_calendar_v1
      const calendarData = localStorage.getItem('health_calendar_v1');
      if (calendarData) {
        try {
          const calendar = JSON.parse(calendarData);
          for (const c of calendar.completed || []) {
            await sb.from('health_events').insert({
              user_id: user.id, event_type: c.id,
              title: c.id, scheduled_date: new Date(c.date).toISOString().split('T')[0],
              completed: true, completed_at: new Date(c.date).toISOString()
            });
            stats.healthEvents++;
          }
          for (const p of calendar.planned || []) {
            await sb.from('health_events').insert({
              user_id: user.id, event_type: p.id,
              title: p.id, scheduled_date: new Date(p.date).toISOString().split('T')[0],
              completed: false
            });
            stats.healthEvents++;
          }
        } catch(e) { console.warn('Migration calendar error:', e); }
      }
      
      // 5. Миграция nutrition_history_v1
      const nutritionData = localStorage.getItem('nutrition_history_v1');
      if (nutritionData) {
        try {
          const plans = JSON.parse(nutritionData);
          for (const plan of plans) {
            await sb.from('diary_entries').insert({
              user_id: user.id,
              metric_type: 'nutrition_plan',
              value: plan,
              entry_date: new Date(plan.date || Date.now()).toISOString()
            });
            stats.nutritionPlans++;
          }
        } catch(e) { console.warn('Migration nutrition error:', e); }
      }
      
      // Помечаем миграцию как выполненную
      localStorage.setItem(migrationKey, Date.now().toString());
      
      console.log('[DB] ✅ Миграция завершена:', stats);
      return { migrated: true, stats };
    } catch (err) {
      console.error('[DB] ❌ Ошибка миграции:', err);
      return { migrated: false, reason: 'error', error: err.message };
    }
  }

  window.SupabaseDB = {
    init,
    register, login, logout, getCurrentUser,
    getFamilyMembers, addFamilyMember, updateFamilyMember, deleteFamilyMember,
    setActiveMember, getActiveMember,
    saveAnalysis, getAnalyses,
    saveDiaryEntry, getDiaryEntries,
    saveHealthEvent, getHealthEvents, markEventCompleted,
    getUserStats, exportUserData,
    migrateFromLocalStorage,
    version: '1.3.0'
  };
})();