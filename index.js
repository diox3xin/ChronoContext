/**
 * ╔══════════════════════════════════════════╗
 * ║   ChronoContext — SillyTavern Extension  ║
 * ║   Историческая контекстуализация RP      ║
 * ║   Автор: Haru & Bunny                    ║
 * ╚══════════════════════════════════════════╝
 *
 * Ищет информацию о стране и годе в Wikipedia,
 * обрабатывает через AI, инжектит в контекст RP.
 */

// ═══════════════════════════════════════
//  ИМПОРТЫ
// ═══════════════════════════════════════

import {
    extension_settings,
    getContext,
    setExtensionPrompt,
    saveMetadataDebounced,
} from "../../../extensions.js";

import {
    saveSettingsDebounced,
    eventSource,
    event_types,
    generateQuietPrompt,
} from "../../../../script.js";

// ═══════════════════════════════════════
//  КОНСТАНТЫ
// ═══════════════════════════════════════

const EXT_NAME = "chrono-context";
const EXT_DISPLAY = "ChronoContext 🕰️";

// Позиции инжекции в промпт
const INJECTION_POSITION = {
    AFTER_SYSTEM: 1,
    IN_CHAT: 2,
};

// Базовый URL для Wikipedia API (английская вики — самая полная)
const WIKI_API_BASE = "https://en.wikipedia.org/w/api.php";
const WIKI_REST_BASE = "https://en.wikipedia.org/api/rest_v1";

// Список предустановленных стран
// wiki_name: название для поиска в Wikipedia
// alt_names: альтернативные названия (для разных эпох)
const COUNTRY_PRESETS = {
    russia:        { label: "Россия",           wiki_name: "Russia",         alt_names: ["Russian Federation"] },
    ussr:          { label: "СССР",             wiki_name: "Soviet Union",   alt_names: ["USSR", "Soviet Russia"] },
    usa:           { label: "США",              wiki_name: "United States",  alt_names: ["United States of America", "USA", "US"] },
    uk:            { label: "Великобритания",   wiki_name: "United Kingdom", alt_names: ["Britain", "UK", "England"] },
    japan:         { label: "Япония",           wiki_name: "Japan",          alt_names: [] },
    germany:       { label: "Германия",         wiki_name: "Germany",        alt_names: ["West Germany", "East Germany"] },
    france:        { label: "Франция",          wiki_name: "France",         alt_names: [] },
    china:         { label: "Китай",            wiki_name: "China",          alt_names: ["People's Republic of China", "PRC"] },
    south_korea:   { label: "Южная Корея",      wiki_name: "South Korea",    alt_names: ["Republic of Korea"] },
    italy:         { label: "Италия",           wiki_name: "Italy",          alt_names: [] },
    brazil:        { label: "Бразилия",         wiki_name: "Brazil",         alt_names: [] },
    spain:         { label: "Испания",          wiki_name: "Spain",          alt_names: [] },
    canada:        { label: "Канада",           wiki_name: "Canada",         alt_names: [] },
    australia:     { label: "Австралия",        wiki_name: "Australia",      alt_names: [] },
    india:         { label: "Индия",            wiki_name: "India",          alt_names: [] },
    mexico:        { label: "Мексика",          wiki_name: "Mexico",         alt_names: [] },
    turkey:        { label: "Турция",           wiki_name: "Turkey",         alt_names: ["Ottoman Empire"] },
    poland:        { label: "Польша",           wiki_name: "Poland",         alt_names: [] },
    ukraine:       { label: "Украина",          wiki_name: "Ukraine",        alt_names: [] },
};

// Дефолтные настройки расширения
const DEFAULT_SETTINGS = {
    enabled: false,
    country_key: "russia",
    custom_country: "",
    year: 2000,
    output_language: "ru",
    modules: {
        technology: true,
        culture: true,
        politics: true,
        economy: true,
        daily_life: true,
        slang: true,
        anachronisms: true,
        news_background: false,
    },
    injection_position: INJECTION_POSITION.AFTER_SYSTEM,
    injection_depth: 4,
    cache: {},           // { "russia_2016_ru": { package: "...", timestamp: ... } }
    active_package: "",  // Текущий активный пакет (текст для инжекции)
};


