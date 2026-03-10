/**
 * ChronoContext - SillyTavern Extension
 * Историческая контекстуализация RP
 * Автор: Haru & Bunny
 *
 * Ищет информацию о стране и годе в Wikipedia,
 * обрабатывает через AI, инжектит в контекст RP.
 */

// =============================================
//  ИМПОРТЫ - ТОЛЬКО ГАРАНТИРОВАННЫЕ ЭКСПОРТЫ
// =============================================
//
//  НЕ импортируем напрямую:
//    - setExtensionPrompt (получаем через getContext)
//    - saveMetadataDebounced (не нужен)
//    - generateQuietPrompt (получаем через window)
//
//  Эти три символа НЕ ЭКСПОРТИРУЮТСЯ стабильно
//  во всех версиях ST и ломают загрузку модуля.
//

import {
    extension_settings,
    getContext,
} from "../../../extensions.js";

import {
    saveSettingsDebounced,
    eventSource,
    event_types,
} from "../../../../script.js";


// =============================================
//  БЕЗОПАСНЫЕ ОБЁРТКИ
// =============================================

/**
 * Безопасный вызов setExtensionPrompt.
 * Пробует: getContext() -> window -> динамический импорт.
 */
function safeSetExtensionPrompt(name, value, position, depth) {
    // Способ 1: через getContext()
    try {
        const ctx = getContext();
        if (ctx && typeof ctx.setExtensionPrompt === "function") {
            ctx.setExtensionPrompt(name, value, position, depth);
            return true;
        }
    } catch (e) {
        // тихо
    }

    // Способ 2: глобальная функция
    if (typeof window.SillyTavern !== "undefined") {
        try {
            const fn = window.SillyTavern?.getContext?.()?.setExtensionPrompt;
            if (typeof fn === "function") {
                fn(name, value, position, depth);
                return true;
            }
        } catch (e) {
            // тихо
        }
    }

    console.warn("[ChronoContext] setExtensionPrompt недоступен ни через один источник");
    return false;
}

/**
 * Безопасный вызов generateQuietPrompt.
 * Пробует: window -> getContext() -> динамический импорт.
 */
async function safeGenerateQuietPrompt(prompt) {
    // Способ 1: глобальная функция (ST часто кладёт её в window)
    if (typeof window.generateQuietPrompt === "function") {
        return await window.generateQuietPrompt(prompt, false);
    }

    // Способ 2: через SillyTavern.getContext
    if (typeof window.SillyTavern !== "undefined") {
        try {
            const ctx = window.SillyTavern.getContext();
            if (ctx && typeof ctx.generateQuietPrompt === "function") {
                return await ctx.generateQuietPrompt(prompt, false);
            }
        } catch (e) {
            // тихо
        }
    }

    // Способ 3: через getContext из импорта
    try {
        const ctx = getContext();
        if (ctx && typeof ctx.generateQuietPrompt === "function") {
            return await ctx.generateQuietPrompt(prompt, false);
        }
    } catch (e) {
        // тихо
    }

    // Способ 4: динамический импорт
    try {
        const mod = await import("../../../../script.js");
        if (typeof mod.generateQuietPrompt === "function") {
            return await mod.generateQuietPrompt(prompt, false);
        }
    } catch (e) {
        // тихо
    }

    throw new Error(
        "generateQuietPrompt недоступен. Убедись, что SillyTavern версии 1.11+ и подключена модель AI."
    );
}


// =============================================
//  КОНСТАНТЫ
// =============================================

const EXT_NAME = "chrono-context";

const INJECTION_POSITION = {
    AFTER_SYSTEM: 1,
    IN_CHAT: 2,
};

const WIKI_API_BASE = "https://en.wikipedia.org/w/api.php";
const WIKI_REST_BASE = "https://en.wikipedia.org/api/rest_v1";

