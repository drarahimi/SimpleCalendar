// Load dependencies
async function loadDependencies() {
    try {
        await loadScript('https://cdn.jsdelivr.net/npm/luxon@3/build/global/luxon.min.js');
        //await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await loadScript('https://github.com/yorickshan/html2canvas-pro/releases/download/v1.5.12/html2canvas-pro.min.js');
        //await loadScript('https://cdn.jsdelivr.net/npm/jspdf-outline/dist/jspdf-outline.min.js');
        await loadScript('https://unpkg.com/jspdf@latest/dist/jspdf.umd.js');
        if (!window.jspdf || !window.jspdf.jsPDF) {
            throw new Error('jsPDF not loaded correctly');
        }
        jsPDF = window.jspdf.jsPDF;
        // luxon available as global `luxon`
        //console.log('Dependencies loaded: jsPDF, html2canvas-pro, luxon');
    } catch (err) {
        console.error(err);
    }
}

loadDependencies();

/**
 * Global Declarations & Constants
 */
const MS_PER_MINUTE = 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

let isGeneratingPdf = false;

// --- Utility Functions ---
function loadScript(url) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('Failed to load ' + url));
        document.head.appendChild(s);
    });
}

// // Add days to a JS Date (preserve time) using Luxon in user timezone
// function addDaysJS(date, days, DateTime, originalZone, userZone) {
//     console.log(originalZone + '/' + userZone)
//     return DateTime.fromJSDate(date, { zone: originalZone }).plus({ days }).setZone(userZone).toJSDate();
// }


/**
 * SimpleCalendar Class (timezone-consistent)
 */
