"use strict";

const assert = require("node:assert/strict");
const engine = require("../assets/js/shared/calendar-engine.js");

const definition = engine.normalizeDefinition({
    name: "Mondo lungo",
    weekdays: ["A", "B", "C"],
    months: [{ id: "alpha", name: "Alpha", days: 10 }, { id: "beta", name: "Beta", days: 5 }],
    timeSystem: { hoursPerDay: 30, minutesPerHour: 20 }
});

assert.equal(engine.formatTime(definition, { hour: 29, minute: 19 }), "29:19");
assert.deepEqual(
    engine.shiftClock(definition, { date: { year: 1, monthId: "alpha", day: 10 }, time: { hour: 29, minute: 10 } }, 15, "minute"),
    { revision: 1, date: { year: 1, monthId: "beta", day: 1 }, time: { hour: 0, minute: 5 }, updatedAt: "", updatedBy: "" }
);
assert.deepEqual(
    engine.shiftClock(definition, { date: { year: 1, monthId: "alpha", day: 1 }, time: { hour: 0, minute: 5 } }, -15, "minute").date,
    { year: 0, monthId: "beta", day: 5 }
);
assert.deepEqual(engine.addDays(definition, { year: 0, monthId: "beta", day: 5 }, 1), { year: 1, monthId: "alpha", day: 1 });
assert.equal(engine.weekdayIndex(definition, engine.addDays(definition, { year: 0, monthId: "alpha", day: 1 }, 1)), 1);
assert.equal(engine.normalizeTime(definition, { hour: 30, minute: 0 }, { strict: true }), null);

console.log("Calendar engine: tutti i test superati.");