const COUNTRY_PRESETS = {
    russia:      { label: "Россия",         wiki_name: "Russia" },
    ussr:        { label: "СССР",           wiki_name: "Soviet Union" },
    usa:         { label: "США",            wiki_name: "United States" },
    uk:          { label: "Великобритания", wiki_name: "United Kingdom" },
    japan:       { label: "Япония",         wiki_name: "Japan" },
    germany:     { label: "Германия",       wiki_name: "Germany" },
    france:      { label: "Франция",        wiki_name: "France" },
    china:       { label: "Китай",          wiki_name: "China" },
    south_korea: { label: "Южная Корея",    wiki_name: "South Korea" },
    italy:       { label: "Италия",         wiki_name: "Italy" },
    brazil:      { label: "Бразилия",       wiki_name: "Brazil" },
    spain:       { label: "Испания",        wiki_name: "Spain" },
    canada:      { label: "Канада",         wiki_name: "Canada" },
    australia:   { label: "Австралия",      wiki_name: "Australia" },
    india:       { label: "Индия",          wiki_name: "India" },
    mexico:      { label: "Мексика",        wiki_name: "Mexico" },
    turkey:      { label: "Турция",         wiki_name: "Turkey" },
    poland:      { label: "Польша",         wiki_name: "Poland" },
    ukraine:     { label: "Украина",        wiki_name: "Ukraine" },
};

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
    cache: {},
    active_package: "",
};


// =============================================
//  HTML ШАБЛОН
// =============================================

function buildSettingsHTML() {
    const countryOptions = Object.entries(COUNTRY_PRESETS)
        .map(([key, val]) => '<option value="' + key + '">' + val.label + '</option>')
        .join("");

    return '<div id="chrono-context-settings">'
        + '<div class="inline-drawer">'
        + '<div class="inline-drawer-toggle inline-drawer-header">'
        + '<b>ChronoContext</b>'
        + '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>'
        + '</div>'
        + '<div class="inline-drawer-content">'

        // Вкл/Выкл
        + '<div class="chrono-row">'
        + '<label class="checkbox_label" for="chrono_enabled">'
        + '<input type="checkbox" id="chrono_enabled" />'
        + '<span>Включить инжекцию в контекст</span>'
        + '</label>'
        + '</div>'

        + '<hr class="sysHR" />'

        // Страна
        + '<div class="chrono-row">'
        + '<label for="chrono_country">Страна:</label>'
        + '<select id="chrono_country" class="text_pole">'
        + countryOptions
        + '<option value="custom">Другая (ввести вручную)</option>'
        + '</select>'
        + '</div>'

        // Кастомная страна
        + '<div class="chrono-row" id="chrono_custom_country_row" style="display:none;">'
        + '<label for="chrono_custom_country">Название страны (англ.):</label>'
        + '<input type="text" id="chrono_custom_country" class="text_pole" placeholder="например: Ottoman Empire" />'
        + '</div>'

        // Год
        + '<div class="chrono-row">'
        + '<label for="chrono_year">Год:</label>'
        + '<div class="chrono-year-control">'
        + '<input type="range" id="chrono_year_slider" min="1800" max="2025" value="2000" />'
        + '<input type="number" id="chrono_year_input" class="text_pole" min="1" max="2025" value="2000" style="width:80px;" />'
        + '</div>'
        + '</div>'

        // Язык
        + '<div class="chrono-row">'
        + '<label for="chrono_language">Язык пакета:</label>'
        + '<select id="chrono_language" class="text_pole">'
        + '<option value="ru">Русский</option>'
        + '<option value="en">English</option>'
        + '<option value="ja">日本語</option>'
        + '<option value="zh">中文</option>'
        + '<option value="ko">한국어</option>'
        + '<option value="es">Español</option>'
        + '<option value="fr">Français</option>'
        + '<option value="de">Deutsch</option>'
        + '</select>'
        + '</div>'

        + '<hr class="sysHR" />'

        // Модули
        + '<div class="chrono-row"><b>Модули:</b></div>'
        + '<div class="chrono-modules-grid">'
        + '<label class="checkbox_label"><input type="checkbox" id="chrono_mod_technology" checked /><span>Технологии и быт</span></label>'
        + '<label class="checkbox_label"><input type="checkbox" id="chrono_mod_culture" checked /><span>Культура и медиа</span></label>'
        + '<label class="checkbox_label"><input type="checkbox" id="chrono_mod_politics" checked /><span>Политический фон</span></label>'
        + '<label class="checkbox_label"><input type="checkbox" id="chrono_mod_economy" checked /><span>Экономика и цены</span></label>'
        + '<label class="checkbox_label"><input type="checkbox" id="chrono_mod_daily_life" checked /><span>Повседневная жизнь</span></label>'
        + '<label class="checkbox_label"><input type="checkbox" id="chrono_mod_slang" checked /><span>Сленг и речь эпохи</span></label>'
        + '<label class="checkbox_label"><input type="checkbox" id="chrono_mod_anachronisms" checked /><span>Запрет анахронизмов</span></label>'
        + '<label class="checkbox_label"><input type="checkbox" id="chrono_mod_news" /><span>Новостной фон</span></label>'
        + '</div>'

        + '<hr class="sysHR" />'

        // Кнопки
        + '<div class="chrono-row chrono-buttons">'
        + '<button id="chrono_generate_btn" class="menu_button">Найти и сгенерировать пакет</button>'
        + '<button id="chrono_preview_btn" class="menu_button" disabled>Превью пакета</button>'
        + '<button id="chrono_clear_btn" class="menu_button">Очистить кэш</button>'
        + '</div>'

        // Статус
        + '<div class="chrono-row">'
        + '<div id="chrono_status" class="chrono-status">Статус: не активен</div>'
        + '</div>'

        // Превью
        + '<div id="chrono_preview_area" style="display:none;">'
        + '<hr class="sysHR" />'
        + '<div class="chrono-row"><b>Текущий пакет:</b></div>'
        + '<textarea id="chrono_preview_text" class="text_pole" rows="12" readonly style="font-size:0.85em;opacity:0.9;"></textarea>'
        + '<div class="chrono-row" style="margin-top:5px;">'
        + '<button id="chrono_edit_btn" class="menu_button">Редактировать вручную</button>'
        + '<button id="chrono_save_edit_btn" class="menu_button" style="display:none;">Сохранить правки</button>'
        + '</div>'
        + '</div>'

        + '</div></div></div>';
}