class SimpleCalendar {
    constructor(containerId, events, options = {}) {
        this.container = document.getElementById(containerId);

        // Options with sensible defaults
        this.options = Object.assign({
            originalTimezone: '',
            userTimezone: '',
            initialDate: '',
            initialView: 'timeGridDay',
            nowIndicator: true,
            slotMinTime: '00:00:00',
            slotMaxTime: '24:00:00',
            autoFitEvents: false,
            hourHeightpx: 60,
            nowIndicatorMode: 'anyDay',
            slotLabelFormat: 'HH:mm',
            dayNameFormat: 'ccc d',
            titleFormat: 'LLLL d, yyyy',
            titleRangeStartFormat: 'LLL d',
            titleRangeEndFormat: 'LLL d, yyyy',
            titleSameMonthYearFormat: 'LLL * yyyy',
            titleSameMontYearDatesSymbol: '*',
            timeZone: this.userTimezone,
            validRange: null,
            views: {
                Day1: { type: 'timeGrid', durationDays: 1, buttonText: '1 Day' },
                Valid: { type: 'timeGrid', durationDays: 10, buttonText: 'Full' }
            },
            headerToolbar: { left: 'prev,next', center: 'title', right: 'Day1,Day3' },
            allDaySlot: false,
            events: [],
            datesSet: null,
            eventDidMount: null,
            eventContent: null,
            pdf: {
                margin: 15,
                overlayMargin: 5,
                overlayOpacity: 0.85,
                backgroundColor: '#002781',
                fillColor: '#002781',
                backgroundUrl: '',
                logoUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/21/IEEE_logo.svg/320px-IEEE_logo.svg.png',
                maxLogoWidth: 30,
                maxLogoHeight: 30,
                longDateFormat: 'EEEE, LLLL d, yyyy (z)',
                timeLabelFormat: 'HH:mm',
                footerText: 'Conference',
                columns: [
                    { label: 'Time', key: 'timerange', width: 10 },
                    { label: 'Title', key: 'title', width: 45 },
                    { label: 'Speaker', key: 'speaker', width: 20 },
                    { label: 'Moderator', key: 'moderator', width: 15 },
                    { label: 'Room', key: 'room', width: 10 }
                ],
                cover: {
                    title: "Conference Program",
                    subtitle: "Scientific Meeting",
                    extraLines: [
                        "Hosted by the Research Community",
                        "Proudly presenting invited speakers"
                    ],
                    dates: "May 14 to May 17, 2025",
                    location: "Vancouver, Canada",
                },
                welcome: {
                    title: "Welcome Message",
                    message: "Welcome to our scientific meeting. This program gathers researchers and innovators..."
                },
                closing: {
                    title: 'Closing Remarks',
                    message: 'Thank you for joining us. We appreciate your contribution and hope to see you again at future events.'
                },
                committee: {
                    title: 'Committee',
                    message: `We would like to thank our committee members`,
                    colGap: 10,
                    columns: 3,
                    cardHeight: 35,
                    list: []
                },
                sponsors: {
                    title: 'Sponsors',
                    message: `We would like to thank our sponsors`,
                    colGap: 10,
                    columns: 3,
                    cardHeight: 35,
                    list: []
                }
            }

        }, options);
        //console.log('events in simpleCalendar:');
        //console.log(events);
        this.originalTimezone = this.options.originalTimezone || (this.DateTime ? this.DateTime.local().zoneName : Intl.DateTimeFormat().resolvedOptions().timeZone);
        this.DateTime = (typeof luxon !== 'undefined') ? luxon.DateTime : null;

        if (!this.DateTime) {
            console.warn('Luxon not found. Timezone-safe features will be degraded.');
        }

        // Load saved timezone for user
        const savedTz = localStorage.getItem("sc-user-timezone");
        if (savedTz) {
            this.options.userTimezone = savedTz;
        }

        // userTimezone fallback: provided param or detect via Intl if luxon missing
        this.userTimezone = this.options.userTimezone || (this.DateTime ? this.DateTime.local().zoneName : Intl.DateTimeFormat().resolvedOptions().timeZone);

        this.initialDate = this._parseIsoToLuxon(this.options.initialDate).dt || (this.DateTime ? this.DateTime.local().setZone(this.userTimezone) : new Date().toISOString().split('T')[0]);

        // parse valid ranges into DateTime (original zone) if provided
        this.validRange = this._parseRangeToUser(this.options.validRange);
        //console.log(this.validRange);       


        // parse initial view/date -> store currentDate as JS Date in user timezone
        this.currentView = this.options.initialView || 'Day1';
        this.currentDate = this.initialDate;
        //console.log(this.currentDate);
        // slot times (minutes)
        this.slotMinMinutes = this._timeStringToMinutes(this.options.slotMinTime);
        //console.log(this.slotMinMinutes)
        this.slotMaxMinutes = this._timeStringToMinutes(this.options.slotMaxTime);
        //console.log(this.slotMaxMinutes)
        if (this.slotMaxMinutes <= this.slotMinMinutes) this.slotMaxMinutes = this.slotMinMinutes + 24 * 60;
        this.autoFitEvents = this.options.autoFitEvents;

        // Now indicator ('anyDay' or 'currentDay')
        this.nowIndicatorMode = this.options.nowIndicator;
        // visual sizes
        this.hourHeightPx = this.options.hourHeightpx; // px per hour by default
        this.visibleMinutes = this.slotMaxMinutes - this.slotMinMinutes;
        this.DAY_HEIGHT_PX = (this.visibleMinutes / 60) * this.hourHeightPx;

        // events (rawEvents keep original input; events hold converted items for rendering)
        this.rawEvents = events || this.options.events || [];
        this.events = this._convertEventsToUserZone(this.rawEvents);

        // set Valid duration based on validrange and events
        // original full duration
        let duration = this.validRange.end.diff(this.validRange.start, 'days').days;

        // find latest event within the valid range
        let lastEventEnd = null;
        this.events.forEach(ev => {
            //console.log(ev)
            //console.log(ev.startDate > this.validRange.start && ev.endDate < this.validRange.end)
            if (ev.startDate > this.validRange.start && ev.endDate < this.validRange.end) {
                if (!lastEventEnd || ev.endDate > lastEventEnd) {
                    lastEventEnd = ev.endDate;
                }
            }
        });
        if (lastEventEnd) {
            // duration from start to last event's end
            duration = Math.ceil(lastEventEnd.diff(this.validRange.start, 'days').days);
        }
        this.options.views['Valid'].durationDays = duration;

        // jsPDF and html2canvas will be bound at runtime if present
        this.jsPDF = (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : null;
        this.html2canvas = (typeof window !== 'undefined' && window.html2canvas) ? window.html2canvas : null;

        this.isGeneratingPdf = false;
        this._resetting = false;

        this.init();
    }

    // ---- Helper / parsing ----

    _parseIsoToLuxon(isoString) {
        if (!isoString) return null;

        const dt = this.DateTime.fromISO(isoString, { zone: this.originalTimezone }).setZone(this.userTimezone);

        return {
            dt,
            start: dt.startOf('day'),
            end: dt.endOf('day')
        };
    }
    // Format a Luxon Date (assumed in userTimezone) to YYYY-MM-DD (user zone)
    _luxonToIso(date) {
        if (!date) return '';
        return date.toFormat('yyyy-MM-dd');
    }

    _normalizeIsoString(isoString, isStart) {
        if (!isoString) return null;
        // Add time if missing
        if (!isoString.includes('T')) {
            isoString = isStart ? `${isoString}T00:00:00` : `${isoString}T23:59:59.999`;
        }
        return isoString;
    }

    // Parse visible/valid range into objects with DateTime in original timezone
    _parseRangeToUser(range) {
        if (!range) return null;
        const out = {};
        if (range.start) {
            out.start = this._parseIsoToLuxon(this._normalizeIsoString(range.start, true)).start;
        } else {
            out.start = null;
        }
        if (range.end) {
            out.end = this._parseIsoToLuxon(this._normalizeIsoString(range.end, false)).end;
        } else {
            out.end = null;
        }
        // console.log(range.start)
        // console.log(this._normalizeIsoString(range.start, true))
        // console.log(out.start.toISO())
        // console.log(range.end)
        // console.log(this._normalizeIsoString(range.end, false))
        // console.log(out.end.toISO())
        return out;
    }

    // Convert raw events (start/end in original timezone ISO strings) to event objects with both original DateTimes and user JS Dates
    _convertEventsToUserZone(events) {
        if (!events || !this.DateTime) return (events || []).map(ev => Object.assign({}, ev));
        return (events || []).map(ev => {
            const originalStartDT = this.DateTime.fromISO(ev.start, { zone: this.originalTimezone });
            const originalEndDT = this.DateTime.fromISO(ev.end, { zone: this.originalTimezone });
            const startUser = originalStartDT.setZone(this.userTimezone);
            const endUser = originalEndDT.setZone(this.userTimezone);

            return Object.assign({}, ev, {
                _originalStartDT: originalStartDT,
                _originalEndDT: originalEndDT,
                startDate: startUser, // Luxon Date used for rendering/layout (in user timezone)
                endDate: endUser
            });
        });
    }

    //A perfect user facing string uses the zone plus its current offset. Uses Luxon since your project already loads it.
    _friendlyTimeZoneWithOffset() {
        const dt = luxon.DateTime.now().setZone(this.userTimezone);
        const offset = dt.offset / 60;
        const offsetText = offset >= 0 ? "UTC+" + offset : "UTC" + offset;
        const name = dt.toFormat('z');// this.userTimezone.split("/").pop().replace('_', ' ');
        return "" + name + " (" + offsetText + ")";
    }

    _timeStringToMinutes(t) {
        if (!t) return 0;
        const parts = t.split(':').map(p => parseInt(p, 10));
        return (parts[0] || 0) * 60 + (parts[1] || 0);
    }

    // Format long date for PDFs in user zone
    _formatLongDate(date) {
        if (!date) return '';
        return date.toFormat(this.options.pdfLongDateFormat);
    }
    // Compare same day in user's timezone
    _isSameDay(d1, d2) {
        const dt1 = d1.setZone(this.userTimezone).startOf('day');
        const dt2 = d2.setZone(this.userTimezone).startOf('day');
        return dt1.equals(dt2);
    }

    _clampDateToValidRange(Date) {
        if (!this.validRange || !this.DateTime) return Date;
        const candidateDayStart = Date.startOf('day');
        let clamped = candidateDayStart;

        if (this.validRange.start && clamped < this.validRange.start) {
            clamped = this.validRange.start;
        }
        if (this.validRange.end && clamped > this.validRange.end) {
            clamped = this.validRange.end;
        }
        // convert clampedOriginal (original zone DateTime) back to user JS Date at its startOf('day') in user zone
        const asUser = clamped.setZone(this.userTimezone).startOf('day');
        return asUser;
    }

    // Auto-fit slotMin and slotMax based on events in current view
    _autoFitSlotTimes(eventsByDay) {
        if (!eventsByDay || Object.keys(eventsByDay).length === 0) return;
        //console.log(eventsByDay)
        let minMinutes = 24 * 60; // start with max possible
        let maxMinutes = 0;        // start with min possible

        Object.values(eventsByDay).forEach(dayEvents => {
            dayEvents.forEach(event => {
                //console.log(event)
                const startDT = event.dayStart;
                const endDT = event.dayEnd;
                const startMinutes = startDT.hour * 60 + startDT.minute;
                const endMinutes = endDT.hour * 60 + endDT.minute;

                if (startMinutes < minMinutes) minMinutes = startMinutes;
                if (endMinutes > maxMinutes) maxMinutes = endMinutes;
            });
        });

        if (minMinutes === 24 * 60 && maxMinutes === 0) return;

        // Round down/up to nearest hour (or configurable step)
        const step = 60; // 60 = round to hour, 30 = round to half hour
        this.slotMinMinutes = Math.floor(minMinutes / step) * step;
        this.slotMaxMinutes = Math.ceil(maxMinutes / step) * step;
        //console.log(`${minMinutes} ${(minMinutes / step)} ${Math.floor(minMinutes / step)}`);
        //console.log(`${maxMinutes} ${(maxMinutes / step)} ${Math.ceil(maxMinutes / step)}`);
        this.visibleMinutes = this.slotMaxMinutes - this.slotMinMinutes;
        this.DAY_HEIGHT_PX = (this.visibleMinutes / 60) * this.hourHeightPx;
    }


    // ---- Init / render ----
    init() {
        this.container.innerHTML = `
            <div id="sc-calendar-header" class="mb-4"></div>
            <div id="sc-calendar-view" class="bg-white rounded-xl shadow-2xl overflow-hidden"></div>
        `;
        this.headerEl = document.getElementById('sc-calendar-header');
        this.viewEl = document.getElementById('sc-calendar-view');

        this.container.insertAdjacentHTML("beforeend", `
            <div id="sc-timezone-dropdown"
                class="hidden absolute bg-white border rounded shadow-xl p-2 pt-0 z-50 max-h-64 overflow-y-auto overflow-x-hidden"
                style="width: 260px;">
            </div>
        `);

        // expose calendar globally for your button inline handlers
        window.calendar = this;

        this.render();
    }

    _getTimezoneCountryCode(tz) {
        const map = {
            "America/New_York": "us",
            "America/Chicago": "us",
            "America/Denver": "us",
            "America/Los_Angeles": "us",
            "America/Phoenix": "us",
            "America/Anchorage": "us",
            "America/Adak": "us",

            "America/Toronto": "ca",
            "America/Vancouver": "ca",
            "America/Montreal": "ca",
            "America/Edmonton": "ca",
            "America/Halifax": "ca",
            "America/St_Johns": "ca",

            "Europe/London": "gb",
            "Europe/Berlin": "de",
            "Europe/Paris": "fr",
            "Europe/Rome": "it",
            "Europe/Madrid": "es",
            "Europe/Amsterdam": "nl",
            "Europe/Stockholm": "se",
            "Europe/Oslo": "no",
            "Europe/Zurich": "ch",
            "Europe/Warsaw": "pl",
            "Europe/Athens": "gr",

            "Asia/Tehran": "ir",
            "Asia/Dubai": "ae",
            "Asia/Tokyo": "jp",
            "Asia/Seoul": "kr",
            "Asia/Shanghai": "cn",
            "Asia/Kolkata": "in",
            "Asia/Singapore": "sg",
            "Asia/Hong_Kong": "hk",
            "Asia/Bangkok": "th",
            "Asia/Jakarta": "id",
            "Asia/Manila": "ph",

            "Australia/Sydney": "au",
            "Australia/Melbourne": "au",
            "Australia/Brisbane": "au",
            "Australia/Adelaide": "au",
            "Australia/Perth": "au",

            "Pacific/Auckland": "nz",
            "Pacific/Honolulu": "us",
            "Pacific/Fiji": "fj",

            "Africa/Cairo": "eg",
            "Africa/Johannesburg": "za",
            "Africa/Nairobi": "ke",

            "America/Mexico_City": "mx",
            "America/Sao_Paulo": "br",
            "America/Buenos_Aires": "ar",
            "America/Bogota": "co",
            "America/Lima": "pe",

            "Europe/Moscow": "ru",
            "Asia/Istanbul": "tr",

            "Antarctica/Troll": "aq"
        };

        // direct match if present
        if (map[tz]) return map[tz];

        // Fallback based on continent
        const region = tz.split("/")[0];
        if (region === "Europe") return "eu";
        if (region === "Africa") return "za";
        if (region === "Asia") return "sg";
        if (region === "America") return "us";
        if (region === "Australia") return "au";
        if (region === "Pacific") return "fj";

        return "un"; // United Nations default
    }


    _getTimezoneFlag(tz) {
        const code = this._getTimezoneCountryCode(tz).toLowerCase();
        return `https://flagcdn.com/w20/${code}.png`;
    }

    _getTimezoneTooltip(tz) {
        const dt = this.DateTime.now().setZone(tz);
        const offset = dt.toFormat("ZZ");
        const region = tz.split("/")[0].replace("_", " ");
        const city = tz.split("/")[1]?.replace("_", " ") || "";
        return `${region}, ${city}  (UTC${offset})`;
    }



    _setupTimezoneSelector() {
        const trigger = this.headerEl.querySelector("#sc-timezone-selector");
        const dropdown = this.container.querySelector("#sc-timezone-dropdown");

        if (!trigger || !dropdown) return;

        // Load all IANA timezones
        const zones = luxon.IANAZone.isValidZone
            ? Intl.supportedValuesOf("timeZone")
            : [];

        // Prepare dropdown content
        dropdown.innerHTML = `
    <div id="sc-tz-search-wrapper"
         class="sticky top-0 bg-white z-10 pb-2 pt-2"
         style="background:white;">
        
        <input type="search" id="sc-tz-search"
               class="w-full p-1 border rounded mb-2"
               placeholder="Search timezone">

        <button id="sc-tz-reset"
                class="w-full text-center p-1 border rounded bg-gray-100 hover:bg-gray-200">
            Reset to system timezone
        </button>
    </div>

    <div id="sc-tz-list"></div>
`;


        const listEl = dropdown.querySelector("#sc-tz-list");
        const searchEl = dropdown.querySelector("#sc-tz-search");
        const resetBtn = dropdown.querySelector("#sc-tz-reset");

        resetBtn.addEventListener("click", (e) => {
            e.stopPropagation();

            // System timezone from browser
            const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

            // Save choice
            localStorage.setItem("sc-user-timezone", systemZone);

            // Hide dropdown with animation
            dropdown.classList.remove("sc-show");
            setTimeout(() => dropdown.classList.add("hidden"), 150);

            // Reinitialize calendar
            const oldOptions = { ...this.options, userTimezone: systemZone };
            const rawEvents = [...this.rawEvents];

            this.container.innerHTML = "";
            new SimpleCalendar(this.container.id, rawEvents, oldOptions);
        });
        const renderList = (filter = "") => {
            const f = filter.toLowerCase();

            const filtered = zones
                .filter(z => z.toLowerCase().includes(f))
                .map(z => {
                    const dt = this.DateTime.now().setZone(z);
                    return {
                        zone: z,
                        offset: dt.offset  /* offset in minutes */
                    };
                })
                .sort((a, b) => a.offset - b.offset);

            listEl.innerHTML = filtered
                .map(item => {
                    const z = item.zone;
                    const flag = this._getTimezoneFlag(z);
                    const tip = this._getTimezoneTooltip(z);

                    return `
                <div class="p-1 hover:bg-gray-200 cursor-pointer tz-item flex items-center"
                     title="${tip}">
                    <img class="sc-flag" src="${flag}">
                    <span>${z}</span>
                </div>
            `;
                })
                .join("");
        };


        renderList();

        // Search filter
        searchEl.addEventListener("input", () => {
            renderList(searchEl.value);
        });

        // Show dropdown
        trigger.addEventListener("click", () => {
            //e.stopPropagation();        // <<< prevents immediate close
            const rect = trigger.getBoundingClientRect();
            dropdown.style.left = rect.left + "px";
            dropdown.style.top = rect.bottom + 5 + "px";

            dropdown.classList.remove("hidden");
            requestAnimationFrame(() => dropdown.classList.add("sc-show"));

            searchEl.focus();
        });

        // Click outside to hide
        setTimeout(() => {
            const closeHandler = (e) => {
                if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
                    dropdown.classList.remove("sc-show");
                    setTimeout(() => dropdown.classList.add("hidden"), 150);
                    document.removeEventListener("click", closeHandler);
                }
            };
            document.addEventListener("click", closeHandler);
        }, 0);


        // Select timezone
        dropdown.addEventListener("click", (e) => {
            const item = e.target.closest(".tz-item");
            if (!item) return;

            const newZone = item.textContent.trim();

            // Save selection
            localStorage.setItem("sc-user-timezone", newZone);

            dropdown.classList.remove("sc-show");
            setTimeout(() => dropdown.classList.add("hidden"), 150);

            // Reinitialize calendar
            const oldOptions = { ...this.options, userTimezone: newZone };
            const raw = [...this.rawEvents];
            this.container.innerHTML = "";

            new SimpleCalendar(this.container.id, raw, oldOptions);
        });
    }


