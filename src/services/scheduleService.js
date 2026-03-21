const { optionalBoolean, optionalEnum, optionalTime } = require("../lib/validation");

const SCHEDULE_FREQUENCIES = ["manual", "daily", "weekly"];

function normalizeScheduleSettings(payload, options = {}) {
  const isCreate = options.mode !== "update";
  const settings = {};

  if (isCreate || payload.schedule_enabled !== undefined) {
    settings.schedule_enabled = optionalBoolean(
      payload.schedule_enabled,
      "schedule_enabled",
      false
    );
  }

  if (isCreate || payload.schedule_frequency !== undefined) {
    settings.schedule_frequency = optionalEnum(
      payload.schedule_frequency,
      "schedule_frequency",
      SCHEDULE_FREQUENCIES,
      "manual"
    );
  }

  if (isCreate || payload.schedule_time !== undefined) {
    settings.schedule_time = optionalTime(payload.schedule_time, "schedule_time");
  }

  return settings;
}

function applyTime(date, timeValue) {
  const [hours, minutes, seconds] = (timeValue || "00:00:00")
    .split(":")
    .map((part) => Number(part));

  const nextDate = new Date(date);
  nextDate.setUTCHours(hours, minutes, seconds || 0, 0);
  return nextDate;
}

function calculateNextRunAt(scheduleFrequency, scheduleEnabled, scheduleTime, baseDate = new Date()) {
  if (!scheduleEnabled || scheduleFrequency === "manual") {
    return null;
  }

  const anchor = new Date(baseDate);
  const nextDate = new Date(anchor);

  if (scheduleFrequency === "daily") {
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  } else if (scheduleFrequency === "weekly") {
    nextDate.setUTCDate(nextDate.getUTCDate() + 7);
  }

  return applyTime(nextDate, scheduleTime).toISOString();
}

module.exports = {
  SCHEDULE_FREQUENCIES,
  calculateNextRunAt,
  normalizeScheduleSettings
};