// =============================================
//  УТИЛИТЫ
// =============================================

function getCacheKey(countryWikiName, year, lang) {
    return countryWikiName.toLowerCase().replace(/\s+/g, "_") + "_" + year + "_" + lang;
}

function setStatus(text, isError) {
    var $s = $("#chrono_status");
    $s.text("Статус: " + text);
    $s.css("color", isError ? "#ff6b6b" : "#a0a0a0");
}

function getCountryWikiName() {
    var s = extension_settings[EXT_NAME];
    if (s.country_key === "custom") return s.custom_country.trim();
    var p = COUNTRY_PRESETS[s.country_key];
    return p ? p.wiki_name : "";
}

function getCountryDisplayName() {
    var s = extension_settings[EXT_NAME];
    if (s.country_key === "custom") return s.custom_country.trim();
    var p = COUNTRY_PRESETS[s.country_key];
    return p ? p.label : "";
}


// =============================================
//  WIKIPEDIA API
// =============================================

async function wikiSearch(query, limit) {
    limit = limit || 5;
    var params = new URLSearchParams({
        action: "query",
        list: "search",
        srsearch: query,
        srlimit: String(limit),
        format: "json",
        origin: "*",
    });

    try {
        var resp = await fetch(WIKI_API_BASE + "?" + params);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        var data = await resp.json();
        return (data.query && data.query.search || []).map(function(item) { return item.title; });
    } catch (err) {
        console.error("[ChronoContext] Wiki search error:", err.message);
        return [];
    }
}

async function wikiGetArticleText(title, maxChars) {
    maxChars = maxChars || 6000;
    var params = new URLSearchParams({
        action: "query",
        titles: title,
        prop: "extracts",
        explaintext: "true",
        exintro: "false",
        format: "json",
        origin: "*",
    });

    try {
        var resp = await fetch(WIKI_API_BASE + "?" + params);
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        var data = await resp.json();
        var pages = (data.query && data.query.pages) || {};
        var pageId = Object.keys(pages)[0];

        if (pageId === "-1" || !pages[pageId] || !pages[pageId].extract) {
            return null;
        }

        var text = pages[pageId].extract;
        if (text.length > maxChars) {
            text = text.substring(0, maxChars);
            var lp = text.lastIndexOf(".");
            if (lp > maxChars * 0.7) {
                text = text.substring(0, lp + 1);
            }
        }
        return text;
    } catch (err) {
        console.error("[ChronoContext] Article fetch error for '" + title + "':", err.message);
        return null;
    }
}