    setView(viewName) {
        if (this.options.views[viewName]) {
            this.currentView = viewName;
            //console.log(viewName);
        } else {
            this.currentView = Object.keys(this.options.views)[0];
        }
        this.render();
        //this._callDatesSet();
    }

    changeDate(days) {
        //console.info(`change dates clicked(${days} days)`);
        // days relative shift in user timezone
        //console.info('current day is:');
        //console.info(this.currentDate.toISO());
        const next = this.currentDate.plus({ days });
        //console.info('next day is:');
        //console.info(next.toISO());
        // clamp to validRange if present (validRange interpreted in original timezone)
        const clamped = this._clampDateToValidRange(next);
        this.currentDate = clamped;
        //console.info(this.validRange.end.toISO());
        // if validRange present, ensure we don't navigate outside it (validRange in user timezone)
        if (this.validRange && this.DateTime) {
            const candidate = this.currentDate;
            if (this.validRange.start && candidate.startOf('day') < this.validRange.start) {
                this.currentDate = this.validRange.start;
            }
            if (this.validRange.end && candidate.endOf('day') > this.validRange.end) {
                this.currentDate = this.validRange.end;
            }
        }

        this.render();
        //this._callDatesSet();
    }

    // gotoDate(iso) {
    //     this.currentDate = this._convertInitialDateToUserJS(iso);
    //     // clamp
    //     this.currentDate = this._clampDateToValidRangeUserJS(this.currentDate);
    //     this.render();
    //     //this._callDatesSet();
    // }

    // Return list of JS Date objects (start-of-day in user timezone) for current view
    getDatesForView() {
        const dayCount = this.options.views[this.currentView]?.durationDays || 1;
        const dates = [];

        const validStart = this.validRange.start;
        const validEnd = this.validRange.end;
        // Base date
        let baseDT = this.currentDate.startOf('day');

        // Clamp baseDT to valid range
        if (baseDT < validStart) baseDT = validStart;
        //console.log(baseDT < validStart);
        const latestAllowedStart = validEnd.startOf('day').minus({ days: dayCount - 1 }).startOf('day');
        //console.info('baseDT in getdateforview')
        //console.log(baseDT.toISO() + '/' + latestAllowedStart.toISO())
        if (baseDT > latestAllowedStart) baseDT = latestAllowedStart;
        //console.log(baseDT > latestAllowedStart);
        for (let i = 0; i < dayCount; i++) {
            let d = baseDT.plus({ days: i });
            dates.push(d);
        }
        //console.log(dates);
        return dates;
    }

    // get events that intersect visible minutes of the day (all computations in user timezone)
    getEventsForView(dates) {
        const eventsByDay = {};
        dates.forEach(date => {
            eventsByDay[this._luxonToIso(date)] = [];
        });
        this.events.forEach(event => {
            dates.forEach(date => {
                const dayKey = this._luxonToIso(date);

                // day start & end in user timezone
                const dayStartDT = date.startOf('day');
                const dayStartMS = dayStartDT.toMillis();
                const dayEndMS = dayStartDT.plus({ days: 1 }).toMillis();

                // event start/end are stored as JS Date in user timezone (startDate/endDate)
                const eventStartMS = event.startDate.toMillis();
                const eventEndMS = event.endDate.toMillis();

                //console.log(`date: ${dayKey}\nday start: ${this.DateTime.fromMillis(dayStartMS, { zone:this.userTimezone }).toISO()}\nday end:${this.DateTime.fromMillis(dayEndMS, { zone:this.userTimezone }).toISO()}\nevent: ${event.title}\nevent start: ${this.DateTime.fromMillis(eventStartMS, { zone:this.userTimezone }).toISO()}\nevent end: ${this.DateTime.fromMillis(eventEndMS, { zone:this.userTimezone }).toISO()}`);

                if (eventStartMS < dayEndMS && eventEndMS > dayStartMS) {
                    // compute intersection limited to slotMin/slotMax (slot times are minutes of day in local user zone)
                    const dayStartMinutesMs = dayStartMS + this.slotMinMinutes * MS_PER_MINUTE;
                    const dayEndMinutesMs = dayStartMS + this.slotMaxMinutes * MS_PER_MINUTE;

                    const adjustedStartMS = Math.max(eventStartMS, dayStartMinutesMs);
                    const adjustedEndMS = Math.min(eventEndMS, dayEndMinutesMs);

                    if (adjustedStartMS < adjustedEndMS) {
                        eventsByDay[dayKey].push({
                            ...event,
                            dayStart: this.DateTime.fromMillis(adjustedStartMS, { zone: this.userTimezone }),
                            dayEnd: this.DateTime.fromMillis(adjustedEndMS, { zone: this.userTimezone }),
                            originalStart: event._originalStartDT ? event._originalStartDT : event.startDate,
                            originalEnd: event._originalEndDT ? event._originalEndDT : event.endDate
                        });
                    }
                }
            });
        });

        Object.keys(eventsByDay).forEach(day => {
            eventsByDay[day].sort((a, b) => a.dayStart - b.dayStart);
        });
        //console.log('eventsByDay:', eventsByDay);
        return eventsByDay;
    }

    calculateEventLayout(events) {
        // Step 1: compute top and height
        events.forEach(event => {
            const startOfDayDT = event.dayStart.startOf('day');
            const startOfDayMS = startOfDayDT.toMillis();

            // startOfDayMS is still a timestamp in ms (could also be Luxon DateTime)
            const startMinutes = (event.dayStart.toMillis() - (startOfDayMS + this.slotMinMinutes * MS_PER_MINUTE)) / MS_PER_MINUTE;
            const endMinutes = (event.dayEnd.toMillis() - (startOfDayMS + this.slotMinMinutes * MS_PER_MINUTE)) / MS_PER_MINUTE;
            const durationMinutes = endMinutes - startMinutes;

            event.top = (startMinutes / this.visibleMinutes) * this.DAY_HEIGHT_PX;
            event.height = (durationMinutes / this.visibleMinutes) * this.DAY_HEIGHT_PX;
        });

        // Step 2: sort by start time
        const sortedEvents = events.sort((a, b) => a.top - b.top);

        // Step 3: assign lanes dynamically
        const activeLanes = []; // array of arrays, each lane is a list of events
        sortedEvents.forEach(event => {
            // find first lane where this event doesn't overlap last event
            let laneIndex = activeLanes.findIndex(lane => {
                const lastEvent = lane[lane.length - 1];
                return event.top >= lastEvent.top + lastEvent.height - 2;
            });

            if (laneIndex === -1) {
                activeLanes.push([]);
                laneIndex = activeLanes.length - 1;
            }

            activeLanes[laneIndex].push(event);
            event.lane = laneIndex;
        });

        // Step 4: compute width based on overlapping lanes
        sortedEvents.forEach(event => {
            const overlapping = sortedEvents.filter(e => overlaps(e, event));
            const maxLane = Math.max(...overlapping.map(e => e.lane));
            const totalLanes = maxLane + 1; // total lanes this event participates in
            event.width = 100 / totalLanes;
            event.left = event.lane * event.width;
            // if (event.title.includes('Tutorial 1'))
            // {
            //     console.log(overlapping)
            //     console.log(maxLane);
            //     console.log(`${totalLanes}`);
            // }

        });

        return sortedEvents;

        function overlaps(a, b) {
            var result = a.top < b.top + b.height - 2 && b.top < a.top + a.height - 2;
            //if ((a.title.includes('Tutorial 1') | b.title.includes('Tutorial 1')) & result === true)
            //    console.log(`${a.title} ${b.title} -> ${result}`);
            return result;
        }
    }