// ═══════════════════════════════════════
//  HTML ШАБЛОН ДЛЯ UI
// ═══════════════════════════════════════

const SETTINGS_HTML = `
<div id="chrono-context-settings">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🕰️ ChronoContext</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">

            <!-- Вкл/Выкл -->
            <div class="chrono-row">
                <label class="checkbox_label" for="chrono_enabled">
                    <input type="checkbox" id="chrono_enabled" />
                    <span>Включить инжекцию в контекст</span>
                </label>
            </div>

            <hr class="sysHR" />

            <!-- Выбор страны -->
            <div class="chrono-row">
                <label for="chrono_country">🌍 Страна:</label>
                <select id="chrono_country" class="text_pole">
                    ${Object.entries(COUNTRY_PRESETS).map(([key, val]) =>
                        `<option value="${key}">${val.label}</option>`
                    ).join("")}
                    <option value="custom">Другая (ввести вручную)</option>
                </select>
            </div>

            <!-- Кастомная страна (скрыто по умолчанию) -->
            <div class="chrono-row" id="chrono_custom_country_row" style="display:none;">
                <label for="chrono_custom_country">✏️ Название страны (англ.):</label>
                <input type="text" id="chrono_custom_country" class="text_pole"
                       placeholder="например: Ottoman Empire" />
            </div>

            <!-- Выбор года -->
            <div class="chrono-row">
                <label for="chrono_year">📅 Год:</label>
                <div class="chrono-year-control">
                    <input type="range" id="chrono_year_slider" min="1800" max="2025" value="2000" />
                    <input type="number" id="chrono_year_input" class="text_pole"
                           min="1" max="2025" value="2000" style="width: 80px;" />
                </div>
            </div>

            <!-- Язык выходного пакета -->
            <div class="chrono-row">
                <label for="chrono_language">🗣️ Язык пакета:</label>
                <select id="chrono_language" class="text_pole">
                    <option value="ru">Русский</option>
                    <option value="en">English</option>
                    <option value="ja">日本語</option>
                    <option value="zh">中文</option>
                    <option value="ko">한국어</option>
                    <option value="es">Español</option>
                    <option value="fr">Français</option>
                    <option value="de">Deutsch</option>
                </select>
            </div>

            <hr class="sysHR" />

            <!-- Модули -->
            <div class="chrono-row">
                <b>⚡ Модули:</b>
            </div>
            <div class="chrono-modules-grid">
                <label class="checkbox_label">
                    <input type="checkbox" id="chrono_mod_technology" checked />
                    <span>💻 Технологии и быт</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="chrono_mod_culture" checked />
                    <span>🎬 Культура и медиа</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="chrono_mod_politics" checked />
                    <span>🏛️ Политический фон</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="chrono_mod_economy" checked />
                    <span>💰 Экономика и цены</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="chrono_mod_daily_life" checked />
                    <span>🏠 Повседневная жизнь</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="chrono_mod_slang" checked />
                    <span>🗣️ Сленг и речь эпохи</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="chrono_mod_anachronisms" checked />
                    <span>🚫 Запрет анахронизмов</span>
                </label>
                <label class="checkbox_label">
                    <input type="checkbox" id="chrono_mod_news" />
                    <span>📰 Новостной фон</span>
                </label>
            </div>

            <hr class="sysHR" />

            <!-- Кнопки действий -->
            <div class="chrono-row chrono-buttons">
                <button id="chrono_generate_btn" class="menu_button">
                    🔍 Найти и сгенерировать пакет
                </button>
                <button id="chrono_preview_btn" class="menu_button" disabled>
                    👁️ Превью пакета
                </button>
                <button id="chrono_clear_btn" class="menu_button">
                    🗑️ Очистить кэш
                </button>
            </div>

            <!-- Статус -->
            <div class="chrono-row">
                <div id="chrono_status" class="chrono-status">
                    Статус: не активен
                </div>
            </div>

            <!-- Превью (скрыто по умолчанию) -->
            <div id="chrono_preview_area" style="display:none;">
                <hr class="sysHR" />
                <div class="chrono-row">
                    <b>📜 Текущий пакет:</b>
                </div>
                <textarea id="chrono_preview_text" class="text_pole"
                          rows="12" readonly
                          style="font-size: 0.85em; opacity: 0.9;"></textarea>
                <div class="chrono-row" style="margin-top: 5px;">
                    <button id="chrono_edit_btn" class="menu_button">
                        ✏️ Редактировать вручную
                    </button>
                    <button id="chrono_save_edit_btn" class="menu_button" style="display:none;">
                        💾 Сохранить правки
                    </button>
                </div>
            </div>

        </div>
    </div>
</div>
`;


