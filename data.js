async function loadGoogleSheets(data) {

    const programSheetUrl = data.program.programSheetUrl;
    const typeColorsUrl = data.program.typeColorsSheetUrl;

    // Fetch both sheets in parallel
    const [programResponse, colorsResponse] = await Promise.all([
        fetch(programSheetUrl),
        fetch(typeColorsUrl)
    ]);

    // Convert CSV into text
    const programCsv = await programResponse.text();
    const colorsCsv = await colorsResponse.text();

    // Parse CSV into objects
    const programRows = Papa.parse(programCsv, { header: true }).data;
    const colorRows = Papa.parse(colorsCsv, { header: true }).data;

    // Map: type to color
    const typeColors = {};
    colorRows.forEach(row => {
        if (row.type && row.color) {
            typeColors[row.type] = row.color;
        }
    });

    // Output object for the calendar
    const programJson = { typeColors, events: [] };

    // Process each program row
    programRows.forEach(row => {

        // Skip invalid rows early
        if (!row.start || !row.end) return;

        try {

            // Create event record
            const event = {
                title: row.id || "",
                subtitle: row.title || "",
                note: "",
                start: null,
                end: null,
                details: {}          // renamed from extendedProps
            };

            // Validate required fields
            if (!row.date) {
                throw new Error("Missing date in row: " + JSON.stringify(row));
            }
            if (!row.start || !row.end) {
                throw new Error("Missing start or end time for row: " + JSON.stringify(row));
            }

            // Construct ISO start and end values
            const startIso = new Date(row.date + "T" + row.start + ":00");
            const endIso = new Date(row.date + "T" + row.end + ":00");

            if (isNaN(startIso.getTime())) {
                throw new Error("Invalid start time: " + row.date + " " + row.start);
            }
            if (isNaN(endIso.getTime())) {
                throw new Error("Invalid end time: " + row.date + " " + row.end);
            }

            // FullCalendar uses strings as valid date inputs
            event.start = row.date + "T" + row.start + ":00";
            event.end = row.date + "T" + row.end + ":00";

            // Details section, previously extendedProps
            event.details.type = row.type || "session";
            event.details.speaker = row.speaker || null;
            event.details.id = row.id || "";
            event.details.room = row.room || "";
            event.details.session = row.session || null;
            event.details.mode = row.mode || "";
            event.details.moderator = row.moderator || null;

            // Look up color by session type
            event.color = typeColors[event.details.type] || "#999999";
            event.textColor = getContrastForeColor(event.color);

            // Save event into output list
            programJson.events.push(event);

        } catch (err) {

            // Failure log for debugging
            console.error("Error creating event record");
            console.error("Row with error:", row);
            console.error("Error message:", err.message);
        }
    });

    // Merge events based on session rules
    programJson.events = mergeEventsBySession(programJson.events);
    //console.log(programJson.events);
    return programJson;
}


