/*
 * The launcher's script (Phase 6, 2026-10-04): it was one inline <script> of 3,180 lines in
 * launcher.html. Moving it here lets the page carry a Content-Security-Policy without
 * 'unsafe-inline' for scripts, takes 100 kB of parse off the HTML, and lets the HTML stay small.
 */
(function () {
  const splash = document.getElementById("splash");
  const main = document.getElementById("main");
  const lamp = document.getElementById("statusLamp");
  const statusTitle = document.getElementById("statusTitle");
  const statusDetail = document.getElementById("statusDetail");
  const modalLocalUrlList = document.getElementById("modalLocalUrlList");
  const modalLanUrlList = document.getElementById("modalLanUrlList");
  const modalPublicUrlList = document.getElementById("modalPublicUrlList");
  const networkSettingsModal = document.getElementById("networkSettingsModal");
  const networkSettingsClose = document.getElementById("networkSettingsClose");
  const networkSettingsMsg = document.getElementById("networkSettingsMsg");
  const btnNetworkSettings = document.getElementById("btnNetworkSettings");
  const toggleSectionLocal = document.getElementById("toggleSectionLocal");
  const toggleSectionLan = document.getElementById("toggleSectionLan");
  const toggleSectionPublic = document.getElementById("toggleSectionPublic");
  const eyeLan = document.getElementById("eyeLan");
  const eyePublic = document.getElementById("eyePublic");
  const forgetPublic = document.getElementById("forgetPublic");
  const btnExomasteryRefresh = document.getElementById("btnExomasteryRefresh");
  const btnOverlayMenu = document.getElementById("btnOverlayMenu");
  const overlayPickModal = document.getElementById("overlayPickModal");
  const overlayPickClose = document.getElementById("overlayPickClose");
  const ovExoDistance = document.getElementById("ovExoDistance");
  const ovFssScan = document.getElementById("ovFssScan");
  const ovExoCandidates = document.getElementById("ovExoCandidates");
  const ovDataValue = document.getElementById("ovDataValue");
  const launcherActionMsg = document.getElementById("launcherActionMsg");
  const btnMainUi = document.getElementById("btnMainUi");
  const btnMainUiMenu = document.getElementById("btnMainUiMenu");
  const mainUiMenu = document.getElementById("mainUiMenu");
  const mainUiSplit = document.getElementById("mainUiSplit");
  const btnMainUiSub = document.getElementById("btnMainUiSub");
  const btnOptions = document.getElementById("btnOptions");
  const modal = document.getElementById("modal");
  const journalInput = document.getElementById("journalInput");
  const modalCancel = document.getElementById("modalCancel");
  const modalSave = document.getElementById("modalSave");
  const optErr = document.getElementById("optErr");
  const pollSection = document.getElementById("pollSection");
  const pollStatusMs = document.getElementById("pollStatusMs");
  const pollJournalMs = document.getElementById("pollJournalMs");
  const pollApplied = document.getElementById("pollApplied");
  const pollDefaults = document.getElementById("pollDefaults");
  const hudPollSummary = document.getElementById("hudPollSummary");
  const btnPollFromOverlay = document.getElementById("btnPollFromOverlay");
  const radarRadiusRow = document.getElementById("radarRadiusRow");
  const radarRadiusM = document.getElementById("radarRadiusM");
  const splashPct = document.getElementById("splashPct");
  const splashBar = document.getElementById("splashBar");
  const splashMsg = document.getElementById("splashMsg");

  let ws;
  let wsOk = false;
  let pollDelayMs = 2500;
  var wsReconnectTimer = null;

  function connectWs() {
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    try {
      if (ws) {
        ws.onopen = ws.onclose = ws.onerror = ws.onmessage = null;
        try {
          ws.close();
        } catch (e) {}
      }
    } catch (e) {}
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    try {
      // The channel in the address: the first frame is already the launcher's slice (plan O-H).
      ws = new WebSocket(proto + "//" + location.host + "/ws?channel=launcher");
      ws.onopen = function () {
        wsOk = true;
        /* The launcher's slice only: lamp, folder, boot progress. The strip polls /api/status. */
        try { ws.send(JSON.stringify({ type: "hello", channel: "launcher" })); } catch (e) {}
      };
      /*
        Every state push is the full snapshot (hundreds of KB, up to once a second while the
        game writes Status.json). The launcher only needs the lamp, the folder and the live
        strip, so a big frame is parsed at most every 3 s; small frames (boot progress) always.
      */
      var lastWsApply = 0;
      ws.onmessage = function (ev) {
        var now = Date.now();
        var big = typeof ev.data === "string" && ev.data.length > 60000;
        if (big && now - lastWsApply < 3000) return;
        try {
          var msg = JSON.parse(ev.data);
          if (msg && msg.type === "state" && msg.payload) {
            lastWsApply = now;
            applyLauncherSnapshotData(msg.payload);
          }
        } catch (e) {}
      };
      ws.onclose = function () {
        wsOk = false;
        wsReconnectTimer = setTimeout(connectWs, 1300);
      };
      ws.onerror = function () {
        wsOk = false;
      };
    } catch (e) {
      wsOk = false;
      wsReconnectTimer = setTimeout(connectWs, 2000);
    }
  }

  var LS_URL_ON = "edexo.launcher.urlOn";
  var LS_PUBLIC_URL = "edexo.launcher.publicUrl";
  var LS_SEC_LOCAL = "edexo.launcher.sec.local";
  var LS_SEC_LAN = "edexo.launcher.sec.lan";
  var LS_SEC_PUBLIC = "edexo.launcher.sec.public";
  var LS_REVEAL_LAN = "edexo.launcher.reveal.lan";
  var LS_REVEAL_PUBLIC = "edexo.launcher.reveal.public";
  /* Where "Open exobiology UI" opens. Defaults to the browser, per the owner. */
  var LS_OPEN_MODE = "edexo.launcher.openMode";
  var lastPort = 7111;
  var lastConnectData = null;

  function readBoolLs(key, defVal) {
    try {
      var v = localStorage.getItem(key);
      if (v === null) return defVal;
      return v !== "0" && v !== "false";
    } catch (e) {
      return defVal;
    }
  }

  function writeBoolLs(key, val) {
    try {
      localStorage.setItem(key, val ? "1" : "0");
    } catch (e) {}
  }

  function getSectionLocal() {
    return readBoolLs(LS_SEC_LOCAL, true);
  }
  function getSectionLan() {
    return readBoolLs(LS_SEC_LAN, true);
  }
  function getSectionPublic() {
    return readBoolLs(LS_SEC_PUBLIC, true);
  }
  function getRevealLan() {
    return readBoolLs(LS_REVEAL_LAN, true);
  }
  function getRevealPublic() {
    return readBoolLs(LS_REVEAL_PUBLIC, false);
  }

  function getStoredPublicUrl() {
    try {
      return localStorage.getItem(LS_PUBLIC_URL) || "";
    } catch (e) {
      return "";
    }
  }

  /**
   * Delete the stored WAN address.
   *
   * The eye only controls whether it is drawn; the value itself persisted forever, so anyone
   * screenshotting the launcher with the eye open published their home IP and had no way to
   * take it back. Hiding is also turned off, so the next render does not immediately look the
   * address up again — forgetting has to mean forgetting until asked.
   */
  function forgetPublicUrl() {
    try {
      localStorage.removeItem(LS_PUBLIC_URL);
    } catch (e) {}
    writeBoolLs(LS_REVEAL_PUBLIC, false);
  }

  function syncNetworkModalControls() {
    if (toggleSectionLocal) toggleSectionLocal.checked = getSectionLocal();
    if (toggleSectionLan) toggleSectionLan.checked = getSectionLan();
    if (toggleSectionPublic) toggleSectionPublic.checked = getSectionPublic();
    var rl = getRevealLan();
    var rp = getRevealPublic();
    if (eyeLan) {
      var lanOn = getSectionLan();
      eyeLan.disabled = !lanOn;
      eyeLan.setAttribute("aria-pressed", rl ? "true" : "false");
      eyeLan.classList.toggle("net-eye--off", !rl);
    }
    if (eyePublic) {
      var pubOn = getSectionPublic();
      eyePublic.disabled = !pubOn;
      eyePublic.setAttribute("aria-pressed", rp ? "true" : "false");
      eyePublic.classList.toggle("net-eye--off", !rp);
    }
    if (forgetPublic) {
      // Nothing stored, nothing to forget — and a live button that does nothing would leave
      // the user unsure whether it had worked.
      forgetPublic.disabled = !getStoredPublicUrl();
    }
  }

  function makePlaceholderRow(text) {
    var li = document.createElement("li");
    li.className = "net-placeholder dim";
    li.textContent = text;
    return li;
  }

  function publicUrlMatchesPort(savedPub, port) {
    if (!savedPub) return false;
    try {
      return Number(new URL(savedPub).port || 0) === port || savedPub.indexOf(":" + port + "/") >= 0;
    } catch (e2) {
      return false;
    }
  }

  function clearNetworkMsg() {
    if (networkSettingsMsg) {
      networkSettingsMsg.className = "msg-launcher";
      networkSettingsMsg.textContent = "";
    }
  }

  function fetchPublicIpAndSave() {
    return fetch("https://api.ipify.org?format=json", { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        var ip = j && j.ip;
        if (!ip) throw new Error("No IP in response");
        var u = "http://" + ip + ":" + lastPort + "/";
        localStorage.setItem(LS_PUBLIC_URL, u);
        return u;
      });
  }

  function apiUrl(pathname) {
    var proto = window.location.protocol || "";
    if (proto === "http:" || proto === "https:") return pathname;
    return "http://127.0.0.1:" + (lastPort || 7111) + pathname;
  }

  function readUrlOn() {
    try {
      var j = JSON.parse(localStorage.getItem(LS_URL_ON) || "{}");
      return j && typeof j === "object" ? j : {};
    } catch (e) {
      return {};
    }
  }
  function writeUrlOn(map) {
    localStorage.setItem(LS_URL_ON, JSON.stringify(map));
  }
  function isUrlEnabled(url) {
    return readUrlOn()[url] !== false;
  }
  function setUrlEnabled(url, on) {
    var m = readUrlOn();
    m[url] = on;
    writeUrlOn(m);
  }

  function makeUrlRow(url, tag) {
    var on = isUrlEnabled(url);
    var li = document.createElement("li");
    li.className = "url-row" + (on ? "" : " url-row--off");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "url-toggle";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.setAttribute("aria-label", "Enable or dim this address");
    btn.textContent = on ? "●" : "○";
    var inner = document.createElement("div");
    inner.className = "url-row-inner";
    var a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = tag ? tag + " · " + url : url;
    inner.appendChild(a);
    li.appendChild(btn);
    li.appendChild(inner);
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var next = !isUrlEnabled(url);
      setUrlEnabled(url, next);
      li.classList.toggle("url-row--off", !next);
      btn.setAttribute("aria-pressed", next ? "true" : "false");
      btn.textContent = next ? "●" : "○";
    });
    return li;
  }

  var lanWarning = document.getElementById("lanWarning");

  function renderLanWarning(data) {
    if (!lanWarning) return;
    if (!data || data.mode !== "server") {
      lanWarning.hidden = true;
      return;
    }
    lanWarning.hidden = false;
    lanWarning.innerHTML = data.lanKeyRequired
      ? "<strong>Anyone on this network</strong> who has the link below can read your journal data and " +
        "change settings, including resetting exobiology progress. The link carries a one-time " +
        "<strong>access key</strong>: open it once on each device and that device stays paired. " +
        "Treat it like a password — this PC never needs it."
      : "<strong>Anyone on this network</strong> can reach this app with no access key. " +
        "Start it with <strong>--local</strong> to bind to this PC only.";
  }

  var lanAccessBox = document.getElementById("lanAccessBox");
  var lanAccessToggle = document.getElementById("lanAccessToggle");
  var lanAccessNote = document.getElementById("lanAccessNote");
  var lanAccessRestart = document.getElementById("lanAccessRestart");
  var lanAccessBusy = false;

  function renderLanAccess(data) {
    if (!lanAccessBox) return;
    var la = data && data.lanAccess;
    lanAccessBox.hidden = !la;
    if (!la) return;
    if (!lanAccessBusy) lanAccessToggle.checked = !!la.saved;
    var pending = !!la.saved !== !!la.active;
    var canRestart = !!(window.edexoElectron && typeof window.edexoElectron.relaunch === "function");
    lanAccessNote.textContent = pending
      ? (la.saved ? "On after a restart." : "Off after a restart.") +
        (canRestart ? "" : " Close the app and start it again.")
      : la.active
        ? "On: devices on this network can open the app with the links below (they carry the access key)."
        : "Off: only this PC can open the app.";
    lanAccessRestart.hidden = !(pending && canRestart);
    // The first-run card opened before the status said whether there is a switch: ask now.
    if (wzLanStep && wzLanStep.hidden && wizardIsOpen()) fillWizardQuestions(data);
  }

  /* The Network panel's switch and the first-run question both save through here. */
  function saveLanAccess(enabled) {
    lanAccessBusy = true;
    return fetch(apiUrl("/api/launcher/lan-access"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: enabled }),
    })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        lanAccessBusy = false;
        if (j && j.ok && lastConnectData) {
          lastConnectData.lanAccess = j.lanAccess;
          renderConnectUrls(lastConnectData);
        }
        return j;
      })
      .catch(function () {
        lanAccessBusy = false;
        return null;
      });
  }
  if (lanAccessToggle) {
    lanAccessToggle.addEventListener("change", function () {
      void saveLanAccess(lanAccessToggle.checked);
    });
  }
  if (lanAccessRestart) {
    lanAccessRestart.addEventListener("click", function () {
      var bridge = window.edexoElectron;
      if (bridge && typeof bridge.relaunch === "function") bridge.relaunch();
    });
  }

  function renderConnectUrls(data) {
    // The WebSocket frames carry no lanAccess, only /api/status does: keep the last one known.
    if (data && data.lanAccess === undefined && lastConnectData && lastConnectData.lanAccess !== undefined) {
      data.lanAccess = lastConnectData.lanAccess;
    }
    lastConnectData = data;
    lastPort = typeof data.port === "number" && data.port > 0 ? data.port : 7111;
    var localUrl = "http://127.0.0.1:" + lastPort + "/";
    if (!modalLocalUrlList || !modalLanUrlList || !modalPublicUrlList) return;

    modalLocalUrlList.innerHTML = "";
    if (getSectionLocal()) {
      modalLocalUrlList.appendChild(makeUrlRow(localUrl, "This PC"));
    } else {
      modalLocalUrlList.appendChild(
        makePlaceholderRow("This computer is turned off — check “This computer” above to show localhost links."),
      );
    }

    renderLanWarning(data);
    renderLanAccess(data);

    modalLanUrlList.innerHTML = "";
    if (!getSectionLan()) {
      modalLanUrlList.appendChild(
        makePlaceholderRow("LAN is turned off — check “LAN” above to show Wi‑Fi / network links."),
      );
    } else if (!getRevealLan()) {
      modalLanUrlList.appendChild(
        makePlaceholderRow("LAN addresses are hidden — click the eye icon to show them."),
      );
    } else if (!data.lanUrls || !data.lanUrls.length) {
      var note = document.createElement("li");
      note.style.cssText =
        "margin:8px 0;padding:10px 12px;background:rgba(255,255,255,0.04);border-left:3px solid #444;font-size:0.88rem;opacity:0.72;list-style:none";
      note.textContent =
        data.lanAccess && !data.lanAccess.active
          ? data.lanAccess.saved
            ? "LAN access turns on at the next start; the links for your other devices appear here then."
            : "LAN access is off — only this PC can open the app. Turn it on above to get links for your other devices."
          : data.mode === "client"
            ? "Client build — only this PC; install the server / portable build for Wi‑Fi links."
            : "No separate LAN IPv4 found (VPN off? single interface). This PC link still works.";
      modalLanUrlList.appendChild(note);
    } else {
      data.lanUrls.forEach(function (u) {
        modalLanUrlList.appendChild(makeUrlRow(u, "LAN"));
        /* The same address as the HUD for a phone: sections, theme and order as on the PC. */
        try {
          var pu = new URL(u);
          pu.pathname = "/hud-overlay.html";
          pu.searchParams.set("phone", "1");
          modalLanUrlList.appendChild(makeUrlRow(pu.toString(), "PHONE HUD"));
        } catch (e) {}
      });
    }

    modalPublicUrlList.innerHTML = "";
    if (!getSectionPublic()) {
      modalPublicUrlList.appendChild(
        makePlaceholderRow("Public internet is turned off — check “Public internet” above to configure WAN links."),
      );
    } else if (!getRevealPublic()) {
      modalPublicUrlList.appendChild(
        makePlaceholderRow("Public (WAN) address is hidden — click the eye icon to show or fetch it."),
      );
    } else {
      var savedPub2 = getStoredPublicUrl();
      if (savedPub2 && publicUrlMatchesPort(savedPub2, lastPort)) {
        modalPublicUrlList.appendChild(makeUrlRow(savedPub2, "Public"));
      } else if (savedPub2) {
        modalPublicUrlList.appendChild(
          makePlaceholderRow(
            "Stored public URL is for a different port than this server — use the eye to hide, then show again to refresh.",
          ),
        );
      } else {
        modalPublicUrlList.appendChild(
          makePlaceholderRow("Click the eye icon to fetch and show your public (WAN) address."),
        );
      }
    }

    syncNetworkModalControls();
  }

  function applyLauncherSnapshotData(data) {
    if (data.journalBoot) {
      splash.style.display = "block";
      main.classList.remove("ready");
      if (splashPct && splashBar && splashMsg) {
        const b = data.journalBoot;
        const p = Math.max(0, Math.min(100, Number(b.percent) || 0));
        splashPct.textContent = p + "%";
        splashBar.style.width = p + "%";
        splashMsg.textContent = typeof b.message === "string" ? b.message : "Loading…";
      }
      pollDelayMs = 400;
      return;
    }

    pollDelayMs = 2500;
    splash.style.display = "none";
    main.classList.add("ready");

    const dirOk = data.journalDirConfiguredOk === true;
    const hasJournal = data.journalFileCount > 0;
    const good = dirOk && wsOk;

    lamp.className = "lamp " + (good ? "ok" : "bad");
    if (!dirOk) {
      statusTitle.textContent = "Journal folder missing or unreadable";
      statusDetail.textContent = data.journalDir || "";
    } else if (!wsOk) {
      statusTitle.textContent = "Server up — live link not active";
      statusDetail.textContent = "WebSocket not connected; try refresh.";
    } else if (!hasJournal) {
      statusTitle.textContent = "All systems nominal — waiting for journal logs";
      statusDetail.textContent = (data.journalDir || "") + " — 0 files merged (launch Elite or check path).";
      lamp.className = "lamp ok";
    } else {
      statusTitle.textContent = "All systems nominal";
      statusDetail.textContent =
        (data.journalFileCount || 0) + " journal file(s) · " + (data.lastJournalEventIso || "no events yet");
    }

    renderConnectUrls(data);
    // Only while the modal is shut. The poll runs every 2.5 s, so writing these fields
    // unconditionally rewrote the folder path out from under whoever was typing it.
    if (!modal.classList.contains("on")) {
      journalInput.value = data.journalDir || "";
      renderPollRates(data.pollRates);
      renderRadarRadius(data.radarRadius);
    }
    renderLiveStrip(data);
    renderJournalHealth(data);
    maybeShowWizard(data);
  }

  /*
    The version line. Asked once when the launcher opens (the server remembers GitHub's answer
    for an hour), and again on the button. When a newer release exists the button becomes its
    download link: the server opens that release's page itself — the page, never a file, and
    nothing on this PC is replaced by the app.
  */
  const versionLine = document.getElementById("versionLine");
  const versionText = document.getElementById("versionText");
  const btnCheckUpdate = document.getElementById("btnCheckUpdate");
  const btnUpdatePage = document.getElementById("btnUpdatePage");
  var updateInfo = null;
  var updatePoll = null;
  /* Set by the button: install as soon as the download is checked (owner: "Download & Install"). */
  var installWhenReady = false;
  /*
    The updater (owner, 2026-10-02): where this copy can replace itself (download.supported), one
    button, "Download & Install", downloads the newer release, checks it against GitHub's SHA-256,
    and then installs it: the app closes, the new copy goes in, and it starts. Only on that press,
    never by itself. The release page stays one click away. Elsewhere (a source run, the console
    builds) the button opens the page as before.
  */
  function canSelfUpdate(info) {
    return Boolean(
      info && info.newer && info.download && info.download.supported &&
        window.edexoElectron && typeof window.edexoElectron.installUpdate === "function",
    );
  }

  function renderUpdateInfo(info, checking) {
    updateInfo = info;
    var cur = info && info.current ? "v" + info.current : "Version —";
    versionLine.classList.toggle("newer", Boolean(info && info.newer));
    btnCheckUpdate.disabled = Boolean(checking);
    btnUpdatePage.hidden = !(info && info.newer && canSelfUpdate(info));
    if (checking) {
      versionText.textContent = cur + " · checking…";
      btnCheckUpdate.textContent = "Check for updates";
      return;
    }
    if (canSelfUpdate(info)) {
      var dl = info.download;
      versionText.title = "";
      btnCheckUpdate.title = "";
      if (dl.state === "downloading") {
        var pct = dl.total ? Math.floor((100 * dl.received) / dl.total) : null;
        versionText.textContent = "Installed " + cur + " · downloading v" + info.latest + (pct != null ? " · " + pct + " %" : "…");
        btnCheckUpdate.textContent = "Downloading…";
        btnCheckUpdate.disabled = true;
      } else if (dl.state === "ready" && installWhenReady) {
        versionText.textContent = "Installed " + cur + " · installing v" + info.latest + "…";
        btnCheckUpdate.textContent = "Installing…";
        btnCheckUpdate.disabled = true;
      } else {
        versionText.textContent =
          "Installed " + cur + " · v" + info.latest + " available" +
          (dl.state === "error" ? " · download failed" : dl.error ? " · last install failed" : "");
        if (dl.error) versionText.title = dl.error;
        btnCheckUpdate.textContent = dl.state === "error" ? "Try again" : "Download & Install v" + info.latest;
        btnCheckUpdate.title =
          "Downloads v" + info.latest + " from GitHub, checks it, then closes the app, puts it in place of this copy and starts it. Your settings and data are kept.";
      }
      return;
    }
    if (info && info.newer) {
      versionText.textContent = "Installed " + cur + " · v" + info.latest + " available";
      btnCheckUpdate.textContent = "Download v" + info.latest;
      btnCheckUpdate.title = "Opens the release page on GitHub in your browser.";
      return;
    }
    btnCheckUpdate.textContent = "Check for updates";
    btnCheckUpdate.title = "";
    if (info && info.error && !info.latest) {
      versionText.textContent = cur + " · could not check";
      versionText.title = info.error;
    } else if (info && info.latest) {
      versionText.textContent = cur + " · up to date";
      versionText.title = "";
    } else {
      versionText.textContent = cur;
    }
  }

  function checkForUpdates(force) {
    renderUpdateInfo(updateInfo, true);
    fetch(apiUrl("/api/app/update" + (force ? "?force=1" : "")), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (info) {
        renderUpdateInfo(info, false);
        // The launcher reopened while a download runs: keep its progress moving.
        if (info.download && info.download.state === "downloading") pollDownload();
      })
      .catch(function (e) {
        var prev = updateInfo || {};
        renderUpdateInfo(
          { current: prev.current, latest: prev.latest, newer: prev.newer, pageUrl: prev.pageUrl, error: String(e && e.message ? e.message : e) },
          false,
        );
      });
  }

  function pollDownload() {
    if (updatePoll) return;
    updatePoll = setInterval(function () {
      fetch(apiUrl("/api/app/update"), { cache: "no-store" })
        .then(function (r) {
          return r.json();
        })
        .then(function (info) {
          renderUpdateInfo(info, false);
          if (!(info.download && info.download.state === "downloading")) {
            clearInterval(updatePoll);
            updatePoll = null;
            if (info.download && info.download.state === "ready" && installWhenReady) installNow();
            else installWhenReady = false;
          }
        })
        .catch(function () {});
    }, 1000);
  }

  btnUpdatePage.addEventListener("click", function () {
    openUpdatePage();
  });

  btnCheckUpdate.addEventListener("click", function () {
    if (!(updateInfo && updateInfo.newer)) {
      checkForUpdates(true);
      return;
    }
    if (canSelfUpdate(updateInfo)) {
      installWhenReady = true;
      // Downloaded and checked already (an earlier press that was called off): install now.
      if (updateInfo.download.state === "ready") {
        installNow();
        return;
      }
      fetch(apiUrl("/api/app/update/download"), { method: "POST" })
        .then(function (r) {
          return r.json();
        })
        .then(function (dl) {
          renderUpdateInfo(Object.assign({}, updateInfo, { download: dl }), false);
          pollDownload();
        })
        .catch(function (e) {
          versionText.textContent = "Could not start the download: " + String(e && e.message ? e.message : e);
        });
      return;
    }
    openUpdatePage();
  });

  function installNow() {
    renderUpdateInfo(updateInfo, false);
    window.edexoElectron.installUpdate().then(function (r) {
      if (r && r.ok) {
        // Still here after a while: the quit was called off ("Keep the app open" while a backup
        // was written). Back to the button.
        setTimeout(function () {
          installWhenReady = false;
          checkForUpdates(false);
        }, 15000);
        return;
      }
      installWhenReady = false;
      renderUpdateInfo(updateInfo, false);
      versionText.textContent = (r && r.error) || "Could not start the update.";
    });
  }

  function openUpdatePage() {
    fetch(apiUrl("/api/app/open-update"), { method: "POST" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (!j.ok) throw new Error(j.error || "Could not open the page");
      })
      .catch(function () {
        // No browser could be started from here (or the route is missing): open the page in a
        // window of this app instead, so the link still goes somewhere.
        if (updateInfo && updateInfo.pageUrl) window.open(updateInfo.pageUrl, "_blank", "noopener");
      });
  }

  checkForUpdates(false);

  /*
    What's new (combined plan, Phase 5): after an update the notes of every release since the
    version last seen, once; closing them marks this version seen (server/whatsNew.ts). The notes
    are GitHub's release notes, drawn here from a small part of Markdown — headings, lists, bold,
    code and links — into elements, never as HTML.
  */
  var whatsNewModal = document.getElementById("whatsNewModal");
  var whatsNewBody = document.getElementById("whatsNewBody");
  var whatsNewTitle = document.getElementById("whatsNewTitle");
  var btnWhatsNew = document.getElementById("btnWhatsNew");
  var whatsNewPending = false;
  var whatsNewPageUrl = "https://github.com/bahuckel/EDEXO-Compare/releases";

  function notesInline(parent, text) {
    var re = /!\[[^\]]*\]\([^)]*\)|\[([^\]]+)\]\((https:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
    var last = 0;
    var m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.appendChild(document.createTextNode(text.slice(last, m.index)));
      last = re.lastIndex;
      var el = null;
      if (m[2]) {
        el = document.createElement("a");
        el.href = m[2];
        el.target = "_blank";
        el.rel = "noopener";
        el.textContent = m[1];
      } else if (m[3]) {
        el = document.createElement("strong");
        el.textContent = m[3];
      } else if (m[4]) {
        el = document.createElement("code");
        el.textContent = m[4];
      }
      if (el) parent.appendChild(el);
    }
    if (last < text.length) parent.appendChild(document.createTextNode(text.slice(last)));
  }

  function renderNotes(md, into) {
    var lists = [];
    var para = null;
    var lastLi = null;
    function closeLists() {
      lists = [];
      lastLi = null;
    }
    md.replace(/\r\n/g, "\n").split("\n").forEach(function (line) {
      if (!line.trim()) {
        para = null;
        return;
      }
      var h = /^#{2,4}\s+(.*)$/.exec(line);
      if (h) {
        para = null;
        closeLists();
        var hd = document.createElement("h4");
        notesInline(hd, h[1].replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\s+[—-]\s*$/, ""));
        into.appendChild(hd);
        return;
      }
      var li = /^(\s*)(\d+\.|[-*])\s+(.*)$/.exec(line);
      if (li) {
        para = null;
        var indent = li[1].length;
        var ordered = /\d/.test(li[2]);
        while (lists.length && lists[lists.length - 1].indent > indent) lists.pop();
        var top = lists[lists.length - 1];
        if (!top || top.indent < indent) {
          var list = document.createElement(ordered ? "ol" : "ul");
          if (top && lastLi) lastLi.appendChild(list);
          else into.appendChild(list);
          lists.push({ indent: indent, el: list });
          top = lists[lists.length - 1];
        }
        lastLi = document.createElement("li");
        notesInline(lastLi, li[3]);
        top.el.appendChild(lastLi);
        return;
      }
      if (lastLi && /^\s/.test(line)) {
        notesInline(lastLi, " " + line.trim());
        return;
      }
      closeLists();
      if (!para) {
        para = document.createElement("p");
        into.appendChild(para);
      } else {
        para.appendChild(document.createTextNode(" "));
      }
      notesInline(para, line.trim());
    });
  }

  function showWhatsNew(info) {
    if (!whatsNewModal || !whatsNewBody) return;
    whatsNewPending = Boolean(info.pending);
    whatsNewBody.innerHTML = "";
    var rel = info.releases || [];
    whatsNewTitle.textContent = (info.pending ? "Updated to v" : "What's new in v") + info.current;
    whatsNewPageUrl = rel.length ? rel[0].pageUrl : "https://github.com/bahuckel/EDEXO-Compare/releases";
    if (!rel.length) {
      var p = document.createElement("p");
      p.textContent =
        "The notes for this version could not be read from GitHub" +
        (info.error ? " (" + info.error + ")" : "") +
        ". They are on the release page.";
      whatsNewBody.appendChild(p);
    }
    rel.forEach(function (r) {
      var v = document.createElement("div");
      v.className = "wn-version";
      v.textContent = "v" + r.version + (r.publishedAt ? " · " + String(r.publishedAt).slice(0, 10) : "");
      whatsNewBody.appendChild(v);
      renderNotes(r.notes, whatsNewBody);
    });
    whatsNewBody.scrollTop = 0;
    whatsNewModal.classList.add("on");
  }

  function closeWhatsNew() {
    if (whatsNewModal) whatsNewModal.classList.remove("on");
    if (!whatsNewPending) return;
    whatsNewPending = false;
    fetch(apiUrl("/api/app/whats-new/seen"), { method: "POST" }).catch(function () {});
  }

  function fetchWhatsNew(any) {
    return fetch(apiUrl("/api/app/whats-new" + (any ? "?any=1" : "")), { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  /* At start: once the server answers, and after any other card (first run, Linux setup) is closed. */
  function loadWhatsNew(tries) {
    fetchWhatsNew(false)
      .then(function (info) {
        if (btnWhatsNew) btnWhatsNew.hidden = false;
        if (!info.pending) return;
        (function waitForOtherCards() {
          if (document.querySelector(".modal-bg.on")) setTimeout(waitForOtherCards, 1500);
          else showWhatsNew(info);
        })();
      })
      .catch(function () {
        if (tries > 0) setTimeout(function () { loadWhatsNew(tries - 1); }, 3000);
      });
  }
  loadWhatsNew(20);

  if (btnWhatsNew) btnWhatsNew.addEventListener("click", function () {
    fetchWhatsNew(true).then(showWhatsNew).catch(function () {});
  });
  var whatsNewClose = document.getElementById("whatsNewClose");
  var whatsNewPage = document.getElementById("whatsNewPage");
  if (whatsNewClose) whatsNewClose.addEventListener("click", closeWhatsNew);
  if (whatsNewPage) whatsNewPage.addEventListener("click", function () { window.open(whatsNewPageUrl, "_blank", "noopener"); });
  if (whatsNewModal) whatsNewModal.addEventListener("click", function (e) { if (e.target === whatsNewModal) closeWhatsNew(); });

  async function poll() {
    try {
      // /api/status is the launcher-sized payload: no snapshot rebuild (~186 ms, ~630 KB)
      // every 2.5 s just to render the lamp and the journal folder.
      const r = await fetch(apiUrl("/api/status"), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      applyLauncherSnapshotData(data);
    } catch (e) {
      pollDelayMs = 2500;
      splash.style.display = "none";
      main.classList.add("ready");
      lamp.className = "lamp bad";
      statusTitle.textContent = "Cannot reach ED Exo Compare service";
      statusDetail.textContent = String(e && e.message ? e.message : e);
      if (modalLocalUrlList) modalLocalUrlList.innerHTML = "";
      if (modalLanUrlList) modalLanUrlList.innerHTML = "";
      if (modalPublicUrlList) modalPublicUrlList.innerHTML = "";
    }
  }

  function loopPoll() {
    void poll().then(function () {
      setTimeout(loopPoll, pollDelayMs);
    });
  }

  btnOptions.addEventListener("click", function () {
    optErr.style.display = "none";
    modal.classList.add("on");
  });
  modalCancel.addEventListener("click", function () {
    modal.classList.remove("on");
  });
  modal.addEventListener("click", function (e) {
    if (e.target === modal) modal.classList.remove("on");
  });
  modalSave.addEventListener("click", async function () {
    optErr.style.display = "none";
    const dir = journalInput.value.trim();
    if (!dir) {
      optErr.textContent = "Enter a folder path.";
      optErr.style.display = "block";
      return;
    }
    try {
      const r = await fetch(apiUrl("/api/settings/journal-directory"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ journalDir: dir }),
      });
      const j = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) {
        optErr.textContent = j.error || r.statusText;
        optErr.style.display = "block";
        return;
      }
      modal.classList.remove("on");
      await poll();
    } catch (e) {
      optErr.textContent = String(e);
      optErr.style.display = "block";
    }
  });

  /*
    The two live-file poll rates.

    Bounds come from the server (`shared/pollRates.ts`) rather than being written into the
    input attributes here, so this window can never offer a number the server would clamp.
    A build without the setting sends no `pollRates` and the section simply stays hidden.
  */
  let pollBounds = null;
  let pollAppliedTimer = null;

  function renderPollRates(rates) {
    if (!pollSection) return;
    if (!rates || typeof rates !== "object") {
      pollSection.hidden = true;
      return;
    }
    pollBounds = rates;
    pollSection.hidden = false;
    pollStatusMs.min = String(rates.statusMinMs);
    pollStatusMs.max = String(rates.statusMaxMs);
    pollJournalMs.min = String(rates.journalMinMs);
    pollJournalMs.max = String(rates.journalMaxMs);
    if (document.activeElement !== pollStatusMs) pollStatusMs.value = String(rates.statusPollMs);
    if (document.activeElement !== pollJournalMs) pollJournalMs.value = String(rates.journalPollMs);
    if (hudPollSummary) {
      hudPollSummary.textContent = "The HUDs follow Status.json, read every " + rates.statusPollMs + " ms";
    }
  }

  function flashPollApplied() {
    if (!pollApplied) return;
    pollApplied.classList.add("on");
    if (pollAppliedTimer) clearTimeout(pollAppliedTimer);
    pollAppliedTimer = setTimeout(function () {
      pollApplied.classList.remove("on");
    }, 1400);
  }

  /*
    Sent on `change`, not on every keystroke: `input` fires per digit, so typing "2000" would
    walk the server through 2, 20 and 200 ms — re-arming the timer three times on its way to a
    rate the commander never asked for.
  */
  async function savePollRates(statusMs, journalMs) {
    if (!pollBounds) return;
    try {
      const r = await fetch(apiUrl("/api/settings/poll-rates"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusPollMs: statusMs, journalPollMs: journalMs }),
      });
      const j = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) {
        optErr.textContent = j.error || r.statusText;
        optErr.style.display = "block";
        return;
      }
      // Show what was accepted, not what was sent — the server clamps.
      pollBounds.statusPollMs = j.statusPollMs;
      pollBounds.journalPollMs = j.journalPollMs;
      pollStatusMs.value = String(j.statusPollMs);
      pollJournalMs.value = String(j.journalPollMs);
      optErr.style.display = "none";
      flashPollApplied();
    } catch (e) {
      optErr.textContent = String(e);
      optErr.style.display = "block";
    }
  }

  function onPollFieldChange() {
    void savePollRates(Number(pollStatusMs.value), Number(pollJournalMs.value));
  }

  if (pollStatusMs && pollJournalMs) {
    pollStatusMs.addEventListener("change", onPollFieldChange);
    pollJournalMs.addEventListener("change", onPollFieldChange);
  }
  /*
    How far the sample radar draws.

    It lives in the Overlay panel rather than beside the poll rates, because it is a property
    of the radar and this is where the radar's other settings are. Bounds come from the server
    for the same reason as the poll rates: the input cannot then offer a value that gets
    clamped on arrival.
  */
  var radarBounds = null;

  function renderRadarRadius(r) {
    if (!radarRadiusRow) return;
    if (!r || typeof r !== "object") {
      radarRadiusRow.hidden = true;
      return;
    }
    radarBounds = r;
    radarRadiusRow.hidden = false;
    radarRadiusM.min = String(r.minM);
    radarRadiusM.max = String(r.maxM);
    if (document.activeElement !== radarRadiusM) radarRadiusM.value = String(r.radiusM);
  }

  async function saveRadarRadius(value) {
    if (!radarBounds) return;
    try {
      var r = await fetch(apiUrl("/api/settings/radar-radius"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ radiusM: value }),
      });
      var j = await r.json().catch(function () {
        return {};
      });
      if (!r.ok) return;
      // What was accepted, not what was sent.
      radarBounds.radiusM = j.radiusM;
      radarRadiusM.value = String(j.radiusM);
    } catch (e) {
      /* the radar keeps its current circle; nothing here is worth an error banner */
    }
  }

  if (radarRadiusM) {
    // `change`, not `input` — typing "1000" would otherwise walk the radar through 1, 10, 100.
    radarRadiusM.addEventListener("change", function () {
      void saveRadarRadius(Number(radarRadiusM.value));
    });
  }

  if (btnPollFromOverlay) {
    btnPollFromOverlay.addEventListener("click", function () {
      // Out of the overlay panel and into the one place the controls live. Leaving the overlay
      // modal open behind it would stack two dialogs over each other.
      if (overlayPickModal) overlayPickModal.classList.remove("on");
      btnOptions.click();
      if (pollStatusMs) pollStatusMs.focus();
    });
  }
  if (pollDefaults) {
    pollDefaults.addEventListener("click", function () {
      if (!pollBounds) return;
      void savePollRates(pollBounds.statusDefaultMs, pollBounds.journalDefaultMs);
    });
  }

  function openNetworkSettingsModal() {
    if (!networkSettingsModal) return;
    clearNetworkMsg();
    networkSettingsModal.classList.add("on");
    syncNetworkModalControls();
    if (lastConnectData) renderConnectUrls(lastConnectData);
  }

  function closeNetworkSettingsModal() {
    if (networkSettingsModal) networkSettingsModal.classList.remove("on");
  }

  /*
    Key binds (owner, 2026-10-02): Electron registers them globally (electron/keybinds.cjs). Recording
    a bind pauses the current ones, or a key that is already bound would never reach this page.
  */
  (function () {
    var ee = window.edexoElectron;
    var btn = document.getElementById("btnKeybinds");
    var modal = document.getElementById("keybindsModal");
    var rowsEl = document.getElementById("kbRows");
    var msgEl = document.getElementById("kbMsg");
    var closeBtn = document.getElementById("kbClose");
    if (!ee || typeof ee.getKeybinds !== "function" || !btn || !modal || !rowsEl) return;
    btn.hidden = false;
    var state = null;
    var recording = null;
    var STATUS = {
      ok: "",
      off: "Off.",
      taken: "Another program already uses this key, so it does nothing here. Pick another.",
      duplicate: "Already bound to another action above.",
      invalid: "Not a key this app can bind.",
      // Registered only while Elite is in front, so the key keeps working in every other program.
      standby: "Works while Elite is in front; other programs keep the key.",
    };
    function pretty(acc) {
      if (!acc) return "None";
      return acc.replace(/^CommandOrControl\+|^CmdOrCtrl\+/, "Ctrl+").replace(/Control/g, "Ctrl").replace(/\+/g, " + ");
    }
    var CODE = { Space: "Space", Tab: "Tab", Backspace: "Backspace", Delete: "Delete", Insert: "Insert", Enter: "Return",
      NumpadEnter: "Return", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home",
      End: "End", PageUp: "PageUp", PageDown: "PageDown", NumpadDecimal: "numdec", NumpadAdd: "numadd",
      NumpadSubtract: "numsub", NumpadMultiply: "nummult", NumpadDivide: "numdiv", Minus: "-", Equal: "=",
      BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'", Comma: ",", Period: ".",
      Slash: "/", Backquote: "`" };
    function keyOf(ev) {
      var c = ev.code || "";
      if (/^Key[A-Z]$/.test(c)) return c.slice(3);
      if (/^Digit[0-9]$/.test(c)) return c.slice(5);
      if (/^F([1-9]|1[0-9]|2[0-4])$/.test(c)) return c;
      if (/^Numpad[0-9]$/.test(c)) return "num" + c.slice(6);
      return CODE[c] || null;
    }
    // Which sections are open, kept for the next time (a convenience: closed when it cannot be read).
    var OPEN_KEY = "edexo.kbGroupsOpen";
    function readOpen() {
      try {
        var v = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]");
        return Array.isArray(v) ? v : [];
      } catch (e) {
        return [];
      }
    }
    function writeOpen(list) {
      try {
        localStorage.setItem(OPEN_KEY, JSON.stringify(list));
      } catch (e) {
        /* not kept */
      }
    }
    function isWarn(code) {
      return code === "taken" || code === "duplicate" || code === "invalid";
    }
    /*
      One folding section per group (owner, 2026-10-06: "key-binds in launcher under collapsible
      categories"), in electron/keybinds.cjs GROUPS order. A closed section lists its keys; one with a
      key that does not work opens by itself.
    */
    function render() {
      rowsEl.innerHTML = "";
      var keys = Object.keys(state.actions);
      var groups = (state.groups || []).slice();
      keys.forEach(function (k) {
        var g = state.actions[k].group || "Other";
        if (groups.indexOf(g) < 0) groups.push(g);
      });
      var open = readOpen();
      groups.forEach(function (g) {
        var inGroup = keys.filter(function (k) { return (state.actions[k].group || "Other") === g; });
        if (!inGroup.length) return;
        var warn = inGroup.some(function (k) { return isWarn(state.status[k]); });
        var det = document.createElement("details");
        det.className = "kb-group";
        det.open = warn || open.indexOf(g) >= 0 || inGroup.indexOf(recording) >= 0;
        var sum = document.createElement("summary");
        var title = document.createElement("span");
        title.textContent = g;
        var list = document.createElement("span");
        list.className = "kb-group__keys" + (warn ? " kb-group__keys--warn" : "");
        list.textContent = inGroup.map(function (k) { return pretty(state.binds[k]); }).join(" · ");
        sum.appendChild(title);
        sum.appendChild(list);
        det.appendChild(sum);
        var grid = document.createElement("div");
        grid.className = "kb-rows";
        det.appendChild(grid);
        det.addEventListener("toggle", function () {
          var now = readOpen().filter(function (x) { return x !== g; });
          if (det.open) now.push(g);
          writeOpen(now);
        });
        rowsEl.appendChild(det);
        inGroup.forEach(function (k) { renderRow(grid, k); });
      });
    }
    function renderRow(grid, k) {
      {
        var a = state.actions[k];
        var label = document.createElement("span");
        label.textContent = a.label;
        var key = document.createElement("button");
        key.type = "button";
        key.className = "btn-mini kb-key";
        key.textContent = recording === k ? "Press the keys… (Esc cancels)" : pretty(state.binds[k]);
        key.setAttribute("aria-pressed", recording === k ? "true" : "false");
        key.title = "Click, then press the key or combination";
        key.addEventListener("click", function () { startRecording(k); });
        var def = document.createElement("button");
        def.type = "button";
        def.className = "btn-mini";
        def.textContent = "Default";
        def.title = "Back to " + pretty(a.default);
        def.addEventListener("click", function () { save(k, null); });
        var off = document.createElement("button");
        off.type = "button";
        off.className = "btn-mini";
        off.textContent = "Off";
        off.addEventListener("click", function () { save(k, ""); });
        var st = document.createElement("p");
        var code = state.status[k] || "off";
        st.className = "kb-status" + (isWarn(code) ? " kb-status--warn" : "");
        st.textContent = STATUS[code] || "";
        grid.appendChild(label);
        grid.appendChild(key);
        grid.appendChild(def);
        grid.appendChild(off);
        if (st.textContent) grid.appendChild(st);
      }
    }
    function load() {
      return ee.getKeybinds().then(function (r) { state = r; render(); }).catch(function () {});
    }
    function save(k, value) {
      var next = {};
      next[k] = value;
      return ee.setKeybinds(next).then(function (r) { state = r; recording = null; render(); }).catch(function () {});
    }
    function stopRecording() {
      if (!recording) return;
      recording = null;
      window.removeEventListener("keydown", onKey, true);
      void ee.pauseKeybinds({ on: false }).then(function (r) { if (r) state = r; render(); });
    }
    function startRecording(k) {
      if (recording) stopRecording();
      recording = k;
      if (msgEl) msgEl.textContent = "";
      void ee.pauseKeybinds({ on: true });
      window.addEventListener("keydown", onKey, true);
      render();
    }
    function onKey(ev) {
      if (!recording) return;
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === "Escape" && !ev.ctrlKey && !ev.altKey && !ev.shiftKey) {
        stopRecording();
        return;
      }
      if (/^(Control|Alt|Shift|Meta|OS)$/.test(ev.key)) return; // wait for the key itself
      var key = keyOf(ev);
      if (!key) {
        if (msgEl) msgEl.textContent = "That key cannot be bound; try another.";
        return;
      }
      var parts = [];
      if (ev.ctrlKey) parts.push("Control");
      if (ev.altKey) parts.push("Alt");
      if (ev.shiftKey) parts.push("Shift");
      if (ev.metaKey) parts.push("Super");
      parts.push(key);
      if (parts.length > 3) {
        if (msgEl) msgEl.textContent = "Up to three keys: two of Ctrl, Alt, Shift and one key.";
        return;
      }
      var k = recording;
      window.removeEventListener("keydown", onKey, true);
      save(k, parts.join("+"));
    }
    function open() {
      modal.classList.add("on");
      void load();
    }
    function close() {
      stopRecording();
      modal.classList.remove("on");
    }
    btn.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    modal.addEventListener("click", function (e) { if (e.target === modal) close(); });
  })();

  if (btnNetworkSettings && networkSettingsModal) {
    btnNetworkSettings.addEventListener("click", function () {
      openNetworkSettingsModal();
    });
  }
  if (networkSettingsClose && networkSettingsModal) {
    networkSettingsClose.addEventListener("click", closeNetworkSettingsModal);
  }
  if (networkSettingsModal) {
    networkSettingsModal.addEventListener("click", function (e) {
      if (e.target === networkSettingsModal) closeNetworkSettingsModal();
    });
  }

  if (toggleSectionLocal) {
    toggleSectionLocal.addEventListener("change", function () {
      writeBoolLs(LS_SEC_LOCAL, toggleSectionLocal.checked);
      if (lastConnectData) renderConnectUrls(lastConnectData);
    });
  }
  if (toggleSectionLan) {
    toggleSectionLan.addEventListener("change", function () {
      writeBoolLs(LS_SEC_LAN, toggleSectionLan.checked);
      if (lastConnectData) renderConnectUrls(lastConnectData);
    });
  }
  if (toggleSectionPublic) {
    toggleSectionPublic.addEventListener("change", function () {
      writeBoolLs(LS_SEC_PUBLIC, toggleSectionPublic.checked);
      if (lastConnectData) renderConnectUrls(lastConnectData);
    });
  }

  if (eyeLan) {
    eyeLan.addEventListener("click", function () {
      if (!getSectionLan()) return;
      var next = !getRevealLan();
      writeBoolLs(LS_REVEAL_LAN, next);
      clearNetworkMsg();
      if (lastConnectData) renderConnectUrls(lastConnectData);
    });
  }

  if (eyePublic) {
    eyePublic.addEventListener("click", function () {
      if (!getSectionPublic()) return;
      if (getRevealPublic()) {
        writeBoolLs(LS_REVEAL_PUBLIC, false);
        clearNetworkMsg();
        if (lastConnectData) renderConnectUrls(lastConnectData);
        return;
      }
      writeBoolLs(LS_REVEAL_PUBLIC, true);
      syncNetworkModalControls();
      clearNetworkMsg();
      var savedPub = getStoredPublicUrl();
      if (savedPub && publicUrlMatchesPort(savedPub, lastPort)) {
        if (lastConnectData) renderConnectUrls(lastConnectData);
        return;
      }
      if (lastConnectData) renderConnectUrls(lastConnectData);
      eyePublic.disabled = true;
      fetchPublicIpAndSave()
        .then(function () {
          if (lastConnectData) renderConnectUrls(lastConnectData);
        })
        .catch(function () {
          writeBoolLs(LS_REVEAL_PUBLIC, false);
          if (networkSettingsMsg) {
            networkSettingsMsg.className = "msg-launcher err";
            networkSettingsMsg.textContent =
              "Could not look up public IP (offline, firewall, or API blocked).";
          }
          syncNetworkModalControls();
          if (lastConnectData) renderConnectUrls(lastConnectData);
        })
        .finally(function () {
          if (eyePublic) eyePublic.disabled = !getSectionPublic();
          syncNetworkModalControls();
        });
    });
  }

  if (forgetPublic) {
    forgetPublic.addEventListener("click", function () {
      if (!getStoredPublicUrl()) return;
      forgetPublicUrl();
      syncNetworkModalControls();
      if (lastConnectData) renderConnectUrls(lastConnectData);
      if (networkSettingsMsg) {
        networkSettingsMsg.className = "msg-launcher ok";
        networkSettingsMsg.textContent =
          "Public address forgotten. Nothing was sent anywhere — it only ever lived on this device.";
      }
    });
  }

  /*
    Where "Open exobiology UI" opens (owner's launcher request).

    Three destinations, one remembered choice, browser by default. The old button navigated
    this window to the app, which left no way back to the launcher short of restarting it. That
    became "This window", and then (owner, 2026-09-26) "App window": the same app in a window of
    its own, so closing it leaves the launcher where it was. The stored value is still "window".

    Opening the system browser needs the server: window.open inside Electron makes another
    Electron window, not a browser. The route takes a two-value enum rather than a URL, so it
    can only ever open this app's own views.
  */
  var OPEN_MODES = {
    browser: { sub: "In your browser", view: "app" },
    window: { sub: "In an app window", view: null },
    phone: { sub: "Phone view — read-only triage", view: "phone" },
  };

  function readOpenMode() {
    try {
      var v = localStorage.getItem(LS_OPEN_MODE);
      if (v && OPEN_MODES[v]) return v;
    } catch (e) {
      /* private window, or storage disabled — the default is still correct */
    }
    return "browser";
  }

  function applyOpenMode(mode) {
    btnMainUiSub.textContent = OPEN_MODES[mode].sub;
    var items = mainUiMenu.querySelectorAll("button[data-open-mode]");
    for (var i = 0; i < items.length; i++) {
      items[i].setAttribute("aria-current", items[i].dataset.openMode === mode ? "true" : "false");
    }
  }

  function setOpenMode(mode) {
    try {
      localStorage.setItem(LS_OPEN_MODE, mode);
    } catch (e) {
      /* the choice still applies for this session */
    }
    applyOpenMode(mode);
    // And in user data, where a rebuilt or moved exe still finds it (localStorage lives in the
    // Chromium profile, which is not the commander's data folder).
    fetch(apiUrl("/api/launcher/open-mode"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: mode }),
    }).catch(function () {
      /* localStorage still has it */
    });
  }

  /* The saved choice wins over this profile's localStorage; a launcher with no route keeps the local one. */
  function loadSavedOpenMode() {
    fetch(apiUrl("/api/launcher/open-mode"))
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (!j || !j.mode || !OPEN_MODES[j.mode]) {
          // Nothing saved yet: carry this profile's choice over once, so an upgrade keeps it.
          var local = readOpenMode();
          if (j && j.ok && local !== "browser") setOpenMode(local);
          return;
        }
        try {
          localStorage.setItem(LS_OPEN_MODE, j.mode);
        } catch (e) {
          /* fine */
        }
        applyOpenMode(j.mode);
      })
      .catch(function () {
        /* offline server: the local choice stands */
      });
  }

  function closeOpenMenu() {
    mainUiMenu.hidden = true;
    btnMainUiMenu.setAttribute("aria-expanded", "false");
  }

  function openChosenUi() {
    var mode = readOpenMode();
    if (mode === "window") {
      var bridge = window.edexoElectron;
      if (bridge && typeof bridge.openAppWindow === "function") {
        bridge.openAppWindow().then(
          function (r) {
            if (r && r.opened) return;
            launcherActionMsg.className = "msg-launcher err";
            launcherActionMsg.textContent = "Could not open the app window" + (r && r.error ? ": " + r.error : ".");
          },
          function (e) {
            launcherActionMsg.className = "msg-launcher err";
            launcherActionMsg.textContent = "Could not open the app window: " + String(e && e.message ? e.message : e);
          },
        );
      } else {
        // The launcher in a browser (CLI server): a new tab is the nearest thing to a window.
        window.open("/", "_blank", "noopener");
      }
      return;
    }
    launcherActionMsg.className = "msg-launcher";
    launcherActionMsg.textContent = "";
    fetch(apiUrl("/api/ui/open-external"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: OPEN_MODES[mode].view }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { r: r, j: j };
        });
      })
      .then(function (x) {
        if (!x.r.ok || !x.j.ok) throw new Error((x.j && x.j.error) || x.r.statusText);
      })
      .catch(function (e) {
        /*
          Falling back rather than failing: on a build with no such route the commander still
          gets their UI, in a new tab, which is the nearest honest thing to what they asked
          for.
        */
        window.open(mode === "phone" ? "/?screen=triage" : "/", "_blank", "noopener");
        launcherActionMsg.className = "msg-launcher";
        launcherActionMsg.textContent = "Opened in a new tab (" + String(e && e.message ? e.message : e) + ")";
      });
  }

  applyOpenMode(readOpenMode());
  loadSavedOpenMode();
  btnMainUi.addEventListener("click", openChosenUi);
  btnMainUiMenu.addEventListener("click", function (ev) {
    ev.stopPropagation();
    var open = mainUiMenu.hidden;
    mainUiMenu.hidden = !open;
    btnMainUiMenu.setAttribute("aria-expanded", open ? "true" : "false");
  });
  /*
    Streamer view (owner, 2026-10-01): the main UI with every control taken away (?view=stream),
    for a Browser source in OBS on this PC. The link is copied for OBS, and (owner, 2026-10-04: "does
    not open") the view opens in the browser too, so what the viewers will see is on screen at once.
  */
  var btnStreamLink = document.getElementById("btnStreamLink");
  if (btnStreamLink) btnStreamLink.addEventListener("click", function () {
    closeOpenMenu();
    var url = "http://127.0.0.1:" + (lastPort || 7111) + "/?view=stream";
    var say = function (copied) {
      launcherActionMsg.className = "msg-launcher";
      launcherActionMsg.textContent =
        (copied ? "Copied: " : "Streamer view: ") + url +
        " — in OBS add a Browser source with this URL (1280×800 or larger). It follows the game and your body-tab keys." +
        " Add &cmdr=0 to hide your name, &zoom=1.25 to scale it, &bg=transparent to drop the backdrop.";
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { say(true); }, function () { say(false); });
    } else {
      say(false);
    }
    fetch(apiUrl("/api/ui/open-external"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ view: "stream" }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error(String(r.status));
      })
      .catch(function () {
        // A launcher in a browser (CLI server), or an older server: a new tab shows it instead.
        window.open("/?view=stream", "_blank", "noopener");
      });
  });
  mainUiMenu.addEventListener("click", function (ev) {
    var item = ev.target.closest("button[data-open-mode]");
    if (!item) return;
    setOpenMode(item.dataset.openMode);
    closeOpenMenu();
    // Choosing is also asking for it: nobody opens this menu to browse it.
    openChosenUi();
  });
  document.addEventListener("click", function (ev) {
    if (!mainUiMenu.hidden && !mainUiSplit.contains(ev.target)) closeOpenMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !mainUiMenu.hidden) closeOpenMenu();
  });

  /*
    Exomastery menu (owner, 2026-09-26): the main button still refreshes; the arrow offers the
    downloads and the shared folder. The line under the title says what the shared folder holds.
  */
  var exomasteryMenu = document.getElementById("exomasteryMenu");
  var btnExomasteryMenu = document.getElementById("btnExomasteryMenu");
  var exomasterySplit = document.getElementById("exomasterySplit");
  var exomasterySub = document.getElementById("exomasterySub");
  var EXO_SUB_DEFAULT = exomasterySub ? exomasterySub.textContent : "";

  function closeExomasteryMenu() {
    exomasteryMenu.hidden = true;
    btnExomasteryMenu.setAttribute("aria-expanded", "false");
  }

  function refreshSharedLine() {
    fetch(apiUrl("/api/exomastery/shared"))
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (!j || !exomasterySub) return;
        var used = (j.files || []).filter(function (f) {
          return !f.skipped;
        }).length;
        var skipped = (j.files || []).length - used;
        if (used === 0 && skipped === 0) {
          exomasterySub.textContent = EXO_SUB_DEFAULT;
          return;
        }
        var parts = ["Shared: " + used + " file" + (used === 1 ? "" : "s")];
        if (j.finds > 0) {
          parts.push(
            j.finds.toLocaleString() + " finds from " + j.commanders + " commander" + (j.commanders === 1 ? "" : "s"),
          );
        }
        if (j.ownBackupFinds > 0) parts.push("your backup: " + j.ownBackupFinds.toLocaleString());
        if (skipped > 0) parts.push(skipped + " skipped");
        if (j.alerts > 0) parts.push(j.alerts + " gate notice" + (j.alerts === 1 ? "" : "s") + " (mail icon)");
        exomasterySub.textContent = parts.join(" · ");
        exomasterySub.title = (j.files || [])
          .map(function (f) {
            return f.file + (f.skipped ? " — skipped: " + f.skipped : " — " + (f.commander || "?") + ", " + f.entries);
          })
          .join("\n");
      })
      .catch(function () {
        /* the default line stays */
      });
  }

  function exomasteryDownload(kind) {
    launcherActionMsg.className = "msg-launcher";
    launcherActionMsg.textContent = "";
    var bridge = window.edexoElectron;
    fetch(apiUrl("/api/exomastery/export?kind=" + kind))
      .then(function (r) {
        if (!r.ok) throw new Error(r.statusText);
        var cd = r.headers.get("Content-Disposition") || "";
        var m = /filename="([^"]+)"/.exec(cd);
        var name = m ? m[1] : "EDEXO-" + kind + ".json";
        return r.text().then(function (text) {
          return { name: name, text: text };
        });
      })
      .then(function (x) {
        if (bridge && typeof bridge.saveTextFile === "function") {
          return bridge.saveTextFile({ defaultName: x.name, text: x.text }).then(function (res) {
            if (res && res.saved) {
              launcherActionMsg.className = "msg-launcher ok";
              launcherActionMsg.textContent = "Saved " + res.path;
            }
          });
        }
        // The launcher in a browser: an ordinary download.
        var url = URL.createObjectURL(new Blob([x.text], { type: "application/json" }));
        var a = document.createElement("a");
        a.href = url;
        a.download = x.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function () {
          URL.revokeObjectURL(url);
        }, 5000);
      })
      .catch(function (e) {
        launcherActionMsg.className = "msg-launcher err";
        launcherActionMsg.textContent = "Could not download: " + String(e && e.message ? e.message : e);
      });
  }

  function openSharedFolder() {
    fetch(apiUrl("/api/exomastery/open-shared-folder"), { method: "POST" })
      .then(function (r) {
        return r.json();
      })
      .then(function (j) {
        if (!j || !j.ok) throw new Error((j && j.error) || "Could not open the folder.");
        launcherActionMsg.className = "msg-launcher ok";
        launcherActionMsg.textContent =
          "Shared folder: " + j.folder + " — drop exomastery or codex files in, then Refresh exomastery.";
      })
      .catch(function (e) {
        launcherActionMsg.className = "msg-launcher err";
        launcherActionMsg.textContent = String(e && e.message ? e.message : e);
      });
  }

  btnExomasteryMenu.addEventListener("click", function (ev) {
    ev.stopPropagation();
    var open = exomasteryMenu.hidden;
    exomasteryMenu.hidden = !open;
    btnExomasteryMenu.setAttribute("aria-expanded", open ? "true" : "false");
  });
  exomasteryMenu.addEventListener("click", function (ev) {
    var item = ev.target.closest("button[data-exo-action]");
    if (!item) return;
    closeExomasteryMenu();
    var act = item.dataset.exoAction;
    if (act === "refresh") btnExomasteryRefresh.click();
    else if (act === "export-exomastery") exomasteryDownload("exomastery");
    else if (act === "export-codex") exomasteryDownload("codex");
    else if (act === "open-shared") openSharedFolder();
    // "import-dump" opens its panel from its own listener (the import section below).
  });
  document.addEventListener("click", function (ev) {
    if (!exomasteryMenu.hidden && !exomasterySplit.contains(ev.target)) closeExomasteryMenu();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !exomasteryMenu.hidden) closeExomasteryMenu();
  });
  refreshSharedLine();

  btnExomasteryRefresh.addEventListener("click", function () {
    launcherActionMsg.className = "msg-launcher";
    launcherActionMsg.textContent = "";
    btnExomasteryRefresh.disabled = true;
    fetch(apiUrl("/api/exomastery/reload"), { method: "POST" })
      .then(function (r) {
        return r.json().then(function (j) {
          return { r: r, j: j };
        });
      })
      .then(function (x) {
        if (!x.r.ok) throw new Error((x.j && x.j.error) || x.r.statusText);
        launcherActionMsg.className = "msg-launcher ok";
        var j = x.j || {};
        var sd = j.speciesDataDir ? String(j.speciesDataDir) : "";
        launcherActionMsg.textContent =
          "Exomastery cache cleared; species tree re-read from disk — linked UI refreshes over WebSocket." +
          (sd
            ? " Species / exomastery folder: " + sd
            : "");
      })
      .catch(function (e) {
        launcherActionMsg.className = "msg-launcher err";
        launcherActionMsg.textContent = String(e && e.message ? e.message : e);
      })
      .then(function () {
        btnExomasteryRefresh.disabled = false;
        refreshSharedLine();
      });
  });

  function webOriginBase() {
    var proto = window.location.protocol || "";
    if (proto === "http:" || proto === "https:") return window.location.origin;
    return "http://127.0.0.1:" + (lastPort || 7111);
  }

  /*
    Two ways to show the same four HUDs: separate click-through windows, or one merged window
    (/hud-overlay.html?s=…) whose sections are named in its query string. The merge checkbox
    picks the form; the four rows toggle the same content either way. Every window asks for
    the same width so the stack lines up.
  */
  var HUD_W = 404;
  var HUD_MERGED = "/hud-overlay.html";
  var HUD_SECTION_BY_PATH = {
    "/jump-overlay.html": "jump",
    "/fss-scan-overlay.html": "fss",
    "/exo-candidates-overlay.html": "candidates",
    "/distance-overlay.html": "distance",
    "/data-value-overlay.html": "datavalue",
    "/achievement-overlay.html": "achievement",
    "/notable-overlay.html": "notable",
    "/notices-overlay.html": "notices",
  };
  var HUD_SECTION_ORDER = ["jump", "fss", "candidates", "distance", "datavalue", "achievement", "notable", "notices"];
  var HUD_SECTION_LABEL = {
    jump: "Next jump",
    fss: "Discovery scan",
    candidates: "Exo candidates",
    distance: "Exo-distance tracker",
    datavalue: "Data value",
    achievement: "Achievement",
    notable: "Notable planets",
    notices: "Notices",
  };
  var HUD_PATH_BY_SECTION = {};
  Object.keys(HUD_SECTION_BY_PATH).forEach(function (p) {
    HUD_PATH_BY_SECTION[HUD_SECTION_BY_PATH[p]] = p;
  });
  var LS_HUD_MERGE = "edexoHudMerge";
  var ovMerge = document.getElementById("ovMerge");
  function hudMergeOn() {
    try {
      return localStorage.getItem(LS_HUD_MERGE) === "1";
    } catch (e) {
      return false;
    }
  }
  async function hudPaths() {
    var ee = window.edexoElectron;
    try {
      if (ee && typeof ee.getHudOverlayState === "function") {
        var st = await ee.getHudOverlayState();
        return (st && st.paths) || [];
      }
    } catch (e) {
      /* fall through */
    }
    return [];
  }
  function mergedSections(paths) {
    for (var i = 0; i < paths.length; i++) {
      var p = String(paths[i]);
      if (p.indexOf(HUD_MERGED) !== 0) continue;
      var m = /[?&]s=([^&]*)/.exec(p);
      if (!m) return HUD_SECTION_ORDER.slice();
      return decodeURIComponent(m[1]).split(",").filter(function (s) {
        return HUD_SECTION_ORDER.indexOf(s) >= 0;
      });
    }
    return [];
  }
  /** Sections active right now, in either form. */
  function activeSections(paths) {
    var out = mergedSections(paths);
    Object.keys(HUD_SECTION_BY_PATH).forEach(function (p) {
      if (paths.indexOf(p) >= 0 && out.indexOf(HUD_SECTION_BY_PATH[p]) < 0) out.push(HUD_SECTION_BY_PATH[p]);
    });
    return HUD_SECTION_ORDER.filter(function (s) {
      return out.indexOf(s) >= 0;
    });
  }
  /*
    One HUD change at a time (owner, 2026-10-05: "Merge into one panel does not save what was
    selected when I click it twice"). Each change reads which sections are open from the windows that
    exist, so a second click while the first was still opening and closing windows read a half-made
    set (hud-events.log: the merged panel came back with Discovery scan and Next jump only). Queued,
    each change starts from the finished state of the one before.
  */
  var hudChain = Promise.resolve();
  function inHudQueue(task) {
    var run = hudChain.then(task);
    hudChain = run.catch(function () {});
    return run;
  }

  async function showSections(sections) {
    var ee = window.edexoElectron;
    if (!ee) return;
    var paths = await hudPaths();
    if (hudMergeOn()) {
      for (var i = 0; i < paths.length; i++) {
        if (HUD_SECTION_BY_PATH[paths[i]] && typeof ee.closeHudOverlay === "function") {
          await ee.closeHudOverlay({ pathname: paths[i] });
        }
      }
      if (!sections.length) {
        if (typeof ee.closeHudOverlay === "function") await ee.closeHudOverlay({ pathname: HUD_MERGED });
      } else if (typeof ee.setHudOverlay === "function") {
        var ordered = (typeof hudOrder !== "undefined" ? hudOrder : HUD_SECTION_ORDER).filter(function (x) {
          return sections.indexOf(x) >= 0;
        });
        var r = await ee.setHudOverlay({
          pathname: HUD_MERGED + "?s=" + ordered.join(","),
          width: HUD_W,
          height: 330,
        });
        if (r && r.error) throw new Error(r.error);
      }
    } else {
      if (typeof ee.closeHudOverlay === "function") await ee.closeHudOverlay({ pathname: HUD_MERGED });
      var want = {};
      sections.forEach(function (s) {
        want[s] = true;
      });
      for (var p in HUD_SECTION_BY_PATH) {
        var open = paths.indexOf(p) >= 0;
        var should = !!want[HUD_SECTION_BY_PATH[p]];
        if (open !== should && typeof ee.toggleHudOverlay === "function") {
          var rt = await ee.toggleHudOverlay({ pathname: p, width: HUD_W, height: 330 });
          if (rt && rt.error) throw new Error(rt.error);
        }
      }
    }
  }

  async function refreshOverlayMenuChecks() {
    var paths = await hudPaths();
    var active = activeSections(paths);
    document.querySelectorAll("[data-overlay-path]").forEach(function (btn) {
      var p = btn.getAttribute("data-overlay-path");
      if (!p) return;
      var on = active.indexOf(HUD_SECTION_BY_PATH[p]) >= 0;
      btn.classList.toggle("overlay-btn--on", on);
      var mark = btn.querySelector(".overlay-check");
      if (mark) mark.textContent = on ? "✓" : "";
    });
    if (ovMerge) ovMerge.checked = hudMergeOn();
  }

  async function toggleHudOverlayPath(pathname, width, height) {
    launcherActionMsg.className = "msg-launcher";
    launcherActionMsg.textContent = "";
    var ee = window.edexoElectron;
    if (ee && typeof ee.toggleHudOverlay === "function") {
      var rOv = await ee.toggleHudOverlay({ pathname: pathname, width: width, height: height });
      if (rOv && rOv.error) throw new Error(rOv.error);
      await refreshOverlayMenuChecks();
      return;
    }
    var base = webOriginBase();
    var name = "edexoHud" + String(pathname).replace(/[^\w-]+/g, "_");
    window.open(
      base + pathname,
      name,
      "noopener,noreferrer,width=" + width + ",height=" + height,
    );
  }

  function pickOverlay(pathname, width, height) {
    return inHudQueue(function () {
      return pickOverlayNow(pathname, width, height);
    });
  }

  async function pickOverlayNow(pathname, width, height) {
    // The picker stays open: with five HUDs and the settings below, one pick per open was a chore.
    try {
      var ee = window.edexoElectron;
      var sec = HUD_SECTION_BY_PATH[pathname];
      if (ee && sec && typeof ee.setHudOverlay === "function") {
        var active = activeSections(await hudPaths());
        var idx = active.indexOf(sec);
        if (idx >= 0) active.splice(idx, 1);
        else active.push(sec);
        await showSections(
          HUD_SECTION_ORDER.filter(function (s) {
            return active.indexOf(s) >= 0;
          }),
        );
        await refreshOverlayMenuChecks();
        return;
      }
      await toggleHudOverlayPath(pathname, width, height);
    } catch (eOv) {
      launcherActionMsg.className = "msg-launcher err";
      launcherActionMsg.textContent = String(eOv && eOv.message ? eOv.message : eOv);
    }
  }

  if (ovMerge) {
    ovMerge.checked = hudMergeOn();
    ovMerge.addEventListener("change", function () {
      try {
        localStorage.setItem(LS_HUD_MERGE, ovMerge.checked ? "1" : "0");
      } catch (e) {
        /* ignore */
      }
      // Re-show whatever is open in the newly chosen form, after any change still under way.
      var wantMerge = ovMerge.checked;
      void inHudQueue(async function () {
        try {
          // A later click may have flipped it back while this waited: follow the box as it is now.
          if (ovMerge.checked !== wantMerge) return;
          var active = activeSections(await hudPaths());
          if (active.length) await showSections(active);
          await refreshOverlayMenuChecks();
        } catch (eM) {
          launcherActionMsg.className = "msg-launcher err";
          launcherActionMsg.textContent = String(eM && eM.message ? eM.message : eM);
        }
      });
    });
  }

  /*
    Elite's display mode decides whether a HUD can be seen at all: an always-on-top window
    draws over a borderless game and cannot draw over an exclusive fullscreen one, which is a
    Windows rule and not something this app can work around. The server reads the game's own
    DisplaySettings.xml, so this says nothing unless the file actually says Fullscreen -- a
    commander whose Elite lives somewhere this cannot find is not warned on a guess.

    Asked on every open rather than once at boot: he changes the setting mid-session, and that
    is exactly when he comes looking for this menu.
  */
  function refreshDisplayModeWarning() {
    var el = document.getElementById("hudDisplayWarn");
    if (!el) return;
    fetch("/api/elite-display-mode")
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        var msg = j && typeof j.warning === "string" ? j.warning : "";
        el.textContent = msg;
        el.hidden = !msg;
      })
      .catch(function () {
        el.hidden = true;
      });
  }

  if (btnOverlayMenu && overlayPickModal) {
    btnOverlayMenu.addEventListener("click", function () {
      overlayPickModal.classList.add("on");
      void refreshOverlayMenuChecks();
      refreshDisplayModeWarning();
    });
  }
  if (overlayPickClose && overlayPickModal) {
    overlayPickClose.addEventListener("click", function () {
      overlayPickModal.classList.remove("on");
    });
  }
  if (overlayPickModal) {
    overlayPickModal.addEventListener("click", function (e) {
      if (e.target === overlayPickModal) overlayPickModal.classList.remove("on");
    });
  }
  if (ovExoDistance) {
    ovExoDistance.addEventListener("click", function () {
      void pickOverlay("/distance-overlay.html", HUD_W, 330);
    });
  }
  if (ovFssScan) {
    ovFssScan.addEventListener("click", function () {
      void pickOverlay("/fss-scan-overlay.html", HUD_W, 212);
    });
  }
  if (ovExoCandidates) {
    ovExoCandidates.addEventListener("click", function () {
      void pickOverlay("/exo-candidates-overlay.html", HUD_W, 480);
    });
  }
  if (ovDataValue) {
    ovDataValue.addEventListener("click", function () {
      void pickOverlay("/data-value-overlay.html", HUD_W, 268);
    });
  }

  /* ------------------------------------------------------------------ live strip + journal health */
  var LS_STRIP = "edexo.launcher.strip";
  var toggleLiveStrip = document.getElementById("toggleLiveStrip");
  var liveStrip = document.getElementById("liveStrip");
  if (toggleLiveStrip) {
    toggleLiveStrip.checked = readBoolLs(LS_STRIP, false);
    toggleLiveStrip.addEventListener("change", function () {
      writeBoolLs(LS_STRIP, toggleLiveStrip.checked);
      if (liveStrip) liveStrip.hidden = !toggleLiveStrip.checked;
    });
  }
  function setCell(id, text, cls) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = text == null || text === "" ? "—" : String(text);
    el.className = "v" + (text == null || text === "" ? " dim" : "") + (cls ? " " + cls : "");
  }
  function renderLiveStrip(data) {
    if (!liveStrip) return;
    liveStrip.hidden = !readBoolLs(LS_STRIP, false);
    var l = data.live || {};
    setCell("lsSystem", l.systemName);
    setCell("lsBody", l.bodyName);
    setCell("lsBio", l.bioSignals == null ? "" : String(l.bioSignals));
    var cr = l.organicDataValueCredits;
    setCell(
      "lsUnsold",
      cr == null ? "" : Number(cr).toLocaleString() + " CR" + (l.organicPendingSampleCount > 0 ? " · " + l.organicPendingSampleCount + " pending" : ""),
    );
    var jt = l.jumpTarget;
    if (!jt) setCell("lsJump", "");
    else {
      var k = String(jt.starClass || "").toUpperCase();
      var cls = k === "H" ? "bad" : k === "N" ? "cool" : /^[KGBFOAM]$/.test(k) ? "" : "warn";
      setCell("lsJump", jt.starSystem + " · " + (k || "?") + (jt.arrived ? " · arrived" : ""), cls);
    }
  }
  /*
    Only while a HUD is up (that is when a silent journal costs something) and only when the
    journal has gone quiet for ten minutes: a wrong folder or a game that stopped writing.
  */
  var lastHudPathCount = 0;
  function renderJournalHealth(data) {
    var el = document.getElementById("journalHealth");
    if (!el) return;
    var iso = data.lastJournalEventIso;
    var ageMin = iso ? (Date.now() - Date.parse(iso)) / 60000 : null;
    var quiet = ageMin != null && isFinite(ageMin) && ageMin >= 10;
    if (!(lastHudPathCount > 0) || !quiet || data.journalBoot) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.textContent =
      "A HUD is open but the journal has been silent for " + Math.round(ageMin) + " min. If the game is running, " +
      "check the journal folder (" + (data.journalDir || "?") + ") — the HUDs only move when the game writes.";
  }
  setInterval(function () {
    hudPaths().then(function (p) {
      lastHudPathCount = p.length;
    });
  }, 30000);
  hudPaths().then(function (p) {
    lastHudPathCount = p.length;
  });

  /* ------------------------------------------------------------------ HUD settings (theme, order, corner) */
  var LS_HUD_THEME = "edexoHudTheme";
  var LS_HUD_CAND = "edexoHudCandOrder";
  var LS_HUD_REGION = "edexoHudRegion";
  var LS_HUD_SCALE = "edexoHudScale";
  var LS_HUD_ALPHA = "edexoHudOpacity";
  var LS_HUD_AUDIO = "edexoHudAudio";
  var LS_HUD_COMPACT = "edexoHudCompact";
  var LS_HUD_RELEVANT = "edexoHudRelevant";
  var LS_HUD_TYPE = "edexoHudType";
  var LS_HUD_TILT = "edexoHudTilt";
  var LS_HUD_TILT_MODE = "edexoHudTiltMode";
  var LS_HUD_SLANT = "edexoHudSlant";
  var HUD_PRESETS = {
    orange: "#ff8a1f", amber: "#ffb020", red: "#ff4a3a", magenta: "#ff4fd8", purple: "#b46bff",
    blue: "#4fa8ff", cyan: "#3fe0e0", green: "#5fe07a", lime: "#c8f04a", white: "#e8e8f0",
  };
  function readTheme() {
    try {
      return JSON.parse(localStorage.getItem(LS_HUD_THEME) || "{}") || {};
    } catch (e) {
      return {};
    }
  }
  /* Mirror every HUD setting to the server, so a phone renders the HUD the same way (task 13). */
  var syncHudPrefsTimer = null;
  function hudPrefsNow() {
    var prefs = {};
    try { prefs.theme = JSON.parse(localStorage.getItem(LS_HUD_THEME) || "{}") || {}; } catch (e) {}
    try { var sc = parseFloat(localStorage.getItem(LS_HUD_SCALE) || ""); if (isFinite(sc)) prefs.scale = sc; } catch (e) {}
    try { var op = parseFloat(localStorage.getItem(LS_HUD_ALPHA) || ""); if (isFinite(op)) prefs.opacity = op; } catch (e) {}
    try { prefs.candOrder = localStorage.getItem(LS_HUD_CAND) || "likelihood"; } catch (e) {}
    try { prefs.region = localStorage.getItem(LS_HUD_REGION) !== "0"; } catch (e) {}
    try { prefs.audio = localStorage.getItem(LS_HUD_AUDIO) === "1"; } catch (e) {}
    try { prefs.compact = localStorage.getItem(LS_HUD_COMPACT) === "1"; } catch (e) {}
    try { prefs.relevant = localStorage.getItem(LS_HUD_RELEVANT) === "1"; } catch (e) {}
    try { prefs.hudType = localStorage.getItem(LS_HUD_TYPE) || "original"; } catch (e) {}
    try { var tl = parseFloat(localStorage.getItem(LS_HUD_TILT) || ""); prefs.tilt = isFinite(tl) ? tl : 15; } catch (e) {}
    try { prefs.tiltMode = localStorage.getItem(LS_HUD_TILT_MODE) === "slant" ? "slant" : "turn"; } catch (e) {}
    try { var sl = parseFloat(localStorage.getItem(LS_HUD_SLANT) || ""); prefs.slant = isFinite(sl) ? sl : 6; } catch (e) {}
    return prefs;
  }
  function syncHudPrefs() {
    /*
      Live to the overlays first (owner, 2026-09-26). They have a session of their own now, so
      the storage event that used to move them while a slider was dragged no longer reaches
      them; the server mirror arrives ~1.5 s after the slider stops. The Electron process
      forwards this to every HUD window at once.
    */
    try {
      if (window.edexoElectron && typeof window.edexoElectron.pushHudPrefs === "function") {
        window.edexoElectron.pushHudPrefs(hudPrefsNow());
      }
    } catch (e) {
      /* the mirror below still gets there */
    }
    if (syncHudPrefsTimer) clearTimeout(syncHudPrefsTimer);
    syncHudPrefsTimer = setTimeout(function () {
      syncHudPrefsTimer = null;
      var prefs = hudPrefsNow();
      fetch(apiUrl("/api/settings/hud-prefs"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prefs),
      }).catch(function () {});
    }, 400);
  }
  setTimeout(syncHudPrefs, 2500);
  function writeTheme(t) {
    try {
      localStorage.setItem(LS_HUD_THEME, JSON.stringify(t));
    } catch (e) {}
    renderSwatches();
    syncHudPrefs();
  }
  var hudSwatches = document.getElementById("hudSwatches");
  /* Saved HUD colours (guild tester report, 2026-09-30: "allow people to save their own"). */
  var LS_HUD_SCHEMES = "edexoHudSchemes";
  function readSchemes() {
    try {
      var v = JSON.parse(localStorage.getItem(LS_HUD_SCHEMES) || "[]");
      return Array.isArray(v)
        ? v.filter(function (x) {
            return x && typeof x.name === "string" && /^#[0-9a-f]{6}$/i.test(x.accent || "") && /^#[0-9a-f]{6}$/i.test(x.text || "");
          })
        : [];
    } catch (e) {
      return [];
    }
  }
  function writeSchemes(list) {
    try { localStorage.setItem(LS_HUD_SCHEMES, JSON.stringify(list.slice(0, 20))); } catch (e) {}
  }
  var hudThemeAccent = document.getElementById("hudThemeAccent");
  var hudThemeText = document.getElementById("hudThemeText");
  function renderSwatches() {
    if (!hudSwatches) return;
    var t = readTheme();
    var cur = t.preset || "orange";
    hudSwatches.innerHTML = "";
    Object.keys(HUD_PRESETS).forEach(function (name) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "hud-swatch";
      b.title = name;
      b.style.background = HUD_PRESETS[name];
      b.setAttribute("role", "radio");
      b.setAttribute("aria-pressed", cur === name ? "true" : "false");
      b.addEventListener("click", function () {
        writeTheme({ preset: name });
      });
      hudSwatches.appendChild(b);
    });
    readSchemes().forEach(function (sc) {
      var wrap = document.createElement("span");
      wrap.className = "hud-scheme";
      var b = document.createElement("button");
      b.type = "button";
      b.className = "hud-swatch";
      b.title = sc.name;
      b.style.background = "linear-gradient(135deg, " + sc.accent + " 58%, " + sc.text + " 58%)";
      b.setAttribute("role", "radio");
      var on = t.preset === "custom" && t.accent === sc.accent && t.text === sc.text;
      b.setAttribute("aria-pressed", on ? "true" : "false");
      b.addEventListener("click", function () {
        writeTheme({ preset: "custom", accent: sc.accent, text: sc.text });
      });
      var label = document.createElement("span");
      label.textContent = sc.name;
      var x = document.createElement("button");
      x.type = "button";
      x.className = "hud-scheme__x";
      x.title = "Forget " + sc.name;
      x.textContent = "\u00d7";
      x.addEventListener("click", function () {
        writeSchemes(readSchemes().filter(function (o) { return o.name !== sc.name; }));
        renderSwatches();
      });
      wrap.appendChild(b);
      wrap.appendChild(label);
      wrap.appendChild(x);
      hudSwatches.appendChild(wrap);
    });
    if (hudThemeAccent && t.preset === "custom" && t.accent) hudThemeAccent.value = t.accent;
    if (hudThemeText && t.preset === "custom" && t.text) hudThemeText.value = t.text;
  }
  function customTheme() {
    writeTheme({ preset: "custom", accent: hudThemeAccent.value, text: hudThemeText.value });
  }
  if (hudThemeAccent) hudThemeAccent.addEventListener("input", customTheme);
  var hudSchemeName = document.getElementById("hudSchemeName");
  var hudSchemeSave = document.getElementById("hudSchemeSave");
  function saveScheme() {
    var n = ((hudSchemeName && hudSchemeName.value) || "").trim().slice(0, 24);
    if (!n || !hudThemeAccent || !hudThemeText) return;
    var list = readSchemes().filter(function (o) { return o.name.toLowerCase() !== n.toLowerCase(); });
    list.push({ name: n, accent: hudThemeAccent.value, text: hudThemeText.value });
    writeSchemes(list);
    hudSchemeName.value = "";
    writeTheme({ preset: "custom", accent: hudThemeAccent.value, text: hudThemeText.value });
  }
  if (hudSchemeSave) hudSchemeSave.addEventListener("click", saveScheme);
  if (hudSchemeName) {
    hudSchemeName.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") saveScheme();
    });
  }
  if (hudThemeText) hudThemeText.addEventListener("input", customTheme);
  /* size + opacity: the HUD pages read the same keys and re-apply on the storage event */
  var hudScale = document.getElementById("hudScale");
  var hudScaleOut = document.getElementById("hudScaleOut");
  var hudAlpha = document.getElementById("hudAlpha");
  var hudAlphaOut = document.getElementById("hudAlphaOut");
  function showSizeOutputs() {
    if (hudScale && hudScaleOut) hudScaleOut.textContent = hudScale.value + " %";
    if (hudAlpha && hudAlphaOut) hudAlphaOut.textContent = hudAlpha.value + " %";
  }
  if (hudScale) {
    hudScale.addEventListener("input", function () {
      showSizeOutputs();
      try { localStorage.setItem(LS_HUD_SCALE, String(Number(hudScale.value) / 100)); } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudAlpha) {
    hudAlpha.addEventListener("input", function () {
      showSizeOutputs();
      try { localStorage.setItem(LS_HUD_ALPHA, String(Number(hudAlpha.value) / 100)); } catch (e) {}
      syncHudPrefs();
    });
  }
  /* HUD type and the Elite Style's angle (owner, 2026-10-04). */
  var hudType = document.getElementById("hudType");
  var hudTilt = document.getElementById("hudTilt");
  var hudTiltOut = document.getElementById("hudTiltOut");
  var hudTiltRow = document.getElementById("hudTiltRow");
  var hudTiltMode = document.getElementById("hudTiltMode");
  var hudSlant = document.getElementById("hudSlant");
  var hudSlantOut = document.getElementById("hudSlantOut");
  var hudTurnRow = document.getElementById("hudTurnRow");
  var hudSlantRow = document.getElementById("hudSlantRow");
  function syncHudTypeUi() {
    if (hudTiltOut && hudTilt) hudTiltOut.textContent = hudTilt.value + "°";
    if (hudSlantOut && hudSlant) hudSlantOut.textContent = hudSlant.value + "°";
    if (hudTiltRow && hudType) hudTiltRow.style.display = hudType.value === "elite" ? "" : "none";
    var slant = hudTiltMode && hudTiltMode.value === "slant";
    if (hudTurnRow) hudTurnRow.style.display = slant ? "none" : "";
    if (hudSlantRow) hudSlantRow.style.display = slant ? "" : "none";
  }
  if (hudTiltMode) {
    hudTiltMode.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_TILT_MODE, hudTiltMode.value); } catch (e) {}
      syncHudTypeUi();
      syncHudPrefs();
    });
  }
  if (hudSlant) {
    hudSlant.addEventListener("input", function () {
      try { localStorage.setItem(LS_HUD_SLANT, hudSlant.value); } catch (e) {}
      syncHudTypeUi();
      syncHudPrefs();
    });
  }
  /* Each settings fold remembers whether it was open (owner, 2026-10-04). */
  document.querySelectorAll("details.hud-group").forEach(function (d) {
    var key = "edexoHudGroup." + d.getAttribute("data-group");
    try {
      var v = localStorage.getItem(key);
      if (v === "1") d.open = true;
      else if (v === "0") d.open = false;
    } catch (e) {}
    d.addEventListener("toggle", function () {
      try { localStorage.setItem(key, d.open ? "1" : "0"); } catch (e) {}
    });
  });
  if (hudType) {
    hudType.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_TYPE, hudType.value); } catch (e) {}
      syncHudTypeUi();
      syncHudPrefs();
    });
  }
  if (hudTilt) {
    hudTilt.addEventListener("input", function () {
      try { localStorage.setItem(LS_HUD_TILT, hudTilt.value); } catch (e) {}
      syncHudTypeUi();
      syncHudPrefs();
    });
  }
  var hudCompact = document.getElementById("hudCompact");
  if (hudCompact) {
    hudCompact.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_COMPACT, hudCompact.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  var hudRelevant = document.getElementById("hudRelevant");
  if (hudRelevant) {
    hudRelevant.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_RELEVANT, hudRelevant.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  var hudAudio = document.getElementById("hudAudio");
  if (hudAudio) {
    hudAudio.addEventListener("change", function () {
      try { localStorage.setItem(LS_HUD_AUDIO, hudAudio.checked ? "1" : "0"); } catch (e) {}
      syncHudPrefs();
    });
  }
  var hudCandOrder = document.getElementById("hudCandOrder");
  var hudRegion = document.getElementById("hudRegion");
  if (hudCandOrder) {
    hudCandOrder.addEventListener("change", function () {
      try {
        localStorage.setItem(LS_HUD_CAND, hudCandOrder.value);
      } catch (e) {}
      syncHudPrefs();
    });
  }
  if (hudRegion) {
    hudRegion.addEventListener("change", function () {
      try {
        localStorage.setItem(LS_HUD_REGION, hudRegion.checked ? "1" : "0");
      } catch (e) {}
      syncHudPrefs();
    });
  }
  var hudCorner = document.getElementById("hudCorner");
  var hudOrderList = document.getElementById("hudOrderList");
  var hudOrder = HUD_SECTION_ORDER.slice();
  function layoutOrderKeys() {
    // window keys are page paths (query aside); the merged HUD is one window and sorts first
    return [HUD_MERGED].concat(
      hudOrder.map(function (s) {
        return HUD_PATH_BY_SECTION[s];
      }),
    );
  }
  function pushLayout() {
    var ee = window.edexoElectron;
    if (ee && typeof ee.setHudLayout === "function") {
      void ee.setHudLayout({ corner: hudCorner ? hudCorner.value : "tr", order: layoutOrderKeys() });
    }
    // The merged HUD orders its sections itself; re-show it so the panel follows the list.
    if (hudMergeOn()) {
      inHudQueue(function () {
        return hudPaths().then(function (paths) {
          var active = activeSections(paths);
          if (active.length) return showSections(active);
        });
      }).catch(function (e) {
        launcherActionMsg.className = "msg-launcher err";
        launcherActionMsg.textContent = "HUD reorder failed: " + String(e && e.message ? e.message : e);
      });
    }
  }
  function renderOrderList() {
    if (!hudOrderList) return;
    hudOrderList.innerHTML = "";
    hudOrder.forEach(function (sec, i) {
      var li = document.createElement("li");
      var up = document.createElement("button");
      up.type = "button";
      up.textContent = "▲";
      up.title = "Move up";
      up.disabled = i === 0;
      var down = document.createElement("button");
      down.type = "button";
      down.textContent = "▼";
      down.title = "Move down";
      down.disabled = i === hudOrder.length - 1;
      var name = document.createElement("span");
      name.textContent = HUD_SECTION_LABEL[sec] || sec;
      up.addEventListener("click", function () {
        hudOrder.splice(i - 1, 0, hudOrder.splice(i, 1)[0]);
        renderOrderList();
        pushLayout();
      });
      down.addEventListener("click", function () {
        hudOrder.splice(i + 1, 0, hudOrder.splice(i, 1)[0]);
        renderOrderList();
        pushLayout();
      });
      li.appendChild(up);
      li.appendChild(down);
      li.appendChild(name);
      hudOrderList.appendChild(li);
    });
  }
  if (hudCorner) hudCorner.addEventListener("change", pushLayout);

  /*
    Free move (owner, 2026-10-02): the stack leaves its corner for a spot dragged anywhere on any
    screen. Electron keeps the spot with the layout; "Move HUD" starts placing (the HUDs take the
    mouse and show a frame), Done on the HUD or here ends it.
  */
  var hudFree = document.getElementById("hudFree");
  var hudMove = document.getElementById("hudMove");
  var hudMoveHint = document.getElementById("hudMoveHint");
  var hudMoving = false;
  function renderFreeMove(freeOn, moving) {
    if (hudFree) hudFree.checked = !!freeOn;
    if (hudCorner) hudCorner.disabled = !!freeOn;
    hudMoving = !!moving;
    if (hudMove) {
      hudMove.disabled = !freeOn;
      var wrap = document.getElementById("hudMoveWrap");
      if (wrap) {
        wrap.title = freeOn
          ? hudMoving
            ? "Ends placing: the HUD stays where you dropped it."
            : "Drag the HUD by its frame to where you want it."
          : 'Tick "Free move HUD" first: the HUD can only be placed by hand in free move.';
      }
      hudMove.textContent = hudMoving ? "Done" : "Move HUD";
      hudMove.setAttribute("aria-pressed", hudMoving ? "true" : "false");
    }
    if (hudMoveHint) hudMoveHint.hidden = !hudMoving;
  }
  function setHudMoving(on) {
    var ee = window.edexoElectron;
    if (!ee || typeof ee.setHudMoveMode !== "function") return;
    ee.setHudMoveMode({ on: on }).then(function (r) {
      renderFreeMove(hudFree && hudFree.checked, r && r.moving);
    }).catch(function () {});
  }
  if (hudFree && window.edexoElectron && typeof window.edexoElectron.setHudMoveMode === "function") {
    hudFree.addEventListener("change", function () {
      var ee = window.edexoElectron;
      var on = hudFree.checked;
      ee.setHudLayout({ freeOn: on }).then(function () {
        renderFreeMove(on, false);
        // Switching it on is asking to place it: start right away.
        if (on) setHudMoving(true);
      }).catch(function () {});
    });
    if (hudMove) hudMove.addEventListener("click", function () { setHudMoving(!hudMoving); });
  } else if (hudFree) {
    hudFree.closest(".hud-set-row").hidden = true;
  }

  /*
    Show / Hide every HUD (owner, 2026-09-28). The state lives in Electron (hud-layout.json), so
    it survives a restart, and the hotkey and the tray change it too: Electron tells this page
    on every change (`onHudVisibility`), and the modal asks again whenever it opens.
  */
  var hudVisShow = document.getElementById("hudVisShow");
  var hudVisHide = document.getElementById("hudVisHide");
  var hudVisSummary = document.getElementById("hudVisSummary");
  function renderHudVisibility(v) {
    var hidden = !!(v && v.hidden);
    if (hudVisShow) hudVisShow.setAttribute("aria-pressed", hidden ? "false" : "true");
    if (hudVisHide) hudVisHide.setAttribute("aria-pressed", hidden ? "true" : "false");
    if (v && typeof v.moving === "boolean") renderFreeMove(hudFree && hudFree.checked, v.moving);
    if (hudVisSummary) {
      var n = v && typeof v.count === "number" ? v.count : null;
      hudVisSummary.textContent =
        (hidden ? "HUDs are hidden" : v && v.gameAway ? "HUDs wait for Elite" : v && v.focusAway ? "HUDs wait for Elite in front" : "HUDs are shown") +
        (n === 0 ? " (none open)" : n ? " (" + n + " open)" : "");
    }
  }
  function setHudVisibility(hidden) {
    var ee = window.edexoElectron;
    if (!ee || typeof ee.toggleHudVisibility !== "function") return;
    ee.toggleHudVisibility({ hidden: hidden }).then(function (r) {
      renderHudVisibility({ hidden: r && r.hidden });
    }).catch(function () {});
  }
  // Hide when Elite is not in front (owner, 2026-09-30): saved by the app with the HUD layout, on by default.
  var hudHideUnfocused = document.getElementById("hudHideUnfocused");
  if (hudHideUnfocused && window.edexoElectron && typeof window.edexoElectron.getHudLayout === "function") {
    window.edexoElectron.getHudLayout().then(function (l) {
      hudHideUnfocused.checked = !l || l.hideUnfocused !== false;
    }).catch(function () {});
    hudHideUnfocused.addEventListener("change", function () {
      var ee = window.edexoElectron;
      if (ee && typeof ee.setHudLayout === "function") {
        void ee.setHudLayout({ hideUnfocused: hudHideUnfocused.checked });
      }
    });
  } else if (hudHideUnfocused) {
    hudHideUnfocused.closest(".hud-set-row").hidden = true;
  }
  if (hudVisShow) hudVisShow.addEventListener("click", function () { setHudVisibility(false); });
  if (hudVisHide) hudVisHide.addEventListener("click", function () { setHudVisibility(true); });
  if (window.edexoElectron && typeof window.edexoElectron.onHudVisibility === "function") {
    window.edexoElectron.onHudVisibility(renderHudVisibility);
  }
  async function loadHudSettingsIntoModal() {
    renderSwatches();
    if (hudCandOrder) hudCandOrder.value = (function () { try { return localStorage.getItem(LS_HUD_CAND) || "likelihood"; } catch (e) { return "likelihood"; } })();
    if (hudRegion) hudRegion.checked = (function () { try { return localStorage.getItem(LS_HUD_REGION) !== "0"; } catch (e) { return true; } })();
    if (hudAudio) hudAudio.checked = (function () { try { return localStorage.getItem(LS_HUD_AUDIO) === "1"; } catch (e) { return false; } })();
    if (hudCompact) hudCompact.checked = (function () { try { return localStorage.getItem(LS_HUD_COMPACT) === "1"; } catch (e) { return false; } })();
    if (hudType) hudType.value = (function () { try { return localStorage.getItem(LS_HUD_TYPE) || "original"; } catch (e) { return "original"; } })();
    if (hudTilt) hudTilt.value = (function () { try { var v = parseFloat(localStorage.getItem(LS_HUD_TILT) || "15"); return String(isFinite(v) ? v : 15); } catch (e) { return "15"; } })();
    if (hudTiltMode) hudTiltMode.value = (function () { try { return localStorage.getItem(LS_HUD_TILT_MODE) === "slant" ? "slant" : "turn"; } catch (e) { return "turn"; } })();
    if (hudSlant) hudSlant.value = (function () { try { var v = parseFloat(localStorage.getItem(LS_HUD_SLANT) || "6"); return String(isFinite(v) ? v : 6); } catch (e) { return "6"; } })();
    syncHudTypeUi();
    if (hudRelevant) hudRelevant.checked = (function () { try { return localStorage.getItem(LS_HUD_RELEVANT) === "1"; } catch (e) { return false; } })();
    if (hudScale) hudScale.value = String(Math.round((function () { try { return parseFloat(localStorage.getItem(LS_HUD_SCALE) || "1") || 1; } catch (e) { return 1; } })() * 100));
    if (hudAlpha) hudAlpha.value = String(Math.round((function () { try { var v = parseFloat(localStorage.getItem(LS_HUD_ALPHA) || "0.45"); return isFinite(v) ? v : 0.45; } catch (e) { return 0.45; } })() * 100));
    showSizeOutputs();
    var ee = window.edexoElectron;
    if (ee && typeof ee.getHudLayout === "function") {
      try {
        var lay = await ee.getHudLayout();
        if (lay && hudCorner && lay.corner) hudCorner.value = lay.corner;
        if (lay) renderFreeMove(lay.freeOn === true, lay.moving === true);
        if (lay) renderHudVisibility({ hidden: lay.hidden, count: lay.count });
        if (lay && Array.isArray(lay.order) && lay.order.length) {
          var secs = lay.order.map(function (k) { return HUD_SECTION_BY_PATH[k]; }).filter(Boolean);
          hudOrder = secs.concat(HUD_SECTION_ORDER.filter(function (s) { return secs.indexOf(s) < 0; }));
        }
      } catch (e) {}
    }
    renderOrderList();
  }
  if (btnOverlayMenu) btnOverlayMenu.addEventListener("click", function () { void loadHudSettingsIntoModal(); });
  var ovJump = document.getElementById("ovJump");
  if (ovJump) ovJump.addEventListener("click", function () { void pickOverlay("/jump-overlay.html", HUD_W, 160); });
  var ovAchievement = document.getElementById("ovAchievement");
  if (ovAchievement) {
    ovAchievement.addEventListener("click", function () {
      void pickOverlay("/achievement-overlay.html", HUD_W, 220);
    });
  }
  var ovNotable = document.getElementById("ovNotable");
  if (ovNotable) ovNotable.addEventListener("click", function () { void pickOverlay("/notable-overlay.html", HUD_W, 160); });
  var ovNotices = document.getElementById("ovNotices");
  if (ovNotices) ovNotices.addEventListener("click", function () { void pickOverlay("/notices-overlay.html", HUD_W, 140); });

  /* ------------------------------------------------------------------------------ backups */
  var backupModal = document.getElementById("backupModal");
  var btnBackups = document.getElementById("btnBackups");
  var backupSub = document.getElementById("backupSub");
  var backupState = document.getElementById("backupState");
  var backupErr = document.getElementById("backupErr");
  var backupList = document.getElementById("backupList");
  var backupFields = {
    onLeaveGame: document.getElementById("backupOnLeave"),
    everyHours: document.getElementById("backupEvery"),
    folder: document.getElementById("backupFolder"),
    keep: document.getElementById("backupKeep"),
    includeKeys: document.getElementById("backupKeys"),
    includeBioBodies: document.getElementById("backupBio"),
  };
  var backupPoll = null;
  /** The last folder check ({level, against, …}), for the tile's line. */
  var backupRiskLast = null;
  /** From the last status: a folder was chosen (then saving keeps it). */
  var backupFolderChosen = false;

  function backupMb(bytes) {
    return bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + " GB" : (bytes / 1e6).toFixed(1) + " MB";
  }
  function backupWhen(iso) {
    var d = new Date(iso);
    var mins = Math.round((Date.now() - d.getTime()) / 60000);
    var ago =
      mins < 1 ? "just now" : mins < 60 ? mins + " min ago" : mins < 2880 ? Math.round(mins / 60) + " h ago" : Math.round(mins / 1440) + " days ago";
    return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " (" + ago + ")";
  }
  /** The outcome of a restore: its own line, so the status refresh does not overwrite it. */
  function backupNote(msg) {
    var el = document.getElementById("backupMsg");
    if (!el) return;
    el.textContent = msg || "";
    el.hidden = !msg;
  }
  function backupShowErr(msg) {
    if (!backupErr) return;
    backupErr.textContent = msg || "";
    backupErr.style.display = msg ? "" : "none";
  }
  function backupJson(path, body) {
    return fetch(apiUrl(path), body === undefined ? undefined : {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok || !j || j.ok === false) throw new Error((j && j.error) || r.statusText);
        return j;
      });
    });
  }

  /** The tile's line and, when the panel is open, its state and fields. */
  function backupRefresh(fillFields) {
    return backupJson("/api/backup/status")
      .then(function (s) {
        var line;
        var tone = "";
        var risk = backupRiskLast && backupRiskLast.folder === s.folder ? backupRiskLast : null;
        var what = risk && risk.against === "app data" ? "the app's data" : "your journals";
        if (s.running) { line = "Backing up… — please don't close the app"; tone = "yellow"; }
        else if (s.lastError) { line = "Last backup failed — open for details"; tone = "red"; }
        else if (!s.folderChosen) { line = "Choose a backup folder to start automatic backups"; tone = "yellow"; }
        else if (risk && risk.level === "same-volume") { line = "Backups share a drive with " + what + " — a USB drive is safer"; tone = "red"; }
        else if (risk && risk.level === "same-disk") { line = "Same physical drive as " + what + " — a drive failure loses both"; tone = "yellow"; }
        else if (s.last) line = "Last: " + backupWhen(s.last.at) + " · " + backupMb(s.last.bytes);
        else line = "Not backed up yet — journals, your data and codex";
        if (backupSub) {
          backupSub.textContent = line;
          backupSub.className = "subline" + (tone ? " backup-sub--" + tone : "");
        }
        backupFolderChosen = !!s.folderChosen;
        var needs = document.getElementById("backupNeedsFolder");
        if (needs) needs.hidden = !!s.folderChosen;
        if (!risk || Date.now() - (backupRiskLast.at || 0) > 60000) backupCheckFolder(s.folder, true);
        if (backupState) {
          backupState.className = "backup-state" + (s.running ? " busy" : s.lastError ? " err" : "");
          var parts = [];
          if (s.running) parts.push("Backing up (" + (s.reason || "now") + ")…");
          else if (s.last) parts.push("Last backup " + backupWhen(s.last.at) + " · " + backupMb(s.last.bytes) + " · " + (s.last.kind === "full" ? "everything" : "new journals and your data"));
          else parts.push("No backup yet.");
          if (s.pendingAt) parts.push("The game has closed: a backup starts in about a minute.");
          if (!s.folderChosen) parts.push("Automatic backups start once you choose a folder.");
          if (s.lastError) parts.push("Problem: " + s.lastError.message);
          parts.push(s.count + " in " + s.folder);
          backupState.textContent = parts.join("  ·  ");
        }
        var restartRow = document.getElementById("backupRestartRow");
        if (restartRow) restartRow.hidden = !s.restorePending;
        var nowBtn = document.getElementById("backupNow");
        if (nowBtn) nowBtn.disabled = !!s.running;
        if (fillFields) {
          backupFields.onLeaveGame.checked = !!s.settings.onLeaveGame;
          backupFields.everyHours.value = String(s.settings.everyHours);
          backupFields.folder.value = s.folder;
          backupFields.keep.value = String(s.settings.keep);
          backupFields.includeKeys.checked = !!s.settings.includeKeys;
          backupFields.includeBioBodies.checked = !!s.settings.includeBioBodies;
          backupCheckFolder(s.folder);
        }
        return s;
      })
      .catch(function () {
        if (backupSub) backupSub.textContent = "Journals, your data and codex — kept as zips";
      });
  }

  function backupLoadList() {
    if (!backupList) return;
    backupJson("/api/backup/list")
      .then(function (j) {
        backupList.innerHTML = "";
        if (!j.backups.length) {
          var li = document.createElement("li");
          li.textContent = "No backups in this folder yet.";
          backupList.appendChild(li);
          return;
        }
        j.backups.forEach(function (b) {
          var li = document.createElement("li");
          var name = document.createElement("span");
          name.textContent = backupWhen(b.created) + " · " + backupMb(b.bytes);
          var meta = document.createElement("em");
          meta.textContent =
            (b.kind === "full" ? "All " + b.journals + " journal files" : b.journals + (b.journals === 1 ? " new journal file" : " new journal files") + " (needs the backup before it)") +
            ", " + b.appDataFiles + " app files" + (b.errors ? " · " + b.errors + " problem(s)" : "") + " — " + b.file;
          var actions = document.createElement("span");
          actions.className = "backup-actions";
          var ra = document.createElement("button");
          ra.type = "button";
          ra.className = "btn-mini";
          ra.textContent = "App data";
          ra.title = "Put this backup's app data back when the app next starts";
          ra.addEventListener("click", function () { backupRestoreAppData(b.file); });
          var rj = document.createElement("button");
          rj.type = "button";
          rj.className = "btn-mini";
          rj.textContent = "Journals";
          rj.title = "Write this backup's journals into a folder you choose";
          rj.addEventListener("click", function () { backupRestoreJournals(b.file); });
          actions.appendChild(ra);
          actions.appendChild(rj);
          li.appendChild(name);
          li.appendChild(actions);
          li.appendChild(meta);
          backupList.appendChild(li);
        });
      })
      .catch(function (e) { backupShowErr("Could not list the backups: " + (e && e.message ? e.message : e)); });
  }

  /** Red: same partition as the journals or app data. Yellow: same physical drive. */
  function backupCheckFolder(folder, forTile) {
    var box = document.getElementById("backupRisk");
    if (!box) return;
    var q = folder ? "?folder=" + encodeURIComponent(folder) : "";
    backupJson("/api/backup/folder-check" + q)
      .then(function (r) {
        var had = backupRiskLast && backupRiskLast.folder === r.folder && backupRiskLast.level === r.level;
        r.at = Date.now();
        backupRiskLast = r;
        if (forTile && !had) backupRefresh(false);
        var what = r.against === "journals" ? "your journals" : "the app's data";
        var here = r.folderVolume ? " (" + r.folderVolume + ")" : "";
        var there = r.dataVolume ? " (" + r.dataVolume + ")" : "";
        var usb = r.usb ? " It is on a USB drive." : "";
        box.hidden = false;
        if (r.level === "same-volume") {
          box.className = "backup-risk backup-risk--red";
          box.innerHTML = "";
          var b = document.createElement("strong");
          b.textContent = "Same partition as " + what + there + ". ";
          box.appendChild(b);
          box.appendChild(document.createTextNode(
            "Backups here still bring back deleted or damaged files, but if the drive fails, is wiped or Windows is " +
            "reinstalled, they are lost together with the originals. Another drive, a USB drive or a synced folder is safer. " +
            "If this is the only drive you have, backing up here is still better than no backup."
          ));
        } else if (r.level === "same-disk") {
          box.className = "backup-risk backup-risk--yellow";
          box.innerHTML = "";
          var y = document.createElement("strong");
          y.textContent = "Same physical drive. ";
          box.appendChild(y);
          box.appendChild(document.createTextNode(
            "This folder" + here + " is on another partition of the drive that holds " + what + there + ". It survives a wiped " +
            "partition, but if the drive itself fails, the data and its backups are lost for good. Another drive or a USB drive is safer."
          ));
        } else if (r.level === "separate") {
          box.className = "backup-risk backup-risk--ok";
          box.textContent = r.network
            ? "A network folder: separate from your journals and the app's data."
            : "A separate drive from your journals and the app's data." + usb;
        } else {
          box.hidden = true;
        }
      })
      .catch(function () { box.hidden = true; });
  }

  /**
   * Save the panel. The folder counts as chosen only when the commander touched it (typed, Browse…,
   * Use this folder) or had chosen one before — ticking another box must not confirm the suggestion.
   */
  function backupSave(confirmFolder) {
    backupShowErr("");
    var typed = backupFields.folder.value.trim();
    return backupJson("/api/backup/settings", {
      onLeaveGame: backupFields.onLeaveGame.checked,
      everyHours: Number(backupFields.everyHours.value),
      folder: typed && (confirmFolder === true || backupFolderChosen) ? typed : null,
      keep: Number(backupFields.keep.value),
      includeKeys: backupFields.includeKeys.checked,
      includeBioBodies: backupFields.includeBioBodies.checked,
    })
      .then(function () { return backupRefresh(true); })
      .then(backupLoadList)
      .catch(function (e) { backupShowErr("Could not save: " + (e && e.message ? e.message : e)); });
  }

  function backupPickFolder(start) {
    var bridge = window.edexoElectron;
    if (bridge && typeof bridge.pickFolder === "function") {
      return bridge.pickFolder({ defaultPath: start || "" }).then(function (r) { return r && r.path ? r.path : null; });
    }
    var typed = window.prompt("Folder (full path):", start || "");
    return Promise.resolve(typed && typed.trim() ? typed.trim() : null);
  }

  function backupRestoreAppData(file) {
    if (!window.confirm(
      "Restore your app data from " + file + "?\n\nIt is put back the next time the app starts. Every file it replaces is moved into a before-restore folder, not deleted."
    )) return;
    backupShowErr("");
    backupJson("/api/backup/restore", { file: file, what: "app-data" })
      .then(function (r) {
        backupNote(r.staged + " files are ready. Restart the app to finish the restore.");
        return backupRefresh(false);
      })
      .catch(function (e) { backupShowErr("Could not restore: " + (e && e.message ? e.message : e)); });
  }

  function backupRestoreJournals(file) {
    backupPickFolder("").then(function (target) {
      if (!target) return;
      var send = function (allowGameFolder) {
        return backupJson("/api/backup/restore", { file: file, what: "journals", target: target, allowGameFolder: allowGameFolder });
      };
      backupShowErr("");
      send(false)
        .catch(function (e) {
          var msg = e && e.message ? e.message : String(e);
          if (/second confirmation/.test(msg) && window.confirm(
            "That is the game's own journal folder.\n\nFiles already there are never replaced — only missing journals are written. Restore into it anyway?"
          )) return send(true);
          throw e;
        })
        .then(function (r) {
          if (!r) return;
          backupNote(
            r.written + " journal files written to " + r.target + (r.skippedExisting ? "; " + r.skippedExisting + " were already there and were left alone." : "."),
          );
        })
        .catch(function (e) { backupShowErr("Could not restore the journals: " + (e && e.message ? e.message : e)); });
    });
  }

  if (btnBackups && backupModal) {
    btnBackups.addEventListener("click", function () {
      backupShowErr("");
      backupNote("");
      backupModal.classList.add("on");
      backupRefresh(true);
      backupLoadList();
      if (backupPoll) clearInterval(backupPoll);
      backupPoll = setInterval(function () { backupRefresh(false); }, 3000);
    });
    var closeBackups = function () {
      backupModal.classList.remove("on");
      if (backupPoll) clearInterval(backupPoll);
      backupPoll = null;
    };
    document.getElementById("backupClose").addEventListener("click", closeBackups);
    backupModal.addEventListener("click", function (e) { if (e.target === backupModal) closeBackups(); });
    ["onLeaveGame", "everyHours", "keep", "includeKeys", "includeBioBodies"].forEach(function (k) {
      backupFields[k].addEventListener("change", function () { backupSave(false); });
    });
    backupFields.folder.addEventListener("change", function () { backupSave(true); });
    // Keeping the suggested folder is a choice too (one-drive PCs): confirm it as it stands.
    document.getElementById("backupUseFolder").addEventListener("click", function () {
      if (!backupFields.folder.value.trim()) return;
      backupSave(true);
    });
    document.getElementById("backupBrowse").addEventListener("click", function () {
      backupPickFolder(backupFields.folder.value).then(function (p) {
        if (!p) return;
        backupFields.folder.value = p;
        backupSave(true);
      });
    });
    document.getElementById("backupNow").addEventListener("click", function () {
      backupShowErr("");
      var p = backupJson("/api/backup/run", {});
      setTimeout(function () { backupRefresh(false); }, 150);
      p.then(function () { return backupRefresh(false); })
        .then(backupLoadList)
        .catch(function (e) { backupShowErr("Backup failed: " + (e && e.message ? e.message : e)); backupRefresh(false); });
    });
    document.getElementById("backupOpenFolder").addEventListener("click", function () {
      backupJson("/api/backup/open-folder", {}).catch(function (e) { backupShowErr(String(e && e.message ? e.message : e)); });
    });
    document.getElementById("backupRestart").addEventListener("click", function () {
      var bridge = window.edexoElectron;
      if (bridge && typeof bridge.relaunch === "function") bridge.relaunch();
      else backupShowErr("Close the app and start it again to finish the restore.");
    });
  }
  backupRefresh(false);
  setInterval(function () { if (!backupModal || !backupModal.classList.contains("on")) backupRefresh(false); }, 60000);

  /* ------------------------------------------------------------------ import Spansh export */
  var importModal = document.getElementById("importModal");
  var btnImportDump = document.getElementById("btnImportDump");
  var importClose = document.getElementById("importClose");
  var importStart = document.getElementById("importStart");
  var importFile = document.getElementById("importFile");
  var importApply = document.getElementById("importApply");
  var importStatus = document.getElementById("importStatus");
  var importNewer = document.getElementById("importNewer");
  var importNewerText = document.getElementById("importNewerText");
  var importNewerGo = document.getElementById("importNewerGo");
  var LS_IMPORT_FILE = "edexo.launcher.importFile";
  function rememberedImportFile() {
    try { return localStorage.getItem(LS_IMPORT_FILE) || ""; } catch (e) { return ""; }
  }
  /* The "newer export on disk" chip (owner, 2026-09-13): mtime moved since the last import of that file. */
  function renderImportNewer(st) {
    var show = !!(st && st.newerOnDisk && !st.running);
    if (importNewer) importNewer.hidden = !show;
    if (btnImportDump) btnImportDump.classList.toggle("btn--attn", show);
    // The item sits in a closed menu: the menu's arrow carries the glow where it can be seen.
    var exoArrow = document.getElementById("btnExomasteryMenu");
    if (exoArrow) {
      exoArrow.classList.toggle("btn--attn", show);
      exoArrow.title = show ? "A newer Spansh export is on disk — Import Spansh export" : "";
    }
    if (show && importNewerText) {
      var when = st.fileMtimeIso ? new Date(st.fileMtimeIso).toLocaleString() : "";
      importNewerText.textContent = "Newer export on disk" + (when ? " (" + when + ")" : "") + " — last imported " + (st.lastImport && st.lastImport.finishedAt ? new Date(st.lastImport.finishedAt).toLocaleString() : "before") + ".";
    }
  }
  function startImport(file, apply) {
    if (importStart) importStart.disabled = true;
    return fetch(apiUrl("/api/feeder/import-dump"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ file: file, apply: !!apply }),
    })
      .then(function (r) { return r.json().then(function (j) { return { r: r, j: j }; }); })
      .then(function (x) {
        if (!x.r.ok || !x.j.ok) throw new Error((x.j && x.j.error) || x.r.statusText);
        showImportStatus("Started…", "");
        if (!importPollTimer) pollImport();
      })
      .catch(function (e) {
        if (importStart) importStart.disabled = false;
        showImportStatus(String(e && e.message ? e.message : e), "err");
      });
  }
  if (importNewerGo) {
    importNewerGo.addEventListener("click", function () {
      var file = rememberedImportFile();
      if (!file) return;
      pollImport(); // refresh once so the apply flag below is the latest
      fetch(apiUrl("/api/feeder/import-dump/status?file=" + encodeURIComponent(file)), { cache: "no-store" })
        .then(function (r) { return r.json(); })
        .then(function (st) { return startImport(file, st && st.lastImport ? st.lastImport.apply : !!(importApply && importApply.checked)); });
    });
  }
  var importPollTimer = null;
  function showImportStatus(text, cls) {
    if (!importStatus) return;
    importStatus.hidden = false;
    importStatus.className = "import-status" + (cls ? " " + cls : "");
    importStatus.textContent = text;
  }
  function renderImportStatus(st) {
    if (!st) return;
    if (st.running) {
      showImportStatus("Running since " + (st.startedAt || "?") + "\n" + (st.file || ""), "");
      if (importStart) importStart.disabled = true;
      return;
    }
    if (importStart) importStart.disabled = false;
    if (st.error) showImportStatus("Failed: " + st.error, "err");
    else if (st.report) showImportStatus(st.report, st.failures > 0 ? "err" : "ok");
    else if (importStatus) importStatus.hidden = true;
  }
  function pollImport() {
    var remembered = rememberedImportFile();
    fetch(apiUrl("/api/feeder/import-dump/status" + (remembered ? "?file=" + encodeURIComponent(remembered) : "")), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (st) {
        renderImportStatus(st);
        renderImportNewer(st);
        if (st && st.running) importPollTimer = setTimeout(pollImport, 2000);
        else importPollTimer = null;
      })
      .catch(function () { importPollTimer = null; });
  }
  if (btnImportDump && importModal) {
    btnImportDump.addEventListener("click", function () {
      try { if (importFile && !importFile.value) importFile.value = localStorage.getItem(LS_IMPORT_FILE) || ""; } catch (e) {}
      importModal.classList.add("on");
      pollImport();
    });
  }
  if (importClose && importModal) importClose.addEventListener("click", function () { importModal.classList.remove("on"); });
  if (importModal) importModal.addEventListener("click", function (e) { if (e.target === importModal) importModal.classList.remove("on"); });
  if (importStart) {
    importStart.addEventListener("click", function () {
      var file = importFile ? importFile.value.trim() : "";
      if (!file) { showImportStatus("Enter the path to the .jsonl.gz file.", "err"); return; }
      try { localStorage.setItem(LS_IMPORT_FILE, file); } catch (e) {}
      void startImport(file, !!(importApply && importApply.checked));
    });
  }
  /* One silent check at start-up, so the button glows when there is something to import. */
  if (rememberedImportFile()) setTimeout(pollImport, 4000);

  /* ------------------------------------------------------------------ Linux setup */
  /*
    The Linux start-up check (server: linuxCheck.ts). Only failures come back, each with the install
    command for this distro. Shown once per set of problems: closing it remembers that set, and a
    new problem shows it again. Ctrl+Alt+H being taken is Electron's to know, so it is added here.
  */
  var LS_LINUX_SEEN = "edexo.launcher.linuxSetupSeen";
  var linuxSetupModal = document.getElementById("linuxSetupModal");
  var linuxSetupList = document.getElementById("linuxSetupList");
  var linuxSetupIntro = document.getElementById("linuxSetupIntro");
  var linuxSetupSig = "";
  // The first-run card goes first (the journal folder matters most); this one waits for it.
  var linuxSetupPending = false;
  function wizardIsOpen() {
    var wz = document.getElementById("wizardModal");
    return !!(wz && wz.classList.contains("on"));
  }
  function linuxSetupItemEl(it) {
    var li = document.createElement("li");
    li.className = it.severity || "warning";
    var t = document.createElement("strong");
    t.textContent = it.title;
    var d = document.createElement("div");
    d.textContent = it.detail;
    li.appendChild(t);
    li.appendChild(d);
    if (it.command) {
      var row = document.createElement("div");
      row.className = "linux-setup-cmd";
      var code = document.createElement("code");
      code.textContent = it.command;
      var copy = document.createElement("button");
      copy.type = "button";
      copy.className = "btn-mini";
      copy.textContent = "Copy";
      copy.addEventListener("click", function () {
        try {
          void navigator.clipboard.writeText(it.command).then(function () { copy.textContent = "Copied"; });
        } catch (e) {}
      });
      row.appendChild(code);
      row.appendChild(copy);
      li.appendChild(row);
    } else if (it.packages && it.packages.length) {
      var p = document.createElement("div");
      p.className = "hint";
      p.textContent = "Install with your package manager: " + it.packages.join(", ");
      li.appendChild(p);
    }
    if (it.then) {
      var th = document.createElement("div");
      th.className = "hint";
      th.textContent = "Then: " + it.then.replace(/`/g, "");
      li.appendChild(th);
    }
    return li;
  }
  async function loadLinuxSetup(force) {
    var r;
    try {
      r = await (await fetch(apiUrl("/api/system/linux-check"), { cache: "no-store" })).json();
    } catch (e) {
      return;
    }
    if (!r || !r.applicable) return;
    var items = (r.items || []).slice();
    var ee = window.edexoElectron;
    if (ee && typeof ee.getHotkeyStatus === "function") {
      try {
        var hk = await ee.getHotkeyStatus();
        if (hk && hk.registered === false) {
          items.push({
            id: "hotkey",
            severity: "warning",
            title: hk.shortcut + " is taken",
            detail:
              "Your desktop (or another app) already uses " + hk.shortcut + ", so it cannot show and hide the HUDs. " +
              "Free it in your desktop's keyboard shortcuts and restart, or use Show / Hide in the Overlays menu.",
          });
        }
      } catch (e) {}
    }
    var sig = items.map(function (i) { return i.id; }).sort().join(",");
    if (!items.length) { if (linuxSetupModal) linuxSetupModal.classList.remove("on"); return; }
    if (!force) {
      var seen = null;
      try { seen = localStorage.getItem(LS_LINUX_SEEN); } catch (e) {}
      if (seen === sig) return;
    }
    linuxSetupSig = sig;
    if (linuxSetupIntro) {
      linuxSetupIntro.textContent =
        (r.distro && r.distro.name ? r.distro.name : "Linux") +
        (r.session ? " · " + r.session : "") +
        (r.desktop ? " · " + r.desktop : "") +
        " — " + items.length + (items.length === 1 ? " thing" : " things") + " to sort out:";
    }
    if (linuxSetupList) {
      linuxSetupList.innerHTML = "";
      items.forEach(function (it) { linuxSetupList.appendChild(linuxSetupItemEl(it)); });
    }
    if (wizardIsOpen()) {
      linuxSetupPending = true;
      return;
    }
    if (linuxSetupModal) linuxSetupModal.classList.add("on");
  }
  function closeLinuxSetup() {
    try { localStorage.setItem(LS_LINUX_SEEN, linuxSetupSig); } catch (e) {}
    if (linuxSetupModal) linuxSetupModal.classList.remove("on");
  }
  var linuxSetupClose = document.getElementById("linuxSetupClose");
  var linuxSetupRecheck = document.getElementById("linuxSetupRecheck");
  if (linuxSetupClose) linuxSetupClose.addEventListener("click", closeLinuxSetup);
  if (linuxSetupRecheck) linuxSetupRecheck.addEventListener("click", function () { void loadLinuxSetup(true); });
  void loadLinuxSetup(false);

  /* ------------------------------------------------------------------ close to tray */
  var trayPrefRow = document.getElementById("trayPrefRow");
  var trayPref = document.getElementById("trayPref");
  var trayNote = document.getElementById("trayNote");
  var trayWhere = /Windows/i.test(navigator.userAgent)
    ? "Closing (X) keeps the app running in the tray: the ˄ arrow next to the clock, bottom right of the taskbar. Click it, then the EDEXO icon to bring the launcher back; right-click the icon to quit."
    : "Closing (X) keeps the app running in the tray, the icon area in your desktop's panel. Click the EDEXO icon there to bring the launcher back; right-click it to quit.";
  function renderTrayPref(p) {
    if (!trayPrefRow || !trayPref || !p) return;
    trayPrefRow.hidden = false;
    if (trayNote) {
      // Only while it is on: with it off the X quits, and there is nothing in the tray to find.
      trayNote.hidden = !p.available || !p.enabled;
      trayNote.textContent = trayWhere;
    }
    trayPref.checked = !!p.enabled && !!p.available;
    trayPref.disabled = !p.available;
    trayPrefRow.classList.toggle("is-off", !p.available);
    trayPrefRow.title = p.available
      ? "Minimise still goes to the taskbar. " + trayWhere
      : p.reason || "This system has no tray.";
  }
  (function () {
    var ee = window.edexoElectron;
    if (!ee || typeof ee.getTrayPref !== "function") return;
    ee.getTrayPref().then(renderTrayPref).catch(function () {});
    if (trayPref) {
      trayPref.addEventListener("change", function () {
        ee.setTrayPref({ enabled: trayPref.checked }).then(renderTrayPref).catch(function () {});
      });
    }
  })();

  /* ------------------------------------------------------------------ first-run wizard */
  var LS_WIZARD = "edexo.launcher.wizardDone";
  var wizardModal = document.getElementById("wizardModal");
  var wizardShown = false;
  function maybeShowWizard(data) {
    if (wizardShown || !wizardModal || data.journalBoot) return;
    if (readBoolLs(LS_WIZARD, false)) return;
    wizardShown = true;
    var ok = data.journalDirConfiguredOk === true && data.journalFileCount > 0;
    var st = document.getElementById("wzJournal");
    var dir = document.getElementById("wzJournalDir");
    if (st) { st.textContent = ok ? "found, " + data.journalFileCount + " log file(s)" : data.journalDirConfiguredOk ? "folder found, no logs yet" : "not found — set it"; st.className = "st " + (ok ? "ok" : "bad"); }
    if (dir) dir.textContent = data.journalDir || "";
    fillWizardQuestions(data);
    // A Linux setup card already up steps aside and comes back when this one closes.
    if (linuxSetupModal && linuxSetupModal.classList.contains("on")) {
      linuxSetupModal.classList.remove("on");
      linuxSetupPending = true;
    }
    wizardModal.classList.add("on");
  }
  function closeWizard() {
    if (wizardModal) wizardModal.classList.remove("on");
    if (linuxSetupPending) {
      linuxSetupPending = false;
      void loadLinuxSetup(true);
    }
  }
  /*
    The two questions (combined plan, Phase 5 [O-B]). Each box is the setting itself, saved on
    the tick like its twin in the launcher: LAN access (only where the app has the switch; it
    applies at the next start) and Close to tray (Electron, where this system has a tray).
  */
  var wzLanStep = document.getElementById("wzLanStep");
  var wzLan = document.getElementById("wzLan");
  var wzLanSt = document.getElementById("wzLanSt");
  var wzTrayStep = document.getElementById("wzTrayStep");
  var wzTray = document.getElementById("wzTray");
  var wzTrayNote = document.getElementById("wzTrayNote");
  var WZ_TRAY_OFF = "Off: closing the window quits the app.";
  function renderWzLan(la) {
    if (!wzLanSt || !la) return;
    var pending = !!la.saved !== !!la.active;
    wzLanSt.className = "st" + (la.saved ? " ok" : "");
    wzLanSt.textContent = pending
      ? la.saved
        ? "on after a restart"
        : "off after a restart"
      : la.active
        ? "on: the links are under Network"
        : "off: this PC only";
  }
  function fillWizardQuestions(data) {
    var la = data && data.lanAccess;
    if (wzLanStep && wzLan && la) {
      wzLanStep.hidden = false;
      wzLan.checked = !!la.saved;
      renderWzLan(la);
    }
    var ee = window.edexoElectron;
    if (wzTrayStep && wzTray && ee && typeof ee.getTrayPref === "function") {
      ee.getTrayPref()
        .then(function (p) {
          if (!p || !p.available) return;
          wzTrayStep.hidden = false;
          wzTray.checked = !!p.enabled;
          if (wzTrayNote) wzTrayNote.textContent = p.enabled ? trayWhere : WZ_TRAY_OFF;
        })
        .catch(function () {});
    }
  }
  if (wzLan) wzLan.addEventListener("change", function () {
    if (lanAccessToggle) lanAccessToggle.checked = wzLan.checked;
    void saveLanAccess(wzLan.checked).then(function (j) {
      if (j && j.ok) renderWzLan(j.lanAccess);
    });
  });
  if (wzTray) wzTray.addEventListener("change", function () {
    var ee = window.edexoElectron;
    if (!ee || typeof ee.setTrayPref !== "function") return;
    ee.setTrayPref({ enabled: wzTray.checked })
      .then(function (p) {
        renderTrayPref(p);
        if (wzTrayNote && p) wzTrayNote.textContent = p.enabled ? trayWhere : WZ_TRAY_OFF;
      })
      .catch(function () {});
  });

  var wzDone = document.getElementById("wzDone");
  var wzSetJournal = document.getElementById("wzSetJournal");
  var wzOpenHud = document.getElementById("wzOpenHud");
  if (wzDone) wzDone.addEventListener("click", function () { writeBoolLs(LS_WIZARD, true); closeWizard(); });
  if (wzSetJournal) wzSetJournal.addEventListener("click", function () { closeWizard(); btnOptions.click(); });
  if (wzOpenHud) wzOpenHud.addEventListener("click", function () {
    void pickOverlay("/distance-overlay.html", HUD_W, 330).then(function () {
      var s = document.getElementById("wzHud");
      if (s) { s.textContent = "opened — look at the top right of your screen"; s.className = "st ok"; }
    });
  });
  if (wizardModal) wizardModal.addEventListener("click", function (e) { if (e.target === wizardModal) closeWizard(); });

  connectWs();
  loopPoll();
})();

// The logo hides itself when the icon cannot load (was an inline onerror, which the CSP forbids).
(function () {
  var logo = document.querySelector("img.logo");
  if (!logo) return;
  var hide = function () {
    logo.style.display = "none";
  };
  if (logo.complete && logo.naturalWidth === 0) hide();
  else logo.addEventListener("error", hide);
})();