    // ---- Rendering utilities ----

    render(header = true) {
        if (header) {
            this.renderHeader();
            this._setupTimezoneSelector();
            this.setUpSearch();
        }

        // apply classes for view
        this.viewEl.className = this.viewEl.className.replace(/sc-day-view|sc-three-day-view/g, '').trim();
        const dayCount = this.options.views[this.currentView]?.durationDays || 1;

        this.viewEl.classList.add('sc-multi-day-view');

        this.renderMultiDayView(dayCount);
    }

    renderHeader() {
        const dates = this.getDatesForView();
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];

        const viewTitle = this._formatViewTitle(startDate, endDate);

        const leftButtons = this.options.headerToolbar?.left || 'prev,next';
        const center = this.options.headerToolbar?.center || 'title';
        const rightButtons = this.options.headerToolbar?.right || 'Day1,Day3,Day5,Day10';
        //console.log(this);
        // Assume you already have these
        const dayCount = dates.length; // number of days in current view
        const validStart = this.validRange.start;
        const validEnd = this.validRange.end;
        const baseDT = this.currentDate.startOf('day');

        // Compute the latest allowed start to keep the whole span in range
        const latestAllowedStart = validEnd.minus({ days: dayCount - 1 }).startOf('day');
        //console.log(baseDT.toISO() + '/' + latestAllowedStart.toISO())
        // Determine if prev/next should be enabled
        const prevEnabled = baseDT > validStart;
        const nextEnabled = baseDT < latestAllowedStart;
        //console.log(prevEnabled + '/' + nextEnabled)
        // Render buttons
        const leftHtml = leftButtons.includes('prev')
            ? `<button onclick="window.calendar.changeDate(-${dayCount})" 
              class="p-2 rounded-lg transition ease-in-out duration-300 
              ${prevEnabled ? 'text-black hover:bg-gray-400' : 'text-gray-300 cursor-not-allowed'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
              <path d="M11.354 1.646 L5.354 7.646 L11.354 13.646" stroke="currentColor" stroke-width="2" fill="none" />
          </svg>
      </button>`
            : '';

        const leftHtml2 = leftButtons.includes('next')
            ? `<button onclick="window.calendar.changeDate(${dayCount})" 
              class="p-2 rounded-lg  transition ease-in-out duration-300 
              ${nextEnabled ? 'text-black hover:bg-gray-400' : 'text-gray-300 cursor-not-allowed'}">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
              <path d="M4.646 1.646 L10.646 7.646 L4.646 13.646" stroke="currentColor" stroke-width="2" fill="none" />
          </svg>
      </button>`
            : '';

        // Dynamic right side view buttons
        const rightParts = rightButtons.split(',');
        let rightHtml = '';

        rightParts.forEach(part => {
            const key = part.trim();
            //console.log(part);
            // If view exists in options.views and has durationDays
            if (this.options.views[key] && this.options.views[key].durationDays) {
                //console.log(`Right part has key: ${key}`);
                const btnText = this.options.views[key].buttonText
                    || this.options.views[key].durationDays + 'd';

                rightHtml += `<button onclick="window.calendar.setView('${key}')" class="${this.currentView === key ? 'bg-blue-500 text-white' : 'hover:bg-gray-400'} px-3 py-1 rounded-lg  transition ease-in-out duration-300">${btnText}</button>`;
                return;
            }
        });
        this.headerEl.innerHTML = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center w-full no-print space-y-2 sm:space-y-0 sm:space-x-4">
            <!-- Title row -->
            <div class="sc-date-container w-full sm:w-auto sm:items-center sm:ml-2 flex flex-col" style="align-items:center;">
                <span class="text-3xl font-bold text-gray-800 leading-tight truncate">
                    ${viewTitle}
                </span>
            <span id="sc-timezone-selector"
                class="text-sm text-gray-600 cursor-pointer underline"
                title="Click to change timezone">
                ${this._friendlyTimeZoneWithOffset()}
            </span>
            </div>
            <!-- Navigation row -->
            <div class="flex w-full sm:w-auto space-x-2 items-center">
                <div class="flex flex-row sm:flex-none w-full sm:w-auto justify-start">
                    ${leftHtml}${leftHtml2}
                </div>
                <!-- View buttons -->
                <div class="flex flex-row flex-1 w-full sm:w-auto justify-end mt-2 sm:mt-0 ">
                    ${rightHtml}
                </div>
                <!-- Download button -->
                <div class="flex flex-row sm:flex-none w-full sm:w-auto justify-end mt-2 sm:mt-0">

                    <div class="relative">
                        <button id="pdf-download-btn"
                            type="button"
                            onclick="document.getElementById('pdf-dropdown-menu').classList.toggle('open')"
                            class="inline-flex items-center justify-center px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-700 transition ease-in-out duration-300">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none"
                                viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                    d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2m-4-4l-4 4m0 0l-4-4m4 4V4" />
                            </svg>
                        </button>

                        <div id="pdf-dropdown-menu"
                            class="origin-top-right absolute right-0 mt-2 w-56 bg-white border rounded-md shadow-lg z-50 
                                opacity-0 scale-95 pointer-events-none transition-all duration-200">
                            <button onclick="window.calendar.generatePdf()"
                                class="w-full text-left px-4 py-2 hover:bg-blue-500 hover:text-white">Download Calendar PDF</button>
                            <button onclick="window.calendar.generateProgramPdf()"
                                class="w-full text-left px-4 py-2 hover:bg-blue-500 hover:text-white">Download Program PDF</button>
                        </div>
                    </div>

                </div>


            </div>

