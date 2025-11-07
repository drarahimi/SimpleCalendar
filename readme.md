# SimpleCalendar

SimpleCalendar is a lightweight, timezone aware, multi day calendar component implemented in plain JavaScript. It supports event rendering, overlapping event layout, multi day views, PDF export, search filtering, and dynamic timezone conversion using Luxon.

This project is suitable for embedding into conference websites, academic schedules, program overviews, or any application that needs a clean, interactive time based layout without pulling in heavy calendar libraries.

---

## Features

- Multi day views (1, 3, 5, 10 day or custom)
- Timezone conversion between an original event timezone and the user's local timezone
- Auto fitting of vertical time range based on visible events
- Overlapping event collision layout with lane calculation
- Customizable event display templates
- Search filtering for live event lookup
- PDF export (full calendar view or structured program PDF)
- Event tooltips with speaker, room, and metadata
- Responsive layout with Tailwind utility classes

---

## Installation

Include the script and its dependencies (Luxon, jsPDF and html2canvas pro):

```html
<script src="simplecalendar.js"></script>
```

The library automatically loads Luxon, jsPDF, and html2canvas pro from CDNs when instantiated.

---

## Basic Usage

Add a container element:

```html
<div id="calendarContainer"></div>
```

Prepare an event list:

```js
const events = [
  {
    id: 1,
    title: "Opening Session",
    start: "2025-06-10T09:00:00",
    end: "2025-06-10T10:00:00",
    color: "#4098fd",
    textColor: "#ffffff",
    details: {
      speaker: "Dr. Smith",
      room: "Auditorium A",
      track: "General"
    }
  }
];
```

Create the calendar:

```js
const calendar = new SimpleCalendar("calendarContainer", events, {
  originalTimezone: "America/New_York",
  userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  initialView: "Day3",
  autoFitEvents: true
});
```

---

## Options

The constructor accepts a third parameter with configuration options:

### Timezone Options

- `originalTimezone`: The timezone used by incoming event ISO strings.
- `userTimezone`: The timezone used for rendering.

### View Options

- `initialView`: Any view defined in `views`.
- `views`: A dictionary of view definitions:
  ```js
  views: {
    Day1: { type: "timeGrid", durationDays: 1, buttonText: "1 Day" },
    Day3: { type: "timeGrid", durationDays: 3, buttonText: "3 Days" }
  }
  ```

### Time Grid Options

- `slotMinTime`: Default earliest time of day to show.
- `slotMaxTime`: Default latest time of day to show.
- `autoFitEvents`: Automatically contracts or expands the time range to fit event boundaries.
- `hourHeightpx`: Height of one hour in pixels.

### Behavior Hooks

- `datesSet(info)`: Callback when the calendar changes its visible date range.
- `eventDidMount(info)`: Callback when an event box is rendered.
- `eventContent(arg)`: Custom renderer returning HTML for an event.

---

## Event Object Format

Events must include at least:

```js
{
  id: 123,
  title: "My Event",
  start: "2025-06-12T13:00:00",
  end: "2025-06-12T14:00:00"
}
```

Optional properties:

- `color`: Background color
- `textColor`: Event text color
- `subtitle`: Secondary line
- `note`: Additional description
- `details`: Arbitrary metadata (speaker, room, track etc.)

The library converts all start and end values from the original timezone to the user's timezone automatically using Luxon.

---

## PDF Export

Two export methods are available:

### 1. Full Calendar PDF
```js
calendar.generatePdf();
```
Captures the entire calendar view as an image and exports it as a PDF.

### 2. Program Style PDF
```js
calendar.generateProgramPdf();
```
Produces a structured PDF with times, titles, and speakers grouped per day.

---

## Searching Events

The calendar automatically attaches search behavior to the input with id:
```html
<input type="search" id="sc-eventSearch">
```
Filtering happens instantly and uses all major event fields.

---

## Styling

The component uses Tailwind utility classes for layout and style. To customize appearance, override or extend Tailwind classes in your environment.

---

## Timezone Handling Overview

- Input events: interpreted in `originalTimezone`.
- Rendered times: displayed in `userTimezone`.
- All layout computations use the user timezone to avoid visual drift.
- Start and end are converted using Luxon `DateTime.setZone`.

---

## License

Specify your project's license here.

---

## Contributing

Contributions, bug reports, and feature requests are welcome. Submit issues or pull requests through the repository.