function buildSearchQueries(countryWikiName, year) {
    var decade = Math.floor(year / 10) * 10;
    return [
        year + " in " + countryWikiName,
        countryWikiName + " in " + year,
        decade + "s in " + countryWikiName,
        "Culture of " + countryWikiName,
        "Economy of " + countryWikiName,
        countryWikiName + " technology",
        "History of " + countryWikiName + " (" + decade + "s)",
        "Media of " + countryWikiName,
    ];
}

async function gatherWikipediaData(countryWikiName, year) {
    setStatus("Поиск в Wikipedia...");
    var queries = buildSearchQueries(countryWikiName, year);
    var collected = {};
    var processed = {};

    for (var i = 0; i < queries.length; i++) {
        var query = queries[i];

        var directText = await wikiGetArticleText(query, 5000);
        if (directText && directText.length > 200) {
            collected[query] = directText;
            processed[query] = true;
            setStatus("Найдена статья: " + query);
            continue;
        }

        var results = await wikiSearch(query, 3);
        for (var j = 0; j < results.length; j++) {
            var title = results[j];
            if (processed[title]) continue;

            var text = await wikiGetArticleText(title, 4000);
            if (text && text.length > 200) {
                collected[title] = text;
                processed[title] = true;
                setStatus("Найдена статья: " + title);
                break;
            }
        }

        await new Promise(function(resolve) { setTimeout(resolve, 300); });
    }

    return collected;
}


// =============================================
//  ГЕНЕРАЦИЯ ПАКЕТА
// =============================================

function buildProcessingPrompt(countryDisplay, countryWikiName, year, collectedTexts, modules, outputLang) {
    var rawDataBlock = "";
    for (var title in collectedTexts) {
        if (collectedTexts.hasOwnProperty(title)) {
            rawDataBlock += "\n--- ARTICLE: " + title + " ---\n" + collectedTexts[title] + "\n";
        }
    }
    if (rawDataBlock.length > 25000) {
        rawDataBlock = rawDataBlock.substring(0, 25000) + "\n[...truncated]";
    }

    var langMap = {
        ru: "Ответ ПОЛНОСТЬЮ на русском языке.",
        en: "Respond ENTIRELY in English.",
        ja: "回答は全て日本語で。",
        zh: "请全部用中文回答。",
        ko: "전부 한국어로 답변하세요.",
        es: "Responde COMPLETAMENTE en español.",
        fr: "Répondez ENTIÈREMENT en français.",
        de: "Antworte KOMPLETT auf Deutsch.",
    };

    var modInstr = [];
    if (modules.technology)      modInstr.push("TECHNOLOGY & DAILY LIFE: What devices, vehicles, appliances exist? What internet/phones look like? What brands are popular? What does NOT exist yet?");
    if (modules.culture)         modInstr.push("CULTURE & MEDIA: Popular movies, TV shows, music, books, video games of this specific year. Fashion trends. Social media platforms that exist (and which DON'T).");
    if (modules.politics)        modInstr.push("POLITICAL BACKGROUND: Major political events, wars, elections, scandals. NOT a history lecture, but what ordinary people talk about.");
    if (modules.economy)         modInstr.push("ECONOMY & PRICES: Average salary, cost of living, popular stores/restaurants, economic mood.");
    if (modules.daily_life)      modInstr.push("EVERYDAY LIFE: How people commute, shop, eat, date, entertain themselves. Typical apartment/house.");
    if (modules.slang)           modInstr.push("SLANG & SPEECH PATTERNS: Era-specific slang, popular expressions, catchphrases, internet slang of the time.");
    if (modules.anachronisms)    modInstr.push("ANACHRONISM BLACKLIST: A strict list of things that DO NOT EXIST YET in this year. Format as bullet list.");
    if (modules.news_background) modInstr.push("NEWS BACKGROUND: What specific events are in the news RIGHT NOW in this year?");

    var modBlock = modInstr.map(function(m, i) { return (i + 1) + ". " + m; }).join("\n");

    return "You are a historical research assistant. You have been given raw Wikipedia data about "
        + countryWikiName + " around the year " + year + ".\n\n"
        + "Your task: Create a structured, concise CONTEXT PACKAGE for a roleplay set in "
        + countryDisplay + " in " + year + ".\n\n"
        + "This package will be injected into an AI's system prompt to ensure historically accurate roleplay. "
        + "It must be practical and specific, not academic.\n\n"
        + "RAW RESEARCH DATA:\n" + rawDataBlock + "\n\n"
        + "REQUIRED SECTIONS:\n" + modBlock + "\n\n"
        + "RULES:\n"
        + "- Be SPECIFIC: name exact brands, exact prices, exact shows, exact devices.\n"
        + "- Be CONCISE: use bullet points.\n"
        + "- Focus on what a CHARACTER LIVING IN THIS TIME would experience day-to-day.\n"
        + "- The ANACHRONISM BLACKLIST is critical.\n"
        + "- If raw data is insufficient, use your general knowledge but stay historically accurate.\n"
        + "- " + (langMap[outputLang] || langMap.en) + "\n"
        + "- Format output starting with '## ChronoContext: " + countryDisplay + ", " + year + "' header.\n"
        + "- Keep total length under 2000 words.";
}