// ═══════════════════════════════════════
//  УТИЛИТЫ
// ═══════════════════════════════════════

/**
 * Генерирует ключ кэша для комбинации страна+год+язык
 */
function getCacheKey(countryWikiName, year, lang) {
    const normalized = countryWikiName.toLowerCase().replace(/\s+/g, "_");
    return `${normalized}_${year}_${lang}`;
}

/**
 * Обновляет текст статуса в UI
 */
function setStatus(text, isError = false) {
    const $status = $("#chrono_status");
    $status.text(`Статус: ${text}`);
    $status.css("color", isError ? "#ff6b6b" : "#a0a0a0");
}

/**
 * Получает wiki-название страны из текущих настроек
 */
function getCountryWikiName() {
    const settings = extension_settings[EXT_NAME];
    if (settings.country_key === "custom") {
        return settings.custom_country.trim();
    }
    const preset = COUNTRY_PRESETS[settings.country_key];
    return preset ? preset.wiki_name : "";
}

/**
 * Получает читаемое название страны для промптов
 */
function getCountryDisplayName() {
    const settings = extension_settings[EXT_NAME];
    if (settings.country_key === "custom") {
        return settings.custom_country.trim();
    }
    const preset = COUNTRY_PRESETS[settings.country_key];
    return preset ? preset.label : "";
}


// ═══════════════════════════════════════
//  WIKIPEDIA API
// ═══════════════════════════════════════

/**
 * Поиск статей в Wikipedia по запросу.
 * Возвращает массив заголовков найденных статей.
 */
async function wikiSearch(query, limit = 5) {
    const params = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: query,
        srlimit: limit.toString(),
        format: "json",
        origin: "*",
    });

    try {
        const response = await fetch(`${WIKI_API_BASE}?${params}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        return (data.query?.search || []).map(item => item.title);
    } catch (err) {
        console.error(`[ChronoContext] Ошибка поиска Wikipedia: ${err.message}`);
        return [];
    }
}

/**
 * Получает текстовое содержимое статьи Wikipedia (plain text).
 * Берёт первые maxChars символов, чтобы не перегрузить контекст.
 */
async function wikiGetArticleText(title, maxChars = 6000) {
    const params = new URLSearchParams({
        action: "query",
        titles: title,
        prop: "extracts",
        explaintext: "true",
        exintro: "false",
        format: "json",
        origin: "*",
    });

    try {
        const response = await fetch(`${WIKI_API_BASE}?${params}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const pages = data.query?.pages || {};
        const pageId = Object.keys(pages)[0];

        // Если страница не найдена, Wikipedia возвращает id "-1"
        if (pageId === "-1" || !pages[pageId]?.extract) {
            return null;
        }

        let text = pages[pageId].extract;

        // Обрезаем до maxChars, но по границе предложения
        if (text.length > maxChars) {
            text = text.substring(0, maxChars);
            const lastPeriod = text.lastIndexOf(".");
            if (lastPeriod > maxChars * 0.7) {
                text = text.substring(0, lastPeriod + 1);
            }
        }

        return text;
    } catch (err) {
        console.error(`[ChronoContext] Ошибка получения статьи "${title}": ${err.message}`);
        return null;
    }
}

