/**
 * MEDICAL LAB DATABASE v5.0 — EXTENDED
 * ========================================
 * Источники:
 * - Mayo Clinic Laboratories (USA)
 * - Quest Diagnostics Reference Intervals
 * - UpToDate Clinical Guidelines
 * - WHO International Standards
 * - CLSI C28-A3 Guidelines
 * - Российские клинические рекомендации МЗ РФ
 * - Invitro / Helix / KDL (РФ)
 * - Harmonisation of Reference Intervals (EU)
 *
 * v5.0: 200+ тестов, поддержка зарядов (K+, Na+, Cl-, Ca2+),
 *        расширенная лейкоформула, полная иммунограмма,
 *        все онкомаркеры, TORCH-инфекции, гепатиты, ВИЧ
 */
;(function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════
  //  УТИЛИТЫ
  // ═══════════════════════════════════════════════════════════
  function normalizeString(str) {
    if (!str) return '';
    let s = String(str).toLowerCase().trim();
    // Защищаем десятичные разделители (цифра-разделитель-цифра)
    s = s.replace(/(\d)\s*([.,])\s*(\d)/g, '$1§$3');
    // Защищаем химические обозначения с зарядами (K+, Na+, Cl-, Ca2+)
    s = s.replace(/([a-zа-я]+)(\d*)([+\-])/gi, '$1§CHARGE§$2$3');
    // Заменяем пунктуацию на пробелы (КРОМЕ + и - внутри формул)
    s = s.replace(/[—–:;()\/\\|]/g, ' ');
    s = s.replace(/\s*-\s*/g, ' ');
    s = s.replace(/[.,]/g, ' ');
    // Возвращаем десятичные разделители
    s = s.replace(/§(?!\s*CHARGE)/g, '.');
    s = s.replace(/§CHARGE§/g, '');
    // Сжимаем пробелы
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function containsWholeWord(text, word) {
    const escaped = escapeRegex(word);
    const pattern = new RegExp('(?:^|\\s|\\()' + escaped + '(?:\\s|$|\\)|,|\\.)', 'i');
    return pattern.test(text);
  }

  function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    return matrix[b.length][a.length];
  }

  // ═══════════════════════════════════════════════════════════
  //  ЛАБОРАТОРНЫЕ ТЕСТЫ (200+ тестов)
  // ═══════════════════════════════════════════════════════════
  const labTests = [
    // ═══════════════════ ОАК / CBC ═══════════════════
    { id: 'cbc_hemoglobin', canonicalName: 'Гемоглобин', shortName: 'HGB', category: 'ОАК', units: ['г/л', 'g/L', 'г/дл', 'g/dL'],
      aliases: ['гемоглобин', 'hb', 'hgb', 'hemoglobin', 'haemoglobin', 'гемоглобин крови', 'hemoglobin blood'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 132, max: 173, unit: 'г/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 117, max: 155, unit: 'г/л' },
        { sex: 'male', ageMin: 1, ageMax: 17, min: 110, max: 160, unit: 'г/л' },
        { sex: 'female', ageMin: 1, ageMax: 17, min: 110, max: 153, unit: 'г/л' }
      ] },
    { id: 'cbc_rbc', canonicalName: 'Эритроциты', shortName: 'RBC', category: 'ОАК', units: ['×10^12/л', '10^12/L', 'млн/мкл'],
      aliases: ['эритроциты', 'rbc', 'red blood cells', 'эр', 'эритроциты крови', 'красные кровяные клетки', 'red cell count'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 4.3, max: 5.9, unit: '×10^12/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 3.8, max: 5.2, unit: '×10^12/л' }
      ] },
    { id: 'cbc_hematocrit', canonicalName: 'Гематокрит', shortName: 'HCT', category: 'ОАК', units: ['%', 'л/л', 'L/L'],
      aliases: ['гематокрит', 'hct', 'hematocrit', 'packed cell volume', 'pcv'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 39, max: 51, unit: '%' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 35, max: 47, unit: '%' }
      ] },
    { id: 'cbc_mcv', canonicalName: 'Средний объём эритроцита', shortName: 'MCV', category: 'ОАК', units: ['фл', 'fL'],
      aliases: ['mcv', 'средний объем эритроцита', 'средний объём эритроцита', 'mean corpuscular volume', 'mean cell volume'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 80, max: 100, unit: 'фл' }] },
    { id: 'cbc_mch', canonicalName: 'Среднее содержание гемоглобина в эритроците', shortName: 'MCH', category: 'ОАК', units: ['пг', 'pg'],
      aliases: ['mch', 'среднее содержание гемоглобина', 'среднее содержание hb', 'mean corpuscular hemoglobin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 27, max: 34, unit: 'пг' }] },
    { id: 'cbc_mchc', canonicalName: 'Средняя концентрация гемоглобина в эритроците', shortName: 'MCHC', category: 'ОАК', units: ['г/л', 'g/L'],
      aliases: ['mchc', 'средняя концентрация гемоглобина', 'mean corpuscular hemoglobin concentration'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 320, max: 360, unit: 'г/л' }] },
    { id: 'cbc_rdw_cv', canonicalName: 'Ширина распределения эритроцитов', shortName: 'RDW-CV', category: 'ОАК', units: ['%'],
      aliases: ['rdw', 'rdw-cv', 'индекс распределения эритроцитов', 'red cell distribution width'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 11.5, max: 14.5, unit: '%' }] },
    { id: 'cbc_rdw_sd', canonicalName: 'Ширина распределения эритроцитов RDW-SD', shortName: 'RDW-SD', category: 'ОАК', units: ['фл', 'fL'],
      aliases: ['rdw-sd', 'ширина распределения эритроцитов sd', 'red cell distribution width sd'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 35, max: 56, unit: 'фл' }] },
    { id: 'cbc_reticulocytes', canonicalName: 'Ретикулоциты', shortName: 'RET', category: 'ОАК', units: ['%', '×10^9/л'],
      aliases: ['ретикулоциты', 'ret', 'reticulocytes', 'retic count'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.5, max: 2.0, unit: '%' }] },
    { id: 'cbc_reticulocytes_abs', canonicalName: 'Ретикулоциты абсолютные', shortName: 'RET#', category: 'ОАК', units: ['×10^9/л'],
      aliases: ['ретикулоциты абсолютные', 'ret absolute', 'absolute reticulocyte count'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 25, max: 100, unit: '×10^9/л' }] },
    { id: 'cbc_platelets', canonicalName: 'Тромбоциты', shortName: 'PLT', category: 'ОАК', units: ['×10^9/л', '10^9/L'],
      aliases: ['тромбоциты', 'plt', 'platelets', 'platelet count'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 150, max: 400, unit: '×10^9/л' }] },
    { id: 'cbc_mpv', canonicalName: 'Средний объём тромбоцита', shortName: 'MPV', category: 'ОАК', units: ['фл', 'fL'],
      aliases: ['mpv', 'средний объем тромбоцита', 'mean platelet volume'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 7.5, max: 11.5, unit: 'фл' }] },
    { id: 'cbc_wbc', canonicalName: 'Лейкоциты', shortName: 'WBC', category: 'ОАК', units: ['×10^9/л', '10^9/L'],
      aliases: ['лейкоциты', 'wbc', 'white blood cells', 'лейкоциты крови', 'white cell count'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 4.0, max: 9.0, unit: '×10^9/л' }] },
    { id: 'cbc_neutrophils_percent', canonicalName: 'Нейтрофилы, %', shortName: 'NEUT%', category: 'ОАК', units: ['%'],
      aliases: ['нейтрофилы', 'neut', 'neut%', 'neutrophils', 'сегментоядерные', 'палочкоядерные', 'neutrophils %'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 40, max: 75, unit: '%' }] },
    { id: 'cbc_neutrophils_abs', canonicalName: 'Нейтрофилы абсолютные', shortName: 'NEUT#', category: 'ОАК', units: ['×10^9/л', '10^9/L'],
      aliases: ['нейтрофилы abs', 'нейтрофилы абсолютные', 'neut#', 'anc', 'absolute neutrophil count'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.8, max: 7.5, unit: '×10^9/л' }] },
    { id: 'cbc_lymphocytes_percent', canonicalName: 'Лимфоциты, %', shortName: 'LYMPH%', category: 'ОАК', units: ['%'],
      aliases: ['лимфоциты', 'lymph', 'lym', 'lymph%', 'lymphocytes', 'лимфоциты %'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 19, max: 45, unit: '%' }] },
    { id: 'cbc_lymphocytes_abs', canonicalName: 'Лимфоциты абсолютные', shortName: 'LYMPH#', category: 'ОАК', units: ['×10^9/л', '10^9/L'],
      aliases: ['лимфоциты abs', 'лимфоциты абсолютные', 'lymph#', 'lym#', 'absolute lymphocyte count'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.0, max: 4.0, unit: '×10^9/л' }] },
    { id: 'cbc_monocytes_percent', canonicalName: 'Моноциты, %', shortName: 'MONO%', category: 'ОАК', units: ['%'],
      aliases: ['моноциты', 'mono', 'mon%', 'monocytes', 'моноциты %'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2, max: 10, unit: '%' }] },
    { id: 'cbc_monocytes_abs', canonicalName: 'Моноциты абсолютные', shortName: 'MONO#', category: 'ОАК', units: ['×10^9/л'],
      aliases: ['моноциты abs', 'моноциты абсолютные', 'mono#', 'absolute monocyte count'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.1, max: 0.9, unit: '×10^9/л' }] },
    { id: 'cbc_eosinophils_percent', canonicalName: 'Эозинофилы, %', shortName: 'EO%', category: 'ОАК', units: ['%'],
      aliases: ['эозинофилы', 'eosinophils', 'eo', 'eos', 'эозинофилы %', 'eo%'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: '%' }] },
    { id: 'cbc_eosinophils_abs', canonicalName: 'Эозинофилы абсолютные', shortName: 'EO#', category: 'ОАК', units: ['×10^9/л'],
      aliases: ['эозинофилы abs', 'эозинофилы абсолютные', 'eo#', 'absolute eosinophil count'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.02, max: 0.5, unit: '×10^9/л' }] },
    { id: 'cbc_basophils_percent', canonicalName: 'Базофилы, %', shortName: 'BASO%', category: 'ОАК', units: ['%'],
      aliases: ['базофилы', 'baso', 'bas', 'basophils', 'базофилы %', 'baso%'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 1, unit: '%' }] },
    { id: 'cbc_basophils_abs', canonicalName: 'Базофилы абсолютные', shortName: 'BASO#', category: 'ОАК', units: ['×10^9/л'],
      aliases: ['базофилы abs', 'базофилы абсолютные', 'baso#', 'absolute basophil count'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0.2, unit: '×10^9/л' }] },
    { id: 'cbc_immature_granulocytes', canonicalName: 'Незрелые гранулоциты', shortName: 'IG', category: 'ОАК', units: ['%'],
      aliases: ['незрелые гранулоциты', 'ig', 'immature granulocytes'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 1.0, unit: '%' }] },
    { id: 'cbc_esr', canonicalName: 'СОЭ', shortName: 'ESR', category: 'ОАК', units: ['мм/ч', 'mm/h'],
      aliases: ['соэ', 'скорость оседания эритроцитов', 'esr', 'erythrocyte sedimentation rate', 'роэ'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 50, min: 0, max: 15, unit: 'мм/ч' },
        { sex: 'female', ageMin: 18, ageMax: 50, min: 0, max: 20, unit: 'мм/ч' },
        { sex: 'male', ageMin: 51, ageMax: 120, min: 0, max: 20, unit: 'мм/ч' },
        { sex: 'female', ageMin: 51, ageMax: 120, min: 0, max: 30, unit: 'мм/ч' }
      ] },

    // ═══════════════════ БИОХИМИЯ ═══════════════════
    { id: 'biochem_glucose', canonicalName: 'Глюкоза натощак', shortName: 'GLU', category: 'Биохимия', units: ['ммоль/л', 'mg/dL'],
      aliases: ['глюкоза', 'глюкоза крови', 'сахар', 'сахар крови', 'glu', 'glucose', 'fasting glucose', 'глюкоза натощак', 'blood sugar'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.9, max: 6.1, unit: 'ммоль/л' }],
      interpretationBands: [
        { label: 'норма', max: 5.5, unit: 'ммоль/л' },
        { label: 'нарушенная гликемия натощак', min: 5.6, max: 6.9, unit: 'ммоль/л' },
        { label: 'диабет', min: 7.0, unit: 'ммоль/л' }
      ] },
    { id: 'biochem_hba1c', canonicalName: 'Гликированный гемоглобин', shortName: 'HbA1c', category: 'Биохимия', units: ['%', 'ммоль/моль'],
      aliases: ['гликированный гемоглобин', 'гликозилированный гемоглобин', 'hba1c', 'a1c', 'glycated hemoglobin', 'hba1c%'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 4.0, max: 6.0, unit: '%' }],
      interpretationBands: [
        { label: 'норма', max: 5.7, unit: '%' },
        { label: 'преддиабет', min: 5.7, max: 6.4, unit: '%' },
        { label: 'диабет', min: 6.5, unit: '%' }
      ] },
    { id: 'biochem_fructosamine', canonicalName: 'Фруктозамин', shortName: 'Fructosamine', category: 'Биохимия', units: ['мкмоль/л'],
      aliases: ['фруктозамин', 'fructosamine'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 200, max: 285, unit: 'мкмоль/л' }] },
    { id: 'biochem_insulin', canonicalName: 'Инсулин натощак', shortName: 'INS', category: 'Биохимия', units: ['мкЕд/мл', 'мЕд/л', 'µIU/mL'],
      aliases: ['инсулин', 'инсулин натощак', 'insulin', 'fasting insulin', 'immunoreactive insulin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2.6, max: 24.9, unit: 'мкЕд/мл' }] },
    { id: 'biochem_c_peptide', canonicalName: 'C-пептид', shortName: 'C-peptide', category: 'Биохимия', units: ['нг/мл', 'нмоль/л'],
      aliases: ['с-пептид', 'c-peptide', 'connecting peptide'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.1, max: 4.4, unit: 'нг/мл' }] },
    { id: 'biochem_total_cholesterol', canonicalName: 'Холестерин общий', shortName: 'TC', category: 'Липидограмма', units: ['ммоль/л', 'mg/dL'],
      aliases: ['холестерин общий', 'общий холестерин', 'холестерин', 'total cholesterol', 'tc', 'chol'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5.2, unit: 'ммоль/л' }],
      interpretationBands: [
        { label: 'оптимальный', max: 5.2, unit: 'ммоль/л' },
        { label: 'пограничный', min: 5.2, max: 6.2, unit: 'ммоль/л' },
        { label: 'высокий', min: 6.2, unit: 'ммоль/л' }
      ] },
    { id: 'biochem_ldl', canonicalName: 'Холестерин ЛПНП', shortName: 'LDL-C', category: 'Липидограмма', units: ['ммоль/л', 'mg/dL'],
      aliases: ['лпнп', 'холестерин лпнп', 'липопротеины низкой плотности', 'ldl', 'ldl-c', 'ldl cholesterol'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 3.0, unit: 'ммоль/л' }] },
    { id: 'biochem_hdl', canonicalName: 'Холестерин ЛПВП', shortName: 'HDL-C', category: 'Липидограмма', units: ['ммоль/л', 'mg/dL'],
      aliases: ['лпвп', 'холестерин лпвп', 'липопротеины высокой плотности', 'hdl', 'hdl-c', 'hdl cholesterol'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 1.0, max: null, unit: 'ммоль/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 1.2, max: null, unit: 'ммоль/л' }
      ] },
    { id: 'biochem_vldl', canonicalName: 'Холестерин ЛПОНП', shortName: 'VLDL-C', category: 'Липидограмма', units: ['ммоль/л'],
      aliases: ['лпонп', 'холестерин лпонп', 'vldl', 'vldl-c'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0.9, unit: 'ммоль/л' }] },
    { id: 'biochem_triglycerides', canonicalName: 'Триглицериды', shortName: 'TG', category: 'Липидограмма', units: ['ммоль/л', 'mg/dL'],
      aliases: ['триглицериды', 'тг', 'tg', 'triglycerides', 'trig'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 1.7, unit: 'ммоль/л' }] },
    { id: 'biochem_lpa', canonicalName: 'Липопротеин(a)', shortName: 'Lp(a)', category: 'Липидограмма', units: ['мг/дл', 'нмоль/л'],
      aliases: ['липопротеин а', 'lpa', 'lp(a)', 'lipoprotein a'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 30, unit: 'мг/дл' }] },
    { id: 'biochem_apob', canonicalName: 'Аполипопротеин B', shortName: 'ApoB', category: 'Липидограмма', units: ['г/л', 'mg/dL'],
      aliases: ['аполипопротеин b', 'apob', 'apolipoprotein b', 'apo-b'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.6, max: 1.1, unit: 'г/л' }] },
    { id: 'biochem_apoa1', canonicalName: 'Аполипопротеин A1', shortName: 'ApoA1', category: 'Липидограмма', units: ['г/л'],
      aliases: ['аполипопротеин a1', 'apoa1', 'apolipoprotein a1', 'apo-a1'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 1.04, max: 2.02, unit: 'г/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 1.08, max: 2.25, unit: 'г/л' }
      ] },
    { id: 'biochem_alt', canonicalName: 'Аланинаминотрансфераза', shortName: 'АЛТ', category: 'Печёночные ферменты', units: ['Ед/л', 'U/L'],
      aliases: ['алт', 'аланинаминотрансфераза', 'аланин аминотрансфераза', 'alt', 'alat', 'sgpt'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 41, unit: 'Ед/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 33, unit: 'Ед/л' }
      ] },
    { id: 'biochem_ast', canonicalName: 'Аспартатаминотрансфераза', shortName: 'АСТ', category: 'Печёночные ферменты', units: ['Ед/л', 'U/L'],
      aliases: ['аст', 'аспартатаминотрансфераза', 'аспартат аминотрансфераза', 'ast', 'asat', 'sgot'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 40, unit: 'Ед/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 32, unit: 'Ед/л' }
      ] },
    { id: 'biochem_ggt', canonicalName: 'Гамма-глутамилтрансфераза', shortName: 'ГГТ', category: 'Печёночные ферменты', units: ['Ед/л', 'U/L'],
      aliases: ['ггт', 'гамма-гт', 'гамма гт', 'ggt', 'ggtp', 'gamma gt', 'gamma-glutamyl transferase'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 60, unit: 'Ед/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 40, unit: 'Ед/л' }
      ] },
    { id: 'biochem_alp', canonicalName: 'Щелочная фосфатаза', shortName: 'ЩФ', category: 'Печёночные ферменты', units: ['Ед/л', 'U/L'],
      aliases: ['щелочная фосфатаза', 'щф', 'alp', 'alkaline phosphatase', 'alk phos'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 40, max: 150, unit: 'Ед/л' }] },
    { id: 'biochem_5_nucleotidase', canonicalName: '5-нуклеотидаза', shortName: '5-NT', category: 'Печёночные ферменты', units: ['Ед/л'],
      aliases: ['5-нуклеотидаза', '5-nt', '5-nucleotidase'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 17, unit: 'Ед/л' }] },
    { id: 'biochem_ldh', canonicalName: 'Лактатдегидрогеназа', shortName: 'ЛДГ', category: 'Печёночные ферменты', units: ['Ед/л', 'U/L'],
      aliases: ['лдг', 'лактатдегидрогеназа', 'ldh', 'lactate dehydrogenase'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 135, max: 225, unit: 'Ед/л' }] },
    { id: 'biochem_ck', canonicalName: 'Креатинфосфокиназа', shortName: 'КФК', category: 'Мышечные ферменты', units: ['Ед/л', 'U/L'],
      aliases: ['кфк', 'креатинфосфокиназа', 'креатинкиназа', 'ck', 'cpk', 'creatine kinase'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 190, unit: 'Ед/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 167, unit: 'Ед/л' }
      ] },
    { id: 'biochem_ck_mb', canonicalName: 'КФК-МВ', shortName: 'CK-MB', category: 'Кардиомаркеры', units: ['Ед/л', 'нг/мл'],
      aliases: ['кфк-мв', 'кфк мв', 'ck-mb', 'creatine kinase mb'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 24, unit: 'Ед/л' }] },
    { id: 'biochem_total_bilirubin', canonicalName: 'Билирубин общий', shortName: 'TBIL', category: 'Билирубин', units: ['мкмоль/л', 'µmol/L', 'mg/dL'],
      aliases: ['билирубин общий', 'общий билирубин', 'tbil', 'total bilirubin', 'bilirubin total'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.4, max: 20.5, unit: 'мкмоль/л' }] },
    { id: 'biochem_direct_bilirubin', canonicalName: 'Билирубин прямой', shortName: 'DBIL', category: 'Билирубин', units: ['мкмоль/л', 'µmol/L'],
      aliases: ['билирубин прямой', 'прямой билирубин', 'билирубин конъюгированный', 'dbil', 'direct bilirubin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5.1, unit: 'мкмоль/л' }] },
    { id: 'biochem_indirect_bilirubin', canonicalName: 'Билирубин непрямой', shortName: 'IBIL', category: 'Билирубин', units: ['мкмоль/л'],
      aliases: ['билирубин непрямой', 'непрямой билирубин', 'билирубин неконъюгированный', 'ibil', 'indirect bilirubin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 16.5, unit: 'мкмоль/л' }] },
    { id: 'biochem_total_protein', canonicalName: 'Общий белок', shortName: 'TP', category: 'Биохимия', units: ['г/л', 'g/L'],
      aliases: ['общий белок', 'белок общий', 'total protein', 'protein total', 'tp'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 65, max: 85, unit: 'г/л' }] },
    { id: 'biochem_albumin', canonicalName: 'Альбумин', shortName: 'ALB', category: 'Биохимия', units: ['г/л', 'g/L'],
      aliases: ['альбумин', 'albumin', 'альбумин крови', 'сывороточный альбумин', 'serum albumin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 35, max: 52, unit: 'г/л' }] },
    { id: 'biochem_globulin', canonicalName: 'Глобулины', shortName: 'GLB', category: 'Биохимия', units: ['г/л'],
      aliases: ['глобулины', 'globulins', 'globulin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 20, max: 35, unit: 'г/л' }] },
    { id: 'biochem_prealbumin', canonicalName: 'Преальбумин', shortName: 'PAB', category: 'Биохимия', units: ['мг/л'],
      aliases: ['преальбумин', 'prealbumin', 'transthyretin', 'транстиретин'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 200, max: 400, unit: 'мг/л' }] },
    { id: 'biochem_creatinine', canonicalName: 'Креатинин', shortName: 'CREA', category: 'Почки', units: ['мкмоль/л', 'µmol/L', 'mg/dL'],
      aliases: ['креатинин', 'crea', 'creatinine', 'креатинин крови', 'сывороточный креатинин', 'serum creatinine'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 62, max: 106, unit: 'мкмоль/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 44, max: 80, unit: 'мкмоль/л' }
      ] },
    { id: 'biochem_urea', canonicalName: 'Мочевина', shortName: 'UREA', category: 'Почки', units: ['ммоль/л', 'mg/dL'],
      aliases: ['мочевина', 'urea', 'blood urea', 'азот мочевины', 'bun', 'blood urea nitrogen'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2.5, max: 8.3, unit: 'ммоль/л' }] },
    { id: 'biochem_cystatin_c', canonicalName: 'Цистатин C', shortName: 'Cys-C', category: 'Почки', units: ['мг/л'],
      aliases: ['цистатин c', 'cystatin c', 'cys-c', 'cys c'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.53, max: 0.95, unit: 'мг/л' }] },
    { id: 'biochem_uric_acid', canonicalName: 'Мочевая кислота', shortName: 'UA', category: 'Биохимия', units: ['мкмоль/л', 'mg/dL'],
      aliases: ['мочевая кислота', 'uric acid', 'мочевая кислота крови'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 202, max: 416, unit: 'мкмоль/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 143, max: 339, unit: 'мкмоль/л' }
      ] },
    { id: 'biochem_crp', canonicalName: 'С-реактивный белок', shortName: 'CRP', category: 'Маркеры воспаления', units: ['мг/л', 'mg/L'],
      aliases: ['с-реактивный белок', 'срб', 'crp', 'c-reactive protein', 'cрб'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'мг/л' }] },
    { id: 'biochem_hs_crp', canonicalName: 'Высокочувствительный СРБ', shortName: 'hs-CRP', category: 'Маркеры воспаления', units: ['мг/л'],
      aliases: ['высокочувствительный срб', 'hs-crp', 'hs crp', 'high sensitivity crp'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 3, unit: 'мг/л' }],
      interpretationBands: [
        { label: 'низкий риск ССЗ', max: 1.0, unit: 'мг/л' },
        { label: 'умеренный риск', min: 1.0, max: 3.0, unit: 'мг/л' },
        { label: 'высокий риск', min: 3.0, unit: 'мг/л' }
      ] },
    { id: 'biochem_procalcitonin', canonicalName: 'Прокальцитонин', shortName: 'PCT', category: 'Маркеры воспаления', units: ['нг/мл'],
      aliases: ['прокальцитонин', 'procalcitonin', 'pct'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0.05, unit: 'нг/мл' }] },
    { id: 'biochem_amylase', canonicalName: 'Амилаза', shortName: 'AMY', category: 'Панкреас', units: ['Ед/л', 'U/L'],
      aliases: ['амилаза', 'amylase', 'альфа-амилаза', 'alpha-amylase', 'диастаза'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 28, max: 100, unit: 'Ед/л' }] },
    { id: 'biochem_pancreatic_amylase', canonicalName: 'Панкреатическая амилаза', shortName: 'P-Amylase', category: 'Панкреас', units: ['Ед/л'],
      aliases: ['панкреатическая амилаза', 'p-amylase', 'pancreatic amylase'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 53, unit: 'Ед/л' }] },
    { id: 'biochem_lipase', canonicalName: 'Липаза', shortName: 'LPS', category: 'Панкреас', units: ['Ед/л', 'U/L'],
      aliases: ['липаза', 'lipase', 'панкреатическая липаза', 'pancreatic lipase'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 60, unit: 'Ед/л' }] },
    { id: 'biochem_homocysteine', canonicalName: 'Гомоцистеин', shortName: 'HCY', category: 'Биохимия', units: ['мкмоль/л'],
      aliases: ['гомоцистеин', 'homocysteine', 'hcy'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 3.7, max: 13.9, unit: 'мкмоль/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 2.7, max: 10.4, unit: 'мкмоль/л' }
      ] },
    { id: 'biochem_lactate', canonicalName: 'Лактат', shortName: 'LAC', category: 'Биохимия', units: ['ммоль/л'],
      aliases: ['лактат', 'молочная кислота', 'lactate', 'lactic acid'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.5, max: 2.2, unit: 'ммоль/л' }] },
    { id: 'biochem_ammonia', canonicalName: 'Аммиак', shortName: 'NH3', category: 'Биохимия', units: ['мкмоль/л'],
      aliases: ['аммиак', 'ammonia', 'nh3'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 11, max: 32, unit: 'мкмоль/л' }] },

    // ═══════════════════ ЭЛЕКТРОЛИТЫ (С ЗАРЯДАМИ) ═══════════════════
    { id: 'electrolytes_potassium', canonicalName: 'Калий', shortName: 'K', category: 'Электролиты', units: ['ммоль/л', 'mEq/L'],
      aliases: ['калий', 'k', 'k+', 'potassium', 'калий крови', 'serum potassium', 'калий (k+)', 'k+'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.5, max: 5.1, unit: 'ммоль/л' }] },
    { id: 'electrolytes_sodium', canonicalName: 'Натрий', shortName: 'Na', category: 'Электролиты', units: ['ммоль/л', 'mEq/L'],
      aliases: ['натрий', 'na', 'na+', 'sodium', 'натрий крови', 'serum sodium', 'натрий (na+)', 'na+'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 136, max: 145, unit: 'ммоль/л' }] },
    { id: 'electrolytes_chloride', canonicalName: 'Хлор', shortName: 'Cl', category: 'Электролиты', units: ['ммоль/л', 'mEq/L'],
      aliases: ['хлор', 'хлориды', 'cl', 'cl-', 'chloride', 'chlorides', 'хлор (cl-)', 'cl-', 'хлорид'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 98, max: 107, unit: 'ммоль/л' }] },
    { id: 'electrolytes_magnesium', canonicalName: 'Магний', shortName: 'Mg', category: 'Электролиты', units: ['ммоль/л', 'мг/дл', 'mg/dL'],
      aliases: ['магний', 'mg', 'magnesium', 'магний крови', 'mg2+', 'mg+2', 'serum magnesium'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.75, max: 1.25, unit: 'ммоль/л' }] },
    { id: 'electrolytes_calcium', canonicalName: 'Кальций общий', shortName: 'Ca', category: 'Электролиты', units: ['ммоль/л', 'мг/дл', 'mg/dL'],
      aliases: ['кальций', 'кальций общий', 'ca', 'calcium', 'calcium total', 'ca2+', 'ca+2', 'общий кальций'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2.15, max: 2.55, unit: 'ммоль/л' }] },
    { id: 'electrolytes_calcium_ionized', canonicalName: 'Кальций ионизированный', shortName: 'Ca++', category: 'Электролиты', units: ['ммоль/л'],
      aliases: ['кальций ионизированный', 'ионизированный кальций', 'ca++', 'ionized calcium', 'ca2+'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.12, max: 1.32, unit: 'ммоль/л' }] },
    { id: 'electrolytes_phosphorus', canonicalName: 'Фосфор', shortName: 'P', category: 'Электролиты', units: ['ммоль/л', 'мг/дл', 'mg/dL'],
      aliases: ['фосфор', 'p', 'phosphorus', 'фосфор крови', 'неорганический фосфор', 'inorganic phosphorus'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.81, max: 1.45, unit: 'ммоль/л' }] },
    { id: 'electrolytes_bicarbonate', canonicalName: 'Бикарбонат', shortName: 'HCO3-', category: 'Электролиты', units: ['ммоль/л'],
      aliases: ['бикарбонат', 'hco3', 'hco3-', 'bicarbonate', 'co2 total'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 22, max: 29, unit: 'ммоль/л' }] },
    { id: 'electrolytes_anion_gap', canonicalName: 'Анионный промежуток', shortName: 'AG', category: 'Электролиты', units: ['ммоль/л'],
      aliases: ['анионный промежуток', 'anion gap', 'ag'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 8, max: 16, unit: 'ммоль/л' }] },
    { id: 'electrolytes_osmolality', canonicalName: 'Осмоляльность', shortName: 'Osm', category: 'Электролиты', units: ['мОсм/кг'],
      aliases: ['осмоляльность', 'osmolality', 'osm'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 275, max: 295, unit: 'мОсм/кг' }] },

    // ═══════════════════ ЖЕЛЕЗО ═══════════════════
    { id: 'iron_ferritin', canonicalName: 'Ферритин', shortName: 'Ferritin', category: 'Обмен железа', units: ['нг/мл', 'µg/L', 'мкг/л'],
      aliases: ['ферритин', 'ferritin', 'сывороточный ферритин', 'serum ferritin'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 30, max: 400, unit: 'нг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 15, max: 150, unit: 'нг/мл' }
      ] },
    { id: 'iron_serum_iron', canonicalName: 'Железо сывороточное', shortName: 'Fe', category: 'Обмен железа', units: ['мкмоль/л', 'µmol/L'],
      aliases: ['железо', 'железо сывороточное', 'сывороточное железо', 'fe', 'serum iron', 'iron'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 11.6, max: 31.3, unit: 'мкмоль/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 9.0, max: 30.4, unit: 'мкмоль/л' }
      ] },
    { id: 'iron_tibc', canonicalName: 'ОЖСС', shortName: 'TIBC', category: 'Обмен железа', units: ['мкмоль/л'],
      aliases: ['ожсс', 'общая железосвязывающая способность', 'tibc', 'о ж с с'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 45, max: 76, unit: 'мкмоль/л' }] },
    { id: 'iron_transferrin', canonicalName: 'Трансферрин', shortName: 'TRF', category: 'Обмен железа', units: ['г/л'],
      aliases: ['трансферрин', 'transferrin', 'trf'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2.0, max: 3.6, unit: 'г/л' }] },
    { id: 'iron_transferrin_saturation', canonicalName: 'Насыщение трансферрина железом', shortName: 'TSAT', category: 'Обмен железа', units: ['%'],
      aliases: ['насыщение трансферрина', 'tsat', 'transferrin saturation'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 20, max: 50, unit: '%' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 15, max: 50, unit: '%' }
      ] },
    { id: 'iron_soluble_transferrin_receptor', canonicalName: 'Растворимый рецептор трансферрина', shortName: 'sTfR', category: 'Обмен железа', units: ['мг/л'],
      aliases: ['растворимый рецептор трансферрина', 'stfr', 'soluble transferrin receptor'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.9, max: 4.4, unit: 'мг/л' }] },

    // ═══════════════════ ЩИТОВИДНАЯ ЖЕЛЕЗА ═══════════════════
    { id: 'thyroid_tsh', canonicalName: 'Тиреотропный гормон', shortName: 'ТТГ', category: 'Щитовидная железа', units: ['мМЕ/л', 'mIU/L', 'мкМЕ/мл'],
      aliases: ['ттг', 'тиреотропный гормон', 'thyroid stimulating hormone', 'tsh', 'thyrotropin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.4, max: 4.0, unit: 'мМЕ/л' }] },
    { id: 'thyroid_ft4', canonicalName: 'Тироксин свободный', shortName: 'св. Т4', category: 'Щитовидная железа', units: ['пмоль/л', 'ng/dL'],
      aliases: ['свободный т4', 'т4 свободный', 'св т4', 'ft4', 'free t4', 'free thyroxine', 'тироксин свободный'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 10.3, max: 24.5, unit: 'пмоль/л' }] },
    { id: 'thyroid_total_t4', canonicalName: 'Тироксин общий', shortName: 'Т4', category: 'Щитовидная железа', units: ['нмоль/л', 'µg/dL'],
      aliases: ['т4 общий', 'общий т4', 'total t4', 'thyroxine total'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 54, max: 158, unit: 'нмоль/л' }] },
    { id: 'thyroid_ft3', canonicalName: 'Трийодтиронин свободный', shortName: 'св. Т3', category: 'Щитовидная железа', units: ['пмоль/л', 'pg/mL'],
      aliases: ['свободный т3', 'т3 свободный', 'св т3', 'ft3', 'free t3', 'free triiodothyronine'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.5, max: 6.5, unit: 'пмоль/л' }] },
    { id: 'thyroid_total_t3', canonicalName: 'Трийодтиронин общий', shortName: 'Т3', category: 'Щитовидная железа', units: ['нмоль/л', 'ng/dL'],
      aliases: ['т3 общий', 'общий т3', 'total t3', 'triiodothyronine total'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.08, max: 2.92, unit: 'нмоль/л' }] },
    { id: 'thyroid_thyroglobulin', canonicalName: 'Тиреоглобулин', shortName: 'TG', category: 'Щитовидная железа', units: ['нг/мл'],
      aliases: ['тиреоглобулин', 'thyroglobulin', 'tg thyroid'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.4, max: 78, unit: 'нг/мл' }] },
    { id: 'thyroid_tbg', canonicalName: 'Тироксинсвязывающий глобулин', shortName: 'TBG', category: 'Щитовидная железа', units: ['мкг/мл'],
      aliases: ['тироксинсвязывающий глобулин', 'tbg', 'thyroxine-binding globulin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 13, max: 39, unit: 'мкг/мл' }] },
    { id: 'thyroid_anti_tpo', canonicalName: 'Антитела к ТПО', shortName: 'anti-TPO', category: 'Щитовидная железа', units: ['МЕ/мл', 'Ед/мл'],
      aliases: ['антитела к тпо', 'anti-tpo', 'anti tpo', 'тпо ат', 'thyroid peroxidase antibodies'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 35, unit: 'МЕ/мл' }] },
    { id: 'thyroid_anti_tg', canonicalName: 'Антитела к тиреоглобулину', shortName: 'anti-TG', category: 'Щитовидная железа', units: ['МЕ/мл'],
      aliases: ['антитела к тиреоглобулину', 'anti-tg', 'anti tg', 'тг ат', 'thyroglobulin antibodies'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 40, unit: 'МЕ/мл' }] },
    { id: 'thyroid_trab', canonicalName: 'Антитела к рецепторам ТТГ', shortName: 'TRAb', category: 'Щитовидная железа', units: ['МЕ/л'],
      aliases: ['антитела к рецепторам ттг', 'trab', 'anti-tshr', 'ттг рецепторы ат'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 1.75, unit: 'МЕ/л' }] },
    { id: 'thyroid_calcitonin', canonicalName: 'Кальцитонин', shortName: 'CT', category: 'Щитовидная железа', units: ['пг/мл'],
      aliases: ['кальцитонин', 'calcitonin', 'ct calcitonin'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 18.2, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 11.5, unit: 'пг/мл' }
      ] },

    // ═══════════════════ ВИТАМИНЫ ═══════════════════
    { id: 'vitamin_d', canonicalName: '25-гидроксивитамин D', shortName: '25(OH)D', category: 'Витамины', units: ['нг/мл', 'нмоль/л'],
      aliases: ['витамин d', 'витамин д', '25-oh витамин d', '25 oh витамин d', '25(oh)d', '25-гидроксивитамин d', '25 hydroxy vitamin d', 'vitamin d'],
      interpretationBands: [
        { label: 'дефицит', max: 20, unit: 'нг/мл' },
        { label: 'недостаточность', min: 20, max: 29, unit: 'нг/мл' },
        { label: 'достаточный уровень', min: 30, max: 100, unit: 'нг/мл' },
        { label: 'возможная токсичность', min: 100, unit: 'нг/мл' }
      ],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 30, max: 100, unit: 'нг/мл' }] },
    { id: 'vitamin_b12', canonicalName: 'Витамин B12', shortName: 'B12', category: 'Витамины', units: ['пг/мл', 'пмоль/л'],
      aliases: ['витамин b12', 'витамин в12', 'b12', 'cyanocobalamin', 'цианокобаламин', 'кобаламин', 'cobalamin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 200, max: 900, unit: 'пг/мл' }] },
    { id: 'vitamin_folate', canonicalName: 'Фолиевая кислота', shortName: 'Folate', category: 'Витамины', units: ['нг/мл', 'нмоль/л'],
      aliases: ['фолиевая кислота', 'фолат', 'фолаты', 'folate', 'folic acid', 'витамин b9', 'витамин в9'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3, max: 17, unit: 'нг/мл' }] },
    { id: 'vitamin_a', canonicalName: 'Витамин A', shortName: 'Vit A', category: 'Витамины', units: ['мкмоль/л'],
      aliases: ['витамин a', 'витамин а', 'vitamin a', 'retinol', 'ретинол'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.05, max: 3.15, unit: 'мкмоль/л' }] },
    { id: 'vitamin_e', canonicalName: 'Витамин E', shortName: 'Vit E', category: 'Витамины', units: ['мкмоль/л'],
      aliases: ['витамин e', 'витамин е', 'vitamin e', 'tocopherol', 'токоферол', 'альфа-токоферол'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 12, max: 42, unit: 'мкмоль/л' }] },
    { id: 'vitamin_k', canonicalName: 'Витамин K', shortName: 'Vit K', category: 'Витамины', units: ['нг/л'],
      aliases: ['витамин k', 'витамин к', 'vitamin k', 'phylloquinone', 'филлохинон'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 150, max: 1500, unit: 'нг/л' }] },
    { id: 'vitamin_b1', canonicalName: 'Витамин B1', shortName: 'B1', category: 'Витамины', units: ['нмоль/л'],
      aliases: ['витамин b1', 'витамин в1', 'thiamine', 'тиамин'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 70, max: 180, unit: 'нмоль/л' }] },
    { id: 'vitamin_b2', canonicalName: 'Витамин B2', shortName: 'B2', category: 'Витамины', units: ['нмоль/л'],
      aliases: ['витамин b2', 'витамин в2', 'riboflavin', 'рибофлавин'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 130, max: 530, unit: 'нмоль/л' }] },
    { id: 'vitamin_b3', canonicalName: 'Витамин B3', shortName: 'B3', category: 'Витамины', units: ['мкмоль/л'],
      aliases: ['витамин b3', 'витамин в3', 'niacin', 'никотиновая кислота', 'vitamin pp'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.5, max: 3.5, unit: 'мкмоль/л' }] },
    { id: 'vitamin_b5', canonicalName: 'Витамин B5', shortName: 'B5', category: 'Витамины', units: ['мкмоль/л'],
      aliases: ['витамин b5', 'витамин в5', 'pantothenic acid', 'пантотеновая кислота'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.7, max: 3.9, unit: 'мкмоль/л' }] },
    { id: 'vitamin_b6', canonicalName: 'Витамин B6', shortName: 'B6', category: 'Витамины', units: ['нмоль/л'],
      aliases: ['витамин b6', 'витамин в6', 'pyridoxine', 'пиридоксин'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 20, max: 125, unit: 'нмоль/л' }] },
    { id: 'vitamin_b7', canonicalName: 'Витамин B7 (биотин)', shortName: 'B7', category: 'Витамины', units: ['пмоль/л'],
      aliases: ['витамин b7', 'биотин', 'biotin', 'vitamin h'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 230, max: 1200, unit: 'пмоль/л' }] },
    { id: 'vitamin_c', canonicalName: 'Витамин C', shortName: 'Vit C', category: 'Витамины', units: ['мкмоль/л'],
      aliases: ['витамин c', 'витамин с', 'vitamin c', 'ascorbic acid', 'аскорбиновая кислота'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 23, max: 85, unit: 'мкмоль/л' }] },

    // ═══════════════════ МИКРОЭЛЕМЕНТЫ ═══════════════════
    { id: 'trace_zinc', canonicalName: 'Цинк', shortName: 'Zn', category: 'Микроэлементы', units: ['мкмоль/л', 'мкг/мл'],
      aliases: ['цинк', 'zinc', 'zn'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 10, max: 18, unit: 'мкмоль/л' }] },
    { id: 'trace_copper', canonicalName: 'Медь', shortName: 'Cu', category: 'Микроэлементы', units: ['мкмоль/л'],
      aliases: ['медь', 'copper', 'cu'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 11, max: 22, unit: 'мкмоль/л' }] },
    { id: 'trace_selenium', canonicalName: 'Селен', shortName: 'Se', category: 'Микроэлементы', units: ['мкг/л'],
      aliases: ['селен', 'selenium', 'se'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 70, max: 150, unit: 'мкг/л' }] },
    { id: 'trace_iron', canonicalName: 'Железо (микроэлемент)', shortName: 'Fe-trace', category: 'Микроэлементы', units: ['мкмоль/л'],
      aliases: ['железо микроэлемент', 'iron trace'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 10.7, max: 32.2, unit: 'мкмоль/л' }] },
    { id: 'trace_manganese', canonicalName: 'Марганец', shortName: 'Mn', category: 'Микроэлементы', units: ['мкг/л'],
      aliases: ['марганец', 'manganese', 'mn'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 4, max: 15, unit: 'мкг/л' }] },
    { id: 'trace_chromium', canonicalName: 'Хром', shortName: 'Cr', category: 'Микроэлементы', units: ['мкг/л'],
      aliases: ['хром', 'chromium', 'cr'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.1, max: 0.5, unit: 'мкг/л' }] },
    { id: 'trace_iodine', canonicalName: 'Йод', shortName: 'I', category: 'Микроэлементы', units: ['мкг/л'],
      aliases: ['йод', 'iodine', 'i'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 30, max: 70, unit: 'мкг/л' }] },
    { id: 'trace_lead', canonicalName: 'Свинец (токсичный)', shortName: 'Pb', category: 'Токсичные элементы', units: ['мкг/л'],
      aliases: ['свинец', 'lead', 'pb'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 50, unit: 'мкг/л' }] },
    { id: 'trace_mercury', canonicalName: 'Ртуть (токсичная)', shortName: 'Hg', category: 'Токсичные элементы', units: ['мкг/л'],
      aliases: ['ртуть', 'mercury', 'hg'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 10, unit: 'мкг/л' }] },
    { id: 'trace_cadmium', canonicalName: 'Кадмий (токсичный)', shortName: 'Cd', category: 'Токсичные элементы', units: ['мкг/л'],
      aliases: ['кадмий', 'cadmium', 'cd'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'мкг/л' }] },
    { id: 'trace_arsenic', canonicalName: 'Мышьяк (токсичный)', shortName: 'As', category: 'Токсичные элементы', units: ['мкг/л'],
      aliases: ['мышьяк', 'arsenic', 'as'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 10, unit: 'мкг/л' }] },

    // ═══════════════════ КОАГУЛОГРАММА ═══════════════════
    { id: 'coag_pt', canonicalName: 'Протромбиновое время', shortName: 'PT', category: 'Коагулограмма', units: ['сек'],
      aliases: ['протромбиновое время', 'pv', 'pt', 'prothrombin time'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 11, max: 13.5, unit: 'сек' }] },
    { id: 'coag_inr', canonicalName: 'МНО', shortName: 'INR', category: 'Коагулограмма', units: [''],
      aliases: ['мно', 'inr', 'international normalized ratio', 'международное нормализованное отношение'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.8, max: 1.2, unit: '' }] },
    { id: 'coag_aptt', canonicalName: 'АЧТВ', shortName: 'APTT', category: 'Коагулограмма', units: ['сек'],
      aliases: ['ачтв', 'aptt', 'activated partial thromboplastin time', 'активированное частичное тромбопластиновое время'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 25, max: 36, unit: 'сек' }] },
    { id: 'coag_thrombin_time', canonicalName: 'Тромбиновое время', shortName: 'TT', category: 'Коагулограмма', units: ['сек'],
      aliases: ['тромбиновое время', 'tt', 'thrombin time'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 14, max: 21, unit: 'сек' }] },
    { id: 'coag_fibrinogen', canonicalName: 'Фибриноген', shortName: 'Fbg', category: 'Коагулограмма', units: ['г/л'],
      aliases: ['фибриноген', 'fibrinogen', 'fbg'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2.0, max: 4.0, unit: 'г/л' }] },
    { id: 'coag_antithrombin_iii', canonicalName: 'Антитромбин III', shortName: 'AT-III', category: 'Коагулограмма', units: ['%'],
      aliases: ['антитромбин iii', 'at-iii', 'antithrombin iii'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 80, max: 125, unit: '%' }] },
    { id: 'coag_protein_c', canonicalName: 'Протеин C', shortName: 'Prot C', category: 'Коагулограмма', units: ['%'],
      aliases: ['протеин c', 'protein c'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 70, max: 140, unit: '%' }] },
    { id: 'coag_protein_s', canonicalName: 'Протеин S', shortName: 'Prot S', category: 'Коагулограмма', units: ['%'],
      aliases: ['протеин s', 'protein s'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 70, max: 140, unit: '%' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 60, max: 130, unit: '%' }
      ] },
    { id: 'coag_d_dimer', canonicalName: 'D-димер', shortName: 'D-dimer', category: 'Коагулограмма', units: ['мкг/мл FEU', 'нг/мл FEU', 'мг/л FEU'],
      aliases: ['д-димер', 'd-димер', 'd dimer', 'd-dimer', 'ddimer', 'димер'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 50, min: 0, max: 0.5, unit: 'мкг/мл FEU' }] },
    { id: 'coag_factor_viii', canonicalName: 'Фактор VIII', shortName: 'FVIII', category: 'Коагулограмма', units: ['%'],
      aliases: ['фактор viii', 'fviii', 'factor viii', 'антигемофильный глобулин'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 50, max: 150, unit: '%' }] },
    { id: 'coag_lupus_anticoagulant', canonicalName: 'Волчаночный антикоагулянт', shortName: 'LA', category: 'Коагулограмма', units: [''],
      aliases: ['волчаночный антикоагулянт', 'la', 'lupus anticoagulant'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },

    // ═══════════════════ ГОРМОНЫ ═══════════════════
    { id: 'hormone_testosterone_total', canonicalName: 'Тестостерон общий', shortName: 'Testosterone', category: 'Гормоны', units: ['нмоль/л', 'нг/мл', 'пг/мл'],
      aliases: ['тестостерон', 'тестостерон общий', 'testosterone', 'total testosterone', 'testo'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 8.9, max: 42.0, unit: 'нмоль/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0.5, max: 2.4, unit: 'нмоль/л' },
        { sex: 'male', ageMin: 18, ageMax: 120, min: 2600, max: 10000, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 15, max: 70, unit: 'нг/дл' }
      ] },
    { id: 'hormone_testosterone_free', canonicalName: 'Тестостерон свободный', shortName: 'Free Test', category: 'Гормоны', units: ['пг/мл', 'пмоль/л'],
      aliases: ['тестостерон свободный', 'свободный тестостерон', 'free testosterone'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 4.5, max: 25, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0.1, max: 6.4, unit: 'пг/мл' }
      ] },
    { id: 'hormone_shbg', canonicalName: 'ГСПГ', shortName: 'SHBG', category: 'Гормоны', units: ['нмоль/л'],
      aliases: ['гспг', 'глобулин связывающий половые гормоны', 'shbg', 'sex hormone binding globulin'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 13, max: 71, unit: 'нмоль/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 18, max: 114, unit: 'нмоль/л' }
      ] },
    { id: 'hormone_prolactin', canonicalName: 'Пролактин', shortName: 'PRL', category: 'Гормоны', units: ['мЕд/л', 'мкМЕ/мл', 'нг/мл'],
      aliases: ['пролактин', 'prolactin', 'prl'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 86, max: 324, unit: 'мЕд/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 109, max: 557, unit: 'мЕд/л' }
      ] },
    { id: 'hormone_lh', canonicalName: 'Лютеинизирующий гормон', shortName: 'ЛГ', category: 'Гормоны', units: ['МЕ/л', 'мМЕ/мл'],
      aliases: ['лг', 'лютеинизирующий гормон', 'lh', 'luteinizing hormone'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 1.5, max: 9.3, unit: 'МЕ/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 1.7, max: 15.0, unit: 'МЕ/л' }
      ] },
    { id: 'hormone_fsh', canonicalName: 'Фолликулостимулирующий гормон', shortName: 'ФСГ', category: 'Гормоны', units: ['МЕ/л', 'мМЕ/мл'],
      aliases: ['фсг', 'фолликулостимулирующий гормон', 'fsh', 'follicle stimulating hormone'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 1.4, max: 15.4, unit: 'МЕ/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 1.4, max: 20.0, unit: 'МЕ/л' }
      ] },
    { id: 'hormone_estradiol', canonicalName: 'Эстрадиол', shortName: 'E2', category: 'Гормоны', units: ['пмоль/л', 'пг/мл'],
      aliases: ['эстрадиол', 'estradiol', 'e2'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 40, max: 160, unit: 'пмоль/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 70, max: 1200, unit: 'пмоль/л' },
        { sex: 'male', ageMin: 18, ageMax: 120, min: 10, max: 40, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 15, max: 350, unit: 'пг/мл' }
      ] },
    { id: 'hormone_estriol', canonicalName: 'Эстриол', shortName: 'E3', category: 'Гормоны', units: ['нмоль/л'],
      aliases: ['эстриол', 'estriol', 'e3'],
      references: [{ sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 50, unit: 'нмоль/л' }] },
    { id: 'hormone_dhea_s', canonicalName: 'ДГЭА-С', shortName: 'DHEA-S', category: 'Гормоны', units: ['мкмоль/л', 'мкг/дл'],
      aliases: ['дгэа-с', 'дегидроэпиандростерон сульфат', 'dhea-s', 'dheas'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 2.5, max: 14.5, unit: 'мкмоль/л' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 1.8, max: 11.0, unit: 'мкмоль/л' }
      ] },
    { id: 'hormone_androstenedione', canonicalName: 'Андростендион', shortName: 'A4', category: 'Гормоны', units: ['нг/мл', 'нмоль/л', 'пг/мл'],
      aliases: ['андростендион', 'androstenedione', 'a4'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0.5, max: 2.8, unit: 'нг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0.4, max: 3.4, unit: 'нг/мл' }
      ] },
    { id: 'hormone_dhea', canonicalName: 'Дегидроэпиандростерон', shortName: 'DHEA', category: 'Гормоны', units: ['пг/мл', 'нг/мл'],
      aliases: ['дегидроэпиандростерон', 'dhea', 'дгэа'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 1000, max: 8000, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 800, max: 6000, unit: 'пг/мл' }
      ] },
    { id: 'hormone_cortisol', canonicalName: 'Кортизол', shortName: 'Cortisol', category: 'Гормоны', units: ['нмоль/л', 'мкг/дл', 'пг/мл'],
      aliases: ['кортизол', 'cortisol', 'гидрокортизон'],
      references: [
        { sex: 'any', ageMin: 18, ageMax: 120, min: 140, max: 690, unit: 'нмоль/л' },
        { sex: 'any', ageMin: 18, ageMax: 120, min: 5, max: 25, unit: 'мкг/дл' }
      ] },
    { id: 'hormone_cortisone', canonicalName: 'Кортизон', shortName: 'Cortisone', category: 'Гормоны', units: ['пг/мл'],
      aliases: ['кортизон', 'cortisone'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 5000, max: 35000, unit: 'пг/мл' }] },
    { id: 'hormone_pregnenolone', canonicalName: 'Прегненолон', shortName: 'Pregnenolone', category: 'Гормоны', units: ['пг/мл'],
      aliases: ['прегненолон', 'pregnenolone'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 200, max: 1000, unit: 'пг/мл' }] },
    { id: 'hormone_progesterone', canonicalName: 'Прогестерон', shortName: 'Progesterone', category: 'Гормоны', units: ['нмоль/л', 'нг/мл', 'пг/мл'],
      aliases: ['прогестерон', 'progesterone'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0.1, max: 1.5, unit: 'нг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0.2, max: 25, unit: 'нг/мл' }
      ] },
    { id: 'hormone_17_oh_progesterone', canonicalName: '17-ОН прогестерон', shortName: '17-OHP', category: 'Гормоны', units: ['нмоль/л', 'нг/мл'],
      aliases: ['17-он прогестерон', '17-ohp', '17-oh progesterone', '17-hydroxyprogesterone'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0.5, max: 4.0, unit: 'нг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0.2, max: 3.0, unit: 'нг/мл' }
      ] },
    { id: 'hormone_acth', canonicalName: 'АКТГ', shortName: 'ACTH', category: 'Гормоны', units: ['пг/мл'],
      aliases: ['актг', 'acth', 'адренокортикотропный гормон', 'adrenocorticotropic hormone'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 10, max: 60, unit: 'пг/мл' }] },
    { id: 'hormone_sth', canonicalName: 'Соматотропный гормон', shortName: 'STH', category: 'Гормоны', units: ['нг/мл'],
      aliases: ['соматотропный гормон', 'sth', 'gh', 'гормон роста', 'growth hormone', 'соматотропин'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'нг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 10, unit: 'нг/мл' }
      ] },
    { id: 'hormone_igf1', canonicalName: 'ИФР-1', shortName: 'IGF-1', category: 'Гормоны', units: ['нг/мл'],
      aliases: ['ифр-1', 'igf-1', 'инсулиноподобный фактор роста 1', 'somatomedin c', 'соматомедин c'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 100, max: 300, unit: 'нг/мл' }] },
    { id: 'hormone_aldosterone', canonicalName: 'Альдостерон', shortName: 'Aldo', category: 'Гормоны', units: ['пг/мл', 'пмоль/л'],
      aliases: ['альдостерон', 'aldosterone', 'aldo'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 30, max: 355, unit: 'пг/мл' }] },
    { id: 'hormone_renin', canonicalName: 'Ренин', shortName: 'Renin', category: 'Гормоны', units: ['мкЕд/мл'],
      aliases: ['ренин', 'renin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.3, max: 41, unit: 'мкЕд/мл' }] },
    { id: 'hormone_adh', canonicalName: 'АДГ (вазопрессин)', shortName: 'ADH', category: 'Гормоны', units: ['пг/мл'],
      aliases: ['адг', 'adh', 'вазопрессин', 'vasopressin', 'антидиуретический гормон'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 4.7, unit: 'пг/мл' }] },
    { id: 'hormone_oxytocin', canonicalName: 'Окситоцин', shortName: 'Oxytocin', category: 'Гормоны', units: ['пг/мл'],
      aliases: ['окситоцин', 'oxytocin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 10, max: 100, unit: 'пг/мл' }] },
    { id: 'hormone_amh', canonicalName: 'Антимюллеров гормон', shortName: 'AMH', category: 'Гормоны', units: ['нг/мл'],
      aliases: ['антимюллеров гормон', 'amh', 'анти-мюллеров гормон', 'anti-mullerian hormone'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0.7, max: 17, unit: 'нг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0.5, max: 12, unit: 'нг/мл' }
      ] },
    { id: 'hormone_inhibin_b', canonicalName: 'Ингибин B', shortName: 'Inhibin B', category: 'Гормоны', units: ['пг/мл'],
      aliases: ['ингибин b', 'inhibin b'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 80, max: 400, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 20, max: 150, unit: 'пг/мл' }
      ] },
    { id: 'hormone_hcg', canonicalName: 'ХГЧ', shortName: 'hCG', category: 'Гормоны', units: ['мМЕ/мл'],
      aliases: ['хгч', 'hcg', 'хорионический гонадотропин', 'human chorionic gonadotropin'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'мМЕ/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'мМЕ/мл' }
      ] },

    // ═══════════════════ ОНКОМАРКЕРЫ ═══════════════════
    { id: 'tumor_psa_total', canonicalName: 'ПСА общий', shortName: 'PSA', category: 'Онкомаркеры', units: ['нг/мл'],
      aliases: ['пса общий', 'общий пса', 'psa total', 'total psa', 'tpsa', 'простатспецифический антиген'],
      references: [{ sex: 'male', ageMin: 40, ageMax: 120, min: 0, max: 4.0, unit: 'нг/мл' }] },
    { id: 'tumor_psa_free', canonicalName: 'ПСА свободный', shortName: 'fPSA', category: 'Онкомаркеры', units: ['нг/мл'],
      aliases: ['пса свободный', 'свободный пса', 'fpsa', 'free psa'],
      references: [{ sex: 'male', ageMin: 40, ageMax: 120, min: 0, max: 0.9, unit: 'нг/мл' }] },
    { id: 'tumor_cea', canonicalName: 'Раково-эмбриональный антиген', shortName: 'CEA', category: 'Онкомаркеры', units: ['нг/мл'],
      aliases: ['раково-эмбриональный антиген', 'cea', 'раковый эмбриональный антиген', 'carcinoembryonic antigen'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'нг/мл' }] },
    { id: 'tumor_ca_125', canonicalName: 'CA-125', shortName: 'CA-125', category: 'Онкомаркеры', units: ['Ед/мл'],
      aliases: ['ca-125', 'ca 125', 'ca125', 'углеводный антиген 125'],
      references: [{ sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 35, unit: 'Ед/мл' }] },
    { id: 'tumor_ca_15_3', canonicalName: 'CA 15-3', shortName: 'CA 15-3', category: 'Онкомаркеры', units: ['Ед/мл'],
      aliases: ['ca 15-3', 'ca-15-3', 'ca15-3', 'ca 15 3', 'углеводный антиген 15-3'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 30, unit: 'Ед/мл' }] },
    { id: 'tumor_ca_19_9', canonicalName: 'CA 19-9', shortName: 'CA 19-9', category: 'Онкомаркеры', units: ['Ед/мл'],
      aliases: ['ca 19-9', 'ca-19-9', 'ca19-9', 'ca 19 9', 'углеводный антиген 19-9'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 37, unit: 'Ед/мл' }] },
    { id: 'tumor_ca_72_4', canonicalName: 'CA 72-4', shortName: 'CA 72-4', category: 'Онкомаркеры', units: ['Ед/мл'],
      aliases: ['ca 72-4', 'ca-72-4', 'ca72-4', 'ca 72 4'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 6.9, unit: 'Ед/мл' }] },
    { id: 'tumor_cyfra_21_1', canonicalName: 'CYFRA 21-1', shortName: 'CYFRA', category: 'Онкомаркеры', units: ['нг/мл'],
      aliases: ['cyfra 21-1', 'cyfra', 'cyfra 21-1', 'цитокератиновый фрагмент 21-1'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 3.3, unit: 'нг/мл' }] },
    { id: 'tumor_nse', canonicalName: 'Нейроспецифическая енолаза', shortName: 'NSE', category: 'Онкомаркеры', units: ['нг/мл'],
      aliases: ['нсе', 'nse', 'нейроспецифическая енолаза', 'neuron-specific enolase'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 16.3, unit: 'нг/мл' }] },
    { id: 'tumor_afp', canonicalName: 'Альфа-фетопротеин', shortName: 'AFP', category: 'Онкомаркеры', units: ['нг/мл'],
      aliases: ['афп', 'afp', 'альфа-фетопротеин', 'alpha-fetoprotein'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 8.9, unit: 'нг/мл' }] },
    { id: 'tumor_he4', canonicalName: 'HE4', shortName: 'HE4', category: 'Онкомаркеры', units: ['пмоль/л'],
      aliases: ['he4', 'человеческий эпидидимальный белок 4', 'human epididymis protein 4'],
      references: [{ sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 70, unit: 'пмоль/л' }] },
    { id: 'tumor_scc', canonicalName: 'SCC антиген', shortName: 'SCC', category: 'Онкомаркеры', units: ['нг/мл'],
      aliases: ['scc', 'scc антиген', 'squamous cell carcinoma antigen'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 2.0, unit: 'нг/мл' }] },
    { id: 'tumor_chromogranin_a', canonicalName: 'Хромогранин A', shortName: 'CgA', category: 'Онкомаркеры', units: ['нг/мл'],
      aliases: ['хромогранин a', 'cga', 'chromogranin a'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 100, unit: 'нг/мл' }] },
    { id: 'tumor_beta_hcg', canonicalName: 'Бета-ХГЧ', shortName: 'β-hCG', category: 'Онкомаркеры', units: ['мМЕ/мл'],
      aliases: ['бета-хгч', 'beta-hcg', 'β-hcg', 'бета-субъединица хгч'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'мМЕ/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'мМЕ/мл' }
      ] },

    // ═══════════════════ КАРДИОМАРКЕРЫ ═══════════════════
    { id: 'cardiac_troponin_i', canonicalName: 'Тропонин I', shortName: 'TnI', category: 'Кардиомаркеры', units: ['нг/л', 'нг/мл'],
      aliases: ['тропонин i', 'тропонин', 'tni', 'troponin i'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 14, unit: 'нг/л' }] },
    { id: 'cardiac_troponin_t', canonicalName: 'Тропонин T', shortName: 'TnT', category: 'Кардиомаркеры', units: ['нг/л'],
      aliases: ['тропонин t', 'tnt', 'troponin t'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 14, unit: 'нг/л' }] },
    { id: 'cardiac_myoglobin', canonicalName: 'Миоглобин', shortName: 'Mb', category: 'Кардиомаркеры', units: ['нг/мл'],
      aliases: ['миоглобин', 'myoglobin', 'mb'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 72, unit: 'нг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 51, unit: 'нг/мл' }
      ] },
    { id: 'cardiac_bnp', canonicalName: 'Натрийуретический пептид B', shortName: 'BNP', category: 'Кардиомаркеры', units: ['пг/мл'],
      aliases: ['bnp', 'натрийуретический пептид b', 'brain natriuretic peptide'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 100, unit: 'пг/мл' }] },
    { id: 'cardiac_nt_probnp', canonicalName: 'NT-proBNP', shortName: 'NT-proBNP', category: 'Кардиомаркеры', units: ['пг/мл'],
      aliases: ['nt-probnp', 'nt probnp', 'n-terminal pro-bnp'],
      references: [
        { sex: 'any', ageMin: 18, ageMax: 50, min: 0, max: 125, unit: 'пг/мл' },
        { sex: 'any', ageMin: 51, ageMax: 75, min: 0, max: 450, unit: 'пг/мл' },
        { sex: 'any', ageMin: 76, ageMax: 120, min: 0, max: 900, unit: 'пг/мл' }
      ] },
    { id: 'cardiac_homocysteine', canonicalName: 'Гомоцистеин (кардио)', shortName: 'HCY-c', category: 'Кардиомаркеры', units: ['мкмоль/л'],
      aliases: ['гомоцистеин кардио', 'homocysteine cardio'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.7, max: 13.9, unit: 'мкмоль/л' }] },

    // ═══════════════════ ИММУНОЛОГИЯ ═══════════════════
    { id: 'immuno_iga', canonicalName: 'Иммуноглобулин A', shortName: 'IgA', category: 'Иммунология', units: ['г/л', 'g/L'],
      aliases: ['ига', 'иммуноглобулин a', 'iga', 'immunoglobulin a'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.7, max: 4.0, unit: 'г/л' }] },
    { id: 'immuno_igm', canonicalName: 'Иммуноглобулин M', shortName: 'IgM', category: 'Иммунология', units: ['г/л', 'g/L'],
      aliases: ['игм', 'иммуноглобулин m', 'igm', 'immunoglobulin m'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.4, max: 2.3, unit: 'г/л' }] },
    { id: 'immuno_igg', canonicalName: 'Иммуноглобулин G', shortName: 'IgG', category: 'Иммунология', units: ['г/л', 'g/L'],
      aliases: ['игг', 'иммуноглобулин g', 'igg', 'immunoglobulin g'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 7.0, max: 16.0, unit: 'г/л' }] },
    { id: 'immuno_ige_total', canonicalName: 'Иммуноглобулин E общий', shortName: 'IgE', category: 'Иммунология', units: ['МЕ/мл', 'kU/L'],
      aliases: ['иммуноглобулин e', 'ige общий', 'ige total', 'immunoglobulin e'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 100, unit: 'МЕ/мл' }] },
    { id: 'immuno_igd', canonicalName: 'Иммуноглобулин D', shortName: 'IgD', category: 'Иммунология', units: ['мг/л'],
      aliases: ['иммуноглобулин d', 'igd', 'immunoglobulin d'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 100, unit: 'мг/л' }] },
    { id: 'immuno_complement_c3', canonicalName: 'Комплемент C3', shortName: 'C3', category: 'Иммунология', units: ['г/л'],
      aliases: ['комплемент c3', 'c3', 'complement c3'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.9, max: 1.8, unit: 'г/л' }] },
    { id: 'immuno_complement_c4', canonicalName: 'Комплемент C4', shortName: 'C4', category: 'Иммунология', units: ['г/л'],
      aliases: ['комплемент c4', 'c4', 'complement c4'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.1, max: 0.4, unit: 'г/л' }] },
    { id: 'immuno_cic', canonicalName: 'ЦИК', shortName: 'CIC', category: 'Иммунология', units: ['у.е.'],
      aliases: ['цик', 'циркулирующие иммунные комплексы', 'cic', 'circulating immune complexes'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 40, unit: 'у.е.' }] },
    { id: 'immuno_ana', canonicalName: 'АНА (антинуклеарные антитела)', shortName: 'ANA', category: 'Аутоиммунные', units: ['титр'],
      aliases: ['ана', 'antinuclear antibodies', 'антинуклеарные антитела', 'ana screen'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 1, unit: 'титр' }] },
    { id: 'immuno_anti_dsdna', canonicalName: 'Анти-dsDNA', shortName: 'anti-dsDNA', category: 'Аутоиммунные', units: ['МЕ/мл'],
      aliases: ['анти-dsdna', 'anti-dsdna', 'антитела к двуспиральной днк'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 25, unit: 'МЕ/мл' }] },
    { id: 'immuno_rf', canonicalName: 'Ревматоидный фактор', shortName: 'RF', category: 'Ревмопробы', units: ['МЕ/мл'],
      aliases: ['рф', 'rf', 'ревматоидный фактор', 'rheumatoid factor'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 14, unit: 'МЕ/мл' }] },
    { id: 'immuno_anti_ccp', canonicalName: 'АЦЦП (анти-ЦЦП)', shortName: 'anti-CCP', category: 'Ревмопробы', units: ['Ед/мл'],
      aliases: ['аццп', 'анти-ццп', 'anti-ccp', 'анти-ccp', 'антитела к циклическому цитруллинированному пептиду'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 17, unit: 'Ед/мл' }] },
    { id: 'immuno_aslo', canonicalName: 'АСЛО', shortName: 'ASLO', category: 'Ревмопробы', units: ['Ед/мл'],
      aliases: ['асло', 'aslo', 'антистрептолизин-о', 'antistreptolysin-o'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 200, unit: 'Ед/мл' }] },
    { id: 'immuno_anti_ttg_iga', canonicalName: 'Антитела к тканевой трансглутаминазе IgA', shortName: 'tTG-IgA', category: 'Аутоиммунные', units: ['Ед/мл'],
      aliases: ['антитела к тканевой трансглутаминазе', 'ttg-iga', 'transglutaminase', 'целиакия'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 20, unit: 'Ед/мл' }] },
    { id: 'immuno_anti_tpo', canonicalName: 'Антитела к ТПО', shortName: 'anti-TPO', category: 'Аутоиммунные', units: ['МЕ/мл'],
      aliases: ['анти-тпо', 'anti-tpo', 'антитела к тиреопероксидазе'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 35, unit: 'МЕ/мл' }] },
    { id: 'immuno_anca', canonicalName: 'ANCA', shortName: 'ANCA', category: 'Аутоиммунные', units: ['титр'],
      aliases: ['anca', 'антинейтрофильные цитоплазматические антитела'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 1, unit: 'титр' }] },
    { id: 'immuno_anti_cardiolipin', canonicalName: 'Антикардиолипиновые антитела', shortName: 'aCL', category: 'Аутоиммунные', units: ['GPL'],
      aliases: ['антикардиолипиновые антитела', 'acl', 'anti-cardiolipin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 15, unit: 'GPL' }] },
    { id: 'immuno_anti_b2_glycoprotein', canonicalName: 'Анти-β2-гликопротеин I', shortName: 'anti-β2GPI', category: 'Аутоиммунные', units: ['Ед/мл'],
      aliases: ['анти-b2-гликопротеин i', 'anti-b2-glycoprotein i', 'анти-β2-gpi'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 20, unit: 'Ед/мл' }] },

    // ═══════════════════ ИНФЕКЦИИ ═══════════════════
    { id: 'inf_hiv', canonicalName: 'ВИЧ (АТ/АГ)', shortName: 'HIV', category: 'Инфекции', units: [''],
      aliases: ['вич', 'hiv', 'антитела к вич', 'hiv antibody', 'hiv 1/2'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'inf_hbv_hbsag', canonicalName: 'HBsAg (гепатит B)', shortName: 'HBsAg', category: 'Инфекции', units: [''],
      aliases: ['hbsag', 'австралийский антиген', 'гепатит b поверхностный антиген'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'inf_hcv', canonicalName: 'Anti-HCV (гепатит C)', shortName: 'Anti-HCV', category: 'Инфекции', units: [''],
      aliases: ['anti-hcv', 'hcv', 'антитела к гепатиту c', 'hepatitis c antibody'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'inf_syphilis', canonicalName: 'Сифилис (RPR)', shortName: 'RPR', category: 'Инфекции', units: [''],
      aliases: ['сифилис', 'rpr', 'vdrl', 'rw', 'реакция вассермана'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'inf_cmv_igg', canonicalName: 'CMV IgG (цитомегаловирус)', shortName: 'CMV IgG', category: 'TORCH', units: ['Ед/мл'],
      aliases: ['cmv igg', 'цитомегаловирус igg', 'cytomegalovirus igg'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: 'Ед/мл' }] },
    { id: 'inf_cmv_igm', canonicalName: 'CMV IgM', shortName: 'CMV IgM', category: 'TORCH', units: ['Ед/мл'],
      aliases: ['cmv igm', 'цитомегаловирус igm'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: 'Ед/мл' }] },
    { id: 'inf_toxo_igg', canonicalName: 'Toxoplasma IgG', shortName: 'Toxo IgG', category: 'TORCH', units: ['МЕ/мл'],
      aliases: ['toxoplasma igg', 'токсоплазма igg', 'anti-toxoplasma igg'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 10, unit: 'МЕ/мл' }] },
    { id: 'inf_toxo_igm', canonicalName: 'Toxoplasma IgM', shortName: 'Toxo IgM', category: 'TORCH', units: [''],
      aliases: ['toxoplasma igm', 'токсоплазма igm'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'inf_rubella_igg', canonicalName: 'Краснуха IgG', shortName: 'Rubella IgG', category: 'TORCH', units: ['МЕ/мл'],
      aliases: ['rubella igg', 'краснуха igg', 'anti-rubella igg'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 10, max: null, unit: 'МЕ/мл' }] },
    { id: 'inf_rubella_igm', canonicalName: 'Краснуха IgM', shortName: 'Rubella IgM', category: 'TORCH', units: [''],
      aliases: ['rubella igm', 'краснуха igm'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'inf_hsv_igg', canonicalName: 'HSV IgG (герпес)', shortName: 'HSV IgG', category: 'TORCH', units: [''],
      aliases: ['hsv igg', 'герпес igg', 'herpes simplex igg'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'inf_ebv_vca_igg', canonicalName: 'EBV VCA IgG (вирус Эпштейн-Барр)', shortName: 'EBV VCA IgG', category: 'Инфекции', units: ['Ед/мл'],
      aliases: ['ebv vca igg', 'эпштейн-барр igg', 'вирус эпштейна-барр'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 20, unit: 'Ед/мл' }] },
    { id: 'inf_ebv_ebna_igg', canonicalName: 'EBV EBNA IgG', shortName: 'EBNA IgG', category: 'Инфекции', units: ['Ед/мл'],
      aliases: ['ebna igg', 'ebv ebna igg'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'Ед/мл' }] },
    { id: 'inf_hpylori_igg', canonicalName: 'H. pylori IgG', shortName: 'H. pylori IgG', category: 'Инфекции', units: ['Ед/мл'],
      aliases: ['h. pylori igg', 'хеликобактер igg', 'helicobacter pylori igg'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 12.5, unit: 'Ед/мл' }] },

    // ═══════════════════ МОЧА ═══════════════════
    { id: 'urine_sg', canonicalName: 'Удельный вес мочи', shortName: 'SG', category: 'Общий анализ мочи', units: [''],
      aliases: ['удельный вес', 'относительная плотность мочи', 'specific gravity', 'sg', 'плотность мочи'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.010, max: 1.025, unit: '' }] },
    { id: 'urine_ph', canonicalName: 'pH мочи', shortName: 'pH', category: 'Общий анализ мочи', units: [''],
      aliases: ['ph мочи', 'реакция мочи', 'кислотность мочи', 'urine ph'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 5.0, max: 7.5, unit: '' }] },
    { id: 'urine_protein', canonicalName: 'Белок в моче', shortName: 'Protein', category: 'Общий анализ мочи', units: ['г/л'],
      aliases: ['белок в моче', 'протеинурия', 'urine protein'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0.033, unit: 'г/л' }] },
    { id: 'urine_glucose', canonicalName: 'Глюкоза в моче', shortName: 'U-Glu', category: 'Общий анализ мочи', units: ['ммоль/л'],
      aliases: ['глюкоза в моче', 'сахар в моче', 'urine glucose', 'глюкозурия'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: 'ммоль/л' }] },
    { id: 'urine_ketones', canonicalName: 'Кетоны в моче', shortName: 'Ketones', category: 'Общий анализ мочи', units: ['ммоль/л'],
      aliases: ['кетоны в моче', 'ацетон в моче', 'ketones', 'кетонурия'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: 'ммоль/л' }] },
    { id: 'urine_bilirubin', canonicalName: 'Билирубин в моче', shortName: 'U-Bil', category: 'Общий анализ мочи', units: [''],
      aliases: ['билирубин в моче', 'urine bilirubin', 'билирубинурия'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'urine_urobilinogen', canonicalName: 'Уробилиноген', shortName: 'Uro', category: 'Общий анализ мочи', units: ['мкмоль/л'],
      aliases: ['уробилиноген', 'urobilinogen'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 17, unit: 'мкмоль/л' }] },
    { id: 'urine_nitrites', canonicalName: 'Нитриты в моче', shortName: 'Nitrites', category: 'Общий анализ мочи', units: [''],
      aliases: ['нитриты в моче', 'nitrites'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'urine_leukocytes', canonicalName: 'Лейкоциты в моче', shortName: 'U-WBC', category: 'Общий анализ мочи', units: ['в п/зр'],
      aliases: ['лейкоциты в моче', 'urine leukocytes', 'urine wbc'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 3, unit: 'в п/зр' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'в п/зр' }
      ] },
    { id: 'urine_erythrocytes', canonicalName: 'Эритроциты в моче', shortName: 'U-RBC', category: 'Общий анализ мочи', units: ['в п/зр'],
      aliases: ['эритроциты в моче', 'urine erythrocytes', 'urine rbc', 'гематурия'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 2, unit: 'в п/зр' }] },
    { id: 'urine_epithelial', canonicalName: 'Эпителий в моче', shortName: 'Epithel', category: 'Общий анализ мочи', units: ['в п/зр'],
      aliases: ['эпителий в моче', 'плоский эпителий', 'urine epithelial cells'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 10, unit: 'в п/зр' }] },
    { id: 'urine_microalbumin', canonicalName: 'Микроальбумин', shortName: 'mALB', category: 'Общий анализ мочи', units: ['мг/л', 'мг/сут'],
      aliases: ['микроальбумин', 'microalbumin', 'альбумин в моче'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 20, unit: 'мг/л' }] },
    { id: 'urine_creatinine_daily', canonicalName: 'Креатинин в суточной моче', shortName: 'U-CREA', category: 'Общий анализ мочи', units: ['ммоль/сут'],
      aliases: ['креатинин в моче', 'суточный креатинин', 'urine creatinine'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 8.8, max: 17.7, unit: 'ммоль/сут' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 7.1, max: 14.2, unit: 'ммоль/сут' }
      ] },

    // ═══════════════════ КАЛ ═══════════════════
    { id: 'stool_calprotectin', canonicalName: 'Кальпротектин в кале', shortName: 'Calprotectin', category: 'Кал', units: ['мкг/г'],
      aliases: ['кальпротектин', 'фекальный кальпротектин', 'fecal calprotectin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 50, unit: 'мкг/г' }] },
    { id: 'stool_occult_blood', canonicalName: 'Скрытая кровь в кале', shortName: 'OB', category: 'Кал', units: ['нг/мл'],
      aliases: ['скрытая кровь', 'скрытая кровь в кале', 'fecal occult blood', 'occult blood'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 50, unit: 'нг/мл' }] },
    { id: 'stool_hpylori', canonicalName: 'H. pylori антиген в кале', shortName: 'HP', category: 'Кал', units: [''],
      aliases: ['h. pylori', 'хеликобактер', 'хеликобактер пилори', 'helicobacter pylori antigen'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0, unit: '' }] },
    { id: 'stool_pancreatic_elastase', canonicalName: 'Панкреатическая эластаза', shortName: 'PE-1', category: 'Кал', units: ['мкг/г'],
      aliases: ['панкреатическая эластаза', 'pancreatic elastase', 'elastase-1'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 200, max: null, unit: 'мкг/г' }] },

    // ═══════════════════ СТЕРИОДНЫЙ ПРОФИЛЬ В СЛЮНЕ ═══════════════════
    { id: 'saliva_cortisol', canonicalName: 'Кортизол в слюне', shortName: 'sCortisol', category: 'Стероиды (слюна)', units: ['пг/мл'],
      aliases: ['кортизол в слюне', 'salivary cortisol', 's cortisol'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 300, max: 3200, unit: 'пг/мл' }] },
    { id: 'saliva_dhea', canonicalName: 'ДГЭА в слюне', shortName: 'sDHEA', category: 'Стероиды (слюна)', units: ['пг/мл'],
      aliases: ['дгэа в слюне', 'salivary dhea', 's dhea'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 200, max: 4000, unit: 'пг/мл' }] },
    { id: 'saliva_testosterone', canonicalName: 'Тестостерон в слюне', shortName: 'sTesto', category: 'Стероиды (слюна)', units: ['пг/мл'],
      aliases: ['тестостерон в слюне', 'salivary testosterone'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 40, max: 160, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 5, max: 35, unit: 'пг/мл' }
      ] },
    { id: 'saliva_estradiol', canonicalName: 'Эстрадиол в слюне', shortName: 'sE2', category: 'Стероиды (слюна)', units: ['пг/мл'],
      aliases: ['эстрадиол в слюне', 'salivary estradiol'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 0.5, max: 3.0, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 0.5, max: 15, unit: 'пг/мл' }
      ] },
    { id: 'saliva_progesterone', canonicalName: 'Прогестерон в слюне', shortName: 'sProg', category: 'Стероиды (слюна)', units: ['пг/мл'],
      aliases: ['прогестерон в слюне', 'salivary progesterone'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 10, max: 50, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 20, max: 400, unit: 'пг/мл' }
      ] },
    { id: 'saliva_dht', canonicalName: 'Дигидротестостерон в слюне', shortName: 'sDHT', category: 'Стероиды (слюна)', units: ['пг/мл'],
      aliases: ['дигидротестостерон в слюне', 'salivary dht', 'dht saliva'],
      references: [
        { sex: 'male', ageMin: 18, ageMax: 120, min: 5, max: 30, unit: 'пг/мл' },
        { sex: 'female', ageMin: 18, ageMax: 120, min: 1, max: 10, unit: 'пг/мл' }
      ] },
    { id: 'saliva_melatonin', canonicalName: 'Мелатонин в слюне', shortName: 'sMelatonin', category: 'Стероиды (слюна)', units: ['пг/мл'],
      aliases: ['мелатонин в слюне', 'salivary melatonin'],
      references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1, max: 15, unit: 'пг/мл' }] }
  ];

  // ═══════════════════════════════════════════════════════════
  //  ДИАГНОСТИЧЕСКИЕ ПРАВИЛА (расширенные)
  // ═══════════════════════════════════════════════════════════
  const diagnosticRules = [
    { id: 1, name: 'Железодефицитная анемия', danger: 'medium', doctors: ['Терапевт', 'Гематолог'], results: { 'Ферритин': 'low', 'Железо сывороточное': 'low' } },
    { id: 2, name: 'Анемия', danger: 'medium', doctors: ['Терапевт', 'Гематолог'], results: { 'Гемоглобин': 'low' } },
    { id: 3, name: 'Гипотиреоз', danger: 'medium', doctors: ['Эндокринолог'], results: { 'Тиреотропный гормон': 'high', 'Тироксин свободный': 'low' } },
    { id: 4, name: 'Гипертиреоз', danger: 'high', doctors: ['Эндокринолог'], results: { 'Тиреотропный гормон': 'low', 'Тироксин свободный': 'high' } },
    { id: 5, name: 'Сахарный диабет', danger: 'high', doctors: ['Эндокринолог'], results: { 'Глюкоза натощак': 'high', 'Гликированный гемоглобин': 'high' } },
    { id: 6, name: 'Дефицит витамина D', danger: 'low', doctors: ['Терапевт'], results: { '25-гидроксивитамин D': 'low' } },
    { id: 7, name: 'Воспаление', danger: 'medium', doctors: ['Терапевт'], results: { 'Лейкоциты': 'high', 'С-реактивный белок': 'high' } },
    { id: 8, name: 'Тромбоцитопения', danger: 'high', doctors: ['Гематолог'], results: { 'Тромбоциты': 'low' } },
    { id: 9, name: 'Гипогонадизм', danger: 'medium', doctors: ['Уролог', 'Эндокринолог'], results: { 'Тестостерон общий': 'low' } },
    { id: 10, name: 'Гиперпролактинемия', danger: 'medium', doctors: ['Эндокринолог'], results: { 'Пролактин': 'high' } },
    { id: 11, name: 'Инсулинорезистентность', danger: 'high', doctors: ['Эндокринолог'], results: { 'Инсулин натощак': 'high', 'Глюкоза натощак': 'high' } },
    { id: 12, name: 'Подагра', danger: 'medium', doctors: ['Ревматолог', 'Терапевт'], results: { 'Мочевая кислота': 'high' } },
    { id: 13, name: 'Поражение печени', danger: 'high', doctors: ['Гастроэнтеролог', 'Гепатолог'], results: { 'Аланинаминотрансфераза': 'high', 'Аспартатаминотрансфераза': 'high' } },
    { id: 14, name: 'Хроническая болезнь почек', danger: 'high', doctors: ['Нефролог'], results: { 'Креатинин': 'high', 'Мочевина': 'high' } },
    { id: 15, name: 'Дефицит B12', danger: 'low', doctors: ['Терапевт', 'Невролог'], results: { 'Витамин B12': 'low' } },
    { id: 16, name: 'Гиперкортицизм', danger: 'high', doctors: ['Эндокринолог'], results: { 'Кортизол': 'high' } },
    { id: 17, name: 'Надпочечниковая недостаточность', danger: 'high', doctors: ['Эндокринолог'], results: { 'Кортизол': 'low' } },
    { id: 18, name: 'Гиперкалиемия', danger: 'high', doctors: ['Терапевт', 'Кардиолог'], results: { 'Калий': 'high' } },
    { id: 19, name: 'Гипокалиемия', danger: 'medium', doctors: ['Терапевт'], results: { 'Калий': 'low' } },
    { id: 20, name: 'Гипернатриемия', danger: 'high', doctors: ['Терапевт', 'Нефролог'], results: { 'Натрий': 'high' } },
    { id: 21, name: 'Гипонатриемия', danger: 'high', doctors: ['Терапевт', 'Нефролог'], results: { 'Натрий': 'low' } },
    { id: 22, name: 'Гиперхлоремия', danger: 'medium', doctors: ['Терапевт'], results: { 'Хлор': 'high' } },
    { id: 23, name: 'Гипохлоремия', danger: 'medium', doctors: ['Терапевт'], results: { 'Хлор': 'low' } },
    { id: 24, name: 'Дислипидемия', danger: 'high', doctors: ['Кардиолог'], results: { 'Холестерин общий': 'high', 'Холестерин ЛПНП': 'high' } },
    { id: 25, name: 'Ревматоидный артрит', danger: 'high', doctors: ['Ревматолог'], results: { 'Ревматоидный фактор': 'high' } },
    { id: 26, name: 'Острый панкреатит', danger: 'high', doctors: ['Гастроэнтеролог'], results: { 'Липаза': 'high', 'Амилаза': 'high' } },
    { id: 27, name: 'Инфаркт миокарда (подозрение)', danger: 'high', doctors: ['Кардиолог'], results: { 'Тропонин I': 'high' } },
    { id: 28, name: 'Дефицит магния', danger: 'medium', doctors: ['Терапевт'], results: { 'Магний': 'low' } },
    { id: 29, name: 'Гипокальциемия', danger: 'medium', doctors: ['Эндокринолог'], results: { 'Кальций общий': 'low' } },
    { id: 30, name: 'Гиперкальциемия', danger: 'high', doctors: ['Эндокринолог'], results: { 'Кальций общий': 'high' } }
  ];

  // ═══════════════════════════════════════════════════════════
  //  КАРТА РЕКОМЕНДАЦИЙ (расширенная)
  // ═══════════════════════════════════════════════════════════
  const supplementMap = {
    '25-гидроксивитамин D': { low: { supplement: 'Витамин D3 2000–4000 МЕ/сут', doctors: ['Терапевт'], duration: '2–3 месяца', danger: 'low', description: 'Витамин D помогает усваивать кальций.', dangerDesc: 'Низкий уровень повышает риск остеопороза.' } },
    'Гемоглобин': { low: { supplement: 'Препараты железа + витамин C', doctors: ['Терапевт'], duration: '1–3 месяца', danger: 'medium', description: 'Белок, переносящий кислород.', dangerDesc: 'Анемия, риск гипоксии органов.' } },
    'Ферритин': { low: { supplement: 'Препараты железа', doctors: ['Терапевт', 'Гематолог'], duration: '1–2 месяца', danger: 'medium', description: 'Запасы железа в организме.', dangerDesc: 'Ведёт к железодефицитной анемии.' } },
    'Тиреотропный гормон': { high: { supplement: 'Левотироксин по назначению врача', doctors: ['Эндокринолог'], duration: 'длительно', danger: 'medium', description: 'Гипотиреоз.', dangerDesc: 'Замедляет обмен веществ.' }, low: { supplement: 'Обследование щитовидной железы', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'high', description: 'Гипертиреоз.', dangerDesc: 'Опасен для сердца.' } },
    'Тестостерон общий': { low: { supplement: 'Гормональная терапия под контролем врача', doctors: ['Уролог', 'Эндокринолог'], duration: 'длительно', danger: 'medium', description: 'Основной мужской гормон.', dangerDesc: 'Снижение либидо, усталость.' } },
    'Кортизол': { high: { supplement: 'Обследование надпочечников', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'high', description: 'Гормон стресса.', dangerDesc: 'Синдром Кушинга.' }, low: { supplement: 'Обследование надпочечников', doctors: ['Эндокринолог'], duration: 'срочно', danger: 'high', description: 'Болезнь Аддисона.', dangerDesc: 'Опасно для жизни.' } },
    'Глюкоза натощак': { high: { supplement: 'Контроль углеводов, консультация эндокринолога', doctors: ['Эндокринолог'], duration: 'постоянно', danger: 'high', description: 'Риск диабета.', dangerDesc: 'Повреждает сосуды.' } },
    'Холестерин общий': { high: { supplement: 'Диета, статины', doctors: ['Кардиолог'], duration: 'длительно', danger: 'high', description: 'Атеросклероз.', dangerDesc: 'Риск инфаркта.' } },
    'Холестерин ЛПНП': { high: { supplement: 'Диета, статины', doctors: ['Кардиолог'], duration: 'длительно', danger: 'high', description: 'Плохой холестерин.', dangerDesc: 'Главный фактор риска ССЗ.' } },
    'Холестерин ЛПВП': { low: { supplement: 'Физическая нагрузка, омега-3', doctors: ['Кардиолог'], duration: '3-6 месяцев', danger: 'medium', description: 'Хороший холестерин.', dangerDesc: 'Повышенный риск атеросклероза.' } },
    'Триглицериды': { high: { supplement: 'Диета, омега-3', doctors: ['Кардиолог'], duration: '3 месяца', danger: 'high', description: 'Жиры крови.', dangerDesc: 'Риск панкреатита и ССЗ.' } },
    'Креатинин': { high: { supplement: 'Контроль почек', doctors: ['Нефролог'], duration: 'постоянно', danger: 'high', description: 'Маркер работы почек.', dangerDesc: 'Почечная недостаточность.' } },
    'Аланинаминотрансфераза': { high: { supplement: 'Гепатопротекторы', doctors: ['Гастроэнтеролог'], duration: 'до нормализации', danger: 'high', description: 'Повреждение печени.', dangerDesc: 'Гепатит.' } },
    'Аспартатаминотрансфераза': { high: { supplement: 'Обследование печени и сердца', doctors: ['Гастроэнтеролог', 'Кардиолог'], duration: 'до нормализации', danger: 'high', description: 'Маркер повреждения.', dangerDesc: 'Гепатит, инфаркт.' } },
    'С-реактивный белок': { high: { supplement: 'Лечение воспаления', doctors: ['Терапевт'], duration: 'до нормализации', danger: 'medium', description: 'Маркер воспаления.', dangerDesc: 'Инфекция, аутоиммунные процессы.' } },
    'Лейкоциты': { high: { supplement: 'Противовоспалительная терапия', doctors: ['Терапевт'], duration: 'до нормализации', danger: 'medium', description: 'Защита от инфекций.', dangerDesc: 'Бактериальная инфекция.' }, low: { supplement: 'Иммуностимуляторы', doctors: ['Гематолог'], duration: 'до выяснения', danger: 'high', description: 'Лейкопения.', dangerDesc: 'Риск инфекций.' } },
    'Тромбоциты': { low: { supplement: 'Консультация гематолога', doctors: ['Гематолог'], duration: 'срочно', danger: 'high', description: 'Свёртываемость крови.', dangerDesc: 'Риск кровотечений.' } },
    'D-димер': { high: { supplement: 'Срочное обследование на тромбоз', doctors: ['Терапевт', 'Кардиолог'], duration: 'немедленно', danger: 'high', description: 'Маркер тромбоза.', dangerDesc: 'Подозрение на тромбоз.' } },
    'ПСА общий': { high: { supplement: 'Консультация уролога, биопсия', doctors: ['Уролог'], duration: 'повтор через 1-3 мес', danger: 'high', description: 'Онкомаркер простаты.', dangerDesc: 'Возможен рак простаты.' } },
    'Витамин B12': { low: { supplement: 'Витамин B12 1000-2000 мкг/сут', doctors: ['Терапевт', 'Невролог'], duration: '1-2 месяца', danger: 'low', description: 'Для нервной системы.', dangerDesc: 'Анемия, неврологические нарушения.' } },
    'Фолиевая кислота': { low: { supplement: 'Фолиевая кислота 400-800 мкг/сут', doctors: ['Терапевт'], duration: '1-2 месяца', danger: 'low', description: 'Для кроветворения.', dangerDesc: 'Анемия, проблемы с плодом.' } },
    'Мочевая кислота': { high: { supplement: 'Диета с низким содержанием пуринов', doctors: ['Ревматолог'], duration: 'длительно', danger: 'medium', description: 'Продукт распада пуринов.', dangerDesc: 'Подагра, камни в почках.' } },
    'Тропонин I': { high: { supplement: 'Срочная госпитализация', doctors: ['Кардиолог'], duration: 'немедленно', danger: 'high', description: 'Маркер инфаркта.', dangerDesc: 'Инфаркт миокарда.' } },
    'Пролактин': { high: { supplement: 'МРТ гипофиза', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'medium', description: 'Гормон лактации.', dangerDesc: 'Возможна пролактинома.' } },
    'Калий': { high: { supplement: 'Ограничение калийсодержащих продуктов', doctors: ['Терапевт', 'Кардиолог'], duration: 'срочно', danger: 'high', description: 'Важно для сердца.', dangerDesc: 'Остановка сердца.' }, low: { supplement: 'Препараты калия', doctors: ['Терапевт'], duration: 'до нормализации', danger: 'medium', description: 'Недостаток калия.', dangerDesc: 'Аритмия, мышечные судороги.' } },
    'Натрий': { high: { supplement: 'Ограничение соли, контроль водного баланса', doctors: ['Терапевт'], duration: 'до нормализации', danger: 'medium', description: 'Электролит водного баланса.', dangerDesc: 'Отёки, повышение давления.' }, low: { supplement: 'Контроль водного баланса', doctors: ['Терапевт', 'Нефролог'], duration: 'срочно', danger: 'high', description: 'Гипонатриемия.', dangerDesc: 'Опасна для мозга, судороги.' } },
    'Хлор': { high: { supplement: 'Контроль водного баланса', doctors: ['Терапевт'], duration: 'до нормализации', danger: 'medium', description: 'Электролит.', dangerDesc: 'Нарушение кислотно-щелочного баланса.' }, low: { supplement: 'Восстановление электролитов', doctors: ['Терапевт'], duration: 'до нормализации', danger: 'medium', description: 'Электролит.', dangerDesc: 'Алкалоз, рвота.' } },
    'Магний': { low: { supplement: 'Магний цитрат 300-400 мг/сут', doctors: ['Терапевт'], duration: '1-2 месяца', danger: 'low', description: 'Для мышц и нервов.', dangerDesc: 'Судороги, аритмия.' } },
    'Кальций общий': { low: { supplement: 'Кальций 500-1000 мг/сут + витамин D', doctors: ['Терапевт'], duration: '1-3 месяца', danger: 'low', description: 'Основа костей.', dangerDesc: 'Остеопороз, судороги.' }, high: { supplement: 'Обследование паращитовидных желёз', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'medium', description: 'Гиперкальциемия.', dangerDesc: 'Камни в почках, проблемы с сердцем.' } },
    'Фосфор': { low: { supplement: 'Обследование паращитовидных желёз', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'medium', description: 'Минерал костей.', dangerDesc: 'Мышечная слабость, рахит.' }, high: { supplement: 'Контроль почек', doctors: ['Нефролог'], duration: 'до нормализации', danger: 'medium', description: 'Маркер функции почек.', dangerDesc: 'Почечная недостаточность.' } },
    'Гомоцистеин': { high: { supplement: 'Витамины B6, B12, фолиевая кислота', doctors: ['Кардиолог'], duration: '3-6 месяцев', danger: 'medium', description: 'Маркер сердечно-сосудистого риска.', dangerDesc: 'Атеросклероз, тромбозы.' } },
    'Липопротеин(a)': { high: { supplement: 'Статины, консультация кардиолога', doctors: ['Кардиолог'], duration: 'длительно', danger: 'high', description: 'Генетический маркер ССЗ.', dangerDesc: 'Высокий риск инфаркта.' } },
    'Гликированный гемоглобин': { high: { supplement: 'Контроль диабета', doctors: ['Эндокринолог'], duration: 'постоянно', danger: 'high', description: 'Средний сахар за 3 месяца.', dangerDesc: 'Осложнения диабета.' } }
  };

  const preventiveRecommendations = [
    { supplement: 'Витамин D3 1000–2000 МЕ/сут', doctors: ['Терапевт'], duration: '1–2 месяца', note: 'Профилактика дефицита.' },
    { supplement: 'Магний 200–300 мг/сут', doctors: ['Терапевт'], duration: '1 месяц', note: 'От стресса и утомляемости.' },
    { supplement: 'Омега-3 1000–2000 мг/сут', doctors: ['Терапевт'], duration: '3 месяца', note: 'Для сердца и сосудов.' },
    { supplement: 'Витамин K2 100 мкг/сут', doctors: ['Терапевт'], duration: '2 месяца', note: 'Для костей и сосудов.' },
    { supplement: 'Цинк 15-30 мг/сут', doctors: ['Терапевт'], duration: '1 месяц', note: 'Для иммунитета.' }
  ];

  // ═══════════════════════════════════════════════════════════
  //  ПОИСК ТЕСТА (с поддержкой зарядов K+, Na+, Cl-)
  // ═══════════════════════════════════════════════════════════
  function findTestByAlias(line) {
    if (!line) return null;
    const originalLine = String(line).trim();
    const normLine = normalizeString(originalLine);
    if (!normLine) return null;

    // ═══════════ ПРИОРИТЕТ 0: Химические обозначения с зарядами ═══════════
    const chargePatterns = [
      { regex: /к(алий)?\s*\(?k\+?\)?/i, test: 'electrolytes_potassium' },
      { regex: /натрий\s*\(?na\+?\)?/i, test: 'electrolytes_sodium' },
      { regex: /хлор(иды?)?\s*\(?cl\-?\)?/i, test: 'electrolytes_chloride' },
      { regex: /кальций\s*\(?ca2\+?\)?/i, test: 'electrolytes_calcium' },
      { regex: /магний\s*\(?mg2\+?\)?/i, test: 'electrolytes_magnesium' },
      { regex: /k\+/i, test: 'electrolytes_potassium' },
      { regex: /na\+/i, test: 'electrolytes_sodium' },
      { regex: /cl\-/i, test: 'electrolytes_chloride' },
      { regex: /ca2\+/i, test: 'electrolytes_calcium' },
      { regex: /mg2\+/i, test: 'electrolytes_magnesium' }
    ];

    for (const pattern of chargePatterns) {
      if (pattern.regex.test(originalLine)) {
        const test = labTests.find(t => t.id === pattern.test);
        if (test) return test;
      }
    }

    let bestMatch = null;
    let bestScore = -1;

    for (const test of labTests) {
      for (const alias of test.aliases) {
        const normAlias = normalizeString(alias);
        if (!normAlias) continue;

        // Приоритет 1: точное вхождение целым словом (+10000)
        if (containsWholeWord(normLine, normAlias)) {
          const score = normAlias.length + 10000;
          if (score > bestScore) { bestMatch = test; bestScore = score; }
          continue;
        }

        // Приоритет 2: все слова алиаса присутствуют (+5000)
        const aliasWords = normAlias.split(' ').filter(w => w.length > 1);
        if (aliasWords.length > 1 && aliasWords.every(w => normLine.includes(w))) {
          const score = normAlias.length + 5000;
          if (score > bestScore) { bestMatch = test; bestScore = score; }
          continue;
        }

        // Приоритет 3: Fuzzy Matching
        if (normAlias.length >= 4) {
          for (let i = 0; i <= normLine.length - normAlias.length; i++) {
            const substring = normLine.substring(i, i + normAlias.length);
            const distance = levenshteinDistance(normAlias, substring);
            const maxDist = normAlias.length >= 8 ? 2 : 1;
            if (distance <= maxDist) {
              const score = normAlias.length;
              if (score > bestScore) { bestMatch = test; bestScore = score; }
              break;
            }
          }
        }
      }
    }
    return bestMatch;
  }

  function getReference(test, sex, age) {
    const refs = test.references;
    if (!refs || refs.length === 0) return null;
    let ref = refs.find(r => r.sex === sex && age >= r.ageMin && age <= r.ageMax);
    if (!ref) ref = refs.find(r => r.sex === 'any' && age >= r.ageMin && age <= r.ageMax);
    if (!ref) ref = refs.find(r => r.sex === sex);
    if (!ref) ref = refs.find(r => r.sex === 'any');
    if (!ref) ref = refs[0];
    return ref;
  }

  // ═══════════════════════════════════════════════════════════
  //  ИЗВЛЕЧЕНИЕ РЕЗУЛЬТАТА
  // ═══════════════════════════════════════════════════════════
  function extractNumericResult(line, test, patientSex, patientAge) {
    if (!line || !test) return null;
    const normLine = normalizeString(line);

    let searchFromIndex = 0;
    for (const alias of test.aliases) {
      const normAlias = normalizeString(alias);
      const idx = normLine.indexOf(normAlias);
      if (idx !== -1) { searchFromIndex = idx + normAlias.length; break; }
    }
    const afterAlias = normLine.substring(searchFromIndex);

    let detectedUnit = test.units[0] || '';
    for (const unit of test.units) {
      const cleanUnit = normalizeString(unit);
      if (cleanUnit && normLine.includes(cleanUnit)) { detectedUnit = unit; break; }
    }

    const numberPattern = /(\d+(?:\.\d+)?)\s*(?!\^)/g;
    const numbers = [];
    let m;
    while ((m = numberPattern.exec(afterAlias)) !== null) {
      const val = parseFloat(m[1]);
      if (!isNaN(val) && val >= 0 && val < 10000000) numbers.push({ value: val, index: m.index });
    }
    if (numbers.length === 0) return null;

    let refMin = null, refMax = null, value = null;

    // Формат 1: "X - Y" или "X | Y"
    const rangeMatch = afterAlias.match(/(\d+(?:\.\d+)?)\s*[-–—|]\s*(\d+(?:\.\d+)?)/);
    if (rangeMatch) {
      refMin = parseFloat(rangeMatch[1]);
      refMax = parseFloat(rangeMatch[2]);
      for (const n of numbers) {
        if (Math.abs(n.value - refMin) > 0.001 && Math.abs(n.value - refMax) > 0.001) { value = n.value; break; }
      }
    }

    // Формат 2: "> X" или "< X"
    if (value === null) {
      const oneSided = afterAlias.match(/([><])\s*(\d+(?:\.\d+)?)/);
      if (oneSided) {
        const bound = parseFloat(oneSided[2]);
        if (oneSided[1] === '>') { refMin = bound; refMax = null; } else { refMin = null; refMax = bound; }
        for (const n of numbers) {
          if (Math.abs(n.value - bound) > 0.001) { value = n.value; break; }
        }
      }
    }

    // Формат 3: 3+ числа через пробел
    if (value === null && numbers.length >= 3) {
      value = numbers[0].value;
      refMin = numbers[1].value;
      refMax = numbers[2].value;
    }

    if (value === null) value = numbers[0].value;

    const testRef = getReference(test, patientSex || 'any', patientAge || 30);
    if (refMin === null && refMax === null && testRef) { refMin = testRef.min; refMax = testRef.max; }

    let status = 'normal';
    if (refMin !== null && refMin !== undefined && value < refMin) status = 'low';
    if (refMax !== null && refMax !== undefined && value > refMax) status = 'high';

    return { value, unit: detectedUnit, status, refMin, refMax };
  }

  function parseAnalysisText(text, patientSex, patientAge) {
    if (!text) return {};
    const lines = text.split('\n').filter(l => l.trim().length > 0);
    const results = {};
    const usedTests = new Set();
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const test = findTestByAlias(line);
      if (!test || usedTests.has(test.canonicalName)) continue;
      let valueInfo = extractNumericResult(line, test, patientSex, patientAge);
      if (!valueInfo && i + 1 < lines.length) valueInfo = extractNumericResult(lines[i + 1], test, patientSex, patientAge);
      if (!valueInfo && i + 1 < lines.length) valueInfo = extractNumericResult(line + ' ' + lines[i + 1], test, patientSex, patientAge);
      if (valueInfo) { results[test.canonicalName] = valueInfo; usedTests.add(test.canonicalName); }
    }
    return results;
  }

  function compareResults(oldResults, newResults) {
    const comparison = {};
    const allKeys = new Set([...Object.keys(oldResults || {}), ...Object.keys(newResults || {})]);
    for (const key of allKeys) {
      const oldVal = oldResults?.[key]?.value ?? null;
      const newVal = newResults?.[key]?.value ?? null;
      let change = null, changePercent = null, direction = 'unchanged';
      if (oldVal !== null && newVal !== null && oldVal !== 0) {
        change = newVal - oldVal;
        changePercent = parseFloat(((change / oldVal) * 100).toFixed(1));
        if (change > 0) direction = 'increased'; else if (change < 0) direction = 'decreased';
      }
      comparison[key] = { old: oldVal, new: newVal, change, changePercent, direction, oldStatus: oldResults?.[key]?.status || null, newStatus: newResults?.[key]?.status || null };
    }
    return comparison;
  }

  function detectPatterns(parsedResults) {
    if (!parsedResults) return [];
    const detected = [];
    for (const rule of diagnosticRules) {
      let allMatch = true;
      for (const [testName, expectedStatus] of Object.entries(rule.results)) {
        const result = parsedResults[testName];
        if (!result || result.status !== expectedStatus) { allMatch = false; break; }
      }
      if (allMatch) detected.push(rule);
    }
    return detected;
  }

  function getRecommendations(parsedResults) {
    const recs = [];
    for (const [testName, result] of Object.entries(parsedResults || {})) {
      if (result.status === 'normal') continue;
      const mapEntry = supplementMap[testName];
      if (!mapEntry) continue;
      const advice = mapEntry[result.status];
      if (!advice) continue;
      recs.push({ testName, status: result.status, value: result.value, unit: result.unit, refMin: result.refMin, refMax: result.refMax, ...advice });
    }
    return recs;
  }

  // ═══════════════════════════════════════════════════════════
  //  ФОРМАТИРОВАНИЕ ЕДИНИЦ ИЗМЕРЕНИЯ
  //  Превращает "×10^9/л" в "×10⁹/л" и другие улучшения
  // ═══════════════════════════════════════════════════════════
  function formatUnit(unit) {
    if (!unit || typeof unit !== 'string') return unit || '';
    
    let result = unit.trim();
    
    // Карта надстрочных цифр
    const superscriptMap = {
      '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
      '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
      '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾'
    };
    
    // Карта подстрочных цифр (для химических формул если нужно)
    const subscriptMap = {
      '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
      '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉'
    };
    
    // 1. Заменяем ^N на надстрочные цифры (например ^9 → ⁹, ^12 → ¹²)
    result = result.replace(/\^(\d+)/g, (match, digits) => {
      return digits.split('').map(d => superscriptMap[d] || d).join('');
    });
    
    // 2. Заменяем _N на подстрочные цифры (если встретится)
    result = result.replace(/_(\d+)/g, (match, digits) => {
      return digits.split('').map(d => subscriptMap[d] || d).join('');
    });
    
    // 3. Заменяем "x10" на "×10" (латинская x на знак умножения)
    result = result.replace(/\bx(\d)/gi, '×$1');
    result = result.replace(/\s[xх]\s*(\d)/gi, ' ×$1'); // русская "х" тоже
    
    // 4. Убираем лишние пробелы вокруг знака умножения
    result = result.replace(/\s*×\s*/g, '×');
    
    // 5. Заменяем "10⁹/L" на более красивое если нужно (опционально)
    // Оставляем как есть, потому что 10⁹/L читается нормально
    
    // 6. Нормализация слешей: оставляем как есть (/ это стандарт)
    
    return result;
  }

  // Вспомогательная функция для форматирования референсного диапазона
  function formatReferenceRange(min, max, unit) {
    const fmtUnit = formatUnit(unit);
    if (min === null && max === null) return '—';
    if (min === null) return `до ${max} ${fmtUnit}`;
    if (max === null) return `от ${min} ${fmtUnit}`;
    return `${min} – ${max} ${fmtUnit}`;
  }

  // Форматирование значения с единицей
  function formatValueWithUnit(value, unit) {
    if (value === null || value === undefined) return '—';
    return `${value} ${formatUnit(unit)}`;
  }


  // ═══════════════════════════════════════════════════════════
  //  ЭКСПОРТ
  // ═══════════════════════════════════════════════════════════
  window.labTests = labTests;
  window.diagnosticRules = diagnosticRules;
  window.supplementMap = supplementMap;
  window.preventiveRecommendations = preventiveRecommendations;
  window.findTestByAlias = findTestByAlias;
  window.getReference = getReference;
  window.extractNumericResult = extractNumericResult;
  window.parseAnalysisText = parseAnalysisText;
  window.compareResults = compareResults;
  window.detectPatterns = detectPatterns;
  window.getRecommendations = getRecommendations;
  window.levenshteinDistance = levenshteinDistance;
  window.normalizeString = normalizeString;
  window.formatUnit = formatUnit;
  window.formatReferenceRange = formatReferenceRange;
  window.formatValueWithUnit = formatValueWithUnit;
  console.log(`📚 Database v5.0 loaded: ${labTests.length} tests, ${diagnosticRules.length} rules, ${Object.keys(supplementMap).length} supplements`);
})();