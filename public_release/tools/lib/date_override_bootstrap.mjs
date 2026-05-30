// Set RESEARCH_OS_OVERRIDE_DATE from CLI --date=YYYY-MM-DD arg before any other modules load.
// This must be imported before stage modules so buildRuntimeConfig() sees the override.
const dateArg = (process.argv || []).find((x) => x.startsWith("--date="));
if (dateArg) {
  const overrideDateStr = dateArg.split("=")[1];
  if (overrideDateStr) {
    process.env.RESEARCH_OS_OVERRIDE_DATE = overrideDateStr;
  }
}
