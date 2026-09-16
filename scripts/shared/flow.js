(function () {
  const API_BASE = "https://io.eklas.dev";
  const CURRENT_VERSION = "6.0";

  function getLicenseKey(store) {
    return "";
  }

  async function getStoredLovableEmail() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return "";
    return new Promise((resolve) => {
      chrome.storage.local.get(["lovable_email", "eu_user_email", "ql_user_email"], (items) => {
        resolve(String(items.lovable_email || items.eu_user_email || items.ql_user_email || "").trim().toLowerCase());
      });
    });
  }

  function normalizeValidation(payload, key) {
    const license = payload && payload.license ? payload.license : {};
    const config = payload && payload.config ? payload.config : {};
    const brandName = config.brandName || config.brandText || license.bound_email || "Lovable";
    return {
      valid: true,
      message: payload && payload.ok === false ? (payload.error || "Standalone mode") : "Standalone mode",
      reason: payload?.status || payload?.reason || "standalone",
      session_id: payload?.session_id || null,
      user_name: brandName,
      expires_at: license.expires_at || null,
      activated_at: license.created_at || null,
      status: license.plan || license.status || "standalone",
      license_id: payload?.license_id || null,
      email: license.bound_email || payload?.email || null,
      online_count: payload?.online_count || 0,
      config,
      branding: normalizeBranding(config),
      operations: normalizeOperations(config),
      extensionV5: config?.extensionV5 || {},
      raw: payload || null,
      key,
    };
  }

  function normalizeBranding(config) {
    const social = config?.socialLinks || {};
    return {
      brandName: config?.brandName || "Lovable",
      brandText: config?.brandText || config?.brandName || "Lovable",
      logoUrl: config?.logoUrl || "",
      socialLinks: social,
      footerText: social.poweredBy || `${config?.brandText || config?.brandName || "Lovable"} • v${CURRENT_VERSION}`,
      badgeText: config?.badgeText || config?.badge || config?.badge_text || "",
    };
  }

  function normalizeOperations(config) {
    return {
      forceUpgrade: config?.forceUpgrade || {},
      maintenance: config?.maintenance || {},
    };
  }

  function compareVersions(left, right) {
    const a = String(left || "").split(".").map((item) => Number(item) || 0);
    const b = String(right || "").split(".").map((item) => Number(item) || 0);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const diff = (a[index] || 0) - (b[index] || 0);
      if (diff !== 0) return diff;
    }
    return 0;
  }

  function shouldBlockForUpgrade(operations) {
    const upgrade = operations?.forceUpgrade || {};
    if (!upgrade.enabled) return false;
    const minimum = upgrade.minimumSupportedVersion || upgrade.minSupportedVersion || "";
    const latest = upgrade.latestVersion || "";
    const mandatory = String(upgrade.mode || "").toLowerCase() === "mandatory";
    if (minimum && compareVersions(CURRENT_VERSION, minimum) < 0) return true;
    const enforcementTime = upgrade.enforcementDate
      ? new Date(upgrade.enforcementDate).getTime()
      : 0;
    const enforcementReached =
      !Number.isFinite(enforcementTime) || !enforcementTime || Date.now() >= enforcementTime;
    if (mandatory && enforcementReached && latest && compareVersions(CURRENT_VERSION, latest) < 0) return true;
    if (!minimum && !latest) return mandatory && enforcementReached;
    return false;
  }

  function shouldShowUpgrade(operations) {
    const upgrade = operations?.forceUpgrade || {};
    if (!upgrade.enabled) return false;
    const latest = upgrade.latestVersion || "";
    return shouldBlockForUpgrade(operations) || (latest && compareVersions(CURRENT_VERSION, latest) < 0);
  }

  function isMaintenanceActive(operations) {
    const maintenance = operations?.maintenance || {};
    if (!maintenance.enabled) return false;
    if (maintenance.services && maintenance.services.extension === false) return false;
    if (maintenance.emergency) return true;
    const now = Date.now();
    const starts = maintenance.startsAt ? new Date(maintenance.startsAt).getTime() : 0;
    const ends = maintenance.endsAt ? new Date(maintenance.endsAt).getTime() : 0;
    return (!starts || now >= starts) && (!ends || now <= ends);
  }

  function storageState(normalized) {
    const branding = normalized.branding || {};
    const operations = normalized.operations || {};
    const extensionV5 = normalized.extensionV5 || {};
    return {
      eu_branding: branding,
      eu_operations: operations,
      eu_extension_v5: extensionV5,
      ql_branding: branding,
      ql_operations: operations,
      ql_extension_v5: extensionV5,
    };
  }

  function clearKeys() {
    return [];
  }

  async function improvePrompt(prompt, key) {
    const response = await fetch(`${API_BASE}/api/v1/ai/improve-prompt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-License-Key": key || "",
      },
      body: JSON.stringify({
        prompt,
        licenseKey: key || "",
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && !payload.error) payload.error = `HTTP ${response.status}`;
    return {
      ...payload,
      optimized_prompt: payload.optimized_prompt || payload.text || "",
    };
  }

  async function sendChat(message, key, opts) {
    const options = opts || {};
    const response = await fetch(`${API_BASE}/api/v1/lovable/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-License-Key": key || "",
      },
      body: JSON.stringify({
        message,
        licenseKey: key || "",
        projectId: options.projectId || "",
        clientGitSha: options.clientGitSha || "",
        files: Array.isArray(options.files) ? options.files : [],
        optimisticImageUrls: Array.isArray(options.optimisticImageUrls)
          ? options.optimisticImageUrls
          : [],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && !payload.error) payload.error = `HTTP ${response.status}`;
    return payload;
  }

  async function uploadMedia(file, key) {
    const response = await fetch(`${API_BASE}/api/v1/media/upload`, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "X-License-Key": key || "",
        "X-File-Name": file.name || "attachment",
      },
      body: file,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Upload failed: ${response.status}`);
    return {
      file_id:
        payload.id ||
        payload.key ||
        payload.objectKey ||
        payload.object_key ||
        payload.public_url ||
        payload.url,
      file_name:
        payload.name ||
        payload.originalName ||
        payload.original_name ||
        file.name ||
        "file",
      public_url: payload.publicUrl || payload.public_url || payload.url,
      raw: payload,
    };
  }

  async function getNotifications() {
    const payload = await getExtensionV5Runtime();
    return payload.notifications || [];
  }

  async function getExtensionV5Runtime() {
    const response = await fetch(`${API_BASE}/api/v1/extension/v5?version=${encodeURIComponent(CURRENT_VERSION)}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Runtime config failed: ${response.status}`);
    return payload && typeof payload === "object" ? payload : {};
  }

  function applyBranding(root, branding) {
    if (!root || !branding) return;
    const brandText = branding.brandText || branding.brandName || "Lovable";
    root.querySelectorAll(".ql-brand-text,.sp-brand-text").forEach((item) => {
      item.textContent = brandText;
    });
    root.querySelectorAll(".ql-footer-version,.sp-footer-badge").forEach((item) => {
      item.textContent = branding.footerText || `${brandText} • v${CURRENT_VERSION}`;
    });
    if (branding.logoUrl) {
      root.querySelectorAll(".ql-brand-logo,.ql-title-logo,.sp-brand-logo").forEach((item) => {
        item.src = branding.logoUrl;
      });
    }
    const badgeText = branding.badgeText || branding.badge || branding.statusText || "";
    if (badgeText) {
      root.querySelectorAll(".ql-status-badge, .sp-status-badge").forEach((item) => {
        item.textContent = badgeText.toUpperCase();
      });
    }

    // Dynamic social links rendering
    const social = branding.socialLinks || {};
    const config = {
      websiteUrl: social.websiteUrl || social.website || '',
      facebookUrl: social.facebookUrl || social.facebook || '',
      youtubeUrl: social.youtubeUrl || social.youtube || '',
      instagramUrl: social.instagramUrl || social.instagram || '',
      telegramUrl: social.telegramUrl || social.telegram || '',
      whatsappUrl: social.whatsappUrl || social.whatsapp || '',
      tiktokUrl: social.tiktokUrl || social.tiktok || '',
      redditUrl: social.redditUrl || social.reddit || '',
      linkedinUrl: social.linkedinUrl || social.linkedin || '',
      xUrl: social.xUrl || social.twitterUrl || social.x || social.twitter || '',
      items: Array.isArray(social.items) ? social.items : [],
    };

    const items = socialItemsFromConfig(config);
    root.querySelectorAll(".ql-social-links, .sp-social-links").forEach((container) => {
      container.innerHTML = '';
      const isSidepanel = container.classList.contains('sp-social-links');
      const itemClass = isSidepanel ? 'sp-social-link' : 'ql-social-link';
      for (const item of items) {
        if (!item.url) continue;
        const link = document.createElement('a');
        link.className = itemClass;
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.title = item.label;
        if (item.iconUrl) {
          const img = document.createElement('img');
          img.src = item.iconUrl;
          img.alt = '';
          img.width = 11;
          img.height = 11;
          link.appendChild(img);
        } else {
          const span = document.createElement('span');
          span.textContent = socialFallback(item);
          span.setAttribute('aria-hidden', 'true');
          link.appendChild(span);
        }
        container.appendChild(link);
      }
      container.hidden = items.every((item) => !item.url);
    });
  }

  function socialItemsFromConfig(config) {
    const fromItems = Array.isArray(config.items) ? config.items : [];
    const legacy = [
      ['website', 'Website', config.websiteUrl],
      ['facebook', 'Facebook', config.facebookUrl],
      ['youtube', 'YouTube', config.youtubeUrl],
      ['instagram', 'Instagram', config.instagramUrl],
      ['whatsapp', 'WhatsApp', config.whatsappUrl],
      ['tiktok', 'TikTok', config.tiktokUrl],
      ['reddit', 'Reddit', config.redditUrl],
      ['linkedin', 'LinkedIn', config.linkedinUrl],
      ['x', 'X', config.xUrl],
      ['telegram', 'Telegram', config.telegramUrl],
    ].map(([platform, label, url]) => ({ platform, label, url: url || '', iconUrl: '' }));
    const byKey = new Map();
    for (const item of [...legacy, ...fromItems]) {
      const key = String(item.platform || item.label || 'custom').toLowerCase();
      byKey.set(key + ':' + String(item.url || item.href || ''), {
        platform: key,
        label: String(item.label || item.name || item.platform || 'Social'),
        url: String(item.url || item.href || ''),
        iconUrl: String(item.iconUrl || item.icon || ''),
      });
    }
    return [...byKey.values()];
  }

  function socialFallback(item) {
    const map = {
      website: 'W',
      facebook: 'fb',
      youtube: 'yt',
      instagram: 'in',
      whatsapp: 'wa',
      tiktok: 'tk',
      reddit: 'rd',
      linkedin: 'ln',
      x: 'X',
      telegram: 'tg',
    };
    return map[item.platform] || item.label.slice(0, 2);
  }


  function renderBlockPage(kind, operations) {
    const upgrade = operations?.forceUpgrade || {};
    const maintenance = operations?.maintenance || {};
    const isMaintenance = kind === "maintenance";
    const title = isMaintenance ? "Maintenance in progress" : "Update required";
    const eyebrow = isMaintenance ? "Service status" : "Extension update";
    const statusLabel = isMaintenance
      ? maintenance.emergency
        ? "Emergency maintenance"
        : "Scheduled maintenance"
      : upgrade.latestVersion
        ? `Version ${upgrade.latestVersion} available`
        : "New version available";
    const message = isMaintenance
      ? maintenance.message || "We are performing scheduled maintenance. Please try again later."
      : upgrade.message || "A new version is available. Please update to continue.";
    const url = isMaintenance ? maintenance.landingPageUrl : upgrade.downloadUrl;
    const windowText = isMaintenance && (maintenance.startsAt || maintenance.endsAt)
      ? `<div class="sp-block-meta"><span>${maintenance.startsAt ? "Starts " + formatBlockDate(maintenance.startsAt) : "Started"}</span><span>${maintenance.endsAt ? "Ends " + formatBlockDate(maintenance.endsAt) : "End time pending"}</span></div>`
      : "";
    const notes = !isMaintenance && upgrade.releaseNotes
      ? `<div class="sp-block-notes"><div class="sp-block-notes-title">Release notes</div><p>${escapeHtml(upgrade.releaseNotes)}</p></div>`
      : "";
    const action = url
      ? `<a class="sp-block-action" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${isMaintenance ? "Open status page" : "Update extension"}</a>`
      : "";
    const reassurance = isMaintenance
      ? "Your license and settings are safe. Access will return when maintenance is complete."
      : "Update from the official download link to continue using all extension features.";
    const icon = isMaintenance
      ? '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M21 12a9 9 0 1 1-3.2-6.9" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M21 4v5h-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M6 11l6-6 6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 21h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    return `<div class="sp-block-page ${isMaintenance ? "sp-block-maintenance" : "sp-block-upgrade"}"><style>
.sp-block-page{--block-accent:#a259ff;--block-accent-2:#ff5a00;min-height:calc(100vh - 118px);display:flex;align-items:center;justify-content:center;padding:28px 16px;background:radial-gradient(circle at 8% 0,rgba(162,89,255,.16),transparent 38%),radial-gradient(circle at 100% 20%,rgba(255,90,0,.12),transparent 34%),linear-gradient(180deg,rgba(255,255,255,.015),transparent);color:var(--ql-text,#fff)}
.sp-block-maintenance{--block-accent:#3b82f6;--block-accent-2:#22c55e}
.sp-block-card{position:relative;overflow:hidden;width:100%;max-width:370px;border:1px solid rgba(255,255,255,.11);background:linear-gradient(155deg,rgba(27,27,32,.96),rgba(13,13,17,.94));box-shadow:0 26px 70px rgba(0,0,0,.42);border-radius:18px;padding:24px;text-align:left}
.sp-block-card:before{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--block-accent),var(--block-accent-2))}
body.sp-light .sp-block-card{background:linear-gradient(155deg,#fff,#f7f7fb);border-color:rgba(15,15,25,.11);box-shadow:0 22px 55px rgba(20,20,35,.15)}
.sp-block-status{display:inline-flex;align-items:center;gap:7px;border:1px solid color-mix(in srgb,var(--block-accent) 35%,transparent);border-radius:999px;padding:6px 10px;margin-bottom:18px;background:color-mix(in srgb,var(--block-accent) 10%,transparent);color:var(--ql-text-secondary,#d8d8df);font-size:10px;font-weight:800;letter-spacing:.035em;text-transform:uppercase}
.sp-block-status-dot{width:7px;height:7px;border-radius:50%;background:var(--block-accent);box-shadow:0 0 0 5px color-mix(in srgb,var(--block-accent) 13%,transparent)}
.sp-block-top{display:flex;align-items:center;gap:14px;margin-bottom:18px}.sp-block-icon{width:48px;height:48px;flex:0 0 48px;border-radius:14px;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--block-accent),var(--block-accent-2));color:#fff;box-shadow:0 12px 28px color-mix(in srgb,var(--block-accent) 28%,transparent)}.sp-block-icon svg{width:24px;height:24px}
.sp-block-eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--ql-text-muted,#8b8b99);font-weight:800}.sp-block-title{font-size:21px;line-height:1.15;font-weight:850;margin-top:4px;letter-spacing:-.02em}
.sp-block-message{font-size:13px;line-height:1.65;color:var(--ql-text-secondary,#c9c9d3);margin:0 0 17px;white-space:pre-wrap}
.sp-block-meta{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:0 0 16px}.sp-block-meta span{border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px;font-size:10.5px;line-height:1.4;color:var(--ql-text-secondary,#c9c9d3);background:rgba(255,255,255,.04)}
body.sp-light .sp-block-meta span{border-color:rgba(15,15,25,.08);background:rgba(15,15,25,.03)}
.sp-block-notes{border:1px solid color-mix(in srgb,var(--block-accent) 22%,transparent);padding:12px;margin:0 0 16px;background:color-mix(in srgb,var(--block-accent) 7%,transparent);border-radius:11px}.sp-block-notes-title{font-size:10px;text-transform:uppercase;letter-spacing:.07em;font-weight:850;margin-bottom:6px;color:var(--block-accent)}.sp-block-notes p{font-size:12px;line-height:1.55;margin:0;white-space:pre-wrap;color:var(--ql-text-secondary,#c9c9d3)}
.sp-block-reassurance{display:flex;gap:9px;align-items:flex-start;margin:0 0 16px;padding:10px 11px;border-radius:10px;background:rgba(255,255,255,.035);font-size:10.5px;line-height:1.5;color:var(--ql-text-muted,#8b8b99)}.sp-block-reassurance svg{width:15px;height:15px;flex:0 0 15px;color:var(--block-accent)}
.sp-block-action{display:flex;align-items:center;justify-content:center;width:100%;min-height:43px;border-radius:11px;background:linear-gradient(135deg,var(--block-accent),var(--block-accent-2));color:#fff;text-decoration:none;font-weight:850;font-size:13px;box-shadow:0 12px 28px color-mix(in srgb,var(--block-accent) 28%,transparent);transition:transform .18s ease,filter .18s ease}.sp-block-action:hover{transform:translateY(-1px);filter:brightness(1.06)}
.sp-block-foot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:15px;font-size:10.5px;color:var(--ql-text-muted,#8b8b99);text-align:center}.sp-block-foot-dot{width:3px;height:3px;border-radius:50%;background:currentColor}
</style><div class="sp-block-card"><div class="sp-block-status"><span class="sp-block-status-dot"></span>${escapeHtml(statusLabel)}</div><div class="sp-block-top"><div class="sp-block-icon">${icon}</div><div><div class="sp-block-eyebrow">${eyebrow}</div><div class="sp-block-title">${title}</div></div></div><p class="sp-block-message">${escapeHtml(message)}</p>${windowText}${notes}<div class="sp-block-reassurance"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-2.8 8.2-7 10-4.2-1.8-7-5.4-7-10V6l7-3z" stroke="currentColor" stroke-width="1.8"/><path d="M9 12l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${escapeHtml(reassurance)}</span></div>${action}<div class="sp-block-foot"><span>Lovable Extension</span><span class="sp-block-foot-dot"></span><span>v${CURRENT_VERSION}</span></div></div></div>`;
  }

  function formatBlockDate(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  window.EUBackend = {
    API_BASE,
    CURRENT_VERSION,
    getLicenseKey,
    improvePrompt,
    sendChat,
    uploadMedia,
    getNotifications,
    getExtensionV5Runtime,
    storageState,
    clearKeys,
    normalizeValidation,
    normalizeBranding,
    normalizeOperations,
    shouldBlockForUpgrade,
    shouldShowUpgrade,
    isMaintenanceActive,
    applyBranding,
    renderBlockPage,
  };
})();