/**
 * Получает краткое описание статьи Wikipedia (summary).
 */
async function wikiGetSummary(title) {
    try {
        const encoded = encodeURIComponent(title);
        const response = await fetch(`${WIKI_REST_BASE}/page/summary/${encoded}`);
        if (!response.ok) return null;
        const data = await response.json();
        return data.extract || null;
    } catch (err) {
        console.error(`[ChronoContext] Ошибка получения summary "${title}": ${err.message}`);
        return null;
    }
}

/**
 * Формирует список поисковых запросов для заданной страны и года.
 * Wikipedia имеет статьи вида "2016 in Russia", "Culture of Russia" и т.д.
 */
function buildSearchQueries(countryWikiName, year) {
    const decade = Math.floor(year / 10) * 10;
    const queries = [];

    // Основная статья года
    queries.push(`${year} in ${countryWikiName}`);
    queries.push(`${countryWikiName} in ${year}`);

    // Статья десятилетия (для общего контекста)
    queries.push(`${decade}s in ${countryWikiName}`);

    // Тематические статьи
    queries.push(`Culture of ${countryWikiName}`);
    queries.push(`Economy of ${countryWikiName}`);
    queries.push(`${countryWikiName} technology`);
    queries.push(`History of ${countryWikiName} (${decade}s)`);
    queries.push(`Media of ${countryWikiName}`);

    return queries;
}

/**
 * Главная функция сбора данных из Wikipedia.
 * Возвращает объект с собранными текстами по категориям.
 */