async function generatePackage() {
    var settings = extension_settings[EXT_NAME];
    var countryWikiName = getCountryWikiName();
    var countryDisplay = getCountryDisplayName();
    var year = settings.year;
    var lang = settings.output_language;

    if (!countryWikiName) {
        setStatus("Введите название страны!", true);
        return;
    }

    var cacheKey = getCacheKey(countryWikiName, year, lang);
    if (settings.cache[cacheKey]) {
        var cached = settings.cache[cacheKey];
        var ageHours = (Date.now() - cached.timestamp) / 3600000;
        if (ageHours < 72) {
            settings.active_package = cached.package;
            applyPackageInjection();
            setStatus("Загружено из кэша (" + countryDisplay + ", " + year + ")");
            showPreview();
            saveSettingsDebounced();
            return;
        }
    }

    $("#chrono_generate_btn").prop("disabled", true).text("Генерация...");
    $("#chrono_status").addClass("chrono-status-loading");

    try {
        var collectedTexts = await gatherWikipediaData(countryWikiName, year);
        var articleCount = Object.keys(collectedTexts).length;

        if (articleCount === 0) {
            setStatus("Wikipedia не нашла данных. Генерируем на основе знаний AI...");
        } else {
            setStatus("Найдено " + articleCount + " статей. AI обрабатывает...");
        }

        var processingPrompt = buildProcessingPrompt(
            countryDisplay, countryWikiName, year,
            collectedTexts, settings.modules, lang
        );

        setStatus("AI обрабатывает данные...");
        var aiResponse = await safeGenerateQuietPrompt(processingPrompt);

        if (!aiResponse || aiResponse.trim().length < 100) {
            throw new Error("AI вернул пустой или слишком короткий ответ.");
        }

        settings.active_package = aiResponse.trim();
        settings.cache[cacheKey] = {
            package: settings.active_package,
            timestamp: Date.now(),
        };

        applyPackageInjection();
        setStatus("Пакет сгенерирован: " + countryDisplay + ", " + year);
        showPreview();
        saveSettingsDebounced();

    } catch (err) {
        console.error("[ChronoContext] Generation error:", err);
        setStatus("Ошибка: " + err.message, true);
    } finally {
        $("#chrono_generate_btn").prop("disabled", false).text("Найти и сгенерировать пакет");
        $("#chrono_status").removeClass("chrono-status-loading");
    }
}


// =============================================
//  ИНЖЕКЦИЯ В КОНТЕКСТ
// =============================================

function applyPackageInjection() {
    var settings = extension_settings[EXT_NAME];

    if (!settings.enabled || !settings.active_package) {
        safeSetExtensionPrompt(EXT_NAME, "", settings.injection_position, settings.injection_depth);
        return;
    }

    var injectionText = "<chrono_context_package>\n"
        + "[SYSTEM NOTE: The following historical context package is ACTIVE. "
        + "All characters, events, and descriptions MUST conform to this time period. "
        + "Any anachronism is a critical error.]\n\n"
        + settings.active_package + "\n\n"
        + "[END OF HISTORICAL CONTEXT. Proceed with roleplay within these constraints.]\n"
        + "</chrono_context_package>";

    safeSetExtensionPrompt(EXT_NAME, injectionText, settings.injection_position, settings.injection_depth);
}

function disableInjection() {
    safeSetExtensionPrompt(EXT_NAME, "", 1, 4);
}


// =============================================
//  ПРЕВЬЮ
// =============================================

