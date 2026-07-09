/**
 * MEDICAL LAB DATABASE v4.2
 * + Fuzzy Matching (Levenshtein)
 * + Стероидный профиль в слюне (пг/мл)
 * + Умный парсер референсов (> X, < X, X | Y, пробел)
 * + Защита десятичных разделителей при нормализации
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
    // Заменяем пунктуацию на пробелы
    s = s.replace(/[—–\-:;()\/\\|]/g, ' ');
    s = s.replace(/[.,]/g, ' ');
    // Возвращаем десятичные разделители как точку
    s = s.replace(/§/g, '.');
    // Сжимаем пробелы
    s = s.replace(/\s+/g, ' ').trim();
    return s;
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function containsWholeWord(text, word) {
    const escaped = escapeRegex(word);
    const pattern = new RegExp('(?:^|\\s)' + escaped + '(?:\\s|$)');
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
  //  ЛАБОРАТОРНЫЕ ТЕСТЫ
  // ═══════════════════════════════════════════════════════════
  const labTests = [
    // ОАК
    { id: 'cbc_hemoglobin', canonicalName: 'Гемоглобин', shortName: 'HGB', category: 'ОАК', units: ['г/л', 'g/L', 'г/дл'], aliases: ['гемоглобин', 'hb', 'hgb', 'hemoglobin', 'haemoglobin', 'гемоглобин крови'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 130, max: 170, unit: 'г/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 120, max: 150, unit: 'г/л' }] },
    { id: 'cbc_rbc', canonicalName: 'Эритроциты', shortName: 'RBC', category: 'ОАК', units: ['×10^12/л', '10^12/L'], aliases: ['эритроциты', 'rbc', 'red blood cells', 'эритроциты крови'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 4.3, max: 5.7, unit: '×10^12/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 3.8, max: 5.1, unit: '×10^12/л' }] },
    { id: 'cbc_hematocrit', canonicalName: 'Гематокрит', shortName: 'HCT', category: 'ОАК', units: ['%'], aliases: ['гематокрит', 'hct', 'hematocrit'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 40, max: 50, unit: '%' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 36, max: 46, unit: '%' }] },
    { id: 'cbc_mcv', canonicalName: 'Средний объём эритроцита', shortName: 'MCV', category: 'ОАК', units: ['фл', 'fL'], aliases: ['mcv', 'средний объем эритроцита', 'mean corpuscular volume'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 80, max: 100, unit: 'фл' }] },
    { id: 'cbc_mch', canonicalName: 'Среднее содержание гемоглобина в эритроците', shortName: 'MCH', category: 'ОАК', units: ['пг', 'pg'], aliases: ['mch', 'среднее содержание гемоглобина', 'mean corpuscular hemoglobin'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 27, max: 34, unit: 'пг' }] },
    { id: 'cbc_mchc', canonicalName: 'Средняя концентрация гемоглобина в эритроците', shortName: 'MCHC', category: 'ОАК', units: ['г/л', 'g/L'], aliases: ['mchc', 'средняя концентрация гемоглобина'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 320, max: 360, unit: 'г/л' }] },
    { id: 'cbc_rdw_cv', canonicalName: 'Ширина распределения эритроцитов', shortName: 'RDW-CV', category: 'ОАК', units: ['%'], aliases: ['rdw', 'rdw-cv', 'ширина распределения эритроцитов', 'red cell distribution width'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 11.5, max: 14.5, unit: '%' }] },
    { id: 'cbc_platelets', canonicalName: 'Тромбоциты', shortName: 'PLT', category: 'ОАК', units: ['×10^9/л', '10^9/L'], aliases: ['тромбоциты', 'plt', 'platelets', 'platelet count'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 150, max: 400, unit: '×10^9/л' }] },
    { id: 'cbc_wbc', canonicalName: 'Лейкоциты', shortName: 'WBC', category: 'ОАК', units: ['×10^9/л', '10^9/L'], aliases: ['лейкоциты', 'wbc', 'white blood cells'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 4.0, max: 9.0, unit: '×10^9/л' }] },
    { id: 'cbc_neutrophils_percent', canonicalName: 'Нейтрофилы, %', shortName: 'NEUT%', category: 'ОАК', units: ['%'], aliases: ['нейтрофилы', 'neut', 'neut%', 'neutrophils', 'сегментоядерные'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 40, max: 75, unit: '%' }] },
    { id: 'cbc_lymphocytes_percent', canonicalName: 'Лимфоциты, %', shortName: 'LYMPH%', category: 'ОАК', units: ['%'], aliases: ['лимфоциты', 'lymph', 'lym', 'lymph%', 'lymphocytes'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 20, max: 45, unit: '%' }] },
    { id: 'cbc_monocytes_percent', canonicalName: 'Моноциты, %', shortName: 'MONO%', category: 'ОАК', units: ['%'], aliases: ['моноциты', 'mono', 'mon%', 'monocytes'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2, max: 10, unit: '%' }] },
    { id: 'cbc_eosinophils_percent', canonicalName: 'Эозинофилы, %', shortName: 'EO%', category: 'ОАК', units: ['%'], aliases: ['эозинофилы', 'eosinophils', 'eo', 'eos', 'эозинофилы %'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: '%' }] },
    { id: 'cbc_basophils_percent', canonicalName: 'Базофилы, %', shortName: 'BASO%', category: 'ОАК', units: ['%'], aliases: ['базофилы', 'baso', 'bas', 'basophils'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 1, unit: '%' }] },
    { id: 'cbc_esr', canonicalName: 'СОЭ', shortName: 'ESR', category: 'ОАК', units: ['мм/ч', 'mm/h'], aliases: ['соэ', 'скорость оседания эритроцитов', 'esr', 'роэ'], references: [{ sex: 'male', ageMin: 18, ageMax: 50, min: 0, max: 15, unit: 'мм/ч' }, { sex: 'female', ageMin: 18, ageMax: 50, min: 0, max: 20, unit: 'мм/ч' }, { sex: 'male', ageMin: 51, ageMax: 120, min: 0, max: 20, unit: 'мм/ч' }, { sex: 'female', ageMin: 51, ageMax: 120, min: 0, max: 30, unit: 'мм/ч' }] },

    // Биохимия
    { id: 'biochem_glucose', canonicalName: 'Глюкоза натощак', shortName: 'GLU', category: 'Биохимия', units: ['ммоль/л', 'mg/dL'], aliases: ['глюкоза', 'глюкоза крови', 'сахар', 'сахар крови', 'glu', 'glucose', 'глюкоза натощак'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.9, max: 5.5, unit: 'ммоль/л' }] },
    { id: 'biochem_hba1c', canonicalName: 'Гликированный гемоглобин', shortName: 'HbA1c', category: 'Биохимия', units: ['%'], aliases: ['гликированный гемоглобин', 'hba1c', 'a1c', 'glycated hemoglobin'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 4.0, max: 5.6, unit: '%' }] },
    { id: 'biochem_insulin', canonicalName: 'Инсулин натощак', shortName: 'INS', category: 'Биохимия', units: ['мкЕд/мл', 'мЕд/л'], aliases: ['инсулин', 'инсулин натощак', 'insulin', 'fasting insulin'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2.6, max: 24.9, unit: 'мкЕд/мл' }] },
    { id: 'biochem_total_cholesterol', canonicalName: 'Холестерин общий', shortName: 'TC', category: 'Липидограмма', units: ['ммоль/л', 'mg/dL'], aliases: ['холестерин общий', 'холестерин', 'total cholesterol', 'tc', 'chol'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5.2, unit: 'ммоль/л' }] },
    { id: 'biochem_ldl', canonicalName: 'Холестерин ЛПНП', shortName: 'LDL-C', category: 'Липидограмма', units: ['ммоль/л', 'mg/dL'], aliases: ['лпнп', 'холестерин лпнп', 'ldl', 'ldl-c', 'low density lipoprotein'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 3.0, unit: 'ммоль/л' }] },
    { id: 'biochem_hdl', canonicalName: 'Холестерин ЛПВП', shortName: 'HDL-C', category: 'Липидограмма', units: ['ммоль/л', 'mg/dL'], aliases: ['лпвп', 'холестерин лпвп', 'hdl', 'hdl-c', 'high density lipoprotein'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 1.0, max: null, unit: 'ммоль/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 1.2, max: null, unit: 'ммоль/л' }] },
    { id: 'biochem_triglycerides', canonicalName: 'Триглицериды', shortName: 'TG', category: 'Липидограмма', units: ['ммоль/л', 'mg/dL'], aliases: ['триглицериды', 'тг', 'tg', 'triglycerides'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 1.7, unit: 'ммоль/л' }] },
    { id: 'biochem_alt', canonicalName: 'Аланинаминотрансфераза', shortName: 'АЛТ', category: 'Печёночные ферменты', units: ['Ед/л', 'U/L'], aliases: ['алт', 'аланинаминотрансфераза', 'alt', 'alat', 'sgpt'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 41, unit: 'Ед/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 33, unit: 'Ед/л' }] },
    { id: 'biochem_ast', canonicalName: 'Аспартатаминотрансфераза', shortName: 'АСТ', category: 'Печёночные ферменты', units: ['Ед/л', 'U/L'], aliases: ['аст', 'аспартатаминотрансфераза', 'ast', 'asat', 'sgot'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 40, unit: 'Ед/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 32, unit: 'Ед/л' }] },
    { id: 'biochem_ggt', canonicalName: 'Гамма-глутамилтрансфераза', shortName: 'ГГТ', category: 'Печёночные ферменты', units: ['Ед/л', 'U/L'], aliases: ['ггт', 'гамма-гт', 'ggt', 'ggtp', 'gamma gt'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 60, unit: 'Ед/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 0, max: 40, unit: 'Ед/л' }] },
    { id: 'biochem_alp', canonicalName: 'Щелочная фосфатаза', shortName: 'ЩФ', category: 'Печёночные ферменты', units: ['Ед/л', 'U/L'], aliases: ['щелочная фосфатаза', 'щф', 'alp', 'alkaline phosphatase'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 40, max: 150, unit: 'Ед/л' }] },
    { id: 'biochem_total_bilirubin', canonicalName: 'Билирубин общий', shortName: 'TBIL', category: 'Билирубин', units: ['мкмоль/л', 'µmol/L'], aliases: ['билирубин общий', 'общий билирубин', 'tbil', 'total bilirubin'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.4, max: 20.5, unit: 'мкмоль/л' }] },
    { id: 'biochem_direct_bilirubin', canonicalName: 'Билирубин прямой', shortName: 'DBIL', category: 'Билирубин', units: ['мкмоль/л', 'µmol/L'], aliases: ['билирубин прямой', 'прямой билирубин', 'dbil', 'direct bilirubin'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5.1, unit: 'мкмоль/л' }] },
    { id: 'biochem_total_protein', canonicalName: 'Общий белок', shortName: 'TP', category: 'Биохимия', units: ['г/л', 'g/L'], aliases: ['общий белок', 'total protein', 'tp'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 65, max: 85, unit: 'г/л' }] },
    { id: 'biochem_albumin', canonicalName: 'Альбумин', shortName: 'ALB', category: 'Биохимия', units: ['г/л', 'g/L'], aliases: ['альбумин', 'albumin'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 35, max: 50, unit: 'г/л' }] },
    { id: 'biochem_creatinine', canonicalName: 'Креатинин', shortName: 'CREA', category: 'Почки', units: ['мкмоль/л', 'µmol/L'], aliases: ['креатинин', 'crea', 'creatinine'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 62, max: 106, unit: 'мкмоль/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 44, max: 80, unit: 'мкмоль/л' }] },
    { id: 'biochem_urea', canonicalName: 'Мочевина', shortName: 'UREA', category: 'Почки', units: ['ммоль/л', 'mg/dL'], aliases: ['мочевина', 'urea', 'blood urea', 'bun'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2.5, max: 8.3, unit: 'ммоль/л' }] },
    { id: 'biochem_uric_acid', canonicalName: 'Мочевая кислота', shortName: 'UA', category: 'Биохимия', units: ['мкмоль/л', 'mg/dL'], aliases: ['мочевая кислота', 'uric acid'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 202, max: 416, unit: 'мкмоль/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 150, max: 350, unit: 'мкмоль/л' }] },
    { id: 'biochem_crp', canonicalName: 'С-реактивный белок', shortName: 'CRP', category: 'Маркеры воспаления', units: ['мг/л', 'mg/L'], aliases: ['с-реактивный белок', 'срб', 'crp', 'c-reactive protein'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 5, unit: 'мг/л' }] },
    { id: 'biochem_amylase', canonicalName: 'Амилаза', shortName: 'AMY', category: 'Панкреас', units: ['Ед/л', 'U/L'], aliases: ['амилаза', 'amylase', 'альфа-амилаза'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 28, max: 100, unit: 'Ед/л' }] },
    { id: 'biochem_lipase', canonicalName: 'Липаза', shortName: 'LPS', category: 'Панкреас', units: ['Ед/л', 'U/L'], aliases: ['липаза', 'lipase'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 60, unit: 'Ед/л' }] },

    // Электролиты
    { id: 'electrolytes_potassium', canonicalName: 'Калий', shortName: 'K', category: 'Электролиты', units: ['ммоль/л', 'mEq/L'], aliases: ['калий', 'k', 'k+', 'potassium'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.5, max: 5.1, unit: 'ммоль/л' }] },
    { id: 'electrolytes_sodium', canonicalName: 'Натрий', shortName: 'Na', category: 'Электролиты', units: ['ммоль/л', 'mEq/L'], aliases: ['натрий', 'na', 'na+', 'sodium'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 136, max: 145, unit: 'ммоль/л' }] },
    { id: 'electrolytes_chloride', canonicalName: 'Хлор', shortName: 'Cl', category: 'Электролиты', units: ['ммоль/л', 'mEq/L'], aliases: ['хлор', 'хлориды', 'cl', 'cl-', 'chloride'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 98, max: 107, unit: 'ммоль/л' }] },
    { id: 'electrolytes_magnesium', canonicalName: 'Магний', shortName: 'Mg', category: 'Электролиты', units: ['ммоль/л'], aliases: ['магний', 'mg', 'magnesium'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.75, max: 1.25, unit: 'ммоль/л' }] },
    { id: 'electrolytes_calcium', canonicalName: 'Кальций общий', shortName: 'Ca', category: 'Электролиты', units: ['ммоль/л'], aliases: ['кальций', 'кальций общий', 'ca', 'calcium'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 2.15, max: 2.55, unit: 'ммоль/л' }] },
    { id: 'electrolytes_phosphorus', canonicalName: 'Фосфор', shortName: 'P', category: 'Электролиты', units: ['ммоль/л'], aliases: ['фосфор', 'p', 'phosphorus'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.81, max: 1.45, unit: 'ммоль/л' }] },

    // Железо
    { id: 'iron_ferritin', canonicalName: 'Ферритин', shortName: 'Ferritin', category: 'Обмен железа', units: ['нг/мл', 'µg/L'], aliases: ['ферритин', 'ferritin'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 30, max: 400, unit: 'нг/мл' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 15, max: 150, unit: 'нг/мл' }] },
    { id: 'iron_serum_iron', canonicalName: 'Железо сывороточное', shortName: 'Fe', category: 'Обмен железа', units: ['мкмоль/л', 'µmol/L'], aliases: ['железо', 'железо сывороточное', 'fe', 'serum iron'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 11.6, max: 31.3, unit: 'мкмоль/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 9.0, max: 30.4, unit: 'мкмоль/л' }] },
    { id: 'iron_tibc', canonicalName: 'ОЖСС', shortName: 'TIBC', category: 'Обмен железа', units: ['мкмоль/л'], aliases: ['ожсс', 'общая железосвязывающая способность', 'tibc'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 45, max: 76, unit: 'мкмоль/л' }] },

    // Щитовидная железа
    { id: 'thyroid_tsh', canonicalName: 'Тиреотропный гормон', shortName: 'ТТГ', category: 'Щитовидная железа', units: ['мМЕ/л', 'mIU/L', 'мкМЕ/мл'], aliases: ['ттг', 'тиреотропный гормон', 'tsh', 'thyrotropin'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.4, max: 4.0, unit: 'мМЕ/л' }] },
    { id: 'thyroid_ft4', canonicalName: 'Тироксин свободный', shortName: 'св. Т4', category: 'Щитовидная железа', units: ['пмоль/л', 'ng/dL'], aliases: ['свободный т4', 'т4 свободный', 'ft4', 'free t4'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 10, max: 22, unit: 'пмоль/л' }] },
    { id: 'thyroid_ft3', canonicalName: 'Трийодтиронин свободный', shortName: 'св. Т3', category: 'Щитовидная железа', units: ['пмоль/л', 'pg/mL'], aliases: ['свободный т3', 'т3 свободный', 'ft3', 'free t3'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3.5, max: 6.5, unit: 'пмоль/л' }] },

    // Витамины
    { id: 'vitamin_d', canonicalName: '25-гидроксивитамин D', shortName: '25(OH)D', category: 'Витамины', units: ['нг/мл', 'нмоль/л'], aliases: ['витамин d', 'витамин д', '25-oh витамин d', '25(oh)d', '25-гидроксивитамин d', 'vitamin d'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 30, max: 100, unit: 'нг/мл' }] },
    { id: 'vitamin_b12', canonicalName: 'Витамин B12', shortName: 'B12', category: 'Витамины', units: ['пг/мл', 'пмоль/л'], aliases: ['витамин b12', 'витамин в12', 'b12', 'cyanocobalamin', 'цианокобаламин'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 200, max: 900, unit: 'пг/мл' }] },
    { id: 'vitamin_folate', canonicalName: 'Фолиевая кислота', shortName: 'Folate', category: 'Витамины', units: ['нг/мл'], aliases: ['фолиевая кислота', 'фолат', 'folate', 'folic acid', 'витамин b9'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 3, max: 17, unit: 'нг/мл' }] },

    // Микроэлементы
    { id: 'trace_zinc', canonicalName: 'Цинк', shortName: 'Zn', category: 'Микроэлементы', units: ['мкмоль/л'], aliases: ['цинк', 'zinc', 'zn'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 10, max: 18, unit: 'мкмоль/л' }] },

    // Коагулограмма
    { id: 'coag_inr', canonicalName: 'МНО', shortName: 'INR', category: 'Коагулограмма', units: [''], aliases: ['мно', 'inr', 'international normalized ratio'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0.8, max: 1.2, unit: '' }] },
    { id: 'coag_d_dimer', canonicalName: 'D-димер', shortName: 'D-dimer', category: 'Коагулограмма', units: ['мкг/мл FEU', 'нг/мл FEU'], aliases: ['д-димер', 'd-dimer', 'd dimer', 'ddimer'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 0.5, unit: 'мкг/мл FEU' }] },

    // Гормоны
    { id: 'hormone_testosterone', canonicalName: 'Тестостерон общий', shortName: 'Testo', category: 'Гормоны', units: ['нмоль/л', 'нг/мл', 'пг/мл'], aliases: ['тестостерон', 'тестостерон общий', 'testosterone', 'total testosterone'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 8.0, max: 35.0, unit: 'нмоль/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 0.5, max: 2.5, unit: 'нмоль/л' }, { sex: 'male', ageMin: 18, ageMax: 120, min: 114.80, max: null, unit: 'пг/мл' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 86.80, max: null, unit: 'пг/мл' }] },
    { id: 'hormone_shbg', canonicalName: 'ГСПГ', shortName: 'SHBG', category: 'Гормоны', units: ['нмоль/л'], aliases: ['гспг', 'глобулин связывающий половые гормоны', 'shbg'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 13, max: 71, unit: 'нмоль/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 18, max: 114, unit: 'нмоль/л' }] },
    { id: 'hormone_prolactin', canonicalName: 'Пролактин', shortName: 'PRL', category: 'Гормоны', units: ['мЕд/л', 'мкМЕ/мл'], aliases: ['пролактин', 'prolactin', 'prl'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 50, max: 400, unit: 'мЕд/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 50, max: 500, unit: 'мЕд/л' }] },
    { id: 'hormone_lh', canonicalName: 'Лютеинизирующий гормон', shortName: 'ЛГ', category: 'Гормоны', units: ['МЕ/л'], aliases: ['лг', 'лютеинизирующий гормон', 'lh'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 1.5, max: 9.3, unit: 'МЕ/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 1.7, max: 15.0, unit: 'МЕ/л' }] },
    { id: 'hormone_fsh', canonicalName: 'Фолликулостимулирующий гормон', shortName: 'ФСГ', category: 'Гормоны', units: ['МЕ/л'], aliases: ['фсг', 'фолликулостимулирующий гормон', 'fsh'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 1.4, max: 15.4, unit: 'МЕ/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 1.4, max: 20.0, unit: 'МЕ/л' }] },
    { id: 'hormone_estradiol', canonicalName: 'Эстрадиол', shortName: 'E2', category: 'Гормоны', units: ['пмоль/л', 'пг/мл'], aliases: ['эстрадиол', 'estradiol', 'e2'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 40, max: 160, unit: 'пмоль/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 70, max: 1200, unit: 'пмоль/л' }, { sex: 'male', ageMin: 18, ageMax: 120, min: 4.12, max: 9.09, unit: 'пг/мл' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 15, max: 350, unit: 'пг/мл' }] },
    { id: 'hormone_dhea_s', canonicalName: 'ДГЭА-С', shortName: 'DHEA-S', category: 'Гормоны', units: ['мкмоль/л'], aliases: ['дгэа-с', 'дегидроэпиандростерон сульфат', 'dhea-s', 'dheas'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 2.5, max: 14.5, unit: 'мкмоль/л' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 1.8, max: 11.0, unit: 'мкмоль/л' }] },
    { id: 'hormone_androstenedione', canonicalName: 'Андростендион', shortName: 'A4', category: 'Гормоны', units: ['пг/мл', 'нг/мл'], aliases: ['андростендион', 'androstenedione', 'a4'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 315, max: 790, unit: 'пг/мл' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 300, max: 2500, unit: 'пг/мл' }] },
    { id: 'hormone_dhea', canonicalName: 'Дегидроэпиандростерон', shortName: 'DHEA', category: 'Гормоны', units: ['пг/мл'], aliases: ['дегидроэпиандростерон', 'dhea', 'дгэа'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 900, max: 7930, unit: 'пг/мл' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 800, max: 6000, unit: 'пг/мл' }] },
    { id: 'hormone_cortisol', canonicalName: 'Кортизол', shortName: 'Cortisol', category: 'Гормоны', units: ['пг/мл', 'нмоль/л'], aliases: ['кортизол', 'cortisol'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1400, max: 10100, unit: 'пг/мл' }, { sex: 'any', ageMin: 18, ageMax: 120, min: 140, max: 690, unit: 'нмоль/л' }] },
    { id: 'hormone_cortisone', canonicalName: 'Кортизон', shortName: 'Cortisone', category: 'Гормоны', units: ['пг/мл'], aliases: ['кортизон', 'cortisone'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 5000, max: 35000, unit: 'пг/мл' }] },
    { id: 'hormone_pregnenolone', canonicalName: 'Прегненолон', shortName: 'Pregnenolone', category: 'Гормоны', units: ['пг/мл'], aliases: ['прегненолон', 'pregnenolone'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 200, max: 1000, unit: 'пг/мл' }] },
    { id: 'hormone_progesterone', canonicalName: 'Прогестерон', shortName: 'Progesterone', category: 'Гормоны', units: ['пг/мл', 'нмоль/л'], aliases: ['прогестерон', 'progesterone'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 100, max: 500, unit: 'пг/мл' }, { sex: 'female', ageMin: 18, ageMax: 120, min: 100, max: 20000, unit: 'пг/мл' }] },

    // Онкомаркеры
    { id: 'tumor_psa', canonicalName: 'ПСА общий', shortName: 'PSA', category: 'Онкомаркеры', units: ['нг/мл'], aliases: ['пса общий', 'psa total', 'total psa', 'простатспецифический антиген'], references: [{ sex: 'male', ageMin: 18, ageMax: 120, min: 0, max: 4.0, unit: 'нг/мл' }] },

    // Моча
    { id: 'urine_sg', canonicalName: 'Удельный вес мочи', shortName: 'SG', category: 'Общий анализ мочи', units: [''], aliases: ['удельный вес', 'относительная плотность мочи', 'specific gravity', 'sg'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 1.010, max: 1.025, unit: '' }] },
    { id: 'urine_ph', canonicalName: 'pH мочи', shortName: 'pH', category: 'Общий анализ мочи', units: [''], aliases: ['ph мочи', 'реакция мочи', 'urine ph'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 5.0, max: 7.5, unit: '' }] },

    // Кардиомаркеры
    { id: 'cardiac_troponin', canonicalName: 'Тропонин', shortName: 'Tn', category: 'Кардиомаркеры', units: ['нг/л', 'нг/мл'], aliases: ['тропонин', 'troponin', 'тропонин i'], references: [{ sex: 'any', ageMin: 18, ageMax: 120, min: 0, max: 14, unit: 'нг/л' }] }
  ];

  // ═══════════════════════════════════════════════════════════
  //  ДИАГНОСТИЧЕСКИЕ ПРАВИЛА
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
    { id: 12, name: 'Подагра', danger: 'medium', doctors: ['Ревматолог'], results: { 'Мочевая кислота': 'high' } },
    { id: 13, name: 'Поражение печени', danger: 'high', doctors: ['Гастроэнтеролог'], results: { 'Аланинаминотрансфераза': 'high', 'Аспартатаминотрансфераза': 'high' } },
    { id: 14, name: 'Хроническая болезнь почек', danger: 'high', doctors: ['Нефролог'], results: { 'Креатинин': 'high', 'Мочевина': 'high' } },
    { id: 15, name: 'Дефицит B12', danger: 'low', doctors: ['Терапевт', 'Невролог'], results: { 'Витамин B12': 'low' } },
    { id: 16, name: 'Гиперкортицизм', danger: 'high', doctors: ['Эндокринолог'], results: { 'Кортизол': 'high' } },
    { id: 17, name: 'Надпочечниковая недостаточность', danger: 'high', doctors: ['Эндокринолог'], results: { 'Кортизол': 'low' } }
  ];

  // ═══════════════════════════════════════════════════════════
  //  КАРТА РЕКОМЕНДАЦИЙ
  // ═══════════════════════════════════════════════════════════
  const supplementMap = {
    '25-гидроксивитамин D': { low: { supplement: 'Витамин D3 2000–4000 МЕ/сут', doctors: ['Терапевт'], duration: '2–3 месяца', danger: 'low', description: 'Витамин D помогает усваивать кальций.', dangerDesc: 'Низкий уровень повышает риск остеопороза.' } },
    'Гемоглобин': { low: { supplement: 'Препараты железа + витамин C', doctors: ['Терапевт'], duration: '1–3 месяца', danger: 'medium', description: 'Белок, переносящий кислород.', dangerDesc: 'Анемия, риск гипоксии органов.' } },
    'Ферритин': { low: { supplement: 'Препараты железа', doctors: ['Терапевт', 'Гематолог'], duration: '1–2 месяца', danger: 'medium', description: 'Запасы железа в организме.', dangerDesc: 'Ведёт к железодефицитной анемии.' } },
    'Тиреотропный гормон': { high: { supplement: 'Левотироксин по назначению врача', doctors: ['Эндокринолог'], duration: 'длительно', danger: 'medium', description: 'Гипотиреоз.', dangerDesc: 'Замедляет обмен веществ.' }, low: { supplement: 'Обследование щитовидной железы', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'high', description: 'Гипертиреоз.', dangerDesc: 'Опасен для сердца.' } },
    'Тестостерон общий': { low: { supplement: 'Гормональная терапия под контролем врача', doctors: ['Уролог', 'Эндокринолог'], duration: 'длительно', danger: 'medium', description: 'Основной мужской гормон.', dangerDesc: 'Снижение либидо, усталость.' } },
    'Кортизол': { high: { supplement: 'Обследование надпочечников', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'high', description: 'Гормон стресса.', dangerDesc: 'Синдром Кушинга.' }, low: { supplement: 'Обследование надпочечников', doctors: ['Эндокринолог'], duration: 'срочно', danger: 'high', description: 'Болезнь Аддисона.', dangerDesc: 'Опасно для жизни.' } },
    'Кортизон': { high: { supplement: 'Обследование надпочечников', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'medium', description: 'Метаболит кортизола.', dangerDesc: 'Избыточная активность надпочечников.' }, low: { supplement: 'Консультация эндокринолога', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'medium', description: 'Метаболит кортизола.', dangerDesc: 'Недостаточность надпочечников.' } },
    'Прегненолон': { high: { supplement: 'Консультация эндокринолога', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'low', description: 'Предшественник стероидов.', dangerDesc: 'Избыточная активность надпочечников.' }, low: { supplement: 'Консультация эндокринолога', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'low', description: 'Предшественник стероидов.', dangerDesc: 'Усталость, снижение когнитивных функций.' } },
    'Андростендион': { high: { supplement: 'Обследование надпочечников и яичников', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'medium', description: 'Предшественник тестостерона.', dangerDesc: 'Опухоли, СПКЯ.' }, low: { supplement: 'Консультация эндокринолога', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'low', description: 'Предшественник половых гормонов.', dangerDesc: 'Недостаточность надпочечников.' } },
    'Дегидроэпиандростерон': { high: { supplement: 'Обследование надпочечников', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'medium', description: 'Гормон надпочечников.', dangerDesc: 'Опухоли надпочечников.' }, low: { supplement: 'Консультация эндокринолога', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'low', description: 'Гормон надпочечников.', dangerDesc: 'Усталость, снижение иммунитета.' } },
    'Прогестерон': { low: { supplement: 'Консультация гинеколога-эндокринолога', doctors: ['Гинеколог', 'Эндокринолог'], duration: 'до нормализации', danger: 'medium', description: 'Гормон беременности.', dangerDesc: 'Нарушения цикла, бесплодие.' } },
    'Эстрадиол': { low: { supplement: 'Консультация гинеколога-эндокринолога', doctors: ['Гинеколог', 'Эндокринолог'], duration: 'до нормализации', danger: 'medium', description: 'Основной женский гормон.', dangerDesc: 'Нарушения цикла, остеопороз.' } },
    'Глюкоза натощак': { high: { supplement: 'Контроль углеводов, консультация эндокринолога', doctors: ['Эндокринолог'], duration: 'постоянно', danger: 'high', description: 'Риск диабета.', dangerDesc: 'Повреждает сосуды.' } },
    'Холестерин общий': { high: { supplement: 'Диета, статины', doctors: ['Кардиолог'], duration: 'длительно', danger: 'high', description: 'Атеросклероз.', dangerDesc: 'Риск инфаркта.' } },
    'Креатинин': { high: { supplement: 'Контроль почек', doctors: ['Нефролог'], duration: 'постоянно', danger: 'high', description: 'Маркер работы почек.', dangerDesc: 'Почечная недостаточность.' } },
    'Аланинаминотрансфераза': { high: { supplement: 'Гепатопротекторы', doctors: ['Гастроэнтеролог'], duration: 'до нормализации', danger: 'high', description: 'Повреждение печени.', dangerDesc: 'Гепатит.' } },
    'Аспартатаминотрансфераза': { high: { supplement: 'Обследование печени и сердца', doctors: ['Гастроэнтеролог', 'Кардиолог'], duration: 'до нормализации', danger: 'high', description: 'Маркер повреждения.', dangerDesc: 'Гепатит, инфаркт.' } },
    'С-реактивный белок': { high: { supplement: 'Лечение воспаления', doctors: ['Терапевт'], duration: 'до нормализации', danger: 'medium', description: 'Маркер воспаления.', dangerDesc: 'Инфекция, аутоиммунные процессы.' } },
    'Лейкоциты': { high: { supplement: 'Противовоспалительная терапия', doctors: ['Терапевт'], duration: 'до нормализации', danger: 'medium', description: 'Защита от инфекций.', dangerDesc: 'Бактериальная инфекция.' }, low: { supplement: 'Иммуностимуляторы', doctors: ['Гематолог'], duration: 'до выяснения', danger: 'high', description: 'Лейкопения.', dangerDesc: 'Риск инфекций.' } },
    'Тромбоциты': { low: { supplement: 'Консультация гематолога', doctors: ['Гематолог'], duration: 'срочно', danger: 'high', description: 'Свёртываемость крови.', dangerDesc: 'Риск кровотечений.' } },
    'D-димер': { high: { supplement: 'Срочное обследование на тромбоз', doctors: ['Терапевт', 'Кардиолог'], duration: 'немедленно', danger: 'high', description: 'Маркер тромбоза.', dangerDesc: 'Подозрение на тромбоз.' } },
    'ПСА общий': { high: { supplement: 'Консультация уролога, биопсия', doctors: ['Уролог'], duration: 'повтор через 1-3 мес', danger: 'high', description: 'Онкомаркер простаты.', dangerDesc: 'Возможен рак простаты.' } },
    'Витамин B12': { low: { supplement: 'Витамин B12 1000-2000 мкг/сут', doctors: ['Терапевт', 'Невролог'], duration: '1-2 месяца', danger: 'low', description: 'Для нервной системы.', dangerDesc: 'Анемия, неврологические нарушения.' } },
    'Мочевая кислота': { high: { supplement: 'Диета с низким содержанием пуринов', doctors: ['Ревматолог'], duration: 'длительно', danger: 'medium', description: 'Продукт распада пуринов.', dangerDesc: 'Подагра, камни в почках.' } },
    'Тропонин': { high: { supplement: 'Срочная госпитализация', doctors: ['Кардиолог'], duration: 'немедленно', danger: 'high', description: 'Маркер инфаркта.', dangerDesc: 'Инфаркт миокарда.' } },
    'Пролактин': { high: { supplement: 'МРТ гипофиза', doctors: ['Эндокринолог'], duration: 'до выяснения', danger: 'medium', description: 'Гормон лактации.', dangerDesc: 'Возможна пролактинома.' } },
    'Калий': { high: { supplement: 'Ограничение калийсодержащих продуктов', doctors: ['Терапевт', 'Кардиолог'], duration: 'срочно', danger: 'high', description: 'Важно для сердца.', dangerDesc: 'Остановка сердца.' }, low: { supplement: 'Препараты калия', doctors: ['Терапевт'], duration: 'до нормализации', danger: 'medium', description: 'Недостаток калия.', dangerDesc: 'Аритмия.' } }
  };

  const preventiveRecommendations = [
    { supplement: 'Витамин D3 1000–2000 МЕ/сут', doctors: ['Терапевт'], duration: '1–2 месяца', note: 'Профилактика дефицита.' },
    { supplement: 'Магний 200–300 мг/сут', doctors: ['Терапевт'], duration: '1 месяц', note: 'От стресса и утомляемости.' },
    { supplement: 'Омега-3 1000–2000 мг/сут', doctors: ['Терапевт'], duration: '3 месяца', note: 'Для сердца и сосудов.' }
  ];

  // ═══════════════════════════════════════════════════════════
  //  ПОИСК ТЕСТА (с Fuzzy Matching и приоритетами)
  // ═══════════════════════════════════════════════════════════
  function findTestByAlias(line) {
    const normLine = normalizeString(line);
    if (!normLine) return null;

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

        // Приоритет 3: Fuzzy Matching (базовый score)
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
  //  ИЗВЛЕЧЕНИЕ РЕЗУЛЬТАТА (десятичные + диапазоны через пробел)
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

    // Формат 3: "значение мин макс" (3+ числа через пробел)
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
  //  ЭКСПОРТ (сохраняем старый API window.xxx)
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
})();