async function gatherWikipediaData(countryWikiName, year) {
    setStatus("🔍 Поиск в Wikipedia...");
    const queries = buildSearchQueries(countryWikiName, year);
    const collectedTexts = {};
    const processedTitles = new Set(); // Чтобы не дублировать статьи

    for (const query of queries) {
        // Сначала пробуем получить статью напрямую по заголовку
        const directText = await wikiGetArticleText(query, 5000);
        if (directText && directText.length > 200) {
            collectedTexts[query] = directText;
            processedTitles.add(query);
            setStatus(`📄 Найдена статья: ${query}`);
            continue;
        }

        // Если прямого совпадения нет, ищем через search API
        const searchResults = await wikiSearch(query, 3);
        for (const title of searchResults) {
            if (processedTitles.has(title)) continue;

            const text = await wikiGetArticleText(title, 4000);
            if (text && text.length > 200) {
                collectedTexts[title] = text;
                processedTitles.add(title);
                setStatus(`📄 Найдена статья: ${title}`);
                break; // Берём только первый релевантный результат по каждому запросу
            }
        }

        // Небольшая пауза между запросами, чтобы не нагружать API
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    return collectedTexts;
}


// ═══════════════════════════════════════
//  ГЕНЕРАЦИЯ ПАКЕТА ЧЕРЕЗ AI
// ═══════════════════════════════════════

/**
 * Формирует промпт для AI, который обработает сырые данные
 * из Wikipedia и создаст структурированный "пакет эпохи".
 */
function buildProcessingPrompt(countryDisplay, countryWikiName, year, collectedTexts, modules, outputLang) {
    // Склеиваем все собранные тексты
    let rawDataBlock = "";
    for (const [title, text] of Object.entries(collectedTexts)) {
        rawDataBlock += `\n--- ARTICLE: ${title} ---\n${text}\n`;
    }

    // Если текстов слишком много, обрезаем
    if (rawDataBlock.length > 25000) {
        rawDataBlock = rawDataBlock.substring(0, 25000) + "\n[...truncated]";
    }

    // Определяем язык для промпта
    const langInstructions = {
        ru: "Ответ ПОЛНОСТЬЮ на русском языке.",
        en: "Respond ENTIRELY in English.",
        ja: "回答は全て日本語で。",
        zh: "请全部用中文回答。",
        ko: "전부 한국어로 답변하세요.",
        es: "Responde COMPLETAMENTE en español.",
        fr: "Répondez ENTIÈREMENT en français.",
        de: "Antworte KOMPLETT auf Deutsch.",
    };

    // Собираем список активных модулей
    const moduleInstructions = [];
    if (modules.technology)   moduleInstructions.push("TECHNOLOGY & DAILY LIFE: What devices, vehicles, appliances exist? What internet/phones look like? What brands are popular? What does NOT exist yet?");
    if (modules.culture)      moduleInstructions.push("CULTURE & MEDIA: Popular movies, TV shows, music, books, video games of this specific year. Fashion trends. Social media platforms that exist (and which DON'T).");
    if (modules.politics)     moduleInstructions.push("POLITICAL BACKGROUND: Major political events, wars, elections, scandals. NOT a history lecture, but what ordinary people talk about and worry about.");
    if (modules.economy)      moduleInstructions.push("ECONOMY & PRICES: Average salary, cost of living, popular stores/restaurants, economic mood (crisis? boom? stagnation?).");
    if (modules.daily_life)   moduleInstructions.push("EVERYDAY LIFE: How people commute, shop, eat, date, entertain themselves. Typical apartment/house. Typical workday.");
    if (modules.slang)        moduleInstructions.push("SLANG & SPEECH PATTERNS: Era-specific slang, popular expressions, catchphrases, internet slang of the time. How different age groups speak.");
    if (modules.anachronisms) moduleInstructions.push("ANACHRONISM BLACKLIST: A strict list of things that DO NOT EXIST YET in this year and MUST NEVER be mentioned. Future technologies, events, cultural phenomena. Format as a bullet list.");
    if (modules.news_background) moduleInstructions.push("NEWS BACKGROUND: What specific events are in the news RIGHT NOW in this year? What are people discussing at dinner tables and water coolers?");

    const prompt = `You are a historical research assistant. You have been given raw Wikipedia data about ${countryWikiName} around the year ${year}.

Your task: Create a structured, concise CONTEXT PACKAGE for a roleplay set in ${countryDisplay} in ${year}.

This package will be injected into an AI's system prompt to ensure historically accurate roleplay. It must be practical and specific, not academic.

RAW RESEARCH DATA:
${rawDataBlock}

REQUIRED SECTIONS (only include sections that were requested):
${moduleInstructions.map((m, i) => `${i + 1}. ${m}`).join("\n")}

RULES:
- Be SPECIFIC: name exact brands, exact prices, exact shows, exact devices. No vague statements.
- Be CONCISE: this goes into a context window. No essays. Use bullet points.
- Focus on what a CHARACTER LIVING IN THIS TIME would experience day-to-day.
- The ANACHRONISM BLACKLIST is critical: list specific technologies, apps, events, and cultural items that DO NOT EXIST in ${year}.
- If the raw data is insufficient for some section, use your general knowledge to fill gaps, but stay historically accurate.
- ${langInstructions[outputLang] || langInstructions.en}
- Format the entire output as a clean, readable injection block starting with "## ChronoContext: ${countryDisplay}, ${year}" header.
- Keep total length under 2000 words.`;

    return prompt;
}

/**
 * Генерирует пакет эпохи: собирает данные из Wikipedia,
 * обрабатывает через AI, сохраняет результат.
 */
async function generatePackage() {
    const settings = extension_settings[EXT_NAME];
    const countryWikiName = getCountryWikiName();
    const countryDisplay = getCountryDisplayName();
    const year = settings.year;
    const lang = settings.output_language;

    if (!countryWikiName) {
        setStatus("❌ Введите название страны!", true);
        return;
    }

    // Проверяем кэш
    const cacheKey = getCacheKey(countryWikiName, year, lang);
    if (settings.cache[cacheKey]) {
        const cached = settings.cache[cacheKey];
        const ageHours = (Date.now() - cached.timestamp) / (1000 * 60 * 60);

        // Кэш валиден 72 часа
        if (ageHours < 72) {
            settings.active_package = cached.package;
            applyPackageInjection();
            setStatus(`✅ Загружено из кэша (${countryDisplay}, ${year})`);
            showPreview();
            saveSettingsDebounced();
            return;
        }
    }

    // Блокируем кнопку на время генерации
    $("#chrono_generate_btn").prop("disabled", true).text("⏳ Генерация...");

    try {
        // Шаг 1: Собираем данные из Wikipedia
        const collectedTexts = await gatherWikipediaData(countryWikiName, year);

        if (Object.keys(collectedTexts).length === 0) {
            setStatus(`⚠️ Wikipedia не нашла данных для "${countryWikiName} ${year}". Генерируем на основе знаний AI...`);
        } else {
            setStatus(`📊 Найдено ${Object.keys(collectedTexts).length} статей. Обрабатываю через AI...`);
        }

        // Шаг 2: Формируем промпт для AI
        const processingPrompt = buildProcessingPrompt(
            countryDisplay,
            countryWikiName,
            year,
            collectedTexts,
            settings.modules,
            lang
        );

        // Шаг 3: Отправляем AI через generateQuietPrompt
        setStatus("🧠 AI обрабатывает данные...");
        const aiResponse = await generateQuietPrompt(processingPrompt, false);

        if (!aiResponse || aiResponse.trim().length < 100) {
            throw new Error("AI вернул пустой или слишком короткий ответ.");
        }

        // Шаг 4: Сохраняем результат
        settings.active_package = aiResponse.trim();
        settings.cache[cacheKey] = {
            package: settings.active_package,
            timestamp: Date.now(),
        };

        // Шаг 5: Применяем инжекцию
        applyPackageInjection();

        setStatus(`✅ Пакет сгенерирован: ${countryDisplay}, ${year}`);
        showPreview();
        saveSettingsDebounced();

    } catch (err) {
        console.error(`[ChronoContext] Ошибка генерации:`, err);
        setStatus(`❌ Ошибка: ${err.message}`, true);
    } finally {
        $("#chrono_generate_btn").prop("disabled", false).text("🔍 Найти и сгенерировать пакет");
    }
}


// ═══════════════════════════════════════
//  ИНЖЕКЦИЯ В КОНТЕКСТ
// ═══════════════════════════════════════

/**
 * Применяет (или снимает) инжекцию пакета в промпт AI.
 */
function applyPackageInjection() {
    const settings = extension_settings[EXT_NAME];

    if (!settings.enabled || !settings.active_package) {
        // Снимаем инжекцию (пустая строка)
        setExtensionPrompt(EXT_NAME, "", settings.injection_position, settings.injection_depth);
        return;
    }

    // Оборачиваем пакет в XML-тег для наглядности в промпте
    const injectionText = `<chrono_context_package>
[SYSTEM NOTE: The following historical context package is ACTIVE. All characters, events, and descriptions MUST conform to this time period. Any anachronism is a critical error.]

${settings.active_package}

[END OF HISTORICAL CONTEXT. Proceed with roleplay within these constraints.]
</chrono_context_package>`;

    setExtensionPrompt(
        EXT_NAME,
        injectionText,
        settings.injection_position,
        settings.injection_depth
    );
}

/**
 * Полностью отключает инжекцию и очищает активный пакет.
 */
function disableInjection() {
    setExtensionPrompt(EXT_NAME, "", 1, 4);
}


// ═══════════════════════════════════════
//  ПРЕВЬЮ
// ═══════════════════════════════════════

/**
 * Показывает текущий пакет в области превью.
 */
function showPreview() {
    const settings = extension_settings[EXT_NAME];

    if (!settings.active_package) {
        $("#chrono_preview_area").hide();
        $("#chrono_preview_btn").prop("disabled", true);
        return;
    }

    $("#chrono_preview_text").val(settings.active_package);
    $("#chrono_preview_area").show();
    $("#chrono_preview_btn").prop("disabled", false);
}

/**
 * Переключает видимость превью.
 */
function togglePreview() {
    const $area = $("#chrono_preview_area");
    if ($area.is(":visible")) {
        $area.hide();
    } else {
        showPreview();
    }
}


// ═══════════════════════════════════════
//  ОБРАБОТЧИКИ UI
// ═══════════════════════════════════════

/**
 * Привязывает все обработчики событий к элементам UI.
 */
function bindUIEvents() {
    const settings = extension_settings[EXT_NAME];

    // Чекбокс включения
    $("#chrono_enabled").on("change", function () {
        settings.enabled = $(this).prop("checked");
        if (settings.enabled && settings.active_package) {
            applyPackageInjection();
            setStatus(`✅ Инжекция активна`);
        } else {
            disableInjection();
            setStatus(settings.active_package ? "⏸️ Инжекция отключена" : "Не активен");
        }
        saveSettingsDebounced();
    });

    // Выбор страны
    $("#chrono_country").on("change", function () {
        settings.country_key = $(this).val();
        const isCustom = settings.country_key === "custom";
        $("#chrono_custom_country_row").toggle(isCustom);
        saveSettingsDebounced();
    });

    // Кастомная страна
    $("#chrono_custom_country").on("input", function () {
        settings.custom_country = $(this).val();
        saveSettingsDebounced();
    });

    // Слайдер года
    $("#chrono_year_slider").on("input", function () {
        const val = parseInt($(this).val());
        settings.year = val;
        $("#chrono_year_input").val(val);
        saveSettingsDebounced();
    });

    // Числовое поле года
    $("#chrono_year_input").on("change", function () {
        let val = parseInt($(this).val());
        val = Math.max(1, Math.min(2025, val || 2000));
        settings.year = val;
        $(this).val(val);
        $("#chrono_year_slider").val(Math.max(1800, Math.min(2025, val)));
        saveSettingsDebounced();
    });

    // Язык пакета
    $("#chrono_language").on("change", function () {
        settings.output_language = $(this).val();
        saveSettingsDebounced();
    });

    // Чекбоксы модулей
    const moduleMap = {
        chrono_mod_technology: "technology",
        chrono_mod_culture: "culture",
        chrono_mod_politics: "politics",
        chrono_mod_economy: "economy",
        chrono_mod_daily_life: "daily_life",
        chrono_mod_slang: "slang",
        chrono_mod_anachronisms: "anachronisms",
        chrono_mod_news: "news_background",
    };

    for (const [elemId, moduleKey] of Object.entries(moduleMap)) {
        $(`#${elemId}`).on("change", function () {
            settings.modules[moduleKey] = $(this).prop("checked");
            saveSettingsDebounced();
        });
    }

    // Кнопка генерации
    $("#chrono_generate_btn").on("click", () => {
        generatePackage();
    });

    // Кнопка превью
    $("#chrono_preview_btn").on("click", () => {
        togglePreview();
    });

    // Кнопка очистки кэша
    $("#chrono_clear_btn").on("click", () => {
        settings.cache = {};
        settings.active_package = "";
        disableInjection();
        $("#chrono_preview_area").hide();
        $("#chrono_preview_btn").prop("disabled", true);
        setStatus("🗑️ Кэш очищен");
        saveSettingsDebounced();
    });

    // Кнопка редактирования пакета
    $("#chrono_edit_btn").on("click", function () {
        const $textarea = $("#chrono_preview_text");
        const isReadonly = $textarea.prop("readonly");

        if (isReadonly) {
            $textarea.prop("readonly", false).css("opacity", "1");
            $(this).text("✏️ Отменить");
            $("#chrono_save_edit_btn").show();
        } else {
            $textarea.prop("readonly", true).css("opacity", "0.9");
            $textarea.val(settings.active_package); // Откатываем изменения
            $(this).text("✏️ Редактировать вручную");
            $("#chrono_save_edit_btn").hide();
        }
    });

    // Кнопка сохранения ручных правок
    $("#chrono_save_edit_btn").on("click", function () {
        const editedText = $("#chrono_preview_text").val().trim();
        if (editedText) {
            settings.active_package = editedText;

            // Обновляем кэш
            const cacheKey = getCacheKey(getCountryWikiName(), settings.year, settings.output_language);
            settings.cache[cacheKey] = {
                package: editedText,
                timestamp: Date.now(),
            };

            applyPackageInjection();
            setStatus("💾 Ручные правки сохранены и применены");
            saveSettingsDebounced();
        }

        // Возвращаем readonly
        $("#chrono_preview_text").prop("readonly", true).css("opacity", "0.9");
        $("#chrono_edit_btn").text("✏️ Редактировать вручную");
        $(this).hide();
    });
}

/**
 * Загружает сохранённые настройки в UI элементы.
 */
function loadSettingsToUI() {
    const settings = extension_settings[EXT_NAME];

    $("#chrono_enabled").prop("checked", settings.enabled);
    $("#chrono_country").val(settings.country_key);
    $("#chrono_custom_country").val(settings.custom_country);
    $("#chrono_custom_country_row").toggle(settings.country_key === "custom");
    $("#chrono_year_slider").val(Math.max(1800, Math.min(2025, settings.year)));
    $("#chrono_year_input").val(settings.year);
    $("#chrono_language").val(settings.output_language);

    // Модули
    $("#chrono_mod_technology").prop("checked", settings.modules.technology);
    $("#chrono_mod_culture").prop("checked", settings.modules.culture);
    $("#chrono_mod_politics").prop("checked", settings.modules.politics);
    $("#chrono_mod_economy").prop("checked", settings.modules.economy);
    $("#chrono_mod_daily_life").prop("checked", settings.modules.daily_life);
    $("#chrono_mod_slang").prop("checked", settings.modules.slang);
    $("#chrono_mod_anachronisms").prop("checked", settings.modules.anachronisms);
    $("#chrono_mod_news").prop("checked", settings.modules.news_background);

    // Если есть активный пакет, показываем превью
    if (settings.active_package) {
        showPreview();
        if (settings.enabled) {
            applyPackageInjection();
            const countryDisplay = getCountryDisplayName();
            setStatus(`✅ Активен: ${countryDisplay}, ${settings.year}`);
        }
    }
}


// ═══════════════════════════════════════
//  ИНИЦИАЛИЗАЦИЯ
// ═══════════════════════════════════════

jQuery(async () => {
    // Пробуем несколько контейнеров
    const possibleContainers = [
        "#extensions_settings",
        "#extensions_settings2",
        "#translation_container",
    ];

    let settingsContainer = null;
    for (const selector of possibleContainers) {
        const $el = $(selector);
        if ($el.length > 0) {
            settingsContainer = $el;
            console.log(`[ChronoContext] Контейнер найден: ${selector}`);
            break;
        }
    }

    if (!settingsContainer) {
        console.error("[ChronoContext] Не найден контейнер для настроек!");
        return;
    }

    settingsContainer.append(SETTINGS_HTML);


    // Инициализируем настройки расширения (мерж с дефолтами)
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = {};
    }

    // Глубокий мерж: заполняем отсутствующие поля дефолтами
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[EXT_NAME][key] === undefined) {
            if (typeof value === "object" && value !== null && !Array.isArray(value)) {
                extension_settings[EXT_NAME][key] = { ...value };
            } else {
                extension_settings[EXT_NAME][key] = value;
            }
        }
    }

    // Мерж вложенных объектов (modules)
    if (extension_settings[EXT_NAME].modules) {
        for (const [key, value] of Object.entries(DEFAULT_SETTINGS.modules)) {
            if (extension_settings[EXT_NAME].modules[key] === undefined) {
                extension_settings[EXT_NAME].modules[key] = value;
            }
        }
    }

    // Загружаем настройки в UI
    loadSettingsToUI();

    // Привязываем обработчики
    bindUIEvents();

    // Подписываемся на событие смены чата, чтобы переприменить инжекцию
    eventSource.on(event_types.CHAT_CHANGED, () => {
        const settings = extension_settings[EXT_NAME];
        if (settings.enabled && settings.active_package) {
            applyPackageInjection();
        }
    });

    console.log(`[ChronoContext] 🕰️ Расширение загружено!`);
});