function showPreview() {
    var settings = extension_settings[EXT_NAME];
    if (!settings.active_package) {
        $("#chrono_preview_area").hide();
        $("#chrono_preview_btn").prop("disabled", true);
        return;
    }
    $("#chrono_preview_text").val(settings.active_package);
    $("#chrono_preview_area").show();
    $("#chrono_preview_btn").prop("disabled", false);
}

function togglePreview() {
    var $area = $("#chrono_preview_area");
    if ($area.is(":visible")) {
        $area.hide();
    } else {
        showPreview();
    }
}


// =============================================
//  ОБРАБОТЧИКИ UI
// =============================================

function bindUIEvents() {
    var settings = extension_settings[EXT_NAME];

    $("#chrono_enabled").on("change", function () {
        settings.enabled = $(this).prop("checked");
        if (settings.enabled && settings.active_package) {
            applyPackageInjection();
            setStatus("Инжекция активна");
        } else {
            disableInjection();
            setStatus(settings.active_package ? "Инжекция отключена" : "Не активен");
        }
        saveSettingsDebounced();
    });

    $("#chrono_country").on("change", function () {
        settings.country_key = $(this).val();
        $("#chrono_custom_country_row").toggle(settings.country_key === "custom");
        saveSettingsDebounced();
    });

    $("#chrono_custom_country").on("input", function () {
        settings.custom_country = $(this).val();
        saveSettingsDebounced();
    });

    $("#chrono_year_slider").on("input", function () {
        var val = parseInt($(this).val());
        settings.year = val;
        $("#chrono_year_input").val(val);
        saveSettingsDebounced();
    });

    $("#chrono_year_input").on("change", function () {
        var val = parseInt($(this).val());
        val = Math.max(1, Math.min(2025, val || 2000));
        settings.year = val;
        $(this).val(val);
        $("#chrono_year_slider").val(Math.max(1800, Math.min(2025, val)));
        saveSettingsDebounced();
    });

    $("#chrono_language").on("change", function () {
        settings.output_language = $(this).val();
        saveSettingsDebounced();
    });

    var moduleMap = {
        chrono_mod_technology: "technology",
        chrono_mod_culture: "culture",
        chrono_mod_politics: "politics",
        chrono_mod_economy: "economy",
        chrono_mod_daily_life: "daily_life",
        chrono_mod_slang: "slang",
        chrono_mod_anachronisms: "anachronisms",
        chrono_mod_news: "news_background",
    };

    for (var elemId in moduleMap) {
        if (moduleMap.hasOwnProperty(elemId)) {
            (function(id, key) {
                $("#" + id).on("change", function () {
                    settings.modules[key] = $(this).prop("checked");
                    saveSettingsDebounced();
                });
            })(elemId, moduleMap[elemId]);
        }
    }

    $("#chrono_generate_btn").on("click", function () {
        generatePackage();
    });

    $("#chrono_preview_btn").on("click", function () {
        togglePreview();
    });

    $("#chrono_clear_btn").on("click", function () {
        settings.cache = {};
        settings.active_package = "";
        disableInjection();
        $("#chrono_preview_area").hide();
        $("#chrono_preview_btn").prop("disabled", true);
        setStatus("Кэш очищен");
        saveSettingsDebounced();
    });

    $("#chrono_edit_btn").on("click", function () {
        var $textarea = $("#chrono_preview_text");
        var isReadonly = $textarea.prop("readonly");

        if (isReadonly) {
            $textarea.prop("readonly", false).css("opacity", "1");
            $(this).text("Отменить");
            $("#chrono_save_edit_btn").show();
        } else {
            $textarea.prop("readonly", true).css("opacity", "0.9");
            $textarea.val(settings.active_package);
            $(this).text("Редактировать вручную");
            $("#chrono_save_edit_btn").hide();
        }
    });

    $("#chrono_save_edit_btn").on("click", function () {
        var editedText = $("#chrono_preview_text").val().trim();
        if (editedText) {
            settings.active_package = editedText;
            var ck = getCacheKey(getCountryWikiName(), settings.year, settings.output_language);
            settings.cache[ck] = { package: editedText, timestamp: Date.now() };
            applyPackageInjection();
            setStatus("Ручные правки сохранены и применены");
            saveSettingsDebounced();
        }
        $("#chrono_preview_text").prop("readonly", true).css("opacity", "0.9");
        $("#chrono_edit_btn").text("Редактировать вручную");
        $(this).hide();
    });
}

