/**
 * Supabase Client v3.0
 * Единый клиент для всего приложения
 */
(function() {
  'use strict';

  const SUPABASE_URL = 'https://lmhdadvbgnkmgtvdzbxk.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtaGRhZHZiZ25rbWd0dmR6YnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2OTM1MTcsImV4cCI6MjA5OTI2OTUxN30.XFtx4Ytax8F7Ud_PE68jJo-EuOs6Oe_Ic0PSZTjEdNs';

  // ✅ Создаём ОДИН глобальный клиент
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true
    }
  });

  console.log('[DB] ✅ Supabase инициализирован (единый клиент)');

  // ═══════════════════════════════════════
  //  ЭКСПОРТ ГЛОБАЛЬНОГО КЛИЕНТА
  // ═══════════════════════════════════════
  window.supabaseClient = supabaseClient;

  // ═══════════════════════════════════════
  //  SUPABASE DB API (для совместимости)
  // ═══════════════════════════════════════
  window.SupabaseDB = {
    // Получить текущего пользователя
    async getCurrentUser() {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return null;
      
      const { data: profile } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      
      return { id: user.id, email: user.email, profile };
    },

    // Регистрация
    async register({ email, password, firstName, lastName, patronymic, sex, age, birthDate, avatarFile }) {
      const { data: authData, error: authError } = await supabaseClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: firstName,
            last_name: lastName,
            patronymic: patronymic || '',
            full_name: `${lastName} ${firstName} ${patronymic || ''}`.trim(),
            sex,
            age,
            birth_date: birthDate
          }
        }
      });

      if (authError) throw authError;

      // Создаём профиль
      const { error: profileError } = await supabaseClient
        .from('profiles')
        .insert({
          id: authData.user.id,
          email,
          first_name: firstName,
          last_name: lastName,
          patronymic: patronymic || '',
          full_name: `${lastName} ${firstName} ${patronymic || ''}`.trim(),
          sex,
          age,
          birth_date: birthDate,
          fio_locked: true
        });

      if (profileError) console.warn('Profile creation warning:', profileError);

      // Загружаем аватар если есть
      if (avatarFile) {
        try {
          await this.uploadAvatar(avatarFile);
        } catch (e) {
          console.warn('Avatar upload failed:', e);
        }
      }

      return authData;
    },

    // Вход
    async login({ email, password }) {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },

    // Выход
    async logout() {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
    },

    // Обновить профиль
    async updateProfile(updates) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) throw new Error('Не авторизован');

      const { error } = await supabaseClient
        .from('profiles')
        .update(updates)
        .eq('id', user.id);

      if (error) throw error;
      return true;
    },

    // Загрузить аватар
    async uploadAvatar(file) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) throw new Error('Не авторизован');

      const fileExt = file.name.split('.').pop();
      const fileName = `${user.id}-${Date.now()}.${fileExt}`;
      const filePath = `avatars/${fileName}`;

      const { error: uploadError } = await supabaseClient.storage
        .from('avatars')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabaseClient.storage
        .from('avatars')
        .getPublicUrl(filePath);

      await this.updateProfile({ avatar_url: publicUrl });
      return publicUrl;
    },

    // Удалить аватар
    async deleteAvatar() {
      const user = await this.getCurrentUser();
      if (!user || !user.profile?.avatar_url) return;

      const url = new URL(user.profile.avatar_url);
      const pathParts = url.pathname.split('/storage/v1/object/public/avatars/');
      if (pathParts[1]) {
        await supabaseClient.storage.from('avatars').remove([pathParts[1]]);
      }

      await this.updateProfile({ avatar_url: null });
    },

    // Получить членов семьи
    async getFamilyMembers() {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabaseClient
        .from('family_members')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('Failed to load family members:', error);
        return [];
      }
      return data || [];
    },

    // Добавить члена семьи
    async addFamilyMember(member) {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) throw new Error('Не авторизован');

      const { error } = await supabaseClient
        .from('family_members')
        .insert({
          user_id: user.id,
          name: member.name,
          sex: member.sex,
          age: member.age,
          birth_date: member.birth_date,
          relation: member.relation
        });

      if (error) throw error;
      return true;
    },

    // Получить активного члена семьи
    async getActiveMember() {
      const activeId = localStorage.getItem('active_family_member_id');
      if (!activeId) return null;

      const members = await this.getFamilyMembers();
      return members.find(m => m.id === activeId) || null;
    },

    // Установить активного члена семьи
    async setActiveMember(memberId) {
      localStorage.setItem('active_family_member_id', memberId);
      return true;
    },

    // Получить статистику пользователя
    async getUserStats() {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return { familyMembers: 0, analyses: 0, diaryEntries: 0 };

      const [family, analyses, diary] = await Promise.all([
        supabaseClient.from('family_members').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabaseClient.from('analyses').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        supabaseClient.from('diary_entries').select('*', { count: 'exact', head: true }).eq('user_id', user.id)
      ]);

      return {
        familyMembers: family.count || 0,
        analyses: analyses.count || 0,
        diaryEntries: diary.count || 0
      };
    },

    // Получить анализы
    async getAnalyses() {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabaseClient
        .from('analyses')
        .select('*')
        .eq('user_id', user.id)
        .order('analysis_date', { ascending: false });

      if (error) return [];
      return data || [];
    },

    // Удалить анализ
    async deleteAnalysis(id) {
      const { error } = await supabaseClient
        .from('analyses')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },

    // Экспорт данных
    async exportUserData() {
      const user = await this.getCurrentUser();
      if (!user) throw new Error('Не авторизован');

      const [analyses, diary, family] = await Promise.all([
        this.getAnalyses(),
        supabaseClient.from('diary_entries').select('*').eq('user_id', user.id),
        this.getFamilyMembers()
      ]);

      return JSON.stringify({
        user: { id: user.id, email: user.email, profile: user.profile },
        analyses: analyses,
        diary: diary.data || [],
        family: family,
        exportedAt: new Date().toISOString()
      }, null, 2);
    },

    // Получить клиента (для других модулей)
    getClient() {
      return supabaseClient;
    }
  };

  console.log('[DB] ✅ Supabase инициализирован');
})();