            <!-- Search row -->
            <div class="flex flex-col sm:flex-row w-full sm:w-auto items-start sm:items-center space-y-2 sm:space-y-0 sm:space-x-2">
                <input type="search" id="sc-eventSearch" class="w-full sm:w-48 px-2 py-2 border border-gray-300 rounded-md" placeholder="Search...">
            </div>
        </div>
    `;

        this.updatePdfButtonState();
        this.searchEl = document.getElementById('sc-eventSearch');
    }


    // Format header/title based on user zone dates
    _formatViewTitle(startDate, endDate) {
        // Assume startDate and endDate are Luxon DateTime objects in userTimezone

        if (startDate.toMillis() === endDate.toMillis()) {
            return startDate.toFormat(this.options.titleFormat);
        }

        const sameMonth = startDate.month === endDate.month;
        const sameYear = startDate.year === endDate.year;

        if (sameMonth && sameYear) {
            return `${startDate.toFormat('LLL *, yyyy')}`.replace(this.options.titleSameMontYearDatesSymbol, `${startDate.day}-${endDate.day}`);
        }

        return `${startDate.toFormat(this.options.titleRangeStartFormat)} - ${endDate.toFormat(this.options.titleRangeEndFormat)}`;
    }


    renderMultiDayView() {
        const dates = this.getDatesForView();
        // Auto-fit slot min/max to visible events
        if (this.options.autoFitEvents && this.searchEl.value.length === 0) {
            this.slotMinMinutes = 0; // start with max possible
            this.slotMaxMinutes = 24 * 60;        // start with min possible
            const eventsByDay = this.getEventsForView(dates);
            this._autoFitSlotTimes(eventsByDay);
        }
        else {
            this.slotMinMinutes = this._timeStringToMinutes(this.options.slotMinTime);
            this.slotMaxMinutes = this._timeStringToMinutes(this.options.slotMaxTime);
        }
        const eventsByDay = this.getEventsForView(dates);

        let columnHeaders = `<div class="grid sc-time-grid border-b border-gray-200 sticky top-0 bg-white z-20" style="grid-template-columns: 50px repeat(${dates.length}, minmax(0, 1fr));">`;
        columnHeaders += '<div class="col-span-1 border-r border-gray-100 p-2 text-sm text-center bg-gray-50">Time</div>';

        dates.forEach(date => {
            const dayKey = this._luxonToIso(date);
            const isToday = this._isSameDay(date, this.DateTime.now());
            //console.log(`is today: ${isToday}`)
            columnHeaders += `<div class="col-span-1 p-2 text-sm text-center font-semibold ${isToday ? 'text-primary bg-blue-100' : 'text-gray-700 bg-gray-50'} border-r border-gray-100">
                ${date.toFormat(this.options.dayNameFormat)}
            </div>`;
            eventsByDay[dayKey] = this.calculateEventLayout(eventsByDay[dayKey] || []);
        });
        columnHeaders += '</div>';

        let dayContent = '';
        dates.forEach(date => {
            const dayKey = this._luxonToIso(date);
            const dayEvents = eventsByDay[dayKey] || [];
            const dayName = date.toFormat(this.options.dayNameFormat);
            dayContent += this.renderDayContainer(dayName, dayEvents, 'col-span-1');
        });
        //console.log(dates.length);
        this.viewEl.innerHTML = `
            ${columnHeaders}
            <div class="grid sc-time-grid relative sc-main-grid-container" style="grid-template-columns: 50px repeat(1, minmax(0, 1fr));">
                ${this.renderTimesColumn()}
                <div class="grid grid-cols-${dates.length} col-span-1 border-l border-gray-100 relative">
                    ${dayContent}
                </div>
                ${this.renderTimeSlots(dates[0])}
            </div>
        `;

        this._attachEventMountHandlers();
    }

    renderTimesColumn() {
        // Render visible slot labels based on slotMinTime/slotMaxTime using user timezone
        let html = `<div class="sticky top-0 bg-white z-2 pt-0">`;
        const startHour = Math.floor(this.slotMinMinutes / 60);
        const endHour = Math.ceil(this.slotMaxMinutes / 60);
        for (let h = startHour; h <= endHour; h++) {
            // build a DateTime at hour h on an arbitrary day in user timezone for consistent formatting
            const dt = this.currentDate.set({ hour: h, minute: 0, second: 0, millisecond: 0 });
            const hourDisplay = dt.toFormat(this.options.slotLabelFormat);
            html += `<div class="sc-hour-label text-xs text-gray-500" style="height: ${this.hourHeightPx}px; line-height: ${this.hourHeightPx}px;">${hourDisplay}</div>`;
        }
        html += `</div>`;
        return html;
    }

    renderTimeSlots(sampleDay) {
        let html = '';
        const linesColSpan = 'grid-column: 1 / -1;';
        const linesColSpanHalfHour = 'grid-column: 2 / -1;';
        const startHour = Math.floor(this.slotMinMinutes / 60);
        const endHour = Math.ceil(this.slotMaxMinutes / 60);
        for (let h = startHour; h <= endHour; h++) {
            const top = ((h * 60 - this.slotMinMinutes) / this.visibleMinutes) * this.DAY_HEIGHT_PX;
            const top2 = (((h * 60) + 30 - this.slotMinMinutes) / this.visibleMinutes) * this.DAY_HEIGHT_PX;
            html += `<div class="sc-time-slot-line-hour absolute w-full" style="top: ${top}px; ${linesColSpan}"></div>`;
            html += `<div class="sc-time-slot-line-half-hour absolute w-full" style="top: ${top2}px; ${linesColSpanHalfHour}"></div>`;
        }
        html += `<div class="sc-time-slot-line-hour absolute w-full" style="top: ${this.DAY_HEIGHT_PX}px; ${linesColSpan}"></div>`;

        if (this.options.nowIndicator && sampleDay && this.DateTime) {
            const nowDT = this.DateTime.now().setZone(this.userTimezone);
            const sampleDayDT = sampleDay.startOf('day');
            let minutesSinceStart;

            if (this.options.nowIndicatorMode === 'currentDay') {
                // Only show if sampleDay is today
                if (nowDT >= sampleDayDT && nowDT <= sampleDayDT.plus({ days: 1 })) {
                    minutesSinceStart = nowDT.diff(sampleDayDT, 'minutes').minutes;
                } else {
                    minutesSinceStart = null;
                }
            } else if (this.options.nowIndicatorMode === 'anyDay') {
                // Show based on the **time of day**, regardless of which day
                const startOfDay = sampleDayDT;
                minutesSinceStart = nowDT.diff(nowDT.startOf('day'), 'minutes').minutes;
                // If you want the indicator to represent the **same time as 'now'** but on sampleDay
                // you could just use the same minutesSinceStart
            }

            if (minutesSinceStart !== null &&
                minutesSinceStart >= this.slotMinMinutes &&
                minutesSinceStart <= this.slotMaxMinutes) {
                const top = ((minutesSinceStart - this.slotMinMinutes) / this.visibleMinutes) * this.DAY_HEIGHT_PX;
                //console.log(top);
                // horizontal line
                html += `<div class="sc-now-slot-line absolute w-full" style="top: ${top}px; ${linesColSpanHalfHour};"></div>`;
                const triSvg = `<svg width="16px" height="16px" viewBox="0 0 16 16" version="1.1" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
                                    <rect width="16" height="16" fill="none"></rect>
                                    <polygon points="13,8 5,16 5,0" fill="currentColor" stroke="currentColor" stroke-width="1"></polygon>
                                </svg>`;
                // small triangle
                html += `<div class="sc-now-slot-line-triangle absolute" style="top: ${top - 7}px;">${triSvg}</div>`;
            }
        }

        return html;
    }

    _getContrastForeColor(color) {
        let r, g, b;

        if (color.startsWith("#")) {
            // Remove the hash
            color = color.slice(1);

            // Expand shorthand hex to full form, e.g. #abc → #aabbcc
            if (color.length === 3) {
                color = color.split("").map(c => c + c).join("");
            }

            r = parseInt(color.substring(0, 2), 16);
            g = parseInt(color.substring(2, 4), 16);
            b = parseInt(color.substring(4, 6), 16);

        } else if (color.startsWith("rgb")) {
            // Match rgb or rgba
            const values = color.match(/rgba?\(([^)]+)\)/);
            if (!values) return "black"; // Fallback

            const parts = values[1].split(",").map(x => parseFloat(x.trim()));
            [r, g, b] = parts;
        } else {
            // Unsupported format
            return "black";
        }

        // Normalize to 0–1 and compute luminance
        const luminance = (0.2126 * r / 255) + (0.7152 * g / 255) + (0.0722 * b / 255);

        return luminance > 0.7 ? "black" : "white";
    }
    // Function to check if the value is a valid hex color
    _isHexColor(value) {
        // Hex color regex (handles 6 or 3 digit hex colors with or without a leading '#')
        const hexPattern = /^#?([0-9A-Fa-f]{3}){1,2}$/;
        return hexPattern.test(value);
    }
    // Function to get hex value from either color name or hex input
    _getHexColor(value) {
        if (isHexColor(value)) {
            return value.startsWith("#") ? value : "#" + value; // Ensure hex has a leading '#'
        }
        // If not a valid hex color, check if it's a color name
        const color = colorNames[value.toLowerCase()];
        return color || null; // Return hex color if found, otherwise null
    }

    renderDayContainer(dayName, events, gridClass) {
        let eventsHtml = '';

        const videoSvg = `<svg fill="currentColor" xmlns="http://www.w3.org/2000/svg" 
                                width="16px" height="16px" style="display:inline" viewBox="0 0 52 52" enable-background="new 0 0 52 52" xml:space="preserve">
                            <path d="M46.9,13.1L35.9,21v-5.6c0-1.5-1.2-2.7-2.7-2.7H4.7c-1.5,0-2.7,1.2-2.7,2.7v21.3c0,1.5,1.2,2.7,2.7,2.7h28.6
                                c1.5,0,2.7-1.2,2.7-2.7v-5.5L46.9,39c0.7,0.7,1.9,0.2,1.9-0.8V13.9C48.8,12.9,47.6,12.4,46.9,13.1z"/>
                            </svg>`
        const roomSvg = `<svg width="16px" height="16px" style="display:inline" viewBox="3 0 18 23" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <rect x="0" fill="none" width="20" height="20"/>
                                <g>
                                <path d="M10 2C6.69 2 4 4.69 4 8c0 2.02 1.17 3.71 2.53 4.89.43.37 1.18.96 1.85 1.83.74.97 1.41 2.01 1.62 2.71.21-.7.88-1.74 1.62-2.71.67-.87 1.42-1.46 1.85-1.83C14.83 11.71 16 10.02 16 8c0-3.31-2.69-6-6-6zm0 2.56c1.9 0 3.44 1.54 3.44 3.44S11.9 11.44 10 11.44 6.56 9.9 6.56 8 8.1 4.56 10 4.56z"stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </g>
                            </svg>`;
        const moderatorSvg = `<svg fill="currentColor" width="16px" height="16px" style="display:inline" viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg"><path d="M860 265h-61q-8 0-13.5 5.5T780 284v246q0 39-28 67t-68 28H279q-8 0-13.5 5.5T260 644v61q0 17 11.5 28.5T300 745h415q25 0 43 18l110 110q4 4 9.5 5t11-1 8.5-7 3-11V305q0-17-11.5-28.5T860 265zM700 505V145q0-17-11.5-28.5T660 105H140q-17 0-28.5 11.5T100 145v514q0 6 3 11t8.5 7 11 1 9.5-5l110-110q18-18 43-18h375q17 0 28.5-12t11.5-28z"/></svg>`;
        const presenterSVg = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="16" height="16" style="display:inline" viewBox="4 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