function mergeEventsBySession(events) {
    presenterSVg = `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" width="16" height="16" style="display:inline" viewBox="4 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
    // Container for grouped events by session
    const grouped = {};

    events.forEach(ev => {

        // Extract the session value from the event
        let session = ev.details.session;

        // Determine if session is valid. If not valid, create a unique key so this event stands alone.
        const sessionKey = (session && session.trim() !== "" && session.trim().toLowerCase() !== "n/a")
            ? session
            : `unique_session${Math.floor(Math.random() * 1000000)}`;

        // Check if we already have a grouped event for this session
        if (!grouped[sessionKey]) {

            // This block runs for the first event that belongs to a session group

            const p = ev.details;

            // Determine if the event has a non empty id that is not auto generated
            const hasId = p.id
                && p.id.trim() !== ""
                && !p.id.includes("unique_session");

            // Determine if the event has a title
            const hasTitle = ev.title
                && ev.title.trim() !== "";
            const hasSpeaker = ev.details
                && ev.details.speaker
                && ev.details.speaker.trim() !== "";
            const presenterHtml = hasSpeaker ? `<span style="display:inline-flex; align-items:center; margin-bottom:5px">${presenterSVg} <span>${ev.details.speaker}</span></span>` : '';
            //console.log(`${ev.title} hasId: ${hasId} hasTitle:${hasTitle}`);
            // Build the base title for the merged event
            var note = p.session ?
                `${hasId && hasTitle
                    ? `<span style='text-decoration: underline;'>${p.id}</span>: <span style='font-weight:400;'>${ev.subtitle}</span>\n${presenterHtml}`
                    : hasId
                        ? `<span style='text-decoration: underline;'>${p.id}</span>`
                        : hasTitle
                            ? ev.title
                            : ""
                }` :
                ''
                ;
            var title = '';
            var subtitle = ev.subtitle;
            var speaker = ev.details.speaker;
            // If a session value exists, prepend a session label with optional mode
            if (p.session) {

                let sessionMode = "";

                // "clean" is assumed to check for non empty values
                if (clean(p.session)) {
                    sessionMode = `${p.session}`;

                    // If mode exists, append it in parentheses
                    if (clean(p.mode)) {
                        sessionMode += ` (${p.mode})`;
                    }
                }

                // Add the session label before the title
                title = `<span>${sessionMode}</span>`;
                subtitle = '';
                speaker = '';
            } else {
                title = p.id;          
            }

            // Create the initial grouped event entry by cloning fields from the event
            grouped[sessionKey] = {
                ...ev,
                title: title,
                subtitle: subtitle,
                start: ev.start,
                end: ev.end,
                note: note,
                details: { ...ev.details, speaker:speaker }
            };

        } else {

            // This block runs for additional events belonging to the same session group
            const g = grouped[sessionKey];

            // Append additional title information from this event into the merged group
            if (ev.details.id || ev.subtitle) {
                const hasSpeaker = ev.details
                    && ev.details.speaker
                    && ev.details.speaker.trim() !== "";
                const presenterHtml = hasSpeaker ? `<span style="display:inline-flex; align-items:center; margin-bottom:5px">${presenterSVg} <span>${ev.details.speaker}</span></span>` : '';

                g.note +=
                    "\n"
                    + `<span style='text-decoration: underline;'>${ev.details.id}</span>`
                    + ": "
                    + `<span style='font-weight:400;'>${ev.subtitle}</span>`
                    + `\n${presenterHtml}`;
            }

            // Expand start time to earliest among merged events
            g.start = g.start < ev.start ? g.start : ev.start;

            // Expand end time to latest among merged events
            g.end = g.end > ev.end ? g.end : ev.end;
        }
    });

    // Convert grouped object back to array
    return Object.values(grouped);
}


async function fetchData() {
    //console.log('loading program...');
    try {
        const response = await fetch('data.json');
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const data = await response.json();
        const programData = await loadGoogleSheets(data);
        //console.log(programData)
        allEvents = programData.events;
        //console.log(programJson);
        return allEvents;
    } catch (err) {
        console.error(err)
    }
}

function getContrastForeColor(color) {
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

const clean = v => v && v.trim() !== "" && v.trim().toLowerCase() !== "n/a";

// Function to check if the value is a valid hex color
function isHexColor(value) {
    // Hex color regex (handles 6 or 3 digit hex colors with or without a leading '#')
    const hexPattern = /^#?([0-9A-Fa-f]{3}){1,2}$/;
    return hexPattern.test(value);
}

// Expanded list of color names to hex codes
const colorNames = {
    "red": "#ff0000",
    "green": "#008000",
    "blue": "#0000ff",
    "yellow": "#ffff00",
    "black": "#000000",
    "white": "#ffffff",
    "pink": "#ffc0cb",
    "purple": "#800080",
    "orange": "#ffa500",
    "brown": "#a52a2a",
    "gray": "#808080",
    "silver": "#c0c0c0",
    "gold": "#ffd700",
    "cyan": "#00ffff",
    "magenta": "#ff00ff",
    "lime": "#00ff00",
    "teal": "#008080",
    "navy": "#000080",
    "indigo": "#4b0082",
    "violet": "#ee82ee",
    "turquoise": "#40e0d0",
    "coral": "#ff7f50",
    "salmon": "#fa8072",
    "orchid": "#da70d6",
    "khaki": "#f0e68c",
    "plum": "#dda0dd",
    "darkgreen": "#006400",
    "lightgreen": "#90ee90",
    "darkblue": "#00008b",
    "lightblue": "#add8e6",
    "seashell": "#fff5ee",
    "mintcream": "#f5fffa",
    "peachpuff": "#ffdab9"
};

// Function to get hex value from either color name or hex input
function getHexColor(value) {
    if (isHexColor(value)) {
        return value.startsWith("#") ? value : "#" + value; // Ensure hex has a leading '#'
    }
    // If not a valid hex color, check if it's a color name
    const color = colorNames[value.toLowerCase()];
    return color || null; // Return hex color if found, otherwise null
}