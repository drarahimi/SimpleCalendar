// Load dependencies
async function loadDependencies() {
    try {
        await loadScript('https://cdn.jsdelivr.net/npm/luxon@3/build/global/luxon.min.js');
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await loadScript('https://github.com/yorickshan/html2canvas-pro/releases/download/v1.5.12/html2canvas-pro.min.js');
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

// Format a JS Date (assumed in userTimezone) to YYYY-MM-DD (user zone)
function formatDateUserZone(date, DateTime, userZone) {
    if (!date) return '';
    return DateTime.fromJSDate(date, { zone: userZone }).toFormat('yyyy-MM-dd');
}

// Add days to a JS Date (preserve time) using Luxon in user timezone
function addDaysJS(date, days, DateTime, userZone) {
    return DateTime.fromJSDate(date, { zone: userZone }).plus({ days }).toJSDate();
}

// Compare same day in user's timezone
function isSameDayUserZone(d1, d2, DateTime, userZone) {
    const dt1 = DateTime.fromJSDate(d1, { zone: userZone }).startOf('day');
    const dt2 = DateTime.fromJSDate(d2, { zone: userZone }).startOf('day');
    return dt1.equals(dt2);
}

// Convert ISO string from original timezone to a JS Date in user timezone
function convertISOOriginalToUserJS(isoString, DateTime, originalZone, userZone) {
    if (!isoString) return null;
    return DateTime.fromISO(isoString, { zone: originalZone }).setZone(userZone).toJSDate();
}

// Convert JS Date (in user timezone) -> ISO string in given zone (default user)
function formatISOInZoneFromJS(date, DateTime, zone) {
    if (!date) return '';
    return DateTime.fromJSDate(date, { zone }).toISO({ suppressMilliseconds: true, suppressSeconds: false, includeOffset: false });
}

// Format long date for PDFs in user zone
function formatLongDateInZoneFromJS(date, DateTime, zone) {
    if (!date) return '';
    return DateTime.fromJSDate(date, { zone }).toFormat('EEEE, LLLL d, yyyy');
}

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
            slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
            timeZone: this.userTimezone,
            visibleRange: null, // interpreted in originalTimezone
            validRange: null,   // interpreted in originalTimezone
            views: {
                Day1: { type: 'timeGrid', durationDays: 1, buttonText: '1 Day' },
                Day3: { type: 'timeGrid', durationDays: 3, buttonText: '3 Days' },
                Day5: { type: 'timeGrid', durationDays: 5, buttonText: '5 Days' },
                Day10: { type: 'timeGrid', durationDays: 10, buttonText: '10 Days' }
            },
            headerToolbar: { left: 'prev,next', center: 'title', right: 'Day1,Day3' },
            allDaySlot: false,
            events: [],
            datesSet: null,
            eventDidMount: null,
            eventContent: null
        }, options);
        //console.log('events in simpleCalendar:');
        //console.log(events);
        this.originalTimezone = this.options.originalTimezone || (this.DateTime ? this.DateTime.local().zoneName : Intl.DateTimeFormat().resolvedOptions().timeZone);
        this.DateTime = (typeof luxon !== 'undefined') ? luxon.DateTime : null;

        if (!this.DateTime) {
            console.warn('Luxon not found. Timezone-safe features will be degraded.');
        }

        // userTimezone fallback: provided param or detect via Intl if luxon missing
        this.userTimezone = this.options.userTimezone || (this.DateTime ? this.DateTime.local().zoneName : Intl.DateTimeFormat().resolvedOptions().timeZone);

        this.initialDate = this.options.initialDate || (this.DateTime ? this.DateTime.local().setZone(this.userTimezone).toFormat('yyyy-MM-dd') : new Date().toISOString().split('T')[0]);

        // parse visible/valid ranges into DateTime (original zone) if provided
        this.visibleRange = this._parseRangeOriginal(this.options.visibleRange);
        this.validRange = this._parseRangeOriginal(this.options.validRange);

        // parse initial view/date -> store currentDate as JS Date in user timezone
        this.currentView = this.options.initialView || 'Day1';
        this.currentDate = this._convertInitialDateToUserJS(this.options.initialDate);

        // slot times (minutes)
        this.slotMinMinutes = this._timeStringToMinutes(this.options.slotMinTime);
        this.slotMaxMinutes = this._timeStringToMinutes(this.options.slotMaxTime);
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

        // jsPDF and html2canvas will be bound at runtime if present
        this.jsPDF = (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF) ? window.jspdf.jsPDF : null;
        this.html2canvas = (typeof window !== 'undefined' && window.html2canvas) ? window.html2canvas : null;

        this.isGeneratingPdf = false;
        this._resetting = false;

        this.init();
    }

    // ---- Helper / parsing ----

    // Parse visible/valid range into objects with DateTime in original timezone
    _parseRangeOriginal(range) {
        if (!range) return null;
        const out = {};
        if (range.start) {
            // treat start as start of day in original timezone
            out.start = this.DateTime.fromISO(range.start, { zone: this.originalTimezone }).startOf('day');
        } else {
            out.start = null;
        }
        if (range.end) {
            // treat end as end-of-day in original timezone (we'll use exclusive end)
            out.end = this.DateTime.fromISO(range.end, { zone: this.originalTimezone }).endOf('day');
        } else {
            out.end = null;
        }
        return out;
    }

    // convert initial ISO-like date (YYYY-MM-DD or ISO) into JS Date in user timezone
    _convertInitialDateToUserJS(iso) {
        if (!iso) return new Date();
        // if simple YYYY-MM-DD -> start of day in user timezone
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
            if (this.DateTime) {
                return this.DateTime.fromISO(iso, { zone: this.userTimezone }).startOf('day').toJSDate();
            } else {
                // fallback: naive JS Date at midnight (browser local) then treat as user timezone
                return new Date(iso + 'T00:00:00');
            }
        }
        // otherwise treat as ISO in original timezone then convert to user timezone
        if (this.DateTime) {
            return this.DateTime.fromISO(iso, { zone: this.originalTimezone }).setZone(this.userTimezone).toJSDate();
        } else {
            return new Date(iso);
        }
    }

    // Convert raw events (start/end in original timezone ISO strings) to event objects with both original DateTimes and user JS Dates
    _convertEventsToUserZone(events) {
        if (!events || !this.DateTime) return (events || []).map(ev => Object.assign({}, ev));
        return (events || []).map(ev => {
            const originalStartDT = this.DateTime.fromISO(ev.start, { zone: this.originalTimezone });
            const originalEndDT = this.DateTime.fromISO(ev.end, { zone: this.originalTimezone });
            const startUserJS = originalStartDT.setZone(this.userTimezone).toJSDate();
            const endUserJS = originalEndDT.setZone(this.userTimezone).toJSDate();

            return Object.assign({}, ev, {
                _originalStartDT: originalStartDT,
                _originalEndDT: originalEndDT,
                startDate: startUserJS, // JS Date used for rendering/layout (in user timezone)
                endDate: endUserJS
            });
        });
    }

    //A perfect user facing string uses the zone plus its current offset. Uses Luxon since your project already loads it.
    _friendlyTzWithOffset(tz) {
        const dt = luxon.DateTime.now().setZone(tz);
        const offset = dt.offset / 60;
        const offsetText = offset >= 0 ? "UTC+" + offset : "UTC" + offset;
        const name = tz.split("/").pop().replace('_', ' ');
        return "" + name + " (" + offsetText + ")";
    }

    // For range comparisons: convert a JS date (assumed in user timezone) to a DateTime in original timezone (startOf day)
    _toOriginalZoneDT_fromUserJSStartOfDay(jsDate) {
        if (!this.DateTime) return DateTime.fromJSDate(jsDate).startOf('day');
        const dtUser = this.DateTime.fromJSDate(jsDate, { zone: this.userTimezone }).startOf('day');
        return dtUser.setZone(this.originalTimezone).startOf('day');
    }

    _toOriginalZoneDT_fromUserJSEndOfDay(jsDate) {
        if (!this.DateTime) return DateTime.fromJSDate(jsDate).endOf('day');
        const dtUser = this.DateTime.fromJSDate(jsDate, { zone: this.userTimezone }).endOf('day');
        return dtUser.setZone(this.originalTimezone).endOf('day');
    }

    _timeStringToMinutes(t) {
        if (!t) return 0;
        const parts = t.split(':').map(p => parseInt(p, 10));
        return (parts[0] || 0) * 60 + (parts[1] || 0);
    }

    _clampDateToValidRangeUserJS(jsDate) {
        if (!this.validRange || !this.DateTime) return jsDate;
        // convert user jsDate to original zone DT startOf day for comparison
        const candidateOriginalDayStart = this._toOriginalZoneDT_fromUserJSStartOfDay(jsDate);
        let clampedOriginal = candidateOriginalDayStart;

        if (this.validRange.start && clampedOriginal < this.validRange.start) {
            clampedOriginal = this.validRange.start;
        }
        if (this.validRange.end && clampedOriginal > this.validRange.end) {
            clampedOriginal = this.validRange.end;
        }
        // convert clampedOriginal (original zone DateTime) back to user JS Date at its startOf('day') in user zone
        const asUser = clampedOriginal.setZone(this.userTimezone).startOf('day').toJSDate();
        return asUser;
    }

    // Auto-fit slotMin and slotMax based on events in current view
    _autoFitSlotTimes(eventsByDay) {
        if (!eventsByDay || Object.keys(eventsByDay).length === 0) return;

        let minMinutes = 24 * 60; // start with max possible
        let maxMinutes = 0;        // start with min possible

        Object.values(eventsByDay).forEach(dayEvents => {
            dayEvents.forEach(event => {
                const startDT = this.DateTime.fromJSDate(event.dayStart, { zone: this.userTimezone });
                const endDT = this.DateTime.fromJSDate(event.dayEnd, { zone: this.userTimezone });
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

        // expose calendar globally for your button inline handlers
        window.calendar = this;

        this.render();
    }

    // setView(viewName) {
    //     if (viewName === 'Full' && this.options.views?.Full) {
    //         this.currentView = 'Full';
    //     } else {
    //         this.currentView = 'day';
    //     }
    //     this.render();
    //     this._callDatesSet();
    // }
    setView(viewName) {
        if (this.options.views[viewName]) {
            this.currentView = viewName;
        } else {
            this.currentView = Object.keys(this.options.views)[0];
        }
        this.render();
        this._callDatesSet();
    }

    changeDate(days) {
        // days relative shift in user timezone
        const next = addDaysJS(this.currentDate, days, this.DateTime, this.userTimezone);
        // clamp to validRange if present (validRange interpreted in original timezone)
        const clamped = this._clampDateToValidRangeUserJS(next);
        this.currentDate = clamped;

        // if visibleRange present, ensure we don't navigate outside it (visibleRange in original timezone)
        if (this.visibleRange && this.DateTime) {
            const candidateOriginal = this._toOriginalZoneDT_fromUserJSStartOfDay(this.currentDate);
            if (this.visibleRange.start && candidateOriginal < this.visibleRange.start) {
                // move to visibleRange.start but convert to user js date
                this.currentDate = this.visibleRange.start.setZone(this.userTimezone).startOf('day').toJSDate();
            }
            if (this.visibleRange.end && candidateOriginal > this.visibleRange.end) {
                this.currentDate = this.visibleRange.end.setZone(this.userTimezone).startOf('day').toJSDate();
            }
        }

        this.render();
        this._callDatesSet();
    }

    gotoDate(iso) {
        this.currentDate = this._convertInitialDateToUserJS(iso);
        // clamp
        this.currentDate = this._clampDateToValidRangeUserJS(this.currentDate);
        this.render();
        this._callDatesSet();
    }

    // Return list of JS Date objects (start-of-day in user timezone) for current view
    getDatesForView() {
        const dayCount = this.options.views[this.currentView]?.durationDays || 1;
        const dates = [];
        // base DateTime in user timezone for currentDate start-of-day
        const baseDT = this.DateTime.fromJSDate(this.currentDate, { zone: this.userTimezone }).startOf('day');
        for (let i = 0; i < dayCount; i++) {
            const d = baseDT.plus({ days: i }).toJSDate();
            dates.push(d);
        }
        return dates;
    }

    // get events that intersect visible minutes of the day (all computations in user timezone)
    getEventsForView(dates) {
        const eventsByDay = {};
        dates.forEach(date => {
            eventsByDay[formatDateUserZone(date, this.DateTime, this.userTimezone)] = [];
        });

        this.events.forEach(event => {
            dates.forEach(date => {
                const dayKey = formatDateUserZone(date, this.DateTime, this.userTimezone);

                // day start & end in user timezone
                const dayStartDT = this.DateTime.fromJSDate(date, { zone: this.userTimezone }).startOf('day');
                const dayStartMS = dayStartDT.toMillis();
                const dayEndMS = dayStartDT.plus({ days: 1 }).toMillis();

                // event start/end are stored as JS Date in user timezone (startDate/endDate)
                const eventStartMS = this.DateTime.fromJSDate(event.startDate, { zone: this.userTimezone }).toMillis();
                const eventEndMS = this.DateTime.fromJSDate(event.endDate, { zone: this.userTimezone }).toMillis();

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
                            dayStart: new Date(adjustedStartMS),
                            dayEnd: new Date(adjustedEndMS),
                            originalStart: event._originalStartDT ? event._originalStartDT.toJSDate() : event.startDate,
                            originalEnd: event._originalEndDT ? event._originalEndDT.toJSDate() : event.endDate
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
            const startOfDayDT = this.DateTime.fromJSDate(event.dayStart, { zone: this.userTimezone }).startOf('day');
            const startOfDayMS = startOfDayDT.toMillis();

            const startMinutes = (event.dayStart.getTime() - (startOfDayMS + this.slotMinMinutes * MS_PER_MINUTE)) / MS_PER_MINUTE;
            const endMinutes = (event.dayEnd.getTime() - (startOfDayMS + this.slotMinMinutes * MS_PER_MINUTE)) / MS_PER_MINUTE;
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
            this.setUpSearch();
        }

        // apply classes for view
        this.viewEl.className = this.viewEl.className.replace(/sc-day-view|sc-three-day-view/g, '').trim();
        // if (this.currentView === 'day') {
        //     this.viewEl.classList.add('sc-day-view');
        //     this.renderDayView();
        // } else {
        //     this.viewEl.classList.add('sc-three-day-view');
        //     this.renderThreeDayView();
        // }
        const dayCount = this.options.views[this.currentView]?.durationDays || 1;

        this.viewEl.classList.add('sc-multi-day-view');

        this.renderMultiDayView(dayCount);
    }

    renderHeader() {
        const dates = this.getDatesForView();
        const startDate = dates[0];
        const endDate = dates[dates.length - 1];

        const viewTitle = this._formatViewTitleUserZone(startDate, endDate);

        const leftButtons = this.options.headerToolbar?.left || 'prev,next';
        const center = this.options.headerToolbar?.center || 'title';
        const rightButtons = this.options.headerToolbar?.right || 'Day1,Day3,Day5,Day10';

        const leftHtml = leftButtons.includes('prev')
            ? `<button onclick="window.calendar.changeDate(-${dates.length})" class="p-2 rounded-lg hover:bg-gray-400 transition ease-in-out duration-300"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path d="M11.354 1.646 L5.354 7.646 L11.354 13.646" stroke="currentColor" stroke-width="2" fill="none" /></svg></button>`
            : '';

        const leftHtml2 = leftButtons.includes('next')
            ? `<button onclick="window.calendar.changeDate(${dates.length})" class="p-2 rounded-lg hover:bg-gray-400 transition ease-in-out duration-300"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" class="ms-auto"><path d="M4.646 1.646 L10.646 7.646 L4.646 13.646" stroke="currentColor" stroke-width="2" fill="none" /></svg></button>`
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
        //const userTz = this.userTimezone;
        //const offsetMinutes = new Date().getTimezoneOffset() * -1;
        //const offsetHours = offsetMinutes / 60;
        this.headerEl.innerHTML = `
        <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center w-full no-print space-y-2 sm:space-y-0 sm:space-x-4">
            <!-- Title row -->
            <div class="sc-date-container w-full sm:w-auto sm:items-center sm:ml-2 flex flex-col" style="align-items:center;">
                <span class="text-3xl font-bold text-gray-800 leading-tight truncate">
                    ${viewTitle}
                </span>
                <span class="text-sm text-gray-600 truncate">
                    ${this._friendlyTzWithOffset(this.userTimezone)}
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
    _formatViewTitleUserZone(startDateJS, endDateJS) {
        const dtStart = this.DateTime.fromJSDate(startDateJS, { zone: this.userTimezone });
        const dtEnd = this.DateTime.fromJSDate(endDateJS, { zone: this.userTimezone });

        if (dtStart.toMillis() === dtEnd.toMillis()) {
            return dtStart.toFormat('LLLL d, yyyy');
        }
        const sameMonth = dtStart.month === dtEnd.month;
        const sameYear = dtStart.year === dtEnd.year;
        if (sameMonth && sameYear) {
            return `${dtStart.toFormat('LLL')} ${dtStart.day}-${dtEnd.day}, ${dtStart.year}`;
        }
        return `${dtStart.toFormat('LLL d')} - ${dtEnd.toFormat('LLL d, yyyy')}`;
    }

    renderMultiDayView() {
        const dates = this.getDatesForView();
        const eventsByDay = this.getEventsForView(dates);
        // Auto-fit slot min/max to visible events
        if (this.options.autoFitEvents && this.searchEl.value.length === 0)
            this._autoFitSlotTimes(eventsByDay);
        else {
            this.slotMinMinutes = this._timeStringToMinutes(this.options.slotMinTime);
            this.slotMaxMinutes = this._timeStringToMinutes(this.options.slotMaxTime);
        }

        let columnHeaders = `<div class="grid sc-time-grid border-b border-gray-200 sticky top-0 bg-white z-20" style="grid-template-columns: 50px repeat(${dates.length}, minmax(0, 1fr));">`;
        columnHeaders += '<div class="col-span-1 border-r border-gray-100 p-2 text-sm text-center bg-gray-50">Time</div>';

        dates.forEach(date => {
            const dayKey = formatDateUserZone(date, this.DateTime, this.userTimezone);
            const isToday = isSameDayUserZone(date, new Date(), this.DateTime, this.userTimezone);
            columnHeaders += `<div class="col-span-1 p-2 text-sm text-center font-semibold ${isToday ? 'text-primary bg-blue-100' : 'text-gray-700 bg-gray-50'} border-r border-gray-100">
                ${this.DateTime.fromJSDate(date, { zone: this.userTimezone }).toFormat('ccc d')}
            </div>`;
            eventsByDay[dayKey] = this.calculateEventLayout(eventsByDay[dayKey] || []);
        });
        columnHeaders += '</div>';

        let dayContent = '';
        dates.forEach(date => {
            const dayKey = formatDateUserZone(date, this.DateTime, this.userTimezone);
            const dayEvents = eventsByDay[dayKey] || [];
            const dayName = this.DateTime.fromJSDate(date, { zone: this.userTimezone }).toFormat('ccc d');
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
            const dt = this.DateTime.fromJSDate(this.currentDate, { zone: this.userTimezone }).set({ hour: h, minute: 0, second: 0, millisecond: 0 });
            const hourDisplay = dt.toLocaleString(this.options.slotLabelFormat || { hour: '2-digit', minute: '2-digit', hour12: false });
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
            const nowDT = this.DateTime.local().setZone(this.userTimezone);
            const sampleDayDT = this.DateTime.fromJSDate(sampleDay, { zone: this.userTimezone }).startOf('day');
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

    getContrastForeColor(color) {
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
    isHexColor(value) {
        // Hex color regex (handles 6 or 3 digit hex colors with or without a leading '#')
        const hexPattern = /^#?([0-9A-Fa-f]{3}){1,2}$/;
        return hexPattern.test(value);
    }
    // Function to get hex value from either color name or hex input
    getHexColor(value) {
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
            const eventTextColor = event.textColor || this.getContrastForeColor(eventColor);
            const eventTitle = event.title || '';
            const eventSubtitle = event.subtitle || '';
            const eventNote = event.note || '';
            const eventModerator = event.details?.moderator || '';
            const hasRoom = event.details?.room
                && event.details?.room.trim() !== ""
                && !event.details?.room.toLowerCase().includes("n/a");
            const eventRoom = hasRoom? `${roomSvg}${event.details?.room}` : '';
            const hasVideoLink = event.details?.videolink
                && event.details?.videolink.trim() !== ""
                && !event.details?.videolink.toLowerCase().includes("n/a");
            const eventVideoLink = hasVideoLink? `${videoSvg} <a target='_blank' href='${event.details?.videolink}'>${event.details?.videolink}</a>` : '';

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
            const start = this.DateTime.fromJSDate(event.dayStart, { zone: this.userTimezone });
            const end = this.DateTime.fromJSDate(event.dayEnd, { zone: this.userTimezone });
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

    _callDatesSet() {
        if (typeof this.options.datesSet !== 'function') return;
        const dates = this.getDatesForView();

        const info = {
            view: { type: (this.currentView || 'Day1') },
            // start & end strings should be formatted in user timezone for display, but represent true day boundaries
            startStr: formatISOInZoneFromJS(dates[0], this.DateTime, this.userTimezone),
            endStr: formatISOInZoneFromJS(addDaysJS(dates[dates.length - 1], 1, this.DateTime, this.userTimezone), this.DateTime, this.userTimezone)
        };

        // If Full view and out of visibleRange, reset to initial
        if (this.options.views.Full && this.visibleRange && info.view.type === 'Full') {
            const startISO = info.startStr.split('T')[0];
            const visibleStartUserJS = this.visibleRange.start ? this.visibleRange.start.setZone(this.userTimezone).toFormat('yyyy-MM-dd') : null;
            if (this.visibleRange.start && startISO !== visibleStartUserJS && !this._resetting) {
                this._resetting = true;
                console.log(`${info.startStr}-${info.endStr} 3day view out of range, resetting`);
                const gotoIso = this.options.visibleRange?.start ? this.options.visibleRange.start : this.options.initialDate;
                this.gotoDate(gotoIso);
                this._resetting = false;
                return;
            }
        }

        try {
            this.options.datesSet(info);
        } catch (err) {
            console.warn('datesSet handler threw', err);
        }
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
                const tooltip = document.createElement('div');
                tooltip.className = 'absolute z-50 hidden bg-gray-900 text-white text-sm rounded px-2 py-1 shadow-lg max-w-full break-words';

                tooltip.innerHTML = el.innerHTML;
                document.body.appendChild(tooltip);

                const offset = 10;

                const positionTip = (e) => {
                    const tipRect = tooltip.getBoundingClientRect();
                    const pageWidth = window.innerWidth;
                    const pageHeight = window.innerHeight;

                    let x = e.pageX + offset;
                    let y = e.pageY + offset;

                    if (x + tipRect.width > pageWidth) {
                        x = pageWidth - tipRect.width - offset;
                    }
                    if (y + tipRect.height > pageHeight) {
                        y = pageHeight - tipRect.height - offset;
                    }

                    tooltip.style.left = x + 'px';
                    tooltip.style.top = y + 'px';
                };

                const showTip = (e) => {
                    tooltip.classList.remove('hidden');
                    positionTip(e);
                };

                const moveTip = (e) => {
                    positionTip(e);
                };

                const hideTip = () => {
                    tooltip.classList.add('hidden');
                };

                el.addEventListener('mouseenter', showTip);
                el.addEventListener('mousemove', moveTip);
                el.addEventListener('mouseleave', hideTip);

            }
        });
    }

    // ---- PDF functions ----
    htmlToText(html) {
        const temp = document.createElement('div');
        temp.innerHTML = html;
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

    async generateProgramPdf() {
        const pdf = new jsPDF('p', 'mm', 'a4');
        const margin = 15;
        let y = margin;

        const title = 'Conference Program';
        const welcomeNote = `Welcome to our scientific meeting. We are pleased to present a program that brings together researchers, educators, and innovators. We hope you enjoy the sessions, exchange ideas, and build collaborations.`;
        const closingNote = `Thank you for participating. We appreciate your contributions and hope to see you at future events.`;

        pdf.setFontSize(22);
        pdf.text(title, margin, y);
        y += 15;

        pdf.setFontSize(12);
        const welcomeLines = pdf.splitTextToSize(welcomeNote, 180);
        pdf.text(welcomeLines, margin, y);

        pdf.addPage();

        // Group events by ISO date in user timezone
        const eventsByDay = {};
        this.events.forEach(ev => {
            const d = formatISOInZoneFromJS(ev.startDate, this.DateTime, this.userTimezone);
            const key = d.split('T')[0];
            if (!eventsByDay[key]) eventsByDay[key] = [];
            eventsByDay[key].push(ev);
        });

        const sortedDays = Object.keys(eventsByDay).sort();

        sortedDays.forEach((day, index) => {
            if (index > 0) pdf.addPage();
            y = margin;

            const dateStr = formatLongDateInZoneFromJS(eventsByDay[day][0].startDate, this.DateTime, this.userTimezone);

            pdf.setFontSize(16);
            pdf.text(dateStr, margin, y);
            y += 10;

            pdf.setFontSize(12);
            pdf.text('Time', margin, y);
            pdf.text('Title', margin + 35, y);
            pdf.text('Speaker', margin + 120, y);
            y += 6;

            pdf.setLineWidth(0.1);
            pdf.line(margin, y, 200, y);
            y += 4;

            const dayEvents = eventsByDay[day].slice().sort((a, b) => a.startDate - b.startDate);
            dayEvents.forEach(ev => {
                const start = this.DateTime.fromJSDate(ev.startDate, { zone: this.userTimezone }).toFormat('HH:mm');
                const end = this.DateTime.fromJSDate(ev.endDate, { zone: this.userTimezone }).toFormat('HH:mm');
                const timeRange = start + '-' + end;

                pdf.text(timeRange, margin, y);

                const titleLines = pdf.splitTextToSize(this.htmlToText(ev.title) || '', 75);
                pdf.text(titleLines, margin + 35, y);

                const speaker = ev.speaker || ev.details?.speaker || '';
                const speakerLines = pdf.splitTextToSize(speaker, 70);
                pdf.text(speakerLines, margin + 120, y);

                const blockHeight = Math.max(titleLines.length, speakerLines.length) * 6;
                y += blockHeight;

                if (y > 260) {
                    pdf.addPage();
                    y = margin;
                }
            });
        });

        pdf.addPage();

        pdf.setFontSize(18);
        pdf.text('Closing Remarks', margin, y);
        y += 12;

        pdf.setFontSize(12);
        const closingLines = pdf.splitTextToSize(closingNote, 180);
        pdf.text(closingLines, margin, y);

        pdf.save('Conference_Program.pdf');
    }
}
