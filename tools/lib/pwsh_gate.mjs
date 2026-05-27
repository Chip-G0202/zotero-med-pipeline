function toInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

export function parsePwshVersion(rawOutput = "") {
  const raw = String(rawOutput || "");
  const normalized = raw.trim();
  if (!normalized) {
    return {
      raw,
      detected_version: "unknown",
      major: null,
      minor: null,
      patch: null,
      unknown: true,
    };
  }

  const match = normalized.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return {
      raw,
      detected_version: "unknown",
      major: null,
      minor: null,
      patch: null,
      unknown: true,
    };
  }

  const major = toInt(match[1]);
  const minor = toInt(match[2]);
  const patch = toInt(match[3] ?? 0);
  return {
    raw,
    detected_version: `${major}.${minor}.${patch}`,
    major,
    minor,
    patch,
    unknown: false,
  };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

export function evaluatePwshGate({
  rawVersionOutput = "",
  requiredMinVersion = "7.0.0",
  commandStatus = 0,
} = {}) {
  const parsedDetected = parsePwshVersion(rawVersionOutput);
  const parsedMin = parsePwshVersion(requiredMinVersion);
  const parseFailed = parsedDetected.unknown || parsedMin.unknown;
  const satisfies = parseFailed ? false : compareSemver(parsedDetected, parsedMin) >= 0;
  const versionUnknown = parsedDetected.unknown || commandStatus !== 0;
  const passed = !versionUnknown && satisfies;
  const warning = versionUnknown || !satisfies;

  let message = "";
  if (versionUnknown) {
    message = "pwsh version unknown; continue with degraded audit";
  } else if (satisfies) {
    message = `pwsh ${parsedDetected.detected_version} satisfies minimum ${parsedMin.detected_version}`;
  } else {
    message = `pwsh ${parsedDetected.detected_version} is below minimum ${parsedMin.detected_version}`;
  }

  return {
    ok: passed,
    pwsh_required_min_version: parsedMin.detected_version,
    pwsh_detected_version: parsedDetected.detected_version,
    pwsh_detected_major: parsedDetected.major,
    pwsh_version_satisfies_minimum: satisfies,
    pwsh_gate_passed: passed,
    pwsh_version_unknown: versionUnknown,
    pwsh_gate_warning: warning,
    pwsh_gate_message: message,
    pwsh_raw_version_output: String(rawVersionOutput || ""),
  };
}