function loadSettingsToUI() {
    var settings = extension_settings[EXT_NAME];

    $("#chrono_enabled").prop("checked", settings.enabled);
    $("#chrono_country").val(settings.country_key);
    $("#chrono_custom_country").val(settings.custom_country);
    $("#chrono_custom_country_row").toggle(settings.country_key === "custom");
    $("#chrono_year_slider").val(Math.max(1800, Math.min(2025, settings.year)));
    $("#chrono_year_input").val(settings.year);
    $("#chrono_language").val(settings.output_language);

    $("#chrono_mod_technology").prop("checked", settings.modules.technology);
    $("#chrono_mod_culture").prop("checked", settings.modules.culture);
    $("#chrono_mod_politics").prop("checked", settings.modules.politics);
    $("#chrono_mod_economy").prop("checked", settings.modules.economy);
    $("#chrono_mod_daily_life").prop("checked", settings.modules.daily_life);
    $("#chrono_mod_slang").prop("checked", settings.modules.slang);
    $("#chrono_mod_anachronisms").prop("checked", settings.modules.anachronisms);
    $("#chrono_mod_news").prop("checked", settings.modules.news_background);

    if (settings.active_package) {
        showPreview();
        if (settings.enabled) {
            applyPackageInjection();
            setStatus("Активен: " + getCountryDisplayName() + ", " + settings.year);
        }
    }
}


// =============================================
//  ИНИЦИАЛИЗАЦИЯ
// =============================================

jQuery(async function () {
    console.log("[ChronoContext] Начинаю инициализацию...");

    try {
        // Ищем контейнер для UI
        var container = null;
        var selectors = [
            "#extensions_settings",
            "#extensions_settings2",
            "#translation_container",
        ];

        for (var i = 0; i < selectors.length; i++) {
            var $el = $(selectors[i]);
            if ($el.length > 0) {
                container = $el;
                console.log("[ChronoContext] Контейнер найден: " + selectors[i]);
                break;
            }
        }

        if (!container) {
            console.error("[ChronoContext] Не найден контейнер для UI! Проверьте версию ST.");
            return;
        }

        // Вставляем HTML
        container.append(buildSettingsHTML());
        console.log("[ChronoContext] HTML вставлен в DOM");

        // Инициализируем настройки
        if (!extension_settings[EXT_NAME]) {
            extension_settings[EXT_NAME] = {};
        }

        var s = extension_settings[EXT_NAME];

        // Мерж с дефолтами (первый уровень)
        for (var key in DEFAULT_SETTINGS) {
            if (DEFAULT_SETTINGS.hasOwnProperty(key) && s[key] === undefined) {
                var val = DEFAULT_SETTINGS[key];
                if (typeof val === "object" && val !== null && !Array.isArray(val)) {
                    s[key] = JSON.parse(JSON.stringify(val));
                } else {
                    s[key] = val;
                }
            }
        }

        // Мерж модулей
        if (s.modules) {
            for (var mk in DEFAULT_SETTINGS.modules) {
                if (DEFAULT_SETTINGS.modules.hasOwnProperty(mk) && s.modules[mk] === undefined) {
                    s.modules[mk] = DEFAULT_SETTINGS.modules[mk];
                }
            }
        }

        console.log("[ChronoContext] Настройки инициализированы:", JSON.stringify(s).substring(0, 200));

        // Загружаем UI
        loadSettingsToUI();
        console.log("[ChronoContext] UI загружен");

        // Привязываем обработчики
        bindUIEvents();
        console.log("[ChronoContext] Обработчики привязаны");

        // Подписка на смену чата
        if (eventSource && event_types && event_types.CHAT_CHANGED) {
            eventSource.on(event_types.CHAT_CHANGED, function () {
                var st = extension_settings[EXT_NAME];
                if (st && st.enabled && st.active_package) {
                    applyPackageInjection();
                }
            });
            console.log("[ChronoContext] Подписка на CHAT_CHANGED установлена");
        } else {
            console.warn("[ChronoContext] eventSource или event_types недоступны, подписка на CHAT_CHANGED пропущена");
        }

        console.log("[ChronoContext] Расширение полностью загружено!");

    } catch (err) {
        console.error("[ChronoContext] КРИТИЧЕСКАЯ ОШИБКА при инициализации:", err);
    }
});
