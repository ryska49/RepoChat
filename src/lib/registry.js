/**
 * registry.js
 *
 * Manages the persistent repository catalog (.index/registry.json).
 * Automatically discovers:
 *   1. Repos in repos/
 *   2. Existing persisted index files in .index/*.json
 *   3. Custom local paths added by the user
 */

import fs from "fs";
import path from "path";

const REGISTRY_PATH = path.resolve(".index", "registry.json");

export function getRegistry() {
  const list = [];
  const seenNames = new Set();
  const seenPaths = new Set();

  // 1. Read existing registry.json if present
  if (fs.existsSync(REGISTRY_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item.name && !seenNames.has(item.name)) {
            seenNames.add(item.name);
            seenPaths.add(item.path);
            list.push(item);
          }
        }
      }
    } catch {}
  }

  // 2. Auto-discover from .index/*.json (e.g. demo.json, Distributed_rate_limiter.json)
  const idxDir = path.resolve(".index");
  if (fs.existsSync(idxDir)) {
    try {
      const idxFiles = fs.readdirSync(idxDir).filter(f => f.endsWith(".json") && f !== "registry.json");
      for (const f of idxFiles) {
        const repoName = f.replace(/\.json$/, "");
        if (seenNames.has(repoName)) continue;

        const fullIdxPath = path.join(idxDir, f);
        try {
          const raw = fs.readFileSync(fullIdxPath, "utf-8");
          const parsed = JSON.parse(raw);
          const chunkCount = parsed.entries ? parsed.entries.length : 0;
          if (chunkCount === 0) continue; // skip empty or corrupt indexes

          let detectedPath = `repos/${repoName}`;
          if (parsed.entries[0]?.doc?.metadata?.source) {
            const firstSrc = parsed.entries[0].doc.metadata.source;
            const match = firstSrc.match(/(.+?[\\/]repos[\\/][^\\/]+)/i);
            if (match) {
              detectedPath = match[1];
            } else {
              const extMatch = firstSrc.match(/(.+?[\\/](?:Distributed_rate_limiter|demo|campuscourier)[^\\/]*)/i);
              if (extMatch) detectedPath = extMatch[1];
            }
          }

          seenNames.add(repoName);
          seenPaths.add(detectedPath);
          list.push({
            id: repoName,
            name: repoName,
            path: detectedPath,
            chunkCount,
            indexPath: fullIdxPath,
          });
        } catch {}
      }
    } catch {}
  }

  // 3. Auto-discover from repos/ folder
  const reposDir = path.resolve("repos");
  if (fs.existsSync(reposDir)) {
    try {
      const subdirs = fs.readdirSync(reposDir, { withFileTypes: true }).filter(d => d.isDirectory());
      for (const d of subdirs) {
        if (!seenNames.has(d.name)) {
          seenNames.add(d.name);
          list.push({
            id: d.name,
            name: d.name,
            path: `repos/${d.name}`,
            chunkCount: null,
          });
        }
      }
    } catch {}
  }

  return list;
}

export function registerRepo(name, repoPath, chunkCount = 0) {
  const list = getRegistry().filter(r => r.name !== name && r.path !== repoPath);
  const item = {
    id: name,
    name,
    path: repoPath,
    chunkCount,
    updatedAt: new Date().toISOString(),
  };
  list.unshift(item);

  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(list, null, 2), "utf-8");
  return item;
}