        events.forEach(event => {
            const eventColor = event.color || '#4098fdff';
            const eventTextColor = event.textColor || this._getContrastForeColor(eventColor);
            const eventTitle = event.title || '';
            const eventSubtitle = event.subtitle || '';
            const eventNote = event.note || '';
            const eventModerator = event.details?.moderator || '';
            const hasRoom = event.details?.room
                && event.details?.room.trim() !== ""
                && !event.details?.room.toLowerCase().includes("n/a");
            const eventRoom = hasRoom ? `${roomSvg}${event.details?.room}` : '';
            const hasVideoLink = event.details?.videolink
                && event.details?.videolink.trim() !== ""
                && !event.details?.videolink.toLowerCase().includes("n/a");
            const eventVideoLink = hasVideoLink ? `${videoSvg} <a target='_blank' href='${event.details?.videolink}'>${event.details?.videolink}</a>` : '';

            const hasModerator = eventModerator
                && eventModerator.trim() !== ""
                && !eventModerator.toLowerCase().includes("n/a");
            //https://www.svgviewer.dev/
            const roomModerator = hasModerator ? `${moderatorSvg} ${eventModerator}` : '';
            const hasSpeaker = event.details
                && event.details.speaker
                && event.details.speaker.trim() !== "";
            const presenterHtml = hasSpeaker ? `<span style="display:inline-flex; align-items:center">${presenterSVg} <span>${event.details.speaker}</span></span>` : '';

            // Format start/end times in user timezone using Luxon
            const start = event.dayStart;
            const end = event.dayEnd;
            const startTime = start.toFormat('HH:mm');
            const endTime = end.toFormat('HH:mm');

            let innerHtml = '';
            if (typeof this.options.eventContent === 'function') {
                try {
                    const out = this.options.eventContent({ event });
                    innerHtml = out && out.html ? out.html : (out && out.dom ? out.dom : '');
                } catch (err) {
                    innerHtml = `<div class="text-md font-bold truncate">${eventTitle}</div><div class="text-xs">${startTime}</div>`;
                }
            } else {
                //console.log(eventSubtitle);
                innerHtml = `
                    <div class="text-md font-bold truncate">${(eventTitle || '').replace(/\n/g, '<br>')}</div>
                    <div class="text-md font-regular truncate">${(eventSubtitle || '').replace(/\n/g, '<br>')}</div>
                    <div class="text-xs opacity-80">${startTime}-${endTime}</div>
                    <div class="text-xs">${presenterHtml}</div>
                    <div class="text-xs">${roomModerator}</div>
                    <div class="text-xs">${eventRoom}</div>
                    <div class="text-xs truncate">${eventVideoLink}</div>
                    <div class="text-md font-regular truncate mt-2 pb-2">${(eventNote || '').replace(/\n/g, '<br>')}</div>
                `;
            }
            //console.log(eventColor);
            eventsHtml += `
                <div class="sc-event-box border"
                    data-ev-id="${event.id || ''}"
                    style="
                        top: ${event.top}px;
                        height: ${event.height}px;
                        left: ${event.left}%;
                        width: ${event.width}%;
                        z-index: ${10 + (event.lane || 0)};
                        position: absolute;
                        padding: 6px;
                        box-sizing: border-box;
                        overflow: hidden;
                        color: ${eventTextColor};
                        background-color: ${eventColor};
                    ">
                    ${innerHtml}
                </div>
            `
        });

