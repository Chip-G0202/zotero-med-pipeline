export function parseCandidates(raw, defaults) {
  const src = String(raw || "").trim();
  if (!src) return [...defaults];
  return [...new Set(src.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n) && n > 0))];
}

export function getAggressiveDefaults() {
  return {
    writeback: [1, 3, 6, 8, 10, 12],
    translation: [1, 4, 8, 12, 16, 20],
  };
}

export function shouldStopEscalation(result, prevStable) {
  if (!result) return true;
  if (result.status !== "stable") return true;
  if (result.failure_rate > 0.05) return true;
  if (result.fallback_to_serial) return true;
  if (result.duplicate_detected_count > 0) return true;
  if (result.wrong_collection_detected_count > 0) return true;
  if (result.shortTitle_mismatch_count > 0) return true;
  if ((result.mcp_errors || []).some((e) => /database busy|transaction failed|timeout|429|limit|lock/i.test(String(e)))) return true;
  if (prevStable && result.avg_ms_per_item > prevStable.avg_ms_per_item * 1.2) return true;
  if (prevStable && result.retry_count > (prevStable.retry_count || 0) * 2 + 2) return true;
  return false;
}

export function recommendConcurrency(results) {
  const stable = (results || []).filter((r) => r.status === "stable");
  if (!stable.length) return 1;
  let best = stable[0];
  for (const r of stable) {
    const faster = r.avg_ms_per_item < best.avg_ms_per_item * 0.95;
    const similarSpeed = Math.abs(r.avg_ms_per_item - best.avg_ms_per_item) / Math.max(1, best.avg_ms_per_item) < 0.05;
    const lowerRisk = (r.retry_count || 0) <= (best.retry_count || 0) && !r.fallback_to_serial;
    if (faster && lowerRisk) best = r;
    if (similarSpeed && r.concurrency < best.concurrency && lowerRisk) best = r;
  }
  return best.concurrency;
}

export function classifyCreateMix(result) {
  const attempted = Number(result?.items_attempted || 0);
  const reused = Number(result?.reused_count || 0);
  if (!attempted) return "insufficient";
  if (reused / attempted > 0.2) return "mixed_create_reuse";
  return "new_create_heavy";
}

export function buildNonOverlappingAllocations({
  uniqueItems,
  concurrencies,
  preferredSizes = [60, 30, 20],
}) {
  const available = uniqueItems.length;
  let sampleSize = 0;
  for (const s of preferredSizes) {
    if (available >= s * concurrencies.length) {
      sampleSize = s;
      break;
    }
  }
  if (!sampleSize) {
    sampleSize = preferredSizes[preferredSizes.length - 1];
  }
  const allocations = [];
  let offset = 0;
  for (const c of concurrencies) {
    const rest = available - offset;
    if (rest <= 0) break;
    const size = Math.min(sampleSize, rest);
    if (size < sampleSize && size < 10) break;
    allocations.push({
      concurrency: c,
      sample_offset: offset,
      sample_size: size,
      sample_items: uniqueItems.slice(offset, offset + size),
    });
    offset += size;
  }
  const tested = allocations.map((x) => x.concurrency);
  const skipped = concurrencies.filter((x) => !tested.includes(x));
  return {
    sample_size: sampleSize,
    allocations,
    skipped_concurrencies: skipped,
    available_unique_items: available,
    sample_limited: skipped.length > 0 || allocations.some((a) => a.sample_size < sampleSize),
  };
}
