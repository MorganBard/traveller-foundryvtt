import { MGT2 } from "./config.mjs";

// Maps a "sensor" hardware item's checkbox fields (item-hardware-sheet.html) onto the Sensor
// Target table's 7 suite columns. Active/Passive Radar and Lidar each collapse into one column
// per the book - hasJammers is excluded entirely, that's Electronic Warfare, not detection.
const SUITE_CHECKS = {
    visual: item => item.system.hardware?.hasVisual,
    thermal: item => item.system.hardware?.hasThermal,
    em: item => item.system.hardware?.hasEM,
    activeRadarLidar: item => item.system.hardware?.hasActiveLidar || item.system.hardware?.hasActiveRadar,
    passiveRadarLidar: item => item.system.hardware?.hasLidar || item.system.hardware?.hasRadar,
    nas: item => item.system.hardware?.hasNAS,
    densitometer: item => item.system.hardware?.hasDensitometer
};

const GRADE_RANK = { none: 0, minimal: 1, limited: 2, full: 3 };

// Every sensor suite shipActor has installed, ORed across every "sensor" hardware item it carries
// (a ship can have more than one) - returns an array of suite keys from SUITE_CHECKS above.
export function installedSensorSuites(shipActor) {
    const sensorItems = shipActor.items.filter(i => i.type === "hardware" && i.system.hardware?.system === "sensor");
    return Object.keys(SUITE_CHECKS).filter(suite => sensorItems.some(item => SUITE_CHECKS[suite](item)));
}

// Best detail-grade tier (1-4) shipActor can achieve on a target at the given Range Band, per the
// Core Rulebook Sensor Target table - the best grade among every suite it has installed, not an
// independent per-suite readout (see plan for reasoning). Callers apply the "undetected" tier-0
// check themselves via the detected_<id> flag, since this function only knows about equipment and
// range, not detection state.
export function sensorDetailTier(shipActor, band) {
    const suites = installedSensorSuites(shipActor);
    let bestGrade = "none";
    for (const suite of suites) {
        const grade = MGT2.SENSOR_DETAIL_GRADE[suite]?.[band] ?? "none";
        if (GRADE_RANK[grade] > GRADE_RANK[bestGrade]) {
            bestGrade = grade;
        }
    }
    return { none: 1, minimal: 2, limited: 3, full: 4 }[bestGrade];
}

// Short display label for a resolved tier (1-4), for surfaces that just want a one-word summary
// (e.g. the GM Fleet Status panel) rather than the full progressive field reveal.
export function sensorDetailGradeLabel(tier) {
    return { 1: "None", 2: "Minimal", 3: "Limited", 4: "Full" }[tier] ?? "Unknown";
}