        // Use CSS-friendly fixed height value
        return `<div class="${gridClass} h-full" style="border-right: 1px solid rgba(0,0,0,0.06); position: relative;">${eventsHtml}</div>`;
    }

    updatePdfButtonState() {
        const btn = document.getElementById('pdf-download-btn');
        if (!btn) return;
        btn.disabled = this.isGeneratingPdf;
        btn.innerHTML = this.isGeneratingPdf ? `<div role="status"><svg aria-hidden="true" class="inline w-6 h-6 text-gray-200 animate-spin dark:text-gray-600 fill-blue-600" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor"/><path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentFill"/></svg><span class="sr-only">Loading...</span></div>` : `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>`;
    }

    setUpSearch() {
        if (!this.searchEl) this.searchEl = document.getElementById('sc-eventSearch');
        if (!this.searchEl) return;
        this.searchEl.removeEventListener?.('input', this._searchHandler);
        this._searchHandler = () => {
            const q = (this.searchEl.value || '').toLowerCase();
            const filteredEvents = this.rawEvents.filter(ev => {
                console.log(ev);
                return q === '' ||
                    (ev.title && ev.title.toLowerCase().includes(q)) ||
                    (ev.subtitle && ev.subtitle.toLowerCase().includes(q)) ||
                    (ev.note && ev.note.toLowerCase().includes(q)) ||
                    (ev.details?.room && ev.details.room.toLowerCase().includes(q)) ||
                    (ev.details?.speaker && ev.details.speaker.toLowerCase().includes(q)) ||
                    (ev.details?.id && ev.details.id.toLowerCase().includes(q)) ||
                    (ev.details?.session && ev.details.session.toLowerCase().includes(q)) ||
                    (ev.details?.moderator && ev.details.moderator.toLowerCase().includes(q)) ||
                    (ev.details?.mode && ev.details.mode.toLowerCase().includes(q)) ||
                    (ev.details?.type && ev.details.type.toLowerCase().includes(q)) ||
                    (ev.details?.track && ev.details.track.toLowerCase().includes(q));
            });
            this.events = this._convertEventsToUserZone(filteredEvents);
            this.render(false);
        };
        this.searchEl.addEventListener('input', this._searchHandler);
    }

    _attachEventMountHandlers() {
        const eventEls = this.viewEl.querySelectorAll('.sc-event-box');
        eventEls.forEach(el => {
            const evId = el.getAttribute('data-ev-id');
            let evObj = null;
            if (evId) {
                evObj = this.events.find(e => `${e.id}` === `${evId}`);
            }
            if (!evObj) {
                const title = (el.querySelector('.text-md')?.textContent || '').trim();
                evObj = this.events.find(e => (e.title || '').includes(title));
            }
            if (!evObj) return;

            if (typeof this.options.eventDidMount === 'function') {
                try {
                    const info = { event: evObj, el };
                    this.options.eventDidMount(info);
                } catch (err) {
                    console.warn('eventDidMount handler threw', err);
                }
            } else {
                const props = evObj.details || {};

                // Create overlay
                const overlay = document.createElement('div');
                overlay.className = 'fixed inset-0 bg-black bg-opacity-50 hidden z-50 flex items-center justify-center';

                // Create tooltip modal box
                const tooltip = document.createElement('div');
                tooltip.className = 'bg-gray-900 text-white text-sm rounded px-4 py-3 shadow-lg max-w-lg w-full break-words';

                // Clone HTML so we can modify it
                const temp = document.createElement('div');
                temp.innerHTML = el.innerHTML;

                // Remove truncate class from all elements that have it
                temp.querySelectorAll('.truncate').forEach(node => {
                    node.classList.remove('truncate');
                });

                // Now build the tooltip with cleaned HTML
                tooltip.innerHTML = `
    <div>${temp.innerHTML}</div>
    <button class="mt-4 bg-gray-700 hover:bg-gray-600 text-white px-3 py-1 rounded close-btn">Close</button>
`;

                overlay.appendChild(tooltip);
                document.body.appendChild(overlay);

                // Close on overlay click or button
                overlay.addEventListener('click', e => {
                    if (e.target === overlay) overlay.classList.add('hidden');
                });

                tooltip.querySelector('.close-btn').addEventListener('click', () => {
                    overlay.classList.add('hidden');
                });

                // Show modal
                const showTip = () => {
                    overlay.classList.remove('hidden');
                };

                // Hide modal
                const hideTip = () => {
                    overlay.classList.add('hidden');
                };

                // Trigger
                el.addEventListener('click', showTip);

            }
        });
    }

    // ---- PDF functions ----
    htmlToText(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;

        // Replace <br> with newline
        temp.querySelectorAll('br').forEach(br => {
            br.replaceWith('\n');
        });

        // Optionally, add newline after block elements (p, div, li)
        temp.querySelectorAll('p, div, li').forEach(el => {
            el.appendChild(document.createTextNode('\n'));
        });

        return temp.textContent || temp.innerText || '';
    }

    async generatePdf() {
        if (this.isGeneratingPdf) return;
        this.isGeneratingPdf = true;
        this.updatePdfButtonState();

        const calendarEl = this.viewEl;
        const body = document.body;
        body.classList.add('sc-pdf-export-mode');

        const stickyHeaders = calendarEl.querySelectorAll('.sticky');
        stickyHeaders.forEach(el => {
            el.setAttribute('data-original-position', el.style.position);
            el.style.position = 'static';
        });

        try {
            const canvas = await html2canvas(calendarEl, { scale: 2 });
            const titleEl = this.headerEl.querySelector('h1');
            const titleText = titleEl ? titleEl.textContent : 'Calendar_Export';
            const title = titleText.replace(/[^\w\s]/gi, '_');

            const imgData = canvas.toDataURL('image/png');
            const imgWidth = 210;
            const pageHeight = 297;
            const imgHeight = (canvas.height * imgWidth) / canvas.width;
            let heightLeft = imgHeight;

            const pdf = new jsPDF('p', 'mm', 'a4');
            pdf.setDisplayMode(1, 'single', 'UseOutlines');
            let position = 0;
            pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;

            while (heightLeft >= 0) {
                position = heightLeft - imgHeight;
                pdf.addPage();
                pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
                heightLeft -= pageHeight;
            }

            pdf.save(`Calendar_View_${title}.pdf`);
        } catch (error) {
            console.error('PDF Generation Failed:', error);
        } finally {
            body.classList.remove('sc-pdf-export-mode');
            stickyHeaders.forEach(el => {
                el.style.position = el.getAttribute('data-original-position') || '';
                el.removeAttribute('data-original-position');
            });
            this.isGeneratingPdf = false;
            this.updatePdfButtonState();
        }
    }

    _hexToRgb(hex) {
        // Remove '#' if present
        hex = hex.replace(/^#/, '');
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        const bigint = parseInt(hex, 16);
        return {
            r: (bigint >> 16) & 255,
            g: (bigint >> 8) & 255,
            b: bigint & 255
        };
    }

    _generatePalette(baseRgb, count = 5) {
        // clamp helper
        const clamp = v => Math.max(0, Math.min(255, v));

        const variations = [];

        for (let i = 0; i < count; i++) {
            const factor = (i - (count - 1) / 2) / ((count - 1) / 2);

            // factor ranges from negative to positive
            // negative makes darker, positive makes lighter
            const amount = factor * 30; // adjust 30 to control strength

            variations.push({
                r: clamp(baseRgb.r + amount),
                g: clamp(baseRgb.g + amount),
                b: clamp(baseRgb.b + amount)
            });
        }

        return variations;
    }

    async generateProgramPdf() {
        const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        pdf.setDisplayMode('fullheight', 'continuous', 'UseOutlines');
        const margin = this.options.pdf.margin || 15;
        const overlayMargin = this.options.pdf.overlayMargin || 5;
        const overlayOpacity = this.options.pdf.overlayOpacity || 0.85;
        const pageW = pdf.internal.pageSize.getWidth();
        const pageH = pdf.internal.pageSize.getHeight();
        const innerW = pageW - margin * 2;
        const maxLogoW = this.options.pdf.maxLogoWidth || 30;
        const maxLogoH = this.options.pdf.maxLogoHeight || 30;
        let y = margin;

        // Load background
        let bg = null;
        if (this.options.pdf.backgroundUrl) {
            bg = await this._loadImageAsBase64(this.options.pdf.backgroundUrl);
        }
        // Add Bookmark for PDF Outline
        const addBookmark = (title, parent = null) => {
            // Get the current page number
            const pageIndex = pdf.internal.getNumberOfPages();

            //console.log(`${title} -> # ${pageIndex}`);

            // Create a destination object with pageNumber and y-coordinate (e.g., top of the page, 0)
            // Note: The y-coordinate might be ignored by some viewers, but page number should work.
            const destination = {
                pageNumber: pageIndex,
                y: 0 // You can specify a y position, e.g., 0 for top of the page
            };

            // Add the bookmark using the destination object
            pdf.outline.add(parent, title, destination);
        };
        // Draw background
        // Helper function for random number generation
        const getRandom = (min, max) => Math.random() * (max - min) + min;

        // Define a modern, harmonious color palette (e.g., professional blues, grays, and a pop of accent color)
        var fillColor = this._hexToRgb(this.options.pdf.fillColor);
        const palette = this._generatePalette(fillColor, 15);

        const drawBackground = () => {
            // 1. Draw the base page background color
            const baseColor = this._hexToRgb(this.options.pdf.backgroundColor);
            pdf.setFillColor(baseColor.r, baseColor.g, baseColor.b);
            pdf.rect(0, 0, pageW, pageH, 'F');

            // Reset opacity to 1 before adding images or overlay
            pdf.setGState(pdf.GState({ opacity: 1 }));

            if (bg) {
                // Add optional background image on top of the shapes if needed
                pdf.addImage(bg, 'JPEG', 0, 0, pageW, pageH);
            }


            // 2. Add random, harmonious geometric shapes
            const numShapes = 15; // Number of shapes to draw
            for (let i = 0; i < numShapes; i++) {
                // Select a random color from the palette
                const color = palette[Math.floor(Math.random() * palette.length)];
                pdf.setFillColor(color.r, color.g, color.b);

                // Set a low opacity so they blend into the background (e.g., 0.1 to 0.4)
                const shapeOpacity = getRandom(0.1, 0.4);
                pdf.setGState(pdf.GState({ opacity: shapeOpacity }));

                // Random position and size
                const x = getRandom(0, pageW);
                const y = getRandom(0, pageH);
                const width = getRandom(20, 150);
                const height = getRandom(20, 150);

                // Draw a rectangle or a square randomly
                if (Math.random() > 0.5) {
                    pdf.rect(x, y, width, height, 'F'); // Filled rectangle
                } else {
                    pdf.rect(x, y, Math.min(width, height), Math.min(width, height), 'F'); // Square
                }
            }

        };

        // White translucent overlay
        const drawOverlay = () => {
            // setGState usage depends on your jsPDF build; this matches your earlier usage
            try {
                pdf.setFillColor(255, 255, 255);
                pdf.setDrawColor(255, 255, 255);
                pdf.setGState(pdf.GState({ opacity: overlayOpacity }));
                pdf.rect(
                    overlayMargin,
                    overlayMargin,
                    pageW - overlayMargin * 2,
                    pageH - overlayMargin * 2,
                    'F'
                );
                pdf.setGState(pdf.GState({ opacity: 1 }));
            } catch (err) {
                // fallback: semi-opaque overlay using RGB fill without gState if not supported
                pdf.setFillColor(255, 255, 255);
                pdf.rect(
                    overlayMargin,
                    overlayMargin,
                    pageW - overlayMargin * 2,
                    pageH - overlayMargin * 2,
                    'F'
                );
            }
        };

        // Header
        const drawHeader = (title) => {
            drawBackground();
            drawOverlay();
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(18);
            pdf.text(title, margin, 12);
            pdf.setDrawColor(0, 0, 0);   // r, g, b
            pdf.setLineWidth(0.25); pdf.setLineWidth(0.2);
            pdf.line(margin, 14, pageW - margin, 14);
            pdf.setFont('helvetica', 'normal');
        };

        // Footer
        const drawFooter = () => {
            const ftxt = this.options.pdf.footerText || 'Generated by SimpleCalendar';
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(10);
            pdf.text(ftxt, margin, pageH - 8);
            var pageNum = pdf.internal.getNumberOfPages() - 1;
            pdf.text(
                String(pageNum),
                pageW - margin,
                pageH - 8,
                { align: 'right' }
            );
            pdf.setFont('helvetica', 'normal');
        };

        const drawCoverPage = async () => {
            //console.log(this.options)
            const title = this.options.pdf.cover.title || 'Title';
            const subtitle = this.options.pdf.cover.subtitle || 'SubTitle';
            const extraLines = this.options.pdf.cover.extraLines || [
                "Line 1",
                "Line 2"
            ];
            const dates = this.options.pdf.cover.dates || 'Dates';
            const location = this.options.pdf.cover.location || 'Location';
            drawBackground();
            drawOverlay();

            const parts = [];

            parts.push({ type: 'text', size: 20, text: title });
            parts.push({ type: 'text', size: 32, text: subtitle });
            extraLines.forEach(t => {
                parts.push({ type: 'text', size: 20, text: t });
            });
            parts.push({ type: 'text', size: 14, text: dates });
            parts.push({ type: 'text', size: 14, text: location });

            // Logo (handled after size calculation)
            let logoData = null;
            let logoW = 0;
            let logoH = 0;

            if (this.options.pdf.logoUrl) {
                logoData = await this._loadImageAsBase64(this.options.pdf.logoUrl);
                const img = new Image();
                img.src = logoData;
                await new Promise(res => img.onload = res);

                const natW = img.width || 1;
                const natH = img.height || 1;

                logoW = maxLogoW;
                logoH = natH * (logoW / natW);

                if (logoH > maxLogoH) {
                    logoH = maxLogoH;
                    logoW = natW * (logoH / natH);
                }

                parts.push({ type: 'image', width: logoW, height: logoH, data: logoData });
            }

            // Compute total height
            let totalH = 0;
            parts.forEach(p => {
                if (p.type === 'text') totalH += p.size + 6;
                if (p.type === 'image') totalH += p.height + 10;
            });

            const startY = (pageH - totalH) / 2;

            // Draw
            let y = startY;

            for (const p of parts) {
                if (p.type === 'text') {
                    pdf.setFontSize(p.size);
                    pdf.setFont('helvetica', 'bold');
                    const lines = pdf.splitTextToSize(p.text, pageW - margin * 4);
                    pdf.text(lines, pageW / 2, y, { align: 'center' });
                    //pdf.text(p.text, pageW / 2, y, { align: 'center' });
                    y += p.size + 6;
                }
                if (p.type === 'image') {
                    pdf.addImage(p.data, 'PNG', (pageW - p.width) / 2, y, p.width, p.height);
                    y += p.height + 10;
                }
            }

            //drawFooter();
        }
        const drawWelcomePage = async () => {
            let y = margin;
            const title = this.options.pdf.welcome.title || 'Welcome';
            const message = this.options.pdf.welcome.message || 'Welcome to this event';

            drawBackground();
            drawOverlay();

            if (title) {
                pdf.setFontSize(28);
                pdf.setFont('helvetica', 'bold');
                pdf.text(title, pageW / 2, y, { align: 'center' });
                y += 20;
            }

            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'normal');
            const lines = pdf.splitTextToSize(message, pageW - margin * 2);
            pdf.text(lines, margin, y);

            drawFooter();
        }

        await drawCoverPage();
        addBookmark('Cover'); // parent=null, title, page number


        pdf.addPage();

        await drawWelcomePage();
        addBookmark('Welcome'); // parent=null, title, page number


        //pdf.addPage();

        // -------------------------------
        // Columns + column positions (ensure `col` is defined)
        // -------------------------------
        const columns = this.options.pdf.columns || [
            { label: 'Time', key: 'timerange', width: 20 },
            { label: 'Title', key: 'title', width: 50 },
            { label: 'Speaker', key: 'speaker', width: 30 }
        ];

        const col = [];
        let curX = margin;
        columns.forEach(c => {
            const w = innerW * (c.width / 100);
            col.push({ ...c, x: curX, w });
            curX += w;
        });

        // -------------------------------
        // Group events by day
        // -------------------------------
        const eventsByDay = {};
        (this.events || []).forEach(ev => {
            const d = this._luxonToIso(ev.startDate).split('T')[0];
            if (!eventsByDay[d]) eventsByDay[d] = [];
            eventsByDay[d].push(ev);
        });
        const days = Object.keys(eventsByDay).sort();

        // -------------------------------
        // Start Program Schedule page
        // -------------------------------
        pdf.addPage();
        addBookmark('Program Schedule'); // parent=null, title, page number

        drawHeader('Program Schedule');
        y = 18;

        // Draw table header once per page
        const drawTableHeader = () => {
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(12);
            col.forEach(c => pdf.text(c.label, c.x, y));
            y += 2;
            pdf.setDrawColor(0, 0, 0);   // r, g, b
            pdf.setLineWidth(0.15);
            pdf.line(margin, y, margin + innerW, y);
            pdf.setFont('helvetica', 'normal');
            y += 6;
        };

        drawTableHeader();

        // ensureSpace will add footer to current page, then start a new page and header
        const ensureSpace = (h) => {
            if (y + h > pageH - 10) {
                // footer for the page we are leaving
                drawFooter();
                // start new page
                pdf.addPage();
                drawHeader('Program Schedule');
                y = 18;
                drawTableHeader();
            }
        };

        // -------------------------------
        // Loop through days without forcing a new page per day
        // -------------------------------
        days.forEach((day) => {
            const list = eventsByDay[day].slice().sort((a, b) => a.startDate - b.startDate);
            if (!list.length) return;

            const dateStr = list[0].startDate.toFormat(this.options.pdf.longDateFormat || 'DDD');

            // Day title - ensure space for title
            ensureSpace(12);
            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(14);
            y += 8;
            pdf.text(dateStr, margin, y);
            pdf.setFont('helvetica', 'normal');
            y += 8;
            pdf.setFontSize(12);

            // Events for the day
            list.forEach((ev, evIndex) => {
                const row = {
                    timerange:
                        ev.startDate.toFormat(this.options.pdf.timeLabelFormat)
                        + '-'
                        + ev.endDate.toFormat(this.options.pdf.timeLabelFormat),

                    title: this.htmlToText(ev.title + (ev.subtitle ? `: ${ev.subtitle}` : '') + (ev.note ? `\n${ev.note}` : '')) || '',

                    speaker: ev.speaker || ev.details?.speaker || '',
                    moderator: ev.moderator || ev.details?.moderator || '',
                    room: ev.room || ev.details?.room || ''
                };

                // Calculate wrapped text and row height
                const wrapped = {};
                let rowHeight = 6;
                col.forEach(c => {
                    const text = row[c.key] || '';
                    wrapped[c.key] = pdf.splitTextToSize(text, c.w - 2);
                    const h = wrapped[c.key].length * 6;
                    if (h > rowHeight) rowHeight = h;
                });

                // Page break if needed for the row
                ensureSpace(rowHeight);

                // Draw line **above the text**
                const fillColor = this._hexToRgb(this.options.pdf.fillColor);
                pdf.setDrawColor(fillColor.r, fillColor.g, fillColor.b);
                pdf.setLineWidth(0.15);
                pdf.line(margin, y, margin + innerW, y); // draw at current y before text

                // Draw row text
                col.forEach(c => {
                    pdf.text(wrapped[c.key], c.x, y + 4);
                });

                y += rowHeight;
            });

            // small gap after a day's events
            y += 4;
        });

        // Draw footer for the final schedule page
        drawFooter();

        const drawClosing = async () => {
            let y = margin;
            const title = this.options.pdf.closing.title || 'Closing Title';
            const message = this.options.pdf.closing.message || 'Closing Message';

            drawBackground();
            drawOverlay();

            if (title) {
                pdf.setFontSize(28);
                pdf.setFont('helvetica', 'bold');
                pdf.text(title, pageW / 2, y, { align: 'center' });
                y += 20;
            }

            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'normal');
            const lines = pdf.splitTextToSize(message, pageW - margin * 2);
            pdf.text(lines, margin, y);

            drawFooter();
        }

        pdf.addPage();
        addBookmark('Closing Remarks'); // parent=null, title, page number

        await drawClosing();

        const drawCommittee = async () => {
            const colGap = this.options.pdf.committee.colGap || 10;

            // Automatically choose 2 or 3 columns unless user forces it
            const columns = this.options.pdf.committee.columns || (pageW > pageH ? 3 : 2);

            const colW = (pageW - margin * 2 - (columns - 1) * colGap) / columns;
            const cardH = this.options.pdf.committee.cardHeight || 55;     // Height per entry

            const title = this.options.pdf.committee.title || 'Committee';
            const message = this.options.pdf.committee.message || 'Committee Message';

            if (typeof drawHeader === 'function') drawHeader(title);  // Assuming drawHeader is globally available

            let x = margin;
            let y = margin + 4;

            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'normal');
            const lines = pdf.splitTextToSize(message, pageW - margin * 2);
            pdf.text(lines, margin, y);
            y += 14 * lines.length;

            for (const member of this.options.pdf.committee.list) {

                // New page if needed
                if (y + cardH > pageH - margin) {
                    pdf.addPage();
                    y = margin;
                }

                // Text positions
                const tx = x;
                let ty = y + 4;

                pdf.setFontSize(12);
                pdf.setFont('Helvetica', 'bold');
                //console.info(member.name + ', ' + tx + ', ' + ty)
                pdf.text(member.name, tx, ty);

                ty += 5;
                pdf.setFont('Helvetica', 'normal');
                pdf.text(member.role, tx, ty);

                ty += 5;
                pdf.text(member.affiliation, tx, ty);

                if (member.location) {
                    ty += 5;
                    pdf.text(member.location, tx, ty);
                }

                // if (member.email) {
                //     ty += 5;
                //     pdf.setFontSize(9);
                //     pdf.text(member.email, tx, ty);
                // }

                // Next column
                x += colW + colGap;

                // If end of row, reset x and move y down
                if (x + colW > pageW - margin) {
                    x = margin;
                    y += cardH + 8;
                    //console.error(`passed height, recalculating to... ${x}, ${y}`)
                }
            }
            drawFooter();
        }

        pdf.addPage();
        addBookmark('Committee'); // parent=null, title, page number
        await drawCommittee();

        const drawSponsors = async () => {
            const colGap = this.options.pdf.sponsors.colGap || 10;

            // Auto choose columns unless user forces it
            const columns = this.options.pdf.sponsors.columns || (pageW > pageH ? 3 : 2);

            const colW = (pageW - margin * 2 - (columns - 1) * colGap) / columns;

            // Height per card, taller than committee because of logos
            const cardH = this.options.pdf.sponsors.cardHeight || 70;

            const title = this.options.pdf.sponsors.title || "Sponsors";
            const message = this.options.pdf.sponsors.message || 'Closing Message';

            if (typeof drawHeader === "function") {
                drawHeader(title);
            }

            let x = margin;
            let y = margin + 4;

            pdf.setFontSize(14);
            pdf.setFont('helvetica', 'normal');
            const lines = pdf.splitTextToSize(message, pageW - margin * 2);
            pdf.text(lines, margin, y);
            y += 14 * lines.length;

            for (const sponsor of this.options.pdf.sponsors.list) {
                if (sponsor.level) {// Start a new page if card wont fit
                    if (y + cardH > pageH - margin) {
                        pdf.addPage();
                        y = margin;
                    }

                    // Draw sponsor logo if available
                    let maxImgW = 40; // maximum width
                    let maxImgH = 20; // maximum height
                    let imgH = 20;
                    let imgW = 40;
                    let imgX = x;
                    let imgY = y;

                    if (sponsor.image_url) {
                        try {
                            const imgData = await this._loadImageAsBase64(sponsor.image_url);

                            // Create an Image object to get original dimensions
                            const img = new Image();
                            img.src = imgData;

                            await new Promise((resolve, reject) => {
                                img.onload = resolve;
                                img.onerror = reject;
                            });

                            // Calculate aspect ratio
                            const ratio = Math.min(maxImgW / img.width, maxImgH / img.height);
                            const imgW = img.width * ratio;
                            const imgH = img.height * ratio;

                            pdf.addImage({
                                imageData: imgData,
                                format: "PNG",
                                x: imgX,
                                y: imgY,
                                width: imgW,
                                height: imgH
                            });

                        } catch (err) {
                            console.warn("Failed to load sponsor logo", sponsor.image_url, err);
                        }
                    }


                    // Text content
                    let tx = x;
                    let ty = y + imgH + 5;

                    pdf.setFontSize(12);
                    pdf.setFont("Helvetica", "bold");
                    pdf.text(sponsor.name, tx, ty);

                    pdf.setFont("Helvetica", "normal");
                    pdf.setFontSize(10);

                    if (sponsor.level) {
                        ty += 5;
                        pdf.text(`Level: ${sponsor.level}`, tx, ty);
                    }

                    if (sponsor.type) {
                        ty += 5;
                        pdf.text(`Type: ${sponsor.type}`, tx, ty);
                    }

                    if (sponsor.website) {
                        ty += 5;
                        pdf.setFontSize(9);
                        pdf.text(sponsor.website, tx, ty);
                    }

                    // Move to next column
                    x += colW + colGap;

                    // If next card would overflow row width, wrap to next row
                    if (x + colW > pageW - margin) {
                        x = margin;
                        y += cardH + 8;
                    }
                }
            }

            drawFooter();
        };

        pdf.addPage();
        addBookmark('Sponsors'); // parent=null, title, page number
        await drawSponsors();


        pdf.save('Conference_Program.pdf');
    }



    async _loadImageAsBase64(url) {
        const res = await fetch(url);
        const blob = await res.blob();
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
    }

}
